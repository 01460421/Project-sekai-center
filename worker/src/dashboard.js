/* 管理後台儀表板的資料來源（/admin/dash/*）。

   為什麼獨立一支：admin.js 是「動作」（審核、給權限、問 Claude、排任務），
   這裡全部是「看」——唯讀、可以隨時重打、失敗了也不會壞掉任何東西。
   兩種性質混在一個檔案裡，日後改動作邏輯時很容易誤傷儀表板的查詢。

   SQL 的例外：全站的規矩是「所有 SQL 都走 db.js」，這個檔案是唯一的例外——
   儀表板的查詢是一次性的聚合，塞進 db.js 只會讓存取層被一堆報表用的
   GROUP BY 撐爆，而且它們只有這裡會用。代價是這裡必須自律：
   語句一律寫死、變數一律綁參數、而且只能 SELECT（下面 readOnly() 會強制檢查）。

   個資最小化：google_sub 從頭到尾不出現（那是 OAuth 內部識別，後台顯示沒有用途）；
   AI 稽核與排行榜只帶 name，不帶 email 也不帶 user_id——「誰用得最兇」不需要
   精確到可以反查帳號。使用者清單與單一使用者詳情才回 email，
   因為那本來就是管理員在做審核時要看的東西。 */

import { corsHeaders, preflight } from './cors.js';
import { WATCH_KINDS } from './watch.js';

/* 台北時區。「今日」對台服玩家來說是 UTC+8 的今日，用 UTC 分日會讓每天早上八點前
   的資料被算到前一天去。JS 這邊的位移量與 SQL 裡的 '+8 hours' 必須永遠一致，
   否則 series 的日期標籤會跟 SQL 分組出來的桶對不起來，圖表整條歪掉。 */
const DAY_MS = 86400000;
const TZ_MS = 8 * 3600 * 1000;

/* 未寄出事件積壓的判定門檻。cron 每分鐘跑一次、一次撈 20 封，
   所以只要有東西卡超過 10 分鐘，就不是「還沒輪到」而是真的出事了。 */
const BACKLOG_S = 600;

const MAX_LIST = 200;

/* ---------- 小工具 ---------- */

/* D1 的 COUNT/SUM 在某些驅動版本會回字串，前端拿去做算術就會變字串相接；
   所有數字出口一律過這裡。SUM 在空表回 NULL，也在這裡收斂成 0。 */
const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/* 時間戳要區分「沒有」與「0」：空表的 MIN(created_at) 是 NULL，
   轉成 0 會讓前端顯示成 1970/01/01。 */
const tsOrNull = (v) => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : null;
};

const nowSec = () => Math.floor(Date.now() / 1000);

/* 台北日界。dayKey 回 'YYYY-MM-DD'，與 SQL 的 date(...,'+8 hours') 產出同一種字串。 */
const dayKey = (ms) => new Date(ms + TZ_MS).toISOString().slice(0, 10);
const startOfDayMs = (ms) => Math.floor((ms + TZ_MS) / DAY_MS) * DAY_MS - TZ_MS;

/* 唯讀關卡。這個檔案被允許自己寫 SQL，代價就是要有一道機械性的防線：
   哪天有人（包括未來的我）順手在這裡加了一句 UPDATE，會在第一次執行就炸掉，
   而不是等到資料被默默改壞才發現。 */
function readOnly(sql) {
  const bad = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|PRAGMA|VACUUM)\b/i;
  if (!/^\s*SELECT\b/i.test(sql) || bad.test(sql)) {
    throw new Error('dashboard.js 只能執行唯讀 SELECT');
  }
  return sql;
}

const rows = (db, sql, ...a) => {
  const st = db.prepare(readOnly(sql));
  return (a.length ? st.bind(...a) : st).all().then((r) => (r && r.results) || []);
};
const firstRow = async (db, sql, ...a) => (await rows(db, sql, ...a))[0] || {};

/* tasks 與 tool_log 是後來的 migration（003）建的。若某個環境還沒跑過，
   整個儀表板不該因此回 500——那一區塊顯示成空的就好，其他數字照樣看得到。 */
const safe = (p, fallback) => p.then((v) => v, () => fallback);

