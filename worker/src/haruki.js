/* Haruki（Team-Haruki）串接：
   1. 排名備援：HiSekai 掛掉時，前端、逐局追蹤器與榜線快照改讀 Haruki 公開 API，
      這裡把遊戲原始格式轉成 HiSekai 的形狀（事件欄位攤在最上層、player_top_100_rankings、
      player_border_rankings、world_link_*），呼叫端一行都不必改。
   2. /haruki/config：前端讀 Haruki 工具箱 OAuth 的 client 設定（client id 放在 Worker 變數，換值不必改前端）。

   Haruki 公開 API 的排名路徑有身分驗證（X-Haruki-Sekai-Token，向 Team-Haruki 申請）；
   沒設 HARUKI_API_TOKEN 時照樣試一次（對方若是開放模式也能用），失敗就回 502 讓呼叫端退到下一個來源。
   活動期程與 WL 章節來自台服 master（Haruki 6.4 版，缺檔退回 Sekai-World），邊緣快取一小時。 */
import { getJson } from './cal.js';
import { bridgeVerify, cleanSecret } from './bridge.js';
import { grantGet, grantUpsert, grantRevoke, grantTokens, grantFail, grantUsed, useBridgeNonce } from './db.js';

export const HARUKI_API_DEFAULT = 'https://public-api.haruki.seiunx.com/sekai-api/v5/api/tw';
export const HARUKI_OAUTH_DEFAULT = 'https://toolbox-api-direct.haruki.seiunx.com';
/* Haruki Event Tracker（Team-Haruki/Haruki-Event-Tracker）的公開 web API：不需要 token，
   Haruki 工具箱自己的排名頁就讀這個（前端 .env 的 VITE_HARUKI_EVENT_TRACKER_URL）。
   玩家 ID 會匿名化成每期固定的 unique_id，所以「用 Player ID 找自己」在這個來源對不上。 */
export const HARUKI_TRACKER_DEFAULT = 'https://toolbox-api-direct.haruki.seiunx.com/event-tracker';
const UA = 'project-sekai-center/1.0 (+https://project-sekai-center.com) haruki-fallback';
/* 日服：活動期程與 WL 章節改讀 Sekai-World 的日服 master（全站的日服模式、/haruki/jp/* 用）。
   台服的仍走 cal.js 的 getJson（Haruki 台服 master，缺檔退回 Sekai-World 台服）。 */
export const JP_MASTER_DEFAULT = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-diff/main';
export const SERVERS = ['tw', 'jp'];
async function getJp(name, env) {
  const base = ((env && env.JP_MASTER_BASE) || JP_MASTER_DEFAULT).replace(/\/+$/, '');
  const r = await fetch(base + '/' + name, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!r.ok) throw new Error('jp ' + name + ' HTTP ' + r.status);
  return r.json();
}
const masterOf = (server, env) => (name => server === 'jp' ? getJp(name, env) : getJson(name));
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

