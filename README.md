# テガワリ（tegawari.com）

中小企業向けのAIエージェント導入支援・AI顧問サービスのサイト。Cloudflare の EmDash（Astro＋Workers・D1・R2・KV）で動かしています。

- 固定ページ：`src/site/pages/*.html` をそのまま返し、記事カードの欄 `{{CARDS}}` だけ D1 の記事から作る
- 記事ページ：`src/site/article.html` を `src/lib/tegawari.ts` の `renderArticle` で置き換えて作る（URL は `/blog/<slug>.html`）
- お問い合わせ：`src/pages/api/contact.ts`（Cloudflare の send_email で転送。宛先は secret の `CONTACT_TO`）

## ビルドと反映

```
npm install --ignore-scripts
npx astro build
npx wrangler deploy
```
