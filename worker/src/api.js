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
  getUser, unlinkDiscord,
  saveApplication, issueNonce, bumpVerifyTry, bindGameUid,
  getCredits, spendCredit, createOrder, listOrders, cancelOrder,
  getPrefs, setPrefs,
  listWatches, createWatch, updateWatch, deleteWatch,
  listEvents,
  logAdmin,
  logTool,
  aiUsedToday,
  createTask,
  unreadCount,
  markRead,
  aiUsedTodaySite,
  listThreads, getThread, listPosts, createThread, addPost, lastPostedAt, setThreadFlag, deletePost, getPost,
  addEvent} from './db.js';
import { sanitizeNote, fetchProfile, makeNonce, wordHasNonce } from './review.js';

const KINDS = ['border', 'player', 'team', 'schedule'];
const MAX_WATCHES = 20;            // 每人上限,免得有人開一百個把掃描迴圈拖垮
const MAX_BODY = 32 * 1024;        // 一般請求
const MAX_PREFS = 256 * 1024;      // 設定整包上限,避免有人拿 D1 當雲端硬碟
const MAX_PARAMS = 8 * 1024;       // 單一 watch 的 params
const MAX_PREF_KEYS = 200;
const APPLY_COOLDOWN = 60;         // 兩次送出之間至少隔這麼久（秒）
const APPLY_MAX = 10;              // 每個帳號累計送出上限
const NONCE_TTL = 15 * 60;         // 驗證碼有效期
const VERIFY_TRIES = 5;            // 每張驗證碼可比對幾次（每次都要打外部 API）
const VERIFY_TOTAL = 40;           // 累計比對上限,換新碼不會歸零

/* AI 點數方案（beta）。定價的基準是實測成本:站上每次助手呼叫平均
   in 約 20,700 / out 約 1,400 tokens,以 Opus 5 的 $5/$25 per MTok 計約 US$0.1385,
   換算約 NT$4.4。**低於這個單價就是每賣一點虧一點** —— 有 prompt 快取時實際會低一些,
   但快取只在同一段對話連續提問時才命中,不能當成常態。
   方案要改就設環境變數 AI_PLANS（JSON 陣列,欄位同下）,不必改程式碼。
   價格與點數一律以伺服器端的這份為準,前端送什麼都不信。 */
const AI_PLANS_DEFAULT = [
  { id: 'trial', name: '體驗包', points: 50, price: 300, currency: 'TWD' },
  { id: 'std', name: '標準包', points: 200, price: 1000, currency: 'TWD' },
  { id: 'bulk', name: '大包', points: 600, price: 2700, currency: 'TWD' },
];
function aiPlans(env) {
  if (env.AI_PLANS) {
    try {
      const v = JSON.parse(env.AI_PLANS);
      if (Array.isArray(v) && v.length) {
        return v.filter(x => x && x.id && +x.points > 0 && +x.price >= 0)
          .map(x => ({ id: String(x.id), name: String(x.name || x.id),
            points: Math.floor(+x.points), price: Math.floor(+x.price),
            currency: String(x.currency || 'TWD') }));
      }
    } catch (e) { /* 設壞了就退回預設,不要讓整個端點掛掉 */ }
  }
  return AI_PLANS_DEFAULT;
}

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

