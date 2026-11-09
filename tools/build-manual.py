#!/usr/bin/env python3
"""說明書閱讀器：tools/manual/*.html（說明書本文）→ manual.html（站上的閱讀器）。

    python3 tools/build-manual.py                 # 重建 manual.html
    python3 tools/build-manual.py --print DIR     # 另外輸出 A4 列印版 HTML 到 DIR（給 tools/build-manual-pdf.mjs 轉 PDF）

本文只寫一次（tools/manual/<id>.html，HTML 片段，h2／h3／表格／註腳的寫法見 docs.json 旁的現有檔案），
這支腳本負責：
  · 每一章、每個表、每個圖、每個註腳都給錨點（#site-s3-2、#sched-t4、#voice-fn1…），目次從標題自動產生
  · 自動加超連結：
      「見 2.6 節」「第 4 節」→ 跳到那一節；「表 3」「圖 1」→ 跳到那個表／圖
      〈菜根機器人排班系統說明〉這類書名 → 切到那份說明書
      站上的頁面名稱（存石規劃、活動排名、卡片圖鑑…，從 js/app.js 的 PAGES 表讀）→ 開那一頁；每一小節只連第一次出現
  · 列印版用絕對網址（PDF 裡點了會開網站），站上版用相對網址
"""
import html as _html
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'tools' / 'manual'
CFG = json.loads((SRC / 'docs.json').read_text(encoding='utf-8'))
SITE = CFG['site_url'].rstrip('/') + '/'

# 站上頁面：PAGES 表（app 內頁）＋獨立頁。太泛用的名字（首頁、設定、通知…）不連，不然滿篇都是連結。
SKIP_NAMES = {'首頁', '設定', '通知', '管理後台', '菜根機器人', '我的帳號', '資源連結', '製作與致謝', '功能介紹', '計算中心'}
STANDALONE = {
    '教學大全': 'tutorial.html', 'SEKAI 星圖': 'starmap.html', '衝榜劇場': 'theater.html', 'SEKAI 聲紋': 'soundprint.html',
    '迴響之境': 'echoes.html', 'EP 計算器': 'ep-calculator.html', '經典長頁版': 'index.html',
}
DOC_TITLES = {   # 書名 → 說明書 id（〈〉或「」括起來才算）
    '網站使用手冊': 'site', 'Project SEKAI 資源中心網站使用手冊': 'site',
    '菜根機器人排班系統說明': 'sched', '排班系統說明': 'sched',
    '菜根機器人語音互動系統': 'voice', '語音功能說明': 'voice', '語音互動系統': 'voice',
}


def app_pages():
    src = (ROOT / 'js' / 'app.js').read_text(encoding='utf-8')
    i = src.index('PAGES = {')
    block = src[i:src.index('\n  };', i)]
    out = {}
    for m in re.finditer(r"^\s{4}(\w+):\s*\['([^']+)'", block, re.M):
        key, name = m.group(1), m.group(2)
        # 分類入口（hubEvent／hubDb…叫「追活動」「圖鑑」「工具」）和兩個字的頁名太常出現在一般句子裡，不連
        if name not in SKIP_NAMES and key not in ('tut',) and not key.startswith('hub') and len(name) > 2:
            out[name] = 'app.html?page=' + key
    out.update(STANDALONE)
    return out


PAGE_LINKS = app_pages()


def esc(s):
    return _html.escape(s, quote=True)


def sec_num(text):
    """「3.2　小節」→ 3.2；「附錄 A　…」→ A"""
    t = re.sub(r'<[^>]+>', '', text).strip()
    m = re.match(r'附錄\s*([A-Z])', t)
    if m:
        return m.group(1)
    m = re.match(r'(\d+(?:\.\d+)*)', t)
    return m.group(1) if m else None


