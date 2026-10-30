#!/usr/bin/env python3
"""產生 data/wl3-power.js：「WL3 綜合力計算器」用的資料。

WL3（日服 2026 起的 World Link）每一期都有總合力上限 336,000（eventTotalPowerLimits），超過的綜合力不計分。
計算器要回答「滿配加成的隊伍，區域道具／大門／玩偶要到什麼狀態才碰得到上限」，需要的東西都在這裡先算好，
瀏覽器只做加減乘除（日服 cards.json 34 MB，不可能讓前端抓）：

  WL3P = {
    built, src,
    lim:    { jp: {gate, area, rank, tree}, tw: {...} }      各服目前的上限：大門等級、區域道具等級、角色等級、有沒有「想いの大樹」
    rank:   [Lv1 的 %, Lv2 的 %, …]                          角色等級加成（26 位都一樣，Lv50 以後固定 5%）
    gate:   [Lv1 的 %, …]                                    MySekai 大門（各團一扇，VS 卡吃最高的那扇）
    doll:   [S, M, L]                                        一套玩偶三種尺寸各給該角色多少 %
    area:   [[id, 名稱, 區域, 種類, 目標, [每級 %], [全隊同團／同色時每級 %], [混團時另加的每級 %], 日服原名, 日服區域名], …]（日服原名跟台服一樣就留空）
              種類 char（角色）／unit（團體）／vs（虛擬歌手團體）／attr（屬性）／tree（想いの大樹，全角色＋混團再一份）
    cards:  {卡號: [角色, 屬性, 稀有度(4／9＝生日), 支援團, 表現力, 技術力, 體力, 名稱, 素材名]}
              三維＝滿級、特訓後、前後篇已讀，不含專精與畫布（專精照 mr、畫布照稀有度由前端加）
    mr:     {'4': [[MR0 三維], [MR1 累計], …, [MR5]], '9': […]}
    events: [[期數, 名稱, 開始, 結算, 總合力上限, 玩偶上限 %|null, 終章?, [[章, 角色]…], [[卡號, 加成 %]…], [[5 張卡號]…]]]
              最後一欄是「滿配加成」的候選隊：五張不同角色、五種顏色、全用該期活動卡，依綜合力排序（最多 10 組）
  }

用法：python3 tools/build-wl3-power.py      （日服 master 走 jp_master 快取；台服上限讀 Haruki 台服 master）
"""
import itertools
import json
import pathlib
import re
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from jp_master import get_jp
from tc_source import TC, tc_json

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'wl3-power.js'
CANVAS = {'rarity_4': 1500, 'rarity_birthday': 1200}
UNIT_OF = {}   # 角色 → 本團（gameCharacterUnits id 1～26）


def r2(v):
    return round(float(v or 0), 2)


def base_stats(card, epi, ml):
    """滿級、特訓、前後篇、專精 5 的三維（跟 js/core.js PowerEngine.basePower 同一套）"""
    p = card.get('cardParameters')
    if isinstance(p, list):
        o = {'param1': [], 'param2': [], 'param3': []}
        for x in p:
            a = o.get(x['cardParameterType'])
            if a is not None:
                lv = int(x['cardLevel'])
                while len(a) < lv:
                    a.append(0)
                a[lv - 1] = x.get('power') or 0
        p = o
    if not p or not p.get('param1'):
        return None
    b = [p['param1'][-1] or 0, p['param2'][-1] or 0, p['param3'][-1] or 0]
    for i in range(3):
        b[i] += card.get(f'specialTrainingPower{i + 1}BonusFixed') or 0
    e = epi.get(card['id'])
    if e:
        b = [b[i] + e[i] for i in range(3)]
    m = ml.get(card['cardRarityType'])
    if m:
        b = [b[i] + m[i] for i in range(3)]
    return b


