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
SRC = ROOT / 'js' / 'app.js'
OUT = ROOT / 'js' / 'app.min.js'


def src_hash():
    text = SRC.read_text(encoding='utf-8')
    return hashlib.sha256(re.sub(r'\?v=[0-9a-f]+', '', text).encode('utf-8')).hexdigest()[:10]


def main():
    terser = os.environ.get('TERSER') or shutil.which('terser')
    cmd = [terser] if terser else ['npx', '--yes', 'terser@5']
    cmd += [str(SRC), '-o', str(OUT), '--compress', 'passes=2', '--mangle', '--format', 'comments=false,ascii_only=false']
    print('執行：' + ' '.join(cmd))
    r = subprocess.run(cmd)
    if r.returncode != 0:
        print('terser 失敗', file=sys.stderr)
        return r.returncode
    code = OUT.read_text(encoding='utf-8')
    OUT.write_text(f'/*! src={src_hash()} */\n' + code, encoding='utf-8')
    print(f'app.js {SRC.stat().st_size // 1024} KB → app.min.js {OUT.stat().st_size // 1024} KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
