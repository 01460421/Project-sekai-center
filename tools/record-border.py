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
  "roster": [[unix秒, 第1名的users索引, ..., 第100名], ...]  # 追特定玩家用
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


def get(path):
    req = urllib.request.Request(API + path, headers={'User-Agent': 'project-sekai-center/1.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def iso_to_unix(s):
    if not s:
        return None
    from datetime import datetime
    return int(datetime.fromisoformat(str(s).replace('Z', '+00:00')).timestamp())


def main():
    try:
        brd = get('/event/live/border')
        top = get('/event/live/top100')
    except Exception as e:
        print(f'API 讀取失敗: {e}', file=sys.stderr)
        return 1

    ev_id = brd.get('id')
    if ev_id is None:
        print('沒有進行中的活動,跳過')
        return 0

    rows = brd.get('player_border_rankings') or []
    if not rows:
        print('榜線為空,跳過')
        return 0

    now = iso_to_unix(None)
    import time
    now = int(time.time())

    end = iso_to_unix(brd.get('aggregate_at') or brd.get('closed_at'))
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
    top1 = rank_scores[0] if rank_scores else None

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
            'name': brd.get('name') or '',
            'startAt': brd.get('start_at') or '',
            'aggregateAt': brd.get('aggregate_at') or '',
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

    # 段位組成理論上不會變。萬一變了,改欄位順序會讓所有舊資料錯位,
    # 所以寧可中止讓人來處理,也不動既有的任何一列。
    if data.get('tiers') and data['tiers'] != tiers:
        print(f'段位組成有變,中止以免既有資料錯位:{data["tiers"]} → {tiers}', file=sys.stderr)
        return 1

    last = data['samples'][-1] if data['samples'] else None
    if last and now - last[0] < 4 * 60:
        print('距上一筆不足 4 分鐘,跳過')
        return 0

    data['samples'].append([now] + scores)
    if top1 is not None:
        data['top1'].append([now, top1])
    if rank_scores:
        data['ranks'].append([now] + rank_scores)
    if any(rank_uids):
        idx = {u: i for i, u in enumerate(data['users'])}
        row = []
        for u in rank_uids:
            if u not in idx:
                idx[u] = len(data['users'])
                data['users'].append(u)
            row.append(idx[u])
        data['roster'].append([now] + row)

    # 寫入前最後一道防線:樣本只能變多
    if len(data['samples']) <= before_n:
        print(f'樣本數沒有增加({before_n} → {len(data["samples"])}),中止', file=sys.stderr)
        return 1

    write_atomic(f, json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')

    idx = OUT / 'index.json'
    ids = sorted({int(p.stem) for p in OUT.glob('*.json') if p.stem.isdigit()})
    write_atomic(idx, json.dumps(ids, separators=(',', ':')) + '\n')

    print(f'第 {ev_id} 期:第 {len(data["samples"])} 筆快照,'
          f'榜線 {len(scores)} 段 + 前百 {len(rank_scores)} 名,T100={scores[0]:,}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
