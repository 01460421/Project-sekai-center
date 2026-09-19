#!/usr/bin/env python3
"""把 js/app.js 壓成 js/app.min.js（app.html 載的是這一支）。

改完 js/app.js 之後跑：

    python3 tools/build-min.py && python3 tools/stamp-assets.py

stamp-assets 會核對 app.min.js 檔頭記的來源雜湊，對不上就直接失敗 ——
壓縮檔過期是會靜靜壞掉的那種問題（新程式碼就是不出現），寧可紅掉。
雜湊算的是去掉 ?v= 戳記後的 app.js，所以每日排程重戳資料檔不會讓它過期。
需要 node；terser 用 TERSER 環境變數指定，沒有就 npx --yes terser@5。
"""
import hashlib
import os
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
# (來源, 輸出, 是否 ES module)。ai.js 是 export function，terser 要加 --module 才會保留 export。
TARGETS = [
    (ROOT / 'js' / 'app.js', ROOT / 'js' / 'app.min.js', False),
    (ROOT / 'js' / 'ai.js', ROOT / 'js' / 'ai.min.js', True),
]


def src_hash(src):
    text = src.read_text(encoding='utf-8')
    return hashlib.sha256(re.sub(r'\?v=[0-9a-f]+', '', text).encode('utf-8')).hexdigest()[:10]


def main():
    terser = os.environ.get('TERSER') or shutil.which('terser')
    base = [terser] if terser else ['npx', '--yes', 'terser@5']
    for src, out, is_module in TARGETS:
        cmd = base + [str(src), '-o', str(out), '--compress', 'passes=2', '--mangle', '--format', 'comments=false,ascii_only=false'] + (['--module'] if is_module else [])
        print('執行：' + ' '.join(cmd))
        r = subprocess.run(cmd)
        if r.returncode != 0:
            print('terser 失敗', file=sys.stderr)
            return r.returncode
        code = out.read_text(encoding='utf-8')
        out.write_text(f'/*! src={src_hash(src)} */\n' + code, encoding='utf-8')
        print(f'{src.name} {src.stat().st_size // 1024} KB → {out.name} {out.stat().st_size // 1024} KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
