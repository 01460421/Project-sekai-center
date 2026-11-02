/* ---------- WL3 計算器：綜合力上限＋後排支援隊＋終章主隊（延後載入，app.js 的 wpLoad() 用 Object.assign(app, wpMembers.call(app)) 掛上） ----------
   WL3 每一期都有總合力上限 336,000（master 的 eventTotalPowerLimits），超過的綜合力不計分。
   這頁回答「滿配加成的隊伍，區域道具、MySekai 大門、玩偶要到什麼狀態才碰得到上限」：
   資料是 tools/build-wl3-power.py 每天從日服 master 算好的 data/wl3-power.js（卡片三維、區域道具每級加成、大門、角色等級）。
   上限用 WL3 當時的（D.lim：大門 Lv40、區域道具 Lv20、沒有想いの大樹），不是現在的日服——那些是 WL3 結束後的 7.0 改版才有的。

   每張卡的綜合力（跟 js/core.js PowerEngine.teamPower 同一套）：
     基礎三維 ＝ 滿級特訓三維 ＋ 前後篇 ＋ 專精 ＋ 畫布（★4 1500、生日 1200，平均攤進三維）
     ＋ 角色等級：每維 floor(基礎 × 等級%)            （Lv50 起固定 5%）
     ＋ 區域道具：各道具的 % 先逐維加總，再逐維 floor
        角色道具＝該角色；團體道具＝卡的團體（全隊同團改用翻倍的 allMatch）；屬性道具＝卡的屬性（全隊同色翻倍）；
        想いの大樹＝全角色一份，「2 種以上團體」的隊伍再一份（同一級在 master 有兩列）
     ＋ MySekai：floor(基礎合計 × (大門% ＋ 玩偶%))     大門看卡的團體，VS 卡吃五扇裡最高的那扇；玩偶受當期上限限制
   隊伍總和超過上限的部分不計分。 */

export const WP_UNITS = ['light_sound', 'idol', 'street', 'theme_park', 'school_refusal'];
export const WP_UNIT_NAME = { light_sound: 'Leo/need', idol: 'MORE MORE JUMP！', street: 'Vivid BAD SQUAD', theme_park: 'ワンダーランズ×ショウタイム', school_refusal: '25時、ナイトコードで。', piapro: 'VIRTUAL SINGER' };
export const WP_CANVAS = { 4: 1500, 9: 1200 };
export const WP_CHARS = ['', '星乃一歌', '天馬咲希', '望月穗波', '日野森志步', '花里實乃理', '桐谷遙', '桃井愛莉', '日野森雫', '小豆澤心羽', '白石杏', '東雲彰人', '青柳冬彌',
  '天馬司', '鳳笑夢', '草薙寧寧', '神代類', '宵崎奏', '朝比奈真冬', '東雲繪名', '曉山瑞希', '初音未來', '鏡音鈴', '鏡音連', '巡音流歌', 'MEIKO', 'KAITO'];
export const wpBand = c => (c <= 4 ? 'light_sound' : c <= 8 ? 'idol' : c <= 12 ? 'street' : c <= 16 ? 'theme_park' : c <= 20 ? 'school_refusal' : 'piapro');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function wpCard(D, id) {
  const c = D.cards[String(id)];
  return c ? { id: +id, ch: c[0], attr: c[1], rar: c[2], sup: c[3], b: [c[4], c[5], c[6]], name: c[7], abn: c[8] } : null;
}
/* 卡在隊伍裡可以算哪些團：人類角色只有本團，VS 卡是 piapro 加上支援團 */
export const wpUnits = c => (c.ch <= 20 ? [wpBand(c.ch)] : ['piapro'].concat(c.sup ? [c.sup] : []));
const pctAt = (arr, lv) => (lv > 0 && arr.length ? arr[Math.min(lv, arr.length) - 1] : 0);

