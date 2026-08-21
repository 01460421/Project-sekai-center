/* Google／Discord OAuth 與 session。

   session 不進資料庫：cookie 裡放 base64url(payload).base64url(HMAC-SHA256)，
   payload 是 {u:userId, e:到期秒}。每次請求只要驗簽就好，不必為了認身分多打一次 D1。
   代價是沒辦法即時撤銷，所以效期壓在 30 天，且改密鑰等於全站登出。

   OAuth 的 state 同樣用簽章而不是存 server 狀態：state 內含 nonce 與要跳回的頁面，
   驗簽通過才接受，藉此擋 CSRF。 */

import { upsertGoogleUser, linkDiscord, getUser } from './db.js';

const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uStr = s => b64u(enc.encode(s));
const unb64u = s => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  return atob(s + '='.repeat((4 - s.length % 4) % 4));
};

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
/* 逐字元比較會因為提早 return 而洩漏長度資訊，這裡做定時比較 */
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function signToken(secret, obj) {
  const p = b64uStr(JSON.stringify(obj));
  return p + '.' + await hmac(secret, p);
}
export async function verifyToken(secret, tok) {
  if (!tok || tok.indexOf('.') < 0) return null;
  const [p, sig] = tok.split('.');
  if (!p || !sig) return null;
  if (!safeEq(sig, await hmac(secret, p))) return null;
  let obj; try { obj = JSON.parse(unb64u(p)); } catch (e) { return null; }
  if (obj.e && obj.e < Math.floor(Date.now() / 1000)) return null;
  return obj;
}

const SESSION_DAYS = 30;
export const sessionCookie = (tok, domain) =>
  `sekai_session=${tok}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax` +
  (domain ? `; Domain=${domain}` : '');
export const clearCookie = domain =>
  `sekai_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` + (domain ? `; Domain=${domain}` : '');

export function readCookie(req, name) {
  const c = req.headers.get('Cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return m ? m[1] : null;
}

/* 目前登入者。回 null 代表未登入；不在這裡判斷核准狀態，交給呼叫端決定。 */
export async function currentUser(req, env) {
  const tok = readCookie(req, 'sekai_session');
  const obj = await verifyToken(env.SESSION_SECRET, tok);
  if (!obj || !obj.u) return null;
  return await getUser(env.DB, obj.u);
}

/* ---------- Google ---------- */

export function googleAuthUrl(env, state) {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  u.searchParams.set('redirect_uri', env.OAUTH_BASE + '/auth/google/callback');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('state', state);
  u.searchParams.set('prompt', 'select_account');
  return u.toString();
}

export async function googleExchange(env, code) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.OAUTH_BASE + '/auth/google/callback', grant_type: 'authorization_code',
    }),
  });
  if (!r.ok) throw new Error('google token ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const tk = await r.json();
  /* id_token 是 Google 簽的 JWT。這個 token 剛從 Google 的 token endpoint 經 TLS 拿到，
     來源已經可信，所以只解 payload 取欄位，不重新驗簽（要驗簽得再抓一次 JWKS）。 */
  const payload = JSON.parse(unb64u(tk.id_token.split('.')[1]));
  return { sub: payload.sub, email: payload.email, name: payload.name, picture: payload.picture,
           emailVerified: payload.email_verified !== false };
}

/* ---------- Discord（車隊房間偵測要靠它辨識身分） ---------- */

export function discordAuthUrl(env, state) {
  const u = new URL('https://discord.com/oauth2/authorize');
  u.searchParams.set('client_id', env.DISCORD_CLIENT_ID);
  u.searchParams.set('redirect_uri', env.OAUTH_BASE + '/auth/discord/callback');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'identify guilds');
  u.searchParams.set('state', state);
  return u.toString();
}

