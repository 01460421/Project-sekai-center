/**
 * 偵測引擎：cron 每次呼叫就掃一遍所有啟用中的 watch，達成條件就寫進 events 表；
 * 真正寄信是 mail 模組的事，這裡只負責「判斷」與「留下紀錄」。
 *
 * 為什麼所有 watch 共用同一份快照：
 *   幾百條訂閱各自去打 HiSekai 等於對人家 DDoS。一輪最多四個外部請求
 *   （top100 / border / 活動清單 / 卡池排程），而且只有真的有人訂那一類才會抓。
 *
 * 為什麼幾乎每種判斷都要 last_state：
 *   「榜線破 300 萬」「他開始跑了」這種條件一旦成立就會一直成立，
 *   沒有上一輪的狀態就會每分鐘重寄一次。所以判斷的是「邊緣」而不是「準位」，
 *   而且沒觸發的那幾輪也要把狀態寫回去，否則下一輪拿到的基準是好幾天前的。
 *
 * 冷卻期內怎麼處理：
 *   通知不寄，而且「狀態刻意不更新」。狀態一更新這個邊緣就永遠消失了，
 *   保留舊狀態的話冷卻一過會用當下的數值重新判一次，補送一則而不是靜靜漏掉；
 *   條件如果已經自己恢復（例如人又停跑了），那就是過期新聞，本來就不該寄。
 */

import { activeWatches, markFired, markState, addEvent, now } from './db.js';

const API = 'https://api.hisekai.org/tw';
/* 卡池排程的正本在 repo 的 js/core.js 裡，但 Worker 讀不到檔案系統；
   主站把同一份資料抽成這支 ES module 靜態檔，這是唯一公開拿得到的來源。 */
const GACHA_URL = 'https://project-sekai-center.com/data/sekai-data.js';
const UA = 'project-sekai-center/1.0 (+https://project-sekai-center.com) watch-engine';

/* 榜線一分鐘內重複抓沒有意義（來源本身也不是即時的），排程類的資料一小時內都不會變。
   走 Cloudflare 快取而不是自己記在記憶體裡，因為 Worker isolate 隨時會被回收。 */
const LIVE_TTL = 60;
const DATA_TTL = 3600;

const SEC_H = 3600;
const TW_OFF = 8 * SEC_H;      // 台服的一切都用 UTC+8 讀
/* 台服的日界線在 15:00（活動的 start_at 一律是 07:00Z，closed_at 一律是 06:59:59Z），
   而卡池排程只有日期沒有時間，所以統一用當日 07:00Z 換算。 */
const GACHA_HOUR_UTC = 7;

/* 一輪最多送幾則。提前很久（例如 before_h=720）會讓一大票目標同時落進窗口，
   一次灌十幾封信給同一個人不如分幾輪慢慢送——沒送到的不寫進 notified，下一輪還會再來。 */
const MAX_SCHEDULE_FIRES = 5;

const BORDER_TIERS = [100, 200, 300, 400, 500, 1000, 1500, 2000, 2500, 3000,
  4000, 5000, 10000, 20000, 30000, 40000, 50000, 100000];
const WL_TIERS = [100, 200, 300, 400, 500, 1000, 2000, 3000, 4000, 5000, 7000, 10000, 20000];

const CHARA = {
  1: '星乃一歌', 2: '天馬咲希', 3: '望月穗波', 4: '日野森志步', 5: '花里實乃理',
  6: '桐谷遙', 7: '桃井愛莉', 8: '日野森雫', 9: '小豆澤心羽', 10: '白石杏',
  11: '東雲彰人', 12: '青柳冬彌', 13: '天馬司', 14: '鳳笑夢', 15: '草薙寧寧',
  16: '神代類', 17: '宵崎奏', 18: '朝比奈真冬', 19: '東雲繪名', 20: '曉山瑞希',
  21: '初音未來', 22: '鏡音鈴', 23: '鏡音連', 24: '巡音流歌', 25: 'MEIKO', 26: 'KAITO',
};

/* ---------- 取資料 ---------- */

