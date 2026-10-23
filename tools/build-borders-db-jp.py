#!/usr/bin/env python3
"""產生 data/borders-db-jp.js：日服版的榜線資料庫（形狀同 data/borders-db.js，網站切到日服時的榜線資料庫用）。

台服那份是 good果汁 的社群表（tools/build-goodjuice.py）；日服沒有這種表，改由三個公開來源拼起來：
  活動資訊   日服 master（tools/jp_master.py）：events、eventStories（banner 角）、gameCharacterUnits、
             eventDeckBonuses（加成屬性與角色）、worldBlooms（WL 章節）
  主榜終線   Sekai Viewer（api.sekai.best）：/event/{id}/rankings/time 列出快照時間，取最後一筆
             （必須在結算前 5 分鐘以後才算終線），再抓 /event/{id}/rankings?timestamp= 那一刻的前百＋各段位
  後備＋WL   Haruki 活動追蹤器（約第 202 期起才有）：主榜 leaderboards/total/overview，
             WL 各章 leaderboards/world-bloom/{角色 id}/overview（Sekai Viewer 沒有章節榜）
兩邊都有的期數以 Sekai Viewer 為主，缺的段位拿 Haruki 補，差太多的會印警告。

輸出 window.BORDERS_DB = { source, events, borders, tiers, wl, wlTiers, exchange, builtAt }，欄位同台服：
  events   {id, name, chara, unit, start, end, days, type, attr}（日期為日本時間；days＝結算−開始，取到 0.25 天）
  borders  {id, name, chara, unit, days, type, t:[各段位終線，沒有就 null]}，對齊 tiers
  wl       {id:'期.章', name:章節角色, chara:'', unit:章節角色的團, days, round:'WL1'…, bonus:null, t:[…]}，對齊 wlTiers
           屆數：依開跑順序走過每一期 WL，章節角色在這一屆出現過、或上一期是終章，就換下一屆
  exchange 台服專用的交換所規劃，日服給 {}
名稱沿用 master 的日文原名；角色簡稱、團體、屬性、型態的寫法跟台服那份一致（未來寫「未來」，團體內的虛擬歌手寫「25未來」）。

終線抓過就存在 tools/border_model/jp-finals.json（提交進版控），每天只補新結束的期數；
結算未滿 1 小時的不抓，查無資料或還不是終線的期數在結算後 14 天內每天重試，之後就不再抓
（JP_BORDERS_REFETCH=all 全部重抓；JP_BORDERS_REFETCH=199,202.1 只重抓指定的期數／章節，202.* 是該期所有章節）。
目前的缺口（2026-10）：Sekai Viewer 第 87～123 期沒有快照、#66 #67 #71 #74 #76 #86 #126 #199 沒有結算後的完整快照，
Haruki 第 202 期起才有，所以這些期數沒有主榜終線；WL 章節榜只有 Haruki 有，WL1／WL2（#112～#179）的章節終線因此從缺。
內容沒變（不計 builtAt）就不寫檔，CI 才不會產生空提交：

    python3 tools/build-borders-db-jp.py
    python3 tools/stamp-assets.py
"""
import datetime
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from jp_master import get_jp

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'borders-db-jp.js'
CACHE = ROOT / 'tools' / 'border_model' / 'jp-finals.json'
SV = 'https://api.sekai.best'
HARUKI = 'https://toolbox-api-direct.haruki.seiunx.com/event-tracker/api/v2/web/events/jp'
UA = 'pjsk-center-build/1.0 (borders-db-jp; +https://project-sekai-center.com)'
JST = datetime.timezone(datetime.timedelta(hours=9))
H = 3600
# 主榜：台服那份的段位＋日服另有的 1 萬～10 萬（20 萬／30 萬只有近期才有，不列）
TIERS = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000,
         10000, 20000, 30000, 40000, 50000, 100000]
# WL 章節榜：台服那份的段位＋日服章節榜另有的 1 萬～10 萬
WL_TIERS = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400, 500, 1000, 2000, 3000, 4000, 5000, 7000,
            10000, 20000, 30000, 40000, 50000, 70000, 100000]