const kindLabel = (k) => (WATCH_KINDS[k] && WATCH_KINDS[k].label) || k || '未知';

/* LIKE 的 % 與 _ 是萬用字元，使用者打進搜尋框的字面值要跳脫，
   否則搜 "_" 會把全部的人都撈回來。搭配 SQL 裡的 ESCAPE '\'。 */
const likeArg = (q) => '%' + String(q).replace(/[\\%_]/g, (m) => '\\' + m) + '%';

/* 沒帶參數要用預設值，不是用 0 —— searchParams.get() 沒有時回 null，
   而 Number(null) 是 0（不是 NaN），少了這一行 ?limit= 沒帶就會被夾成 1，
   整個清單只剩一筆。空字串同理。 */
const clamp = (v, lo, hi, dflt) => {
  if (v == null || v === '') return dflt;
  const x = Math.floor(Number(v));
  if (!Number.isFinite(x)) return dflt;
  return Math.min(hi, Math.max(lo, x));
};

/* 後台資料一律 no-store（使用者名單、稽核紀錄不該被任何中間層留下來），
   CORS 比照 admin.js：主站與 Worker 不同來源，session 又在 cookie，
   少了具名的 Allow-Origin 前端連讀都讀不到。 */
const json = (obj, status, req, env) => new Response(JSON.stringify(obj), {
  status: status || 200,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...corsHeaders(req, env),
  },
});

/* watches 的 params 存的是 JSON 字串。前端每個地方各自 try/catch 很囉唆，
   在出口就解好；解不開就原字串奉還，不要因為一筆壞資料讓整個端點掛掉。 */
const parseParams = (s) => {
  try { return JSON.parse(s); } catch (e) { return s || null; }
};

/* ---------- 各區塊查詢 ---------- */

/* 訂閱依 kind 的分佈。overview 與 watches 兩個端點都要用，抽出來共用。 */
async function watchesByKind(db) {
  const r = await rows(db,
    'SELECT kind, COUNT(*) AS total, SUM(enabled=1) AS enabled FROM watches GROUP BY kind ORDER BY total DESC');
  return r.map((x) => ({
    kind: x.kind, label: kindLabel(x.kind), total: n(x.total), enabled: n(x.enabled),
  }));
}

/* 首屏的全部數字。六段互不相干，並行打；每一段在空表都自然回 0，不必特別處理。
   同一張表能用條件式聚合一次問完就不要拆成好幾個 COUNT——D1 是每句一次往返。 */
