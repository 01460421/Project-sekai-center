"""卡片與活動的「角色、屬性、技能」整理（build-schedule-forecast.py、build-jp-now.py 共用）。

技能分類跟網站卡片技能庫（js/app.js 的 CL_CAT／CL_GROUP）同一套：
  score 分數提升、judge 判定強化、heal 體力回復、perfect P分、cfes_life 七彩血分、good 七彩 good 以上、
  birthday 生日、unit 團分、bfes_char 絢爛角色、bfes_ref 絢爛吸技、bfes_vs 絢爛虛擬。"""
import collections

SKILL_CAT = {1: 'score', 2: 'score', 3: 'score', 4: 'score', 5: 'judge', 6: 'judge', 7: 'judge', 8: 'heal', 9: 'heal', 10: 'heal',
             11: 'perfect', 12: 'cfes_life', 13: 'good', 14: 'birthday', 15: 'unit', 16: 'unit', 17: 'unit', 18: 'unit', 19: 'unit',
             22: 'bfes_char', 23: 'bfes_ref', 24: 'bfes_vs'}
ATTR5 = ['cool', 'happy', 'mysterious', 'cute', 'pure']
UNIT_MEMBERS = {'light_sound': [1, 2, 3, 4], 'idol': [5, 6, 7, 8], 'street': [9, 10, 11, 12],
                'theme_park': [13, 14, 15, 16], 'school_refusal': [17, 18, 19, 20]}
RARITY_CODE = {'rarity_1': 1, 'rarity_2': 2, 'rarity_3': 3, 'rarity_4': 4, 'rarity_birthday': 9}
EV_OWN_SUPPLY = (1, 3, 6)      # 活動自己的卡（一般／期間限定／團體限定）；同期 FES 卡（5）也在活動加成名單裡，但不算這期的卡


def card_facts(cards):
    """cards.json → {卡 id: [角色, 稀有度(1-4,9=生日), 屬性, 技能分類, 素材名, 取得類別]}"""
    out = {}
    for c in cards or []:
        try:
            out[int(c['id'])] = [int(c.get('characterId') or 0), RARITY_CODE.get(c.get('cardRarityType'), 0), c.get('attr') or '',
                                 SKILL_CAT.get(c.get('skillId'), ''), c.get('assetbundleName') or '', int(c.get('cardSupplyId') or 0)]
        except Exception:
            continue
    return out


def event_facts(jp_ev, edb, ec, cf, gcu):
    """每期活動：加成屬性、加成角色（[角色, 團]）、活動卡（[卡 id, 角色, 稀有度, 屬性, 技能, 素材名, 取得類別]，稀有度高的在前）"""
    unit_of = {int(g['id']): (int(g.get('gameCharacterId') or 0), g.get('unit') or '') for g in gcu or []}
    out = collections.defaultdict(lambda: {'attr': '', 'chars': set(), 'cards': []})
    for b in edb or []:
        f = out[b['eventId']]
        if b.get('cardAttr') and not b.get('gameCharacterUnitId'):
            f['attr'] = b['cardAttr']
        if b.get('gameCharacterUnitId') and int(b['gameCharacterUnitId']) in unit_of:
            f['chars'].add(unit_of[int(b['gameCharacterUnitId'])])
    for x in ec or []:
        c = cf.get(int(x['cardId']))
        if c:
            out[x['eventId']]['cards'].append([int(x['cardId'])] + c)
    res = {}
    for eid, f in out.items():
        res[eid] = {'attr': f['attr'], 'chars': sorted([c, u] for c, u in f['chars']),
                    'cards': sorted(f['cards'], key=lambda c: (-(4.5 if c[2] == 9 else c[2]), c[6] == 5, c[1]))}
    return res