/* 隊伍判定：全隊共同團體（VS 可算支援團；優先非 piapro 的實體團）、全隊同色、有沒有 2 種以上團體 */
export function wpTeamInfo(cards) {
  const poss = cards.map(wpUnits);
  let common = null;
  if (cards.length) {
    for (const u of poss[0]) { if (u !== 'piapro' && poss.every(s => s.includes(u))) { common = u; break; } }
    if (!common && poss.every(s => s.includes('piapro'))) common = 'piapro';
  }
  const sameAttr = cards.length > 0 && cards.every(c => c.attr === cards[0].attr);
  const eff = cards.map(c => common || (c.ch <= 20 ? wpBand(c.ch) : 'piapro'));
  return { common, sameUnit: !!common, sameAttr, mixed: !common, eff };
}
/* 這張卡會吃到的區域道具 %（未乘基礎） */
export function wpItemPct(it, card, eff, T, lv) {
  if (!lv) return 0;
  const [, , , kind, target, b, a, m] = it;
  if (kind === 'char') return target === card.ch ? pctAt(b, lv) : 0;
  if (kind === 'unit' || kind === 'vs') return target === eff ? pctAt(T.sameUnit ? a : b, lv) : 0;
  if (kind === 'attr') return target === card.attr ? pctAt(T.sameAttr ? a : b, lv) : 0;
  if (kind === 'tree') return pctAt(b, lv) + (T.mixed && m.length ? pctAt(m, lv) : 0);
  return 0;
}
/* cfg = { area:{道具 id: 等級}, gate:{團: 等級}, doll:{角色: %}, rank:{角色: 等級}, mr:[五格專精], dollCap: % 或 null, cap, areaMax, gateMax, tree } */
export function wpPower(D, team, cfg) {
  const cards = team.map(id => wpCard(D, id)).filter(Boolean);
  const T = wpTeamInfo(cards);
  const aMax = cfg.areaMax || 20, gMax = cfg.gateMax || D.gate.length;
  const lvOf = it => (it[3] === 'tree' && cfg.tree === false) ? 0 : clamp(Math.round(+((cfg.area || {})[it[0]]) || 0), 0, Math.min(aMax, it[5].length));
  const gate = u => pctAt(D.gate, clamp(Math.round(+((cfg.gate || {})[u]) || 0), 0, gMax));
  const gateTop = Math.max(0, ...WP_UNITS.map(gate));
  const per = cards.map((c, i) => {
    const eff = T.eff[i];
    const mrTab = D.mr[String(c.rar)] || [[0, 0, 0]];
    const mr = mrTab[clamp(Math.round(cfg.mr && cfg.mr[i] != null ? +cfg.mr[i] : 5), 0, mrTab.length - 1)];
    const cv = (WP_CANVAS[c.rar] || 0) / 3;
    const base = [0, 1, 2].map(k => c.b[k] + mr[k] + cv);
    const bsum = Math.round(base[0] + base[1] + base[2]);
    const rk = pctAt(D.rank, clamp(Math.round(+((cfg.rank || {})[c.ch] ?? 50) || 0), 0, 999));
    const rankB = base.reduce((s, v) => s + Math.floor(rk * 0.01 * v), 0);
    const acc = [0, 0, 0];
    let areaPct = 0;
    D.area.forEach(it => { const p = wpItemPct(it, c, eff, T, lvOf(it)); if (p) { areaPct += p; for (let k = 0; k < 3; k++) acc[k] += p * 0.01 * base[k]; } });
    const areaB = acc.reduce((s, v) => s + Math.floor(v + 1e-9), 0);
    const gp = c.ch <= 20 ? gate(wpBand(c.ch)) : gateTop;
    const dRaw = +((cfg.doll || {})[c.ch]) || 0, dp = cfg.dollCap != null ? Math.min(dRaw, cfg.dollCap) : dRaw;
    const myB = Math.floor(bsum * (gp + dp) / 100 + 1e-9);
    return { card: c, base: bsum, rankPct: rk, rankB, areaPct: Math.round(areaPct * 100) / 100, areaB, gatePct: gp, dollPct: dp, myB, total: bsum + rankB + areaB + myB };
  });
  const total = per.reduce((s, p) => s + p.total, 0), cap = cfg.cap || 0;
  return { total, cap, counted: cap ? Math.min(total, cap) : total, over: cap ? Math.max(0, total - cap) : 0, short: cap ? Math.max(0, cap - total) : 0, per, T };
}
/* 這隊用得到的區域道具 id（想いの大樹每隊都吃） */
export function wpRelevant(D, team, cfg) {
  const cards = team.map(id => wpCard(D, id)).filter(Boolean), T = wpTeamInfo(cards);
  return D.area.filter(it => (it[3] !== 'tree' || cfg.tree !== false) && cards.some((c, i) => wpItemPct(it, c, T.eff[i], T, 1) > 0)).map(it => it[0]);
}
export function wpUniform(cfg, ids, lv) { const area = Object.assign({}, cfg.area); ids.forEach(id => { area[id] = lv; }); return Object.assign({}, cfg, { area }); }
/* 在目前設定之外，讓「這隊用得到的區域道具」全部同一級，最低幾級碰得到上限；全滿也不夠回 null */
export function wpMinUniform(D, team, cfg, ids) {
  for (let L = 0; L <= (cfg.areaMax || 20); L++) if (wpPower(D, team, wpUniform(cfg, ids, L)).total >= cfg.cap) return L;
  return null;
}
/* 從目前狀態補到上限：每一步挑「升一級加最多綜合力」的那一項（區域道具或大門），連續同一項合併成一段 */
export function wpPlan(D, team, cfg, ids, maxSteps = 400) {
  let cur = { area: Object.assign({}, cfg.area), gate: Object.assign({}, cfg.gate) };
  const mk = () => Object.assign({}, cfg, cur);
  let p = wpPower(D, team, mk()).total;
  const steps = [];
  while (p < cfg.cap && steps.length < maxSteps) {
    let best = null;
    ids.forEach(id => {
      const lv = +cur.area[id] || 0; if (lv >= (cfg.areaMax || 20)) return;
      const nx = { area: Object.assign({}, cur.area, { [id]: lv + 1 }), gate: cur.gate };
      const g = wpPower(D, team, Object.assign({}, cfg, nx)).total - p;
      if (!best || g > best.g) best = { k: 'a' + id, id, from: lv, nx, g };
    });
    WP_UNITS.forEach(u => {
      const lv = +cur.gate[u] || 0; if (lv >= (cfg.gateMax || D.gate.length)) return;
      const nx = { area: cur.area, gate: Object.assign({}, cur.gate, { [u]: lv + 1 }) };
      const g = wpPower(D, team, Object.assign({}, cfg, nx)).total - p;
      if (!best || g > best.g) best = { k: 'g' + u, u, from: lv, nx, g };
    });
    if (!best || best.g <= 0) break;
    cur = best.nx; p += best.g;
    steps.push({ k: best.k, id: best.id, u: best.u, from: best.from, to: best.from + 1, g: best.g });
  }
  /* 加成一樣的道具會被輪流各升一級（例如五個角色道具），畫面上合併成「每一項從幾級升到幾級」，照第一次出現的先後排 */
  const by = new Map();
  steps.forEach(st => { const o = by.get(st.k); if (o) { o.to = st.to; o.g += st.g; } else by.set(st.k, Object.assign({}, st)); });
  let run = wpPower(D, team, cfg).total;
  const merged = [...by.values()].map(o => { run += o.g; return Object.assign(o, { after: run }); });
  return { steps: merged, reached: p >= cfg.cap, final: p };
}

