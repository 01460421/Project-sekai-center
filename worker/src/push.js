/* Web Push：只送「叮一下」（不帶內容），瀏覽器的 service worker 收到後自己去 /api/events
   拿最新通知來顯示。好處：不必做 RFC 8291 的內容加密，金鑰只有 VAPID 一組；
   代價：離線時顯示的是通用文案。金鑰用 `npx web-push generate-vapid-keys` 產，
   VAPID_PUBLIC（base64url 的 65 bytes 未壓縮公鑰）、VAPID_PRIVATE（base64url 的 32 bytes d）
   都用 wrangler secret put 放進去。 */
import { pendingPushEvents, markPushed, pushSubsByUsers, dropPushSub, bumpPushFail } from './db.js';

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uBytes = s => { s = String(s || '').replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const enc = new TextEncoder();

export const pushEnabled = env => !!(env && env.VAPID_PUBLIC && env.VAPID_PRIVATE);

let _key = null, _keyFor = '';
async function signingKey(env) {
  if (_key && _keyFor === env.VAPID_PUBLIC) return _key;
  const pub = b64uBytes(env.VAPID_PUBLIC);          // 0x04 || x(32) || y(32)
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC 不是未壓縮的 P-256 公鑰');
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: env.VAPID_PRIVATE, ext: true };
  _key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  _keyFor = env.VAPID_PUBLIC;
  return _key;
}

/* RFC 8292：Authorization: vapid t=<JWT>, k=<公鑰>。JWT 的 aud 是推播服務的 origin，12 小時內有效。 */
export async function vapidAuth(env, endpoint, nowS) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64u(enc.encode(JSON.stringify({ aud, exp: (nowS || Math.floor(Date.now() / 1000)) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:noreply@project-sekai-center.com' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey(env), enc.encode(header + '.' + payload));
  return 'vapid t=' + header + '.' + payload + '.' + b64u(sig) + ', k=' + env.VAPID_PUBLIC;
}

/* 空訊息推播：推播服務回 201 表示收下；404／410 表示訂閱已失效（使用者關了通知或換了瀏覽器）。 */
export async function sendTickle(env, sub) {
  const r = await fetch(sub.endpoint, { method: 'POST', headers: { Authorization: await vapidAuth(env, sub.endpoint), TTL: '86400', Urgency: 'normal', 'Content-Length': '0' } });
  return r.status;
}

/* 給 cron：把還沒推過的事件依使用者合併，一人一輪只叮一次（同一分鐘多筆事件不會連響）。
   沒有訂閱的人也標成已推，否則每分鐘都會再撈到。 */
export async function flushPush(env) {
  const rows = await pendingPushEvents(env.DB, 50);
  if (!rows.length) return { events: 0, sent: 0 };
  const byUser = {}; rows.forEach(e => { byUser[e.user_id] = 1; });
  const subs = await pushSubsByUsers(env.DB, Object.keys(byUser));
  let sent = 0, gone = 0, failed = 0;
  for (const s of subs) {
    let st = 0; try { st = await sendTickle(env, s); } catch (e) { st = 0; }
    if (st >= 200 && st < 300) sent++;
    else if (st === 404 || st === 410) { gone++; await dropPushSub(env.DB, s.id); }
    else { failed++; await bumpPushFail(env.DB, s.id); }
  }
  await markPushed(env.DB, rows.map(e => e.id));
  return { events: rows.length, sent, gone, failed };
}