KEEP = set(TIERS) | set(WL_TIERS) | {200000, 300000}    # 快取多存 20 萬／30 萬，之後要加段位不必重抓
FINAL_SLACK = 5 * 60          # 快照最晚要在結算前 5 分鐘以內才算終線
MIN_RANKS = 15                # 一筆快照至少要有這麼多個 KEEP 裡的名次才算完整（早期 Sekai Viewer 有 22 個，近期 30 個）
SETTLE = 1 * H                # 結算後 1 小時才去抓（給追蹤器時間存下結算後的快照）
RECHECK = 14 * 86400          # 結算 14 天內查無資料或不是終線的，每天重試
GAP = 1.0                     # 每個請求之間至少隔 1 秒
# 角色簡稱同 tools/build-gachas-jp.py，只有 21 照台服 borders-db 寫「未來」（WL 章節名、「25未來」這類 banner 都這樣寫）
CH_SHORT = {1: '一歌', 2: '咲希', 3: '穗波', 4: '志步', 5: '實乃理', 6: '遙', 7: '愛莉', 8: '雫', 9: '心羽', 10: '杏', 11: '彰人', 12: '冬彌',
            13: '司', 14: '笑夢', 15: '寧寧', 16: '類', 17: '奏', 18: '真冬', 19: '繪名', 20: '瑞希', 21: '未來', 22: '鈴', 23: '連', 24: '流歌',
            25: 'MEIKO', 26: 'KAITO'}
UNIT = {'light_sound': 'L/N', 'idol': 'MMJ', 'street': 'VBS', 'theme_park': 'WXS', 'school_refusal': '25', 'piapro': 'VS'}
ATTR = {'cute': '粉', 'cool': '藍', 'pure': '綠', 'happy': '橘', 'mysterious': '紫'}
TYPE = {'marathon': '馬拉松', 'cheerful_carnival': '歡樂嘉年華', 'world_bloom': 'World Link'}
_last = [0.0]


def load(name):
    d = os.environ.get('SCHED_JP_DIR')
    if d and (pathlib.Path(d) / f'jp_{name}.json').exists():
        return json.load(open(pathlib.Path(d) / f'jp_{name}.json', encoding='utf-8'))
    return get_jp(name + '.json')


