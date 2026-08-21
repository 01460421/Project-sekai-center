/* 管理員後台 API（/admin/*）。

   Claude 代理的安全模型：管理員被授權的只有「用自然語言查資料、產報表」，是唯讀的。
   所以這裡刻意不給 Claude 任何工具，也不讓它的輸出決定接下來要跑什麼 —— 沒有 eval、
   沒有 new Function、沒有「把回傳值當 SQL 執行」。流程固定是：本檔先用寫死的唯讀
   SELECT 把資料查成一份快照，連同管理員的問題一起送出去，Claude 只負責把快照翻成人話。
   這樣就算問題裡被塞了奇怪的指令，最壞結果也只是「回答得很怪」，動不到任何資料。

   個資最小化：送進 Claude 的快照只有聚合數字與活動榜線，沒有 email、Google sub、
   Discord id，也沒有玩家 uid —— 這些欄位對「回答統計問題」毫無幫助，帶出去只是風險。 */

import { corsHeaders, preflight } from './api.js';
import { listUsers, reviewUser, setAdmin, getUser, logAdmin, listAdminLog,
  logTool,
  listToolLog,
  createTask,
  listTasks} from './db.js';

/* 模型 id 與參數依 claude-api skill 查證，不是憑記憶寫的。
   Opus 5 預設就跑 adaptive thinking，不必（也不能）再給 budget_tokens；
   effort 用 medium 是後台同步請求的折衷：這種「把數字講成人話」的活不需要 xhigh，
   但管理員在等回應，延遲比多想幾秒更值錢。 */
const MODEL = 'claude-opus-5';
const MAX_TOKENS = 8000;
const EFFORT = 'medium';
/* 安全拒答時由伺服器端接手改用別的模型；這個 beta 只配得上 fallbacks: "default" 純量寫法 */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const HISEKAI = 'https://api.hisekai.org/tw';
const UA = 'project-sekai-center/1.0 (+https://project-sekai-center.vercel.app) admin-console';

/* 後台回應一律 no-store：這裡面是使用者名單與稽核紀錄，不該被任何中間層留下來 */
/* 後台跟主站不同來源（主站 project-sekai-center.com，這裡是 games 子網域），
   而 session 在 cookie，所以每個回應都得帶具名的 Allow-Origin 與 Allow-Credentials。
   少了它，瀏覽器連讀都讀不到，POST 的 preflight 更是直接失敗 —— 整個後台會叫不動。
   規則跟 api.js 完全一樣，所以直接共用那份實作，不要另寫一套走鐘。 */
let _req = null, _env = null;
const json = (o, status) => new Response(JSON.stringify(o), {
  status: status || 200,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(_req ? corsHeaders(_req, _env) : {}),
  },
});

const n = v => Number(v || 0);
const rows = (db, sql, ...a) => (a.length ? db.prepare(sql).bind(...a) : db.prepare(sql))
  .all().then(r => r.results || []);
const firstRow = async (db, sql, ...a) => (await rows(db, sql, ...a))[0] || {};

/* ---------- 站台統計（唯讀，語句寫死） ---------- */

/* 三張表各用一句條件式聚合湊齊，比逐項 COUNT 少打好幾次 D1。
   SUM(布林) 在空表會回 NULL，所以出口統一過 n()。 */
