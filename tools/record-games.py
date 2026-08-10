#!/usr/bin/env python3
"""逐局活動P 採集器：每 15 秒掃一次前 50 名，只記「有變動」的那一筆。

一局協力最短約 150 秒（曲長＋結算＋房間），所以 15 秒間隔絕不會把兩局併成一筆，
時間戳誤差 ±15 秒。API 支援 brotli/gzip，帶 Accept-Encoding 後回應從 120KB 降到 14~26KB。

輸出（append，只增不減）：
  data/games/{eventId}.jsonl        每行一局 [玩家索引, 相對秒數, 增量活動P, 當下名次]
  data/games/{eventId}.meta.json    {event, users:[uid...], gaps:[[起,迄]...], updatedAt}
  data/games/index.json             有哪幾期、各幾筆

設計取捨：
  * 只做前 50 名 —— API 只有前 100 名有本期活動分數，非前百查不到（不是偷懶）。
  * 玩家用索引不存 uid —— uid 是 19 位大整數，直接寫進 JSON 會被 JS 讀成失精的浮點數。
  * 時間存「相對活動開始的秒數」—— 比絕對時間短很多，整筆才 17 bytes。
  * 每 FLUSH_MIN 分鐘寫檔＋提交一次 —— job 中途被砍最多只丟這段。

單獨執行時預設跑 330 分鐘（給 GitHub Actions 的 6 小時上限留餘裕）：
    python3 tools/record-games.py [分鐘數]
"""
import gzip
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = 'https://api.hisekai.org/tw/event/live/top100'
EVENT_LIST = 'https://api.hisekai.org/tw/event/list'
TOP_N = 50
INTERVAL = 15          # 秒。< 150 就不會漏局
FLUSH_MIN = 30         # 每 30 分鐘寫檔＋提交
BACKOFF_MAX = 300      # 失敗退避上限（秒）
GAP_FACTOR = 3         # 超過 3 個週期沒成功就記一段缺口
UA = 'project-sekai-center/1.0 (+https://project-sekai-center.vercel.app) per-game-tracker'   # HTTP header 只能 ASCII

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'games'


def fetch(url):
    req = urllib.request.Request(url, headers={
        'user-agent': UA,
        'accept-encoding': 'gzip',      # br 要額外套件，gzip 內建就夠（26KB）
    })
    with urllib.request.urlopen(req, timeout=25) as r:
        raw = r.read()
        if r.headers.get('content-encoding') == 'gzip':
            raw = gzip.decompress(raw)
    # 19 位 uid 超過 JSON/JS 的安全整數，parse 前先轉成字串（站上踩過的老雷）
    raw = re.sub(rb'([\[:,]\s*)(\d{16,})', rb'\1"\2"', raw)
    return json.loads(raw)


def _window(e):
    """從活動物件取出 {id,name,startAt,aggregateAt}（欄位在兩支 API 有 camel/snake 兩種寫法）。"""
    st = e.get('start_at') or e.get('startAt')
    en = e.get('aggregate_at') or e.get('aggregateAt') or e.get('closed_at')
    if st is None or en is None:
        return None
    return {'id': e.get('id'), 'name': e.get('name'),
            'startAt': st if isinstance(st, (int, float)) else _ms(st),
            'aggregateAt': en if isinstance(en, (int, float)) else _ms(en)}


def live_event():
    """回傳進行中的活動；沒有就回 None。

    先查活動列表；列表掛掉就退回即時排名那支——它的頂層本來就帶當期活動的期程，
    是同一份資料的另一個入口，不必因為列表出問題就整輪不掃。
    """
    now = time.time() * 1000
    try:
        lst = fetch(EVENT_LIST)
        rows = lst if isinstance(lst, list) else (lst.get('events') or lst.get('data') or [])
        for e in rows:
            w = _window(e)
            if w and w['startAt'] <= now <= w['aggregateAt']:
                return w
        return None            # 列表拿得到、確實沒有進行中的活動
    except Exception as e:
        print(f'活動列表載入失敗（{type(e).__name__}: {e}），改用即時排名判斷', file=sys.stderr)
    try:
        w = _window(fetch(API))
        if w and w['startAt'] <= now <= w['aggregateAt']:
            return w
    except Exception as e:
        print(f'即時排名也載入失敗（{type(e).__name__}: {e}）', file=sys.stderr)
    return None


def _ms(s):
    import datetime
    return datetime.datetime.fromisoformat(str(s).replace('Z', '+00:00')).timestamp() * 1000


def git(*args):
    return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True)


def commit(paths, msg):
    """提交並推送。併發（榜線快照也在推）時 rebase 重試，與 border-snapshot 同款。

    只在 CI 裡（或明確設 RECORD_GAMES_COMMIT=1）才推送——本機跑個幾分鐘試東西
    不該把測試資料塞進正式 repo。
    """
    if not (os.environ.get('GITHUB_ACTIONS') or os.environ.get('RECORD_GAMES_COMMIT')):
        print('  （本機模式：只寫檔不提交）')
        return False
    if not git('status', '--porcelain', *paths).stdout.strip():
        return False
    git('config', 'user.name', 'github-actions[bot]')
    git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
    git('add', *paths)
    git('commit', '-m', msg)
    for _ in range(3):
        git('pull', '--rebase', '--autostash', 'origin', 'main')
        if git('push', 'origin', 'HEAD:main').returncode == 0:
            return True
        time.sleep(5)
    print('推送失敗，資料留在工作區等下一輪', file=sys.stderr)
    return False


