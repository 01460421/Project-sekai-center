// WL3 一圖流攻略：上下兩張 16:9 圖（img/wl3/guide-1.png、guide-2.png，1920×1080 版面輸出 3840×2160）、
// 上下接成一張的一頁式（img/wl3/guide.jpg，3840×4320）、頁面縮圖與看大圖用的 WebP，並更新 app.html 的 ?v=。
//   上篇：WL3 是什麼、台服時程、跟 WL2 哪裡不一樣、章節主隊、後排支援隊、終章、綜合力上限、開跑前準備
//   下篇：日服每一章與每一期的最終榜線、26 張 WL3 限定卡、台服預測卡池、常見 Q&A
// 數字全部讀資料檔（data/wl3-zone.js、data/wl3-power.js、data/sekai-data.js）與日服 master（tools/jp_master.py 的快取），
// 綜合力上限的達標等級用 js/wl3pow.js 同一套算式現算，跟 WL3 專區、WL3 計算器一致。
// 本機：node tools/build-wl3-guide.mjs（需要 playwright 或 playwright-core + Chromium；CHROME 可指定執行檔；縮圖與接圖要 python3 + Pillow）
// TEXT_OUT=檔名 另外輸出同內容的純文字版。版面固定 16:9，哪一欄塞不下會報錯（LOOSE=1 只警告）。
// 圖上不用 emoji 與會被手機換成 emoji 的符號（▶ ★ ✓ 之類）；星級寫「四星」。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch (e) { pw = require('playwright-core'); }
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'img', 'wl3');
const AS = 'https://storage.sekai.best/sekai-jp-assets';
const { WL3Z: Z } = await import(path.join(ROOT, 'data', 'wl3-zone.js'));
const { WL3P: D } = await import(path.join(ROOT, 'data', 'wl3-power.js'));
const W = await import(path.join(ROOT, 'js', 'wl3pow.js'));
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

/* 角色短名：照 js/app.js 的 CHARA_ID（同一個 id 取最短、先出現的那個，跟 charShort 一樣） */
const short = {};
for (const [, k, v] of appSrc.match(/CHARA_ID = \{([^}]+)\}/)[1].matchAll(/'([^']+)':(\d+)/g)) if (!short[v] || k.length < short[v].length) short[v] = k;
const CN = c => short[c] || '#' + c;
const sd = c => AS + '/character/character_sd_l/chr_sp_' + c + '.webp';
const ATTR = [['帥氣', '#4d8ef5'], ['快樂', '#ffaa1c'], ['神秘', '#9d62d8'], ['可愛', '#ff6ba0'], ['純真', '#7fcf3f']];   // cards-index 的屬性順序

/* 日服 master 的終章限制表（WL2 第 180 期 vs WL3 第 218 期）：走 tools/jp_master.py 同一份快取 */
const M = JSON.parse(execFileSync('python3', ['-c', `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'tools'))})
from jp_master import get_jp
out = {}
for f in ['eventCardBonusLimits', 'eventSkillScoreUpLimits', 'eventMysekaiFixtureGameCharacterPerformanceBonusLimits', 'eventShuffleUnitBonuses', 'eventTotalPowerLimits']:
    out[f] = [x for x in (get_jp(f + '.json') or []) if x.get('eventId') in (180, 218)]
print(json.dumps(out))
`]).toString());
const of = (f, id) => M[f].find(x => x.eventId === id) || null;
const skillOf = id => { const v = +(of('eventSkillScoreUpLimits', id) || {}).scoreUpRateLimit || 0; return v ? (v > 200 ? v - 100 : v) : null; };
const dollOf = id => { const x = of('eventMysekaiFixtureGameCharacterPerformanceBonusLimits', id); return x ? x.bonusRateLimit / 10 : null; };
const limOf = id => { const x = of('eventCardBonusLimits', id); return x ? x.memberCountLimit : null; };
const capOf = id => { const x = of('eventTotalPowerLimits', id); return x ? x.upperTotalPower : null; };

/* ===== 資料 ===== */
const E = Z.events, CH = E.filter(e => !e.fin), FIN = E.find(e => e.fin), C1 = CH[0];
const fmt = n => Number(n).toLocaleString('en-US');
const tw = ms => new Date(ms + 8 * 3600000);
const md = ms => { const d = tw(ms); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); };
const ymd = ms => { const d = tw(ms); return d.getUTCFullYear() + '/' + (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); };
const hm = ms => { const d = tw(ms); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };
const tag = e => (e.fin ? '終章' : '第 ' + e.part + ' 期');
const evName = e => e.tw || e.jp;
const nCh = CH.reduce((a, e) => a + e.ch.length, 0);
const sup = D.sup, rar = D.evb.rar, attrB = D.evb.attr;
const shu = Object.entries(FIN.shuffle || {}).sort((a, b) => a[0] - b[0]);

/* 綜合力上限：第 1 期滿配隊伍、角色等級 50、專精 5，大門 × 玩偶 → 區域道具最低統一等級（js/wl3pow.js 同一套算式） */
const ev1 = D.events.find(e => e[0] === C1.id), team = ev1[9][0];
const base = { area: {}, gate: {}, doll: {}, rank: {}, mr: [5, 5, 5, 5, 5], cap: ev1[4], dollCap: ev1[5], areaMax: D.lim.area, gateMax: D.lim.gate, tree: D.lim.tree };
const ids = W.wpRelevant(D, team, base);
const GATES = [0, Math.round(D.lim.gate / 2), D.lim.gate], DOLLS = [0, 1, 2];
const capGrid = GATES.map(g => DOLLS.map(d => W.wpMinUniform(D, team, Object.assign({}, base, {
  gate: Object.fromEntries(W.WP_UNITS.map(u => [u, g])), doll: Object.fromEntries(team.map(id => [D.cards[id][0], d])) }), ids)));
