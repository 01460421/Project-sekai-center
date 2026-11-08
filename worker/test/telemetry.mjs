/* 匿名使用統計（/t、/admin/tele）與資料管線檢查（pipeline.js）的回歸測試。
   D1 用 node:sqlite 模擬、GitHub API 用假 fetch。用法：node worker/test/telemetry.mjs   任何一項失敗就 exit 1。 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { handleTelemetry, teleReport, teleMaintain, ensureTeleSchema, _resetTeleSchema, _resetRate, dayKey, stateGet, stateSet } from '../src/telemetry.js';
import { summarize, diffAlerts, checkPipeline, pipelineStatus } from '../src/pipeline.js';

let fail = 0;
const ok = (cond, name, extra) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).slice(0, 300))); if (!cond) fail++; };

/* ---------- 假 D1 ---------- */
const HERE = dirname(fileURLToPath(import.meta.url));
const SQL_DIR = join(HERE, '..', 'sql');
const sq = new DatabaseSync(':memory:');
sq.exec(readFileSync(join(SQL_DIR, 'schema.sql'), 'utf8'));
const stmts = f => readFileSync(join(SQL_DIR, f), 'utf8').replace(/--[^\n]*/g, '').split(/;\s*(?:\n|$)/).map(x => x.trim()).filter(Boolean);
for (const f of readdirSync(SQL_DIR).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort()) {
  for (const st of stmts(f)) { try { sq.exec(st); } catch (e) { if (!/duplicate column|already exists/.test(e.message)) throw e; } }
}
const norm = a => a.map(v => (v === undefined ? null : v));
const mkStmt = (sql, args = []) => ({
  bind: (...a) => mkStmt(sql, a),
  first: async () => sq.prepare(sql).get(...norm(args)) ?? null,
  all: async () => ({ results: sq.prepare(sql).all(...norm(args)) }),
  run: async () => { const r = sq.prepare(sql).run(...norm(args)); return { meta: { changes: Number(r.changes) } }; },
  _exec: () => sq.prepare(sql).run(...norm(args)),
});
const DB = { prepare: sql => mkStmt(sql), batch: async sts => { sq.exec('BEGIN'); try { const r = sts.map(s => s._exec()); sq.exec('COMMIT'); return r; } catch (e) { sq.exec('ROLLBACK'); throw e; } } };
const env = { DB, SESSION_SECRET: 't-secret', SITE_BASE: 'https://project-sekai-center.com' };
const SITE = 'https://project-sekai-center.com';
const W = 'https://games.test';

