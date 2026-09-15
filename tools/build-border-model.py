#!/usr/bin/env python3
"""重擬榜線終線預測模型 M3，輸出 data/border-model.json（前端 js/border-model.js 讀）。

輸入：
  data/history/*.json          公用榜線時序（主榜 18 段、前百逐名次、WL 各章）
  data/borders-db.js           good果汁終線表（先驗成員 m_P 與活動型態）
  tools/border_model/finals.json  官方終線快取（hisekai /event/{id}/border 與 /top100）；
                               已結束但快取裡沒有的期數會嘗試抓一次，抓到就寫回快取

訓練集：所有已結束（結算後 1 小時以上）且有終線的期數。主榜／名次／玩家三個家族用主榜期數，
WL 章節家族用各 WL 期的章節榜。

內容沒變就不寫檔，CI 才不會產生空提交：

    python3 tools/build-border-model.py

方法與回測見 tools/border_model/model.py 開頭。只用 numpy。
"""
import json
import os
import pathlib
import sys
import time

# 41 個參數的 normal equation 很小，多執行緒 BLAS 反而慢 7 倍；擬合端固定單執行緒
for _v in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS'):
    os.environ.setdefault(_v, '1')

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from border_model import data as D, model as M   # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'border-model.json'


def main():
    t0 = time.time()
    now = time.time()
    finals = D.load_finals_cache()

    # 先掃一遍：已結束但沒有終線快取的期數，去 API 補（失敗就靠「最後一筆快照」或跳過）
    fetched = False
    for p in D.history_files():
        d = json.loads(p.read_text(encoding='utf-8'))
        ev_id = str(d.get('eventId', p.stem))
        try:
            end = D.iso_to_unix(d['aggregateAt'])
        except Exception:
            continue
        if now < end + D.HOUR:
            continue
        need_b = ev_id not in finals['border']
        need_t = ev_id not in finals['top100']
        if not (need_b or need_t):
            continue
        b, t = D.fetch_finals(int(ev_id))
        if need_b and b:
            finals['border'][ev_id] = b; fetched = True
        if need_t and t:
            finals['top100'][ev_id] = t; fetched = True
        print(f'第 {ev_id} 期終線：border {"ok" if b else "無"}、top100 {"ok" if t else "無"}')
    if fetched and D.save_finals_cache(finals):
        print('終線快取已更新', D.FINALS_PATH.relative_to(ROOT))

    evs = [D.load_event(p, finals, now) for p in D.history_files()]
    done = [e for e in evs if now >= e.end + D.HOUR]
    main = [e for e in done if e.final_src.get('tier') != 'none' and len(e.ts)]
    ranked = [e for e in main if e.final_src.get('rank') != 'none' and len(e.rts)]
    chapters = [c for e in done for k, c in sorted(e.wl.items())
                if c.final_src.get('tier') != 'none' and len(c.ts)]
    for e in evs:
        print(' ', e)
    print(f'主榜訓練期 {[e.id for e in main]}；名次／玩家 {[e.id for e in ranked]}；WL 章節 {[c.id for c in chapters]}')
    if len(main) < 2:
        print('已結束的期數不足 2 期，無法擬合', file=sys.stderr)
        return 1

    db = D.load_borders_db()
    params = M.params_header()
    fam = {}
    fam['tier'] = M.M3Model(main, 'tier', db).to_json()
    if len(chapters) >= 2:
        fam['wl'] = M.M3Model(chapters, 'wl', None).to_json()
    if len(ranked) >= 2:
        fam['rank'] = M.M3Model(ranked, 'rank', None).to_json()
        fam['player'] = M.PlayerModel(ranked).to_json()
    params['families'] = fam
    params['builtFrom'] = {'events': [e.id for e in main], 'chapters': [c.id for c in chapters]}

    text = json.dumps(params, indent=1, ensure_ascii=False)
    if OUT.exists() and OUT.read_text(encoding='utf-8') == text:
        print(f'內容沒變，不寫檔（{len(text):,} 字元，{time.time() - t0:.0f}s）')
        return 0
    OUT.write_text(text, encoding='utf-8')
    print(f'已寫入 {OUT.relative_to(ROOT)}（{len(text):,} 字元，{time.time() - t0:.0f}s）')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
