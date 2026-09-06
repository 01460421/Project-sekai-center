#!/usr/bin/env python3
"""重建 data/ep-songs.js(計算中心／摸魚表用的曲庫)。

為什麼要有這支:
  ep-songs.js 原本是「由 ep-calculator.html 的 SD 抽出」的一次性產物,沒有任何
  自動更新機制,所以新歌一直進不來 —— 寫這支的當下它有 640 首,而 b30-consts
  已經有 707 首,摸魚表少算了 70 首歌。有了這支就能跟 b30-consts 一樣每天重建。

資料源:
  - music_metas.json(storage.sekai.best):分數係數的唯一來源。
    每筆是 {music_id, difficulty, base_score, base_score_auto, fever_score,
    skill_score_solo/multi/auto(各 6 個技能窗), event_rate, music_time}。
    這個站有防盜連,帶 Referer 會 403;urllib 預設不送 Referer,所以直接抓即可。
  - JP/TC master musics.json:曲名與曲目清單(台服曲名同日服原名)。
  - JP/TC musicDifficulties.json:各難度的遊戲內 Lv 與音符數。
  - sekai-i18n:中文譯名(社群翻譯,非官方)。

輸出兩個檔:
  data/ep-songs.js         沿用既有格式,所有既有取用端不用改
      d[難度] = [lv, notes, base, baseAuto, soloSkill, soloS6,
                 multiSkill, multiS6, autoSkill, autoS6, fever]
      其中 soloSkill = 前 5 個技能窗的係數總和、soloS6 = 第 6 窗(encore/隊長)
  data/ep-song-windows.js  每一個技能窗各自的影響倍率(6 個窗分開列)
      這是把上面那個「總和」拆開,要看單一技能的影響時用;
      因為體積不小(等於把係數量翻近三倍),獨立成一個檔案按需載入,
      不拖累計算中心的首次載入。

安全網:
  這支腳本沒辦法在每個環境都跑得到 storage.sekai.best,所以內建自我校驗 ——
  重建結果會跟現有 ep-songs.js 的重疊曲目逐一比對,對不上就中止、不寫檔。
  欄位名稱猜錯或上游改格式時,寧可讓 CI 紅掉,也不要默默寫出一份錯的曲庫,
  那會讓摸魚表給出看起來正常但其實錯誤的排名。

內容沒變就不寫檔,CI 才不會空提交。重跑:

    python3 tools/build-ep-songs.py
    python3 tools/stamp-assets.py
"""
import json
import pathlib
import re
import sys
import urllib.request

METAS = 'https://storage.sekai.best/sekai-best-assets/music_metas.json'
JP = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-diff/main'
TC = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-tc-diff/main'
I18N = 'https://raw.githubusercontent.com/Sekai-World/sekai-i18n/main/zh-TW/music_titles.json'

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'ep-songs.js'
OUT_W = ROOT / 'data' / 'ep-song-windows.js'

# music_metas 的 difficulty 字串 → 既有檔案使用的單字母鍵
DKEY = {'easy': 'E', 'normal': 'N', 'hard': 'H', 'expert': 'X', 'master': 'M', 'append': 'A'}
ORDER = ['E', 'N', 'H', 'X', 'M', 'A']


