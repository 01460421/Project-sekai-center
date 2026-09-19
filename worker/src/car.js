/* 私車排班頁：Worker 夾在前端與菜根機器人之間（合約第 2、4 節）。

   GET/POST /car/api/<rest>  → CAIBOT_API_BASE + /api/<rest>（保留 query）
     - 要已登入（sekai_session）,且身上至少有 Discord 或一個 QQ 身分;
       **不看站內核准狀態** —— 車隊頁的權限由機器人端的車隊角色決定。
     - 客戶端送來的 X-Caibot-* 與 Cookie 一律丟掉,只轉 Content-Type 與 body,
       再由 Worker 加上簽章標頭（身分放在 X-Caibot-Ident,機器人驗簽後才信）。
     - 非 GET 要求 Origin 是本站,擋 CSRF。
     - GET 也要擋跨站：Sec-Fetch-Site 是 cross-site、或 Origin 不是本站 → 403
       （機器人自己的 Sec-Fetch-Site 檢查在代理後面永遠看不到這個標頭,所以在這裡做）。
     - 機器人回應只收 JSON；不是 JSON 就改成我們自己的 JSON 錯誤,並加 nosniff 與 CSP,
       免得機器人哪天回了反射輸入的 HTML,變成 Worker 網域（同時服務 /api、/admin）上的 XSS。
   POST /car/qqbind          ← 機器人（QQ 使用者打 /网页 <碼>）,驗機器人簽章後依 purpose 執行。
     兩步確認：第一次送碼只回「你正在做什麼」的警告＋一組綁在這個 QQ 身分上的確認碼,
     同一個 QQ 再送確認碼才真正註冊／綁定／放行重設。詳見 qqBind 前的說明。 */

import { corsHeaders, originIsSite } from './cors.js';
import { currentUser } from './auth.js';
import { bridgeHeaders, bridgeVerify, b64urlJson, cleanSecret } from './bridge.js';
import { clientIp } from './accounts.js';
import {
  qqOfUser, qqOwner, passwordByUsername, getUser, failCount, addFail, useBridgeNonce,
  qqCodeByCode, claimQQCode, awaitQQCode, swapQQCode, finishQQCode, deleteQQCode, createQQCode, createQQUser, linkQQ,
  unlinkQQMember, bumpSessionVer,
} from './db.js';

const MAX_PROXY_BODY = 256 * 1024;
const PROXY_TIMEOUT = 20000;
const REST_OK = /^[A-Za-z0-9_\-.~/]{0,200}$/;
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];

/* 代理回應一律加的安全標頭：就算內容被當成頁面打開也什麼都不能執行 */
const HARDEN = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
};
const JSON_CT = /^application\/([\w.+-]+\+)?json\s*(;|$)/i;

function json(req, env, obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...HARDEN, ...corsHeaders(req, env) },
  });
}

/* 跨站請求一律擋。Sec-Fetch-Site 由瀏覽器填、網頁改不了：
   same-origin／same-site（主站 fetch 過來）與 none（使用者自己打網址）放行,cross-site 擋掉。
   有 Origin 的話它也必須是本站（或 Worker 自己）。 */
function crossSite(req, env, url) {
  const sfs = (req.headers.get('Sec-Fetch-Site') || '').toLowerCase();
  if (sfs && sfs !== 'same-origin' && sfs !== 'same-site' && sfs !== 'none') return true;
  const o = req.headers.get('Origin');
  if (o && o !== url.origin && !originIsSite(req, env)) return true;
  return false;
}

/* 身分 JSON（Worker → 機器人）。鍵的順序照合約,方便兩邊對照除錯。 */
export async function identityOf(env, user) {
  const qq = (await qqOfUser(env.DB, user.id)).map(r => ({ g: r.group_openid, m: r.member_openid, n: r.name || '' }));
  return {
    v: 1,
    uid: user.id,
    name: user.name || '',
    dc: user.discord_id || null,
    dn: user.discord_id ? (user.discord_name || '') : null,
    qq,
  };
}

export async function handleCar(req, env, url) {
  const p = url.pathname;
  if (p === '/car/qqbind') return qqBind(req, env, url);
  if (p === '/car/api' || p.startsWith('/car/api/')) return proxy(req, env, url);
  return null;
}