const maxPow = W.wpPower(D, team, W.wpUniform(Object.assign({}, base, { gate: Object.fromEntries(W.WP_UNITS.map(u => [u, D.lim.gate])) }), ids, D.lim.area)).total;

/* 台服預測卡池裡掛在 WL3 期數的池（data/sekai-data.js 的 GACHAS） */
const { GACHAS: G } = await import(path.join(ROOT, 'data', 'sekai-data.js'));
const wlIds = new Set(E.map(e => String(e.id)));
const POOLS = G.filter(g => g.eid && wlIds.has(String(g.eid)) && /World Link/.test(g.t || ''));
const lastPool = G.reduce((m, g) => (g.s && g.s > m ? g.s : m), '');

/* ===== 文字內容（圖與文字版共用） ===== */
const WHAT = [
  ['6 期 ' + nCh + ' 章', `第 1～5 期是章節活動：一期 5～6 章、一章 2 天、主角一位，${nCh} 位角色各一章；第 6 期是終章，3 天、全角色一起。`],
  ['章節榜＋總榜', '每一章有自己的章節榜（排名獎勵與章節稱號），整期另有總榜。'],
  ['兩隊加成相加', '活動加成＝主隊五張（活動卡、角色、稀有度×專精、異色…）＋後排支援隊 25 張的加成。'],
  ['台服 ' + ymd(C1.twT[0]) + ' ' + hm(C1.twT[0]), `第 1 期「${evName(C1)}」台服 master 已公布；第 2 期起照「日服同一時刻加一年」推估。`],
];
const DIFF = [
  ['後排支援隊', '20 張', Z.supN + ' 張'],
  ['後排的前幾屆限定卡 +20', 'WL1 一張', 'WL1＋WL2 兩張'],
  ['總合力上限', capOf(180) ? fmt(capOf(180)) : '沒有', capOf(218) ? fmt(capOf(218)) : '—'],
  ['終章限定卡加成', limOf(180) ? '最多計 ' + limOf(180) + ' 張' : '五張都算', limOf(218) ? '最多計 ' + limOf(218) + ' 張' : '五張都算'],
  ['終章混團加成', '沒有', shu.length ? shu.map(x => x[0]).join('／') + ' 團 +' + shu.map(x => x[1]).join('／') + '%' : '沒有'],
  ['終章技能上限', skillOf(180) != null ? '+' + skillOf(180) + '%' : '—', skillOf(218) != null ? '+' + skillOf(218) + '%' : '—'],
  ['終章玩偶綜合力上限', dollOf(180) != null ? dollOf(180) + '%' : '—', dollOf(218) != null ? dollOf(218) + '%' : '—'],
];
const PREP = [
  ['區域道具', `大門 Lv${D.lim.gate}＋每人 1 套玩偶時，這隊用得到的區域道具全練到 <b>Lv${capGrid[2][1]}</b> 就碰到 ${fmt(C1.cap)}；沒有大門與玩偶要 <b>Lv${capGrid[0][0]}</b>。`],
  ['MySekai 大門', `WL3 當時大門上限 Lv${D.lim.gate}；先練章節角色那幾團的門。`],
  ['後排卡', '每位角色的四星越多越好（本章角色一張 17%）；WL1、WL2 限定卡一定留著，後排每張再 +20。'],
  ['WL3 限定卡', `各章的活動卡：章節期間 +${C1.ec}%、終章 26 張一起當限定卡（每張 +${FIN.ec}%，五張都算）。`],
  ['終章隊伍', '五張不同團、五種屬性的 WL3 限定卡（混團 +50、五色 +125），隊長也放限定卡。'],
  ['碰到上限之後', `綜合力超過 ${fmt(C1.cap)} 不計分：改練技能等級，或換成技能更好的卡。`],
];
const QA = [
  ['綜合力已經超過 33.6 萬了？', '多出來的不計分。先確認活動加成拉滿（五色、活動卡、後排），再去提升技能。'],
  ['後排可以放當期的活動卡嗎？', '不行。當期的活動卡（章節＝本期 5～6 張、終章＝26 張 WL3 限定卡）只能放主隊。'],
  ['VS 卡算哪一團？', '後排看卡片的支援團（支援這團的才收）；終章的混團加成一律算 VIRTUAL SINGER。'],
  ['終章隊長要選誰？', '想拿哪位角色的終章報酬就用誰：看你終章期間最常用的隊長。隊長是限定卡再 +20%，主稱號要跟隊長同角色。'],
  ['主稱號是什麼？', `隊長角色那一章拿到 T1000 以內的章節稱號，戴著跑終章 +${FIN.title}%。`],
  ['台服日期會變嗎？', '第 1 期是台服 master 的正式時間；其他是推估，台服公布後 WL3 專區隔天就換成正式時間。'],
];

/* ===== 版面 ===== */
const sec = (no, title, sub, body, cls = '') => `<div class="sec ${cls}"><div class="sh"><span class="no">${no}</span><h2>${title}</h2>${sub ? `<em>${sub}</em>` : ''}</div>${body}</div>`;
const pct = v => (Math.round(v * 10) / 10) + '%';

const A1 = sec('01', 'WL3 是什麼', '日服 2026/4–9 已結束',
  `<div class="whats">${WHAT.map(([k, d]) => `<div class="wh"><b>${k}</b><span>${d}</span></div>`).join('')}</div>`);