/* ---------- 後排（支援隊）與終章主隊：規則逐條跟 app.js 的 wlSupCalc／wlsFinaleMain 一樣 ----------
   每張後排卡 ＝ 角色加成（本章角色 specific／其他 others，依稀有度）＋專精＋技能等級＋前幾屆 WL 限定卡對本章角色的固定加成
   入選：角色本團＝本章角色的團，或卡的支援團＝本章團（VS 卡靠這條）；終章不限團，「本章角色」換成主隊隊長的角色
   當期活動卡放前排、不能進後排；WL3 收 25 張。另外只算該期結算前已推出的卡（回頭算以前的期數才準） */
export const WP_SUP_N = 25;
export const wpUnitOf = ch => (ch <= 20 ? wpBand(ch) : 'piapro');
export function wpSupport(D, ev, special, opt = {}) {
  const finale = !!ev[6], ban = new Set(ev[10] || []), until = ev[3] || Infinity;
  const lim = new Map((((ev[11] || {})[String(special)]) || []).map(([id, b]) => [id, b]));
  const chUnit = finale ? null : wpUnitOf(special), own = opt.own || null;
  const mr0 = clamp(Math.round(opt.mr ?? 5), 0, 5), sl0 = clamp(Math.round(opt.sl ?? 4), 1, 4);
  const list = [];
  const add = (id, ch, rar, sup, name, abn, rel) => {
    if (ban.has(id) || (rel && rel > until)) return;
    if (!finale && wpUnitOf(ch) !== chUnit && sup !== chUnit) return;
    let mr = mr0, sl = sl0;
    if (own) { const o = own[id]; if (!o) return; mr = clamp(Math.round(+o[0] || 0), 0, 5); sl = clamp(Math.round(+o[1] || 1), 1, 4); }
    const t = D.sup[String(rar)]; if (!t) return;
    const ex = lim.get(id) || 0;
    const bonus = Math.round(((ch === special ? t[0] : t[1]) + t[2][mr] + t[3][sl - 1] + ex) * 10) / 10;
    list.push({ id, ch, rar, mr, sl, name, abn, bonus, spec: ch === special, lim: ex > 0 });
  };
  for (const [id, c] of Object.entries(D.cards)) add(+id, c[0], c[2], c[3], c[7], c[8], c[9]);
  for (const [id, c] of Object.entries(D.low || {})) add(+id, c[0], c[1], c[2], c[3], c[4], c[5]);
  list.sort((a, b) => b.bonus - a.bonus || a.id - b.id);
  const use = list.slice(0, WP_SUP_N);
  return { use, total: Math.round(use.reduce((s, r) => s + r.bonus, 0) * 10) / 10, pool: list.length, short: Math.max(0, WP_SUP_N - use.length), finale };
}
/* 終章主隊：每張角色加成＋WL3 限定卡（照順序最多計 limMax 張）＋稀有度×專精，加隊內異色；隊長是限定卡、主稱號另計 */
export function wpFinaleMain(D, ev, team, mr, lead, title) {
  const F = ev[12]; if (!F) return null;
  const limSet = new Set((ev[8] || []).map(x => x[0])), E = D.evb || { rar: {}, attr: [] };
  let used = 0;
  const slots = team.map((id, i) => {
    const c = wpCard(D, id) || {}, isLim = limSet.has(id), counted = isLim && used < F.limMax;
    if (counted) used++;
    const rarB = ((E.rar[String(c.rar)] || [])[clamp(Math.round(mr && mr[i] != null ? +mr[i] : 5), 0, 5)]) || 0;
    return { lim: isLim, counted, rarB, sum: F.char + (counted ? F.lim : 0) + rarB };
  });
  const attrN = new Set(team.map(id => (wpCard(D, id) || {}).attr)).size;
  const r1 = v => Math.round(v * 10) / 10;
  const charSum = slots.length * F.char, limSum = slots.reduce((a, x) => a + (x.counted ? F.lim : 0), 0), rarSum = r1(slots.reduce((a, x) => a + x.rarB, 0));
  const attrB = E.attr[attrN - 1] || 0, leaderB = slots[lead] && slots[lead].lim ? F.lead : 0, titleB = title ? F.title : 0;
  const deck = r1(charSum + limSum + rarSum + attrB);
  return { charSum, limSum, rarSum, attrN, attrB, leaderB, titleB, deck, main: r1(deck + leaderB + titleB), limUsed: used, F };
}

