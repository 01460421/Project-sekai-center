#!/usr/bin/env python3
"""重建 data/mysekai-studio.js：豆森工作室（mystudio.html）的資料。

    PALETTE  可以當「像素」用的家具：彩色方塊 1x1／2x2（放哪裡都行）、彩色瓷磚 2x2（只能放家前）、
             紅磚／木紋／混凝土塊。每筆 [家具id, 名稱, 色鍵, 色碼, 邊長, 種類, 素材名, 製作素材[[素材id,數量]]]。
             色碼是從官方縮圖的上表面取的主色（tools/.cache 不需要；表就寫在下面 COLOR，新顏色上市時補一行）。
    MATS     上面用到的素材：{id:[名稱, 圖示 assetbundle]}
    CHARS    26 位角色：[id, 名稱, 團體鍵, 代表色, 生日月, 生日日]（生日模板用）
    FIXTURES 由 mystudio.html 自己 import data/fixtures-index.js（內部設計模擬要整份家具表）。

內容沒變就不寫檔。台服 master：gameCharacters.json、characterProfiles.json（Haruki，缺檔退 Sekai-World）。
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tc_source import TC, tc_json  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'mysekai-studio.js'
FIX = ROOT / 'data' / 'fixtures-index.js'

# 色鍵 → 顯示色（官方縮圖上表面的主色，2026-11 量測）。方塊與瓷磚同一組色鍵，瓷磚的實際色略淡一點（第二欄）。
COLOR = {
    'rd': ('#f67777', '#f87b7b'), 'or': ('#fe9759', '#ff9b5c'), 'lor': ('#ffb33d', '#ffba43'), 'yw': ('#ffd844', '#ffdd47'),
    'ygn': ('#a0c00d', '#a4c30d'), 'gn': ('#56c557', '#58c858'), 'bgn': ('#47c69c', '#49ca9d'), 'lbl': ('#77b7e2', '#7abae4'),
    'bl': ('#7b93d0', '#7d95d2'), 'pr': ('#9382cb', '#9685cc'), 'ppr': ('#cd82c0', '#d287c5'), 'pk': ('#ffa2a9', '#ffa7ad'),
    'lbg': ('#f6e5ae', '#f8e9b5'), 'bg': ('#e5ca75', '#e6ce79'), 'lbr': ('#d2a151', '#d5a655'), 'br': ('#a57539', '#a7783b'),
    'wh': ('#e6e6e6', '#ebebeb'), 'lgr': ('#afafaf', '#b4b4b4'), 'gr': ('#7c7c7c', '#818181'), 'bk': ('#4d4d4d', '#4c4c4c'),
    'cl': ('#d6f6f7', '#d6f6f7'),           # 透明方塊：淡青，像素畫不列入
    'brick': ('#d3794b', ''), 'grain': ('#e7b567', ''), 'concre': ('#b7b7b7', ''),
}
UNIT_OF = {'light_sound': 'ln', 'idol': 'mmj', 'street': 'vbs', 'theme_park': 'wxs', 'school_refusal': 'n25', 'piapro': 'vs'}
CHARA_COLOR = {1: '#33aaee', 2: '#ffdd44', 3: '#ee6666', 4: '#bbdd22', 5: '#ffccaa', 6: '#99ccff', 7: '#ffaacc', 8: '#99eedd',
               9: '#ff6699', 10: '#00bbdd', 11: '#ff7722', 12: '#0077dd', 13: '#ffbb00', 14: '#ff66bb', 15: '#33dd99', 16: '#bb88ee',
               17: '#bb6588', 18: '#8888cc', 19: '#ccaa88', 20: '#ddaacc', 21: '#33ccbb', 22: '#ffcc11', 23: '#ffee11', 24: '#ffbbcc',
               25: '#dd4444', 26: '#3366cc'}


def load_fixtures():
    """讀 data/fixtures-index.js 的 FIXTURES 與 FIX_MATS（JS 常值 → JSON）。"""
    txt = FIX.read_text(encoding='utf-8')
    def grab(name):
        m = re.search(r'export const ' + name + r'=(.*?);\n', txt, re.S)
        return json.loads(m.group(1))
    return grab('FIXTURES'), grab('FIX_MATS')


def main():
    rows, mats = load_fixtures()
    pal, used = [], set()
    for r in rows:
        fid, name, genre, asset, size, cost = r[0], r[1], r[2], r[6], r[5], r[10]
        if genre not in (31, 32):
            continue
        m = re.search(r'_(?:block|road)_([a-z]+)(\d)$', asset)
        if not m or m.group(1) not in COLOR:
            print(f'略過（沒有色鍵）：{fid} {name} {asset}', file=sys.stderr)
            continue
        key = m.group(1)
        kind = 'tile' if genre == 31 else 'block'
        hexes = COLOR[key]
        color = hexes[1] if kind == 'tile' and hexes[1] else hexes[0]
        side = size[0] or 1
        pal.append([fid, name, key, color, side, kind, asset, cost])
        used.update(c[0] for c in cost)
    pal.sort(key=lambda p: (p[5], p[4], list(COLOR).index(p[2])))
    mat_rows = {str(k): [mats[str(k)][0], mats[str(k)][1]] for k in sorted(used) if str(k) in mats}

    chars = tc_json(f'{TC}/gameCharacters.json')
    profs = {p['characterId']: p for p in tc_json(f'{TC}/characterProfiles.json')}
    out_chars = []
    for c in chars:
        cid = c['id']
        if cid > 26:
            break
        bd = (profs.get(cid) or {}).get('birthday') or ''
        m = re.search(r'(\d+)月(\d+)日', bd)
        nm = ((c.get('firstName') or '') + (c.get('givenName') or '')).strip()
        out_chars.append([cid, nm, UNIT_OF.get(c.get('unit'), ''), CHARA_COLOR.get(cid, '#888888'), int(m.group(1)) if m else 0, int(m.group(2)) if m else 0])

    dump = lambda o: json.dumps(o, ensure_ascii=False, separators=(',', ':'))
    text = ('/* 由 tools/build-mysekai-studio.py 產生,勿手改。豆森工作室（mystudio.html）用。\n'
            '   PALETTE 欄位:[家具id, 名稱, 色鍵, 色碼, 邊長, 種類(block|tile), 素材名, 製作素材[[素材id,數量]]]；'
            'CHARS 欄位:[id, 名稱, 團體, 代表色, 生日月, 生日日] */\n'
            'export const PALETTE=' + dump(pal) + ';\n'
            'export const MATS=' + dump(mat_rows) + ';\n'
            'export const CHARS=' + dump(out_chars) + ';\n')
    if OUT.exists() and OUT.read_text(encoding='utf-8') == text:
        print(f'{OUT.name}：內容沒變，不寫檔（{len(pal)} 色塊、{len(out_chars)} 位角色）')
        return
    OUT.write_text(text, encoding='utf-8')
    print(f'寫入 {OUT.name}：{len(pal)} 色塊、{len(mat_rows)} 種素材、{len(out_chars)} 位角色，{len(text.encode()) // 1024} KB')


if __name__ == '__main__':
    main()
