"""資料載入：公用榜線時序（data/history/{id}.json）、good果汁終線表（data/borders-db.js）、
官方終線（hisekai /event/{id}/border 與 /top100，快取在 tools/border_model/finals.json）。

只依賴 numpy。fixMono 與 js/app.js 的 fixMono 逐行對應：分數只增不減，
由後往前取 running-min，把 WL 期間 API 串值造成的假高值壓回去。
"""
from __future__ import annotations

import json
import math
import pathlib
import time
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
HIST_DIR = ROOT / 'data' / 'history'
BDB_PATH = ROOT / 'data' / 'borders-db.js'
FINALS_PATH = pathlib.Path(__file__).resolve().parent / 'finals.json'
API = 'https://api.hisekai.org/tw'
HOUR = 3600.0


# ----------------------------------------------------------------------------
# 小工具
# ----------------------------------------------------------------------------
def iso_to_unix(s) -> int:
    return int(datetime.fromisoformat(str(s).replace('Z', '+00:00')).timestamp())


def spec_kind(spec) -> tuple:
    """100 / 'T100' -> ('tier', 100)；'R5' -> ('rank', 5)。"""
    if isinstance(spec, (int, np.integer)):
        return ('tier', int(spec))
    s = str(spec).strip().upper()
    if s.startswith('R'):
        return ('rank', int(s[1:]))
    if s.startswith('T'):
        return ('tier', int(s[1:]))
    return ('tier', int(s))


def spec_key(spec) -> str:
    k, v = spec_kind(spec)
    return ('T' if k == 'tier' else 'R') + str(v)


def fix_mono(rows: List[list], n: int) -> List[list]:
    """app.js fixMono 的逐行移植。rows = [[ts, v1..vn], ...]（允許 None），回傳副本。"""
    out = [list(r) for r in rows]
    for i in range(1, n + 1):
        nxt = None
        for j in range(len(out) - 1, -1, -1):
            x = out[j][i] if i < len(out[j]) else None
            if x is None:
                continue
            if nxt is not None and x > nxt:
                out[j][i] = nxt
            else:
                nxt = x
    return out


# ----------------------------------------------------------------------------
# Event
# ----------------------------------------------------------------------------
@dataclass
class Event:
    id: object                          # int，WL 章節為 '176.1'
    name: str
    start: int                          # unix 秒
    end: int                            # aggregate_at
    tiers: List[int]
    ts: np.ndarray
    S: np.ndarray                       # 修過單調的榜線，NaN = 缺
    raw_S: np.ndarray                   # 原始紀錄
    rts: np.ndarray = field(default_factory=lambda: np.array([]))
    R: np.ndarray = field(default_factory=lambda: np.zeros((0, 100)))
    raw_R: np.ndarray = field(default_factory=lambda: np.zeros((0, 100)))
    users: List[str] = field(default_factory=list)
    roster: np.ndarray = field(default_factory=lambda: np.zeros((0, 100), int))
    is_wl: bool = False
    chapter: Optional[int] = None
    character: Optional[int] = None
    parent: Optional[int] = None
    wl: Dict[int, 'Event'] = field(default_factory=dict)
    finals: Dict[str, float] = field(default_factory=dict)
    final_src: Dict[str, str] = field(default_factory=dict)
    final_users: Dict[str, str] = field(default_factory=dict)   # 最終前百 {名次: uid}

    @property
    def total_h(self) -> float:
        return (self.end - self.start) / HOUR

    @property
    def covered(self) -> bool:
        return bool(len(self.ts) and self.ts[-1] >= self.end)

    @property
    def rank_covered(self) -> bool:
        return bool(len(self.rts) and self.rts[-1] >= self.end)

    def col(self, spec) -> int:
        k, v = spec_kind(spec)
        if k == 'tier':
            return self.tiers.index(v) if v in self.tiers else -1
        return v - 1 if 1 <= v <= self.R.shape[1] else -1

    def matrix(self, spec):
        k, v = spec_kind(spec)
        c = self.col(spec)
        if c < 0:
            return np.array([]), np.array([])
        return (self.ts, self.S[:, c]) if k == 'tier' else (self.rts, self.R[:, c])

    def has(self, spec) -> bool:
        ts, col = self.matrix(spec)
        return bool(len(col) and np.isfinite(col).any())

    def final(self, spec):
        v = self.finals.get(spec_key(spec))
        return float(v) if v is not None else None

    def last_sample(self, spec):
        ts, col = self.matrix(spec)
        if not len(col):
            return None
        m = np.isfinite(col)
        return float(col[m][-1]) if m.any() else None

    def altered_mask(self, spec) -> np.ndarray:
        """True = 該筆紀錄被單調修復改寫過（WL 污染窗）。"""
        k, v = spec_kind(spec)
        c = self.col(spec)
        if c < 0:
            return np.zeros(0, bool)
        raw, fx = (self.raw_S[:, c], self.S[:, c]) if k == 'tier' else (self.raw_R[:, c], self.R[:, c])
        return np.isfinite(raw) & ((raw != fx) | ~np.isfinite(fx))

    def key(self) -> str:
        return str(self.id)

    def __repr__(self):
        return (f"Event({self.id}, n={len(self.ts)}, ranks={len(self.rts)}, tiers={len(self.tiers)}, "
                f"covered={self.covered}, finals={self.final_src}, wl={sorted(self.wl)})")


