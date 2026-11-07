/* 玩家榜線回報（/contrib）的回歸測試。D1 用 node:sqlite 模擬。用法：node worker/test/contrib.mjs   任何一項失敗就 exit 1。 */
import { DatabaseSync } from 'node:sqlite';
import { handleContrib, contribReport, cleanContrib, playerHash, _resetContribSchema, _resetContribRate } from '../src/contrib.js';

let fail = 0;
const ok = (cond, name, extra) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).slice(0, 300))); if (!cond) fail++; };

/* ---------- 假 D1 ---------- */
const sq = new DatabaseSync(':memory:');
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
const SITE = 'https://project-sekai-center.com', W = 'https://games.test';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
const post = (body, { origin = SITE, ua = UA, ip = '1.2.3.4', raw } = {}) => {
  const h = { 'User-Agent': ua, 'CF-Connecting-IP': ip, 'Content-Type': 'text/plain' };
  if (origin) h.Origin = origin;
  const req = new Request(W + '/contrib', { method: 'POST', headers: h, body: raw !== undefined ? raw : JSON.stringify(body) });
  return handleContrib(req, env, new URL(req.url));
};
const get = q => { const req = new Request(W + '/contrib?' + q, { headers: { Origin: SITE } }); return handleContrib(req, env, new URL(req.url)); };
const count = (where = '1=1') => sq.prepare('SELECT COUNT(*) AS n FROM contrib_pts WHERE ' + where).get().n;

/* 1. 欄位清洗 */
ok(cleanContrib({ ev: 183, rank: 1500, score: 12345678, pid: '123456789' }) && cleanContrib({ ev: 183, rank: 1500, score: 12345678, pid: '123456789' }).srv === 'tw', 'cleanContrib：合法資料、預設台服');
ok(cleanContrib({ ev: 183, rank: 1500, score: 1, pid: '123456789', srv: 'jp' }).srv === 'jp', 'cleanContrib：srv jp');
ok(!cleanContrib({ ev: 0, rank: 1, score: 1, pid: '123456789' }) && !cleanContrib({ ev: 183, rank: 0, score: 1, pid: '123456789' }) && !cleanContrib({ ev: 183, rank: 1, score: -1, pid: '123456789' }) && !cleanContrib({ ev: 183, rank: 1, score: 1, pid: 'abc' }) && !cleanContrib({ ev: 1.5, rank: 1, score: 1, pid: '12345' }), 'cleanContrib：期數 0、名次 0、負分、非數字 ID、非整數都丟掉');
ok((await playerHash('s', 'tw', '1')).length === 12 && (await playerHash('s', 'tw', '1')) !== (await playerHash('s', 'jp', '1')) && (await playerHash('s', 'tw', '1')) !== (await playerHash('s2', 'tw', '1')), 'playerHash：12 碼、伺服器與密鑰都影響');

/* 2. 收一筆 */
let r = await post({ ev: 183, rank: 1500, score: 12345678, pid: '123456789' });
ok(r.status === 204, 'POST /contrib 回 204');
ok(count() === 1, '寫入一列');
let row = sq.prepare('SELECT * FROM contrib_pts').get();
ok(row.srv === 'tw' && row.ev === 183 && row.rank === 1500 && row.score === 12345678 && row.uh.length === 12 && row.t > 1.6e9, '欄位：不存 ID，只存雜湊', row);
ok(r.headers.get('access-control-allow-origin') === SITE && r.headers.get('cache-control') === 'no-store', 'POST 帶 CORS 與 no-store');

/* 3. 同一人 20 分鐘內再送：不收；不同人收 */
r = await post({ ev: 183, rank: 1490, score: 12400000, pid: '123456789' });
ok(r.status === 204 && count() === 1, '同一人 20 分鐘內第二筆不收');
await post({ ev: 183, rank: 300, score: 30000000, pid: '555555555' });
await post({ ev: 183, rank: 7000, score: 5000000, pid: '777777777', srv: 'jp' });
await post({ ev: 183, rank: 7000, score: 5000000, pid: '777777777' });
ok(count() === 4 && count("srv='jp'") === 1, '不同人、不同伺服器各自一筆', count());
// 把第一人的時間撥回 2 小時前，再送就收（也讓它掉出「最近一小時」）
sq.prepare("UPDATE contrib_pts SET t = t - 7200 WHERE rank = 1500").run();
await post({ ev: 183, rank: 1480, score: 12600000, pid: '123456789' });
ok(count() === 5, '超過 20 分鐘後再送會收');

