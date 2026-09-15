"""M3：對數線性速率回歸 + 隨 τ 堆疊集成（擬合端，只用 numpy）。

目標  y = log(final / 現分)（≥ 0，結算時 = 0）

第一層 速率回歸（每段位一張表，在訓練活動上擬合）
    log ρ(t) = c0 + a[hod(t)] + b[hte_bin(t)] + s[hfs_bin(t)] + w·weekend(t)
        ρ   = 增量速率 ÷ (final / 總時數)（相對速率，1 = 整期平均）
        hod = 台灣時 0..23（24 個 one-hot），hte = 距結算小時（9 段，≥24h 為基準），
        hfs = 開跑後小時（6 段，≥24h 為基準），weekend = 台灣週六日
    在「相鄰真實（未被單調修復改寫）快照之間的區段」上做非線性最小平方：斷檔變成
    一個長區段、只約束總增量，所以錄不到的末段仍有資訊。
    0.25h 網格積分：P(t) = ∫ exp(x(t)·β) dt，g(t) = P(t)/P(end)。

第二層 成員（都是 y 的估計，只用 ≤ t_now 的資料）
    m_R = −log g(t_last)、m_W24 / m_W6 = 窗口速率 × 剖面、m_P = log(prior/現分)、
    m_L = −log τ、m_X = 跨段位錨定。缺的成員差值視為 0。

第三層 堆疊  ŷ = m_R + Σ_k w_k(τ箱, 群)(m_k − m_R)，權重用 ridge 在內層
    leave-one-event-out 的成員列上擬合；同一批殘差給 P10/P90 區間。

家族：'tier'（主榜 T100..T100000，含 WL 主榜）、'rank'（R1..R100 六個群）、
'wl'（WL 章節榜）、'player'（rank 剖面 + 玩家自己的 24h/6h 增量）。
與瀏覽器端 js/border-model.js 的推論逐式對應。
"""
from __future__ import annotations

import math
from typing import Dict, List

import numpy as np

from . import data as D

HOUR = 3600.0
DT = 0.25
HTE_EDGES = [0, 1, 2, 3, 4, 6, 9, 12, 18, 24]
HFS_EDGES = [0, 1, 2, 3, 6, 12, 24]
TAU_EDGES = [0.0, 0.15, 0.3, 0.5, 0.7, 0.85, 1.01]
MEMBERS = ['R', 'W24', 'W6', 'P', 'L', 'X']
RANK_GROUPS = [(1, 1), (2, 3), (4, 10), (11, 20), (21, 50), (51, 100)]
LOG_FLOOR = 0.03
N_HTE, N_HFS = len(HTE_EDGES) - 1, len(HFS_EDGES) - 1
N_FEAT = 1 + 24 + N_HTE + N_HFS + 1
LAM_PROF = (1.0, 0.1, 0.1, 1.0)
LAM_W = 0.05
IV_SCALE = 1.25
TYPE_W = 3.0
WIN = (('W24', 24.0, 6.0), ('W6', 6.0, 2.0))
N_TB = len(TAU_EDGES) - 1


# ----------------------------------------------------------------------------
# 台灣曆法
# ----------------------------------------------------------------------------
def hod_of(t):
    return ((t + 8 * HOUR) % 86400.0) / HOUR


def weekend_of(t):
    dow = (math.floor((t + 8 * HOUR) / 86400.0) + 4) % 7      # 0 = 週日
    return 1.0 if dow in (0, 6) else 0.0


def bin_of(x, edges):
    if x < 0:
        x = 0.0
    for i in range(len(edges) - 1):
        if x < edges[i + 1]:
            return i
    return -1


def board_type(ev):
    if ev.is_wl:
        return 'wlch'
    return 'wlmain' if ev.total_h > 200 else 'marathon'


def rank_group(k):
    for i, (a, b) in enumerate(RANK_GROUPS):
        if a <= k <= b:
            return i
    return len(RANK_GROUPS) - 1


def spec_group_key(family, spec):
    kind, v = D.spec_kind(spec)
    return f'RG{rank_group(v)}' if kind == 'rank' else f'T{v}'


