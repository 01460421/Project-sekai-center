/* ---------- 活動回顧（page=recap）與預測準確度（page=accuracy） ----------
   做法同 haruki.js／car.js／maker.js：匯出一個回傳成員物件的函式，App 進這兩頁時 loadRecapMod() 動態載入後
   Object.assign 到實例上，方法裡的 this 就是 App。主程式（app.min.js）不再帶這 220 行，只有看回顧的人才下載。
   回顧讀 data/history/<期數>.json（公用時序，結算後就是完整的）、BORDERS_DB 的官方終線與歷屆對照、
   data/border-accuracy.json 的留一法預測、以及這台裝置自己記的快照（我的分數）。
   準確度資料由 tools/build-border-accuracy.py 每天產：每一期都用「沒看過它」的模型在 25／50／75／90% 進度預測，
   跟官方終線比，另附線性外推與賽前先驗兩個對照組。
   模板在 app.html 的 isRecap／isAccuracy 兩段；按鈕的處理函式仍在 app.js 的 handlers（它們呼叫這裡的 loadRecap）。 */
export function recapMembers() {
  return {
    RECAP_TIERS: [100, 500, 1000, 2000, 5000, 10000, 50000],
    async loadAccuracy() {
      if (this._accP) return this._accP;
      this._accP = fetch('data/border-accuracy.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null)
        .then(d => { this.setState({ accData: d || { missing: true } }); return d; })
        .catch(() => { this._accP = null; this.setState({ accData: { missing: true } }); return null; });
      return this._accP;
    },
    async loadRecap(id) {
      this.loadBorderDB(); this.loadEvInfo(); this.loadAccuracy();
      try {
        if (!this._histIdx) this._histIdx = await fetch(this.HIST + '/index.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : []).catch(() => []);
      } catch (e) { this._histIdx = []; }
      const ids = (this._histIdx || []).map(Number).filter(Boolean).sort((a, b) => b - a);
      let want = +(id || this.state.recapEv) || 0;
      if (!ids.includes(want)) want = 0;
      this._recapCache = this._recapCache || {};
      const now = Date.now();
      const ended = h => h && h.aggregateAt && Date.parse(h.aggregateAt) + 3600e3 < now;
      const get = async i => {
        if (!this._recapCache[i]) this._recapCache[i] = fetch(this.HIST + '/' + i + '.json', { cache: 'force-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
        return this._recapCache[i];
      };
      this.setState({ recapLoad: true, recapErr: '', recapIds: ids });
      try {
        if (!want) {   // 預設最近一期已結算的（最新的那期通常還在進行中）
          for (const i of ids) { const h = await get(i); if (ended(h)) { want = i; break; } }
          if (!want) want = ids[0] || 0;
        }
        const h = want ? await get(want) : null;
        if (!h) throw new Error('沒有這一期的榜線紀錄');
        this.setState({ recapLoad: false, recapEv: String(want), recapHist: h });
      } catch (e) {
        this.setState({ recapLoad: false, recapErr: (e && e.message) || '載入失敗' });
      }
    },
    /* 某一期的時序整理成圖表用的列：[[ms, {tier: score}]]，先修單調 */
    recapRows(h) {
      if (this._recapRowsFor === h) return this._recapRows;
      const tiers = h.tiers || [];
      const fixed = this.fixMono(this.histT100(h), tiers.length);
      this._recapRowsFor = h;
      this._recapRows = fixed.map(s => { const o = {}; tiers.forEach((t, i) => { if (s[i + 1] != null) o[t] = s[i + 1]; }); return [s[0] * 1000, o]; });
      return this._recapRows;
    },
    recapVals(s) {
      const h = s.recapHist, pid = s.pid;
      const ids = s.recapIds || [];
      const DB = (typeof BORDERS_DB !== 'undefined') ? BORDERS_DB : null;
      const ei = this.eiRows ? this.eiRows() : [];
      const nameOf = i => { const e = ei.find(x => x.id === i) || (DB && (DB.events || []).find(x => +x.id === i)); return e ? e.name : ''; };
      const chipSt = on => on ? { bg: 'var(--ink-grad)', fg: '#fff', bd: 'transparent' } : { bg: 'var(--card)', fg: 'var(--text-2)', bd: 'var(--border)' };
      const chips = ids.map(i => Object.assign({ v: String(i), n: '第 ' + i + ' 期' + (nameOf(i) ? '　' + nameOf(i) : ''), on: String(i) === String(s.recapEv) }, chipSt(String(i) === String(s.recapEv))));
      const out = { recapLoad: !!s.recapLoad, recapErr: s.recapErr || '', recapHas: !!h, recapChips: chips, recapIsJp: this.SRV === 'jp' };
      if (!h) return out;
      const id = +h.eventId, now = Date.now();
      const st = Date.parse(h.startAt), en = Date.parse(h.aggregateAt), days = (en - st) / 86400e3;
      const dbEv = DB && (DB.events || []).find(e => +e.id === id);
      const eiEv = ei.find(e => e.id === id);
      const type = eiEv ? (this.DV_EV_TYPES[eiEv.type] || [eiEv.type])[0] : (dbEv ? dbEv.type : '');
      const unit = eiEv ? (eiEv.unit ? this.UNITS[eiEv.unit].n : (eiEv.type === 'world_bloom' ? 'World Link' : '混活')) : (dbEv ? dbEv.unit : '');
      const fd = ms => { const t = new Date(ms); return (t.getMonth() + 1) + '/' + t.getDate() + ' ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'); };
      out.recapTitle = h.name || ('第 ' + id + ' 期'); out.recapNo = '第 ' + id + ' 期'; out.recapMeta = [type, unit, days.toFixed(2) + ' 天'].filter(Boolean).join('・');
      out.recapRange = fd(st) + ' – ' + fd(en); out.recapEnded = en + 3600e3 < now; out.recapLive = !out.recapEnded;
      out.recapLogo = eiEv && eiEv.abn ? this.ASSET + '/event/' + eiEv.abn + '/logo/logo.webp' : ''; out.recapHasLogo = !!out.recapLogo;
      const rows = this.recapRows(h), last = rows.length ? rows[rows.length - 1][1] : {};
      const dbB = DB && (DB.borders || []).find(b => +b.id === id);
      const ref = this.bdbRef(id);
      const acc = s.accData && s.accData.events ? s.accData.events.find(e => +e.id === id) : null;
      const accT = spec => acc ? (acc.tiers || []).find(t => t.spec === spec) : null;
      const tiers = this.RECAP_TIERS.filter(t => (h.tiers || []).includes(t));
      const pct = (a, b) => (!a || !b) ? '' : ((a / b - 1) >= 0 ? '+' : '') + ((a / b - 1) * 100).toFixed(1) + '%';
      out.recapTiers = tiers.map(t => {
        const i = DB ? (DB.tiers || []).indexOf(t) : -1;
        const official = dbB && i >= 0 && dbB.t && dbB.t[i] ? dbB.t[i] : null;
        const fin = official || last[t] || null;
        const r = ref && ref.by[t];
        const a = accT('T' + t), p50 = a && a.at && a.at['0.5'];
        return { t: 'T' + this.n(t), final: fin ? this.n(fin) : '—', src: official ? '官方' : (fin ? '最後快照' : ''),
          ref: r ? this.short(r.med) : '—', refPct: r && fin ? pct(fin, r.med) : '', refColor: r && fin ? (fin >= r.med ? '#e0576a' : '#2fb37a') : 'var(--text-3)',
          pred: p50 ? this.short(p50.pred) : '—', predErr: p50 && fin ? pct(p50.pred, fin) : '', on: +s.recapTier === t, v: String(t), ...chipSt(+s.recapTier === t) };
      });
      out.recapRefNote = ref ? ('歷屆：同型態同日數的前 ' + ref.n + ' 期（半衰期加權）') : '歷屆：同型態同日數的樣本不足 3 期';
      out.recapAccNote = acc ? '預測：活動進行到 50% 時、沒看過這一期的模型給的終線' : '預測：這一期還沒有留一法回測資料';
      // 走勢圖與每日增量（選定段位）
      const tier = tiers.includes(+s.recapTier) ? +s.recapTier : (tiers.includes(1000) ? 1000 : tiers[0]);
      out.recapTierName = 'T' + this.n(tier);
      const list = rows.map(r => r[1][tier] != null ? [r[0], r[1][tier]] : null).filter(Boolean);
      out.recapChartOk = list.length >= 2;
      if (out.recapChartOk) {
        const c = this.mkChart(list, { key: 'recap' });
        Object.keys(c).forEach(k => { out['recapC' + k[0].toUpperCase() + k.slice(1)] = c[k]; });
        const at = ms => { let v = null; for (const x of list) { if (x[0] <= ms) v = x[1]; else break; } return v; };
        const nd = Math.ceil(days), bars = [];
        for (let d = 0; d < nd; d++) {
          const a = d === 0 ? (at(st) || 0) : at(st + d * 86400e3), b = at(Math.min(en, st + (d + 1) * 86400e3));   // 開跑那一刻每個段位都是 0
          bars.push(a != null && b != null ? b - a : null);
        }
        const mx = Math.max(1, ...bars.filter(x => x != null));
        out.recapDays = bars.map((g, d) => ({ d: '第 ' + (d + 1) + ' 天', g: g == null ? '—' : this.short(g), w: g == null ? '2%' : Math.max(2, Math.round(g / mx * 100)) + '%', tip: g == null ? '沒有紀錄' : this.n(g) }));
        const lastDay = bars[bars.length - 1], avg = bars.filter(x => x != null).reduce((a, b) => a + b, 0) / Math.max(1, bars.filter(x => x != null).length);
        out.recapDayNote = lastDay != null && avg ? ('最後一天漲 ' + this.short(lastDay) + '，是平均每天的 ' + (lastDay / avg).toFixed(1) + ' 倍') : '';
      }
      // 前百
      const rk = h.ranks || [], rl = rk.length ? rk[rk.length - 1] : null;
      out.recapTop1 = rl && rl[1] ? this.n(rl[1]) : '—'; out.recapTop100 = rl && rl[100] ? this.n(rl[100]) : (last[100] ? this.n(last[100]) : '—');
      const ro = h.roster || [];
      if (ro.length >= 2) {
        const fin = ro[ro.length - 1], tEnd = fin[0] * 1000;
        let before = null; for (const r of ro) { if (r[0] * 1000 <= tEnd - 86400e3) before = r; else break; }
        if (before) { const was = new Set(before.slice(1)); out.recapIn24 = fin.slice(1).filter(u => !was.has(u)).length + ' 人'; }
        const allU = new Set(); ro.forEach(r => r.slice(1).forEach(u => allU.add(u)));
        out.recapEverTop = allU.size + ' 人';
      }
      // 我的這期：先看公用前百名單（有名次與分數），再看這台裝置自己記的快照
      out.recapMe = null; out.recapMeHas = false;
      if (pid) {
        const ui = (h.users || []).findIndex(u => this.sameUid(u, pid));
        const sAt = {}; rk.forEach(r => { sAt[r[0]] = r; });
        const rank = [], score = [];
        if (ui >= 0) ro.forEach(r => { const pos = r.indexOf(ui, 1); if (pos < 1) return; rank.push([r[0] * 1000, pos]); const sr = sAt[r[0]]; if (sr && sr[pos] != null) score.push([r[0] * 1000, sr[pos]]); });
        let local = [];
        try { local = JSON.parse(localStorage.getItem(this.snapKey(id)) || '[]') || []; } catch (e) { local = []; }
        const ls = local.filter(x => x[2] != null).map(x => [x[0], x[2]]);
        const useScore = score.length >= 2 ? score : ls;
        if (rank.length >= 2 || useScore.length >= 2) {
          out.recapMeHas = true;
          const finalRank = rank.length ? rank[rank.length - 1][1] : null, best = rank.length ? Math.min(...rank.map(x => x[1])) : null;
          out.recapMeFinal = finalRank ? ('第 ' + finalRank + ' 名') : (ls.length ? '前百以外' : '—');
          out.recapMeBest = best ? ('最高第 ' + best + ' 名') : '';
          out.recapMeScore = useScore.length ? this.n(useScore[useScore.length - 1][1]) : '—';
          out.recapMeSrc = rank.length >= 2 ? '來源：公用前百名單（只涵蓋你在前百的時段）' : '來源：這台裝置開著網站時記下的分數';
          out.recapMeChartOk = useScore.length >= 2;
          if (out.recapMeChartOk) { const c = this.mkChart(useScore, { key: 'recapme' }); Object.keys(c).forEach(k => { out['recapM' + k[0].toUpperCase() + k.slice(1)] = c[k]; }); }
          out.recapMeRankOk = rank.length >= 2;
          if (out.recapMeRankOk) { const c = this.mkChart(rank, { key: 'recaprk', invert: true, fmt: v => '#' + v }); Object.keys(c).forEach(k => { out['recapR' + k[0].toUpperCase() + k.slice(1)] = c[k]; }); }
        }
      }
      out.recapMeNone = !!pid && !out.recapMeHas; out.recapNoPid = !pid;
      // 預測 vs 實際（留一法）
      const taus = (s.accData && s.accData.taus) || [0.25, 0.5, 0.75, 0.9];
      out.recapAccHas = !!acc;
      out.recapAccHead = taus.map(t => Math.round(t * 100) + '%');
      const specs = ['T100', 'T500', 'T1000', 'T2000', 'T5000', 'T10000', 'R1', 'R10', 'R50'];
      out.recapAcc = !acc ? [] : specs.map(sp => { const rec = (sp[0] === 'R' ? acc.ranks : acc.tiers || []).find(x => x.spec === sp); if (!rec) return null;
        return { spec: sp[0] === 'R' ? '第 ' + sp.slice(1) + ' 名' : sp, final: this.short(rec.final), cells: taus.map(t => { const p = rec.at && rec.at[String(t)]; if (!p) return { v: '—', e: '', color: 'var(--text-3)' };
          const e = p.pred / rec.final - 1; return { v: this.short(p.pred), e: (e >= 0 ? '+' : '') + (e * 100).toFixed(1) + '%', color: Math.abs(e) < 0.05 ? '#2fb37a' : Math.abs(e) < 0.15 ? '#e0a030' : '#e0576a' }; }) }; }).filter(Boolean);
      out.recapShareUrl = this._linkTo('recap', { recapEv: String(id) });
      return out;
    },
    accVals(s) {
      const D = s.accData;
      const out = { accLoad: !D, accMissing: !!(D && D.missing), accHas: !!(D && D.summary) };
      if (!out.accHas) return out;
      const taus = D.taus || [0.25, 0.5, 0.75, 0.9];
      const tau = taus.map(String).includes(String(s.accTau)) ? String(s.accTau) : '0.5';
      const chipSt = on => on ? { bg: 'var(--ink-grad)', fg: '#fff', bd: 'transparent' } : { bg: 'var(--card)', fg: 'var(--text-2)', bd: 'var(--border)' };
      out.accTaus = taus.map(t => Object.assign({ v: String(t), n: '進度 ' + Math.round(t * 100) + '%', on: String(t) === tau }, chipSt(String(t) === tau)));
      const pct = v => v == null ? '—' : (v * 100).toFixed(1) + '%';
      const T = (D.summary.tier || {})[tau] || {}, R = (D.summary.rank || {})[tau] || {};
      const all = T.all || {};
      out.accCards = [
        { k: '模型（中位誤差）', v: pct(all.medAPE), sub: '主榜各段位，' + (all.n || 0) + ' 個預測' },
        { k: '線性外推', v: pct(all.linMedAPE), sub: '照當時平均速度推到結束' },
        { k: '賽前先驗', v: pct(all.priorMedAPE), sub: '同型態歷屆終線的加權平均' },
        { k: 'P10～P90 涵蓋率', v: all.cover != null ? Math.round(all.cover * 100) + '%' : '—', sub: '理想值 80%' },
      ];
      const GL = { A: 'T100～T300', B: 'T400～T1000', C: 'T1500～T5000', D: 'T10000～T20000', E: 'T30000 以上', r_top: '第 1～3 名', r_mid: '第 10～20 名', r_low: '第 30 名以後' };
      const row = (g, v) => ({ g: GL[g] || g, n: v.n, med: pct(v.medAPE), mean: pct(v.mape), lin: pct(v.linMedAPE), prior: pct(v.priorMedAPE), cover: v.cover != null ? Math.round(v.cover * 100) + '%' : '—', color: v.medAPE < 0.05 ? '#2fb37a' : v.medAPE < 0.15 ? '#e0a030' : '#e0576a' });
      out.accGroups = ['A', 'B', 'C', 'D', 'E'].filter(g => T[g]).map(g => row(g, T[g]));
      out.accRankGroups = ['r_top', 'r_mid', 'r_low'].filter(g => R[g]).map(g => row(g, R[g]));
      out.accRankAll = R.all ? pct(R.all.medAPE) : '—';
      out.accEvents = (D.events || []).slice().sort((a, b) => b.id - a.id).map(e => {
        const cell = sp => { const rec = (e.tiers || []).find(x => x.spec === sp); const p = rec && rec.at && rec.at[tau]; if (!rec || !p) return { v: '—', e: '', color: 'var(--text-3)' };
          const err = p.pred / rec.final - 1; return { v: this.short(p.pred) + ' / ' + this.short(rec.final), e: (err >= 0 ? '+' : '') + (err * 100).toFixed(1) + '%', color: Math.abs(err) < 0.05 ? '#2fb37a' : Math.abs(err) < 0.15 ? '#e0a030' : '#e0576a' }; };
        return { id: e.id, name: e.name || ('第 ' + e.id + ' 期'), meta: [e.type, e.unit, e.days ? e.days + ' 天' : ''].filter(Boolean).join('・'), c100: cell('T100'), c1000: cell('T1000'), c5000: cell('T5000'), c10000: cell('T10000') };
      });
      out.accBuilt = D.builtFrom || ''; out.accBuiltAt = D.builtAt ? D.builtAt.slice(0, 10) : '';
      out.accN = (D.events || []).length;
      return out;
    },
  };
}