/* ---------- 代理 ---------- */

async function proxy(req, env, url) {
  const out = (o, s) => json(req, env, o, s);
  if (req.method === 'OPTIONS') {
    const h = corsHeaders(req, env);
    h['access-control-allow-methods'] = METHODS.join(', ') + ', OPTIONS';
    h['access-control-allow-headers'] = 'Content-Type';
    h['access-control-max-age'] = '86400';
    return new Response(null, { status: 204, headers: h });
  }
  if (METHODS.indexOf(req.method) < 0) return out({ error: 'method_not_allowed' }, 405);
  const secret = cleanSecret(env.CAIBOT_BRIDGE_SECRET);
  const base = String(env.CAIBOT_API_BASE || '').replace(/\/+$/, '');
  if (!secret || !base) return out({ error: 'car_not_configured' }, 503);

  const rest = p2rest(url.pathname);
  if (rest == null) return out({ error: 'bad_path' }, 400);

  if (req.method !== 'GET' && req.method !== 'HEAD' && !originIsSite(req, env)) return out({ error: 'bad_origin' }, 403);
  if (crossSite(req, env, url)) return out({ error: 'bad_origin' }, 403);

  const user = await currentUser(req, env);
  if (!user) return out({ error: 'need_login' }, 401);
  const ident = await identityOf(env, user);
  if (!ident.dc && !ident.qq.length) return out({ error: 'need_identity' }, 403);

  let body = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const declared = Number(req.headers.get('Content-Length') || 0);
    if (declared > MAX_PROXY_BODY) return out({ error: 'too_large' }, 413);
    body = await req.arrayBuffer();
    if (body.byteLength > MAX_PROXY_BODY) return out({ error: 'too_large' }, 413);
  }

  const pathq = '/api' + rest + url.search;
  const identStr = b64urlJson(ident);
  const sigH = await bridgeHeaders(secret, {
    method: req.method, pathq, ident: identStr, ip: clientIp(req), body,
  });
  // 全新的標頭：客戶端的 Cookie、X-Caibot-*、Authorization 一個都不帶過去
  const h = new Headers(sigH);
  const ct = req.headers.get('Content-Type');
  if (ct && body) h.set('Content-Type', ct);
  h.set('Accept', 'application/json');

  let up;
  try {
    up = await fetch(base + pathq, {
      method: req.method, headers: h, body: body && body.byteLength ? body : (body ? new Uint8Array(0) : undefined),
      redirect: 'manual', signal: AbortSignal.timeout(PROXY_TIMEOUT),
    });
  } catch (e) {
    console.error('car proxy upstream', e && e.message);
    return out({ error: 'bot_unreachable', message: '車隊機器人目前連不上，請稍後再試' }, 502);
  }
  // 機器人的回應原樣回給前端（狀態碼＋JSON body）,但不讓它的 Set-Cookie／轉址／非 JSON 內容穿過來
  const drop = async () => { try { if (up.body) await up.body.cancel(); } catch (e) {} };
  if (up.status >= 300 && up.status < 400) { await drop(); return out({ error: 'bot_redirect' }, 502); }
  const uct = up.headers.get('content-type') || '';
  const empty = req.method === 'HEAD' || up.status === 204 || up.status === 205;
  if (!empty && !JSON_CT.test(uct)) {
    await drop();
    /* 最常見的情況：機器人還沒更新到驗簽模式,/api/car/me 之類的新路由不存在,aiohttp 回純文字 404。
       保留狀態碼讓前端判斷,內容換成我們自己的 JSON（不回顯機器人給的任何字）。 */
    if (up.status === 404) return out({ error: 'bot_not_updated', message: '車隊機器人尚未更新或不支援這個功能' }, 404);
    return out({ error: 'bot_bad_response', message: '車隊機器人回應格式不正確，請稍後再試' }, 502);
  }
  const rh = new Headers(corsHeaders(req, env));
  for (const [k, v] of Object.entries(HARDEN)) rh.set(k, v);
  rh.set('content-type', 'application/json; charset=utf-8');
  rh.set('cache-control', 'no-store');
  return new Response(empty ? null : up.body, { status: up.status, headers: rh });
}

