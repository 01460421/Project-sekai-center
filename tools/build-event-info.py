#!/usr/bin/env python3
"""活動資料頁（app.html?page=evinfo）與活動甘特圖用的活動詮釋資料。

台服 master（tools/tc_source.py：Haruki 為主、Sekai-World 後備）的 events（含排名獎勵區間）、eventCards、
eventDeckBonuses（加成屬性與角色）、worldBlooms（WL 章節）、cheerfulCarnivalTeams／Summaries（嘉年華隊伍與中場發表）、
eventExchangeSummaries（活動商店換到的卡＝活動獲取）、resourceBoxDetails（26 MB，排名獎勵箱的內容）、honors／honorGroups
（稱號名）、materials、cards。瀏覽器不可能抓 26 MB 的 resourceBoxDetails，所以在這裡把每期的排名獎勵攤平成
「名次區間 → 道具清單」，稱號名與素材名一起帶著；內容沒變就不寫檔。輸出 data/event-info.js：

  EVENT_INFO = { ev: [...每期一筆...], rw: { 獎勵表鍵: [[起名次, 迄名次, [道具索引…]]…] }, it: [[種類, id, 數量]…],
                 hn: { 稱號 id: [名稱, 稱號組 id, 名次圖 abn, 稀有度 l/m/h/x] }, hg: { 稱號組 id: [組名, 底圖 abn] }, mn: { 素材 id: 名稱 },
                 tk: { 技能練習券 id: 名稱 }, pf: { 頭像框 id: [邊框組名, 角色 id] } }
  道具的名稱與圖都從 master 來：稱號底圖 honor/{底圖 abn}/degree_main、名次圖 honor/{名次圖 abn}/rank_main，
  技能練習券 thumbnail/skill_practice_ticket/ticket{id}，素材 thumbnail/material/material{id}，水晶／金幣 thumbnail/common_material。
  每期：[id, 名稱, 類型(marathon|cheerful_carnival|world_bloom), 團體, 素材名, 開始, 結算, 排名公布, 發放, 結束, 商店截止,
        加成屬性, [[角色 id, 團體]…（加成角色）], [[卡 id, 角色, 星級, 屬性索引, 素材名, 卡名, 加成%, 隊長加成%, 來源(0 抽卡／1 活動商店)]…],
        獎勵表鍵, [[章節, 角色 id, 開始, 結算, 結束]…（WL）], [[隊伍 id, 隊伍名]…]（嘉年華）, 中場發表 1, 中場發表 2, 嘉年華主題, 虛擬 Live id]
  MASTER_SRV=jp 時改吃日服 master、輸出 data/event-info-jp.js（形狀相同）。日服 master 沒有 resourceBoxDetails.json，
  同樣的明細掛在 resourceBoxes.json（35 MB）每個箱子的 details 底下，這裡攤平成同一種列。

    python3 tools/build-event-info.py
    MASTER_SRV=jp python3 tools/build-event-info.py    # 日服版
    python3 tools/stamp-assets.py
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from tc_source import SRV, TC, srv_out, tc_json

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / srv_out('event-info.js')
ATTRS = ['cool', 'happy', 'mysterious', 'cute', 'pure']   # 與 cards-index.js 相同順序
RAR = {'rarity_1': 1, 'rarity_2': 2, 'rarity_3': 3, 'rarity_4': 4, 'rarity_birthday': 9}
UNIT_KEY = {'light_sound': 'ln', 'idol': 'mmj', 'street': 'vbs', 'theme_park': 'wxs', 'school_refusal': 'n25', 'piapro': 'vs', 'none': ''}


def load(name):
    try:
        return tc_json(f'{TC}/{name}.json')
    except Exception as e:   # 單一張表抓不到就當空表，不要整支掛掉
        print(f'{name}.json 抓不到：{e}', file=sys.stderr)
        return []


def main():
    events = load('events')
    if not events:
        print('events.json 沒有資料，不更新', file=sys.stderr)
        return 1
    ev_cards = load('eventCards')
    deck_bonus = load('eventDeckBonuses')
    blooms = load('worldBlooms')
    cc_teams = load('cheerfulCarnivalTeams')
    cc_sum = load('cheerfulCarnivalSummaries')
    exchanges = load('eventExchangeSummaries')
    if SRV == 'jp':   # 日服 master 只有 resourceBoxes（箱子底下帶 details），攤平成跟 resourceBoxDetails 一樣的列
        details = [d for b in load('resourceBoxes') for d in (b.get('details') or [])]
    else:
        details = load('resourceBoxDetails')
    honors = load('honors')
    honor_groups = load('honorGroups')
    materials = load('materials')
    tickets = load('skillPracticeTickets')
    frames = load('playerFrames')
    frame_groups = load('playerFrameGroups')
    cards = load('cards')
    gcu = load('gameCharacterUnits')

    c_by = {c['id']: c for c in cards}
    gcu_by = {g['id']: g for g in gcu}
    mat_name = {m['id']: m.get('name', '') for m in materials}
    hg_by = {g['id']: g for g in honor_groups}
    honor_by = {h['id']: h for h in honors}
    ticket_name = {t['id']: t.get('name', '') for t in tickets}
    fg_name = {g['id']: g.get('name', '') for g in frame_groups}
    frame_by = {f['id']: f for f in frames}

    # 排名獎勵箱：resourceBoxDetails 只留 event_ranking_reward 的箱子（6 千多箱、1.9 萬列）
    box = {}
    for d in details:
        if d.get('resourceBoxPurpose') != 'event_ranking_reward':
            continue
        box.setdefault(d['resourceBoxId'], []).append((d.get('resourceType') or '', d.get('resourceId') or 0, d.get('resourceQuantity') or 0))
    # 活動商店（event_exchange）裡換到的卡 → 活動獲取
    ex_cards = {}
    ex_box = {}
    for d in details:
        if d.get('resourceBoxPurpose') == 'event_exchange' and d.get('resourceType') == 'card':
            ex_box.setdefault(d['resourceBoxId'], []).append(d.get('resourceId'))
    for s in exchanges:
        ids = set()
        for x in s.get('eventExchanges', []):
            ids.update(ex_box.get(x.get('resourceBoxId'), []))
        ex_cards[s['eventId']] = ids

    items, item_idx = [], {}
    def item(t, i, q):
        k = (t, i, q)
        if k not in item_idx:
            item_idx[k] = len(items)
            items.append([t, i, q])
        return item_idx[k]

    rewards, reward_key = {}, {}
    used_honors, used_mats, used_tickets, used_frames = set(), set(), set(), set()
    def reward_table(e):
        tiers = []
        for t in sorted(e.get('eventRankingRewardRanges', []), key=lambda t: t.get('fromRank', 0)):
            lst = []
            for r in t.get('eventRankingRewards', []):
                for ty, i, q in box.get(r.get('resourceBoxId'), []):
                    lst.append(item(ty, i, q))
                    if ty == 'honor':
                        used_honors.add(i)
                    elif ty == 'material':
                        used_mats.add(i)
                    elif ty == 'skill_practice_ticket':
                        used_tickets.add(i)
                    elif ty == 'player_frame':
                        used_frames.add(i)
            tiers.append([t.get('fromRank', 0), t.get('toRank', 0), lst])
        if not tiers:
            return ''
        sig = json.dumps(tiers, separators=(',', ':'))
        if sig not in reward_key:
            reward_key[sig] = 'r' + str(len(rewards))
            rewards[reward_key[sig]] = tiers
        return reward_key[sig]

    cards_of = {}
    for c in ev_cards:
        cards_of.setdefault(c['eventId'], []).append(c)
    bonus_of = {}
    for b in deck_bonus:
        bonus_of.setdefault(b['eventId'], []).append(b)
    wl_of = {}
    for w in blooms:
        wl_of.setdefault(w['eventId'], []).append(w)
    teams_of = {}
    for t in cc_teams:
        teams_of.setdefault(t['eventId'], []).append(t)
    ccs_of = {s['eventId']: s for s in cc_sum}

    rows = []
    for e in sorted(events, key=lambda x: x['id']):
        eid = e['id']
        bl = bonus_of.get(eid, [])
        attr = ''
        chars = []
        seen = set()
        for b in bl:
            if b.get('cardAttr') and not attr:
                attr = b['cardAttr']
            u = b.get('gameCharacterUnitId')
            if u and not b.get('cardAttr') and u not in seen:
                seen.add(u)
                g = gcu_by.get(u) or {}
                chars.append([g.get('gameCharacterId') or u, UNIT_KEY.get(g.get('unit') or '', '')])
        card_rows = []
        for c in sorted(cards_of.get(eid, []), key=lambda x: x['cardId']):
            cd = c_by.get(c['cardId']) or {}
            card_rows.append([c['cardId'], cd.get('characterId') or 0, RAR.get(cd.get('cardRarityType'), 0),
                              ATTRS.index(cd['attr']) if cd.get('attr') in ATTRS else -1, cd.get('assetbundleName') or '', cd.get('prefix') or '',
                              c.get('bonusRate') or 0, c.get('leaderBonusRate') or 0, 1 if c['cardId'] in ex_cards.get(eid, set()) else 0])
        wl = [[w.get('chapterNo') or 0, w.get('gameCharacterId') or 0, w.get('chapterStartAt') or 0, w.get('aggregateAt') or 0, w.get('chapterEndAt') or 0]
              for w in sorted(wl_of.get(eid, []), key=lambda w: w.get('chapterNo') or 0) if not w.get('isSupplemental')]
        teams = [[t['id'], t.get('teamName') or ''] for t in sorted(teams_of.get(eid, []), key=lambda t: t.get('seq') or 0)]
        cs = ccs_of.get(eid) or {}
        rows.append([eid, e.get('name') or '', e.get('eventType') or '', UNIT_KEY.get(e.get('unit') or 'none', ''), e.get('assetbundleName') or '',
                     e.get('startAt') or 0, e.get('aggregateAt') or 0, e.get('rankingAnnounceAt') or 0, e.get('distributionStartAt') or 0,
                     e.get('closedAt') or 0, e.get('distributionEndAt') or 0, attr, chars, card_rows, reward_table(e), wl, teams,
                     cs.get('midtermAnnounce1At') or 0, cs.get('midtermAnnounce2At') or 0, cs.get('theme') or '', e.get('virtualLiveId') or 0])

    hn, hg = {}, {}
    RAR_CODE = {'low': 'l', 'middle': 'm', 'high': 'h', 'highest': 'x'}
    for hid in sorted(used_honors):
        h = honor_by.get(hid)
        if h:
            gid = h.get('groupId') or 0
            g = hg_by.get(gid) or {}
            hg[gid] = [g.get('name') or '', g.get('backgroundAssetbundleName') or h.get('assetbundleName') or '']
            hn[hid] = [h.get('name') or '', gid, h.get('assetbundleName') or '', RAR_CODE.get(h.get('honorRarity') or '', '')]
    mn = {mid: mat_name.get(mid, '') for mid in sorted(used_mats)}
    tk = {tid: ticket_name.get(tid, '') for tid in sorted(used_tickets)}
    pf = {}
    for fid in sorted(used_frames):
        f = frame_by.get(fid)
        if f:
            pf[fid] = [fg_name.get(f.get('playerFrameGroupId'), ''), f.get('gameCharacterId') or 0]
    out = {'ev': rows, 'rw': rewards, 'it': items, 'hn': hn, 'hg': hg, 'mn': mn, 'tk': tk, 'pf': pf}
    body = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    text = ('/* 由 tools/build-event-info.py 產生,勿手改。' + ('日服 master（MASTER_SRV=jp）。' if SRV == 'jp' else '') + '活動資料頁與活動甘特圖用：每期活動的時程、加成屬性與角色、活動卡（來源 0 抽卡／1 活動商店）、\n'
            '   排名獎勵（rw 表鍵 → [起名次, 迄名次, [it 索引…]]，it 為 [種類, id, 數量]，hn 稱號 id → [名稱, 稱號組 id, 名次圖 abn, 稀有度], hg 稱號組 → [組名, 底圖 abn],\n'
            '   mn 素材 id → 名稱, tk 技能練習券 id → 名稱, pf 頭像框 id → [邊框組名, 角色 id]）、WL 章節、嘉年華隊伍。 */\n'
            f'export const EVENT_INFO={body};\n')
    if OUT.exists() and OUT.read_text(encoding='utf-8') == text:
        print(f'內容無變化,不更新 {OUT.name}（{len(rows)} 期）')
        return 0
    OUT.write_text(text, encoding='utf-8')
    print(f'寫入 {OUT.name}:{OUT.stat().st_size // 1024} KB（{len(rows)} 期活動,{len(rewards)} 套排名獎勵,{len(items)} 種道具,{len(hn)} 個稱號,{len(tk)} 種券,{len(pf)} 個頭像框）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
