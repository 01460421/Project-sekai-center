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
