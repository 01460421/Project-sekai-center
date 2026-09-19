/* Google／Discord OAuth 與 session。

   session 不進資料庫：cookie 裡放 base64url(payload).base64url(HMAC-SHA256)，
   payload 是 {u:userId, v:工作階段版本, e:到期秒}。每次請求驗簽後照樣要 getUser,
   順便比對 users.session_ver —— 改密碼／重設密碼／解綁身分時版本 +1,舊 cookie 全部失效。

   OAuth 的 state 用簽章而不是存 server 狀態：state 內含 nonce 與要跳回的頁面；
   另外同一個 nonce 放在只屬於這個瀏覽器的 oauth_n cookie,回呼時兩者要對得上,
   否則攻擊者可以把自己的 state＋code 塞給受害者,讓受害者登入成攻擊者（登入 CSRF）。 */

import { upsertGoogleUser, getUser, userByDiscord, createDiscordUser, linkDiscordSafe } from './db.js';

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

/* 目前登入者。回 null 代表未登入；不在這裡判斷核准狀態，交給呼叫端決定。
   session 版本：cookie 的 v 要等於 users.session_ver（改密碼／重設／解綁時 +1）,
   舊 cookie 就此失效。反正每次都要 getUser,比對版本不多花一次 D1。
   017 遷移還沒跑時 users 沒有這個欄位（undefined）→ 不比對,行為同舊版。 */
export async function currentUser(req, env) {
  const tok = readCookie(req, 'sekai_session');
  const obj = await verifyToken(env.SESSION_SECRET, tok);
  if (!obj || !obj.u) return null;
  const u = await getUser(env.DB, obj.u);
  if (!u) return null;
  if (u.session_ver != null && (Number(obj.v) || 0) !== (Number(u.session_ver) || 0)) return null;
  return u;
}

/* 發 session cookie。一律走這支,版本號才不會漏帶。user 要是完整的 users 列。 */
export async function issueSession(env, user) {
  const tok = await signToken(env.SESSION_SECRET, {
    u: user.id, v: Number(user.session_ver) || 0, e: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400,
  });
  return sessionCookie(tok, env.COOKIE_DOMAIN);
}

/* OAuth 登入 CSRF：state 只有簽章的話,攻擊者可以把「自己的」state＋code 塞給受害者的瀏覽器,
   讓受害者登入成攻擊者的帳號（之後受害者加綁的 QQ／Discord 就落到攻擊者手上）。
   所以發 state 時同時在這個瀏覽器種一個短命的 HttpOnly cookie（只在 Worker 自己的網域、
   Path=/auth/),state 裡放同一個 nonce,回呼時兩者要對得上。
   cookie 裡最多留 3 個 nonce,同時開兩三個登入分頁也不會互相踢掉。 */
const OAUTH_COOKIE = 'oauth_n';
const NONCE_RE = /^[0-9a-f]{32}$/;
const oauthNonces = req => String(readCookie(req, OAUTH_COOKIE) || '').split('.').filter(x => NONCE_RE.test(x));
const oauthCookie = list =>
  `${OAUTH_COOKIE}=${list.join('.')}; Path=/auth/; Max-Age=${list.length ? 600 : 0}; HttpOnly; Secure; SameSite=Lax`;
const randHex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');

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

