/* 服務工作者：只做兩件事。
   1. 頁面（app.html 等）網路優先，斷線時退回快取，所以離線也開得起殼層。
   2. 帶 ?v= 戳記的本站資產（js/css/data/vendor/icons）快取優先：戳記變了就是新網址，不會拿到舊檔。
   跨網域（素材站、API）與沒戳記、需要 revalidate 的資料檔一律不碰。
   v2：頁面改用「路徑」當快取鍵（以前每個 ?page=…&id=… 都存一份 1 MB 的 app.html）；
       資產換了新戳記就刪掉同路徑的舊版本（以前 v1 每個舊 ?v= 都留著，只會越長越大）。
       升版時 activate 會把 v1 的兩個快取整個清掉。 */
const VER = 'v2';
const STATIC_MAX = 160;   // 保險絲：同時最多留這麼多個資產
const PAGES = 'pages-' + VER, STATIC = 'static-' + VER;
const STATIC_RE = /^\/(js|css|data|vendor|icons|tut-img)\/|^\/support\.js$/;
const NO_CACHE_RE = /^\/data\/(billing|billing-jp|b30-consts|borders-db|borders-db-jp)\.js$|^\/data\/border-model\.json$|^\/data\/history\//;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== PAGES && k !== STATIC).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate' || /\.html$/.test(url.pathname) || url.pathname === '/') {
    const key = url.origin + url.pathname;   // 查詢字串不進鍵：同一個殼層只存一份
    e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(PAGES).then(x => x.put(key, c)); } return r; })
      .catch(() => caches.open(PAGES).then(x => x.match(key).then(r => r || x.match(url.origin + '/app.html')).then(r => r || x.match(url.origin + '/')))));
    return;
  }
  /* data/stamps.js（資料檔戳記表）也是網路優先：離線時拿上次那份，資料檔網址才對得上快取裡的版本 */
  if (url.pathname === '/data/stamps.js') {
    const key = url.origin + url.pathname;
    e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(PAGES).then(x => x.put(key, c)); } return r; })
      .catch(() => caches.open(PAGES).then(x => x.match(key)).then(r => r || Response.error())));
    return;
  }
  if (STATIC_RE.test(url.pathname) && url.searchParams.has('v') && !NO_CACHE_RE.test(url.pathname)) {
    e.respondWith(caches.open(STATIC).then(c => c.match(req).then(r => r || fetch(req).then(res => {
      if (res.ok) { const p = c.put(req, res.clone()).then(() => prune(c, url)).catch(() => {}); try { e.waitUntil(p); } catch (err) {} }
      return res;
    }))));
  }
});
/* 新戳記進來：刪掉同一個檔案的舊戳記；總數超過上限就從最舊的刪 */
async function prune(cache, url) {
  const keys = await cache.keys();
  for (const k of keys) { const u = new URL(k.url); if (u.pathname === url.pathname && u.search !== url.search) await cache.delete(k); }
  const left = await cache.keys();
  for (let i = 0; i < left.length - STATIC_MAX; i++) await cache.delete(left[i]);
}

/* ===== Web Push =====
   後端只送「叮一下」（沒有內容），這裡去 games 子網域拿最新通知來顯示；
   兩個網域同站（cookie Domain=.project-sekai-center.com），帶 credentials 就有登入狀態。
   拿不到（離線、逾時）就顯示通用文案，點開一樣進通知頁。 */
const API = 'https://games.project-sekai-center.com';
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let title = 'SEKAI 中心', body = '有新的通知，點開查看。', n = 1;
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch(API + '/api/events?limit=3', { credentials: 'include', signal: ctl.signal });
      clearTimeout(tm);
      const d = await r.json(); const ev = (d && d.events) || [];
      if (ev.length) { title = ev[0].title || title; body = ev.length > 1 && d.unread > 1 ? ('還有 ' + (d.unread - 1) + ' 則未讀') : String(ev[0].body || '').slice(0, 120); n = d.unread || ev.length; }
    } catch (err) {}
    await self.registration.showNotification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'sekai-notice', renotify: true, data: { url: '/app.html?page=notices' } });
    try { if (navigator.setAppBadge) await navigator.setAppBadge(n); } catch (err) {}
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/app.html?page=notices';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) { if (c.navigate) c.navigate(url); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
