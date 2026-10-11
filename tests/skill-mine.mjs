// 理論技能倍率表「我的卡」解算器與建置腳本的一致性：把台服全部卡片標成持有，
// 網頁用 JS 算出的「我 x.xx」每一格都必須等於建置時 Python 算出的台服理論值
// （同團同色 30 格、同團不限色 6 列、同色不限團 5 列）。
// 本機：python3 -m http.server 8765 之後 node tests/skill-mine.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch (e) { pw = require('playwright-core'); }
const BASE = process.env.BASE || 'http://127.0.0.1:8765/app.html';
const launch = { headless: true, args: ['--no-sandbox'] };
if (process.env.CHROME) launch.executablePath = process.env.CHROME;

const src = readFileSync('data/skill-table.js', 'utf8');
const T = JSON.parse(src.slice(src.indexOf('={') + 1).trim().replace(/;$/, ''));
const ids = T.tw.pool.map(r => r[0]);
// 與 app.js 的 ownCode() 相同：bitmap → base64
let max = 0; ids.forEach(id => { if (id > max) max = id; });
const b = new Uint8Array((max >> 3) + 1); ids.forEach(id => { b[id >> 3] |= (1 << (id & 7)); });
const code = Buffer.from(b).toString('base64');

const browser = await pw.chromium.launch(launch);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(c => { try { localStorage.setItem('sekai-guide-hide', '1'); localStorage.setItem('sekai-cards-own', c); } catch (e) {} }, code);
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', e => errors.push(e.message.slice(0, 200)));
await page.goto(BASE + '?page=skillmult', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.querySelectorAll('.sm-me').length >= 41, null, { timeout: 60000 });
const cells = await page.evaluate(() => Array.from(document.querySelectorAll('.sm-cell')).map(el => ({
  k: el.dataset.k, tw: (el.querySelector('.sm-tw') || {}).textContent, me: (el.querySelector('.sm-me') || {}).textContent
})));
let bad = 0;
for (const c of cells) {
  const me = (c.me || '').replace(/^我\s*/, '');
  if (me !== c.tw) { bad++; console.log('MISMATCH', c.k, 'tw', c.tw, 'mine', me); }
}
// 點一格：我的卡欄要有五張卡、理論隊伍沒有「缺」、替代卡全部標「有」
await page.locator('.sm-cell').first().click();
await page.waitForFunction(() => /我的卡/.test(document.body.innerText) && document.querySelectorAll('.sm-no').length === 15, null, { timeout: 15000 });
const panel = await page.evaluate(() => ({ miss: document.querySelectorAll('.sm-miss').length, have: document.querySelectorAll('.sm-alt .sm-have').length, alts: document.querySelectorAll('.sm-alt').length, jpNew: (document.body.innerText.match(/台服未實裝/g) || []).length }));
// 理論隊伍裡只有「台服未實裝」的日服卡不算缺；全持有時台服那排不能有缺
if (panel.miss !== 0) { bad++; console.log('全持有卻有「缺」', panel); }
if (panel.have !== panel.alts - panel.jpNew && panel.have < panel.alts - panel.jpNew) { bad++; console.log('替代卡「有」標記不全', panel); }
await browser.close();
console.log(`${cells.length} 格比對，${bad} 格不一致，JS 錯誤 ${errors.length} 個`, errors);
process.exit(bad || errors.length ? 1 : 0);
