#!/usr/bin/env python3
"""重建 data/song-meta.js（星圖頁 starmap.html 用的歌曲詮釋資料）。

來源：台服 master 走 tools/tc_source.py（Haruki 為主、缺檔退回 Sekai-World），日服用 Sekai-World sekai-master-db-diff 補台服未實裝曲
      musics.json：台服標題、發行日、作曲／作詞／編曲、是否書き下ろし、MV 分類
      musicVocals.json：各版本演唱角色 → 所屬團體（星圖用團體上色）
輸出：export const SONG_META = { id: [台服標題, 團體, 發行日, 作曲, 作詞, 編曲, 旗標, MV, 封面素材名, 創作者, 虛擬歌手版音源, SEKAI 版音源] }
      團體：以逗號相連的 ln／mmj／vbs／wxs／n25／vs／other，依各版本演唱者順序（不算愚人節版、純伴奏、直播版）；只有虛擬歌手的歌是 vs
      發行日：YYYY-MM-DD，以當地時間取日期（台服 UTC+8、日服 UTC+9；零點上架的歌用 UTC 會早一天）；日服限定曲用日服日期並在旗標標 j
      旗標：j＝台服尚未實裝（日服限定）、w＝書き下ろし（為本作新寫的歌）、f＝完整版
      MV：3＝3D MV、2＝2D MV、1＝只有靜態圖、0＝無
      封面素材名：master 的 assetbundleName，等於預設的 jacket_s_{id 三位} 時留空
      創作者：infos[0].creator（如 livetune、DECO*27），與作曲者相同時留空
      音源：musicVocals 的 assetbundleName（星圖試聽用，網址 storage.sekai.best/.../music/long/{名}/{名}.mp3）；
            虛擬歌手版＝virtual_singer／original_song（都沒有就取任一版本），SEKAI 版＝sekai，沒有則留空
      台服標題與 data/ep-songs.js 的日文標題相同時留空字串，省體積。
內容沒變就不寫檔。重跑：python3 tools/build-song-meta.py && python3 tools/stamp-assets.py
"""
import datetime
import json
import pathlib
import re
import sys
import urllib.request

from tc_source import TC, TC_SW, tc_json   # 台服 master：Haruki 為主，缺檔退回 Sekai-World

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


SKIP_VOCAL = {'april_fool_2022', 'instrumental', 'streaming_live'}   # 愚人節角色互換版、純伴奏、直播版：不算演唱團體、也不當試聽音源


def units_for(vocals):
    """依各版本演唱者順序列出團體；虛擬歌手排最後；只有外部歌手的歌標 other。"""
    out, has_vs, has_other = [], False, False
    for v in sorted(vocals, key=lambda v: v.get('seq') or 0):
        if v.get('musicVocalType') in SKIP_VOCAL:
            continue
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


def vocal_abns(vocals):
    """[虛擬歌手版, SEKAI 版] 的音源名；虛擬歌手版缺的話退回任一版本（只有 another_vocal 或純伴奏的歌），愚人節版不算。"""
    v_abn = s_abn = any_abn = ''
    for v in sorted(vocals, key=lambda v: v.get('seq') or 0):
        abn = v.get('assetbundleName') or ''
        t = v.get('musicVocalType')
        if not abn or t == 'april_fool_2022':
            continue
        if not any_abn:
            any_abn = abn   # 純伴奏曲只有 instrumental 版本：當作最後的退路，試聽才有音源
        if t in SKIP_VOCAL:
            continue
        if t in ('virtual_singer', 'original_song') and not v_abn:
            v_abn = abn
        if t == 'sekai' and not s_abn:
            s_abn = abn
    return [v_abn or any_abn, s_abn]


def day(ms, tz_hours):
    """以當地時間（台服 +8、日服 +9）取日期：零點上架的歌用 UTC 會早一天。"""
    if not ms:
        return ''
    tz = datetime.timezone(datetime.timedelta(hours=tz_hours))
    return datetime.datetime.fromtimestamp(int(ms) / 1000, tz).strftime('%Y-%m-%d')


