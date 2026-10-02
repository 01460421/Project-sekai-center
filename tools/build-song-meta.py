#!/usr/bin/env python3
"""重建 data/song-meta.js（星圖頁 starmap.html 用的歌曲詮釋資料）。

來源：Sekai-World 的 master 資料（台服 sekai-master-db-tc-diff 為主、日服 sekai-master-db-diff 補台服未實裝曲）
      musics.json：台服標題、發行日、作曲／作詞／編曲、是否書き下ろし、MV 分類
      musicVocals.json：各版本演唱角色 → 所屬團體（星圖用團體上色）
輸出：export const SONG_META = { id: [台服標題, 團體, 發行日, 作曲, 作詞, 編曲, 旗標, MV, 封面素材名, 創作者] }
      團體：以逗號相連的 ln／mmj／vbs／wxs／n25／vs／other，依 SEKAI ver. 的演唱者順序；只有虛擬歌手的歌是 vs
      發行日：YYYY-MM-DD（台服；日服限定曲用日服日期並在旗標標 j）
      旗標：j＝台服尚未實裝（日服限定）、w＝書き下ろし（為本作新寫的歌）、f＝完整版
      MV：3＝3D MV、2＝2D MV、1＝只有靜態圖、0＝無
      封面素材名：master 的 assetbundleName，等於預設的 jacket_s_{id 三位} 時留空
      創作者：infos[0].creator（如 livetune、DECO*27），與作曲者相同時留空
      台服標題與 data/ep-songs.js 的日文標題相同時留空字串，省體積。
內容沒變就不寫檔。重跑：python3 tools/build-song-meta.py && python3 tools/stamp-assets.py
"""
import datetime
import json
import pathlib
import re
import sys
import urllib.request

TDB = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-tc-diff/main'
JDB = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-diff/main'
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'song-meta.js'
EP = ROOT / 'data' / 'ep-songs.js'


def get(url):
    req = urllib.request.Request(url, headers={'user-agent': 'project-sekai-center/1.0'})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)


def unit_of(cid):
    return 'ln' if cid <= 4 else 'mmj' if cid <= 8 else 'vbs' if cid <= 12 else 'wxs' if cid <= 16 else 'n25' if cid <= 20 else 'vs'


def units_for(vocals):
    """依 SEKAI ver. 演唱者順序列出團體；虛擬歌手排最後；只有外部歌手的歌標 other。"""
    out, has_vs, has_other = [], False, False
    for v in sorted(vocals, key=lambda v: v.get('seq') or 0):
        for c in v.get('characters') or []:
            if c.get('characterType') == 'game_character' and c.get('characterId'):
                u = unit_of(int(c['characterId']))
                if u == 'vs':
                    has_vs = True
                elif u not in out:
                    out.append(u)
            elif c.get('characterType') == 'outside_character':
                has_other = True
    if has_vs:
        out.append('vs')
    if not out and has_other:
        out.append('other')
    return out


def day(ms):
    if not ms:
        return ''
    return datetime.datetime.fromtimestamp(int(ms) / 1000, datetime.timezone.utc).strftime('%Y-%m-%d')


def mv_level(cats):
    cats = {(c.get('musicCategoryName') if isinstance(c, dict) else c) for c in (cats or [])}
    return 3 if 'mv' in cats else 2 if 'mv_2d' in cats else 1 if 'image' in cats else 0


def main():
    ep_src = EP.read_text(encoding='utf-8')
    ep_titles = {int(m.group(1)): json.loads('"' + m.group(2) + '"') for m in re.finditer(r'\{"id":(\d+),"t":"((?:[^"\\]|\\.)*)"', ep_src)}
    if len(ep_titles) < 300:
        sys.exit(f'data/ep-songs.js 只解析到 {len(ep_titles)} 首，中止')
    tm, tv = get(TDB + '/musics.json'), get(TDB + '/musicVocals.json')
    jm, jv = get(JDB + '/musics.json'), get(JDB + '/musicVocals.json')
    tw = {m['id']: m for m in tm}
    jp = {m['id']: m for m in jm}
    vt, vj = {}, {}
    for v in tv:
        vt.setdefault(v['musicId'], []).append(v)
    for v in jv:
        vj.setdefault(v['musicId'], []).append(v)
    out = {}
    for mid in sorted(ep_titles):
        m = tw.get(mid)
        is_jp = m is None
        if is_jp:
            m = jp.get(mid)
        if m is None:
            continue   # 兩邊 master 都沒有（例如台服獨佔但 master 未收錄）：星圖只用 ep-songs 的資料
        vocals = vt.get(mid) or vj.get(mid) or []
        title = m.get('title') or ''
        if title == ep_titles.get(mid):
            title = ''
        flags = ('j' if is_jp else '') + ('w' if m.get('isNewlyWrittenMusic') else '') + ('f' if m.get('isFullLength') else '')
        jkt = m.get('assetbundleName') or ''
        if jkt == 'jacket_s_%03d' % mid:
            jkt = ''
        creator = ((m.get('infos') or [{}])[0].get('creator') or '')
        if creator == (m.get('composer') or ''):
            creator = ''
        out[mid] = [title, ','.join(units_for(vocals)), day(m.get('publishedAt')), m.get('composer') or '', m.get('lyricist') or '', m.get('arranger') or '', flags, mv_level(m.get('categories')), jkt, creator]
    if len(out) < 500:
        sys.exit(f'只湊到 {len(out)} 首，來源可能有問題，中止')
    body = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    text = ('// 歌曲詮釋資料（由 tools/build-song-meta.py 產生，勿手改）。星圖頁 starmap.html 用。\n'
            '// 來源：Sekai-World master（台服 tc-diff 為主、日服 diff 補台服未實裝曲）的 musics.json 與 musicVocals.json\n'
            '// SONG_META[id] = [台服標題（同日文標題時為空）, 團體（ln,mmj,vbs,wxs,n25,vs,other，逗號相連）, 發行日 YYYY-MM-DD, 作曲, 作詞, 編曲, 旗標（j 日服限定／w 書き下ろし／f 完整版）, MV（3=3D 2=2D 1=靜態圖 0=無）, 封面素材名（預設 jacket_s_{id 三位} 時為空）, 創作者（同作曲時為空）]\n'
            f'export const SONG_META = {body};\n')
    if OUT.exists() and OUT.read_text(encoding='utf-8') == text:
        print(f'內容無變化，不更新 {OUT.name}（{len(out)} 首）')
        return
    OUT.write_text(text, encoding='utf-8')
    print(f'寫入 {OUT.name}：{len(out)} 首，{OUT.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