def stack_group(family, spec):
    kind, v = D.spec_kind(spec)
    if kind == 'rank':
        return 'r_top' if v <= 3 else ('r_mid' if v <= 20 else 'r_low')
    if v <= 300:
        return 'A'
    if v <= 1000:
        return 'B'
    if v <= 5000:
        return 'C'
    if v <= 20000:
        return 'D'
    return 'E'


def specs_for(ev, family):
    return [f'R{k}' for k in range(1, 101)] if family == 'rank' else list(ev.tiers)


def tau_bin(tau):
    b = bin_of(tau, TAU_EDGES)
    return b if b >= 0 else len(TAU_EDGES) - 2


# ----------------------------------------------------------------------------
# 時序存取（numpy，按活動×段位快取）
# ----------------------------------------------------------------------------
_SER = {}


def series_np(ev, spec):
    key = (ev.key(), D.spec_key(spec))
    r = _SER.get(key)
    if r is None:
        ts, col = ev.matrix(spec)
        am = ev.altered_mask(spec)
        if len(col):
            m = np.isfinite(col)
            r = (ts[m].astype(float), col[m].astype(float), (am[m] if len(am) else np.zeros(m.sum(), bool)))
        else:
            r = (np.zeros(0), np.zeros(0), np.zeros(0, bool))
        _SER[key] = r
    return r


def until(ts, vals, t):
    n = int(np.searchsorted(ts, t, side='right'))
    return ts[:n], vals[:n]


def win_delta(ts, vals, win_h, min_span_h):
    if len(ts) < 2:
        return None
    t_b = ts[-1]
    i = int(np.searchsorted(ts, t_b - win_h * HOUR, side='left'))
    span = (t_b - ts[i]) / HOUR
    if span < min_span_h:
        return None
    return (vals[-1] - vals[i], span)


# ----------------------------------------------------------------------------
# 第一層：區段上的速率回歸
# ----------------------------------------------------------------------------
_SEGX = {}


def design_row(t_mid, start, end):
    x = np.zeros(N_FEAT)
    x[0] = 1.0
    x[1 + int(hod_of(t_mid)) % 24] = 1.0
    b = bin_of((end - t_mid) / HOUR, HTE_EDGES)
    if b >= 0:
        x[25 + b] = 1.0
    s = bin_of((t_mid - start) / HOUR, HFS_EDGES)
    if s >= 0:
        x[25 + N_HTE + s] = 1.0
    x[-1] = weekend_of(t_mid)
    return x


def segment_design(ev, spec, min_span_h=1.0, step_h=0.5):
    key = (ev.key(), D.spec_key(spec))
    if key in _SEGX:
        return _SEGX[key]
    fin = ev.final(spec)
    if not fin:
        _SEGX[key] = None
        return None
    ts, vals, am = series_np(ev, spec)
    keep = (~am) & (ts > ev.start) & (ts < ev.end)
    pts = [(float(ev.start), 0.0)] + list(zip(ts[keep], vals[keep])) + [(float(ev.end), float(fin))]
    segs = []
    ta, va = pts[0]
    for tb, vb in pts[1:]:
        if (tb - ta) / HOUR < min_span_h and tb < ev.end:
            continue
        segs.append((ta, tb, max(0.0, vb - va)))
        ta, va = tb, vb
    base = fin / ev.total_h
    Xs, DH, SEG, OBS, SPAN = [], [], [], [], []
    for k, (ta, tb, dS) in enumerate(segs):
        span = (tb - ta) / HOUR
        n = max(1, int(math.ceil(span / step_h)))
        dh = span / n
        Xs.append(np.array([design_row(ta + (i + 0.5) * dh * HOUR, ev.start, ev.end) for i in range(n)]))
        DH.append(np.full(n, dh)); SEG.append(np.full(n, k))
        OBS.append(math.log(max(dS / base, LOG_FLOOR * span))); SPAN.append(span)
    r = {'X': np.vstack(Xs), 'dh': np.concatenate(DH), 'seg': np.concatenate(SEG),
         'obs': np.array(OBS), 'span': np.array(SPAN), 'k': len(segs)}
    _SEGX[key] = r
    return r


