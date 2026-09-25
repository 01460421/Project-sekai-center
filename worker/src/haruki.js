/* Haruki（Team-Haruki）串接：
   1. 排名備援：HiSekai 掛掉時，前端、逐局追蹤器與榜線快照改讀 Haruki 公開 API，
      這裡把遊戲原始格式轉成 HiSekai 的形狀（事件欄位攤在最上層、player_top_100_rankings、
      player_border_rankings、world_link_*），呼叫端一行都不必改。
   2. /haruki/config：前端讀 Haruki 工具箱 OAuth 的 client 設定（client id 放在 Worker 變數，換值不必改前端）。

   Haruki 公開 API 的排名路徑有身分驗證（X-Haruki-Sekai-Token，向 Team-Haruki 申請）；
   沒設 HARUKI_API_TOKEN 時照樣試一次（對方若是開放模式也能用），失敗就回 502 讓呼叫端退到下一個來源。
   活動期程與 WL 章節來自台服 master（Haruki 6.4 版，缺檔退回 Sekai-World），邊緣快取一小時。 */
import { getJson } from './cal.js';

export const HARUKI_API_DEFAULT = 'https://public-api.haruki.seiunx.com/sekai-api/v5/api/tw';
export const HARUKI_OAUTH_DEFAULT = 'https://toolbox-api-direct.haruki.seiunx.com';
/* Haruki Event Tracker（Team-Haruki/Haruki-Event-Tracker）的公開 web API：不需要 token，
   Haruki 工具箱自己的排名頁就讀這個（前端 .env 的 VITE_HARUKI_EVENT_TRACKER_URL）。
   玩家 ID 會匿名化成每期固定的 unique_id，所以「用 Player ID 找自己」在這個來源對不上。 */
export const HARUKI_TRACKER_DEFAULT = 'https://toolbox-api-direct.haruki.seiunx.com/event-tracker';
const UA = 'project-sekai-center/1.0 (+https://project-sekai-center.com) haruki-fallback';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS' };
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', ...extra } });

