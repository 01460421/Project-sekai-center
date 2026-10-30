#!/usr/bin/env python3
"""記錄當期榜線快照，累積成全時間軸資料。

台服沒有任何現成的榜線時序來源:
  - HiSekai API 只給當下數值,/history、/graph、/trend 全是 404
  - api.sekai.best 有完整時序,但 region=tw 回空(它只追日服)
所以只能自己定時記。這支由 .github/workflows/border-snapshot.yml
每 10 分鐘跑一次,把結果 append 進 data/history/{eventId}.json,
網站再從 raw.githubusercontent.com 讀,所有訪客都看得到同一份完整曲線。

檔案格式(刻意壓扁,一天 48 筆、一期約 340 筆也才幾十 KB):
{
  "eventId": 175,
  "name": "...",
  "startAt": "...", "aggregateAt": "...",
  "tiers": [100, 200, ..., 50000],          # 欄位順序
  "samples": [[unix秒, 分數1, 分數2, ...], ...],
  "top1": [[unix秒, 分數], ...],
  "ranks": [[unix秒, 第1名分數, 第2名分數, ..., 第100名分數], ...],
  "users": ["7013511661659167489", ...],   # 出現過的玩家(字串,避免大整數失精)
  "roster": [[unix秒, 第1名的users索引, ..., 第100名], ...],  # 追特定玩家用
  "wl": {"1": {"chapter":1,"character":5,"tiers":[...],"samples":[[unix秒, 各段分數...]]}}  # World Link 各章獨立榜線
}
"""
import json
import os
import pathlib
import sys
import urllib.request

API = 'https://api.hisekai.org/tw'
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'history'


def write_atomic(path, text):
    """先寫暫存檔再 rename。直接覆寫的話,程式中途被砍或磁碟寫到一半,
    就會留下一個截斷的檔案,整期歷史一次報銷。"""
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(text, encoding='utf-8')
    os.replace(tmp, path)


# HiSekai 讀不到時改問自家 Worker 的 Haruki 備援（已轉成 HiSekai 同樣的欄位，下面的程式不必分兩套）
HARUKI_FALLBACK = 'https://games.project-sekai-center.com/haruki'
# 自家 Worker 的追蹤器每 5 分鐘也記一筆快照（GitHub 排程實測 4～5 小時才跑一次，中間全靠它）；
# 每次執行先把上一筆之後的快照補進來，再記當下這一筆
SNAPS = 'https://games.project-sekai-center.com/snaps'


def _get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'project-sekai-center/1.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def get(path):
    try:
        return _get(API + path)
    except Exception as e:
        print(f'HiSekai {path} 失敗（{e}），改用 Haruki 備援', file=sys.stderr)
        return _get(HARUKI_FALLBACK + path)


def iso_to_unix(s):
    if not s:
        return None
    from datetime import datetime
    return int(datetime.fromisoformat(str(s).replace('Z', '+00:00')).timestamp())


