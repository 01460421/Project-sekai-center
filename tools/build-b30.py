#!/usr/bin/env python3
"""從「プロセカAP難易度表」(EMERALD;v32 以前叫 PENTATONIC,v33 起作者改名並搬到新試算表。線上試算表＋repo 內釘選版 tools/src/pentatonic-pin.json 取較新者)產生 data/b30-consts.js(B30 產生器用定數表)。

資料源:
  - 難易度表試算表(公開 Google Sheet,xlsx 匯出):難易度表(MAS)/難易度表(APD) 兩分頁
    定數為 AP 難度基準(注意事項原文),曲名為日文原名
  - JP master musics.json:曲名 → musicId/封面 assetbundleName(台服曲名同日服)
  - TC master musics.json + musicDifficulties.json:過濾台服已實裝曲池、取遊戲內 Lv

輸出 window.B30_CONSTS = { builtAt, charts:[{id,d,lv,c,jkt,t}] }
  d = master|append,c = 定數(float),lv = 遊戲內表記 Lv

內容沒變就不寫檔(builtAt 除外),CI 才不會空提交。重跑:

    python3 tools/build-b30.py
    python3 tools/stamp-assets.py
"""
import json
import pathlib
import re
import sys
import time
import unicodedata
import urllib.request
import zipfile
import io

# v33 起的新試算表(EMERALD)。舊表 18HtlXNRxPrTMFMGfUnrLAiF3k1UjjkedSmlRX2GmLzU(PENTATONIC)停在 V32,不會再更新。
SHEET = 'https://docs.google.com/spreadsheets/d/1MU1FlzTZ8mX91kjyHBFTIIP7s3oFSRGpvgLjZLP1BUw/export?format=xlsx'
JP = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-diff/main'
from tc_source import TC, TC_SW, tc_json  # 台服 master：Haruki 為主，缺檔退回 Sekai-World
# 台服官方不翻譯曲名(master title=日文原名);中文譯名採 Sekai Viewer 社群翻譯(非官方)
I18N = 'https://raw.githubusercontent.com/Sekai-World/sekai-i18n/main'
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'b30-consts.js'
# 釘選版:作者釋出新版 xlsx 時線上試算表往往還停在舊版(V32 時線上仍是 V31),
# 把本機 xlsx 解析成小 JSON 釘在 repo 裡,線上版追上(含所有釘選曲目)前以釘選版為準。
# 更新方式:python3 tools/build-b30.py --pin '/path/to/スプシ用AP難易度表EMERALD v34.xlsx'
# (檔名沿用 pentatonic-pin.json,內容是 EMERALD 版;版號取檔名裡的 v 加數字)
PIN = ROOT / 'tools' / 'src' / 'pentatonic-pin.json'
# EXPERT(紅譜)定數:英語圈社群的「39s Chart Constants」試算表(JP 分頁),pjskb30、Unibot 系的 B30 都用這張。
# 本站的 EXPERT 定數規則仍是「遊戲等級 .0」(c 欄);這張表的值另外放在 x 欄,前端給使用者自選要不要採用。
X_SHEET = 'https://docs.google.com/spreadsheets/d/1B8tX9VL2PcSJKyuHFVd2UT_8kYlY4ZdwHwg9MfWOPug/export?format=csv&gid=1855810409'
X_SOURCE = '39s Chart Constants (JP)'


