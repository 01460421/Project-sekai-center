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
# 台服官方網頁商店(GamePay/Ariel,MyCard·信用卡通路)的公開商品 API,無需登入
WEB_API = 'https://gamepay.ariel.com.tw/web/payment/app/5245/country/TW/all_goods_detail'
WEB_SHOP_URL = 'https://gamepay.ariel.com.tw/topup/5245'
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'billing.js'

# 官網通行證「兌換券」→ 對應遊戲內商品 id(內容照抄再加上券附贈的水晶)
VOUCHER_MAP = {
    'mk.mycard.card': 67,      # 七彩通行證～BASIC～
    'mk.mycard.card2': 69,     # 七彩通行證～PRECIOUS～
    'mk.mycard.sekai': 400000,  # 世界通行證
    'mk.mycard.bpset1': 24,    # 高階任務通行證
    'mk.mycard.bpset0': 400004,  # 通行證組合包
    'mk.mycard.bpset2': 1060,  # 高階任務通行證(進階版)
}
# GamePay limit_dimension → 重置週期(實測頁面文案:0=總量、1/4=每月、2=每週)
WEB_DIM = {0: 'none', 1: 'monthly', 2: 'weekly', 4: 'monthly'}


def get(name):
    req = urllib.request.Request(f'{DB}/{name}', headers={'Accept-Encoding': 'identity'})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def fetch_web(rows_by_id):
    """抓官網商店目錄,轉成與 master 商品同構的 rows(src='web')。"""
    req = urllib.request.Request(
        WEB_API, data=b'{}', method='POST',
        headers={'content-type': 'application/json', 'user-agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        j = json.load(r)
    if j.get('code') != 0:
        raise RuntimeError(f'gamepay code={j.get("code")}')
    out = []
    goods = (j['data'].get('activity') or []) + (j['data'].get('normal') or [])
    for g in goods:
        pid = g['product_id']
        price = round(g['price'] / 100)   # API 價格單位是「分」
        desc = re.sub(r'<[^>]+>', '\n', g.get('goods_desc') or '')
        lines = [l.strip().strip('*').strip() for l in desc.split('\n')]
        lines = [l for l in lines if l]
        paid = free = pulls = 0
        contents = []
        for l in lines:
            m = re.search(r'(付費水晶|水晶\(付費\)|免費水晶|水晶\(免費\)|\[僅限官網\]免費水晶|\[僅限官網\]附贈免費水晶)\s*[x×]?\s*([\d,]+)', l)
            if m:
                q = int(m.group(2).replace(',', ''))
                if '免費' in m.group(1):
                    free += q
                else:
                    paid += q
                continue
            m2 = re.search(r'^(.+?)\s*[x×]\s*([\d,]+)', l)
            if m2:
                name, q = m2.group(1).strip(), int(m2.group(2).replace(',', ''))
                if '票券' in name and '10連' in name:
                    pulls += q * 10
                    contents.append(['ticket', q, name])
                elif '兌換券' in name or '交換券' in name:
                    contents.append(['web_voucher', q, name])
                else:
                    contents.append(['web_item', q, name])
            elif l and '獲得後' not in l and '可在遊戲' not in l:
                contents.append(['web_item', 1, l])
        t = 'jewel' if 'crystal' in pid else 'value_set'
        ref = VOUCHER_MAP.get(pid)
        if ref and rows_by_id.get(ref):
            base = rows_by_id[ref]
            t = base['t']
            paid += base['paid']
            free += base['free']
            pulls += base['pulls']
            contents = base['c'] + base['bc'] + [c for c in contents if c[0] == 'web_voucher']
        lim_v = g.get('purchase_limit') or 0
        lim = ({'t': 'count', 'v': lim_v, 'r': WEB_DIM.get(g.get('limit_dimension'), 'none'), 'rv': None}
               if lim_v > 0 else {'t': 'unlimited', 'v': None, 'r': 'none', 'rv': None})
        end = g.get('end_time') or 0
        e = end * 1000 if 0 < end < 4000000000 else None
        out.append({
            'id': pid, 'seq': 90000, 't': t, 'n': g['product_name'],
            'd': ' / '.join(lines), 'lab': '', 'tab': '官網商店', 'tabP': '官網商店',
            'price': price, 'pk': True, 'exch': None,
            'paid': paid, 'free': free, 'pulls': pulls,
            'c': contents, 'bc': [], 'lim': lim, 's': None, 'e': e,
            'src': 'web', 'ref': ref,
        })
    return out


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

    # 官網商店(GamePay):抓失敗就沿用上一版的官網資料,別讓整包資料開天窗
    rows_by_id = {r['id']: r for r in rows}
    web_rows = None
    try:
        web_rows = fetch_web(rows_by_id)
        print(f'官網商店:{len(web_rows)} 項')
    except Exception as ex:
        print(f'官網商店抓取失敗({ex}),沿用舊資料')
        if OUT.exists():
            m = re.search(r'window\.BILLING_DATA\s*=\s*(\{.*\});?\s*$', OUT.read_text(), re.S)
            if m:
                try:
                    web_rows = [r for r in json.loads(m.group(1))['items'] if r.get('src') == 'web']
                except Exception:
                    web_rows = None
    rows.extend(web_rows or [])

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
