#!/usr/bin/env python3
"""產生 data/gachas-jp.js：網站切到「日服」時的卡池列表（卡池頁、活動日曆、活動頁的當期卡池、抽卡模擬用）。

形狀跟 data/sekai-data.js 的 GACHAS（台服預測卡池，手工維護）一樣，前端換 import 就能用：
  GACHAS = [{s, e, id, n, t, note, ch, u, eid, et, ech}, …]
    s / e  開始／結束日（日本時間 UTC+9，'YYYY/MM/DD'）
    id     卡池 id（字串；卡池、卡片、活動 id 兩服共用）
    n      卡池名（日服原名）
    t      池型：FES池／普通限定池／常駐池／生日池／復刻限定池／World Link池／World Link支援池／有償池／免費池／新手池／選角池／其他
           台服表把免費、新手、選角都記成「其他」，再由前端（js/app.js gachaTone）照中文池名細分；
           日服池名是日文認不出來，這裡直接給細分後的標籤（都在前端 TONES 裡）。
    note   自動備註：FES 池「BFES/221期伴生」、有償池「有償水晶 3000 限 1 次」、生日池「同期另有歷年生日復刻 3 池」
    ch     PU 角色，用台服表的簡稱（遙, 杏, 彰人…，順序照 gachaPickups；26 人都有寫「全員」）；有償／免費／新手／其他這類沒有主打角色的池留空
    u      PU 裡虛擬歌手卡的副團（LN／MMJ／VBS／WS／25時，沒有副團寫「無副團」），多個用「, 」接
    eid    同期活動 id：卡池開始時正在跑（或兩天內要開始）、而且 PU 卡在那期活動加成卡（eventCards）裡；
           Memories 這種沒有活動卡的活動，認「活動名＋ガチャ」同名的池；
           WL 支援池與「[フィナーレチャプター]」池則是 14 天內要開始的那期 World Link。生日、復刻、有償池通常沒有。
    et     活動類型：World Link／箱活（有團體）／混活
    ech    活動主角簡稱（eventStories 的 banner 角色）；World Link 寫團名（V家；章節混團寫「其他」、沒有章節角色寫「全員」）

排除跟 tools/build-jp-now.py 一樣：名稱含 テスト／test 的測試池、開 400 天以上的常駐池；另外比照台服表不列
每月的「カラフルパスガチャ」，以及跟生日池同一天開的「[復刻][角色]HAPPY BIRTHDAY20xx」（併進生日池那列的備註）。
收錄開始日在 SINCE 之後的池（預設兩年前的 1 月 1 日，日本時間；GACHAS_JP_SINCE=2021 這樣可改），
未來池只有日服 master 已排好的那些（日服沒有「加一年」的預測）。內容沒變就不寫檔。

用法：
    python3 tools/build-gachas-jp.py                       # 日服 master 用 jp_master 抓（有快取）
    MASTER_SRV=jp python3 tools/build-gacha-pickups.py     # 再產 data/gacha-pickups-jp.js（照這份列表的 id）
    python3 tools/stamp-assets.py
離線測試可設 SCHED_JP_DIR 指向放 jp_*.json 的資料夾（同 build-jp-now.py）。
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
OUT = ROOT / 'data' / 'gachas-jp.js'
D = 86400 * 1000
PERMANENT = 400 * D
JST = datetime.timezone(datetime.timedelta(hours=9))
# 台服表（data/sekai-data.js）的角色簡稱；21 在台服表寫「初音」（前端 CHARA_ID 兩個都認）
CH_SHORT = {1: '一歌', 2: '咲希', 3: '穗波', 4: '志步', 5: '實乃理', 6: '遙', 7: '愛莉', 8: '雫', 9: '心羽', 10: '杏', 11: '彰人', 12: '冬彌',
            13: '司', 14: '笑夢', 15: '寧寧', 16: '類', 17: '奏', 18: '真冬', 19: '繪名', 20: '瑞希', 21: '初音', 22: '鈴', 23: '連', 24: '流歌',
            25: 'MEIKO', 26: 'KAITO'}
UNIT_LABEL = {'light_sound': 'LN', 'idol': 'MMJ', 'street': 'VBS', 'theme_park': 'WS', 'school_refusal': '25時'}
LIMITED = ('term_limited', 'colorful_festival_limited', 'bloom_festival_limited', 'unit_event_limited', 'collaboration_limited')
NO_CH = ('有償池', '免費池', '新手池', '選角池', '其他')


def load(name):
    d = os.environ.get('SCHED_JP_DIR')
    if d and (pathlib.Path(d) / f'jp_{name}.json').exists():
        return json.load(open(pathlib.Path(d) / f'jp_{name}.json', encoding='utf-8'))
    return get_jp(name + '.json')


def ymd(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, JST).strftime('%Y/%m/%d')


def is_test(name):
    return bool(re.search(r'テスト|test', name or '', re.I))


def is_bday(name):
    return bool(re.search(r'HAPPY BIRTHDAY|HAPPY ANNIVERSARY', name or '', re.I))


def costs(g):
    """{消耗種類} 與有償那一筆（價格、次數上限）"""
    kinds, paid = set(), None
    for b in g.get('gachaBehaviors') or []:
        k = b.get('costResourceType')
        if k:
            kinds.add(k)
        if k == 'paid_jewel' and b.get('gachaBehaviorType') != 'once_a_day' and (paid is None or (b.get('costResourceQuantity') or 0) > paid[0]):
            paid = (b.get('costResourceQuantity') or 0, b.get('executeLimit'))
    return kinds, paid


def main():
    now = int(os.environ.get('JP_NOW_AT') or time.time() * 1000)
    since_year = int(os.environ.get('GACHAS_JP_SINCE') or datetime.datetime.fromtimestamp(now / 1000, JST).year - 2)
    since = int(datetime.datetime(since_year, 1, 1, tzinfo=JST).timestamp() * 1000)
    gachas = load('gachas')
    cards = {c['id']: c for c in load('cards')}
    supply = {s['id']: s.get('cardSupplyType') or '' for s in load('cardSupplies')}
    events = sorted((e for e in load('events') if not is_test(e.get('name'))), key=lambda e: e['startAt'])
    ev_cards = collections.defaultdict(set)
    for x in load('eventCards'):
        ev_cards[x['eventId']].add(x['cardId'])
    gcu = {u['id']: u for u in load('gameCharacterUnits')}
    banner = {s['eventId']: (gcu.get(s.get('bannerGameCharacterUnitId')) or {}).get('gameCharacterId') for s in load('eventStories')}
    wl_chars = collections.defaultdict(set)
    for w in load('worldBlooms') or []:
        if w.get('gameCharacterId'):
            wl_chars[w['eventId']].add(int(w['gameCharacterId']))

    def event_of(g, pk, wl_link):
        if wl_link:
            for e in events:
                if e['eventType'] == 'world_bloom' and g['startAt'] - D <= e['startAt'] <= g['startAt'] + 14 * D:
                    return e
            return None
        for e in events:
            if e['startAt'] - 2 * D <= g['startAt'] < e['aggregateAt'] and pk & ev_cards.get(e['id'], set()):
                return e
        for e in events:   # 沒有活動卡的活動（2026-10 起的 Memories）：池名就是「活動名ガチャ」
            if e['startAt'] - 2 * D <= g['startAt'] < e['aggregateAt'] and not ev_cards.get(e['id']) and g.get('name') == f"{e.get('name')}ガチャ":
                return e
        return None

    def ech_of(e):
        if e['eventType'] == 'world_bloom':
            if e.get('unit') in UNIT_LABEL:
                return UNIT_LABEL[e['unit']]
            chs = wl_chars.get(e['id'], set())
            return '全員' if not chs else 'V家' if all(c >= 21 for c in chs) else '其他'
        return CH_SHORT.get(banner.get(e['id']), '')

    keep = []
    for g in gachas:
        name = g.get('name') or ''
        if g['endAt'] - g['startAt'] >= PERMANENT or is_test(name) or g['startAt'] < since:
            continue
        if re.search(r'カラフルパスガチャ', name):
            continue
        keep.append(g)
    # 生日池同一天開的歷年復刻（[復刻][角色]HAPPY BIRTHDAY2024 之類）併進當年那一列
    def bday_key(g):
        pk = [p['cardId'] for p in g.get('gachaPickups') or [] if p.get('cardId') in cards]
        return ymd(g['startAt']), cards[pk[0]].get('characterId') if pk else 0

    bday_rerun = collections.Counter()
    bday_main = {bday_key(g) for g in keep if is_bday(g['name']) and '復刻' not in g['name']}
    rows_src = []
    for g in keep:
        if is_bday(g['name']) and '復刻' in g['name']:
            key = bday_key(g)
            if key in bday_main:
                bday_rerun[key] += 1
                continue
        rows_src.append(g)

    rows = []
    for g in sorted(rows_src, key=lambda g: (g['startAt'], g['id'])):
        name, gt = g.get('name') or '', g.get('gachaType') or ''
        pk_ids = [p['cardId'] for p in sorted(g.get('gachaPickups') or [], key=lambda p: p.get('id') or 0) if p.get('cardId') in cards]
        pk = set(pk_ids)
        kinds, paid = costs(g)
        wl_support = gt == 'ceil' and bool(re.search(r'ワールドリンク.*サポート|サポートガチャ', name))
        finale = gt == 'ceil' and 'フィナーレチャプター' in name   # WL 終章前一週，各團 WL 限定卡再登場
        e = event_of(g, pk, wl_support or finale) if gt == 'ceil' else None
        if is_bday(name):
            t = '復刻限定池' if '復刻' in name else '生日池'
        elif gt == 'beginner' or re.search(r'初心者|友達招待', name):
            t = '新手池'
        elif gt == 'gift' or ('paid_jewel' in kinds and 'jewel' not in kinds):
            t = '有償池'
        elif gt != 'ceil':
            t = '免費池' if re.search(r'無料', name) else '選角池' if (g.get('isSelectCharacter') or 'セレクトキャラクター' in name) else '其他'
        elif wl_support:
            t = 'World Link支援池'
        elif re.search(r'(ブルーム|カラフル)フェスティバル', name):   # リコレクションフェスティバル（大暗鍋）不算
            t = 'FES池'
        elif '復刻' in name:
            t = '復刻限定池'
        elif e and e['eventType'] == 'world_bloom':
            t = 'World Link池'
        elif e:
            # 少數新卡在 master 的 cardSupplyId 還是一般（例如 915 池），卡池說明「新たな期間限定メンバー」也算限定
            lim = any(supply.get(cards[c].get('cardSupplyId')) in LIMITED for c in pk_ids) or \
                bool(re.search(r'新たな(期間|ユニットイベント|コラボ)限定メンバー', (g.get('gachaInformation') or {}).get('summary') or ''))
            t = '普通限定池' if lim else '常駐池'
        elif g.get('isSelectCharacter') or 'セレクトキャラクター' in name:
            t = '選角池'
        else:
            t = '其他'
        ch, u = [], []
        if t not in NO_CH:
            for c in pk_ids:
                cid = cards[c].get('characterId')
                nm = CH_SHORT.get(cid)
                if nm and nm not in ch:
                    ch.append(nm)
                if cid and cid >= 21:
                    lab = UNIT_LABEL.get(cards[c].get('supportUnit'), '無副團')
                    if lab not in u:
                        u.append(lab)
        note = ''
        if t == 'FES池':
            note = ('BFES' if 'ブルーム' in name else 'CFES' if 'カラフル' in name else 'FES') + (f'/{e["id"]}期伴生' if e else '')
        elif t == '有償池' and paid:
            note = f'有償水晶 {paid[0]}' + (f' 限 {paid[1]} 次' if paid[1] else '')
        elif t == '生日池' and bday_rerun.get(bday_key(g)):
            note = f'同期另有歷年生日復刻 {bday_rerun[bday_key(g)]} 池'
        et = ''
        if e:
            et = 'World Link' if e['eventType'] == 'world_bloom' else '混活' if (e.get('unit') or 'none') == 'none' else '箱活'
        rows.append({'s': ymd(g['startAt']), 'e': ymd(g['endAt']), 'id': str(g['id']), 'n': name, 't': t, 'note': note,
                     'ch': '全員' if len(ch) >= len(CH_SHORT) else ', '.join(ch), 'u': ', '.join(u), 'eid': str(e['id']) if e else '', 'et': et, 'ech': ech_of(e) if e else ''})

    body = json.dumps(rows, ensure_ascii=False, separators=(',', ':'))
    text = (f'/* 由 tools/build-gachas-jp.py 產生,勿手改。日服卡池列表（{since_year}/01/01 起，日本時間），形狀同 data/sekai-data.js 的 GACHAS：\n'
            '   {s 開始, e 結束, id, n 名稱, t 池型, note 自動備註, ch PU 角色簡稱, u 虛擬歌手副團, eid 同期活動, et 活動類型, ech 活動主角／WL 團} */\n'
            f'export const GACHAS={body};\n')
    if OUT.exists() and OUT.read_text(encoding='utf-8') == text:
        print(f'內容無變化,不更新 {OUT.name}（{len(rows)} 池）')
        return 0
    OUT.write_text(text, encoding='utf-8')
    cnt = collections.Counter(r['t'] for r in rows)
    print(f'寫入 {OUT.name}:{OUT.stat().st_size // 1024} KB（{len(rows)} 池，{rows[0]["s"] if rows else "-"} ～ {rows[-1]["s"] if rows else "-"}；'
          + '、'.join(f'{k} {v}' for k, v in cnt.most_common()) + f'；併進生日池的歷年復刻 {sum(bday_rerun.values())} 池）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
