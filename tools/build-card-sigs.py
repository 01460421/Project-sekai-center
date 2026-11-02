#!/usr/bin/env python3
"""產生 data/card-sigs.js —— 卡面縮圖的視覺指紋，給「截圖辨識卡庫」用。

為什麼需要這個：
    截圖辨識要回答「這一格是哪一張卡」。模型讀得準的是角色、稀有度、屬性、
    專精、技能等級，但它記不住 1,249 張卡長什麼樣 —— 實測 CLIP 的第一名與
    第二名相似度只差 0.001~0.01，等於分不出來。
    所以卡片身分不靠模型，靠圖像比對：把每張卡的官方縮圖壓成一組指紋，
    瀏覽器端對截圖裁下來的那一格算同一種指紋，比距離。

為什麼這樣行得通：
    模型給的三個約束（角色×稀有度×屬性）先把候選從 1,249 縮到中位數 2 張，
    指紋只需要在這 2 張之間分勝負，不必在 1,249 張裡大海撈針。
    （實測：其中 16% 的組合只有 1 張候選，連比對都不用。）

★3/★4 要存兩份：卡庫顯示特訓前還是特訓後，取決於玩家練了沒。

卡片範圍：台服與日服卡號是同一套，讀 data/cards-index.js 與 data/cards-index-jp.js 的聯集
（日服卡最多，台服模式辨識的卡也一定在裡面）。以前只讀台服索引、又是手動跑的，
停在 #1271 之後新卡全都認不出來 —— 而比對時一定會挑「最近的一張」，認不出來的新卡
就被硬湊成某張舊卡，連角色都被改掉，後排加成整批算錯。現在由每日排程（ep-songs-refresh.yml）
在卡片索引更新之後接著跑；已經有指紋的卡沿用，只抓新卡的縮圖。

手動重跑：

    python3 tools/build-cards-index.py
    python3 tools/build-card-sigs.py            # 只補新卡
    python3 tools/build-card-sigs.py --all      # 全部重抓
    python3 tools/stamp-assets.py
"""
import base64
import concurrent.futures
import io
import json
import pathlib
import re
import sys
import urllib.request

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSET = 'https://storage.sekai.best/sekai-jp-assets/thumbnail/chara/'
# 這個 CDN 對 python-urllib 的預設 UA 回 403，一定要自報身分
UA = {'User-Agent': 'pjsk-center-build/1.0 (+https://project-sekai-center.com)'}
N = 16          # dHash 邊長：每列取 N+1 個像素、比 N 組相鄰對 → 每個通道 N×N bits
# 三個顏色通道各做一次。灰階把卡面差異最大的資訊（顏色）整個丟掉 ——
# 實測同樣 16x16，加上顏色之後「第一名與第二名的差距」相對值提升約四成。
CHANS = 3
# 遮罩：遊戲格子上疊著左上的屬性圖示與下方的 SLv 條／專精菱形，每一格都一樣，
# 會把所有卡的距離往中間壓。把那兩塊塗成中性灰，參考與查詢都塗，比較才公平。
# 這幾個數字是在縮小後的 (N+1)xN 網格上算的，瀏覽器端必須用完全一樣的整數。
MASK_ROW_FROM = int(N * 0.78)        # 下方這幾列全遮
MASK_TL_X = int((N + 1) * 0.24)      # 左上角這個方塊遮掉
MASK_TL_Y = int(N * 0.24)


