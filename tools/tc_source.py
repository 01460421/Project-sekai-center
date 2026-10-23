"""台服 master 的來源與後備；設 MASTER_SRV=jp 時同一批建置腳本改吃日服 master。

2026-09 起改以 Team-Haruki/haruki-sekai-tc-master 為主：它跟著台服 6.4（Nuverse）更新，
卡片、歌曲、活動與 eventTotalPowerLimits 都比 Sekai-World 的 tc-diff 新；
Sekai-World 那份停在 6.0.0.51，只剩 userInformations 還會動。

Haruki 那份少了 19 張表（configs、versions、userInformations、mobCharacters 等），
欄位則與 Sekai-World 相同，所以逐檔後備：Haruki 回 404 就改抓 Sekai-World 的同名檔。

日服（MASTER_SRV=jp）：TC 與 TC_SW 都指向 Sekai-World 的 sekai-master-db-diff，下載一律走
tools/jp_master.py（以上游 commit 當鍵快取，cards.json 34 MB、gachas.json 49 MB 不必每支腳本各抓一次）。
兩服欄位名稱相同，卡片／卡池／活動 id 也共用，所以腳本本身幾乎不用改；輸出檔名用 srv_out() 換成 -jp 版
（event-info.js → event-info-jp.js），台服（沒設 MASTER_SRV）的輸出一個位元組都不變。
"""
import json
import os
import urllib.error
import urllib.request

_srv = (os.environ.get('MASTER_SRV') or 'tw').strip().lower() or 'tw'
if _srv not in ('tw', 'jp'):
    raise SystemExit(f'MASTER_SRV 只能是 tw 或 jp（現在是 {_srv!r}）')
SRV = _srv
SRV_LABEL = {'tw': '台服', 'jp': '日服'}[SRV]

JP = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-diff/main'
if SRV == 'jp':
    TC = TC_SW = JP
else:
    TC = 'https://raw.githubusercontent.com/Team-Haruki/haruki-sekai-tc-master/main/master'
    TC_SW = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-tc-diff/main'
UA = {'user-agent': 'pjsk-center-build/1.0 (+https://project-sekai-center.com)', 'Accept-Encoding': 'identity'}


def srv_out(fname):
    """輸出檔名：台服照舊；日服在副檔名前加 -jp（event-info.js → event-info-jp.js、data-built.js → data-built-jp.js）。"""
    if SRV != 'jp':
        return fname
    stem, dot, ext = fname.rpartition('.')
    return f'{stem}-jp.{ext}' if dot else f'{fname}-jp'


def _get(url, timeout):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def tc_bytes(url, timeout=300):
    """url 以 TC 開頭時,Haruki 沒有這個檔就退回 Sekai-World；明指 TC_SW 的就照抓 Sekai-World。
    日服模式下 TC 開頭的網址改由 jp_master 下載（有快取）。"""
    if SRV == 'jp' and url.startswith(JP + '/'):
        from jp_master import get_jp_bytes
        return get_jp_bytes(url[len(JP) + 1:])
    try:
        return _get(url, timeout)
    except urllib.error.HTTPError as e:
        if e.code != 404 or not url.startswith(TC):
            raise
    return _get(TC_SW + url[len(TC):], timeout)


def tc_json(url, timeout=300):
    """Haruki 那份整張是空陣列時（例如 eventSkillScoreUpLimits），看 Sekai-World 有沒有資料，有就用它。"""
    d = json.loads(tc_bytes(url, timeout))
    if SRV == 'jp':
        return d
    if isinstance(d, list) and not d and url.startswith(TC):
        try:
            alt = json.loads(_get(TC_SW + url[len(TC):], timeout))
            if alt:
                return alt
        except Exception:
            pass
    return d