def fit_log_rate(items, lam=LAM_PROF, max_w=8.0, iters=60):
    """items = [(ev, spec, pair_weight)] -> 係數向量（Levenberg-Marquardt，normal equation）。"""
    Xs, DH, SEG, OBS, W = [], [], [], [], []
    k = 0
    for ev, spec, pw in items:
        d = segment_design(ev, spec)
        if d is None:
            continue
        tot = d['span'].sum()
        Xs.append(d['X']); DH.append(d['dh']); SEG.append(d['seg'] + k); OBS.append(d['obs'])
        W.append(np.minimum(max_w, d['span']) / tot * pw)
        k += d['k']
    if k == 0:
        return None
    X = np.vstack(Xs); dh = np.concatenate(DH); seg = np.concatenate(SEG).astype(int)
    obs = np.concatenate(OBS); w = np.concatenate(W); w = w / w.sum() * k
    pen = np.full(N_FEAT, lam[0]); pen[0] = 1e-6
    pen[25:25 + N_HTE] = lam[1]; pen[25 + N_HTE:-1] = lam[2]; pen[-1] = lam[3]

    # 區段聚合（原版用 scipy 稀疏矩陣，這裡用 bincount 做同一件事）
    def agg(v):
        return np.bincount(seg, weights=v, minlength=k)

    def cost_parts(b):
        e = np.exp(X @ b) * dh
        pred = agg(e)
        r = np.log(pred) - obs
        return e, pred, r, float((w * r * r).sum() + (pen * b * b).sum())
    b = np.zeros(N_FEAT)
    e, pred, r, c = cost_parts(b)
    mu = 1e-2
    c_old = c
    for _ in range(iters):
        EX = e[:, None] * X
        J = np.column_stack([agg(EX[:, j]) for j in range(N_FEAT)]) / pred[:, None]
        JtW = J.T * w
        A = JtW @ J + np.diag(pen)
        g = JtW @ r + pen * b
        improved = False
        for _try in range(8):
            step = np.linalg.solve(A + mu * np.eye(N_FEAT), -g)
            b2 = b + step
            e2, pred2, r2, c2 = cost_parts(b2)
            if c2 < c:
                b, e, pred, r, c_old, c = b2, e2, pred2, r2, c, c2
                mu = max(mu / 3, 1e-6)
                improved = True
                break
            mu *= 4
        if not improved or abs(c_old - c) < 1e-9 * max(1.0, c):
            break
    return b


class RateProfile:
    def __init__(self, events, family, lam=LAM_PROF, btype=None, type_w=1.0):
        self.family = family
        self.lam = tuple(lam)
        self.coef, self.n_pairs = {}, {}
        specs = {}
        for e in events:
            for s in specs_for(e, family):
                if e.final(s) and e.has(s):
                    specs.setdefault(spec_group_key(family, s), []).append((e, s))
        for key, lst in specs.items():
            cnt = {}
            for e, s in lst:
                cnt[e.key()] = cnt.get(e.key(), 0) + 1
            tw = {e.key(): (type_w if (btype and board_type(e) == btype) else 1.0) for e, s in lst}
            c = fit_log_rate([(e, s, tw[e.key()] / cnt[e.key()]) for e, s in lst], self.lam)
            if c is not None:
                self.coef[key] = c
                self.n_pairs[key] = len(lst)
        self._P = {}

    def coef_for(self, spec):
        key = spec_group_key(self.family, spec)
        if key in self.coef:
            return self.coef[key]
        kind, v = D.spec_kind(spec)
        if kind == 'rank':
            ks = sorted(self.coef, key=lambda k: int(k[2:]))
            return self.coef[ks[-1]] if ks else None
        avail = sorted((D.spec_kind(k)[1], k) for k in self.coef)
        if not avail:
            return None
        lo = [a for a in avail if a[0] <= v]
        hi = [a for a in avail if a[0] >= v]
        if lo and hi:
            (r0, k0), (r1, k1) = lo[-1], hi[0]
            a = 0.0 if r1 == r0 else (math.log(v) - math.log(r0)) / (math.log(r1) - math.log(r0))
            return (1 - a) * self.coef[k0] + a * self.coef[k1]
        return self.coef[(lo or hi)[-1 if lo else 0][1]]

    def cum(self, spec, start, end):
        key = (spec_group_key(self.family, spec), start, end)
        P = self._P.get(key)
        if P is None:
            c = self.coef_for(spec)
            total_h = (end - start) / HOUR
            n = int(math.ceil(total_h / DT))
            mids = start + (np.arange(n) + 0.5) * DT * HOUR
            dh = np.minimum(DT, total_h - np.arange(n) * DT)
            if c is None:
                r = np.ones(n)
            else:
                Xg = np.array([design_row(t, start, end) for t in mids])
                r = np.exp(Xg @ c)
            P = np.concatenate([[0.0], np.cumsum(r * dh)])
            self._P[key] = P
        return P

    def P_at(self, spec, start, end, t):
        P = self.cum(spec, start, end)
        x = min(max((t - start) / HOUR / DT, 0.0), len(P) - 1)
        i = min(int(math.floor(x)), len(P) - 2)
        return P[i] + (x - i) * (P[i + 1] - P[i])

    def to_json(self):
        out = {}
        for k, c in self.coef.items():
            out[k] = {'c0': round(float(c[0]), 5), 'hod': [round(float(x), 4) for x in c[1:25]],
                      'hte': [round(float(x), 4) for x in c[25:25 + N_HTE]],
                      'hfs': [round(float(x), 4) for x in c[25 + N_HTE:-1]],
                      'wk': round(float(c[-1]), 4), 'n_pairs': int(self.n_pairs[k])}
        return out


