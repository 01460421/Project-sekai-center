#!/usr/bin/env python3
"""產生 data/gachasim-jp.js：網站切到「日服」時抽卡模擬用的卡池（機率、池內卡片與權重、PU、抽法）。

日服 master 的 gachas.json 有 49 MB（1,000 多個池，每池八九百筆 gachaDetails），瀏覽器不可能直接抓。
這裡只收「近 13 個月內結束」的池加上進行中與已排好的未來池（GACHASIM_JP_MONTHS=13 可改；從那個月的 1 日算，
日本時間，所以檔案最多一個月因為視窗往前滑而變一次），去掉測試池與沒有 gachaDetails／機率的池，再壓成：

  GACHASIM = {rates, behaviors, sets, gachas, cards}
    rates      機率表：[[稀有度, 機率%]…]（稀有度 1–4，9=生日）。同一稀有度有好幾列（夢幻選秀的 categorized_wish、
               WL 支援池的 rate_choice_first／second）就加總成一列：模擬器不模擬自選，該稀有度裡照權重抽
    behaviors  抽法：[抽數, 消耗種類, 消耗數量, gachaBehaviorType]（台服 master 的 gachaBehaviors 欄位，null＝免費）
    sets       卡片 id 集合（共用）：字串是遞增 id 的連續段，逗號分隔，每段「間距」或「間距+長度」——
               起點＝上一段終點（一開始是 0）加間距、終點＝起點加長度。例如 "3,2+4" 是 {3, 5,6,7,8,9}。
               陣列 [基底, 加入段, 移除段] 表示以前面第「基底」個集合為底、加上與拿掉這兩串 id（格式同上）；
               相鄰幾期的池幾乎一樣，差分通常只有幾張新卡
    gachas     每列 [id, 池名(日文原文), 開始, 結束, 素材名('' = ab_gacha_<id>), 機率表索引,
                     [[集合索引, 預設權重, [[權重, 卡 id…]…]?]…], [PU 卡 id…], [抽法索引…]]
               時間是 epoch 秒；第七欄每個稀有度一組，例外權重通常只有 PU（例如 4000000 對其他 ★4 的 23923）
    cards      卡池裡有、但 data/cards-index-jp.js 還沒收（或標成素材未上架）的卡，欄位同 cards-index 的 CARDS：
               [id, 角色, 稀有度, 屬性, 取得類別, 支援團, 卡池可得, 卡名, 素材名]；cards-index-jp 是有新卡時手動重建，
               沒有這份的話當期新卡（通常就是 PU）在模擬器裡會整張消失
前端（js/app.js loadGachaSim）在日服模式把它解回台服 master 同形狀的物件（gachaDetails[{cardId, weight}] 等），
模擬本身不分伺服器。內容沒變就不寫檔（檔內沒有建置時間戳）。

用法：
    python3 tools/build-gachasim-jp.py      # 日服 master 用 jp_master 抓（有快取）；離線測試可設 SCHED_JP_DIR 指向放 jp_*.json 的資料夾
    python3 tools/stamp-assets.py
"""
import collections
import datetime
import json
import os
import pathlib
import re
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from jp_master import get_jp

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'gachasim-jp.js'
INDEX = ROOT / 'data' / 'cards-index-jp.js'
JST = datetime.timezone(datetime.timedelta(hours=9))
RAR = {'rarity_1': 1, 'rarity_2': 2, 'rarity_3': 3, 'rarity_4': 4, 'rarity_birthday': 9}
# 跟 tools/build-cards-index.py 相同的欄位順序
UNITS = ['light_sound', 'idol', 'street', 'theme_park', 'school_refusal', 'piapro']
ATTRS = ['cool', 'happy', 'mysterious', 'cute', 'pure']
SUPPLY_ORDER = ['normal', 'birthday', 'term_limited', 'colorful_festival_limited', 'bloom_festival_limited', 'unit_event_limited', 'collaboration_limited']
BASE_WINDOW = 120   # 找差分基底時往回看幾個集合