async function overview(db) {
  const t = nowSec();
  const d7 = t - 7 * 86400;

  const [u, byKind, e, ai, top, tk] = await Promise.all([
    firstRow(db, `SELECT COUNT(*) AS total,
        SUM(status='pending')  AS pending,
        SUM(status='approved') AS approved,
        SUM(status='rejected') AS rejected,
        SUM(is_admin=1)        AS admins,
        SUM(discord_id IS NOT NULL AND discord_id <> '') AS discord_linked,
        SUM(date(created_at,'unixepoch','+8 hours') = date('now','+8 hours')) AS today,
        SUM(created_at >= ?)   AS last_7d
      FROM users`, d7),

    watchesByKind(db),

    firstRow(db, `SELECT COUNT(*) AS total,
        SUM(date(created_at,'unixepoch','+8 hours') = date('now','+8 hours')) AS today,
        SUM(created_at >= ?)        AS last_7d,
        SUM(mailed_at IS NULL)      AS unmailed,
        SUM(mail_error IS NOT NULL AND mail_error <> '') AS failed
      FROM events`, d7),

    firstRow(db, `SELECT COUNT(*) AS total,
        SUM(date(created_at,'unixepoch','+8 hours') = date('now','+8 hours')) AS today,
        SUM(created_at >= ?) AS last_7d,
        SUM(CASE WHEN date(created_at,'unixepoch','+8 hours') = date('now','+8 hours')
                 THEN tokens_in  ELSE 0 END) AS tokens_in_today,
        SUM(CASE WHEN date(created_at,'unixepoch','+8 hours') = date('now','+8 hours')
                 THEN tokens_out ELSE 0 END) AS tokens_out_today
      FROM admin_log`, d7),

    /* 排行榜刻意只帶 name：這裡要回答的是「近期誰在大量用 AI」，
       不需要精確到可以反查帳號，所以連 user_id 都不出去。 */
    rows(db, `SELECT u.name AS name, COUNT(*) AS calls,
        SUM(a.tokens_in) AS tokens_in, SUM(a.tokens_out) AS tokens_out
      FROM admin_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.created_at >= ?
      GROUP BY a.user_id ORDER BY calls DESC LIMIT 5`, d7),

    safe(firstRow(db, `SELECT COUNT(*) AS total,
        SUM(status='pending')   AS pending,
        SUM(status='failed')    AS failed,
        SUM(status='done')      AS done,
        SUM(status='cancelled') AS cancelled,
        SUM(status='pending' AND run_at <= ?) AS due
      FROM tasks`, t), {}),
  ]);

  return {
    generated_at: t,
    users: {
      total: n(u.total), pending: n(u.pending), approved: n(u.approved),
      rejected: n(u.rejected), admins: n(u.admins),
      today: n(u.today), last_7d: n(u.last_7d),
      discord_linked: n(u.discord_linked),
    },
    watches: {
      total: byKind.reduce((s, k) => s + k.total, 0),
      enabled: byKind.reduce((s, k) => s + k.enabled, 0),
      by_kind: byKind,
    },
    events: {
      total: n(e.total), today: n(e.today), last_7d: n(e.last_7d),
      unmailed: n(e.unmailed), failed: n(e.failed),
    },
    ai: {
      total: n(ai.total), today: n(ai.today), last_7d: n(ai.last_7d),
      tokens_in_today: n(ai.tokens_in_today), tokens_out_today: n(ai.tokens_out_today),
      top: top.map((r) => ({
        name: r.name || '（未命名）', calls: n(r.calls),
        tokens_in: n(r.tokens_in), tokens_out: n(r.tokens_out),
      })),
    },
    tasks: {
      total: n(tk.total), pending: n(tk.pending), failed: n(tk.failed),
      done: n(tk.done), cancelled: n(tk.cancelled), due: n(tk.due),
    },
  };
}

/* 時間序列。分組交給 SQL 的 date()，JS 只負責補零與排序——
   把整張表撈回來在 JS 裡分日，資料一多就是白白把 D1 的頻寬燒掉。
   沒有資料的日子 SQL 不會產生列，所以要用預先算好的日期陣列去對，
   缺的補 0；否則折線圖會把「那天沒事」畫成「那天不存在」。 */
async function series(db, daysParam) {
  const days = clamp(daysParam, 1, 90, 14);
  const start = startOfDayMs(Date.now()) - (days - 1) * DAY_MS;
  const since = Math.floor(start / 1000);

  const keys = [];
  for (let i = 0; i < days; i++) keys.push(dayKey(start + i * DAY_MS));

  const [us, ai, ev] = await Promise.all([
    rows(db, `SELECT date(created_at,'unixepoch','+8 hours') AS d, COUNT(*) AS c
              FROM users WHERE created_at >= ? GROUP BY d`, since),
    rows(db, `SELECT date(created_at,'unixepoch','+8 hours') AS d, COUNT(*) AS c
              FROM admin_log WHERE created_at >= ? GROUP BY d`, since),
    rows(db, `SELECT date(created_at,'unixepoch','+8 hours') AS d, COUNT(*) AS c
              FROM events WHERE created_at >= ? GROUP BY d`, since),
  ]);

  const fill = (r) => {
    const m = new Map(r.map((x) => [x.d, n(x.c)]));
    return keys.map((k) => m.get(k) || 0);
  };

  return {
    // days 是給座標軸用的短標籤，dates 保留完整日期給 tooltip／跨年時對照
    days: keys.map((k) => k.slice(5)),
    dates: keys,
    tz: 'UTC+8',
    series: { users: fill(us), ai: fill(ai), events: fill(ev) },
  };
}

/* 使用者清單。篩選條件用「? = '' 就略過」的哨兵寫法，
   而不是依條件拼 SQL——語句永遠是同一句，D1 也能重用 prepared statement。 */
