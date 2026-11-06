#!/usr/bin/env python3
"""把全站字型（Huninn＋M PLUS Rounded 1c）的 @font-face 表抓回來，存成本站的 css/fonts.css。

為什麼不直接連 fonts.googleapis.com：
  中日文字型被 Google 切成上百個 unicode-range 子集，CSS 本身就有 590 KB（615 條 @font-face），
  Google 只給 gzip（約 155 KB）。同一份放在本站走 brotli 只剩 40～60 KB，而且吃 css/ 的一年期快取，
  慢速網路下開站後不會再跟資料檔搶那 155 KB 的頻寬。字型檔本身照舊從 fonts.gstatic.com 下載
  （網址帶版本號、不會變），只有「哪個字在哪個檔」這張表搬回來。

用法（改了字重、或想跟上 Google 的字型更新時）：

    python3 tools/build-fonts.py && python3 tools/stamp-assets.py

抓不到或內容不對就不覆寫舊檔、照常結束（每日排程失敗不擋其他資料）。
Noto Sans JP 只有站內製作工具（追加圖、譜面預覽）用得到，由 js/maker.js 進頁時才向 Google 要。
"""
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'css' / 'fonts.css'
FAMILIES = 'family=Huninn&family=M+PLUS+Rounded+1c:wght@400;500;700;800&display=swap'
URL = 'https://fonts.googleapis.com/css2?' + FAMILIES
# 用現代瀏覽器的 UA：Google 會依 UA 決定給 woff2＋unicode-range（舊瀏覽器拿到的是整包 ttf）
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
HEAD = ('/* 由 tools/build-fonts.py 產生，勿手改。來源：' + URL + '\n'
        '   全站字型的 @font-face 表（字型檔照舊從 fonts.gstatic.com 下載）；js/app.js 在第一次畫面出來之後才載這個檔。 */\n')


def fetch():
    req = urllib.request.Request(URL, headers={'User-Agent': UA, 'Accept': 'text/css,*/*;q=0.1'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode('utf-8')


def minify(css):
    css = re.sub(r'/\*[\s\S]*?\*/', '', css)          # Google 在每段前面標的 /* [12] */ 子集編號
    css = re.sub(r'\s+', ' ', css)
    css = re.sub(r'\s*([{};:,])\s*', r'\1', css)
    css = css.replace(';}', '}')
    return css.replace('}@font-face', '}\n@font-face').strip() + '\n'


def check(css):
    faces = re.findall(r'@font-face\{[^}]*\}', css)
    if len(faces) < 300:
        return f'@font-face 只有 {len(faces)} 條（應該有 600 條上下），可能被擋或格式變了'
    for f in faces:
        if not re.search(r"src:url\(https://fonts\.gstatic\.com/[^)]+\.woff2\) ?format\('woff2'\)", f):
            return '有 @font-face 不是 fonts.gstatic.com 的 woff2：' + f[:120]
        if 'unicode-range:' not in f:
            return '有 @font-face 少了 unicode-range：' + f[:120]
    fams = set(re.findall(r"font-family:'([^']+)'", css))
    if fams != {'Huninn', 'M PLUS Rounded 1c'}:
        return f'字型家族不對：{sorted(fams)}'
    return None


def main():
    try:
        css = minify(fetch())
    except Exception as e:  # 網路問題：保留舊檔
        print(f'抓不到字型表，保留舊的 css/fonts.css：{e}', file=sys.stderr)
        return 0
    err = check(css)
    if err:
        print(f'字型表內容不對，保留舊的 css/fonts.css：{err}', file=sys.stderr)
        return 0
    text = HEAD + css
    if OUT.is_file() and OUT.read_text(encoding='utf-8') == text:
        print('css/fonts.css 已是最新')
        return 0
    OUT.write_text(text, encoding='utf-8')
    print(f'寫出 css/fonts.css：{len(text.encode()) // 1024} KB，{text.count("@font-face")} 條 @font-face')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
