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


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()[:10]


def collect():
    """回傳 {相對路徑: 雜湊}。"""
    out = {}
    for d in ASSET_DIRS:
        for p in sorted((ROOT / d).rglob('*')):
            if p.is_file() and p.suffix in ('.js', '.css'):
                out[p.relative_to(ROOT).as_posix()] = digest(p)
    for f in ASSET_FILES:
        p = ROOT / f
        if p.is_file():
            out[f] = digest(p)
    return out


def main():
    assets = collect()
    if not assets:
        print('找不到任何資源檔', file=sys.stderr)
        return 1

    changed = []
    for name in HTML:
        p = ROOT / name
        if not p.is_file():
            continue
        src = p.read_text(encoding='utf-8')
        new = src
        for rel, h in assets.items():
            # 比對 "js/core.js" / './js/core.js' / "/js/core.js"，可帶既有 ?v=
            pat = re.compile(
                r'(["\'])((?:\./|/)?' + re.escape(rel) + r')(?:\?v=[0-9a-f]+)?\1'
            )
            new = pat.sub(lambda m: f'{m.group(1)}{m.group(2)}?v={h}{m.group(1)}', new)
        if new != src:
            p.write_text(new, encoding='utf-8')
            changed.append(name)

    print(f'資源 {len(assets)} 個：')
    for rel, h in assets.items():
        print(f'  {rel:32s} v={h}')
    print(f'更新的 HTML：{", ".join(changed) if changed else "無（已是最新）"}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
