// 從 js/app.js 的 PAGES 表為每一頁產 1200×630 的分享預覽圖（og/<page>.jpg），分享到社群時每頁各有自己的圖。
// 本機：python3 -m http.server 8765 之後 node tools/build-og.mjs（需要 playwright 或 playwright-core + Chromium；CHROME 可指定執行檔）
// 新增分頁或改了標題／說明就重跑一次；GitHub 的 og-refresh workflow 在 app.js／og.html 改動時也會自動重產。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch (e) { pw = require('playwright-core'); }
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const block = src.slice(src.indexOf('  PAGES = {'));
const body = block.slice(0, block.indexOf('\n  };'));
const pages = [...body.matchAll(/^\s{4}(\w+):\s+\['([^']*)',\s*'([^']*)'/gm)].map(m => ({ k: m[1], t: m[2], d: m[3] }));
if (!pages.length) { console.error('PAGES 表解析不到任何頁面'); process.exit(1); }
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