async function userList(db, url) {
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 60);
  const status = String(url.searchParams.get('status') || '').trim();
  const limit = clamp(url.searchParams.get('limit'), 1, MAX_LIST, 50);

  if (status && ['pending', 'approved', 'rejected'].indexOf(status) < 0) {
    return { error: 'status 只能是 pending/approved/rejected' };
  }
  const like = likeArg(q);

  const r = await rows(db, `SELECT u.id, u.name, u.email, u.picture, u.discord_name,
        u.is_admin, u.status, u.apply_note, u.created_at, u.updated_at, u.reviewed_at,
        (SELECT COUNT(*) FROM watches w WHERE w.user_id = u.id) AS watches,
        (SELECT COUNT(*) FROM events  e WHERE e.user_id = u.id) AS events
      FROM users u
      WHERE (? = '' OR u.status = ?)
        AND (? = '' OR u.name LIKE ? ESCAPE '\\' OR u.discord_name LIKE ? ESCAPE '\\')
      ORDER BY u.created_at DESC
      LIMIT ?`, status, status, q, like, like, limit);

  return {
    query: { q, status, limit },
    // 有沒有被截斷要讓前端知道，不然管理員會以為「就只有這些人」
    truncated: r.length >= limit,
    users: r.map((x) => ({
      id: x.id, name: x.name || '', email: x.email || '', picture: x.picture || '',
      discord_name: x.discord_name || null, is_admin: !!n(x.is_admin), status: x.status,
      apply_note: x.apply_note || null,
      created_at: tsOrNull(x.created_at), updated_at: tsOrNull(x.updated_at),
      reviewed_at: tsOrNull(x.reviewed_at),
      watches: n(x.watches), events: n(x.events),
    })),
  };
}

/* 單一使用者詳情。查不到回 null，由呼叫端翻成 404。 */
async function userDetail(db, id) {
  const t = nowSec();
  const d7 = t - 7 * 86400;

  /* 明列欄位而不是 SELECT *：google_sub 不該離開資料庫，
     用 * 的話哪天 schema 加了新的敏感欄位會自動被帶出去。 */
  const u = await firstRow(db, `SELECT id, name, email, picture, discord_id, discord_name,
      is_admin, status, apply_note, reviewed_at, reviewed_by, created_at, updated_at
    FROM users WHERE id = ?`, id);
  if (!u.id) return null;

  const [ws, evs, ai, tools, tasks] = await Promise.all([
    rows(db, `SELECT id, kind, name, params, enabled, cooldown_s, last_fired, created_at,
        (SELECT COUNT(*) FROM events e WHERE e.watch_id = watches.id) AS fired_count
      FROM watches WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`, id),

    // body 可能很長且含玩家資料，列表只給標題與寄送狀態
    rows(db, `SELECT id, watch_id, title, created_at, mailed_at, mail_error
      FROM events WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`, id),

    firstRow(db, `SELECT COUNT(*) AS total,
        SUM(date(created_at,'unixepoch','+8 hours') = date('now','+8 hours')) AS today,
        SUM(created_at >= ?) AS last_7d,
        SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out,
        MAX(created_at) AS last_at
      FROM admin_log WHERE user_id = ?`, d7, id),

    safe(firstRow(db, `SELECT COUNT(*) AS total, SUM(ok=0) AS failed, MAX(created_at) AS last_at
      FROM tool_log WHERE user_id = ?`, id), {}),

    safe(firstRow(db, `SELECT COUNT(*) AS total,
        SUM(status='pending') AS pending, SUM(status='failed') AS failed
      FROM tasks WHERE user_id = ?`, id), {}),
  ]);

  return {
    user: {
      id: u.id, name: u.name || '', email: u.email || '', picture: u.picture || '',
      discord_id: u.discord_id || null, discord_name: u.discord_name || null,
      is_admin: !!n(u.is_admin), status: u.status,
      apply_note: u.apply_note || null,
      reviewed_at: tsOrNull(u.reviewed_at), reviewed_by: u.reviewed_by || null,
      created_at: tsOrNull(u.created_at), updated_at: tsOrNull(u.updated_at),
    },
    watches: ws.map((w) => ({
      id: w.id, kind: w.kind, label: kindLabel(w.kind), name: w.name || '',
      params: parseParams(w.params), enabled: !!n(w.enabled),
      cooldown_s: n(w.cooldown_s), last_fired: tsOrNull(w.last_fired),
      fired_count: n(w.fired_count), created_at: tsOrNull(w.created_at),
    })),
    events: evs.map((e) => ({
      id: e.id, watch_id: e.watch_id, title: e.title || '',
      created_at: tsOrNull(e.created_at), mailed_at: tsOrNull(e.mailed_at),
      mail_error: e.mail_error || null,
    })),
    ai: {
      total: n(ai.total), today: n(ai.today), last_7d: n(ai.last_7d),
      tokens_in: n(ai.tokens_in), tokens_out: n(ai.tokens_out),
      last_at: tsOrNull(ai.last_at),
    },
    tools: { total: n(tools.total), failed: n(tools.failed), last_at: tsOrNull(tools.last_at) },
    tasks: { total: n(tasks.total), pending: n(tasks.pending), failed: n(tasks.failed) },
  };
}