def build_doc(doc, body, mode):
    did = doc['id']
    ids = {}            # 'sec:3.2' / 'tbl:3' / 'fig:1' / 'fn:1' → element id
    toc = []

    # 1. 標題錨點
    def h_sub(m):
        lvl, inner = m.group(1), m.group(2)
        n = sec_num(inner)
        if not n:
            return m.group(0)
        hid = f'{did}-s{n.replace(".", "-")}'
        ids['sec:' + n] = hid
        title = re.sub(r'<[^>]+>', '', inner).strip()
        toc.append((int(lvl), title, hid))
        anc = '' if mode == 'print' else f'<a class="anc" href="#{hid}" aria-label="本節連結">#</a>'
        return f'<h{lvl} id="{hid}">{inner}{anc}</h{lvl}>'
    body = re.sub(r'<h([23])>(.*?)</h\1>', h_sub, body, flags=re.S)

    # 2. 表、圖
    def tbl_sub(m):
        cls, n = m.group(1), m.group(3)
        tid = f'{did}-t{n}'
        ids['tbl:' + n] = tid
        # 站上版：表格在手機可能要左右捲，給鍵盤焦點與名稱（無障礙：可捲動的區塊要能用鍵盤捲）
        extra = '' if mode == 'print' else f' tabindex="0" role="region" aria-labelledby="{tid}-c"'
        return f'<div class="{cls}" id="{tid}"{extra}>' + m.group(2).replace('<div class="cap">', f'<div class="cap" id="{tid}-c">', 1)
    body = re.sub(r'<div class="(tbl(?: long)?)">(\s*<div class="cap"><b>表\s*(\d+)</b>)', tbl_sub, body)
    out, pos = [], 0
    for m in re.finditer(r'<div class="fig">', body):
        nxt = re.search(r'<b>圖\s*(\d+)</b>', body[m.end():])
        out.append(body[pos:m.start()])
        if nxt:
            fid = f'{did}-f{nxt.group(1)}'
            ids['fig:' + nxt.group(1)] = fid
            out.append(f'<div class="fig" id="{fid}">')
        else:
            out.append(m.group(0))
        pos = m.end()
    body = ''.join(out) + body[pos:]

    # 3. 註腳（雙向連結）
    for m in re.finditer(r'<p><sup>(\d+)</sup>', body):
        ids['fn:' + m.group(1)] = f'{did}-fn{m.group(1)}'
    body = re.sub(r'<p><sup>(\d+)</sup>',
                  lambda m: f'<p id="{did}-fn{m.group(1)}"><sup><a href="#{did}-fnr{m.group(1)}" aria-label="回到內文">{m.group(1)}</a></sup>', body)
    body = re.sub(r'<sup class="fn">(\d+)</sup>',
                  lambda m: f'<sup class="fn" id="{did}-fnr{m.group(1)}"><a href="#{did}-fn{m.group(1)}" aria-label="註 {m.group(1)}">{m.group(1)}</a></sup>', body)

    # 4. 內文自動連結
    body = linkify(body, did, ids, mode)
    return body, toc


def href_doc(target, mode):
    return (SITE + 'manual#' + target) if mode == 'print' else '#' + target


def href_page(url, mode):
    return SITE + url if mode == 'print' else url


def linkify(body, did, ids, mode):
    names = sorted(PAGE_LINKS, key=len, reverse=True)
    titles = sorted(DOC_TITLES, key=len, reverse=True)
    rx = re.compile(
        r'(?P<doc>[〈「](?P<dt>' + '|'.join(map(re.escape, titles)) + r')[〉」])'
        r'|(?P<sec>(?:(?:見|參見|參閱|詳見)\s*(?:第\s*)?(?P<n1>\d+(?:\.\d+)?)(?:\s*節)?)|(?:第\s*)?(?P<n2>\d+(?:\.\d+)?)\s*節)'
        r'|(?P<tf>(?P<tk>表|圖)\s*(?P<tn>\d+))'
        r'|(?P<pg>' + '|'.join(map(re.escape, names)) + r')')
    SKIP = {'code', 'a', 'h2', 'h3', 'th', 'svg', 'sup', 'title'}
    toks = re.split(r'(<[^>]+>)', body)
    skip, div_cap = [], []
    seen = set()
    out = []
    for t in toks:
        if t.startswith('<'):
            m = re.match(r'<(/?)([a-zA-Z0-9]+)', t)
            if m:
                close, tag = m.group(1) == '/', m.group(2).lower()
                if tag in ('h2', 'h3') and not close:
                    seen = set()                      # 每一節重新算「第一次出現」
                if tag == 'div':
                    if close:
                        if div_cap and div_cap.pop():
                            skip.pop()
                    else:
                        cap = 'class="cap"' in t
                        div_cap.append(cap)
                        if cap:
                            skip.append('cap')
                elif tag in SKIP and not t.endswith('/>'):
                    if close:
                        if tag in skip:
                            while skip and skip.pop() != tag:
                                pass
                    else:
                        skip.append(tag)
            out.append(t)
            continue
        if skip or not t.strip():
            out.append(t)
            continue

        def rep(m):
            s = m.group(0)
            if m.group('doc'):
                target = DOC_TITLES[m.group('dt')]
                if target == did:
                    return s
                return f'<a class="xdoc" href="{href_doc(target, mode)}">{s}</a>'
            if m.group('sec'):
                n = m.group('n1') or m.group('n2')
                hid = ids.get('sec:' + n)
                return f'<a class="xref" href="#{hid}">{s}</a>' if hid else s
            if m.group('tf'):
                hid = ids.get(('tbl:' if m.group('tk') == '表' else 'fig:') + m.group('tn'))
                return f'<a class="xref" href="#{hid}">{s}</a>' if hid else s
            name = m.group('pg')
            if name in seen:
                return s
            seen.add(name)
            ext = '' if mode == 'print' else ' target="_blank" rel="noopener"'
            return f'<a class="xpage" href="{esc(href_page(PAGE_LINKS[name], mode))}"{ext}>{s}</a>'
        out.append(rx.sub(rep, t))
    return ''.join(out)


