#!/usr/bin/env python3
"""從 master DB 產生 data/cards-index.js（收集率功能用的精簡卡片索引）。

cards.json 原始檔 4 MB、gachas.json 3.3 MB,不可能在瀏覽器端載入。
這支腳本把收集率頁需要的欄位抽出來壓成約 100 KB,
並在建置階段就算好「是否能從卡池取得」(不能的多半是活動報酬)。

有新卡時重跑:

    python3 tools/build-cards-index.py
    python3 tools/stamp-assets.py      # 別忘了重新戳版本
"""
import json
import pathlib
import urllib.request

DB = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-tc-diff/main'
ROOT = pathlib.Path(__file__).resolve().parent.parent

UNITS = ['light_sound', 'idol', 'street', 'theme_park', 'school_refusal', 'piapro']
ATTRS = ['cool', 'happy', 'mysterious', 'cute', 'pure']
# cardSupplyId 1..7 → 顯示用代碼
SUPPLY_ORDER = ['normal', 'birthday', 'term_limited', 'colorful_festival_limited',
                'bloom_festival_limited', 'unit_event_limited', 'collaboration_limited']


def get(name):
    with urllib.request.urlopen(f'{DB}/{name}') as r:
        return json.load(r)


def main():
    print('下載 master DB…')
    cards = get('cards.json')
    charas = get('gameCharacters.json')
    supplies = get('cardSupplies.json')
    gachas = get('gachas.json')

    supply_type = {s['id']: s['cardSupplyType'] for s in supplies}

    in_gacha = set()
    for g in gachas:
        for d in (g.get('gachaDetails') or []):
            if d.get('cardId'):
                in_gacha.add(d['cardId'])

    ch_rows = []
    for c in sorted(charas, key=lambda x: x['id']):
        name = (c.get('firstName') or '') + (c.get('givenName') or '')
        ch_rows.append([c['id'], name, UNITS.index(c['unit'])])

    rar_code = {'rarity_1': 1, 'rarity_2': 2, 'rarity_3': 3, 'rarity_4': 4, 'rarity_birthday': 9}

    rows = []
    for c in sorted(cards, key=lambda x: x['id']):
        st = supply_type.get(c.get('cardSupplyId'), 'normal')
        rows.append([
            c['id'],
            c['characterId'],
            rar_code.get(c['cardRarityType'], 0),
            ATTRS.index(c['attr']) if c.get('attr') in ATTRS else 0,
            SUPPLY_ORDER.index(st) if st in SUPPLY_ORDER else 0,
            UNITS.index(c['supportUnit']) if c.get('supportUnit') in UNITS else -1,
            1 if c['id'] in in_gacha else 0,
            c.get('prefix') or '',
            c.get('assetbundleName') or '',
        ])

    out = ROOT / 'data' / 'cards-index.js'
    body = [
        '/* 由 tools/build-cards-index.py 產生,請勿手改 */',
        f'export const UNITS = {json.dumps(UNITS)};',
        f'export const ATTRS = {json.dumps(ATTRS)};',
        f'export const SUPPLY = {json.dumps(SUPPLY_ORDER)};',
        '/* [id, 角色, 稀有度(1-4,9=生日), 屬性, 取得類別, 支援團(-1=無), 卡池可得, 卡名, 素材名] */',
        'export const CARDS = [',
    ]
    body += [json.dumps(r, ensure_ascii=False, separators=(',', ':')) + ',' for r in rows]
    body.append('];')
    body.append(f'export const CHARAS = {json.dumps(ch_rows, ensure_ascii=False, separators=(",", ":"))};')
    out.write_text('\n'.join(body) + '\n', encoding='utf-8')

    kb = out.stat().st_size / 1024
    n_ev = sum(1 for r in rows if r[6] == 0)
    print(f'寫出 {out.relative_to(ROOT)}  {kb:.0f} KB')
    print(f'  卡片 {len(rows)} 張 / 角色 {len(ch_rows)} 位')
    print(f'  非卡池取得(活動報酬等) {n_ev} 張')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
