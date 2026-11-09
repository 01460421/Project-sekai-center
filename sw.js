/* 服務工作者：只做兩件事。
   1. 頁面（app.html 等）網路優先，斷線時退回快取，所以離線也開得起殼層。
   2. 帶 ?v= 戳記的本站資產（js/css/data/vendor/icons）快取優先：戳記變了就是新網址，不會拿到舊檔。
   跨網域（素材站、API）與沒戳記、需要 revalidate 的資料檔一律不碰。
   v2：頁面改用「路徑」當快取鍵（以前每個 ?page=…&id=… 都存一份 1 MB 的 app.html）；
       資產換了新戳記就刪掉同路徑的舊版本（以前 v1 每個舊 ?v= 都留著，只會越長越大）。
       升版時 activate 會把 v1 的兩個快取整個清掉。
   v2 補：頁面不只快取鍵用路徑，「去抓」也改用路徑（快取鍵格式沒變，不用升版）。
       以前 fetch(req) 帶著完整查詢字串，瀏覽器的 HTTP 快取是以完整網址當鍵，
       所以 ?page=home 回訪是 0 KB，換到 ?page=calendar 就又是一次完整的 app.html；
       改抓 /app.html 之後每個 ?page= 都共用同一個 HTTP 快取項，之後只剩 304。
       /、/app 在線上都是 app.html（vercel.json），一併併進 /app.html 這個鍵。
   v2 再補：網址改成路徑形式（/songs、/recap）之後，這些路徑也併進 /app.html 這個鍵；
       不然每個分頁又會各存一份、離線也只有看過的那幾頁開得起來。 */
const VER = 'v2';
const STATIC_MAX = 160;   // 保險絲：同時最多留這麼多個資產
const PAGES = 'pages-' + VER, STATIC = 'static-' + VER;
const STATIC_RE = /^\/(js|css|data|vendor|icons|tut-img)\/|^\/support\.js$/;
/* 殼層：/、/app、/app.html，以及 /songs、/recap 這種路徑形式的分頁（vercel.json 的 catch-all 都回 app.html）。
   獨立頁（starmap、theater…）雖然也是沒有副檔名的路徑，但它們是自己的 HTML，不能當殼層。 */
const STANDALONE_RE = /^\/(starmap|theater|soundprint|echoes|classic|tutorial|ep-calculator|mystudio|profile|plan|manual)$/;
const SHELL_RE = /^\/[A-Za-z0-9_]*$/;
const isShell = p => SHELL_RE.test(p) && !STANDALONE_RE.test(p);
const NO_CACHE_RE = /^\/data\/(billing|billing-jp|b30-consts|borders-db|borders-db-jp)\.js$|^\/data\/border-(model|accuracy)\.json$|^\/data\/history\//;

/* 安裝時先把殼層抓一份：PAGES 裡立刻有離線可用的 app.html，HTTP 快取也先有 /app.html 這個項目，
   SW 第一次接手的那次導覽才是 304 而不是再抓一次完整的檔；抓不到（離線安裝）也不擋安裝 */
self.addEventListener('install', e => {
  e.waitUntil(caches.open(PAGES).then(c => fetch(shellReq(self.location.origin + '/app.html', 'default')).then(r => { if (r.ok) return c.put(self.location.origin + '/app.html', r); }).catch(() => {})));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== PAGES && k !== STATIC).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate' || /\.html$/.test(url.pathname) || url.pathname === '/') {
    const path = isShell(url.pathname) ? '/app.html' : url.pathname;
    const key = url.origin + path;   // 查詢字串不進鍵：同一個殼層只存一份，去抓也只抓這個路徑
    /* redirect:'manual' 不能省：導覽請求本來就是 manual，自建的 Request 預設是 follow，
       /songcard、/chart 這種 308（vercel.json）會被跟到底再交回瀏覽器，瀏覽器對導覽拒收跟過轉址的回應 → ERR_FAILED。
       manual 拿到的是 opaqueredirect（status 0、ok 為 false）：不進快取，瀏覽器自己跟 308 再進一次這裡。
       cache 沿用原請求：重新整理（F5）時瀏覽器要求略過 HTTP 快取，這裡照辦。 */
    e.respondWith(fetch(shellReq(key, req.cache)).then(r => { if (r.ok) { const c = r.clone(); caches.open(PAGES).then(x => x.put(key, c)); } return r; })
      .catch(() => offline(url.origin, path)));
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
/* 殼層請求：只帶路徑、同源 cookie、不跟轉址（理由見 fetch 裡的註解） */
function shellReq(key, cache) { return new Request(key, { mode: 'same-origin', credentials: 'same-origin', redirect: 'manual', cache: cache || 'default' }); }
/* 離線退回：殼層（/app.html）拿快取裡那份（舊鍵 /、/app 也找一下，v2 初期存過）；
   其他 .html（starmap、theater…）沒快取就回一頁簡單的離線頁，不退回首頁殼——網址列還是 starmap 卻長出首頁，比直說離線更糊塗 */
function offline(origin, path) {
  return caches.open(PAGES).then(x => x.match(origin + path).then(r => {
    if (r) return r;
    if (path !== '/app.html') return offlinePage();
    return x.match(origin + '/').then(r => r || x.match(origin + '/app')).then(r => r || offlinePage());
  }));
}
function offlinePage() {
  const html = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>目前離線 · SEKAI 中心</title>'
    + '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:16px/1.6 system-ui,-apple-system,"Noto Sans TC",sans-serif;background:#0f1117;color:#e6e8ef}main{max-width:28em;padding:24px}h1{font-size:1.4em;margin:0 0 .4em}p{margin:.4em 0;color:#aab0c0}button,a{display:inline-block;margin:12px 8px 0 0;padding:8px 18px;border-radius:8px;border:1px solid #3b4260;background:#1b1f2e;color:#e6e8ef;font:inherit;text-decoration:none;cursor:pointer}</style></head>'
    + '<body><main><h1>目前離線</h1><p>這一頁還沒有存在這台裝置裡，連上網路之後再試一次。</p><p>已經看過的主站頁面離線也開得起來。</p>'
    + '<button onclick="location.reload()">重試</button><a href="/app.html">回主站</a></main></body></html>';
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
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
