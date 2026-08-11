#!/usr/bin/env python3
"""把 good果汁 的公開表格轉成站上可用的資料檔。

來源（皆為公開分享，站上每處引用都附原始連結）：
  台服全榜線紀錄  1GrB74wgDgJyRe_lNKpwWHjXrnCYOZP9M8L9uuQHJafA
  台服 WL 榜線紀錄 15P85CdYfmFh58iJxgOkS4ZvyrJ7SGPf6IIRA2AEh-ts
  WL 交換所規劃表  1V00MxDxbL0QyMD-5hha92Q2w9ZfTHzPMW-aeKI493Bk

輸出 data/borders-db.js：
  window.BORDERS_DB = { builtAt, events:[...], borders:[...], wl:[...], exchange:{...}, tiers:[...] }

為什麼不用 HiSekai API 就好：
  API 要一期一個請求（174 期就是 174 次），而且沒有活動日數／型態／團體／屬性
  這些 metadata —— 正是「時長 8.25 天的 wxs 箱活 T1000 排行」這種交叉篩選要用的東西。
  這份表一次就全給了。

內容沒變就不寫檔，CI 才不會產生空提交：

    python3 tools/build-goodjuice.py
    python3 tools/stamp-assets.py
"""
import html
import io
import json
import pathlib
import re
import sys
import time
import urllib.request
import zipfile

SHEETS = {
    'border': '1GrB74wgDgJyRe_lNKpwWHjXrnCYOZP9M8L9uuQHJafA',
    'wl': '15P85CdYfmFh58iJxgOkS4ZvyrJ7SGPf6IIRA2AEh-ts',
    'exchange': '1V00MxDxbL0QyMD-5hha92Q2w9ZfTHzPMW-aeKI493Bk',
}
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'borders-db.js'


