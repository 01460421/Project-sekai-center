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
  ['cards', /共 [\d,]+ 項/], ['chars', /角色圖鑑/], ['fixtures', /共 [\d,]+ 項/], ['mstalk', /已看過 \d/], ['story', /活動劇情/], ['news', /遊戲公告/], ['b30', /B30/], ['account', /登入|我的帳號/], ['event', /活動總覽/], ['favs', /收藏與待辦/], ['car', /私車排班/],
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
      let detail = '';
      if (mobile && overflow) {
        // 印出沒被任何捲動容器夾住、卻超出視窗的元素，CI 上直接看得出是誰
        detail = await page.evaluate(() => {
          const w = document.documentElement.clientWidth;
          const clipped = el => { let e = el.parentElement; while (e && e !== document.body) { const o = getComputedStyle(e).overflowX; if (o === 'auto' || o === 'hidden' || o === 'scroll' || o === 'clip') return true; e = e.parentElement; } return false; };
          const bad = [];
          for (const el of document.querySelectorAll('body *')) { const b = el.getBoundingClientRect(); if (b.right > w + 1 && b.width > 0 && !clipped(el)) bad.push(el.tagName + (el.className ? '.' + String(el.className).split(' ')[0] : '') + ' w=' + Math.round(b.width) + ' right=' + Math.round(b.right) + ' "' + (el.textContent || '').trim().slice(0, 24).replace(/\s+/g, ' ') + '" style=' + (el.getAttribute('style') || '').slice(0, 100)); }
          // 再往下挖：第一個超出的元素裡，最深的哪些葉節點也超出（通常就是撐爆 min-content 的那一個）
          let leaf = '';
          const first = [...document.querySelectorAll('body *')].find(el => { const b = el.getBoundingClientRect(); return b.right > w + 1 && b.width > 0 && !clipped(el); });
          if (first) leaf = ' | leaves: ' + [...first.querySelectorAll('*')].filter(el => !el.children.length && el.getBoundingClientRect().right > w + 1).slice(0, 5).map(el => el.tagName + ' w=' + Math.round(el.getBoundingClientRect().width) + ' "' + (el.textContent || el.getAttribute('src') || '').trim().slice(0, 30) + '" style=' + (el.getAttribute('style') || '').slice(0, 80)).join(' || ');
          return ' scrollWidth=' + document.documentElement.scrollWidth + ' | ' + bad.slice(0, 4).join(' || ') + leaf;
        });
      }
      ok = !errors.length && !(mobile && overflow); why = errors[0] || (overflow ? '橫向溢出' + detail : '');
    } catch (e) { why = e.message.slice(0, 120); }
    console.log((ok ? 'ok  ' : 'FAIL') + ' ' + (mobile ? 'mobile ' : 'desktop') + ' ' + p + (why ? ' — ' + why : ''));
    if (!ok) fail++;
    await page.close();
  }
  await ctx.close();
}

