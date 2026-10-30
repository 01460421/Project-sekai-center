#!/usr/bin/env python3
"""從 js/app.js 的 PAGES 表產 sitemap.xml（?page= 網址），再加上獨立頁面。新增分頁後跑一次。"""
import pathlib, re, datetime
ROOT = pathlib.Path(__file__).resolve().parent.parent
src = (ROOT / 'js' / 'app.js').read_text(encoding='utf-8')
block = src[src.index('  PAGES = {'):]
block = block[:block.index('\n  };')]
keys = re.findall(r'^\s{4}(\w+):\s*\[', block, re.M)
today = datetime.date.today().isoformat()
BASE = 'https://project-sekai-center.com/'
STANDALONE = ['ep-calculator.html', 'tutorial.html', 'starmap.html', 'theater.html', 'soundprint.html', 'echoes.html']   # 不在 PAGES 表裡的獨立頁面
urls = [BASE] + [BASE + '?page=' + k for k in keys if k not in ('home', 'admin', 'account')] + [BASE + f for f in STANDALONE]
# 已經在 sitemap 裡的網址沿用原本的 lastmod，只有新頁面記今天：每日排程跑這支時，頁面沒增減就不會產生變更
out = ROOT / 'sitemap.xml'
old = dict(re.findall(r'<loc>([^<]+)</loc><lastmod>([^<]+)</lastmod>', out.read_text(encoding='utf-8'))) if out.exists() else {}
esc = lambda u: u.replace('&', '&amp;')
xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + ''.join(
    f'  <url><loc>{esc(u)}</loc><lastmod>{old.get(esc(u), today)}</lastmod><changefreq>daily</changefreq></url>\n' for u in urls) + '</urlset>\n'
added = [u for u in urls if esc(u) not in old]
out.write_text(xml, encoding='utf-8')
print(f'sitemap.xml：{len(urls)} 筆' + (f'，新增 {len(added)} 筆：' + '、'.join(u.rsplit("=", 1)[-1] for u in added) if added else ''))
