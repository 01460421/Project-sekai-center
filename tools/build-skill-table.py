#!/usr/bin/env python3
"""理論技能倍率表：各團×各色的「同團同色」最佳五人隊的推隊倍率，台服當前與日服最新進度各算一份。

資料源:
  - 台服 master(Haruki 為主、Sekai-World 後備):cards.json、skills.json、gameCharacterUnits.json
  - 日服 master(Sekai-World):cards.json(34 MB,只在建置時抓)、skills.json
只算 releaseAt 已到的卡(台服＝「當前」,日服＝「最新進度」);日服那份另外標出台服還沒有的卡。

技能值(理論:SL4、角色等級 100、特訓後技能)照 index.html 的 SkillEngine.effSkillTeam 同一套規則:
  basic(score_up 類最大值) ＋ 角色等級型(score_up_character_rank,取 ≤100 的最大) ＋
  團分(skillEnhance:除自己外每位同團成員 +e,全員同團再 +e) ＋ 絢爛吸技(other_member…:
  取隊友技能值 ×rate,不超過 value2) ＋ 混團(score_up_unit_count:異團種類數達標才加)。
推隊倍率照計算中心的公式:(隊長 + 100 + 其餘四人合計 ÷ 5) ÷ 100。

三種編法都算:同團同色(主表)、同團不限色、同色不限團(全角色最佳卡做組合搜尋)。
輸出 data/skill-table.js(ES module,export const SKILL_TABLE)。內容沒變就不寫檔(builtAt 除外)。

    python3 tools/build-skill-table.py
    python3 tools/stamp-assets.py
"""
import itertools
import json
import pathlib
import re
import time
import urllib.request

from tc_source import TC, tc_json

JP = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-diff/main'
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'skill-table.js'
UNITS = ['light_sound', 'idol', 'street', 'theme_park', 'school_refusal', 'piapro']
ATTRS = ['cute', 'cool', 'pure', 'happy', 'mysterious']
RAR = {'rarity_1': 1, 'rarity_2': 2, 'rarity_3': 3, 'rarity_4': 4, 'rarity_birthday': 9}
SL, CHAR_RANK = 4, 100


def get_jp(name):
    req = urllib.request.Request(f'{JP}/{name}', headers={'user-agent': 'pjsk-center-build/1.0'})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read())


def load(server):
    if server == 'tw':
        cards, skills, gcu = tc_json(f'{TC}/cards.json'), tc_json(f'{TC}/skills.json'), tc_json(f'{TC}/gameCharacterUnits.json')
    else:
        cards, skills, gcu = get_jp('cards.json'), get_jp('skills.json'), get_jp('gameCharacterUnits.json')
    unit_of = {}
    for g in gcu:   # 角色的本團(VS 角色是 piapro;其餘每人一個團)
        unit_of.setdefault(g['gameCharacterId'], g['unit'])
    return cards, {s['id']: s for s in skills}, unit_of


def units_of(card, unit_of):
    """卡在隊伍裡算哪些團:VS 卡同時算 piapro 與支援團(與 SkillEngine._units 相同)。"""
    u = unit_of.get(card['characterId'], 'piapro')
    if card['characterId'] <= 20:
        return [u]
    out = ['piapro']
    if card.get('supportUnit') and card['supportUnit'] != 'none':
        out.append(card['supportUnit'])
    return out