/* /car/api/<rest> → '/<rest>'（或 ''）。URL 解析時已經把 ../ 正規化掉了；
   這裡再擋百分比編碼（%2e%2e 之類）與其他奇怪字元,只放行固定字元集。 */
function p2rest(pathname) {
  const rest = pathname.slice('/car/api'.length);
  if (!REST_OK.test(rest)) return null;
  if (rest && rest[0] !== '/') return null;
  if (/(^|\/)\.\.?(\/|$)/.test(rest) || rest.indexOf('//') >= 0) return null;
  return rest;
}

/* ---------- QQ 綁定（機器人 → Worker） ----------

   碼是使用者自己打在 QQ 群裡的（/网页 123456）,群裡每個人都看得到。所以：
   1. 碼一旦被機器人搶下就**絕不放回未使用**。任何失敗（含例外）都把碼作廢（failed）,
      網頁輪詢拿到 status:'fail' 後重新取碼。以前失敗會放回去讓本人重打 —— 同群旁觀者就能接手,
      把自己的 QQ 綁到受害者帳號,再用那個 QQ 重設受害者的密碼。
   2. 兩步確認。第一次送碼：先做完所有能先做的檢查,失敗就作廢；通過的話回一段**寫明要做什麼**
      的警告（註冊新帳號／綁到哪個網頁帳號／重設哪個帳號的密碼）＋一組新的 6 位確認碼。
      確認碼綁死在這個 QQ 身分 (g,m) 上,別人送了也沒用。同一個 QQ 再送確認碼才真正執行。
      → 攻擊者自己在網頁發碼、騙受害者在群裡打（釣魚）時,受害者會先看到「你正在重設帳號 X 的密碼,
        不是你本人操作請忽略」,而不是一步就把帳號交出去。
   3. 等確認期間如果有**另一個** QQ 也送了同一個主碼（旁觀者照抄）,整張碼作廢。
   4. 回覆一律不帶帳號名（帳號名是登入用的,貼在群裡等於幫人挑目標）；重設時只給遮罩過的提示。
   機器人那端不用改：一樣是 {code,g,m,name} 進、{ok,text} 出,確認碼也是 6 位數字。 */

const QQ_MEMBER_MAX = 5;      // 同一個 QQ 身分 15 分鐘內送錯碼的上限
const QQ_GROUP_MAX = 30;      // 同一個群 15 分鐘內送錯碼的上限
/* 全站送錯碼超過 QQ_ALL_HIGH 時不再全面封鎖（那等於 60 個 QQ 號就能關掉全站的 QQ 註冊）,
   只把「每群上限」收緊到 QQ_GROUP_MAX_HIGH —— 正在被拿來猜碼的群會先被擋,沒出事的群照常。 */
const QQ_ALL_HIGH = 300;
const QQ_GROUP_MAX_HIGH = 5;
const CONFIRM_TTL = 120;
const WIN = 15 * 60;

