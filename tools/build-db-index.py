#!/usr/bin/env python3
"""從台服 master DB 產生「圖鑑類」分頁用的精簡索引。

virtualLives.json 2.7 MB、mysekaiFixtures.json 1 MB（外加 tags 170 KB、藍圖成本 2,700 筆），
瀏覽器端直接載太肥，而且大半欄位（等候室、道具、演出設定）圖鑑根本用不到。
這支把要顯示的欄位抽出來壓成兩個小檔：

    data/lives-index.js      虛擬 Live：類型、名稱、期間、場次、歌單、出演角色       （約 60 KB）
    data/fixtures-index.js   MySekai 家具：分類、標籤、尺寸、顏色、製作素材            （約 120 KB）

角色／素材／一格漫畫／原聲帶／公告那幾頁的來源檔都很小（< 300 KB），
前端直接抓 master 就好，不經過這裡。

內容沒變就不寫檔，CI 才不會空提交。重跑：

    python3 tools/build-db-index.py
    python3 tools/stamp-assets.py
"""
import json
import pathlib
import urllib.request

TC = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-tc-diff/main'
JP = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-diff/main'
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_LIVES = ROOT / 'data' / 'lives-index.js'
OUT_FIX = ROOT / 'data' / 'fixtures-index.js'


def get(url):
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
        })
    rows.sort(key=lambda r: (-(r['s'] or 0), -r['id']))
    body = 'export const LIVES=' + dump(rows) + ';\n'
    header = ('/* 由 tools/build-db-index.py 產生,勿手改。'
              ' 欄位:id 類型ty 名稱n 素材abn 期間s/e 場次sch=[起點,每場分鐘,各場分鐘偏移] 歌單set=[[曲id,曲名,封面素材名]] 出演ch=[角色id] */\n')
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
    cost_of = {}
    for c in costs:
        cost_of.setdefault(c['mysekaiBlueprintId'], []).append((c.get('seq') or 0, c['mysekaiMaterialId'], c.get('quantity') or 0))
    tag_name = {t['id']: t for t in tags}

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
              ' FIXTURES 欄位:[id, 名稱, 主分類id, 子分類id, 標籤id[], [寬,深,高], 素材名, 類型, 說明, 其他顏色[], 製作素材[[素材id,數量]], 可放置場所, 可製作] */\n')
    print(f'家具:{len(rows)} 件（有製作素材 {sum(1 for r in rows if r[10])}、標籤 {len(tag_rows)} 條）')
    return write_if_changed(OUT_FIX, header, body)


if __name__ == '__main__':
    build_lives()
    build_fixtures()
