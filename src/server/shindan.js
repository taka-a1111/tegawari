// テガワリ 無料業務診断の結果票：受付の保存 → 結果票（A4・2ページ、PDF）→ Resend でメール送付 → 運営者に知らせる
//
// 使う設定
//   DB（D1）……………… 受付の保存（表 shindan_requests。無ければ作る）
//   BROWSER ………………… PDF を作る（Cloudflare の Browser Rendering）
//   RESEND_API_KEY …… メール送信（secret。未設定なら送らずに運営者へ「手動で送る」と知らせる）
//   SHINDAN_MAIL_FROM … 差出人（既定：テガワリ <shindan@tegawari.com>）
//   SEND_EMAIL / CONTACT_TO … 運営者への知らせ（お問い合わせフォームと同じ）
import puppeteer from "@cloudflare/puppeteer";
import { env } from "cloudflare:workers";
import { EmailMessage } from "cloudflare:email";

export const SITE = "https://tegawari.com";

/** 業務の一覧（画面の site.js と同じ。キー・名前・AIとの相性・説明） */
export const TASKS = {
	inquiry: ["問い合わせへの一次返信", 3, "よくある質問への返信の下書きをAIが作り、人が確認して送ります。"],
	estimate: ["見積書・請求書の作成", 3, "案件の情報から下書きを作り、会計ソフトへの入力まで自動にしやすい業務です。"],
	minutes: ["議事録・報告書のまとめ", 3, "録音やメモから要点をまとめる作業は、AIが最も得意な分野の一つです。"],
	article: ["ブログ・SNSの下書き", 2, "下書きはAIに任せやすい一方、事実の確認の手順を先に決める必要があります。"],
	sales: ["営業リスト作り・提案書の下書き", 2, "公開情報の収集と下書きは任せやすく、送る判断は人が持ちます。"],
	data: ["表計算への転記・集計", 3, "決まった形の転記や集計は、GASなどで自動にしやすい業務です。"],
	recruit: ["求人票・応募者への連絡", 2, "定型の連絡文は任せやすく、選考の判断は人が行います。"],
	schedule: ["日程調整・リマインド", 2, "カレンダーとメールをつなぐと、手間を大きく減らせます。"],
	manual: ["社内マニュアル・手順書づくり", 2, "担当者の説明を文章に起こす作業は、AIで早く進められます。"],
};
/** 業種ごとの追加の業務（キー・名前・相性・説明）と、相性・説明の上書き。画面の site.js と同じ */
export const IND = {
	"士業": {
		extra: ["shorui", "申請書類・契約書の下書き", 3, "ひな形と案件の情報から下書きを作り、最後の確認と判断は先生が行います。"],
		fit: { inquiry: [2, "一般的な案内の返信は任せやすく、個別の判断を含む返信は人が書きます。"] },
	},
	"Web・制作会社": {
		extra: ["kousei", "原稿の校正・修正依頼のまとめ", 3, "誤字や表記ゆれの確認、お客さまからの修正依頼の整理は、AIで早く進められます。"],
		fit: { article: [3, "制作の知識がある分、下書きの確認が速く、任せやすい業務です。"] },
	},
	"建設・塗装": {
		extra: ["genba", "現場写真の整理・日報づくり", 2, "写真とメモから日報や報告書の下書きを作れます。写真の分け方の決まりを先に作ります。"],
		fit: {},
	},
	"EC・小売": {
		extra: ["shohin", "商品説明文・レビューへの返信", 3, "商品の情報から説明文の下書きを作り、表現の確認は人が行います。"],
		fit: {},
	},
	"治療院・クリニック": {
		extra: ["yoyaku", "予約の受付・問診票の整理", 2, "予約の確認や問診の転記は任せやすく、症状の判断は人が行います。"],
		fit: {
			inquiry: [2, "予約や料金の案内は任せやすく、症状についての返信は人が書きます。"],
			article: [1, "医療広告のルールがあるため、下書きでも確認の手間が大きい業務です。"],
		},
	},
};
/** 従業員数ごとの、始め方のひとこと */
export const SIZE_TIP = {
	"1〜4名": "少人数の会社は、代表の方ご自身が時間を使っている業務から選ぶと、早く効果が出ます。",
	"5〜20名": "担当者が決まっている業務から選ぶと、手順をそろえやすく、効果も測りやすくなります。",
	"21〜50名": "部署ごとに手順が違うことが多いため、1つの部署で試してから広げます。",
	"51名以上": "情報の扱いのルールを先に決め、1つの部署で試してから広げます。",
};
/** その業種で使う業務の一覧（{k:[名前, 相性, 説明]}） */
export function tasksFor(industry) {
	const ind = IND[industry];
	const out = {};
	for (const k of Object.keys(TASKS)) {
		const o = ind && ind.fit[k];
		out[k] = o ? [TASKS[k][0], o[0], o[1]] : TASKS[k];
	}
	if (ind) out[ind.extra[0]] = ind.extra.slice(1);
	return out;
}
export const INDUSTRIES = ["士業", "Web・制作会社", "建設・塗装", "EC・小売", "治療院・クリニック", "そのほか"];
export const SIZES = ["1〜4名", "5〜20名", "21〜50名", "51名以上"];
const TIME_LABEL = ["していない", "週1時間未満", "週1〜5時間", "週5時間以上"];
const STD_LABEL = { 1: "人によって違う", 2: "ほぼ決まっている" };

