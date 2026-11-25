// 版面不能左右溢出：主站每一個分頁（js/app.js 的 PAGES 全部）與每一個獨立頁（vercel.json 有路由的 *.html），
// 在最窄的手機（摺疊機外螢幕 280px）與平板（768px）各開一次，整頁的 scrollWidth 不能比視窗寬。
// 以前出過的：卡片格線寫死 minmax(300px,1fr) 在 280px 放不下、頁首按鈕擠出畫面、底部導覽列兩端超出、表格把整頁撐寬。
// 本機：python3 -m http.server 8765 之後 node tests/layout.mjs（BASE 可改網址、WIDTHS=280,390 可改寬度、ONLY=正規式 只跑部分）
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch (e) { pw = require('playwright-core'); }
const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const WIDTHS = (process.env.WIDTHS || '280,768').split(',').map(Number);
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;

const app = fs.readFileSync('js/app.js', 'utf8');
const block = app.slice(app.indexOf('  PAGES = {'), app.indexOf('\n  };', app.indexOf('  PAGES = {')));
const spa = [...block.matchAll(/^\s{4}([A-Za-z0-9_]+):\s*\[/gm)].map(m => m[1]);
const routes = JSON.parse(fs.readFileSync('vercel.json', 'utf8')).routes || [];
const standalone = [...new Set(routes.map(r => r.dest).filter(d => /^\/[A-Za-z0-9_-]+\.html$/.test(d || '') && d !== '/app.html' && !d.startsWith('/share/')))].map(d => d.slice(1));
let urls = [...spa.map(p => 'app.html?page=' + p), ...standalone];
if (ONLY) urls = urls.filter(u => ONLY.test(u));
if (spa.length < 40) { console.log('FAIL 讀不到 PAGES 表（只找到 ' + spa.length + ' 頁）'); process.exit(1); }

const launch = { headless: true, args: ['--no-sandbox'] };
if (process.env.CHROME) launch.executablePath = process.env.CHROME;
const browser = await pw.chromium.launch(launch);
let fail = 0, n = 0;
for (const w of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 700 ? 720 : 1024 }, isMobile: w < 700, hasTouch: w < 700 });
  const queue = urls.slice();
  const worker = async () => {
    while (queue.length) {
      const u = queue.shift();
      const page = await ctx.newPage();
      let why = '';
      try {
        await page.goto(BASE + '/' + u, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1800);
        const r = await page.evaluate(() => {
          const W = document.documentElement.clientWidth, over = document.documentElement.scrollWidth - W;
          if (over <= 0) return { over };
          // 指出是誰撐寬的：沒有被可捲動／裁切的祖先包住、右緣超出視窗的最外層元素
          const clipped = el => { for (let q = el.parentElement; q && q !== document.documentElement; q = q.parentElement) if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(q).overflowX)) return true; return false; };
          let who = '';
          for (const el of document.body.querySelectorAll('*')) {
            const b = el.getBoundingClientRect();
            if (b.width && b.right > W + 1 && getComputedStyle(el).position !== 'fixed' && !clipped(el)) { who = el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().split(/\s+/).slice(0, 2).join('.') : '') + ' 右緣 ' + Math.round(b.right); break; }
          }
          return { over, who };
        });
        if (r.over > 0) why = '多出 ' + r.over + 'px' + (r.who ? '（' + r.who + '）' : '');
      } catch (e) { why = e.message.slice(0, 100); }
      n++;
      if (why) { fail++; console.log('FAIL ' + w + 'px ' + u + ' — ' + why); }
      await page.close();
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  await ctx.close();
}
await browser.close();
console.log((fail ? 'FAIL' : 'ok  ') + ` 版面溢出：${urls.length} 頁 × ${WIDTHS.length} 種寬度，${n - fail} 通過、${fail} 失敗`);
process.exit(fail ? 1 : 0);
