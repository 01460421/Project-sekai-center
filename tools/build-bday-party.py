#!/usr/bin/env python3
"""產生 data/bday-party.js（MASTER_SRV=jp → data/bday-party-jp.js）：豆森生日派對（慶典之花）攻略頁與計算機用的資料。

master 裡有的都從 master 來：
  birthdayParties                    派對期間（收集開始、生日當天、結束）、露水（materials）、慶典之花（mysekaiMaterials）
  birthdayPartyDeliveryRewards       每朵慶典之花要澆多少 pt（目前都是 10,000）
  birthdayPartyDeliveryPointBonuses  持有加成卡時每個露水多給的 %（當年生日卡 +50%、往年生日卡 +15%）
  birthdayPartyDeliveryTotalRewards  依慶典之花累計數量領的獎勵（resourceBox，攤平成 [類型, id, 數量]）
露水的掉落量（雙葉、一般採集、LIVE）是伺服器決定的，master 沒有，前端標社群實測值。

  BDAY = { built, parties: [[派對id, 角色id, 收集開始, 生日當天, 結束, 露水（materials id）, 慶典之花（mysekaiMaterials id）, 每朵pt, [[卡id, 加成%]…], [[需要花數, 箱id]…]]…],
           boxes: {箱id: [[類型, id, 數量]…]}, names: {'類型:id': [名稱, 縮圖路徑(素材庫底下), 數值]} }
    數值：練習譜＝每張 EXP、技能升級譜＝每張技能 EXP、LIVE BONUS 飲料＝回復量、稱號＝稀有度
時間一律是 epoch 毫秒。

用法：
    python3 tools/build-bday-party.py                    # 台服 → data/bday-party.js
    MASTER_SRV=jp python3 tools/build-bday-party.py      # 日服 → data/bday-party-jp.js
    python3 tools/stamp-assets.py
"""
import json
import pathlib
import re
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from tc_source import TC, SRV, SRV_LABEL, srv_out, tc_json

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / srv_out('bday-party.js')


def load(name):
    try:
        return tc_json(f'{TC}/{name}.json') or []
    except Exception as e:   # 單一張表抓不到就當空表
        print(f'{name}.json 抓不到：{e}', file=sys.stderr)
        return []