def get(url, timeout=120):
    req = urllib.request.Request(url, headers={'user-agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def r4(x):
    """四捨五入到 4 位。既有檔案就是這個精度,保持一致才比對得起來。"""
    return round(float(x or 0) + 0.0, 4)


def split_windows(arr):
    """技能窗係數 → (前 5 窗總和, 第 6 窗)。

    第 6 窗是 encore/隊長,計算式裡吃的是另一個倍率(S6),所以要跟前五窗分開。
    上游若哪天改成別的長度,這裡照「最後一個是第 6 窗」處理,不硬編 6。
    """
    a = [float(x or 0) for x in (arr or [])]
    if not a:
        return 0.0, 0.0
    if len(a) == 1:
        return r4(a[0]), 0.0
    return r4(sum(a[:-1])), r4(a[-1])


def load_existing():
    """讀出現有 ep-songs.js 的 EP_SONGS,給自我校驗用。讀不到就回 None。"""
    if not OUT.exists():
        return None
    t = OUT.read_text(encoding='utf-8')
    k = t.find('EP_SONGS')
    i = t.find('[', k)
    j = t.find('];', i)
    if k < 0 or i < 0 or j < 0:
        return None
    try:
        return {s['id']: s for s in json.loads(t[i:j + 1])}
    except Exception:
        return None


def build():
    print('抓 music_metas…', flush=True)
    metas = get(METAS)
    if not isinstance(metas, list) or len(metas) <= 1000:
        sys.exit('music_metas 回傳異常（不是陣列或筆數過少），中止')
    print(f'  {len(metas)} 筆譜面係數', flush=True)

    print('抓 master 曲目資料…', flush=True)
    jp_m = get(f'{JP}/musics.json')
    tc_m = get(f'{TC}/musics.json')
    jp_d = get(f'{JP}/musicDifficulties.json')
    tc_d = get(f'{TC}/musicDifficulties.json')
    try:
        zh = get(I18N)
    except Exception as e:
        print(f'  中文譯名抓取失敗（{e}），本輪不帶譯名')
        zh = {}

    title = {}
    for row in jp_m:
        if row.get('id') is not None and row.get('title'):
            title[row['id']] = row['title']
    for row in tc_m:            # 台服若有自己的字串就以台服為準
        if row.get('id') is not None and row.get('title'):
            title[row['id']] = row['title']
    tc_ids = {row['id'] for row in tc_m if row.get('id') is not None}

    # 難度資料:台服優先(遊戲內 Lv 可能與日服不同),沒有才退日服
    lvnote = {}
    for src in (jp_d, tc_d):
        for row in src:
            mid, d = row.get('musicId'), DKEY.get(row.get('musicDifficulty'))
            if mid is None or not d:
                continue
            lvnote[(mid, d)] = (row.get('playLevel') or 0, row.get('totalNoteCount') or 0)

    by = {}
    for m in metas:
        mid = m.get('music_id')
        d = DKEY.get(m.get('difficulty'))
        if mid is None or not d:
            continue
        by.setdefault(mid, {})[d] = m

    songs, wins = [], []
    for mid in sorted(by):
        diffs = by[mid]
        # 歌長與活動係數是整首歌共用的,取任一個有值的難度即可
        time_s = rate = 0
        for d in ORDER:
            m = diffs.get(d)
            if m and m.get('music_time'):
                time_s = round(float(m['music_time']), 1)
                rate = int(m.get('event_rate') or 100)
                break
        if not time_s:
            continue                       # 沒有歌長就算不了每小時 P,略過

        d_out, w_out = {}, {}
        for d in ORDER:
            m = diffs.get(d)
            if not m:
                continue
            lv, notes = lvnote.get((mid, d), (0, 0))
            ss, s6 = split_windows(m.get('skill_score_solo'))
            ms, m6 = split_windows(m.get('skill_score_multi'))
            as_, a6 = split_windows(m.get('skill_score_auto'))
            d_out[d] = [lv, notes,
                        r4(m.get('base_score')), r4(m.get('base_score_auto')),
                        ss, s6, ms, m6, as_, a6,
                        r4(m.get('fever_score'))]
            w_out[d] = {
                's': [r4(x) for x in (m.get('skill_score_solo') or [])],
                'm': [r4(x) for x in (m.get('skill_score_multi') or [])],
                'a': [r4(x) for x in (m.get('skill_score_auto') or [])],
            }
        if not d_out:
            continue

        rec = {'id': mid, 't': title.get(mid, f'#{mid}'), 'time': time_s, 'rate': rate, 'd': d_out}
        zt = zh.get(str(mid)) or zh.get(mid)
        if zt and zt != rec['t']:
            rec['tc'] = zt                 # 中文譯名(社群翻譯,非官方)
        if mid not in tc_ids:
            rec['jp'] = 1                  # 日服限定,台服還沒實裝
        songs.append(rec)
        wins.append({'id': mid, 'w': w_out})

    return songs, wins


def verify(songs):
    """跟現有檔案比對重疊曲目。

    重點是分辨兩種完全不同的狀況,它們的「不符比例」可能一樣,但處置相反:

      欄位對應錯了  → 同一個欄位索引在幾乎每一首歌上都不符(例如把 solo 和 multi
                     對調,索引 4 與 6 會全軍覆沒)。這種一定要中止。
      上游改了資料  → 不符集中在特定曲子/特定難度,而那些曲子的多個欄位一起變
                     (譜面重新模擬過)。這是正常更新,應該放行。

    所以判斷依據不是總比例,而是「有沒有某個欄位索引壞掉一大片」。
    第一版只看總比例、門檻 2%,結果上游重算了一批 APPEND 譜面就卡住不放行 ——
    97% 的係數完全吻合,那顯然不是對應錯誤。
    """
    old = load_existing()
    if not old:
        print('  找不到可比對的舊檔,跳過自我校驗')
        return
    new_by = {s['id']: s for s in songs}
    both = sorted(set(old) & set(new_by))
    if len(both) < 100:
        sys.exit(f'與舊檔重疊的曲目只有 {len(both)} 首，資料對應可能整個錯了，中止')

    lost = sorted(set(old) - set(new_by))
    if lost:
        names = ', '.join(f"#{i} {old[i].get('t', '')}" for i in lost[:10])
        print(f'  注意:舊檔有、新檔沒有的曲目 {len(lost)} 首 —— {names}')
        if len(lost) > len(old) * 0.05:
            sys.exit('掉了太多既有曲目，來源可能不完整，中止')

    # 逐欄位統計。per_field[i] = (不符數, 比對數)
    per_field = {i: [0, 0] for i in range(2, 11)}
    per_diff, bad_songs, samples = {}, set(), []
    for mid in both:
        o, n = old[mid], new_by[mid]
        for d, od in (o.get('d') or {}).items():
            nd = n['d'].get(d)
            if not nd:
                continue
            for i in range(2, min(len(od), len(nd))):
                per_field[i][1] += 1
                if abs(float(od[i]) - float(nd[i])) > 0.002:
                    per_field[i][0] += 1
                    per_diff[d] = per_diff.get(d, 0) + 1
                    bad_songs.add(mid)
                    if len(samples) < 12:
                        samples.append(f"#{mid} {n['t']} {d}[{i}] {od[i]} → {nd[i]}")

    checked = sum(v[1] for v in per_field.values())
    bad = sum(v[0] for v in per_field.values())
    rate = bad / max(checked, 1)
    print(f'  自我校驗:比對 {len(both)} 首、{checked} 個係數，不符 {bad} 個（{rate:.2%}）')
    if bad:
        print('    不符的難度分布:', ', '.join(f'{d}×{c}' for d, c in sorted(per_diff.items(), key=lambda x: -x[1])))
        print(f'    受影響曲目 {len(bad_songs)}/{len(both)} 首')
        worst = max(per_field.items(), key=lambda kv: (kv[1][0] / max(kv[1][1], 1)))
        wi, (wb, wn) = worst
        wrate = wb / max(wn, 1)
        print(f'    最糟的欄位索引 [{wi}]:{wb}/{wn}（{wrate:.1%}）')
        for line in samples[:8]:
            print('    ' + line)
        # 某個欄位壞掉一大片 = 對應錯了,不是資料更新
        if wrate > 0.50:
            sys.exit(f'欄位索引 [{wi}] 有 {wrate:.0%} 的譜面對不上，判定為欄位對應錯誤或上游改格式，中止且不寫檔')
        if rate > 0.35:
            sys.exit(f'整體不符 {rate:.0%} 過高，來源可能有問題，中止且不寫檔')
        print('    （不符集中在特定曲目而非特定欄位，判定為上游重新模擬過的譜面，放行）')


def dump(path, header, body):
    """內容沒變就不寫檔,CI 才不會空提交。"""
    text = header + body
    if path.exists() and path.read_text(encoding='utf-8') == text:
        print(f'  {path.name} 內容未變，不寫檔')
        return False
    path.write_text(text, encoding='utf-8')
    print(f'  已更新 {path.name}（{len(text) / 1024:.0f} KB）')
    return True


def main():
    songs, wins = build()
    print(f'重建完成:{len(songs)} 首')
    verify(songs)

    j = lambda o: json.dumps(o, ensure_ascii=False, separators=(',', ':'))

    dump(OUT,
         '// 曲庫（EP 計算用）：由 tools/build-ep-songs.py 自 music_metas 與 master 資料重建\n'
         '// d[難度] = [lv, notes, base, baseAuto, soloSkill, soloS6, multiSkill, multiS6, autoSkill, autoS6, fever]\n'
         '// soloSkill 等為「前 5 個技能窗的係數總和」，S6 為第 6 窗（encore／隊長）。\n'
         '// 想看每一個技能窗各自的倍率請用 data/ep-song-windows.js。\n',
         f'export const EP_SONGS = {j(songs)};\n'
         'export const ENERGY_MULT = {0:1,1:5,2:10,3:15,4:20,5:25,6:27,7:29,8:31,9:33,10:35};\n'
         'export const OVERHEAD = 15;\n'
         "export const DIFF_NAMES = {E:'EASY',N:'NORMAL',H:'HARD',X:'EXPERT',M:'MASTER',A:'APPEND'};\n")

    dump(OUT_W,
         '// 每個技能窗各自的影響倍率（由 tools/build-ep-songs.py 產生）。\n'
         '// w[難度] = { s: 個人, m: 協力, a: 自動 }，各為 6 個技能窗的係數陣列；\n'
         '// 第 6 窗是 encore（隊長）。分數 = ⌊(base ＋ Σ 窗i係數×窗i技能%/100) × 綜合力 × 4⌋。\n'
         '// 體積較大，按需載入，不要跟 ep-songs.js 一起在首屏拉。\n',
         f'export const EP_SONG_WINDOWS = {j(wins)};\n')


if __name__ == '__main__':
    main()
