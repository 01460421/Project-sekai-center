#!/usr/bin/env python3
"""把介面翻譯（tools/i18n/en.json、tools/i18n/ja.json：{繁中原文: 譯文}）編成網站載入用的 data/i18n-en.js、data/i18n-ja.js。

鍵是原文（去掉前後空白）的 FNV-1a 32 位雜湊（以 UTF-16 碼元計算，跟 js/i18n.js 的 hashKey 一致），轉 36 進位：
六千多條原文本身就有幾百 KB，雜湊之後檔案只剩譯文；只有切到英文或日文的人才會下載。
原文裡的 {0}、{1}… 是執行時才填的數字，js/i18n.js 會先把畫面上的數字換成 {n} 再查一次。

用法：
    python3 tools/build-i18n.py            # 重建兩個語言檔
    python3 tools/build-i18n.py --missing  # 列出網站上有、詞典還沒有的字串（加新功能後補翻譯用）
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'tools' / 'i18n'
HAN = re.compile(r'[\u3400-\u9fff]')


def fnv(s):
    h = 0x811c9dc5
    b = s.encode('utf-16-le')
    for i in range(0, len(b), 2):
        h ^= b[i] | (b[i + 1] << 8)
        h = (h * 0x01000193) & 0xffffffff
    return h


def b36(n):
    d = '0123456789abcdefghijklmnopqrstuvwxyz'
    out = ''
    while True:
        n, r = divmod(n, 36)
        out = d[r] + out
        if not n:
            return out


def build(lang):
    src = json.loads((SRC / f'{lang}.json').read_text(encoding='utf-8'))
    out, seen = {}, {}
    for zh, tr in src.items():
        k = zh.strip()
        if not k or not tr or not str(tr).strip():
            continue
        key = b36(fnv(k))
        if key in seen and seen[key] != k:
            raise SystemExit(f'雜湊碰撞：{seen[key]!r} 與 {k!r}，請改寫其中一條')
        seen[key] = k
        out[key] = str(tr).strip()
    body = json.dumps(out, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    path = ROOT / 'data' / f'i18n-{lang}.js'
    text = (f'/* 由 tools/build-i18n.py 從 tools/i18n/{lang}.json 產生，勿手改。鍵是原文的 FNV-1a 雜湊（36 進位）。 */\n'
            f'export const I18N={body};\n')
    if path.exists() and path.read_text(encoding='utf-8') == text:
        print(f'{path.name} 沒有變化')
        return
    path.write_text(text, encoding='utf-8')
    print(f'寫入 {path.name}：{len(out)} 條，{path.stat().st_size // 1024} KB')


def strings():
    """網站上看得到的中文字串：app.html 標籤間文字與 placeholder／title／aria-label、js 字串常值、教學大全的文字段"""
    import html as H
    got = set()
    def add(t):
        t = H.unescape(t).strip()
        if t and HAN.search(t) and len(t) <= 2500 and t.count('|') < 3:
            got.add(t)
    h = (ROOT / 'app.html').read_text(encoding='utf-8')
    h = re.sub(r'<style[\s\S]*?</style>|<script[\s\S]*?</script>|<!--[\s\S]*?-->', '', h)
    for m in re.finditer(r'>([^<>]+)<', h):
        for seg in re.split(r'\{\{[^}]*\}\}', m.group(1)):
            add(seg)
    for m in re.finditer(r'(?:placeholder|title|aria-label)="([^"]*)"', h):
        for seg in re.split(r'\{\{[^}]*\}\}', m.group(1)):
            add(seg)
    # JS 字串交給 acorn（tools/i18n-strings.mjs）：正規式遇到樣板字串會失去同步而整段漏抓
    import subprocess, tempfile
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(['npm', 'i', '--silent', '--no-save', '--prefix', tmp, 'acorn@8', 'acorn-walk@8'], check=True)
        out = pathlib.Path(tmp) / 'js.json'
        subprocess.run(['node', str(ROOT / 'tools' / 'i18n-strings.mjs'), str(out)], check=True, env={**__import__('os').environ, 'ACORN_DIR': tmp})
        for t in json.loads(out.read_text(encoding='utf-8')):
            add(t)
    # app.html 裡「文字 {{ 值 }} 文字」→ 帶 {n} 的句型
    for m in re.finditer(r'>([^<>]*\{\{[^}]*\}\}[^<>]*)<', h):
        k = [0]
        def sub(_):
            k[0] += 1
            return '{%d}' % (k[0] - 1)
        tpl = re.sub(r'\{\{[^}]*\}\}', sub, m.group(1)).strip()
        if k[0] <= 4:
            add(tpl)
    tut = (ROOT / 'data' / 'tutorial-data.js').read_text(encoding='utf-8')
    for m in re.finditer(r'"((?:[^"\\]|\\.)*)"', tut):
        for seg in re.split(r'<[^>]+>', json.loads('"' + m.group(1) + '"')):
            add(seg)
    return got


def main():
    if '--missing' in sys.argv:
        have = set(json.loads((SRC / 'en.json').read_text(encoding='utf-8'))) & set(json.loads((SRC / 'ja.json').read_text(encoding='utf-8')))
        miss = sorted(s for s in strings() if s not in have)
        print(json.dumps(miss, ensure_ascii=False, indent=1))
        print(f'缺 {len(miss)} 條', file=sys.stderr)
        return 0
    for lang in ('en', 'ja'):
        build(lang)
    return 0


if __name__ == '__main__':
    sys.exit(main())
