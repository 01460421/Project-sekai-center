#!/usr/bin/env python3
"""產生 tools/i18n/names.json：遊戲內容名稱的「台服名 → 日服原名」對照，給英文與日文介面用。

台服的卡名、活動名、家具名是台服 master 的中文翻譯，英日介面的人手寫翻譯不可能一條條跟上
（新卡、新家具每週都有）。兩服的 id 是同一套，所以用 id 把台服名對到日服原名：
英文介面也用日服原名（站上其他地方的慣例，例如 WL3 計算器；英語玩家也多半認得日服名）。

來源（都是每日排程建好的資料檔）：
  卡片     data/cards-index.js ／ data/cards-index-jp.js（卡名）
  技能名   data/cards-extra.js ／ data/cards-extra-jp.js（卡片技能庫與卡片頁的技能名稱）
  活動     data/event-info.js ／ data/event-info-jp.js
  家具     data/fixtures-index.js ／ data/fixtures-index-jp.js（家具名、大類、小類）

tools/build-i18n.py 會把這份併進兩個語言檔，但人手寫的翻譯優先：同一個鍵兩邊都有時用 en.json／ja.json 的。
單一個字的名稱不收（「床」「花」這種很容易撞到介面上的其他字）。

用法：python3 tools/build-i18n-names.py   之後再跑 python3 tools/build-i18n.py
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
OUT = ROOT / 'tools' / 'i18n' / 'names.json'
HAN = re.compile(r'[㐀-鿿]')
CARD = re.compile(r'\[(\d+),\d+,\d+,\d+,\d+,-?\d+,\d+,"((?:[^"\\]|\\.)*)","[^"]*"')


def const(name, var):
    s = (DATA / name).read_text(encoding='utf-8')
    m = re.search(r'export const ' + var + r'\s*=', s)
    if not m:
        raise SystemExit(f'{name} 找不到 {var}')
    dec = json.JSONDecoder()
    return dec.raw_decode(s[m.end():].lstrip())[0]


def main():
    pairs = {}

    def add(tw, jp, kind):
        tw, jp = (tw or '').strip(), (jp or '').strip()
        if len(tw) < 2 or not jp or tw == jp or not HAN.search(tw):
            return
        if tw in pairs and pairs[tw][0] != jp:
            pairs[tw] = (None, kind)          # 同一個台服名對到兩個日服名：不知道該用哪個，不收
            return
        pairs.setdefault(tw, (jp, kind))

    tw = {int(i): json.loads('"' + n + '"') for i, n in CARD.findall((DATA / 'cards-index.js').read_text(encoding='utf-8'))}
    jp = {int(i): json.loads('"' + n + '"') for i, n in CARD.findall((DATA / 'cards-index-jp.js').read_text(encoding='utf-8'))}
    for i, n in tw.items():
        add(n, jp.get(i), 'card')
    ex_tw = const('cards-extra.js', 'CARD_EXTRA')
    ex_jp = const('cards-extra-jp.js', 'CARD_EXTRA')
    for i, r in ex_tw.items():
        j = ex_jp.get(i)
        if len(r) > 9 and j and len(j) > 9:
            add(r[9], j[9], 'skill')
    n_card = len(pairs)

    ev_tw = {e[0]: e[1] for e in const('event-info.js', 'EVENT_INFO')['ev']}
    ev_jp = {e[0]: e[1] for e in const('event-info-jp.js', 'EVENT_INFO')['ev']}
    for i, n in ev_tw.items():
        add(n, ev_jp.get(i), 'event')
    n_ev = len(pairs) - n_card

    for var in ('FIX_GENRES', 'FIX_SUBS'):
        a = {r[0]: r[1] for r in const('fixtures-index.js', var)}
        b = {r[0]: r[1] for r in const('fixtures-index-jp.js', var)}
        for i, n in a.items():
            add(n, b.get(i), 'fixture-cat')
    fa = {r[0]: r[1] for r in const('fixtures-index.js', 'FIXTURES')}
    fb = {r[0]: r[1] for r in const('fixtures-index-jp.js', 'FIXTURES')}
    for i, n in fa.items():
        add(n, fb.get(i), 'fixture')
    n_fx = len(pairs) - n_card - n_ev

    out = {k: v[0] for k, v in sorted(pairs.items()) if v[0]}
    if len(out) < 1000:
        raise SystemExit(f'只對到 {len(out)} 條，資料不對，不覆寫')
    text = json.dumps(out, ensure_ascii=False, indent=0)
    if OUT.exists() and OUT.read_text(encoding='utf-8') == text:
        print('names.json 沒有變化')
        return 0
    OUT.write_text(text, encoding='utf-8')
    print(f'寫出 {OUT.name}：{len(out)} 條（卡名與技能名 {n_card}、活動 {n_ev}、家具與分類 {n_fx}，略過對到兩個日服名的 {len(pairs) - len(out)} 條）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
