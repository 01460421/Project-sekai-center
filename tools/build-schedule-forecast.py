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
  gaFuture 每列 [id, 名稱, 池型, 分類, 開始, 結束, [[卡 id, 角色, 星級, 素材名]…], 活動 id, 站上列表差幾天|null, 來源 tw|pred|jp, 信心, (jp) 日服推估開始, 規則名]
  evFuture 來源 jp（日服還沒公布、用日服自己的規律推估）的列多 [日服推估開始, 團體候選1, 候選2, 混活比例, 規則名]
  jp：第二層的回測與規則；jpBack 每列 [日服 id, 名稱, 類型, 實際開始, 預測開始, 規則, 偏差小時, 命中, 預測類型, 類型命中, 實際團體, 候選1, 候選2]

第二層（日服自己的規律，推估日服還沒公布的）：日服的排程本身一年一年很像（10/11、10/21、10/31…），所以「去年同日的下一期」是主規則，
「結算後隔兩天 15:00」是節奏規則，一樣逐期挑；類型照模板（嘉年華已停辦）；團體用「最久沒輪到的團」給前兩名候選（屬性查過沒有規律，不猜）。
卡池每一類在「去年同日／活動開始日 12:00／每月第一個週一 04:00（通行證）／每月 12 日 12:00（復刻）／WL 前 7 天」裡挑回測最高的規則。

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


# ---------- 日服自己的規律（推估日服還沒公布的期數） ----------
JP_WIN = 6 * D          # 年度模板：找一年前 ±6 天內最接近的那期
JP_TOL = 36 * H         # 日服推估的命中容許：差一天以內
JP_HORIZON = 366 * D    # 往後推估一年
JP_CHAIN = 36           # 連鎖回測往後推幾期
GA_RECENT = 24          # 卡池挑規則只看每一類最近幾個樣本（排程改制後舊規律不算數）
JP_SINCE = 2022         # 回測從哪一年起（之前排程還沒定型）
UNITS5 = ['light_sound', 'idol', 'street', 'theme_park', 'school_refusal']
UNIT_KEY = {'light_sound': 'ln', 'idol': 'mmj', 'street': 'vbs', 'theme_park': 'wxs', 'school_refusal': 'n25'}
JP_RULES = ['tpl', 'cad']
JP_RULE_NAME = {'tpl': '去年同日的下一期', 'cad': '結算後隔兩天 15:00'}
GA_RULE_NAME = {'yearly': '去年同日', 'bday4': '生日前 4 天 00:00', 'evday': '活動開始日 12:00', 'mon1': '每月第一個週一 04:00', 'd12': '每月 12 日 12:00', 'wl7': 'World Link 開始前 7 天 12:00', 'yearly7': '去年同日前後一週'}
BDAY_LEAD = 4           # 生日池：生日前幾天 00:00 開


def jst(ms):
    return datetime.datetime.utcfromtimestamp(ms / 1000) + datetime.timedelta(hours=9)


def from_jst(d):
    return int((d - datetime.timedelta(hours=9) - EPOCH).total_seconds() * 1000)


def shift_year_jp(ms, years=1):
    """日服時刻 → 日服同一天同一時刻再加 years 年（2/29 落到 3/1）"""
    d = jst(ms)
    try:
        d2 = d.replace(year=d.year + years)
    except ValueError:
        d2 = d.replace(year=d.year + years, month=3, day=1)
    return from_jst(d2)


def jp_template(prev_start, hist):
    """年度模板：一年前最接近 prev_start 的那期（±JP_WIN），回傳它的下一期；找不到回 None"""
    best = None
    for i, e in enumerate(hist):
        d = abs(shift_year_jp(e['startAt']) - prev_start)
        if d <= JP_WIN and (best is None or d < best[0]):
            best = (d, i)
    if best is None or best[1] + 1 >= len(hist):
        return None
    return hist[best[1] + 1]


def jp_cadence(prev):
    """節奏規則：上一期結算日再隔兩天 15:00（馬拉松 8.25 天＋10 天一期、World Link 12 天＋14 天一期都符合）"""
    return from_jst(jst(prev['aggregateAt']).replace(hour=15, minute=0, second=0, microsecond=0) + datetime.timedelta(days=2))