def add_sample(data, now, tiers, by_rank, rank_scores, rank_uids, wl):
    """把一筆快照接到 data 後面。tiers 是這筆的段位順序，by_rank 是 {名次: 分數}，rank_scores／rank_uids 是前百
    （名次由小到大），wl 是 HiSekai 格式的 World Link 章節列表。距上一筆不足 4 分鐘就不記，回 False。"""
    last = data['samples'][-1] if data['samples'] else None
    if last and now - last[0] < 4 * 60:
        return False
    # 段位組成會變 —— 實測官方在活動中途加開了 T100000(17 → 18 段)。
    # 不能重排欄位順序,那會讓所有既有列錯位;但也不該直接中止,
    # 否則整期就再也記不到任何東西(這次就是這樣卡了兩天)。
    # 做法:既有順序原封不動,新段位往後追加。舊列因此比新列短,
    # 讀取端本來就是依 rank 查找、查不到就略過,不會出錯。
    if not data.get('tiers'):
        data['tiers'] = list(tiers)
    known = list(data['tiers'])
    added = [r for r in tiers if r not in known]
    if added:
        print(f'新增段位 {added},往後追加')
        known = known + added
        data['tiers'] = known
    scores = [by_rank.get(r) for r in known]        # 一律照既有欄位順序輸出

    # World Link:每章有獨立角色與榜線,分開存成 wl[章節]
    # 章節結構(角色、期程)不會變,榜線段位可能隨開章才出現,
    # 一樣採「既有順序不動、新段位往後追加」。
    if wl:
        data.setdefault('wl', {})
        for c in wl:
            # 2026-09 HiSekai 把章節欄位改名：player_borders → player_border_rankings、
            # closed_at → ranking_announce_at。只認舊名的話每章都被當成「未開章」跳過，
            # 第 179 期整期的 WL 章節榜線就是這樣一筆都沒記到。新名在前、舊名當後備。
            pb = c.get('player_border_rankings') or c.get('player_borders') or []
            if not pb:
                continue                      # 未開章的章節官方回空,跳過
            key = str(c.get('chapter'))
            slot = data['wl'].setdefault(key, {
                'chapter': c.get('chapter'), 'character': c.get('character'),
                'startAt': c.get('start_at') or '',
                'aggregateAt': c.get('aggregate_at') or c.get('ranking_announce_at') or c.get('closed_at') or '',
                'tiers': [], 'samples': []
            })
            wk = list(slot['tiers'])
            for r in pb:
                if r['rank'] not in wk:
                    wk.append(r['rank'])
            slot['tiers'] = wk
            by = {r['rank']: r.get('score') for r in pb}
            slot['samples'].append([now] + [by.get(r) for r in wk])

    data['samples'].append([now] + scores)
    if rank_scores:
        if rank_scores[0] is not None:
            data['top1'].append([now, rank_scores[0]])
        data['ranks'].append([now] + list(rank_scores))
    if any(rank_uids):
        idx = {u: i for i, u in enumerate(data['users'])}
        row = []
        for u in rank_uids:
            if u not in idx:
                idx[u] = len(data['users'])
                data['users'].append(u)
            row.append(idx[u])
        data['roster'].append([now] + row)
    return True


def backfill(data, ev_id):
    """把 Worker 追蹤器在上一筆之後記的快照補進 data，回傳補了幾筆。讀不到就當沒有（不影響本次取樣）。"""
    since = data['samples'][-1][0] if data['samples'] else 0
    try:
        d = _get(f'{SNAPS}?ev={ev_id}&since={since}')
    except Exception as e:
        print(f'Worker 快照讀取失敗（{e}），本次不補', file=sys.stderr)
        return 0
    n = 0
    for snap in (d.get('snaps') or []):
        try:
            ts, rows, tops, wl = snap[0], snap[1] or [], snap[2] or [], snap[3] or []
            tiers = [r[0] for r in rows]
            by_rank = {r[0]: r[1] for r in rows}
            rank_scores = [t[0] if isinstance(t, list) else t for t in tops]
            rank_uids = [str(t[1]) if isinstance(t, list) and len(t) > 1 else '' for t in tops]
            wl_list = [{'chapter': c[0], 'character': c[1], 'start_at': c[2], 'aggregate_at': c[3],
                        'player_border_rankings': [{'rank': r[0], 'score': r[1]} for r in c[4]]} for c in wl]
            if add_sample(data, int(ts), tiers, by_rank, rank_scores, rank_uids, wl_list):
                n += 1
        except Exception as e:
            print(f'略過一筆格式不對的 Worker 快照（{e}）', file=sys.stderr)
    return n


