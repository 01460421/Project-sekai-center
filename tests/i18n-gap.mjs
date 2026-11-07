// 英日翻譯缺漏不能變多：tools/build-i18n.py --missing 列出站上有、詞典（tools/i18n/en.json ∩ ja.json）還沒有的字串。
// 以前新功能常忘了補翻譯，英日介面就冒出中文。現在基準是目前的數字，新字串沒補翻譯就紅；
// 補了翻譯讓數字變少時，請把 MAX 往下調（只能往下）。
// 用法：node tests/i18n-gap.mjs
import { spawnSync } from 'node:child_process';
const MAX = 836;
const r = spawnSync('python3', ['tools/build-i18n.py', '--missing'], { encoding: 'utf8', maxBuffer: 64 << 20 });
if (r.status !== 0) { console.error(r.stderr || '--missing 失敗'); process.exit(1); }
let miss;
try { miss = JSON.parse(r.stdout); } catch (e) { console.error('--missing 的輸出不是 JSON：' + e.message); process.exit(1); }
// 多句的段落（更新紀錄的全文）執行時是逐句翻的（js/i18n.js），--missing 卻把整段也列一次：不算
miss = miss.filter(s => !/。.+/.test(s));
const n = miss.length, ok = n <= MAX;
console.log((ok ? 'ok   ' : 'FAIL ') + `i18n：缺 ${n} 條（基準 ${MAX}）`);
if (!ok) { console.log('最可能是新加的字串（補進 tools/i18n/en.json 與 ja.json 後跑 python3 tools/build-i18n.py）：'); miss.slice(-15).forEach(s => console.log('  ' + s)); }
else if (n < MAX) console.log(`缺漏變少了，可以把 tests/i18n-gap.mjs 的 MAX 調成 ${n}`);
process.exit(ok ? 0 : 1);
