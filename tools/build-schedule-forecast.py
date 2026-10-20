#!/usr/bin/env python3
"""排程預測（app.html?page=sched）：把日服的活動與卡池排程換算成台服預測，並逐期回測。

官方沒明說、但資料裡很乾淨的規律：台服的活動與卡池 id、素材名都跟日服一模一樣，開放時間是日服「同一天、同一個當地時刻」
再加一年（所以跨 2/29 那一年差 366 天、其他年差 365 天；台灣比日本慢一小時，換成 UTC 就是多 1 小時）。
這支不把規律寫死：每一期拿「之前幾期」的命中率在四條候選規則裡挑一條（同一天加一年／加 365 天／加 366 天／照上一期的延遲），
用它預測這一期，再跟台服 master 的實際時間比——這就是逐期回測；最近的規則就拿來算未來。卡池另外依名稱分類（生日、周年、
新春、復刻、FES、WL、通行證、免費、禮物、選擇清單、PU、一般），每一類從過去的偏差學一個修正量（周年類台服會提早幾天之類）。

輸出 data/schedule-forecast.js，內容沒變就不寫檔：
  SCHED_FORECAST = { built, rule, eras, evBack, evFuture, gaBack, gaFuture, cats, anomalies, manual }
  evBack 每列 [台服 id, 名稱, 類型, 日服開始, 台服實際開始, 預測開始, 用的規則, 偏差小時, 命中, 長度差小時]
  evFuture 每列 [id, 名稱, 類型, 開始, 結算, 結束, 來源 tw|pred, 日服 id, 模型是否同意]
  gaBack 每列 [id, 名稱, 池型, 分類, 日服開始, 台服實際開始, 預測開始, 偏差小時, 命中]
  gaFuture 每列 [id, 名稱, 池型, 分類, 開始, 結束, [[卡 id, 角色, 星級, 素材名]…], 活動 id, 站上列表差幾天|null, 來源 tw|pred, 信心]

    python3 tools/build-schedule-forecast.py        # 日服 master 用 jp_master 抓；離線測試可設 SCHED_JP_DIR 指向放 jp_events.json/jp_gachas.json 的資料夾
    python3 tools/stamp-assets.py
"""
import collections
import datetime
import json
import os
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from tc_source import TC, tc_json
from jp_master import get_jp

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'schedule-forecast.js'
EPOCH = datetime.datetime(1970, 1, 1)
H = 3600000
D = 86400000
WINDOW = 10        # 挑規則時回看幾期
TOL = H            # 命中容許：一小時內
CAT_MIN = 2        # 分類修正量至少要幾個樣本

CATS = [  # 依日服名稱分類；順序有意義，先符合的先算
    ('birthday', re.compile(r'HAPPY BIRTHDAY|HAPPY ANNIVERSARY', re.I)),
    ('anniv', re.compile(r'周年|週年|ANNIVERSARY', re.I)),
    ('newyear', re.compile(r'新春|お正月|初夢|年末|年始')),
    ('wl', re.compile(r'ワールドリンク|World Link|WL', re.I)),
    ('fes', re.compile(r'フェス|FES', re.I)),
    ('rerun', re.compile(r'復刻')),
    ('pass', re.compile(r'カラフルパス|通行證')),
    ('free', re.compile(r'無料|免費')),
    ('gift', re.compile(r'プレゼント|パッケージ|禮物|ギフト')),
    ('select', re.compile(r'セレクト|選擇|選択')),
    ('beginner', re.compile(r'初心者|新手|スタート')),
]
CAT_NAME = {'birthday': '生日池', 'anniv': '周年', 'newyear': '新春', 'wl': 'World Link', 'fes': 'FES', 'rerun': '復刻', 'pass': '通行證', 'free': '免費', 'gift': '禮物', 'select': '選擇清單', 'beginner': '新手', 'pickup': 'PU 池', 'normal': '一般'}
RULE_NAME = {'calendar': '同一天加一年', 'd365': '加 365 天', 'd366': '加 366 天', 'last': '照上一期的延遲'}
EV_NAME = {'marathon': '馬拉松', 'cheerful_carnival': '嘉年華', 'world_bloom': 'World Link'}


def load_jp(name):
    d = os.environ.get('SCHED_JP_DIR')
    if d:
        return json.load(open(pathlib.Path(d) / f'jp_{name}.json', encoding='utf-8'))
    return get_jp(name + '.json')


