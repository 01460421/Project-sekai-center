// 煙霧測試：桌機與手機各開幾頁，不能有 JS 錯誤、頁面要長出關鍵字。
// 本機：python3 -m http.server 8765 之後 node tests/smoke.mjs（需要 playwright 或 playwright-core + Chromium）
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch (e) { pw = require('playwright-core'); }
const BASE = process.env.BASE || 'http://127.0.0.1:8765/app.html';
const launch = { headless: true, args: ['--no-sandbox'] };
if (process.env.CHROME) launch.executablePath = process.env.CHROME;
const browser = await pw.chromium.launch(launch);
// 本機沙盒連不到 GitHub 時，用 MDB_DIR 指一個放 master JSON 的資料夾（檔名同 raw.githubusercontent 的路徑尾端）
const fs = await import('node:fs');
const MDB = process.env.MDB_DIR ? process.env.MDB_DIR.replace(/\/?$/, '/') : '';
const routeMdb = async ctx => { if (!MDB) return; await ctx.route(/raw\.githubusercontent\.com\/Sekai-World\/(sekai-master-db-tc-diff|sekai-master-db-diff)\/main\/([A-Za-z0-9]+)\.json/, (r, req) => { const m = /Sekai-World\/(sekai-master-db-tc-diff|sekai-master-db-diff)\/main\/([A-Za-z0-9]+)\.json/.exec(req.url()); const name = m[1] === 'sekai-master-db-diff' ? (m[2] === 'musics' ? 'musics_jp' : 'jp_' + m[2]) : m[2]; const f = MDB + name + '.json'; if (fs.existsSync(f)) r.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(f) }); else r.abort(); }); };
const CASES = [
  ['home', /首頁|近期卡池/], ['calendar', /活動日曆/], ['gacha', /卡池/], ['songs', /共 \d+ 首/], ['calc', /共用設定|活動 P/],
  ['cards', /共 [\d,]+ 項/], ['chars', /角色圖鑑/], ['fixtures', /共 [\d,]+ 項/], ['mstalk', /已看過 \d/], ['story', /活動劇情/], ['news', /遊戲公告/], ['b30', /B30/], ['account', /登入|我的帳號/],
];
let fail = 0;
for (const mobile of [false, true]) {
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(() => { try { localStorage.setItem('sekai-guide-hide', '1'); } catch (e) {} });
  await routeMdb(ctx);
  for (const [p, re] of CASES) {
    const page = await ctx.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    let ok = false, why = '';
    try {
      await page.goto(BASE + '?page=' + p, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(r => new RegExp(r).test(document.body.innerText), re.source, { timeout: 45000 });
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      ok = !errors.length && !(mobile && overflow); why = errors[0] || (overflow ? '橫向溢出' : '');
    } catch (e) { why = e.message.slice(0, 120); }
    console.log((ok ? 'ok  ' : 'FAIL') + ' ' + (mobile ? 'mobile ' : 'desktop') + ' ' + p + (why ? ' — ' + why : ''));
    if (!ok) fail++;
    await page.close();
  }
  await ctx.close();
}
await browser.close();
process.exit(fail ? 1 : 0);