_PROF_CACHE = {}


def get_profile(events, family, lam=LAM_PROF, btype=None, type_w=1.0):
    if type_w == 1.0:
        btype = None
    key = (tuple(sorted(e.key() for e in events)), family, tuple(lam), btype, type_w)
    p = _PROF_CACHE.get(key)
    if p is None:
        p = RateProfile(events, family, lam, btype, type_w)
        _PROF_CACHE[key] = p
    return p


# ----------------------------------------------------------------------------
# borders-db 先驗
# ----------------------------------------------------------------------------
def db_prior(db, meta_db, ev_id, spec, half_life=6.0, min_n=3, k_last=12):
    """同型態（樣本 ≥ min_n 時再限同日數）過去終線的半衰期加權幾何平均。
    db 是已限制 id < 本期 的表；meta_db 提供本期的 type/days。名次線與表上沒有的段位回 None。"""
    if not db:
        return None
    hid = int(str(ev_id).split('.')[0])
    meta = D.db_event(meta_db, hid)
    if not meta:
        return None
    kind, rk = D.spec_kind(spec)
    if kind == 'rank':
        return None
    tiers = db['tiers']
    if rk not in tiers:
        return None
    i = tiers.index(rk)

    def collect(same_days):
        out = []
        for b in db['borders']:
            if int(b['id']) >= hid or b.get('type') != meta.get('type'):
                continue
            if same_days and b.get('days') != meta.get('days'):
                continue
            t = b.get('t') or []
            v = t[i] if i < len(t) else None
            if v:
                out.append((int(b['id']), float(v), b.get('days') or 1))
        return out
    rows = collect(True)
    scale = False
    if len(rows) < min_n:
        rows = collect(False)
        scale = True
        if len(rows) < min_n:
            return None
    rows.sort()
    rows = rows[-k_last:]
    w = np.array([0.5 ** ((hid - i_) / half_life) for i_, _, _ in rows])
    lv = np.array([math.log(v * ((meta.get('days') or 1) / d if scale else 1.0)) for _, v, d in rows])
    return float(math.exp((w * lv).sum() / w.sum()))


def db_restricted(db, ev_id):
    hid = int(str(ev_id).split('.')[0])
    return {'events': db['events'], 'borders': [b for b in db['borders'] if int(b['id']) < hid],
            'tiers': db['tiers'], 'wl': db['wl'], 'wlTiers': db['wlTiers']}


# ----------------------------------------------------------------------------
# 第二層：成員
# ----------------------------------------------------------------------------
def anchor_of(ev, spec):
    """同一榜上一個較高段位（名次數字較小），沒有回 None。"""
    kind, v = D.spec_kind(spec)
    if kind == 'rank':
        return None
    lower = [t for t in ev.tiers if t < v]
    return max(lower) if lower else None


def log_ratio_table(events, family):
    out = {}
    for e in events:
        for s in specs_for(e, family):
            a = anchor_of(e, s)
            if a is None:
                continue
            f, fa = e.final(s), e.final(a)
            if f and fa:
                out.setdefault(D.spec_key(s), []).append(math.log(f / fa))
    return {k: float(np.mean(v)) for k, v in out.items()}


