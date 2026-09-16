#!/usr/bin/env python3
"""從「プロセカ難易度表」(pentatonic) 產生 data/b30-consts.js(B30 產生器用定數表)。

資料源:
  - 難易度表試算表(公開 Google Sheet,xlsx 匯出):難易度表(MAS)/難易度表(APD) 兩分頁
    定數為 AP 難度基準(注意事項原文),曲名為日文原名
  - tools/b30-table.json:上面那張表的快照,同時當「不准倒退」的底線(見 resolve_sheet)
  - JP master musics.json:曲名 → musicId/封面 assetbundleName(台服曲名同日服)
  - TC master musics.json + musicDifficulties.json:過濾台服已實裝曲池、取遊戲內 Lv

輸出 window.B30_CONSTS = { builtAt, charts:[{id,d,lv,c,jkt,t}] }
  d = master|append,c = 定數(float),lv = 遊戲內表記 Lv

內容沒變就不寫檔(builtAt 除外),CI 才不會空提交。重跑:

    python3 tools/build-b30.py
    python3 tools/stamp-assets.py

拿到新版難易度表的 xlsx(製作者另開新檔、線上那份還沒跟上時)可以直接餵進來,
會順便更新 tools/b30-table.json 快照:

    python3 tools/build-b30.py --xlsx ~/Downloads/PENTATONIC_v32.xlsx --version v32
"""
import argparse
import json
import pathlib
import re
import time
import unicodedata
import urllib.request
import zipfile
import io

SHEET = 'https://docs.google.com/spreadsheets/d/18HtlXNRxPrTMFMGfUnrLAiF3k1UjjkedSmlRX2GmLzU/export?format=xlsx'
JP = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-diff/main'
TC = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-tc-diff/main'
# 台服官方不翻譯曲名(master title=日文原名);中文譯名採 Sekai Viewer 社群翻譯(非官方)
I18N = 'https://raw.githubusercontent.com/Sekai-World/sekai-i18n/main'
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'b30-consts.js'
SNAP = ROOT / 'tools' / 'b30-table.json'


def get(url, binary=False):
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


def load_snap():
    """讀快照。回傳 (version, {'master': [...], 'append': [...]}) 或 (None, None)。"""
    if not SNAP.is_file():
        return None, None
    try:
        d = json.loads(SNAP.read_text(encoding='utf-8'))
    except Exception as ex:
        print(f'快照讀取失敗({ex}),忽略')
        return None, None
    sheet = {k: [(t, float(c), int(pl)) for t, c, pl in d.get(k, [])] for k in ('master', 'append')}
    return d.get('version'), sheet


def save_snap(version, sheet):
    body = {'note': '難易度表(MAS/APD)的曲名+定數快照,由 tools/build-b30.py 維護,勿手改。'
                    'version=null 代表線上表已超前上次標記的版本、版號未知。',
            'version': version}
    # 一列一譜面:diff 看得出哪首改了定數,不會整個檔炸開
    out = [json.dumps(body, ensure_ascii=False)[:-1]]
    for k in ('master', 'append'):
        rows = ',\n  '.join(json.dumps([t, c, pl], ensure_ascii=False) for t, c, pl in sheet[k])
        out.append(f', "{k}": [\n  {rows}\n ]')
    SNAP.write_text(''.join(out) + '}\n', encoding='utf-8')