export function wpMembers() {
  const KEY = 'sekai-wl3pow';
  const fmtW = v => (v / 10000).toFixed(v >= 1e6 ? 0 : 1) + ' 萬';
  const DOLL_OPTS = Array.from({ length: 21 }, (_, i) => {
    const v = Math.round(i) / 10;
    return { v: String(v), n: v === 0 ? '沒有' : v === 1 ? '1.0%（一套）' : v === 2 ? '2.0%（兩套）' : v.toFixed(1) + '%' };
  });
  return {
    wpInit() {
      if (this.state.wpReady) return;
      import(scData('wl3-power.js')).then(m => {
        this._wp = m.WL3P;
        let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
        const D = this._wp, lim = D.lim;
        const now = Date.now(), evs = D.events;
        const cur = evs.filter(e => e[2] <= now).pop() || evs[evs.length - 1];
        const wp = Object.assign({ ev: cur[0], ti: 0, team: (cur[9][0] || []).slice(), mr: [5, 5, 5, 5, 5], area: {}, gate: {}, doll: {}, rank: {}, ref: 'team', msg: '',
          ch: 0, lead: 0, smr: 5, ssl: 4, spool: 'all', own: null, title: true }, saved || {});
        if (!saved) {   // 第一次：區域道具與大門先帶滿級、玩偶 0、角色等級 50，下面的表會列出其他組合
          D.area.forEach(it => { wp.area[it[0]] = Math.min(lim.area, it[5].length); });
          WP_UNITS.forEach(u => { wp.gate[u] = lim.gate; });
        }
        if (!evs.some(e => e[0] === wp.ev)) { wp.ev = cur[0]; wp.team = (cur[9][0] || []).slice(); }
        this.setState({ wpReady: true, wp });
      }).catch(() => this.setState({ wpErr: 'WL3 計算器的資料載入失敗，請檢查網路後重試。' }));
    },
    wpSet(patch) {
      const wp = Object.assign({}, this.state.wp, patch);
      try { const { msg, ...keep } = wp; localStorage.setItem(KEY, JSON.stringify(keep)); } catch (e) {}
      this.setState({ wp });
    },
    wpCfg(wp) {
      const D = this._wp, lim = D.lim, ev = D.events.find(e => e[0] === wp.ev) || D.events[0];
      return { area: wp.area, gate: wp.gate, doll: wp.doll, rank: wp.rank, mr: wp.mr, cap: ev[4], dollCap: ev[5], areaMax: lim.area, gateMax: lim.gate, tree: lim.tree };
    },
    /* Haruki 專區匯入過的遊戲資料：區域道具、大門、玩偶、角色等級，隊上有的卡帶專精 */
    async wpImport() {
      try {
        const rec = await this.hkSuiteGet();
        const U = rec && rec.suite ? this.hkNormalize(rec.suite, rec.uid) : null;
        if (!U) { this.wpSet({ msg: '這台裝置還沒在 Haruki 專區匯入' + (this.SRV === 'jp' ? '日服' : '台服') + '的遊戲資料，先到 Haruki 專區匯入再回來按一次。' }); return; }
        const area = {}, gate = {}, doll = {}, rank = {};
        (U.userAreas || []).forEach(a => (a.areaItems || []).forEach(i => { const id = +i.areaItemId, l = +i.level || 0; if (id > 0 && l > (area[id] || 0)) area[id] = l; }));
        const GATE = { 1: 'light_sound', 2: 'idol', 3: 'street', 4: 'theme_park', 5: 'school_refusal' };
        (U.userMysekaiGates || []).forEach(g => { if (GATE[g.mysekaiGateId]) gate[GATE[g.mysekaiGateId]] = Math.min(+g.mysekaiGateLevel || 0, this._wp.lim.gate); });   // 現在的日服可到 Lv70，WL3 當時只到 Lv40
        (U.userMysekaiFixtureGameCharacterPerformanceBonuses || []).forEach(f => { doll[f.gameCharacterId] = Math.round((+f.totalBonusRate || 0)) / 10; });
        (U.userCharacters || []).forEach(c => { rank[c.characterId] = +c.characterRank || 0; });
        const own = new Map((U.userCards || []).map(c => [+c.cardId, +c.masterRank || 0]));
        const wp = this.state.wp, mr = wp.team.map((id, i) => (own.has(id) ? own.get(id) : wp.mr[i]));
        /* 後排「我的卡」：每張卡自己的專精與技能等級 */
        const mine = {};
        (U.userCards || []).forEach(c => { if (+c.cardId > 0) mine[+c.cardId] = [+c.masterRank || 0, +c.skillLevel || 1]; });
        this.wpSet({ area, gate, doll, rank, mr, own: mine, msg: '已帶入 Haruki 專區的資料：區域道具 ' + Object.keys(area).length + ' 個、大門 ' + Object.keys(gate).length + ' 扇、玩偶與角色等級；隊上有的卡帶入你的專精，後排也能改用你的 ' + Object.keys(mine).length + ' 張卡。' });
      } catch (e) { this.wpSet({ msg: '讀不到 Haruki 專區的資料：' + ((e && e.message) || e) }); }
    },
    wpVals(s) {
      if (!s.wpReady || !this._wp) return { wpOn: false };
      /* 表格、最低等級與升級順序要跑上千次 wpPower，設定沒變就沿用上一次的結果（整站任何 setState 都會重算畫面） */
      const key = (s.lang || '') + JSON.stringify(s.wp);
      if (this._wpKey === key && this._wpOut) return this._wpOut;
      const out = { wpOn: true };
      const D = this._wp, wp = s.wp, lim = D.lim;
      /* 日文、英文介面用日服原名（[8]、[9]），中文介面用台服名 */
      const jpN = s.lang === 'ja' || s.lang === 'en', nm = it => (jpN && it[8]) || it[1], whr = it => (jpN && it[9]) || it[2];
      const ev = D.events.find(e => e[0] === wp.ev) || D.events[0];
      const cfg = this.wpCfg(wp), team = wp.team.filter(id => D.cards[String(id)]);
      const R = wpPower(D, team, cfg), ids = wpRelevant(D, team, cfg);
      const chip = on => on ? { bg: 'var(--ink-grad)', fg: '#fff', bd: 'transparent' } : { bg: 'var(--card)', fg: 'var(--text-2)', bd: 'var(--border)' };
      const AT = a => this.SM_ATTR[a] || [a, 'var(--text-3)'];
      const lvOpts = mx => [{ v: '0', n: '沒有／未升' }].concat(Array.from({ length: mx }, (_, i) => ({ v: String(i + 1), n: 'Lv' + (i + 1) })));
      const fd = t => { const d = new Date(t); return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate(); };

      out.wpEvs = D.events.map(e => Object.assign({ v: String(e[0]), n: (e[6] ? '終章・' : '第 ' + e[0] + ' 期・') + e[1], on: e[0] === wp.ev }, chip(e[0] === wp.ev)));
      out.wpEvInfo = '日服 ' + fd(ev[2]) + ' – ' + fd(ev[3]) + '・總合力上限 ' + this.n(ev[4]) + (ev[5] != null ? '・玩偶上限 ' + ev[5] + '%' : '')
        + (ev[6] ? '・終章：WL3 限定卡加成 25%（最多計 4 張），隊長是限定卡再 +20%' : '・章節角色：' + ev[7].map(c => WP_CHARS[c[1]] || '#' + c[1]).join('、') + '；活動卡加成 30%');
      out.wpTeams = ev[9].length > 1 ? ev[9].map((t, i) => {
        const on = JSON.stringify(t) === JSON.stringify(team);
        const diff = t.filter(id => !ev[9][0].includes(id)).map(id => WP_CHARS[D.cards[String(id)][0]]);
        return Object.assign({ v: String(i), n: '組合 ' + (i + 1) + (i === 0 ? '（綜合力最高）' : diff.length ? '（換：' + diff.join('、') + '）' : ''), on }, chip(on));
      }) : [];
      out.wpHasTeams = out.wpTeams.length > 0;

      /* 後排（支援隊）：章節選本章角色；終章選主隊隊長（決定後排的「本章角色」與隊長加成） */
      const fin = !!ev[6], chs = ev[7] || [], ownMode = wp.spool === 'own', hasOwn = !!(wp.own && Object.keys(wp.own).length);
      const chI = clamp(+wp.ch || 0, 0, Math.max(0, chs.length - 1)), lead = clamp(+wp.lead || 0, 0, Math.max(0, team.length - 1));
      const special = fin ? (wpCard(D, team[lead]) || {}).ch : (chs[chI] || [])[1];
      const S = special ? wpSupport(D, ev, special, { mr: wp.smr ?? 5, sl: wp.ssl ?? 4, own: ownMode ? (wp.own || {}) : null }) : null;
      const M = fin ? wpFinaleMain(D, ev, team, cfg.mr, lead, wp.title !== false) : null;
      const pct = v => (Math.round(v * 10) / 10) + '%';
      const RAR = { 1: '★1', 2: '★2', 3: '★3', 4: '★4', 9: '生日' };
      out.wpIsFin = fin; out.wpHasChs = !fin && chs.length > 0;
      out.wpChs = fin ? [] : chs.map(([no, c], i) => Object.assign({ v: String(i), n: '第 ' + no + ' 章・' + (WP_CHARS[c] || '#' + c), on: i === chI }, chip(i === chI)));
      out.wpLeads = fin ? team.map((id, i) => Object.assign({ v: String(i), n: WP_CHARS[(wpCard(D, id) || {}).ch] || '#' + id, on: i === lead }, chip(i === lead))) : [];
      out.wpSpAll = chip(!ownMode); out.wpSpOwn = chip(ownMode); out.wpSupOwn = ownMode; out.wpNotOwn = !ownMode;
      out.wpSmr = String(wp.smr ?? 5); out.wpSsl = String(wp.ssl ?? 4);
      out.wpSmrOpts = [5, 4, 3, 2, 1, 0].map(v => ({ v: String(v), n: '後排全部專精 ' + v }));
      out.wpSslOpts = [4, 3, 2, 1].map(v => ({ v: String(v), n: '後排全部技能 Lv' + v }));
      out.wpSupMsg = ownMode && !hasOwn ? '還沒帶入你的卡：按下面「你的狀態」的「從 Haruki 專區帶入」，後排就會用你實際持有的卡與各自的專精、技能等級來排。' : '';
      out.wpSupHasMsg = !!out.wpSupMsg;
      out.wpSupOn = !!S;
      out.wpSupTotal = S ? '+' + pct(S.total) : '—';
      out.wpSupWho = special ? (fin ? '隊長：' : '本章角色：') + (WP_CHARS[special] || '#' + special) : '';
      out.wpSupSub = S ? (S.use.length + ' 張' + (S.short ? '（符合條件的卡只有 ' + S.use.length + ' 張，還空 ' + S.short + ' 格）' : '') + '・' + (ownMode ? '用你的卡與各自的專精、技能等級' : '全部卡都當成持有')) : '';
      out.wpSupList = S ? S.use.map((r, i) => ({ n: String(i + 1), img: this.cardImg(r.abn, r.rar), name: r.name || '#' + r.id, ch: WP_CHARS[r.ch] || '#' + r.ch, rar: RAR[r.rar] || '',
        b: '+' + pct(r.bonus), mark: r.lim ? '限定卡 +20' : r.spec ? (fin ? '隊長角色' : '本章角色') : '', hasMark: r.lim || r.spec, mrsl: ownMode ? '專精 ' + r.mr + '・技能 Lv' + r.sl : '' })) : [];
      out.wpSupNote = fin ? '終章後排不限團體；跟隊長同角色的卡多 5%。當期活動卡要放主隊，不能放後排；只算這期結算前已推出的卡。'
        : '只收本章角色同團的卡，VS 卡要支援這團才算；本章角色的卡多 5%，前幾屆的 WL 限定卡另加 +20%。當期活動卡要放主隊，不能放後排；只算這期結算前已推出的卡。';
      out.wpFinOn = !!M;
      if (M) {
        out.wpTitleOn = chip(wp.title !== false); out.wpTitleOff = chip(wp.title === false);
        out.wpFinRows = [
          { k: '角色加成（每張 ' + M.F.char + '%）', v: '+' + pct(M.charSum) },
          { k: 'WL3 限定卡（每張 ' + M.F.lim + '%，最多計 ' + M.F.limMax + ' 張）', v: '+' + pct(M.limSum) },
          { k: '稀有度×專精', v: '+' + pct(M.rarSum) },
          { k: '隊內 ' + M.attrN + ' 種屬性', v: '+' + pct(M.attrB) },
          { k: '隊長是 WL3 限定卡', v: '+' + pct(M.leaderB) },
          { k: '主稱號（隊長角色那一章的排名稱號）', v: '+' + pct(M.titleB) },
        ];
        out.wpFinMain = '+' + pct(M.main); out.wpFinSup = S ? '+' + pct(S.total) : '—';
        out.wpFinTotal = '+' + pct(M.main + (S ? S.total : 0));
      }
      out.wpBonusLine = !S ? '' : fin && M ? '活動加成 ' + pct(M.main + S.total) + '（主隊 ' + pct(M.main) + '＋後排 ' + pct(S.total) + '）'
        : '後排加成 +' + pct(S.total) + '（' + out.wpSupWho + '）';

      out.wpSlots = R.per.map((p, i) => {
        const c = p.card, at = AT(c.attr);
        const same = Object.entries(D.cards).filter(([, x]) => x[0] === c.ch).map(([id, x]) => ({ id: +id, s: x[4] + x[5] + x[6] + (WP_CANVAS[x[2]] || 0), x }))
          .sort((a, b) => b.s - a.s).slice(0, 40);
        const evIds = new Set(ev[8].map(x => x[0]));
        return { i: String(i), img: this.cardImg(c.abn, c.rar), ch: WP_CHARS[c.ch] || '#' + c.ch, at: at[0], atC: at[1], tag: c.rar === 9 ? '生日' : '★4', name: c.name,
          ev: evIds.has(c.id), mr: String(cfg.mr[i] != null ? cfg.mr[i] : 5), base: this.n(p.base), total: this.n(p.total),
          mrOpts: [0, 1, 2, 3, 4, 5].map(v => ({ v: String(v), n: '專精 ' + v })),
          card: String(c.id), cardOpts: same.map(o => ({ v: String(o.id), n: (evIds.has(o.id) ? '【活動卡】' : '') + o.x[7] + '・' + this.n(o.s) + '・' + AT(o.x[1])[0] })) };
      });

      /* 結果 */
      out.wpTotal = this.n(R.total); out.wpCap = this.n(R.cap); out.wpOk = R.total >= R.cap; out.wpNotOk = !out.wpOk;
      out.wpBar = Math.min(100, R.total / R.cap * 100).toFixed(1) + '%';
      out.wpBarC = out.wpOk ? '#3ec49a' : 'var(--accent)';
      out.wpShortTxt = out.wpOk ? '已達上限' : '還差 ' + this.n(R.short);
      out.wpStatus = out.wpOk ? '已碰到上限 ' + this.n(R.cap) + '，多出的 ' + this.n(R.over) + ' 不計分——再往上練綜合力也沒有用。' : '還差 ' + this.n(R.short) + '（' + (R.short / R.cap * 100).toFixed(1) + '%）才碰到上限 ' + this.n(R.cap) + '。';
      out.wpTeamNote = (R.T.sameUnit ? '全隊同團（' + (WP_UNIT_NAME[R.T.common] || R.T.common) + '）：團體道具翻倍' : '混團：團體道具不翻倍' + (cfg.tree ? '，想いの大樹吃兩份（全角色＋2 種以上團體）' : ''))
        + '；' + (R.T.sameAttr ? '全隊同色：屬性道具翻倍' : '五色：屬性道具不翻倍') + '。';
      out.wpRows = R.per.map(p => ({ ch: WP_CHARS[p.card.ch], base: this.n(p.base), rank: '+' + this.n(p.rankB), rankP: p.rankPct + '%', area: '+' + this.n(p.areaB), areaP: p.areaPct + '%',
        my: '+' + this.n(p.myB), myP: (Math.round((p.gatePct + p.dollPct) * 10) / 10) + '%', total: this.n(p.total) }));
      const sum = k => R.per.reduce((t, p) => t + p[k], 0);
      out.wpSum = { base: this.n(sum('base')), rank: '+' + this.n(sum('rankB')), area: '+' + this.n(sum('areaB')), my: '+' + this.n(sum('myB')), total: this.n(R.total) };

      /* 設定：快速全設、逐項區域道具、大門、玩偶、角色等級 */
      out.wpAreaOpts = [{ v: '', n: '這隊用得到的區域道具全部設成…' }].concat(lvOpts(lim.area).map(o => ({ v: o.v, n: o.v === '0' ? '全部 0' : '全部 ' + o.n })));
      out.wpGateOpts = [{ v: '', n: '五扇大門全部設成…' }].concat(Array.from({ length: lim.gate + 1 }, (_, i) => ({ v: String(i), n: '全部 Lv' + i })));
      out.wpDollAll = [{ v: '', n: '隊上角色的玩偶全部設成…' }].concat(DOLL_OPTS.map(o => ({ v: o.v, n: '全部 ' + o.n })));
      out.wpRankAll = [{ v: '', n: '隊上角色等級全部設成…' }].concat([1, 10, 20, 30, 40, 50].map(v => ({ v: String(v), n: '全部 Lv' + v + (v === 50 ? ' 以上（5%）' : '（' + (v / 10) + '%）') })));
      const groups = [['char', '角色道具', '只加那位角色'], ['unit', '團體道具', '加卡片所屬團體' + (R.T.sameUnit ? '（全隊同團：翻倍）' : '')],
        ['vs', '虛擬歌手團體道具', 'VS 卡在混團裡算 VIRTUAL SINGER'], ['attr', '屬性道具', '加卡片屬性' + (R.T.sameAttr ? '（全隊同色：翻倍）' : '')], ['tree', '想いの大樹', '全角色；2 種以上團體再一份']];
      const relSet = new Set(ids);
      const tgtName = it => it[3] === 'char' ? (WP_CHARS[it[4]] || '#' + it[4]) : it[3] === 'attr' ? AT(it[4])[0] : it[3] === 'tree' ? '全角色' : (WP_UNIT_NAME[it[4]] || it[4]);
      out.wpGroups = groups.map(([k, n, note]) => ({ n, note, rows: D.area.filter(it => it[3] === k && relSet.has(it[0])).map(it => {
        const lv = clamp(+wp.area[it[0]] || 0, 0, lim.area);
        const gain = R.per.reduce((t, p, i) => t + wpItemPct(it, p.card, R.T.eff[i], R.T, lv), 0);
        return { id: String(it[0]), name: nm(it), where: whr(it), tgt: tgtName(it), lv: String(lv), opts: lvOpts(Math.min(lim.area, it[5].length)), pct: lv ? '+' + (Math.round(gain * 100) / 100) + '%' : '—' };
      }) })).filter(g => g.rows.length);
      const used = new Set(R.per.map(p => (p.card.ch <= 20 ? wpBand(p.card.ch) : '')));
      const hasVs = R.per.some(p => p.card.ch > 20);
      out.wpGates = WP_UNITS.map(u => ({ u, n: WP_UNIT_NAME[u], lv: String(clamp(+wp.gate[u] || 0, 0, lim.gate)), opts: Array.from({ length: lim.gate + 1 }, (_, i) => ({ v: String(i), n: 'Lv' + i + '（' + pctAt(D.gate, i) + '%）' })),
        use: used.has(u) ? '隊上有這團的卡' : (hasVs ? 'VS 卡吃最高的那扇' : '這隊用不到') }));
      out.wpDolls = R.per.map(p => ({ ch: String(p.card.ch), n: WP_CHARS[p.card.ch], v: String(Math.round((+wp.doll[p.card.ch] || 0) * 10) / 10), opts: DOLL_OPTS,
        capped: cfg.dollCap != null && (+wp.doll[p.card.ch] || 0) > cfg.dollCap }));
      out.wpDollCapNote = cfg.dollCap != null ? '這一期玩偶加成上限 ' + cfg.dollCap + '%，超過的不算。' : '玩偶：一套 S／M／L ＝ 0.1＋0.3＋0.6 ＝ 1.0%，只加那位角色。';
      out.wpRanks = R.per.map(p => ({ ch: String(p.card.ch), n: WP_CHARS[p.card.ch], v: String(clamp(+(wp.rank[p.card.ch] ?? 50) || 0, 1, 50)),
        opts: Array.from({ length: 50 }, (_, i) => ({ v: String(i + 1), n: 'Lv' + (i + 1) + (i === 49 ? ' 以上' : '') + '（' + pctAt(D.rank, i + 1) + '%）' })) }));
      out.wpMsg = wp.msg || ''; out.wpHasMsg = !!wp.msg;

      /* 哪些組合碰得到上限：列＝區域道具統一等級，欄＝大門 × 玩偶 */
      const gCols = [0, Math.round(lim.gate / 2), lim.gate];
      const cols = [];
      gCols.forEach(g => [0, 1, 2].forEach(d => cols.push({ g, d })));
      const withGD = (c, g, d) => Object.assign({}, c, { gate: Object.fromEntries(WP_UNITS.map(u => [u, g])), doll: Object.fromEntries(R.per.map(p => [p.card.ch, d])) });
      const levels = [];
      for (let L = Math.max(1, lim.area - 10); L <= lim.area; L++) levels.push(L);
      out.wpMxCols = cols.map(c => ({ n: '門 ' + c.g, d: c.d ? c.d + ' 套娃' : '無娃' }));
      out.wpMxGrid = 'grid-template-columns:64px repeat(' + cols.length + ',minmax(58px,1fr))';
      out.wpMxRows = levels.map(L => ({ L: 'Lv' + L, cells: cols.map(c => {
        const t = wpPower(D, team, wpUniform(withGD(cfg, c.g, c.d), ids, L)).total, ok = t >= R.cap;
        return { v: fmtW(t), bg: ok ? 'color-mix(in oklab,#3ec49a 22%,var(--card))' : 'transparent', fg: ok ? 'var(--ink)' : 'var(--text-3)', w: ok ? '800' : '500' };
      }) }));
      out.wpMxMin = cols.map(c => { const L = wpMinUniform(D, team, withGD(cfg, c.g, c.d), ids); return { v: L == null ? '不夠' : 'Lv' + L }; });
      out.wpMxNote = '假設這隊用得到的區域道具全部同一級（列）、五扇大門同一級、隊上每位角色的玩偶一樣多（欄）；角色等級與專精照上面的設定。綠底＝碰得到 ' + this.n(R.cap) + '。';

      /* 從目前狀態補到上限的升級順序 */
      const P = out.wpOk ? null : wpPlan(D, team, cfg, ids);
      const itemName = id => { const it = D.area.find(a => a[0] === id); return it ? nm(it) + '（' + tgtName(it) + '）' : '#' + id; };
      out.wpPlan = P ? P.steps.slice(0, 20).map(st => ({ n: st.u ? WP_UNIT_NAME[st.u] + ' 大門' : itemName(st.id), lv: 'Lv' + st.from + ' → ' + st.to, g: '+' + this.n(st.g), after: this.n(st.after) })) : [];
      out.wpHasPlan = !!(P && P.steps.length);
      out.wpPlanNote = !P ? '' : P.reached ? '照這個順序升，最後一步就碰到上限（每一步都挑「升一級加最多綜合力」的那一項，不考慮素材難易）。'
        : '區域道具與大門全部升到目前上限也只有 ' + this.n(P.final) + '，還差 ' + this.n(R.cap - P.final) + '：要靠玩偶、角色等級、專精或換更強的卡。';

      /* 所有區域道具的各等級 */
      const showAll = wp.ref === 'all';
      out.wpRefTeam = !showAll; out.wpRefAll = showAll;
      const lvN = Math.min(lim.area, 20);
      out.wpRefHead = Array.from({ length: lvN }, (_, i) => ({ n: 'Lv' + (i + 1) }));
      out.wpRefGrid = 'grid-template-columns:170px repeat(' + lvN + ',minmax(52px,1fr))';
      out.wpRef = D.area.filter(it => (showAll || relSet.has(it[0])) && (it[3] !== 'tree' || lim.tree)).map(it => {
        const hasA = it[6].some((v, i) => v !== it[5][i]);
        return { name: nm(it), where: whr(it), tgt: tgtName(it), kind: { char: '角色', unit: '團體', vs: 'VS 團體', attr: '屬性', tree: '大樹' }[it[3]],
          cells: Array.from({ length: lvN }, (_, i) => {
            const b = pctAt(it[5], i + 1), a = pctAt(it[6], i + 1), m = pctAt(it[7], i + 1);
            return { v: it[3] === 'tree' ? b + (m ? '+' + m : '') : hasA ? b + '／' + a : String(b) };
          }) };
      });
      out.wpRefNote = '單位 %。團體與屬性道具：平常／全隊同團或同色。資料：日服 master 整理於 ' + fd(D.built) + '。';
      this._wpKey = key; this._wpOut = out;
      return out;
    },
    wpHandlers() {
      const num = e => +e.currentTarget.value;
      return {
        onWpEv: e => { const D = this._wp, id = +e.currentTarget.dataset.v, ev = D.events.find(x => x[0] === id); if (ev) this.wpSet({ ev: id, ti: 0, team: (ev[9][0] || []).slice(), mr: [5, 5, 5, 5, 5], ch: 0, lead: 0, msg: '' }); },
        onWpTeam: e => { const D = this._wp, ev = D.events.find(x => x[0] === this.state.wp.ev), i = +e.currentTarget.dataset.v; if (ev && ev[9][i]) this.wpSet({ ti: i, team: ev[9][i].slice() }); },
        onWpCard: e => { const i = +e.currentTarget.dataset.i, team = this.state.wp.team.slice(); team[i] = num(e); this.wpSet({ team }); },
        onWpMr: e => { const i = +e.currentTarget.dataset.i, mr = this.state.wp.mr.slice(); mr[i] = num(e); this.wpSet({ mr }); },
        onWpArea: e => this.wpSet({ area: Object.assign({}, this.state.wp.area, { [e.currentTarget.dataset.id]: num(e) }) }),
        onWpGate: e => this.wpSet({ gate: Object.assign({}, this.state.wp.gate, { [e.currentTarget.dataset.u]: num(e) }) }),
        onWpDoll: e => this.wpSet({ doll: Object.assign({}, this.state.wp.doll, { [e.currentTarget.dataset.ch]: num(e) }) }),
        onWpRank: e => this.wpSet({ rank: Object.assign({}, this.state.wp.rank, { [e.currentTarget.dataset.ch]: num(e) }) }),
        onWpAreaAll: e => { if (e.currentTarget.value === '') return; const wp = this.state.wp, ids = wpRelevant(this._wp, wp.team, this.wpCfg(wp)); this.wpSet(wpUniform({ area: wp.area }, ids, num(e))); },
        onWpGateAll: e => { if (e.currentTarget.value === '') return; this.wpSet({ gate: Object.fromEntries(WP_UNITS.map(u => [u, num(e)])) }); },
        onWpDollAll: e => { if (e.currentTarget.value === '') return; const D = this._wp, doll = Object.assign({}, this.state.wp.doll); this.state.wp.team.forEach(id => { const c = wpCard(D, id); if (c) doll[c.ch] = num(e); }); this.wpSet({ doll }); },
        onWpRankAll: e => { if (e.currentTarget.value === '') return; const D = this._wp, rank = Object.assign({}, this.state.wp.rank); this.state.wp.team.forEach(id => { const c = wpCard(D, id); if (c) rank[c.ch] = num(e); }); this.wpSet({ rank }); },
        onWpImport: () => this.wpImport(),
        onWpRef: e => this.wpSet({ ref: e.currentTarget.dataset.v === 'all' ? 'all' : 'team' }),
        onWpCh: e => this.wpSet({ ch: +e.currentTarget.dataset.v || 0 }),
        onWpLead: e => this.wpSet({ lead: +e.currentTarget.dataset.v || 0 }),
        onWpSpool: e => this.wpSet({ spool: e.currentTarget.dataset.v === 'own' ? 'own' : 'all' }),
        onWpSmr: e => this.wpSet({ smr: num(e) }),
        onWpSsl: e => this.wpSet({ ssl: num(e) }),
        onWpTitle: e => this.wpSet({ title: e.currentTarget.dataset.v !== 'off' }),
        onWpReset: () => { const D = this._wp, lim = D.lim, area = {}, gate = {}; D.area.forEach(it => { area[it[0]] = Math.min(lim.area, it[5].length); }); WP_UNITS.forEach(u => { gate[u] = lim.gate; }); this.wpSet({ area, gate, doll: {}, rank: {}, mr: [5, 5, 5, 5, 5], msg: '已重設：區域道具與大門滿級、玩偶 0、角色等級 50、專精 5。' }); },
      };
    },
  };
}
