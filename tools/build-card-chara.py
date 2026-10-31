#!/usr/bin/env python3
"""產生 data/card-chara.js：cardId → characterId 的密集陣列（索引即 cardId，0＝無此卡）。

排名 API（HiSekai、Haruki）每位玩家只給代表卡的 id，靠這張表換成角色才畫得出 Q 版頭像。
台服與日服的卡號是同一套，日服卡最多，所以用日服 master 一次涵蓋兩服。

以前這個檔是手動產生的、停在 #1271，之後的新卡（活動卡最常被設成代表卡）全都沒有頭像；
現在由每日排程（billing-refresh.yml）重算，新卡進 master 隔天就有。

用法：python3 tools/build-card-chara.py      （日服 master 走 jp_master 快取）
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from jp_master import get_jp

OUT = pathlib.Path(__file__).resolve().parent.parent / 'data' / 'card-chara.js'
HEAD = ('// cardId → characterId 對照（由 cards.json 壓成密集陣列，索引即 cardId，0=無此卡）\n'
        '// 用途：排名列表只拿得到玩家的代表卡 id，靠這張表換成角色才能顯示 Q 版頭像。\n'
        '// 由 tools/build-card-chara.py 從日服 master 產生（台服卡號同一套），每日排程更新，勿手改。\n')


def main():
    cards = get_jp('cards.json')
    m = {c['id']: c['characterId'] for c in cards if c.get('id') and c.get('characterId')}
    if len(m) < 1000:
        raise SystemExit(f'日服 cards.json 只有 {len(m)} 張，資料不對，不覆寫')
    arr = [m.get(i, 0) for i in range(max(m) + 1)]
    text = HEAD + 'export const CARD_CHARA = [' + ','.join(map(str, arr)) + '];\n'
    old = OUT.read_text(encoding='utf-8') if OUT.exists() else ''
    if old == text:
        print(f'內容無變化，不更新 {OUT.name}')
        return 0
    OUT.write_text(text, encoding='utf-8')
    print(f'寫入 {OUT.name}：卡號到 #{max(m)}（{len(m)} 張），{OUT.stat().st_size // 1024} KB')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
