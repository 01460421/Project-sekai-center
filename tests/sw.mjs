// 服務工作者（sw.js）的導覽快取：已裝 SW 的人換 ?page= 不能每個網址都再抓一次完整的 app.html。
// 本機：node tests/sw.mjs（需要 playwright 或 playwright-core + Chromium）
// 腳本自己起一個小伺服器（預設 127.0.0.1:8766，PORT 可改），因為 python http.server 不會回 304、也沒有 /songcard 的 308；
// 伺服器照 vercel.json 的行為：.html 回 max-age=0, must-revalidate + ETag（If-None-Match 命中回 304）、
// /songs/ 這種尾斜線回 308 到 /songs、/ 與 /app 與 /songs 這種路徑形式的分頁都是 app.html，並記下每一筆請求（路徑、狀態、位元組）。
// 設了 BASE（例如 http://127.0.0.1:8765）就改打外面的伺服器，只做瀏覽器端的檢查（不看伺服器記錄、不測 308）。
// 流程：開 ?page=home 等 SW 啟用 → 開 ?page=calendar、?page=songs、/?page=event：文件要由 SW 回應、伺服器只看到 /app.html 的 304
//       → 開 /songs（路徑形式）：也要由 SW 回應、落在 /songs 且長出歌曲頁 → 開 /songs/：308 不能 ERR_FAILED，最後要落在 /songs
//       → 離線開 ?page=event 與 /recap 仍要開得起來、沒看過的 starmap.html 要回離線頁。
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch (e) { pw = require('playwright-core'); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launch = { headless: true, args: ['--no-sandbox'] };
if (process.env.CHROME) launch.executablePath = process.env.CHROME;

/* ===== 小伺服器（模擬 vercel.json 的行為） ===== */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };
const log = [];                 // { url, status, bytes }
let dead = false;               // 離線開關：true 時直接把連線切掉，連 SW 裡的 fetch 都會失敗
function serve(req, res) {
  const rec = { url: req.url, status: 0, bytes: 0 }; log.push(rec);
  if (dead) { rec.status = 'dropped'; req.socket.destroy(); return; }
  const u = new URL(req.url, 'http://x');
  const end = (status, headers, body) => { rec.status = status; rec.bytes = body ? body.length : 0; res.writeHead(status, headers); res.end(body); };
  let m;
  if ((m = /^\/([A-Za-z0-9_]+)\/$/.exec(u.pathname))) return end(308, { Location: '/' + m[1] });   // vercel.json：尾斜線 308
  let p = u.pathname;
  if (p === '/' || p === '/app' || /^\/[A-Za-z0-9_]+$/.test(p)) p = '/app.html';   // vercel.json 的 catch-all：路徑形式的分頁都是殼層
  const f = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return end(404, { 'content-type': 'text/plain' }, 'not found');
  const st = fs.statSync(f), ext = path.extname(f);
  const etag = '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
  const h = { 'content-type': MIME[ext] || 'application/octet-stream', etag };
  h['cache-control'] = ext === '.html' || p === '/sw.js' || p === '/data/stamps.js' ? 'public, max-age=0, must-revalidate' : u.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate';
  if (p === '/sw.js') h['service-worker-allowed'] = '/';
  if (req.headers['if-none-match'] === etag) return end(304, h);
  end(200, h, fs.readFileSync(f));
}
let server = null, BASE = process.env.BASE;
if (!BASE) {
  const port = +(process.env.PORT || 8766);
  server = http.createServer(serve);
  await new Promise((ok, no) => server.on('error', no).listen(port, '127.0.0.1', ok));
  BASE = 'http://127.0.0.1:' + port;
}
BASE = BASE.replace(/\/app\.html$/, '').replace(/\/$/, '');
const own = !!server;   // 自己的伺服器才看得到請求記錄

