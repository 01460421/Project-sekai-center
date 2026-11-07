/* 玩家榜線回報（/contrib）：綁定 Player ID 的玩家在站上看榜時，把自己的名次與分數匿名送上來。
   為什麼：官方只給 T100～T50000 那十幾條榜線，中間每一個名次（第 1,500 名在哪、第 7,000 名在哪）
   只有站在那個位置的玩家自己知道。幾十個人各送一筆，就補出前百以外的整條曲線——這是別站沒有、
   也只有「玩家餵資料」才做得到的東西。
   隱私：只存 期數、伺服器、名次、分數、時間；玩家以「站方密鑰 + 伺服器 + Player ID」的雜湊 12 碼辨識
   （用來每人每 20 分鐘只留一筆、算回報人數），不存 ID、不存 IP、不用 cookie；設定頁可關。
   GET /contrib?ev=183&srv=tw 公開：每個人最新的一筆（名次、分數、時間）＋人數與筆數，邊緣快取 60 秒。
   表結構由 Worker 自己確保（同 telemetry.js），sql/020_contrib.sql 是同一份結構的紀錄。 */

import { allowOrigin, corsHeaders } from './cors.js';

const MIN_GAP_S = 20 * 60;        // 同一人同一期最密 20 分鐘一筆（前端自己是 30 分鐘）
const MAX_BODY = 1024;
const RATE_N = 20, RATE_MS = 60_000;
const MAX_LATEST = 3000;           // GET 最多回幾個人
const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|discordbot|telegrambot|whatsapp|line-poker|playwright|puppeteer|phantom/i;

let _schema = null;
export function ensureContribSchema(db) {
  if (!_schema) {
    _schema = (async () => {
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS contrib_pts (
          srv TEXT NOT NULL DEFAULT 'tw', ev INTEGER NOT NULL, t INTEGER NOT NULL,
          rank INTEGER NOT NULL, score INTEGER NOT NULL, uh TEXT NOT NULL)`),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_contrib_ev ON contrib_pts(srv, ev, t)'),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_contrib_uh ON contrib_pts(srv, ev, uh, t)'),
      ]);
    })().catch(e => { _schema = null; throw e; });
  }
  return _schema;
}
export function _resetContribSchema() { _schema = null; }

const _rate = new Map();
function rateOk(ip, now) {
  if (_rate.size > 5000) _rate.clear();
  const r = _rate.get(ip);
  if (!r || now - r.t0 > RATE_MS) { _rate.set(ip, { t0: now, n: 1 }); return true; }
  r.n++;
  return r.n <= RATE_N;
}
export function _resetContribRate() { _rate.clear(); }

export async function playerHash(secret, srv, pid) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(secret || '') + '|contrib|' + srv + '|' + pid));
  return [...new Uint8Array(buf)].slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* 收下來的欄位：ev 1～99999、rank 1～9,999,999、score 0～99,999,999,999、pid 4～24 位數字、srv tw|jp */
export function cleanContrib(b) {
  if (!b || typeof b !== 'object') return null;
  const ev = Number(b.ev), rank = Number(b.rank), score = Number(b.score);
  const srv = b.srv === 'jp' ? 'jp' : 'tw';
  const pid = String(b.pid || '').trim();
  if (!Number.isInteger(ev) || ev < 1 || ev > 99999) return null;
  if (!Number.isInteger(rank) || rank < 1 || rank > 9_999_999) return null;
  if (!Number.isInteger(score) || score < 0 || score > 99_999_999_999) return null;
  if (!/^\d{4,24}$/.test(pid)) return null;
  return { ev, rank, score, srv, pid };
}

/* 公開彙總：每個人最新的一筆（依名次排序）、人數、筆數、最近一小時的筆數 */
export async function contribReport(db, srv, ev, now) {
  await ensureContribSchema(db);
  const s = srv === 'jp' ? 'jp' : 'tw', e = Number(ev) || 0, t = Math.floor((now || Date.now()) / 1000);
  const all = async (sql, ...a) => ((await db.prepare(sql).bind(...a).all()).results || []);
  const tot = await db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT uh) AS p, SUM(t >= ?) AS h FROM contrib_pts WHERE srv = ? AND ev = ?').bind(t - 3600, s, e).first();
  const latest = await all(`SELECT c.rank AS rank, c.score AS score, c.t AS t FROM contrib_pts c
      JOIN (SELECT uh, MAX(t) AS mt FROM contrib_pts WHERE srv = ? AND ev = ? GROUP BY uh) m ON m.uh = c.uh AND m.mt = c.t
      WHERE c.srv = ? AND c.ev = ? ORDER BY c.rank ASC LIMIT ?`, s, e, s, e, MAX_LATEST);
  const n = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  return { ev: e, srv: s, now: t, n: n(tot && tot.n), players: n(tot && tot.p), hour: n(tot && tot.h), latest: latest.map(r => [n(r.rank), n(r.score), n(r.t)]) };
}

export async function handleContrib(req, env, url) {
  const h = { ...corsHeaders(req, env) };
  if (req.method === 'OPTIONS') {
    h['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    h['access-control-allow-headers'] = 'Content-Type';
    h['access-control-max-age'] = '86400';
    return new Response(null, { status: 204, headers: h });
  }
  if (!env.DB) return new Response(JSON.stringify({ error: 'no_db' }), { status: 503, headers: { ...h, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  if (req.method === 'GET') {
    const ev = Number(url.searchParams.get('ev') || 0);
    if (!Number.isInteger(ev) || ev < 1) return new Response(JSON.stringify({ error: 'bad_ev' }), { status: 400, headers: { ...h, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    const rep = await contribReport(env.DB, url.searchParams.get('srv'), ev);
    return new Response(JSON.stringify(rep), { headers: { ...h, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' } });
  }
  h['cache-control'] = 'no-store';
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: h });
  if (!allowOrigin(req, env)) return new Response(null, { status: 403, headers: h });
  const ua = req.headers.get('User-Agent') || '';
  if (!ua || BOT_RE.test(ua)) return new Response(null, { status: 204, headers: h });
  const ip = req.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const now = Date.now();
  if (!rateOk(ip, now)) return new Response(null, { status: 429, headers: h });
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY) return new Response(null, { status: 413, headers: h });
  let text = '';
  try { text = await req.text(); } catch (e) { return new Response(null, { status: 400, headers: h }); }
  if (text.length > MAX_BODY) return new Response(null, { status: 413, headers: h });
  let body = null;
  try { body = JSON.parse(text); } catch (e) { return new Response(null, { status: 400, headers: h }); }
  const c = cleanContrib(body);
  if (!c) return new Response(null, { status: 400, headers: h });
  const uh = await playerHash(env.SESSION_SECRET, c.srv, c.pid);
  const t = Math.floor(now / 1000);
  try {
    await ensureContribSchema(env.DB);
    const last = await env.DB.prepare('SELECT t FROM contrib_pts WHERE srv = ? AND ev = ? AND uh = ? ORDER BY t DESC LIMIT 1').bind(c.srv, c.ev, uh).first();
    if (last && t - Number(last.t) < MIN_GAP_S) return new Response(null, { status: 204, headers: h });   // 太密：靜靜不收
    await env.DB.prepare('INSERT INTO contrib_pts (srv, ev, t, rank, score, uh) VALUES (?,?,?,?,?,?)').bind(c.srv, c.ev, t, c.rank, c.score, uh).run();
  } catch (e) {
    console.error('contrib insert', e && e.message);
  }
  return new Response(null, { status: 204, headers: h });
}
