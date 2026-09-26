/* 列出全部功能（Markdown 表格），README 的功能清單就是用這個產生的：node scripts/list-features.js */
import { Bot } from '../src/core/bot.js';
import { CATEGORIES } from '../src/core/registry.js';

const reg = Bot.defaultRegistry();
const byCat = reg.byCategory();
let n = 0;
for (const [key, c] of Object.entries(CATEGORIES)) {
  console.log(`\n### ${c.emoji} ${c.name}（${byCat[key].length}）\n`);
  console.log('| # | 指令 | 說明 | 互動 |');
  console.log('|---|---|---|---|');
  for (const f of byCat[key]) {
    const kinds = [f.buttons && '按鈕', f.selects && '選單', f.modals && '表單', f.autocomplete && '自動完成', f.events && '被動事件', f.tick && '排程'].filter(Boolean).join('、');
    console.log(`| ${++n} | \`/${f.name}\` | ${f.description.replace(/\|/g, '\\|')} | ${kinds || '—'} |`);
  }
}
console.log(`\n共 ${n} 個功能`);
