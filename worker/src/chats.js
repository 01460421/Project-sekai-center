/* AI 助手的對話持久化（/api/chats*）。

   由 api.js 掛上來,呼叫慣例與 handleApi 一致：不是自己的路就回 null。

   為什麼 SQL 寫在這裡而不是 db.js：
     這兩張表只有這支模組會碰,而且每支查詢都必須帶 user_id（見下面 IDOR 那段）。
     把「取得 + 權限條件」綁在同一個地方,比拆到 db.js 再讓呼叫端自己記得傳 user_id
     不容易漏。時間與 id 的產生方式仍然沿用 db.js,全站保持一致。

   IDOR：對外只有 chat id 這一個識別字,而 id 是 UUID 但不是密碼。
     所以每一支 SELECT / UPDATE / DELETE 都寫死 `AND user_id = ?`，
     不是「先查出來再比對」——查得到但不是你的,一律當作 not_found。 */

import { corsHeaders, preflight } from './cors.js';
import { now, newId } from './db.js';

/* ---------- 上限 ----------
   全部都是為了同一件事：D1 是共用資源,不能讓單一使用者塞爆。
   三道關卡各擋一種塞法：對話開太多、單一對話太長、單則訊息太肥。 */
const MAX_CHATS         = 50;            // 每人對話數
const MAX_MSGS_PER_CHAT = 400;           // 每則對話的訊息數
const MAX_CHAT_CHARS    = 1024 * 1024;   // 每則對話的內容總量（約 1 MB）
const MAX_CONTENT       = 64 * 1024;     // 單則訊息的 content JSON
const MAX_BATCH         = 50;            // 一次追加幾則
const MAX_BODY          = 512 * 1024;    // 請求 body。對話帶著 tool_result,比其他端點大得多
const TITLE_LEN         = 40;            // 自動標題取前幾字
const LIST_LIMIT        = 50;            // 列表預設筆數

/* ---------- 回應 ---------- */

/* 與 api.js 的 json() 同一個形狀：JSON ＋ CORS ＋ no-store。
   帶 session 的東西不能被中間層快取,否則 A 的對話會被送給 B。 */
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

const one = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).first()) || null;
const all = async (db, sql, ...a) => ((await db.prepare(sql).bind(...a).all()).results || []);
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();

/* 讀 body。前端送什麼都不能信,先擋大小再解析。
   刻意抄 api.js 的 readJson 形狀（回 { value } / { tooBig } / { bad }）,
   兩邊的錯誤碼才會一致；不共用是因為 api.js 沒有匯出它。
   Content-Length 只是「快篩」——它可以造假,所以拿到 body 之後還要再量一次。 */
async function readJson(req, max) {
  const cap = max || MAX_BODY;
  const declared = Number(req.headers.get('Content-Length') || 0);
  if (declared > cap) return { tooBig: true };
  const buf = await req.arrayBuffer();
  if (buf.byteLength > cap) return { tooBig: true };
  if (!buf.byteLength) return { value: {} };
  try {
    return { value: JSON.parse(new TextDecoder().decode(buf)) };
  } catch (e) {
    return { bad: true };
  }
}

/* 驗證並正規化訊息陣列。
   content 可以是字串,也可以是 content block 陣列（tool_use / tool_result 就長這樣）,
   兩種都要收。區塊內容本身不解讀——那是 Claude API 的格式,後端多管只會擋到新的區塊型別；
   但至少要求每個區塊是物件且有 type,免得把純垃圾存進去、下次送回 Claude 才炸。

   接受兩種 body：直接是陣列,或 { messages: [...] }。前端兩種寫法都很自然,不值得為此回 400。 */