def _rows_to_arrays(samples, n):
    rows = []
    for r in samples:
        if not r or r[0] is None:
            continue
        rows.append([int(r[0])] + [(r[i] if i < len(r) else None) for i in range(1, n + 1)])
    rows.sort(key=lambda r: r[0])
    ded = {}
    for r in rows:
        ded[r[0]] = r
    return [ded[k] for k in sorted(ded)]


def _to_np(rows, n):
    ts = np.array([r[0] for r in rows], dtype=float)
    S = np.full((len(rows), n), np.nan)
    for j, r in enumerate(rows):
        for i in range(n):
            v = r[i + 1]
            if v is not None:
                S[j, i] = float(v)
    return ts, S


def _build_event(d: dict, id_, is_wl=False, parent=None) -> Event:
    tiers = [int(t) for t in (d.get('tiers') or [])]
    n = len(tiers)
    rows = _rows_to_arrays(d.get('samples') or [], n)
    raw_ts, raw_S = _to_np(rows, n)
    ts, S = _to_np(fix_mono(rows, n), n)
    ev = Event(id=id_, name=d.get('name') or str(id_),
               start=iso_to_unix(d['startAt']), end=iso_to_unix(d['aggregateAt']),
               tiers=tiers, ts=ts, S=S, raw_S=raw_S, is_wl=is_wl,
               chapter=d.get('chapter'), character=d.get('character'), parent=parent)
    rk = d.get('ranks') or []
    if rk:
        rrows = _rows_to_arrays(rk, 100)
        rts, R = _to_np(rrows, 100)                 # 名次線不修單調：名次掉出前百是真的
        ev.rts, ev.R, ev.raw_R = rts, R, R.copy()
        ev.users = [str(u) for u in (d.get('users') or [])]
        ro = {int(r[0]): r for r in (d.get('roster') or []) if r and r[0] is not None}
        roster = np.full((len(rts), 100), -1, int)
        for j, t in enumerate(rts):
            r = ro.get(int(t))
            if r:
                for i in range(1, min(101, len(r))):
                    if r[i] is not None:
                        roster[j, i - 1] = int(r[i])
        ev.roster = roster
    return ev


# ----------------------------------------------------------------------------
# 官方終線快取（tools/border_model/finals.json）
#   {'border': {'175': {'final': {tier: score}, 'wl': [{'gameCharacterId', 'final': {...}}]}},
#    'top100': {'175': {'ranks': {rank: score}, 'users': {rank: uid}}}}
# ----------------------------------------------------------------------------
def load_finals_cache(path: pathlib.Path = FINALS_PATH) -> dict:
    if path.exists():
        d = json.loads(path.read_text(encoding='utf-8'))
        d.setdefault('border', {})
        d.setdefault('top100', {})
        return d
    return {'border': {}, 'top100': {}}


def save_finals_cache(cache: dict, path: pathlib.Path = FINALS_PATH) -> bool:
    text = json.dumps(cache, ensure_ascii=False, indent=0, sort_keys=True) + '\n'
    if path.exists() and path.read_text(encoding='utf-8') == text:
        return False
    path.write_text(text, encoding='utf-8')
    return True