def fetch(url):
    """GET JSON。404 回 None（這期沒資料）；其他錯誤退避重試 4 次，還是失敗就丟例外。"""
    err = None
    for i in range(4):
        wait = _last[0] + GAP - time.time()
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            req = urllib.request.Request(url, headers={'user-agent': UA, 'accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            err = e
        except Exception as e:      # 逾時、連線中斷、JSON 截斷
            err = e
        if i < 3:
            time.sleep(3 * 2 ** i)
    raise RuntimeError(f'{url}: {type(err).__name__}: {err}')


def iso_s(s):
    return int(datetime.datetime.fromisoformat(str(s).replace('Z', '+00:00')).timestamp())


def keep_ranks(pairs):
    """[(名次, 分數)…] → {'名次': 分數}，只留 KEEP 裡的名次，依名次排序。"""
    out = {}
    for rk, sc in pairs:
        try:
            rk, sc = int(rk), int(sc)
        except (TypeError, ValueError):
            continue
        if rk in KEEP and str(rk) not in out:
            out[str(rk)] = sc
    return {k: out[k] for k in sorted(out, key=int)}


def from_sv(eid, agg):
    """Sekai Viewer：最後一筆快照（要在結算前 5 分鐘以後）。回傳 (紀錄, 說明)；紀錄為 None 表示沒有可用的。
    結算後那筆偶爾是殘缺的（#199 只存到前 3 名），段位不到 MIN_RANKS 個就往前找，最多再看 3 筆；
    往前找到的若已經在結算前，就是「不是終線」。"""
    times = fetch(f'{SV}/event/{eid}/rankings/time?region=jp')
    times = sorted((times or {}).get('data') or [], key=iso_s)
    if not times:
        return None, 'Sekai Viewer 無快照'
    rec, sparse = None, ''
    for ts in times[::-1][:4]:
        d = fetch(f'{SV}/event/{eid}/rankings?region=jp&timestamp={urllib.parse.quote(ts, safe=":")}')
        t = keep_ranks((r.get('rank'), r.get('score')) for r in (((d or {}).get('data') or {}).get('eventRankings')) or [])
        if len(t) >= MIN_RANKS:
            rec = {'src': 'sv', 'at': iso_s(ts), 't': t}
            break
        sparse = sparse or f'（結算後的快照只有 {len(t)} 段）'
    if not rec:
        return None, 'Sekai Viewer 快照殘缺' + sparse
    if rec['at'] < agg - FINAL_SLACK:
        rec['partial'] = round((agg - rec['at']) / H, 2)
        return rec, f'Sekai Viewer 最後完整快照在結算前 {rec["partial"]} 小時{sparse}'
    return rec, ''


def from_haruki(path, agg):
    """Haruki 活動追蹤器的 overview（主榜或 WL 章節榜）。快照時間取各段位線時間戳與追蹤器最後一次更新中最早的那個
    （前百的時間戳是「分數最後一次變動」，不能拿來判斷追蹤器有沒有跑到結算）。"""
    d = fetch(f'{HARUKI}/{path}/overview?interval=3600')
    if not d:
        return None, 'Haruki 無資料'
    top = [((x.get('rankData') or {}).get('rank'), (x.get('rankData') or {}).get('score')) for x in d.get('topRankings') or []]
    bl = d.get('borderLines') or []
    t = keep_ranks(top + [(b.get('rank'), b.get('score')) for b in bl])
    if len(t) < MIN_RANKS:
        return None, f'Haruki 資料殘缺（{len(t)} 段）'
    stamps = [int(b['timestamp']) for b in bl if b.get('timestamp')]
    stamps.append(int(((d.get('status') or {}).get('timestamp')) or 0))
    at = min(x for x in stamps if x) if any(stamps) else 0
    rec = {'src': 'haruki', 'at': at, 't': t}
    if at < agg - FINAL_SLACK:
        rec['partial'] = round((agg - at) / H, 2)
        return rec, f'Haruki 最後快照在結算前 {rec["partial"]} 小時'
    return rec, ''


def merge(a, b, label):
    """以 a 為主、b 補缺的段位；兩邊都有的段位差超過 0.5% 印警告。"""
    if not a or a.get('partial'):
        return b if b and not b.get('partial') else (a or b)
    if not b or b.get('partial'):
        return a
    diff = [k for k in a['t'] if k in b['t'] and abs(a['t'][k] - b['t'][k]) > 0.005 * max(a['t'][k], 1)]
    if diff:
        print(f'  警告 {label}：Sekai Viewer 與 Haruki 有 {len(diff)} 段差超過 0.5%（' +
              '、'.join(f'T{k} {a["t"][k]}/{b["t"][k]}' for k in diff[:4]) + '）', file=sys.stderr)
    add = {k: v for k, v in b['t'].items() if k not in a['t']}
    if not add:
        return a
    t = dict(a['t'], **add)
    return dict(a, src=a['src'] + '+' + b['src'], t={k: t[k] for k in sorted(t, key=int)})


def load_cache():
    try:
        c = json.loads(CACHE.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        c = {}
    return {'events': c.get('events') or {}, 'wl': c.get('wl') or {}}


def dump_cache(c):
    """一期一行，diff 才看得懂。"""
    parts = []
    for sec in ('events', 'wl'):
        items = sorted(c[sec].items(), key=lambda kv: float(kv[0]))
        body = ',\n'.join(f'  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False, separators=(",", ":"))}' for k, v in items)
        parts.append(f'"{sec}": {{\n{body}\n}}' if items else f'"{sec}": {{}}')
    text = '{\n' + ',\n'.join(parts) + '\n}\n'
    if not CACHE.exists() or CACHE.read_text(encoding='utf-8') != text:
        CACHE.write_text(text, encoding='utf-8')


def need(key, entry, agg, now, refetch):
    """這期要不要（再）抓：沒抓過；指名重抓；或上次查無／不是終線，且結算未滿 14 天。"""
    if entry is None or 'all' in refetch or key in refetch or ('.' in key and key.split('.')[0] + '.*' in refetch):
        return True
    if 't' in entry and not entry.get('partial'):
        return False
    return now - agg < RECHECK


def miss(old, why, now):
    """查無資料的紀錄。原因沒變就沿用上次的檢查時間，免得 14 天的重試期間每天都改到快取檔、產生提交。"""
    if old and old.get('miss') == why:
        return old
    return {'miss': why, 'chk': now}


def id_ranges(ids):
    """[87, 88, 89, 91] → '#87–#89、#91'；WL 章節 ['112.1'…'112.4'] → '#112.1–4'。"""
    groups = []
    for x in ids:
        p, n = ('', x) if isinstance(x, int) else (x.split('.')[0] + '.', int(x.split('.')[1]))
        if groups and groups[-1][0] == p and groups[-1][2] == n - 1:
            groups[-1][2] = n
        else:
            groups.append([p, n, n])
    return '、'.join(f'#{p}{a}' if a == b else (f'#{p}{a}–{b}' if p else f'#{a}–#{b}') for p, a, b in groups)


def days_of(ms):
    v = round(ms / 86400000 * 4) / 4
    return int(v) if v == int(v) else v


def ymd(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, JST).strftime('%Y/%m/%d')


def main():
    now = int(os.environ.get('JP_BORDERS_NOW') or time.time())
    # 強制重抓：all＝全部；或用逗號列期數／章節，例如 199,202.1；202.* 是該期所有章節
    refetch = {x.strip() for x in (os.environ.get('JP_BORDERS_REFETCH') or '').split(',') if x.strip()}
    events = sorted(load('events'), key=lambda e: (e['startAt'], e['id']))
    stories = {s['eventId']: s for s in load('eventStories') or []}
    gcu = {int(g['id']): g for g in load('gameCharacterUnits') or []}
    blooms = load('worldBlooms') or []
    attr_of, bonus_units = {}, {}
    for b in load('eventDeckBonuses') or []:
        g = gcu.get(int(b.get('gameCharacterUnitId') or 0))
        if b.get('cardAttr') and not g:
            attr_of[b['eventId']] = b['cardAttr']
        if g:
            bonus_units.setdefault(b['eventId'], set()).add(('VS' if int(g['gameCharacterId']) >= 21 else UNIT.get(g.get('unit'), '')))
    chapters = {}
    for w in blooms:
        chapters.setdefault(w['eventId'], []).append(w)

    def unit_of(e):
        if e.get('unit') in UNIT and e['unit'] != 'piapro':
            return UNIT[e['unit']]
        if e['eventType'] == 'world_bloom' and all(c.get('worldBloomChapterType') == 'finale' for c in chapters.get(e['id']) or [{}]):
            return '終章'
        # 早期的團體活動 master 的 unit 也寫 none：看加成角色，除了虛擬歌手只有一團就是團體活動，全是虛擬歌手算 VS
        us = bonus_units.get(e['id']) or set()
        oc = us - {'VS'}
        return oc.pop() if len(oc) == 1 else ('VS' if us == {'VS'} else '/')

    def chara_of(e):
        if e['eventType'] == 'world_bloom':
            return 'World Link'
        g = gcu.get(int((stories.get(e['id']) or {}).get('bannerGameCharacterUnitId') or 0))
        if not g:
            return ''
        cid = int(g['gameCharacterId'])
        if cid >= 21 and g.get('unit') in UNIT and g['unit'] != 'piapro':
            return UNIT[g['unit']] + CH_SHORT[cid]     # 團體裡的虛擬歌手：25未來、VBS未來…
        return CH_SHORT.get(cid, '')

    # WL 屆數：依開跑順序，章節角色這一屆出現過、或上一期是終章，就換下一屆
    round_of, rnd, seen, after_finale = {}, 0, set(), False
    for e in events:
        if e['eventType'] != 'world_bloom':
            continue
        chs = {int(c['gameCharacterId']) for c in chapters.get(e['id']) or [] if c.get('gameCharacterId')}
        if chs and (rnd == 0 or after_finale or chs & seen):
            rnd, seen, after_finale = rnd + 1, set(), False
        seen |= chs
        if not chs:
            after_finale = True
        round_of[e['id']] = f'WL{max(rnd, 1)}'

    cache = load_cache()
    ended = [e for e in events if e['aggregateAt'] // 1000 + SETTLE <= now and not re.search(r'テスト|test', e.get('name') or '', re.I)]
    fetched, notes = 0, {}
    try:
        for e in ended:
            eid, agg = e['id'], e['aggregateAt'] // 1000
            key = str(eid)
            if need(key, cache['events'].get(key), agg, now, refetch):
                sv, why_sv = from_sv(eid, agg)
                sv_ok = sv and not sv.get('partial')
                try:
                    # Haruki 第 202 期起才有：Sekai Viewer 沒終線時當後備，有的話（近期）拿來對照、補段位
                    hk, why_hk = from_haruki(f'{eid}/leaderboards/total', agg) if (not sv_ok or eid >= 200) else (None, '')
                except Exception as ex:
                    if not sv_ok:
                        raise
                    hk, why_hk = None, ''
                    print(f'  #{eid} Haruki 對照失敗（{type(ex).__name__}），先只用 Sekai Viewer', file=sys.stderr)
                rec = merge(sv, hk, f'#{eid}')
                cache['events'][key] = rec or miss(cache['events'].get(key), '；'.join(x for x in (why_sv, why_hk) if x), now)
                fetched += 1
                if fetched % 20 == 0:
                    dump_cache(cache)      # 第一次建快取要抓幾百筆，中途斷掉也不必從頭來
                print(f'#{eid} {e["name"]}：' + (f'{rec["src"]} {len(rec["t"])} 段' + (f'（不是終線：{why_sv or why_hk}）' if rec.get('partial') else '')
                                                if rec else cache['events'][key]['miss']))
            for c in sorted(chapters.get(eid) or [], key=lambda c: c.get('chapterNo') or 0):
                if not c.get('gameCharacterId'):
                    continue
                ck, cagg = f'{eid}.{c["chapterNo"]}', int(c.get('aggregateAt') or c.get('chapterEndAt') or 0) // 1000
                if cagg + SETTLE > now or not need(ck, cache['wl'].get(ck), cagg, now, refetch):
                    continue
                rec, why = from_haruki(f'{eid}/leaderboards/world-bloom/{c["gameCharacterId"]}', cagg)
                cache['wl'][ck] = rec or miss(cache['wl'].get(ck), why, now)
                fetched += 1
                print(f'#{ck} {CH_SHORT.get(int(c["gameCharacterId"]))}：' + (f'{rec["src"]} {len(rec["t"])} 段' + (f'（不是終線：{why}）' if rec.get('partial') else '')
                                                                             if rec else why))
    except Exception as ex:
        # 來源掛了：已經抓到的照樣寫回快取，輸出用快取裡有的東西照常產生
        print(f'抓取中斷（{type(ex).__name__}: {ex}），先用已有的資料', file=sys.stderr)
    dump_cache(cache)

    ev_rows, bd_rows, wl_rows = [], [], []
    for e in sorted(ended, key=lambda e: e['id']):
        eid = e['id']
        row = {'id': eid, 'name': e['name'], 'chara': chara_of(e), 'unit': unit_of(e), 'start': ymd(e['startAt']), 'end': ymd(e['aggregateAt']),
               'days': days_of(e['aggregateAt'] - e['startAt']), 'type': TYPE.get(e['eventType'], e['eventType']),
               'attr': 'WL全屬性' if e['eventType'] == 'world_bloom' else ATTR.get(attr_of.get(eid), '')}
        ev_rows.append(row)
        rec = cache['events'].get(str(eid)) or {}
        if rec.get('t') and not rec.get('partial'):
            bd_rows.append({k: row[k] for k in ('id', 'name', 'chara', 'unit', 'days', 'type')} | {'t': [rec['t'].get(str(x)) for x in TIERS]})
        else:
            notes[eid] = rec.get('miss') or (f'不是終線（最後快照在結算前 {rec["partial"]} 小時）' if rec.get('partial') else '沒抓到')
        for c in sorted(chapters.get(eid) or [], key=lambda c: c.get('chapterNo') or 0):
            if not c.get('gameCharacterId'):
                continue
            ck = f'{eid}.{c["chapterNo"]}'
            cr = cache['wl'].get(ck) or {}
            if not (cr.get('t') and not cr.get('partial')):
                notes[ck] = cr.get('miss') or (f'不是終線（{cr["partial"]} 小時）' if cr.get('partial') else '沒抓到')
                continue
            cid = int(c['gameCharacterId'])
            g = gcu.get(cid) or {}
            wl_rows.append({'id': ck, 'name': CH_SHORT.get(cid, ''), 'chara': '', 'unit': 'VS' if cid >= 21 else UNIT.get(g.get('unit'), ''),
                            'days': days_of(int(c.get('aggregateAt') or c['chapterEndAt']) - int(c['chapterStartAt'])),
                            'round': round_of.get(eid, ''), 'bonus': None, 't': [cr['t'].get(str(x)) for x in WL_TIERS]})

    data = {'source': '日服：Sekai Viewer（api.sekai.best）活動排名快照、Haruki 活動追蹤器（WL 章節榜與近期活動）；活動資訊取自日服 master（Sekai-World）',
            'events': ev_rows, 'borders': bd_rows, 'tiers': TIERS, 'wl': wl_rows, 'wlTiers': WL_TIERS, 'exchange': {}}
    by_why = {}
    for k, v in notes.items():
        by_why.setdefault(re.sub(r'[\d.]+ 小時', 'N 小時', v), []).append(k)
    for why, ids in by_why.items():
        print(f'沒有終線 {len(ids)} 筆（{why}）：' + id_ranges(ids))
    print(f'活動 {len(ev_rows)} 期｜榜線 {len(bd_rows)} 期 × {len(TIERS)} 段｜WL {len(wl_rows)} 章 × {len(WL_TIERS)} 段｜本輪抓了 {fetched} 筆')

    old = None
    if OUT.exists():
        m = re.search(r'window\.BORDERS_DB\s*=\s*(\{.*\});?\s*$', OUT.read_text(encoding='utf-8'), re.S)
        try:
            old = json.loads(m.group(1)) if m else None
        except ValueError:
            old = None
    if old:
        old.pop('builtAt', None)
        if old == data:
            print('內容無變化，不更新')
            return 0
        # 快取裡的終線只有指名重抓才會被換掉；期數變少多半是快取檔壞了，別把現有的資料蓋掉
        if not refetch and (len(bd_rows) < len(old.get('borders') or []) or len(wl_rows) < len(old.get('wl') or [])):
            print(f'榜線期數比現有檔案少（{len(bd_rows)} < {len(old.get("borders") or [])} 或 WL {len(wl_rows)} < {len(old.get("wl") or [])}），不覆蓋', file=sys.stderr)
            return 1
    if len(bd_rows) < 100:
        print(f'資料量異常（榜線 {len(bd_rows)} 期），不寫檔', file=sys.stderr)
        return 1
    data['builtAt'] = int(time.time() * 1000)
    body = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    OUT.write_text('// 由 tools/build-borders-db-jp.py 產生,勿手改。\n'
                   '// 資料來源:Sekai Viewer 活動排名快照、Haruki 活動追蹤器(WL 章節榜與近期活動)、日服 master(活動資訊)\n'
                   f'window.BORDERS_DB={body};\n', encoding='utf-8')
    print(f'寫入 {OUT.name}：{OUT.stat().st_size // 1024} KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