/* 全站訂閱總覽。排序刻意把「啟用中且最近觸發過」排前面：
   管理員打開這頁最常想知道的是「現在有什麼在跑、跑得怎樣」。
   SQLite 的 NULL 在 DESC 會排最前面，所以先用 (last_fired IS NULL) 把沒觸發過的推到後面。 */
async function watchList(db, url) {
  const limit = clamp(url.searchParams.get('limit'), 1, MAX_LIST, 100);

  const [r, byKind] = await Promise.all([
    rows(db, `SELECT w.id, w.kind, w.name, w.enabled, w.cooldown_s, w.last_fired, w.created_at,
          w.user_id, u.name AS user_name, u.status AS user_status,
          (SELECT COUNT(*) FROM events e WHERE e.watch_id = w.id) AS fired_count
        FROM watches w LEFT JOIN users u ON u.id = w.user_id
        ORDER BY w.enabled DESC, (w.last_fired IS NULL), w.last_fired DESC, w.created_at DESC
        LIMIT ?`, limit),
    watchesByKind(db),
  ]);

  return {
    total: byKind.reduce((s, k) => s + k.total, 0),
    enabled: byKind.reduce((s, k) => s + k.enabled, 0),
    by_kind: byKind,
    truncated: r.length >= limit,
    watches: r.map((w) => ({
      id: w.id, kind: w.kind, label: kindLabel(w.kind), name: w.name || '',
      enabled: !!n(w.enabled), cooldown_s: n(w.cooldown_s),
      last_fired: tsOrNull(w.last_fired), fired_count: n(w.fired_count),
      created_at: tsOrNull(w.created_at),
      // 訂閱總覽要能點進使用者詳情，所以帶內部 id（不是個資）；email 不帶
      user: { id: w.user_id, name: w.user_name || '（已刪除）', status: w.user_status || null },
    })),
  };
}

/* AI 稽核時間軸：admin_log（誰問了什麼）與 tool_log（模型呼叫了哪些工具）合併。

   問題／回覆／參數一律在 SQL 裡就用 substr 截斷，不是撈回來再切——
   稽核只要看得出「問的是哪一類事情」，整包倒出來既浪費頻寬，
   也等於把使用者可能貼進去的內容全部再攤一次。
   兩張表各自取最新 limit 筆再在 JS 合併排序，資料量固定是 2×limit，
   不是「把整張表撈回來算」。 */
