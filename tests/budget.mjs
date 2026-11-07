// 效能預算：首屏會下載的檔案壓縮後不能超過上限。以前靠人手量（Chrome 節流 + 看 Network），
// 一次沒量就會悄悄長回去；現在每個 PR 都算一次 gzip 大小，超過就紅。
// 上限 = 現在的大小加一成左右；要調預算請連同原因一起改這個表，不要為了過關把數字往上抬。
// 用法：node tests/budget.mjs
import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';

const KB = 1024;
const BUDGET = [
  // [路徑, 上限 KB（gzip）, 說明]
  ['app.html', 260, '殼層＋全部模板（首屏必載）'],
  ['js/app.min.js', 275, '主程式（首屏必載）'],
  ['support.js', 23, '範本引擎（首屏必載）'],
  ['vendor/react.production.min.js', 8, 'React'],
  ['vendor/react-dom.production.min.js', 46, 'ReactDOM'],
  ['css/fonts.css', 170, '字型表（第一次畫面後才載；內嵌 unicode-range 子集表，約 155 KB）'],
  ['js/ai.min.js', 380, 'AI 助手（登入核准後才載）'],
  ['js/car.min.js', 70, '車隊（進頁才載）'],
  ['js/maker.js', 60, '製作工具（進頁才載）'],
  ['js/recap.js', 12, '活動回顧與預測準確度（進頁才載）'],
  ['sw.js', 6, 'Service worker'],
  ['data/stamps.js', 8, '資料檔戳記（每次開站都抓）'],
  ['data/songs-index.js', 40, '歌曲索引（歌曲頁）'],
  ['data/syslog.js', 40, '更新紀錄（閒置時才載）'],
];
// 首屏合計：開站一定會下載的那幾個檔
const FIRST = ['app.html', 'js/app.min.js', 'support.js', 'vendor/react.production.min.js', 'vendor/react-dom.production.min.js', 'data/stamps.js'];
const FIRST_MAX = 560;

let fail = 0;
const gz = p => gzipSync(readFileSync(p), { level: 9 }).length / KB;
const rows = [];
for (const [p, max, why] of BUDGET) {
  if (!existsSync(p)) { console.log(`FAIL ${p}：檔案不存在`); fail++; continue; }
  const kb = gz(p), ok = kb <= max;
  if (!ok) fail++;
  rows.push([ok ? 'ok  ' : 'FAIL', p, kb.toFixed(1), String(max), why]);
}
const w = [4, Math.max(...rows.map(r => r[1].length)), 7, 5];
for (const r of rows) console.log(`${r[0]} ${r[1].padEnd(w[1])} ${r[2].padStart(w[2])} / ${r[3].padStart(w[3])} KB  ${r[4]}`);
const first = FIRST.filter(existsSync).reduce((a, p) => a + gz(p), 0);
const fok = first <= FIRST_MAX;
if (!fok) fail++;
console.log(`${fok ? 'ok  ' : 'FAIL'} 首屏合計 ${first.toFixed(1)} / ${FIRST_MAX} KB（${FIRST.join('、')}）`);
console.log(fail ? `\n${fail} 項超過預算：先想辦法瘦身；真的需要才調 tests/budget.mjs 的上限並寫明原因。` : '\n全部在預算內');
process.exit(fail ? 1 : 0);
