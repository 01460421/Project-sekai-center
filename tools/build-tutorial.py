#!/usr/bin/env python3
"""從教學原檔（Google 文件匯出的 HTML）重建 data/tutorial-data.js。

原本站上的教學資料是人工摘要過的，數值表（專精等級、活動加成、
WL 輔助團體…）多半被縮成一句話，圖片只留「前往文檔查看」的連結。
這支直接吃原檔，保留清單與表格結構，圖片改指向站內壓過的 webp。

用法：
    python3 tools/build-tutorial.py <解壓後的 教學/ 目錄>

圖片請先轉好：
    cwebp -q 78 -resize 1000 0 教學/images/imageN.png -o tut-img/imageN.webp
"""
import html
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# h2 標題 → 站上分類
CATS = [
    ('basic',  '基礎',      '#4ad1e8', ['基礎']),
    ('adv',    '進階',      '#3ee0a8', ['進階']),
    ('skill',  '卡面技能',  '#ff9db4', ['卡面', '技能']),
    ('sekai',  '烤森綜合力', '#b8e561', ['烤森', '綜合力', 'mysekai']),
    ('rank',   '排位賽',    '#c39df2', ['排位']),
    ('rhythm', '音遊練習',  '#ffd94d', ['音遊', '練習', '譜面']),
]
KEEP = {'p', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'strong', 'b', 'em', 'i', 'br', 'a', 'img', 'h4'}


def cat_of(heading):
    h = (heading or '').lower()
    for cid, _n, _c, keys in CATS:
        if any(k.lower() in h for k in keys):
            return cid
    return 'basic'


def clean(frag):
    """去掉 Google 的 class/style/id，只留語意標籤；圖片轉指站內 webp。"""
    frag = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', frag, flags=re.S)
    # 圖片：images/imageN.png → tut-img/imageN.webp
    def img(m):
        src = m.group(1)
        stem = pathlib.Path(src).stem
        return (f'<img src="/tut-img/{stem}.webp" alt="" loading="lazy" '
                f'style="max-width:100%;height:auto;border-radius:10px;display:block;margin:8px 0">')
    frag = re.sub(r'<img[^>]*src="([^"]+)"[^>]*>', img, frag)

    def tag(m):
        closing, name, attrs = m.group(1), m.group(2).lower(), m.group(3)
        if name not in KEEP:
            return ''
        if closing:
            return f'</{name}>'
        if name == 'img':
            return m.group(0)          # 已在上一步處理好
        if name == 'a':
            href = re.search(r'href="([^"]+)"', attrs or '')
            if not href:
                return ''
            url = html.unescape(href.group(1))
            if url.startswith('#'):
                return ''              # Google Docs 的註解錨點,站上沒有對應內容
            # Google 的轉址包裝拆掉
            q = re.search(r'[?&]q=([^&]+)', url)
            if q:
                from urllib.parse import unquote
                url = unquote(q.group(1))
            return f'<a href="{url}" target="_blank" rel="noopener">'
        return f'<{name}>'
    frag = re.sub(r'<(/?)(\w+)((?:\s[^>]*)?)>', tag, frag)
    frag = re.sub(r'<p>\s*</p>', '', frag)
    frag = re.sub(r'\s{2,}', ' ', frag)
    return frag.strip()


def main():
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 1
    src = pathlib.Path(sys.argv[1])
    f = src / 'index.html'
    if not f.is_file():
        print(f'找不到 {f}', file=sys.stderr)
        return 1

    doc = html.unescape(f.read_text(encoding='utf-8'))

    # 依 h2/h3 切段：h2 決定分類，h3【標題】是一則問答
    marks = []
    for m in re.finditer(r'<h([23])[^>]*>(.*?)</h\1>', doc, re.S):
        text = re.sub(r'<[^>]+>', '', m.group(2)).strip()
        marks.append((int(m.group(1)), text, m.start(), m.end()))

    qa, cur_cat, skipped = [], 'basic', 0
    for i, (lv, text, _s, e) in enumerate(marks):
        if lv == 2:
            cur_cat = cat_of(text)
            continue
        t = re.match(r'^【(.+?)】$', text.strip())
        if not t:
            skipped += 1
            continue
        end = marks[i + 1][2] if i + 1 < len(marks) else len(doc)
        body = clean(doc[e:end])
        if not body:
            continue
        qa.append({'cat': cur_cat, 'q': t.group(1).strip(), 'a': body,
                   'kw': ' '.join(re.findall(r'[A-Za-z]{2,}', t.group(1)))})

    # 原檔只涵蓋基礎/進階/卡面技能三段,站上另有烤森/排位/音遊等內容,
    # 所以是「合併」而非覆蓋:既有題目保留(含分類),原檔較完整者換掉內文,
    # 原檔獨有的追加在後面。直接覆蓋會弄丟站上既有的 28 則。
    out = ROOT / 'data' / 'tutorial-data.js'
    old = []
    if out.is_file():
        m = re.search(r'TUT_QA = (\[.*?\]);', out.read_text(encoding='utf-8'), re.S)
        if m:
            old = json.loads(m.group(1))
    norm = lambda s: re.sub(r'[\s　]+', '', s or '')
    byq = {norm(x['q']): x for x in old}
    merged, upgraded, added = list(old), 0, 0
    for n in qa:
        k = norm(n['q'])
        o = byq.get(k)
        if o:
            # 只在原檔明顯更完整時才換,避免把人工潤過的短句換成雜訊
            if len(n['a']) > len(o['a']) * 1.15 or '<img' in n['a']:
                o['a'] = n['a']; upgraded += 1
        else:
            merged.append(n); added += 1
    qa = merged
    print(f'  合併:既有 {len(old)} 則,內文升級 {upgraded} 則,新增 {added} 則')

    cats = [{'id': c, 'name': n, 'c': col} for c, n, col, _ in CATS]
    body = ('// 教學大全：由 tools/build-tutorial.py 從教學原檔產生，勿手改\n'
            f'export const TUT_CATS = {json.dumps(cats, ensure_ascii=False)};\n'
            f'export const TUT_QA = {json.dumps(qa, ensure_ascii=False)};\n')
    out.write_text(body, encoding='utf-8')

    from collections import Counter
    print(f'寫出 {out.relative_to(ROOT)}  {out.stat().st_size / 1024:.0f} KB')
    print(f'  問答 {len(qa)} 則（略過非【】標題 {skipped} 個）')
    print(f'  分類分布：{dict(Counter(x["cat"] for x in qa))}')
    print(f'  含圖片的則數：{sum(1 for x in qa if "<img" in x["a"])}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