export async function discordExchange(env, code) {
  const r = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET,
      redirect_uri: env.OAUTH_BASE + '/auth/discord/callback', grant_type: 'authorization_code',
    }),
  });
  if (!r.ok) throw new Error('discord token ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const tk = await r.json();
  const me = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: 'Bearer ' + tk.access_token },
  }).then(x => x.json());
  return { id: me.id, username: me.global_name || me.username, access_token: tk.access_token };
}

/* ---------- 路由 ---------- */

const html = (body, status) => new Response(body, { status: status || 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

/* 登入完成後跳回站上。用 HTML 而不是 302，是為了在同一個回應裡種 cookie
   並讓使用者看到結果（OAuth 失敗時直接把原因寫在畫面上比較好查）。 */
const bounce = (to, msg) => html(
  `<!doctype html><meta charset="utf-8"><title>登入中…</title>
   <body style="font-family:system-ui;padding:40px;text-align:center;color:#333">
   <p>${msg || '登入成功，正在返回…'}</p>
   <script>location.replace(${JSON.stringify(to)})</script>
   <p><a href="${to}">如果沒有自動跳轉，點這裡</a></p></body>`);

export async function handleAuth(req, env, url) {
  const p = url.pathname;
  const site = env.SITE_BASE || 'https://project-sekai-center.com';

  if (p === '/auth/google' || p === '/auth/discord') {
    const isG = p === '/auth/google';
    if (isG && !env.GOOGLE_CLIENT_ID) return html('尚未設定 GOOGLE_CLIENT_ID', 500);
    if (!isG && !env.DISCORD_CLIENT_ID) return html('尚未設定 DISCORD_CLIENT_ID', 500);
    // Discord 是「綁定」不是「登入」，必須先有 session
    if (!isG && !(await currentUser(req, env))) return bounce(site + '/app.html?page=account', '請先用 Google 登入再綁定 Discord');
    const state = await signToken(env.SESSION_SECRET, {
      n: crypto.randomUUID(), e: Math.floor(Date.now() / 1000) + 600,
      r: url.searchParams.get('r') || '/app.html?page=account',
    });
    return Response.redirect(isG ? googleAuthUrl(env, state) : discordAuthUrl(env, state), 302);
  }

  if (p === '/auth/google/callback' || p === '/auth/discord/callback') {
    const isG = p === '/auth/google/callback';
    const err = url.searchParams.get('error');
    if (err) return bounce(site + '/app.html?page=account', '登入取消或失敗：' + err);
    const st = await verifyToken(env.SESSION_SECRET, url.searchParams.get('state') || '');
    if (!st) return html('state 驗證失敗（可能是逾時或被竄改），請重新登入。', 400);
    const code = url.searchParams.get('code');
    if (!code) return html('缺少 code', 400);
    try {
      if (isG) {
        const prof = await googleExchange(env, code);
        if (!prof.emailVerified) return html('這個 Google 帳號的信箱尚未驗證，無法用來接收通知。', 400);
        const user = await upsertGoogleUser(env.DB, prof, env.ADMIN_EMAIL);
        const tok = await signToken(env.SESSION_SECRET, { u: user.id, e: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400 });
        const res = bounce(site + (st.r || '/app.html?page=account'));
        res.headers.append('Set-Cookie', sessionCookie(tok, env.COOKIE_DOMAIN));
        return res;
      }
      const me = await currentUser(req, env);
      if (!me) return bounce(site + '/app.html?page=account', 'session 已過期，請重新登入。');
      const d = await discordExchange(env, code);
      await linkDiscord(env.DB, me.id, d);
      return bounce(site + (st.r || '/app.html?page=account'), 'Discord 已綁定，正在返回…');
    } catch (e) {
      return html('OAuth 交換失敗：' + (e && e.message ? e.message : e), 502);
    }
  }

  if (p === '/auth/logout') {
    const res = bounce(site + '/app.html', '已登出');
    res.headers.append('Set-Cookie', clearCookie(env.COOKIE_DOMAIN));
    return res;
  }
  return null;
}