/* ===== 測試 ===== */
const browser = await pw.chromium.launch(launch);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('sekai-guide-hide', '1'); } catch (e) {} });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
let doc = null;   // 最近一次主文件的回應（CDP）：fromServiceWorker、status、encodedDataLength
cdp.on('Network.responseReceived', ev => { if (ev.type === 'Document' && ev.frameId && !ev.response.url.startsWith('data:')) doc = { id: ev.requestId, url: ev.response.url, status: ev.response.status, fromSW: !!ev.response.fromServiceWorker, bytes: 0 }; });
cdp.on('Network.loadingFinished', ev => { if (doc && ev.requestId === doc.id) doc.bytes = ev.encodedDataLength; });

let fail = 0;
const report = (name, why) => { console.log((why ? 'FAIL' : 'ok  ') + ' sw ' + name + (why ? ' — ' + why : '')); if (why) fail++; };
// 殼層有沒有長出來：app.html 的 <main> 在、主程式跑起來把 body 長出字（document.title 會被各頁改掉，不拿它判斷）
const shellLoaded = () => page.waitForFunction(() => !!document.querySelector('main') && document.body.innerText.trim().length > 20, null, { timeout: 30000 }).then(() => true, () => false);
const navEntry = () => page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return n ? { transferSize: n.transferSize, encodedBodySize: n.encodedBodySize, deliveryType: n.deliveryType } : null; });
// 伺服器端：這段期間 app.html 的請求有沒有完整下載（200）；SW 改寫後不該再看到帶 ?page= 的 app.html 請求
const since = () => log.length;
const htmlHits = from => log.slice(from).filter(r => /^\/(app\.html|app)?(\?|$)/.test(r.url));