const cleanName = v => String(v || '').replace(/[ -​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, 20);
const maskUser = u => {
  u = String(u || '');
  if (u.length <= 3) return (u[0] || '') + '**';
  return u.slice(0, 2) + '*'.repeat(Math.min(6, u.length - 3)) + u.slice(-1);
};

function confirmText(purpose, cc, extra) {
  const tail = '\n确认请在 2 分钟内由你本人发送：/网页 ' + cc;
  if (purpose === 'register') {
    return '⚠ 你正在用这个 QQ 注册一个新的网页账号，注册后该账号会绑定这个 QQ（可用来进入车队页、重置密码）。'
      + '\n只有你本人刚在网页上点了「用 QQ 注册」才继续；如果是别人叫你发的，请忽略，不要发送下面的确认码。' + tail;
  }
  if (purpose === 'link') {
    return '⚠ 你正在把这个 QQ 绑定到网页账号「' + (extra || '未命名') + '」。绑定后该网页账号可以用你的 QQ 身分进入车队，也能用这个 QQ 重置密码。'
      + '\n只有那是你本人的网页账号才继续；如果是别人叫你发的，请忽略，不要发送下面的确认码。' + tail;
  }
  return '⚠ 你正在重置网页账号「' + (extra || '') + '」的密码。'
    + '\n只有你本人刚在网页上点了「忘记密码」才继续；如果是别人叫你发的，请忽略，对方就无法改你的密码。' + tail;
}

async function qqBind(req, env, url) {
  const res = (o, s) => new Response(JSON.stringify(o), {
    status: s || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
  if (req.method !== 'POST') return res({ ok: false, error: 'method_not_allowed' }, 405);
  const secret = cleanSecret(env.CAIBOT_BRIDGE_SECRET);
  if (!secret) return res({ ok: false, error: 'not_configured' }, 503);

  const declared = Number(req.headers.get('Content-Length') || 0);
  if (declared > 4096) return res({ ok: false, error: 'too_large' }, 413);
  const buf = await req.arrayBuffer();
  if (buf.byteLength > 4096) return res({ ok: false, error: 'too_large' }, 413);

  const v = await bridgeVerify(secret, req, url.pathname + url.search, buf);
  if (!v.ok) return res({ ok: false, error: 'bad_signature', why: v.why }, 401);
  if (v.ip !== 'bot' || v.ident !== '') return res({ ok: false, error: 'bad_signature', why: 'bad_direction' }, 401);
  if (!(await useBridgeNonce(env.DB, v.nonce))) return res({ ok: false, error: 'replay' }, 401);

  let b;
  try { b = JSON.parse(new TextDecoder().decode(buf)); } catch (e) { b = null; }
  if (!b || typeof b !== 'object') return res({ ok: false, error: 'bad_json' }, 400);
  const code = String(b.code == null ? '' : b.code).trim();
  const g = typeof b.g === 'string' ? b.g.trim() : '';
  const m = typeof b.m === 'string' ? b.m.trim() : '';
  const qqName = typeof b.name === 'string' ? cleanName(b.name.trim().slice(0, 64)) : '';
  if (!g || !m || g.length > 128 || m.length > 128) return res({ ok: false, error: 'bad_identity' }, 400);
  const mk = g + ':' + m;

  /* QQ 端自己解除綁定（例如 /网页 解绑）：只有這個 QQ 身分本人（機器人驗過發訊者）才能發動,
     把 (g,m) 從它綁著的網頁帳號拿掉,並讓該帳號所有 session 失效。
     被騙綁到別人帳號的受害者,不必登入那個帳號就能自己解開。 */
  if (b.action === 'unlink') {
    const owner = await qqOwner(env.DB, g, m);
    if (!owner) return res({ ok: true, text: '这个 QQ 目前没有绑定任何网页账号。' });
    await unlinkQQMember(env.DB, g, m);
    try { await bumpSessionVer(env.DB, owner.user_id); } catch (e) { console.error('unlink bump', e && e.message); }
    return res({ ok: true, text: '已解除这个 QQ 与网页账号的绑定，该网页账号已在所有装置登出。' });
  }

  const fail = async (text) => {
    await addFail(env.DB, [['qqm', mk], ['qqg', g], ['qqall', '*']]);
    return res({ ok: false, text });
  };

  const [cm, cg, ca] = await Promise.all([
    failCount(env.DB, 'qqm', mk, WIN), failCount(env.DB, 'qqg', g, WIN), failCount(env.DB, 'qqall', '*', WIN)]);
  if (cm >= QQ_MEMBER_MAX || cg >= (ca >= QQ_ALL_HIGH ? QQ_GROUP_MAX_HIGH : QQ_GROUP_MAX)) {
    return res({ ok: false, text: '尝试次数过多，请 15 分钟后再试。' });
  }
  if (!/^\d{6}$/.test(code)) return fail('验证码格式不对，应为网页上显示的 6 位数字。');

  const nowS = Math.floor(Date.now() / 1000);
  const row = await qqCodeByCode(env.DB, code);
  if (!row || row.exp < nowS) return fail('验证码无效或已过期，请回到网页重新获取。');

  try {
    if (row.purpose === 'confirm') return await qqConfirm(env, row, g, m, qqName, res, fail);
    return await qqFirst(env, row, g, m, qqName, res, fail);
  } catch (e) {
    console.error('qqbind error', e && (e.stack || e.message));
    // 出錯也不放回：作廢,網頁輪詢會拿到 fail 重新取碼
    try {
      if (row.purpose === 'confirm') {
        let pl = {};
        try { pl = JSON.parse(row.payload_json || '{}'); } catch (e3) { pl = {}; }
        if (pl.parent) await finishQQCode(env.DB, pl.parent, { status: 'failed', reason: 'error' });
        await deleteQQCode(env.DB, row.code);
      } else {
        await finishQQCode(env.DB, row.code, { status: 'failed', reason: 'error' });
      }
    } catch (e2) { /* 盡力而為 */ }
    return res({ ok: false, text: '网站暂时出错，这组验证码已作废，请回到网页重新获取。' }, 500);
  }
}

/* 第一步：主碼 */
async function qqFirst(env, row, g, m, qqName, res, fail) {
  const code = row.code;
  let done = null;
  try { done = row.done_json ? JSON.parse(row.done_json) : null; } catch (e) { done = null; }

  if (done && done.status === 'await') {
    if (done.g === g && done.m === m) {
      // 同一個 QQ 重送（平台重推或本人多打一次）：把同一段確認訊息再回一次,不算失敗
      return res({ ok: true, text: confirmText(row.purpose, done.cc, done.x) });
    }
    // 別的 QQ 也送了同一個碼（群裡照抄）→ 整張作廢
    if (await swapQQCode(env.DB, code, row.done_json, { status: 'failed', reason: 'contested' })) {
      if (done.cc) await deleteQQCode(env.DB, done.cc);
    }
    return fail('这组验证码已被其他 QQ 使用，为了安全已作废。请本人回到网页重新获取。');
  }
  if (done) {
    if (done.status === 'done' && done.qq && done.qq.g === g && done.by === m) return res({ ok: true, text: '已经完成了，请回到网页查看。' });
    return fail('验证码无效或已过期，请回到网页重新获取。');
  }
  if (!(await claimQQCode(env.DB, code))) return fail('验证码无效或已过期，请回到网页重新获取。');

  const burn = async (reason, text) => {
    await finishQQCode(env.DB, code, { status: 'failed', reason });
    return fail(text);
  };
  let payload = {};
  try { payload = JSON.parse(row.payload_json || '{}'); } catch (e) { payload = {}; }

  let extra = '';
  if (row.purpose === 'register') {
    if (await qqOwner(env.DB, g, m)) {
      return burn('qq_taken', '这个 QQ 已经绑定了网站账号，请直接在网页登录；忘记密码可以用「忘记密码」。这组验证码已作废。');
    }
    if (!payload.username || await passwordByUsername(env.DB, payload.username)) {
      return burn('username_taken', '这个账号名刚刚被别人注册了，这组验证码已作废，请回网页换一个账号名。');
    }
  } else if (row.purpose === 'link') {
    const u = payload.uid ? await getUser(env.DB, payload.uid) : null;
    if (!u) return burn('no_user', '找不到要绑定的网站账号，这组验证码已作废，请回网页重新获取。');
    const owner = await qqOwner(env.DB, g, m);
    if (owner && owner.user_id !== u.id) {
      return burn('qq_taken', '这个 QQ 已经绑定了另一个网站账号，一个 QQ 只能绑一个账号。这组验证码已作废。');
    }
    if (owner) {
      // 已經綁在這個帳號上：只更新名字,沒有新增任何權限,不必再確認
      await linkQQ(env.DB, u.id, g, m, qqName);
      await finishQQCode(env.DB, code, { status: 'done', purpose: 'link', user_id: u.id, qq: { g, n: qqName }, by: m });
      return res({ ok: true, text: '这个 QQ 本来就绑定在这个网页账号上了。' });
    }
    extra = cleanName(u.name);
  } else if (row.purpose === 'reset') {
    const pw = payload.username ? await passwordByUsername(env.DB, payload.username) : null;
    const owner = await qqOwner(env.DB, g, m);
    /* 只接受「該帳號已綁定的 QQ 身分」—— 否則任何人都能拿自己的 QQ 重設別人的密碼。
       帳號不存在與沒綁這個 QQ 回同一句話,不透露帳號是否存在。 */
    if (!pw || !owner || owner.user_id !== pw.user_id) {
      return burn('not_linked', '这个 QQ 没有绑定该网站账号，无法重置密码。这组验证码已作废。');
    }
    extra = maskUser(pw.username);
  } else {
    return burn('error', '验证码无效或已过期，请回到网页重新获取。');
  }

  const c = await createQQCode(env.DB, 'confirm', { parent: code, g, m }, '', CONFIRM_TTL, 'cc');
  await awaitQQCode(env.DB, code, { status: 'await', g, m, n: qqName, cc: c.code, x: extra }, c.exp);
  return res({ ok: true, text: confirmText(row.purpose, c.code, extra) });
}

/* 第二步：確認碼（只認發給它的那個 QQ 身分） */
async function qqConfirm(env, crow, g, m, qqName, res, fail) {
  let pl = {};
  try { pl = JSON.parse(crow.payload_json || '{}'); } catch (e) { pl = {}; }
  // 不是發給你的確認碼：拒絕,但不作廢（別人照抄確認碼傷不到本人）
  if (pl.g !== g || pl.m !== m) return fail('这个确认码不是发给你的。');
  const prow = pl.parent ? await qqCodeByCode(env.DB, pl.parent) : null;
  let done = null;
  try { done = prow && prow.done_json ? JSON.parse(prow.done_json) : null; } catch (e) { done = null; }
  if (!prow || !done || done.status !== 'await' || done.cc !== crow.code || done.g !== g || done.m !== m) {
    await deleteQQCode(env.DB, crow.code);
    return fail('确认码无效或已过期，请回到网页重新获取验证码。');
  }
  // 搶下這一步（兩個確認請求同時到,只有一個會成功）
  if (!(await swapQQCode(env.DB, prow.code, prow.done_json, { status: 'processing' }))) {
    return fail('确认码无效或已过期，请回到网页重新获取验证码。');
  }
  await deleteQQCode(env.DB, crow.code);
  const code = prow.code;
  const burn = async (reason, text) => {
    await finishQQCode(env.DB, code, { status: 'failed', reason });
    return fail(text);
  };
  let payload = {};
  try { payload = JSON.parse(prow.payload_json || '{}'); } catch (e) { payload = {}; }
  const name = qqName || done.n || '';
  const qq = { g, n: name };

  if (prow.purpose === 'register') {
    const r = await createQQUser(env.DB, { username: payload.username, hash: payload.hash, name: name || payload.username, g, m, qqName: name });
    if (r.taken) {
      const again = await qqOwner(env.DB, g, m);
      return burn(again ? 'qq_taken' : 'username_taken', '注册没有完成（账号名或这个 QQ 刚被占用），这组验证码已作废，请回网页重新操作。');
    }
    await finishQQCode(env.DB, code, { status: 'done', purpose: 'register', user_id: r.id, username: payload.username, qq, by: m });
    return res({ ok: true, text: '注册完成！网页会自动登录。' });
  }
  if (prow.purpose === 'link') {
    const u = payload.uid ? await getUser(env.DB, payload.uid) : null;
    if (!u) return burn('no_user', '找不到要绑定的网站账号，这组验证码已作废。');
    const r = await linkQQ(env.DB, u.id, g, m, name);
    if (r.taken) return burn('qq_taken', '这个 QQ 已经绑定了另一个网站账号，一个 QQ 只能绑一个账号。');
    await finishQQCode(env.DB, code, { status: 'done', purpose: 'link', user_id: u.id, qq, by: m });
    return res({ ok: true, text: '绑定完成！' });
  }
  if (prow.purpose === 'reset') {
    const pw = payload.username ? await passwordByUsername(env.DB, payload.username) : null;
    const owner = await qqOwner(env.DB, g, m);
    if (!pw || !owner || owner.user_id !== pw.user_id) return burn('not_linked', '这个 QQ 没有绑定该网站账号，无法重置密码。');
    await finishQQCode(env.DB, code, { status: 'done', purpose: 'reset', user_id: pw.user_id, username: pw.username, rt_used: 0, qq, by: m });
    return res({ ok: true, text: '验证成功！请回到网页设置新密码（10 分钟内有效）。' });
  }
  return burn('error', '验证码无效或已过期，请回到网页重新获取。');
}
