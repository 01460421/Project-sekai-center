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

export const applyNote = (db, userId, note) =>
  run(db, 'UPDATE users SET apply_note=?, updated_at=? WHERE id=? AND status=\'pending\'', String(note || '').slice(0, 500), now(), userId);

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
  await run(db, 'INSERT INTO events (id,watch_id,user_id,title,body,created_at) VALUES (?,?,?,?,?,?)',
    id, ev.watch_id, ev.user_id, String(ev.title || '').slice(0, 200), String(ev.body || '').slice(0, 4000), now());
  return id;
}
export const pendingEvents = (db, limit) =>
  all(db, `SELECT e.*, u.email, u.name AS user_name FROM events e JOIN users u ON u.id = e.user_id
           WHERE e.mailed_at IS NULL ORDER BY e.created_at LIMIT ?`, Math.min(50, limit || 20));
export const markMailed = (db, id, err) =>
  run(db, 'UPDATE events SET mailed_at=?, mail_error=? WHERE id=?', now(), err || null, id);
export const listEvents = (db, userId, limit) =>
  all(db, 'SELECT * FROM events WHERE user_id=? ORDER BY created_at DESC LIMIT ?', userId, Math.min(100, limit || 30));

/* ---------- 管理員稽核 ---------- */
export const logAdmin = (db, userId, prompt, reply, ti, to) =>
  run(db, 'INSERT INTO admin_log (id,user_id,prompt,reply,tokens_in,tokens_out,created_at) VALUES (?,?,?,?,?,?,?)',
    newId(), userId, String(prompt || '').slice(0, 4000), String(reply || '').slice(0, 8000), ti || 0, to || 0, now());
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
export const listTasks = (db, userId, limit) => userId
  ? all(db, 'SELECT * FROM tasks WHERE user_id=? ORDER BY created_at DESC LIMIT ?', userId, Math.min(100, limit || 50))
  : all(db, 'SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?', Math.min(100, limit || 50));
/* 週期性任務跑完要排下一次,而不是標成 done */
export async function finishTask(db, t, ok, result) {
  const ts = now();
  if (ok && t.repeat_s) {
    await run(db, 'UPDATE tasks SET run_at=?, attempts=attempts+1, result=?, last_error=NULL, updated_at=? WHERE id=?',
      ts + t.repeat_s, String(result || '').slice(0, 2000), ts, t.id);
    return;
  }
  await run(db, 'UPDATE tasks SET status=?, attempts=attempts+1, result=?, last_error=?, updated_at=? WHERE id=?',
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