async function harukiGet(env, path, server = 'tw') {
  // HARUKI_API_BASE 預設結尾是 /api/tw；日服把最後一段換成 /jp
  const base = ((env && env.HARUKI_API_BASE) || HARUKI_API_DEFAULT).replace(/\/(tw|jp)\/?$/, '') + '/' + server;
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
/* 官方段位端點出錯時（2026-09 第 180 期 WL 終章整期如此，Tracker 只存得到前百），
   borderLines 會是空的：退一步用前百第 100 名當 T100，至少榜線頁與快照還有東西。 */
export function trackerBorders(ov) {
  const lines = ((ov && ov.borderLines) || []).filter(b => b && b.rank).map(b => ({ rank: b.rank, score: b.score, name: '', user_id: '' }));
  if (lines.length) return lines;
  const r100 = ((ov && ov.topRankings) || []).map(it => (it && it.rankData) || {}).find(r => r.rank === 100);
  return r100 && r100.score != null ? [{ rank: 100, score: r100.score, name: '', user_id: '', partial: true }] : [];
}
async function trackerGet(env, eventId, charId, server = 'tw') {
  const base = ((env && env.HARUKI_TRACKER_BASE) || HARUKI_TRACKER_DEFAULT).replace(/\/+$/, '');
  const path = '/api/v2/web/events/' + server + '/' + eventId + '/leaderboards/' + (charId ? 'world-bloom/' + charId + '/overview' : 'total/overview') + '?interval=3600';
  const r = await fetch(base + path, { headers: { accept: 'application/json', 'user-agent': UA }, cf: { cacheTtl: 0, cacheEverything: false }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('tracker HTTP ' + r.status);
  return parseSafe(await r.text());
}
async function fromTracker(env, kind, ev, wbs, server = 'tw') {
  const ov = await trackerGet(env, ev.id, 0, server);
  const main = kind === 'top100' ? trackerRows(ov) : trackerBorders(ov);
  if (!main.length) throw new Error('tracker 沒有這一期的資料');
  const out = { ...eventMeta(ev), source: 'haruki', via: 'tracker', server };
  if (kind === 'top100') out.player_top_100_rankings = main; else out.player_border_rankings = main;
  const chs = (wbs || []).filter(w => w.eventId === ev.id);
  if (chs.length) {
    const per = await Promise.all(chs.map(w => trackerGet(env, ev.id, w.gameCharacterId, server).catch(() => null)));
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
export async function harukiLive(env, kind, eventId, server = 'tw') {
  const M = masterOf(server, env);
  const events = await M('events.json');
  const ev = eventId ? events.find(e => String(e.id) === String(eventId)) : pickCurrent(events, Date.now());
  if (!ev) throw new Error('no event');
  const wbs = ev.eventType === 'world_bloom' ? await M('worldBlooms.json').catch(() => []) : [];
  try { return await fromTracker(env, kind, ev, wbs, server); }
  catch (e) {
    try {
      if (kind === 'top100') return { ...toTop100(await harukiGet(env, '/event/' + ev.id + '/ranking-top100', server), ev, wbs), server };
      return { ...toBorder(await harukiGet(env, '/event/' + ev.id + '/ranking-border', server), ev, wbs), server };
    } catch (e2) { throw new Error('Event Tracker：' + ((e && e.message) || e) + '；公開 API：' + ((e2 && e2.message) || e2)); }
  }
}

const PATH_OK = /^\/haruki\/(config|event\/list|event\/(live|\d{1,4})\/(top100|border|user\/(?:\d{6,20}|[0-9a-f]{64})))$/;

/* ---------- 單一玩家的即時紀錄（用 Player ID 查） ----------
   Haruki 活動追蹤器的 details/user：輸入遊戲裡的 Player ID（追蹤器內部的雜湊 ID 也收），回目前名次與分數、
   上一名，以及約 10～20 秒一筆的分數軌跡（columns 格式：t0＋dt[] 秒、s0＋ds[] 分、r0＋dr[] 名次）。
   追蹤器只記前百與各段位線上的玩家，查不到回 404 not_tracked。 */
export async function harukiUser(env, eventId, uid, server = 'tw') {
  const M = masterOf(server, env);
  const events = await M('events.json');
  const ev = eventId ? events.find(e => String(e.id) === String(eventId)) : pickCurrent(events, Date.now());
  if (!ev) throw new Error('no event');
  const base = ((env && env.HARUKI_TRACKER_BASE) || HARUKI_TRACKER_DEFAULT).replace(/\/+$/, '');
  const path = '/api/v2/web/events/' + server + '/' + ev.id + '/leaderboards/total/details/user/' + encodeURIComponent(uid)
    + '?interval=3600&includeTrace=true&includeProfile=true&traceFormat=columns&limit=5000';
  const r = await fetch(base + path, { headers: { accept: 'application/json', 'user-agent': UA }, cf: { cacheTtl: 0, cacheEverything: false }, signal: AbortSignal.timeout(15000) });
  if (r.status === 404) return { ...eventMeta(ev), server, tracked: false };
  if (!r.ok) throw new Error('tracker HTTP ' + r.status);
  const d = parseSafe(await r.text()) || {};
  const pick = x => x && typeof x === 'object' ? { rankData: x.rankData || null, userData: x.userData || null } : null;
  return { ...eventMeta(ev), server, tracked: true, ranked: !!d.ranked, fetched_at: (d.meta && d.meta.fetchedAt) || null,
    current: pick(d.current), next: pick(d.next), trace: d.playerTrace || null, profile: d.profile || null };
}

/* ---------- 工具箱 OAuth 轉送 ----------
   Haruki 工具箱不對其他網站開 CORS，瀏覽器不能直接呼叫它（對方 2026-09 回覆），所以換 token、撤銷、
   讀綁定與遊戲資料都經這裡轉一手：原封不動送過去、原封不動回來，不記錄、不快取、不保存任何 token。
   只放行固定幾條路徑；CORS 只給本站網域；client_id 必須是 Worker 設定的那一個，避免被拿去替別的 client 代打。
   本站有後端，向 Haruki 申請的是保密客戶端（confidential，見對方 docs/oauth2-integration §2、§5.2）：
   有設 HARUKI_OAUTH_CLIENT_SECRET 時，換 token 與撤銷改用 client_secret_basic（Basic 認證、表單不帶 client_id），
   secret 只存在 Worker，瀏覽器看不到。沒設 secret 就照公開客戶端（PKCE）轉送。 */
const OAUTH_GET = /^\/haruki\/oauth\/(user\/bindings|user\/profile|game-data\/(tw|jp)\/(suite|mysekai)\/\d{6,20})$/;
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
const PUBLIC_OK = /^\/haruki\/public\/(tw|jp)\/(suite|mysekai)\/(\d{6,20})$/;
async function handleHarukiPublic(req, env, url) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  const m = PUBLIC_OK.exec(url.pathname);
  if (!m) return json({ error: 'not_found' }, 404);
  const tail = '/' + m[1] + '/' + m[2] + '/' + m[3] + (url.searchParams.get('key') ? '?key=' + encodeURIComponent(url.searchParams.get('key')) : '');
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


/* ---------- Haruki 授權橋接給菜根機器人 ----------
   玩家在「我的帳號」連結 Haruki 後，可以再按「允許機器人讀取」：瀏覽器把手上的 refresh／access token
   POST 到 /haruki/grant，Worker 先拿同一個 Bearer 問 Haruki 的 user/bindings，確認這個 Haruki 帳號真的綁著
   （已驗證的）台服 uid，才用 AES-GCM（金鑰 = SHA-256(HARUKI_GRANT_KEY)）加密後存進 haruki_grants。
   機器人用橋接簽章（bridge.js，與 /car/qqbind 同一套、ident 空、ip "bot"）打 /api/bot/haruki/{suite|mysekai}/{uid}：
   Worker 解密、access 過期就用 refresh 換新（client_secret_basic，與上面 handleHarukiOAuth 同寫法）並寫回，
   再帶 Bearer 讀 game-data 原樣轉回。任何回應都不含 token，log 也不印。
   沒設 HARUKI_GRANT_KEY 或 HARUKI_OAUTH_CLIENT_SECRET：所有 grant 端點回 503 not_configured，前端據此不顯示區塊。 */

export const grantReady = env => !!(env && env.HARUKI_GRANT_KEY && env.HARUKI_OAUTH_CLIENT_SECRET && env.HARUKI_OAUTH_CLIENT_ID);
const b64u = bytes => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = str => { const bin = atob(String(str).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - str.length % 4) % 4)); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
async function grantKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(env.HARUKI_GRANT_KEY).trim()));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
/** 明文 → base64url(iv12 ‖ ciphertext)。每次 iv 都隨機，同一個 token 加密兩次密文不同。 */
export async function grantEnc(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await grantKey(env), new TextEncoder().encode(String(text))));
  const out = new Uint8Array(12 + ct.length); out.set(iv, 0); out.set(ct, 12);
  return b64u(out);
}
export async function grantDec(env, b64) {
  const bytes = unb64u(b64);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await grantKey(env), bytes.slice(12));
  return new TextDecoder().decode(pt);
}
const oauthBase = env => ((env && env.HARUKI_OAUTH_BASE) || HARUKI_OAUTH_DEFAULT).replace(/\/+$/, '');
const BEARER_OK = /^Bearer [\w\-.~+/=]{8,4096}$/;
const UID_OK = /^\d{6,20}$/;