function normaliseMessages(input) {
  const arr = Array.isArray(input) ? input
            : (isObj(input) && Array.isArray(input.messages) ? input.messages : null);
  if (!arr) return { error: 'bad_messages' };
  if (arr.length > MAX_BATCH) return { error: 'too_many_messages', limit: MAX_BATCH, status: 413 };

  const list = [];
  for (const m of arr) {
    if (!isObj(m)) return { error: 'bad_message' };
    if (m.role !== 'user' && m.role !== 'assistant') return { error: 'bad_role' };
    const c = m.content;
    if (typeof c !== 'string' && !Array.isArray(c)) return { error: 'bad_content' };
    if (Array.isArray(c)) {
      for (const b of c) {
        if (!isObj(b) || typeof b.type !== 'string') return { error: 'bad_block' };
      }
    }
    const text = JSON.stringify(c);
    if (text.length > MAX_CONTENT) return { error: 'message_too_large', limit: MAX_CONTENT, status: 413 };
    list.push({ role: m.role, content: text, chars: text.length });
  }
  return { list };
}

/* 自動標題：第一則「有文字的」使用者訊息的前 N 字。
   只帶 tool_result 的使用者訊息沒有可讀文字,跳過去找下一則,
   不然列表上會出現一整排看不出是什麼的對話。 */
function titleFrom(list) {
  for (const m of list) {
    if (m.role !== 'user') continue;
    let raw;
    try { raw = JSON.parse(m.content); } catch (e) { continue; }
    const text = typeof raw === 'string'
      ? raw
      : (Array.isArray(raw) ? raw.filter(b => b && b.type === 'text' && typeof b.text === 'string')
                                 .map(b => b.text).join(' ') : '');
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t) return t.slice(0, TITLE_LEN);
  }
  return '';
}

/* 對外的形狀。title 存的是空字串代表「還沒取到標題」,但前端每次都要有東西可以顯示,
   所以在出口補上預設值,而不是在資料表裡寫死——寫死的話之後就分不出「使用者真的
   把標題改成這四個字」和「系統還沒取到」。 */
const shapeChat = c => ({
  id: c.id,
  title: c.title || '新對話',
  msg_count: c.msg_count || 0,
  chars: c.chars || 0,
  created_at: c.created_at,
  updated_at: c.updated_at,
});

function shapeMessage(r) {
  let content;
  // 存進去的一定是合法 JSON,但舊資料/人工改過的列不該讓整支 API 掛掉
  try { content = JSON.parse(r.content); } catch (e) { content = String(r.content || ''); }
  return { id: r.id, role: r.role, content, seq: r.seq, created_at: r.created_at };
}

/* 追加訊息。額度一律用 chat_messages 現算,不看 chats 上的快取欄位——
   快取一旦漂移,拿它當上限就會變成「明明滿了還讓你寫」或反過來。
   一次查詢同時拿到三件事：現有筆數、下一個 seq、已用字元數。 */
async function appendMessages(db, chat, list) {
  const add = list.reduce((n, m) => n + m.chars, 0);
  const t = now();

  /* 額度檢查必須和寫入在同一個原子動作裡。原本的寫法是「先 SELECT 現況、
     判斷、再寫入」—— 並發時每個請求都讀到爆發前的數字,於是全部通過檢查、
     全部寫進去,上限等於形同虛設。D1 是全站共用的,被灌爆之後連登入建檔、
     寫 events 都會失敗,不是重啟能救的。

     改成把條件放進 UPDATE 的 WHERE：資料庫自己保證同一列的更新是序列化的,
     只有真的還在額度內的那一次會成功（changes === 1）,其餘自然落空。
     計數用 msg_count/chars 這兩個快取欄位遞增,不再每次回頭掃 chat_messages。 */
  const gate = await db.prepare(
    `UPDATE chats SET msg_count = msg_count + ?, chars = chars + ?, updated_at = ?,
            title = CASE WHEN title = '' THEN ? ELSE title END
     WHERE id = ? AND user_id = ?
       AND msg_count + ? <= ? AND chars + ? <= ?`)
    .bind(list.length, add, t, titleFrom(list), chat.id, chat.user_id,
          list.length, MAX_MSGS_PER_CHAT, add, MAX_CHAT_CHARS)
    .run();

  const okRows = (gate && gate.meta && gate.meta.changes) || 0;
  if (!okRows) {
    // 沒更新到：不是超過訊息數上限就是超過字元上限,回頭讀一次現況給出正確的錯誤
    const cur = await one(db, 'SELECT msg_count, chars FROM chats WHERE id = ? AND user_id = ?', chat.id, chat.user_id);
    if (!cur) return { error: 'not_found' };
    if ((cur.msg_count || 0) + list.length > MAX_MSGS_PER_CHAT) {
      return { error: 'message_limit', limit: MAX_MSGS_PER_CHAT, have: cur.msg_count || 0 };
    }
    return { error: 'chat_too_large', limit: MAX_CHAT_CHARS, used: cur.chars || 0 };
  }

  /* 額度拿到了才寫訊息。seq 直接用更新後的 msg_count 回推,不再用 MAX(seq)+1 ——
     那個做法在並發下會算出相同的 seq,讓對話順序錯亂。 */
  const after = await one(db, 'SELECT msg_count, chars, title FROM chats WHERE id = ? AND user_id = ?', chat.id, chat.user_id);
  const endSeq = (after && after.msg_count) || list.length;
  let seq = endSeq - list.length;

  const ins = db.prepare(
    'INSERT INTO chat_messages (id,chat_id,user_id,seq,role,content,created_at) VALUES (?,?,?,?,?,?,?)');
  await db.batch(list.map(m => ins.bind(newId(), chat.id, chat.user_id, seq++, m.role, m.content, t)));

  return { added: list.length, msg_count: endSeq, chars: (after && after.chars) || 0,
           updated_at: t, title: (after && after.title) || '' };
}

