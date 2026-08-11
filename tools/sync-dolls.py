#!/usr/bin/env python3
"""從瑞憶春希的公開表格同步「豆森娃月列表」到 data/sekai-data.js 的 DOLLS。

原始表格（月卡玩偶列表分頁）：
  https://docs.google.com/spreadsheets/d/1hSnDoo3MN_MexTf3hddOpq9Tyoa8qUSgffPojlFT9IM/

為什麼用 gviz 而不是 export?format=csv：
  csv 匯出只給第一個工作表（那份表的第一頁是說明頁）。gviz 可以指定分頁，
  而且要帶 headers=0，否則它會自作聰明把前幾列當表頭合併成一格。

內容沒變就不寫檔，CI 才不會產生空提交。手動重跑：

    python3 tools/sync-dolls.py
    python3 tools/stamp-assets.py    # 資料檔改了要重新蓋版本戳
"""
import csv
import io
import json
import pathlib
import re
import sys
import urllib.parse
import urllib.request

SHEET = '1hSnDoo3MN_MexTf3hddOpq9Tyoa8qUSgffPojlFT9IM'
TAB = '月卡玩偶列表'
URL = (f'https://docs.google.com/spreadsheets/d/{SHEET}/gviz/tq'
       f'?tqx=out:csv&sheet={urllib.parse.quote(TAB)}&headers=0')
ROOT = pathlib.Path(__file__).resolve().parent.parent
TARGET = ROOT / 'data' / 'sekai-data.js'
MONTH = re.compile(r'^\d{4}/\d{2}$')


def fetch_rows():
    req = urllib.request.Request(URL, headers={'user-agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=45) as r:
        text = r.read().decode('utf-8')
    return list(csv.reader(io.StringIO(text)))


def parse(rows):
    out = []
    for r in rows:
        # 欄序：本月角色 / 日服月份 / 台服月份 / 卡池類型 / 普限輪數
        if len(r) < 4:
            continue
        chars, jp, tw, typ = (r[0].strip(), r[1].strip(), r[2].strip(), r[3].strip())
        if not MONTH.match(jp) or not MONTH.match(tw):
            continue                      # 表頭與空列自然被濾掉
        rnd = r[4].strip() if len(r) > 4 else ''
        out.append({'chars': chars, 'jp': jp, 'tw': tw, 'type': typ,
                    'round': int(rnd) if rnd.isdigit() else 0})
    return out


def main():
    try:
        dolls = parse(fetch_rows())
    except Exception as e:
        print(f'抓取失敗（{type(e).__name__}: {e}），保留現有資料', file=sys.stderr)
        return 1
    if len(dolls) < 10:
        # 表格改版或抓到空頁時，寧可什麼都不做，也不要把好資料覆蓋成殘缺的
        print(f'只解析到 {len(dolls)} 筆，顯然不對，不覆蓋現有資料', file=sys.stderr)
        return 1

    src = TARGET.read_text()
    m = re.search(r'export const DOLLS = (\[.*?\]);', src, re.S)
    if not m:
        print('找不到 DOLLS 宣告', file=sys.stderr)
        return 1
    try:
        old = json.loads(m.group(1))
    except Exception:
        old = None
    if old == dolls:
        print(f'內容無變化（{len(dolls)} 筆），不更新')
        return 0

    body = json.dumps(dolls, ensure_ascii=False, separators=(', ', ': '))
    TARGET.write_text(src[:m.start(1)] + body + src[m.end(1):])
    n_old = len(old) if old else 0
    print(f'已更新 DOLLS：{n_old} → {len(dolls)} 筆（最新台服月份 {dolls[-1]["tw"]}）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