// 私車／登入回歸（用 ?carmock= 本機假後端；只在 localhost／127.0.0.1 生效）
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('sekai-guide-hide', '1'); } catch (e) {} });
  const txt = page => page.evaluate(() => document.body.innerText);
  const run = async (name, fn) => {
    const page = await ctx.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    let why = '';
    try { why = (await fn(page)) || ''; } catch (e) { why = e.message.slice(0, 160); }
    if (!why && errors.length) why = errors[0];
    console.log((why ? 'FAIL' : 'ok  ') + ' car-auth ' + name + (why ? ' — ' + why : ''));
    if (why) fail++;
    await page.close();
  };
  // 1) 已登入但機器人拒絕簽章（401 bad_signature）：不能叫人再登入一次，要顯示驗證失敗
  await run('401 非 need_login 不顯示登入卡', async page => {
    await page.goto(BASE + '?page=car&carmock=badsig', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => /驗證失敗/.test(document.body.innerText), null, { timeout: 30000 });
    const t = await txt(page);
    if (/登入以使用私車排班/.test(t)) return '出現登入卡';
  });
  // 1b) 真的沒登入（need_login）仍然要顯示登入卡
  await run('need_login 顯示登入卡', async page => {
    await page.goto(BASE + '?page=car&carmock=out', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => /登入以使用私車排班/.test(document.body.innerText), null, { timeout: 30000 });
  });
  // 2) Discord 綁定失敗帶回 ?auth_error=discord_taken：要有提示，網址參數要拿掉
  await run('auth_error=discord_taken 顯示提示', async page => {
    await page.goto(BASE + '?page=account&carmock=member&auth_error=discord_taken', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => /這個 Discord 已綁在另一個網站帳號上/.test(document.body.innerText), null, { timeout: 30000 });
    if (/auth_error/.test(page.url())) return '網址還留著 auth_error：' + page.url();
  });
  // 3) 登入卡不能宣稱 Discord 可以重設密碼（Worker 沒有這條路）
  await run('忘記密碼說明只提 QQ', async page => {
    await page.goto(BASE + '?page=account&carmock=out', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => /忘記密碼/.test(document.body.innerText), null, { timeout: 30000 });
    if (/QQ 或 Discord 重新證明/.test(await txt(page))) return '仍寫著可用 Discord 重設';
  });
  // 4) QQ 重設密碼成功後 Worker 已經發了登入 cookie：頁面要直接變成已登入，不能再叫人登入
  await run('重設密碼後直接登入', async page => {
    await page.goto(BASE + '?page=car&carmock=out', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => /登入以使用私車排班/.test(document.body.innerText), null, { timeout: 30000 });
    await page.getByRole('button', { name: '忘記密碼' }).first().click();
    await page.fill('input[data-k="lgUser"]', 'demo');
    await page.getByRole('button', { name: '用 QQ 驗證身分' }).click();
    await page.waitForSelector('input[data-k="lgNewPass"]', { timeout: 20000 });
    await page.fill('input[data-k="lgNewPass"]', 'newpassword1');
    await page.getByRole('button', { name: '設定新密碼' }).click();
    await page.waitForFunction(() => /密碼已重設，已登入/.test(document.body.innerText), null, { timeout: 20000 });
    await page.waitForFunction(() => !/登入以使用私車排班/.test(document.body.innerText), null, { timeout: 20000 });
  });
  // 5) QQ 驗證碼兩段式：畫面要說明確認碼；QQ 送出碼後顯示「QQ「n」已送出碼」
  await run('QQ 兩段式確認碼提示', async page => {
    await page.goto(BASE + '?page=car&carmock=out', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => /登入以使用私車排班/.test(document.body.innerText), null, { timeout: 30000 });
    await page.getByRole('button', { name: '忘記密碼' }).first().click();
    await page.fill('input[data-k="lgUser"]', 'demo');
    await page.getByRole('button', { name: '用 QQ 驗證身分' }).click();
    await page.waitForFunction(() => /再傳一次「\/网页 確認碼」/.test(document.body.innerText), null, { timeout: 20000 });
    await page.waitForFunction(() => /QQ「測試 QQ」已送出碼，請在 QQ 送出/.test(document.body.innerText), null, { timeout: 20000 });
    await page.waitForSelector('input[data-k="lgNewPass"]', { timeout: 20000 });
  });
  // 6) 驗證碼作廢（status:'fail'）：顯示 Worker 的 message，一鍵重新拿碼
  await run('QQ 作廢顯示原因並可重拿', async page => {
    await page.goto(BASE + '?page=car&carmock=out', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => /登入以使用私車排班/.test(document.body.innerText), null, { timeout: 30000 });
    await page.getByRole('button', { name: '忘記密碼' }).first().click();
    await page.fill('input[data-k="lgUser"]', 'contested');
    await page.getByRole('button', { name: '用 QQ 驗證身分' }).click();
    await page.waitForFunction(() => /這組碼已作廢/.test(document.body.innerText), null, { timeout: 20000 });
    await page.getByRole('button', { name: '重新取得驗證碼' }).click();
    await page.waitForFunction(() => /再傳一次「\/网页 確認碼」/.test(document.body.innerText) && !/這組碼已作廢/.test(document.body.innerText), null, { timeout: 20000 });
  });
  // 7) 註冊碼作廢（帳號名被搶）：重拿時回到登入卡、密碼放回去、顯示原因
  await run('QQ 註冊帳號名被搶', async page => {
    await page.goto(BASE + '?page=car&carmock=out', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => /登入以使用私車排班/.test(document.body.innerText), null, { timeout: 30000 });
    await page.getByRole('button', { name: 'QQ 車隊？用 QQ 註冊' }).first().click();
    await page.fill('input[data-k="lgUser"]', 'taken');
    await page.fill('input[data-k="lgPass"]', 'password123');
    await page.getByRole('button', { name: '取得 QQ 驗證碼' }).click();
    await page.waitForFunction(() => /帳號名剛剛被別人註冊了/.test(document.body.innerText), null, { timeout: 20000 });
    await page.getByRole('button', { name: '重新取得驗證碼' }).click();
    await page.waitForFunction(() => !/再傳一次「\/网页 確認碼」/.test(document.body.innerText), null, { timeout: 20000 });
    if ((await page.inputValue('input[data-k="lgPass"]')) !== 'password123') return '密碼沒有放回欄位';
    if (!/帳號名剛剛被別人註冊了/.test(await txt(page))) return '登入卡沒有顯示原因';
  });
  // 8) 機器人還沒更新（bot_not_updated）：顯示說明文字，不顯示錯誤代碼
  await run('bot_not_updated 顯示說明', async page => {
    await page.goto(BASE + '?page=car&carmock=botold', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => /車隊機器人尚未更新或不支援這個功能/.test(document.body.innerText), null, { timeout: 30000 });
    if (/bot_not_updated/.test(await txt(page))) return '畫面出現錯誤代碼';
  });
  await ctx.close();
}
await browser.close();
process.exit(fail ? 1 : 0);
