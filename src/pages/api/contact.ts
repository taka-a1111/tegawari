// @ts-nocheck
// お問い合わせフォームの受付。内容を Cloudflare のメール送信（send_email）で運営者の Gmail に転送する。
// 送信元は Email Routing を有効にした tegawari.com のアドレス。宛先は秘密の値 CONTACT_TO（wrangler secret）で入れ、リポジトリには書かない。
// 迷惑送信よけ：見えない欄（website）、表示から送信までの時間、URLの数、同じ送り主からの連続送信（KV に10分）。
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { EmailMessage } from "cloudflare:email";

const FROM = "form@tegawari.com";
const KINDS: Record<string, string> = {
	spot: "スポット相談",
	pack: "導入パックの見積もり",
	advisor: "月額顧問",
	result: "無料業務診断の結果について",
	other: "そのほか",
};
const EMAIL_RE = /^[^\s@<>()"',;]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const clip = (v: unknown, n: number) => String(v ?? "").replace(/\r/g, "").trim().slice(0, n);
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ");

/** UTF-8 の文字列を base64 にする（76文字ごとに改行） */
function b64(s: string, wrap = true): string {
	const bytes = new TextEncoder().encode(s);
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	const out = btoa(bin);
	return wrap ? out.replace(/.{76}/g, "$&\r\n") : out;
}
const mimeWord = (s: string) => `=?UTF-8?B?${b64(s, false)}?=`;

export const POST: APIRoute = async ({ request, clientAddress }) => {
	const res = (code: number, obj: unknown) =>
		new Response(JSON.stringify(obj), { status: code, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
	const fail = (code: number, message: string) => res(code, { ok: false, message });

	const text = await request.text().catch(() => "");
	let b: Record<string, unknown> = {};
	try {
		b = text.length <= 20000 ? JSON.parse(text || "{}") : {};
	} catch {
		b = {};
	}
	// ボットは見えない欄を埋めたり、表示してすぐ送ったりする。受け付けたふりをして捨てる
	if (b.website || Number(b.elapsed ?? 0) < 3000) return res(200, { ok: true });

	const name = oneLine(clip(b.name, 100));
	const email = oneLine(clip(b.email, 254));
	const message = clip(b.message, 4000);
	if (!name || !message) return fail(400, "お名前とご相談の内容を入力してください。");
	if (!EMAIL_RE.test(email)) return fail(400, "メールアドレスの形を確かめてください。");
	if ((message.match(/https?:\/\//g) || []).length > 3) return fail(400, "URLが多いため送信できませんでした。URLを減らしてお試しください。");
	const company = oneLine(clip(b.company, 150));
	const tel = oneLine(clip(b.tel, 40));
	const kind = KINDS[String(b.kind)] ?? KINDS.other;

	const to = env.CONTACT_TO;
	if (!to || !env.SEND_EMAIL) return fail(503, "ただいまフォームを準備しています。お手数ですが、少し時間をおいてお試しください。");

	// 同じ IP からの連続送信を10分に3回までにする
	const ip = clientAddress || request.headers.get("cf-connecting-ip") || "unknown";
	const kv = env.SESSION;
	if (kv) {
		const key = `contact:${ip}`;
		const n = Number((await kv.get(key)) || 0);
		if (n >= 3) return fail(429, "送信が続いています。少し時間をおいてお試しください。");
		await kv.put(key, String(n + 1), { expirationTtl: 600 });
	}

	const now = new Date();
	const jst = new Date(now.getTime() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16);
	const body = [
		"テガワリのお問い合わせフォームから届きました。",
		"このメールに返信すると、お客さまのアドレスあてになります。",
		"",
		`受付日時：${jst}（日本時間）`,
		`ご相談の種類：${kind}`,
		`会社名：${company || "（なし）"}`,
		`お名前：${name}`,
		`メールアドレス：${email}`,
		`電話番号：${tel || "（なし）"}`,
		"",
		"ご相談の内容：",
		message,
	].join("\r\n");
	const subject = `【テガワリ】お問い合わせ（${kind}）${company || name} 様`;
	const raw = [
		`From: ${mimeWord("テガワリ お問い合わせフォーム")} <${FROM}>`,
		`To: <${to}>`,
		`Reply-To: ${mimeWord(name)} <${email}>`,
		`Subject: ${mimeWord(subject)}`,
		`Date: ${now.toUTCString().replace("GMT", "+0000")}`,
		`Message-ID: <${crypto.randomUUID()}@tegawari.com>`,
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: base64",
		"",
		b64(body),
	].join("\r\n");

	try {
		await env.SEND_EMAIL.send(new EmailMessage(FROM, to, raw));
	} catch (e) {
		console.error("contact send failed", e);
		return fail(502, "送信に失敗しました。お手数ですが、少し時間をおいてもう一度お試しください。");
	}
	return res(200, { ok: true });
};