def mv_level(cats):
    cats = {(c.get('musicCategoryName') if isinstance(c, dict) else c) for c in (cats or [])}
    return 3 if 'mv' in cats else 2 if 'mv_2d' in cats else 1 if 'image' in cats else 0


def main():
    ep_src = EP.read_text(encoding='utf-8')
    ep_titles = {int(m.group(1)): json.loads('"' + m.group(2) + '"') for m in re.finditer(r'\{"id":(\d+),"t":"((?:[^"\\]|\\.)*)"', ep_src)}
    if len(ep_titles) < 300:
        sys.exit(f'data/ep-songs.js 只解析到 {len(ep_titles)} 首，中止')
    tm, tv = tc_json(f'{TC}/musics.json'), tc_json(f'{TC}/musicVocals.json')
    # Haruki 的 musicVocals 少了十幾首台服獨佔曲的版本：Sekai-World 那份有的、Haruki 沒有的曲目就補進來
    try:
        sw_v = get(f'{TC_SW}/musicVocals.json')
        have = {v['musicId'] for v in tv}
        extra = [v for v in sw_v if v.get('musicId') not in have]
        if extra:
            print(f'台服 musicVocals：Haruki 缺 {len({v["musicId"] for v in extra})} 首的版本，自 Sekai-World 補上')
            tv = tv + extra
    except Exception as e:
        print(f'Sekai-World musicVocals 抓取失敗（{e}），只用 Haruki 的')
    jm, jv = get(JDB + '/musics.json'), get(JDB + '/musicVocals.json')
    # 每個來源各自把關：台服縮水或變空的話，所有歌都會被當成日服限定、發行日也會換成日服的，寧可中止
    for name, rows, floor in (('台服 musics', tm, 500), ('台服 musicVocals', tv, 800), ('日服 musics', jm, 600), ('日服 musicVocals', jv, 1000)):
        if not isinstance(rows, list) or len(rows) < floor:
            sys.exit(f'{name} 只有 {len(rows) if isinstance(rows, list) else "?"} 筆（門檻 {floor}），來源可能有問題，中止')
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
        out[mid] = [title, ','.join(units_for(vocals)), day(m.get('publishedAt'), 9 if is_jp else 8), m.get('composer') or '', m.get('lyricist') or '', m.get('arranger') or '', flags, mv_level(m.get('categories')), jkt, creator] + vocal_abns(vocals)
    if len(out) < 500:
        sys.exit(f'只湊到 {len(out)} 首，來源可能有問題，中止')
    tw_n = sum(1 for r in out.values() if 'j' not in r[6])
    if tw_n < 500:
        sys.exit(f'台服已實裝的歌只有 {tw_n} 首，台服來源可能有問題，中止')
    body = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    text = ('// 歌曲詮釋資料（由 tools/build-song-meta.py 產生，勿手改）。星圖頁 starmap.html 用。\n'
            '// 來源：Sekai-World master（台服 tc-diff 為主、日服 diff 補台服未實裝曲）的 musics.json 與 musicVocals.json\n'
            '// SONG_META[id] = [台服標題（同日文標題時為空）, 團體（ln,mmj,vbs,wxs,n25,vs,other，逗號相連）, 發行日 YYYY-MM-DD, 作曲, 作詞, 編曲, 旗標（j 日服限定／w 書き下ろし／f 完整版）, MV（3=3D 2=2D 1=靜態圖 0=無）, 封面素材名（預設 jacket_s_{id 三位} 時為空）, 創作者（同作曲時為空）, 虛擬歌手版音源名, SEKAI 版音源名（無則空）]\n'
            f'export const SONG_META = {body};\n')
    if OUT.exists() and OUT.read_text(encoding='utf-8') == text:
        print(f'內容無變化，不更新 {OUT.name}（{len(out)} 首）')
        return
    OUT.write_text(text, encoding='utf-8')
    print(f'寫入 {OUT.name}：{len(out)} 首，{OUT.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