/* 4. 拒絕：沒有 Origin、別站、爬蟲、壞 JSON、太大、欄位不合法、非 POST/GET */
r = await post({ ev: 183, rank: 1, score: 1, pid: '123456789' }, { origin: '' });
ok(r.status === 403, '沒有 Origin → 403');
r = await post({ ev: 183, rank: 1, score: 1, pid: '123456789' }, { origin: 'https://evil.example' });
ok(r.status === 403, '別站 Origin → 403');
let before = count();
r = await post({ ev: 183, rank: 1, score: 1, pid: '999999999' }, { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1)' });
ok(r.status === 204 && count() === before, '爬蟲 UA：回 204 但不寫');
r = await post(null, { raw: '{not json' });
ok(r.status === 400, '壞 JSON → 400');
r = await post(null, { raw: 'x'.repeat(2000) });
ok(r.status === 413, '超過 1 KB → 413');
r = await post({ ev: 183, rank: 'abc', score: 1, pid: '123456789' });
ok(r.status === 400 && count() === before, '欄位不合法 → 400 不寫');
const del = new Request(W + '/contrib', { method: 'DELETE', headers: { Origin: SITE } });
ok((await handleContrib(del, env, new URL(del.url))).status === 405, 'DELETE → 405');
const pre = new Request(W + '/contrib', { method: 'OPTIONS', headers: { Origin: SITE, 'Access-Control-Request-Method': 'POST' } });
const pr = await handleContrib(pre, env, new URL(pre.url));
ok(pr.status === 204 && /POST/.test(pr.headers.get('access-control-allow-methods') || '') && /GET/.test(pr.headers.get('access-control-allow-methods') || ''), 'OPTIONS preflight 允許 GET 與 POST');

/* 5. 每分鐘 20 次 */
_resetContribRate();
let codes = [];
for (let i = 0; i < 22; i++) codes.push((await post({ ev: 184, rank: 100 + i, score: 1, pid: String(100000000 + i) }, { ip: '8.8.8.8' })).status);
ok(codes.filter(c => c === 429).length === 2 && codes[0] === 204, '第 21 次起 429', codes);

/* 6. GET 彙總：每個人最新一筆、依名次排序、人數筆數、最近一小時 */
r = await get('ev=183&srv=tw');
ok(r.status === 200 && r.headers.get('cache-control') === 'public, max-age=60' && r.headers.get('access-control-allow-origin') === SITE, 'GET 回 200、快取 60 秒、CORS');
let d = await r.json();
ok(d.ev === 183 && d.srv === 'tw' && d.n === 4 && d.players === 3 && d.hour === 3, 'GET：台服 4 筆 3 人，最近一小時 3 筆（撥回去的那筆不算）', d);
ok(JSON.stringify(d.latest.map(x => x.slice(0, 2))) === JSON.stringify([[300, 30000000], [1480, 12600000], [7000, 5000000]]), 'latest：每人最新一筆、名次由小到大', d.latest);
ok(d.latest.every(x => x.length === 3 && x[2] > 1.6e9), 'latest 每筆帶時間');
d = await (await get('ev=183&srv=jp')).json();
ok(d.n === 1 && d.players === 1 && d.latest[0][0] === 7000, 'GET 日服只看日服');
d = await (await get('ev=999')).json();
ok(d.n === 0 && d.players === 0 && d.latest.length === 0, '沒資料的期數回空');
ok((await get('ev=abc')).status === 400, 'ev 不合法 → 400');

/* 7. 沒有 DB 時：503，不拋 */
const noDb = new Request(W + '/contrib?ev=1', { headers: { Origin: SITE } });
ok((await handleContrib(noDb, { SITE_BASE: SITE }, new URL(noDb.url))).status === 503, '沒有 DB → 503');

/* 8. contribReport 直接呼叫；重建 schema 不炸 */
_resetContribSchema();
d = await contribReport(DB, 'tw', 183);
ok(d.players === 3, 'contribReport 直接呼叫；再 ensure 一次表也不會重建炸掉');

console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
process.exit(fail ? 1 : 0);
