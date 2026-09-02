#!/usr/bin/env python3
"""把 app.html 裡內嵌的 dc-script（約 750 KB 的 JS）抽成 js/app.js。

為什麼：app.html 一個檔就 1.2 MB，而且 HTML 只能 max-age=0，每次部署所有人
整份重抓；JS 抽出去之後走 stamp-assets 的內容雜湊，長快取、只有改到才重抓，
殼本身剩下模板。

做法：把 <script type="text/x-dc" data-dc-script ...>…</script> 的內容寫到
js/app.js，標籤改成 src="./js/app.js"（內容清空）。support.js 的 boot 會看到
textContent 是空的、有 src，就先 fetch 再啟動。

冪等：已經是外部檔的情況下，改成「從 js/app.js 讀回來」不做任何事。
之後改邏輯請直接改 js/app.js，改完跑 stamp-assets。
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HTML = ROOT / 'app.html'
OUT = ROOT / 'js' / 'app.js'

TAG = re.compile(r'(<script type="text/x-dc" data-dc-script)([^>]*)>([\s\S]*?)</script>')


def main():
    src = HTML.read_text(encoding='utf-8')
    m = TAG.search(src)
    if not m:
        print('app.html 裡找不到 data-dc-script 標籤', file=sys.stderr)
        return 1
    attrs, body = m.group(2), m.group(3)
    if 'src=' in attrs and not body.strip():
        print('已經是外部檔（js/app.js），沒有事要做')
        return 0
    if 'src=' in attrs:
        print('標籤同時有 src 與內容，不敢猜要哪一份', file=sys.stderr)
        return 1
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(body.lstrip('\n'), encoding='utf-8')
    new_tag = m.group(1) + attrs + ' src="./js/app.js"></script>'
    HTML.write_text(src[:m.start()] + new_tag + src[m.end():], encoding='utf-8')
    print(f'寫出 js/app.js {OUT.stat().st_size / 1024:.0f} KB；app.html 改為引用外部檔')
    print('接著跑 python3 tools/stamp-assets.py 加上版本戳')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
