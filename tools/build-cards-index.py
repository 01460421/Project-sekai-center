#!/usr/bin/env python3
"""從 master DB 產生精簡卡片索引（收集率與卡面下載用）。

cards.json 原始檔台服 4 MB、日服 34 MB,不可能在瀏覽器端載入。
這支腳本把需要的欄位抽出來壓成約 100 KB,
並在建置階段就算好「是否能從卡池取得」(不能的多半是活動報酬)。

兩個伺服器各產一份:
    data/cards-index.js      台服(繁中卡名)
    data/cards-index-jp.js   日服(日文卡名)——台服還沒實裝的卡只有這裡有

有新卡時重跑:

    python3 tools/build-cards-index.py         # 兩服都產
    python3 tools/build-cards-index.py tw      # 只產台服
    python3 tools/stamp-assets.py              # 別忘了重新戳版本
"""
import sys
import concurrent.futures
import json
import pathlib
import urllib.error
import urllib.request

ASSET = 'https://storage.sekai.best/sekai-jp-assets'


def art_exists(abn):
    """素材庫裡有沒有這張卡的圖。

    日服 master 會列出「已公布但素材還沒上架」的卡（實測 id 1454、1457 是 404），
    照單全收的話卡面下載頁會出現一排破圖與死連結。所以建置時逐張確認，
    確認不到的就標記起來，讓前端不要放進格點。
    這個邊界會隨時間往後移，寫死一個 id 是錯的，只能每次建置時實際問一次。
    """
    # 不能用 HEAD:這個 CDN 對 python-urllib 的預設 User-Agent 一律回 403,
    # 於是「每一張都查不到」——照著做會把整份日服清單標成未上架而全部消失。
    # 用帶 UA 的範圍 GET 只抓前 100 bytes,拿得到 206 就代表檔案在。
    req = urllib.request.Request(
        f'{ASSET}/character/member/{abn}/card_normal.png',
        headers={'Range': 'bytes=0-99', 'User-Agent': 'pjsk-center-build/1.0 (+https://project-sekai-center.com)'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status in (200, 206)
    except urllib.error.HTTPError as e:
        return e.code in (200, 206, 416)     # 416＝檔案比 100 bytes 還小,仍然算存在
    except Exception:
        return False


from tc_source import TC, TC_SW, tc_json  # 台服 master：Haruki 為主，缺檔退回 Sekai-World

SERVERS = {
    # 台服 master 以 Haruki 為主(缺檔退回 tc-diff),日服是 diff。日服永遠比台服快約一年,
    # 所以日服索引裡會有台服還查不到的卡 —— 卡面下載頁就是靠這一份補齊。
    'tw': (TC,
           'cards-index.js', '台服'),
    'jp': ('https://raw.githubusercontent.com/Sekai-World/sekai-master-db-diff/main',
           'cards-index-jp.js', '日服'),
}
ROOT = pathlib.Path(__file__).resolve().parent.parent

UNITS = ['light_sound', 'idol', 'street', 'theme_park', 'school_refusal', 'piapro']
ATTRS = ['cool', 'happy', 'mysterious', 'cute', 'pure']
# cardSupplyId 1..7 → 顯示用代碼
SUPPLY_ORDER = ['normal', 'birthday', 'term_limited', 'colorful_festival_limited',
                'bloom_festival_limited', 'unit_event_limited', 'collaboration_limited']


def get(db, name):
    if db == TC:
        return tc_json(f'{db}/{name}', 120)
    with urllib.request.urlopen(f'{db}/{name}') as r:
        return json.load(r)


def prev_gacha_flags(fname):
    """上一版索引裡標為「卡池可得」的卡 id（見 build 內的說明）。"""
    out = ROOT / 'data' / fname
    ids = set()
    if not out.exists():
        return ids
    for line in out.read_text(encoding='utf-8').split('\n'):
        if line.startswith('[') and line.endswith('],'):
            try:
                r = json.loads(line[:-1])
                if r[6] == 1:
                    ids.add(r[0])
            except Exception:
                pass
    return ids


def build(server):
    db, fname, label = SERVERS[server]
    print(f'下載 {label} master DB…')
    cards = get(db, 'cards.json')
    charas = get(db, 'gameCharacters.json')
    supplies = get(db, 'cardSupplies.json')
    gachas = get(db, 'gachas.json')

    supply_type = {s['id']: s['cardSupplyType'] for s in supplies}

    in_gacha = set()
    for g in gachas:
        for d in (g.get('gachaDetails') or []):
            if d.get('cardId'):
                in_gacha.add(d['cardId'])
    if server == 'tw':
        # 2026/06 起台服的 gachas.json 只保留近期卡池（六十幾筆），舊卡「能不能從卡池取得」
        # 已經查不到。卡片 id 兩服相同，所以把日服（完整 1,000 多筆）的卡池明細也算進來，
        # 再用上一版索引的旗標當最後保險（日服也拿不到時不要把舊卡全標成活動卡）。
        try:
            for g in get(SERVERS['jp'][0], 'gachas.json'):
                for d in (g.get('gachaDetails') or []):
                    if d.get('cardId'):
                        in_gacha.add(d['cardId'])
            print(f'  卡池明細已合併日服（台服 {len(gachas)} 筆）')
        except Exception as e:
            print(f'  日服 gachas.json 讀不到（{e}），只用台服＋上一版索引')
        in_gacha |= prev_gacha_flags(fname)

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
        # 6.0 起有「一拿到就是特訓後」的卡（initialSpecialTrainingStatus=done）：
        # 第 10 欄先補素材旗標 1，第 11 欄記 1；其他卡維持 9 欄不動。
        if c.get('initialSpecialTrainingStatus') == 'done':
            rows[-1].append(1)
            rows[-1].append(1)

    if server == 'jp':
        # 只查最後 300 張:更早的卡素材一定早就上架,全查 1,435 張是白花時間
        tail = rows[-300:]
        print(f'確認最後 {len(tail)} 張的素材是否已上架…')
        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as ex:
            ok = list(ex.map(lambda r: art_exists(r[8]), tail))
        missing = 0
        for r, has in zip(tail, ok):
            if not has:
                if len(r) > 9:
                    r[9] = 0
                else:
                    r.append(0)
                missing += 1
        print(f'  素材尚未上架 {missing} 張（前端不列入）')

    out = ROOT / 'data' / fname
    body = [
        '/* 由 tools/build-cards-index.py 產生,請勿手改 */',
        f'export const UNITS = {json.dumps(UNITS)};',
        f'export const ATTRS = {json.dumps(ATTRS)};',
        f'export const SUPPLY = {json.dumps(SUPPLY_ORDER)};',
        '/* [id, 角色, 稀有度(1-4,9=生日), 屬性, 取得類別, 支援團(-1=無), 卡池可得, 卡名, 素材名]',
        '   第 10 欄若為 0 代表素材庫還沒有這張卡的圖(日服已公布但未上架),前端不列入;第 11 欄為 1 代表取得即特訓後(6.0 起) */',
        'export const CARDS = [',
    ]
    body += [json.dumps(r, ensure_ascii=False, separators=(',', ':')) + ',' for r in rows]
    body.append('];')
    body.append(f'export const CHARAS = {json.dumps(ch_rows, ensure_ascii=False, separators=(",", ":"))};')
    out.write_text('\n'.join(body) + '\n', encoding='utf-8')

    if server == 'tw':
        write_extra(db, cards)

    kb = out.stat().st_size / 1024
    n_ev = sum(1 for r in rows if r[6] == 0)
    print(f'寫出 {out.relative_to(ROOT)}  {kb:.0f} KB')
    print(f'  卡片 {len(rows)} 張 / 角色 {len(ch_rows)} 位')
    print(f'  非卡池取得(活動報酬等) {n_ev} 張')
    return len(rows)


def write_extra(db, cards):
    """卡片圖鑑詳情用的補充資料：滿等數值、特訓加成、技能、釋出日、招募台詞。
    跟 cards-index 分開放：收集率／卡面下載頁用不到這些，不必為了圖鑑多載 100 KB。
    cardParameters 在台服 master 是壓縮格式 {param1:[逐等級], param2, param3}，
    最後一格就是該稀有度的滿等值（★4/生日 60、★3 50、★2 40、★1 20）。"""
    skills = get(db, 'skills.json')
    # 樣板裡的 {{44;v}} 是「效果 id 44」不是第幾個效果，所以效果要用 id 當 key。
    # e = 同團加成（skillEnhance，每多一位同團成員 +e%）、m = 該等級的上限（v + e×5：四位同團再加全員一致）。
    sk = {}
    for x in skills:
        effects = {}
        for e in (x.get('skillEffects') or []):
            enh = (e.get('skillEnhance') or {}).get('activateEffectValue')
            lv = {}
            for d in (e.get('skillEffectDetails') or []):
                row = {'d': d.get('activateEffectDuration'), 'v': d.get('activateEffectValue')}
                if enh is not None and isinstance(row['v'], (int, float)):
                    row['m'] = row['v'] + enh * 5
                lv[d.get('level') or 0] = row
            obj = {'lv': [lv.get(i) for i in range(1, 5)]}
            if enh is not None:
                obj['e'] = enh
            effects[e['id']] = obj
        sk[x['id']] = [x.get('description') or '', effects]

    extra = {}
    for c in cards:
        cp = c.get('cardParameters') or {}
        if isinstance(cp, dict):
            mx = [(cp.get(k) or [0])[-1] for k in ('param1', 'param2', 'param3')]
        else:   # 舊格式：逐筆 {cardLevel, cardParameterType, power}
            best = {}
            for r in cp:
                t = r.get('cardParameterType'); best[t] = max(best.get(t, 0), r.get('power') or 0)
            mx = [best.get('param1', 0), best.get('param2', 0), best.get('param3', 0)]
        extra[c['id']] = [
            c.get('skillId') or 0, int((c.get('releaseAt') or 0) / 1000),
            mx[0], mx[1], mx[2],
            c.get('specialTrainingPower1BonusFixed') or 0, c.get('specialTrainingPower2BonusFixed') or 0, c.get('specialTrainingPower3BonusFixed') or 0,
            c.get('gachaPhrase') or '', c.get('cardSkillName') or '',
        ]
    out = ROOT / 'data' / 'cards-extra.js'
    body = ['/* 由 tools/build-cards-index.py 產生,請勿手改。',
            '   CARD_EXTRA[id] = [技能id, 釋出(秒), 滿等表演, 滿等技巧, 滿等體力, 特訓加成×3, 招募台詞, 技能名]',
            '   SKILLS[id] = [敘述樣板({{效果id;d}}=秒數、{{效果id;v}}=數值、e=同團加成、m=上限、c=角色名), {效果id:{lv:[Lv1..Lv4 的 {d,v,m}], e}}] */',
            'export const CARD_EXTRA=' + json.dumps(extra, ensure_ascii=False, separators=(',', ':')) + ';',
            'export const SKILLS=' + json.dumps(sk, ensure_ascii=False, separators=(',', ':')) + ';']
    out.write_text('\n'.join(body) + '\n', encoding='utf-8')
    print(f'寫出 {out.relative_to(ROOT)}  {out.stat().st_size / 1024:.0f} KB（{len(extra)} 張、{len(sk)} 種技能）')


def main():
    want = [a for a in sys.argv[1:] if a in SERVERS] or list(SERVERS)
    counts = {}
    for sv in want:
        counts[sv] = build(sv)
        print()
    if len(counts) > 1:
        print('日服比台服多 %d 張（台服尚未實裝）' % (counts.get('jp', 0) - counts.get('tw', 0)))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
