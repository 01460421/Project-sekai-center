// 守門：所有「網址是變數或外站」的 <img> 都要帶 referrerpolicy。
// storage.sekai.best 收到帶本站 Referer 的請求會回 403（2026/10 理論技能倍率表整頁破圖就是這樣），
// 與其每次靠人記得，不如在 CI 擋：app.html／index.html 的模板、core.js／app.js 字串裡的 <img> 都掃。
import { readFileSync } from 'node:fs';
const FILES = ['app.html', 'index.html', 'js/core.js', 'js/app.js', 'js/haruki.js'];
const bad = [];
for (const f of FILES) {
  let src; try { src = readFileSync(f, 'utf8'); } catch (e) { continue; }
  const re = /<img\b[^<>]*>/g; let m;
  while ((m = re.exec(src))) {
    const tag = m[0];
    const s = /\bsrc\s*=\s*("[^"]*"|'[^']*'|`[^`]*`)/.exec(tag);
    if (!s) continue;
    const url = s[1].slice(1, -1);
    const dynamic = /\{\{|\$\{/.test(url) || /^https?:\/\//i.test(url) || /^\/\//.test(url);
    if (!dynamic) continue;                       // 寫死的本站路徑不需要
    if (/\breferrerpolicy\s*=/.test(tag)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    bad.push(`${f}:${line}  ${tag.slice(0, 110)}`);
  }
}
if (bad.length) {
  console.error(`有 ${bad.length} 個 <img> 的網址是變數或外站卻沒帶 referrerpolicy（外站素材庫會回 403）：`);
  bad.forEach(x => console.error('  ' + x));
  process.exit(1);
}
console.log('img referrerpolicy 檢查通過');
