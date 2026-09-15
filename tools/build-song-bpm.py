#!/usr/bin/env python3
"""重建 data/song-bpm.js(歌曲頁詳情用的 BPM)。

來源:社長 bot(t-wy)的公開資料庫 game-public-data/pjsk/song_bpm.json —
      遊戲內譜面製作功能用的 BPM 段落(每首 [{bpm, time, beats}, …]),691 首,曲目 id 同日服 master。
輸出:export const SONG_BPM = { id: [主BPM, 最低, 最高] }
      主BPM = 各段落依持續秒數加總後最長的那個;最低／最高不含 4 拍以下的過門段(time 差 < 1 秒的段落)。
      單一 BPM 的歌三個值相同。體積 ~10 KB,歌曲詳情打開時才載入。
內容沒變就不寫檔。重跑:python3 tools/build-song-bpm.py && python3 tools/stamp-assets.py
"""
import json
import pathlib
import re
import sys
import urllib.request

SRC = 'https://raw.githubusercontent.com/t-wy/game-public-data/main/pjsk/song_bpm.json'
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'song-bpm.js'


def get(url):
    req = urllib.request.Request(url, headers={'user-agent': 'project-sekai-center/1.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def summarize(segs, total_hint=None):
    segs = sorted((s for s in segs if s.get('bpm')), key=lambda s: float(s.get('time') or 0))
    if not segs:
        return None
    dur = {}
    for i, s in enumerate(segs):
        t0 = float(s.get('time') or 0)
        t1 = float(segs[i + 1]['time']) if i + 1 < len(segs) else t0 + 30.0   # 最後一段長度未知,給個下限
        b = round(float(s['bpm']), 2)
        dur[b] = dur.get(b, 0) + max(0.0, t1 - t0)
    main = max(dur.items(), key=lambda kv: kv[1])[0]
    # 只有一瞬間的變速(小於 1 秒)不算進範圍,否則過門一個 400 就把範圍撐爆
    steady = [b for b, d in dur.items() if d >= 1.0] or [main]
    fmt = lambda v: int(v) if float(v).is_integer() else v
    return [fmt(main), fmt(min(steady)), fmt(max(steady))]


def main():
    d = get(SRC)
    rows = d['data'] if isinstance(d, dict) else d
    out = {}
    for row in rows:
        mid = row.get('id')
        s = summarize(row.get('bpm') or [])
        if mid is not None and s:
            out[mid] = s
    if len(out) < 300:
        sys.exit(f'BPM 資料只有 {len(out)} 首,來源可能有問題,中止')
    body = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    text = ('// 歌曲 BPM(由 tools/build-song-bpm.py 產生,勿手改)。\n'
            '// 來源:社長 bot(t-wy)game-public-data/pjsk/song_bpm.json(遊戲內譜面製作功能的 BPM 段落)\n'
            '// SONG_BPM[id] = [主BPM, 最低, 最高];曲目 id 同日服 master。\n'
            f'export const SONG_BPM = {body};\n')
    if OUT.exists() and OUT.read_text(encoding='utf-8') == text:
        print(f'內容無變化,不更新 {OUT.name}({len(out)} 首)')
        return
    OUT.write_text(text, encoding='utf-8')
    print(f'寫入 {OUT.name}:{len(out)} 首,{OUT.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
