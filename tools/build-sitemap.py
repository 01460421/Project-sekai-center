#!/usr/bin/env python3
"""從 js/app.js 的 PAGES 表產 sitemap.xml（?page= 網址）。新增分頁後跑一次。"""
import pathlib, re, datetime
ROOT = pathlib.Path(__file__).resolve().parent.parent
src = (ROOT / 'js' / 'app.js').read_text(encoding='utf-8')
block = src[src.index('  PAGES = {'):]
block = block[:block.index('\n  };')]
keys = re.findall(r'^\s{4}(\w+):\s+\[', block, re.M)
today = datetime.date.today().isoformat()
BASE = 'https://project-sekai-center.com/'
urls = [BASE] + [BASE + '?page=' + k for k in keys if k not in ('home', 'admin', 'account')]
xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + ''.join(
    f'  <url><loc>{u.replace("&", "&amp;")}</loc><lastmod>{today}</lastmod><changefreq>daily</changefreq></url>\n' for u in urls) + '</urlset>\n'
(ROOT / 'sitemap.xml').write_text(xml, encoding='utf-8')
print(f'sitemap.xml：{len(urls)} 筆')