const A2 = sec('02', '台服時程', '台北時間；第 2 期起為推估',
  `<div class="tl">${E.map(e => `<div class="tr${e.fin ? ' fin' : ''}"><div class="tlh"><span class="tg">${tag(e)}</span><b>${evName(e)}</b>`
    + `<span class="dt">${md(e.twT[0])}–${md(e.twT[1])}${e.twOff ? '<i class="off">台服公布</i>' : '<i>推估</i>'}</span></div>`
    + (e.fin ? `<div class="fintx">全角色・3 天</div>` : `<div class="avs">${e.ch.map(c => `<span class="av"><img src="${sd(c[1])}" alt=""><em>${CN(c[1])}</em></span>`).join('')}</div>`)
    + '</div>').join('')}</div>`);
const B1 = sec('03', '跟 WL2 哪裡不一樣', '日服 master',
  `<table><thead><tr><th>項目</th><th>WL2</th><th>WL3</th></tr></thead><tbody>${DIFF.map(([k, a, b]) => `<tr class="${a !== b ? 'hot' : ''}"><td class="l">${k}</td><td>${a}</td><td><b>${b}</b></td></tr>`).join('')}</tbody></table>`);
const B2 = sec('04', '章節：主隊加成', `滿配 ${C1.bMain}%`,
  `<div class="eq"><div class="eqi"><b>+${C1.ec}</b><span>本期活動卡</span></div><i>＋</i><div class="eqi"><b>+${C1.cb}</b><span>本章角色</span></div><i>＋</i><div class="eqi"><b>+${rar['4'][5]}</b><span>四星專精 5</span></div><i>×5＋</i><div class="eqi"><b>+${attrB[4]}</b><span>五色</span></div><i>＝</i><div class="eqi t"><b>${C1.bMain}%</b><span>主隊</span></div></div>`
  + `<ul class="pts"><li>本期的活動卡剛好是 5 位章節角色、<b>五種屬性</b>：五張全放主隊就是滿配。</li><li>異色：隊上 3／4／5 種屬性 <b>+${attrB[2]}／${attrB[3]}／${attrB[4]}%</b>；1～2 種沒有。</li></ul>`
  + `<table class="mini"><thead><tr><th>專精</th>${[0, 1, 2, 3, 4, 5].map(m => `<th>${m}</th>`).join('')}</tr></thead><tbody>`
  + `<tr><td class="l">四星</td>${rar['4'].map(v => `<td>${v}</td>`).join('')}</tr><tr><td class="l">生日</td>${rar['9'].map(v => `<td>${v}</td>`).join('')}</tr></tbody></table>`);
const C1s = sec('05', '後排支援隊', `${Z.supN} 張・滿配 ${C1.bSup}%`,
  `<ul class="pts"><li>章節：只收<b>本章角色同團</b>的卡（VS 卡要支援這團）；終章不限團，照<b>隊長的角色</b>算。</li><li><b>當期活動卡不能放</b>；只算該期結算前已推出的卡。</li><li>前幾屆的 WL 限定卡（本章角色的）每張再 <b>+20</b>：WL1、WL2 各一張。</li></ul>`
  + `<table><thead><tr><th>稀有度</th><th>本章角色</th><th>其他角色</th><th>專精 5</th><th>技能 4</th></tr></thead><tbody>`
  + [['四星', '4'], ['生日', '9'], ['三星', '3'], ['二星', '2']].map(([k, r]) => `<tr class="${r === '4' ? 'hot' : ''}"><td class="l nw">${k}</td><td><b>${sup[r][0]}</b></td><td>${sup[r][1]}</td><td>+${sup[r][2][5]}</td><td>+${sup[r][3][3]}</td></tr>`).join('')
  + `</tbody></table><div class="big"><div><b>${C1.bSup}% ＝ 2 × 37 ＋ 23 × 17</b><span>兩張前幾屆限定卡（${sup['4'][0]}＋2.5＋2.5＋20）＋ 23 張本章角色四星（全部專精 5、技能 4）</span></div></div>`);
const C2s = sec('06', '終章', `主隊 ${FIN.bMain}% ＋ 後排 ${FIN.bSup}%`,
  `<table><tbody>${[
    ['WL3 限定卡', `+${FIN.ec} × 5`, FIN.ec * 5, FIN.limMax == null ? '五張都算（WL2 只算 4 張）' : '最多 ' + FIN.limMax + ' 張'],
    ['角色加成', `+${FIN.cb} × 5`, FIN.cb * 5, '全角色都有'],
    ['稀有度×專精', `+${rar['4'][5]} × 5`, rar['4'][5] * 5, '四星專精 5'],
    ['五色', '', attrB[4], '五種屬性'],
    ['混團', '', shu.length ? +shu[shu.length - 1][1] : 0, shu.length ? shu.map(x => x[0]).join('／') + ' 團 +' + shu.map(x => x[1]).join('／') + '・VS 算 VIRTUAL SINGER' : ''],
    ['隊長', '', FIN.lead, '隊長是 WL3 限定卡'],
    ['主稱號', '', FIN.title, '隊長角色那一章 T1000 以內'],
  ].map(([k, f, v, n]) => `<tr><td class="l nw">${k}</td><td class="l">${n}</td><td><b>+${v}</b>${f ? `<em>${f}</em>` : ''}</td></tr>`).join('')}`
  + `<tr class="hot"><td class="l nw"><b>合計</b></td><td class="l">主隊 ${FIN.bMain}＋後排 ${FIN.bSup}</td><td><b class="pk">${FIN.bAll}%</b></td></tr></tbody></table>`
  + `<div class="callout">終章期間單張卡的技能最多 <b>+${FIN.skill}%</b>、玩偶的綜合力最多 <b>${FIN.doll}%</b>。排名報酬給的角色看你終章最常用的<b>隊長</b>。</div>`);