def members_at(prof, spec, ts, vals, start, end, t_now, prior=None, score_now=None, anchor=None):
    if score_now is None:
        if not len(ts):
            return None
        t_last, score = float(ts[-1]), float(vals[-1])
    else:
        t_last, score = t_now, float(score_now)
    if score <= 0:
        return None
    total_h = (end - start) / HOUR
    tau = min(1.0, max(1e-4, (t_last - start) / HOUR / total_h))
    P = prof.cum(spec, start, end)
    Pn = prof.P_at(spec, start, end, t_last)
    Pe = P[-1]
    g = max(1e-6, Pn / Pe)
    m = {'R': -math.log(g), 'L': -math.log(tau), 'P': None, 'W24': None, 'W6': None, 'X': None}
    if prior:
        m['P'] = math.log(prior / score)
    if anchor is not None:
        lr, a_ts, a_vals, a_spec = anchor
        if len(a_ts) and a_vals[-1] > 0:
            ga = max(1e-6, prof.P_at(a_spec, start, end, float(a_ts[-1])) / prof.cum(a_spec, start, end)[-1])
            m['X'] = math.log(a_vals[-1] / ga) + lr - math.log(score)
    for name, win, min_span in WIN:
        w = win_delta(ts, vals, win, min_span)
        if w is None:
            continue
        dS, span = w
        dP = Pn - prof.P_at(spec, start, end, t_last - span * HOUR)
        if dP <= 1e-9:
            continue
        m[name] = math.log(1.0 + max(0.0, dS) * (Pe - Pn) / dP / score)
    st = {'t': t_last, 'score': score, 'tau': tau, 'g': g, 'left_h': max(0.0, (end - t_last) / HOUR)}
    return m, st


def member_diff(m):
    return np.array([0.0 if m[k] is None else m[k] - m['R'] for k in MEMBERS[1:]])


# ----------------------------------------------------------------------------
# 第三層：堆疊列（內層 LOO）、權重、分位
# ----------------------------------------------------------------------------
def anchor_for(ev, spec, lr_tab, t):
    a = anchor_of(ev, spec)
    if a is None or D.spec_key(spec) not in lr_tab:
        return None
    a_ts, a_vals, a_am = series_np(ev, a)
    a_ts, a_vals = until(a_ts, a_vals, t)
    if not len(a_ts) or a_am[len(a_ts) - 1]:
        return None
    return (lr_tab[D.spec_key(spec)], a_ts, a_vals, a)


def stack_rows(events, family, db, meta_db, lam=LAM_PROF, step_h=1.0, max_stale_h=6.0, type_w=1.0):
    D_, YR, Y, TAU, G, EV, W = [], [], [], [], [], [], []
    for ev in events:
        others = [e for e in events if e.key() != ev.key()]
        if not others:
            continue
        prof = get_profile(others, family, lam, board_type(ev), type_w)
        lr_tab = log_ratio_table(others, family)
        dbr = db_restricted(db, ev.id) if db else None
        specs = [s for s in specs_for(ev, family) if ev.final(s) and ev.has(s)]
        if family == 'rank':
            specs = [s for s in specs if D.spec_kind(s)[1] in (1, 2, 3, 5, 10, 15, 20, 30, 40, 50, 75, 100)]
        buf = []
        for s in specs:
            fin = ev.final(s)
            prior = db_prior(dbr, meta_db, ev.id, s) if dbr else None
            ts, vals, am = series_np(ev, s)
            n_t = int(ev.total_h / step_h)
            for k in range(1, n_t + 1):
                t = ev.start + k * step_h * HOUR
                if t >= ev.end:
                    break
                n = int(np.searchsorted(ts, t, side='right'))
                if n == 0:
                    continue
                if (t - ts[n - 1]) / HOUR > max_stale_h or vals[n - 1] <= 0 or am[n - 1]:
                    continue
                r = members_at(prof, s, ts[:n], vals[:n], ev.start, ev.end, t, prior, None, anchor_for(ev, s, lr_tab, t))
                if r is None:
                    continue
                m, st = r
                buf.append((member_diff(m), m['R'], math.log(fin / st['score']), st['tau'], stack_group(family, s)))
        wt = 1.0 / max(1, len(buf))
        for d, yr, y, tau, grp in buf:
            D_.append(d); YR.append(yr); Y.append(y); TAU.append(tau); G.append(grp); EV.append(ev.key()); W.append(wt)
    return (np.array(D_), np.array(YR), np.array(Y), np.array(TAU), np.array(G), np.array(EV), np.array(W))


