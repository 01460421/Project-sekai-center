#!/usr/bin/env python3
"""產生 data/wl3-zone.js：WL3 專區用的小檔（約 20 KB）。

專區要的東西散在幾個大檔裡（活動資料兩服各 700 KB、日服榜線資料庫 100 KB、WL3 計算器 155 KB），
只為了一頁時程表與榜線就把它們全載進來太重，所以每天從這些已經建好的檔案裡挑出 WL3 那幾期：

  ・時程：日服 master 的每一期、每一章（開始、結算）；台服 master 已經有的那幾期用台服的正式時間與台服名稱，
          還沒有的照排程預測的規律（日服同一時刻加 lagHours，目前 8761 小時＝一年又一小時）推估，並標成「預估」。
  ・榜線：日服每一章與每一期總榜的最終榜線（挑幾個常看的名次）。
  ・限定卡：終章的 26 張 WL3 限定卡（各章的活動卡），台服有的卡用台服卡名。
  ・規則與滿配：每期的總合力上限、玩偶上限、技能上限（日服 master），以及主隊、後排與合計的滿配加成
    （數字全部從 data/wl3-power.js 的規則表算，跟 WL3 計算器一致）。

輸入（都由每日排程先建好）：data/event-info-jp.js、data/event-info.js、data/borders-db-jp.js、
data/wl3-power.js、data/cards-index.js、data/schedule-forecast.js；技能上限另讀日服 master。

用法：python3 tools/build-wl3-zone.py
"""
import json
import pathlib
import re
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from jp_master import get_jp

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
OUT = DATA / 'wl3-zone.js'
TIERS = [10, 100, 1000, 5000, 10000, 50000]     # 專區榜線表要列的名次
SUP_N = 25                                         # WL3 後排張數
ROW = re.compile(r'\[(\d+),(\d+),(\d+),(\d+),(\d+),(-?\d+),(\d+),"([^"]*)","([^"]*)"(?:,[^\]]*)?\]')


def js_const(name, var):
    """讀 data/ 底下 `export const VAR=...` 或 `window.VAR=...` 形式的產生檔。"""
    s = (DATA / name).read_text(encoding='utf-8')
    m = re.search(r'(?:export const|window\.)\s*' + var + r'\s*=', s)
    if not m:
        raise SystemExit(f'{name} 裡找不到 {var}')
    txt = s[m.end():].strip()
    # 只取到這個常數結束：其後可能還有別的 export
    depth, end, instr, esc = 0, None, False, False
    for i, ch in enumerate(txt):
        if instr:
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == '"':
                instr = False
            continue
        if ch == '"':
            instr = True
        elif ch in '[{':
            depth += 1
        elif ch in ']}':
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    return json.loads(txt[:end])


def r1(v):
    return round(v * 10) / 10