def shift_year(ms, years=1):
    """日服時刻（日本牆上時間）→ 台服同一天同一時刻（台灣時間）：加 years 年；2/29 落到 3/1。"""
    d = datetime.datetime.utcfromtimestamp(ms / 1000) + datetime.timedelta(hours=9)
    try:
        d2 = d.replace(year=d.year + years)
    except ValueError:
        d2 = d.replace(year=d.year + years, month=3, day=1)
    return int((d2 - datetime.timedelta(hours=8) - EPOCH).total_seconds() * 1000)


RULES = {
    'calendar': lambda ms, prev: shift_year(ms),
    'd365': lambda ms, prev: ms + 365 * D + H,
    'd366': lambda ms, prev: ms + 366 * D + H,
    'last': lambda ms, prev: (ms + prev) if prev is not None else shift_year(ms),
}
RULE_ORDER = ['calendar', 'last', 'd365', 'd366']


def pick_rule(history):
    """history：之前幾期的 {rule: hit?}；回看 WINDOW 期，命中最多的規則；平手照 RULE_ORDER。"""
    recent = history[-WINDOW:]
    if not recent:
        return 'calendar'
    score = {r: sum(1 for h in recent if h[r]) for r in RULE_ORDER}
    return max(RULE_ORDER, key=lambda r: (score[r], -RULE_ORDER.index(r)))


def is_test(name):
    """日服 master 裡的內部測試活動／卡池（台服不會開）"""
    return bool(re.search(r'テスト|test', name or '', re.I))


def category(name, gtype):
    for cat, rx in CATS:
        if rx.search(name or ''):
            return cat
    return 'pickup' if gtype == 'ceil' else 'beginner' if gtype == 'beginner' else 'gift' if gtype == 'gift' else 'normal'


def rh(x):
    return round(x / H, 1)


def cat_corr(offs):
    """分類修正量：過去同類卡池「實際 − 基本規則」的眾數；至少 CAT_MIN 個樣本、而且要占一半以上才採用，否則 0。"""
    if len(offs) < CAT_MIN:
        return 0
    c = collections.Counter(offs)
    off, n = c.most_common(1)[0]
    return off if n >= CAT_MIN and n * 2 >= len(offs) else 0


