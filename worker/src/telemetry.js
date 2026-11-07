/* 匿名使用統計與前端錯誤回報（/t）。

   為什麼自己做而不接 Google Analytics：這站的問題是「不知道誰在用哪一頁、壞在哪」，
   要的只是頁面次數、裝置、來源、語言與錯誤訊息，不需要跨站追蹤。自己收：
   - 不用 cookie、不存 IP。訪客只用「當天 + IP + UA + 站方密鑰」的雜湊前 12 碼辨識，
     隔天雜湊就換，無法跨日串起同一個人；資料 90 天後刪。
   - 前端尊重「不要追蹤」（DNT／GPC）與設定頁的開關；爬蟲 UA 直接丟掉。
   - 只收白名單欄位：頁面 id、裝置（m/d）、來源主機名、介面語言、伺服器（tw/jp）、
     錯誤訊息（截 200 字）、程式版本戳。其他任何欄位一律忽略。
   - POST 用 text/plain（sendBeacon 的 Blob）：不觸發 preflight，關分頁那一刻也送得出去。

   表結構由 Worker 自己確保（跟 push.js 一樣，部署用的 token 不一定能跑 D1 遷移），
   sql/019_telemetry.sql 是同一份結構的紀錄。 */

import { allowOrigin, corsHeaders } from './cors.js';

const KEEP_DAYS = 90;
const MAX_EVENTS = 20;          // 一次最多幾筆
const MAX_BODY = 8 * 1024;      // 一次最多幾 bytes
const RATE_N = 30, RATE_MS = 60_000;   // 每個 IP 每分鐘最多幾次 POST
const PAGE_RE = /^[a-z][a-z0-9_]{0,23}$/;
const KINDS = new Set(['pv', 'err', 'dat']);
const LANGS = new Set(['zh-TW', 'zh-CN', 'en', 'ja']);
const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|discordbot|telegrambot|whatsapp|line-poker|playwright|puppeteer|phantom/i;

