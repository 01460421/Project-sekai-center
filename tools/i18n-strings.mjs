/* 網站 JS 裡所有帶中文的字串（含 'A' + x + 'B' 串接成的 'A{0}B' 句型），給 tools/build-i18n.py --missing 用。
   用 acorn 真的解析 JS：以前用正規式抓字串，遇到樣板字串會失去同步、整段漏抓。
   acorn 不在 repo 的依賴裡，build-i18n.py 會臨時裝在暫存資料夾，以 ACORN_DIR 指過來。
   用法：ACORN_DIR=<有 node_modules/acorn 的資料夾> node tools/i18n-strings.mjs <輸出.json> */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const req = createRequire((process.env.ACORN_DIR || process.cwd()).replace(/\/?$/, '/'));
const { parse } = req('acorn');
const { simple } = req('acorn-walk');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HAN = /[㐀-鿿]/;
const out = new Set();
/* 更新紀錄這類長文在畫面上是照「。」切成一句一句顯示（標籤先拿掉），所以每一句也收一份 */
const addSentences = t => { if (typeof t !== 'string' || t.length < 60 || !t.includes('。')) return; t.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').split(/。\s*/).forEach(x => add0(x)); };
const add0 = t => { const x = String(t).replace(/&nbsp;/g, ' ').trim(); if (x && HAN.test(x) && x.length <= 2500 && (x.match(/\|/g) || []).length < 3) out.add(x); };
const add = t => { addSentences(t); if (typeof t !== 'string') return; for (const seg of t.split(/<[^>]+>/)) { const x = seg.replace(/&nbsp;/g, ' ').trim(); if (x && HAN.test(x) && x.length <= 2500 && (x.match(/\|/g) || []).length < 3) out.add(x); } };
for (const f of ['js/app.js', 'js/help.js', 'js/haruki.js', 'js/car.js', 'js/maker.js']) {
  const src = readFileSync(ROOT + f, 'utf8');
  const ast = parse(src, { ecmaVersion: 'latest', sourceType: f === 'js/app.js' ? 'script' : 'module', allowHashBang: true });
  simple(ast, {
    Literal(n) { if (typeof n.value === 'string') add(n.value); },
    TemplateLiteral(n) { const parts = n.quasis.map(q => q.value.cooked || ''); parts.forEach(add); if (n.expressions.length) add(parts.map((p, i) => p + (i < n.expressions.length ? '{' + i + '}' : '')).join('')); },
    BinaryExpression(n) {
      /* 'A' + x + 'B' 的串接 → 'A{0}B' 句型（只收最外層的一串） */
      if (n.operator !== '+' || n._seen) return;
      const items = []; const flat = e => { if (e.type === 'BinaryExpression' && e.operator === '+') { e._seen = true; flat(e.left); flat(e.right); } else items.push(e); };
      flat(n);
      if (!items.some(e => e.type === 'Literal' && typeof e.value === 'string' && HAN.test(e.value))) return;
      let k = 0; const t = items.map(e => e.type === 'Literal' && typeof e.value === 'string' ? e.value : '{' + (k++) + '}').join('');
      if (k && k <= 6) add(t);
    },
  });
}
writeFileSync(process.argv[2], JSON.stringify([...out], null, 0));
console.error(out.size, 'strings');