/* ---------- 主路由 ---------- */

export async function handleChats(req, env, url, user) {
  const p = url.pathname;
  // 只吃 /api/chats 與 /api/chats/...;/api/chat（既有的 Claude 代理）不能被誤收
  if (p !== '/api/chats' && !p.startsWith('/api/chats/')) return null;
  if (req.method === 'OPTIONS') return preflight(req, env);

  const out = (o, s) => json(o, s, req, env);

  /* 權限自己再擋一次。api.js 的主流程本來就會擋,但這支模組是被「掛上去」的,
     哪天掛的位置移到核准判斷之前,對話就會整個外露。這幾行是那個情況的保險。 */
  if (!user) return out({ error: 'unauthorized' }, 401);
  if (user.status !== 'approved') return out({ error: 'pending_approval', status: user.status }, 403);

  // D1 binding 沒掛好時要直接講明,不要偽裝成通用 500(照 dashboard.js 的作法)
  if (!env.DB) return json({ error: 'no_db', message: '資料庫尚未設定' }, 503, req, env);
  const db = env.DB;
  const m = req.method;

  // /api/chats/:id[/messages]。結尾多一條斜線視同集合,不必為此回 404
  const seg = p === '/api/chats' ? [] : p.slice('/api/chats/'.length).split('/').filter(Boolean);
  if (seg.length > 2) return out({ error: 'not_found' }, 404);
  let id = '', sub = '';
  if (seg.length) {
    try { id = decodeURIComponent(seg[0]); } catch (e) { id = seg[0]; }   // 壞的百分號編碼就原樣用,反正等下查不到
    sub = seg[1] || '';
    if (sub && sub !== 'messages') return out({ error: 'not_found' }, 404);
    if (!id || id.length > 64) return out({ error: 'bad_id' }, 400);
  }

  try {
    /* ---------- 集合：列表 / 建立 ---------- */
    if (!id) {
      if (m === 'GET') {
        const n = parseInt(url.searchParams.get('limit'), 10);
        const limit = Math.min(100, Math.max(1, Number.isFinite(n) ? n : LIST_LIMIT));
        const rows = await all(db,
          'SELECT * FROM chats WHERE user_id=? ORDER BY updated_at DESC LIMIT ?', user.id, limit);
        return out({ chats: rows.map(shapeChat), max: MAX_CHATS });
      }

      if (m === 'POST') {
        const b = await readJson(req, MAX_BODY);
        if (b.tooBig) return out({ error: 'payload_too_large', limit: MAX_BODY }, 413);
        if (b.bad) return out({ error: 'bad_json' }, 400);
        const body = isObj(b.value) ? b.value : {};

        // 先數再開。無上限的話,一支跑迴圈的前端就能把整個資料庫灌滿
        const c = await one(db, 'SELECT COUNT(*) AS n FROM chats WHERE user_id=?', user.id);
        if (((c && c.n) || 0) >= MAX_CHATS) return out({ error: 'chat_limit', limit: MAX_CHATS }, 409);

        // 第一則訊息可有可無：前端有時先開空對話,有時連問題一起送
        let list = [];
        if (body.messages != null) {
          const v = normaliseMessages(body.messages);
          if (v.error) return out({ error: v.error, limit: v.limit }, v.status || 400);
          list = v.list;
        }

        const t = now();
        const chatId = newId();
        const title = str(body.title, TITLE_LEN).replace(/\s+/g, ' ').trim() || titleFrom(list);
        await run(db,
          'INSERT INTO chats (id,user_id,title,msg_count,chars,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
          chatId, user.id, title, 0, 0, t, t);

        const chat = { id: chatId, user_id: user.id, title, msg_count: 0, chars: 0, created_at: t, updated_at: t };
        if (list.length) {
          const r = await appendMessages(db, chat, list);
          // 剛建的空對話一定塞得下這一批（MAX_BATCH < MAX_MSGS_PER_CHAT）,真的失敗就照實回
          if (r.error) return out({ error: r.error, limit: r.limit }, 413);
          Object.assign(chat, r);
        }
        return out({ ok: true, chat: shapeChat(chat) }, 201);
      }

      return out({ error: 'method_not_allowed' }, 405);
    }

    /* ---------- 單一對話：讀取 / 刪除 ---------- */
    if (!sub) {
      if (m === 'GET') {
        const c = await one(db, 'SELECT * FROM chats WHERE id=? AND user_id=?', id, user.id);
        if (!c) return out({ error: 'not_found' }, 404);
        const rows = await all(db,
          'SELECT * FROM chat_messages WHERE chat_id=? AND user_id=? ORDER BY seq, created_at', id, user.id);
        return out({ chat: { ...shapeChat(c), messages: rows.map(shapeMessage) } });
      }

      if (m === 'DELETE') {
        const c = await one(db, 'SELECT id FROM chats WHERE id=? AND user_id=?', id, user.id);
        if (!c) return out({ error: 'not_found' }, 404);
        // 連帶刪訊息。batch 是單一交易,不會留下沒有主人的訊息列
        await db.batch([
          db.prepare('DELETE FROM chat_messages WHERE chat_id=? AND user_id=?').bind(id, user.id),
          db.prepare('DELETE FROM chats WHERE id=? AND user_id=?').bind(id, user.id),
        ]);
        return out({ ok: true });
      }

      return out({ error: 'method_not_allowed' }, 405);
    }

    /* ---------- 追加訊息 ---------- */
    if (sub === 'messages') {
      if (m !== 'POST') return out({ error: 'method_not_allowed' }, 405);

      // 先確認對話是自己的,再讀 body：不是你的東西,沒必要先把 512 KB 收下來
      const c = await one(db, 'SELECT * FROM chats WHERE id=? AND user_id=?', id, user.id);
      if (!c) return out({ error: 'not_found' }, 404);

      const b = await readJson(req, MAX_BODY);
      if (b.tooBig) return out({ error: 'payload_too_large', limit: MAX_BODY }, 413);
      if (b.bad) return out({ error: 'bad_json' }, 400);

      const v = normaliseMessages(b.value);
      if (v.error) return out({ error: v.error, limit: v.limit }, v.status || 400);
      if (!v.list.length) return out({ error: 'no_messages' }, 400);

      const r = await appendMessages(db, c, v.list);
      if (r.error) return out({ error: r.error, limit: r.limit, have: r.have, used: r.used }, 413);
      return out({ ok: true, chat: shapeChat({ ...c, ...r }), added: r.added });
    }

    return out({ error: 'not_found' }, 404);
  } catch (e) {
    console.error('chats error', (e && e.stack) || e);
    // 只留一小段：夠查問題,又不至於把 SQL 或內部路徑整包吐給前端
    return out({ error: 'server_error', detail: String((e && e.message) || e).slice(0, 200) }, 500);
  }
}
