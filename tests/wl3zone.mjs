/* WL3 專區的資料（data/wl3-zone.js，由 tools/build-wl3-zone.py 從活動資料、日服榜線資料庫與 WL3 計算器規則表挑出）。 */
import { WL3Z as Z } from '../data/wl3-zone.js';
import { WL3P as P } from '../data/wl3-power.js';

let fail = 0;
const ok = (cond, name) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) fail++; };
const E = Z.events, ch = E.filter(e => !e.fin), fin = E.filter(e => e.fin);
ok(E.length === 6 && ch.length === 5 && fin.length === 1 && E.map(e => e.part).join() === '1,2,3,4,5,0', 'WL3 六期：第 1～5 期章節＋終章');
ok(ch.reduce((a, e) => a + e.ch.length, 0) === 26 && new Set(ch.flatMap(e => e.ch.map(c => c[1]))).size === 26, '五期章節合計 26 章，26 位角色各一章');
ok(E.every(e => e.ch.every(c => c[4] - c[2] === e.twT[0] - e.jpT[0] || e.twOff)), '台服沒有正式時間的期數：每一章都照同一個時差推估');
const p1 = E[0];
ok(p1.twOff && p1.tw && new Date(p1.twT[0]).toISOString() === '2027-04-18T12:00:00.000Z', '第 1 期台服已公布：' + p1.tw + ' 2027-04-18 20:00（台北）');
ok(ch.every(e => e.bMain === 525 && e.bSup === 465 && e.bAll === 990), '章節滿配：主隊 525＋後排 465＝990%');
ok(fin[0].bMain === 520 && fin[0].bSup === 465 && fin[0].bAll === 985 && fin[0].limMax == null && fin[0].shuffle['5'] === 50, '終章滿配：主隊 520（限定卡五張都算、混團 5 團 +50）＋後排 465＝985%');
ok(E.every(e => e.cap === 336000) && fin[0].skill === 140 && fin[0].doll === 6, '總合力上限 336,000；終章技能上限 +140%、玩偶 6%');
ok(ch.every(e => e.ch.every(c => Array.isArray(c[6]) && c[6].length === Z.tiers.length && c[6].every(v => v > 0))), '每一章都有日服最終榜線（' + Z.tiers.map(t => 'T' + t).join('／') + '）');
ok(E.every(e => e.main && e.main.every((v, i, a) => v > 0 && (i === 0 || v <= a[i - 1]))), '每一期的總榜榜線都有，名次越後越低');
const ec = Object.keys(P.events.find(e => e[6])[12].ec).map(Number).sort((a, b) => a - b);
ok(Z.cards.length === 26 && JSON.stringify(Z.cards.map(c => c[0]).sort((a, b) => a - b)) === JSON.stringify(ec), '26 張 WL3 限定卡＝WL3 計算器終章的限定卡');
ok(Z.cards.every(c => ch.some(e => e.id === c[6] && e.ch.some(x => x[1] === c[1]))), '每張限定卡都落在它角色那一章的期數');
console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
process.exit(fail ? 1 : 0);
