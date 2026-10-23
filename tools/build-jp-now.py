#!/usr/bin/env python3
"""產生 data/jp-now.js：網站切到「日服」時的現況快照（日服現況頁、首頁、站內客服用）。

日服 master 的 gachas.json 有 49 MB、cards.json 34 MB，不可能讓瀏覽器直接抓，所以每天在 CI 先算好一份小檔：
  JP_NOW = { built, ver, events, gachas, songs }
    ver     日服版本（versions.json：appVersion、dataVersion）
    events  每列 [id, 名稱, 類型, 團, 開始, 結算, 結束, 素材名, 加成屬性, [[角色, 團]…], [[卡 id, 角色, 稀有度, 屬性, 技能, 素材名]…], [[章, 角色, 開始, 結束]…]]
            最近結束的 4 期＋進行中＋master 裡已經排好的未來活動
    gachas  每列 [id, 名稱, 池型, 開始, 結束, 素材名, [[卡 id, 角色, 稀有度, 屬性, 技能, 素材名]…]]
            還沒結束（含 3 天內剛結束）且 60 天內會開的池；常駐池（開 400 天以上）與測試池不列
    songs   每列 [id, 歌名, 作詞, 作曲, 公開時間, 曲繪素材名]，依公開時間新到舊取 24 首（含已公布、還沒公開的）
時間一律是 epoch 毫秒。角色、屬性、技能的整理跟排程預測同一套（tools/card_facts.py）。

用法：
    python3 tools/build-jp-now.py          # 日服 master 用 jp_master 抓；離線測試可設 SCHED_JP_DIR 指向放 jp_*.json 的資料夾
    python3 tools/stamp-assets.py
"""
import json
import os
import pathlib
import re
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from jp_master import get_jp
from card_facts import card_facts, event_facts

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'jp-now.js'
D = 86400 * 1000
PERMANENT = 400 * D
EV_PAST = 4
SONGS = 24


def load(name):
    d = os.environ.get('SCHED_JP_DIR')
    if d and (pathlib.Path(d) / f'jp_{name}.json').exists():
        return json.load(open(pathlib.Path(d) / f'jp_{name}.json', encoding='utf-8'))
    return get_jp(name + '.json')


def main():
    now = int(os.environ.get('JP_NOW_AT') or time.time() * 1000)
    ver = load('versions')
    events = load('events')
    gachas = load('gachas')
    cards = load('cards')
    musics = load('musics')
    cf = card_facts(cards)
    facts = event_facts(events, load('eventDeckBonuses'), load('eventCards'), cf, load('gameCharacterUnits'))
    wl = {}
    for w in load('worldBlooms') or []:
        if w.get('gameCharacterId'):
            wl.setdefault(w['eventId'], []).append([int(w.get('chapterNo') or 0), int(w['gameCharacterId']),
                                                    int(w.get('chapterStartAt') or 0), int(w.get('chapterEndAt') or 0)])
    card6 = lambda cid: [cid] + [cf[cid][i] for i in (0, 1, 2, 3, 4)] if cid in cf else None

    evs = sorted(events, key=lambda e: e['startAt'])
    past = [e for e in evs if e.get('closedAt', e['aggregateAt']) < now][-EV_PAST:]
    rest = [e for e in evs if e.get('closedAt', e['aggregateAt']) >= now]
    ev_rows = []
    for e in past + rest:
        f = facts.get(e['id'], {'attr': '', 'chars': [], 'cards': []})
        ev_rows.append([e['id'], e['name'], e['eventType'], e.get('unit') or '', e['startAt'], e['aggregateAt'],
                        e.get('closedAt') or e['aggregateAt'], e['assetbundleName'], f['attr'], f['chars'],
                        [c[:6] for c in f['cards']][:10], sorted(wl.get(e['id'], []))])

    ga_rows = []
    for g in sorted(gachas, key=lambda g: (g['startAt'], g['id'])):
        if g['endAt'] < now - 3 * D or g['startAt'] > now + 60 * D:
            continue
        if g['endAt'] - g['startAt'] >= PERMANENT or re.search(r'テスト|test', g.get('name') or '', re.I):
            continue
        pu = [card6(p['cardId']) for p in (g.get('gachaPickups') or [])]
        pu = sorted([p for p in pu if p], key=lambda c: (-(4.5 if c[2] == 9 else c[2]), c[1]))
        ga_rows.append([g['id'], g['name'], g.get('gachaType') or '', g['startAt'], g['endAt'], g['assetbundleName'], pu[:12]])

    song_rows = [[m['id'], m['title'], m.get('lyricist') or '', m.get('composer') or '', m['publishedAt'], m['assetbundleName']]
                 for m in sorted(musics, key=lambda m: (m['publishedAt'], m['id']), reverse=True)[:SONGS]]

    out = {'built': now, 'ver': {'app': ver.get('appVersion') or '', 'data': ver.get('dataVersion') or '', 'asset': ver.get('assetVersion') or ''},
           'events': ev_rows, 'gachas': ga_rows, 'songs': song_rows}
    body = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    text = ('/* 由 tools/build-jp-now.py 產生,勿手改。網站切到日服時的現況：版本、近期與未來活動、開放中的卡池、新曲。 */\n'
            f'export const JP_NOW={body};\n')
    old = OUT.read_text(encoding='utf-8') if OUT.exists() else ''
    strip = lambda s: re.sub(r'"built":\d+', '"built":0', s)
    if strip(old) == strip(text):
        print(f'內容無變化,不更新 {OUT.name}')
        return 0
    OUT.write_text(text, encoding='utf-8')
    print(f'寫入 {OUT.name}:{OUT.stat().st_size // 1024} KB（日服 {out["ver"]["data"]}；活動 {len(ev_rows)} 期、卡池 {len(ga_rows)} 個、新曲 {len(song_rows)} 首）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
