/* 帳密登入與 QQ 身分綁定（合約第 4、5 節）。

   路由：
     POST /auth/password/login   {username, password}
     POST /auth/password/set     {username?, password, current?}   需已登入
     POST /auth/password/reset   {resetToken, password}
     POST /auth/qq/start         {purpose, username?, password?}  → {code, k, ttl}
     GET  /auth/qq/poll?k=       → {status: pending|expired|done|fail, ...}（詳見 qqPoll 前的說明）
   機器人那一端（POST /car/qqbind）在 car.js。

   這些都是前端用 fetch(credentials:'include') 從主站跨子網域呼叫的,所以回應一律 JSON＋具體的
   Allow-Origin;會改狀態的 POST 另外檢查 Origin 必須是本站,擋登入 CSRF。 */

import { corsHeaders, originIsSite } from './cors.js';
import { signToken, verifyToken, currentUser, issueSession } from './auth.js';
import { hashPassword, verifyPassword, USERNAME_RE, normUsername, validPassword } from './passwords.js';
import {
  getUser, passwordByUsername, passwordOfUser, insertPassword, updatePasswordHash,
  failCount, addFail, clearFails, markGoodIp, createQQCode, qqCodeByKey, burnQQKey, deleteQQCode, useResetToken,
} from './db.js';

const WIN = 15 * 60;              // 限流視窗
const IP_MAX = 20;                // 同一 IP（IPv6 以 /64 計）15 分鐘失敗上限
const USERIP_MAX = 8;             // 同一「帳號名＋IP 前綴」15 分鐘失敗上限
/* 同一帳號名 15 分鐘總失敗數超過這個值,就只放行「這個帳號以前成功登入過的 IP 前綴」。
   不做成全面鎖死 —— 否則任何人打 8 次錯密碼就能讓本人登不進去（QQ 註冊的帳號只有密碼這條路）。
   被擋在外面的新裝置還是可以走 QQ「忘記密碼」重設,重設完就直接登入。 */
const USER_SOFT_MAX = 50;
const QQ_TTL = 120;               // 綁定碼有效秒數
const QQ_START_MAX = 10;          // 同一 IP 15 分鐘最多發幾張碼
const RESET_TTL = 600;            // resetToken 有效秒數
const MAX_BODY = 4096;

const BAD_LOGIN = '帳號或密碼錯誤';
const TOO_MANY = '嘗試次數過多，請 15 分鐘後再試';

export const clientIp = req => req.headers.get('CF-Connecting-IP') || '0.0.0.0';

/* 限流用的 IP 鍵：IPv4 用完整位址,IPv6 只取 /64 前綴 —— 一般使用者手上就有一整個 /64,
   用完整位址當鍵的話輪換位址就能無限重試。 */
export function ipKey(ip) {
  const v = String(ip || '').trim().toLowerCase().replace(/%.*$/, '');
  if (v.indexOf(':') < 0) return v || '0.0.0.0';
  const m4 = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (m4) return m4[1];
  const parts = v.split('::');
  if (parts.length > 2) return v.slice(0, 64);
  const grp = x => (x ? x.split(':') : []).flatMap(h => (h.indexOf('.') >= 0 ? ['0', '0'] : [h]));
  const head = grp(parts[0]);
  const tail = parts.length === 2 ? grp(parts[1]) : [];
  const full = parts.length === 2 ? head.concat(Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), tail) : head;
  return full.slice(0, 4).map(h => (parseInt(h, 16) || 0).toString(16)).join(':') + '::/64';
}

/* resetToken 用另一把衍生金鑰簽 —— 同一把 SESSION_SECRET 的話,
   帶 u 欄位的 resetToken 就能直接塞進 sekai_session 當登入 cookie 用。 */
export const resetKey = env => String(env.SESSION_SECRET || '') + '|pwreset';

function json(req, env, obj, status, extra) {
  const h = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', ...corsHeaders(req, env) });
  if (extra) for (const c of extra) h.append('Set-Cookie', c);
  return new Response(JSON.stringify(obj), { status: status || 200, headers: h });
}