async function siteStats(db) {
  const t = Math.floor(Date.now() / 1000);
  const d7 = t - 7 * 86400;

  const [u, e, a, w] = await Promise.all([
    firstRow(db, `SELECT COUNT(*) AS total,
        SUM(status='pending')  AS pending,
        SUM(status='approved') AS approved,
        SUM(status='rejected') AS rejected,
        SUM(is_admin=1)        AS admins,
        SUM(created_at >= ?)   AS new_7d,
        SUM(discord_id IS NOT NULL) AS discord_linked
      FROM users`, d7),
    firstRow(db, `SELECT COUNT(*) AS total,
        SUM(created_at >= ?)         AS last_7d,
        SUM(mailed_at IS NULL)       AS unmailed,
        SUM(mail_error IS NOT NULL)  AS mail_failed
      FROM events`, d7),
    firstRow(db, `SELECT COUNT(*) AS total, SUM(created_at >= ?) AS last_7d,
        SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out
      FROM admin_log`, d7),
    rows(db, `SELECT kind, COUNT(*) AS total, SUM(enabled=1) AS enabled
      FROM watches GROUP BY kind ORDER BY total DESC`),
  ]);

  const byKind = w.map(r => ({ kind: r.kind, total: n(r.total), enabled: n(r.enabled) }));
  return {
    generated_at: new Date(t * 1000).toISOString(),
    users: {
      total: n(u.total), pending: n(u.pending), approved: n(u.approved),
      rejected: n(u.rejected), admins: n(u.admins), new_7d: n(u.new_7d),
      discord_linked: n(u.discord_linked),
    },
    watches: {
      total: byKind.reduce((s, k) => s + k.total, 0),
      enabled: byKind.reduce((s, k) => s + k.enabled, 0),
      by_kind: byKind,
    },
    events: {
      total: n(e.total), last_7d: n(e.last_7d),
      unmailed: n(e.unmailed), mail_failed: n(e.mail_failed),
    },
    admin_asks: {
      total: n(a.total), last_7d: n(a.last_7d),
      tokens_in: n(a.tokens_in), tokens_out: n(a.tokens_out),
    },
  };
}

/* 只取標題，body 可能長且沒有分析價值；user_id 一律不帶出去 */
const recentEventTitles = db =>
  rows(db, 'SELECT title, created_at FROM events ORDER BY created_at DESC LIMIT 30')
    .then(r => r.map(x => [x.created_at, String(x.title || '').slice(0, 120)]));

/* ---------- 當期榜線（HiSekai） ---------- */