class Recorder:
    def __init__(self, ev):
        self.ev = ev
        self.start_ms = ev['startAt']
        OUT.mkdir(parents=True, exist_ok=True)
        self.jsonl = OUT / f"{ev['id']}.jsonl"
        self.meta_p = OUT / f"{ev['id']}.meta.json"
        # 接力：沿用既有的玩家索引表，索引才不會在每個 job 之間跑掉
        self.meta = {'event': ev, 'users': [], 'gaps': []}
        if self.meta_p.exists():
            try:
                old = json.loads(self.meta_p.read_text())
                self.meta['users'] = old.get('users', [])
                self.meta['gaps'] = old.get('gaps', [])
            except Exception:
                pass
        self.uidx = {u: i for i, u in enumerate(self.meta['users'])}
        self.pending = []
        self.prev = {}
        self.last_ok = None

    def rel(self, ms=None):
        return int(((ms or time.time() * 1000) - self.start_ms) / 1000)

    def scan(self):
        d = fetch(API)
        rows = d['player_top_100_rankings'][:TOP_N]
        now = time.time()
        # 中斷過久：這段期間的增量會是多局合併，記成缺口讓前端標示，不假裝完整
        if self.last_ok and now - self.last_ok > INTERVAL * GAP_FACTOR:
            self.meta['gaps'].append([self.rel(self.last_ok * 1000), self.rel(now * 1000)])
        cur, t = {}, self.rel(now * 1000)
        for r in rows:
            uid = r['last_player_info']['profile']['id']
            cur[uid] = r['score']
            if uid not in self.uidx:
                self.uidx[uid] = len(self.meta['users'])
                self.meta['users'].append(uid)
            old = self.prev.get(uid)
            # 第一輪、或玩家剛進榜：沒有基準值，不能當成一局
            if old is not None and r['score'] != old:
                self.pending.append([self.uidx[uid], t, r['score'] - old, r['rank']])
        self.prev = cur
        self.last_ok = now
        return len(rows)

    def flush(self):
        if not self.pending:
            # 沒有新局也要更新 meta 的 gaps/updatedAt
            self._write_meta()
            return 0
        with self.jsonl.open('a') as f:
            for g in self.pending:
                f.write(json.dumps(g, separators=(',', ':')) + '\n')
        n = len(self.pending)
        self.pending = []
        self._write_meta()
        self._write_index()
        return n

    def _write_meta(self):
        self.meta['updatedAt'] = int(time.time() * 1000)
        self.meta['topN'] = TOP_N
        self.meta['interval'] = INTERVAL
        self.meta_p.write_text(json.dumps(self.meta, ensure_ascii=False, separators=(',', ':')))

    def _write_index(self):
        idx = []
        for p in sorted(OUT.glob('*.jsonl')):
            eid = p.stem
            mp = OUT / f'{eid}.meta.json'
            try:
                m = json.loads(mp.read_text())
            except Exception:
                continue
            with p.open() as f:
                n = sum(1 for _ in f)
            idx.append({'eventId': int(eid), 'name': (m.get('event') or {}).get('name'),
                        'games': n, 'users': len(m.get('users', [])),
                        'gaps': len(m.get('gaps', [])), 'updatedAt': m.get('updatedAt')})
        (OUT / 'index.json').write_text(json.dumps(idx, ensure_ascii=False, separators=(',', ':')))


def main():
    minutes = float(sys.argv[1]) if len(sys.argv) > 1 else 330
    ev = live_event()
    if not ev:
        # 非活動期間直接收工，不佔 runner、也不打人家的 API
        print('目前沒有進行中的活動，本輪不掃描。')
        return 0
    print(f"開始記錄：#{ev['id']} {ev['name']}｜前 {TOP_N} 名｜每 {INTERVAL} 秒｜預計 {minutes:.0f} 分鐘")
    rec = Recorder(ev)
    t0 = time.time()
    deadline = t0 + minutes * 60
    last_flush = t0
    fails = 0
    backoff = INTERVAL
    total = 0
    while time.time() < deadline:
        loop = time.time()
        # 活動結束就收工（不必等 job 跑滿）
        if time.time() * 1000 > ev['aggregateAt']:
            print('活動已結算，提前收工。')
            break
        try:
            rec.scan()
            fails = 0
            backoff = INTERVAL
        except Exception as e:
            fails += 1
            # 失敗退避：連續失敗就拉長間隔，別在對方出狀況時猛打
            backoff = min(BACKOFF_MAX, INTERVAL * (2 ** min(fails, 5)))
            print(f'  ! 第 {fails} 次失敗（{type(e).__name__}: {e}），{backoff}s 後重試', file=sys.stderr)
        if (time.time() - last_flush) / 60 >= FLUSH_MIN:
            n = rec.flush()
            total += n
            if n:
                commit(['data/games'], f"逐局紀錄 {time.strftime('%Y-%m-%d %H:%M', time.gmtime())} UTC [skip ci]")
            print(f'  已寫入 {n} 局（累計 {total}）')
            last_flush = time.time()
        time.sleep(max(0, backoff - (time.time() - loop)))

    n = rec.flush()
    total += n
    if n:
        commit(['data/games'], f"逐局紀錄 {time.strftime('%Y-%m-%d %H:%M', time.gmtime())} UTC [skip ci]")
    print(f'本輪結束：共記錄 {total} 局、{len(rec.meta["users"])} 位玩家、{len(rec.meta["gaps"])} 段缺口')
    return 0


if __name__ == '__main__':
    sys.exit(main())
