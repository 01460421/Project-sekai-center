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
/* atob 回傳的是 latin1 binary string —— 中文名字在 id_token 裡是 UTF-8,
   直接拿 atob 的結果當字串,每個位元組會被當成一個字元,顯示出來就是亂碼。
   要先還原成位元組再用 TextDecoder 解 UTF-8。 */
const unb64u = s => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - s.length % 4) % 4));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
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

/* 這一頁是在 Worker 自己的網域上跑的,而那個網域同時服務 /api/* 與 /admin/*。
   任何插進這裡的 HTML 都會在該來源執行,SameSite=Lax 又會讓它發出的同源請求
   自動帶上 session cookie —— 也就是說這裡的字串一旦沒跳脫,就等於把帳號送人
   (HttpOnly 擋不住,攻擊腳本不需要讀 cookie,只要用它打 API 就好)。
   所以:所有插值一律跳脫,跳轉目標一律只接受同源相對路徑。 */
const esc = v => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* 只允許「單一斜線開頭」的相對路徑。擋掉 //evil.com（協定相對網址,會跳到外站）
   與任何帶協定的絕對網址;不合格就退回帳號頁。 */
function safePath(r) {
  const v = String(r || '');
  if (!/^\/[^/\\]/.test(v)) return '/app.html?page=account';
  if (v.length > 200) return '/app.html?page=account';
  return v;
}

/* 登入完成後跳回站上。用 HTML 而不是 302，是為了在同一個回應裡種 cookie
   並讓使用者看到結果。to 必須是呼叫端自己組出來的可信網址。 */
const bounce = (to, msg) => html(
  `<!doctype html><meta charset="utf-8"><title>登入中…</title>
   <body style="font-family:system-ui;padding:40px;text-align:center;color:#333">
   <p>${esc(msg || '登入成功，正在返回…')}</p>
   <script>location.replace(${JSON.stringify(String(to))})</script>
   <p><a href="${esc(to)}">如果沒有自動跳轉，點這裡</a></p></body>`);

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
      r: safePath(url.searchParams.get('r')),
    });
    return Response.redirect(isG ? googleAuthUrl(env, state) : discordAuthUrl(env, state), 302);
  }

  if (p === '/auth/google/callback' || p === '/auth/discord/callback') {
    const isG = p === '/auth/google/callback';
    const err = url.searchParams.get('error');
    // 供應商回傳的 error 是外部輸入,只用代碼比對後顯示我們自己的文案,不回顯原文
    if (err) return bounce(site + '/app.html?page=account',
      err === 'access_denied' ? '你取消了授權，沒有完成登入。' : '登入沒有完成（供應商回報錯誤）。請再試一次。');
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
        const res = bounce(site + safePath(st.r));
        res.headers.append('Set-Cookie', sessionCookie(tok, env.COOKIE_DOMAIN));
        return res;
      }
      const me = await currentUser(req, env);
      if (!me) return bounce(site + '/app.html?page=account', 'session 已過期，請重新登入。');
      const d = await discordExchange(env, code);
      await linkDiscord(env.DB, me.id, d);
      return bounce(site + safePath(st.r), 'Discord 已綁定，正在返回…');
    } catch (e) {
      // 例外訊息裡可能帶有供應商回應的原文,只記到 log,不吐回瀏覽器
      console.error('oauth exchange failed', e && e.message);
      return html('登入流程失敗，請重新登入。若持續發生請聯絡管理員。', 502);
    }
  }

  if (p === '/auth/logout') {
    const res = bounce(site + '/app.html', '已登出');
    res.headers.append('Set-Cookie', clearCookie(env.COOKIE_DOMAIN));
    return res;
  }
  return null;
}
