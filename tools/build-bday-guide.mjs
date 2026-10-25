// 豆森生日派對（慶典之花）一圖流攻略：產 img/bdayparty/guide.png（2160 寬）與頁面縮圖 guide-thumb.webp，並更新 app.html 的 ?v=。
// 數字全部從 data/bday-party.js（master）與 js/app.js 的社群實測常數算，跟頁面一致；遊戲畫面取自遊戲內的生日派對說明投影片（素材庫）。
// 本機：node tools/build-bday-guide.mjs（需要 playwright 或 playwright-core + Chromium；CHROME 可指定執行檔；縮圖要 python3 + Pillow）
// 規則或獎勵改了（例如 build-bday-party.py 抓到新的累計獎勵）就重跑一次。
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
const perLb = spDew / spLb;

/* 範例場次：現在或下一場（台服）；日期、家具、露水與花的圖都用這一場 */
const now = Date.now(), P = B.parties;
const ex = P.find(x => x[2] <= now && now <= x[4]) || P.find(x => x[2] > now) || P[P.length - 1];
const [pid, cid, st, bd, en, dewId, flId, per, bonus, totals] = ex;
const N = B.names, nm = k => N[k] || ['', '', 0];
const img = k => nm(k)[1] ? AS + '/' + nm(k)[1] : '';
const newCard = (bonus.find(b => b[1] >= 50) || [])[0];
const abn = (cardsSrc.match(new RegExp('\\[' + newCard + ',\\d+,\\d+,\\d+,\\d+,-?\\d+,\\d+,"[^"]*","([^"]+)"')) || [])[1];
const fx = FIXTURES.filter(r => r[13] === pid).map(r => ({ name: r[1].replace(/（[^）]*）$/, ''), img: AS + '/mysekai/thumbnail/fixture/' + r[6] + '_1.webp',
  cost: ((r[10] || []).find(m => m[0] === flId) || [0, 0])[1] })).sort((a, b) => a.cost - b.cost);
const fxAll = fx.reduce((a, x) => a + x.cost, 0), maxReq = totals[totals.length - 1][0];

/* 累計獎勵與 LIVE BONUS 換算 */
const rewLb = n => totals.filter(([r]) => r <= n).reduce((a, [, bx]) => a + (B.boxes[bx] || []).filter(x => x[0] === 'boost_item').reduce((b, [, i, q]) => b + q * (nm('boost_item:' + i)[2] || 1), 0), 0);
const cost = (bon, n) => { const d = Math.ceil(n * per / (BP_PT * (100 + bon) / 100)), lb = Math.ceil(d / perLb); return { d, lb, can: Math.ceil(Math.max(0, lb - NAT - rewLb(n)) / 10) }; };
const sum = {};
totals.forEach(([, bx]) => (B.boxes[bx] || []).forEach(([t, i, q]) => { const k = t + ':' + i; sum[k] = (sum[k] || 0) + q; }));
const tot = t => Object.keys(sum).filter(k => k.startsWith(t + ':'));
const expN = tot('practice_ticket').reduce((a, k) => a + sum[k] * nm(k)[2], 0), tkN = tot('practice_ticket').reduce((a, k) => a + sum[k], 0);
const lvAt = e => { let lv = 1; CARD_EXP.forEach((v, i) => { if (v <= e) lv = i + 1; }); return lv; };
const honorAt = totals.filter(([, bx]) => (B.boxes[bx] || []).some(x => x[0] === 'honor')).map(([r, bx]) => [r, (B.boxes[bx].find(x => x[0] === 'honor') || [])[1]]);
const honorUp = honorAt.filter(([, h], i) => !i || h !== honorAt[i - 1][1]).map(x => x[0]);   // 稱號換成更高階的那幾階
const fmt = n => Number(n).toLocaleString('en-US');
const md = ms => { const d = new Date(ms + 8 * 3600000); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); };
const who = nm('mysekai_material:' + flId)[0].replace(/的慶典之花$/, '');

/* 遊戲畫面：投影片原圖用 CSS 裁切（x0,y0,x1,y1 是原圖座標），寬度固定、高度照比例 */
const SL1 = [AS + '/mysekai/rule_slide/tutorial_birthday/mysekai_tutorial_birthday_01.png', 1224, 744];
const SL2 = [AS + '/mysekai/rule_slide/tutorial_birthday/mysekai_tutorial_birthday_02.png', 1224, 744];
const SLN = [AS + '/mysekai/birthday/honami_2026/birthday_rule_slide.png', 845, 428];
const shot = ([u, w, h], [x0, y0, x1, y1], W, cls = '') => { const s = W / (x1 - x0);
  return `<div class="shot ${cls}" style="width:${W}px;height:${Math.round((y1 - y0) * s)}px;background-image:url('${u}');background-size:${(w * s).toFixed(1)}px ${(h * s).toFixed(1)}px;background-position:${(-x0 * s).toFixed(1)}px ${(-y0 * s).toFixed(1)}px"></div>`; };
const local = f => 'data:image/webp;base64,' + fs.readFileSync(path.join(ROOT, f)).toString('base64');
const ic = (k, cls = 'ic') => `<img class="${cls}" src="${img(k)}" alt="">`;

const BON = [[0, '沒有加成卡'], [15, '往年生日卡 1 張'], [50, '當年生日卡'], [65, '當年＋往年 1 張'], [110, '台服全收・當年＋往年 4 張'], [125, '日服 2026 全收・當年＋往年 5 張']];
const scRows = BON.map(([bon, n]) => { const pt = BP_PT * (100 + bon) / 100, c3 = cost(bon, 3), cf = cost(bon, fxAll), cm = cost(bon, maxReq);
  return `<tr class="${bon === 50 ? 'hot' : ''}"><td><b class="bon">+${bon}%</b></td><td class="l">${n}${bon === 50 ? '<i class="tag">至少抽這張</i>' : ''}</td><td>${fmt(Math.ceil(per / pt))}</td><td>${Math.floor(NAT * perLb * pt / per)} 朵</td><td>${c3.lb}</td>`
    + `<td><b>${fmt(cf.lb)}</b><em>${cf.can ? '大罐 ' + cf.can : '不用喝'}</em></td><td><b>${fmt(cm.lb)}</b><em>${cm.can ? '大罐 ' + cm.can : '不用喝'}</em></td></tr>`; }).join('');
