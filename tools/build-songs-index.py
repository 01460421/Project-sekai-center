#!/usr/bin/env python3
"""重建 data/songs-index.js：歌曲清單（js/app.js 的 loadSongs 用）的預先整理版。

為什麼：loadSongs 以前每次都即時抓台服＋日服 master 的 musics／musicDifficulties／musicVocals 六個檔
（約 360 KB），手機慢速網路下歌曲頁要等兩三秒才有東西，日曆頁也會觸發同一批下載。
這裡用同一套規則先整理好（壓縮後約 30 KB）：網站先用它立刻畫出清單，
進歌曲頁之後瀏覽器閒下來，再照舊即時抓一次 master，有新歌就換上（不會因為每日建置而落後）。

規則與 js/app.js 的 loadSongs 完全一樣（改一邊要改另一邊）：
  台服 master 為主（tools/tc_source.py：Haruki 為主、缺檔退回 Sekai-World），
  日服 master（Sekai-World sekai-master-db-diff）補台服還沒實裝的曲目，標 jp:1。
  units：各版本演唱角色所屬團體（依 musicVocals 出現順序、去重）；
  lv／nt：各難度的等級與 Notes 數；abnV＝虛擬歌手版（original_song 也算）、abnS＝SEKAI 版、abn＝abnV||abnS||任一版本。
輸出：export const SONGS = [{ id, title, composer, published, units, lv, nt, abn, abnV, abnS, jkt, jp? }]、export const BUILT
內容沒變就不寫檔。重跑：python3 tools/build-songs-index.py && python3 tools/stamp-assets.py
"""
import datetime
import json
import pathlib
import sys
import urllib.request

from tc_source import TC, tc_json

JDB = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-diff/main'
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'songs-index.js'
DIFFS = ['easy', 'normal', 'hard', 'expert', 'master', 'append']
UA = {'user-agent': 'pjsk-center-build/1.0 (+https://project-sekai-center.com)'}


def jp_json(name):
    req = urllib.request.Request(JDB + '/' + name, headers=UA)
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read())


def cu(c):
    return 'ln' if c <= 4 else 'mmj' if c <= 8 else 'vbs' if c <= 12 else 'wxs' if c <= 16 else 'n25' if c <= 20 else 'vs'


def build(mlist, dlist, vlist, jp):
    """跟 loadSongs 裡的 build() 一行對一行"""
    lv, nt = {}, {}
    for d in dlist:
        lv.setdefault(d['musicId'], {})[d['musicDifficulty']] = d.get('playLevel')
        nt.setdefault(d['musicId'], {})[d['musicDifficulty']] = d.get('totalNoteCount')
    um, vV, vS, vAny = {}, {}, {}, {}
    for v in vlist:
        u = um.setdefault(v['musicId'], [])
        for c in v.get('characters') or []:
            cid = c.get('characterId')
            if cid and cu(cid) not in u:
                u.append(cu(cid))
        abn = v.get('assetbundleName')
        if not abn:
            continue
        vAny.setdefault(v['musicId'], abn)
        t = v.get('musicVocalType')
        if t in ('virtual_singer', 'original_song') and v['musicId'] not in vV:
            vV[v['musicId']] = abn
        if t == 'sekai' and v['musicId'] not in vS:
            vS[v['musicId']] = abn
    out = []
    for x in mlist:
        i = x['id']
        abnV, abnS = vV.get(i, ''), vS.get(i, '')
        rec = {'id': i, 'title': x.get('title') or '', 'composer': x.get('composer') or x.get('arranger') or '',
               'published': x.get('publishedAt') or 0, 'units': um.get(i, []),
               'lv': lv.get(i, {}), 'nt': nt.get(i, {}), 'abn': abnV or abnS or vAny.get(i, ''),
               'abnV': abnV, 'abnS': abnS, 'jkt': x.get('assetbundleName') or ''}
        if jp:
            rec['jp'] = 1
        out.append(rec)
    return out


