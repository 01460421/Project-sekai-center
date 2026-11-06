// 從 js/app.js 的 PAGES 表為每一頁產 1200×630 的分享預覽圖（og/<page>.jpg），分享到社群時每頁各有自己的圖；
// 同時產 share/<page>.html：只給連結預覽的爬蟲看的極小靜態頁（title、description、og:*、twitter:*、canonical），
// vercel.json 把爬蟲打 /?page=X 的請求改寫到這裡——app.html 的 head 寫死首頁那組、爬蟲又不跑 JS，不然每一頁的預覽都長一樣。
// 本機：python3 -m http.server 8765 之後 node tools/build-og.mjs（需要 playwright 或 playwright-core + Chromium；CHROME 可指定執行檔）
//       只重產 share/ 不截圖：node tools/build-og.mjs --share-only（不需要瀏覽器）
// 新增分頁或改了標題／說明就重跑一次；GitHub 的 og-refresh workflow 在 app.js／og.html 改動時也會自動重產。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const shareOnly = process.argv.includes('--share-only');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const block = src.slice(src.indexOf('  PAGES = {'));
const body = block.slice(0, block.indexOf('\n  };'));
const pages = [...body.matchAll(/^\s{4}(\w+):\s*\['([^']*)',\s*'([^']*)'/gm)].map(m => ({ k: m[1], t: m[2], d: m[3] }));
if (!pages.length) { console.error('PAGES 表解析不到任何頁面'); process.exit(1); }

if (!shareOnly) {
  let pw; try { pw = require('playwright'); } catch (e) { pw = require('playwright-core'); }
  const BASE = process.env.BASE || 'http://127.0.0.1:8765';
  const launch = { headless: true, args: ['--no-sandbox'] };
  if (process.env.CHROME) launch.executablePath = process.env.CHROME;
  const browser = await pw.chromium.launch(launch);
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  fs.mkdirSync(path.join(ROOT, 'og'), { recursive: true });
  for (const p of pages) {
    await page.goto(BASE + '/og.html?' + new URLSearchParams({ t: p.t, d: p.d, k: p.k }), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready).catch(() => {}); await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(ROOT, 'og', p.k + '.jpg'), type: 'jpeg', quality: 82 });
  }
  await browser.close();
  console.log('og/：' + pages.length + ' 張');
}

// share/<page>.html：標題與說明跟 js/app.js 進頁後改寫 head 的結果一致（_syncUrl），爬蟲拿到的才會跟瀏覽器分頁列看到的一樣。
// og:url 與 canonical 指回 /?page=X（站內「複製連結」與 sitemap 用的就是這種網址），FB／LINE 照 og:url 正規化時仍是同一頁。
// 誤入的人（例如把 share 網址貼出去、或 CDN 把爬蟲那份快取給了真人）由 meta refresh 帶回 /app.html?page=X&s=1：
// 多帶一個 s=1 是因為 vercel.json 那條路由對有 s 的請求不改寫（missing），就算真人拿到這一頁也只會多跳一次、不會無限迴圈。
const SITE = 'https://project-sekai-center.com';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const shareDir = path.join(ROOT, 'share');
fs.mkdirSync(shareDir, { recursive: true });
// 舊的 share/*.html（PAGES 表拿掉的頁）清掉，目錄才跟表一致
for (const f of fs.readdirSync(shareDir)) if (f.endsWith('.html')) fs.unlinkSync(path.join(shareDir, f));
let fallback = 0;
for (const p of pages) {
  let img = p.k;
  if (!fs.existsSync(path.join(ROOT, 'og', p.k + '.jpg'))) { img = 'home'; fallback++; console.warn('share/' + p.k + '.html：沒有 og/' + p.k + '.jpg，預覽圖退回 og/home.jpg'); }
  const title = p.t + ' · SEKAI 資源中心';
  const url = SITE + '/?page=' + p.k, image = SITE + '/og/' + img + '.jpg';
  const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<!-- 連結預覽用的靜態頁（tools/build-og.mjs 由 js/app.js 的 PAGES 表產生，不要手改）：
     vercel.json 只在 user-agent 是預覽爬蟲且網址帶 ?page= 時把 /、/app、/app.html 改寫到這裡。 -->
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(p.d)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:site_name" content="SEKAI 資源中心">
<meta property="og:type" content="website">
<meta property="og:locale" content="zh_TW">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(p.d)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(p.d)}">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0; url=/app.html?page=${p.k}&s=1">
</head><body>
<p>${esc(p.t)}：<a href="/app.html?page=${p.k}&s=1">前往 SEKAI 資源中心</a></p>
</body></html>
`;
  fs.writeFileSync(path.join(shareDir, p.k + '.html'), html);
}
console.log('share/：' + pages.length + ' 頁' + (fallback ? '（' + fallback + ' 頁沒有自己的圖，退回 home.jpg）' : ''));