/** 回答から順位を出す（画面と同じ計算） */
export function rank(answers, industry) {
	const T = tasksFor(industry);
	const rows = [];
	for (const k of Object.keys(T)) {
		const a = answers[k];
		if (!a) continue;
		const time = Number(a.t), std = Number(a.s);
		rows.push({ k, name: T[k][0], fit: T[k][1], time, std, score: time * std * T[k][1], note: T[k][2] });
	}
	rows.sort((a, b) => b.score - a.score);
	return rows;
}
export const level = (score) => (score >= 12 ? "高" : score >= 6 ? "中" : score > 0 ? "低" : "－");

/** 入力の検査。正しければ answers（{k:{t,s}}）を返す */
export function parseAnswers(raw, industry) {
	if (!raw || typeof raw !== "object") return null;
	const out = {};
	for (const k of Object.keys(tasksFor(industry))) {
		const a = raw[k];
		if (!a) return null;
		const t = Number(a.t), s = Number(a.s);
		if (![0, 1, 2, 3].includes(t) || ![1, 2].includes(s)) return null;
		out[k] = { t, s };
	}
	return out;
}

// ---------- 保存（D1） ----------
const DDL = `CREATE TABLE IF NOT EXISTS shindan_requests (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	token TEXT NOT NULL,
	created_at TEXT NOT NULL,
	company TEXT, name TEXT NOT NULL, email TEXT NOT NULL,
	industry TEXT, size TEXT, answers TEXT NOT NULL,
	consent INTEGER NOT NULL DEFAULT 0, unsub INTEGER NOT NULL DEFAULT 0,
	status TEXT NOT NULL DEFAULT 'new', last_error TEXT, sent_at TEXT, ip TEXT
)`;
let ready = false;
async function db() {
	if (!ready) {
		await env.DB.prepare(DDL).run();
		ready = true;
	}
	return env.DB;
}

const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function createRequest(p) {
	const d = await db();
	const token = hex(24);
	const now = new Date().toISOString();
	const r = await d
		.prepare("INSERT INTO shindan_requests (token, created_at, company, name, email, industry, size, answers, consent, ip) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id")
		.bind(token, now, p.company || null, p.name, p.email, p.industry, p.size, JSON.stringify(p.answers), p.consent ? 1 : 0, p.ip || null)
		.first();
	return { id: r.id, token, created_at: now };
}

export async function getRequest(id, token) {
	const d = await db();
	return d.prepare("SELECT * FROM shindan_requests WHERE id = ? AND token = ?").bind(id, token).first();
}

async function setStatus(id, status, extra = {}) {
	const d = await db();
	await d
		.prepare("UPDATE shindan_requests SET status = ?, last_error = ?, sent_at = COALESCE(?, sent_at) WHERE id = ?")
		.bind(status, extra.error ?? null, extra.sentAt ?? null, id)
		.run();
}

