/* CORS 規則。api.js 與 admin.js 都要用同一套 —— 兩邊各寫一份遲早會走鐘,
   而且互相 import 會形成循環相依。所以獨立成一個沒有相依的模組。 */

/* 回傳可以放進 Allow-Origin 的具體來源,不允許就回 null（連標頭都不發,瀏覽器自己會擋）。 */
export function allowOrigin(req, env) {
  const o = req.headers.get('Origin');
  if (!o) return null;                      // 同源或非瀏覽器請求,不需要 CORS 標頭
  const site = String(env.SITE_BASE || 'https://project-sekai-center.com').replace(/\/+$/, '');
  const ok = [site];
  // 使用者網址列多打或少打 www 都還是同一個站,不該因為三個字被擋在門外
  try {
    const u = new URL(site);
    const alt = u.hostname.startsWith('www.') ? u.hostname.slice(4) : 'www.' + u.hostname;
    ok.push(u.protocol + '//' + u.host.replace(u.hostname, alt));
  } catch (e) { /* SITE_BASE 設壞了就只比對字串 */ }
  if (ok.indexOf(o) >= 0) return o;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return o;   // 本機開發
  return null;
}

export function corsHeaders(req, env) {
  // Allow-Origin 會隨請求變動,沒有 Vary 的話 CDN 可能把 A 站的標頭快取給 B 站
  const h = { 'vary': 'Origin' };
  const o = allowOrigin(req, env);
  if (o) {
    h['access-control-allow-origin'] = o;
    h['access-control-allow-credentials'] = 'true';
  }
  return h;
}

export function preflight(req, env) {
  const h = corsHeaders(req, env);
  h['access-control-allow-methods'] = 'GET, POST, PATCH, DELETE, OPTIONS';
  h['access-control-allow-headers'] = req.headers.get('Access-Control-Request-Headers') || 'Content-Type';
  h['access-control-max-age'] = '86400';
  return new Response(null, { status: 204, headers: h });
}