def dhash(im):
    """左右相鄰像素比大小。只看梯度方向，所以整體變亮變暗都不影響 ——
    截圖裡的卡格疊了一層半透明白，這點很重要。
    瀏覽器端必須用完全一樣的算法（見 app.html 的 sigOf）。"""
    im = im.convert('RGB').resize((N + 1, N), Image.LANCZOS)
    px = im.load()
    # 先縮再遮：縮完才遮，瀏覽器那邊才能用同樣的整數座標做出一模一樣的結果
    for y in range(N):
        for x in range(N + 1):
            if y >= MASK_ROW_FROM or (x < MASK_TL_X and y < MASK_TL_Y):
                px[x, y] = (128, 128, 128)
    bits = []
    for c in range(CHANS):
        for y in range(N):
            for x in range(N):
                bits.append(1 if px[x + 1, y][c] > px[x, y][c] else 0)
    out = bytearray((len(bits) + 7) // 8)
    for i, b in enumerate(bits):
        if b:
            out[i >> 3] |= 1 << (i & 7)
    return base64.b64encode(bytes(out)).decode()


def fetch(args):
    cid, abn, suf = args
    try:
        req = urllib.request.Request(f'{ASSET}{abn}_{suf}.webp', headers=UA)
        with urllib.request.urlopen(req, timeout=20) as r:
            return cid, suf, dhash(Image.open(io.BytesIO(r.read())))
    except Exception:
        return None


ROW = re.compile(r'\[(\d+),(\d+),(\d+),(\d+),(\d+),(-?\d+),(\d+),"([^"]*)","([^"]*)"(?:,[^\]]*)?\]')
OUT = ROOT / 'data' / 'card-sigs.js'


def main():
    rows = {}
    for name in ('cards-index.js', 'cards-index-jp.js'):
        f = ROOT / 'data' / name
        if f.exists():
            for r in ROW.findall(f.read_text(encoding='utf-8')):
                rows.setdefault(int(r[0]), r)
    if not rows:
        print('讀不到 data/cards-index.js／cards-index-jp.js，先跑 build-cards-index.py')
        return 1

    # 已經有的指紋沿用（縮圖不會變），只抓還沒有的；--all 全部重抓
    have = {}
    if '--all' not in sys.argv and OUT.exists():
        for cid, tr, sig in re.findall(r'^\[(\d+),(\d),"([^"]+)"\],$', OUT.read_text(encoding='utf-8'), re.M):
            have[(int(cid), int(tr))] = sig

    jobs = []
    for cid, r in sorted(rows.items()):
        rar, abn = int(r[2]), r[8]
        for suf in (['normal', 'after_training'] if rar in (3, 4) else ['normal']):
            if (cid, 1 if suf == 'after_training' else 0) not in have:
                jobs.append((cid, abn, suf))
    print(f'{len(rows)} 張卡（到 #{max(rows)}）；沿用 {len(have)} 枚指紋，要抓 {len(jobs)} 張縮圖…')

    with concurrent.futures.ThreadPoolExecutor(max_workers=24) as ex:
        res = [x for x in ex.map(fetch, jobs) if x]
    print(f'成功 {len(res)} / {len(jobs)}')
    if jobs and len(res) < len(jobs) * 0.5 and len(jobs) > 20:
        raise SystemExit('一半以上的縮圖抓不到，素材站可能有狀況，不覆寫')

    # [卡片id, 0=特訓前 1=特訓後, 指紋]
    got = dict(have)
    for cid, suf, sig in res:
        got[(cid, 1 if suf == 'after_training' else 0)] = sig
    out = [[cid, tr, sig] for (cid, tr), sig in sorted(got.items()) if cid in rows]

    body = [
        '/* 由 tools/build-card-sigs.py 產生,請勿手改 */',
        '/* 卡面縮圖的視覺指紋(16x16 dHash × RGB 三通道、遮掉遊戲覆蓋層 = 768 bits,base64)。',
        '   [卡片id, 0=特訓前/1=特訓後, 指紋]',
        '   用途:截圖辨識卡庫時判斷「這一格是哪一張卡」。',
        '   顏色與遮罩都是量出來的:遊戲格子上那些每格都一樣的覆蓋層會把距離往中間壓,\n   遮掉並加上顏色之後,第一名與第二名的相對差距提升約四成。 */',
        'export const SIG_BITS = %d;' % (N * N * CHANS),
        'export const SIGS = [',
    ]
    body += [json.dumps(r, ensure_ascii=False, separators=(',', ':')) + ',' for r in out]
    body.append('];')
    text = '\n'.join(body) + '\n'
    if OUT.exists() and OUT.read_text(encoding='utf-8') == text:
        print('內容無變化，不更新 card-sigs.js')
        return 0
    OUT.write_text(text, encoding='utf-8')
    print(f'寫出 {OUT.relative_to(ROOT)}  {OUT.stat().st_size / 1024:.0f} KB，{len({r[0] for r in out})} 張卡到 #{max(r[0] for r in out)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
