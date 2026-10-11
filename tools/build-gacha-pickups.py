#!/usr/bin/env python3
"""卡池詳情用的 PU 卡資料。

data/sekai-data.js 的 GACHAS（台服預測卡池列表）每一期用 id 對到 master 的 gacha（台服 master 有就用台服、
沒有就日服——未來卡池只有日服有），取 gachaPickups 的卡：卡名（台服有這張卡就用台服卡名）、角色、星級、屬性、
素材名、滿等技能摘要，台服還沒有的卡另外標。輸出 data/gacha-pickups.js，App 的卡池詳情直接用，
不必再像經典版那樣在瀏覽器抓 34 MB 的日服 cards.json。內容沒變就不寫檔。

    python3 tools/build-gacha-pickups.py
    python3 tools/stamp-assets.py
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from tc_source import TC, tc_json
from jp_master import get_jp

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'gacha-pickups.js'
ATTRS = ['cool', 'happy', 'mysterious', 'cute', 'pure']   # 與 cards-index.js 相同順序
RAR = {'rarity_1': 1, 'rarity_2': 2, 'rarity_3': 3, 'rarity_4': 4, 'rarity_birthday': 9}


def skill_summary(sk):
    """滿等技能摘要，照經典版 GachaDetail._skill：依 skillEffects 逐項標示（分數、持續、滿血、吸隊友、同團、角色等級、回血）。"""
    if not sk:
        return ''
    score = keep = cond = ref = unit = rank = life = 0
    for e in sk.get('skillEffects', []):
        t = str(e.get('skillEffectType') or '')
        dets = sorted(e.get('skillEffectDetails', []), key=lambda d: d.get('level') or 0)
        v = (dets[-1] if dets else {}).get('activateEffectValue') or 0
        if t == 'life_recovery':
            life = max(life, v)
        elif 'reference' in t:
            ref = max(ref, v)
        elif 'condition_life' in t:
            cond = max(cond, v)
        elif 'unit_count' in t:
            unit = max(unit, v)
        elif 'character_rank' in t:
            rank = max(rank, v)
        elif 'keep' in t:
            keep = max(keep, v)
        elif t.startswith('score_up'):
            score = max(score, v)
    parts = []
    if score: parts.append(f'分數+{score}%')
    if keep: parts.append(f'持續+{keep}%')
    if cond: parts.append(f'滿血+{cond}%')
    if ref: parts.append(f'吸隊友最高技能 {ref}%')
    if unit: parts.append(f'同團每人+{unit}%')
    if rank: parts.append(f'角色等級+{rank}%')
    if life: parts.append(f'回血{life}')
    return '・'.join(parts)


def main():
    src = (ROOT / 'data' / 'sekai-data.js').read_text(encoding='utf-8')
    m = re.search(r'export const GACHAS = (\[.*?\]);', src, re.S)
    gachas = json.loads(m.group(1))
    tw_g, tw_c, tw_s = tc_json(f'{TC}/gachas.json'), tc_json(f'{TC}/cards.json'), tc_json(f'{TC}/skills.json')
    jp_g, jp_c, jp_s = get_jp('gachas.json'), get_jp('cards.json'), get_jp('skills.json')
    g_by = {g['id']: g for g in jp_g}; g_by.update({g['id']: g for g in tw_g})
    c_tw = {c['id']: c for c in tw_c}; c_jp = {c['id']: c for c in jp_c}
    s_by = {s['id']: s for s in jp_s}; s_by.update({s['id']: s for s in tw_s})
    out = {}
    for g in gachas:
        gid = str(g.get('id', ''))
        if not gid.isdigit():
            continue
        mg = g_by.get(int(gid))
        if not mg:
            continue
        ids = [p['cardId'] for p in mg.get('gachaPickups', [])]
        if not ids:   # 沒標 pickup 的池（常駐、新手）：取 ★4／生日卡前 8 張
            ids = [d['cardId'] for d in mg.get('gachaDetails', [])
                   if (c_tw.get(d['cardId']) or c_jp.get(d['cardId']) or {}).get('cardRarityType') in ('rarity_4', 'rarity_birthday')][:8]
        cards = []
        for cid in ids:
            c = c_tw.get(cid) or c_jp.get(cid)
            if not c:
                continue
            sk = s_by.get(c.get('specialTrainingSkillId') or c.get('skillId'))
            row = [cid, c['characterId'], RAR.get(c['cardRarityType'], 0), ATTRS.index(c['attr']) if c.get('attr') in ATTRS else -1,
                   c['assetbundleName'], c.get('prefix', ''), skill_summary(sk)]
            if cid not in c_tw:
                row.append(1)   # 台服還沒有
            cards.append(row)
        out[gid] = {'n': mg.get('name', ''), 'cards': cards}
    body = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    text = ('/* 由 tools/build-gacha-pickups.py 產生,勿手改。卡池 id → PU 卡:[卡id, 角色, 星級(9=生日), 屬性索引, 素材名, 卡名, 技能摘要, 台服未實裝?] */\n'
            f'export const GACHA_PICKUPS={body};\n')
    if OUT.exists() and OUT.read_text(encoding='utf-8') == text:
        print(f'內容無變化,不更新 {OUT.name}（{len(out)} 期）')
        return 0
    OUT.write_text(text, encoding='utf-8')
    print(f'寫入 {OUT.name}:{OUT.stat().st_size // 1024} KB（{len(out)} 期卡池,{sum(len(v["cards"]) for v in out.values())} 張 PU 卡）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
