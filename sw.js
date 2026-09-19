/* 服務工作者：只做兩件事。
   1. 頁面（app.html 等）網路優先，斷線時退回快取，所以離線也開得起殼層。
   2. 帶 ?v= 戳記的本站資產（js/css/data/vendor/icons）快取優先：戳記變了就是新網址，不會拿到舊檔。
   跨網域（素材站、API）與沒戳記、需要 revalidate 的資料檔一律不碰。 */
const VER = 'v1';
const PAGES = 'pages-' + VER, STATIC = 'static-' + VER;
const STATIC_RE = /^\/(js|css|data|vendor|icons|tut-img)\/|^\/support\.js$/;
const NO_CACHE_RE = /^\/data\/(billing|b30-consts|borders-db)\.js$|^\/data\/border-model\.json$|^\/data\/history\//;

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
    e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(PAGES).then(x => x.put(req, c)); } return r; })
      .catch(() => caches.match(req).then(r => r || caches.match('/app.html'))));
    return;
  }
  if (STATIC_RE.test(url.pathname) && url.searchParams.has('v') && !NO_CACHE_RE.test(url.pathname)) {
    e.respondWith(caches.open(STATIC).then(c => c.match(req).then(r => r || fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }))));
  }
});

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