let cum = 0;
const fxRows = fx.map(x => { cum += x.cost; const c = [0, 50, 110].map(b => cost(b, cum));
  return `<tr><td class="l"><img class="fxs" src="${x.img}" alt="">${x.name}</td><td><b class="pk">${x.cost}</b></td><td>${cum}</td>` + c.map(v => `<td><b>${fmt(v.lb)}</b><em>${v.can ? '大罐 ' + v.can : '不用喝'}</em></td>`).join('') + '</tr>'; }).join('');
const rwName = k => nm(k)[0].replace(new RegExp('^' + who + '的'), '角色的').replace(/^\S+記憶$/, '記憶（角色代表色）');
const rw = [['boost_item:1', '小罐 1 LB'], ...tot('practice_ticket').map(k => [k, fmt(nm(k)[2]) + ' EXP／張']), ...tot('skill_practice_ticket').map(k => [k, nm(k)[2] + ' 技能 EXP／張']),
  ...tot('gacha_ticket').map(k => [k, '']), ...tot('material').map(k => [k, '']), ...tot('mysekai_item').map(k => [k, '']), ...tot('mysekai_material').map(k => [k, ''])]
  .map(([k, sub]) => `<div class="rw"><img src="${img(k)}" alt=""><div><span>${rwName(k)}</span><b>×${fmt(sum[k])}</b>${sub ? `<em>${sub}</em>` : ''}</div></div>`).join('')
  + `<div class="rw"><div class="hb">${shot(SL2, [24, 371, 256, 427], 96)}</div><div><span>生日稱號</span><b>${honorUp.length} 階</b><em>朵數到了自動升級</em></div></div>`;
const QA_TXT = [
  ['可以一次把露水倒完嗎？', `不要。每倒滿 ${fmt(per)} pt 雙葉才重生一輪，重生<b>不會累積</b>，一次倒完只換到一輪。拔完一輪 → 只倒到下一朵 → 再拔。`],
  ['第一天拔，還是最後一天拔？', '<b>第一天就拔</b>。沒拔的雙葉不會累積、露水也不會貶值；真正的上限是 LIVE BONUS，拖到最後只會浪費自然回復與刷新。'],
  ['要先抽卡再倒嗎？', `要。加成看<b>倒進去那一刻</b>持有的卡；當年生日卡池在生日前 4 天就開（例：${md(bd - 4 * 86400000)}）。`],
  ['不喝罐子能拿幾朵？', `只靠收集期自然回復（${NAT} LB）：沒有加成約 ${Math.floor(NAT * perLb * BP_PT / per)} 朵、當年卡約 ${Math.floor(NAT * perLb * 1.5 * BP_PT / per)} 朵、台服全收約 ${Math.floor(NAT * perLb * 2.1 * BP_PT / per)} 朵。`],
  ['拿滿的經驗值夠升滿一張卡嗎？', `不夠。${fmt(expN)} EXP＝一張卡 Lv1 → <b>Lv${lvAt(expN)}</b>；★4 從 1 練到 60 要 ${fmt(CARD_EXP[59])} EXP（${Math.ceil(CARD_EXP[59] / 10000)} 張中級）。`],
  ['加成卡要放進隊伍嗎？', '不用，<b>持有就算</b>；但送進控え室（倉庫）的卡不算。當年 +50%、往年每張 +15%。'],
  ['值得拿滿 400 朵嗎？', `推角才拿滿（最高階稱號在 ${maxReq} 朵）；其他角色做完想要的家具就好：蛋糕 3 朵就能開派對。`],
  ['剩下的露水怎麼辦？', '只能用在這一場，生日後 2 天 23:59 截止後作廢；生日當天起記得全部倒完。'],
];
const QA = QA_TXT.map(([q, a]) => `<div class="qa"><b>Q</b><div><h4>${q}</h4><p>${a}</p></div></div>`).join('');
const TL = [
  ['生日前 4 天 00:00', '生日卡池開始', '先抽當年生日卡（+50%）', md(bd - 4 * 86400000)],
  ['生日前 3 天 00:00', '收集開始', '四區雙葉長出來，馬上拔第一輪', md(st)],
  ['每天 05:00／17:00', '雙葉刷新', '刷新前拔完，才不會浪費', '收集期間'],
  ['生日前 1 天 23:59', '收集截止', '之後拔不到雙葉、也不掉露水', md(bd - 60000)],
  ['生日當天 00:00', '派對開始', '剩下的露水倒完、做家具開派對', md(bd)],
  ['生日後 2 天 23:59', '全部截止', '沒倒的露水作廢', md(en)],
].map(([t, k, d, e], i) => `<div class="tn${i === 1 ? ' on' : ''}"><i>${i + 1}</i><span class="tt">${t}</span><b>${k}</b><span class="td">${d}</span><em>例：${e}</em></div>`).join('');
const areas = [5, 6, 7, 8].map((s, i) => `<div class="ar"><img src="${local('img/mysekai/site-' + s + '.webp')}" alt=""><span>${AREAS[i]}<b>×${spN / 4}</b></span></div>`).join('');