def tw_json(name):
    """loadSongs 的 tdbJson(...).catch(() => [])：抓不到就當空的"""
    try:
        d = tc_json(TC + '/' + name)
        return d if isinstance(d, list) else []
    except Exception as e:
        print(f'台服 {name} 抓取失敗：{e}', file=sys.stderr)
        return []


def compact(songs):
    """縮成陣列（主要省掉重複的鍵名）；lv／nt 依 DIFFS 排、沒有的難度記 null。
    難度出現順序跟 DIFFS 不一樣的歌（理論上沒有）就原樣保留物件，展開結果才會一模一樣。"""
    rows = []
    for s in songs:
        def arr(o):
            if list(o) != [k for k in DIFFS if k in o]:
                return o
            a = [o.get(k) if k in o else None for k in DIFFS]
            while a and a[-1] is None and DIFFS[len(a) - 1] not in o:
                a.pop()
            return a
        dflt = 'jacket_s_%03d' % s['id']
        anyabn = s['abn'] if not (s['abnV'] or s['abnS']) else ''
        rows.append([s['id'], s['title'], s['composer'], s['published'], ','.join(s['units']), arr(s['lv']), arr(s['nt']),
                     s['abnV'], s['abnS'], anyabn, '' if s['jkt'] == dflt else (s['jkt'] or None), 1 if s.get('jp') else 0])
    return rows


def main():
    ms, md, mv = tw_json('musics.json'), tw_json('musicDifficulties.json'), tw_json('musicVocals.json')
    try:
        jms, jmd, jmv = jp_json('musics.json'), jp_json('musicDifficulties.json'), jp_json('musicVocals.json')
    except Exception as e:
        print(f'日服 master 抓取失敗，不更新：{e}', file=sys.stderr)
        return 0
    if len(ms) < 300 or len(jms) < 300:
        print(f'曲目數不對（台服 {len(ms)}、日服 {len(jms)}），不更新', file=sys.stderr)
        return 0
    tw = build(ms, md, mv, 0)
    have = {x['id'] for x in tw}
    songs = tw + build([x for x in jms if x['id'] not in have], jmd, jmv, 1)
    rows = compact(songs)
    body = ',\n'.join(json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in rows)
    js = ('/* 由 tools/build-songs-index.py 產生，勿手改。歌曲清單的預先整理版（規則同 js/app.js 的 loadSongs）：\n'
          '   台服 master 為主、日服補台服未實裝曲（jp:1）。網站先用這份畫清單，進歌曲頁閒下來再即時抓 master 對一次。 */\n'
          f"const D = {json.dumps(DIFFS)};\n"
          'const L = a => Array.isArray(a) ? a.reduce((o, v, i) => { if (v !== null) o[D[i]] = v; return o; }, {}) : a;\n'
          f'const R = [\n{body}\n];\n'
          "export const SONGS = R.map(r => { const o = { id: r[0], title: r[1], composer: r[2], published: r[3], units: r[4] ? r[4].split(',') : [],\n"
          "  lv: L(r[5]), nt: L(r[6]), abn: r[7] || r[8] || r[9], abnV: r[7], abnS: r[8], jkt: r[10] === null ? '' : (r[10] || 'jacket_s_' + String(r[0]).padStart(3, '0')) };\n"
          '  if (r[11]) o.jp = 1; return o; });\n')
    old = OUT.read_text(encoding='utf-8') if OUT.is_file() else ''
    strip = lambda t: '\n'.join(l for l in t.split('\n') if not l.startswith('export const BUILT'))
    if strip(old) == js.rstrip('\n') + '\n' or strip(old) == js:
        print(f'data/songs-index.js 已是最新（{len(songs)} 首）')
        return 0
    built = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%MZ')
    OUT.write_text(js + f"export const BUILT = '{built}';\n", encoding='utf-8')
    print(f'寫出 data/songs-index.js：{len(songs)} 首（台服 {len(tw)}、日服限定 {len(songs) - len(tw)}），{OUT.stat().st_size // 1024} KB')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