def main():
    jp = js_const('event-info-jp.js', 'EVENT_INFO')['ev']
    tw = {e[0]: e for e in js_const('event-info.js', 'EVENT_INFO')['ev']}
    bdb = js_const('borders-db-jp.js', 'BORDERS_DB')
    wp = js_const('wl3-power.js', 'WL3P')
    try:
        lag_h = float(js_const('schedule-forecast.js', 'SCHED_FORECAST')['rule']['lagHours'])
    except Exception:
        lag_h = 8761.0
    lag = int(lag_h * 3600000)
    tw_name = {}
    for r in ROW.findall((DATA / 'cards-index.js').read_text(encoding='utf-8')):
        tw_name[int(r[0])] = r[7]

    wl3 = sorted([e for e in jp if e[2] == 'world_bloom' and str(e[4]).startswith('event_wl_3rd')], key=lambda e: e[0])
    if len(wl3) < 6:
        raise SystemExit(f'日服活動資料裡只有 {len(wl3)} 期 WL3，資料不對，不覆寫')
    wpe = {e[0]: e for e in wp['events']}

    # 技能上限（日服第 218 期 140＝+140%；大於 200 的寫法是含本體 100%）
    skl = {}
    for x in get_jp('eventSkillScoreUpLimits.json') or []:
        v = +x.get('scoreUpRateLimit', 0)
        if v:
            skl[x['eventId']] = v - 100 if v > 200 else v

    # 榜線：名次 → 欄位索引
    wt = bdb.get('wlTiers') or []
    mt = bdb.get('tiers') or []
    wl_rows = {r['id']: r for r in bdb.get('wl') or []}
    main_rows = {r['id']: r for r in bdb.get('borders') or []}

    def pick(row, tiers):
        if not row:
            return None
        t = row.get('t') or []
        return [(t[tiers.index(k)] if k in tiers and tiers.index(k) < len(t) else None) for k in TIERS]

    sup4 = wp['sup']['4']                    # [本章角色, 其他, [MR0..5], [SL1..4]]
    rar4 = wp['evb']['rar']['4'][5]
    attr5 = wp['evb']['attr'][4]
    events, cards = [], []
    seen_card = {}
    part = 0
    for e in wl3:
        eid = e[0]
        fin = all(c[1] in (0, None) for c in (e[15] or [])) or len(e[15] or []) <= 1
        if not fin:
            part += 1
        t = tw.get(eid)
        off = bool(t)
        tw_ch = {c[0]: c for c in (t[15] if t else [])}
        chs = []
        for c in e[15] or []:
            no, ch, s, a = c[0], c[1], c[2], c[3]
            tc = tw_ch.get(no)
            chs.append([no, ch, s, a, tc[2] if tc else s + lag, tc[3] if tc else a + lag,
                        pick(wl_rows.get(f'{eid}.{no}'), wt)])
        W = wpe.get(eid)
        R = (W[12] if W and len(W) > 12 else None) or {}
        ec = max(R.get('ec', {}).values() or [0])
        cb = max([v for o in R.get('cb', {}).values() for v in o.values()] or [0])
        if fin:
            sh = R.get('shuffle') or {}
            main = 5 * (ec + cb + rar4) + attr5 + (max(sh.values()) if sh else 0) + R.get('lead', 0) + R.get('title', 0)
        else:
            main = 5 * (ec + cb + rar4) + attr5
        lim = W[11] if W and len(W) > 11 else {}
        lim_max = max([sum(b for _, b in v) for v in lim.values()] or [0])
        sup = SUP_N * (sup4[0] + sup4[2][5] + sup4[3][3]) + lim_max
        events.append({
            'id': eid, 'jp': e[1], 'tw': t[1] if t else None, 'abn': e[4], 'fin': fin, 'part': 0 if fin else part,
            'jpT': [e[5], e[6]], 'twT': [t[5], t[6]] if t else [e[5] + lag, e[6] + lag], 'twOff': off,
            'ch': chs, 'main': pick(main_rows.get(eid), mt),
            'cap': W[4] if W else None, 'doll': W[5] if W else None, 'skill': skl.get(eid),
            'ec': ec, 'cb': cb, 'lead': R.get('lead', 0), 'title': R.get('title', 0), 'shuffle': R.get('shuffle') or {},
            'limMax': R.get('limMax'), 'bMain': r1(main), 'bSup': r1(sup), 'bAll': r1(main + sup),
        })
        for c in e[13] or []:
            if c[0] not in seen_card:
                seen_card[c[0]] = eid
    fin_ev = next((e for e, x in zip(wl3, events) if x['fin']), wl3[-1])
    for c in fin_ev[13] or []:
        cards.append([c[0], c[1], c[3], c[4], c[5], tw_name.get(c[0]), seen_card.get(c[0], fin_ev[0])])
    if len(cards) < 20:
        raise SystemExit(f'終章限定卡只有 {len(cards)} 張，資料不對，不覆寫')

    out = {'built': int(time.time() * 1000), 'lagH': lag_h, 'tiers': TIERS, 'supN': SUP_N, 'rar4': rar4, 'attr5': attr5,
           'sup': {'spec': sup4[0], 'other': sup4[1], 'mr': sup4[2][5], 'sl': sup4[3][3]},
           'events': events, 'cards': cards}
    text = ('/* 由 tools/build-wl3-zone.py 產生，勿手改。WL3 專區：各期各章的日服時間與台服時間（台服 master 有的用正式時間，'
            '其餘照排程預測推估）、日服最終榜線、WL3 限定卡、每期規則與滿配加成。 */\n'
            'export const WL3Z=' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
    old = OUT.read_text(encoding='utf-8') if OUT.exists() else ''
    strip = lambda s: re.sub(r'"built":\d+', '', s)
    if strip(old) == strip(text):
        print('內容無變化，不更新 wl3-zone.js')
        return 0
    OUT.write_text(text, encoding='utf-8')
    print(f'寫出 {OUT.name}：{len(events)} 期、{sum(len(e["ch"]) for e in events)} 章、{len(cards)} 張限定卡，'
          f'{OUT.stat().st_size // 1024} KB；台服正式時間 {sum(e["twOff"] for e in events)} 期')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
