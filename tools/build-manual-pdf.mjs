// 說明書 PDF：tools/manual/*.html → manual/<id>.pdf（A4 雙欄、論文排版，內文的超連結在 PDF 裡也點得到）
//   python3 tools/build-manual.py --print /tmp/manual-print && node tools/build-manual-pdf.mjs /tmp/manual-print
// 需要 playwright 的 chromium，以及系統字型 Noto Serif CJK TC／Noto Sans CJK TC（Ubuntu：fonts-noto-cjk）。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch (e) { pw = require('playwright-core'); }
const src = process.argv[2] || '/tmp/manual-print';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'tools/manual/docs.json'), 'utf8'));
const browser = await pw.chromium.launch();
const page = await browser.newPage();
const bar = (l, r) => `<div style="width:100%;font-family:'Noto Serif CJK TC',serif;font-size:7.5pt;color:#666;padding:0 17mm;display:flex;justify-content:space-between"><span>${l}</span><span>${r}</span></div>`;
for (const d of cfg.docs) {
  const f = path.join(src, d.id + '.html');
  if (!fs.existsSync(f)) continue;
  await page.goto('file://' + f);
  await page.waitForTimeout(400);
  const out = path.join(root, d.pdf);
  await page.pdf({
    path: out, format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
    headerTemplate: bar(d.title.replace(/<br>/g, ''), '技術說明文件'),
    footerTemplate: bar('Project SEKAI 資源中心 ・ 2026 年 11 月', '— <span class="pageNumber"></span> / <span class="totalPages"></span> —'),
  });
  console.log(d.pdf, Math.round(fs.statSync(out).size / 1024) + ' KB');
}
await browser.close();
