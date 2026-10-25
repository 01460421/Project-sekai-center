// 豆森生日派對（慶典之花）一圖流詳細攻略：上下兩張 16:9 圖（img/bdayparty/guide-1.png、guide-2.png，1920×1080 版面輸出 3840×2160）與頁面縮圖，並更新 app.html 的 ?v=。
//   上篇：活動流程、名詞、逐日時程、機制與露水來源、加成卡、最佳採集策略
//   下篇：情形對照表、目標規劃、生日家具要喝幾罐、累計獎勵、經驗值換算、常見 Q&A
// 數字全部從 data/bday-party.js（master）與 js/app.js 的社群實測常數算，跟頁面一致；遊戲畫面取自遊戲內的生日派對說明投影片（素材庫）。
// 本機：node tools/build-bday-guide.mjs（需要 playwright 或 playwright-core + Chromium；CHROME 可指定執行檔；去背與縮圖要 python3 + Pillow + numpy）
// TEXT_OUT=檔名 另外輸出同內容的純文字版。版面固定 16:9，哪一欄塞不下會報錯（LOOSE=1 只警告）。規則或獎勵改了就重跑一次。
// 圖上不用 emoji 與會被手機換成 emoji 的符號（▶ ★ ✓ 之類），箭頭一律用 SVG。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch (e) { pw = require('playwright-core'); }
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'img', 'bdayparty');
const AS = 'https://storage.sekai.best/sekai-jp-assets';
const { BDAY: B } = await import(path.join(ROOT, 'data', 'bday-party.js'));
const { FIXTURES } = await import(path.join(ROOT, 'data', 'fixtures-index.js'));
const cardsSrc = fs.readFileSync(path.join(ROOT, 'data', 'cards-index.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

/* 頁面上的常數（社群實測與卡片等級表）照 js/app.js 抓，兩邊不會各說各話 */
const num = re => { const m = appSrc.match(re); if (!m) throw new Error('js/app.js 找不到 ' + re); return m; };
const [, spN, spDew, spLb] = num(/BP_SPROUT = \{ n: (\d+), dew: (\d+), lb: ([\d.]+) \}/).map(Number);
const BP_PT = +num(/BP_PT = (\d+);/)[1], NAT = +num(/BP_NAT_LB = (\d+);/)[1];
const CARD_EXP = JSON.parse(num(/BP_CARD_EXP = (\[[\d, ]+\])/)[1]);
const AREAS = JSON.parse(num(/BP_AREAS = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
const perLb = spDew / spLb, roundDew = spN * spDew, roundLb = spN * spLb;

/* 範例場次：現在或下一場（台服）；日期、家具、加成卡、露水與花的圖都用這一場 */
const now = Date.now(), P = B.parties;
const ex = P.find(x => x[2] <= now && now <= x[4]) || P.find(x => x[2] > now) || P[P.length - 1];
const [pid, cid, st, bd, en, dewId, flId, per, bonus, totals] = ex;
const N = B.names, nm = k => N[k] || ['', '', 0];
const img = k => nm(k)[1] ? AS + '/' + nm(k)[1] : '';
const card = id => { const m = cardsSrc.match(new RegExp('\\[' + id + ',\\d+,\\d+,\\d+,\\d+,-?\\d+,\\d+,"([^"]*)","([^"]+)"')); return m ? { name: m[1], abn: m[2] } : { name: '#' + id, abn: '' }; };
const bcards = bonus.map(([id, rate]) => ({ id, rate, ...card(id) }));
const abn = (bcards.find(c => c.rate >= 50) || bcards[0]).abn;
const fx = FIXTURES.filter(r => r[13] === pid).map(r => ({ name: r[1].replace(/（[^）]*）$/, ''), img: AS + '/mysekai/thumbnail/fixture/' + r[6] + '_1.webp',
  cost: ((r[10] || []).find(m => m[0] === flId) || [0, 0])[1] })).sort((a, b) => a.cost - b.cost);
const fxAll = fx.reduce((a, x) => a + x.cost, 0), maxReq = totals[totals.length - 1][0];

/* 累計獎勵與 LIVE BONUS 換算（大罐＝扣掉收集期自然回復與該朵數前領到的獎勵小罐後，還要喝的 LIVE BONUS 飲料（大）） */
const rewLb = n => totals.filter(([r]) => r <= n).reduce((a, [, bx]) => a + (B.boxes[bx] || []).filter(x => x[0] === 'boost_item').reduce((b, [, i, q]) => b + q * (nm('boost_item:' + i)[2] || 1), 0), 0);
const cost = (bon, n) => { const d = Math.ceil(n * per / (BP_PT * (100 + bon) / 100)), lb = Math.ceil(d / perLb); return { d, lb, can: Math.ceil(Math.max(0, lb - NAT - rewLb(n)) / 10), rounds: d / roundDew }; };
const natFl = bon => Math.floor(NAT * perLb * (100 + bon) / per);
const sum = {};
totals.forEach(([, bx]) => (B.boxes[bx] || []).forEach(([t, i, q]) => { const k = t + ':' + i; sum[k] = (sum[k] || 0) + q; }));
const tot = t => Object.keys(sum).filter(k => k.startsWith(t + ':'));
const expN = tot('practice_ticket').reduce((a, k) => a + sum[k] * nm(k)[2], 0), tkN = tot('practice_ticket').reduce((a, k) => a + sum[k], 0);
const tkExp = nm(tot('practice_ticket')[0] || '')[2] || 10000;
const sklN = tot('skill_practice_ticket').reduce((a, k) => a + sum[k] * nm(k)[2], 0), sklTk = tot('skill_practice_ticket').reduce((a, k) => a + sum[k], 0);
const lvAt = e => { let lv = 1; CARD_EXP.forEach((v, i) => { if (v <= e) lv = i + 1; }); return lv; };
const honorAt = totals.filter(([, bx]) => (B.boxes[bx] || []).some(x => x[0] === 'honor')).map(([r, bx]) => [r, (B.boxes[bx].find(x => x[0] === 'honor') || [])[1]]);
const honorUp = honorAt.filter(([, h], i) => !i || h !== honorAt[i - 1][1]).map(x => x[0]);   // 稱號換成更高階的那幾階
const fmt = n => Number(n).toLocaleString('en-US');
const md = ms => { const d = new Date(ms + 8 * 3600000); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); };
const DAY = 86400000;
const who = nm('mysekai_material:' + flId)[0].replace(/的慶典之花$/, '');
const rwName = k => nm(k)[0].replace(new RegExp('^' + who + '的'), '角色的').replace(/^\S+記憶$/, '記憶（角色代表色）');
/* 收集期的雙葉：開始時長一輪，之後每天 05:00、17:00 各刷新一次（台服 UTC+8） */
let spawns = 1;
for (let t = st + 3600000; t < bd; t += 3600000) { const h = new Date(t + 8 * 3600000).getUTCHours(); if (h === 5 || h === 17) spawns++; }

/* 遊戲畫面：投影片原圖用 CSS 裁切（x0,y0,x1,y1 是原圖座標），寬度固定、高度照比例 */
const SL1 = [AS + '/mysekai/rule_slide/tutorial_birthday/mysekai_tutorial_birthday_01.png', 1224, 744];
const SL2 = [AS + '/mysekai/rule_slide/tutorial_birthday/mysekai_tutorial_birthday_02.png', 1224, 744];
const SLN = [AS + '/mysekai/birthday/honami_2026/birthday_rule_slide.png', 845, 428];
const shot = ([u, w, h], [x0, y0, x1, y1], W, cls = '') => { const s = W / (x1 - x0);
  return `<div class="shot ${cls}" style="width:${W}px;height:${Math.round((y1 - y0) * s)}px;background-image:url('${u}');background-size:${(w * s).toFixed(1)}px ${(h * s).toFixed(1)}px;background-position:${(-x0 * s).toFixed(1)}px ${(-y0 * s).toFixed(1)}px"></div>`; };
const local = f => 'data:image/webp;base64,' + fs.readFileSync(path.join(ROOT, f)).toString('base64');
const ic = (k, cls = 'ic') => `<img class="${cls}" src="${img(k)}" alt="">`;
const SPROUT = AS + '/mysekai/birthday/honami_2026/icon_refresh.png';
const can = c => c ? '大罐 ' + fmt(c) : '不用喝';


/* ===== 兩張共用的資料（圖與文字版都從這裡產） ===== */
const GLOSS_D = [
  [SPROUT, '雙葉', `活動限定採集點。豆森四個區域各 ${spN / 4} 株，一株 ${spLb} LIVE BONUS、約 ${spDew} 個露水。`],
  [img('material:' + dewId), '慶典露水', '每一場專用的道具，只能倒進這一場的庭園；截止後作廢。'],
  [img('mysekai_material:' + flId), '慶典之花', `每倒滿 ${fmt(per)} pt 開一朵；做生日家具的素材，也照朵數領累計獎勵。`],
  [SPROUT, '慶典的庭園', '倒露水的地方：區域移動畫面右上角的入口。開花時四區雙葉全部重生。'],
  [AS + '/thumbnail/chara/' + abn + '_normal.webp', '加成卡', '持有就有效（不用上場）：當年生日卡 +50%、往年每張 +15%。'],
  [AS + '/thumbnail/boost_item/boost_item2.webp', 'LIVE BONUS', '豆森採集也用它當體力。自然回復 30 分鐘 1、上限 10；大罐回 10、小罐回 1。'],
];
const DAYS_D = [
  [bd - 4 * DAY, '生日前 4 天', '卡池開始', '要抽當年生日卡的話今天抽。還不能收集，先把 LIVE BONUS 存滿 10。'],
  [st, '生日前 3 天', '收集第 1 天', '00:00 雙葉長出來：拔完 28 株 → 庭園倒到剛好開下一朵 → 雙葉重生 → 再拔。05:00、17:00 刷新前先拔完。'],
  [st + DAY, '生日前 2 天', '收集第 2 天', '同上。每 5 小時上線把自然回復用掉；要喝罐的話照目標平均分三天喝。'],
  [st + 2 * DAY, '生日前 1 天', '收集最後一天', '23:59 收集截止：LIVE BONUS 在這之前花在雙葉上，之後拔不到也不掉露水。'],
  [bd, '生日當天', '派對開始', '剩下的露水全部倒完、領累計獎勵、做生日家具，擺上蛋糕開派對。'],
  [bd + DAY, '生日後 1 天', '做家具', '還沒做的家具在這兩天做完；露水不會再增加。'],
  [en, '生日後 2 天', '全部截止', '23:59 截止：沒倒的露水作廢，也不能再做這一場的家具。'],
];
const SRC_D = [
  [SPROUT, '雙葉', `約 ${perLb.toFixed(1)}`, `一株 ${spLb} LB → 約 ${spDew} 個；倒滿 ${fmt(per)} pt 與每天 05:00／17:00 重生。最划算。`],
  [AS + '/mysekai/thumbnail/material/item_wood_1.webp', '一般採集', '約 8', '樹、礦石，看運氣；拔完雙葉後不建議花 LIVE BONUS 在這裡。'],
  [AS + '/thumbnail/boost_item/boost_item1.webp', 'LIVE', '約 5', '不用 LIVE BONUS 打一場也有 1 個；效率最低。'],
  [AS + '/thumbnail/gacha_ticket/mission_gacha_ticket.webp', '卡池兌換所', '—', '招募點數一次 150 個、最多 200 次；點數要換卡就別換。'],
];
const RULES_D = [
  ['先抽卡再倒', '加成看「倒進去那一刻」持有的卡；當年生日卡池生日前 4 天就開。'],
  ['LIVE BONUS 只花在雙葉', `雙葉 1 LB ≈ ${perLb.toFixed(1)} 個露水；一般採集約 8 個、打 LIVE 約 5 個。`],
  ['不要一次倒完', '重生不會累積，一次倒完只換一輪；每次只倒到下一朵，多的存著。'],
  ['第一天就拔', '沒拔的不會累積、露水不會貶值；05:00／17:00 刷新前拔完。'],
  ['生日前一天 23:59 收手', '收集期過了就拔不到；生日當天起把剩下的露水倒完、做家具。'],
];
const STEPS_D = [
  [SPROUT, '把四個區域的雙葉全部拔完', `${spN} 株、${roundLb} LIVE BONUS、約 ${fmt(roundDew)} 個露水。`],
  [img('material:' + dewId), '區域移動畫面右上角進「慶典的庭園」', '露水在這裡倒，進度條滿一朵就開花。'],
  [img('mysekai_material:' + flId), '只倒到剛好開下一朵', `沒加成 ${Math.ceil(per / BP_PT)} 個、當年卡 ${Math.ceil(per / (BP_PT * 1.5))} 個、台服全收 ${Math.ceil(per / (BP_PT * 2.1))} 個；多的先存著。`],
  [SPROUT, '開花的瞬間，四區雙葉全部重生', '重生不會累積：一次開 10 朵也只重生一輪。'],
  [AS + '/thumbnail/boost_item/boost_item2.webp', '回豆森再拔，重複到 LIVE BONUS 用完', '用完就等自然回復（5 小時回滿 10），或照目標喝罐。'],
];
const BON = [[0, '沒有加成卡'], [15, '往年生日卡 1 張'], [50, '當年生日卡'], [65, '當年＋往年 1 張'], [110, '台服全收・當年＋往年 4 張'], [125, '日服 2026 全收・當年＋往年 5 張']];
const GOALS = [[3, '蛋糕（可以開派對）'], [13, '＋花束'], [33, '＋氣球'], [45, '稱號第 2 階'], [83, '＋掛旗'], [165, '稱號第 3 階'], [fxAll, '全部生日家具'], [maxReq, '稱號最高階・獎勵全拿']]
  .filter(([n], i, a) => a.findIndex(x => x[0] === n) === i);
const bigTiers = totals.filter(([, bx]) => (B.boxes[bx] || []).some(x => x[0] === 'honor'));
const honorStep = r => { const i = honorAt.findIndex(x => x[0] === r), h = honorAt[i][1], lv = honorUp.filter(u => u <= r).length;
  return honorAt.filter(x => x[1] === h)[0][0] === r ? `第 ${lv} 階` : `第 ${lv} 階升級`; };
const smallN = totals.length - bigTiers.length;
const smallQ = [...new Set(totals.filter(t => !bigTiers.includes(t)).flatMap(([, bx]) => (B.boxes[bx] || []).map(x => x[2])))].join('／');
const RAR = [['一星', 1, 20, ''], ['二星', 1, 30, ''], ['三星', 1, 40, '特訓前滿級'], ['三星特訓後', 40, 50, ''], ['四星', 1, 50, '特訓前滿級'], ['四星特訓後', 50, 60, ''], ['生日卡', 1, 60, '']];
const SKL = [['一星', 5], ['二星', 25], ['三星', 250], ['四星', 10000], ['生日卡', 5000]];
const REW_KEYS = ['boost_item:1', ...tot('practice_ticket'), ...tot('skill_practice_ticket'), ...tot('gacha_ticket'), ...tot('material'), ...tot('mysekai_item'), ...tot('mysekai_material')];
const REW_SUB = k => k.startsWith('boost_item') ? '小罐 1 LB' : k.startsWith('practice_ticket') ? fmt(nm(k)[2]) + ' EXP／張' : k.startsWith('skill_practice_ticket') ? nm(k)[2] + ' 技能 EXP／張' : '';
const QA_TXT = [
  ['可以一次把露水倒完嗎？', `不要。每倒滿 ${fmt(per)} pt 雙葉才重生一輪，重生<b>不會累積</b>，一次倒完只換到一輪。拔完一輪 → 只倒到下一朵 → 再拔。`],
  ['第一天拔，還是最後一天拔？', '<b>第一天就拔</b>。沒拔的雙葉不會累積、露水也不會貶值；真正的上限是 LIVE BONUS，拖到最後只會浪費自然回復與刷新。'],
  ['值得拿滿 400 朵嗎？', `推角才拿滿（最高階稱號在 ${maxReq} 朵）；其他角色做完想要的家具就好：蛋糕 3 朵就能開派對。`],
  ['剩下的露水怎麼辦？', '只能用在這一場，生日後 2 天 23:59 截止後作廢；生日當天起記得全部倒完。'],
  ['卡池點數換露水划算嗎？', '一次 150 個、最多 200 次；點數要換卡就別換，有剩又差一點露水才換。'],
  ['錯過收集期還能補嗎？', '不行。生日前 1 天 23:59 之後雙葉消失、也不掉露水；只能把手上的露水倒完。'],
];
const natNote = `只靠刷新、不倒露水：收集期只長 ${spawns} 輪（開始＋每天 05:00、17:00），最多 ${spawns * spN} 株、約 ${fmt(spawns * roundDew)} 個露水（沒加成約 ${Math.floor(spawns * roundDew * BP_PT / per)} 朵）。想要更多就靠「倒滿一朵 → 雙葉重生」。`;
const whyNote = '為什麼不要一次倒完？手上有 3,000 個露水（沒加成＝30 朵）時，<b>一次倒完</b>只觸發一次重生；<b>拔一輪、倒一朵</b>則每一朵都換到一輪雙葉，LIVE BONUS 夠就能一直拔。';

/* ===== 16:9 版面（1920×1080，輸出 2 倍＝3840×2160）：上方標題列、中間四欄、底下一行出處 ===== */
const sec = (no, title, sub, body, cls = '') => `<div class="sec ${cls}"><div class="sh"><span class="no">${no}</span><h2>${title}</h2>${sub ? `<em>${sub}</em>` : ''}</div>${body}</div>`;
const ctab = c => c ? `<em>大罐 ${fmt(c)}</em>` : '<em class="ok">不用喝</em>';

const FLOW = [[SL1, [42, 345, 312, 544], '拔雙葉收集露水', `豆森四區各 ${spN / 4} 株雙葉，一株 <b>${spLb} LIVE BONUS → 約 ${spDew} 個露水</b>。打 LIVE、一般採集也會掉，但效率低。`],
  [SL1, [402, 345, 668, 544], '到慶典的庭園澆灌', `每個露水 <b>${BP_PT} pt</b>（加成卡再加），每滿 <b>${fmt(per)} pt 開一朵</b>，四區雙葉同時重生。`],
  [SL1, [733, 318, 1176, 571], '做家具開派對', '用慶典之花做<b>生日家具</b>；生日當天起擺上蛋糕開派對，朵數也換<b>稱號與獎勵</b>。']]
  .map(([s, box, k, d], i) => `<div class="fr">${shot(s, box, 150)}<div><h3><i>${i + 1}</i>${k}</h3><p>${d}</p></div></div>`).join('');
const C1a = sec('01', '活動流程', '圖為遊戲畫面', FLOW
  + `<div class="key"><img src="${SPROUT}" alt=""><div>關鍵：每倒滿 <b>${fmt(per)} pt</b>，四區雙葉<b>全部重生</b>，回去再拔一輪。</div></div>`);
const C1b = sec('', '名詞先看懂', '', `<div class="gls">${GLOSS_D.map(([u, k, d]) => `<div class="gl"><img src="${u}" alt=""><div><b>${k}</b><span>${d}</span></div></div>`).join('')}</div>`, 'plain');
const C2a = sec('02', '逐日時程', `例：${who} ${md(bd)} 生日`, `<table><thead><tr><th>日期</th><th>階段</th><th>該做的事</th></tr></thead><tbody>`
  + DAYS_D.map(([t, d, k, x], i) => `<tr class="${i >= 1 && i <= 3 ? 'hot' : ''}"><td><b>${md(t)}</b><span class="dd">${d}</span></td><td class="l nw"><b class="pk">${k}</b></td><td class="l">${x}</td></tr>`).join('')
  + `</tbody></table><div class="note">台服時間（UTC+8）；日服同一時刻是 UTC+9。粉色列是能拔雙葉的收集期。</div>`);
const C2b = sec('04', '加成卡', `例：${who}這一場 ${bcards.length} 張`,
  `<div class="bcs">${bcards.map(c => `<div class="bc${c.rate >= 50 ? ' new' : ''}"><img src="${AS}/thumbnail/chara/${c.abn}_normal.webp" alt=""><b>+${c.rate}%</b><span>${c.rate >= 50 ? '當年' : '往年'}</span></div>`).join('')}</div>`
  + `<ul class="pts"><li><b>持有就算</b>，不用上場；送進控え室（倉庫）的不算。</li><li>當年 <b>+50%</b>、往年每張 <b>+15%</b>，可疊加：台服最高 <b>+110%</b>、日服 2026 起 <b>+125%</b>。</li><li>加成算在<b>倒進去那一刻</b>；每個露水 ＝ ${BP_PT} ×（1＋加成）pt。</li></ul>`
  + `<table class="mini"><thead><tr><th>加成</th>${[0, 15, 50, 65, 110, 125].map(b => `<th>+${b}%</th>`).join('')}</tr></thead><tbody>`
  + `<tr><td class="l">一朵要</td>${[0, 15, 50, 65, 110, 125].map(b => `<td><b>${Math.ceil(per / (BP_PT * (100 + b) / 100))}</b></td>`).join('')}</tr>`
  + `<tr><td class="l">一輪開</td>${[0, 15, 50, 65, 110, 125].map(b => `<td>${(Math.floor(roundDew * BP_PT * (100 + b) / 100 / per * 10) / 10)}</td>`).join('')}</tr></tbody></table>`);
const C3a = sec('03', '機制與露水來源', 'master＋社群實測',
  `<div class="stats">
    <div class="st"><img src="${SPROUT}" alt=""><div><span>雙葉一輪</span><b>${spN} 株</b><em>四區各 ${spN / 4} 株</em></div></div>
    <div class="st">${ic('material:' + dewId)}<div><span>一輪拔完</span><b>${fmt(roundDew)}</b><em>露水，花 ${roundLb} LIVE BONUS</em></div></div>
    <div class="st">${ic('mysekai_material:' + flId)}<div><span>一朵慶典之花</span><b>${fmt(per)} pt</b><em>沒加成＝${fmt(per / BP_PT)} 個露水</em></div></div>
    <div class="st"><img src="${AS}/thumbnail/boost_item/boost_item1.webp" alt=""><div><span>LIVE BONUS 自然回復</span><b>30 分 1</b><em>上限 10；收集期最多約 ${NAT}</em></div></div>
    <div class="st"><img src="${AS}/thumbnail/boost_item/boost_item2.webp" alt=""><div><span>大罐一罐</span><b>10 LB</b><em>小罐 1；拿滿送 ${sum['boost_item:1']} 小罐</em></div></div>
    <div class="st"><img src="${SPROUT}" alt=""><div><span>雙葉重生</span><b>2 種</b><em>倒滿 ${fmt(per)} pt／05:00、17:00</em></div></div>
  </div>
  <div class="areas">${[5, 6, 7, 8].map((s, i) => `<div class="ar"><img src="${local('img/mysekai/site-' + s + '.webp')}" alt=""><span>${AREAS[i]}<b>×${spN / 4}</b></span></div>`).join('')}</div>
  <table><thead><tr><th>來源</th><th>每 1 LB</th><th>說明</th></tr></thead><tbody>${SRC_D.map(([u, k, v, d], i) => `<tr class="${i ? '' : 'hot'}"><td class="l nw"><img class="ti" src="${u}" alt="">${k}</td><td><b>${v}</b></td><td class="l">${d}</td></tr>`).join('')}</tbody></table>
  <div class="callout">${natNote.replace(/(\d+ 輪|約 [\d,]+ 個露水)/g, '<b>$1</b>')}</div>`);
const C3b = `<div class="scr">${shot(SLN, [506, 160, 804, 329], 460)}<span>生日當天的派對（遊戲畫面）</span></div>`;
const C4a = sec('05', '最佳採集策略', '怎麼拔才不虧',
  `<div class="loopw"><div class="loop">
      <svg viewBox="0 0 340 340"><defs><marker id="m" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#ff4f93"/></marker></defs>
        <circle cx="170" cy="190" r="110" fill="none" stroke="#ffe3ef" stroke-width="18"/>
        <path d="M225 94.7A110 110 0 0 1 280 190" fill="none" stroke="#ff4f93" stroke-width="5" stroke-linecap="round" marker-end="url(#m)"/>
        <path d="M225 285.3A110 110 0 0 1 115 285.3" fill="none" stroke="#ff4f93" stroke-width="5" stroke-linecap="round" marker-end="url(#m)"/>
        <path d="M60 190A110 110 0 0 1 115 94.7" fill="none" stroke="#ff4f93" stroke-width="5" stroke-linecap="round" marker-end="url(#m)"/></svg>
      <img class="lni" style="left:138px;top:48px" src="${SPROUT}" alt="">
      <img class="lni" style="left:233px;top:213px" src="${img('material:' + dewId)}" alt="">
      <img class="lni" style="left:43px;top:213px" src="${img('mysekai_material:' + flId)}" alt="">
      <div class="ln" style="left:95px;top:0">拔完 ${spN} 株<em>${roundLb} LB・${fmt(roundDew)} 露水</em></div>
      <div class="ln" style="left:190px;top:281px">只倒到下一朵<em>剛好滿 ${fmt(per)} pt</em></div>
      <div class="ln" style="left:0;top:281px">雙葉全部重生<em>回去再拔一輪</em></div>
      <div class="lc">重複到<br>LIVE BONUS<br>用完</div>
    </div>
    <div class="rules">${RULES_D.map(([k, d], i) => `<div class="ru"><i>${i + 1}</i><div><b>${k}</b><span>${d}</span></div></div>`).join('')}</div></div>
  <div class="sub">一輪的實際操作</div>
  <div class="sps">${STEPS_D.map(([u, k, d], i) => `<div class="sp"><i>${i + 1}</i><img src="${u}" alt=""><div><b>${k}</b><span>${d}</span></div></div>`).join('')}</div>
  <div class="callout">${whyNote}</div>`);

const D1 = sec('06', '情形對照表', `全用雙葉；大罐＝扣掉自然回復 ${NAT} 與獎勵小罐後還要喝的`,
  `<table class="one"><thead><tr><th>加成</th><th>情形</th><th>一朵要露水</th><th>不喝罐能開</th><th>只做蛋糕 3 朵</th><th>做齊家具 ${fxAll} 朵<br>LB／大罐</th><th>拿滿 ${maxReq} 朵<br>LB／大罐</th><th>拿滿要拔</th></tr></thead><tbody>`
  + BON.map(([bon, n]) => { const pt = BP_PT * (100 + bon) / 100, c3 = cost(bon, 3), cf = cost(bon, fxAll), cm = cost(bon, maxReq);
    return `<tr class="${bon === 50 ? 'hot' : ''}"><td><b class="bon">+${bon}%</b></td><td class="l">${n}${bon === 50 ? '<i class="tag">至少抽這張</i>' : ''}</td><td>${fmt(Math.ceil(per / pt))}</td><td>${natFl(bon)} 朵</td><td>${c3.lb} LB</td>`
      + `<td><b>${fmt(cf.lb)}</b>${ctab(cf.can)}</td><td><b>${fmt(cm.lb)}</b>${ctab(cm.can)}</td><td>${Math.ceil(cm.rounds)} 輪</td></tr>`; }).join('')
  + `</tbody></table><div class="note">做齊家具前會領到 ${rewLb(fxAll)} 小罐、拿滿前 ${rewLb(maxReq)} 小罐；自然回復以每 5 小時上線一次計。一輪＝${spN} 株、${roundLb} LB。雙葉露水量取社群實測（一株約 ${spDew} 個），會有小誤差。</div>`);
const D2 = sec('07', '目標規劃表', '想拿到哪裡、要準備多少',
  `<table class="one"><thead><tr><th>朵數</th><th>目標</th><th>沒有加成卡<br>LB／大罐</th><th>當年生日卡 +50%<br>LB／大罐</th><th>台服全收 +110%<br>LB／大罐</th><th>+50% 收集期<br>每天喝</th></tr></thead><tbody>`
  + GOALS.map(([n, k]) => `<tr class="${n === fxAll ? 'hot' : ''}"><td><b class="pk">${n}</b></td><td class="l">${k}</td>`
    + [0, 50, 110].map(b => { const c = cost(b, n); return `<td><b>${fmt(c.lb)}</b>${ctab(c.can)}</td>`; }).join('')
    + `<td>${(c => c ? '每天 ' + Math.ceil(c / 3) + ' 罐' : '不用喝')(cost(50, n).can)}</td></tr>`).join('')
  + '</tbody></table>');
let cum = 0;
const D3 = sec('08', '生日家具要幾罐', `${fx.length} 件共 ${fxAll} 朵`,
  `<div class="fxrow">${fx.map(x => `<div class="fxi"><img src="${x.img}" alt=""><span>${x.name.replace(/^生日/, '')}</span><b>${x.cost}</b></div>`).join('')}</div>
  <table><thead><tr><th>家具</th><th>累計</th><th>沒加成</th><th>+50%</th><th>+110%</th></tr></thead><tbody>`
  + fx.map(x => { cum += x.cost; return `<tr><td class="l nw">${x.name.replace(/^生日/, '')} <b class="pk">${x.cost}</b></td><td>${cum}</td>` + [0, 50, 110].map(b => { const v = cost(b, cum); return `<td><b>${fmt(v.lb)}</b>${ctab(v.can)}</td>`; }).join('') + '</tr>'; }).join('')
  + `</tbody></table><div class="big"><img src="${AS}/thumbnail/boost_item/boost_item2.webp" alt=""><div><b>做齊 ≈ 大罐 ${cost(0, fxAll).can}／${cost(50, fxAll).can}／${cost(110, fxAll).can}</b><span>沒加成／當年卡／台服全收；只做蛋糕不用喝</span></div></div>`);
const D4 = sec('10', '經驗值換算', `練習譜 ${tkN} 張＝${fmt(expN)} EXP`,
  `<table><thead><tr><th>卡片</th><th>等級</th><th>要的 EXP</th><th>中級譜</th><th>夠嗎</th></tr></thead><tbody>`
  + RAR.map(([k, a, b, note]) => { const need = CARD_EXP[b - 1] - CARD_EXP[a - 1], ok = expN >= need;
    return `<tr><td class="l nw">${k}</td><td class="nw">${a} → ${b}${note ? `<em>${note}</em>` : ''}</td><td><b>${fmt(need)}</b></td><td>${Math.ceil(need / tkExp)}</td><td><span class="${ok ? 'yes' : 'no'}">${ok ? '夠' : '到 Lv' + lvAt(CARD_EXP[a - 1] + expN)}</span></td></tr>`; }).join('')
  + `</tbody></table><div class="callout">技能升級譜 ${sklTk} 張＝${fmt(sklN)} 技能 EXP：剛好把<b>一張三星技能 Lv1 → 4</b>；四星要 10,000、生日卡 5,000，連 Lv2 都不夠。練習譜可把<b>三星練到 40</b>，四星／生日卡練到 <b>Lv${lvAt(expN)}</b>。</div>`);
const D5 = sec('09', '累計獎勵', `2～${maxReq} 朵共 ${totals.length} 階`,
  `<div class="rws">${REW_KEYS.map(k => `<div class="rw"><img src="${img(k)}" alt=""><div><span>${rwName(k)}</span><b>×${fmt(sum[k])}</b>${REW_SUB(k) ? `<em>${REW_SUB(k)}</em>` : ''}</div></div>`).join('')}
    <div class="rw"><div class="hb">${shot(SL2, [24, 371, 256, 427], 70)}</div><div><span>生日稱號</span><b>${honorUp.length} 階</b></div></div></div>
  <table class="tiers"><thead><tr><th>朵數</th><th>稱號</th><th>其他獎勵</th></tr></thead><tbody>`
  + bigTiers.map(([r, bx]) => `<tr class="${honorUp.includes(r) ? 'hot' : ''}"><td><b class="pk">${r}</b></td><td class="l nw">${honorStep(r)}</td><td class="l"><div class="chips">`
    + (B.boxes[bx] || []).filter(x => x[0] !== 'honor').map(([t, i, q]) => `<span class="chip"><img src="${img(t + ':' + i)}" alt="">×${q}</span>`).join('') + '</div></td></tr>').join('')
  + `</tbody></table><div class="note">其餘 ${smallN} 階每階送心願碎片 ×${smallQ}（一般與角色的交替）。粉色列換成更高階的稱號。</div>`
  + `<div class="sub">稱號隨朵數升級（遊戲畫面）</div>${shot(SL2, [18, 345, 965, 535], 434, 'wide')}`);
const D6 = sec('11', '常見 Q&amp;A', '', `<div class="qas qas2">${QA_TXT.map(([q, a]) => `<div class="qa"><b>Q</b><div><h4>${q}</h4><p>${a}</p></div></div>`).join('')}</div>`);

const CSS = `
:root{--pk:#ff4f93;--pk2:#ffd6e7;--lv:#8a72ff;--mt:#2fbfa8;--ink:#2a2140;--sub:#665d80;--line:#efdbe8}
*{box-sizing:border-box;margin:0;padding:0}
body{width:1920px;height:1080px;font-family:'Noto Sans TC','Noto Sans CJK TC','Microsoft JhengHei',sans-serif;color:var(--ink);background:#fff}
#poster{width:1920px;height:1080px;overflow:hidden;display:grid;grid-template-rows:120px minmax(0,1fr) 30px;background:radial-gradient(circle at 1px 1px,rgba(255,79,147,.10) 1.5px,transparent 0) 0 0/20px 20px,linear-gradient(160deg,#ffe4f0 0%,#f4eaff 40%,#e8f4ff 75%,#fff0f7 100%)}
.bon,b.pk{font-family:'M PLUS Rounded 1c',sans-serif}
.top{position:relative;overflow:hidden;background:linear-gradient(90deg,#ff4f93 0%,#ff5c9c 45%,#ff7fb0 100%)}
.top .art{position:absolute;right:0;top:0;bottom:0;width:980px;background:url('${AS}/character/member/${abn}/card_normal.webp') center 26%/cover;-webkit-mask-image:linear-gradient(90deg,transparent 0%,#000 40%);mask-image:linear-gradient(90deg,transparent 0%,#000 40%)}
.top .gar{position:absolute;right:300px;top:-26px;width:300px;filter:drop-shadow(0 3px 8px rgba(0,0,0,.15))}
.top .tt{position:absolute;left:30px;top:16px;color:#fff}
.top h1{font-size:46px;font-weight:900;letter-spacing:1px;line-height:1.1;text-shadow:0 3px 0 rgba(197,32,98,.5),0 8px 20px rgba(120,0,50,.3)}
.top h1 small{font-size:30px;margin-left:12px}
.top .ln2{display:flex;align-items:center;gap:10px;margin-top:8px;font-size:17px;font-weight:700}
.top .pill{padding:3px 14px;border-radius:999px;background:#fff;color:var(--pk);font-weight:900;font-size:17px}
.top .ln2 img{width:30px;height:30px}
.top .brand{position:absolute;right:22px;bottom:12px;padding:5px 14px;border-radius:999px;background:rgba(255,255,255,.92);font-weight:900;font-size:15px;color:var(--pk)}
.body{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;padding:12px 18px;min-height:0}
.col{display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden}
.span2{grid-column:span 2}
.foot{display:flex;align-items:center;gap:10px;padding:0 20px;background:#2a2140;color:#fff;font-size:12.5px}
.foot b{color:#ffd6e7;font-size:13.5px}
.foot .pg{margin-left:auto;font-family:'M PLUS Rounded 1c';font-weight:800;color:#ffd6e7}
.sec{background:rgba(255,255,255,.92);border-radius:18px;padding:9px 12px 10px;box-shadow:0 6px 18px rgba(138,114,255,.10);border:1px solid rgba(255,255,255,.8)}
.sec.plain{padding-top:8px}
.sh{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.sh .no{font-family:'M PLUS Rounded 1c';font-weight:800;font-size:14px;color:#fff;background:linear-gradient(135deg,var(--pk),var(--lv));border-radius:9px;padding:2px 8px}
.sh .no:empty{display:none}
.sh h2{font-size:21px;font-weight:900}
.sh em{margin-left:auto;font-style:normal;font-size:12px;color:var(--sub);font-weight:700;text-align:right}
.sub{font-size:14.5px;font-weight:900;margin:8px 0 5px;display:flex;align-items:center;gap:6px}
.sub::before{content:'';width:4px;height:15px;border-radius:2px;background:linear-gradient(180deg,var(--pk),var(--lv))}
.shot{border-radius:10px;box-shadow:0 3px 8px rgba(0,0,0,.12);flex:none}
.fr{display:flex;gap:10px;align-items:center;padding:6px;border-radius:14px;background:#fff;border:1.5px solid var(--line);margin-bottom:6px}
.fr h3{font-size:16px;font-weight:900;display:flex;align-items:center;gap:6px;margin-bottom:2px}
.fr h3 i{font-style:normal;font-family:'M PLUS Rounded 1c';width:22px;height:22px;border-radius:50%;background:var(--pk);color:#fff;display:grid;place-items:center;font-size:13px;flex:none}
.fr p{font-size:12.5px;line-height:1.5;color:var(--sub)} .fr p b{color:var(--ink)}
.key{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:12px;background:linear-gradient(90deg,#fff0f6,#f1edff);font-size:13.5px;font-weight:700;line-height:1.45}
.key img{width:34px;height:34px}
.key b{color:var(--pk)}
.gls{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.gl{display:flex;gap:6px;align-items:flex-start;padding:6px;border-radius:12px;background:#fff;border:1.5px solid var(--line)}
.gl img{width:32px;height:32px;flex:none;object-fit:contain;border-radius:7px}
.gl b{display:block;font-size:14px;font-weight:900;color:var(--pk)}
.gl span{font-size:11.5px;line-height:1.45;color:var(--sub);display:block}
table{width:100%;border-collapse:separate;border-spacing:0;border-radius:12px;overflow:hidden;border:1.5px solid var(--line);background:#fff}
th{background:linear-gradient(90deg,#ffe0ee,#ece6ff);font-size:11.5px;font-weight:900;padding:5px 4px;text-align:center;line-height:1.25}
td{padding:4px 5px;border-top:1px solid var(--line);text-align:center;font-size:13px;font-family:'M PLUS Rounded 1c';font-weight:700;white-space:nowrap}
td.l{text-align:left;font-family:'Noto Sans TC';font-size:12px;font-weight:700;line-height:1.4;white-space:normal}
td.nw{white-space:nowrap}
td b{font-size:14.5px} td em{display:block;font-style:normal;font-size:11px;color:var(--pk);font-family:'Noto Sans TC';font-weight:900;line-height:1.2}
td em.ok{color:#16927f}
td .dd{display:block;font-family:'Noto Sans TC';font-size:10.5px;color:var(--sub)}
.bon{color:var(--lv);font-size:15px}
tr.hot td{background:#fff3f8}
.tag{font-style:normal;display:inline-block;margin-left:5px;padding:0 6px;border-radius:999px;background:var(--pk);color:#fff;font-size:10.5px;vertical-align:1px}
.note{margin-top:5px;font-size:11px;line-height:1.5;color:var(--sub)}
.ti{width:24px;height:24px;vertical-align:middle;margin-right:4px;object-fit:contain}
b.pk{color:var(--pk)}
.bcs{display:grid;grid-template-columns:repeat(${Math.max(5, bcards.length)},1fr);gap:6px}
.bc{display:flex;flex-direction:column;align-items:center;padding:5px 2px;border-radius:12px;background:#fff;border:1.5px solid var(--line)}
.bc.new{border-color:var(--pk);background:#fff3f8}
.bc img{width:62px;height:62px;border-radius:9px;box-shadow:0 2px 6px rgba(0,0,0,.15)}
.bc b{font-family:'M PLUS Rounded 1c';font-size:16px;color:var(--pk);line-height:1.2;margin-top:2px}
.bc span{font-size:11px;font-weight:900}
ul.pts{list-style:none;display:grid;gap:4px;margin:7px 0}
ul.pts li{position:relative;padding:4px 8px 4px 20px;border-radius:10px;background:#fff;border:1.5px solid var(--line);font-size:12px;line-height:1.45}
ul.pts li::before{content:'';position:absolute;left:8px;top:11px;width:6px;height:6px;border-radius:50%;background:var(--pk)}
ul.pts b{color:var(--pk)}
table.mini td,table.mini th{padding:3px 2px}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.st{display:flex;align-items:center;gap:7px;padding:6px 8px;border-radius:12px;background:#fff;border:1.5px solid var(--line)}
.st img{width:36px;height:36px;flex:none;object-fit:contain;border-radius:7px}
.st div{display:flex;flex-direction:column;min-width:0}
.st span{font-size:11px;font-weight:700;color:var(--sub)}
.st b{font-family:'M PLUS Rounded 1c';font-size:19px;line-height:1.15}
.st em{font-style:normal;font-size:10.5px;color:var(--sub);line-height:1.3}
.areas{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:7px 0}
.ar{position:relative;border-radius:10px;overflow:hidden;height:62px}
.ar img{width:100%;height:100%;object-fit:cover}
.ar span{position:absolute;left:0;right:0;bottom:0;padding:10px 6px 3px;background:linear-gradient(180deg,transparent,rgba(42,33,64,.85));color:#fff;font-weight:900;font-size:11px;display:flex;justify-content:space-between;align-items:flex-end}
.ar span b{font-family:'M PLUS Rounded 1c';font-size:13px;color:#ffd6e7}
.callout{margin-top:7px;padding:7px 10px;border-radius:12px;background:linear-gradient(90deg,#fff0f6,#f1edff);font-size:12.5px;line-height:1.55}
.callout b{color:var(--pk)}
.scr{position:relative}
.scr .shot{border-radius:16px}
.scr span{position:absolute;left:10px;bottom:8px;padding:2px 10px;border-radius:999px;background:rgba(42,33,64,.75);color:#fff;font-size:12px;font-weight:700}
.loopw{display:grid;grid-template-columns:190px 1fr;gap:8px;align-items:center}
.loop{position:relative;width:340px;height:340px;zoom:.56}
.lni{position:absolute;width:64px;height:64px;background:#fff;border-radius:50%;padding:6px;box-shadow:0 4px 12px rgba(255,79,147,.28);z-index:1}
.loop svg{position:absolute;inset:0}
.ln{position:absolute;width:150px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:2px;font-weight:900;font-size:19px;line-height:1.3}
.ln em{font-style:normal;font-weight:700;font-size:15px;color:var(--sub)}
.lc{position:absolute;left:170px;top:190px;transform:translate(-50%,-50%);text-align:center;font-weight:900;font-size:21px;color:var(--pk);line-height:1.3}
.rules{display:grid;gap:5px}
.ru,.sp{display:flex;gap:7px;align-items:flex-start;padding:5px 8px;border-radius:11px;background:#fff;border:1.5px solid var(--line)}
.ru i,.sp i{font-style:normal;font-family:'M PLUS Rounded 1c';font-weight:800;min-width:21px;height:21px;border-radius:7px;background:linear-gradient(135deg,var(--pk),var(--lv));color:#fff;display:grid;place-items:center;font-size:12.5px;margin-top:1px}
.ru b,.sp b{display:block;font-size:13.5px;font-weight:900;line-height:1.3}
.ru span,.sp span{font-size:11.5px;line-height:1.4;color:var(--sub);display:block}
.sps{display:grid;gap:5px}
.sp{align-items:center}
.sp img{width:30px;height:30px;object-fit:contain;flex:none}
.fxrow{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;margin-bottom:7px}
.fxi{display:flex;flex-direction:column;align-items:center;padding:4px 2px;border-radius:12px;background:#fff;border:1.5px solid var(--line)}
.fxi img{width:52px;height:52px;object-fit:contain}
.fxi span{font-weight:900;font-size:12px}
.fxi b{font-family:'M PLUS Rounded 1c';font-size:15px;color:var(--pk)}
.big{display:flex;align-items:center;gap:10px;margin-top:7px;padding:7px 12px;border-radius:14px;background:linear-gradient(90deg,#ff4f93,#8a72ff);color:#fff}
.big img{width:38px;height:38px;background:rgba(255,255,255,.9);border-radius:10px;padding:2px}
.big b{font-size:16px;font-weight:900;display:block}
.big span{font-size:12px;opacity:.95}
.rws{display:grid;grid-template-columns:repeat(2,1fr);gap:5px;margin-bottom:7px}
.rw{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:11px;background:#fff;border:1.5px solid var(--line)}
.rw img{width:32px;height:32px;flex:none}
.rw .hb{flex:none;width:70px}
.rw div{display:flex;flex-direction:column;min-width:0}
.rw span{font-size:11.5px;font-weight:700;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rw b{font-family:'M PLUS Rounded 1c';font-size:15px;line-height:1.15}
.rw em{font-style:normal;font-size:10.5px;color:var(--pk);font-weight:700}
.chips{display:flex;flex-wrap:wrap;gap:4px}
.chip{display:inline-flex;align-items:center;gap:1px;padding:1px 6px 1px 2px;border-radius:999px;background:#f6f1ff;font-family:'M PLUS Rounded 1c';font-size:12px;font-weight:800;color:var(--pk)}
.chip img{width:20px;height:20px}
table.tiers td{padding:2px 5px}
.yes,.no{display:inline-block;padding:0 8px;border-radius:999px;font-family:'Noto Sans TC';font-weight:900;font-size:11.5px}
.yes{background:#dff7f1;color:#16927f}.no{background:#ffe3ec;color:#d63a74}
.qas{display:grid;gap:5px}
.qas2{grid-template-columns:1fr 1fr}
table.one td em{display:inline;margin-left:5px}
table.one td{padding:3px 5px}
.shot.wide{border-radius:12px}
.qa{display:flex;gap:7px;padding:5px 8px;border-radius:11px;background:#fff;border:1.5px solid var(--line)}
.qa>b{font-family:'M PLUS Rounded 1c';font-weight:800;font-size:13px;color:#fff;background:var(--pk);border-radius:7px;min-width:21px;height:21px;display:grid;place-items:center;margin-top:1px}
.qa h4{font-size:13.5px;font-weight:900}
.qa p{font-size:11.5px;line-height:1.45;color:var(--sub)} .qa p b{color:var(--pk)}`;

const page16 = (part, pill, body) => `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><style>/*FONTS*/${CSS}</style></head><body><div id="poster">
<div class="top"><div class="art"></div><img class="gar" src="${AS}/mysekai/birthday/honami_2026/birthday_garland.png" alt="">
  <div class="tt"><h1>豆森生日派對<small>慶典之花 詳細攻略</small></h1>
    <div class="ln2"><span class="pill">${pill}</span>${ic('material:' + dewId, '')} 露水 → ${ic('mysekai_material:' + flId, '')} 慶典之花 → 生日家具・稱號・罐子・經驗值｜台服・日服通用</div></div>
  <div class="brand">Project SEKAI 資源中心・一圖流</div></div>
<div class="body">${body}</div>
<div class="foot"><b>project-sekai-center.com ・ 豆森生日派對頁</b><span>期間、加成、每朵 pt、累計獎勵、家具素材、雙葉消耗 ${spLb} LIVE BONUS 讀自遊戲 master；雙葉露水量為 Game8 社群實測。遊戲畫面與素材 © SEGA / © Colorful Palette / © Crypton Future Media</span><span class="pg">${part}</span></div>
</div></body></html>`;
const html1 = page16('上篇 1/2', '上篇｜機制・時程・採集策略',
  `<div class="col">${C1a}${C1b}</div><div class="col">${C2a}${C2b}</div><div class="col">${C3a}${C3b}</div><div class="col">${C4a}</div>`);
const html2 = page16('下篇 2/2', '下篇｜對照表・目標・家具・獎勵',
  `<div class="col span2">${D1}${D2}${D6}</div><div class="col">${D3}${D4}</div><div class="col">${D5}</div>`);
/* 圖與數字字型先用 curl 抓下來內嵌成 data URI：截圖時不靠瀏覽器連外網（代理、憑證、逾時都不必管），也確定每張圖都到齊才截。
   中文字用本機的 Noto Sans TC；數字的 M PLUS Rounded 1c 只抓 ASCII 子集（Google Fonts 的 text= 參數，一個檔幾 KB）。 */
const get = (url, ua) => execFileSync('curl', ['-sSfL', '-m', '90', ...(ua ? ['-A', ua] : []), url], { maxBuffer: 64 << 20 });
const MIME = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', woff2: 'font/woff2', ttf: 'font/ttf' };
const dataUri = (buf, ext) => 'data:' + (MIME[ext] || 'application/octet-stream') + ';base64,' + buf.toString('base64');
const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
const fontCss = get('https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@700;800&text=' + encodeURIComponent(ascii),
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36').toString()
  .replace(/url\((https:[^)]+)\)/g, (m, u) => 'url(' + dataUri(get(u), (u.match(/\.(\w+)$/) || [])[1] || 'woff2') + ')');
/* 道具／家具縮圖底下有一塊青色圓角底（#8FE9E9）：從四邊洪水填充拿掉跟邊緣相連的底色，邊緣半透明處把混進去的底色解回來 */
const UNMATTE = `
import sys
from collections import deque
import numpy as np
from PIL import Image
BG = np.array([143, 233, 233], float)
for src, dst in zip(sys.argv[1::2], sys.argv[2::2]):
    a = np.array(Image.open(src).convert('RGBA')).astype(float)
    h, w = a.shape[:2]
    diff = np.abs(a[:, :, :3] - BG).sum(axis=2)
    cand = (diff < 45) | (a[:, :, 3] < 16)
    bg = np.zeros((h, w), bool)
    q = deque([(y, x) for y in range(h) for x in (0, w - 1)] + [(y, x) for x in range(w) for y in (0, h - 1)])
    while q:
        y, x = q.popleft()
        if bg[y, x] or not cand[y, x]:
            continue
        bg[y, x] = True
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not bg[ny, nx]:
                q.append((ny, nx))
    ring, m = np.zeros((h, w), bool), bg.copy()
    for _ in range(2):
        g = m.copy()
        g[1:, :] |= m[:-1, :]; g[:-1, :] |= m[1:, :]; g[:, 1:] |= m[:, :-1]; g[:, :-1] |= m[:, 1:]
        ring |= g & ~m; m = g
    al = np.clip((diff - 45) / 110, 0, 1)
    k = ring & ~bg
    f = al[k][:, None]
    a[k, :3] = np.clip((a[k, :3] - (1 - f) * BG) / np.maximum(f, 0.05), 0, 255)
    a[k, 3] = a[k, 3] * al[k]
    a[bg, 3] = 0
    Image.fromarray(a.astype('uint8'), 'RGBA').save(dst)
`;
const pages = [html1, html2].map(h => h.replace('/*FONTS*/', fontCss));
const urls = [...new Set(pages.join('').match(/https:\/\/storage\.sekai\.best\/[^'")\s]+/g) || [])];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bday-guide-')), inl = {}, icons = [];
urls.forEach((u, i) => { const ext = u.split('.').pop(), buf = get(u);
  if (/\/thumbnail\/(?!chara\/)/.test(u)) { const src = path.join(tmp, i + '.' + ext); fs.writeFileSync(src, buf); icons.push([u, src, path.join(tmp, i + '.png')]); }
  else inl[u] = dataUri(buf, ext); });
if (icons.length) execFileSync('python3', ['-c', UNMATTE, ...icons.flatMap(x => [x[1], x[2]])]);
icons.forEach(([u, , dst]) => { inl[u] = dataUri(fs.readFileSync(dst), 'png'); });
fs.rmSync(tmp, { recursive: true, force: true });
const inline = h => urls.reduce((s, u) => s.split(u).join(inl[u]), h);

const launch = { headless: true, args: ['--no-sandbox'] };
if (process.env.CHROME) launch.executablePath = process.env.CHROME;
const browser = await pw.chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: +(process.env.DSF || 2) });
const bad = [];
page.on('requestfailed', r => bad.push(r.url().slice(0, 120)));
fs.mkdirSync(OUT, { recursive: true });
const outs = [];
for (const [i, h] of pages.entries()) {
  await page.setContent(inline(h), { waitUntil: 'networkidle', timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const broken = await page.evaluate(() => [...document.images].filter(x => !x.naturalWidth).length);
  if (bad.length || broken) { console.error('有圖沒載入（' + broken + ' 張）：\n' + bad.join('\n')); process.exit(1); }
  /* 16:9 是固定高度：哪一欄塞不下就報出來（差幾 px），不要默默被切掉 */
  const over = await page.evaluate(() => [...document.querySelectorAll('.col')].map((c, j) => [j + 1, c.scrollHeight - c.clientHeight]).filter(([, d]) => d > 0));
  if (over.length) { console.error(`第 ${i + 1} 張有欄位超出：` + over.map(([j, d]) => `第 ${j} 欄 +${d}px`).join('、')); if (!process.env.LOOSE) process.exit(1); }
  const png = path.join(OUT, `guide-${i + 1}.png`);
  await page.screenshot({ path: png, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  if (process.env.HTML_OUT) fs.writeFileSync(process.env.HTML_OUT.replace(/(\.\w+)?$/, `-${i + 1}$1`), h);
  outs.push(png);
}
await browser.close();

/* 純文字版（TEXT_OUT=檔名）：跟圖同一份資料，給 Discord／LINE／巴哈貼文；一樣不用 emoji */
if (process.env.TEXT_OUT) {
  const strip = h => h.replace(/<[^>]+>/g, '');
  const T = ['【豆森生日派對・慶典之花 詳細攻略（文字版）】', '露水 → 慶典之花 → 生日家具・稱號・罐子・經驗值｜台服・日服通用', '',
    '＝＝＝ 上篇｜機制與策略 ＝＝＝', '',
    '■ 01 活動流程',
    `1. 拔雙葉收集露水：豆森四個區域各 ${spN / 4} 株雙葉（共 ${spN} 株），一株 ${spLb} LIVE BONUS → 約 ${spDew} 個露水。打 LIVE、一般採集也會掉，但效率低。`,
    `2. 到慶典的庭園澆灌：每個露水 ${BP_PT} pt（持有加成卡再加），每滿 ${fmt(per)} pt 開一朵慶典之花，四區雙葉同時重生。`,
    '3. 做家具開派對：用慶典之花做生日家具；生日當天起擺上蛋糕開派對，朵數也換稱號與獎勵。',
    `重點：每倒滿 ${fmt(per)} pt，雙葉就全部重生 → 回去再拔一輪。`, '',
    '■ 名詞', ...GLOSS_D.map(([, k, d]) => `・${k}：${d}`), '',
    `■ 02 逐日時程（例：${who} ${md(bd)} 生日；台服時間）`, ...DAYS_D.map(([t, d, k, x]) => `・${md(t)}（${d}）${k}：${x}`), '',
    '■ 03 機制與露水來源',
    `・雙葉一輪 ${spN} 株＝約 ${fmt(roundDew)} 個露水、${roundLb} LIVE BONUS（1 LB ≈ ${perLb.toFixed(1)} 個）`,
    `・一朵慶典之花 ${fmt(per)} pt（沒加成＝${fmt(per / BP_PT)} 個露水）`,
    `・LIVE BONUS 自然回復 30 分鐘 1、上限 10；收集期 3 天最多約 ${NAT}。大罐回 10、小罐回 1；拿滿送 ${sum['boost_item:1']} 小罐`,
    ...SRC_D.map(([, k, v, d]) => `・${k}：每 1 LB ${v} 個；${d}`), '・' + natNote, '',
    '■ 04 加成卡',
    `・例：${who}這一場：` + bcards.map(c => `${c.name} +${c.rate}%`).join('、'),
    '・持有就算、不用上場；送進控え室的卡不算。當年 +50%、往年每張 +15%（台服最多 +110%、日服 2026 起 +125%）',
    `・加成算在倒進去那一刻；每個露水 pt ＝ ${BP_PT} ×（1 ＋ 加成）`,
    '・一朵要幾個露水：' + [0, 15, 50, 65, 110, 125].map(b => `+${b}% ${Math.ceil(per / (BP_PT * (100 + b) / 100))} 個`).join('、'), '',
    '■ 05 最佳採集策略', ...RULES_D.map(([k, d], i) => `${i + 1}. ${k}：${d}`),
    '一輪的實際操作：', ...STEPS_D.map(([, k, d], i) => `${i + 1}) ${k}：${d}`), strip(whyNote), '',
    '＝＝＝ 下篇｜數字與獎勵 ＝＝＝', '',
    `■ 06 情形對照表（全用雙葉；大罐＝扣掉自然回復 ${NAT} 與獎勵小罐後還要喝的）`,
    ...BON.map(([bon, n]) => { const pt = BP_PT * (100 + bon) / 100, c3 = cost(bon, 3), cf = cost(bon, fxAll), cm = cost(bon, maxReq);
      return `・+${bon}%（${n}）：一朵 ${fmt(Math.ceil(per / pt))} 個露水｜不喝罐能開 ${natFl(bon)} 朵｜只做蛋糕 ${c3.lb} LB｜做齊家具 ${fmt(cf.lb)} LB（${can(cf.can)}）｜拿滿 ${maxReq} 朵 ${fmt(cm.lb)} LB（${can(cm.can)}，拔 ${Math.ceil(cm.rounds)} 輪）`; }), '',
    '■ 07 目標規劃表（LB／大罐：沒有加成卡｜當年生日卡｜台服全收 +110%）',
    ...GOALS.map(([n, k]) => `・${n} 朵 ${k}：` + [0, 50, 110].map(b => { const c = cost(b, n); return `${fmt(c.lb)} LB／${can(c.can)}`; }).join('｜') + (cost(50, n).can ? `；+50% 每天喝 ${Math.ceil(cost(50, n).can / 3)} 罐` : '')), '',
    `■ 08 生日家具要幾罐（${fx.length} 件共 ${fxAll} 朵；LB／大罐：沒有加成卡｜當年生日卡｜台服全收 +110%）`,
    ...(() => { let c = 0; return fx.map(x => { c += x.cost; return `・${x.name} ${x.cost} 朵（累計 ${c}）：` + [0, 50, 110].map(b => { const v = cost(b, c); return `${fmt(v.lb)} LB／${can(v.can)}`; }).join('｜'); }); })(),
    `→ 做齊 ${fxAll} 朵約喝大罐 ${cost(0, fxAll).can}／${cost(50, fxAll).can}／${cost(110, fxAll).can} 罐；只做蛋糕開派對不用喝。`, '',
    `■ 09 累計獎勵（2～${maxReq} 朵共 ${totals.length} 階）`,
    '・拿滿總計：' + REW_KEYS.map(k => rwName(k) + ' ×' + fmt(sum[k])).join('、') + `、生日稱號 ${honorUp.length} 階`,
    ...bigTiers.map(([r, bx]) => `・${r} 朵（${honorStep(r)}）：` + (B.boxes[bx] || []).filter(x => x[0] !== 'honor').map(([t, i, q]) => `${rwName(t + ':' + i).replace(/（.*）$/, '')} ×${q}`).join('、')),
    `・其餘 ${smallN} 階每階送心願碎片 ×${smallQ}（一般與角色的交替）`, '',
    `■ 10 經驗值換算（練習譜 ${tkN} 張＝${fmt(expN)} EXP；技能升級譜 ${sklTk} 張＝${fmt(sklN)} 技能 EXP）`,
    ...RAR.map(([k, a, b]) => { const need = CARD_EXP[b - 1] - CARD_EXP[a - 1]; return `・${k} Lv${a} → ${b}：${fmt(need)} EXP（${Math.ceil(need / tkExp)} 張中級）${expN >= need ? '，夠' : `，不夠（到 Lv${lvAt(CARD_EXP[a - 1] + expN)}）`}`; }),
    '・技能 Lv1 → 4：' + SKL.map(([k, need]) => `${k} ${fmt(need)}${sklN >= need ? '（夠）' : '（不夠）'}`).join('、'), '',
    '■ 11 常見 Q&A', ...QA_TXT.flatMap(([q, a]) => ['Q：' + q, 'A：' + strip(a), '']),
    `（期間、加成、每朵 pt、累計獎勵、家具素材與雙葉消耗 ${spLb} LIVE BONUS 讀自遊戲 master；雙葉露水量取自 Game8 社群實測）`,
    '互動計算機：https://project-sekai-center.com/app.html?page=bdayparty'];
  fs.writeFileSync(process.env.TEXT_OUT, T.join('\n') + '\n');
}

/* 縮圖（頁面卡片用，480×270）＋把 app.html 的 ?v= 換成各張圖的雜湊；舊的單張版本一起清掉 */
let appHtml = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
for (const [i, png] of outs.entries()) {
  execFileSync('python3', ['-c', `
from PIL import Image
Image.open(${JSON.stringify(png)}).convert('RGB').resize((640, 360), Image.LANCZOS).save(${JSON.stringify(path.join(OUT, `guide-${i + 1}-thumb.webp`))}, 'WEBP', quality=82, method=6)
`]);
  const v = crypto.createHash('sha1').update(fs.readFileSync(png)).digest('hex').slice(0, 10);
  appHtml = appHtml.replace(new RegExp(`(img/bdayparty/guide-${i + 1}(?:-thumb\\.webp|\\.png)\\?v=)\\w+`, 'g'), '$1' + v);
  console.log(`img/bdayparty/guide-${i + 1}.png：${(fs.statSync(png).size / 1048576).toFixed(2)} MB（v=${v}）`);
}
fs.writeFileSync(path.join(ROOT, 'app.html'), appHtml);
for (const f of ['guide.png', 'guide-thumb.webp']) fs.rmSync(path.join(OUT, f), { force: true });
console.log(`範例：${who}，家具 ${fx.length} 件 ${fxAll} 朵，收集期雙葉 ${spawns} 輪`);