const D1s = sec('07', `綜合力上限 ${fmt(C1.cap)}`, '超過不計分',
  `<div class="stats"><div class="st"><span>每一期</span><b>${fmt(C1.cap)}</b><em>章節與終章都一樣</em></div><div class="st"><span>第 1 期滿配隊伍練滿</span><b>${fmt(maxPow)}</b><em>多 ${fmt(maxPow - C1.cap)} 不計分</em></div></div>`
  + `<div class="sub">碰到上限要把區域道具練到幾級</div><table><thead><tr><th>大門 ＼ 玩偶</th>${DOLLS.map(d => `<th>${d ? d + ' 套' : '沒有'}</th>`).join('')}</tr></thead><tbody>`
  + GATES.map((g, i) => `<tr><td class="l nw">大門 Lv${g}</td>${capGrid[i].map(L => `<td><b>${L == null ? '不夠' : 'Lv' + L}</b></td>`).join('')}</tr>`).join('')
  + `</tbody></table><div class="note">第 1 期滿配隊伍、角色等級 50、專精 5，這隊用得到的區域道具全部同一級。WL3 當時區域道具 Lv${D.lim.area}、大門 Lv${D.lim.gate}、沒有想いの大樹。</div>`);
const D2s = sec('08', '開跑前準備', `台服 ${ymd(C1.twT[0])}`,
  `<div class="rules">${PREP.map(([k, d], i) => `<div class="ru"><i>${i + 1}</i><div><b>${k}</b><span>${d}</span></div></div>`).join('')}</div>`);
const D3s = `<div class="site"><b>project-sekai-center.com</b><span>WL3 專區：倒數、時程、榜線<br>WL3 計算器：用你的資料算上限與加成<br>WL 後排加成：截圖辨識你的卡庫</span></div>`;

/* 下篇 */
const TI = Z.tiers.map((t, i) => [t, i]).filter(([t]) => [100, 1000, 5000, 10000, 50000].includes(t));
const wan = v => (v == null ? '—' : fmt(Math.round(v / 1e4)));
const bdTable = evs => `<table class="bd"><thead><tr><th>章節</th>${TI.map(([t]) => `<th>T${fmt(t)}</th>`).join('')}</tr></thead><tbody>`
  + evs.map(e => `<tr class="evh"><td class="l nw"><span class="tg">${tag(e)}</span>總榜</td>${TI.map(([, i]) => `<td><b>${wan((e.main || [])[i])}</b></td>`).join('')}</tr>`
    + e.ch.filter(c => c[1]).map(c => `<tr><td class="l nw"><img class="ti" src="${sd(c[1])}" alt="">${CN(c[1])}<span class="dd">第 ${c[0]} 章</span></td>${TI.map(([, i]) => `<td>${wan((c[6] || [])[i])}</td>`).join('')}</tr>`).join('')).join('')
  + '</tbody></table>';
/* 26 章的章節榜一起看：每個名次的平均、最高與最低是哪一章 */
const ALLCH = CH.flatMap(e => e.ch.filter(c => c[1] && c[6]).map(c => ({ c: c[1], v: c[6] })));
const SUMT = [100, 1000, 10000].map(t => { const i = Z.tiers.indexOf(t), xs = ALLCH.filter(x => x.v[i] != null).sort((a, b) => b.v[i] - a.v[i]);
  return { t, i, avg: xs.reduce((a, x) => a + x.v[i], 0) / xs.length, hi: xs[0], lo: xs[xs.length - 1] }; });
const P1 = sec('09', '日服最終榜線', '單位：萬分；粉色列＝整期總榜',
  `<div class="bd2"><div>${bdTable(E.slice(0, 3))}</div><div>${bdTable(E.slice(3))}`
  + `<div class="sub">${ALLCH.length} 章的章節榜一起看</div><table><thead><tr><th>名次</th><th>平均</th><th>最高</th><th>最低</th></tr></thead><tbody>`
  + SUMT.map(x => `<tr><td><b>T${fmt(x.t)}</b></td><td><b>${wan(x.avg)}</b></td><td class="l nw"><img class="ti" src="${sd(x.hi.c)}" alt="">${CN(x.hi.c)} ${wan(x.hi.v[x.i])}</td><td class="l nw"><img class="ti" src="${sd(x.lo.c)}" alt="">${CN(x.lo.c)} ${wan(x.lo.v[x.i])}</td></tr>`).join('')
  + `</tbody></table></div></div>`
  + `<div class="note">日服每一章（章節榜，2 天）與每一期（總榜）的最終榜線；終章 3 天、只有總榜，T1000 以內是搶稱號的區間，往後斷崖式下降。台服玩家數不同，只當量級參考；台服開跑後的即時榜線看網站的 WL 個榜。</div>`);
const P2 = sec('10', 'WL3 限定卡', '26 張＝各章的活動卡',
  `<div class="cds">${Z.cards.map(c => `<div class="cd"><img src="${AS}/thumbnail/chara/${c[3]}_after_training.webp" alt=""><b>${CN(c[1])}</b><span><i style="background:${ATTR[c[2]][1]}"></i>${ATTR[c[2]][0]}・${tag(E.find(e => e.id === c[6]) || FIN)}</span></div>`).join('')}</div>`
  + `<div class="note">章節期間是當期活動卡（+${C1.ec}%、只能放主隊）；終章 26 張一起當 WL3 限定卡（每張 +${FIN.ec}%）。</div>`);