def main():
    try:
        top = get('/event/live/top100')
    except Exception as e:
        print(f'API 讀取失敗: {e}', file=sys.stderr)
        return 1
    # 段位端點壞掉時照樣記前百（Haruki Event Tracker 也是這樣處理）：
    # 2026-09 第 180 期 WL 終章，官方榜線段位端點整期出錯，HiSekai /event/live/border 回 500、
    # Haruki 也沒有段位；前百仍正常。這時用前百第 100 名當 T100，其餘段位留空。
    try:
        brd = get('/event/live/border')
    except Exception as e:
        print(f'榜線段位讀取失敗（{e}），本次只記前百', file=sys.stderr)
        brd = None

    meta = brd or top
    ev_id = meta.get('id')
    if ev_id is None:
        print('沒有進行中的活動,跳過')
        return 0

    if brd:
        rows = brd.get('player_border_rankings') or []
    else:
        t100 = [t for t in (top.get('player_top_100_rankings') or []) if t.get('rank') == 100]
        rows = [{'rank': 100, 'score': t100[0].get('score')}] if t100 else []
    if not rows:
        print('榜線為空,跳過')
        return 0

    now = iso_to_unix(None)
    import time
    now = int(time.time())

    end = iso_to_unix(meta.get('aggregate_at') or meta.get('closed_at'))
    if end and now > end + 3 * 3600:
        print(f'第 {ev_id} 期已結算超過 3 小時,跳過')
        return 0

    tiers = [r['rank'] for r in rows]
    scores = [r.get('score') for r in rows]

    # 前 100 名逐名次的分數曲線。API 只公開前百與這 17 段，
    # 其餘名次(例如第 137 名、第 8500 名)沒有任何端點拿得到。
    tops = top.get('player_top_100_rankings') or []
    tops = sorted([t for t in tops if t.get('rank')], key=lambda t: t['rank'])
    rank_scores = [t.get('score') for t in tops]
    # 每個名次當下是誰。用字串存 —— userId 是 19 位數,
    # 存成 JSON 數字的話瀏覽器 JSON.parse 會把尾數四捨五入。
    rank_uids = [str((t.get('last_player_info') or {}).get('profile', {}).get('id')
                     or t.get('userId') or t.get('user_id') or '') for t in tops]

    OUT.mkdir(parents=True, exist_ok=True)
    f = OUT / f'{ev_id}.json'
    if f.is_file():
        # 紀錄是只增不減的:讀不出來就中止,絕不用新檔覆蓋既有檔案,
        # 否則一次解析失敗就會把整期歷史洗掉(時間過了永遠補不回來)。
        try:
            data = json.loads(f.read_text(encoding='utf-8'))
        except Exception as e:
            print(f'既有紀錄無法解析,中止以免覆蓋:{e}', file=sys.stderr)
            return 1
        if not isinstance(data, dict) or not isinstance(data.get('samples'), list):
            print('既有紀錄結構異常,中止以免覆蓋', file=sys.stderr)
            return 1
    else:
        data = {
            'eventId': ev_id,
            'name': meta.get('name') or '',
            'startAt': meta.get('start_at') or '',
            'aggregateAt': meta.get('aggregate_at') or '',
            'tiers': tiers,
            'samples': [],
            'top1': [],
            'ranks': [],
            'users': [],      # 出現過的 userId(字串),roster 存的是這裡的索引
            'roster': [],     # 每筆 = [unix秒, 第1名的users索引, ..., 第100名]
        }
    data.setdefault('ranks', [])
    data.setdefault('users', [])
    data.setdefault('roster', [])
    before_n = len(data['samples'])

    # 先補 Worker 記的快照（上一筆之後的每 5 分鐘一筆），再記當下這一筆
    merged = backfill(data, ev_id)
    if merged:
        print(f'從 Worker 補進 {merged} 筆快照')

    by_rank = {r['rank']: r.get('score') for r in rows}
    absent = [r for r in (data.get('tiers') or []) if r not in by_rank]
    if absent:
        print(f'這次沒回傳的段位 {absent},該欄位留空')
    wl = (brd or {}).get('world_link_border_rankings') or []
    if not add_sample(data, now, tiers, by_rank, rank_scores, rank_uids, wl):
        print('距上一筆不足 4 分鐘,跳過')
        if not merged:
            return 0

    # 寫入前最後一道防線:樣本只能變多
    if len(data['samples']) <= before_n:
        print(f'樣本數沒有增加({before_n} → {len(data["samples"])}),中止', file=sys.stderr)
        return 1

    write_atomic(f, json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')

    idx = OUT / 'index.json'
    ids = sorted({int(p.stem) for p in OUT.glob('*.json') if p.stem.isdigit()})
    write_atomic(idx, json.dumps(ids, separators=(',', ':')) + '\n')

    wln = sum(len(v['samples']) for v in (data.get('wl') or {}).values())
    print(f'第 {ev_id} 期:第 {len(data["samples"])} 筆快照,'
          f'榜線 {len(scores)} 段 + 前百 {len(rank_scores)} 名'
          + (f' + WL {len(data.get("wl") or {})} 章(累計 {wln} 筆)' if data.get('wl') else '')
          + (f',T100={scores[0]:,}' if scores and scores[0] is not None else '')
          + ('' if brd else '（段位端點失敗，只有前百）'))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
