/* D1 存取層。其他模組一律走這裡，不自己拼 SQL。
   時間統一用「秒」（Date.now()/1000），因為 D1 存整數比存毫秒省事，
   而且這些欄位的精度需求都在分鐘等級。 */

export const now = () => Math.floor(Date.now() / 1000);
export const newId = () => crypto.randomUUID();

const one = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).first()) || null;
const all = async (db, sql, ...a) => ((await db.prepare(sql).bind(...a).all()).results || []);
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();

/* ---------- 使用者 ---------- */

/* Google 登入後建檔或更新。用 sub 當識別鍵而不是 email —— email 可以改，sub 不會。
   ADMIN_EMAIL 指定的信箱直接給管理員且免審核，否則第一個人會卡在沒人能核准他。 */
export async function upsertGoogleUser(db, p, adminEmail) {
  const t = now();
  const isAdmin = !!(adminEmail && p.email && p.email.toLowerCase() === String(adminEmail).toLowerCase());
  const found = await one(db, 'SELECT * FROM users WHERE google_sub = ?', p.sub);
  if (found) {
    await run(db,
      `UPDATE users SET email=?, name=?, picture=?, updated_at=?${isAdmin ? ", is_admin=1, status='approved'" : ''} WHERE id=?`,
      p.email || found.email, p.name || found.name, p.picture || found.picture, t, found.id);
    return await one(db, 'SELECT * FROM users WHERE id = ?', found.id);
  }
  const id = newId();
  await run(db,
    `INSERT INTO users (id, google_sub, email, name, picture, is_admin, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    id, p.sub, p.email || '', p.name || '', p.picture || '',
    isAdmin ? 1 : 0, isAdmin ? 'approved' : 'pending', t, t);
  return await one(db, 'SELECT * FROM users WHERE id = ?', id);
}

export const getUser = (db, id) => one(db, 'SELECT * FROM users WHERE id = ?', id);

/* Discord 綁定。同一個 Discord 帳號不能綁到兩個站台帳號，
   所以先把別人身上的同一個 discord_id 解除，避免 UNIQUE 撞車。 */
export async function linkDiscord(db, userId, d) {
  await run(db, 'UPDATE users SET discord_id=NULL, discord_name=NULL WHERE discord_id=? AND id<>?', d.id, userId);
  await run(db, 'UPDATE users SET discord_id=?, discord_name=?, updated_at=? WHERE id=?', d.id, d.username || '', now(), userId);
  return getUser(db, userId);
}
export const unlinkDiscord = (db, userId) =>
  run(db, 'UPDATE users SET discord_id=NULL, discord_name=NULL, updated_at=? WHERE id=?', now(), userId);

export const listUsers = (db, status) => status
  ? all(db, 'SELECT * FROM users WHERE status=? ORDER BY created_at DESC LIMIT 200', status)
  : all(db, 'SELECT * FROM users ORDER BY created_at DESC LIMIT 200');

export const reviewUser = (db, id, status, by) =>
  run(db, 'UPDATE users SET status=?, reviewed_at=?, reviewed_by=?, updated_at=? WHERE id=?', status, now(), by, now(), id);

export const setAdmin = (db, id, on) =>
  run(db, 'UPDATE users SET is_admin=?, updated_at=? WHERE id=?', on ? 1 : 0, now(), id);

/* ---------- 站上設定 ---------- */
/* 值一律是前端丟來的 JSON 字串，後端不解讀。前端要加欄位不必動 schema。 */

export async function getPrefs(db, userId) {
  const rows = await all(db, 'SELECT k, v, updated_at FROM prefs WHERE user_id=?', userId);
  const out = {};
  rows.forEach(r => { try { out[r.k] = JSON.parse(r.v); } catch (e) { out[r.k] = r.v; } });
  return out;
}
export async function setPrefs(db, userId, obj) {
  const t = now();
  const st = db.prepare('INSERT INTO prefs (user_id,k,v,updated_at) VALUES (?,?,?,?) ' +
                        'ON CONFLICT(user_id,k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at');
  const batch = Object.keys(obj || {}).map(k => st.bind(userId, k, JSON.stringify(obj[k]), t));
  if (batch.length) await db.batch(batch);
  return batch.length;
}

/* ---------- 偵測訂閱 ---------- */

export const listWatches = (db, userId) =>
  all(db, 'SELECT * FROM watches WHERE user_id=? ORDER BY created_at DESC', userId);

export async function createWatch(db, userId, w) {
  const id = newId();
  await run(db, 'INSERT INTO watches (id,user_id,kind,name,params,enabled,cooldown_s,created_at) VALUES (?,?,?,?,?,?,?,?)',
    id, userId, w.kind, String(w.name || '').slice(0, 80), JSON.stringify(w.params || {}),
    w.enabled === false ? 0 : 1, Math.max(60, +w.cooldown_s || 3600), now());
  return one(db, 'SELECT * FROM watches WHERE id=?', id);
}

export async function updateWatch(db, userId, id, patch) {
  const w = await one(db, 'SELECT * FROM watches WHERE id=? AND user_id=?', id, userId);
  if (!w) return null;
  await run(db, 'UPDATE watches SET name=?, params=?, enabled=?, cooldown_s=? WHERE id=?',
    patch.name != null ? String(patch.name).slice(0, 80) : w.name,
    patch.params != null ? JSON.stringify(patch.params) : w.params,
    patch.enabled != null ? (patch.enabled ? 1 : 0) : w.enabled,
    patch.cooldown_s != null ? Math.max(60, +patch.cooldown_s) : w.cooldown_s, id);
  return one(db, 'SELECT * FROM watches WHERE id=?', id);
}

export const deleteWatch = (db, userId, id) =>
  run(db, 'DELETE FROM watches WHERE id=? AND user_id=?', id, userId);

/* 掃描用：只撈啟用中、且擁有者已核准的。沒核准的人不該收到通知。 */
export const activeWatches = (db) =>
  all(db, `SELECT w.*, u.email, u.name AS user_name, u.discord_id
           FROM watches w JOIN users u ON u.id = w.user_id
           WHERE w.enabled = 1 AND u.status = 'approved'`);

export const markFired = (db, id, state, t) =>
  run(db, 'UPDATE watches SET last_fired=?, last_state=? WHERE id=?', t || now(), JSON.stringify(state || null), id);

/* 只更新比對狀態、不算觸發（用於「記住上次看到的值」但這次沒達成條件） */
export const markState = (db, id, state) =>
  run(db, 'UPDATE watches SET last_state=? WHERE id=?', JSON.stringify(state || null), id);

/* ---------- 事件 ---------- */

export async function addEvent(db, ev) {
  const id = newId();
  /* no_mail:純站內通知,不進寄信佇列。管理員的審核通知屬於這一類 ——
     量大、只需要在站上看到,不該吃掉 Resend 給偵測訂閱用的每日額度。 */
  await run(db, 'INSERT INTO events (id,watch_id,user_id,title,body,created_at,no_mail) VALUES (?,?,?,?,?,?,?)',
    id, ev.watch_id, ev.user_id, String(ev.title || '').slice(0, 200), String(ev.body || '').slice(0, 4000),
    now(), ev.no_mail ? 1 : 0);
  return id;
}
export const pendingEvents = (db, limit) =>
  all(db, `SELECT e.*, u.email, u.name AS user_name FROM events e JOIN users u ON u.id = e.user_id
           WHERE e.mailed_at IS NULL AND e.no_mail = 0 ORDER BY e.created_at LIMIT ?`, Math.min(50, limit || 20));
export const markMailed = (db, id, err) =>
  run(db, 'UPDATE events SET mailed_at=?, mail_error=? WHERE id=?', now(), err || null, id);
export const listEvents = (db, userId, limit) =>
  all(db, 'SELECT * FROM events WHERE user_id=? ORDER BY created_at DESC LIMIT ?', userId, Math.min(100, limit || 30));

/* ---------- 管理員稽核 ---------- */
/* x:{ model, cache_read, cache_write, kind }。kind 分 chat（站內助手）／admin（管理員提問）／review（自動審核）。 */
export const logAdmin = (db, userId, prompt, reply, ti, to, x) =>
  run(db, 'INSERT INTO admin_log (id,user_id,prompt,reply,tokens_in,tokens_out,created_at,model,cache_read,cache_write,kind,op_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    newId(), userId, String(prompt || '').slice(0, 4000), String(reply || '').slice(0, 8000), ti || 0, to || 0, now(),
    String((x && x.model) || ''), (x && +x.cache_read) || 0, (x && +x.cache_write) || 0, String((x && x.kind) || 'chat'), (x && x.op_id) || null);

/* 用量彙總。以 model 分組是為了算錢:不同模型單價差五倍,合在一起就算不出來。
   since=0 就是累計。userId 不給就是全站。 */
export const aiUsageRows = (db, { userId, since }) => userId
  ? all(db, `SELECT model, COUNT(*) AS calls, SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out,
       SUM(cache_read) AS cache_read, SUM(cache_write) AS cache_write
       FROM admin_log WHERE user_id=? AND created_at>=? GROUP BY model`, userId, since || 0)
  : all(db, `SELECT model, COUNT(*) AS calls, SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out,
       SUM(cache_read) AS cache_read, SUM(cache_write) AS cache_write
       FROM admin_log WHERE created_at>=? GROUP BY model`, since || 0);
/* 每人每模型一列,費用在外面算完再合併成每人一列。 */
export const aiUsageByUser = (db, since) =>
  all(db, `SELECT a.user_id, u.name, u.email, u.is_admin, a.model, COUNT(*) AS calls,
       SUM(a.tokens_in) AS tokens_in, SUM(a.tokens_out) AS tokens_out,
       SUM(a.cache_read) AS cache_read, SUM(a.cache_write) AS cache_write, MAX(a.created_at) AS last_at
       FROM admin_log a LEFT JOIN users u ON u.id=a.user_id
       WHERE a.created_at>=? GROUP BY a.user_id, a.model`, since || 0);
export const aiUsageDaily = (db, since) =>
  all(db, `SELECT date(created_at,'unixepoch') AS d, model, COUNT(*) AS calls,
       SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out,
       SUM(cache_read) AS cache_read, SUM(cache_write) AS cache_write
       FROM admin_log WHERE created_at>=? GROUP BY d, model ORDER BY d`, since || 0);
export const listAdminLog = (db, limit) =>
  all(db, 'SELECT * FROM admin_log ORDER BY created_at DESC LIMIT ?', Math.min(100, limit || 30));

/* ---------- 多步驟排程 ---------- */
/* action 一律是程式裡寫死的白名單代號,不存也不執行任何程式碼字串。 */

export async function createTask(db, userId, t) {
  const id = newId(), ts = now();
  await run(db, `INSERT INTO tasks (id,user_id,title,action,params,run_at,repeat_s,created_at,updated_at)
                 VALUES (?,?,?,?,?,?,?,?,?)`,
    id, userId, String(t.title || '').slice(0, 120), t.action, JSON.stringify(t.params || {}),
    Math.max(now(), +t.run_at || now()), t.repeat_s ? Math.max(300, +t.repeat_s) : null, ts, ts);
  return one(db, 'SELECT * FROM tasks WHERE id=?', id);
}
export const dueTasks = (db, limit) =>
  all(db, `SELECT * FROM tasks WHERE status='pending' AND run_at <= ? ORDER BY run_at LIMIT ?`, now(), Math.min(20, limit || 10));

/* 搶佔一筆到期任務。cron 每分鐘觸發,而任務可能跑超過一分鐘（AI 呼叫動輒十幾秒）,
   下一輪就會撈到同一批仍是 pending 的列 —— 於是同一筆審核打兩次 AI、發兩次通知。
   這裡用條件式 UPDATE 當鎖:只有把 status 從 pending 改成 running 的那個實例算搶到。
   回傳 true 才可以執行。 */
export async function claimTask(db, id, leaseS) {
  const t = now();
  const r = await run(db,
    "UPDATE tasks SET status='running', lease_until=?, updated_at=? WHERE id=? AND status='pending'",
    t + (leaseS || 180), t, id);
  return !!(r && r.meta && r.meta.changes);
}

/* 租約過期的任務還原成 pending。會發生在 isolate 被回收、部署中斷、
   或執行到一半拋出未捕捉的例外 —— 沒有這一支,那些任務會永遠卡在 running。 */
export async function reclaimStaleTasks(db) {
  const r = await run(db,
    "UPDATE tasks SET status='pending', lease_until=NULL, attempts=attempts+1, updated_at=? " +
    "WHERE status='running' AND lease_until IS NOT NULL AND lease_until < ?", now(), now());
  return (r && r.meta && r.meta.changes) || 0;
}
export const listTasks = (db, userId, limit) => userId
  ? all(db, 'SELECT * FROM tasks WHERE user_id=? ORDER BY created_at DESC LIMIT ?', userId, Math.min(100, limit || 50))
  : all(db, 'SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?', Math.min(100, limit || 50));
/* 週期性任務跑完要排下一次,而不是標成 done */
export async function finishTask(db, t, ok, result) {
  const ts = now();
  if (ok && t.repeat_s) {
    /* 週期任務要把 status 放回 pending 並清掉租約,否則加了租約機制之後
       它會永遠停在 running,dueTasks 再也撈不到 —— 排程等於默默死掉。 */
    await run(db, "UPDATE tasks SET status='pending', lease_until=NULL, run_at=?, attempts=attempts+1, " +
      'result=?, last_error=NULL, updated_at=? WHERE id=?',
      ts + t.repeat_s, String(result || '').slice(0, 2000), ts, t.id);
    return;
  }
  await run(db, 'UPDATE tasks SET status=?, lease_until=NULL, attempts=attempts+1, result=?, last_error=?, updated_at=? WHERE id=?',
    ok ? 'done' : 'failed', ok ? String(result || '').slice(0, 2000) : null,
    ok ? null : String(result || '').slice(0, 500), ts, t.id);
}
export const cancelTask = (db, userId, id) =>
  run(db, "UPDATE tasks SET status='cancelled', updated_at=? WHERE id=? AND user_id=?", now(), id, userId);

/* Claude 每一次工具呼叫都留痕（它自己決定的參數也要記） */
export const logTool = (db, userId, tool, args, ok, result) =>
  run(db, 'INSERT INTO tool_log (id,user_id,tool,args,ok,result,created_at) VALUES (?,?,?,?,?,?,?)',
    newId(), userId, tool, JSON.stringify(args || {}).slice(0, 2000), ok ? 1 : 0,
    String(result == null ? '' : (typeof result === 'string' ? result : JSON.stringify(result))).slice(0, 2000), now());
export const listToolLog = (db, limit) =>
  all(db, 'SELECT * FROM tool_log ORDER BY created_at DESC LIMIT ?', Math.min(200, limit || 50));

/* 今日已用的 AI 次數。開放給一般使用者之後,沒有上限的話 API 費用會失控,
   而且一個人跑迴圈就能把額度吃光。用 admin_log 當計數來源,不另外開表。 */
export async function aiUsedToday(db, userId) {
  const since = now() - 86400;
  const r = await one(db, 'SELECT count(*) AS c FROM admin_log WHERE user_id=? AND created_at>=?', userId, since);
  return (r && r.c) || 0;
}

/* ---------- 站內通知 ---------- */
/* 改成站內通知之後,「送達」不再需要確認 —— 寫進 events 使用者就看得到。
   要追蹤的是看過沒有。 */

export const unreadCount = async (db, userId) => {
  const r = await one(db, 'SELECT COUNT(*) AS c FROM events WHERE user_id=? AND read_at IS NULL', userId);
  return (r && r.c) || 0;
};
export const markRead = (db, userId, id) => id
  ? run(db, 'UPDATE events SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL', now(), id, userId)
  : run(db, 'UPDATE events SET read_at=? WHERE user_id=? AND read_at IS NULL', now(), userId);

/* 今日全站的 AI 呼叫數。個人上限擋得住單一使用者,擋不住「十個人同時用滿」——
   帳戶餘額是全站共用的,所以需要一道總量保護。 */
export async function aiUsedTodaySite(db) {
  const since = now() - 86400;
  const r = await one(db, 'SELECT count(*) AS c FROM admin_log WHERE created_at>=?', since);
  return (r && r.c) || 0;
}

/* ---------- 申請審核 ---------- */

/* 管理員清單（收審核通知用）。原本沒有這支 —— is_admin 全站只被拿來統計人數。
   只找已核准的管理員:被停權的管理員不該繼續收通知。 */
export const listAdmins = (db) =>
  all(db, "SELECT id, name, email FROM users WHERE is_admin=1 AND status='approved'");

/* 送出申請。冷卻與次數上限直接寫進 WHERE,用 changes 判斷有沒有真的收下 ——
   先 SELECT 再 UPDATE 會有競態,而這支端點會觸發外部抓取與 AI 呼叫,
   是實打實的費用放大器,擋不住就等於把帳單交給任何一個登入中的人。 */
export async function saveApplication(db, userId, a, cooldownS, maxCount) {
  const t = now();
  const r = await run(db,
    `UPDATE users SET apply_uid=?, apply_level=?, apply_note=?, apply_note_dropped=?,
            last_apply_at=?, apply_count=apply_count+1, updated_at=?
      WHERE id=? AND status='pending'
        AND (last_apply_at IS NULL OR last_apply_at <= ?)
        AND apply_count < ?`,
    a.uid || null, a.level == null ? null : +a.level, String(a.note || '').slice(0, 200),
    Math.max(0, +a.dropped || 0),
    t, t, userId, t - (cooldownS || 600), maxCount || 10);
  return !!(r && r.meta && r.meta.changes);
}

/* 發驗證碼。用「距離上次發碼不足 60 秒就不發」當節流:每張碼都允許幾次重試,
   若能無限換新碼,重試次數的上限就形同虛設(換一張就歸零)。
   條件寫進 WHERE,用 changes 判斷有沒有真的發出去。 */
export async function issueNonce(db, userId, nonce, ttlS) {
  const t = now();
  const r = await run(db,
    `UPDATE users SET verify_nonce=?, verify_expire=?, verify_tries=0, updated_at=?
      WHERE id=? AND (verify_expire IS NULL OR verify_expire < ?)`,
    nonce, t + ttlS, t, userId, t + ttlS - 60);
  return !!(r && r.meta && r.meta.changes);
}

/* 累加驗證嘗試次數。每次比對都要打一次外部 API(164KB),不設上限就是個放大器。
   同樣用條件式 UPDATE,回 false 代表已達上限。 */
export async function bumpVerifyTry(db, userId, maxTries, maxTotal) {
  /* 兩道上限:每張碼 maxTries 次,以及不會被換碼歸零的累計 maxTotal 次。
     只有前者的話,換一張新碼就把次數清掉了,上限形同虛設 —— 而每一次比對
     都是一次 164KB 的外部抓取。 */
  const r = await run(db,
    `UPDATE users SET verify_tries=verify_tries+1, verify_total=verify_total+1, updated_at=?
      WHERE id=? AND verify_tries < ? AND verify_total < ?`,
    now(), userId, maxTries || 5, maxTotal || 40);
  return !!(r && r.meta && r.meta.changes);
}

/* 綁定「已證明擁有」的遊戲 id。唯一性交給 partial unique index 擋,
   不先 SELECT 再寫 —— D1 沒有跨 await 的交易,先查後寫必然有競態。
   撞到約束就代表這個遊戲帳號已經被別的網站帳號綁走了。 */
export async function bindGameUid(db, userId, uid) {
  try {
    const r = await run(db,
      'UPDATE users SET game_uid=?, verify_nonce=NULL, verify_expire=NULL, updated_at=? WHERE id=?',
      uid, now(), userId);
    return { ok: !!(r && r.meta && r.meta.changes) };
  } catch (e) {
    const m = String((e && e.message) || e);
    if (/UNIQUE|constraint/i.test(m)) return { ok: false, taken: true };
    throw e;
  }
}

/* 同一個宣稱 uid 有沒有別人也在用。這只是給管理員看的訊號,不是拒絕的理由 ——
   在還沒證明所有權之前,先送出的人不一定就是真正的擁有者（反而可能是搶註的）。 */
export const uidClaimedBy = (db, uid, exceptUserId) =>
  all(db, `SELECT id, name, status, created_at, (game_uid = ?) AS proven FROM users
            WHERE (apply_uid=? OR game_uid=?) AND id<>? ORDER BY created_at LIMIT 5`,
      uid, uid, uid, exceptUserId || '');

export const saveReview = (db, userId, reviewJson) =>
  run(db, 'UPDATE users SET review_json=?, updated_at=? WHERE id=?',
      String(reviewJson || '').slice(0, 8000), now(), userId);

/* 自動核准。一定要帶 status='pending' 前提:背景審核跑完時,管理員可能已經
   手動拒絕了這個人。沒有前提就會把「已拒絕」復活成「已核准」,而且沒有人會發現。
   changes=0 代表期間狀態被改過,呼叫端只該寫通知、不該改狀態。 */
export async function autoApprove(db, userId) {
  const t = now();
  const r = await run(db,
    `UPDATE users SET status='approved', reviewed_at=?, reviewed_by='system:auto', updated_at=?
      WHERE id=? AND status='pending'`, t, t, userId);
  return !!(r && r.meta && r.meta.changes);
}

/* ---------- AI 點數（beta） ---------- */

export const getCredits = (db, userId) =>
  one(db, 'SELECT * FROM ai_credits WHERE user_id=?', userId);

/* 扣一點。條件寫進 WHERE,回 false 就是餘額不足 —— 先查後扣會有競態,
   而競態在這裡等於「同時開兩個分頁就能多用一次」。 */
export async function spendCredit(db, userId) {
  const r = await run(db,
    'UPDATE ai_credits SET balance=balance-1, spent=spent+1, updated_at=? WHERE user_id=? AND balance>0',
    now(), userId);
  return !!(r && r.meta && r.meta.changes);
}

/* 對帳碼。使用者匯款時附註這組,管理員靠它把款項對到訂單。
   不用容易看錯的字元,長度取 6 —— 撞號由 UNIQUE index 擋,撞到就重產。 */
const REF_A = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function makeRef() {
  const b = crypto.getRandomValues(new Uint8Array(6));
  let s = '';
  for (let i = 0; i < 6; i++) s += REF_A[b[i] % REF_A.length];
  return s;
}

export async function createOrder(db, userId, plan) {
  const t = now();
  for (let i = 0; i < 5; i++) {          // 撞號重試
    const id = newId(), ref = makeRef();
    try {
      await run(db,
        `INSERT INTO ai_orders (id,user_id,plan,points,price,currency,ref,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,'pending',?,?)`,
        id, userId, plan.id, plan.points, plan.price, plan.currency || 'TWD', ref, t, t);
      return one(db, 'SELECT * FROM ai_orders WHERE id=?', id);
    } catch (e) {
      if (!/UNIQUE|constraint/i.test(String((e && e.message) || e))) throw e;
    }
  }
  throw new Error('無法產生不重複的對帳碼，請稍後再試');
}

export const listOrders = (db, userId, limit) =>
  all(db, 'SELECT * FROM ai_orders WHERE user_id=? ORDER BY created_at DESC LIMIT ?',
      userId, Math.min(50, limit || 20));

export const pendingOrders = (db, limit) =>
  all(db, `SELECT o.*, u.name AS user_name, u.email AS user_email
             FROM ai_orders o JOIN users u ON u.id = o.user_id
            WHERE o.status='pending' ORDER BY o.created_at LIMIT ?`, Math.min(100, limit || 50));

/* 未付款的訂單使用者可以自己取消。已入帳的不能動 —— 那要走退款,不是取消。 */
export async function cancelOrder(db, userId, id) {
  const r = await run(db,
    "UPDATE ai_orders SET status='cancelled', updated_at=? WHERE id=? AND user_id=? AND status='pending'",
    now(), id, userId);
  return !!(r && r.meta && r.meta.changes);
}

/* 入帳。兩句放同一個 batch（D1 的 batch 是一個交易）,第二句只認這次產生的 token:
   狀態沒真的從 pending 翻過去的那次,沒有任何一列帶著它的 token,所以加不到點。
   重複按、兩個管理員同時按,都只會入帳一次。 */
export async function confirmOrder(db, id, adminId) {
  const t = now(), tok = newId();
  await db.batch([
    db.prepare(`UPDATE ai_orders SET status='paid', confirmed_at=?, confirmed_by=?, confirm_token=?, updated_at=?
                 WHERE id=? AND status='pending'`).bind(t, adminId, tok, t, id),
    db.prepare(`INSERT INTO ai_credits (user_id, balance, lifetime, spent, updated_at)
                SELECT user_id, points, points, 0, ? FROM ai_orders WHERE confirm_token=?
                ON CONFLICT(user_id) DO UPDATE SET
                  balance = balance + excluded.balance,
                  lifetime = lifetime + excluded.lifetime,
                  updated_at = excluded.updated_at`).bind(t, tok),
  ]);
  return one(db, 'SELECT * FROM ai_orders WHERE id=? AND confirm_token=?', id, tok);
}


/* ---------- 提問所／討論串 ---------- */
/* 作者名稱一律從 users 表 JOIN 出來，不存進 threads/posts:改暱稱時舊文才會跟著變。 */
const AUTHOR = `COALESCE(NULLIF(u.name,''), substr(u.email,1,3)||'…') AS author, u.is_admin AS author_admin`;
export const listThreads = (db, kind, limit, before) =>
  all(db, `SELECT t.id,t.kind,t.title,t.user_id,t.created_at,t.updated_at,t.reply_count,t.last_reply_at,t.solved,t.locked,
                  substr(t.body,1,140) AS preview, ${AUTHOR}
           FROM threads t JOIN users u ON u.id=t.user_id
           WHERE t.deleted=0 AND t.kind=? AND t.updated_at < ?
           ORDER BY t.updated_at DESC LIMIT ?`, kind, before || 2147483647, Math.min(50, limit || 30));
export const getThread = (db, id) =>
  one(db, `SELECT t.*, ${AUTHOR} FROM threads t JOIN users u ON u.id=t.user_id WHERE t.id=? AND t.deleted=0`, id);
export const listPosts = (db, threadId) =>
  all(db, `SELECT p.id,p.user_id,p.body,p.created_at,p.deleted,p.via_ai,p.reply_to, ${AUTHOR}
           FROM posts p JOIN users u ON u.id=p.user_id WHERE p.thread_id=? ORDER BY p.created_at LIMIT 500`, threadId);
export async function createThread(db, userId, kind, title, body) {
  const id = newId(), t = now();
  await run(db, 'INSERT INTO threads (id,kind,title,body,user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
    id, kind, title, body, userId, t, t);
  return id;
}
export async function addPost(db, userId, threadId, body, viaAi, replyTo) {
  const id = newId(), t = now();
  /* 兩句要一起成立:回覆寫進去、主題的計數與時間更新。D1 的 batch 是一個交易。 */
  await db.batch([
    db.prepare('INSERT INTO posts (id,thread_id,user_id,body,created_at,via_ai,reply_to) VALUES (?,?,?,?,?,?,?)').bind(id, threadId, userId, body, t, viaAi ? 1 : 0, replyTo || null),
    db.prepare('UPDATE threads SET reply_count=reply_count+1, last_reply_at=?, updated_at=? WHERE id=?').bind(t, t, threadId),
  ]);
  return id;
}
/* 冷卻:同一個人上一篇（主題或回覆）距今幾秒。防連發，不是防弊。 */
export async function lastPostedAt(db, userId) {
  const a = await one(db, 'SELECT MAX(created_at) AS t FROM threads WHERE user_id=?', userId);
  const b = await one(db, 'SELECT MAX(created_at) AS t FROM posts WHERE user_id=?', userId);
  return Math.max((a && a.t) || 0, (b && b.t) || 0);
}
export const setThreadFlag = (db, id, col, v) => {
  if (['solved', 'locked', 'deleted'].indexOf(col) < 0) throw new Error('bad flag');   // 欄位名不吃外部輸入
  return run(db, `UPDATE threads SET ${col}=?, updated_at=? WHERE id=?`, v ? 1 : 0, now(), id);
};
export const deletePost = (db, id) => run(db, 'UPDATE posts SET deleted=1 WHERE id=?', id);
export const getPost = (db, id) => one(db, 'SELECT * FROM posts WHERE id=?', id);

/* 一串裡所有發過言的人（作者＋回覆者），通知用。上限 30 位，再多就不像討論串了。 */
export const threadParticipants = (db, threadId) =>
  all(db, `SELECT DISTINCT user_id FROM posts WHERE thread_id=? AND deleted=0 LIMIT 30`, threadId).then(r => r.map(x => x.user_id));

/* ---------- AI 操作(額度單位) ----------
   一次提問／一次截圖辨識算一次操作;中間跑幾輪工具都算同一次,做到完為止。
   額度以台灣時間的日曆日計(00:00 重置),不是 24 小時滾動 —— 使用者看得懂「今天還剩幾次」。 */
export const twDayStart = () => Math.floor((now() + 8 * 3600) / 86400) * 86400 - 8 * 3600;
export const aiOpsToday = async (db, userId) => {
  const r = await one(db, 'SELECT COUNT(*) AS c FROM ai_ops WHERE user_id=? AND created_at>=?', userId, twDayStart());
  return (r && r.c) || 0;
};
export async function createOp(db, userId, kind, ttl, paid) {
  const id = newId(), t = now(), exp = t + (ttl || 1800);
  await run(db, 'INSERT INTO ai_ops (id,user_id,kind,created_at,expires_at,rounds,paid,last_at) VALUES (?,?,?,?,?,0,?,?)',
    id, userId, String(kind || 'chat').slice(0, 16), t, exp, paid ? 1 : 0, t);
  return { id, created_at: t, expires_at: exp };
}
/* 記一輪。條件式 UPDATE:逾時或輪數用完就不加,changes=0 再查原因。 */
export async function touchOp(db, id, userId, maxRounds) {
  const t = now();
  const r = await run(db, 'UPDATE ai_ops SET rounds=rounds+1, last_at=? WHERE id=? AND user_id=? AND expires_at>=? AND rounds<?',
    t, id, userId, t, maxRounds || 60);
  if (r && r.meta && r.meta.changes > 0) {
    const o = await one(db, 'SELECT rounds FROM ai_ops WHERE id=?', id);
    return { ok: true, rounds: (o && o.rounds) || 1 };
  }
  const o = await one(db, 'SELECT * FROM ai_ops WHERE id=? AND user_id=?', id, userId);
  if (!o) return { ok: false, reason: 'not_found' };
  if (o.expires_at < t) return { ok: false, reason: 'expired' };
  return { ok: false, reason: 'exhausted', rounds: o.rounds };
}
export const aiOpsByUser = (db, since) =>
  all(db, 'SELECT user_id, COUNT(*) AS ops FROM ai_ops WHERE created_at>=? GROUP BY user_id', since || 0);
