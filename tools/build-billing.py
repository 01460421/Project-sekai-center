#!/usr/bin/env python3
"""從 master DB 產生 data/billing.js（儲值分析用的商城商品資料）。

resourceBoxDetails.json 原始檔 23 MB,不可能在瀏覽器端載入。
這支腳本把商城 930+ 項商品(水晶包/組合包/通行證/裝扮)連同台幣價格、
內容物(有償/無償水晶、票券、道具)、限購與販售期間全部 join 好,
壓成一個 ~200 KB 的靜態檔;瀏覽器端零額外請求。

注意:
- billingProducts 有一批價格是 9999 的佔位值(月卡V2/新手包等,實際售價
  只在商店端顯示),抓下來會標 priceKnown=false,前端讓玩家自填。
- 內容物 = 主資源箱(billing_shop_item) + 附贈箱(billing_shop_item_bonus)。
- costume_3d 部件數量龐大,只記部件總數不展開。
- 內容與上次相同就不改檔(builtAt 除外),CI 才不會每天空提交。

有新商品時重跑:

    python3 tools/build-billing.py
    python3 tools/stamp-assets.py      # 別忘了重新戳版本
"""
import json
import pathlib
import re
import time
import urllib.request

DB = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-tc-diff/main'
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'billing.js'


def get(name):
    req = urllib.request.Request(f'{DB}/{name}', headers={'Accept-Encoding': 'identity'})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def main():
    items = get('billingShopItems.json')
    products = get('billingProducts.json')
    tab_parents = get('billingShopTabParents.json')
    tab_children = get('billingShopTabChildren.json')
    exchange_costs = get('billingShopItemExchangeCosts.json')
    pass_v1 = get('colorfulPasses.json')
    pass_v2 = get('colorfulPassV2s.json')
    mysekai_pass = get('mysekaiColorfulPass.json')
    materials = {m['id']: m['name'] for m in get('materials.json')}
    tickets = {t['id']: t['name'] for t in get('gachaTickets.json')}
    try:
        boosts = {b['id']: b.get('name') or '活力補給' for b in get('boostItems.json')}
    except Exception:
        boosts = {}
    chars = {c['id']: (c.get('firstName') or '') + (c.get('givenName') or '') for c in get('gameCharacters.json')}
    cards = {c['id']: c for c in get('cards.json')}

    # resourceBoxDetails 23 MB:只留商城相關 purpose
    print('抓 resourceBoxDetails(23MB)…')
    details = get('resourceBoxDetails.json')
    box = {}
    for d in details:
        p = d['resourceBoxPurpose']
        if p in ('billing_shop_item', 'billing_shop_item_bonus', 'colorful_pass_v2', 'colorful_pass'):
            box.setdefault((p, d['resourceBoxId']), []).append(d)
    del details

    # 價格:同群組 iOS/Android/web 實測全同價,取第一個非 google_points 的
    price_by_group = {}
    for p in products:
        if p['platform'] == 'google_points':
            continue
        g = p['groupId']
        if g not in price_by_group:
            price_by_group[g] = p['price']

    # 兌換價(有償水晶):一項一筆
    exch = {}
    for c in exchange_costs:
        exch.setdefault(c['billingShopItemId'], c['quantity'])

    parents = {t['id']: t['name'] for t in tab_parents}
    children = {t['id']: t for t in tab_children}

    RARE = {'rarity_1': '★1', 'rarity_2': '★2', 'rarity_3': '★3', 'rarity_4': '★4', 'rarity_birthday': '生日'}
    TYPE_LABEL = {
        'coin': '金幣', 'virtual_coin': '虛擬硬幣', 'live_point': 'LIVE P',
        'stamp': '貼圖', 'practice_ticket': '練習分數組合', 'skill_practice_ticket': '技能練習卷軸',
        'boost_item': '活力補給', 'custom_profile_collection_resource': '個人檔案素材',
        'avatar_coordinate': '頭像裝扮', 'colorful_pass': '七彩通行證(舊)資格',
        'colorful_pass_v2': '七彩通行證資格', 'mysekai_colorful_pass': '世界通行證資格',
        'mysekai_material': '「世界」素材', 'mysekai_fixture': '「世界」家具',
        'mysekai_music_record': '「世界」唱片', 'mysekai_canvas': '畫布',
    }

    def content_name(d):
        t, rid = d['resourceType'], d.get('resourceId')
        if t == 'material':
            return materials.get(rid, f'素材#{rid}')
        if t == 'gacha_ticket':
            return tickets.get(rid, f'招募票券#{rid}')
        if t == 'boost_item':
            return boosts.get(rid, '活力補給')
        if t == 'card':
            c = cards.get(rid)
            if not c:
                return f'卡片#{rid}'
            return f"「{c.get('prefix', '')}」{chars.get(c.get('characterId'), '')} {RARE.get(c.get('cardRarityType'), '')}"
        return TYPE_LABEL.get(t, t)

    def pack_contents(ds):
        """[{...}] → (paid, free, ticketPulls, contents[])。costume 部件只記總數。"""
        paid = free = pulls = 0
        out = []
        costume_parts = 0
        for d in ds:
            t, q = d['resourceType'], d['resourceQuantity']
            if t == 'paid_jewel':
                paid += q
            elif t == 'jewel':
                free += q
            elif t == 'costume_3d':
                costume_parts += q
                continue
            elif t == 'gacha_ticket':
                name = tickets.get(d.get('resourceId'), '')
                per = 10 if '10連' in name else 1
                pulls += q * per
                out.append(['ticket', q, content_name(d)])
                continue
            elif t in ('colorful_pass', 'colorful_pass_v2', 'mysekai_colorful_pass'):
                # 前端 passJ() 靠第 4 欄 resourceId 查每日領取量(tier)
                out.append([t, q, content_name(d), d.get('resourceId')])
                continue
            else:
                out.append([t, q, content_name(d)])
                continue
        if costume_parts:
            out.append(['costume', costume_parts, f'服裝部件×{costume_parts}'])
        return paid, free, pulls, out

    rows = []
    for i in items:
        main = box.get(('billing_shop_item', i['resourceBoxId']), [])
        bonus = box.get(('billing_shop_item_bonus', i.get('bonusResourceBoxId')), []) if i.get('bonusResourceBoxId') else []
        p1, f1, t1, c1 = pack_contents(main)
        p2, f2, t2, c2 = pack_contents(bonus)
        price = price_by_group.get(i.get('billingProductGroupId'))
        child = children.get(i.get('billingShopTabChildId'), {})
        row = {
            'id': i['id'], 'seq': i.get('seq', 0), 't': i['billingShopItemType'],
            'n': i['name'], 'd': i.get('description') or '',
            'lab': i.get('label') or '',
            'tab': (child.get('name') or '').replace('\n', ''),
            'tabP': parents.get(child.get('billingShopTabParentId'), ''),
            'price': price if price is not None else None,
            'pk': bool(price is not None and price < 9990),   # priceKnown:9999 是佔位
            # 有償水晶兌換價:只有 purchaseOption=exchange 才是真的用水晶買
            'exch': exch.get(i['id']) if i.get('purchaseOption') == 'exchange' else None,
            'paid': p1 + p2, 'free': f1 + f2, 'pulls': t1 + t2,
            'c': c1, 'bc': c2,
            'lim': {'t': i['billableLimitType'], 'v': i.get('billableLimitValue'),
                    'r': i.get('billableLimitResetIntervalType'), 'rv': i.get('billableLimitResetIntervalValue')},
            's': i.get('startAt'), 'e': i.get('endAt'),
        }
        rows.append(row)

    # 七彩通行證:每日無償水晶在 colorful_pass(_v2) resource box(id=tier/pass id)
    daily = {}
    daily_v1 = {}
    for (p, bid), ds in box.items():
        q = sum(d['resourceQuantity'] for d in ds if d['resourceType'] == 'jewel')
        if p == 'colorful_pass_v2':
            daily[bid] = q
        elif p == 'colorful_pass':
            daily_v1[bid] = q
    passes = {'v1': pass_v1, 'v1Daily': daily_v1, 'v2': pass_v2, 'v2Daily': daily, 'mysekai': mysekai_pass}

    data = {'source': 'sekai-master-db-tc-diff', 'items': rows, 'passes': passes}

    # 內容沒變就不寫(builtAt 除外),CI 才不會空提交
    if OUT.exists():
        m = re.search(r'window\.BILLING_DATA\s*=\s*(\{.*\});?\s*$', OUT.read_text(), re.S)
        if m:
            try:
                old = json.loads(m.group(1))
                old.pop('builtAt', None)
                if old == data:
                    print(f'內容無變化,不更新 {OUT.name}')
                    return
            except Exception:
                pass

    data['builtAt'] = int(time.time() * 1000)
    body = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    OUT.write_text('// 由 tools/build-billing.py 產生,勿手改。資料源:sekai-master-db-tc-diff\n'
                   f'window.BILLING_DATA={body};\n')
    known = sum(1 for r in rows if r['pk'])
    print(f'寫入 {OUT.name}:{len(rows)} 項商品(已知台幣價 {known}、有償水晶兌換 {sum(1 for r in rows if r["exch"])})、{OUT.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