def get(url, binary=False):
    if not binary and url.startswith((TC, TC_SW)):
        return tc_json(url, 60)
    req = urllib.request.Request(url, headers={'user-agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    return data if binary else json.loads(data)


def norm(t):
    """曲名正規化:全半形/大小寫/空白/常見異體符號差異都吃掉。"""
    t = unicodedata.normalize('NFKC', str(t)).lower()
    t = re.sub(r'[\s　]+', '', t)
    for a, b in [('’', "'"), ('‘', "'"), ('”', '"'), ('“', '"'), ('〜', '~'), ('～', '~'),
                 ('！', '!'), ('？', '?'), ('（', '('), ('）', ')'), ('。', '.'), ('、', ','),
                 ('×', 'x'), ('☆', ''), ('★', ''), ('♪', ''), ('・', ''), ('･', ''),
                 ('=', ''), ('＝', ''), ('-', ''), ('－', ''), ('—', ''), ('ー', 'ー')]:
        t = t.replace(a, b)
    return t


def parse_sheet(xlsx_bytes):
    """回傳 {'master': [(title, const)], 'append': [...]}"""
    z = zipfile.ZipFile(io.BytesIO(xlsx_bytes))
    ss = []
    try:
        sx = z.read('xl/sharedStrings.xml').decode('utf-8')
        for m in re.finditer(r'<si>(.*?)</si>', sx, re.S):
            import html as _h
            ss.append(_h.unescape(re.sub(r'<[^>]+>', '', m.group(1))))
    except KeyError:
        pass
    wb = z.read('xl/workbook.xml').decode('utf-8')
    rels = z.read('xl/_rels/workbook.xml.rels').decode('utf-8')
    rid2file = dict(re.findall(r'Id="(rId\d+)" Type="[^"]*worksheet" Target="(worksheets/sheet\d+\.xml)"', rels))
    name2rid = dict(re.findall(r'<sheet [^>]*name="([^"]+)"[^>]*r:id="(rId\d+)"', wb))

    def rows_of(sheet_name):
        rid = name2rid.get(sheet_name)
        if not rid:
            return []
        xml = z.read('xl/' + rid2file[rid]).decode('utf-8')
        out = []
        for rm in re.finditer(r'<row[^>]*>(.*?)</row>', xml, re.S):
            cells = {}
            for cm in re.finditer(r'<c r="([A-Z]+)\d+"(?:[^>]* t="(\w+)")?[^>]*>(?:<f>.*?</f>)?(?:<v>([^<]*)</v>)?</c>', rm.group(1), re.S):
                col, t, v = cm.group(1), cm.group(2), cm.group(3)
                if v is None:
                    continue
                cells[col] = ss[int(v)] if t == 's' and v.isdigit() else v
            out.append(cells)
        return out

    res = {}
    for key, sheet_name in [('master', '難易度表(MAS)'), ('append', '難易度表(APD)')]:
        lst = []
        for r in rows_of(sheet_name):
            title = (r.get('C') or '').strip()
            raw = str(r.get('H') or '')
            # 定數欄是文字:可能帶「+」「++」(同 0.1 帶內的三階細分)與「(↑)」等註記
            m = re.match(r'^(\d+(?:\.\d+)?)\s*(\++)?', raw)
            if not title or not m or title == '曲名':
                continue
            # 數字曲名被 xlsx 存成浮點:「39」→39.0、「0.0000034」→3.4E-6,還原成原字串
            if re.match(r'^\d+\.0$', title):
                title = title[:-2]
            elif re.match(r'^[\d.]+E-?\d+$', title, re.I):
                from decimal import Decimal
                title = format(Decimal(title), 'f')
            lst.append((title, float(m.group(1)), len(m.group(2) or '')))
        res[key] = lst
        print(f'{sheet_name}:{len(lst)} 譜面')
    return res


def load_x_consts():
    """39s 表的 EXPERT 定數:回傳 {日服 musicId: 定數}。
    抓不到或格式變了就沿用上一版 data 檔裡的 x,連上一版都沒有才回空表(前端的開關會顯示沒資料)。"""
    try:
        import csv
        raw = get(X_SHEET, binary=True).decode('utf-8-sig')
        out = {}
        for r in csv.DictReader(io.StringIO(raw)):
            if (r.get('Difficulty') or '').strip() != 'Expert':
                continue
            try:
                out[int(float(r['Song ID']))] = round(float(r['Constant']), 1)
            except (KeyError, ValueError, TypeError):
                continue
        if len(out) < 300:
            raise ValueError(f'Expert 列只有 {len(out)} 筆,欄位可能變了')
        print(f'39s 定數表:EXPERT {len(out)} 筆')
        return out
    except Exception as ex:
        print(f'39s 定數表抓取失敗({ex}),沿用上一版的 x')
        old = {}
        if OUT.exists():
            m = re.search(r'window\.B30_CONSTS\s*=\s*(\{.*\});?\s*$', OUT.read_text(encoding='utf-8'), re.S)
            if m:
                try:
                    for c in json.loads(m.group(1)).get('charts', []):
                        if c.get('d') == 'expert' and c.get('x') is not None:
                            old[c['id']] = c['x']
                except Exception:
                    pass
        return old


def write_pin(xlsx_path):
    """把本機 xlsx 解析成釘選 JSON(版本號取檔名裡的 v 加數字,例如 v32)。"""
    xp = pathlib.Path(xlsx_path)
    m = re.search(r'[vV](\d+)', xp.stem)
    ver = int(m.group(1)) if m else 0
    sheet = parse_sheet(xp.read_bytes())
    PIN.parent.mkdir(parents=True, exist_ok=True)
    PIN.write_text(json.dumps({'version': ver, 'file': xp.name,
                               'master': sheet['master'], 'append': sheet['append']},
                              ensure_ascii=False, indent=0), encoding='utf-8')
    print(f'釘選 V{ver}:{xp.name} → {PIN.relative_to(ROOT)}(MAS {len(sheet["master"])}/APD {len(sheet["append"])})')


def load_pin():
    if not PIN.exists():
        return None
    try:
        d = json.loads(PIN.read_text(encoding='utf-8'))
        return {'version': int(d.get('version') or 0),
                'master': [tuple(x) for x in d.get('master', [])],
                'append': [tuple(x) for x in d.get('append', [])]}
    except Exception as ex:
        print(f'釘選檔讀取失敗({ex}),改用線上版')
        return None


def merge_pin(sheet, pin):
    """線上版已涵蓋釘選版全部曲目 → 線上版較新或相同,用線上版;
    否則線上版還是舊版 → 以線上版為底、釘選版覆蓋並補上新曲。回傳 (sheet, 來源標籤)。"""
    if not pin or not pin['version']:
        return sheet, 'EMERALD プロセカAP難易度表'
    ver = f"V{pin['version']}"
    online_has = {k: {norm(t) for t, _, _ in sheet.get(k, [])} for k in ('master', 'append')}
    covered = all({norm(t) for t, _, _ in pin[k]} <= online_has[k] for k in ('master', 'append'))
    if covered:
        print(f'線上版已含釘選 {ver} 全部曲目,採線上版')
        return sheet, f'EMERALD {ver}+ プロセカAP難易度表'
    merged = {}
    n_over = n_add = 0
    for k in ('master', 'append'):
        by = {norm(t): (t, c, p) for t, c, p in sheet.get(k, [])}
        for t, c, p in pin[k]:
            key = norm(t)
            if key in by:
                if by[key][1:] != (c, p):
                    n_over += 1
            else:
                n_add += 1
            by[key] = (t, c, p)
        merged[k] = list(by.values())
    print(f'線上版落後釘選 {ver}:覆蓋 {n_over} 筆定數、新增 {n_add} 譜面')
    return merged, f'EMERALD {ver} プロセカAP難易度表'


def main():
    sheet = parse_sheet(get(SHEET, binary=True))
    sheet, source = merge_pin(sheet, load_pin())
    jp_musics = get(f'{JP}/musics.json')
    jp_diffs = get(f'{JP}/musicDifficulties.json')
    tc_musics = get(f'{TC}/musics.json')
    tc_diffs = get(f'{TC}/musicDifficulties.json')
    # 中文譯名:繁中優先、簡中補缺(皆為社群翻譯);抓不到就全部保留日文
    zh = {}
    try:
        cn = get(f'{I18N}/zh-CN/music_titles.json')
        tw = get(f'{I18N}/zh-TW/music_titles.json')
        zh = {int(k): v for k, v in cn.items() if v}
        zh.update({int(k): v for k, v in tw.items() if v})
    except Exception as ex:
        print(f'譯名抓取失敗({ex}),曲名保留日文')

    # 同名曲要保留全部候選:「初音ミクの激唱」JP 有 id 131(MAS)與 388(APD)兩筆,
    # 只留第一筆會讓 APPEND 那張永遠對不到,譜面就此消失
    by_norm = {}
    for mu in jp_musics:
        by_norm.setdefault(norm(mu['title']), []).append(mu)
    # 台服先行實裝曲在台服 master 是另一組獨立 id(11xxx),與日服 id 對不起來,
    # 只靠 id 比對會把它誤判成「日服限定」,而且 est 路徑又會把台服那筆補進來 → 同譜面兩列。
    # 所以 fallback 前先用曲名查台服曲池。
    tc_by_norm = {}
    for mu in tc_musics:
        tc_by_norm.setdefault(norm(mu['title']), []).append(mu)
    tc_ids = {mu['id'] for mu in tc_musics}
    lv = {}
    for d in tc_diffs:
        lv[(d['musicId'], d['musicDifficulty'])] = d['playLevel']
    jp_lv = {}
    for d in jp_diffs:
        jp_lv[(d['musicId'], d['musicDifficulty'])] = d['playLevel']

    charts = []
    unmatched, jp_only = [], 0
    for dkey in ('master', 'append'):
        for title, const, plus in sheet[dkey]:
            cands = by_norm.get(norm(title))
            if not cands:
                unmatched.append(title)
                continue
            # 同名多筆時挑「台服真的有這個難度」的那一筆;台服沒有 → 收成日服限定(jp=1)
            mu = next((m for m in cands if m['id'] in tc_ids and (m['id'], dkey) in lv), None)
            jp_mark = 0
            if not mu:
                # 台服先行曲:id 對不到,但曲名在台服曲池且有這個難度 → 台服玩得到,用台服那筆
                mu = next((m for m in tc_by_norm.get(norm(title), []) if (m['id'], dkey) in lv), None)
            if not mu:
                mu = next((m for m in cands if (m['id'], dkey) in jp_lv), None)
                if not mu:
                    unmatched.append(title)
                    continue
                jp_mark = 1
                jp_only += 1
            row = {
                'id': mu['id'], 'd': dkey,
                'lv': lv[(mu['id'], dkey)] if not jp_mark else jp_lv[(mu['id'], dkey)],
                'c': const,
                'jkt': mu['assetbundleName'], 't': mu['title'],
            }
            if jp_mark:
                row['jp'] = 1   # 日服限定(台服未實裝):前端標示,可切換顯示
            if plus:
                row['p'] = plus   # 「+」數(1 或 2):三位小數模式換算 +p/30
            tr = zh.get(mu['id'])
            if tr and tr.strip() and tr.strip() != mu['title']:
                row['tc'] = tr.strip()   # 社群中文譯名(顯示用;搜尋中日皆可)
            charts.append(row)

    # EXPERT 高難度(Lv28~32):EMERALD 難易度表只收 MASTER/APPEND,沒有 EXPERT 定數。
    # 本站規則「定數用 .0」—— 直接拿遊戲內等級當定數(Lv29 → 29.0),不做任何推估,
    # 所以不標 e=1(那是「推估」的意思,這裡是明確規則)。
    # x 欄＝39s 表的 EXPERT 定數(有就放),前端開關決定 B30 用 c 還是 x。
    tc_by_id = {mu['id']: mu for mu in tc_musics}
    xmap = load_x_consts()
    EXP_MIN, EXP_MAX = 28, 32
    exp_n = exp_x = 0
    for d in tc_diffs:
        if d['musicDifficulty'] != 'expert':
            continue
        if not (EXP_MIN <= d['playLevel'] <= EXP_MAX):
            continue
        mu = tc_by_id.get(d['musicId'])
        if not mu:
            continue
        row = {
            'id': mu['id'], 'd': 'expert', 'lv': d['playLevel'],
            'c': float(d['playLevel']),           # 定數＝等級，整數 .0
            'jkt': mu['assetbundleName'], 't': mu['title'],
        }
        if mu['id'] in xmap:
            row['x'] = xmap[mu['id']]
            exp_x += 1
        tr = zh.get(mu['id'])
        if tr and tr.strip() and tr.strip() != mu['title']:
            row['tc'] = tr.strip()
        charts.append(row)
        exp_n += 1

    # 39s 表有、台服還沒實裝的 EXPERT(日服新 31 等):Lv28~32 也收進來,標 jp=1。
    # 台服先行曲在台服是另一組 id,先用曲名查台服曲池,查得到就不算日服限定。
    jp_by_id = {mu['id']: mu for mu in jp_musics}
    exp_jp = 0
    for mid, xv in xmap.items():
        mu = jp_by_id.get(mid)
        if not mu or mid in tc_ids or tc_by_norm.get(norm(mu['title'])):
            continue
        lvl = jp_lv.get((mid, 'expert'))
        if lvl is None or not (EXP_MIN <= lvl <= EXP_MAX):
            continue
        row = {
            'id': mu['id'], 'd': 'expert', 'lv': lvl, 'c': float(lvl),
            'jkt': mu['assetbundleName'], 't': mu['title'], 'jp': 1, 'x': xv,
        }
        tr = zh.get(mu['id'])
        if tr and tr.strip() and tr.strip() != mu['title']:
            row['tc'] = tr.strip()
        charts.append(row)
        exp_jp += 1
    print(f'EXPERT{EXP_MIN}-{EXP_MAX}:台服 {exp_n} 張(39s 有定數 {exp_x})、日服限定 {exp_jp} 張')

    # 台服有、但難易度表沒有的譜面(英服來源曲等:日服未實裝,EMERALD 表自然不會收)
    # → 用遊戲內等級 +0.5 當中位推估,標 e=1 讓前端顯示「推估」並可排除
    have = {(c['id'], c['d']) for c in charts}
    est = []
    for d in tc_diffs:
        key = (d['musicId'], d['musicDifficulty'])
        if d['musicDifficulty'] not in ('master', 'append') or key in have:
            continue
        mu = tc_by_id.get(d['musicId'])
        if not mu:
            continue
        row = {
            'id': mu['id'], 'd': d['musicDifficulty'], 'lv': d['playLevel'],
            'c': round(d['playLevel'] + 0.5, 1), 'jkt': mu['assetbundleName'],
            't': mu['title'], 'e': 1,
        }
        tr = zh.get(mu['id'])
        if tr and tr.strip() and tr.strip() != mu['title']:
            row['tc'] = tr.strip()
        charts.append(row)
        est.append(f"{mu['title']}({d['musicDifficulty'][:3].upper()} Lv{d['playLevel']})")

    PLUS_ADD = [0, 0.05, 0.09999999]
    charts.sort(key=lambda x: (-(x['c'] + PLUS_ADD[x.get('p', 0)]), x.get('e', 0)))
    print(f'共 {len(charts)} 譜面(含日服限定 {jp_only + exp_jp}、EXPERT{EXP_MIN}-{EXP_MAX} {exp_n + exp_jp})、曲名比對失敗 {len(unmatched)}')
    print(f'難易度表未收錄、以等級+0.5 推估: {len(est)} 譜面 {est}')
    if unmatched:
        print('比對失敗(前 15):', unmatched[:15])

    data = {'source': source, 'charts': charts}
    if xmap:
        data['xsource'] = X_SOURCE   # x 欄的出處(前端署名用)
    if OUT.exists():
        m = re.search(r'window\.B30_CONSTS\s*=\s*(\{.*\});?\s*$', OUT.read_text(), re.S)
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
    OUT.write_text(f'// 由 tools/build-b30.py 產生,勿手改。定數:{source}(AP 基準,非官方)\n'
                   f'window.B30_CONSTS={body};\n')
    print(f'寫入 {OUT.name}:{OUT.stat().st_size // 1024} KB')


if __name__ == '__main__':
    if len(sys.argv) >= 3 and sys.argv[1] == '--pin':
        write_pin(sys.argv[2])
    main()