/* 這個 Bearer 的 Haruki 帳號是否綁著台服 uid（有 verified 欄位就要為真）。
   回 { ok:true, binding } 或 { ok:false, status: 401（token 無效）| 403（沒綁）| 502（對方掛了）}。 */
async function bindingOwns(env, auth, uid) {
  const r = await fetch(oauthBase(env) + '/api/oauth2/user/bindings', { headers: { authorization: auth, accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
  if (r.status === 401 || r.status === 403) return { ok: false, status: 401 };
  if (!r.ok) return { ok: false, status: 502 };
  let p = null;
  try { p = parseSafe(await r.text()); } catch (e) { return { ok: false, status: 502 }; }
  const list = Array.isArray(p) ? p : (p && (p.bindings || p.data || p.updatedData || p.items)) || [];
  const hit = (Array.isArray(list) ? list : []).find(b => b && String(b.server || b.region || '').toLowerCase() === 'tw'
    && String(b.userId != null ? b.userId : (b.user_id != null ? b.user_id : (b.gameUserId != null ? b.gameUserId : ''))) === uid
    && (b.verified === undefined || b.verified === null || !!b.verified));
  return hit ? { ok: true, binding: hit } : { ok: false, status: 403 };
}

/* 瀏覽器端：POST /haruki/grant、GET|DELETE /haruki/grant/{uid}（Bearer = 玩家自己的 Haruki access token；CORS 只給本站） */
const GRANT_UID = /^\/haruki\/grant\/(\d{6,20})$/;
async function handleHarukiGrant(req, env, url) {
  const cors = { ...siteCors(env, req), 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS' };
  const out = (obj, status) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!grantReady(env) || !env.DB) return out({ error: 'not_configured', error_description: '站方尚未開通機器人授權' }, 503);
  const auth = req.headers.get('authorization') || '';
  if (!BEARER_OK.test(auth)) return out({ error: 'invalid_token', error_description: '缺少授權' }, 401);
  let uid = '', body = null, refresh = '';
  if (req.method === 'POST' && url.pathname === '/haruki/grant') {
    if (Number(req.headers.get('content-length') || 0) > 16384) return out({ error: 'too_large' }, 413);
    try { body = await req.json(); } catch (e) { body = null; }
    if (!body || typeof body !== 'object') return out({ error: 'bad_json' }, 400);
    uid = String(body.uid == null ? '' : body.uid).trim();
    refresh = typeof body.refresh_token === 'string' ? body.refresh_token : '';
    if (!UID_OK.test(uid)) return out({ error: 'bad_uid', error_description: 'uid 要是 6～20 位數字' }, 400);
    if (!/^[\w\-.~+/=]{8,4096}$/.test(refresh)) return out({ error: 'bad_refresh_token' }, 400);
  } else if ((req.method === 'GET' || req.method === 'DELETE') && GRANT_UID.test(url.pathname)) {
    uid = GRANT_UID.exec(url.pathname)[1];
  } else {
    return out({ error: 'not_found' }, 404);
  }
  let own;
  try { own = await bindingOwns(env, auth, uid); }
  catch (e) { return out({ error: 'upstream', error_description: 'Haruki 工具箱連線失敗' }, 502); }
  if (!own.ok) {
    if (own.status === 403) return out({ error: 'uid_not_bound', error_description: '這個 Haruki 帳號沒有綁定（並驗證）台服 ' + uid }, 403);
    if (own.status === 401) return out({ error: 'invalid_token', error_description: 'Haruki 授權無效或已過期' }, 401);
    return out({ error: 'upstream', error_description: 'Haruki 工具箱暫時連不上' }, 502);
  }
  if (req.method === 'POST') {
    const access = typeof body.access_token === 'string' && /^[\w\-.~+/=]{8,4096}$/.test(body.access_token) ? body.access_token : '';
    const expIn = Math.floor(Number(body.expires_in));
    const nowS = Math.floor(Date.now() / 1000);
    const b = own.binding || {};
    const row = await grantUpsert(env.DB, {
      uid,
      harukiUser: b.harukiUserId != null ? b.harukiUserId : (b.ownerId != null ? b.ownerId : (b.accountId != null ? b.accountId : null)),
      refreshEnc: await grantEnc(env, refresh),
      accessEnc: access && expIn > 0 ? await grantEnc(env, access) : null,
      accessExp: access && expIn > 0 ? nowS + expIn : null,
      scope: typeof body.scope === 'string' ? body.scope.slice(0, 200) : null,
    });
    return out({ ok: true, uid, since: row.created_at }, 200);
  }
  const row = await grantGet(env.DB, uid);
  if (req.method === 'DELETE') {
    if (row) await grantRevoke(env.DB, uid);
    return out({ ok: true, uid }, 200);
  }
  const granted = !!(row && !row.revoked_at);
  return out({ granted, uid, since: granted ? row.created_at : null, last_used_at: granted ? row.last_used_at : null }, 200);
}

/* 用 refresh token 換新 access（client_secret_basic）。回 { ok, p } 或 { ok:false, invalid }（invalid = 對方說 invalid_grant，授權已失效） */
async function refreshGrant(env, refresh) {
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh });
  const headers = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': UA,
    authorization: 'Basic ' + btoa(encodeURIComponent(env.HARUKI_OAUTH_CLIENT_ID) + ':' + encodeURIComponent(env.HARUKI_OAUTH_CLIENT_SECRET)) };
  let r;
  try { r = await fetch(oauthBase(env) + '/api/oauth2/token', { method: 'POST', headers, body: form.toString(), signal: AbortSignal.timeout(20000) }); }
  catch (e) { return { ok: false, invalid: false }; }
  let p = null; try { p = await r.json(); } catch (e) { p = null; }
  if (r.ok && p && typeof p.access_token === 'string' && p.access_token) return { ok: true, p };
  return { ok: false, invalid: !!(p && p.error === 'invalid_grant') };
}