async function aiAudit(db, url) {
  const limit = clamp(url.searchParams.get('limit'), 1, MAX_LIST, 50);
  const CUT = 200;

  const [asks, tools] = await Promise.all([
    rows(db, `SELECT a.id, a.created_at, a.tokens_in, a.tokens_out,
          substr(a.prompt, 1, 200) AS prompt, substr(a.reply, 1, 200) AS reply,
          length(a.prompt) AS prompt_len, length(a.reply) AS reply_len,
          u.name AS user_name
        FROM admin_log a LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.created_at DESC LIMIT ?`, limit),

    safe(rows(db, `SELECT t.id, t.created_at, t.tool, t.ok,
          substr(t.args, 1, 200) AS args, substr(t.result, 1, 200) AS result,
          length(t.args) AS args_len, u.name AS user_name
        FROM tool_log t LEFT JOIN users u ON u.id = t.user_id
        ORDER BY t.created_at DESC LIMIT ?`, limit), []),
  ]);

  const items = [];
  for (const a of asks) {
    items.push({
      type: 'ask', id: a.id, at: tsOrNull(a.created_at),
      user_name: a.user_name || '（未命名）',
      prompt: a.prompt || '', reply: a.reply || '',
      truncated: n(a.prompt_len) > CUT || n(a.reply_len) > CUT,
      tokens_in: n(a.tokens_in), tokens_out: n(a.tokens_out),
    });
  }
  for (const t of tools) {
    items.push({
      type: 'tool', id: t.id, at: tsOrNull(t.created_at),
      user_name: t.user_name || '（未命名）',
      tool: t.tool, ok: !!n(t.ok),
      args: t.args || '', result: t.result || '',
      truncated: n(t.args_len) > CUT,
    });
  }
  // 兩張表的時間戳同單位（秒），直接比大小即可；null 當 0 沉底
  items.sort((x, y) => (y.at || 0) - (x.at || 0));

  return { limit, truncate_at: CUT, items: items.slice(0, limit) };
}

/* 系統健康。這裡的每一段都要能在「表是空的」甚至「表還沒建」的情況下回應，
   因為它正是拿來診斷那種狀況的端點——自己先炸掉就沒有意義了。 */
async function health(db, env) {
  const t = nowSec();

  const [core, extra, ev, tk] = await Promise.all([
    firstRow(db, `SELECT
        (SELECT COUNT(*) FROM users)     AS users,
        (SELECT COUNT(*) FROM prefs)     AS prefs,
        (SELECT COUNT(*) FROM watches)   AS watches,
        (SELECT COUNT(*) FROM events)    AS events,
        (SELECT COUNT(*) FROM admin_log) AS admin_log`),

    // 003 migration 才有的兩張表，單獨問，沒有就顯示 null 而不是讓整頁掛掉
    safe(firstRow(db, `SELECT
        (SELECT COUNT(*) FROM tasks)    AS tasks,
        (SELECT COUNT(*) FROM tool_log) AS tool_log`), null),

    firstRow(db, `SELECT MIN(created_at) AS oldest, MAX(created_at) AS newest,
        SUM(mailed_at IS NULL AND no_mail = 0) AS unmailed,
        MIN(CASE WHEN mailed_at IS NULL AND no_mail = 0 THEN created_at END) AS oldest_unmailed,
        SUM(mail_error IS NOT NULL AND mail_error <> '') AS mail_failed
      FROM events`),

    safe(firstRow(db, `SELECT SUM(status='failed') AS failed, SUM(status='pending') AS pending,
        SUM(status='pending' AND run_at <= ?) AS overdue FROM tasks`, t), {}),
  ]);

  const oldestUnmailed = tsOrNull(ev.oldest_unmailed);
  const backlog = oldestUnmailed != null && (t - oldestUnmailed) > BACKLOG_S;

  /* 只回「有沒有設定」，永遠不回值本身——後台頁面被截圖外流的機率
     遠高於資料庫被拖走，金鑰不該有機會出現在畫面上。 */
  const capabilities = {
    db: !!env.DB,
    tracker: !!env.TRACKER,
    mail: !!(env.RESEND_API_KEY && env.MAIL_FROM),
    ai: !!env.ANTHROPIC_API_KEY,
    google_login: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    discord: !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET),
    session: !!env.SESSION_SECRET,
    admin_bootstrap: !!env.ADMIN_EMAIL,
  };

  const failedTasks = n(tk.failed);
  return {
    generated_at: t,
    tables: {
      users: n(core.users), prefs: n(core.prefs), watches: n(core.watches),
      events: n(core.events), admin_log: n(core.admin_log),
      tasks: extra ? n(extra.tasks) : null,
      tool_log: extra ? n(extra.tool_log) : null,
    },
    // extra 是 null 代表 003 migration 沒跑過，值得在畫面上點出來
    migrations: { tasks_tables: !!extra },
    events: {
      oldest_at: tsOrNull(ev.oldest), newest_at: tsOrNull(ev.newest),
      unmailed: n(ev.unmailed), oldest_unmailed_at: oldestUnmailed,
      oldest_unmailed_age_s: oldestUnmailed == null ? 0 : t - oldestUnmailed,
      backlog, backlog_threshold_s: BACKLOG_S,
      mail_failed: n(ev.mail_failed),
    },
    tasks: { pending: n(tk.pending), failed: failedTasks, overdue: n(tk.overdue) },
    capabilities,
    ok: capabilities.db && !backlog && failedTasks === 0,
  };
}