async function fetchJson(path) {
  const r = await fetch(HISEKAI + path, {
    headers: { 'user-agent': UA },
    // 後台是同步請求，來源站慢就放棄不帶這段資料，不要讓管理員一直等
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/* 前百原始 JSON 有 270KB，整份塞給 Claude 只會吃掉 context 又幫不上忙，
   這裡壓成「頭部名次＋分段榜線」。順帶一提：玩家 uid 是 19 位數，JSON.parse 會失精，
   所以這份摘要完全不碰 profile.id —— 反正個資最小化本來也不該帶它。 */
async function liveDigest() {
  const out = {};
  const [top, border] = await Promise.allSettled([
    fetchJson('/event/live/top100'),
    fetchJson('/event/live/border'),
  ]);

  if (top.status === 'fulfilled') {
    const d = top.value;
    out.event = {
      id: d.id, name: d.name,
      start_at: d.start_at, aggregate_at: d.aggregate_at, closed_at: d.closed_at,
    };
    const rk = d.player_top_100_rankings || [];
    out.top100 = {
      note: '[rank, name, score]',
      top20: rk.slice(0, 20).map(r => [r.rank, r.name, r.score]),
      marks: rk.filter(r => r.rank === 30 || r.rank === 50 || r.rank === 100)
        .map(r => [r.rank, r.name, r.score]),
    };
  } else {
    out.top100_error = String(top.reason).slice(0, 120);
  }

  if (border.status === 'fulfilled') {
    const d = border.value;
    if (!out.event) {
      out.event = {
        id: d.id, name: d.name,
        start_at: d.start_at, aggregate_at: d.aggregate_at, closed_at: d.closed_at,
      };
    }
    out.border = {
      note: '[rank, score]',
      rankings: (d.player_border_rankings || []).map(r => [r.rank, r.score]),
    };
    out.world_link = (d.world_link_border_rankings || []).map(w => ({
      chapter: w.chapter, character: w.character,
      start_at: w.start_at, aggregate_at: w.aggregate_at,
      borders: (w.player_borders || []).map(r => [r.rank, r.score]),
    }));
  } else {
    out.border_error = String(border.reason).slice(0, 120);
  }
  return out;
}

/* ---------- Claude 代理 ---------- */

const SYSTEM = `你是「Project SEKAI 台服資源站」後台的資料分析助手，對象是站台管理員。

你能看到的只有訊息裡那份唯讀資料快照。你沒有任何工具，查不到別的資料，
也無法執行任何操作 —— 需要改設定、核准使用者、寄信時，請直接告訴管理員
該去後台哪個功能自己動手，不要假裝你做了。

規則：
- 只根據快照回答。引用數字時用快照裡的實際值，快照沒有的就明說「這份快照沒有」，
  絕對不要臆測或編造數字。
- 快照裡沒有任何使用者的 email、Google 帳號或 Discord 身分，也沒有玩家 uid。
  不要假裝知道某筆資料是誰，也不要要求管理員提供這些資訊。
- 用繁體中文回答，結論先講，需要時再用條列或表格展開。要產報表就直接給排版好的內容。
- 分數與名次是遊戲當期榜線，時間欄位都是 UTC（ISO 8601），換算成台北時間要加 8 小時。`;

/* withFallback=false 是退路：萬一這個帳號沒開通 server-side fallback beta，
   400 之後拿掉參數重打一次，總比整個問答功能死掉好。只退一次，不會無限遞迴。 */
async function askClaude(env, snapshot, prompt, withFallback = true) {
  const headers = {
    'content-type': 'application/json',
    'x-api-key': env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
  };
  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    output_config: { effort: EFFORT },
    messages: [{
      role: 'user',
      content: '【唯讀資料快照】\n' + JSON.stringify(snapshot) +
               '\n\n【管理員的問題】\n' + prompt,
    }],
  };
  if (withFallback) {
    body.fallbacks = 'default';
    headers['anthropic-beta'] = FALLBACK_BETA;
  }

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const raw = await r.text();
  let d = null;
  try { d = JSON.parse(raw); } catch (e) { /* 非 JSON 的錯誤頁，下面用 raw 當訊息 */ }

  if (!r.ok) {
    const msg = (d && d.error && d.error.message) || raw.slice(0, 200);
    if (withFallback && r.status === 400 && /fallback|beta/i.test(msg)) {
      return askClaude(env, snapshot, prompt, false);
    }
    throw new Error('Claude API ' + r.status + '：' + msg);
  }

  const usage = (d && d.usage) || {};
  const base = {
    model: d && d.model, refused: false,
    tokens_in: n(usage.input_tokens), tokens_out: n(usage.output_tokens),
  };
  // 拒答是 HTTP 200 + stop_reason='refusal'，content 可能是空的，要先擋再讀
  if (d && d.stop_reason === 'refusal') {
    const why = (d.stop_details && d.stop_details.category) || '未分類';
    return { ...base, refused: true, reply: `（安全政策拒絕回答，類別：${why}。換個問法或縮小範圍再試。）` };
  }
  // 只取 text 區塊：thinking 與 fallback 標記區塊不是給人看的內容
  const reply = ((d && d.content) || [])
    .filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
  return { ...base, reply: reply || '（模型沒有回傳內容。）' };
}


/* ---------- 工具呼叫（多輪） ----------

   /admin/ask 是單輪問答：把資料快照塞進 prompt 讓 Claude 回答。
   但管理員要的是「幫我設好 uid、算出接下來兩期的最佳隊伍、我還要跑多久」這種
   跨功能、多步驟的任務 —— 那需要模型自己決定要查什麼、查幾次。

   作法是把工具執行放在**瀏覽器**：站上的計算引擎、卡片資料、榜線快照、教學大全
   本來就都在前端，Worker 沒有那些東西。所以 Worker 只做兩件事：
   代理 Claude API（保護金鑰）與稽核（誰呼叫了什麼工具）。

   安全邊界不變：工具清單由前端寫死，Worker 不執行任何模型產生的程式碼，
   也不把 tools 的內容當指令看待。 */

const MAX_TOOLS = 40;
const MAX_MSGS = 60;

async function chatClaude(env, { messages, tools, system }) {
  const headers = {
    'content-type': 'application/json',
    'x-api-key': env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
  };
  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: system || SYSTEM,
    messages,
  };
  if (tools && tools.length) body.tools = tools;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers, body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const raw = await r.text();
  let d = null; try { d = JSON.parse(raw); } catch (e) {}
  if (!r.ok) {
    const msg = (d && d.error && d.error.message) || raw.slice(0, 300);
    throw new Error('Claude API ' + r.status + '：' + msg);
  }
  const usage = (d && d.usage) || {};
  return {
    content: (d && d.content) || [],
    stop_reason: d && d.stop_reason,
    model: d && d.model,
    tokens_in: n(usage.input_tokens), tokens_out: n(usage.output_tokens),
  };
}

/* 前端送來的東西一律當成不可信輸入檢查過再轉發 */
function validateChat(body) {
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || !messages.length) return { error: '缺少 messages' };
  if (messages.length > MAX_MSGS) return { error: '對話過長，請開新對話' };
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return { error: 'role 只能是 user/assistant' };
    if (typeof m.content !== 'string' && !Array.isArray(m.content)) return { error: 'content 格式錯誤' };
  }
  const tools = Array.isArray(body.tools) ? body.tools : [];
  if (tools.length > MAX_TOOLS) return { error: '工具數量過多' };
  for (const t of tools) {
    if (!t || typeof t.name !== 'string' || !t.input_schema) return { error: '工具定義格式錯誤' };
  }
  return { messages, tools, system: typeof body.system === 'string' ? body.system.slice(0, 8000) : null };
}