const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<style>/*FONTS*/
:root{--pk:#ff4f93;--pk2:#ffd6e7;--lv:#8a72ff;--mt:#2fbfa8;--ink:#2a2140;--sub:#665d80;--card:rgba(255,255,255,.9);--line:#efdbe8}
*{box-sizing:border-box;margin:0;padding:0}
body{width:1080px;font-family:'Noto Sans TC','Noto Sans CJK TC','Microsoft JhengHei',sans-serif;color:var(--ink);background:#fff}
#poster{width:1080px;padding-bottom:36px;background:radial-gradient(circle at 1px 1px,rgba(255,79,147,.10) 1.5px,transparent 0) 0 0/22px 22px,linear-gradient(180deg,#ffe4f0 0%,#f4eaff 32%,#e8f4ff 64%,#fff0f7 100%)}
.num,.bon,b.pk{font-family:'M PLUS Rounded 1c',sans-serif}
.hero{position:relative;height:600px;overflow:hidden;background:#f6c9da url('${AS}/character/member/${abn}/card_normal.webp') center 28%/cover}
.hero::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(42,33,64,.05) 0%,rgba(42,33,64,.0) 35%,rgba(255,79,147,.55) 68%,rgba(255,79,147,.95) 100%)}
.hero .gar{position:absolute;top:-6px;right:24px;width:430px;z-index:2;filter:drop-shadow(0 4px 10px rgba(0,0,0,.15))}
.hero .brand{position:absolute;top:28px;left:36px;z-index:2;padding:8px 16px;border-radius:999px;background:rgba(255,255,255,.92);font-weight:900;font-size:19px;color:var(--pk);box-shadow:0 6px 18px rgba(255,79,147,.25)}
.hero .ht{position:absolute;left:44px;right:44px;bottom:38px;z-index:2;color:#fff}
.hero .pill{display:inline-block;padding:6px 16px;border-radius:999px;background:rgba(255,255,255,.95);color:var(--pk);font-weight:900;font-size:20px;margin-bottom:12px}
.hero h1{font-size:92px;font-weight:900;line-height:1.02;letter-spacing:2px;text-shadow:0 4px 0 rgba(197,32,98,.55),0 10px 30px rgba(120,0,50,.35)}
.hero h1 small{display:block;font-size:56px;letter-spacing:1px;margin-top:6px}
.hero .hs{margin-top:16px;font-size:23px;font-weight:700;display:flex;align-items:center;gap:10px;text-shadow:0 2px 8px rgba(120,0,50,.4)}
.hero .hs img{width:52px;height:52px;filter:drop-shadow(0 3px 6px rgba(0,0,0,.25))}
.hero .crk{position:absolute;right:40px;bottom:150px;width:150px;z-index:2;transform:rotate(-8deg)}
.sec{margin:26px 32px 0;padding:26px 28px 28px;border-radius:30px;background:var(--card);box-shadow:0 10px 30px rgba(138,114,255,.12),0 1px 0 #fff inset;border:1px solid rgba(255,255,255,.7)}
.sh{display:flex;align-items:center;gap:14px;margin-bottom:18px}
.sh .no{font-family:'M PLUS Rounded 1c';font-weight:800;font-size:20px;color:#fff;background:linear-gradient(135deg,var(--pk),var(--lv));border-radius:14px;padding:6px 12px}
.sh h2{font-size:34px;font-weight:900;letter-spacing:1px}
.sh em{margin-left:auto;font-style:normal;font-size:17px;color:var(--sub);font-weight:700}
.flow{display:grid;grid-template-columns:1fr 34px 1fr 34px 1fr;align-items:stretch}
.fc{background:#fff;border-radius:22px;padding:12px;border:2px solid var(--line);display:flex;flex-direction:column;gap:10px}
.fc .shot{border-radius:14px;box-shadow:0 4px 12px rgba(0,0,0,.12)}
.fc h3{font-size:24px;font-weight:900;display:flex;align-items:center;gap:8px}
.fc h3 i{font-style:normal;font-family:'M PLUS Rounded 1c';width:34px;height:34px;border-radius:50%;background:var(--pk);color:#fff;display:grid;place-items:center;font-size:20px;flex:none}
.fc p{font-size:17.5px;line-height:1.6;color:var(--sub)} .fc p b{color:var(--ink)}
.arw{display:grid;place-items:center;font-size:30px;color:var(--pk);font-weight:900}
.loopnote{margin-top:16px;display:flex;align-items:center;gap:14px;padding:12px 18px;border-radius:18px;background:linear-gradient(90deg,#fff0f6,#f1edff);font-size:20px;font-weight:700}
.loopnote img{width:58px;height:58px}
.loopnote b{color:var(--pk)}
.tl{position:relative;display:grid;grid-template-columns:repeat(6,1fr);gap:8px;padding-top:6px}
.tl::before{content:'';position:absolute;left:5%;right:5%;top:26px;height:4px;border-radius:4px;background:linear-gradient(90deg,var(--lv),var(--pk),var(--mt))}
.tn{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;gap:4px}
.tn i{font-style:normal;font-family:'M PLUS Rounded 1c';font-weight:800;width:44px;height:44px;border-radius:50%;background:#fff;border:4px solid var(--pk);display:grid;place-items:center;font-size:20px;color:var(--pk);z-index:1}
.tn.on i{background:var(--pk);color:#fff}
.tn .tt{font-size:15px;font-weight:700;color:var(--sub);margin-top:4px}
.tn b{font-size:21px;font-weight:900}
.tn .td{font-size:15px;line-height:1.45;color:var(--ink)}
.tn em{font-style:normal;font-size:14px;font-weight:700;color:var(--pk);background:var(--pk2);border-radius:999px;padding:2px 10px;margin-top:2px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.st{display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:20px;background:#fff;border:2px solid var(--line)}
.st img{width:62px;height:62px;flex:none;object-fit:contain}
.st div{display:flex;flex-direction:column;min-width:0}
.st span{font-size:15.5px;font-weight:700;color:var(--sub)}
.st b{font-family:'M PLUS Rounded 1c';font-size:30px;line-height:1.15;color:var(--ink)}
.st em{font-style:normal;font-size:14.5px;color:var(--sub)}
.areas{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}
.ar{position:relative;border-radius:18px;overflow:hidden;height:150px;box-shadow:0 4px 12px rgba(0,0,0,.12)}
.ar img{width:100%;height:100%;object-fit:cover}
.ar span{position:absolute;left:0;right:0;bottom:0;padding:22px 12px 8px;background:linear-gradient(180deg,transparent,rgba(42,33,64,.85));color:#fff;font-weight:900;font-size:18px;display:flex;justify-content:space-between;align-items:flex-end}
.ar span b{font-family:'M PLUS Rounded 1c';font-size:22px;color:#ffd6e7}
.strat{display:grid;grid-template-columns:340px 1fr;gap:22px;align-items:center}
.loop{position:relative;width:340px;height:340px}
.lni{position:absolute;width:64px;height:64px;background:#fff;border-radius:50%;padding:6px;box-shadow:0 4px 12px rgba(255,79,147,.28);z-index:1}
.loop svg{position:absolute;inset:0}
.ln{position:absolute;width:150px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:2px;font-weight:900;font-size:17px;line-height:1.3}
.ln em{font-style:normal;font-weight:700;font-size:14px;color:var(--sub)}
.lc{position:absolute;left:170px;top:190px;transform:translate(-50%,-50%);text-align:center;font-weight:900;font-size:19px;color:var(--pk);line-height:1.3}
.rules{display:grid;gap:10px}
.ru{display:flex;gap:12px;align-items:flex-start;padding:12px 16px;border-radius:18px;background:#fff;border:2px solid var(--line)}
.ru i{font-style:normal;font-family:'M PLUS Rounded 1c';font-weight:800;min-width:34px;height:34px;border-radius:12px;background:linear-gradient(135deg,var(--pk),var(--lv));color:#fff;display:grid;place-items:center;font-size:19px}
.ru b{display:block;font-size:20px;font-weight:900}
.ru span{font-size:16px;line-height:1.55;color:var(--sub)}
table{width:100%;border-collapse:separate;border-spacing:0;border-radius:18px;overflow:hidden;border:2px solid var(--line);background:#fff}
th{background:linear-gradient(90deg,#ffe0ee,#ece6ff);font-size:15.5px;font-weight:900;padding:10px 8px;text-align:center;line-height:1.3}
th img{width:30px;height:30px;vertical-align:middle}
td{padding:10px 8px;border-top:1.5px solid var(--line);text-align:center;font-size:17px;font-family:'M PLUS Rounded 1c';font-weight:700}
td.l{text-align:left;font-family:'Noto Sans TC';font-size:16.5px;font-weight:700}
td b{font-size:20px} td em{display:block;font-style:normal;font-size:14.5px;color:var(--pk);font-family:'Noto Sans TC';font-weight:900}
.bon{color:var(--lv);font-size:20px}
tr.hot td{background:#fff3f8}
.tag{font-style:normal;display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;background:var(--pk);color:#fff;font-size:12.5px;vertical-align:2px}
.note{margin-top:10px;font-size:14.5px;line-height:1.6;color:var(--sub)}
.fxs{width:46px;height:46px;vertical-align:middle;margin-right:6px;object-fit:contain}
b.pk{color:var(--pk)}
.fxrow{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px}
.fxi{display:flex;flex-direction:column;align-items:center;padding:10px 6px;border-radius:18px;background:#fff;border:2px solid var(--line)}
.fxi img{width:100px;height:100px;object-fit:contain}
.fxi span{font-weight:900;font-size:17px}
.fxi b{font-family:'M PLUS Rounded 1c';font-size:22px;color:var(--pk);display:flex;align-items:center;gap:4px}
.fxi b img{width:28px;height:28px}
.big{display:flex;align-items:center;gap:16px;margin-top:14px;padding:14px 18px;border-radius:20px;background:linear-gradient(90deg,#ff4f93,#8a72ff);color:#fff}
.big img{width:64px;height:64px;background:rgba(255,255,255,.9);border-radius:16px;padding:4px}
.big b{font-size:22px;font-weight:900;display:block}
.big span{font-size:16.5px;line-height:1.55;opacity:.95}
.rws{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.rw{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:18px;background:#fff;border:2px solid var(--line)}
.rw img{width:54px;height:54px;flex:none}
.rw .hb{flex:none;width:96px;display:grid;place-items:center}
.rw div{display:flex;flex-direction:column;min-width:0}
.rw span{font-size:15px;font-weight:700;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rw b{font-family:'M PLUS Rounded 1c';font-size:24px}
.rw em{font-style:normal;font-size:13.5px;color:var(--pk);font-weight:700}
.hon{margin-top:14px;display:grid;grid-template-columns:1fr 300px;gap:14px;align-items:center}
.hon .shot{border-radius:16px}
.hon .ms{display:flex;flex-wrap:wrap;gap:6px}
.hon .ms span{font-family:'M PLUS Rounded 1c';font-weight:800;font-size:16px;padding:4px 11px;border-radius:999px;background:var(--pk2);color:var(--pk)}
.hon .ms span.g{background:var(--pk);color:#fff}
.hon p{font-size:15px;line-height:1.55;color:var(--sub);margin-top:8px}
.exp{margin-top:12px;display:flex;gap:12px;align-items:center;padding:12px 16px;border-radius:18px;background:#f1edff;font-size:17px;line-height:1.55}
.exp img{width:52px;height:52px}
.exp b{color:var(--lv)}
.qas{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.qa{display:flex;gap:10px;padding:12px 14px;border-radius:18px;background:#fff;border:2px solid var(--line)}
.qa>b{font-family:'M PLUS Rounded 1c';font-weight:800;font-size:22px;color:#fff;background:var(--pk);border-radius:12px;min-width:36px;height:36px;display:grid;place-items:center}
.qa h4{font-size:18.5px;font-weight:900;margin-bottom:3px}
.qa p{font-size:15.5px;line-height:1.6;color:var(--sub)} .qa p b{color:var(--pk)}
.foot{margin:24px 32px 0;display:flex;align-items:center;gap:16px;padding:18px 22px;border-radius:24px;background:#2a2140;color:#fff}
.foot img{width:76px;height:auto}
.foot div{font-size:14.5px;line-height:1.65;opacity:.92}
.foot b{font-size:20px;color:#ffd6e7;display:block;opacity:1}
</style></head><body><div id="poster">
<div class="hero">
  <img class="gar" src="${AS}/mysekai/birthday/honami_2026/birthday_garland.png" alt="">
  <div class="brand">Project SEKAI 資源中心・一圖流</div>
  <img class="crk" src="${AS}/mysekai/birthday/honami_2026/birthday_cracker.png" alt="">
  <div class="ht">
    <span class="pill">豆森 MySekai・角色生日活動</span>
    <h1>豆森生日派對<small>慶典之花 一圖流攻略</small></h1>
    <div class="hs">${ic('material:' + dewId)} 露水 → ${ic('mysekai_material:' + flId)} 慶典之花 → 生日家具・稱號・罐子・經驗值｜台服・日服通用</div>
  </div>
</div>

<div class="sec"><div class="sh"><span class="no">01</span><h2>整體流程</h2><em>圖為遊戲畫面</em></div>
  <div class="flow">
    <div class="fc">${shot(SL1, [42, 345, 312, 544], 264)}<h3><i>1</i>拔雙葉收集露水</h3><p>豆森四個區域各 ${spN / 4} 株雙葉，一株 <b>${spLb} LIVE BONUS → 約 ${spDew} 個露水</b>。打 LIVE、一般採集也會掉，但效率低。</p></div>
    <div class="arw">▶</div>
    <div class="fc">${shot(SL1, [402, 345, 668, 544], 264)}<h3><i>2</i>到慶典的庭園澆灌</h3><p>每個露水 <b>${BP_PT} pt</b>（持有加成卡再加），每滿 <b>${fmt(per)} pt 開一朵慶典之花</b>，四區雙葉同時重生。</p></div>
    <div class="arw">▶</div>
    <div class="fc">${shot(SL1, [733, 318, 1176, 571], 264)}<h3><i>3</i>做家具開派對</h3><p>用慶典之花做<b>生日家具</b>；生日當天起擺上蛋糕就能開派對，朵數也換<b>稱號與獎勵</b>。</p></div>
  </div>
  <div class="loopnote"><img src="${AS}/mysekai/birthday/honami_2026/icon_refresh.png" alt=""><div>關鍵：② 每倒滿 <b>${fmt(per)} pt</b>，① 的雙葉就<b>全部重生</b>，回去再拔一輪 —— 這就是不喝也能多拿的循環。</div></div>
</div>

<div class="sec"><div class="sh"><span class="no">02</span><h2>時程</h2><em>每一場都一樣・例：${who} ${md(bd)} 生日</em></div>
  <div class="tl">${TL}</div>
</div>

<div class="sec"><div class="sh"><span class="no">03</span><h2>核心數字</h2><em>master＋社群實測</em></div>
  <div class="stats">
    <div class="st"><img src="${AS}/mysekai/birthday/honami_2026/icon_refresh.png" alt=""><div><span>雙葉一輪</span><b>${spN} 株</b><em>四區各 ${spN / 4} 株</em></div></div>
    <div class="st">${ic('material:' + dewId)}<div><span>一輪拔完</span><b>${fmt(spN * spDew)} 露水</b><em>花 ${spN * spLb} LIVE BONUS（1 LB ≈ ${perLb.toFixed(1)} 個）</em></div></div>
    <div class="st">${ic('mysekai_material:' + flId)}<div><span>一朵慶典之花</span><b>${fmt(per)} pt</b><em>沒加成＝${fmt(per / BP_PT)} 個露水</em></div></div>
    <div class="st"><img src="${AS}/thumbnail/chara/${abn}_normal.webp" alt="" style="border-radius:12px"><div><span>持有加成卡（不用上場）</span><b>+50%</b><em>當年生日卡；往年每張 +15%</em></div></div>
    <div class="st">${ic('boost_item:1')}<div><span>LIVE BONUS 自然回復</span><b>30 分 1</b><em>上限 10；收集期 3 天最多約 ${NAT}</em></div></div>
    <div class="st"><img src="${AS}/thumbnail/boost_item/boost_item2.webp" alt=""><div><span>大罐一罐回復</span><b>10 LB</b><em>小罐 1 LB；拿滿送 ${sum['boost_item:1']} 小罐</em></div></div>
  </div>
  <div class="areas">${areas}</div>
</div>

<div class="sec"><div class="sh"><span class="no">04</span><h2>怎麼拔才不虧</h2><em>最佳採集策略</em></div>
  <div class="strat">
    <div class="loop">
      <svg viewBox="0 0 340 340"><defs><marker id="m" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#ff4f93"/></marker></defs>
        <circle cx="170" cy="190" r="110" fill="none" stroke="#ffe3ef" stroke-width="18"/>
        <path d="M225 94.7A110 110 0 0 1 280 190" fill="none" stroke="#ff4f93" stroke-width="5" stroke-linecap="round" marker-end="url(#m)"/>
        <path d="M225 285.3A110 110 0 0 1 115 285.3" fill="none" stroke="#ff4f93" stroke-width="5" stroke-linecap="round" marker-end="url(#m)"/>
        <path d="M60 190A110 110 0 0 1 115 94.7" fill="none" stroke="#ff4f93" stroke-width="5" stroke-linecap="round" marker-end="url(#m)"/></svg>
      <img class="lni" style="left:138px;top:48px" src="${AS}/mysekai/birthday/honami_2026/icon_refresh.png" alt="">
      <img class="lni" style="left:233px;top:213px" src="${img('material:' + dewId)}" alt="">
      <img class="lni" style="left:43px;top:213px" src="${img('mysekai_material:' + flId)}" alt="">
      <div class="ln" style="left:95px;top:0">拔完 ${spN} 株<em>${spN * spLb} LB・${fmt(spN * spDew)} 露水</em></div>
      <div class="ln" style="left:190px;top:281px">只倒到下一朵<em>剛好滿 ${fmt(per)} pt</em></div>
      <div class="ln" style="left:0;top:281px">雙葉全部重生<em>回去再拔一輪</em></div>
      <div class="lc">重複到<br>LIVE BONUS<br>用完</div>
    </div>
    <div class="rules">
      <div class="ru"><i>1</i><div><b>先抽卡再倒</b><span>加成看「倒進去那一刻」持有的卡；當年生日卡池生日前 4 天就開。</span></div></div>
      <div class="ru"><i>2</i><div><b>LIVE BONUS 只花在雙葉</b><span>雙葉 1 LB ≈ ${perLb.toFixed(1)} 個露水；一般採集約 8 個、打 LIVE 約 5 個。</span></div></div>
      <div class="ru"><i>3</i><div><b>不要一次倒完</b><span>重生不會累積，一次倒完只換一輪；每次只倒到下一朵，多的存著。</span></div></div>
      <div class="ru"><i>4</i><div><b>第一天就拔</b><span>沒拔的不會累積、露水不會貶值；05:00／17:00 刷新前拔完。</span></div></div>
      <div class="ru"><i>5</i><div><b>生日前一天 23:59 收手</b><span>收集期過了就拔不到；生日當天起把剩下的露水倒完、做家具。</span></div></div>
    </div>
  </div>
</div>

<div class="sec"><div class="sh"><span class="no">05</span><h2>情形對照表</h2><em>全用雙葉・要花多少 LIVE BONUS、喝幾罐</em></div>
  <table><thead><tr><th>加成</th><th>情形</th><th>一朵要<br>幾個露水</th><th>不喝罐<br>能開</th><th>只做蛋糕<br>3 朵（LB）</th><th>做齊家具 ${fxAll} 朵<br>LB／大罐</th><th>拿滿 ${maxReq} 朵<br>LB／大罐</th></tr></thead><tbody>${scRows}</tbody></table>
  <div class="note">大罐＝已扣掉收集期自然回復 ${NAT} LB 與該朵數前領到的獎勵小罐（做齊家具前 ${rewLb(fxAll)}、拿滿前 ${rewLb(maxReq)}）後，還要喝的 LIVE BONUS 飲料（大）。雙葉掉落量取社群實測（一株約 ${spDew} 個），實際會有小誤差；卡池點數換露水另計。</div>
</div>

<div class="sec"><div class="sh"><span class="no">06</span><h2>做完全部生日家具要幾罐？</h2><em>照便宜到貴累計</em></div>
  <div class="fxrow">${fx.map(x => `<div class="fxi"><img src="${x.img}" alt=""><span>${x.name}</span><b>${ic('mysekai_material:' + flId, '')}${x.cost}</b></div>`).join('')}</div>
  <table><thead><tr><th>家具</th><th>朵</th><th>累計</th><th>沒有加成卡<br>LB／大罐</th><th>當年生日卡 +50%<br>LB／大罐</th><th>台服全收 +110%<br>LB／大罐</th></tr></thead><tbody>${fxRows}</tbody></table>
  <div class="big"><img src="${AS}/thumbnail/boost_item/boost_item2.webp" alt=""><div><b>做齊 ${fx.length} 件共 ${fxAll} 朵 ≈ 大罐 ${cost(0, fxAll).can}／${cost(50, fxAll).can}／${cost(110, fxAll).can} 罐</b><span>沒有加成卡／當年生日卡／台服全收；只做蛋糕 3 朵開派對，自然回復就夠，不用喝。</span></div></div>
</div>

<div class="sec"><div class="sh"><span class="no">07</span><h2>拿滿 ${maxReq} 朵的累計獎勵</h2><em>2～${maxReq} 朵共 ${totals.length} 階</em></div>
  <div class="rws">${rw}</div>
  <div class="hon">${shot(SL2, [18, 345, 965, 535], 640)}<div><div class="ms">${honorAt.map(([r]) => `<span class="${honorUp.includes(r) ? 'g' : ''}">${r}</span>`).join('')}</div><p>這些朵數送生日稱號；深色的 ${honorUp.join('、')} 朵換成更高階的稱號（左圖為遊戲畫面）。</p></div></div>
  <div class="exp">${ic('practice_ticket:2', '')}<div>練習譜 ${tkN} 張＝<b>${fmt(expN)} EXP</b>：一張卡 Lv1 → <b>Lv${lvAt(expN)}</b>；★4 從 1 練滿 60 要 ${fmt(CARD_EXP[59])} EXP（${Math.ceil(CARD_EXP[59] / 10000)} 張中級），<b>不夠升滿一張</b>。</div></div>
</div>

<div class="sec"><div class="sh"><span class="no">08</span><h2>常見 Q&amp;A</h2></div>
  <div class="qas">${QA}</div>
</div>

<div class="foot"><img src="${AS}/character/character_sd_l/chr_sp_${cid}.webp" alt=""><div><b>project-sekai-center.com ・ 豆森生日派對頁</b>互動計算機（勾持有的加成卡、輸入露水）與每一場的時程在網站上。期間、加成、每朵 pt、累計獎勵、家具素材與雙葉消耗 2.5 LIVE BONUS 讀自遊戲 master；雙葉露水量取自 Game8 社群實測。遊戲畫面與素材 © SEGA / © Colorful Palette / © Crypton Future Media。</div></div>
</div></body></html>`;

/* 圖與數字字型先用 curl 抓下來內嵌成 data URI：截圖時不靠瀏覽器連外網（代理、憑證、逾時都不必管），也確定每張圖都到齊才截。
   中文字用本機的 Noto Sans TC；數字的 M PLUS Rounded 1c 只抓 ASCII 子集（Google Fonts 的 text= 參數，一個檔幾 KB）。 */
const get = (url, ua) => execFileSync('curl', ['-sSfL', '-m', '90', ...(ua ? ['-A', ua] : []), url], { maxBuffer: 64 << 20 });
const MIME = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', woff2: 'font/woff2', ttf: 'font/ttf' };
const dataUri = (buf, ext) => 'data:' + (MIME[ext] || 'application/octet-stream') + ';base64,' + buf.toString('base64');
const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
const fontCss = get('https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@700;800&text=' + encodeURIComponent(ascii),
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36').toString()
  .replace(/url\((https:[^)]+)\)/g, (m, u) => 'url(' + dataUri(get(u), (u.match(/\.(\w+)$/) || [])[1] || 'woff2') + ')');
let page_html = html.replace('/*FONTS*/', fontCss);
const urls = [...new Set(page_html.match(/https:\/\/storage\.sekai\.best\/[^'")\s]+/g) || [])];
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bday-guide-')), inl = {}, icons = [];
urls.forEach((u, i) => { const ext = u.split('.').pop(), buf = get(u);
  if (/\/thumbnail\/(?!chara\/)/.test(u)) { const src = path.join(tmp, i + '.' + ext); fs.writeFileSync(src, buf); icons.push([u, src, path.join(tmp, i + '.png')]); }
  else inl[u] = dataUri(buf, ext); });
if (icons.length) execFileSync('python3', ['-c', UNMATTE, ...icons.flatMap(x => [x[1], x[2]])]);
icons.forEach(([u, , dst]) => { inl[u] = dataUri(fs.readFileSync(dst), 'png'); });
fs.rmSync(tmp, { recursive: true, force: true });
for (const u of urls) page_html = page_html.split(u).join(inl[u]);
const launch = { headless: true, args: ['--no-sandbox'] };
if (process.env.CHROME) launch.executablePath = process.env.CHROME;
const browser = await pw.chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1080, height: 1200 }, deviceScaleFactor: +(process.env.DSF || 2) });
const bad = [];
page.on('requestfailed', r => bad.push(r.url()));
page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
await page.setContent(page_html, { waitUntil: 'networkidle', timeout: 120000 });
await page.evaluate(() => document.fonts.ready);
await page.evaluate(async () => { await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))); });
await page.waitForTimeout(400);
const broken = await page.evaluate(() => [...document.images].filter(i => !i.naturalWidth).length);
if (bad.length || broken) { console.error('有圖沒載入（' + broken + ' 張）：\n' + bad.join('\n')); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
const png = path.join(OUT, 'guide.png');
await (await page.$('#poster')).screenshot({ path: png });
if (process.env.HTML_OUT) fs.writeFileSync(process.env.HTML_OUT, html);
/* 純文字版（TEXT_OUT=檔名）：跟圖同一份數字，給 Discord／LINE／巴哈貼文 */
if (process.env.TEXT_OUT) {
  const strip = h => h.replace(/<[^>]+>/g, '');
  const T = ['【豆森生日派對・慶典之花 一圖流攻略（文字版）】', '露水 → 慶典之花 → 生日家具・稱號・罐子・經驗值｜台服・日服通用', '',
    '■ 整體流程',
    `1. 拔雙葉收集露水：豆森四個區域各 ${spN / 4} 株雙葉（共 ${spN} 株），一株 ${spLb} LIVE BONUS → 約 ${spDew} 個露水。打 LIVE、一般採集也會掉，但效率低。`,
    `2. 到慶典的庭園澆灌：每個露水 ${BP_PT} pt（持有加成卡再加），每滿 ${fmt(per)} pt 開一朵慶典之花，四區雙葉同時重生。`,
    '3. 做家具開派對：用慶典之花做生日家具；生日當天起擺上蛋糕開派對，朵數也換稱號與獎勵。',
    `★ 關鍵：每倒滿 ${fmt(per)} pt，雙葉就全部重生 → 回去再拔一輪。`, '',
    `■ 時程（每一場都一樣；例：${who} ${md(bd)} 生日）`,
    ...[['生日前 4 天 00:00', '生日卡池開始：先抽當年生日卡（+50%）', md(bd - 4 * 86400000)], ['生日前 3 天 00:00', '收集開始：四區雙葉長出來，馬上拔第一輪', md(st)],
      ['每天 05:00／17:00', '雙葉刷新：刷新前拔完，才不會浪費', ''], ['生日前 1 天 23:59', '收集截止：之後拔不到雙葉、也不掉露水', md(bd - 60000)],
      ['生日當天 00:00', '派對開始：剩下的露水倒完、做家具開派對', md(bd)], ['生日後 2 天 23:59', '全部截止：沒倒的露水作廢', md(en)]].map(([t, d, e]) => `・${t}　${d}${e ? `（例：${e}）` : ''}`), '',
    '■ 核心數字',
    `・雙葉一輪 ${spN} 株＝約 ${fmt(spN * spDew)} 個露水、${spN * spLb} LIVE BONUS（1 LB ≈ ${perLb.toFixed(1)} 個露水）`,
    `・一朵慶典之花 ${fmt(per)} pt（沒加成＝${fmt(per / BP_PT)} 個露水）`,
    '・加成卡持有就算（不用上場；送進控え室的不算）：當年生日卡 +50%、往年每張 +15%',
    `・LIVE BONUS 自然回復 30 分鐘 1、上限 10；收集期 3 天最多約 ${NAT}`,
    `・大罐（LIVE BONUS 飲料大）回 10、小罐回 1；拿滿送 ${sum['boost_item:1']} 小罐`, '',
    '■ 怎麼拔才不虧',
    '1. 先抽卡再倒：加成看「倒進去那一刻」持有的卡；當年生日卡池生日前 4 天就開。',
    `2. LIVE BONUS 只花在雙葉：雙葉 1 LB ≈ ${perLb.toFixed(1)} 個露水；一般採集約 8 個、打 LIVE 約 5 個。`,
    '3. 不要一次倒完：重生不會累積，一次倒完只換一輪；拔完一輪 → 只倒到下一朵 → 雙葉重生 → 再拔，重複到 LIVE BONUS 用完。',
    '4. 第一天就拔：沒拔的雙葉不會累積、露水不會貶值；05:00／17:00 刷新前拔完。',
    '5. 生日前一天 23:59 收手：收集期過了就拔不到；生日當天起把剩下的露水倒完、做家具。', '',
    `■ 情形對照表（全用雙葉；大罐＝扣掉自然回復 ${NAT} 與獎勵小罐後還要喝的）`,
    ...BON.map(([bon, n]) => { const pt = BP_PT * (100 + bon) / 100, c3 = cost(bon, 3), cf = cost(bon, fxAll), cm = cost(bon, maxReq);
      return `・+${bon}%（${n}）：一朵 ${fmt(Math.ceil(per / pt))} 個露水｜不喝罐能開 ${Math.floor(NAT * perLb * pt / per)} 朵｜只做蛋糕 ${c3.lb} LB｜做齊家具 ${fmt(cf.lb)} LB（${cf.can ? '大罐 ' + cf.can : '不用喝'}）｜拿滿 ${maxReq} 朵 ${fmt(cm.lb)} LB（${cm.can ? '大罐 ' + cm.can : '不用喝'}）`; }), '',
    `■ 做完全部生日家具要幾罐（${fx.length} 件共 ${fxAll} 朵；LB／大罐：沒有加成卡｜當年生日卡｜台服全收 +110%）`,
    ...(() => { let c = 0; return fx.map(x => { c += x.cost; return `・${x.name} ${x.cost} 朵（累計 ${c}）：` + [0, 50, 110].map(b => { const v = cost(b, c); return `${fmt(v.lb)} LB／${v.can ? '大罐 ' + v.can : '不用喝'}`; }).join('｜'); }); })(),
    `→ 做齊 ${fxAll} 朵約喝大罐 ${cost(0, fxAll).can}／${cost(50, fxAll).can}／${cost(110, fxAll).can} 罐；只做蛋糕開派對不用喝。`, '',
    `■ 拿滿 ${maxReq} 朵的累計獎勵（2～${maxReq} 朵共 ${totals.length} 階）`,
    '・' + [['boost_item:1'], ...tot('practice_ticket').map(k => [k]), ...tot('skill_practice_ticket').map(k => [k]), ...tot('gacha_ticket').map(k => [k]), ...tot('material').map(k => [k]), ...tot('mysekai_item').map(k => [k]), ...tot('mysekai_material').map(k => [k])]
      .map(([k]) => rwName(k) + ' ×' + fmt(sum[k])).join('、') + `、生日稱號 ${honorUp.length} 階（${honorUp.join('、')} 朵換階）`,
    `・練習譜 ${tkN} 張＝${fmt(expN)} EXP：一張卡 Lv1 → Lv${lvAt(expN)}；★4 從 1 練滿 60 要 ${fmt(CARD_EXP[59])} EXP（${Math.ceil(CARD_EXP[59] / 10000)} 張中級），不夠升滿一張。`, '',
    '■ 常見 Q&A', ...QA_TXT.flatMap(([q, a]) => ['Q：' + q, 'A：' + strip(a), '']),
    '（期間、加成、每朵 pt、累計獎勵、家具素材與雙葉消耗 2.5 LIVE BONUS 讀自遊戲 master；雙葉露水量取自 Game8 社群實測）',
    '互動計算機：https://project-sekai-center.com/app.html?page=bdayparty'];
  fs.writeFileSync(process.env.TEXT_OUT, T.join('\n') + '\n');
}
await browser.close();

/* 縮圖（頁面卡片用，上半部）＋把 app.html 的 ?v= 換成這張圖的雜湊 */
execFileSync('python3', ['-c', `
from PIL import Image
im = Image.open(${JSON.stringify(png)}).convert('RGB')
w = 480; h = round(im.height * w / im.width)
im.resize((w, h), Image.LANCZOS).crop((0, 0, w, min(h, 640))).save(${JSON.stringify(path.join(OUT, 'guide-thumb.webp'))}, 'WEBP', quality=82, method=6)
`]);
const v = crypto.createHash('sha1').update(fs.readFileSync(png)).digest('hex').slice(0, 10);
const appHtml = path.join(ROOT, 'app.html');
fs.writeFileSync(appHtml, fs.readFileSync(appHtml, 'utf8').replace(/(img\/bdayparty\/guide(?:-thumb\.webp|\.png)\?v=)[\w]+/g, '$1' + v));
console.log(`img/bdayparty/guide.png：${(fs.statSync(png).size / 1048576).toFixed(2)} MB（v=${v}，範例：${who}，家具 ${fx.length} 件 ${fxAll} 朵）`);
