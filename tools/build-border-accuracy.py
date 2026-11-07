#!/usr/bin/env python3
"""榜線終線預測的「真」準確度：對每一期已結束的活動做留一法（把它從訓練集拿掉、用其他期重擬模型），
在活動進度 25%／50%／75%／90% 那一刻各預測一次終線，跟官方終線比。輸出 data/border-accuracy.json，
給網站的「預測準確度」頁與「活動回顧」頁用。

為什麼不用前端現成的模型參數回算：data/border-model.json 是用全部期數擬的，拿它去評自己的訓練期是
「考古題」，數字會好看得不真實。這裡每一期都用「沒看過它」的模型，是使用者在活動進行中真正會拿到的預測。

同時給兩個對照組：線性外推（照目前平均速度推到結束）與賽前先驗（同型態歷屆終線的加權幾何平均），
讓人看得出模型比土法好多少。

輸出（內容沒變就不寫檔）：
  { version, builtAt, taus:[.25,.5,.75,.9],
    events:[{ id, name, start, end, days, type, unit,
              tiers:[{ spec:'T100', final, prior, at:{ '0.5':{ pred, lo, hi, lin } ... } }],
              ranks:[{ spec:'R10', final, at:{...} }] }],
    summary:{ tier:{ '0.5':{ A:{n, medAPE, mape, cover, linMedAPE, priorMedAPE}, ... all:{...} } }, rank:{...} } }
    APE＝|預測/實際 − 1|；cover＝實際落在 P10～P90 區間內的比例。

用法：python3 tools/build-border-accuracy.py            # 每日排程（billing-refresh）在重擬模型後跑
      python3 tools/build-border-accuracy.py --fast     # 只算 50%（本機快速看）
"""
import json
import math
import os
import pathlib
import sys
import time

for _v in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS'):
    os.environ.setdefault(_v, '1')

import numpy as np   # noqa: E402

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from border_model import data as D, model as M   # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'border-accuracy.json'
TAUS = [0.25, 0.5, 0.75, 0.9]
RANK_SPECS = ['R1', 'R2', 'R3', 'R10', 'R20', 'R30', 'R40', 'R50', 'R100']


def predict_at(model, ev, spec, tau):
    """在進度 tau 那一刻（用當時以前的資料）預測終線；回 {pred, lo, hi, lin, tauAt} 或 None。"""
    ts, vals, am = M.series_np(ev, spec)
    if not len(ts):
        return None
    t = ev.start + tau * (ev.end - ev.start)
    n = int(np.searchsorted(ts, t, side='right'))
    if n == 0:
        return None
    if (t - ts[n - 1]) / D.HOUR > 6 or vals[n - 1] <= 0:
        return None
    r = model.predict(ev, spec, ts[:n], vals[:n], t)
    if not r:
        return None
    el = max(1e-6, ts[n - 1] - ev.start)
    lin = vals[n - 1] * (ev.end - ev.start) / el          # 線性外推：目前平均速度打到結束
    return {'pred': round(r['final']), 'lo': round(r['lo']), 'hi': round(r['hi']), 'lin': round(lin)}


def ev_meta(db, ev):
    e = D.db_event(db, ev.id) or {}
    return {'type': e.get('type', ''), 'unit': e.get('unit', ''), 'days': e.get('days') or round((ev.end - ev.start) / 86400, 2)}


def summarize(rows, fam):
    """rows: [(group, tau, final, pred, lo, hi, lin, prior)] → summary[fam][tau][group]"""
    out = {}
    for tau in TAUS:
        key = str(tau)
        groups = {}
        for g, t_, fin, pred, lo, hi, lin, prior in rows:
            if t_ != tau or not fin or not pred:
                continue
            for gk in (g, 'all'):
                b = groups.setdefault(gk, {'ape': [], 'lin': [], 'prior': [], 'cover': 0, 'n': 0})
                b['ape'].append(abs(pred / fin - 1)); b['n'] += 1
                if lin: b['lin'].append(abs(lin / fin - 1))
                if prior: b['prior'].append(abs(prior / fin - 1))
                if lo is not None and hi is not None and lo <= fin <= hi: b['cover'] += 1
        res = {}
        for gk, b in groups.items():
            if not b['n']:
                continue
            res[gk] = {'n': b['n'], 'medAPE': round(float(np.median(b['ape'])), 4), 'mape': round(float(np.mean(b['ape'])), 4),
                       'cover': round(b['cover'] / b['n'], 3),
                       'linMedAPE': round(float(np.median(b['lin'])), 4) if b['lin'] else None,
                       'priorMedAPE': round(float(np.median(b['prior'])), 4) if b['prior'] else None}
        out[key] = res
    return out