const P3 = sec('11', 'WL3 卡池', `台服預測（排到 ${lastPool} 開始的池）`,
  `<div class="pools">${POOLS.map(g => `<div class="pl"><b>${g.n}</b><span>${g.t}・${g.s.slice(5)}–${g.e.slice(5)}</span><span>${g.ch}</span>${g.note ? `<em>${g.note}</em>` : ''}</div>`).join('')}</div>`
  + `<div class="note">「支援活動招募」可以抽到 WL1、WL2 的限定卡（後排 +20 的那些），想補後排可以考慮。卡池日期照日服同一天加一年推估。</div>`);
const P4 = sec('12', '常見 Q&amp;A', '', `<div class="qas">${QA.map(([q, a]) => `<div class="qa"><b>Q</b><div><h4>${q}</h4><p>${a}</p></div></div>`).join('')}</div>`);

const CSS = `
:root{--bl:#3f8cff;--pk:#ff4f93;--lv:#8a72ff;--ink:#1f2340;--sub:#5d6585;--line:#dfe6f6}
*{box-sizing:border-box;margin:0;padding:0}
body{width:1920px;height:1080px;font-family:'Noto Sans TC','Noto Sans CJK TC','Microsoft JhengHei',sans-serif;color:var(--ink);background:#fff}
#poster{width:1920px;height:1080px;overflow:hidden;display:grid;grid-template-rows:120px minmax(0,1fr) 30px;background:radial-gradient(circle at 1px 1px,rgba(63,140,255,.10) 1.5px,transparent 0) 0 0/20px 20px,linear-gradient(160deg,#e6f0ff 0%,#f1ecff 45%,#ffeef6 80%,#eaf6ff 100%)}
.top{position:relative;overflow:hidden;background:linear-gradient(90deg,#2f6fe0 0%,#5a7cff 45%,#a36bff 75%,#ff6fa8 100%)}
.top .art{position:absolute;right:0;top:0;bottom:0;width:1100px;background:url('${AS}/event/${FIN.abn}/screen/bg.webp') center 40%/cover;-webkit-mask-image:linear-gradient(90deg,transparent 0%,#000 45%);mask-image:linear-gradient(90deg,transparent 0%,#000 45%)}
.top .logo{position:absolute;right:250px;top:8px;height:104px;filter:drop-shadow(0 3px 10px rgba(0,0,0,.25))}
.top .tt{position:absolute;left:30px;top:14px;color:#fff}
.top h1{font-size:48px;font-weight:900;letter-spacing:1px;line-height:1.1;text-shadow:0 3px 0 rgba(30,60,160,.45),0 8px 20px rgba(20,30,90,.3)}
.top h1 small{font-size:28px;margin-left:12px}
.top .ln2{display:flex;align-items:center;gap:10px;margin-top:8px;font-size:17px;font-weight:700}
.top .pill{padding:3px 14px;border-radius:999px;background:#fff;color:var(--bl);font-weight:900;font-size:17px}
.top .brand{position:absolute;right:22px;bottom:12px;padding:5px 14px;border-radius:999px;background:rgba(255,255,255,.92);font-weight:900;font-size:15px;color:var(--bl)}
.body{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;padding:12px 18px;min-height:0}
.col{display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden}
.span2{grid-column:span 2}
.foot{display:flex;align-items:center;gap:10px;padding:0 20px;background:#1f2340;color:#fff;font-size:12.5px}
.foot b{color:#cfe0ff;font-size:13.5px}
.foot .pg{margin-left:auto;font-weight:900;color:#cfe0ff}
.sec{background:rgba(255,255,255,.93);border-radius:18px;padding:9px 12px 10px;box-shadow:0 6px 18px rgba(63,140,255,.10);border:1px solid rgba(255,255,255,.8)}
.sh{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.sh .no{font-weight:900;font-size:14px;color:#fff;background:linear-gradient(135deg,var(--bl),var(--lv));border-radius:9px;padding:2px 8px}
.sh h2{font-size:21px;font-weight:900}
.sh em{margin-left:auto;font-style:normal;font-size:12px;color:var(--sub);font-weight:700;text-align:right}
.sub{font-size:14px;font-weight:900;margin:8px 0 5px;display:flex;align-items:center;gap:6px}
.sub::before{content:'';width:4px;height:15px;border-radius:2px;background:linear-gradient(180deg,var(--bl),var(--lv))}
.whats{display:grid;gap:6px}
.wh{padding:5px 9px;border-radius:12px;background:#fff;border:1.5px solid var(--line)}
.wh b{display:block;font-size:15px;font-weight:900;color:var(--bl)}
.wh span{display:block;font-size:12px;line-height:1.5;color:var(--sub)}
.tl{display:grid;gap:5px}
.tr{padding:5px 8px;border-radius:12px;background:#fff;border:1.5px solid var(--line)}
.tr.fin{border-color:#ffc2da;background:#fff6fa}
.tlh{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.tlh b{font-size:13.5px;font-weight:900}
.tg{display:inline-block;font-size:11px;font-weight:900;color:#fff;background:var(--bl);border-radius:999px;padding:0 7px;margin-right:4px}
.tr.fin .tg,.evh .tg{background:var(--pk)}
.dt{margin-left:auto;font-size:12px;font-weight:900;color:var(--ink);font-variant-numeric:tabular-nums}
.dt i{font-style:normal;margin-left:5px;font-size:10.5px;padding:0 6px;border-radius:999px;background:#eef2fb;color:var(--sub)}
.dt i.off{background:#dff7f1;color:#16927f}
.avs{display:flex;gap:3px;margin-top:4px}
.av{display:flex;flex-direction:column;align-items:center;width:48px}
.av img{width:30px;height:30px;border-radius:50%;background:#eef3ff;object-fit:cover}
.av em{font-style:normal;font-size:10.5px;font-weight:700;color:var(--sub);white-space:nowrap}
.fintx{margin-top:3px;font-size:12px;font-weight:700;color:var(--pk)}
table{width:100%;border-collapse:separate;border-spacing:0;border-radius:12px;overflow:hidden;border:1.5px solid var(--line);background:#fff}
th{background:linear-gradient(90deg,#e3edff,#efe8ff);font-size:11.5px;font-weight:900;padding:5px 4px;text-align:center;line-height:1.25}
td{padding:4px 6px;border-top:1px solid var(--line);text-align:center;font-size:12.5px;font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}
td.l{text-align:left;font-size:12px;line-height:1.4;white-space:normal}
td.nw{white-space:nowrap}
td b{font-size:13.5px} td em{display:block;font-style:normal;font-size:10.5px;color:var(--sub);line-height:1.2}
td .dd{margin-left:5px;font-size:10.5px;color:var(--sub);font-weight:500}
tr.hot td{background:#f1f6ff}
b.pk{color:var(--pk);font-size:16px}
.ti{width:22px;height:22px;border-radius:50%;vertical-align:middle;margin-right:4px;background:#eef3ff;object-fit:cover}
ul.pts{list-style:none;display:grid;gap:4px;margin:7px 0}
ul.pts li{position:relative;padding:4px 8px 4px 20px;border-radius:10px;background:#fff;border:1.5px solid var(--line);font-size:12px;line-height:1.45}
ul.pts li::before{content:'';position:absolute;left:8px;top:11px;width:6px;height:6px;border-radius:50%;background:var(--bl)}
ul.pts b{color:var(--bl)}
table.mini td,table.mini th{padding:3px 2px}
.eq{display:flex;align-items:center;gap:3px;flex-wrap:nowrap}
.eq>i{font-style:normal;font-weight:900;color:var(--sub);font-size:13px;white-space:nowrap}
.eqi{flex:1 1 0;display:flex;flex-direction:column;align-items:center;padding:5px 2px;border-radius:12px;background:#fff;border:1.5px solid var(--line);min-width:0}
.eqi b{font-size:17px;font-weight:900;color:var(--bl)}
.eqi span{font-size:10.5px;font-weight:700;color:var(--sub);white-space:nowrap}
.eqi.t{background:linear-gradient(135deg,var(--bl),var(--lv));border:none}
.eqi.t b,.eqi.t span{color:#fff}
.big{display:flex;align-items:center;gap:10px;margin-top:7px;padding:7px 12px;border-radius:14px;background:linear-gradient(90deg,#3f8cff,#8a72ff);color:#fff}
.big b{font-size:16px;font-weight:900;display:block}
.big span{font-size:11.5px;opacity:.95;line-height:1.45}
.callout{margin-top:7px;padding:7px 10px;border-radius:12px;background:linear-gradient(90deg,#eaf2ff,#f3eeff);font-size:12.5px;line-height:1.55}
.callout b{color:var(--pk)}
.note{margin-top:5px;font-size:11px;line-height:1.5;color:var(--sub)}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.st{display:flex;flex-direction:column;padding:6px 9px;border-radius:12px;background:#fff;border:1.5px solid var(--line)}
.st span{font-size:11px;font-weight:700;color:var(--sub)}
.st b{font-size:21px;font-weight:900;line-height:1.15;font-variant-numeric:tabular-nums}
.st em{font-style:normal;font-size:10.5px;color:var(--sub)}
.rules{display:grid;gap:5px}
.ru{display:flex;gap:7px;align-items:flex-start;padding:5px 8px;border-radius:11px;background:#fff;border:1.5px solid var(--line)}
.ru i{font-style:normal;font-weight:900;min-width:21px;height:21px;border-radius:7px;background:linear-gradient(135deg,var(--bl),var(--lv));color:#fff;display:grid;place-items:center;font-size:12.5px;margin-top:1px}
.ru b{display:block;font-size:13.5px;font-weight:900;line-height:1.3}
.ru span{font-size:11.5px;line-height:1.45;color:var(--sub);display:block}
.ru span b{display:inline;font-size:11.5px;color:var(--pk)}
.site{padding:9px 12px;border-radius:16px;background:linear-gradient(135deg,#2f6fe0,#a36bff);color:#fff}
.site b{display:block;font-size:17px;font-weight:900}
.site span{display:block;font-size:12px;line-height:1.6;opacity:.95}
.bd2{display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:start}
table.bd td{padding:4px 6px;font-size:13px}
table.bd td.l{font-size:12.5px}
table.bd tr.evh td{background:#fff1f7;font-weight:900}
table.bd tr.evh td b{color:var(--pk);font-size:12.5px}
.cds{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}
.cd{display:flex;flex-direction:column;align-items:center;padding:4px 2px;border-radius:11px;background:#fff;border:1.5px solid var(--line)}
.cd img{width:58px;height:58px;border-radius:9px;box-shadow:0 2px 6px rgba(0,0,0,.15)}
.cd b{font-size:12px;font-weight:900;margin-top:2px}
.cd span{font-size:10px;color:var(--sub);display:flex;align-items:center;gap:3px;white-space:nowrap}
.cd span i{width:7px;height:7px;border-radius:50%;display:inline-block}
.pools{display:grid;gap:5px}
.pl{display:flex;flex-direction:column;padding:6px 9px;border-radius:12px;background:#fff;border:1.5px solid var(--line)}
.pl b{font-size:13px;font-weight:900}
.pl span{font-size:11.5px;color:var(--sub);line-height:1.45}
.pl em{font-style:normal;font-size:11px;color:var(--pk);font-weight:700}
.qas{display:grid;gap:5px}
.qa{display:flex;gap:7px;padding:5px 8px;border-radius:11px;background:#fff;border:1.5px solid var(--line)}
.qa>b{font-weight:900;font-size:13px;color:#fff;background:var(--bl);border-radius:7px;min-width:21px;height:21px;display:grid;place-items:center;margin-top:1px}
.qa h4{font-size:13px;font-weight:900}
.qa p{font-size:11.5px;line-height:1.45;color:var(--sub)}`;

