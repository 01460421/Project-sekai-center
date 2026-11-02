/* 截圖辨識的卡面指紋要涵蓋卡片索引裡的卡。
   以前 data/card-sigs.js 是手動產生、停在 #1271，之後的新卡在截圖辨識時一律被硬湊成某張舊卡，
   連角色都被改掉，WL 後排加成整批算錯，而畫面上看不出異常。現在每日排程會在卡片索引之後補指紋；
   這支測試擋的是「排程壞掉、指紋又悄悄落後」。剛上架、素材站還沒有縮圖的幾張新卡允許暫時缺。 */
import { SIGS, SIG_BITS } from '../data/card-sigs.js';
import { CARDS as TW } from '../data/cards-index.js';
import { CARDS as JP } from '../data/cards-index-jp.js';

let fail = 0;
const ok = (cond, name) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) fail++; };
const has = new Set(SIGS.map(r => r[0]));
const bytes = SIG_BITS / 8;
ok(SIGS.every(r => Buffer.from(r[2], 'base64').length === bytes), '每枚指紋都是 ' + SIG_BITS + ' bits');
for (const [name, cards] of [['台服', TW], ['日服', JP.filter(c => c[9] !== 0)]]) {
  const ids = cards.map(c => c[0]), miss = ids.filter(id => !has.has(id));
  const maxId = Math.max(...ids), recent = new Set(ids.slice().sort((a, b) => b - a).slice(0, 15));
  ok(miss.filter(id => !recent.has(id)).length <= 3, name + '卡片索引（' + ids.length + ' 張，到 #' + maxId + '）都有卡面指紋'
    + (miss.length ? '；缺 ' + miss.length + ' 張：' + miss.slice(0, 10).map(x => '#' + x).join(' ') : ''));
}
console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
process.exit(fail ? 1 : 0);