try {
  // 1) 第一次：還沒有 SW，正常載入並註冊；等到 SW 啟用且接管這個分頁
  const t0 = since();
  await page.goto(BASE + '/app.html?page=home', { waitUntil: 'domcontentloaded', timeout: 30000 });
  // app.html 在 load 之後才 register；clients.claim() 之後 controller 才會出現（新 SW 啟用時會有一拍延遲）
  const ctl = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 100 && !navigator.serviceWorker.controller; i++) await new Promise(r => setTimeout(r, 100));
    return !!navigator.serviceWorker.controller;
  });
  report('home 註冊並啟用 SW', ctl ? '' : 'navigator.serviceWorker.controller 還是空的');
  if (own) {
    const first = htmlHits(t0);
    report('home 第一次是完整下載（200）', first.some(r => r.status === 200 && r.bytes > 100000) ? '' : '伺服器記錄：' + JSON.stringify(first));
  }

  // 2) 換 ?page=：文件要由 SW 回應；伺服器只該看到不帶查詢字串的 /app.html，而且是 304
  for (const target of ['/app.html?page=calendar', '/app.html?page=songs', '/?page=event']) {
    const t = since(); doc = null;
    await page.goto(BASE + target, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const ok = await shellLoaded(), nav = await navEntry();
    const hits = own ? htmlHits(t) : [];
    const full = hits.filter(r => r.status === 200), withQuery = hits.filter(r => /\?/.test(r.url));
    let why = '';
    if (!ok) why = '殼層沒長出來';
    else if (!doc || !doc.fromSW) why = '文件不是 SW 回應的：' + JSON.stringify(doc);
    else if (own && full.length) why = '伺服器還是完整送了 app.html：' + JSON.stringify(full);
    else if (own && withQuery.length) why = 'SW 還是帶著查詢字串去抓：' + JSON.stringify(withQuery);
    else if (own && !hits.some(r => r.status === 304)) why = '沒看到 304（網路優先應該要去 revalidate）：' + JSON.stringify(hits);
    // 註：Chrome 對 SW 回應的 navigation transferSize 會照本體大小報（1.29 MB），不能拿來判斷有沒有真的下載；只印出來參考
    report(target + ' 不是完整下載', why);
    console.log('     ' + target + ' → fromSW=' + (doc && doc.fromSW) + ' status=' + (doc && doc.status) + ' cdpBytes=' + (doc && doc.bytes) + (nav ? ' transferSize=' + nav.transferSize + ' deliveryType=' + JSON.stringify(nav.deliveryType) : '') + (own ? ' server=' + JSON.stringify(hits) : ''));
  }

  // 3) 路徑形式的分頁：/songs 由 SW 回應（鍵併進 /app.html）、主程式認得路徑、網址列維持 /songs；
  //    /songs/ 的 308 跟得過去（redirect:'manual' 拿掉就 ERR_FAILED），最後落在 /songs
  if (own) {
    {
      const t = since(); doc = null; let why = '';
      try {
        await page.goto(BASE + '/songs', { waitUntil: 'domcontentloaded', timeout: 30000 });
        const ok = await shellLoaded();
        const songs = await page.waitForFunction(() => /共 \d+ 首/.test(document.body.innerText), null, { timeout: 45000 }).then(() => true, () => false);
        const hits = htmlHits(t), full = hits.filter(r => r.status === 200);
        if (!ok) why = '殼層沒長出來';
        else if (!doc || !doc.fromSW) why = '文件不是 SW 回應的：' + JSON.stringify(doc);
        else if (full.length) why = '伺服器還是完整送了 app.html：' + JSON.stringify(full);
        else if (!songs) why = '主程式沒把 /songs 認成歌曲頁';
        else if (!/\/songs(\?|$)/.test(page.url())) why = '網址列變成 ' + page.url();
      } catch (e) { why = e.message.slice(0, 120); }
      report('/songs 路徑形式由 SW 回應且認得頁面', why);
    }
    for (const p of ['/songs/', '/recap/']) {
      let why = '';
      try {
        await page.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const ok = await shellLoaded();
        if (!ok) why = '殼層沒長出來';
        else if (new URL(page.url()).pathname !== p.slice(0, -1)) why = '最後落在 ' + page.url();
      } catch (e) { why = e.message.slice(0, 120); }
      report(p + ' 尾斜線 308 跟得過去', why);
    }
  }

  // 4) 離線：殼層從 PAGES 快取來、資產從 STATIC 來；沒看過的獨立頁要回離線頁而不是首頁殼
  dead = true; await ctx.setOffline(true);
  {
    const t = since(); doc = null;
    let why = '';
    try {
      await page.goto(BASE + '/app.html?page=event', { waitUntil: 'domcontentloaded', timeout: 30000 });
      const ok = await shellLoaded();
      if (!ok) why = '殼層沒長出來';
      else if (!doc || !doc.fromSW || doc.status !== 200) why = '文件不是 SW 快取回的：' + JSON.stringify(doc);
    } catch (e) { why = e.message.slice(0, 120); }
    report('離線 ?page=event 仍開得起來', why);
    // setOffline 有沒有管到 SW 裡的 fetch 不一定（所以伺服器那邊也一起切斷）；印出來參考，不當失敗
    if (own) console.log('     離線期間打到伺服器（已切斷）的請求：' + log.slice(t).length + ' 筆' + (log.slice(t).length ? ' ' + JSON.stringify(log.slice(t).slice(0, 3).map(r => r.url)) : ''));
  }
  {
    doc = null; let why = '';
    try {
      await page.goto(BASE + '/recap', { waitUntil: 'domcontentloaded', timeout: 30000 });
      const ok = await shellLoaded();
      if (!ok) why = '殼層沒長出來';
      else if (!doc || !doc.fromSW || doc.status !== 200) why = '文件不是 SW 快取回的：' + JSON.stringify(doc);
    } catch (e) { why = e.message.slice(0, 120); }
    report('離線 /recap（路徑形式）仍開得起來', why);
  }
  {
    let why = '';
    try {
      await page.goto(BASE + '/starmap.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
      const t = await page.evaluate(() => document.body.innerText);
      if (!/目前離線/.test(t)) why = '不是離線頁：' + t.slice(0, 80).replace(/\s+/g, ' ');
      else if (!(doc && doc.status === 503)) why = '狀態碼不是 503：' + JSON.stringify(doc);
    } catch (e) { why = e.message.slice(0, 120); }
    report('離線沒看過的 starmap.html 回離線頁', why);
  }
  await ctx.setOffline(false); dead = false;
} catch (e) {
  report('流程', e.message.slice(0, 200));
}
report('沒有 JS 錯誤', errors[0] || '');
await ctx.close();
await browser.close();
if (server) server.close();
process.exit(fail ? 1 : 0);