def median(xs, default=0):
    xs = sorted(xs)
    return xs[len(xs) // 2] if xs else default


def bump_year(name):
    """卡池名稱裡的年份、周年數往後推一年：HAPPY BIRTHDAY2026 → 2027、5周年 → 6周年、5.5周年 → 6.5周年"""
    name = re.sub(r'20(\d\d)', lambda m: '20%02d' % (int(m.group(1)) + 1), name or '')
    return re.sub(r'(\d+(?:\.\d)?)(周年|週年)', lambda m: ('%g' % (float(m.group(1)) + 1)) + m.group(2), name)


def first_monday(y, m):
    d = datetime.datetime(y, m, 1, 4, 0)
    return d + datetime.timedelta(days=(7 - d.weekday()) % 7)


def pick_jp_rule(history):
    recent = history[-WINDOW:]
    if not recent:
        return 'tpl'
    score = {r: sum(1 for h in recent if h[r]) for r in JP_RULES}
    return max(JP_RULES, key=lambda r: (score[r], -JP_RULES.index(r)))


def jp_self_events(jp_ev):
    """用日服自己的規律逐期回測，再往後推估一年。回 (back_rows, future, stats)。
    back_rows 每列 [id, 名稱, 類型, 實際開始, 預測開始, 規則, 偏差小時, 命中, 預測類型, 類型命中, 實際團體, 候選1, 候選2]
    future 每列 {id, type, start, aggregate, closed, unit1, unit2, mixed, rule}"""
    ev = [e for e in sorted(jp_ev, key=lambda x: x['startAt']) if not is_test(e.get('name'))]
    hits_hist, back = [], []
    unit_n = unit1 = unit2 = 0

    def lru(hist):
        last = {u: -1 for u in UNITS5}
        for i, e in enumerate(hist):
            if e.get('unit') in last:
                last[e['unit']] = i
        return sorted(UNITS5, key=lambda u: last[u])

    def predict(prev, hist, rule):
        tpl = jp_template(prev['startAt'], hist)
        cand = {'tpl': shift_year_jp(tpl['startAt']) if tpl else None, 'cad': jp_cadence(prev)}
        if tpl and not (5 * D <= cand['tpl'] - prev['startAt'] <= 20 * D):
            cand['tpl'] = None   # 模板算出來的間隔離譜（去年這時候的排程跟今年對不上）就不用
        use = rule if cand.get(rule) else 'cad'
        typ = tpl['eventType'] if tpl else 'marathon'
        if typ == 'cheerful_carnival' and not any(e['eventType'] == 'cheerful_carnival' for e in hist[-20:]):
            typ = 'marathon'   # 嘉年華已停辦，去年模板若是嘉年華就當馬拉松
        start = cand[use]
        if use == 'cad' or not tpl:
            start = from_jst(jst(start).replace(hour=20 if typ == 'world_bloom' else 15))
        same = [e for e in hist[-40:] if e['eventType'] == typ]
        length = (tpl['aggregateAt'] - tpl['startAt']) if tpl else median([e['aggregateAt'] - e['startAt'] for e in same], 8 * D + 6 * H)
        close = median([e['closedAt'] - e['aggregateAt'] for e in same if e.get('closedAt')], 34 * H)
        order = lru([e for e in hist if e['eventType'] != 'world_bloom'])
        wl_unit = next((e.get('unit') for e in reversed(hist) if e['eventType'] == 'world_bloom'), 'none')
        return {'type': typ, 'start': start, 'aggregate': start + length, 'closed': start + length + close, 'rule': use, 'cand': cand,
                'unit1': wl_unit if typ == 'world_bloom' else order[0], 'unit2': '' if typ == 'world_bloom' else order[1]}

    for i in range(1, len(ev)):
        cur, prev, hist = ev[i], ev[i - 1], ev[:i]
        if jst(cur['startAt']).year < JP_SINCE:
            continue
        rule = pick_jp_rule(hits_hist)
        p = predict(prev, hist, rule)
        hits_hist.append({r: p['cand'][r] is not None and abs(p['cand'][r] - cur['startAt']) <= JP_TOL for r in JP_RULES})
        err = cur['startAt'] - p['start']
        type_hit = p['type'] == cur['eventType']
        u = cur.get('unit') or 'none'
        if cur['eventType'] != 'world_bloom' and u in UNITS5:
            unit_n += 1; unit1 += p['unit1'] == u; unit2 += u in (p['unit1'], p['unit2'])
        back.append([cur['id'], cur.get('name') or '', cur['eventType'], cur['startAt'], p['start'], p['rule'], rh(err), abs(err) <= JP_TOL, p['type'], type_hit,
                     UNIT_KEY.get(u, u), UNIT_KEY.get(p['unit1'], p['unit1']), UNIT_KEY.get(p['unit2'], p['unit2'])])
    active = pick_jp_rule(hits_hist)
    non_wl = [e for e in ev[-60:] if e['eventType'] != 'world_bloom']
    mixed = round(100 * sum(1 for e in non_wl if (e.get('unit') or 'none') == 'none') / max(1, len(non_wl)))
    # 往後推估：從最後一期實際的往下接，推估出來的期也接著當「上一期」
    future, prev, hist, nid = [], ev[-1], list(ev), max(e['id'] for e in jp_ev)
    while True:
        p = predict(prev, hist, active)
        if p['start'] > ev[-1]['startAt'] + JP_HORIZON:
            break
        nid += 1
        future.append({'id': nid, 'type': p['type'], 'start': p['start'], 'aggregate': p['aggregate'], 'closed': p['closed'], 'rule': p['rule'],
                       'unit1': UNIT_KEY.get(p['unit1'], p['unit1']), 'unit2': UNIT_KEY.get(p['unit2'], p['unit2']), 'mixed': mixed})
        prev = {'id': nid, 'name': '', 'eventType': p['type'], 'startAt': p['start'], 'aggregateAt': p['aggregate'], 'closedAt': p['closed'], 'unit': p['unit1']}
        hist.append(prev)
    # 連鎖回測：從 2024 年起的每一期當起點，只用它之前的資料往後連推 JP_CHAIN 期（推估的期接著當上一期），逐期跟實際比
    chain = collections.defaultdict(lambda: [0, 0, 0, 0])   # 第 k 步 → [期數, 日期命中（一天內）, 類型命中, 三天內]
    for a in range(len(ev)):
        if jst(ev[a]['startAt']).year < 2024 or a + 1 >= len(ev):
            continue
        prev_c, hist_c = ev[a], ev[:a + 1]
        for k in range(1, JP_CHAIN + 1):
            if a + k >= len(ev):
                break
            p = predict(prev_c, hist_c, active)
            act = ev[a + k]
            c = chain[k]
            c[0] += 1; c[1] += abs(p['start'] - act['startAt']) <= JP_TOL; c[2] += p['type'] == act['eventType']; c[3] += abs(p['start'] - act['startAt']) <= 3 * D + 12 * H
            prev_c = {'id': 0, 'name': '', 'eventType': p['type'], 'startAt': p['start'], 'aggregateAt': p['aggregate'], 'closedAt': p['closed'], 'unit': p['unit1']}
            hist_c = hist_c + [prev_c]
    chain_rows = [[k, c[0], c[1], c[2], c[3]] for k, c in sorted(chain.items())]
    bucket = lambda lo, hi: [sum(c[i] for k, c in chain.items() if lo <= k <= hi) for i in (0, 1, 2, 3)]
    stats = {'since': JP_SINCE, 'chain': chain_rows, 'chainBuckets': [[1, 12] + bucket(1, 12), [13, 24] + bucket(13, 24), [25, JP_CHAIN] + bucket(25, JP_CHAIN)], 'n': len(back), 'hit': sum(1 for r in back if r[7]), 'hit60': sum(1 for r in back if abs(r[6]) <= 60), 'n30': len(back[-30:]), 'hit30': sum(1 for r in back[-30:] if r[7]),
             'typeHit': sum(1 for r in back if r[9]), 'unitN': unit_n, 'unit1': unit1, 'unit2': unit2, 'mixed': mixed, 'active': active, 'activeName': JP_RULE_NAME[active],
             'ruleHits': {r: sum(1 for h in hits_hist if h[r]) for r in JP_RULES}, 'tolHours': JP_TOL / H, 'horizonDays': JP_HORIZON // D, 'latestStart': ev[-1]['startAt'], 'futureN': len(future)}
    return back, future, stats


def jp_self_gachas(jp_ga, jp_ev, future_ev, bdays, cnames, jp_cards):
    """卡池：每一類在幾條規則裡挑回測命中最高的，再用它往後推估一年。回 (rules, future, 日服最後一池開始)。
    future 每列 {name, gtype, cat, start, end, evId, conf, rule}"""
    ev = [e for e in sorted(jp_ev, key=lambda x: x['startAt']) if not is_test(e.get('name'))]
    ga = [g for g in sorted(jp_ga, key=lambda x: x['startAt']) if g['endAt'] - g['startAt'] < 400 * D and not is_test(g.get('name'))]
    ev_days = {jst(e['startAt']).date(): e for e in ev}
    wl_days = {jst(e['startAt']).date() for e in ev if e['eventType'] == 'world_bloom'}
    since = from_jst(datetime.datetime(2024, 1, 1))

    def is_evday(g):
        t = jst(g['startAt'])
        return g['gachaType'] == 'ceil' and t.date() in ev_days and t.hour == 12 and not re.search(r'復刻|BIRTHDAY|ANNIVERSARY', g['name'], re.I)

    def cat_of(g):
        return 'pickup' if is_evday(g) else category(g['name'], g['gachaType'])

    def chara_of(g):
        for pk in g.get('gachaPickups', []):
            c = jp_cards.get(pk.get('cardId'))
            if c:
                return c[0]
        return 0

    def bday_start(cid, year):
        b = bdays.get(cid)
        if not b:
            return None
        try:
            return from_jst(datetime.datetime(year, b[0], b[1]) - datetime.timedelta(days=BDAY_LEAD))
        except ValueError:
            return None

    samples = collections.defaultdict(list)   # cat → [{rule: hit?}]（照時間）
    for g in ga:
        if g['startAt'] < since:
            continue
        cat = cat_of(g)
        t = jst(g['startAt'])
        older = [h for h in ga if h['startAt'] < g['startAt'] - 300 * D and cat_of(h) == cat]
        samples[cat].append({
            'yearly': any(abs(shift_year_jp(h['startAt']) - g['startAt']) <= JP_TOL for h in older),
            'yearly7': any(abs(shift_year_jp(h['startAt']) - g['startAt']) <= 7 * D + JP_TOL for h in older),
            'bday4': cat == 'birthday' and bday_start(chara_of(g), t.year) is not None and abs(bday_start(chara_of(g), t.year) - g['startAt']) <= H,
            'evday': is_evday(g),
            'mon1': abs((t - first_monday(t.year, t.month)).total_seconds()) <= 3600,
            'd12': t.day == 12 and t.hour == 12,
            'wl7': t.hour == 12 and any((d - t.date()).days in (6, 7, 8) for d in wl_days)})
    rules = {}
    for cat, rows in samples.items():
        recent = rows[-GA_RECENT:]
        score = {r: sum(1 for x in recent if x[r]) for r in GA_RULE_NAME}
        strict = [r for r in GA_RULE_NAME if r != 'yearly7']
        best = max(strict, key=lambda r: (score[r], -strict.index(r)))
        if score[best] * 10 < len(recent) * 3 and score['yearly7'] * 2 >= len(recent):
            best = 'yearly7'   # 嚴格規則都不行、但「前後一週」有一半以上：用寬鬆版（FES 這類）
        rules[cat] = {'rule': best, 'name': GA_RULE_NAME[best], 'hit': score[best], 'n': len(recent), 'all': len(rows)}
    # 活動池這條改用「每期活動有沒有池」算命中，比用池算更貼切
    ev_recent = [e for e in ev if e['startAt'] >= since]
    if 'pickup' in rules:
        evday_hit = sum(1 for e in ev_recent if any(is_evday(g) and jst(g['startAt']).date() == jst(e['startAt']).date() for g in ga))
        rules['pickup'].update({'rule': 'evday', 'name': GA_RULE_NAME['evday'], 'hit': evday_hit, 'n': len(ev_recent), 'all': len(ev_recent)})
    last = max(g['startAt'] for g in ga)
    horizon = last + JP_HORIZON

    def dur(cat):
        return median([g['endAt'] - g['startAt'] for g in ga[-300:] if cat_of(g) == cat], 10 * D)

    future = []
    for cat, r in rules.items():
        if r['n'] < 3 or r['hit'] * 10 < r['n'] * 3:
            continue   # 樣本太少、或最好的規則也只中不到三成：不推估
        conf = round(r['hit'] / r['n'], 2)
        row = lambda name, gtype, s, e, ev_id: {'name': name, 'gtype': gtype, 'cat': cat, 'start': s, 'end': e, 'evId': ev_id, 'conf': conf, 'rule': r['name']}
        if r['rule'] in ('yearly', 'yearly7'):
            seen = {}
            for g in ga:
                if last - 366 * D < g['startAt'] <= last and cat_of(g) == cat:
                    s = shift_year_jp(g['startAt'])
                    if last < s <= horizon:
                        if cat == 'rerun':   # 復刻池明年同一天也會有，但標題不會一樣：同一天壓成一列
                            if s in seen:
                                seen[s]['name'] = '復刻ガチャ ×%d' % (int(seen[s]['name'].split('×')[1]) + 1)
                            else:
                                seen[s] = row('復刻ガチャ ×1', 'ceil', s, shift_year_jp(g['endAt']), 0)
                                future.append(seen[s])
                        else:
                            future.append(row(bump_year(g['name']), g['gachaType'], s, shift_year_jp(g['endAt']), 0))
        elif r['rule'] == 'bday4':
            d = dur(cat)
            for cid, b in bdays.items():
                for y in (jst(last).year, jst(last).year + 1):
                    s = bday_start(cid, y)
                    if s and last < s <= horizon:
                        kind = 'ANNIVERSARY' if cid > 20 else 'BIRTHDAY'
                        nm = cnames.get(cid, '#%d' % cid)
                        future.append(row('[%s]HAPPY %s %d招募' % (nm, kind, jst(s).year + 1), 'ceil', s, s + d, 0))
                        future.append(row('[%s]HAPPY %s Memories招募' % (nm, kind), 'ceil', s, s + d, 0))
        elif r['rule'] == 'evday':
            for e in future_ev:
                s = from_jst(jst(e['start']).replace(hour=12, minute=0))
                if last < s <= horizon:
                    future.append(row('第 %d 期活動卡池' % e['id'], 'ceil', s, s + dur(cat), e['id']))
        elif r['rule'] in ('mon1', 'd12'):
            t = jst(last)
            y, m = t.year, t.month
            for _ in range(14):
                d = first_monday(y, m) if r['rule'] == 'mon1' else datetime.datetime(y, m, 12, 12, 0)
                s = from_jst(d)
                if last < s <= horizon:
                    name = 'カラフルパスガチャ' if cat == 'pass' else '復刻ガチャ ×2' if cat == 'rerun' else CAT_NAME.get(cat, cat)
                    future.append(row(name, 'normal' if cat == 'pass' else 'ceil', s, s + dur(cat), 0))
                m += 1
                if m > 12:
                    y, m = y + 1, 1
        elif r['rule'] == 'wl7':
            for e in future_ev:
                if e['type'] == 'world_bloom':
                    s = from_jst(jst(e['start']).replace(hour=12, minute=0) - datetime.timedelta(days=7))
                    if last < s <= horizon:
                        future.append(row('ワールドリンクイベント サポートガチャ', 'normal', s, s + dur(cat), e['id']))
    future.sort(key=lambda g: g['start'])
    return rules, future, last


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

    # ---------- 第二層：日服還沒公布的期數，用日服自己的規律推估，再照台服規則換算 ----------
    jp_back, jp_future, jp_stats = jp_self_events(jp_ev)
    for f in jp_future:
        s = RULES[active_rule](f['start'], prev_lag)
        ev_future.append([f['id'], '', f['type'], s, RULES[active_rule](f['aggregate'], prev_lag), RULES[active_rule](f['closed'], prev_lag), 'jp', 0, True, f['start'], f['unit1'], f['unit2'], f['mixed'], JP_RULE_NAME[f['rule']]])
    ev_future.sort(key=lambda r: r[3])
    bdays, cnames = {}, {}
    try:
        for c in tc_json(f'{TC}/characterProfiles.json'):
            m = re.match(r'(\d+)月(\d+)日', c.get('birthday') or '')
            if m:
                bdays[c['characterId']] = (int(m.group(1)), int(m.group(2)))
        for c in tc_json(f'{TC}/gameCharacters.json'):
            cnames[c['id']] = (c.get('firstName') or '') + (c.get('givenName') or '')
    except Exception as e:
        print('角色生日讀不到：' + str(e), file=sys.stderr)
    ga_rules, jp_ga_future, jp_ga_last = jp_self_gachas(jp_ga, jp_ev, jp_future, bdays, cnames, jp_cards)
    for f in jp_ga_future:
        corr = cats.get(f['cat'], {}).get('corr', 0) * H
        ga_future.append([0, f['name'], f['gtype'], f['cat'], RULES[active_rule](f['start'], prev_lag) + corr, RULES[active_rule](f['end'], prev_lag) + corr, [], f['evId'], None, 'jp', f['conf'], f['start'], f['rule']])
    ga_future.sort(key=lambda r: (r[4], r[0]))
    jp_stats['gaRules'] = {c: dict(r, catName=CAT_NAME.get(c, c)) for c, r in ga_rules.items()}
    jp_stats['gaFutureN'] = len(jp_ga_future); jp_stats['gaLatestStart'] = jp_ga_last
    for cat in {f['cat'] for f in jp_ga_future}:
        cats.setdefault(cat, {'name': CAT_NAME.get(cat, cat), 'n': 0, 'hit': 0, 'corr': 0, 'offsets': []})

    anomalies = [['event', r[0], r[1], r[4], r[5], r[7], ('長度差 %+g 小時' % r[9]) if r[9] else ''] for r in ev_back if not r[8] or r[9]] + \
                [['gacha', r[0], r[1], r[5], r[6], r[7], CAT_NAME.get(r[3], r[3])] for r in ga_back if not r[8]]
    rule = {'active': active_rule, 'activeName': RULE_NAME[active_rule], 'lagHours': round(prev_lag / H, 2) if prev_lag is not None else None,
            'evN': len(done), 'evHit': hit_all, 'ev30N': len(done[-30:]), 'ev30Hit': hit30, 'schedN': len(sched), 'schedHit': hit_sched,
            'gaN': len(ga_back), 'gaHit': sum(1 for r in ga_back if r[8]), 'window': WINDOW, 'tolHours': TOL / H,
            'startHours': sorted({(e.get('eventType'), (datetime.datetime.utcfromtimestamp(e['startAt'] / 1000) + datetime.timedelta(hours=8)).hour) for e in tw_ev}),
            'jpLatestEvent': max(j['id'] for j in jp_ev), 'twLatestEvent': max(e['id'] for e in tw_ev), 'twGachaN': len(tw_ga), 'jpGachaN': len(jp_ga)}
    out = {'built': now, 'rule': rule, 'eras': eras, 'evBack': list(reversed(ev_back)), 'evFuture': ev_future, 'gaBack': list(reversed(ga_back)),
           'gaFuture': ga_future, 'cats': cats, 'anomalies': anomalies, 'manual': len(manual), 'jp': jp_stats, 'jpBack': list(reversed(jp_back))}
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
    print(f'寫入 {OUT.name}:{OUT.stat().st_size // 1024} KB（活動回測 {len(ev_back)} 期命中 {hit_all}/{len(done)}、預告 {hit_sched}/{len(sched)}；卡池回測 {rule["gaHit"]}/{rule["gaN"]}；未來活動 {len(ev_future)}、未來卡池 {len(ga_future)}；規則 {RULE_NAME[active_rule]}；日服推估 活動 {jp_stats["futureN"]} 期（日期回測 {jp_stats["hit"]}/{jp_stats["n"]}、團體前兩名 {jp_stats["unit2"]}/{jp_stats["unitN"]}）、卡池 {jp_stats["gaFutureN"]}）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