/** 19 位 userId 超過安全整數，parse 前先轉字串（與 index.js 的 parseSafe 同一招）。 */
export function parseSafe(text) {
  return JSON.parse(text.replace(/("(?:[^"\\]|\\.)*")\s*:\s*(\d{16,})(?=\s*[,}\]])/g, '$1:"$2"'));
}
const iso = ms => (ms ? new Date(ms).toISOString() : null);

/** master 活動列 → HiSekai 形狀的活動欄位（攤在回應最上層，前端 eventOf() 直接吃） */
export function eventMeta(e) {
  if (!e) return {};
  return {
    id: e.id, name: e.name || '', event_type: e.eventType || '', unit: e.unit || '',
    start_at: iso(e.startAt), aggregate_at: iso(e.aggregateAt), closed_at: iso(e.closedAt),
    ranking_announce_at: iso(e.rankingAnnounceAt), assetbundle_name: e.assetbundleName || '',
  };
}

/** 現在該看哪一期：進行中（開始～關閉）優先，否則最近一期已開始的 */
export function pickCurrent(events, now) {
  const list = (events || []).filter(e => e && e.startAt);
  return list.find(e => e.startAt <= now && now <= (e.closedAt || e.aggregateAt || 0))
    || list.filter(e => e.startAt <= now).sort((a, b) => b.startAt - a.startAt)[0] || null;
}

/** 遊戲原始的排名列 → HiSekai 的列（rank／score／name／user_id／last_player_info.profile.id） */
export function convRow(r) {
  if (!r || typeof r !== 'object') return null;
  const uid = r.userId != null ? String(r.userId) : '';
  const card = r.userCard && r.userCard.cardId != null ? { id: r.userCard.cardId, level: r.userCard.level, master_rank: r.userCard.masterRank, special_training: r.userCard.specialTrainingStatus === 'done' } : null;
  return { rank: r.rank, score: r.score, name: r.name || '', user_id: uid, last_player_info: { profile: { id: uid, word: (r.userProfile && r.userProfile.word) || '' }, card } };
}

function chapterMeta(wbs, eventId, charId) {
  const w = (wbs || []).find(x => x.eventId === eventId && x.gameCharacterId === charId);
  return w ? { chapter: w.chapterNo, character: charId, start_at: iso(w.chapterStartAt), aggregate_at: iso(w.aggregateAt), closed_at: iso(w.chapterEndAt || w.aggregateAt) }
    : { chapter: null, character: charId };
}

export function toTop100(raw, ev, wbs) {
  const rows = ((raw && raw.rankings) || []).map(convRow).filter(Boolean);
  const out = { ...eventMeta(ev), player_top_100_rankings: rows, source: 'haruki' };
  const chs = (raw && raw.userWorldBloomChapterRankings) || [];
  if (chs.length) {
    out.world_link_top_100_rankings = chs.map(c => ({ ...chapterMeta(wbs, ev && ev.id, c.gameCharacterId),
      player_top_100_rankings: (c.rankings || []).map(convRow).filter(Boolean) }))
      .filter(c => c.chapter != null).sort((a, b) => a.chapter - b.chapter);
  }
  return out;
}

export function toBorder(raw, ev, wbs) {
  const rows = ((raw && raw.borderRankings) || []).map(convRow).filter(Boolean);
  const out = { ...eventMeta(ev), player_border_rankings: rows, source: 'haruki' };
  const chs = (raw && raw.userWorldBloomChapterRankingBorders) || [];
  if (chs.length) {
    out.world_link_border_rankings = chs.map(c => {
      const pb = (c.borderRankings || []).map(convRow).filter(Boolean);
      // 榜線快照（tools/record-border.py）讀 player_borders，前端讀 player_border_rankings：兩個都給
      return { ...chapterMeta(wbs, ev && ev.id, c.gameCharacterId), player_border_rankings: pb, player_borders: pb };
    }).filter(c => c.chapter != null).sort((a, b) => a.chapter - b.chapter);
  }
  return out;
}

export function toEventList(events, now) {
  return (events || []).filter(e => e && e.startAt && e.startAt <= now + 86400000 * 30)
    .sort((a, b) => b.id - a.id).map(eventMeta);
}

async function harukiGet(env, path) {
  const base = (env && env.HARUKI_API_BASE) || HARUKI_API_DEFAULT;
  const headers = { 'user-agent': UA, accept: 'application/json' };
  if (env && env.HARUKI_API_TOKEN) headers['x-haruki-sekai-token'] = env.HARUKI_API_TOKEN;
  const r = await fetch(base + path, { headers, cf: { cacheTtl: 0, cacheEverything: false }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('haruki HTTP ' + r.status);
  return parseSafe(await r.text());
}

/* ---------- Event Tracker → HiSekai 形狀 ----------
   overview 回：topRankings[{rankData:{rank,score,userId,timestamp}, userData:{name,cardId,…}}]、
   topPlayerGrowths[{userId,growth,timeDiff}]（interval 內的增量，換算成時速）、borderLines[{rank,score}]。 */
export function trackerRows(ov) {
  const grow = new Map(((ov && ov.topPlayerGrowths) || []).map(g => [String(g.userId), g]));
  return ((ov && ov.topRankings) || []).map(it => {
    const r = (it && it.rankData) || {}, u = (it && it.userData) || {};
    const uid = String(r.userId != null ? r.userId : (u.userId || ''));
    const g = grow.get(uid);
    const speed = g && g.timeDiff > 0 && g.growth != null ? Math.round(g.growth * 3600 / g.timeDiff) : null;
    return { rank: r.rank, score: r.score, name: u.name || '', user_id: uid,
      last_player_info: { profile: { id: uid, word: u.profileWord || '' },
        card: u.cardId != null ? { id: u.cardId, level: u.cardLevel, master_rank: u.cardMasterRank, special_training: u.cardSpecialTrainingStatus === 'done' } : null },
      last_1h_stats: speed != null ? { speed } : null };
  }).filter(x => x.rank);
}
export function trackerBorders(ov) {
  return ((ov && ov.borderLines) || []).filter(b => b && b.rank).map(b => ({ rank: b.rank, score: b.score, name: '', user_id: '' }));
}
async function trackerGet(env, eventId, charId) {
  const base = ((env && env.HARUKI_TRACKER_BASE) || HARUKI_TRACKER_DEFAULT).replace(/\/+$/, '');
  const path = '/api/v2/web/events/tw/' + eventId + '/leaderboards/' + (charId ? 'world-bloom/' + charId + '/overview' : 'total/overview') + '?interval=3600';
  const r = await fetch(base + path, { headers: { accept: 'application/json', 'user-agent': UA }, cf: { cacheTtl: 0, cacheEverything: false }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('tracker HTTP ' + r.status);
  return parseSafe(await r.text());
}
async function fromTracker(env, kind, ev, wbs) {
  const ov = await trackerGet(env, ev.id);
  const main = kind === 'top100' ? trackerRows(ov) : trackerBorders(ov);
  if (!main.length) throw new Error('tracker 沒有這一期的資料');
  const out = { ...eventMeta(ev), source: 'haruki', via: 'tracker' };
  if (kind === 'top100') out.player_top_100_rankings = main; else out.player_border_rankings = main;
  const chs = (wbs || []).filter(w => w.eventId === ev.id);
  if (chs.length) {
    const per = await Promise.all(chs.map(w => trackerGet(env, ev.id, w.gameCharacterId).catch(() => null)));
    const list = chs.map((w, i) => {
      if (!per[i]) return null;
      const meta = chapterMeta(wbs, ev.id, w.gameCharacterId);
      if (kind === 'top100') return { ...meta, player_top_100_rankings: trackerRows(per[i]) };
      const pb = trackerBorders(per[i]);
      return { ...meta, player_border_rankings: pb, player_borders: pb };
    }).filter(Boolean).sort((a, b) => a.chapter - b.chapter);
    if (list.length) out[kind === 'top100' ? 'world_link_top_100_rankings' : 'world_link_border_rankings'] = list;
  }
  return out;
}

/** 逐局追蹤器與其他模組共用：直接拿 HiSekai 形狀的當期前百／榜線（不經 HTTP）。
    先問 Event Tracker（公開、不用 token、有時速），不行再問 Haruki 公開 API（要 token）。 */
export async function harukiLive(env, kind, eventId) {
  const events = await getJson('events.json');
  const ev = eventId ? events.find(e => String(e.id) === String(eventId)) : pickCurrent(events, Date.now());
  if (!ev) throw new Error('no event');
  const wbs = ev.eventType === 'world_bloom' ? await getJson('worldBlooms.json').catch(() => []) : [];
  try { return await fromTracker(env, kind, ev, wbs); }
  catch (e) {
    try {
      if (kind === 'top100') return toTop100(await harukiGet(env, '/event/' + ev.id + '/ranking-top100'), ev, wbs);
      return toBorder(await harukiGet(env, '/event/' + ev.id + '/ranking-border'), ev, wbs);
    } catch (e2) { throw new Error('Event Tracker：' + ((e && e.message) || e) + '；公開 API：' + ((e2 && e2.message) || e2)); }
  }
}

const PATH_OK = /^\/haruki\/(config|event\/list|event\/(live|\d{1,4})\/(top100|border))$/;

/* ---------- 工具箱 OAuth 轉送 ----------
   Haruki 工具箱不對其他網站開 CORS，瀏覽器不能直接呼叫它（對方 2026-09 回覆），所以換 token、撤銷、
   讀綁定與遊戲資料都經這裡轉一手：原封不動送過去、原封不動回來，不記錄、不快取、不保存任何 token。
   只放行固定幾條路徑；CORS 只給本站網域；client_id 必須是 Worker 設定的那一個，避免被拿去替別的 client 代打。
   本站有後端，向 Haruki 申請的是保密客戶端（confidential，見對方 docs/oauth2-integration §2、§5.2）：
   有設 HARUKI_OAUTH_CLIENT_SECRET 時，換 token 與撤銷改用 client_secret_basic（Basic 認證、表單不帶 client_id），
   secret 只存在 Worker，瀏覽器看不到。沒設 secret 就照公開客戶端（PKCE）轉送。 */
const OAUTH_GET = /^\/haruki\/oauth\/(user\/bindings|user\/profile|game-data\/tw\/(suite|mysekai)\/\d{6,20})$/;
const OAUTH_POST = /^\/haruki\/oauth\/(token|revoke)$/;
function siteCors(env, req) {
  const site = (env && env.SITE_BASE) || 'https://project-sekai-center.com';
  const origin = req.headers.get('origin') || '';
  const allow = origin === site ? origin : site;
  return { 'access-control-allow-origin': allow, 'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '600', vary: 'Origin' };
}
export async function handleHarukiOAuth(req, env, url) {
  const cors = siteCors(env, req);
  const out = (obj, status) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const base = ((env && env.HARUKI_OAUTH_BASE) || HARUKI_OAUTH_DEFAULT).replace(/\/+$/, '');
  const clientId = (env && env.HARUKI_OAUTH_CLIENT_ID) || '';
  if (!clientId) return out({ error: 'not_configured', error_description: '站方尚未設定 Haruki OAuth client' }, 503);
  let upstream;
  try {
    if (req.method === 'POST' && OAUTH_POST.test(url.pathname)) {
      const form = new URLSearchParams(await req.text());
      if (form.get('client_id') !== clientId) return out({ error: 'invalid_client', error_description: 'client_id 不符' }, 400);
      const which = OAUTH_POST.exec(url.pathname)[1];
      if (which === 'token' && !['authorization_code', 'refresh_token'].includes(form.get('grant_type') || '')) return out({ error: 'unsupported_grant_type' }, 400);
      const headers = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': UA };
      const secret = (env && env.HARUKI_OAUTH_CLIENT_SECRET) || '';
      if (secret) {
        // RFC 6749 §2.3.1：id 與 secret 先各自 form-urlencode 再組 Basic
        headers.authorization = 'Basic ' + btoa(encodeURIComponent(clientId) + ':' + encodeURIComponent(secret));
        form.delete('client_id');
      }
      upstream = await fetch(base + '/api/oauth2/' + which, { method: 'POST', headers, body: form.toString(), signal: AbortSignal.timeout(20000) });
    } else if (req.method === 'GET' && OAUTH_GET.test(url.pathname)) {
      const auth = req.headers.get('authorization') || '';
      if (!/^Bearer [\w\-.~+/=]{8,4096}$/.test(auth)) return out({ error: 'invalid_token', error_description: '缺少授權' }, 401);
      upstream = await fetch(base + '/api/oauth2/' + url.pathname.slice('/haruki/oauth/'.length), { headers: { authorization: auth, accept: 'application/json', 'user-agent': UA },
        signal: AbortSignal.timeout(30000) });
    } else {
      return out({ error: 'not_found' }, 404);
    }
  } catch (e) {
    return out({ error: 'upstream', error_description: 'Haruki 工具箱連線失敗：' + String((e && e.message) || e).slice(0, 120) }, 502);
  }
  const h = new Headers(cors);
  h.set('content-type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
  h.set('cache-control', 'no-store');
  return new Response(upstream.body, { status: upstream.status, headers: h });
}

/* ---------- 工具箱公開 API（不需要 token） ----------
   玩家在 Haruki 工具箱把自己帳號的 Suite／MySekai 設成「允許公開 API」後，
   /public/{server}/{suite|mysekai}/{userId} 不必登入就讀得到（對方 internal/modules/public）。
   一樣不開 CORS，所以經 Worker 轉一手；主機先打 suite-api（Uni PJSK Viewer 用的那台），失敗再打工具箱後端的 /api/public。
   回應原樣轉回（404＝沒上傳或沒公開，對方刻意不分這兩種），邊緣快取一分鐘。 */
export const HARUKI_SUITE_DEFAULT = 'https://suite-api.haruki.seiunx.com';
const PUBLIC_OK = /^\/haruki\/public\/tw\/(suite|mysekai)\/(\d{6,20})$/;
async function handleHarukiPublic(req, env, url) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  const m = PUBLIC_OK.exec(url.pathname);
  if (!m) return json({ error: 'not_found' }, 404);
  const tail = '/tw/' + m[1] + '/' + m[2] + (url.searchParams.get('key') ? '?key=' + encodeURIComponent(url.searchParams.get('key')) : '');
  const hosts = [((env && env.HARUKI_SUITE_API_BASE) || HARUKI_SUITE_DEFAULT).replace(/\/+$/, '') + '/public',
    ((env && env.HARUKI_OAUTH_BASE) || HARUKI_OAUTH_DEFAULT).replace(/\/+$/, '') + '/api/public'];
  let last = null;
  for (const h of hosts) {
    try {
      const r = await fetch(h + tail, { headers: { accept: 'application/json', 'user-agent': UA }, cf: { cacheTtl: 60, cacheEverything: true }, signal: AbortSignal.timeout(30000) });
      if (r.status >= 500) { last = r; continue; }   // 這台掛了才換下一台；404 是「沒公開」，換台也一樣
      const hd = new Headers(CORS);
      hd.set('content-type', r.headers.get('content-type') || 'application/json; charset=utf-8');
      hd.set('cache-control', r.ok ? 'public, max-age=60' : 'no-store');
      return new Response(r.body, { status: r.status, headers: hd });
    } catch (e) { last = e; }
  }
  return json({ error: 'upstream', message: 'Haruki 工具箱暫時連不上' + (last && last.status ? '（HTTP ' + last.status + '）' : '') }, 502);
}

/* ---------- Haruki master 登錄處（sekai-api-cdn） ----------
   工具箱的組卡引擎要 music_metas.json（每首歌每個難度的基礎分、技能時間點），master 版本清單 current 也在這台。
   對方沒開 CORS，所以經 Worker 轉一手並快取：metas 內容只在新歌上架時變，快取 6 小時；current 5 分鐘。 */
export const HARUKI_REGISTRY_DEFAULT = 'https://sekai-api-cdn.haruki.seiunx.com';
const REGISTRY_OK = /^\/haruki\/(metas\/(jp|tw)\/music_metas\.json|master\/(jp|tw)\/current)$/;
async function handleHarukiRegistry(req, env, url) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  const m = REGISTRY_OK.exec(url.pathname);
  if (!m) return json({ error: 'not_found' }, 404);
  const ttl = m[2] ? 21600 : 300;
  const cache = (typeof caches !== 'undefined' && caches.default) || null;
  const key = new Request('https://haruki.local' + url.pathname, { method: 'GET' });
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  const base = ((env && env.HARUKI_REGISTRY_BASE) || HARUKI_REGISTRY_DEFAULT).replace(/\/+$/, '');
  let r;
  try {
    r = await fetch(base + '/v1/' + m[1], { headers: { accept: 'application/json', 'user-agent': UA }, cf: { cacheTtl: ttl, cacheEverything: true }, signal: AbortSignal.timeout(30000) });
  } catch (e) { return json({ error: 'upstream', message: 'Haruki master 登錄處連不上' }, 502); }
  if (!r.ok) return json({ error: 'upstream', message: 'Haruki master 登錄處回 HTTP ' + r.status }, r.status === 404 ? 404 : 502);
  const hd = new Headers(CORS);
  hd.set('content-type', 'application/json; charset=utf-8');
  hd.set('cache-control', 'public, max-age=' + ttl);
  const res = new Response(r.body, { status: 200, headers: hd });
  if (cache) { try { await cache.put(key, res.clone()); } catch (e) {} }
  return res;
}

export async function handleHaruki(req, env, url) {
  if (url.pathname.startsWith('/haruki/oauth/')) return handleHarukiOAuth(req, env, url);
  if (url.pathname.startsWith('/haruki/public/')) return handleHarukiPublic(req, env, url);
  if (/^\/haruki\/(metas|master)\//.test(url.pathname)) return handleHarukiRegistry(req, env, url);
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  const m = PATH_OK.exec(url.pathname);
  if (!m) return json({ error: 'not_found' }, 404);
  if (m[1] === 'config') {
    return json({
      /* 保密客戶端要等 Cloudflare 上的 HARUKI_OAUTH_CLIENT_SECRET 真的存好才對外公布 client id（前端沒 id 就不顯示連結按鈕），
         否則玩家按下去換 token 一定失敗；HARUKI_OAUTH_PUBLIC="1" 表示申請的是公開客戶端，不需要 secret。 */
      oauth: { base: (env && env.HARUKI_OAUTH_BASE) || HARUKI_OAUTH_DEFAULT,
        clientId: (env && env.HARUKI_OAUTH_CLIENT_ID && (env.HARUKI_OAUTH_CLIENT_SECRET || env.HARUKI_OAUTH_PUBLIC === '1')) ? env.HARUKI_OAUTH_CLIENT_ID : '',
        confidential: !!(env && env.HARUKI_OAUTH_CLIENT_SECRET),
        scopes: ((env && env.HARUKI_OAUTH_SCOPES) || 'offline_access game-data:read').split(/\s+/).filter(Boolean) },
      api: { token: !!(env && env.HARUKI_API_TOKEN) },
    }, 200, { 'cache-control': 'public, max-age=300' });
  }
  const cache = (typeof caches !== 'undefined' && caches.default) || null;
  const key = new Request('https://haruki.local' + url.pathname, { method: 'GET' });
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  let body;
  try {
    if (m[1] === 'event/list') body = toEventList(await getJson('events.json'), Date.now());
    else body = await harukiLive(env, m[3], m[2] === 'live' ? null : m[2]);
  } catch (e) {
    return json({ error: 'upstream', message: String((e && e.message) || e).slice(0, 160) }, 502);
  }
  const res = json(body, 200, { 'cache-control': 'public, max-age=30' });
  if (cache) { try { await cache.put(key, res.clone()); } catch (e) {} }
  return res;
}