def main():
    fast = '--fast' in sys.argv
    taus = [0.5] if fast else TAUS
    t0 = time.time()
    now = time.time()
    finals = D.load_finals_cache()
    evs = [D.load_event(p, finals, now) for p in D.history_files()]
    done = [e for e in evs if now >= e.end + D.HOUR]
    main_ev = [e for e in done if e.final_src.get('tier') != 'none' and len(e.ts)]
    ranked = [e for e in main_ev if e.final_src.get('rank') != 'none' and len(e.rts)]
    if len(main_ev) < 3:
        print('已結束且有終線的期數不足 3 期，不產出', file=sys.stderr)
        return 0
    db = D.load_borders_db()
    out_events, tier_rows, rank_rows = [], [], []
    for ev in main_ev:
        others = [e for e in main_ev if e.key() != ev.key()]
        model = M.M3Model(others, 'tier', db)
        rmodel = None
        if ev in ranked:
            r_others = [e for e in ranked if e.key() != ev.key()]
            if len(r_others) >= 2:
                rmodel = M.M3Model(r_others, 'rank', None)
        rec = {'id': ev.id, 'name': ev.name, 'start': ev.start, 'end': ev.end, **ev_meta(db, ev), 'tiers': [], 'ranks': []}
        dbr = M.db_restricted(db, ev.id)
        for tier in ev.tiers:
            fin = ev.final(tier)
            if not fin or not ev.has(tier):
                continue
            prior = M.db_prior(dbr, db, ev.id, tier)
            at = {}
            for tau in taus:
                p = predict_at(model, ev, tier, tau)
                if p:
                    at[str(tau)] = p
                    tier_rows.append((M.stack_group('tier', tier), tau, fin, p['pred'], p['lo'], p['hi'], p['lin'], prior))
            if at:
                rec['tiers'].append({'spec': f'T{tier}', 'final': round(fin), 'prior': round(prior) if prior else None, 'at': at})
        if rmodel:
            for spec in RANK_SPECS:
                fin = ev.final(spec)
                if not fin or not ev.has(spec):
                    continue
                at = {}
                for tau in taus:
                    p = predict_at(rmodel, ev, spec, tau)
                    if p:
                        at[str(tau)] = p
                        rank_rows.append((M.stack_group('rank', spec), tau, fin, p['pred'], p['lo'], p['hi'], p['lin'], None))
                if at:
                    rec['ranks'].append({'spec': spec, 'final': round(fin), 'at': at})
        out_events.append(rec)
        print(f'第 {ev.id} 期：{len(rec["tiers"])} 段位、{len(rec["ranks"])} 名次線（{time.time() - t0:.0f}s）')
    summary = {'tier': summarize(tier_rows, 'tier'), 'rank': summarize(rank_rows, 'rank')}
    half = summary['tier'].get('0.5', {}).get('all') or {}
    print(f"主榜 50% 進度：中位誤差 {half.get('medAPE', 0) * 100:.1f}%（線性 {(half.get('linMedAPE') or 0) * 100:.1f}%、先驗 {(half.get('priorMedAPE') or 0) * 100:.1f}%），區間涵蓋 {half.get('cover', 0) * 100:.0f}%，n={half.get('n')}")
    if fast:
        return 0
    payload = {'version': 1, 'taus': TAUS, 'events': out_events, 'summary': summary}
    text_body = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    old = OUT.read_text(encoding='utf-8') if OUT.exists() else ''
    # builtAt 不參與比較：內容沒變就不寫檔，每日排程才不會產生空提交
    strip = lambda s: s.split('"builtAt"')[0] if s else s
    if old and json.loads(old).get('events') == payload['events'] and json.loads(old).get('summary') == payload['summary']:
        print(f'內容沒變，不寫檔（{time.time() - t0:.0f}s）')
        return 0
    payload['builtAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'已寫入 {OUT.relative_to(ROOT)}（{OUT.stat().st_size // 1024} KB，{time.time() - t0:.0f}s）')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