/* ---------- 路由 ---------- */

export async function handleDashboard(req, env, url, user) {
  const p = url.pathname;
  if (p !== '/admin/dash' && !p.startsWith('/admin/dash/')) return null;

  // preflight 不帶 cookie，照一般流程會被下面的 403 擋掉，整個請求就失敗了
  if (req.method === 'OPTIONS') return preflight(req, env);

  /* 這支一定是從 admin.js 轉進來的、那邊已經驗過權限，但還是自己再驗一次：
     權限檢查跟被檢查的資料放在同一個檔案，日後改路由才不會不小心繞過。
     未登入與非管理員都回 403，差別只放在 body 讓前端決定跳登入還是顯示無權限。 */
  if (!user) return json({ error: 'not_signed_in', message: '請先登入' }, 403, req, env);
  if (!user.is_admin) return json({ error: 'not_admin', message: '沒有管理員權限' }, 403, req, env);

  if (req.method !== 'GET') {
    return json({ error: 'method_not_allowed', message: '儀表板只接受 GET' }, 405, req, env);
  }

  const db = env.DB;
  if (!db) return json({ error: 'no_db', message: '尚未綁定 D1（DB）' }, 503, req, env);

  try {
    if (p === '/admin/dash' || p === '/admin/dash/') {
      // 自我描述：前端（與之後接手的人）不必翻程式碼才知道有哪些端點
      return json({
        endpoints: [
          'GET /admin/dash/overview',
          'GET /admin/dash/series?days=14',
          'GET /admin/dash/users?q=&status=&limit=',
          'GET /admin/dash/user/:id',
          'GET /admin/dash/watches?limit=',
          'GET /admin/dash/ai?limit=50',
          'GET /admin/dash/health',
        ],
      }, 200, req, env);
    }

    if (p === '/admin/dash/overview') {
      return json({ overview: await overview(db) }, 200, req, env);
    }

    if (p === '/admin/dash/series') {
      return json(await series(db, url.searchParams.get('days')), 200, req, env);
    }

    if (p === '/admin/dash/users') {
      const r = await userList(db, url);
      if (r.error) return json({ error: 'bad_request', message: r.error }, 400, req, env);
      return json(r, 200, req, env);
    }

    if (p.startsWith('/admin/dash/user/')) {
      // id 是 UUID，但仍可能被 URL-encode 過；解不開就當原字串（反正查不到會回 404）
      const raw = p.slice('/admin/dash/user/'.length);
      let id = raw;
      try { id = decodeURIComponent(raw); } catch (e) { /* 壞的 percent-encoding，用原字串 */ }
      if (!id) return json({ error: 'bad_request', message: '缺少使用者 id' }, 400, req, env);
      const d = await userDetail(db, id);
      if (!d) return json({ error: 'not_found', message: '查無此使用者' }, 404, req, env);
      return json(d, 200, req, env);
    }

    if (p === '/admin/dash/watches') {
      return json(await watchList(db, url), 200, req, env);
    }

    if (p === '/admin/dash/ai') {
      return json(await aiAudit(db, url), 200, req, env);
    }

    if (p === '/admin/dash/health') {
      return json({ health: await health(db, env) }, 200, req, env);
    }

    return json({ error: 'not_found', message: '沒有這個儀表板端點' }, 404, req, env);
  } catch (e) {
    // 原始訊息會帶出 SQL 片段與欄位名,只寫進 log 不回給前端
    console.error('dashboard', e && e.stack || e);
    return json({ error: 'server_error', message: '伺服器錯誤' }, 500, req, env);
  }
}