const page16 = (part, pill, body) => `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="poster">
<div class="top"><div class="art"></div><img class="logo" src="${AS}/event/${FIN.abn}/logo/logo.webp" alt="">
  <div class="tt"><h1>WORLD LINK 3<small>攻略</small></h1>
    <div class="ln2"><span class="pill">${pill}</span>台服 ${ymd(C1.twT[0])} 開跑・6 期 ${nCh} 章・滿配 ${C1.bAll}%／${FIN.bAll}%</div></div>
  <div class="brand">Project SEKAI 資源中心・一圖流</div></div>
<div class="body">${body}</div>
<div class="foot"><b>project-sekai-center.com ・ WL3 專區</b><span>規則、加成、上限、時程、榜線與限定卡讀自遊戲 master 與本站資料庫（日服 WL3 已於 2026/9 結束；台服第 2 期起為推估）。遊戲畫面與素材 © SEGA / © Colorful Palette / © Crypton Future Media</span><span class="pg">${part}</span></div>
</div></body></html>`;
const html1 = page16('上篇 1/2', '上篇｜時程・規則・加成',
  `<div class="col">${A1}${A2}</div><div class="col">${B1}${B2}</div><div class="col">${C1s}${C2s}</div><div class="col">${D1s}${D2s}${D3s}</div>`);