def get_xlsx(sid):
    url = f'https://docs.google.com/spreadsheets/d/{sid}/export?format=xlsx'
    req = urllib.request.Request(url, headers={'user-agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return zipfile.ZipFile(io.BytesIO(r.read()))


def sheet_rows(z, name):
    """回傳 [{欄字母: 值}]。

    兩個容易踩的地方：合併儲存格只有左上角有值（讀出來是空的，屬正常）；
    以及 Excel 的 shared formula 後續格是自閉合的 <f t="shared" si="0"/>，
    正則若只認 <f>...</f> 會整格比對失敗，那一欄就從第二列起全變空值。
    """
    ss = []
    try:
        sx = z.read('xl/sharedStrings.xml').decode('utf-8')
        for m in re.finditer(r'<si>(.*?)</si>', sx, re.S):
            ss.append(html.unescape(re.sub(r'<[^>]+>', '', m.group(1))))
    except KeyError:
        pass
    wb = z.read('xl/workbook.xml').decode('utf-8')
    rels = z.read('xl/_rels/workbook.xml.rels').decode('utf-8')
    rid2f = dict(re.findall(r'Id="(rId\d+)" Type="[^"]*worksheet" Target="(worksheets/sheet\d+\.xml)"', rels))
    n2r = dict(re.findall(r'<sheet [^>]*name="([^"]+)"[^>]*r:id="(rId\d+)"', wb))
    rid = n2r.get(name)
    if not rid:
        return []
    xml = z.read('xl/' + rid2f[rid].lstrip('/')).decode('utf-8')
    out = []
    for rm in re.finditer(r'<row[^>]*>(.*?)</row>', xml, re.S):
        row = {}
        for cm in re.finditer(
                r'<c r="([A-Z]+)\d+"(?:[^>]* t="(\w+)")?[^>]*>(?:<f[^>]*/>|<f[^>]*>.*?</f>)?'
                r'(?:<v>([^<]*)</v>)?(?:<is><t[^>]*>([^<]*)</t></is>)?</c>', rm.group(1), re.S):
            col, typ, v, iss = cm.groups()
            val = iss if iss is not None else v
            if val is None:
                continue
            row[col] = ss[int(val)] if typ == 's' and val.isdigit() else val
        out.append(row)
    return out


def num(v):
    try:
        f = float(v)
        return int(f) if f == int(f) else f
    except (TypeError, ValueError):
        return None


def excel_date(v):
    """Excel 序列日 → YYYY/MM/DD（1900 曆制，含它那個著名的閏年 bug 偏移）。"""
    n = num(v)
    if not n:
        return ''
    days = int(n) - 25569          # 1970-01-01 的序列值
    t = time.gmtime(days * 86400)
    return f'{t.tm_year}/{t.tm_mon:02d}/{t.tm_mday:02d}'


def col_letters(n):
    s = ''
    while n >= 0:
        s = chr(n % 26 + 65) + s
        n = n // 26 - 1
    return s


def parse_events(z):
    """活動一覽：期數/名稱/角色/團體/起訖/日數/型態/屬性。"""
    rows = sheet_rows(z, '活動一覽')
    out = []
    for i, r in enumerate(rows[1:], 1):
        name = (r.get('B') or '').strip()
        if not name:
            continue
        out.append({
            'id': num(r.get('A')) or i,
            'name': name,
            'chara': (r.get('C') or '').strip(),
            'unit': (r.get('D') or '').strip(),
            'start': excel_date(r.get('E')),
            'end': excel_date(r.get('F')),
            'days': num(r.get('G')),
            'type': (r.get('H') or '').strip(),
            'attr': (r.get('I') or '').strip(),
        })
    return out


def parse_borders(z, sheet, id_is_float=False):
    """榜線資料總表：前幾欄是 metadata，之後每欄一個段位。"""
    rows = sheet_rows(z, sheet)
    if not rows:
        return [], []
    head = rows[0]
    # 找出「T數字」開頭的欄位，順序照表上的欄序
    tiers = []
    for col, val in sorted(head.items(), key=lambda kv: (len(kv[0]), kv[0])):
        m = re.match(r'^T(\d+)$', str(val).strip())
        if m:
            tiers.append((col, int(m.group(1))))
    meta_cols = {v: k for k, v in
                 {k: str(v).strip() for k, v in head.items()}.items()}
    out = []
    for r in rows[1:]:
        name = (r.get('B') or '').strip()
        eid = r.get('A')
        if not name and not eid:
            continue
        rec = {
            'id': (str(eid).strip() if id_is_float else (num(eid) or 0)),
            'name': name,
            'chara': (r.get('C') or '').strip(),
            'unit': (r.get('D') or '').strip(),
        }
        # 兩份表的 metadata 欄序不同，用表頭名稱對應比寫死欄位安全
        for label, key in (('活動日數', 'days'), ('活動型態', 'type'),
                           ('活動輪次', 'round'), ('加成理論', 'bonus')):
            col = meta_cols.get(label)
            if col:
                v = r.get(col)
                rec[key] = num(v) if key in ('days', 'bonus') else (str(v).strip() if v else '')
        rec['t'] = [num(r.get(c)) for c, _ in tiers]
        if any(x for x in rec['t']):
            out.append(rec)
    return out, [t for _, t in tiers]


def parse_exchange(z):
    """WL 交換所：每個分頁有「綜合交換所」與各章節交換所，各自一組 7 欄。"""
    out = {}
    wb = z.read('xl/workbook.xml').decode('utf-8')
    names = [n for n in re.findall(r'<sheet [^>]*name="([^"]+)"', wb) if re.match(r'^WL\d+$', n)]
    for tab in names:
        rows = sheet_rows(z, tab)
        if len(rows) < 5:
            continue
        # 第 3 列(index 2)是各區塊標題，第 4 列是欄名
        blocks = []
        for col, val in sorted(rows[2].items(), key=lambda kv: (len(kv[0]), kv[0])):
            t = str(val).strip()
            if t:
                blocks.append((col, t))
        secs = []
        for bi, (col, title) in enumerate(blocks):
            start = 0
            for n in range(0, 60):
                if col_letters(n) == col:
                    start = n
                    break
            items = []
            for r in rows[4:]:
                nm = (r.get(col_letters(start + 1)) or '').strip()
                if not nm:
                    continue
                items.append({
                    'n': nm,
                    'cost': num(r.get(col_letters(start + 2))),
                    'max': num(r.get(col_letters(start + 3))),
                })
            if items:
                secs.append({'title': title, 'items': items})
        if secs:
            out[tab] = secs
    return out


def main():
    try:
        zb = get_xlsx(SHEETS['border'])
        events = parse_events(zb)
        borders, tiers = parse_borders(zb, '榜線資料總表')
        zw = get_xlsx(SHEETS['wl'])
        wl, wl_tiers = parse_borders(zw, '榜線資料總表', id_is_float=True)
        ze = get_xlsx(SHEETS['exchange'])
        exchange = parse_exchange(ze)
    except Exception as e:
        print(f'抓取或解析失敗（{type(e).__name__}: {e}）', file=sys.stderr)
        return 1

    if len(events) < 50 or len(borders) < 50:
        print(f'資料量異常（活動 {len(events)}、榜線 {len(borders)}），不覆蓋現有檔案', file=sys.stderr)
        return 1

    data = {
        'source': 'good果汁（台服全榜線紀錄／WL 榜線紀錄／WL 交換所規劃表）',
        'events': events, 'borders': borders, 'tiers': tiers,
        'wl': wl, 'wlTiers': wl_tiers, 'exchange': exchange,
    }
    print(f'活動 {len(events)} 期｜榜線 {len(borders)} 期 × {len(tiers)} 段'
          f'｜WL {len(wl)} 章 × {len(wl_tiers)} 段｜交換所 {list(exchange)}')

    if OUT.exists():
        m = re.search(r'window\.BORDERS_DB\s*=\s*(\{.*\});?\s*$', OUT.read_text(), re.S)
        if m:
            try:
                old = json.loads(m.group(1))
                old.pop('builtAt', None)
                if old == data:
                    print('內容無變化，不更新')
                    return 0
            except Exception:
                pass
    data['builtAt'] = int(time.time() * 1000)
    body = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    OUT.write_text('// 由 tools/build-goodjuice.py 產生,勿手改。\n'
                   '// 資料來源:good果汁的公開表格(台服全榜線紀錄/WL榜線紀錄/WL交換所規劃表)\n'
                   f'window.BORDERS_DB={body};\n')
    print(f'寫入 {OUT.name}：{OUT.stat().st_size // 1024} KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
