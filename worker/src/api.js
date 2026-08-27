/* 登入後的使用者 API（/api/*）。

   這裡只處理「使用者自己的東西」：身分、站上設定、偵測訂閱、觸發紀錄。
   管理員功能另外一支，權限判斷才不會混在同一個檔案裡互相干擾。

   跨來源：主站在 project-sekai-center.com、Worker 在 games.project-sekai-center.com，
   而 session 是 cookie，所以每個回應都得帶「具體」的 Allow-Origin —— 帶 credentials 時
   瀏覽器會直接拒絕 `*`。統一由 json() 補齊，不要逐路由重抄一遍。 */

import { allowOrigin, corsHeaders, preflight } from './cors.js';
import { chatClaude, validateChat } from './admin.js';
import { handleChats } from './chats.js';
import { WATCH_KINDS } from './watch.js';
import {
  applyNote, getUser, unlinkDiscord,
  getPrefs, setPrefs,
  listWatches, createWatch, updateWatch, deleteWatch,
  listEvents,
  logAdmin,
  logTool,
  aiUsedToday,
  createTask,
  unreadCount,
  markRead} from './db.js';

const KINDS = ['border', 'player', 'team', 'schedule'];
const MAX_WATCHES = 20;            // 每人上限,免得有人開一百個把掃描迴圈拖垮
const MAX_BODY = 32 * 1024;        // 一般請求
const MAX_PREFS = 256 * 1024;      // 設定整包上限,避免有人拿 D1 當雲端硬碟
const MAX_PARAMS = 8 * 1024;       // 單一 watch 的 params
const MAX_PREF_KEYS = 200;

/* 全站唯一的回應出口：JSON ＋ CORS ＋ no-store（帶 session 的東西不能被中間層快取）。 */
function json(obj, status, req, env) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsHeaders(req, env),
    },
  });
}

/* ---------- 小工具 ---------- */

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

/* 讀 body。前端送什麼都不能信,先擋大小再解析;
   回 { value } / { tooBig } / { bad },讓呼叫端決定要回哪種錯誤碼。 */
async function readJson(req, max) {
  const cap = max || MAX_BODY;
  const declared = Number(req.headers.get('Content-Length') || 0);
  if (declared > cap) return { tooBig: true };
  const buf = await req.arrayBuffer();
  if (buf.byteLength > cap) return { tooBig: true };
  if (!buf.byteLength) return { value: {} };
  try {
    const v = JSON.parse(new TextDecoder().decode(buf));
    return { value: v };
  } catch (e) {
    return { bad: true };
  }
}

/* 回給前端的使用者資料。google_sub 是內部識別鍵,不外流。 */
function shapeUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email || '',
    name: u.name || '',
    picture: u.picture || '',
    status: u.status || 'pending',
    is_admin: !!u.is_admin,
    apply_note: u.apply_note || '',
    discord: u.discord_id ? { id: u.discord_id, name: u.discord_name || '' } : null,
    created_at: u.created_at,
  };
}

/* params 在 D1 裡是字串,前端要的是物件;last_state 純屬內部比對用,不外送。 */
function shapeWatch(w) {
  let params = {};
  try { params = JSON.parse(w.params); } catch (e) { /* 舊資料壞了就當空物件 */ }
  return {
    id: w.id,
    kind: w.kind,
    name: w.name || '',
    params,
    enabled: !!w.enabled,
    cooldown_s: w.cooldown_s,
    last_fired: w.last_fired || null,
    created_at: w.created_at,
  };
}

const shapeEvent = e => ({
  id: e.id,
  watch_id: e.watch_id,
  title: e.title || '',
  body: e.body || '',
  created_at: e.created_at,
  mailed_at: e.mailed_at || null,
  mail_error: e.mail_error || null,
  read_at: e.read_at || null,
});

const clampCooldown = v => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return 3600;
  return Math.min(86400, Math.max(60, n));
};

/* ---------- 主路由 ---------- */