def toc_html(toc):
    items = []
    for lvl, title, hid in toc:
        items.append(f'<li class="l{lvl}"><a href="#{hid}">{esc(title)}</a></li>')
    return '<ol class="toc-list">' + ''.join(items) + '</ol>'


def head_block(doc, mode):
    ab = doc.get('abstract') or ''
    pdf = '' if mode == 'print' else (
        f'<p class="dl"><a href="{doc["pdf"]}" download="{esc(doc["pdf_name"])}">下載 PDF（A4 雙欄排版）</a></p>')
    return (f'<div class="title-block"><div class="kicker">技術說明文件・TECHNICAL NOTE</div>'
            f'<h1>{doc["title"]}</h1><div class="en">{doc["en"]}</div>'
            f'<div class="author">{doc["author"]}</div><div class="affil">{doc["affil"]}</div>{pdf}</div>'
            + (f'<div class="abstract"><b class="lbl">摘要</b>　{ab}</div>' if ab else '')
            + f'<div class="kw"><b>關鍵詞：</b>{doc["keywords"]}</div>')


def main():
    args = sys.argv[1:]
    docs = [d for d in CFG['docs'] if (SRC / f'{d["id"]}.html').exists()]
    built = {}
    for d in docs:
        body = (SRC / f'{d["id"]}.html').read_text(encoding='utf-8')
        built[d['id']] = build_doc(d, body, 'web')

    tpl = (SRC / 'reader.html').read_text(encoding='utf-8')
    tabs = ''.join(f'<button type="button" role="tab" class="tab" id="tab-{d["id"]}" data-doc="{d["id"]}" aria-controls="doc-{d["id"]}">{esc(d["tab"])}</button>' for d in docs)
    tocs = ''.join(f'<div class="toc-doc" data-doc="{d["id"]}" hidden>{toc_html(built[d["id"]][1])}</div>' for d in docs)
    arts = ''.join(f'<article class="paper" id="doc-{d["id"]}" data-doc="{d["id"]}" role="tabpanel" aria-labelledby="tab-{d["id"]}" hidden>'
                   f'{head_block(d, "web")}<div class="body">{built[d["id"]][0]}</div></article>' for d in docs)
    meta = json.dumps([{'id': d['id'], 'tab': d['tab'], 'pdf': d['pdf']} for d in docs], ensure_ascii=False)
    out = (tpl.replace('{{TABS}}', tabs).replace('{{TOCS}}', tocs).replace('{{ARTICLES}}', arts)
              .replace('{{META}}', meta))
    (ROOT / 'manual.html').write_text(out, encoding='utf-8')
    print(f'manual.html：{len(docs)} 份說明書，{len(out) // 1024} KB')

    if '--print' in args:
        dst = pathlib.Path(args[args.index('--print') + 1])
        dst.mkdir(parents=True, exist_ok=True)
        css = (SRC / 'paper.css').read_text(encoding='utf-8')
        for d in docs:
            body, toc = build_doc(d, (SRC / f'{d["id"]}.html').read_text(encoding='utf-8'), 'print')
            ptoc = ('<div class="toc"><div class="t">目次</div>' + ''.join(
                f'<div class="i{" s" if lvl == 3 else ""}"><a href="#{hid}">{esc(t)}</a></div>' for lvl, t, hid in toc) + '</div>') if len(toc) > 20 else ''
            page = (f'<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>{esc(d["tab"])}</title><style>{css}</style></head>'
                    f'<body>{head_block(d, "print")}{ptoc}<main>{body}</main></body></html>')
            (dst / f'{d["id"]}.html').write_text(page, encoding='utf-8')
        print(f'列印版：{dst}')


if __name__ == '__main__':
    main()