def _get(path):
    req = urllib.request.Request(API + path, headers={'User-Agent': 'project-sekai-center/1.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def _rows_final(rows):
    out = {}
    for r in rows or []:
        if r.get('rank') is not None and r.get('score') is not None:
            out[str(int(r['rank']))] = float(r['score'])
    return out


def fetch_finals(ev_id: int) -> tuple:
    """回 (border_entry, top100_entry)；任一失敗回 None。isEventAggregate 只是旗標，
    呼叫端要自己確認活動已結束才把它當終線。"""
    b = t = None
    try:
        d = _get(f'/event/{ev_id}/border')
        b = {'fetchedAt': int(time.time()), 'final': _rows_final(d.get('borderRankings')),
             'wl': [{'gameCharacterId': w.get('gameCharacterId'), 'final': _rows_final(w.get('borderRankings'))}
                    for w in (d.get('userWorldBloomChapterRankingBorders') or []) if w.get('gameCharacterId') is not None]}
        if not b['final']:
            b = None
    except Exception:
        b = None
    try:
        d = _get(f'/event/{ev_id}/top100')
        rows = d.get('rankings') or d.get('player_top_100_rankings') or []
        t = {'fetchedAt': int(time.time()), 'ranks': _rows_final(rows),
             'users': {str(int(r['rank'])): str(r.get('userId') if r.get('userId') is not None else r.get('user_id', ''))
                       for r in rows if r.get('rank') is not None}}
        if not t['ranks']:
            t = None
    except Exception:
        t = None
    return b, t


# ----------------------------------------------------------------------------
# 載入
# ----------------------------------------------------------------------------
def _attach_finals(ev: Event, official: Optional[dict], live: bool, kind: str):
    prefix = 'T' if kind == 'tier' else 'R'
    if official and not live:
        for k, v in official.items():
            if v is not None:
                ev.finals[prefix + str(int(k))] = float(v)
        ev.final_src[kind] = 'api'
        return
    cov = ev.covered if kind == 'tier' else ev.rank_covered
    if cov and not live:
        specs = ev.tiers if kind == 'tier' else [f'R{k}' for k in range(1, ev.R.shape[1] + 1)]
        for s in specs:
            v = ev.last_sample(s)
            if v is not None:
                ev.finals[spec_key(s)] = v
        ev.final_src[kind] = 'last_sample'
    else:
        ev.final_src[kind] = 'none'


def load_event(path: pathlib.Path, finals: dict, now: float = None) -> Event:
    d = json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
    ev = _build_event(d, int(d.get('eventId', pathlib.Path(path).stem)))
    now = now if now is not None else datetime.now(timezone.utc).timestamp()
    live = now < ev.end + HOUR
    api = (finals.get('border') or {}).get(str(ev.id)) or {}
    _attach_finals(ev, api.get('final'), live, 'tier')
    top = (finals.get('top100') or {}).get(str(ev.id)) or {}
    _attach_finals(ev, top.get('ranks'), live, 'rank')
    ev.final_users = {str(k): str(v) for k, v in (top.get('users') or {}).items()} if not live else {}
    api_wl = {}
    for w in api.get('wl') or []:
        if w.get('gameCharacterId') is not None:
            api_wl[int(w['gameCharacterId'])] = w.get('final') or {}
    for k, w in (d.get('wl') or {}).items():
        ch = int(w.get('chapter', k))
        ce = _build_event(w, f'{ev.id}.{ch}', is_wl=True, parent=ev.id)
        ce.name = f'{d.get("name", ev.id)} ch{ch}'
        off = api_wl.get(int(w.get('character', -1)))
        _attach_finals(ce, off if off else None, now < ce.end + HOUR, 'tier')
        ce.final_src['rank'] = 'none'
        ev.wl[ch] = ce
    return ev


def history_files(hist_dir: pathlib.Path = HIST_DIR) -> List[pathlib.Path]:
    return sorted(p for p in hist_dir.glob('*.json') if p.stem.isdigit())


def load_borders_db(path: pathlib.Path = BDB_PATH) -> dict:
    s = path.read_text(encoding='utf-8')
    j = s[s.index('{'):].rstrip().rstrip(';')
    return json.loads(j)


def db_event(db: dict, ev_id):
    for e in db['events']:
        if int(e['id']) == int(str(ev_id).split('.')[0]):
            return e
    return None


# ----------------------------------------------------------------------------
# 前百玩家
# ----------------------------------------------------------------------------
def player_series(ev: Event, uid) -> List[tuple]:
    uid = str(uid)
    if uid not in ev.users:
        return []
    ui = ev.users.index(uid)
    out = []
    for j in range(len(ev.rts)):
        pos = np.where(ev.roster[j] == ui)[0]
        if len(pos):
            v = ev.R[j, pos[0]]
            if np.isfinite(v):
                out.append((float(ev.rts[j]), float(v)))
    return out


def players_at(ev: Event, t: float) -> List[dict]:
    m = np.where(ev.rts <= t)[0]
    if not len(m):
        return []
    j = m[-1]
    out = []
    for i in range(100):
        ui = ev.roster[j, i]
        if ui >= 0 and np.isfinite(ev.R[j, i]):
            out.append({'uid': ev.users[ui], 'rank': i + 1, 'score': float(ev.R[j, i]), 't': float(ev.rts[j])})
    return out


def player_finals(ev: Event) -> Dict[str, dict]:
    out = {}
    if ev.final_users:
        for r, uid in ev.final_users.items():
            sc = ev.finals.get(f'R{int(r)}')
            if sc is not None:
                out[str(uid)] = {'rank': int(r), 'score': float(sc)}
        return out
    if ev.rank_covered:
        for p in players_at(ev, float('inf')):
            out[p['uid']] = {'rank': p['rank'], 'score': p['score']}
    return out
