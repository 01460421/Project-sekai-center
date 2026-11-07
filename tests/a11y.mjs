// 無障礙門檻：用 axe-core 掃幾個代表頁，critical 等級（沒有可讀名稱的表單欄位、沒有 alt 的圖…）一個都不能有，
// serious 只列數量當基準（目前幾乎全是對比度；要降低請改配色，不是改這裡）。
// 本機：python3 -m http.server 8765 之後 node tests/a11y.mjs（需要 playwright 與 axe-core；AXE 環境變數可指到 axe.min.js）
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch (e) { pw = require('playwright-core'); }
let axeSrc = '';
try { axeSrc = fs.readFileSync(process.env.AXE || require.resolve('axe-core/axe.min.js'), 'utf8'); }
catch (e) { console.error('找不到 axe-core（npm i --no-save axe-core，或 AXE=路徑）'); process.exit(1); }
const BASE = process.env.BASE || 'http://127.0.0.1:8765/app.html';
const PAGES = ['home', 'songs', 'cards', 'rank', 'calc', 'settings', 'event', 'status', 'recap'];
const SERIOUS_MAX = 100;   // 基準：2026-11 對比度大修後 9 頁合計約 68（手機版）；超過代表新頁把對比度做壞了。要調請連同原因一起改。
const launch = { headless: true, args: ['--no-sandbox'] };
if (process.env.CHROME) launch.executablePath = process.env.CHROME;
const browser = await pw.chromium.launch(launch);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { try { localStorage.setItem('sekai-guide-hide', '1'); } catch (e) {} });
let fail = 0, serious = 0;
const byRule = {};
for (const p of PAGES) {
  const page = await ctx.newPage();
  let crit = [], n = 0;
  try {
    await page.goto(BASE + '?page=' + p, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.body.innerText.trim().length > 200, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.addScriptTag({ content: axeSrc });
    const r = await page.evaluate(async () => {
      const res = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
      return res.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map(x => x.target.join(' ')).slice(0, 5), n: v.nodes.length }));
    });
    crit = r.filter(v => v.impact === 'critical');
    r.filter(v => v.impact === 'serious').forEach(v => { n += v.n; byRule[v.id] = (byRule[v.id] || 0) + v.n; });
  } catch (e) { crit = [{ id: 'run', help: e.message.slice(0, 160), nodes: [], n: 1 }]; }
  serious += n;
  const bad = crit.length > 0; if (bad) fail++;
  console.log((bad ? 'FAIL' : 'ok  ') + ' a11y ' + p.padEnd(9) + ' critical ' + crit.reduce((a, v) => a + v.n, 0) + '  serious ' + n);
  for (const v of crit) console.log('       ' + v.id + '：' + v.help + '  ' + v.nodes.join(' | '));
  await page.close();
}
await browser.close();
console.log('serious 合計 ' + serious + ' / 基準 ' + SERIOUS_MAX + '  ' + JSON.stringify(byRule));
if (serious > SERIOUS_MAX) { console.log('FAIL serious 超過基準'); fail++; }
console.log(fail ? `\n${fail} 項不過` : '\n無障礙門檻通過（critical 0）');
process.exit(fail ? 1 : 0);