/* 機器人端：GET /api/bot/haruki/grant/{uid}、GET /api/bot/haruki/{suite|mysekai}/{uid}（X-Caibot-* 簽章，pathq 含 query） */
const BOT_OK = /^\/api\/bot\/haruki\/(grant|suite|mysekai)\/(\d{6,20})$/;
export async function handleHarukiBot(req, env, url) {
  const out = (obj, status, extra) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(extra || {}) } });
  if (req.method !== 'GET') return out({ error: 'method_not_allowed' }, 405);
  const m = BOT_OK.exec(url.pathname);
  if (!m) return out({ error: 'not_found' }, 404);
  const secret = cleanSecret(env && env.CAIBOT_BRIDGE_SECRET);
  if (!secret || !grantReady(env) || !env.DB) return out({ error: 'not_configured' }, 503);
  const buf = await req.arrayBuffer();
  const v = await bridgeVerify(secret, req, url.pathname + url.search, buf);
  if (!v.ok) return out({ error: 'bad_signature', why: v.why }, 401);
  if (v.ip !== 'bot' || v.ident !== '') return out({ error: 'bad_signature', why: 'bad_direction' }, 401);
  if (!(await useBridgeNonce(env.DB, v.nonce))) return out({ error: 'replay' }, 401);
  const type = m[1], uid = m[2];
  const row = await grantGet(env.DB, uid);
  if (!row) return out({ error: 'no_grant' }, 404);
  if (row.revoked_at) return out({ error: 'revoked' }, 404);
  if (type === 'grant') return out({ granted: true, uid, since: row.created_at, last_used_at: row.last_used_at, types: ['suite', 'mysekai'] }, 200);

  const cache = (typeof caches !== 'undefined' && caches.default) || null;
  const key = new Request('https://haruki.local/bot/' + type + '/' + uid, { method: 'GET' });
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }

  const nowS = Math.floor(Date.now() / 1000);
  let access = '', refreshed = false;
  if (row.access_enc && row.access_exp && row.access_exp - 30 > nowS) { try { access = await grantDec(env, row.access_enc); } catch (e) { access = ''; } }
  const renew = async () => {
    let refresh;
    try { refresh = await grantDec(env, row.refresh_enc); } catch (e) { return out({ error: 'decrypt_failed' }, 500); }
    const t = await refreshGrant(env, refresh);
    if (!t.ok) {
      if (t.invalid) { await grantRevoke(env.DB, uid); return out({ error: 'revoked' }, 404); }
      await grantFail(env.DB, uid);
      return out({ error: 'refresh_failed', error_description: 'Haruki 換 token 失敗' }, 502);
    }
    access = t.p.access_token; refreshed = true;
    const expIn = Math.floor(Number(t.p.expires_in));
    await grantTokens(env.DB, uid, { refreshEnc: typeof t.p.refresh_token === 'string' && t.p.refresh_token ? await grantEnc(env, t.p.refresh_token) : null,
      accessEnc: await grantEnc(env, access), accessExp: nowS + (expIn > 0 ? expIn : 600) });
    return null;
  };
  if (!access) { const bad = await renew(); if (bad) return bad; }
  const read = () => fetch(oauthBase(env) + '/api/oauth2/game-data/tw/' + type + '/' + uid, { headers: { authorization: 'Bearer ' + access, accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
  let up;
  try {
    up = await read();
    // 存起來的 access 被對方提前作廢：換一次再讀
    if (up.status === 401 && !refreshed) { const bad = await renew(); if (bad) return bad; up = await read(); }
  } catch (e) {
    await grantFail(env.DB, uid);
    return out({ error: 'upstream', error_description: 'Haruki 工具箱連線失敗' }, 502);
  }
  if (up.ok) await grantUsed(env.DB, uid);
  const h = new Headers({ 'content-type': up.headers.get('content-type') || 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff',
    'cache-control': up.ok ? 'private, max-age=60' : 'no-store' });
  const res = new Response(up.body, { status: up.status, headers: h });
  if (cache && up.ok) { try { await cache.put(key, res.clone()); } catch (e) {} }
  return res;
}

export async function handleHaruki(req, env, url) {
  if (url.pathname.startsWith('/haruki/oauth/')) return handleHarukiOAuth(req, env, url);
  if (url.pathname === '/haruki/grant' || url.pathname.startsWith('/haruki/grant/')) return handleHarukiGrant(req, env, url);
  if (url.pathname.startsWith('/api/bot/haruki/')) return handleHarukiBot(req, env, url);
  if (url.pathname.startsWith('/haruki/public/')) return handleHarukiPublic(req, env, url);
  if (/^\/haruki\/(metas|master)\//.test(url.pathname)) return handleHarukiRegistry(req, env, url);
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  // 日服：/haruki/jp/event/… 跟台服同一套路徑，只是活動期程讀日服 master、排名讀日服 tracker
  const jp = url.pathname.startsWith('/haruki/jp/event/');
  const server = jp ? 'jp' : 'tw';
  const m = PATH_OK.exec(jp ? '/haruki' + url.pathname.slice('/haruki/jp'.length) : url.pathname);
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
    if (m[1] === 'event/list') body = toEventList(await masterOf(server, env)('events.json'), Date.now());
    else if (m[3].startsWith('user/')) body = await harukiUser(env, m[2] === 'live' ? null : m[2], m[3].slice(5), server);
    else body = await harukiLive(env, m[3], m[2] === 'live' ? null : m[2], server);
  } catch (e) {
    return json({ error: 'upstream', message: String((e && e.message) || e).slice(0, 160) }, 502);
  }
  if (body && body.tracked === false) return json({ error: 'not_tracked', ...body }, 404, { 'cache-control': 'public, max-age=30' });
  // 個人紀錄追蹤器每 10～20 秒更新一次，快取短一點
  const res = json(body, 200, { 'cache-control': 'public, max-age=' + (String(m[3] || '').startsWith('user/') ? 15 : 30) });
  if (cache) { try { await cache.put(key, res.clone()); } catch (e) {} }
  return res;
}