def skill_parts(card, skills):
    """拆成與隊伍無關／有關的部分:basic+角色等級、團分(每位同團 +e、條件團)、吸技(rate,cap)、混團(異團數→加值)。"""
    sid = card.get('specialTrainingSkillId') or card['skillId']
    sk = skills.get(sid)
    if not sk:
        return None
    basic = cr = 0
    enh = None
    absorb = None
    unit_cnt = {}
    for e in sk.get('skillEffects', []):
        t = e['skillEffectType']
        dets = e.get('skillEffectDetails', [])
        det = next((x for x in dets if x.get('level') == SL), dets[-1] if dets else None)
        v = (det or {}).get('activateEffectValue', 0) or 0
        if t in ('score_up', 'score_up_condition_life', 'score_up_keep'):
            basic = max(basic, v)
            se = e.get('skillEnhance')
            if se and (se.get('skillEnhanceCondition') or {}).get('unit'):
                enh = (se.get('activateEffectValue') or 0, se['skillEnhanceCondition']['unit'])
        elif t == 'score_up_character_rank':
            if e.get('activateCharacterRank') is not None and e['activateCharacterRank'] <= CHAR_RANK:
                cr = max(cr, v)
        elif t == 'other_member_score_up_reference_rate':
            absorb = (v, (det or {}).get('activateEffectValue2', 0) or 0)
        elif t == 'score_up_unit_count':
            n = e.get('activateUnitCount') or 0
            unit_cnt[n] = max(unit_cnt.get(n, 0), v)
    return {'basic': basic + cr, 'enh': enh, 'absorb': absorb, 'unit_cnt': unit_cnt, 'sid': sid}


def team_values(team, unit_of):
    """隊伍裡每張卡的有效技能值(含團分、混團、吸技)。team = [(card, parts)]。"""
    units = [units_of(c, unit_of) for c, _ in team]
    base = []
    for i, (c, p) in enumerate(team):
        v = p['basic']
        if p['enh']:
            per, cond = p['enh']
            others = sum(1 for j, u in enumerate(units) if j != i and cond in u)
            all_same = len(team) == 5 and all(cond in u for u in units)
            v += per * others + (per if all_same else 0)
        if p['unit_cnt']:
            own = unit_of.get(c['characterId'], 'piapro') if c['characterId'] <= 20 else 'piapro'
            distinct = len({u for j, us in enumerate(units) for u in us if u != own})
            v += max([val for n, val in p['unit_cnt'].items() if n <= distinct] or [0])
        base.append(v)
    out = []
    for i, (c, p) in enumerate(team):
        v = base[i]
        if p['absorb']:
            rate, cap = p['absorb']
            best_other = max([base[j] for j in range(len(team)) if j != i] or [0])
            v += min(cap, round(best_other * rate / 100))
        out.append(v)
    return out


def mult_of(values):
    """推隊倍率:(隊長 + 100 + 其餘四人合計 ÷ 5) ÷ 100,隊長取最高。"""
    if not values:
        return 0
    vs = sorted(values, reverse=True)
    return round((vs[0] + 100 + sum(vs[1:]) / 5) / 100, 3)


def best_per_char(cands, unit_of, assume_unit):
    """每位角色留一張:以「全隊同團(assume_unit)」的假設先估值,挑最高的那張。"""
    best = {}
    for c, p in cands:
        v = p['basic']
        if p['enh'] and assume_unit and p['enh'][1] == assume_unit:
            v += p['enh'][0] * 5
        if p['absorb']:
            v += p['absorb'][1]
        k = c['characterId']
        if k not in best or v > best[k][2] or (v == best[k][2] and RAR.get(c['cardRarityType'], 0) > RAR.get(best[k][0]['cardRarityType'], 0)):
            best[k] = (c, p, v)
    return list(best.values())


def pack(team, values, unit_of, tw_ids):
    vs = sorted(zip(values, team), key=lambda x: -x[0])
    rows = []
    for v, (c, p) in vs:
        row = {'id': c['id'], 'ch': c['characterId'], 'n': c.get('prefix', ''), 'r': RAR.get(c['cardRarityType'], 0),
               'v': v, 'jkt': c['assetbundleName'], 'sk': p['sid']}
        if c['characterId'] > 20 and c.get('supportUnit') and c['supportUnit'] != 'none':
            row['su'] = c['supportUnit']
        if tw_ids is not None and c['id'] not in tw_ids:
            row['new'] = 1   # 台服還沒有這張
        rows.append(row)
    return rows


def solve_same_unit(cands, unit, unit_of, tw_ids):
    """同團(可限色):每人最佳卡 → 取最高五位,再用實際隊伍重算一次(吸技看隊友)。"""
    per = best_per_char(cands, unit_of, unit)
    per.sort(key=lambda x: -x[2])
    team = [(c, p) for c, p, _ in per[:5]]
    if not team:
        return None
    values = team_values(team, unit_of)
    return {'m': mult_of(values), 'deck': pack(team, values, unit_of, tw_ids), 'chars': len(per)}


