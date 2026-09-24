#!/usr/bin/env python3
"""從台服 master DB 產生「圖鑑類」分頁用的精簡索引。

virtualLives.json 2.7 MB、mysekaiFixtures.json 1 MB（外加 tags 170 KB、藍圖成本 2,700 筆），
瀏覽器端直接載太肥，而且大半欄位（等候室、道具、演出設定）圖鑑根本用不到。
這支把要顯示的欄位抽出來壓成兩個小檔：

    data/lives-index.js      虛擬 Live：類型、名稱、期間、場次、歌單、出演角色       （約 60 KB）
    data/fixtures-index.js   MySekai 家具：分類、標籤、尺寸、顏色、製作素材            （約 120 KB）
    data/stories-index.js    劇情目錄：活動／主線／卡片／區域對話／個人／特別 的章節與 scenarioId（約 250 KB）
    data/mysekai-talks-index.js  MySekai 角色對話：每則對話的角色與解鎖條件（家具／劇情／現象／來訪次數）（約 130 KB）

角色／素材／一格漫畫／原聲帶／公告那幾頁的來源檔都很小（< 300 KB），
前端直接抓 master 就好，不經過這裡。

內容沒變就不寫檔，CI 才不會空提交。重跑：

    python3 tools/build-db-index.py
    python3 tools/stamp-assets.py
"""
import json
import pathlib
import urllib.request

from tc_source import TC, TC_SW, tc_json  # 台服 master：Haruki 為主，缺檔退回 Sekai-World
JP = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-diff/main'
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_LIVES = ROOT / 'data' / 'lives-index.js'
OUT_FIX = ROOT / 'data' / 'fixtures-index.js'
OUT_ST = ROOT / 'data' / 'stories-index.js'
OUT_MST = ROOT / 'data' / 'mysekai-talks-index.js'
OUT_BUILT = ROOT / 'data' / 'data-built.js'
OUT_MSEV = ROOT / 'data' / 'mysekai-events.js'
OUT_SUP = ROOT / 'data' / 'support-events.js'


