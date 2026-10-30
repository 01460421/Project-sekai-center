/* WL3 綜合力計算器（js/wl3pow.js）的純函式與 data/wl3-power.js 的資料檢查。
   用法：node tests/wl3pow.mjs   任何一項失敗就 exit 1。 */
import { WL3P as D } from '../data/wl3-power.js';
import { wpPower, wpRelevant, wpUniform, wpMinUniform, wpPlan, wpTeamInfo, wpCard, WP_UNITS } from '../js/wl3pow.js';

let fail = 0;
const ok = (cond, name) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) fail++; };
const zero = (extra = {}) => Object.assign({ area: {}, gate: {}, doll: {}, rank: Object.fromEntries(Array.from({ length: 26 }, (_, i) => [i + 1, 0])), mr: [5, 5, 5, 5, 5], cap: 336000, dollCap: null, areaMax: 20, gateMax: 70, tree: true }, extra);
const baseOf = id => { const c = wpCard(D, id), mr = D.mr[String(c.rar)][5]; return [0, 1, 2].map(k => c.b[k] + mr[k] + ({ 4: 1500, 9: 1200 }[c.rar]) / 3); };

/* ---- 資料 ---- */
ok(D.events.length >= 6 && D.events.every(e => e[4] === 336000), 'WL3 各期都有 336,000 的總合力上限');
ok(D.events.every(e => e[9].length && e[9].every(t => t.length === 5 && new Set(t.map(id => D.cards[id][0])).size === 5 && new Set(t.map(id => D.cards[id][1])).size === 5)), '每期的滿配候選隊都是五個不同角色、五種顏色');
ok(D.lim.jp.tree === true && D.lim.tw.tree === false, '想いの大樹：日服有、台服目前沒有');
ok(D.area.every(it => it[5].every((v, i) => i === 0 || v >= it[5][i - 1])), '區域道具每級加成不會往下掉');
const tree = D.area.find(it => it[3] === 'tree');
ok(tree && tree[5][19] === 10 && tree[7][19] === 10, '想いの大樹 Lv20：全角色 10%＋2 種以上團體 10%');
ok(D.rank[D.rank.length - 1] === 5 && D.rank.length === 50, '角色等級 Lv50 封頂 5%');

/* ---- 綜合力 ---- */
const ev = D.events.find(e => e[0] === 202), team = ev[9][0];
const R0 = wpPower(D, team, zero());
const sumBase = team.reduce((s, id) => s + Math.round(baseOf(id).reduce((a, b) => a + b, 0)), 0);
ok(R0.total === sumBase, '全部 0：總綜合力＝五張基礎（滿級＋特訓＋前後篇＋專精 5＋畫布）＝' + sumBase);

const ichika = team.find(id => D.cards[id][0] === 1), cid1 = D.area.find(it => it[3] === 'char' && it[4] === 1)[0];
const R1 = wpPower(D, team, zero({ area: { [cid1]: 20 } }));
const exp1 = baseOf(ichika).reduce((s, v) => s + Math.floor(0.40 * v + 1e-9), 0);
ok(R1.total - R0.total === exp1, '一歌的角色道具 Lv20：只加一歌，每維 floor(40%)＝+' + exp1);

const Rt = wpPower(D, team, zero({ area: { [tree[0]]: 20 } }));
const expT = team.reduce((s, id) => s + baseOf(id).reduce((a, v) => a + Math.floor(0.20 * v + 1e-9), 0), 0);
ok(wpTeamInfo(team.map(id => wpCard(D, id))).mixed && Rt.total - R0.total === expT, '混團吃兩份想いの大樹（20%）＝+' + expT);
ok(wpPower(D, team, zero({ area: { [tree[0]]: 20 }, tree: false })).total === R0.total, '台服上限（沒有大樹）時大樹不算');

/* 同團隊：四位 Leo/need＋支援 Leo/need 的 VS 卡 → 大樹只吃一份、團體道具翻倍 */
const pick = ch => Object.keys(D.cards).find(id => D.cards[id][0] === ch && D.cards[id][2] === 4);
const lnVs = Object.keys(D.cards).find(id => D.cards[id][0] === 21 && D.cards[id][3] === 'light_sound');
const lnTeam = [pick(1), pick(2), pick(3), pick(4), lnVs].map(Number);
const L0 = wpPower(D, lnTeam, zero());
ok(L0.T.sameUnit && L0.T.common === 'light_sound', '四位 Leo/need＋Leo/need 支援的 VS 卡算全隊同團');
const Lt = wpPower(D, lnTeam, zero({ area: { [tree[0]]: 20 } }));
ok(Lt.total - L0.total === lnTeam.reduce((s, id) => s + baseOf(id).reduce((a, v) => a + Math.floor(0.10 * v + 1e-9), 0), 0), '同團隊的想いの大樹只吃全角色那一份（10%）');
const lnItem = D.area.find(it => it[3] === 'unit' && it[4] === 'light_sound');
const Lu = wpPower(D, lnTeam, zero({ area: { [lnItem[0]]: 20 } }));
ok(Lu.total - L0.total === lnTeam.reduce((s, id) => s + baseOf(id).reduce((a, v) => a + Math.floor(0.20 * v + 1e-9), 0), 0), '全隊同團：團體道具 Lv20 翻倍成 20%，VS 卡也吃');

/* 大門：人類吃本團，VS 卡吃最高那扇 */
const miku = team.find(id => D.cards[id][0] === 21);
const Rg = wpPower(D, team, zero({ gate: { street: 70 } }));
const mikuRow = Rg.per.find(p => p.card.id === miku);
ok(mikuRow.gatePct === 7 && Rg.per.filter(p => p.card.ch <= 20).every(p => p.gatePct === 0), 'Vivid BAD SQUAD 大門 Lv70：隊上沒有 VBS 人類，只有 VS 卡吃到 7%');

/* 玩偶：終章上限 6% */
const fin = D.events.find(e => e[6]);
const Rd = wpPower(D, team, zero({ doll: { 21: 8 }, dollCap: fin[5] }));
ok(Rd.per.find(p => p.card.ch === 21).dollPct === 6, '終章玩偶上限 6%：設 8% 只算 6%');

/* 最低統一等級、升級順序 */
const cfg = zero({ rank: {}, gate: Object.fromEntries(WP_UNITS.map(u => [u, 0])) });
const ids = wpRelevant(D, team, cfg);
ok(ids.includes(tree[0]) && ids.includes(cid1), '這隊用得到的道具含大樹與章節角色的角色道具');
const L = wpMinUniform(D, team, cfg, ids);
ok(L != null && wpPower(D, team, wpUniform(cfg, ids, L)).total >= 336000 && wpPower(D, team, wpUniform(cfg, ids, L - 1)).total < 336000, '最低統一等級 Lv' + L + '：這級達標、低一級不達標');
const start = wpUniform(cfg, ids, 10), P = wpPlan(D, team, start, ids);
ok(P.reached && P.final >= 336000 && P.steps[0].k === 'a' + tree[0], '從全部 Lv10 補到上限：第一步是想いの大樹，最後達標');
ok(new Set(P.steps.map(s => s.k)).size === P.steps.length, '升級順序每一項只出現一次（同項合併）');

console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
process.exit(fail ? 1 : 0);