/** 19 位 uid 超過 IEEE754 安全整數，JSON.parse 前先把它們轉成字串（站上踩過的老雷）。 */
function parseSafe(text) {
  return JSON.parse(text.replace(/([[:,]\s*)(\d{16,})/g, '$1"$2"'));
}

async function apiJSON(path, ttl) {
  const r = await fetch(API + path, {
    headers: { 'user-agent': UA, 'accept-encoding': 'br, gzip' },
    // JSON 不在 Cloudflare 預設會快取的型別裡，要 cacheEverything 才吃得到 cacheTtl
    cf: { cacheTtl: ttl, cacheEverything: true },
  });
  if (!r.ok) throw new Error(`HiSekai ${path} 回 HTTP ${r.status}`);
  return parseSafe(await r.text());
}

/** 卡池排程：抓主站的靜態 JS，用正則把 GACHAS 陣列挖出來（後面還接著 DOLLS，要非貪婪）。 */
async function fetchGachas() {
  const r = await fetch(GACHA_URL, {
    headers: { 'user-agent': UA },
    cf: { cacheTtl: DATA_TTL, cacheEverything: true },
  });
  if (!r.ok) throw new Error(`卡池排程 ${GACHA_URL} 回 HTTP ${r.status}`);
  const m = /export const GACHAS\s*=\s*(\[[\s\S]*?\]);/.exec(await r.text());
  if (!m) throw new Error('卡池排程格式變了，找不到 GACHAS 陣列');
  return JSON.parse(m[1]);
}

/** 一輪之內每種資料只抓一次，而且要有人訂才抓。 */
function snapshot() {
  const memo = new Map();
  const once = (k, fn) => {
    if (!memo.has(k)) {
      const p = fn();
      // 只是把 unhandled rejection 的警告壓掉，錯誤本身仍然留給 await 的人接
      p.catch(() => {});
      memo.set(k, p);
    }
    return memo.get(k);
  };
  return {
    live: () => once('live', () => apiJSON('/event/live/top100', LIVE_TTL)),
    border: () => once('border', () => apiJSON('/event/live/border', LIVE_TTL)),
    events: () => once('events', () => apiJSON('/event/list', DATA_TTL)),
    gachas: () => once('gachas', fetchGachas),
  };
}

/* ---------- 小工具 ---------- */

function iso2sec(s) {
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** 'YYYY/MM/DD' → 該日台服日界線（15:00 台灣時間）的秒級時間戳。 */
function daySec(d, hourUtc) {
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(String(d || '').trim());
  if (!m) return null;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], hourUtc, 0, 0) / 1000);
}

