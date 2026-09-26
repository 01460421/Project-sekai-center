/* 網站的即時與歷史資料（跟排名頁同一套來源）：
     榜線／前百：HiSekai 直連 → 自家 Worker 代理（games.project-sekai-center.com/proxy/hisekai）→ 自家 Worker 的 Haruki 備援
     走勢：      網站每小時記的榜線快照 data/history/<期數>.json（project-sekai-center.com/data/history/）
     歷史榜線：  data/borders-db.js（good果汁的台服全榜線紀錄，網站每日重建）
   都是純 fetch，Node 與 Cloudflare Workers 通用；結果在記憶體快取一小段時間，別把來源打爆。
   測試用 useFetch() 換成假的 fetch。 */

export const HISEKAI = 'https://api.hisekai.org/tw';
export const GAMES_API = 'https://games.project-sekai-center.com';
export const SITE = 'https://project-sekai-center.com';

let _fetch = (...a) => globalThis.fetch(...a);
export function useFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); clearCache(); }
const cache = new Map();
export function clearCache() { cache.clear(); }
async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { value, exp: Date.now() + ttlMs });
  return value;
}

/* 19 位 userId 超過安全整數：parse 前把「"key": 16 位以上整數」轉成字串（與網站同一招） */
export const parseSafe = text => JSON.parse(String(text).replace(/("(?:[^"\\]|\\.)*")\s*:\s*(\d{16,})(?=\s*[,}\]])/g, '$1:"$2"'));

async function getText(url, timeoutMs = 8000) {
  const r = await _fetch(url, { headers: { accept: 'application/json, text/plain, */*', 'user-agent': 'sekai-center-bot/1.0 (+https://project-sekai-center.com)' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}
async function firstOk(urls, timeoutMs) {
  let err;
  for (const u of urls) { try { return parseSafe(await getText(u, timeoutMs)); } catch (e) { err = e; } }
  throw err || new Error('fetch failed');
}

const toMs = v => { if (v == null || v === '') return 0; if (typeof v === 'number') return v < 1e12 ? v * 1000 : v; const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; };
const eventOf = d => (d && (d.event || d.event_data)) || d || {};
const row = r => ({ rank: r.rank, score: Number(r.score) || 0, name: String(r.name || ''), userId: String(r.user_id || (r.last_player_info && r.last_player_info.profile && r.last_player_info.profile.id) || ''), speed: r.last_1h_stats && r.last_1h_stats.speed != null ? Number(r.last_1h_stats.speed) : null, cardId: r.last_player_info && r.last_player_info.card ? r.last_player_info.card.id : null });

/* kind = 'top100' | 'border' → { event:{id,name,start,end}, rows, wl:[{chapter,character,start,end,rows}], partial, source } */
export function normalizeLive(kind, d) {
  const ev = eventOf(d);
  const key = kind === 'top100' ? 'player_top_100_rankings' : 'player_border_rankings';
  const rowsOf = o => ((o && (o[key] || o.player_rankings || o.player_borders)) || []).map(row).filter(r => r.rank);
  const wl = ((d && (kind === 'top100' ? d.world_link_top_100_rankings : d.world_link_border_rankings)) || []).map(c => ({ chapter: c.chapter, character: c.character || c.game_character_id || null, start: toMs(c.start_at), end: toMs(c.aggregate_at || c.ranking_announce_at || c.closed_at), rows: rowsOf(c) })).filter(c => c.rows.length);
  return {
    event: { id: ev.id != null ? Number(ev.id) : null, name: String(ev.name || ''), start: toMs(ev.start_at || ev.startAt), end: toMs(ev.aggregate_at || ev.aggregateAt || ev.closed_at) },
    rows: rowsOf(d), wl, partial: !!(d && d.partial), source: (d && d.source) || 'hisekai',
  };
}
export function fetchLive(kind) {
  const path = `/event/live/${kind}`;
  return cached(`live:${kind}`, 60e3, async () => normalizeLive(kind, await firstOk([HISEKAI + path, `${GAMES_API}/proxy/hisekai${path}`, `${GAMES_API}/haruki${path}`])));
}

/* 榜線快照：samples[i] = [秒, T100, T200, …]（對齊 tiers），top1[i] = [秒, 分數]，wl[章] = { tiers, samples } */
export const fetchHistoryIndex = () => cached('hist:index', 5 * 60e3, async () => parseSafe(await getText(`${SITE}/data/history/index.json`)));
export const fetchHistory = id => cached(`hist:${id}`, 5 * 60e3, async () => parseSafe(await getText(`${SITE}/data/history/${Number(id)}.json`)));
/* 最新一筆與約 hoursAgo 小時前那一筆，各段位的差 */
export function trend(h, hoursAgo = 1) {
  const s = (h && h.samples) || []; if (!s.length) return null;
  const last = s[s.length - 1]; const target = last[0] - hoursAgo * 3600;
  let prev = null; for (const x of s) { if (x[0] <= target) prev = x; else break; }
  const tiers = (h.tiers || []);
  const lines = tiers.map((t, i) => ({ tier: t, score: last[i + 1] ?? null, delta: prev && last[i + 1] != null && prev[i + 1] != null ? last[i + 1] - prev[i + 1] : null }));
  return { at: last[0] * 1000, prevAt: prev ? prev[0] * 1000 : null, lines, top1: (h.top1 || []).length ? h.top1[h.top1.length - 1][1] : null };
}

/* 歷史最終榜線（good果汁表）：{ events, borders:[{id,name,chara,unit,days,type,t[]}], tiers, wl:[{id:'112.1',name,round,bonus,t[]}], wlTiers } */
export const fetchBordersDb = () => cached('borders-db', 6 * 3600e3, async () => {
  const text = await getText(`${SITE}/data/borders-db.js`, 15000);
  const i = text.indexOf('{'); const j = text.lastIndexOf('}');
  if (i < 0 || j < 0) throw new Error('borders-db 格式非預期');
  return JSON.parse(text.slice(i, j + 1));
});
