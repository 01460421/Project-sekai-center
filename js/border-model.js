/* 榜線終線預測模型 M3 —— 瀏覽器推論（純 JS、無依賴、classic script）。
 * 掛在 window.BorderModel（node 端 module.exports 亦可）。參數檔 data/border-model.json 由
 * tools/build-border-model.py 每日重擬；方法、公式與回測見 tools/border_model/model.py。
 *
 * BorderModel.predict(params, {
 *     family: 'tier' | 'wl' | 'rank' | 'player',
 *     spec:   'T1000' | 'R10' | 1000,          // 這條線的段位／名次（player：玩家目前名次）
 *     start, end, now:  unix ms,                // end 用 aggregate_at
 *     series: [[ms, score], ...],               // ≤ now 的快照，遞增排序、已 fixMono（可為空）
 *     score:  number | undefined,               // now 時刻的即時值（沒給就用 series 最後一筆）
 *     prior:  number | null,                    // BorderModel.dbPrior(BORDERS_DB, evId, spec) 或 null
 *     anchor: {spec, series, score} | null      // 同榜上一個較高段位（如 T50000 的 T40000）：
 *                                               // 它自己 ≤ now 的序列（＋即時值）→ 跨段位成員 X
 * }) -> { final, lo, hi, y, g, tau, members:{R,W24,W6,P,L,X}, weights, used, tauBin, group, method, leftH }
 *   final 是預測終線，lo/hi 是 P10/P90 區間；method 是 'profile-ratio' / 'profile-ratio+prior' /
 *   'profile+6h' / 'profile+24h'（依可用的成員）。任何家族／參數缺漏回 null，呼叫端自行退回舊算式。
 *
 * params = data/border-model.json：
 *   { dt, hteEdges, hfsEdges, tauEdges, members, ivScale, families: { tier: {profile:{T100:{c0,hod,hte,hfs,wk}},
 *     stack:{w:{'A|0':[w24,w6,wP,wL,wX]}, q:{'A|0':[q10,q90,sd,n]}}, logRatio:{T200:…}}, wl, rank, player } }
 * 成本：剖面積分每 (family, 段位群, 活動) 一次（0.25h 網格）後快取，之後每次預測只是查表。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BorderModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const HOUR = 3600000;
  const RANK_GROUPS = [[1, 1], [2, 3], [4, 10], [11, 20], [21, 50], [51, 100]];

  function specKind(spec) {
    if (typeof spec === 'number') return ['tier', spec];
    const s = String(spec).trim().toUpperCase();
    if (s[0] === 'R') return ['rank', parseInt(s.slice(1), 10)];
    if (s[0] === 'T') return ['tier', parseInt(s.slice(1), 10)];
    return ['tier', parseInt(s, 10)];
  }
  function rankGroup(k) {
    for (let i = 0; i < RANK_GROUPS.length; i++) if (k >= RANK_GROUPS[i][0] && k <= RANK_GROUPS[i][1]) return i;
    return RANK_GROUPS.length - 1;
  }
  function profileKey(family, spec) {
    const [kind, v] = specKind(spec);
    return kind === 'rank' ? 'RG' + rankGroup(v) : 'T' + v;
  }
  function stackGroup(spec) {
    const [kind, v] = specKind(spec);
    if (kind === 'rank') return v <= 3 ? 'r_top' : (v <= 20 ? 'r_mid' : 'r_low');
    return v <= 300 ? 'A' : (v <= 1000 ? 'B' : (v <= 5000 ? 'C' : (v <= 20000 ? 'D' : 'E')));
  }
  function binOf(x, edges) {
    if (x < 0) x = 0;
    for (let i = 0; i < edges.length - 1; i++) if (x < edges[i + 1]) return i;
    return -1;
  }
  // Taiwan calendar (UTC+8) from unix ms
  function hodOf(ms) { return ((ms + 8 * HOUR) % 86400000) / HOUR; }
  function weekendOf(ms) {
    const dow = (Math.floor((ms + 8 * HOUR) / 86400000) + 4) % 7;   // 0 = Sunday
    return (dow === 0 || dow === 6) ? 1 : 0;
  }
  function logRate(c, params, tMid, start, end) {
    let v = c.c0 + c.hod[Math.floor(hodOf(tMid)) % 24] + c.wk * weekendOf(tMid);
    const b = binOf((end - tMid) / HOUR, params.hteEdges);
    if (b >= 0) v += c.hte[b];
    const s = binOf((tMid - start) / HOUR, params.hfsEdges);
    if (s >= 0) v += c.hfs[s];
    return v;
  }
  // coefficient table for a spec (log-rank interpolation between neighbouring tier tables)
  function coefFor(prof, family, spec) {
    const key = profileKey(family, spec);
    if (prof[key]) return prof[key];
    const [kind, v] = specKind(spec);
    if (kind === 'rank') {
      const ks = Object.keys(prof).filter(k => k.startsWith('RG')).sort((a, b) => +a.slice(2) - +b.slice(2));
      return ks.length ? prof[ks[ks.length - 1]] : null;
    }
    const avail = Object.keys(prof).filter(k => k[0] === 'T').map(k => [+k.slice(1), k]).sort((a, b) => a[0] - b[0]);
    if (!avail.length) return null;
    const lo = avail.filter(a => a[0] <= v), hi = avail.filter(a => a[0] >= v);
    if (lo.length && hi.length) {
      const [r0, k0] = lo[lo.length - 1], [r1, k1] = hi[0];
      const a = r1 === r0 ? 0 : (Math.log(v) - Math.log(r0)) / (Math.log(r1) - Math.log(r0));
      const A = prof[k0], B = prof[k1], mix = (x, y) => (1 - a) * x + a * y;
      return { c0: mix(A.c0, B.c0), hod: A.hod.map((x, i) => mix(x, B.hod[i])), hte: A.hte.map((x, i) => mix(x, B.hte[i])),
               hfs: A.hfs.map((x, i) => mix(x, B.hfs[i])), wk: mix(A.wk, B.wk) };
    }
    return prof[(lo.length ? lo[lo.length - 1] : hi[0])[1]];
  }
  const _P = new Map();
  function cumProfile(params, family, spec, start, end) {
    const key = family + '|' + profileKey(family, spec) + '|' + start + '|' + end;
    let P = _P.get(key);
    if (P) return P;
    const c = coefFor(params.families[family].profile, family, spec);
    const dt = params.dt, totalH = (end - start) / HOUR, n = Math.ceil(totalH / dt);
    P = new Float64Array(n + 1);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const tMid = start + (i + 0.5) * dt * HOUR, dh = Math.min(dt, totalH - i * dt);
      acc += (c ? Math.exp(logRate(c, params, tMid, start, end)) : 1) * dh;
      P[i + 1] = acc;
    }
    _P.set(key, P);
    return P;
  }
  function pAt(P, dt, start, t) {
    let x = (t - start) / HOUR / dt;
    x = Math.min(Math.max(x, 0), P.length - 1);
    const i = Math.min(Math.floor(x), P.length - 2);
    return P[i] + (x - i) * (P[i + 1] - P[i]);
  }
  function tauBin(tau, edges) { const b = binOf(tau, edges); return b >= 0 ? b : edges.length - 2; }

  // window delta: last point vs earliest point inside the last winH hours (>= minSpanH)
  function winDelta(series, winH, minSpanH) {
    if (series.length < 2) return null;
    const tb = series[series.length - 1][0];
    let i = 0;
    while (i < series.length && series[i][0] < tb - winH * HOUR) i++;
    const span = (tb - series[i][0]) / HOUR;
    if (span < minSpanH) return null;
    return [series[series.length - 1][1] - series[i][1], span];
  }

  function predict(params, inp) {
    const fam = params.families[inp.family];
    if (!fam) return null;
    const series = inp.series || [];
    let tLast, score;
    if (inp.score != null) { tLast = inp.now; score = inp.score; }
    else if (series.length) { tLast = series[series.length - 1][0]; score = series[series.length - 1][1]; }
    else return null;
    if (!(score > 0)) return null;
    const start = inp.start, end = inp.end, totalH = (end - start) / HOUR;
    const tau = Math.min(1, Math.max(1e-4, (tLast - start) / HOUR / totalH));
    const P = cumProfile(params, inp.family, inp.spec, start, end);
    const Pn = pAt(P, params.dt, start, tLast), Pe = P[P.length - 1];
    const g = Math.max(1e-6, Pn / Pe);
    const m = { R: -Math.log(g), L: -Math.log(tau), P: null, W24: null, W6: null, X: null };
    if (inp.prior > 0) m.P = Math.log(inp.prior / score);
    const lr = fam.logRatio && fam.logRatio[String(inp.spec).toUpperCase().replace(/^(\d)/, 'T$1')];
    if (inp.anchor && lr != null) {
      const a = inp.anchor, as = a.series || [];
      let at, asc;
      if (a.score != null) { at = tLast; asc = a.score; }
      else if (as.length) { at = as[as.length - 1][0]; asc = as[as.length - 1][1]; }
      if (asc > 0) {
        const Pa = cumProfile(params, inp.family, a.spec, start, end);
        const ga = Math.max(1e-6, pAt(Pa, params.dt, start, at) / Pa[Pa.length - 1]);
        m.X = Math.log(asc / ga) + lr - Math.log(score);
      }
    }
    for (const [name, win, minSpan] of [['W24', 24, 6], ['W6', 6, 2]]) {
      const w = winDelta(series, win, minSpan);
      if (!w) continue;
      const dP = Pn - pAt(P, params.dt, start, tLast - w[1] * HOUR);
      if (dP <= 1e-9) continue;
      m[name] = Math.log(1 + Math.max(0, w[0]) * (Pe - Pn) / dP / score);
    }
    const grp = stackGroup(inp.spec), tb = tauBin(tau, params.tauEdges);
    const w = fam.stack.w[grp + '|' + tb] || [0, 0, 0, 0, 0];
    const q0 = fam.stack.q[grp + '|' + tb] || [-0.2, 0.2, 0.15, 0], ivs = params.ivScale || 1;
    const q = [q0[0] * ivs, q0[1] * ivs, q0[2], q0[3]];
    let y = m.R;
    const names = params.members.slice(1);            // W24, W6, P, L, X
    let used = ['R'];
    for (let k = 0; k < names.length; k++) {
      if (m[names[k]] == null) continue;
      y += w[k] * (m[names[k]] - m.R);
      if (Math.abs(w[k]) > 1e-9) used.push(names[k]);
    }
    y = Math.max(0, y);
    const method = series.length < 2 ? (m.P == null ? 'profile-ratio' : 'profile-ratio+prior')
                 : (m.W24 == null ? 'profile+6h' : 'profile+24h');
    return { final: score * Math.exp(y), lo: score * Math.exp(Math.max(0, y + q[0])), hi: score * Math.exp(y + q[1]),
             y, g, tau, members: m, weights: w, tauBin: tb, group: grp, method, used, leftH: Math.max(0, (end - tLast) / HOUR) };
  }

  // borders-db prior: weighted geometric mean of past finals of the same type (& days when >= 3)
  function dbPrior(DB, evId, spec, halfLife, minN, kLast) {
    halfLife = halfLife || 6; minN = minN || 3; kLast = kLast || 12;
    if (!DB || !DB.borders) return null;
    const hid = Math.floor(+String(evId).split('.')[0]);
    const meta = (DB.events || []).find(e => +e.id === hid);
    if (!meta) return null;
    const [kind, rk] = specKind(spec);
    if (kind === 'rank') return null;
    const i = (DB.tiers || []).indexOf(rk);
    if (i < 0) return null;
    const collect = (sameDays) => DB.borders
      .filter(b => +b.id < hid && b.type === meta.type && (!sameDays || b.days === meta.days) && b.t && b.t[i])
      .map(b => [+b.id, +b.t[i], b.days || 1]);
    let rows = collect(true), scale = false;
    if (rows.length < minN) { rows = collect(false); scale = true; if (rows.length < minN) return null; }
    rows.sort((a, b) => a[0] - b[0]);
    rows = rows.slice(-kLast);
    let sw = 0, sl = 0;
    for (const [id, v, d] of rows) {
      const w = Math.pow(0.5, (hid - id) / halfLife);
      sw += w; sl += w * Math.log(v * (scale ? (meta.days || 1) / d : 1));
    }
    return Math.exp(sl / sw);
  }

  return { predict, dbPrior, cumProfile, specKind, stackGroup, profileKey, hodOf, weekendOf, clearCache: () => _P.clear(), _cache: _P };
});