def fit_w(Dm, r, W, lam):
    if len(r) == 0:
        return np.zeros(Dm.shape[1])
    A = (Dm * W[:, None]).T @ Dm + lam * np.eye(Dm.shape[1])
    return np.linalg.solve(A, (Dm * W[:, None]).T @ r)


class Stacker:
    def __init__(self, rows, lam_w=LAM_W, min_rows=8):
        Dm, YR, Y, TAU, G, EV, W = rows
        self.groups = sorted(set(G))
        self.w, self.q = {}, {}
        nd = Dm.shape[1] if Dm.ndim == 2 else len(MEMBERS) - 1
        tb = np.array([tau_bin(t) for t in TAU])
        r = Y - YR

        def fit_sel(sel):
            Wn = W[sel] / W[sel].sum() * sel.sum()
            return fit_w(Dm[sel], r[sel], Wn, lam_w * sel.sum())
        for grp in self.groups:
            for b in range(N_TB):
                sel = (G == grp) & (tb == b)
                if sel.sum() < min_rows:
                    sel = (G == grp)
                self.w[(grp, b)] = fit_sel(sel) if sel.sum() >= min_rows else np.zeros(nd)
        res = np.full(len(Y), np.nan)
        for e in sorted(set(EV)):
            for grp in self.groups:
                for b in range(N_TB):
                    te = (G == grp) & (tb == b) & (EV == e)
                    if not te.any():
                        continue
                    tr = (G == grp) & (tb == b) & (EV != e)
                    if tr.sum() < min_rows:
                        tr = (G == grp) & (EV != e)
                    wv = fit_sel(tr) if tr.sum() >= min_rows else np.zeros(nd)
                    res[te] = r[te] - Dm[te] @ wv
        for grp in self.groups:
            for b in range(N_TB):
                sel = (G == grp) & (tb == b) & np.isfinite(res)
                if sel.sum() < 15:
                    sel = (G == grp) & np.isfinite(res)
                rr = res[sel] if sel.sum() else np.array([0.0])
                self.q[(grp, b)] = (float(np.quantile(rr, 0.10)), float(np.quantile(rr, 0.90)),
                                    float(np.sqrt(np.mean(rr ** 2))), int(sel.sum()))

    def combine(self, m, tau, grp):
        b = tau_bin(tau)
        w = self.w.get((grp, b))
        d = member_diff(m)
        y = m['R'] + (float(np.dot(w, d)) if w is not None else 0.0)
        lo, hi, sd, n = self.q.get((grp, b), (-0.2, 0.2, 0.15, 0))
        return y, lo * IV_SCALE, hi * IV_SCALE, sd

    def to_json(self):
        return {'members': MEMBERS, 'tau_edges': TAU_EDGES,
                'w': {f'{g}|{b}': [round(float(x), 4) for x in w] for (g, b), w in self.w.items()},
                'q': {f'{g}|{b}': [round(a, 4), round(b_, 4), round(c, 4), n] for (g, b), (a, b_, c, n) in self.q.items()}}


# ----------------------------------------------------------------------------
# 各家族模型
# ----------------------------------------------------------------------------
class M3Model:
    def __init__(self, events, family, db, meta_db=None, lam_prof=LAM_PROF, lam_w=LAM_W, btype=None, type_w=TYPE_W):
        self.family, self.db, self.meta_db = family, db, (meta_db or db)
        self.prof = get_profile(events, family, lam_prof, btype, type_w)
        self.lr_tab = log_ratio_table(events, family)
        self.rows = stack_rows(events, family, db, self.meta_db, lam_prof, type_w=type_w)
        self.stk = Stacker(self.rows, lam_w=lam_w)
        self.events = [e.key() for e in events]

    def predict(self, ev, spec, ts, vals, t_now, score_now=None, anchor=None):
        prior = db_prior(db_restricted(self.db, ev.id), self.meta_db, ev.id, spec) if self.db else None
        if anchor is None:
            anchor = anchor_for(ev, spec, self.lr_tab, t_now)
        r = members_at(self.prof, spec, ts, vals, ev.start, ev.end, t_now, prior, score_now, anchor)
        if r is None:
            return None
        m, st = r
        y, lo, hi, sd = self.stk.combine(m, st['tau'], stack_group(self.family, spec))
        y = max(0.0, y)
        return {'final': st['score'] * math.exp(y), 'lo': st['score'] * math.exp(max(0.0, y + lo)),
                'hi': st['score'] * math.exp(y + hi), 'y': y, 'members': m, 'state': st, 'sd': sd}

    def to_json(self):
        return {'family': self.family, 'events': self.events, 'profile': self.prof.to_json(),
                'stack': self.stk.to_json(), 'logRatio': {k: round(v, 5) for k, v in self.lr_tab.items()}}