/* ---------- 路由 ---------- */

export async function handleAdmin(req, env, url, user) {
  const p = url.pathname;
  if (p !== '/admin' && !p.startsWith('/admin/')) return null;

  // json() 要拿得到 req/env 才能組 CORS 標頭
  _req = req; _env = env;
  // preflight 不帶 cookie，若照一般流程會被下面的 403 擋掉而讓整個 POST 失敗
  if (req.method === 'OPTIONS') return preflight(req, env);

  /* 未登入與非管理員都回 403：對外不去區分「這條路存在但你不夠格」和「你還沒登入」，
     真正的差別放在 body 讓前端決定要跳登入還是顯示無權限。 */
  if (!user) return json({ error: 'not_signed_in', message: '請先登入' }, 403);
  if (!user.is_admin) return json({ error: 'not_admin', message: '沒有管理員權限' }, 403);

  const db = env.DB;
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

  try {
    if (p === '/admin/users' && req.method === 'GET') {
      const status = url.searchParams.get('status') || '';
      if (status && !['pending', 'approved', 'rejected'].includes(status)) {
        return json({ error: 'bad_request', message: 'status 只能是 pending/approved/rejected' }, 400);
      }
      return json({ users: await listUsers(db, status || null) });
    }

    if (p === '/admin/users/review' && req.method === 'POST') {
      const id = String(body.id || '');
      const status = String(body.status || '');
      if (!id) return json({ error: 'bad_request', message: '缺少 id' }, 400);
      if (!['approved', 'rejected', 'pending'].includes(status)) {
        return json({ error: 'bad_request', message: 'status 只能是 approved/rejected/pending' }, 400);
      }
      if (!(await getUser(db, id))) return json({ error: 'not_found', message: '查無此使用者' }, 404);
      await reviewUser(db, id, status, user.id);
      return json({ ok: true, user: await getUser(db, id) });
    }

    if (p === '/admin/users/admin' && req.method === 'POST') {
      const id = String(body.id || '');
      const on = !!body.on;
      if (!id) return json({ error: 'bad_request', message: '缺少 id' }, 400);
      // 不准把自己降級：站上可能只剩你一個管理員，降完就沒人能核准任何人了
      if (id === user.id && !on) {
        return json({ error: 'bad_request', message: '不能取消自己的管理員權限' }, 400);
      }
      if (!(await getUser(db, id))) return json({ error: 'not_found', message: '查無此使用者' }, 404);
      await setAdmin(db, id, on);
      return json({ ok: true, user: await getUser(db, id) });
    }

    if (p === '/admin/stats' && req.method === 'GET') {
      return json({ stats: await siteStats(db) });
    }

    if (p === '/admin/log' && req.method === 'GET') {
      const limit = Number(url.searchParams.get('limit') || 30);
      return json({ log: await listAdminLog(db, limit) });
    }

    if (p === '/admin/ask' && req.method === 'POST') {
      if (!env.ANTHROPIC_API_KEY) {
        return json({ error: 'no_api_key', message: '尚未設定 ANTHROPIC_API_KEY' }, 503);
      }
      const prompt = String(body.prompt || '').trim();
      if (!prompt) return json({ error: 'bad_request', message: '缺少 prompt' }, 400);
      if (prompt.length > 2000) {
        return json({ error: 'bad_request', message: '問題太長（上限 2000 字）' }, 400);
      }

      // 三份資料互不相干，並行抓；榜線那邊失敗也只是快照少一段，不影響回答其他問題
      const [stats, titles, live] = await Promise.all([
        siteStats(db), recentEventTitles(db), liveDigest(),
      ]);
      const snapshot = {
        site: 'Project SEKAI 台服資源站',
        note: '這是唯讀快照，不含任何使用者的 email／Google／Discord 識別資訊',
        stats,
        recent_event_titles: titles,
        live,
      };

      let out;
      try {
        out = await askClaude(env, snapshot, prompt);
      } catch (e) {
        const msg = (e && e.message) || String(e);
        // 失敗也要留稽核：這樣「他問了什麼但沒問成」在紀錄裡看得出來
        await logAdmin(db, user.id, prompt, '[失敗] ' + msg, 0, 0);
        return json({ error: 'claude_failed', message: msg }, 502);
      }
      await logAdmin(db, user.id, prompt, out.reply, out.tokens_in, out.tokens_out);
      return json({
        reply: out.reply,
        refused: out.refused,
        model: out.model,
        tokens: { in: out.tokens_in, out: out.tokens_out },
        snapshot,   // 一併回傳讓管理員看得到「Claude 依據的就是這些數字」
      });
    }

    if (p === '/admin/chat' && req.method === 'POST') {
      if (!env.ANTHROPIC_API_KEY) return json({ error: 'no_key', message: '尚未設定 ANTHROPIC_API_KEY' }, 503);
      const v = validateChat(body);
      if (v.error) return json({ error: 'bad_request', message: v.error }, 400);
      let out;
      try {
        out = await chatClaude(env, v);
      } catch (e) {
        const msg = (e && e.message) || String(e);
        await logAdmin(db, user.id, '[chat]', '[失敗] ' + msg, 0, 0);
        return json({ error: 'claude_failed', message: msg }, 502);
      }
      // 稽核：記下這一輪模型決定呼叫了哪些工具與參數
      const calls = out.content.filter(c => c.type === 'tool_use');
      for (const c of calls) await logTool(db, user.id, c.name, c.input, true, 'requested');
      const text = out.content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
      await logAdmin(db, user.id, JSON.stringify(v.messages.slice(-1)).slice(0, 2000),
                     text || ('[tool_use] ' + calls.map(c => c.name).join(',')), out.tokens_in, out.tokens_out);
      return json({
        content: out.content, stop_reason: out.stop_reason, model: out.model,
        tokens: { in: out.tokens_in, out: out.tokens_out },
      });
    }

    if (p === '/admin/tasks' && req.method === 'GET') {
      return json({ tasks: await listTasks(db, null, 50) });
    }
    if (p === '/admin/tasks' && req.method === 'POST') {
      // action 必須是 index.js runDueTasks 實作過的白名單,否則會建檔成功、
      // 到期才失敗,管理員得翻資料表才知道打錯字
      const TASK_ACTIONS = ['notify'];
      if (TASK_ACTIONS.indexOf(String(body.action || '')) < 0) {
        return json({ error: 'bad_request', message: 'action 只能是：' + TASK_ACTIONS.join('、') }, 400);
      }
      const t = await createTask(db, user.id, {
        title: body.title, action: String(body.action || ''),
        params: body.params || {}, run_at: +body.run_at || 0, repeat_s: +body.repeat_s || 0,
      });
      await logTool(db, user.id, 'schedule_task', body, true, t.id);
      return json({ task: t });
    }
    if (p === '/admin/toollog' && req.method === 'GET') {
      return json({ log: await listToolLog(db, 50) });
    }

    return json({ error: 'not_found', message: '沒有這個後台端點' }, 404);
  } catch (e) {
    return json({ error: 'server_error', message: (e && e.message) || String(e) }, 500);
  }
}