const html2 = page16('下篇 2/2', '下篇｜日服榜線・限定卡・卡池・Q&amp;A',
  `<div class="col span2">${P1}</div><div class="col">${P2}</div><div class="col">${P3}${P4}</div>`);

/* 圖先用 curl 抓下來內嵌成 data URI：截圖時不靠瀏覽器連外網，也確定每張圖都到齊才截 */
const get = url => execFileSync('curl', ['-sSfL', '-m', '90', url], { maxBuffer: 64 << 20 });
const MIME = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };
const pages = [html1, html2];
const urls = [...new Set(pages.join('').match(/https:\/\/storage\.sekai\.best\/[^'")\s]+/g) || [])];
const inl = {};
urls.forEach(u => { inl[u] = 'data:' + (MIME[u.split('.').pop()] || 'application/octet-stream') + ';base64,' + get(u).toString('base64'); });
const inline = h => urls.reduce((s, u) => s.split(u).join(inl[u]), h);

const launch = { headless: true, args: ['--no-sandbox'] };
if (process.env.CHROME) launch.executablePath = process.env.CHROME;
const browser = await pw.chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: +(process.env.DSF || 2) });
fs.mkdirSync(OUT, { recursive: true });
const outs = [];
for (const [i, h] of pages.entries()) {
  await page.setContent(inline(h), { waitUntil: 'networkidle', timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const broken = await page.evaluate(() => [...document.images].filter(x => !x.naturalWidth).length);
  if (broken) { console.error('有 ' + broken + ' 張圖沒載入'); process.exit(1); }
  const over = await page.evaluate(() => [...document.querySelectorAll('.col')].map((c, j) => [j + 1, c.scrollHeight - c.clientHeight]).filter(([, d]) => d > 0));
  if (over.length) { console.error(`第 ${i + 1} 張有欄位超出：` + over.map(([j, d]) => `第 ${j} 欄 +${d}px`).join('、')); if (!process.env.LOOSE) process.exit(1); }
  const png = path.join(OUT, `guide-${i + 1}.png`);
  await page.screenshot({ path: png, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  if (process.env.HTML_OUT) fs.writeFileSync(process.env.HTML_OUT.replace(/(\.\w+)?$/, `-${i + 1}$1`), h);
  outs.push(png);
}
await browser.close();

/* 純文字版（TEXT_OUT=檔名）：給 Discord／LINE／巴哈貼文 */
if (process.env.TEXT_OUT) {
  const strip = h => h.replace(/<[^>]+>/g, '');
  const T = ['【WORLD LINK 3 攻略（文字版）】', `台服 ${ymd(C1.twT[0])} ${hm(C1.twT[0])} 開跑・6 期 ${nCh} 章・滿配 ${C1.bAll}%（章節）／${FIN.bAll}%（終章）`, '',
    '■ 01 WL3 是什麼', ...WHAT.map(([k, d]) => `・${k}：${d}`), '',
    '■ 02 台服時程（台北時間；第 2 期起為推估）',
    ...E.map(e => `・${tag(e)}「${evName(e)}」${md(e.twT[0])}–${md(e.twT[1])}${e.twOff ? '（台服公布）' : '（推估）'}：` + (e.fin ? '全角色・3 天' : e.ch.map(c => `${CN(c[1])} ${md(c[4])}`).join('、'))), '',
    '■ 03 跟 WL2 哪裡不一樣', ...DIFF.map(([k, a, b]) => `・${k}：WL2 ${a} → WL3 ${b}`), '',
    `■ 04 章節：主隊加成（滿配 ${C1.bMain}%）`,
    `・每張：本期活動卡 +${C1.ec}、本章角色 +${C1.cb}、四星專精 5 +${rar['4'][5]}；五張再加五色 +${attrB[4]}`,
    `・本期活動卡剛好是 5 位章節角色、五種屬性：全放主隊就是滿配。異色 3／4／5 種 +${attrB[2]}／${attrB[3]}／${attrB[4]}%`, '',
    `■ 05 後排支援隊（${Z.supN} 張・滿配 ${C1.bSup}%）`,
    '・章節只收本章角色同團的卡（VS 卡要支援這團）；終章不限團，照隊長的角色算',
    '・當期活動卡不能放；只算該期結算前已推出的卡；前幾屆的 WL 限定卡（本章角色的）每張再 +20（WL1、WL2 各一張）',
    ...[['四星', '4'], ['生日', '9'], ['三星', '3'], ['二星', '2']].map(([k, r]) => `・${k}：本章角色 ${sup[r][0]}、其他 ${sup[r][1]}、專精 5 +${sup[r][2][5]}、技能 4 +${sup[r][3][3]}`),
    `・滿配 ${C1.bSup}% ＝ 2 × 37 ＋ 23 × 17`, '',
    `■ 06 終章（主隊 ${FIN.bMain}% ＋ 後排 ${FIN.bSup}% ＝ ${FIN.bAll}%）`,
    `・WL3 限定卡 +${FIN.ec} × 5（五張都算）、角色 +${FIN.cb} × 5、四星專精 5 +${rar['4'][5]} × 5、五色 +${attrB[4]}`,
    `・混團 ${shu.map(x => x[0]).join('／')} 團 +${shu.map(x => x[1]).join('／')}（VS 卡算 VIRTUAL SINGER）、隊長是限定卡 +${FIN.lead}、主稱號 +${FIN.title}（隊長角色那一章 T1000 以內）`,
    `・終章技能上限 +${FIN.skill}%、玩偶綜合力上限 ${FIN.doll}%；排名報酬的角色看終章最常用的隊長`, '',
    `■ 07 綜合力上限 ${fmt(C1.cap)}（超過不計分；第 1 期滿配隊伍練滿是 ${fmt(maxPow)}）`,
    ...GATES.map((g, i) => `・大門 Lv${g}：` + DOLLS.map((d, j) => `${d ? d + ' 套玩偶' : '沒有玩偶'} 區域道具 Lv${capGrid[i][j]}`).join('、')), '',
    `■ 08 開跑前準備`, ...PREP.map(([k, d], i) => `${i + 1}. ${k}：${strip(d)}`), '',
    '■ 09 日服最終榜線（萬分；T' + TI.map(([t]) => fmt(t)).join('／T') + '）',
    ...E.flatMap(e => [`・${tag(e)}「${e.jp}」總榜：` + TI.map(([, i]) => wan((e.main || [])[i])).join('／'),
      ...e.ch.filter(c => c[1]).map(c => `　${CN(c[1])}（第 ${c[0]} 章）：` + TI.map(([, i]) => wan((c[6] || [])[i])).join('／'))]), '',
    ...SUMT.map(x => `・${ALLCH.length} 章 T${fmt(x.t)}：平均 ${wan(x.avg)}、最高 ${CN(x.hi.c)} ${wan(x.hi.v[x.i])}、最低 ${CN(x.lo.c)} ${wan(x.lo.v[x.i])}`), '',
    '■ 10 WL3 限定卡（26 張）', Z.cards.map(c => `${CN(c[1])}（${tag(E.find(e => e.id === c[6]) || FIN)}）`).join('、'), '',
    `■ 11 WL3 卡池（台服預測，排到 ${lastPool} 開始的池）`, ...POOLS.map(g => `・${g.n}（${g.t}）${g.s}–${g.e}：${g.ch}${g.note ? '；' + g.note : ''}`), '',
    '■ 12 常見 Q&A', ...QA.flatMap(([q, a]) => ['Q：' + q, 'A：' + a, '']),
    '互動版：https://project-sekai-center.com/app.html?page=wl3'];
  fs.writeFileSync(process.env.TEXT_OUT, T.join('\n') + '\n');
}

/* 一頁式（上下接成一張 JPG）、縮圖（640×360）、看大圖用的全尺寸 WebP，並把 app.html 的 ?v= 換成各張圖的雜湊 */
execFileSync('python3', ['-c', `
from PIL import Image
a, b = Image.open(${JSON.stringify(outs[0])}).convert('RGB'), Image.open(${JSON.stringify(outs[1])}).convert('RGB')
im = Image.new('RGB', (a.width, a.height + b.height), 'white'); im.paste(a, (0, 0)); im.paste(b, (0, a.height))
im.save(${JSON.stringify(path.join(OUT, 'guide.jpg'))}, 'JPEG', quality=88, optimize=True, progressive=True)
for i, p in enumerate([${outs.map(o => JSON.stringify(o)).join(', ')}]):
    x = Image.open(p).convert('RGB')
    x.save(p[:-4] + '.webp', 'WEBP', quality=88, method=6)
    x.resize((640, 360), Image.LANCZOS).save(p[:-4] + '-thumb.webp', 'WEBP', quality=82, method=6)
`]);
let appHtml = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
for (const f of ['guide-1.png', 'guide-2.png', 'guide.jpg']) {
  const v = crypto.createHash('sha1').update(fs.readFileSync(path.join(OUT, f))).digest('hex').slice(0, 10);
  const stem = f.replace(/\.\w+$/, '').replace(/[-.]/g, '\\$&');
  appHtml = appHtml.replace(new RegExp(`(img/wl3/${stem}(?:-thumb\\.webp|\\.webp|\\.png|\\.jpg)\\?v=)\\w+`, 'g'), '$1' + v);
  console.log(`img/wl3/${f}：${(fs.statSync(path.join(OUT, f)).size / 1048576).toFixed(2)} MB（v=${v}）`);
}
fs.writeFileSync(path.join(ROOT, 'app.html'), appHtml);