export async function unsubscribe(id, token) {
	const d = await db();
	const r = await d.prepare("UPDATE shindan_requests SET unsub = 1 WHERE id = ? AND token = ?").bind(id, token).run();
	return (r.meta?.changes ?? 0) > 0;
}

/** 同じメールアドレスからの受付が直近24時間に何件あるか */
export async function recentCount(email) {
	const d = await db();
	const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
	const r = await d.prepare("SELECT COUNT(*) AS n FROM shindan_requests WHERE email = ? AND created_at > ?").bind(email, since).first();
	return Number(r?.n ?? 0);
}

// ---------- 結果票（HTML → PDF） ----------
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const jst = (iso) => new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
export const receiptNo = (id, iso) => {
	const t = jst(iso);
	return `TG-${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, "0")}${String(t.getUTCDate()).padStart(2, "0")}-${String(id).padStart(4, "0")}`;
};
const dateJa = (iso) => {
	const t = jst(iso);
	return `${t.getUTCFullYear()}年${t.getUTCMonth() + 1}月${t.getUTCDate()}日`;
};

export function buildReportHtml(row, logoSvg) {
	const answers = JSON.parse(row.answers);
	const rows = rank(answers, row.industry);
	const top = rows.filter((r) => r.score > 0).slice(0, 3);
	const no = receiptNo(row.id, row.created_at);
	const who = row.company ? `${esc(row.company)}　${esc(row.name)} 様` : `${esc(row.name)} 様`;
	const anyUnstd = top.some((r) => r.std === 1);

	const topHtml = top.length
		? top
				.map(
					(r, i) => `<div class="top"><div class="num">${i + 1}</div><div class="tb"><div class="tn">${esc(r.name)}<span class="lv lv-${level(r.score)}">任せやすさ ${level(r.score)}</span></div>
<p>${esc(r.note)}${r.std === 1 ? "手順が人によって違うため、先に手順をそろえてから始めます。" : ""}</p>
<div class="meta">かかっている時間：${TIME_LABEL[r.time]}　／　手順：${STD_LABEL[r.std]}</div></div></div>`,
				)
				.join("")
		: `<p class="none">今回の質問の中には、時間を使っている業務が見つかりませんでした。ほかの業務については、お問い合わせからご相談ください。</p>`;

	const tableRows = rows
		.map(
			(r, i) =>
				`<tr><td class="c">${r.score > 0 ? i + 1 : "－"}</td><td>${esc(r.name)}</td><td>${TIME_LABEL[r.time]}</td><td>${STD_LABEL[r.std]}</td><td class="c">${"●".repeat(r.fit)}${"○".repeat(3 - r.fit)}</td><td class="c"><b>${level(r.score)}</b></td></tr>`,
		)
		.join("");

	const first = top[0];
	const foot = (p) => `<div class="foot"><span>テガワリ（運営：インフォサクセス）　${SITE}/</span><span>${no}　${p} / 2</span></div>`;

	return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=block" rel="stylesheet">
<style>
@page{size:A4;margin:0}
:root{--navy:#1F3A5F;--ink:#1B2430;--mid:#4A5566;--light:#7A8494;--org:#E8792B;--blue:#2F80D8;--pale:#F2F5F9;--rule:#D8DEE6}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Noto Sans JP",sans-serif;color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact;font-size:12.5px;line-height:1.75}
.page{width:210mm;height:297mm;position:relative;padding:34px 50px 70px;page-break-after:always;overflow:hidden}
.page:last-child{page-break-after:auto}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid var(--navy);padding-bottom:14px}
.head svg{height:44px;width:auto}
.id{text-align:right;font-size:10.5px;color:var(--light);line-height:1.6}
h1{font-size:24px;font-weight:900;color:var(--navy);margin:22px 0 4px}
.who{font-size:14px;margin-bottom:4px}
.lead{color:var(--mid);margin-bottom:12px}
.prof{display:flex;gap:10px;margin-bottom:14px}
.prof div{background:var(--pale);padding:6px 12px;font-size:11.5px;border-radius:4px}
h2{font-size:16px;font-weight:900;color:var(--navy);margin:22px 0 10px;padding-left:10px;border-left:5px solid var(--org)}
.top{display:flex;gap:14px;border:1px solid var(--rule);border-radius:8px;padding:9px 14px;margin-bottom:8px}
.num{flex:none;width:34px;height:34px;border-radius:50%;background:var(--navy);color:#fff;font-weight:900;font-size:16px;display:grid;place-items:center}
.tn{font-weight:700;font-size:14.5px;color:var(--navy)}
.lv{display:inline-block;margin-left:10px;font-size:11px;padding:1px 8px;border-radius:10px;vertical-align:2px;color:#fff;background:var(--light)}
.lv-高{background:var(--org)}.lv-中{background:var(--blue)}
.tb p{margin:4px 0 2px}
.meta{font-size:11px;color:var(--light)}
.none{background:var(--pale);padding:14px}
table{width:100%;border-collapse:collapse;font-size:11.5px}
th,td{border-bottom:1px solid var(--rule);padding:3px 6px;text-align:left}
th{background:var(--navy);color:#fff;font-weight:700}
td.c,th.c{text-align:center}
.note{font-size:10.5px;color:var(--light);margin-top:6px}
ol.steps{list-style:none;counter-reset:s}
ol.steps li{counter-increment:s;position:relative;padding:10px 12px 10px 48px;border:1px solid var(--rule);border-radius:8px;margin-bottom:8px}
ol.steps li::before{content:counter(s);position:absolute;left:12px;top:10px;width:26px;height:26px;border-radius:50%;background:var(--org);color:#fff;font-weight:900;display:grid;place-items:center}
ol.steps b{color:var(--navy)}
ul.chk{list-style:none}
ul.chk li{padding-left:20px;position:relative;margin-bottom:4px}
ul.chk li::before{content:"✓";position:absolute;left:0;color:var(--org);font-weight:900}
.cta{background:var(--pale);border-radius:8px;padding:14px 16px;margin-top:8px}
.cta table td{border:none;padding:3px 6px}
.foot{position:absolute;left:50px;right:50px;bottom:26px;display:flex;justify-content:space-between;font-size:10px;color:var(--light);border-top:1px solid var(--rule);padding-top:8px}
</style></head><body>
<section class="page">
<div class="head">${logoSvg}<div class="id">受付番号 ${no}<br>${dateJa(row.created_at)}</div></div>
<h1>無料業務診断 結果票</h1>
<p class="who">${who}</p>
<p class="lead">ご回答いただいた、業務ごとの時間と手順をもとに、AIに任せやすい業務の候補を順に並べました。</p>
<div class="prof"><div>業種：${esc(row.industry)}</div><div>従業員数：${esc(row.size)}</div></div>
<h2>AIに任せやすい業務の候補</h2>
${topHtml}
<h2>${rows.length}つの業務の一覧</h2>
<table><thead><tr><th class="c">順位</th><th>業務</th><th>かかっている時間</th><th>手順</th><th class="c">AIとの相性</th><th class="c">任せやすさ</th></tr></thead><tbody>${tableRows}</tbody></table>
<p class="note">任せやすさは、かかっている時間・手順の決まり方・AIとの相性（●の数）を掛け合わせた目安です。実際の進め方は、業務の中身を伺ってから決めます。</p>
${foot(1)}
</section>
<section class="page">
<div class="head">${logoSvg}<div class="id">受付番号 ${no}<br>${dateJa(row.created_at)}</div></div>
<h2>始めるときの進め方</h2>
<ol class="steps">
<li><b>1本だけ選ぶ</b><br>${first ? `まずは1位の「${esc(first.name)}」のように、時間がかかっていて手順の決まった業務を1本だけ選びます。` : "時間がかかっていて、手順の決まった業務を1本だけ選びます。"}いきなり全部をAIにしないことが、続けるいちばんの近道です。${SIZE_TIP[row.size] ? esc(SIZE_TIP[row.size]) : ""}</li>
<li><b>今の時間を測る</b><br>始める前に、その業務に週何時間かかっているかを1〜2週間記録します。導入の後と比べて、続けるかどうかを決める材料になります。</li>
<li><b>下書きはAI、判断は人</b><br>AIが下書きや転記をして、人が確かめて送る形から始めます。${anyUnstd ? "手順が人によって違う業務は、先に手順を1枚の紙にそろえます。" : "送る・決めるといった判断は、これまでどおり人が持ちます。"}</li>
<li><b>入れてよい情報を決める</b><br>お客さまの個人情報や社外秘の資料を、どのツールに入れてよいかを先に決め、社内のルールにします。</li>
</ol>
<h2>AIに任せるときの注意</h2>
<ul class="chk">
<li>AIの出した文章や数字は、送る前に必ず人が確かめます。もっともらしい間違いが混ざることがあります。</li>
<li>ツールごとに、入力した内容が学習に使われるかどうかや、保存される場所が違います。法人向けの設定を確かめてから使います。</li>
<li>1つの業務で効果を確かめてから、次の業務に広げます。</li>
</ul>
<h2>テガワリにご相談いただく場合</h2>
<div class="cta">
<table>
<tr><td><b>スポット相談</b></td><td>30,000円（税別）・60分</td><td>この結果票をもとに、最初の1本の進め方を決めます。</td></tr>
<tr><td><b>導入パック</b></td><td>150,000〜300,000円（税別）</td><td>業務の棚卸しから、仕組みづくり・社内への定着まで行います。</td></tr>
<tr><td><b>月額顧問</b></td><td>月50,000円〜（税別）</td><td>継続して相談でき、広げる順番も一緒に決めます。</td></tr>
</table>
<p style="margin-top:8px">お問い合わせ：${SITE}/contact.html（ご相談の種類で「無料業務診断の結果について」をお選びください。受付番号 ${no}）</p>
</div>
<p class="note" style="margin-top:14px">この結果票は、ご回答をもとにした目安であり、業務の削減や成果を保証するものではありません。</p>
${foot(2)}
</section>
</body></html>`;
}

export async function htmlToPdf(html) {
	const browser = await puppeteer.launch(env.BROWSER);
	try {
		const page = await browser.newPage();
		await page.setViewport({ width: 794, height: 1123 });
		// networkidle0 はフォントの読み込みで止まることがあるため、load まで待ってからフォントを最大10秒待つ
		await page.setContent(html, { waitUntil: "load", timeout: 30000 });
		await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 10000))]));
		const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
		return new Uint8Array(pdf);
	} finally {
		await browser.close().catch(() => {});
	}
}

// ---------- メール ----------
function b64u8(u8) {
	let s = "";
	for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
	return btoa(s);
}
const b64s = (s, wrap = true) => {
	const out = b64u8(new TextEncoder().encode(s));
	return wrap ? out.replace(/.{76}/g, "$&\r\n") : out;
};
const mimeWord = (s) => `=?UTF-8?B?${b64s(s, false)}?=`;

async function resend({ to, subject, text, attachments, headers }) {
	const html =
		'<div style="font-family:\'Noto Sans JP\',\'游ゴシック\',\'Yu Gothic\',\'メイリオ\',Meiryo,sans-serif;font-size:14px;line-height:1.8;color:#1B2430">' +
		text
			.split("\n")
			.map((l) => (l ? l.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]).replace(/(https:\/\/[^\s]+)/g, '<a href="$1">$1</a>') : "&nbsp;"))
			.join("<br>") +
		"</div>";
	const r = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
		body: JSON.stringify({ from: env.SHINDAN_MAIL_FROM || "テガワリ <shindan@tegawari.com>", to: [to], subject, text, html, attachments, headers }),
		signal: AbortSignal.timeout(20000),
	});
	if (!r.ok) throw new Error(`resend ${r.status} ${(await r.text()).slice(0, 300)}`);
	return r.json();
}

/** 運営者への知らせ（お問い合わせフォームと同じ送り方） */
export async function notifyOwner(subject, lines) {
	const to = env.CONTACT_TO;
	if (!to || !env.SEND_EMAIL) return;
	const from = "form@tegawari.com";
	const raw = [
		`From: ${mimeWord("テガワリ 業務診断")} <${from}>`,
		`To: <${to}>`,
		`Subject: ${mimeWord(subject)}`,
		`Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
		`Message-ID: <${crypto.randomUUID()}@tegawari.com>`,
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: base64",
		"",
		b64s(lines.join("\r\n")),
	].join("\r\n");
	try {
		await env.SEND_EMAIL.send(new EmailMessage(from, to, raw));
	} catch (e) {
		console.error("notifyOwner", e);
	}
}

const SIGN = `――――――――――
テガワリ（中小企業のAIエージェント導入と顧問）
運営：インフォサクセス　高崎信吾
〒450-0002 愛知県名古屋市中村区名駅3-4-10 アルティメイト名駅1st 2階
${SITE}/
このメールは送信専用です。ご質問は、お問い合わせフォームからお送りください。
${SITE}/contact.html`;

/** 結果票を作って送る（受付1件分） */
export async function processRequest(id, token, logoSvg) {
	const row = await getRequest(id, token);
	if (!row) return;
	if (row.status === "sent") return;
	const no = receiptNo(row.id, row.created_at);
	const rows = rank(JSON.parse(row.answers), row.industry);
	const top = rows.filter((r) => r.score > 0).slice(0, 3);
	const summary = top.length ? top.map((r, i) => `${i + 1}位　${r.name}（任せやすさ ${level(r.score)}）`).join("\n") : "時間を使っている業務は見つかりませんでした。";
	const ownerLines = [
		"無料業務診断で、結果票の送付の申し込みがありました。",
		"",
		`受付番号：${no}`,
		`会社名：${row.company || "（なし）"}`,
		`お名前：${row.name}`,
		`メールアドレス：${row.email}`,
		`業種：${row.industry}／従業員数：${row.size}`,
		`案内メールの同意：${row.consent ? "あり" : "なし"}`,
		"",
		summary,
	];
	try {
		await setStatus(id, "working");
		const pdf = await htmlToPdf(buildReportHtml(row, logoSvg));
		if (!env.RESEND_API_KEY) {
			await setStatus(id, "ready_no_mail", { error: "RESEND_API_KEY 未設定" });
			await notifyOwner(`【テガワリ】結果票の送付（手動で送る）${row.company || row.name} 様`, [...ownerLines, "", "メール送信の設定がまだのため、結果票は送れていません。手動で送ってください。"]);
			return;
		}
		const unsubUrl = `${SITE}/api/unsubscribe?id=${row.id}&t=${row.token}`;
		const text = `${row.company ? row.company + "\n" : ""}${row.name} 様

テガワリの無料業務診断をご利用いただき、ありがとうございます。
結果票（A4・2ページ、PDF）をお送りします。

AIに任せやすい業務の候補
${summary}

結果票の2ページ目に、始めるときの進め方と注意点を載せています。
結果についてのご質問やご相談は、お問い合わせフォームからお送りください（ご相談の種類で「無料業務診断の結果について」をお選びください）。
${SITE}/contact.html

受付番号：${no}
${row.consent ? `\nAIの業務活用についてのお知らせを、月に1〜2回お送りします。不要の場合は、こちらから止められます。\n${unsubUrl}\n` : ""}
${SIGN}`;
		await resend({
			to: row.email,
			subject: "【テガワリ】無料業務診断の結果票をお送りします",
			text,
			attachments: [{ filename: `テガワリ_業務診断_結果票_${no}.pdf`, content: b64u8(pdf) }],
			headers: row.consent ? { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
		});
		await setStatus(id, "sent", { sentAt: new Date().toISOString() });
		await notifyOwner(`【テガワリ】業務診断の結果票を送付 ${row.company || row.name} 様`, [...ownerLines, "", "結果票は自動で送付済みです。"]);
	} catch (e) {
		console.error("shindan process", e);
		await setStatus(id, "error", { error: String(e?.message || e).slice(0, 500) });
		await notifyOwner(`【テガワリ】結果票の自動送付に失敗 ${row.company || row.name} 様`, [...ownerLines, "", `失敗の内容：${String(e?.message || e).slice(0, 300)}`, "手動で結果票を作って送ってください。"]);
	}
}