export async function handleApi(req, env, url, user) {
  const p = url.pathname;
  if (!p.startsWith('/api/') && p !== '/api') return null;   // 不是我的路,交還給呼叫端
  if (req.method === 'OPTIONS') return preflight(req, env);

  const out = (o, s) => json(o, s, req, env);
  const m = req.method;

  try {
    /* /api/me 一律 200：未登入回 { user: null },前端不必為了「還沒登入」去 catch 401 */
    if (p === '/api/me') {
      if (m !== 'GET') return out({ error: 'method_not_allowed' }, 405);
      return out({ user: shapeUser(user) });
    }

    /* 偵測規格。前端靠它動態產生表單 —— 規格寫在後端,新增偵測種類時
       前端不必跟著改。不需要核准就能看,讓人先知道能訂什麼再決定要不要申請。 */
    if (p === '/api/watch-kinds') {
      if (m !== 'GET') return out({ error: 'method_not_allowed' }, 405);
      /* 一併回報站方的能力狀態：沒設定 Resend 就寄不出信,訂閱會建立成功但
         沒有人收得到通知。與其讓使用者等一封永遠不來的信,不如在介面上講明。 */
      return out({ kinds: WATCH_KINDS, capabilities: {
        mail: !!env.RESEND_API_KEY,
        ai: !!env.ANTHROPIC_API_KEY,
        discord: !!env.DISCORD_CLIENT_ID,
      } });
    }

    // 以下都要登入
    if (!user) return out({ error: 'unauthorized' }, 401);

    /* 對話存檔自成一個模組。放在登入檢查之後、核准檢查之前,
       由 chats.js 自己決定要不要求核准。 */
    if (p === '/api/chats' || p.startsWith('/api/chats/')) {
      const r = await handleChats(req, env, url, user);
      if (r) return r;
    }

    if (p === '/api/apply') {
      if (m !== 'POST') return out({ error: 'method_not_allowed' }, 405);
      if (user.status === 'rejected') return out({ error: 'rejected' }, 403);
      const b = await readJson(req);
      if (b.tooBig) return out({ error: 'payload_too_large' }, 413);
      if (b.bad) return out({ error: 'bad_json' }, 400);
      // 已核准的人再送一次就當沒事發生（db 層本來就只改 pending 的列）
      await applyNote(env.DB, user.id, str(b.value.note, 500).trim());
      return out({ ok: true, status: user.status });
    }

    /* 除了上面兩支,其餘功能都要管理員核准過。回 403 ＋ 固定錯誤碼,
       前端看到就切「等待審核」畫面,不用再猜是哪種失敗。 */
    if (user.status !== 'approved') return out({ error: 'pending_approval', status: user.status }, 403);

    /* ---------- 站上設定同步 ---------- */
    if (p === '/api/prefs') {
      if (m === 'GET') return out({ prefs: await getPrefs(env.DB, user.id) });
      if (m === 'POST') {
        const b = await readJson(req, MAX_PREFS);
        if (b.tooBig) return out({ error: 'payload_too_large', limit: MAX_PREFS }, 413);
        if (b.bad) return out({ error: 'bad_json' }, 400);
        if (!isObj(b.value)) return out({ error: 'bad_prefs' }, 400);
        const keys = Object.keys(b.value);
        if (keys.length > MAX_PREF_KEYS) return out({ error: 'too_many_keys', limit: MAX_PREF_KEYS }, 413);
        const n = await setPrefs(env.DB, user.id, b.value);
        return out({ ok: true, keys: n });
      }
      return out({ error: 'method_not_allowed' }, 405);
    }

    /* ---------- 偵測訂閱 ---------- */
    if (p === '/api/watches') {
      if (m === 'GET') {
        const rows = await listWatches(env.DB, user.id);
        return out({ watches: rows.map(shapeWatch), max: MAX_WATCHES });
      }

      if (m === 'POST') {
        const b = await readJson(req);
        if (b.tooBig) return out({ error: 'payload_too_large' }, 413);
        if (b.bad) return out({ error: 'bad_json' }, 400);
        const w = b.value;
        if (KINDS.indexOf(w.kind) < 0) return out({ error: 'bad_kind', allowed: KINDS }, 400);
        if (!isObj(w.params)) return out({ error: 'bad_params' }, 400);
        if (JSON.stringify(w.params).length > MAX_PARAMS) return out({ error: 'params_too_large' }, 413);
        // 先數再開。掃描迴圈要跑遍所有啟用中的 watch,人均無上限就會被少數人拖垮
        const have = await listWatches(env.DB, user.id);
        if (have.length >= MAX_WATCHES) return out({ error: 'watch_limit', limit: MAX_WATCHES }, 409);
        const row = await createWatch(env.DB, user.id, {
          kind: w.kind,
          name: str(w.name, 80),
          params: w.params,
          enabled: w.enabled !== false,
          cooldown_s: clampCooldown(w.cooldown_s),
        });
        return out({ ok: true, watch: shapeWatch(row) }, 201);
      }

      if (m === 'PATCH') {
        const b = await readJson(req);
        if (b.tooBig) return out({ error: 'payload_too_large' }, 413);
        if (b.bad) return out({ error: 'bad_json' }, 400);
        const body = b.value;
        const id = str(url.searchParams.get('id') || body.id, 64);
        if (!id) return out({ error: 'missing_id' }, 400);
        // 只挑認得的欄位進 patch;kind 建立後不給改,params 的意義是綁在 kind 上的
        const patch = {};
        if (body.name != null) patch.name = str(body.name, 80);
        if (body.params != null) {
          if (!isObj(body.params)) return out({ error: 'bad_params' }, 400);
          if (JSON.stringify(body.params).length > MAX_PARAMS) return out({ error: 'params_too_large' }, 413);
          patch.params = body.params;
        }
        if (body.enabled != null) patch.enabled = !!body.enabled;
        if (body.cooldown_s != null) patch.cooldown_s = clampCooldown(body.cooldown_s);
        const row = await updateWatch(env.DB, user.id, id, patch);   // db 層已含 user_id 條件,不會改到別人的
        if (!row) return out({ error: 'not_found' }, 404);
        return out({ ok: true, watch: shapeWatch(row) });
      }

      if (m === 'DELETE') {
        let id = str(url.searchParams.get('id'), 64);
        if (!id) {
          const b = await readJson(req);          // 有些前端習慣把 id 放 body
          if (b.value && b.value.id) id = str(b.value.id, 64);
        }
        if (!id) return out({ error: 'missing_id' }, 400);
        const r = await deleteWatch(env.DB, user.id, id);
        const changed = r && r.meta ? r.meta.changes : 1;
        if (!changed) return out({ error: 'not_found' }, 404);
        return out({ ok: true });
      }

      return out({ error: 'method_not_allowed' }, 405);
    }

    /* ---------- 觸發紀錄 ---------- */
    /* 站內助手。開放給「已核准」的一般使用者 —— 核准本身就是管理員的許可。
       工具在瀏覽器執行,Worker 只代理 Claude API 並記帳。
       每日上限:一般使用者 40 次、管理員 200 次。一次對話會來回好幾輪,
       所以這裡算的是「請求數」不是「問題數」。 */
    if (p === '/api/chat' && req.method === 'POST') {
      if (!env.ANTHROPIC_API_KEY) return json({ error: 'no_key', message: '站方尚未設定 AI 金鑰' }, 503, req, env);
      const cap = user.is_admin ? 200 : 40;
      const used = await aiUsedToday(env.DB, user.id);
      if (used >= cap) {
        return json({ error: 'quota', message: '今日 AI 用量已達上限（' + cap + ' 次），請明天再試。' }, 429, req, env);
      }
      const rb = await readJson(req, 512 * 1024);   // 對話帶著工具結果,body 會比其他端點大
      if (rb.tooBig) return out({ error: 'payload_too_large', message: '對話內容過大，請按「清除」開新對話' }, 413);
      if (rb.bad) return out({ error: 'bad_json', message: 'JSON 格式錯誤' }, 400);
      const v = validateChat(rb.value || {});
      if (v.error) return out({ error: 'bad_request', message: v.error }, 400);
      /* 這個變數原本叫 out,把上面那個回應 helper 遮蔽掉了 —— let 的 TDZ 涵蓋整個
         區塊,所以上面兩行的 out(...) 會拋 ReferenceError 而不是回 413/400,
         被外層 catch 吞成一個看不出原因的 500。 */
      let reply;
      try {
        reply = await chatClaude(env, v);
      } catch (e) {
        const msg = (e && e.message) || String(e);
        await logAdmin(env.DB, user.id, '[chat]', '[失敗] ' + msg, 0, 0);
        return json({ error: 'claude_failed', message: msg }, 502, req, env);
      }
      const calls = (reply.content || []).filter(c => c.type === 'tool_use');
      for (const c of calls) await logTool(env.DB, user.id, c.name, c.input, true, 'requested');
      const text = (reply.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
      await logAdmin(env.DB, user.id, JSON.stringify(v.messages.slice(-1)).slice(0, 2000),
                     text || ('[tool_use] ' + calls.map(c => c.name).join(',')), reply.tokens_in, reply.tokens_out);
      return json({
        content: reply.content, stop_reason: reply.stop_reason, model: reply.model,
        quota: { used: used + 1, cap },
      }, 200, req, env);
    }

    /* 站內通知的已讀標記。id 不給就是「全部標為已讀」。 */
    if (p === '/api/events/read' && m === 'POST') {
      const b = await readJson(req);
      if (b.bad) return out({ error: 'bad_json' }, 400);
      const id = str((b.value || {}).id, 64);
      await markRead(env.DB, user.id, id || null);
      return out({ ok: true, unread: await unreadCount(env.DB, user.id) });
    }

    if (p === '/api/events') {
      if (m !== 'GET') return out({ error: 'method_not_allowed' }, 405);
      const n = parseInt(url.searchParams.get('limit'), 10);
      const limit = Math.min(100, Math.max(1, Number.isFinite(n) ? n : 30));
      const rows = await listEvents(env.DB, user.id, limit);
      // 一併回未讀數,前端才不用為了那個紅點再打一次
      return out({ events: rows.map(shapeEvent), unread: await unreadCount(env.DB, user.id) });
    }

    /* ---------- Discord 解綁 ---------- */
    if (p === '/api/discord/unlink') {
      if (m !== 'POST') return out({ error: 'method_not_allowed' }, 405);
      await unlinkDiscord(env.DB, user.id);
      return out({ ok: true, user: shapeUser(await getUser(env.DB, user.id)) });
    }

    return out({ error: 'not_found' }, 404);
  } catch (e) {
      console.error('api error', e && e.stack || e);
    // 例外訊息只留一小段：夠查問題,又不至於把 SQL 或內部路徑整包吐出去
    return out({ error: 'server_error', detail: String((e && e.message) || e).slice(0, 200) }, 500);
  }
}