/* ---------- Discord（車隊頁與房間偵測要靠它辨識身分；也可以直接用它登入） ---------- */

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
  if (!me || !me.id) throw new Error('discord @me failed');
  const avatar = me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=128` : '';
  return { id: me.id, username: me.global_name || me.username, avatar, access_token: tk.access_token };
}

/* ---------- 路由 ---------- */

/* 這些頁面只有一段就地跳轉的 script：CSP 禁掉所有連線（default-src 'none' 含 connect-src）,
   就算哪天又有字串沒跳脫被插進來,腳本也發不出任何 API 請求。 */
const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
const html = (body, status) => new Response(body, { status: status || 200, headers: HTML_HEADERS });

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
export function safePath(r) {
  const v = String(r || '');
  if (!/^\/[^/\\]/.test(v)) return '/app.html?page=account';
  if (v.length > 200) return '/app.html?page=account';
  // 只收 URL 本來就合法的 ASCII（RFC 3986 的 pchar／query 字元,不含引號）。
  // < > " ' ` 空白、反斜線、非 ASCII 一律退回帳號頁 —— 站內自己產生的 r 都是 encodeURIComponent 過的。
  if (!/^[A-Za-z0-9\-._~!$&()*+,;=:@%\/?#]+$/.test(v)) return '/app.html?page=account';
  return v;
}

/* 放進 <script> 的字串常值：JSON.stringify 不會跳脫 </script>,要另外把 < > & 與 U+2028/2029 換成 \uXXXX */
export const scriptStr = v => JSON.stringify(String(v))
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const withParam = (u, k, v) => u + (u.indexOf('?') >= 0 ? '&' : '?') + k + '=' + encodeURIComponent(v);

/* 登入完成後跳回站上。用 HTML 而不是 302，是為了在同一個回應裡種 cookie
   並讓使用者看到結果。to 必須是呼叫端自己組出來的可信網址。 */
export const bounce = (to, msg) => html(
  `<!doctype html><meta charset="utf-8"><title>登入中…</title>
   <body style="font-family:system-ui;padding:40px;text-align:center;color:#333">
   <p>${esc(msg || '登入成功，正在返回…')}</p>
   <script>location.replace(${scriptStr(to)})</script>
   <p><a href="${esc(to)}">如果沒有自動跳轉，點這裡</a></p></body>`);

export async function handleAuth(req, env, url) {
  const p = url.pathname;
  const site = env.SITE_BASE || 'https://project-sekai-center.com';

  if (p === '/auth/google' || p === '/auth/discord') {
    const isG = p === '/auth/google';
    if (isG && !env.GOOGLE_CLIENT_ID) return html('尚未設定 GOOGLE_CLIENT_ID', 500);
    if (!isG && !env.DISCORD_CLIENT_ID) return html('尚未設定 DISCORD_CLIENT_ID', 500);
    /* Discord：沒有 session → 直接用 Discord 登入（找不到就建帳號）；
       有 session → 綁定到目前帳號。模式與要綁的帳號 id 記在簽過章的 state 裡,
       回來時 session 換了人（別的分頁登出／換帳號）就拒絕,不會綁錯人。 */
    const n = randHex(16);
    const st0 = { n, e: Math.floor(Date.now() / 1000) + 600, r: safePath(url.searchParams.get('r')) };
    if (!isG) {
      const me = await currentUser(req, env);
      st0.m = me ? 'link' : 'login';
      if (me) st0.lu = me.id;
    }
    const state = await signToken(env.SESSION_SECRET, st0);
    const keep = [n].concat(oauthNonces(req).filter(x => x !== n)).slice(0, 3);
    return new Response(null, { status: 302, headers: {
      Location: isG ? googleAuthUrl(env, state) : discordAuthUrl(env, state),
      'Set-Cookie': oauthCookie(keep), 'Cache-Control': 'no-store',
    } });
  }

  if (p === '/auth/google/callback' || p === '/auth/discord/callback') {
    const isG = p === '/auth/google/callback';
    const err = url.searchParams.get('error');
    // 供應商回傳的 error 是外部輸入,只用代碼比對後顯示我們自己的文案,不回顯原文
    if (err) return bounce(site + '/app.html?page=account',
      err === 'access_denied' ? '你取消了授權，沒有完成登入。' : '登入沒有完成（供應商回報錯誤）。請再試一次。');
    const st = await verifyToken(env.SESSION_SECRET, url.searchParams.get('state') || '');
    if (!st) return html('state 驗證失敗（可能是逾時或被竄改），請重新登入。', 400);
    /* state 必須是「這個瀏覽器」發起的（見 OAUTH_COOKIE 的說明）。對不上就不交換 code、不動 session。 */
    const mine = oauthNonces(req);
    if (typeof st.n !== 'string' || mine.indexOf(st.n) < 0) {
      return html('登入流程不是從這個瀏覽器開始的（或已逾時），請回網站重新按一次登入。', 400);
    }
    const left = oauthCookie(mine.filter(x => x !== st.n));
    const code = url.searchParams.get('code');
    if (!code) return html('缺少 code', 400);
    const withNonce = r => { r.headers.append('Set-Cookie', left); return r; };
    try {
      if (isG) {
        const prof = await googleExchange(env, code);
        if (!prof.emailVerified) return html('這個 Google 帳號的信箱尚未驗證，無法用來接收通知。', 400);
        const user = await upsertGoogleUser(env.DB, prof, env.ADMIN_EMAIL);
        const res = bounce(site + safePath(st.r));
        res.headers.append('Set-Cookie', await issueSession(env, user));
        return withNonce(res);
      }
      if (st.m === 'login') {
        const d = await discordExchange(env, code);
        let user = await userByDiscord(env.DB, d.id);
        if (!user) user = await createDiscordUser(env.DB, d);
        if (!user) return html('建立帳號失敗，請重新登入。', 500);
        const res = bounce(site + safePath(st.r));
        res.headers.append('Set-Cookie', await issueSession(env, user));
        return withNonce(res);
      }
      const me = await currentUser(req, env);
      if (!me) return withNonce(bounce(site + '/app.html?page=account', 'session 已過期，請重新登入。'));
      if (st.lu && st.lu !== me.id) return withNonce(bounce(site + '/app.html?page=account', '登入的帳號在授權期間換了人，沒有綁定。請重新操作。'));
      const d = await discordExchange(env, code);
      const r = await linkDiscordSafe(env.DB, me.id, d);
      /* 被別的帳號綁走時直接拒絕。以前的做法是把對方的 discord_id 清成 NULL,
         但現在可以只靠 Discord 登入,清掉就等於把那個帳號變成永遠登不進去的孤兒。 */
      if (r.taken) return withNonce(bounce(withParam(site + safePath(st.r), 'auth_error', 'discord_taken'),
        '這個 Discord 已經綁定在另一個網站帳號上，沒有綁定。請先用 Discord 登入那個帳號並解除綁定，再回來綁。'));
      return withNonce(bounce(site + safePath(st.r), 'Discord 已綁定，正在返回…'));
    } catch (e) {
      // 例外訊息裡可能帶有供應商回應的原文,只記到 log,不吐回瀏覽器
      console.error('oauth exchange failed', e && e.message);
      return html('登入流程失敗，請重新登入。若持續發生請聯絡管理員。', 502);
    }
  }

  if (p === '/auth/logout') {
    const r = url.searchParams.get('r');                 // 車隊頁登出後要回車隊頁；沒帶就回首頁
    const res = bounce(site + (r ? safePath(r) : '/app.html'), '已登出');
    res.headers.append('Set-Cookie', clearCookie(env.COOKIE_DOMAIN));
    return res;
  }
  return null;
}