def load(name):
    d = os.environ.get('SCHED_JP_DIR')
    if d and (pathlib.Path(d) / f'jp_{name}.json').exists():
        return json.load(open(pathlib.Path(d) / f'jp_{name}.json', encoding='utf-8'))
    return get_jp(name + '.json')


def indexed_cards():
    """data/cards-index-jp.js 裡前端會用到的卡（第 10 欄是 0＝素材未上架的，前端 loadCards 會濾掉，不算）。"""
    ids = set()
    if not INDEX.exists():
        return ids
    for line in INDEX.read_text(encoding='utf-8').split('\n'):
        if line.startswith('[') and line.endswith('],'):
            try:
                r = json.loads(line[:-1])
            except ValueError:
                continue
            if len(r) <= 9 or r[9] != 0:
                ids.add(r[0])
    return ids


def runs(ids):
    """遞增 id → 連續段字串（見檔頭說明）"""
    segs = []
    for i in ids:
        if segs and segs[-1][1] == i - 1:
            segs[-1][1] = i
        else:
            segs.append([i, i])
    out, prev = [], 0
    for a, b in segs:
        out.append(str(a - prev) + ('' if a == b else '+' + str(b - a)))
        prev = b
    return ','.join(out)


def num(x):
    x = round(float(x), 4)
    return int(x) if x == int(x) else x


