// 資料檔的結構驗證：每日排程產出的檔案在提交前、以及每個 PR 都跑一次。
// 為什麼：榜線模型曾因 WL 終章的 character: null 靜靜壞掉五週，卡面指紋停在 #1271 幾個月——
// 建置腳本「跑完」不代表「產出對」。這裡只檢查形狀與基本數量（不是內容對不對），壞了就非零結束。
// 用法：node tools/validate-data.mjs            全部檢查
//       node tools/validate-data.mjs history   只檢查某一組（stamps／songs／cards／events／borders／model／accuracy／history／syslog／i18n／jp）
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const only = process.argv[2] || '';
let fail = 0, n = 0;
const ok = (cond, name, extra) => { n++; console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + String(extra == null ? '' : extra).slice(0, 200))); if (!cond) fail++; };
const want = g => !only || only === g;
const mod = async rel => import(pathToFileURL(path.join(ROOT, rel)).href);
const globalJs = (rel, name) => { const s = readFileSync(path.join(ROOT, rel), 'utf8'); const i = s.indexOf('{'); return JSON.parse(s.slice(i).replace(/;\s*$/, '')); };   // window.X = {...}; 形式
const json = rel => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

if (want('stamps')) {
  const s = readFileSync(path.join(ROOT, 'data/stamps.js'), 'utf8');
  const V = JSON.parse(/self\.SC_DATA_V=(\{.*?\});/.exec(s)[1]), AT = JSON.parse((/self\.SC_DATA_AT=(\{.*?\});/.exec(s) || [, '{}'])[1]);
  const files = readdirSync(path.join(ROOT, 'data')).filter(f => f.endsWith('.js') && f !== 'stamps.js');
  const missing = files.filter(f => !V[f]);
  ok(!missing.length, 'stamps：每個 data/*.js 都有戳記', missing);
  ok(Object.values(V).every(v => /^[0-9a-f]{10}$/.test(v)), 'stamps：戳記是 10 碼十六進位');
  ok(files.every(f => /^\d{4}-\d\d-\d\d$/.test(AT[f] || '')), 'stamps：每個檔都有最近變動日（SC_DATA_AT）', files.filter(f => !AT[f]));
}
if (want('songs')) {
  const m = await mod('data/songs-index.js');
  const S = m.SONGS || [];
  ok(S.length >= 300, 'songs-index：至少 300 首', S.length);
  ok(S.every(x => x.id > 0 && x.title), 'songs-index：每首有 id 與曲名');
  ok(new Set(S.map(x => x.id)).size === S.length, 'songs-index：id 不重複');
  ok(S.every(x => x.lv && typeof x.lv === 'object'), 'songs-index：每首有難度表');
}
if (want('cards')) {
  for (const f of ['data/cards-index.js', 'data/cards-index-jp.js']) {
    const m = await mod(f);
    const C = m.CARDS || m.default || [];
    ok(Array.isArray(C) && C.length >= 1000, f + '：至少 1000 張', C.length);
    ok(Array.isArray(m.UNITS) && m.UNITS.length === 6 && Array.isArray(m.ATTRS) && m.ATTRS.length === 5, f + '：UNITS 6 個、ATTRS 5 個');
  }
}
if (want('events')) {
  const m = await mod('data/event-info.js');
  const rows = (m.EVENT_INFO || {}).ev || [];
  ok(rows.length >= 150, 'event-info：至少 150 期', rows.length);
  ok(rows.every(r => Number.isInteger(r[0]) && r[0] > 0 && typeof r[1] === 'string'), 'event-info：每期有 id 與名稱');
  ok(rows.every(r => r[5] > 1.5e12 && r[6] > r[5]), 'event-info：開始與結算時間是毫秒且結算在開始之後', rows.filter(r => !(r[5] > 1.5e12 && r[6] > r[5])).map(r => r[0]).slice(0, 5));
  ok(new Set(rows.map(r => r[0])).size === rows.length, 'event-info：期數不重複');
}
if (want('borders')) {
  for (const f of ['data/borders-db.js', 'data/borders-db-jp.js']) {
    const D = globalJs(f);
    ok(Array.isArray(D.events) && D.events.length >= 150, f + '：events 至少 150 期', (D.events || []).length);
    ok(Array.isArray(D.tiers) && D.tiers.length >= 20 && D.tiers.includes(100) && D.tiers.includes(1000), f + '：tiers 含 T100、T1000');
    const bad = (D.borders || []).filter(b => !Array.isArray(b.t) || b.t.length !== D.tiers.length);
    ok(!bad.length, f + '：每期終線欄數＝tiers 數', bad.map(b => b.id).slice(0, 5));
    ok((D.borders || []).length >= 100, f + '：borders 至少 100 期', (D.borders || []).length);
  }
}
if (want('model')) {
  const M = json('data/border-model.json');
  ok(M.version && M.families && M.families.tier && M.families.tier.profile && M.families.tier.stack, 'border-model：有 version、families.tier 的 profile 與 stack');
  ok(((M.builtFrom || {}).events || []).length >= 5, 'border-model：訓練期至少 5 期', (M.builtFrom || {}).events);
  const q = (M.families.tier.stack || {}).q || {};
  ok(Object.keys(q).length >= 5, 'border-model：stack 的分位表有東西', Object.keys(q).length);
}
if (want('accuracy') && existsSync(path.join(ROOT, 'data/border-accuracy.json'))) {
  const A = json('data/border-accuracy.json');
  ok(Array.isArray(A.events) && A.events.length >= 3, 'border-accuracy：至少 3 期', (A.events || []).length);
  const all = (((A.summary || {}).tier || {})['0.5'] || {}).all || {};
  ok(all.n > 20 && all.medAPE > 0 && all.medAPE < 0.3, 'border-accuracy：50% 進度主榜中位誤差在 0～30% 之間（模型沒壞）', all);
  ok(A.events.every(e => Array.isArray(e.tiers) && e.tiers.every(t => t.final > 0 && t.at && Object.keys(t.at).length)), 'border-accuracy：每期每段位有終線與預測');
}
if (want('history')) {
  const dir = path.join(ROOT, 'data/history');
  const idx = json('data/history/index.json');
  const files = readdirSync(dir).filter(f => /^\d+\.json$/.test(f)).map(f => +f.replace('.json', '')).sort((a, b) => a - b);
  ok(JSON.stringify(idx.slice().sort((a, b) => a - b)) === JSON.stringify(files), 'history：index.json 與檔案一致', { idx, files });
  for (const id of files) {
    const h = json('data/history/' + id + '.json');
    const probs = [];
    if (+h.eventId !== id) probs.push('eventId 不是 ' + id);
    if (!(Date.parse(h.startAt) > 0 && Date.parse(h.aggregateAt) > Date.parse(h.startAt))) probs.push('startAt／aggregateAt 不對');
    if (!Array.isArray(h.tiers) || !h.tiers.includes(100)) probs.push('tiers 沒有 T100');
    if (!Array.isArray(h.samples) || h.samples.length < 2) probs.push('samples 太少');
    else {
      for (let i = 1; i < h.samples.length; i++) if (!(h.samples[i][0] > h.samples[i - 1][0])) { probs.push('samples 時間不是遞增（第 ' + i + ' 筆）'); break; }
      if (h.samples.some(s => s.length - 1 > h.tiers.length)) probs.push('有 sample 的欄數多過 tiers');
    }
    if (Array.isArray(h.ranks) && h.ranks.some(r => r.length !== 101)) probs.push('ranks 有不是 101 欄的列');
    if (Array.isArray(h.roster) && h.roster.some(r => r.length !== 101)) probs.push('roster 有不是 101 欄的列');
    if (h.wl) for (const [k, c] of Object.entries(h.wl)) { if (!Array.isArray(c.samples) || !Array.isArray(c.tiers)) probs.push('wl.' + k + ' 缺 samples／tiers'); }
    ok(!probs.length, `history/${id}.json 結構（${(h.samples || []).length} 筆）`, probs);
  }
}
if (want('mysekai-studio')) {
  const m = await mod('data/mysekai-studio.js');
  const P = m.PALETTE || [], C = m.CHARS || [];
  ok(P.length >= 60 && P.every(p => /^#[0-9a-f]{6}$/.test(p[3]) && (p[4] === 1 || p[4] === 2) && Array.isArray(p[7]) && p[7].length), 'mysekai-studio：色塊有色碼、邊長與製作素材', P.length);
  ok(C.length === 26 && C.every(c => c[1] && c[4] >= 1 && c[4] <= 12 && c[5] >= 1 && c[5] <= 31), 'mysekai-studio：26 位角色都有名字與生日', C.length);
  const SI = m.SITES || [];
  ok(SI.length >= 15 && SI.every(r => r[5] >= 4 && r[6] >= 4 && r[7] >= 1) && SI.some(r => r[2] === 'home_site' && r[5] === 36) && SI.some(r => r[2] === 'first_floor' && r[5] === 10), 'mysekai-studio：場地格數（我的家 36、1F 10 起）', SI.length);
  const ST = m.CHAL_STAGES || {};
  ok(Object.keys(ST).length === 26 && Object.values(ST).every(v => v >= 100), 'mysekai-studio：26 位角色的挑戰 Live 關卡數', Object.keys(ST).length);
}
if (want('syslog')) {
  const m = await mod('data/syslog.js');
  const S = m.SYSLOG || [];
  ok(S.length >= 100, 'syslog：至少 100 則', S.length);
  ok(S.every(u => /^\d{4}\/\d\d\/\d\d$/.test(u.d) && u.t && u.s), 'syslog：每則有日期、標題、內容');
  ok(S.every((u, i) => !i || u.d <= S[i - 1].d), 'syslog：日期由新到舊');
}
if (want('i18n')) {
  for (const f of ['data/i18n-en.js', 'data/i18n-ja.js']) {
    const s = readFileSync(path.join(ROOT, f), 'utf8');
    const i = s.indexOf('{');
    let D = null; try { D = JSON.parse(s.slice(i).replace(/;\s*$/, '')); } catch (e) {}
    ok(D && Object.keys(D).length >= 10000, f + '：至少 10,000 條', D ? Object.keys(D).length : 'parse 失敗');
  }
}
if (want('jp')) {
  const m = await mod('data/jp-now.js');
  const J = m.JP_NOW || {};
  ok(J.built > 1.5e12 && J.ver && J.ver.app, 'jp-now：有 built 與版本', J.ver);
  ok(Array.isArray(J.events) && J.events.length >= 1, 'jp-now：有活動', (J.events || []).length);
  const f = await mod('data/schedule-forecast.js');
  const F = f.SCHED_FORECAST || {};
  ok(F.built > 1.5e12 && F.rule && F.rule.active, 'schedule-forecast：有 built 與規則', F.rule);
}
console.log(fail ? `\n${n} 項中 ${fail} 項失敗` : `\n${n} 項全部通過`);
process.exit(fail ? 1 : 0);