/* 申請者自己看得到的審核狀態。只回一個粗略字串,不回細節。 */
function reviewState(j) {
  if (!j) return '';
  try {
    const v = JSON.parse(j).verdict;
    if (v === 'auto_approved') return 'passed';
    if (v === 'hard_fail') return 'failed';
    if (v === 'unknown') return 'retry';
    return 'manual';
  } catch (e) { return ''; }
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
    apply_uid: u.apply_uid || '',
    apply_level: u.apply_level == null ? null : +u.apply_level,
    /* 驗證碼要給本人看（他得貼進遊戲內自我介紹）。過期的就不送了,
       免得前端顯示一組已經沒用的碼讓人白忙。 */
    verify_nonce: (u.verify_nonce && u.verify_expire > Math.floor(Date.now() / 1000)) ? u.verify_nonce : '',
    verify_expire: u.verify_expire || null,
    uid_verified: !!(u.game_uid && u.apply_uid && u.game_uid === u.apply_uid),
    /* 只給粗略狀態。AI 的個別標記不外送 —— 讓申請者知道是哪一條標記絆住他,
       等於教他怎麼改寫才能通過。 */
    review_state: reviewState(u.review_json),
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
    /* ---------- 提問所／討論串 ----------
       讀不需要登入(公開看得到才有人回答);寫要「已核准」的帳號,跟站上其他功能一致。
       文字一律過 sanitizeNote(去不可見字元、正規化),長度上限與站內通知同一組數字。 */
    if (p === '/api/qa' || p.startsWith('/api/qa/')) {
      const QA_COOLDOWN = 60, TITLE_MAX = 80, BODY_MAX = 4000;
      const seg = p.split('/').filter(Boolean);          // ['api','qa', id?, action?, pid?]
      const id = str(seg[2] || '', 64), action = str(seg[3] || '', 16), pid = str(seg[4] || '', 64);
      const needWrite = () => {
        if (!user) return out({ error: 'not_signed_in', message: '請先登入' }, 401);
        if (user.status !== 'approved') return out({ error: 'pending_approval', status: user.status, message: '帳號尚未核准' }, 403);
        return null;
      };
      const shape = t => t && ({
        id: t.id, kind: t.kind, title: t.title, body: t.body, preview: t.preview, author: t.author, author_admin: !!t.author_admin,
        mine: !!(user && t.user_id === user.id), created_at: t.created_at, updated_at: t.updated_at,
        reply_count: t.reply_count, last_reply_at: t.last_reply_at, solved: !!t.solved, locked: !!t.locked });

      if (!id) {
        if (m === 'GET') {
          const kind = url.searchParams.get('kind') === 'discussion' ? 'discussion' : 'question';
          const before = parseInt(url.searchParams.get('before'), 10);
          const rows = await listThreads(env.DB, kind, 30, Number.isFinite(before) ? before : null);
          return out({ threads: rows.map(shape), can_post: !!(user && user.status === 'approved') });
        }
        if (m === 'POST') {
          const deny = needWrite(); if (deny) return deny;
          const b = await readJson(req); if (b.bad) return out({ error: 'bad_json' }, 400);
          const v = b.value || {};
          const kind = v.kind === 'discussion' ? 'discussion' : 'question';
          const title = sanitizeNote(str(v.title, TITLE_MAX)).text.trim();
          const body = sanitizeNote(str(v.body, BODY_MAX)).text.trim();
          if (title.length < 2) return out({ error: 'bad_title', message: '標題至少 2 個字' }, 400);
          if (body.length < 2) return out({ error: 'bad_body', message: '內容至少 2 個字' }, 400);
          const last = await lastPostedAt(env.DB, user.id);
          if (Date.now() / 1000 - last < QA_COOLDOWN) return out({ error: 'cooldown', message: '發文間隔至少 ' + QA_COOLDOWN + ' 秒' }, 429);
          const tid = await createThread(env.DB, user.id, kind, title, body);
          return out({ ok: true, id: tid });
        }
        return out({ error: 'method_not_allowed' }, 405);
      }

      const t = await getThread(env.DB, id);
      if (!t) return out({ error: 'not_found' }, 404);
      const isAdmin = !!(user && user.is_admin), isOwner = !!(user && user.id === t.user_id);

      if (!action) {
        if (m !== 'GET') return out({ error: 'method_not_allowed' }, 405);
        const posts = await listPosts(env.DB, id);
        return out({ thread: shape(t), can_post: !!(user && user.status === 'approved') && !t.locked, is_admin: isAdmin,
          posts: posts.map(x => ({ id: x.id, body: x.deleted ? '' : x.body, deleted: !!x.deleted, author: x.author,
            author_admin: !!x.author_admin, mine: !!(user && x.user_id === user.id), created_at: x.created_at })) });
      }
      if (m !== 'POST') return out({ error: 'method_not_allowed' }, 405);

      if (action === 'reply') {
        const deny = needWrite(); if (deny) return deny;
        if (t.locked) return out({ error: 'locked', message: '這個主題已鎖定' }, 403);
        const b = await readJson(req); if (b.bad) return out({ error: 'bad_json' }, 400);
        const body = sanitizeNote(str((b.value || {}).body, BODY_MAX)).text.trim();
        if (body.length < 1) return out({ error: 'bad_body', message: '內容不能是空的' }, 400);
        const last = await lastPostedAt(env.DB, user.id);
        if (Date.now() / 1000 - last < QA_COOLDOWN) return out({ error: 'cooldown', message: '發文間隔至少 ' + QA_COOLDOWN + ' 秒' }, 429);
        const pidNew = await addPost(env.DB, user.id, id, body);
        /* 通知原作者:純站內(no_mail),watch_id 用 qa: 前綴讓助手快照能整段排除 */
        if (t.user_id !== user.id) {
          try { await addEvent(env.DB, { watch_id: 'qa:' + id, user_id: t.user_id, no_mail: 1,
            title: '你的' + (t.kind === 'question' ? '提問' : '討論') + '有新回覆：' + t.title.slice(0, 40),
            body: (user.name || '有人') + '：' + body.slice(0, 200) }); } catch (e) {}
        }
        return out({ ok: true, id: pidNew });
      }
      if (action === 'solve') {                       // 作者或管理員都能標／取消「已解決」
        if (!isOwner && !isAdmin) return out({ error: 'forbidden' }, 403);
        await setThreadFlag(env.DB, id, 'solved', !t.solved);
        return out({ ok: true, solved: !t.solved });
      }
      if (action === 'lock') {
        if (!isAdmin) return out({ error: 'forbidden' }, 403);
        await setThreadFlag(env.DB, id, 'locked', !t.locked);
        return out({ ok: true, locked: !t.locked });
      }
      if (action === 'delete') {
        if (!isOwner && !isAdmin) return out({ error: 'forbidden' }, 403);
        await setThreadFlag(env.DB, id, 'deleted', 1);
        return out({ ok: true });
      }
      if (action === 'post' && pid) {                 // /api/qa/:id/post/:pid → 刪除單則回覆
        const po = await getPost(env.DB, pid);
        if (!po || po.thread_id !== id) return out({ error: 'not_found' }, 404);
        if (!isAdmin && !(user && user.id === po.user_id)) return out({ error: 'forbidden' }, 403);
        await deletePost(env.DB, pid);
        return out({ ok: true });
      }
      return out({ error: 'not_found' }, 404);
    }

    if (p === '/api/me') {
      if (m !== 'GET') return out({ error: 'method_not_allowed' }, 405);
      const u2 = shapeUser(user);
      /* 點數餘額只在 beta 開著時才查。這支端點每次載入頁面都會打,
         沒開的時候不該為了一個不會顯示的數字多打一次 D1。 */
      if (u2 && String(env.CREDITS_BETA || '') === '1') {
        const c = await getCredits(env.DB, user.id);
        u2.credits = (c && c.balance) || 0;
        u2.credits_beta = true;
      }
      return out({ user: u2 });
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

    /* 送出申請。三個欄位:玩家等級、玩家 id、想說的一句話(選填)。
       這支端點會觸發一次外部抓取,而稍後的背景審核還會再打一次 AI ——
       所以冷卻與次數上限不是防呆,是防帳單:沒有它,任何一個登入中的
       pending 帳號寫個迴圈就能一直燒站方的錢。 */
    if (p === '/api/apply') {
      if (m !== 'POST') return out({ error: 'method_not_allowed' }, 405);
      if (user.status === 'rejected') return out({ error: 'rejected' }, 403);
      if (user.status === 'approved') return out({ ok: true, status: 'approved' });
      const b = await readJson(req);
      if (b.tooBig) return out({ error: 'payload_too_large' }, 413);
      if (b.bad) return out({ error: 'bad_json' }, 400);
      const v = isObj(b.value) ? b.value : {};

      const uid = String(v.uid == null ? '' : v.uid).replace(/\D/g, '');
      if (!/^\d{15,20}$/.test(uid)) {
        return out({ error: 'bad_uid', message: '玩家 id 應為 15～20 位數字，可在遊戲內個人檔案查到' }, 400);
      }
      const lv = Math.floor(Number(v.level));
      if (!(lv >= 1 && lv <= 999)) {
        return out({ error: 'bad_level', message: '玩家等級應為 1～999 的整數' }, 400);
      }
      const note = sanitizeNote(v.note);

      /* 驗證通過才扣冷卻與次數 —— 打錯字不該消耗使用者的重試機會。 */
      const saved = await saveApplication(env.DB, user.id,
        { uid, level: lv, note: note.text, dropped: note.dropped }, APPLY_COOLDOWN, APPLY_MAX);
      if (!saved) {
        return out({ error: 'too_frequent',
          message: '送出太頻繁，或已達送出次數上限（' + APPLY_MAX + ' 次）。請稍候再試，或聯絡管理員。' }, 429);
      }

      /* 硬性檢查同步做:實測這支外部 API 約 0.2 秒,使用者當場就知道 id 是不是打錯了,
         可以立刻改。真正花時間的 AI 判斷才丟到背景。外部 API 出問題時回 unknown,
         照樣收下申請 —— 別人的服務壞掉不該變成使用者眼中的失敗。 */
      const pf = await fetchProfile(uid);

      await createTask(env.DB, user.id, {
        title: '申請自動審核', action: 'review_apply',
        params: { user_id: user.id }, run_at: 0, repeat_s: 0,
      });

      return out({ ok: true, status: 'pending',
        check: {
          exists: pf.exists,
          reason: pf.reason || '',
          api_level: pf.rank == null ? null : pf.rank,
          level_match: (pf.exists === 'yes' && pf.rank != null)
            ? (lv <= pf.rank || Math.abs(lv - pf.rank) <= 5) : null,
          note_cleaned: note.suspicious,
        } });
    }

    /* 所有權驗證。前面的檢查全都只證明「這個遊戲帳號存在」,而站上的 T100 榜單
       就公開展示著高分玩家的 id —— 抄一個填進來,所有檢查都會過。
       唯一能證明帳號是他的,是他能改動那個帳號的內容:我們發一組碼,
       他寫進遊戲內自我介紹,我們從公開 API 讀回來比對。 */
    if (p === '/api/apply/verify-start' || p === '/api/apply/verify-check') {
      if (m !== 'POST') return out({ error: 'method_not_allowed' }, 405);
      if (user.status === 'rejected') return out({ error: 'rejected' }, 403);
      const u = await getUser(env.DB, user.id);
      const uid = String((u && u.apply_uid) || '');
      if (!/^\d{15,20}$/.test(uid)) {
        return out({ error: 'no_application', message: '請先送出申請（填寫玩家 id）再進行驗證' }, 400);
      }

      if (p === '/api/apply/verify-start') {
        const nonce = makeNonce();
        const okN = await issueNonce(env.DB, user.id, nonce, NONCE_TTL);
        if (!okN) {
          return out({ error: 'too_frequent',
            message: '剛剛才發過驗證碼，請先使用目前這一組（或稍等一分鐘再取得新的）' }, 429);
        }
        return out({ ok: true, nonce, expire_in: NONCE_TTL });
      }

      // verify-check
      if (!u.verify_nonce || !(u.verify_expire > Math.floor(Date.now() / 1000))) {
        return out({ error: 'nonce_expired', message: '驗證碼已過期，請重新取得一組' }, 400);
      }
      if (!(await bumpVerifyTry(env.DB, user.id, VERIFY_TRIES, VERIFY_TOTAL))) {
        return out({ error: 'too_many_tries',
          message: '比對次數已達上限（每組驗證碼 ' + VERIFY_TRIES + ' 次，累計 ' + VERIFY_TOTAL
            + ' 次）。請換一組驗證碼再試；若已達累計上限，請聯絡管理員。' }, 429);
      }
      const pf = await fetchProfile(uid);
      if (pf.exists === 'unknown') {
        return out({ error: 'upstream', message: '暫時無法讀取遊戲資料（' + pf.reason + '），請稍後再試' }, 503);
      }
      if (pf.exists !== 'yes') {
        return out({ error: 'not_found', message: pf.reason || '查無此遊戲帳號' }, 404);
      }
      if (!wordHasNonce(pf.word || '', u.verify_nonce)) {
        return out({ ok: false, matched: false,
          message: '還沒在你的遊戲內自我介紹看到驗證碼。改好之後請稍等幾分鐘讓資料同步，再按一次。' });
      }
      const bound = await bindGameUid(env.DB, user.id, uid);
      if (!bound.ok) {
        return out({ error: 'uid_taken',
          message: bound.taken
            ? '這個遊戲帳號已經被另一個網站帳號綁定了。若那不是你，請聯絡管理員處理。'
            : '綁定失敗，請稍後再試。' }, 409);
      }
      // 驗證狀態變了，重新跑一次審核讓判定與通知反映最新結果
      await createTask(env.DB, user.id, {
        title: '申請自動審核（驗證後）', action: 'review_apply',
        params: { user_id: user.id }, run_at: 0, repeat_s: 0,
      });
      return out({ ok: true, matched: true, message: '驗證成功，已確認這個遊戲帳號屬於你。' });
    }

    /* 除了上面兩支,其餘功能都要管理員核准過。回 403 ＋ 固定錯誤碼,
       前端看到就切「等待審核」畫面,不用再猜是哪種失敗。 */
    if (user.status !== 'approved') return out({ error: 'pending_approval', status: user.status }, 403);

    /* ---------- AI 點數（beta） ---------- */
    /* 這裡刻意不接金流。beta 階段只產生訂單與對帳碼,實際收款在站外完成,
       管理員確認收到款項後才在後台入帳 —— 站上從頭到尾不碰任何付款資訊。 */
    if (p === '/api/credits') {
      if (m !== 'GET') return out({ error: 'method_not_allowed' }, 405);
      const [c, orders] = await Promise.all([
        getCredits(env.DB, user.id), listOrders(env.DB, user.id, 20),
      ]);
      return out({
        beta: true,
        enabled: String(env.CREDITS_BETA || '') === '1',
        balance: (c && c.balance) || 0,
        lifetime: (c && c.lifetime) || 0,
        spent: (c && c.spent) || 0,
        plans: aiPlans(env),
        pay_instructions: String(env.PAY_INSTRUCTIONS || ''),
        orders: (orders || []).map(o => ({
          id: o.id, plan: o.plan, points: o.points, price: o.price, currency: o.currency,
          ref: o.ref, status: o.status, created_at: o.created_at, confirmed_at: o.confirmed_at || null,
        })),
      });
    }

    if (p === '/api/credits/order') {
      if (m !== 'POST') return out({ error: 'method_not_allowed' }, 405);
      if (String(env.CREDITS_BETA || '') !== '1') {
        return out({ error: 'disabled', message: '點數方案尚未開放。' }, 403);
      }
      const b = await readJson(req);
      if (b.tooBig) return out({ error: 'payload_too_large' }, 413);
      if (b.bad) return out({ error: 'bad_json' }, 400);
      const v = isObj(b.value) ? b.value : {};
      const plan = aiPlans(env).find(x => x.id === String(v.plan || ''));
      if (!plan) return out({ error: 'bad_plan', message: '沒有這個方案' }, 400);
      /* 同時只能有一張未付款的訂單。不然對帳碼會滿天飛,管理員收到一筆款
         根本不知道要對到哪一張,而使用者也會搞不清楚自己該匯多少。 */
      const mine = await listOrders(env.DB, user.id, 20);
      const open1 = (mine || []).find(o => o.status === 'pending');
      if (open1) {
        return out({ error: 'order_open',
          message: '你還有一張未完成的訂單（對帳碼 ' + open1.ref + '）。請先完成或取消它。',
          order: { id: open1.id, ref: open1.ref, points: open1.points, price: open1.price } }, 409);
      }
      const o = await createOrder(env.DB, user.id, plan);
      return out({ ok: true,
        order: { id: o.id, plan: o.plan, points: o.points, price: o.price,
                 currency: o.currency, ref: o.ref, status: o.status, created_at: o.created_at },
        pay_instructions: String(env.PAY_INSTRUCTIONS || ''),
        note: '請依照付款說明完成付款，並在備註填上對帳碼。管理員確認收到後會為你入帳。' });
    }

    if (p === '/api/credits/cancel') {
      if (m !== 'POST') return out({ error: 'method_not_allowed' }, 405);
      const b = await readJson(req);
      if (b.tooBig) return out({ error: 'payload_too_large' }, 413);
      if (b.bad) return out({ error: 'bad_json' }, 400);
      const id = str((isObj(b.value) ? b.value : {}).id, 64);
      if (!id) return out({ error: 'bad_params', message: '缺少訂單 id' }, 400);
      const okC = await cancelOrder(env.DB, user.id, id);
      if (!okC) return out({ error: 'not_cancellable', message: '這張訂單無法取消（可能已入帳或已取消）' }, 409);
      return out({ ok: true });
    }

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
      /* 兩層額度。個人上限可由 env 調整;站台總量是保護網 —— 個人上限擋得住
         單一使用者,擋不住十個人同時用滿,而帳戶餘額是全站共用的。
         實測每次呼叫約 $0.14(in 約 2 萬 tokens、out 約 1.4 千),設定時請對著
         這個數字換算:2000 次 ≈ $277／人／日。 */
      /* 自動核准的帳號先給試用額度。自動審核再嚴謹也可能誤放行一個人,
         而誤放行的代價是真金白銀 —— 以 AI_CAP_USER=400、每次約 $0.14 計,
         一個誤放行的帳號當天最多能燒掉 $55。壓在 20 次就是 $3,
         等管理員事後覆核(把 reviewed_by 改成自己)才升到正常額度。 */
      const onProbation = !user.is_admin && String(user.reviewed_by || '') === 'system:auto';
      const cap = user.is_admin ? (+env.AI_CAP_ADMIN || 5000)
        : onProbation ? (+env.AI_CAP_AUTO || 20)
        : (+env.AI_CAP_USER || 2000);
      const siteCap = +env.AI_CAP_SITE || 6000;
      const [used, siteUsed] = await Promise.all([
        aiUsedToday(env.DB, user.id),
        aiUsedTodaySite(env.DB),
      ]);
      if (siteUsed >= siteCap) {
        return json({ error: 'site_quota', message: '站台今日的 AI 總用量已達上限，請明天再試。' }, 429, req, env);
      }
      /* 免費額度用完之後才動點數。順序不能反 —— 反過來等於在還有免費額度時
         就先扣付費使用者的點,那是在懲罰付費的人。
         扣點是條件式 UPDATE,餘額不足就是不足,不會扣成負數。 */
      let paidCall = false;
      if (used >= cap) {
        paidCall = await spendCredit(env.DB, user.id);
        if (!paidCall) {
          const c = await getCredits(env.DB, user.id);
          return json({ error: 'quota',
            message: '你今日的免費額度已用完（' + cap + ' 次）'
              + (String(env.CREDITS_BETA || '') === '1'
                  ? '，目前點數餘額 ' + ((c && c.balance) || 0) + ' 點。可到「我的帳號」購買點數，或明天再試。'
                  : '，請明天再試。'),
            balance: (c && c.balance) || 0 }, 429, req, env);
        }
      }
      /* 4 MB:對話本來就會帶著工具結果,而截圖辨識還會夾一張 base64 圖片。
         base64 比原始檔大三分之一,所以 4 MB 大約容得下 3 MB 的 JPEG ——
         那已經是一張很密的卡庫截圖(60 格以上)縮到 1800px 之後的量級。 */
      const rb = await readJson(req, 4 * 1024 * 1024);
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
        quota: { used: used + 1, cap, site_used: siteUsed + 1, site_cap: siteCap, paid: paidCall },
        cache: { read: reply.cache_read || 0, write: reply.cache_write || 0 },
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