def main():
    tw_ev = tc_json(f'{TC}/events.json')
    tw_ga = tc_json(f'{TC}/gachas.json')
    jp_ev = load_jp('events')
    jp_ga = load_jp('gachas')
    if not tw_ev or not jp_ev:
        print('events 抓不到，不更新', file=sys.stderr)
        return 1
    now = int(datetime.datetime.utcnow().timestamp() * 1000)
    jpe = {e['id']: e for e in jp_ev}
    jpg = {g['id']: g for g in jp_ga}
    twe = {e['id']: e for e in tw_ev}
    twg = {g['id']: g for g in tw_ga}

    # ---------- 活動：逐期回測 ----------
    ev_rows = sorted([e for e in tw_ev if e['id'] in jpe and jpe[e['id']].get('assetbundleName') == e.get('assetbundleName')], key=lambda e: e['startAt'])
    history, ev_back, prev_lag = [], [], None
    for e in ev_rows:
        j = jpe[e['id']]
        rule = pick_rule(history)
        preds = {r: RULES[r](j['startAt'], prev_lag) for r in RULE_ORDER}
        hits = {r: abs(preds[r] - e['startAt']) <= TOL for r in RULE_ORDER}
        pred = preds[rule]
        err = e['startAt'] - pred
        len_diff = (e['aggregateAt'] - e['startAt']) - (j['aggregateAt'] - j['startAt'])
        ev_back.append([e['id'], e.get('name') or j.get('name') or '', e.get('eventType') or '', j['startAt'], e['startAt'], pred, rule, rh(err), abs(err) <= TOL, rh(len_diff)])
        history.append(hits)
        prev_lag = e['startAt'] - j['startAt']
    active_rule = pick_rule(history)
    # 延遲歷史：連續相同延遲（小時）的期數壓成一段
    eras = []
    for e in ev_rows:
        lag = round((e['startAt'] - jpe[e['id']]['startAt']) / H)
        if eras and eras[-1][2] == lag:
            eras[-1][1] = e['id']; eras[-1][3] += 1
        else:
            eras.append([e['id'], e['id'], lag, 1, e['startAt']])
    done = [r for r in ev_back if r[4] <= now]
    hit_all = sum(1 for r in done if r[8]); hit30 = sum(1 for r in done[-30:] if r[8])
    sched = [r for r in ev_back if r[4] > now]     # 台服 master 已排、還沒開的：也算一次「預告驗證」
    hit_sched = sum(1 for r in sched if r[8])

    # ---------- 活動：未來 ----------
    ev_future = []
    for e in sorted(tw_ev, key=lambda x: x['startAt']):
        if e['startAt'] > now:
            j = jpe.get(e['id'])
            agree = bool(j) and abs(RULES[active_rule](j['startAt'], prev_lag) - e['startAt']) <= TOL
            ev_future.append([e['id'], e.get('name') or '', e.get('eventType') or '', e['startAt'], e['aggregateAt'], e.get('closedAt') or 0, 'tw', e['id'] if j else 0, agree])
    tw_max_ev = max(e['id'] for e in tw_ev)
    for j in sorted(jp_ev, key=lambda x: x['startAt']):
        if j['id'] in twe or j['id'] <= tw_max_ev or is_test(j.get('name')):
            continue   # 台服已排／台服跳過（期數比台服已排的還小）／日服內部測試活動
        s = RULES[active_rule](j['startAt'], prev_lag)
        if s <= now:
            continue
        ev_future.append([j['id'], j.get('name') or '', j.get('eventType') or '', s, RULES[active_rule](j['aggregateAt'], prev_lag), RULES[active_rule](j.get('closedAt') or j['aggregateAt'], prev_lag), 'pred', j['id'], True])
    ev_future.sort(key=lambda r: r[3])

    # ---------- 卡池：分類修正量 + 逐池回測 ----------
    ga_rows = sorted([g for g in tw_ga if g['id'] in jpg], key=lambda g: g['startAt'])
    cat_off = collections.defaultdict(list)   # cat → [actual - base]（小時）
    ga_back, cat_stat = [], collections.defaultdict(lambda: {'n': 0, 'hit': 0})
    for g in ga_rows:
        j = jpg[g['id']]
        cat = category(j.get('name') or g.get('name'), j.get('gachaType'))
        base = RULES[active_rule](j['startAt'], prev_lag)
        corr = cat_corr(cat_off[cat])
        pred = base + corr
        err = g['startAt'] - pred
        hit = abs(err) <= TOL
        ga_back.append([g['id'], g.get('name') or j.get('name') or '', j.get('gachaType') or '', cat, j['startAt'], g['startAt'], pred, rh(err), hit])
        cat_stat[cat]['n'] += 1; cat_stat[cat]['hit'] += 1 if hit else 0
        cat_off[cat].append(round((g['startAt'] - base) / H) * H)
    cats = {}
    for cat, offs in cat_off.items():
        c = collections.Counter(int(o / H) for o in offs)
        cats[cat] = {'name': CAT_NAME.get(cat, cat), 'n': cat_stat[cat]['n'], 'hit': cat_stat[cat]['hit'],
                     'corr': int(cat_corr(offs) / H),
                     'offsets': [[k, v] for k, v in sorted(c.items())]}
    for cat in CAT_NAME:
        cats.setdefault(cat, {'name': CAT_NAME[cat], 'n': 0, 'hit': 0, 'corr': 0, 'offsets': []})

    # ---------- 卡池：未來 ----------
    jp_cards = {}
    try:
        for line in (ROOT / 'data' / 'cards-index-jp.js').read_text(encoding='utf-8').splitlines():
            m = re.match(r'\[(\d+),(\d+),(\d+),(-?\d+),(-?\d+),(-?\d+),(-?\d+),"(?:[^"\\]|\\.)*","([^"]*)"', line)
            if m:
                jp_cards[int(m.group(1))] = (int(m.group(2)), int(m.group(3)), m.group(8))
    except Exception as e:
        print('cards-index-jp 讀不到：' + str(e), file=sys.stderr)
    manual = {}
    try:
        t = (ROOT / 'data' / 'sekai-data.js').read_text(encoding='utf-8')
        m = re.search(r'GACHAS\s*=\s*(\[.*?\]);', t, re.S)
        for g in json.loads(m.group(1)):
            if str(g.get('id', '')).isdigit():
                manual[int(g['id'])] = g
    except Exception as e:
        print('sekai-data GACHAS 讀不到：' + str(e), file=sys.stderr)
    jp_ev_sorted = sorted(jp_ev, key=lambda x: x['startAt'])

    def event_of(ms):
        for j in jp_ev_sorted:
            if j['startAt'] <= ms < j['aggregateAt']:
                return j['id']
        return 0

    def manual_diff(gid, start):
        g = manual.get(gid)
        if not g:
            return None
        try:
            d = datetime.datetime.strptime(g['s'], '%Y/%m/%d')
            p = datetime.datetime.utcfromtimestamp(start / 1000) + datetime.timedelta(hours=8)
            return (d - p.replace(hour=0, minute=0, second=0, microsecond=0)).days
        except Exception:
            return None

    ga_future = []
    for g in sorted(tw_ga, key=lambda x: x['startAt']):
        if g['startAt'] > now and g['endAt'] - g['startAt'] < 400 * D:
            j = jpg.get(g['id']) or {}
            cat = category(j.get('name') or g.get('name'), g.get('gachaType'))
            pk = [[c, *jp_cards.get(c, (0, 0, ''))] for c in [p.get('cardId') for p in g.get('gachaPickups', [])] if c][:6]
            ga_future.append([g['id'], g.get('name') or '', g.get('gachaType') or '', cat, g['startAt'], g['endAt'], pk, event_of(j['startAt']) if j else 0, manual_diff(g['id'], g['startAt']), 'tw', 1.0])
    for j in sorted(jp_ga, key=lambda x: x['startAt']):
        if j['id'] in twg or (j['endAt'] - j['startAt']) >= 400 * D or is_test(j.get('name')):
            continue
        cat = category(j.get('name'), j.get('gachaType'))
        corr = cats[cat]['corr'] * H
        s = RULES[active_rule](j['startAt'], prev_lag) + corr
        if s <= now or s > now + 400 * D:
            continue
        e = RULES[active_rule](j['endAt'], prev_lag) + corr
        pk = [[c, *jp_cards.get(c, (0, 0, ''))] for c in [p.get('cardId') for p in j.get('gachaPickups', [])] if c][:6]
        conf = (cats[cat]['hit'] / cats[cat]['n']) if cats[cat]['n'] else (hit30 / max(1, len(done[-30:])))
        ga_future.append([j['id'], j.get('name') or '', j.get('gachaType') or '', cat, s, e, pk, event_of(j['startAt']), manual_diff(j['id'], s), 'pred', round(conf, 2)])
    ga_future.sort(key=lambda r: (r[4], r[0]))

    anomalies = [['event', r[0], r[1], r[4], r[5], r[7], ('長度差 %+g 小時' % r[9]) if r[9] else ''] for r in ev_back if not r[8] or r[9]] + \
                [['gacha', r[0], r[1], r[5], r[6], r[7], CAT_NAME.get(r[3], r[3])] for r in ga_back if not r[8]]
    rule = {'active': active_rule, 'activeName': RULE_NAME[active_rule], 'lagHours': round(prev_lag / H, 2) if prev_lag is not None else None,
            'evN': len(done), 'evHit': hit_all, 'ev30N': len(done[-30:]), 'ev30Hit': hit30, 'schedN': len(sched), 'schedHit': hit_sched,
            'gaN': len(ga_back), 'gaHit': sum(1 for r in ga_back if r[8]), 'window': WINDOW, 'tolHours': TOL / H,
            'startHours': sorted({(e.get('eventType'), (datetime.datetime.utcfromtimestamp(e['startAt'] / 1000) + datetime.timedelta(hours=8)).hour) for e in tw_ev}),
            'jpLatestEvent': max(j['id'] for j in jp_ev), 'twLatestEvent': max(e['id'] for e in tw_ev), 'twGachaN': len(tw_ga), 'jpGachaN': len(jp_ga)}
    out = {'built': now, 'rule': rule, 'eras': eras, 'evBack': list(reversed(ev_back)), 'evFuture': ev_future, 'gaBack': list(reversed(ga_back)),
           'gaFuture': ga_future, 'cats': cats, 'anomalies': anomalies, 'manual': len(manual)}
    body = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    text = ('/* 由 tools/build-schedule-forecast.py 產生,勿手改。排程預測頁用：台服照日服同一天加一年的規律，逐期回測與未來活動／卡池預測。 */\n'
            f'export const SCHED_FORECAST={body};\n')
    old = OUT.read_text(encoding='utf-8') if OUT.exists() else ''
    # built 每次都不同，只比對 built 以外的內容
    strip = lambda s: re.sub(r'"built":\d+', '"built":0', s)
    if strip(old) == strip(text):
        print(f'內容無變化,不更新 {OUT.name}')
        return 0
    OUT.write_text(text, encoding='utf-8')
    print(f'寫入 {OUT.name}:{OUT.stat().st_size // 1024} KB（活動回測 {len(ev_back)} 期命中 {hit_all}/{len(done)}、預告 {hit_sched}/{len(sched)}；卡池回測 {rule["gaHit"]}/{rule["gaN"]}；未來活動 {len(ev_future)}、未來卡池 {len(ga_future)}；規則 {RULE_NAME[active_rule]}）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