_PSER = {}


def player_series_np(ev, uid):
    key = (ev.key(), str(uid))
    r = _PSER.get(key)
    if r is None:
        s = D.player_series(ev, uid)
        a = np.array(s, float) if s else np.zeros((0, 2))
        r = (a[:, 0], a[:, 1]) if len(a) else (np.zeros(0), np.zeros(0))
        _PSER[key] = r
    return r


def player_rows(events, lam=LAM_PROF, step_h=2.0):
    D_, YR, Y, TAU, G, EV, W = [], [], [], [], [], [], []
    for ev in events:
        others = [e for e in events if e.key() != ev.key()]
        if not others:
            continue
        prof = get_profile(others, 'rank', lam)
        finals = D.player_finals(ev)
        if not finals:
            continue
        buf = []
        n_t = int(ev.total_h / step_h)
        for k in range(1, n_t + 1):
            t = ev.start + k * step_h * HOUR
            if t >= ev.end:
                break
            cur = D.players_at(ev, t)
            if not cur or (t - cur[0]['t']) / HOUR > 6.0:
                continue
            for p in cur:
                f = finals.get(p['uid'])
                if not f:
                    continue
                ts, vals = player_series_np(ev, p['uid'])
                ts, vals = until(ts, vals, t)
                if not len(ts):
                    continue
                spec = f"R{p['rank']}"
                r = members_at(prof, spec, ts, vals, ev.start, ev.end, t, None)
                if r is None:
                    continue
                m, st = r
                buf.append((member_diff(m), m['R'], math.log(f['score'] / st['score']), st['tau'], stack_group('rank', spec)))
        wt = 1.0 / max(1, len(buf))
        for d, yr, y, tau, grp in buf:
            D_.append(d); YR.append(yr); Y.append(y); TAU.append(tau); G.append(grp); EV.append(ev.key()); W.append(wt)
    return (np.array(D_), np.array(YR), np.array(Y), np.array(TAU), np.array(G), np.array(EV), np.array(W))


class PlayerModel:
    def __init__(self, events, lam_prof=LAM_PROF, lam_w=LAM_W):
        self.prof = get_profile(events, 'rank', lam_prof)
        self.rows = player_rows(events, lam_prof)
        self.stk = Stacker(self.rows, lam_w=lam_w)
        self.events = [e.key() for e in events]

    def predict_state(self, start, end, rank, ts, vals, t_now, score_now=None):
        spec = f'R{max(1, min(100, int(rank)))}'
        r = members_at(self.prof, spec, ts, vals, start, end, t_now, None, score_now)
        if r is None:
            return None
        m, st = r
        y, lo, hi, sd = self.stk.combine(m, st['tau'], stack_group('rank', spec))
        y = max(0.0, y)
        return {'final': st['score'] * math.exp(y), 'lo': st['score'] * math.exp(max(0.0, y + lo)),
                'hi': st['score'] * math.exp(y + hi), 'y': y, 'members': m, 'state': st, 'sd': sd}

    def to_json(self):
        return {'family': 'player', 'events': self.events, 'profile': self.prof.to_json(), 'stack': self.stk.to_json()}


def params_header():
    return {'version': 'M3', 'dt': DT, 'hteEdges': HTE_EDGES, 'hfsEdges': HFS_EDGES,
            'tauEdges': TAU_EDGES, 'members': MEMBERS, 'ivScale': IV_SCALE,
            'lamProf': list(LAM_PROF), 'lamW': LAM_W}