const post = (body, { origin = SITE, ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', ip = '1.2.3.4', raw } = {}) => {
  const h = { 'User-Agent': ua, 'CF-Connecting-IP': ip, 'Content-Type': 'text/plain' };
  if (origin) h.Origin = origin;
  const req = new Request(W + '/t', { method: 'POST', headers: h, body: raw !== undefined ? raw : JSON.stringify(body) });
  return handleTelemetry(req, env, new URL(req.url));
};
const count = (where = '1=1') => sq.prepare('SELECT COUNT(*) AS n FROM tele_raw WHERE ' + where).get().n;

/* 1. 基本：建表、收下 pv，欄位白名單 */
let r = await post({ v: 1, e: [{ k: 'pv', p: 'songs', d: 'm', r: 'https://discord.com/channels/1/2', l: 'zh-TW', s: 'tw', v: 'abc123', junk: 'x' }] });
ok(r.status === 204, 'POST /t 回 204');
ok(count() === 1, '寫入一列');
let row = sq.prepare('SELECT * FROM tele_raw').get();
ok(row.k === 'pv' && row.page === 'songs' && row.dev === 'm' && row.ref === 'discord.com' && row.lang === 'zh-TW' && row.srv === 'tw' && row.ver === 'abc123', '欄位正規化：來源只留主機名', row);
ok(row.day === dayKey() && row.vh.length === 12, '台北日期與 12 碼訪客雜湊', row);
ok(r.headers.get('access-control-allow-origin') === SITE, '帶本站的 CORS 標頭');

/* 2. 同一天同一人雜湊相同；不同 IP 不同 */
await post({ e: [{ k: 'pv', p: 'home' }] });
await post({ e: [{ k: 'pv', p: 'home' }] }, { ip: '9.9.9.9' });
const vhs = sq.prepare('SELECT DISTINCT vh FROM tele_raw').all().map(x => x.vh);
ok(vhs.length === 2, '同 IP+UA 同雜湊、不同 IP 不同雜湊', vhs);

/* 3. 拒絕：沒有 Origin、別站 Origin、爬蟲 UA、非 POST、壞 JSON、太大、未知欄位值 */
r = await post({ e: [{ k: 'pv', p: 'home' }] }, { origin: '' });
ok(r.status === 403, '沒有 Origin → 403');
r = await post({ e: [{ k: 'pv', p: 'home' }] }, { origin: 'https://evil.example' });
ok(r.status === 403, '別站 Origin → 403');
let before = count();
r = await post({ e: [{ k: 'pv', p: 'home' }] }, { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1)' });
ok(r.status === 204 && count() === before, '爬蟲 UA：回 204 但不寫');
r = await post({ e: [{ k: 'pv', p: 'home' }] }, { ua: 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/130' });
ok(count() === before, 'HeadlessChrome 不寫');
r = await post(null, { raw: '{not json' });
ok(r.status === 400, '壞 JSON → 400');
r = await post(null, { raw: 'x'.repeat(9000) });
ok(r.status === 413, '超過 8 KB → 413');
r = await post({ e: [{ k: 'zzz', p: 'home' }, { k: 'pv', p: 'Bad Page!' }, { k: 'err' }] });
ok(count() === before + 1 && sq.prepare('SELECT page FROM tele_raw ORDER BY rowid DESC LIMIT 1').get().page === '', '未知種類與空錯誤丟掉；壞頁面 id 清空', count());
const getReq = new Request(W + '/t', { headers: { Origin: SITE } });
ok((await handleTelemetry(getReq, env, new URL(getReq.url))).status === 405, 'GET → 405');
const pre = new Request(W + '/t', { method: 'OPTIONS', headers: { Origin: SITE, 'Access-Control-Request-Method': 'POST' } });
const pr = await handleTelemetry(pre, env, new URL(pre.url));
ok(pr.status === 204 && /POST/.test(pr.headers.get('access-control-allow-methods') || ''), 'OPTIONS preflight');

/* 4. 一次最多 20 筆；每分鐘 30 次 */
before = count();
await post({ e: Array.from({ length: 40 }, (_, i) => ({ k: 'pv', p: 'p' + i })) }, { ip: '5.5.5.5' });
ok(count() === before + 20, '一次最多寫 20 筆', count() - before);
let last;
for (let i = 0; i < 31; i++) last = await post({ e: [{ k: 'pv', p: 'home' }] }, { ip: '7.7.7.7' });
ok(last.status === 429, '同 IP 一分鐘第 31 次 → 429');
_resetRate();

/* 5. 錯誤：訊息截 200 字、控制字元清掉 */
await post({ e: [{ k: 'err', m: 'TypeError: x is not a function\n    at foo (app.min.js:1:2)' + 'y'.repeat(300), p: 'rank', v: 'v1' }, { k: 'dat', m: 'api:/event/live/border HTTP 500', p: 'rank' }] });
row = sq.prepare("SELECT * FROM tele_raw WHERE k='err' ORDER BY rowid DESC LIMIT 1").get();
ok(row.msg.length === 200 && !/\n/.test(row.msg), '錯誤訊息截 200 字、沒有換行', row.msg.length);
ok(sq.prepare("SELECT COUNT(*) AS n FROM tele_raw WHERE k='dat'").get().n === 1, '資料載入失敗另算一類');

/* 6. 彙總 */
const rep = await teleReport(DB, 30);
ok(rep.days === 30 && rep.daily.length === 1 && rep.daily[0].day === dayKey(), '每日列', rep.daily);
ok(rep.today.views === rep.totals.views && rep.totals.views === count("k='pv'"), '今日 = 全部（只有今天的資料）', rep.today);
ok(rep.totals.uniq === sq.prepare("SELECT COUNT(DISTINCT vh) AS n FROM tele_raw WHERE k='pv'").get().n, '不重複訪客數');
ok(rep.pages[0] && rep.pages[0].v === 'home' && rep.pages[0].n === count("k='pv' AND page='home'"), '頁面排行第一是 home', rep.pages[0]);
ok(rep.refs.some(x => x.v === 'discord.com'), '來源有 discord.com', rep.refs);
ok(rep.errors.length === 2 && rep.errors.every(e => e.n === 1 && e.last > 0), '錯誤彙總兩筆', rep.errors);
ok(rep.devices.find(x => x.v === 'm') && !rep.devices.find(x => x.v === ''), '空的維度值不列', rep.devices);

/* 7. 清理：90 天前的刪掉 */
sq.prepare("INSERT INTO tele_raw (t, day, k, page) VALUES (?, '2026-01-01', 'pv', 'old')").run(Math.floor(Date.now() / 1000) - 100 * 86400);
await teleMaintain(DB);
ok(count("page='old'") === 0, '90 天前的原始列被刪');

/* 8. ops_state */
await stateSet(DB, 'k1', 'v1'); await stateSet(DB, 'k1', 'v2');
ok((await stateGet(DB, 'k1')).val === 'v2' && (await stateGet(DB, 'nope')) === null, 'ops_state upsert 與讀取');

/* ---------- 資料管線 ---------- */
// 用真實時間建假資料：下面 checkPipeline() 內部用的是 Date.now()，時間凍在某一天的話隔天跑就會多一則「太久沒成功」（2026-11-08 紅過一次）
const NOW = Date.now();
const run = (file, name, ago, status, conclusion, id) => ({ id: id || Math.floor(Math.random() * 1e9), name, path: '.github/workflows/' + file, status, conclusion, event: 'schedule',
  updated_at: new Date(NOW - ago * 3600e3).toISOString(), created_at: new Date(NOW - ago * 3600e3 - 60000).toISOString(), html_url: 'https://github.com/x/y/actions/runs/' + (id || 1), display_title: name });
const runs = [
  run('billing-refresh.yml', '儲值商品資料更新', 10, 'completed', 'success', 1),
  run('ep-songs-refresh.yml', 'EP 曲庫更新', 50, 'completed', 'success', 2),      // 50 小時沒成功 → stale
  run('ep-songs-refresh.yml', 'EP 曲庫更新', 26, 'completed', 'failure', 3),       // 最新一次失敗 → fail
  run('border-snapshot.yml', '榜線快照', 0.5, 'completed', 'success', 4),
  run('border-snapshot.yml', '榜線快照', 0.1, 'in_progress', null, 5),
  run('ci.yml', 'ci', 2, 'completed', 'failure', 6),
  run('og-refresh.yml', 'og-refresh', 3, 'completed', 'success', 7),
];
const items = summarize(runs, NOW);
const by = Object.fromEntries(items.map(i => [i.file, i]));
ok(by['billing-refresh.yml'].state === 'ok' && by['billing-refresh.yml'].scheduled, '每日工作 10 小時前成功 → ok');
ok(by['ep-songs-refresh.yml'].state === 'fail' && by['ep-songs-refresh.yml'].lastRunId === 3, '最新一次失敗 → fail（優先於 stale）', by['ep-songs-refresh.yml']);
ok(by['border-snapshot.yml'].state === 'ok' && by['border-snapshot.yml'].running, '進行中的不算失敗，標 running');
ok(by['bot-deploy.yml'] && by['bot-deploy.yml'].state === 'stale' && by['bot-deploy.yml'].lastOkAt === null, '完全沒紀錄的排程工作 → stale');
ok(by['canary.yml'] && by['canary.yml'].state === 'stale', '探針沒跑過 → stale');
ok(by['ci.yml'].state === 'fail' && !by['ci.yml'].scheduled, '非排程工作只看失敗');
ok(items[0].scheduled && items.findIndex(i => !i.scheduled) > items.filter(i => i.scheduled).length - 1, '排程的排前面');

const alerts = diffAlerts(items, {}, NOW, '2026-11-07');
const keys = alerts.map(a => a.key);
ok(keys.includes('fail:ep-songs-refresh.yml:3') && keys.includes('stale:bot-deploy.yml:2026-11-07') && keys.includes('fail:ci.yml:6'), '失敗與太久沒成功各一則', keys);
ok(!keys.some(k => k.startsWith('ok:')), '之前沒壞的不會發「恢復」');
const alerts2 = diffAlerts(items, { 'billing-refresh.yml': 'fail' }, NOW, '2026-11-07');
ok(alerts2.some(a => a.key === 'ok:billing-refresh.yml:1'), '上次壞、這次好 → 恢復通知');

/* checkPipeline：假 GitHub、兩位管理員、同一個失敗只通知一次 */
sq.exec(`INSERT INTO users (id,google_sub,email,name,picture,is_admin,status,created_at,updated_at) VALUES
  ('adm1','g1','a@x','A','',1,'approved',1,1), ('adm2','g2','b@x','B','',1,'approved',1,1), ('usr','g3','c@x','C','',0,'approved',1,1)`);
let ghStatus = 200;
globalThis.fetch = async (u) => {
  if (String(u).startsWith('https://api.github.com/')) return new Response(JSON.stringify({ workflow_runs: runs }), { status: ghStatus, headers: { 'content-type': 'application/json' } });
  return new Response('nope', { status: 500 });
};
_resetTeleSchema();
let res = await checkPipeline(env);
const nEv = () => sq.prepare("SELECT COUNT(*) AS n FROM events WHERE watch_id='pipeline'").get().n;
ok(res.ok && res.alerts.length === 4 && res.sent === 8 && nEv() === 8, '四則通知 × 兩位管理員 = 8 筆事件', { alerts: res.alerts.length, sent: res.sent, n: nEv() });
ok(!sq.prepare("SELECT 1 FROM events WHERE user_id='usr'").get(), '一般使用者不會收到');
res = await checkPipeline(env);
ok(res.sent === 0 && nEv() === 8, '再查一次：同樣的失敗不重發');
const st = await pipelineStatus(env);
ok(st.checkedAt > 0 && st.items.length === items.length && !st.error, '/ops/status 的資料：有檢查時間與每個工作');
ghStatus = 403;
res = await checkPipeline(env);
ok(!res.ok && (await pipelineStatus(env)).error.includes('403') && (await pipelineStatus(env)).items.length === items.length, 'GitHub 拿不到：記錯誤、沿用上次結果');

console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
process.exit(fail ? 1 : 0);