async function readBody(req) {
  const declared = Number(req.headers.get('Content-Length') || 0);
  if (declared > MAX_BODY) return null;
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_BODY) return null;
  if (!buf.byteLength) return {};
  try {
    const v = JSON.parse(new TextDecoder().decode(buf));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch (e) { return null; }
}

/* ip 參數一律是 ipKey() 之後的值 */
async function limited(env, ip, username) {
  const [a, b, c] = await Promise.all([
    failCount(env.DB, 'ip', ip, WIN),
    username ? failCount(env.DB, 'userip', username + '|' + ip, WIN) : Promise.resolve(0),
    username ? failCount(env.DB, 'user', username, WIN) : Promise.resolve(0),
  ]);
  if (a >= IP_MAX || b >= USERIP_MAX) return true;
  if (c >= USER_SOFT_MAX) return (await failCount(env.DB, 'okip', username + '|' + ip, 30 * 86400)) === 0;
  return false;
}
const recordFail = (env, ip, username) =>
  addFail(env.DB, username ? [['ip', ip], ['userip', username + '|' + ip], ['user', username]] : [['ip', ip]]);

export async function handleAccounts(req, env, url) {
  const p = url.pathname;
  if (!(p.startsWith('/auth/password/') || p.startsWith('/auth/qq/'))) return null;
  if (req.method === 'OPTIONS') {
    const h = corsHeaders(req, env);
    h['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    h['access-control-allow-headers'] = 'Content-Type';
    h['access-control-max-age'] = '86400';
    return new Response(null, { status: 204, headers: h });
  }
  const out = (o, s, cookies) => json(req, env, o, s, cookies);
  if (!env.SESSION_SECRET) return out({ error: '伺服器尚未設定 SESSION_SECRET' }, 500);

  try {
    if (p === '/auth/qq/poll') {
      if (req.method !== 'GET') return out({ error: 'method_not_allowed' }, 405);
      return await qqPoll(req, env, url, out);
    }

    if (req.method !== 'POST') return out({ error: 'method_not_allowed' }, 405);
    if (!originIsSite(req, env)) return out({ error: 'bad_origin' }, 403);
    const body = await readBody(req);
    if (!body) return out({ error: 'bad_json' }, 400);
    const ip = ipKey(clientIp(req));

    if (p === '/auth/password/login') {
      const username = normUsername(body.username);
      const password = typeof body.password === 'string' ? body.password : '';
      if (await limited(env, ip, USERNAME_RE.test(username) ? username : '')) return out({ error: TOO_MANY }, 429);
      if (!USERNAME_RE.test(username) || !validPassword(password)) {
        await verifyPassword(password || 'x', null);     // 同樣的耗時,不讓格式錯誤比較快回
        await recordFail(env, ip, USERNAME_RE.test(username) ? username : '');
        return out({ error: BAD_LOGIN }, 401);
      }
      const row = await passwordByUsername(env.DB, username);
      const ok = await verifyPassword(password, row ? row.hash : null);
      if (!ok || !row) {
        await recordFail(env, ip, username);
        return out({ error: BAD_LOGIN }, 401);
      }
      const u = await getUser(env.DB, row.user_id);
      if (!u) { await recordFail(env, ip, username); return out({ error: BAD_LOGIN }, 401); }
      /* 只清「這個帳號＋這個 IP 前綴」的失敗數；帳號總數不清,不然攻擊者只要本人登入一次就歸零。 */
      await clearFails(env.DB, 'userip', username + '|' + ip);
      await markGoodIp(env.DB, username + '|' + ip);
      return out({ ok: true, username, user: { id: u.id, name: u.name || '' } }, 200, [await issueSession(env, u)]);
    }

    if (p === '/auth/password/set') {
      const me = await currentUser(req, env);
      if (!me) return out({ error: 'need_login', message: '請先登入' }, 401);
      const password = body.password;
      if (!validPassword(password)) return out({ error: '密碼需為 8～64 個字' }, 400);
      const row = await passwordOfUser(env.DB, me.id);
      if (row) {
        // 已有密碼：改密碼要帶目前密碼；帳號名第一次設定後就不能改
        if (body.username != null && body.username !== '' && normUsername(body.username) !== row.username) {
          return out({ error: '帳號名設定後不能更改' }, 400);
        }
        if (await limited(env, ip, row.username)) return out({ error: TOO_MANY }, 429);
        const cur = typeof body.current === 'string' ? body.current : '';
        if (!cur || !(await verifyPassword(cur, row.hash))) {
          await recordFail(env, ip, row.username);
          return out({ error: '目前的密碼不正確' }, 403);
        }
        // 改密碼 → 工作階段版本 +1,其他裝置（包括可能的盜用者）全部登出；這個瀏覽器換發新 cookie
        const fresh = await updatePasswordHash(env.DB, me.id, await hashPassword(password));
        return out({ ok: true, username: row.username }, 200, fresh ? [await issueSession(env, fresh)] : undefined);
      }
      const username = normUsername(body.username);
      if (!USERNAME_RE.test(username)) return out({ error: '帳號名需為 3～20 個小寫英文、數字或底線' }, 400);
      const r = await insertPassword(env.DB, me.id, username, await hashPassword(password));
      if (r.taken) {
        // 可能是帳號名被用走,也可能是同一個人兩個分頁同時送出
        const again = await passwordOfUser(env.DB, me.id);
        if (again) return out({ error: '這個帳號已經設定過密碼，請重新整理' }, 409);
        return out({ error: '這個帳號名已經有人使用' }, 409);
      }
      return out({ ok: true, username });
    }

    if (p === '/auth/password/reset') {
      const st = await verifyToken(resetKey(env), typeof body.resetToken === 'string' ? body.resetToken : '');
      if (!st || st.p !== 'pwreset' || !st.c || !st.u) return out({ error: '重設連結無效或已過期，請重新用 QQ 驗證' }, 400);
      if (!validPassword(body.password)) return out({ error: '密碼需為 8～64 個字' }, 400);
      const row = await passwordOfUser(env.DB, st.u);
      if (!row) return out({ error: '重設連結無效或已過期，請重新用 QQ 驗證' }, 400);
      const hash = await hashPassword(body.password);     // 先算好再搶 token,避免搶到了卻在運算中失敗
      if (!(await useResetToken(env.DB, st.c, st.u))) return out({ error: '重設連結已使用過，請重新用 QQ 驗證' }, 400);
      // 重設 → 工作階段版本 +1（同一個交易）：之前所有 cookie 失效,只有這個瀏覽器拿到新的
      const fresh = await updatePasswordHash(env.DB, st.u, hash);
      await deleteQQCode(env.DB, st.c);
      await clearFails(env.DB, 'user', row.username);
      await clearFails(env.DB, 'userip', row.username + '|' + ip);
      await markGoodIp(env.DB, row.username + '|' + ip);
      if (!fresh) return out({ error: '重設連結無效或已過期，請重新用 QQ 驗證' }, 400);
      return out({ ok: true, username: row.username }, 200, [await issueSession(env, fresh)]);
    }

    if (p === '/auth/qq/start') {
      const purpose = body.purpose;
      if (['register', 'link', 'reset'].indexOf(purpose) < 0) return out({ error: 'bad_purpose' }, 400);
      if ((await failCount(env.DB, 'qqstart', ip, WIN)) >= QQ_START_MAX) return out({ error: '取得驗證碼的次數過多，請 15 分鐘後再試' }, 429);
      // 先計數再檢查：「帳號名已被使用」的 409 也算一次,不能拿來無限枚舉帳號名
      await addFail(env.DB, [['qqstart', ip]]);
      let payload;
      if (purpose === 'register') {
        const username = normUsername(body.username);
        if (!USERNAME_RE.test(username)) return out({ error: '帳號名需為 3～20 個小寫英文、數字或底線' }, 400);
        if (!validPassword(body.password)) return out({ error: '密碼需為 8～64 個字' }, 400);
        if (await passwordByUsername(env.DB, username)) return out({ error: '這個帳號名已經有人使用' }, 409);
        payload = { username, hash: await hashPassword(body.password) };
      } else if (purpose === 'link') {
        const me = await currentUser(req, env);
        if (!me) return out({ error: 'need_login', message: '請先登入' }, 401);
        payload = { uid: me.id };
      } else {
        // reset：不查帳號存不存在,一律發碼 —— 回應不能透露帳號是否存在。對不上的在機器人那端才拒絕。
        const username = normUsername(body.username);
        if (!USERNAME_RE.test(username)) return out({ error: '帳號名需為 3～20 個小寫英文、數字或底線' }, 400);
        payload = { username };
      }
      const c = await createQQCode(env.DB, purpose, payload, ip, QQ_TTL);
      return out({ code: c.code, k: c.k, ttl: QQ_TTL });
    }

    return out({ error: 'not_found' }, 404);
  } catch (e) {
    console.error('accounts error', e && (e.stack || e.message));
    return out({ error: 'server_error' }, 500);
  }
}

/* 輪詢。status：
     pending  —— 還沒送碼,或 QQ 已送碼、正在等同一個 QQ 送確認碼（stage:'confirm',附 qq:{n} 讓網頁顯示是誰）
     done     —— 完成（register 設 cookie；reset 回 resetToken）
     fail     —— 這張碼已作廢（QQ 已綁別的帳號、帳號名被搶、別的 QQ 也送了同一個碼…）,
                 reason／message 說明原因,網頁要重新取得新碼。碼一旦被機器人搶下就不會放回去重用。
     expired  —— 過期或 k 不對 */
const FAIL_MSG = {
  qq_taken: '這個 QQ 已經綁定了別的網站帳號（一個 QQ 只能綁一個帳號）。',
  username_taken: '這個帳號名剛剛被別人註冊了，請換一個帳號名。',
  not_linked: '送出驗證碼的 QQ 沒有綁定這個帳號，無法重設密碼。',
  contested: '有其他 QQ 也送出了同一組驗證碼，為了安全這組碼已作廢。請重新取得，並注意不要讓別人看到後搶先送出。',
  no_user: '找不到要綁定的網站帳號，請重新登入後再試。',
  error: '網站暫時出錯，請重新取得驗證碼再試一次。',
};
async function qqPoll(req, env, url, out) {
  const k = url.searchParams.get('k') || '';
  if (!/^[0-9a-f]{32}$/.test(k)) return out({ status: 'expired' });
  const row = await qqCodeByKey(env.DB, k);
  const nowS = Math.floor(Date.now() / 1000);
  if (!row || row.purpose === 'confirm') return out({ status: 'expired' });
  let done = null;
  try { done = row.done_json ? JSON.parse(row.done_json) : null; } catch (e) { done = null; }
  const st = done && done.status;
  if (st === 'failed') {
    await burnQQKey(env.DB, row.code);
    const reason = FAIL_MSG[done.reason] ? done.reason : 'error';
    return out({ status: 'fail', purpose: row.purpose, reason, message: FAIL_MSG[reason] });
  }
  if (st !== 'done') {
    if (row.exp < nowS) return out({ status: 'expired' });
    const o = { status: 'pending', ttl: row.exp - nowS, purpose: row.purpose };
    if (st === 'await') { o.stage = 'confirm'; o.qq = { n: done.n || '' }; }
    return out(o);
  }
  // 兌換即焚
  if (row.purpose === 'register') {
    await deleteQQCode(env.DB, row.code);
    const u = await getUser(env.DB, done.user_id);
    if (!u) return out({ status: 'expired' });
    return out({ status: 'done', purpose: 'register', username: done.username, qq: done.qq || null },
      200, [await issueSession(env, u)]);
  }
  if (row.purpose === 'link') {
    await deleteQQCode(env.DB, row.code);
    return out({ status: 'done', purpose: 'link', qq: done.qq || null });
  }
  // reset：列要留著（resetToken 一次性要靠它），只換掉 browser_key
  await burnQQKey(env.DB, row.code);
  const resetToken = await signToken(resetKey(env), { p: 'pwreset', c: row.code, u: done.user_id, e: nowS + RESET_TTL });
  return out({ status: 'done', purpose: 'reset', resetToken, username: done.username, ttl: RESET_TTL });
}
