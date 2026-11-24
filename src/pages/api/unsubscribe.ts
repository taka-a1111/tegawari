// @ts-nocheck
// 案内メールの停止（メールのリンク、またはメールソフトの「配信停止」ボタン）
// GET はページを表示して停止、POST（List-Unsubscribe-Post のワンクリック）は停止だけ行う
import type { APIRoute } from "astro";
import * as shindan from "../../server/shindan.js";

const page = (title: string, msg: string) =>
	new Response(
		`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}｜テガワリ</title>
<style>body{margin:0;background:#F2F5F9;color:#1B2430;font-family:"Noto Sans JP","游ゴシック","Yu Gothic","メイリオ",Meiryo,sans-serif;line-height:1.8}
main{max-width:560px;margin:56px auto;padding:32px 24px;background:#fff;border-radius:12px}h1{font-size:20px;margin:0 0 12px;color:#1F3A5F}p{font-size:15px;margin:0 0 10px}a{color:#2F80D8}</style></head>
<body><main><h1>${title}</h1><p>${msg}</p><p><a href="/">テガワリのトップへ</a></p></main></body></html>`,
		{ status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } },
	);

async function stop(url: URL) {
	const id = Number(url.searchParams.get("id"));
	const t = String(url.searchParams.get("t") || "");
	if (!id || !/^[0-9a-f]{48}$/.test(t)) return false;
	return shindan.unsubscribe(id, t);
}

export const GET: APIRoute = async ({ request }) => {
	const ok = await stop(new URL(request.url)).catch(() => false);
	return ok
		? page("お知らせを止めました", "テガワリからのお知らせメールを止めました。これからはお送りしません。お問い合わせへのお返事は、これまでどおりお送りします。")
		: page("止められませんでした", "リンクの形が正しくないか、受付が見つかりませんでした。お手数ですが、お問い合わせフォームから「お知らせの停止」とお知らせください。");
};

export const POST: APIRoute = async ({ request }) => {
	const ok = await stop(new URL(request.url)).catch(() => false);
	return new Response(ok ? "ok" : "ng", { status: ok ? 200 : 400, headers: { "cache-control": "no-store" } });
};
