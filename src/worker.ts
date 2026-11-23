import handler, { createScheduledHandler, PluginBridge } from "@emdash-cms/cloudflare/worker";

const emdashScheduled = createScheduledHandler();

export { PluginBridge };

/** 管理画面（/_emdash）を開けるホスト。仮URL（workers.dev）などでは管理画面と初期設定を出さない */
const ADMIN_HOSTS = new Set(["tegawari.com", "localhost", "127.0.0.1"]);
/** tegawari.com へ308で送るホスト */
const MOVED = new Set(["www.tegawari.com"]);

export default {
	...handler,
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);
		if (MOVED.has(url.hostname)) return Response.redirect(`https://tegawari.com${url.pathname}${url.search}`, 308);
		if (url.pathname.startsWith("/_emdash") && !ADMIN_HOSTS.has(url.hostname)) {
			return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" } });
		}
		return handler.fetch!(request as any, env as any, ctx);
	},
	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
		// 毎分：EmDash の予約処理
		return (emdashScheduled as any)(controller, env, ctx);
	},
} satisfies ExportedHandler<Env>;