def main():
    jp = {n: get_jp(n + '.json') for n in (
        'cards', 'cardEpisodes', 'masterLessons', 'areaItems', 'areaItemLevels', 'areas', 'mysekaiGateLevels',
        'characterRanks', 'gameCharacterUnits', 'events', 'worldBlooms', 'eventCards', 'eventTotalPowerLimits',
        'eventMysekaiFixtureGameCharacterPerformanceBonusLimits', 'mysekaiFixtureGameCharacterGroupPerformanceBonuses')}
    tw = {}
    for n in ('areaItems', 'areaItemLevels', 'areas', 'mysekaiGateLevels', 'characterRanks'):
        try:
            tw[n] = tc_json(f'{TC}/{n}.json')
        except Exception as e:   # 台服抓不到就只用日服的上限，不影響產檔
            print(f'台服 {n} 抓不到（{e}），台服上限沿用日服', file=sys.stderr)
            tw[n] = []

    for g in jp['gameCharacterUnits']:
        if g['id'] <= 26:
            UNIT_OF[g['gameCharacterId']] = g['unit']

    # 前後篇與專精的三維加值
    epi = {}
    for e in jp['cardEpisodes']:
        a = epi.setdefault(e['cardId'], [0, 0, 0])
        for i in range(3):
            a[i] += e.get(f'power{i + 1}BonusFixed') or 0
    # 專精：每稀有度 MR0～5 的累計三維（卡片三維不含專精，前端照每格選的專精加）
    mlc = {}
    for m in sorted(jp['masterLessons'], key=lambda m: m['masterRank']):
        if m['masterRank'] > 5 or m['cardRarityType'] not in CANVAS:
            continue
        cum = mlc.setdefault(m['cardRarityType'], [[0, 0, 0]])
        prev = cum[-1]
        cum.append([prev[i] + (m.get(f'power{i + 1}BonusFixed') or 0) for i in range(3)])
    ml = {}

    cards = {}
    for c in jp['cards']:
        if c['cardRarityType'] not in CANVAS:
            continue
        b = base_stats(c, epi, ml)
        if not b:
            continue
        sup = c.get('supportUnit') or 'none'
        cards[c['id']] = [c['characterId'], c['attr'], 9 if c['cardRarityType'] == 'rarity_birthday' else 4,
                          '' if sup == 'none' else sup, b[0], b[1], b[2], c.get('prefix') or '', c.get('assetbundleName') or '']

    # 區域道具：每級的 %（三維相同，只存 power1）；想いの大樹同一級有兩列（全角色、混團），分開存
    tw_names = {a['id']: a['name'] for a in tw['areaItems']}
    tw_area_names = {a['id']: a['name'] for a in tw['areas']}
    area_name = {a['id']: a['name'] for a in jp['areas']}
    rows = {}
    for x in jp['areaItemLevels']:
        mixed = '2種類以上のユニット' in (x.get('sentence') or '')
        it = rows.setdefault(x['areaItemId'], {'b': {}, 'a': {}, 'm': {}, 'row': x})
        if mixed:
            it['m'][x['level']] = r2(x['power1BonusRate'])
        else:
            it['b'][x['level']] = r2(x['power1BonusRate'])
            it['a'][x['level']] = r2(x['power1AllMatchBonusRate'])
            it['row'] = x
        for i in (2, 3):   # 防呆：三維不同就停，計算器假設三維同率
            if x[f'power{i}BonusRate'] != x['power1BonusRate'] or x[f'power{i}AllMatchBonusRate'] != x['power1AllMatchBonusRate']:
                raise SystemExit(f'區域道具 {x["areaItemId"]} Lv{x["level"]} 三維加成不同，計算器要改')
    area = []
    for a in sorted(jp['areaItems'], key=lambda a: a['id']):
        it = rows.get(a['id'])
        if not it:
            continue
        x = it['row']
        mx = max(it['b'])
        seq = lambda d: [d.get(l, 0) for l in range(1, mx + 1)]
        if x.get('targetGameCharacterId'):
            kind, target = 'char', x['targetGameCharacterId']
        elif x['targetUnit'] == 'piapro':
            kind, target = 'vs', 'piapro'
        elif x['targetUnit'] != 'any':
            kind, target = 'unit', x['targetUnit']
        elif x['targetCardAttr'] != 'any':
            kind, target = 'attr', x['targetCardAttr']
        else:
            kind, target = 'tree', ''
        nm, an = tw_names.get(a['id']) or a['name'], tw_area_names.get(a['areaId']) or area_name.get(a['areaId'], '')
        jn, ja = a['name'], area_name.get(a['areaId'], '')
        # 8、9：日服原名（日文、英文介面用）；跟台服名一樣就留空
        area.append([a['id'], nm, an, kind, target, seq(it['b']), seq(it['a']), seq(it['m']) if it['m'] else [],
                     '' if jn == nm else jn, '' if ja == an else ja])

    rank1 = sorted([(r['characterRank'], r2(r['power1BonusRate'])) for r in jp['characterRanks'] if r['characterId'] == 1])
    rank = [v for k, v in rank1]
    while len(rank) > 1 and rank[-1] == rank[-2]:   # 封頂之後都一樣，只留到第一次封頂
        rank.pop()
    gl = sorted([(g['level'], r2(g['powerBonusRate'])) for g in jp['mysekaiGateLevels'] if g['mysekaiGateId'] == 1])
    gate = [v for k, v in gl]
    doll = sorted({r2(x['bonusRate'] / 10) for x in jp['mysekaiFixtureGameCharacterGroupPerformanceBonuses']})

    def lim_of(m, has_tree):
        a = m['areaItemLevels']
        return {'gate': max([g['level'] for g in m['mysekaiGateLevels']] or [0]),
                'area': max([x['level'] for x in a] or [0]),
                'rank': max([r['characterRank'] for r in m['characterRanks']] or [0]),
                'tree': has_tree}
    has_tree_jp = any(x[3] == 'tree' for x in area)
    tw_ids = {x['areaItemId'] for x in tw['areaItemLevels']}
    lim = {'jp': lim_of(jp, has_tree_jp),
           'tw': lim_of(tw, any(x[3] == 'tree' and x[0] in tw_ids for x in area)) if tw['areaItemLevels'] else lim_of(jp, has_tree_jp)}

    # WL3 各期：有總合力上限的 World Link
    cap = {x['eventId']: x['upperTotalPower'] for x in jp['eventTotalPowerLimits']}
    doll_lim = {x['eventId']: x['bonusRateLimit'] / 10 for x in jp['eventMysekaiFixtureGameCharacterPerformanceBonusLimits']}
    evs = {e['id']: e for e in jp['events']}
    wbs = jp['worldBlooms']
    canvas = lambda cid: CANVAS['rarity_birthday' if cards[cid][2] == 9 else 'rarity_4']
    power_sum = lambda cid: sum(cards[cid][4:7]) + canvas(cid)
    events = []
    for eid in sorted(cap):
        e = evs.get(eid)
        if not e:
            continue
        ch = sorted([(w['chapterNo'], w['gameCharacterId']) for w in wbs if w['eventId'] == eid and w.get('gameCharacterId')])
        finale = any(w.get('worldBloomChapterType') == 'finale' for w in wbs if w['eventId'] == eid) or len(ch) == 0
        ec = sorted([(x['cardId'], r2(x['bonusRate'])) for x in jp['eventCards'] if x['eventId'] == eid and x['cardId'] in cards])
        pool = [c for c, _ in ec]
        teams = []
        for combo in itertools.combinations(pool, 5):
            if len({cards[c][0] for c in combo}) < 5 or len({cards[c][1] for c in combo}) < 5:
                continue
            teams.append((sum(power_sum(c) for c in combo), list(combo)))
        teams.sort(key=lambda t: -t[0])
        events.append([eid, e['name'], e['startAt'], e['aggregateAt'], cap[eid], doll_lim.get(eid), finale,
                       [list(x) for x in ch], [list(x) for x in ec], [t[1] for t in teams[:10]]])

    out = {'built': int(time.time() * 1000), 'src': '日服 master（Sekai-World）＋台服上限（Haruki 台服 master）',
           'lim': lim, 'rank': rank, 'gate': gate, 'doll': doll, 'area': area,
           'mr': {'4': mlc.get('rarity_4', [[0, 0, 0]]), '9': mlc.get('rarity_birthday', [[0, 0, 0]])},
           'cards': {str(k): v for k, v in sorted(cards.items())}, 'events': events}
    body = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    text = ('/* 由 tools/build-wl3-power.py 產生，勿手改。WL3 綜合力計算器：各期總合力上限、滿配候選隊、卡片三維、'
            '區域道具每級加成、大門、角色等級與玩偶。 */\n' f'export const WL3P={body};\n')
    old = OUT.read_text(encoding='utf-8') if OUT.exists() else ''
    strip = lambda s: re.sub(r'"built":\d+', '"built":0', s)
    if strip(old) == strip(text):
        print(f'內容無變化，不更新 {OUT.name}')
        return 0
    OUT.write_text(text, encoding='utf-8')
    print(f'寫入 {OUT.name}：{OUT.stat().st_size // 1024} KB（WL3 {len(events)} 期、卡片 {len(cards)} 張、區域道具 {len(area)} 個；'
          f'上限 日服 門{lim["jp"]["gate"]}／道具{lim["jp"]["area"]}、台服 門{lim["tw"]["gate"]}／道具{lim["tw"]["area"]}）')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