def main():
    parties = load('birthdayParties')
    if not parties:
        print('birthdayParties.json 沒有資料，不更新', file=sys.stderr)
        return 1
    units = {u['id']: u for u in load('gameCharacterUnits')}
    per_pt = {}
    for r in load('birthdayPartyDeliveryRewards'):
        per_pt.setdefault(r['birthdayPartyId'], int(r.get('requirement') or 10000))
    bonus = {}
    for b in load('birthdayPartyDeliveryPointBonuses'):
        bonus.setdefault(b['birthdayPartyId'], []).append([int(b['cardId']), int(b.get('rate') or 0)])
    totals = {}
    for t in load('birthdayPartyDeliveryTotalRewards'):
        totals.setdefault(t['birthdayPartyId'], []).append([int(t['requirement']), int(t['resourceBoxId'])])
    want = {bx for rows in totals.values() for _, bx in rows}

    # 獎勵箱：台服有 resourceBoxDetails；日服只有 resourceBoxes（明細掛在 details 底下）
    if SRV == 'jp':
        details = [d for b in load('resourceBoxes') for d in (b.get('details') or [])]
    else:
        details = load('resourceBoxDetails')
    boxes = {}
    for d in details:
        if d.get('resourceBoxPurpose') != 'birthday_party_delivery_total_reward' or d.get('resourceBoxId') not in want:
            continue
        boxes.setdefault(d['resourceBoxId'], []).append([d.get('resourceType') or '', int(d.get('resourceId') or 0), int(d.get('resourceQuantity') or 0)])

    # 名稱、縮圖與數值：只帶獎勵用得到的
    used = {(t, i) for rows in boxes.values() for t, i, _ in rows}
    mats = {m['id']: m for m in load('materials')}
    mys_mats = {m['id']: m for m in load('mysekaiMaterials')}
    names = {}
    def put(t, i, name, img='', val=0):
        names[f'{t}:{i}'] = [name, img, val]
    for p in parties:
        m = mats.get(p.get('deliveryItemMaterialId')) or {}
        put('material', p.get('deliveryItemMaterialId'), m.get('name') or '', f"thumbnail/material/material{p.get('deliveryItemMaterialId')}.webp")
        f = mys_mats.get(p.get('deliveryRewardMysekaiMaterialId')) or {}
        put('mysekai_material', p.get('deliveryRewardMysekaiMaterialId'), f.get('name') or '',
            f"mysekai/thumbnail/material/{f['iconAssetbundleName']}.webp" if f.get('iconAssetbundleName') else '')
    tables = {}
    def table(name):
        if name not in tables:
            tables[name] = {x['id']: x for x in load(name)}
        return tables[name]
    for t, i in sorted(used):
        if t == 'material':
            m = mats.get(i) or {}
            put(t, i, m.get('name') or f'素材 #{i}', f'thumbnail/material/material{i}.webp')
        elif t == 'boost_item':
            b = table('boostItems').get(i) or {}
            put(t, i, b.get('name') or f'LIVE BONUS #{i}', f'thumbnail/boost_item/boost_item{i}.webp', int(b.get('recoveryValue') or 0))
        elif t == 'practice_ticket':
            b = table('practiceTickets').get(i) or {}
            put(t, i, b.get('name') or f'練習譜 #{i}', f'thumbnail/practice_ticket/ticket{i}.webp', int(b.get('exp') or 0))
        elif t == 'skill_practice_ticket':
            b = table('skillPracticeTickets').get(i) or {}
            put(t, i, b.get('name') or f'技能升級譜 #{i}', f'thumbnail/skill_practice_ticket/ticket{i}.webp', int(b.get('exp') or 0))
        elif t == 'gacha_ticket':
            b = table('gachaTickets').get(i) or {}
            put(t, i, b.get('name') or f'招募券 #{i}', f"thumbnail/gacha_ticket/{b['assetbundleName']}.webp" if b.get('assetbundleName') else '')
        elif t == 'mysekai_item':
            b = table('mysekaiItems').get(i) or {}
            put(t, i, b.get('name') or f'道具 #{i}', f"mysekai/thumbnail/item/{b['iconAssetbundleName']}.webp" if b.get('iconAssetbundleName') else '')
        elif t == 'mysekai_material':
            b = mys_mats.get(i) or {}
            put(t, i, b.get('name') or f'素材 #{i}', f"mysekai/thumbnail/material/{b['iconAssetbundleName']}.webp" if b.get('iconAssetbundleName') else '')
        elif t == 'honor':
            b = table('honors').get(i) or {}
            put(t, i, b.get('name') or f'稱號 #{i}', '', {'low': 1, 'middle': 2, 'high': 3, 'highest': 4}.get(b.get('honorRarity'), 0))
        else:
            put(t, i, f'{t} #{i}')

    rows = []
    for p in sorted(parties, key=lambda x: (x['startAt'], x['id'])):
        u = units.get(p.get('gameCharacterUnitId')) or {}
        f = mys_mats.get(p.get('deliveryRewardMysekaiMaterialId')) or {}
        rows.append([p['id'], int(u.get('gameCharacterId') or 0), p['startAt'], p['birthdayStartAt'], p['closedAt'],
                     int(p.get('deliveryItemMaterialId') or 0), int(p.get('deliveryRewardMysekaiMaterialId') or 0), per_pt.get(p['id'], 10000),
                     sorted(bonus.get(p['id'], []), key=lambda b: -b[1]), sorted(totals.get(p['id'], []))])

    out = {'built': int(time.time() * 1000), 'parties': rows, 'boxes': {str(k): v for k, v in sorted(boxes.items())}, 'names': names}
    body = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    text = (f'/* 由 tools/build-bday-party.py 產生,勿手改。{SRV_LABEL}豆森生日派對（慶典之花）：期間、露水與花、加成卡、每朵 pt、累計獎勵與道具名稱。 */\n'
            f'export const BDAY={body};\n')
    old = OUT.read_text(encoding='utf-8') if OUT.exists() else ''
    strip = lambda s: re.sub(r'"built":\d+', '"built":0', s)
    if strip(old) == strip(text):
        print(f'內容無變化,不更新 {OUT.name}')
        return 0
    OUT.write_text(text, encoding='utf-8')
    print(f'寫入 {OUT.name}:{OUT.stat().st_size // 1024} KB（派對 {len(rows)} 場、獎勵箱 {len(boxes)} 個、道具 {len(names)} 種）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