/** 用 UTC 方法讀「加了 8 小時的時間」，就不必依賴 runtime 的時區設定。 */
function fmtTW(sec) {
  if (sec == null) return '—';
  const d = new Date((sec + TW_OFF) * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ` +
         `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function fmtNum(n) {
  if (n == null || !Number.isFinite(+n)) return '—';
  return String(Math.round(+n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtSigned(n) {
  return (n > 0 ? '+' : '') + fmtNum(n);
}

function fmtDur(s) {
  s = Math.max(0, Math.round(s || 0));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d} 天 ${h} 小時`;
  if (h) return `${h} 小時 ${m} 分`;
  return `${m} 分`;
}

/** GACHAS 有一部分項目的 id 是空字串（聯動贈品池之類），
    拿 id 當去重鍵會讓它們全部撞成同一個 key，只好用內容雜湊。 */
function keyHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const uidOf = (r) => String(r?.last_player_info?.profile?.id ?? '');
const findUid = (rows, uid) => (rows || []).find((r) => uidOf(r) === String(uid)) || null;

/** WL 章節之間有十分鐘的結算空窗，落在空窗就沿用剛結束的那一章，不要回 null。 */
function currentChapter(list, t) {
  let cur = null;
  for (const c of (list || []).slice().sort((a, b) => (iso2sec(a.start_at) || 0) - (iso2sec(b.start_at) || 0))) {
    const s = iso2sec(c.start_at);
    if (s != null && s <= t) cur = c;
  }
  return cur;
}

/** 換期或換章就不能拿舊基準比對（上一期的 T1 對這一期的 T50 不是「掉了 49 名」）。 */
const sameScope = (st, scope) => (st && st.scope === scope ? st : null);

/** 前百的人才拿得到精確分數；掉出前百之後只剩「剛好卡在某條榜線上」這一種可能被看見。 */
async function resolveScore(snap, uid, board, t) {
  const live = await snap.live();
  const b = boardRows(live, board, t, 'live');
  const hit = b && findUid(b.rows, uid);
  if (hit) return { score: hit.score, rank: hit.rank, top100: true, from: `${b.label}前 100 名` };
  const bd = await snap.border();
  const bb = boardRows(bd, board, t, 'border');
  const on = bb && findUid(bb.rows, uid);
  if (on) return { score: on.score, rank: on.rank, top100: false, from: `${bb.label}榜線 T${on.rank}` };
  return null;
}

/** 把「活動榜 / 世界連結當前章節」這兩種榜的取列方式收在一處。 */
function boardRows(data, board, t, which) {
  if (board === 'world_link') {
    const list = which === 'live' ? data.world_link_top_100_rankings : data.world_link_border_rankings;
    const ch = currentChapter(list, t);
    if (!ch) return null;
    /* 2026-09 HiSekai 把章節物件的欄位改名：player_rankings → player_top_100_rankings、
       player_borders → player_border_rankings、closed_at → ranking_announce_at。
       新名在前、舊名保留當後備，兩種版本的回應都吃得下。 */
    const rows = which === 'live'
      ? (ch.player_top_100_rankings || ch.player_rankings)
      : (ch.player_border_rankings || ch.player_borders);
    const who = CHARA[ch.character] ? `／${CHARA[ch.character]}` : '';
    return { rows: rows || [], label: `世界連結第 ${ch.chapter} 章${who}`, chapter: ch.chapter, meta: ch };
  }
  const rows = which === 'live' ? data.player_top_100_rankings : data.player_border_rankings;
  return { rows: rows || [], label: '活動榜', chapter: 0, meta: null };
}

const evLabel = (d) => `${d.name}（第 ${d.id} 期）`;

/* ---------- 給前端渲染表單用的規格 ---------- */

export const WATCH_KINDS = {
  border: {
    label: '榜線',
    desc: '當期活動的分段榜線（T100 ~ T100000）。',
    available: true,
    source: 'HiSekai /event/live/border',
    mode_key: 'mode',
    default_cooldown_s: 1800,
    common_fields: [
      { key: 'board', label: '榜別', type: 'select', default: 'event', options: [
        { value: 'event', label: '活動榜' },
        { value: 'world_link', label: '世界連結（自動跟著當前章節）' },
      ] },
      { key: 'tier', label: '段位', type: 'select', default: 1000, required: true,
        options: BORDER_TIERS.map((n) => ({ value: n, label: `T${n}` })),
        hint: `世界連結榜只有 ${WL_TIERS.map((n) => 'T' + n).join('、')}，選了不存在的段位這條訂閱會判定失敗。` },
    ],
    modes: {
      tier_score: {
        label: '榜線分數到達門檻',
        fields: [
          { key: 'op', label: '條件', type: 'select', default: 'gte', required: true, options: [
            { value: 'gte', label: '大於等於' },
            { value: 'lte', label: '小於等於' },
          ] },
          { key: 'value', label: '分數', type: 'number', min: 0, step: 100000, required: true },
        ],
        example: { board: 'event', tier: 1000, op: 'gte', value: 3000000 },
        note: '建立後第一次觀測就已經達成的話會立刻通知一次；之後只在「由未達成轉為達成」時再通知。',
      },
      my_rank_out: {
        label: '我掉出這個段位',
        fields: [{ key: 'uid', label: '你的遊戲 uid', type: 'text', required: true }],
        example: { board: 'event', tier: 500, mode: 'my_rank_out', uid: '7101286516974017282' },
        note: '限制：公開 API 只查得到前 100 名的分數，以及剛好站在某條榜線上的那一個人。' +
              '你的 uid 不在這兩種情況裡時無法判斷，這條訂閱會靜靜地跳過（統計裡算 unresolved）。' +
              '唯一的例外是 T100 以內：本來在前百、這次不見了，就確定是掉出去了。',
      },
      my_rank_in: {
        label: '我擠進這個段位',
        fields: [{ key: 'uid', label: '你的遊戲 uid', type: 'text', required: true }],
        example: { board: 'event', tier: 500, mode: 'my_rank_in', uid: '7101286516974017282' },
        note: '限制同上。',
      },
    },
  },

  player: {
    label: '玩家動態',
    desc: '盯住某個玩家的名次、分數與開跑／停跑。',
    available: true,
    source: 'HiSekai /event/live/top100',
    mode_key: 'mode',
    default_cooldown_s: 900,
    limits: '只看得到當期前 100 名（世界連結榜是該章節前 100 名）。對象不在榜上時無法判斷，' +
            '不會亂猜；但「本來在榜上、這一輪不見了」會當成掉出前百通知。',
    common_fields: [
      { key: 'board', label: '榜別', type: 'select', default: 'event', options: [
        { value: 'event', label: '活動榜' },
        { value: 'world_link', label: '世界連結（自動跟著當前章節）' },
      ] },
      { key: 'uid', label: '對象的遊戲 uid', type: 'text', required: true },
    ],
    modes: {
      rank_change: {
        label: '名次變動',
        fields: [{ key: 'threshold', label: '變動幾名才通知', type: 'number', min: 1, default: 3 }],
        example: { uid: '7101286516974017282', mode: 'rank_change', threshold: 3 },
      },
      started: {
        label: '開始跑了',
        fields: [{ key: 'idle_min', label: '幾分鐘沒出分算停跑', type: 'number', min: 1, default: 15,
          hint: '一場協力大約 150 秒，設太短會被換房、選曲的空檔誤判。' }],
        example: { uid: '7101286516974017282', mode: 'started', idle_min: 15 },
      },
      stopped: {
        label: '停跑了',
        fields: [{ key: 'idle_min', label: '幾分鐘沒出分算停跑', type: 'number', min: 1, default: 15 }],
        example: { uid: '7101286516974017282', mode: 'stopped', idle_min: 15 },
      },
      passed_me: {
        label: '對方超過我',
        fields: [{ key: 'my_uid', label: '你的遊戲 uid', type: 'text', required: true }],
        example: { uid: '7101286516974017282', mode: 'passed_me', my_uid: '7276954891191540482' },
        note: '兩個人的分數都要查得到才能比；查不到就跳過不通知。',
      },
    },
  },

  team: {
    label: '車隊房間',
    desc: '車隊開房、缺人、房號變動之類的提醒。',
    available: false,
    /* 沒有資料源就不要假裝有。站上只有公開榜單，房況只有車隊自己的 bot 知道。 */
    unavailable_reason:
      '站上目前沒有任何車隊／房間的資料源：HiSekai 只公開榜單，房號與成員狀態不會出現在任何公開 API。' +
      '要能偵測必須先接使用者自己的 Discord bot（由 bot 主動把房況回報進來），還沒接上之前這一類不會有結果。',
    blocked_on: '使用者自架 Discord bot 的回報端點；使用者身分靠 users.discord_id 對應。',
    mode_key: 'mode',
    default_cooldown_s: 600,
    common_fields: [
      { key: 'guild_id', label: 'Discord 伺服器 id', type: 'text', required: true },
      { key: 'channel_id', label: '車隊頻道 id', type: 'text' },
    ],
    modes: {
      room_open: { label: '車隊開房', fields: [], example: { mode: 'room_open', guild_id: '' } },
      room_need: { label: '車隊缺人', fields: [
        { key: 'seats', label: '剩幾個位子就通知', type: 'number', min: 1, default: 1 },
      ], example: { mode: 'room_need', guild_id: '', seats: 1 } },
      room_close: { label: '車隊收工', fields: [], example: { mode: 'room_close', guild_id: '' } },
    },
  },

  schedule: {
    label: '活動與卡池排程',
    desc: '活動開始／結算、卡池開放／結束、世界連結章節切換，提前多久通知。',
    available: true,
    source: 'HiSekai /event/list ＋ 主站 /data/sekai-data.js 的 GACHAS',
    mode_key: 'what',
    default_cooldown_s: 300,
    common_fields: [
      { key: 'before_h', label: '提前幾小時通知', type: 'number', min: 0.5, step: 0.5, default: 24, required: true },
    ],
    modes: {
      event_start: { label: '活動開始', fields: [], example: { what: 'event_start', before_h: 24 } },
      event_end: {
        label: '活動結算',
        fields: [{ key: 'end_kind', label: '哪一個時間點', type: 'select', default: 'aggregate', options: [
          { value: 'aggregate', label: '榜線結算（aggregate_at）' },
          { value: 'closed', label: '活動關閉（closed_at）' },
        ] }],
        example: { what: 'event_end', before_h: 24, end_kind: 'aggregate' },
      },
      gacha_start: {
        label: '卡池開放',
        fields: [{ key: 'filter', label: '只看名稱／類型含有', type: 'text',
          hint: '例如填「限定」只提醒限定池；留空就是全部。' }],
        example: { what: 'gacha_start', before_h: 24, filter: '限定' },
        note: '卡池排程只有日期沒有時間，一律以當日 15:00（台灣時間）換算，實際切換以遊戲內公告為準。',
      },
      gacha_end: {
        label: '卡池結束',
        fields: [{ key: 'filter', label: '只看名稱／類型含有', type: 'text' }],
        example: { what: 'gacha_end', before_h: 24 },
        note: '同上，日期精度。',
      },
      wl_chapter: {
        label: '世界連結章節切換',
        fields: [{ key: 'edge', label: '哪一端', type: 'select', default: 'start', options: [
          { value: 'start', label: '章節開始' },
          { value: 'end', label: '章節結算' },
        ] }],
        example: { what: 'wl_chapter', before_h: 6, edge: 'start' },
      },
    },
    note: '同一條訂閱在同一個目標上只會通知一次（狀態裡記著已通知過的目標），' +
          `所以窗口開很長也不會被重複打擾；一輪最多送 ${MAX_SCHEDULE_FIRES} 則，剩下的下一輪再送。`,
  },
};

/* ---------- 各種偵測 ---------- */
/* 慣例：回傳 { fires: [{title, body}], state, unresolved }。
   state 一定要回（就算沒觸發），不回等於把基準留在上一次，下一輪比對就失真。 */

async function detectBorder(w, p, st, snap, t) {
  const bd = await snap.border();
  const board = p.board === 'world_link' ? 'world_link' : 'event';
  const b = boardRows(bd, board, t, 'border');
  if (!b) return { state: st, note: '目前不是世界連結活動' };

  const tier = Number(p.tier);
  const row = b.rows.find((r) => Number(r.rank) === tier);
  if (!row) throw new Error(`${b.label}沒有 T${tier} 這一段榜線`);

  const scope = `${bd.id}:${b.chapter}`;
  const base = sameScope(st, scope);
  const head = `活動：${evLabel(bd)}\n榜別：${b.label}\n段位：T${tier}`;
  const mode = p.mode || 'tier_score';

  if (mode === 'tier_score') {
    const op = p.op === 'lte' ? 'lte' : 'gte';
    const value = Number(p.value);
    if (!Number.isFinite(value)) throw new Error('門檻 value 不是數字');
    const hit = op === 'lte' ? row.score <= value : row.score >= value;
    const state = { scope, tier, score: row.score, hit };
    const fires = [];
    // 只在「上一輪還沒達成」時通知；第一次觀測（base 為 null）就已達成也算一次
    if (hit && !(base && base.hit)) {
      fires.push({
        title: `T${tier} 榜線${op === 'gte' ? '突破' : '跌破'} ${fmtNum(value)}`,
        body: `${head}\n目前分數：${fmtNum(row.score)}\n` +
              `設定門檻：${op === 'gte' ? '≥' : '≤'} ${fmtNum(value)}\n` +
              `上次觀測：${base ? fmtNum(base.score) : '（建立後第一次觀測）'}\n` +
              `觀測時間：${fmtTW(t)}（台灣時間）`,
      });
    }
    return { fires, state };
  }

  if (mode !== 'my_rank_out' && mode !== 'my_rank_in') throw new Error(`border 不支援 mode=${mode}`);

  const uid = String(p.uid || '').trim();
  if (!uid) throw new Error('缺少 uid');
  const my = await resolveScore(snap, uid, board, t);
  const inside = my ? my.score >= row.score : null;
  const state = {
    scope, tier, border: row.score,
    score: my ? my.score : (base ? base.score : null),
    inside: inside != null ? inside : (base ? base.inside : null),
    found: !!my, top100: my ? my.top100 : (base ? base.top100 : false),
  };

  if (!my) {
    // 前百的人這一輪整個消失 = 掉出 T100；其他段位沒有分數就是真的沒辦法判斷
    if (mode === 'my_rank_out' && base && base.inside === true && base.top100 && tier <= 100) {
      state.inside = false;
      return {
        state,
        fires: [{
          title: `你已掉出 T${tier}`,
          body: `${head}\n你（uid ${uid}）上一輪還在前 100 名（T${base.rank ?? '?'}、` +
                `${fmtNum(base.score)} 分），這一輪已經不在榜上。\n` +
                `目前 T${tier} 榜線：${fmtNum(row.score)}\n觀測時間：${fmtTW(t)}（台灣時間）`,
        }],
      };
    }
    return { state, unresolved: true };
  }

  state.rank = my.rank;
  const want = mode === 'my_rank_in';
  const fires = [];
  if (base && base.inside === !want && inside === want) {
    const gap = Math.abs(my.score - row.score);
    fires.push({
      title: want ? `你擠進 T${tier} 了` : `你已掉出 T${tier}`,
      body: `${head}\n你的分數：${fmtNum(my.score)}（來源：${my.from}）\n` +
            `T${tier} 榜線：${fmtNum(row.score)}\n` +
            `${want ? '超出' : '落後'}：${fmtNum(gap)}\n觀測時間：${fmtTW(t)}（台灣時間）`,
    });
  }
  return { fires, state };
}

async function detectPlayer(w, p, st, snap, t) {
  const uid = String(p.uid || '').trim();
  if (!uid) throw new Error('缺少 uid');
  const live = await snap.live();
  const board = p.board === 'world_link' ? 'world_link' : 'event';
  const b = boardRows(live, board, t, 'live');
  if (!b) return { state: st, note: '目前不是世界連結活動' };

  const scope = `${live.id}:${b.chapter}`;
  const base = sameScope(st, scope);
  const row = findUid(b.rows, uid);
  const idleS = Math.max(60, (Number(p.idle_min) || 15) * 60);
  const played = row ? iso2sec(row.last_played_at) : null;
  const playing = !!(row && played != null && t - played <= idleS);
  const name = row ? (row.name || uid) : (base ? base.name : uid);

  const state = {
    scope, name, present: !!row, playing,
    rank: row ? row.rank : (base ? base.rank : null),
    score: row ? row.score : (base ? base.score : null),
    played: played != null ? played : (base ? base.played : null),
    run_at: base ? base.run_at : null,
    run_score: base ? base.run_score : null,
    ahead: base ? base.ahead : null,
  };
  // 由停轉跑的那一刻記下起點，停跑時才有東西可以結算這一輪跑了多少
  if (playing && !(base && base.playing)) {
    state.run_at = played != null ? played : t;
    state.run_score = row ? row.score : null;
  }

  const head = `活動：${evLabel(live)}\n榜別：${b.label}\n玩家：${name}（uid ${uid}）`;
  const mode = p.mode || 'rank_change';
  if (!base) return { state };                    // 沒有基準，這一輪只記錄

  if (base.present && !row) {
    // 從榜上消失：對名次類的偵測而言這就是「掉出前 100」，其他 mode 沒東西可比
    if (mode === 'rank_change') {
      return {
        state,
        fires: [{
          title: `${name} 掉出前 100 名`,
          body: `${head}\n上一輪：T${base.rank}、${fmtNum(base.score)} 分\n` +
                `這一輪已經不在${b.label}前 100 名內。\n觀測時間：${fmtTW(t)}（台灣時間）`,
        }],
      };
    }
    return { state, unresolved: true };
  }
  if (!row) return { state, unresolved: true };

  const fires = [];
  if (mode === 'rank_change') {
    const th = Math.max(1, Number(p.threshold) || 3);
    const d = base.rank - row.rank;              // 正數 = 名次前進
    if (Math.abs(d) >= th) {
      fires.push({
        title: `${name} 名次${d > 0 ? '上升' : '下降'} ${Math.abs(d)} 名（現在 T${row.rank}）`,
        body: `${head}\n名次：T${base.rank} → T${row.rank}（${fmtSigned(d)}）\n` +
              `分數：${fmtNum(base.score)} → ${fmtNum(row.score)}（${fmtSigned(row.score - base.score)}）\n` +
              `最後一局：${fmtTW(played)}\n觀測時間：${fmtTW(t)}（台灣時間）`,
      });
    }
  } else if (mode === 'started') {
    if (playing && !base.playing) {
      const idleFor = base.played != null ? t - base.played : null;
      fires.push({
        title: `${name} 開始跑了（T${row.rank}）`,
        body: `${head}\n最後一局：${fmtTW(played)}（距今 ${fmtDur(t - played)}）\n` +
              `目前分數：${fmtNum(row.score)}\n` +
              (idleFor != null ? `這之前停了 ${fmtDur(idleFor)}\n` : '') +
              `觀測時間：${fmtTW(t)}（台灣時間）`,
      });
    }
  } else if (mode === 'stopped') {
    if (!playing && base.playing) {
      const from = base.run_at, gained = base.run_score != null ? row.score - base.run_score : null;
      fires.push({
        title: `${name} 已停跑超過 ${Math.round(idleS / 60)} 分鐘`,
        body: `${head}\n最後一局：${fmtTW(played)}（距今 ${fmtDur(t - (played != null ? played : t))}）\n` +
              `目前分數：${fmtNum(row.score)}（T${row.rank}）\n` +
              (from != null ? `這一輪從 ${fmtTW(from)} 開始，共 ${fmtDur((played != null ? played : t) - from)}` +
                (gained != null ? `、${fmtSigned(gained)} 分\n` : '\n') : '') +
              `觀測時間：${fmtTW(t)}（台灣時間）`,
      });
    }
  } else if (mode === 'passed_me') {
    const myUid = String(p.my_uid || '').trim();
    if (!myUid) throw new Error('缺少 my_uid');
    const me = await resolveScore(snap, myUid, board, t);
    if (!me) {
      state.ahead = base.ahead;
      return { state, unresolved: true };
    }
    const ahead = row.score > me.score;
    state.ahead = ahead;
    state.my_score = me.score;
    if (base.ahead === false && ahead === true) {
      fires.push({
        title: `${name} 超過你了`,
        body: `${head}\n對方分數：${fmtNum(row.score)}（T${row.rank}）\n` +
              `你的分數：${fmtNum(me.score)}（來源：${me.from}）\n` +
              `差距：${fmtNum(row.score - me.score)}\n觀測時間：${fmtTW(t)}（台灣時間）`,
      });
    }
  } else {
    throw new Error(`player 不支援 mode=${mode}`);
  }
  return { fires, state };
}

/** 車隊：資料源還沒接上，明講而不是硬湊。 */
async function detectTeam() {
  return { state: undefined, unavailable: WATCH_KINDS.team.unavailable_reason };
}

/** 把 what 換算成一串「未來的時間點」，之後統一用同一套窗口邏輯比對。 */
async function scheduleTargets(what, p, snap, t) {
  const out = [];
  if (what === 'gacha_start' || what === 'gacha_end') {
    const hour = Number.isFinite(+p.at_utc_hour) ? +p.at_utc_hour : GACHA_HOUR_UTC;
    const kw = String(p.filter || '').trim();
    for (const g of await snap.gachas()) {
      if (kw && !`${g.n || ''} ${g.t || ''} ${g.note || ''} ${g.ch || ''}`.includes(kw)) continue;
      const at = daySec(what === 'gacha_start' ? g.s : g.e, hour);
      if (at == null) continue;
      out.push({
        key: `gacha:${keyHash(`${g.id}|${g.n}|${g.s}|${g.e}`)}:${what}`, at, name: g.n || `卡池 ${g.id}`,
        extra: `類型：${g.t || '—'}` + (g.ch ? `\nUP 角色：${g.ch}` : '') + (g.note ? `\n備註：${g.note}` : '') +
               '\n（卡池排程只有日期精度，這裡以當日 15:00 換算，實際切換以遊戲內公告為準）',
      });
    }
    return out;
  }

  const evs = await snap.events();
  for (const e of evs) {
    if (what === 'event_start') {
      const at = iso2sec(e.start_at);
      if (at != null) out.push({ key: `ev:${e.id}:start`, at, name: evLabel(e), extra: `結算：${fmtTW(iso2sec(e.aggregate_at))}` });
    } else if (what === 'event_end') {
      const useClosed = p.end_kind === 'closed';
      const at = iso2sec(useClosed ? e.closed_at : e.aggregate_at);
      if (at != null) {
        out.push({
          key: `ev:${e.id}:${useClosed ? 'closed' : 'aggregate'}`, at, name: evLabel(e),
          extra: `開始：${fmtTW(iso2sec(e.start_at))}\n` +
                 `${useClosed ? '榜線結算' : '活動關閉'}：${fmtTW(iso2sec(useClosed ? e.aggregate_at : e.closed_at))}`,
        });
      }
    } else if (what === 'wl_chapter') {
      const end = p.edge === 'end';
      for (const c of e.chapters || []) {
        const at = iso2sec(end ? c.aggregate_at : c.start_at);
        if (at == null) continue;
        const who = CHARA[c.character] ? `／${CHARA[c.character]}` : '';
        out.push({
          key: `wl:${c.id}:${end ? 'end' : 'start'}`, at,
          name: `${evLabel(e)} 第 ${c.chapter} 章${who}`,
          extra: `章節區間：${fmtTW(iso2sec(c.start_at))} ~ ${fmtTW(iso2sec(c.aggregate_at))}`,
        });
      }
    } else {
      throw new Error(`schedule 不支援 what=${what}`);
    }
  }
  return out;
}

const SCHED_LABEL = {
  event_start: '活動開始', event_end: '活動結算', gacha_start: '卡池開放',
  gacha_end: '卡池結束', wl_chapter: '世界連結章節',
};

async function detectSchedule(w, p, st, snap, t) {
  const what = p.what || 'event_start';
  let label = SCHED_LABEL[what];
  if (!label) throw new Error(`schedule 不支援 what=${what}`);
  if (what === 'event_end' && p.end_kind === 'closed') label = '活動關閉';
  if (what === 'wl_chapter' && p.edge === 'end') label = '世界連結章節結算';

  /* before_h 也要有上限。設成一年的話,未來所有卡池都會同時落進視窗
     (光是 GACHAS 就有 140+ 筆未來排程),一輪吐幾十封信,共用的寄信額度撐不住。
     30 天已經遠超過「提前提醒」的實際需求。 */
  const beforeS = Math.min(720, Math.max(0.1, Number(p.before_h) || 24)) * SEC_H;
  const targets = await scheduleTargets(what, p, snap, t);
  const future = targets.filter((x) => x.at > t).sort((a, b) => a.at - b.at);

  /* 已通知清單存 {k, at},淘汰依據是「這個目標的時間過了沒」而不是筆數。
     原本用 slice(-40) 只留最後 40 筆,一旦視窗內的目標超過 40 個,較早的 key
     會被擠出清單,下一輪就當成沒通知過而再次觸發 —— 永遠收斂不了,
     單一訂閱就能把全站共用的寄信額度燒光。 */
  const notifiedMap = new Map();
  (Array.isArray(st?.notified) ? st.notified : []).forEach((x) => {
    if (typeof x === 'string') notifiedMap.set(x, t + beforeS);   // 舊格式:給一個保守的到期時間
    else if (x && x.k) notifiedMap.set(x.k, Number(x.at) || 0);
  });

  const fires = [];
  const hit = [];
  for (const x of future) {
    if (x.at - t > beforeS) break;               // 已排序，後面的只會更遠
    if (notifiedMap.has(x.key)) continue;
    if (fires.length >= MAX_SCHEDULE_FIRES) break;
    hit.push(x);
    fires.push({
      title: `${label}：${x.name}（還有 ${fmtDur(x.at - t)}）`,
      body: `${label}：${x.name}\n時間：${fmtTW(x.at)}（台灣時間）\n距離現在：${fmtDur(x.at - t)}\n` +
            (x.extra ? `${x.extra}\n` : '') +
            `提醒設定：提前 ${Math.round((beforeS / SEC_H) * 10) / 10} 小時\n觀測時間：${fmtTW(t)}（台灣時間）`,
    });
  }

  hit.forEach((x) => notifiedMap.set(x.key, x.at));
  const next = future[0] || null;
  /* 目標時間過了三天才清掉：留一點餘裕,免得剛過期就被清、又被同一輪的其他判斷
     重新撿回來。上限 500 純粹是防呆,正常情況下遠遠用不到。 */
  const keep = [...notifiedMap.entries()]
    .filter(([, at]) => at > t - 3 * 86400)
    .map(([k, at]) => ({ k, at }))
    .slice(-500);
  const state = {
    notified: keep,
    next: next ? { key: next.key, at: next.at, name: next.name } : null,
  };
  return { fires, state };
}

const DETECT = {
  border: detectBorder,
  player: detectPlayer,
  team: detectTeam,
  schedule: detectSchedule,
};

/* ---------- 主迴圈 ---------- */

/**
 * 掃一遍所有啟用中的 watch。
 * 回傳 { scanned, fired, errors, skipped, cooled, unresolved, ms, error_list }：
 *   skipped    = 資料源還沒接上的（目前只有 team）
 *   cooled     = 條件成立但還在冷卻期內，沒送（狀態保留，冷卻過後會再判一次）
 *   unresolved = 條件本身沒問題，但這一輪查不到需要的人／分數，沒辦法判斷
 */
export async function runWatches(env) {
  const t0 = Date.now();
  const t = now();
  const db = env.DB;
  const snap = snapshot();
  const stats = { scanned: 0, fired: 0, errors: 0, skipped: 0, cooled: 0, unresolved: 0, ms: 0, error_list: [] };
  const fail = (msg) => {
    stats.errors++;
    if (stats.error_list.length < 10) stats.error_list.push(String(msg).slice(0, 300));
  };

  let list;
  try {
    list = await activeWatches(db);
  } catch (e) {
    fail(`讀取 watches 失敗: ${e && e.message || e}`);
    stats.ms = Date.now() - t0;
    return stats;
  }

  for (const w of list) {
    stats.scanned++;
    // 一條壞掉不能拖垮整輪：每條各自包 try/catch，錯誤記下來繼續下一條
    try {
      const spec = WATCH_KINDS[w.kind];
      const detect = DETECT[w.kind];
      if (!spec || !detect) throw new Error(`未知的 kind=${w.kind}`);

      let p;
      try { p = JSON.parse(w.params || '{}') || {}; } catch (e) { throw new Error('params 不是合法 JSON'); }
      let st = null;
      try { st = w.last_state ? JSON.parse(w.last_state) : null; } catch (e) { st = null; }

      const res = (await detect(w, p, st, snap, t)) || {};
      if (res.unavailable) { stats.skipped++; continue; }
      if (res.unresolved) stats.unresolved++;

      const fires = res.fires || [];
      const cooling = w.last_fired != null && (t - w.last_fired) < w.cooldown_s;

      if (fires.length && cooling) {
        // 冷卻中：連狀態都不寫。寫下去這個邊緣就消失了，冷卻結束也補不回來。
        stats.cooled++;
      } else if (fires.length) {
        for (const f of fires) {
          await addEvent(db, { watch_id: w.id, user_id: w.user_id, title: f.title, body: f.body });
          stats.fired++;
        }
        await markFired(db, w.id, res.state === undefined ? st : res.state, t);
      } else if (res.state !== undefined &&
                 JSON.stringify(res.state === undefined ? null : res.state) !== (w.last_state == null ? 'null' : w.last_state)) {
        // 沒觸發也要把狀態寫回去，否則下一輪的比對基準是舊的。值沒變就不寫，省掉大部分 D1 寫入。
        await markState(db, w.id, res.state);
      }
    } catch (e) {
      fail(`${w.kind}/${w.id}: ${e && e.message || e}`);
    }
  }

  stats.ms = Date.now() - t0;
  return stats;
}