def get(url):
    if url.startswith((TC, TC_SW)):
        return tc_json(url)
    req = urllib.request.Request(url, headers={'user-agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read())


def dump(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':'))


def write_if_changed(path, header, body):
    """檔頭註解之後就是資料；資料相同就不動檔案。"""
    text = header + body
    if path.exists() and path.read_text(encoding='utf-8') == text:
        print(f'內容無變化,不更新 {path.name}')
        return False
    path.write_text(text, encoding='utf-8')
    print(f'寫入 {path.name}:{path.stat().st_size // 1024} KB')
    return True


# ---------------------------------------------------------------- 虛擬 Live
def build_lives():
    lives = get(f'{TC}/virtualLives.json')
    # 歌單要顯示封面:曲名之外也帶上封面素材名(台服沒有的曲用日服補)
    tc_music = {m['id']: (m['title'], m.get('assetbundleName') or '') for m in get(f'{TC}/musics.json')}
    jp_music = {m['id']: (m['title'], m.get('assetbundleName') or '') for m in get(f'{JP}/musics.json')}
    unit_chara = {u['id']: u['gameCharacterId'] for u in get(f'{TC}/gameCharacterUnits.json')}

    rows = []
    for v in lives:
        # 場次：同一場 Live 的每個時段長度幾乎都一樣（15 分鐘），存「起點 + 每場的分鐘偏移」就夠。
        sch = sorted((x.get('startAt') or 0, x.get('endAt') or 0) for x in (v.get('virtualLiveSchedules') or []))
        sch = [x for x in sch if x[0]]
        base = sch[0][0] if sch else 0
        dur = round((sch[0][1] - sch[0][0]) / 60000) if sch else 0
        offs = [round((a - base) / 60000) for a, _b in sch]
        # 歌單只留曲目：MC／過場對圖鑑沒有意義
        setlist = []
        for x in sorted((v.get('virtualLiveSetlists') or []), key=lambda y: y.get('seq') or 0):
            if x.get('virtualLiveSetlistType') != 'music' or not x.get('musicId'):
                continue
            mid = x['musicId']
            title, jkt = tc_music.get(mid) or jp_music.get(mid) or (f'#{mid}', '')
            setlist.append([mid, title, jkt])
        chars = []
        for x in (v.get('virtualLiveCharacters') or []):
            cid = unit_chara.get(x.get('gameCharacterUnitId'))
            if cid and cid not in chars:
                chars.append(cid)
        rows.append({
            'id': v['id'], 'ty': v.get('virtualLiveType') or 'normal', 'n': v.get('name') or '',
            'abn': v.get('assetbundleName') or '',
            's': v.get('startAt') or 0, 'e': v.get('endAt') or 0,
            'sch': [base, dur, offs] if sch else None,
            'set': setlist, 'ch': chars,
            'g': v.get('virtualLiveGroupId') or 0,   # 6.0 起:同一組（如五週年特別留言 26 場）合併顯示
        })
    rows.sort(key=lambda r: (-(r['s'] or 0), -r['id']))
    try:
        groups = [[g['id'], g.get('name') or '', g.get('startAt') or 0, g.get('endAt') or 0] for g in get(f'{TC}/virtualLiveGroups.json')]
    except Exception:
        groups = []
    body = 'export const LIVES=' + dump(rows) + ';\nexport const LIVE_GROUPS=' + dump(groups) + ';\n'
    header = ('/* 由 tools/build-db-index.py 產生,勿手改。'
              ' 欄位:id 類型ty 名稱n 素材abn 期間s/e 場次sch=[起點,每場分鐘,各場分鐘偏移] 歌單set=[[曲id,曲名,封面素材名]] 出演ch=[角色id] 群組g;'
              ' LIVE_GROUPS=[[群組id,名稱,起,迄]] */\n')
    print(f'虛擬 Live:{len(rows)} 場（有場次 {sum(1 for r in rows if r["sch"])}、有歌單 {sum(1 for r in rows if r["set"])}）')
    return write_if_changed(OUT_LIVES, header, body)


# ---------------------------------------------------------------- MySekai 家具
def build_fixtures():
    fx = get(f'{TC}/mysekaiFixtures.json')
    genres = get(f'{TC}/mysekaiFixtureMainGenres.json')
    subs = get(f'{TC}/mysekaiFixtureSubGenres.json')
    tags = get(f'{TC}/mysekaiFixtureTags.json')
    bps = get(f'{TC}/mysekaiBlueprints.json')
    costs = get(f'{TC}/mysekaiBlueprintMysekaiMaterialCosts.json')
    mats = get(f'{TC}/mysekaiMaterials.json')

    bp_of = {b['craftTargetId']: b['id'] for b in bps if b.get('mysekaiCraftType') == 'mysekai_fixture'}
    # 6.0 起藍圖多了 isAvailableWithoutPossession（不用持有藍圖也能做）：豆森對話的「還缺家具」不該算它
    free_bp = {b['craftTargetId'] for b in bps if b.get('mysekaiCraftType') == 'mysekai_fixture' and b.get('isAvailableWithoutPossession')}
    cost_of = {}
    for c in costs:
        cost_of.setdefault(c['mysekaiBlueprintId'], []).append((c.get('seq') or 0, c['mysekaiMaterialId'], c.get('quantity') or 0))
    tag_name = {t['id']: t for t in tags}
    # 6.0 起的豆森生日派對家具:記派對 id,圖鑑上標「生日派對家具」
    try:
        bday_of = {x['mysekaiFixtureId']: x['birthdayPartyId'] for x in get(f'{TC}/birthdayPartyMysekaiFixtures.json')}
    except Exception:
        bday_of = {}

    rows, used_tags = [], set()
    for f in fx:
        g = f.get('mysekaiFixtureTagGroup') or {}
        tids = [g.get(k) for k in ('mysekaiFixtureTagId1', 'mysekaiFixtureTagId2', 'mysekaiFixtureTagId3') if g.get(k)]
        # 標籤裡「跟家具同名」的那條只是自己指自己，圖鑑上看不出意義，去掉
        tids = [t for t in tids if t in tag_name and tag_name[t].get('name') != f.get('name')]
        used_tags.update(tids)
        gs = f.get('gridSize') or {}
        cost = sorted(cost_of.get(bp_of.get(f['id']), []))
        rows.append([
            f['id'], f.get('name') or '', f.get('mysekaiFixtureMainGenreId') or 0, f.get('mysekaiFixtureSubGenreId') or 0,
            tids, [gs.get('width') or 0, gs.get('depth') or 0, gs.get('height') or 0],
            f.get('assetbundleName') or '', f.get('mysekaiFixtureType') or '',
            (f.get('flavorText') or '') if (f.get('flavorText') or '') != (f.get('name') or '') else '',
            [c.get('colorCode') for c in (f.get('mysekaiFixtureAnotherColors') or []) if c.get('colorCode')],
            [[mid, qty] for _s, mid, qty in cost],
            f.get('mysekaiSettableSiteType') or '', 1 if f.get('isAssembled') else 0,
            bday_of.get(f['id'], 0), 1 if f['id'] in free_bp else 0,
        ])
    rows.sort(key=lambda r: r[0])
    tag_rows = {t: [tag_name[t].get('name') or '', tag_name[t].get('mysekaiFixtureTagType') or 'none', tag_name[t].get('externalId') or 0]
                for t in sorted(used_tags)}
    mat_rows = {m['id']: [m.get('name') or '', m.get('iconAssetbundleName') or '', m.get('mysekaiMaterialRarityType') or '']
                for m in mats}
    body = ('export const FIX_GENRES=' + dump([[g['id'], g.get('name') or ''] for g in genres]) + ';\n'
            'export const FIX_SUBS=' + dump([[g['id'], g.get('name') or '', g.get('mysekaiFixtureMainGenreId') or 0] for g in subs]) + ';\n'
            'export const FIX_TAGS=' + dump(tag_rows) + ';\n'
            'export const FIX_MATS=' + dump(mat_rows) + ';\n'
            'export const FIXTURES=' + dump(rows) + ';\n')
    header = ('/* 由 tools/build-db-index.py 產生,勿手改。'
              ' FIXTURES 欄位:[id, 名稱, 主分類id, 子分類id, 標籤id[], [寬,深,高], 素材名, 類型, 說明, 其他顏色[], 製作素材[[素材id,數量]], 可放置場所, 可製作, 生日派對id(0=否), 免持有藍圖可做(1)] */\n')
    print(f'家具:{len(rows)} 件（有製作素材 {sum(1 for r in rows if r[10])}、標籤 {len(tag_rows)} 條）')
    return write_if_changed(OUT_FIX, header, body)


# ---------------------------------------------------------------- 劇情目錄
def build_stories():
    """劇情閱讀器只需要「有哪些章節、每章的 scenarioId 與素材路徑」；劇本本文另外從素材 CDN 抓。
    eventStories 587 KB、cardEpisodes 1.1 MB、actionSets 876 KB 都是為了報酬／解鎖條件才那麼大。"""
    ev_st = get(f'{TC}/eventStories.json')
    events = {e['id']: e for e in get(f'{TC}/events.json')}
    unit_st = get(f'{TC}/unitStories.json')
    card_eps = get(f'{TC}/cardEpisodes.json')
    action_sets = get(f'{TC}/actionSets.json')
    areas = get(f'{TC}/areas.json')
    specials = get(f'{TC}/specialStories.json')
    profiles = get(f'{TC}/characterProfiles.json')

    st_events = []
    for st in sorted(ev_st, key=lambda x: -x['eventId']):
        eps = sorted(st.get('eventStoryEpisodes') or [], key=lambda e: e.get('episodeNo') or 0)
        st_events.append([st['eventId'], events.get(st['eventId'], {}).get('name', ''), st.get('assetbundleName') or '',
                          st.get('outline') or '', [[e.get('episodeNo') or 0, e.get('title') or '', e.get('scenarioId') or ''] for e in eps]])
    st_units = []
    for u in sorted(unit_st, key=lambda x: x.get('seq') or 0):
        chapters = []
        for c in sorted(u.get('chapters') or [], key=lambda x: x.get('chapterNo') or 0):
            eps = sorted(c.get('episodes') or [], key=lambda e: (e.get('chapterNo') or 0, e.get('episodeNo') or 0))
            chapters.append([c.get('chapterNo') or 0, c.get('assetbundleName') or '', c.get('title') or '',
                             [[e.get('episodeNoLabel') or '', e.get('title') or '', e.get('scenarioId') or ''] for e in eps]])
        st_units.append([u.get('unit') or '', chapters])
    # 卡片劇情的標題幾乎都是「支線劇情（前篇／後篇）」，跟前後篇欄位重複，只有不一樣時才存
    st_cards = {}
    DEFAULT_TITLE = {'first_part': '支線劇情（前篇）', 'second_part': '支線劇情（後篇）'}
    for e in sorted(card_eps, key=lambda x: x['id']):
        part = e.get('cardEpisodePartType') or ''
        title = e.get('title') or ''
        st_cards.setdefault(e['cardId'], []).append(['' if title == DEFAULT_TITLE.get(part) else title, e.get('scenarioId') or '', part[:1]])
    st_areas = [[a['id'], a.get('name') or '', a.get('areaType') or ''] for a in sorted(areas, key=lambda x: x['id'])]
    # 劇本檔名在鏡像站用 scenarioId（areatalk_…），舊資料只有 scriptId（as_…）；兩個都存，前端一個抓不到換另一個
    st_talks = [[a['id'], a.get('areaId') or 0, a.get('characterIds') or [], a.get('scenarioId') or '', a.get('scriptId') or '']
                for a in sorted(action_sets, key=lambda x: x['id']) if a.get('scenarioId') or a.get('scriptId')]
    st_special = []
    for sp in sorted(specials, key=lambda x: x['id']):
        eps = sorted(sp.get('episodes') or [], key=lambda e: e.get('episodeNo') or 0)
        st_special.append([sp['id'], sp.get('title') or '', sp.get('assetbundleName') or '',
                           [[e.get('episodeNo') or 0, e.get('title') or '', e.get('scenarioId') or '', e.get('assetbundleName') or ''] for e in eps]])
    st_self = {pf['characterId']: pf.get('scenarioId') or '' for pf in profiles if pf.get('scenarioId')}

    body = ('export const ST_EVENTS=' + dump(st_events) + ';\n'
            'export const ST_UNITS=' + dump(st_units) + ';\n'
            'export const ST_CARDS=' + dump(st_cards) + ';\n'
            'export const ST_AREAS=' + dump(st_areas) + ';\n'
            'export const ST_TALKS=' + dump(st_talks) + ';\n'
            'export const ST_SPECIAL=' + dump(st_special) + ';\n'
            'export const ST_SELF=' + dump(st_self) + ';\n')
    header = ('/* 由 tools/build-db-index.py 產生,勿手改。'
              ' ST_EVENTS=[活動id,名稱,劇情素材名,大綱,[[話數,標題,scenarioId]]] ST_UNITS=[[團,[[章,章素材名,章名,[[話標籤,標題,scenarioId]]]]]]'
              ' ST_CARDS={卡id:[[標題(空=預設的「支線劇情（前篇／後篇）」),scenarioId,f/s]]} ST_AREAS=[[區域id,名稱,類型]] ST_TALKS=[[對話id,區域id,[角色id],scenarioId,scriptId]]'
              ' ST_SPECIAL=[[id,標題,素材名,[[話數,標題,scenarioId,話素材名]]]] ST_SELF={角色id:scenarioId} */\n')
    print(f'劇情目錄:活動 {len(st_events)}、主線章 {sum(len(u[1]) for u in st_units)}、卡片 {len(st_cards)}、區域對話 {len(st_talks)}、特別 {len(st_special)}、個人 {len(st_self)}')
    return write_if_changed(OUT_ST, header, body)



# ---------------------------------------------------------------- MySekai 角色對話
def build_mysekai_talks():
    """豆森對話清單：mysekaiCharacterTalks 2.3 MB，前端只需要「哪幾個角色、要什麼條件」。
    以遊戲內對話一覽的分組（characterArchiveMysekaiCharacterTalkGroupId）為一則，
    同一則的多筆變體（不同天氣、單人／多人）合併：角色取聯集、條件取聯集。"""
    talks = get(f'{TC}/mysekaiCharacterTalks.json')
    conds = get(f'{TC}/mysekaiCharacterTalkConditions.json')
    cgroups = get(f'{TC}/mysekaiCharacterTalkConditionGroups.json')
    ugroups = get(f'{TC}/mysekaiGameCharacterUnitGroups.json')
    gcus = get(f'{TC}/gameCharacterUnits.json')
    phen = get(f'{TC}/mysekaiPhenomenas.json')
    ev_st = get(f'{TC}/eventStories.json')
    events = {e['id']: e for e in get(f'{TC}/events.json')}

    # 遊戲角色單位 id → 角色 id（VS 在各團的分身要折回本體）
    base_of = {g['id']: g['gameCharacterId'] for g in gcus}
    chars_of = {}
    for u in ugroups:
        ids = [u.get(f'gameCharacterUnitId{i}') for i in range(1, 6)]
        chars_of[u['id']] = sorted({base_of.get(i, i) for i in ids if i})
    cond_by_id = {c['id']: c for c in conds}
    KIND = {'mysekai_fixture_id': 'f', 'read_event_story_episode_id': 's', 'mysekai_phenomena_id': 'p', 'mysekai_character_visit_count': 'v'}
    conds_of = {}
    for row in cgroups:
        c = cond_by_id.get(row['mysekaiCharacterTalkConditionId'])
        if c:
            conds_of.setdefault(row['groupId'], []).append((KIND.get(c['mysekaiCharacterTalkConditionType'], c['mysekaiCharacterTalkConditionType']), c['mysekaiCharacterTalkConditionTypeValue']))

    groups = {}
    for t in sorted(talks, key=lambda x: x['id']):
        gid = t.get('characterArchiveMysekaiCharacterTalkGroupId') or t['id']
        g = groups.setdefault(gid, {'chars': set(), 'conds': set()})
        g['chars'].update(chars_of.get(t.get('mysekaiGameCharacterUnitGroupId'), []))
        g['conds'].update(conds_of.get(t.get('mysekaiCharacterTalkConditionGroupId'), []))
    rows = [[gid, sorted(g['chars']), sorted(g['conds'])] for gid, g in sorted(groups.items()) if g['chars']]

    # 條件的顯示名稱：劇情話數與天氣現象（家具名稱由 fixtures-index 提供）
    ep_name = {}
    for st in ev_st:
        ev = events.get(st['eventId'], {}).get('name', '')
        for e in st.get('eventStoryEpisodes') or []:
            ep_name[e['id']] = f"{ev} 第 {e.get('episodeNo') or 0} 話"
    used_s = {v for r in rows for k, v in r[2] if k == 's'}
    used_p = {v for r in rows for k, v in r[2] if k == 'p'}
    names = {'s': {i: ep_name.get(i, f'活動劇情 #{i}') for i in sorted(used_s)},
             'p': {p['id']: p.get('name') or '' for p in phen if p['id'] in used_p}}
    body = ('export const MST_TALKS=' + dump(rows) + ';\n'
            'export const MST_NAMES=' + dump(names) + ';\n')
    header = ('/* 由 tools/build-db-index.py 產生,勿手改。'
              ' MST_TALKS=[[對話組id,[角色id],[[條件種類,值]]]] 種類:f=家具id s=活動劇情話id p=天氣現象id v=來訪次數；'
              ' MST_NAMES={s:{話id:名稱},p:{現象id:名稱}} */\n')
    n_fix = sum(1 for r in rows if any(k == 'f' for k, _ in r[2]))
    print(f'MySekai 對話:{len(rows)} 則（需家具 {n_fix}、原始 {len(talks)} 筆）')
    return write_if_changed(OUT_MST, header, body)



# ---------------------------------------------------------------- 豆森活動（6.0 起）
def build_mysekai_events():
    """data/mysekai-events.js：豆森生日派對（birthdayParties）與我的「世界」百景競賽（mysekaiHousingCompetitions）。
    日曆、今日摘要與行事曆匯出用。台服沒有這兩張表時輸出空清單。"""
    unit_chara = {u['id']: u['gameCharacterId'] for u in get(f'{TC}/gameCharacterUnits.json')}
    rows = []
    try:
        for b in get(f'{TC}/birthdayParties.json'):
            rows.append({'k': 'bday', 'id': b['id'], 'ch': unit_chara.get(b.get('gameCharacterUnitId')) or 0,
                         's': b.get('startAt') or 0, 'e': b.get('closedAt') or 0, 'bs': b.get('birthdayStartAt') or 0})
    except Exception:
        pass
    try:
        for c in get(f'{TC}/mysekaiHousingCompetitions.json'):
            rows.append({'k': 'contest', 'id': c['id'], 'n': c.get('name') or '', 'd': c.get('description') or '',
                         's': c.get('submitStartAt') or 0, 'e': c.get('submitEndAt') or 0, 'agg': c.get('aggregateAt') or 0})
    except Exception:
        pass
    rows.sort(key=lambda r: r['s'])
    body = 'export const MS_EVENTS=' + dump(rows) + ';\n'
    header = '/* 由 tools/build-db-index.py 產生,勿手改。豆森活動:k=bday(生日派對:ch 角色id、s/e 期間、bs 生日當天) 或 contest(百景競賽:n 名稱、d 說明、s/e 投稿期間、agg 結算) */\n'
    print(f'豆森活動:{len(rows)} 筆')
    return write_if_changed(OUT_MSEV, header, body)


# ---------------------------------------------------------------- 應援活動
def build_support_events():
    """data/support-events.js：應援活動（supportEvents）。期程、各 Live 種類×火數的應援點數係數、評價係數、
    個人／全體得分獎勵。獎勵明細從 compactResourceBoxDetails（欄式壓縮版）解出；個人獎勵六個團體只差稱號，
    存一份並把稱號寫成「團體稱號」。日曆、今日摘要、行事曆匯出與計算中心「應援活動」分頁用。

    2026-09 改吃 Haruki 的 6.4 master 後要注意兩件事：
    1. 它只留最近三場，而且重新編號（Sekai-World 的第 7、8 場在這裡是 id 5、6），所以更早的場次
       從 Sekai-World 補回來；同一場在兩邊的開始時間可能差一天（台服改過期程），三天內算同一場，以 Haruki 為準。
    2. 6.4 新增 eventType=v2（棋盤版）：沒有火數係數與個人得分獎勵，改由棋盤格發獎。
    顯示用的「第 N 回」依開始時間排序算出來（n），不再直接拿 master id。"""
    def load(url):
        try:
            return get(url) or []
        except Exception:
            return []
    hk = load(f'{TC}/supportEvents.json')
    sw = load(f'{TC_SW}/supportEvents.json') if TC != TC_SW else []
    if not hk and not sw:
        body = 'export const SUPPORT_EVENTS=[];\n'
        return write_if_changed(OUT_SUP, '/* 由 tools/build-db-index.py 產生,勿手改。應援活動（台服目前沒有這張表） */\n', body)
    names = {}
    for typ, fname in (('material', 'materials'), ('boost_item', 'boostItems'), ('gacha_ticket', 'gachaTickets'),
                       ('mysekai_material', 'mysekaiMaterials'), ('stamp', 'stamps')):
        try:
            names[typ] = {x['id']: x.get('name') or '' for x in get(f'{TC}/{fname}.json')}
        except Exception:
            names[typ] = {}
    fixed = {'jewel': '水晶', 'paid_jewel': '有償水晶', 'coin': '金幣', 'virtual_coin': '虛擬硬幣', 'honor': '團體稱號',
             'practice_ticket': '練習券', 'skill_practice_ticket': '技能練習券', 'live_point': 'Live 點數',
             'card': '卡片', 'costume_3d': '服裝', 'penlight': '螢光棒', 'player_frame': '玩家邊框'}

    def boxes(base):
        try:
            c = get(f'{base}/compactResourceBoxDetails.json')
        except Exception:
            return {}
        en = c['__ENUM__']
        out = {}
        for i, pi in enumerate(c['resourceBoxPurpose']):
            pn = en['resourceBoxPurpose'][pi]
            if not pn.startswith('support_event_'):
                continue
            out.setdefault((pn, c['resourceBoxId'][i]), []).append(
                (en['resourceType'][c['resourceType'][i]], c['resourceId'][i], c['resourceQuantity'][i] or 0))
        return out
    box_hk = boxes(TC) if hk else {}
    box_sw = boxes(TC_SW) if sw else {}

    def label(items):
        out = []
        for typ, rid, qty in items:
            nm = names.get(typ, {}).get(rid) or fixed.get(typ) or typ
            if typ == 'stamp':
                nm = '貼圖'
            out.append(nm + ('×' + str(qty) if qty and qty > 1 else ''))
        return '、'.join(out)

    def jewel(items):
        return sum(q for typ, _, q in items if typ == 'jewel')

    def row(e, box, src):
        boost = {}
        for b in e.get('liveBoostRates') or []:
            boost.setdefault(b['liveType'], {})[b['boost']] = b['boostRate']
        boost = {k: [v.get(i, 0) for i in range(max(v) + 1)] for k, v in boost.items()}
        rank = {r['scoreRank']: r['rate'] for r in e.get('liveScoreRankRates') or []}
        units = sorted({r['unit'] for r in (e.get('personalScoreRewards') or []) + (e.get('totalScoreRewards') or [])})
        u0 = units[0] if units else None
        personal = []
        for r in sorted((x for x in e.get('personalScoreRewards') or [] if x['unit'] == u0), key=lambda x: x['unitScore']):
            it = box.get(('support_event_personal_reward', r['resourceBoxId']), [])
            personal.append([r['unitScore'], label(it), jewel(it)])
        total = []
        for r in sorted((x for x in e.get('totalScoreRewards') or [] if x['unit'] == u0), key=lambda x: x['unitScore']):
            it = box.get(('support_event_total_reward', r['resourceBoxId']), [])
            total.append([r['unitScore'], label(it)])
        out = {'id': e['id'], 's': e.get('startAt') or 0, 'agg': e.get('aggregateAt') or 0, 'c': e.get('closeAt') or 0,
               'boost': boost, 'rank': rank, 'personal': personal, 'total': total, 'src': src}
        v = e.get('eventType') or 'v1'
        if v != 'v1':
            out['v'] = v
            out['turn'] = e.get('turn') or 0
            out['jump'] = e.get('maxJumpPoint') or 0
            out['tiles'] = len(e.get('v2MapTiles') or [])
        return out

    rows = [row(e, box_hk, 'hk') for e in hk]
    DAY3 = 3 * 86400000
    for e in sw:
        st = e.get('startAt') or 0
        if any(abs(st - (r['s'] or 0)) <= DAY3 for r in rows):
            continue   # 同一場,以 Haruki(較新)為準
        rows.append(row(e, box_sw, 'sw'))
    rows.sort(key=lambda r: r['s'])
    for i, r in enumerate(rows):
        r['n'] = i + 1
    body = 'export const SUPPORT_EVENTS=' + dump(rows) + ';\n'
    header = ('/* 由 tools/build-db-index.py 產生,勿手改。應援活動:id master id（Haruki 與 Sekai-World 編號不同）、n 第幾回、'
              's 開始、agg 結算、c 關閉；boost={live種類:[火0..火10 的應援點數係數]}；rank={評價:係數}；'
              ' personal=[[個人分數門檻,獎勵,水晶數]]（六團只差稱號,存一份）；total=[[全體分數門檻,獎勵]]；'
              ' v=v2 為棋盤版（turn 回合、jump 跳躍點上限、tiles 格數,個人獎勵改由棋盤發放）；src hk/sw 資料來源 */\n')
    print(f'應援活動:{len(rows)} 場（Haruki {len(hk)}、Sekai-World 補 {len(rows) - len(hk)}）')
    return write_if_changed(OUT_SUP, header, body)


# ---------------------------------------------------------------- 資料日期
def write_built(changed):
    """data/data-built.js：各索引檔最近一次「內容真的有變」的日期，圖鑑頁角落顯示「資料 9/18 更新」。
    沒變的索引保留舊日期，這個小檔本身只在日期有變時才改（避免每天戳記都變、快取白白失效）。"""
    import datetime
    old = {}
    if OUT_BUILT.exists():
        m = __import__('re').search(r'BUILT=(\{.*?\});', OUT_BUILT.read_text(encoding='utf-8'), __import__('re').S)
        if m:
            try:
                old = json.loads(m.group(1))
            except Exception:
                old = {}
    today = datetime.date.today().isoformat()
    for k, did in changed.items():
        if did or k not in old:
            old[k] = today
    body = 'export const BUILT=' + dump(old) + ';\n'
    return write_if_changed(OUT_BUILT, '/* 由 tools/build-db-index.py 產生,勿手改。各索引檔最近一次內容有變的日期 */\n', body)


if __name__ == '__main__':
    changed = {
        'lives': build_lives(),
        'fixtures': build_fixtures(),
        'stories': build_stories(),
        'mst': build_mysekai_talks(),
        'msev': build_mysekai_events(),
        'sup': build_support_events(),
    }
    write_built(changed)
