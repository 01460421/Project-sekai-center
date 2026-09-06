#!/usr/bin/env python3
"""為靜態資源加上內容雜湊版本戳。

用途：讓 js/ css/ data/ vendor/ 底下的檔案可以用 immutable 長快取，
同時保證檔案一改、URL 就變，不會出現「新 HTML 配舊 JS」的錯配。

改完 js/core.js、css/core.css 或 data/*.js 之後跑一次：

    python3 tools/stamp-assets.py

冪等：重複執行結果相同。內容沒變就不會動到檔案。
"""
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HTML = ['index.html', 'app.html', 'ep-calculator.html', 'tutorial.html']
ASSET_DIRS = ['js', 'css', 'data', 'vendor']
ASSET_FILES = ['support.js']
# js/*.js 內部也會用 import('./data/xxx.js?v=…') 動態載入資料檔,那些戳記
# 以前是手改的,改完資料忘記改戳記,瀏覽器就會用一年期 immutable 快取黏住舊資料。
# 這些檔案要先被改寫,改完之後它們自己的雜湊才算得準,所以分兩輪。
CODE = ['js/app.js', 'js/core.js', 'support.js']


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()[:10]


def collect(only=None):
    """回傳 {相對路徑: 雜湊}。only 給定時只收那些目錄。"""
    out = {}
    for d in (only or ASSET_DIRS):
        base = ROOT / d
        if not base.is_dir():
            continue
        for p in sorted(base.rglob('*')):
            if p.is_file() and p.suffix in ('.js', '.css'):
                out[p.relative_to(ROOT).as_posix()] = digest(p)
    if only is None:
        for f in ASSET_FILES:
            p = ROOT / f
            if p.is_file():
                out[f] = digest(p)
    return out


def restamp(path, assets, only_existing=False):
    """把 path 裡對這些資源的引用重新戳上版本。有改到回 True。

    only_existing=True 時「只更新已經有 ?v= 的地方,絕不替沒戳記的網址加上戳記」。
    程式碼檔一定要用這個模式,因為裡面的裸網址是刻意的:
      - data/billing.js 與 data/b30-consts.js 走 vercel.json 的 must-revalidate,
        每天重建,加了一年期 immutable 的戳記反而會讓瀏覽器黏住舊資料
      - data/cards-index.js 自己接了 12 小時的時間桶,再加一個 ?v= 會變成
        「?v=雜湊?v=時間」這種壞掉的網址
    HTML 那邊則是所有引用本來就都該有戳記,可以直接補。
    """
    if not path.is_file():
        return False
    src = path.read_text(encoding='utf-8')
    new = src
    for rel, h in assets.items():
        ver = r'\?v=[0-9a-f]+' if only_existing else r'(?:\?v=[0-9a-f]+)?'
        pat = re.compile(r'(["\'])((?:\./|/)?' + re.escape(rel) + r')' + ver + r'\1')
        new = pat.sub(lambda m: f'{m.group(1)}{m.group(2)}?v={h}{m.group(1)}', new)
    if new != src:
        path.write_text(new, encoding='utf-8')
        return True
    return False


def main():
    # 第一輪:先把 data / css / vendor 的戳記寫進程式碼檔。
    # 這一輪會改動 js/app.js 之類的檔案,所以它們的雜湊要等這輪做完才算得準。
    data_assets = collect(['data', 'css', 'vendor'])
    code_changed = [f for f in CODE if restamp(ROOT / f, data_assets, only_existing=True)]

    # 第二輪:所有資源(含剛被改過的程式碼檔)的戳記寫進 HTML。
    assets = collect()
    if not assets:
        print('找不到任何資源檔', file=sys.stderr)
        return 1
    changed = [n for n in HTML if restamp(ROOT / n, assets)]

    print(f'資源 {len(assets)} 個：')
    for rel, h in assets.items():
        print(f'  {rel:32s} v={h}')
    print(f'更新的程式碼檔：{", ".join(code_changed) if code_changed else "無（已是最新）"}')
    print(f'更新的 HTML：{", ".join(changed) if changed else "無（已是最新）"}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