def main():
    now = int(os.environ.get('JP_NOW_AT') or time.time() * 1000)
    months = int(os.environ.get('GACHASIM_JP_MONTHS') or 13)
    t = datetime.datetime.fromtimestamp(now / 1000, JST)
    m = t.year * 12 + t.month - 1 - months
    since_dt = datetime.datetime(m // 12, m % 12 + 1, 1, tzinfo=JST)
    since = int(since_dt.timestamp() * 1000)

    cards = {c['id']: c for c in load('cards')}
    supply = {s['id']: s.get('cardSupplyType') or 'normal' for s in load('cardSupplies')}
    gachas = []
    for g in load('gachas'):
        if not g.get('gachaDetails') or not g.get('gachaCardRarityRates'):
            continue
        if g['endAt'] < since or re.search(r'テスト|test', g.get('name') or '', re.I):
            continue
        gachas.append(g)
    gachas.sort(key=lambda g: (g['startAt'], g['id']))

    rate_tab, rate_idx = [], {}
    beh_tab, beh_idx = [], {}
    sets, set_idx = [], {}       # sets[i] = (frozenset, 編碼)

    def intern(tab, idx, v):
        k = json.dumps(v)
        if k not in idx:
            idx[k] = len(tab)
            tab.append(v)
        return idx[k]

    def set_of(ids):
        key = frozenset(ids)
        if key in set_idx:
            return set_idx[key]
        best = runs(sorted(ids))
        cost = len(best) + 2
        for j in range(max(0, len(sets) - BASE_WINDOW), len(sets)):
            base = sets[j][0]
            add, rem = runs(sorted(key - base)), runs(sorted(base - key))
            c = len(add) + len(rem) + len(str(j)) + 8
            if c < cost:
                best, cost = [j, add, rem], c
        set_idx[key] = len(sets)
        sets.append((key, best))
        return set_idx[key]

    rows, used = [], set()
    for g in gachas:
        rates = collections.OrderedDict()
        for r in g['gachaCardRarityRates']:
            k = RAR.get(r.get('cardRarityType'))
            if k:
                rates[k] = rates.get(k, 0) + float(r.get('rate') or 0)
        by = collections.defaultdict(list)
        for d in g['gachaDetails']:
            c = cards.get(d.get('cardId'))
            if c and RAR.get(c.get('cardRarityType')):
                by[RAR[c['cardRarityType']]].append((d['cardId'], d.get('weight') or 0))
        if not by:
            continue
        groups = []
        for rar in sorted(by):
            lst = sorted(by[rar])
            used.update(i for i, _ in lst)
            dw = collections.Counter(w for _, w in lst).most_common(1)[0][0]
            ex = collections.defaultdict(list)
            for i, w in lst:
                if w != dw:
                    ex[w].append(i)
            grp = [set_of([i for i, _ in lst]), dw]
            if ex:
                grp.append([[w] + ids for w, ids in sorted(ex.items())])
            groups.append(grp)
        pk = [p['cardId'] for p in sorted(g.get('gachaPickups') or [], key=lambda p: p.get('id') or 0) if p.get('cardId') in cards]
        used.update(pk)
        beh = [intern(beh_tab, beh_idx, [b['spinCount'], b.get('costResourceType'), b.get('costResourceQuantity'), b.get('gachaBehaviorType') or ''])
               for b in g.get('gachaBehaviors') or [] if b.get('spinCount')]
        abn = g.get('assetbundleName') or ''
        rows.append([g['id'], g.get('name') or '', g['startAt'] // 1000, g['endAt'] // 1000, '' if abn == f'ab_gacha_{g["id"]}' else abn,
                     intern(rate_tab, rate_idx, [[k, num(v)] for k, v in rates.items()]), groups, pk, beh])

    known = indexed_cards()
    extra = []
    for cid in sorted(used - known):
        c = cards[cid]
        st = supply.get(c.get('cardSupplyId'), 'normal')
        extra.append([cid, c.get('characterId') or 0, RAR.get(c.get('cardRarityType'), 0), ATTRS.index(c['attr']) if c.get('attr') in ATTRS else 0,
                      SUPPLY_ORDER.index(st) if st in SUPPLY_ORDER else 0, UNITS.index(c['supportUnit']) if c.get('supportUnit') in UNITS else -1,
                      1, c.get('prefix') or '', c.get('assetbundleName') or ''])

    js = lambda v: json.dumps(v, ensure_ascii=False, separators=(',', ':'))
    lines = lambda items: ',\n'.join(js(x) for x in items)
    text = (f'/* 由 tools/build-gachasim-jp.py 產生,勿手改。日服抽卡模擬的卡池（{since_dt:%Y/%m/%d} 之後結束的池＋進行中與已排好的池，日本時間）。\n'
            '   rates 機率表 [[稀有度, %]…]；behaviors 抽法 [抽數, 消耗種類, 數量, gachaBehaviorType]；\n'
            '   sets 卡片 id 集合：「間距」或「間距+長度」的連續段，或 [基底集合, 加入段, 移除段]；\n'
            '   gachas [id, 池名, 開始秒, 結束秒, 素材名(空=ab_gacha_id), 機率表, [[集合, 預設權重, [[權重, 卡 id…]…]]…], [PU…], [抽法…]]；\n'
            '   cards 卡片索引（cards-index-jp.js）還沒有的卡，欄位同 CARDS。詳見 tools/build-gachasim-jp.py。 */\n'
            'export const GACHASIM={\n'
            f'"rates":{js(rate_tab)},\n'
            f'"behaviors":{js(beh_tab)},\n'
            f'"cards":[\n{lines(extra)}],\n'
            f'"sets":[\n{lines(s[1] for s in sets)}],\n'
            f'"gachas":[\n{lines(rows)}]\n'
            '};\n')
    if OUT.exists() and OUT.read_text(encoding='utf-8') == text:
        print(f'內容無變化,不更新 {OUT.name}（{len(rows)} 池）')
        return 0
    OUT.write_text(text, encoding='utf-8')
    ymd = lambda s: datetime.datetime.fromtimestamp(s, JST).strftime('%Y/%m/%d')
    print(f'寫入 {OUT.name}:{OUT.stat().st_size // 1024} KB（{len(rows)} 池，開始日 {ymd(rows[0][2]) if rows else "-"} ～ {ymd(rows[-1][2]) if rows else "-"}；'
          f'卡片集合 {len(sets)} 組、機率表 {len(rate_tab)} 種、抽法 {len(beh_tab)} 種、索引外的卡 {len(extra)} 張）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
