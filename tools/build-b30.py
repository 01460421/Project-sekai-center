#!/usr/bin/env python3
"""從「プロセカ難易度表」(腐食氏) 產生 data/b30-consts.js(B30 產生器用定數表)。

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
import time
import unicodedata
import urllib.request
import zipfile
import io

SHEET = 'https://docs.google.com/spreadsheets/d/18HtlXNRxPrTMFMGfUnrLAiF3k1UjjkedSmlRX2GmLzU/export?format=xlsx'
JP = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-diff/main'
TC = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-tc-diff/main'
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'b30-consts.js'


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


def main():
    sheet = parse_sheet(get(SHEET, binary=True))
    jp_musics = get(f'{JP}/musics.json')
    tc_musics = get(f'{TC}/musics.json')
    tc_diffs = get(f'{TC}/musicDifficulties.json')

    by_norm = {}
    for mu in jp_musics:
        by_norm.setdefault(norm(mu['title']), mu)
    tc_ids = {mu['id'] for mu in tc_musics}
    lv = {}
    for d in tc_diffs:
        lv[(d['musicId'], d['musicDifficulty'])] = d['playLevel']

    charts = []
    unmatched, jp_only = [], 0
    for dkey in ('master', 'append'):
        for title, const, plus in sheet[dkey]:
            mu = by_norm.get(norm(title))
            if not mu:
                unmatched.append(title)
                continue
            if mu['id'] not in tc_ids or (mu['id'], dkey) not in lv:
                jp_only += 1
                continue
            row = {
                'id': mu['id'], 'd': dkey, 'lv': lv[(mu['id'], dkey)], 'c': const,
                'jkt': mu['assetbundleName'], 't': mu['title'],
            }
            if plus:
                row['p'] = plus   # 「+」數(1 或 2):三位小數模式換算 +p/30
            charts.append(row)
    charts.sort(key=lambda x: (-x['c'], -x.get('p', 0)))
    print(f'共 {len(charts)} 譜面(台服可玩)、日服限定略過 {jp_only}、曲名比對失敗 {len(unmatched)}')
    if unmatched:
        print('比對失敗(前 15):', unmatched[:15])

    data = {'source': '腐食氏 プロセカ難易度表', 'charts': charts}
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
    OUT.write_text('// 由 tools/build-b30.py 產生,勿手改。定數:腐食氏 プロセカ難易度表(AP 基準,非官方)\n'
                   f'window.B30_CONSTS={body};\n')
    print(f'寫入 {OUT.name}:{OUT.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
