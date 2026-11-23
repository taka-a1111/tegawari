import type { APIRoute } from "astro";
import { BASE, allPosts, isLive, todayJST } from "../lib/tegawari";

/** AI検索・AIアシスタント向けの案内（llms.txt）。サービスの要点と、公開中の記事の一覧を Markdown で返す */
export const GET: APIRoute = async () => {
	const today = todayJST();
	const posts = (await allPosts())
		.filter((p) => isLive(p, today))
		.sort((a, b) => (a.date === b.date ? (a.num < b.num ? 1 : -1) : a.date < b.date ? 1 : -1));
	const body = `# テガワリ

> テガワリは、従業員5〜50名でIT専任の担当者がいない中小企業向けの、AIエージェント導入支援・AI顧問サービスです。運営者は自分の受託業務（Web制作・記事制作・SEO）をAIエージェントとGAS・APIの自動化で回しており、自分の業務で効果を確かめた方法だけを提案します。運営はインフォサクセス（SEO 15年以上、Web制作 12年以上、SEO検定1級）です。

- 入口は無料の業務診断です。質問に答えるだけで、AIに任せやすい業務の順位がその場で出ます（回答はブラウザの中だけで計算し、送信しません）
- 進め方：無料業務診断 → 業務の棚卸し → 1〜2本を構築 → 社内への定着
- 料金と条件は料金ページに記載しています
- 成果は保証しません。導入の前後で作業時間を測って比べます

## サービス

- [トップページ](${BASE}/): サービスの概要と、AIに任せやすい業務の例
- [サービス](${BASE}/service.html): できること・やらないこと、進め方、向いている会社
- [料金](${BASE}/price.html): 無料業務診断、スポット相談、導入パック、月額顧問
- [無料業務診断](${BASE}/shindan.html): 質問に答えて、AIに任せやすい業務の順位を出す
- [運営者情報](${BASE}/about.html): 運営者の経歴と所在地
- [お問い合わせ](${BASE}/contact.html): ご相談とお見積もりのご依頼

## ブログ記事

${posts.map((p) => `- [${p.title}](${BASE}/blog/${p.slug}.html): ${p.description}（${p.cat}、${p.modified || p.date}）`).join("\n")}

## そのほか

- [ブログ一覧](${BASE}/blog/index.html)
- [RSS](${BASE}/feed.xml)
- [サイトマップ](${BASE}/sitemap.xml)
`;
	return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=600" } });
};