let _schema = null;
export function ensureTeleSchema(db) {
  if (!_schema) {
    _schema = (async () => {
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS tele_raw (
          t INTEGER NOT NULL, day TEXT NOT NULL, k TEXT NOT NULL, page TEXT NOT NULL DEFAULT '',
          dev TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '', lang TEXT NOT NULL DEFAULT '',
          srv TEXT NOT NULL DEFAULT '', vh TEXT NOT NULL DEFAULT '', msg TEXT NOT NULL DEFAULT '', ver TEXT NOT NULL DEFAULT '')`),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_tele_t ON tele_raw(t)'),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_tele_day_k ON tele_raw(day, k)'),
        db.prepare('CREATE TABLE IF NOT EXISTS ops_state (key TEXT PRIMARY KEY, val TEXT NOT NULL, t INTEGER NOT NULL)'),
      ]);
    })().catch(e => { _schema = null; throw e; });
  }
  return _schema;
}
/* 測試會換一個資料庫再跑一次 */
export function _resetTeleSchema() { _schema = null; }

/* 台北的「今天」：台服玩家的一天，跟儀表板其他統計一致 */
export const dayKey = (ms) => new Date((ms == null ? Date.now() : ms) + 8 * 3600 * 1000).toISOString().slice(0, 10);

async function visitorHash(secret, ip, ua, day) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(secret || '') + '|' + day + '|' + ip + '|' + ua));
  return [...new Uint8Array(buf)].slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
}

const _rate = new Map();
function rateOk(ip, now) {
  if (_rate.size > 5000) _rate.clear();
  const r = _rate.get(ip);
  if (!r || now - r.t0 > RATE_MS) { _rate.set(ip, { t0: now, n: 1 }); return true; }
  r.n++;
  return r.n <= RATE_N;
}
export function _resetRate() { _rate.clear(); }

/* 來源主機名：只留主機、去掉 www、本站自己的不算來源 */
function refHost(v, env) {
  const s = String(v || '').trim().toLowerCase().slice(0, 120);
  if (!s) return '';
  let h = s;
  try { if (/^[a-z]+:\/\//.test(s)) h = new URL(s).hostname; } catch (e) { return ''; }
  h = h.replace(/^www\./, '');
  if (!/^[a-z0-9.-]{1,60}$/.test(h)) return '';
  let site = '';
  try { site = new URL(String(env.SITE_BASE || 'https://project-sekai-center.com')).hostname.replace(/^www\./, ''); } catch (e) {}
  if (h === site || h.endsWith('.' + site)) return '';
  return h;
}

function cleanEvent(e, env) {
  if (!e || typeof e !== 'object') return null;
  const k = String(e.k || '');
  if (!KINDS.has(k)) return null;
  const page = PAGE_RE.test(String(e.p || '')) ? String(e.p) : '';
  const dev = e.d === 'm' ? 'm' : e.d === 'd' ? 'd' : '';
  const lang = LANGS.has(e.l) ? e.l : '';
  const srv = e.s === 'jp' ? 'jp' : e.s === 'tw' ? 'tw' : '';
  const ver = /^[a-z0-9]{1,12}$/i.test(String(e.v || '')) ? String(e.v) : '';
  let msg = '';
  if (k !== 'pv') {
    msg = String(e.m || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 200);
    if (!msg) return null;
  }
  return { k, page, dev, ref: k === 'pv' ? refHost(e.r, env) : '', lang, srv, msg, ver };
}

export async function handleTelemetry(req, env, url) {
  const h = { ...corsHeaders(req, env), 'cache-control': 'no-store' };
  if (req.method === 'OPTIONS') {
    h['access-control-allow-methods'] = 'POST, OPTIONS';
    h['access-control-allow-headers'] = 'Content-Type';
    h['access-control-max-age'] = '86400';
    return new Response(null, { status: 204, headers: h });
  }
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: h });
  // 只收本站（含 www、本機開發）送來的；沒有 Origin 的不是瀏覽器
  if (!allowOrigin(req, env)) return new Response(null, { status: 403, headers: h });
  if (!env.DB) return new Response(null, { status: 204, headers: h });
  const ua = req.headers.get('User-Agent') || '';
  if (!ua || BOT_RE.test(ua)) return new Response(null, { status: 204, headers: h });
  const ip = req.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const now = Date.now();
  if (!rateOk(ip, now)) return new Response(null, { status: 429, headers: h });
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) return new Response(null, { status: 413, headers: h });
  let text = '';
  try { text = await req.text(); } catch (e) { return new Response(null, { status: 400, headers: h }); }
  if (text.length > MAX_BODY) return new Response(null, { status: 413, headers: h });
  let body = null;
  try { body = JSON.parse(text); } catch (e) { return new Response(null, { status: 400, headers: h }); }
  const list = Array.isArray(body && body.e) ? body.e.slice(0, MAX_EVENTS) : [];
  const rows = list.map(e => cleanEvent(e, env)).filter(Boolean);
  if (!rows.length) return new Response(null, { status: 204, headers: h });
  const day = dayKey(now);
  const vh = await visitorHash(env.SESSION_SECRET, ip, ua, day);
  try {
    await ensureTeleSchema(env.DB);
    const t = Math.floor(now / 1000);
    await env.DB.batch(rows.map(r => env.DB.prepare(
      'INSERT INTO tele_raw (t, day, k, page, dev, ref, lang, srv, vh, msg, ver) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(t, day, r.k, r.page, r.dev, r.ref, r.lang, r.srv, vh, r.msg, r.ver)));
  } catch (e) {
    console.error('telemetry insert', e && e.message);
  }
  return new Response(null, { status: 204, headers: h });
}

/* 管理員儀表板用的彙總（admin.js 已驗過身分）。days 1～90，預設 30。 */
export async function teleReport(db, days) {
  await ensureTeleSchema(db);
  const d = Math.max(1, Math.min(90, Number(days) || 30));
  const since = Math.floor(Date.now() / 1000) - d * 86400;
  const all = async (sql, ...a) => ((await db.prepare(sql).bind(...a).all()).results || []);
  const n = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  const daily = (await all(`SELECT day, SUM(k='pv') AS views, COUNT(DISTINCT CASE WHEN k='pv' THEN vh END) AS uniq,
      SUM(k='err') AS errs, SUM(k='dat') AS dats FROM tele_raw WHERE t >= ? GROUP BY day ORDER BY day`, since))
    .map(r => ({ day: r.day, views: n(r.views), uniq: n(r.uniq), errs: n(r.errs), dats: n(r.dats) }));
  const dim = async (col, lim) => (await all(`SELECT ${col} AS v, COUNT(*) AS n, COUNT(DISTINCT vh) AS u FROM tele_raw
      WHERE k='pv' AND t >= ? AND ${col} <> '' GROUP BY ${col} ORDER BY n DESC LIMIT ?`, since, lim || 20))
    .map(r => ({ v: r.v, n: n(r.n), u: n(r.u) }));
  const errors = (await all(`SELECT k, msg, page, ver, COUNT(*) AS n, MAX(t) AS last FROM tele_raw
      WHERE k IN ('err','dat') AND t >= ? GROUP BY k, msg, page, ver ORDER BY n DESC LIMIT 60`, since))
    .map(r => ({ k: r.k, msg: r.msg, page: r.page, ver: r.ver, n: n(r.n), last: n(r.last) }));
  const today = dayKey();
  const tot = daily.reduce((a, r) => ({ views: a.views + r.views, errs: a.errs + r.errs, dats: a.dats + r.dats }), { views: 0, errs: 0, dats: 0 });
  const uniq = n(((await all('SELECT COUNT(DISTINCT day || vh) AS u FROM tele_raw WHERE k=\'pv\' AND t >= ?', since))[0] || {}).u);
  const td = daily.find(r => r.day === today) || { views: 0, uniq: 0, errs: 0, dats: 0 };
  return {
    days: d, today: td, totals: { ...tot, uniq },   // uniq 是「每日不重複訪客」的加總（跨日無法辨識同一人）
    daily, pages: await dim('page', 60), devices: await dim('dev', 3), refs: await dim('ref', 25), langs: await dim('lang', 4), srv: await dim('srv', 2),
    errors,
  };
}

/* 每小時：刪 90 天前的原始列 */
export async function teleMaintain(db) {
  await ensureTeleSchema(db);
  const cut = Math.floor(Date.now() / 1000) - KEEP_DAYS * 86400;
  await db.prepare('DELETE FROM tele_raw WHERE t < ?').bind(cut).run();
}

/* ops_state：給資料管線檢查等雜項存狀態用（key → 字串） */
export async function stateGet(db, key) {
  await ensureTeleSchema(db);
  const r = await db.prepare('SELECT val, t FROM ops_state WHERE key = ?').bind(key).first();
  return r ? { val: r.val, t: Number(r.t) } : null;
}
export async function stateSet(db, key, val) {
  await ensureTeleSchema(db);
  await db.prepare('INSERT INTO ops_state (key, val, t) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET val = excluded.val, t = excluded.t')
    .bind(key, String(val), Math.floor(Date.now() / 1000)).run();
}