def resolve_sheet(args):
    """決定這次要用哪份難易度表,回傳 (version, sheet)。

    線上那份試算表是寫死的單一文件 id。製作者若是「另開一份新檔」發 v32,
    這個網址就會永遠停在舊版 —— 手動把新版的定數建進去,隔天 CI 一跑又被蓋回去。
    所以快照除了當離線備援,還當「不准倒退」的底線:

      - 線上表的曲目 ⊇ 快照的曲目 → 線上是同版或更新,採用線上(難易度表只會加曲不會砍曲)
      - 線上表少了快照才有的曲目   → 線上落後,沿用快照並警告
      - 線上抓不到                 → 沿用快照

    採用線上、而且內容跟快照不一樣時,快照會被更新,版號則清成 null:
    表裡沒有任何版本欄位,線上比 v32 新時我們無從得知它是 v33 還是 v34,
    與其標一個錯的版號,不如標「不知道」(輸出的署名會改成「線上最新版」)。
    """
    if args.xlsx:
        sheet = parse_sheet(pathlib.Path(args.xlsx).read_bytes())
        version = args.version or None
        save_snap(version, sheet)
        print(f'採用本機 xlsx({args.xlsx}),版號 {version or "未標記"},已更新 {SNAP.name}')
        return version, sheet

    snap_ver, snap = load_snap()
    try:
        live = parse_sheet(get(args.url, binary=True))
    except Exception as ex:
        if not snap:
            raise
        print(f'線上難易度表抓取失敗({ex}),沿用快照 {snap_ver or "未標記"}')
        return snap_ver, snap
    if not snap:
        return None, live

    titles = lambda sh: {(k, norm(t)) for k in ('master', 'append') for t, _c, _p in sh[k]}
    missing = titles(snap) - titles(live)
    if missing:
        sample = [t for _k, t in list(missing)[:6]]
        print(f'線上難易度表少了快照裡的 {len(missing)} 張譜({sample}…),判定為落後版本,'
              f'沿用快照 {snap_ver or "未標記"}')
        return snap_ver, snap
    if live != snap:
        version = snap_ver if titles(live) == titles(snap) else None
        save_snap(version, live)
        print(f'線上難易度表已更新,快照同步更新(版號 {version or "未知 → 標為線上最新版"})')
        return version, live
    return snap_ver, snap


def main():
    ap = argparse.ArgumentParser(description='產生 data/b30-consts.js')
    ap.add_argument('--xlsx', help='改用本機的難易度表 xlsx,並更新 tools/b30-table.json 快照')
    ap.add_argument('--version', help='搭配 --xlsx 標記版號,例:v32')
    ap.add_argument('--url', default=SHEET, help='線上難易度表的 xlsx 匯出網址')
    args = ap.parse_args()

    version, sheet = resolve_sheet(args)
    src = f'pentatonic {version} プロセカ難易度表' if version else 'pentatonic プロセカ難易度表(線上最新版)'
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

    # EXPERT 高難度(Lv28~32):pentatonic 的難易度表只收 MASTER/APPEND,沒有 EXPERT 定數。
    # 本站規則「定數用 .0」—— 直接拿遊戲內等級當定數(Lv29 → 29.0),不做任何推估,
    # 所以不標 e=1(那是「推估」的意思,這裡是明確規則)。
    tc_by_id = {mu['id']: mu for mu in tc_musics}
    EXP_MIN, EXP_MAX = 28, 32
    exp_n = 0
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
        tr = zh.get(mu['id'])
        if tr and tr.strip() and tr.strip() != mu['title']:
            row['tc'] = tr.strip()
        charts.append(row)
        exp_n += 1

    # 台服有、但難易度表沒有的譜面(英服來源曲等:日服未實裝,pentatonic 表自然不會收)
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
    print(f'共 {len(charts)} 譜面(含日服限定 {jp_only}、EXPERT{EXP_MIN}-{EXP_MAX} {exp_n})、曲名比對失敗 {len(unmatched)}')
    print(f'難易度表未收錄、以等級+0.5 推估: {len(est)} 譜面 {est}')
    if unmatched:
        print('比對失敗(前 15):', unmatched[:15])

    data = {'source': src, 'charts': charts}
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
    OUT.write_text(f'// 由 tools/build-b30.py 產生,勿手改。定數:{src}(AP 基準,非官方)\n'
                   f'window.B30_CONSTS={body};\n')
    print(f'寫入 {OUT.name}:{OUT.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
