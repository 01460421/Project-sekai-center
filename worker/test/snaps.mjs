/* GameTracker 的榜線快照（每 5 分鐘一筆）與 /snaps 端點的回歸測試。
   Durable Object 的 SQL 用 node:sqlite 模擬，HiSekai／Haruki 用假 fetch。
   用法：node worker/test/snaps.mjs   任何一項失敗就 exit 1。 */
import { DatabaseSync } from 'node:sqlite';
import { GameTracker } from '../src/index.js';

let fail = 0;
const ok = (cond, name) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) fail++; };

/* ---- 假 Durable Object storage ---- */
const db = new DatabaseSync(':memory:');
const sql = {
  exec(q, ...args) {
    if (!args.length && /;\s*\S/.test(q.trim().replace(/;\s*$/, ''))) { db.exec(q); return []; }   // 建表那種多句
    const st = db.prepare(q);
    if (/^\s*(SELECT|WITH)\b/i.test(q)) return st.all(...args);
    st.run(...args);
    return [];
  },
};
const storage = { sql, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} };
const tr = new GameTracker({ storage }, {});

/* ---- 假上游 ---- */
let borderUp = true, calls = 0;
const BORDER = {
  name: '測試活動', start_at: '2026-10-20T06:00:00Z', aggregate_at: '2026-10-28T12:00:00Z',
  player_border_rankings: [{ rank: 100, score: 9000000 }, { rank: 1000, score: 3000000 }, { rank: 500, score: null }],
  world_link_border_rankings: [{ chapter: 1, character: 21, start_at: 'a', aggregate_at: 'b', player_border_rankings: [{ rank: 100, score: 500000 }] }],
};
globalThis.fetch = async (u) => {
  calls++;
  if (borderUp && String(u).includes('/event/live/border')) return new Response(JSON.stringify(BORDER), { status: 200 });
  return new Response('down', { status: 503 });
};
const top = n => ({ player_top_100_rankings: Array.from({ length: n }, (_, i) => ({ rank: i + 1, score: 20000000 - i * 1000, userId: 'u' + (i + 1) })) });
const ev = { id: 200, name: '測試活動' };
const T0 = Date.UTC(2026, 9, 25, 0, 0, 0);
const get = async (path) => (await tr.fetch(new Request('https://do' + path))).json();

/* 1. 第一筆：段位、前百（照名次排序、帶 ID）、WL 章節 */
await tr.snapshot(ev, top(100), T0);
let d = await get('/snaps?ev=200');
ok(d.snaps.length === 1, '第一筆寫入');
ok(JSON.stringify(d.snaps[0][1]) === JSON.stringify([[100, 9000000], [1000, 3000000], [500, null]]), '段位 [名次, 分數]，沒分數的留 null');
ok(d.snaps[0][2].length === 100 && d.snaps[0][2][0][0] === 20000000 && d.snaps[0][2][0][1] === 'u1', '前百帶分數與玩家 ID');
ok(d.snaps[0][3].length === 1 && d.snaps[0][3][0][0] === 1 && d.snaps[0][3][0][4][0][1] === 500000, 'WL 章節的段位');
ok(d.meta && d.meta.name === '測試活動' && d.meta.aggregateAt === '2026-10-28T12:00:00Z', 'snapMeta 記活動名稱與結算時間');

/* 2. 5 分鐘內再呼叫：不抓也不寫 */
const before = calls;
await tr.snapshot(ev, top(100), T0 + 60_000);
d = await get('/snaps?ev=200');
ok(d.snaps.length === 1 && calls === before, '5 分鐘內不重複取樣');

/* 3. 段位端點與 Haruki 都掛掉：用前百第 100 名當 T100 */
borderUp = false;
await tr.snapshot(ev, top(100), T0 + 5 * 60_000);
d = await get('/snaps?ev=200');
ok(d.snaps.length === 2 && JSON.stringify(d.snaps[1][1]) === JSON.stringify([[100, 20000000 - 99 * 1000]]), '段位抓不到時用第 100 名當 T100');
ok(d.snaps[1][3].length === 0, '沒有 WL 資料時是空陣列');

/* 4. lite=1 不帶玩家 ID；since 只回之後的 */
d = await get('/snaps?ev=200&lite=1');
ok(typeof d.snaps[0][2][0] === 'number', 'lite=1 的前百只有分數');
d = await get('/snaps?ev=200&since=' + Math.floor(T0 / 1000));
ok(d.snaps.length === 1 && d.snaps[0][0] === Math.floor(T0 / 1000) + 300, 'since 之後的才回');

/* 5. 前百也沒有：什麼都不寫 */
await tr.snapshot(ev, { player_top_100_rankings: [] }, T0 + 10 * 60_000);
d = await get('/snaps?ev=200');
ok(d.snaps.length === 2, '段位與前百都沒有就不寫');

/* 6. 超過 45 天的舊快照會被清掉；別期的不會混進來 */
borderUp = true;
await tr.snapshot({ id: 201, name: '下一期' }, top(10), T0 + 46 * 86400_000);
ok((await get('/snaps?ev=200')).snaps.length === 0, '45 天前的快照被清掉');
d = await get('/snaps?ev=201');
ok(d.snaps.length === 1 && d.snaps[0][2].length === 10, '各期分開存');

/* 7. CORS 與快取標頭（網站跨網域讀） */
const r = await tr.fetch(new Request('https://do/snaps?ev=201&lite=1'));
ok(r.headers.get('access-control-allow-origin') != null && /max-age=60/.test(r.headers.get('cache-control') || ''), 'CORS 與 60 秒快取');

console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
process.exit(fail ? 1 : 0);
