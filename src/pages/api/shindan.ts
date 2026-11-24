// @ts-nocheck
// 無料業務診断：結果票のメール送付の受付。受付を D1 に保存し、裏で PDF を作って Resend で送る。
// 迷惑送信よけ：見えない欄（website）、表示から送信までの時間、同じ IP（10分3回）、同じメールアドレス（24時間3回）。
import type { APIRoute } from "astro";
import { env, waitUntil } from "cloudflare:workers";
import logoSvg from "../../../public/assets/logo.svg?raw";
import * as shindan from "../../server/shindan.js";

const EMAIL_RE = /^[^\s@<>()"',;]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const clip = (v: unknown, n: number) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, n);

export const POST: APIRoute = async ({ request, clientAddress }) => {
	const res = (code: number, obj: unknown) =>
		new Response(JSON.stringify(obj), { status: code, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
	const fail = (code: number, message: string) => res(code, { ok: false, message });

	const text = await request.text().catch(() => "");
	let b: Record<string, any> = {};
	try {
		b = text.length <= 20000 ? JSON.parse(text || "{}") : {};
	} catch {
		b = {};
	}
	if (b.website || Number(b.elapsed ?? 0) < 5000) return res(200, { ok: true });

	const name = clip(b.name, 100);
	const email = clip(b.email, 254);
	const company = clip(b.company, 150);
	if (!name) return fail(400, "お名前を入力してください。");
	if (!EMAIL_RE.test(email)) return fail(400, "メールアドレスの形を確かめてください。");
	if (!b.agree) return fail(400, "プライバシーポリシーへの同意が必要です。");
	const industry = shindan.INDUSTRIES.includes(b.industry) ? b.industry : "そのほか";
	const answers = shindan.parseAnswers(b.answers, industry);
	if (!answers) return fail(400, "診断の回答がそろっていません。もう一度「結果を見る」を押してからお試しください。");
	const size = shindan.SIZES.includes(b.size) ? b.size : "5〜20名";

	const ip = clientAddress || request.headers.get("cf-connecting-ip") || "unknown";
	const kv = env.SESSION;
	if (kv) {
		const key = `shindan:${ip}`;
		const n = Number((await kv.get(key)) || 0);
		if (n >= 3) return fail(429, "送信が続いています。少し時間をおいてお試しください。");
		await kv.put(key, String(n + 1), { expirationTtl: 600 });
	}
	try {
		if ((await shindan.recentCount(email)) >= 3) return fail(429, "このメールアドレスへの送付が続いています。時間をおいてお試しください。");
		const { id, token } = await shindan.createRequest({ company, name, email, industry, size, answers, consent: !!b.consent, ip });
		waitUntil(shindan.processRequest(id, token, logoSvg));
		return res(200, { ok: true });
	} catch (e) {
		console.error("shindan request", e);
		return fail(500, "受付に失敗しました。お手数ですが、少し時間をおいてもう一度お試しください。");
	}
};