def solve_same_attr(cands, unit_of, tw_ids):
    """同色不限團:每位角色最佳卡(團分卡的估值用「同團滿隊」會高估,所以留每人前兩張),
    取前 14 位做五人組合搜尋,每組用實際隊伍計值。"""
    pool = {}
    for c, p in cands:
        v = p['basic'] + (p['absorb'][1] if p['absorb'] else 0) + (p['enh'][0] * 5 if p['enh'] else 0) + (max(p['unit_cnt'].values()) if p['unit_cnt'] else 0)
        pool.setdefault(c['characterId'], []).append((v, c, p))
    picks = []
    for k, lst in pool.items():
        lst.sort(key=lambda x: -x[0])
        picks.extend(lst[:2])
    picks.sort(key=lambda x: -x[0])
    top = picks[:16]
    best = None
    for combo in itertools.combinations(range(len(top)), 5):
        chars = {top[i][1]['characterId'] for i in combo}
        if len(chars) < 5:
            continue
        team = [(top[i][1], top[i][2]) for i in combo]
        values = team_values(team, unit_of)
        m = mult_of(values)
        if best is None or m > best[0]:
            best = (m, team, values)
    if not best:
        return None
    return {'m': best[0], 'deck': pack(best[1], best[2], unit_of, tw_ids)}


def build(server, tw_ids):
    cards, skills, unit_of = load(server)
    now = time.time() * 1000
    live = []
    for c in cards:
        if (c.get('releaseAt') or 0) > now:
            continue
        p = skill_parts(c, skills)
        if p:
            live.append((c, p))
    out = {'cards': len(live), 'cells': {}, 'unit': {}, 'attr': {}}
    for u in UNITS:
        same_u = [(c, p) for c, p in live if u in units_of(c, unit_of)]
        out['unit'][u] = solve_same_unit(same_u, u, unit_of, tw_ids)
        for a in ATTRS:
            cell = solve_same_unit([(c, p) for c, p in same_u if c['attr'] == a], u, unit_of, tw_ids)
            if cell:
                cell['n4'] = sum(1 for c, _ in same_u if c['attr'] == a and c['cardRarityType'] == 'rarity_4')
            out['cells'][u + ':' + a] = cell
    for a in ATTRS:
        out['attr'][a] = solve_same_attr([(c, p) for c, p in live if c['attr'] == a], unit_of, tw_ids)
    return out, {c['id'] for c, _ in live}


def main():
    tw, tw_ids = build('tw', None)
    jp, _ = build('jp', tw_ids)
    data = {'units': UNITS, 'attrs': ATTRS, 'sl': SL, 'charRank': CHAR_RANK, 'tw': tw, 'jp': jp}
    if OUT.exists():
        m = re.search(r'SKILL_TABLE\s*=\s*(\{.*\});?\s*$', OUT.read_text(encoding='utf-8'), re.S)
        if m:
            try:
                old = json.loads(m.group(1))
                old.pop('builtAt', None)
                if old == data:
                    print(f'內容無變化,不更新 {OUT.name}')
                    return
            except Exception:
                pass
    data['builtAt'] = int(time.time() * 1000)
    body = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    OUT.write_text(f'/* 由 tools/build-skill-table.py 產生,勿手改。理論技能倍率表:SL{SL}、角色等級 {CHAR_RANK}、特訓後技能 */\nexport const SKILL_TABLE={body};\n', encoding='utf-8')
    print(f'寫入 {OUT.name}:{OUT.stat().st_size // 1024} KB(台服 {tw["cards"]} 張、日服 {jp["cards"]} 張)')
    for u in UNITS:
        print(u, ' '.join(f"{a[:4]}:{tw['cells'][u + ':' + a]['m'] if tw['cells'][u + ':' + a] else '-'}/{jp['cells'][u + ':' + a]['m'] if jp['cells'][u + ':' + a] else '-'}" for a in ATTRS))


if __name__ == '__main__':
    main()
