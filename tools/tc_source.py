"""台服 master 的來源與後備。

2026-09 起改以 Team-Haruki/haruki-sekai-tc-master 為主：它跟著台服 6.4（Nuverse）更新，
卡片、歌曲、活動與 eventTotalPowerLimits 都比 Sekai-World 的 tc-diff 新；
Sekai-World 那份停在 6.0.0.51，只剩 userInformations 還會動。

Haruki 那份少了 19 張表（configs、versions、userInformations、mobCharacters 等），
欄位則與 Sekai-World 相同，所以逐檔後備：Haruki 回 404 就改抓 Sekai-World 的同名檔。
"""
import json
import urllib.error
import urllib.request

TC = 'https://raw.githubusercontent.com/Team-Haruki/haruki-sekai-tc-master/main/master'
TC_SW = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-tc-diff/main'
UA = {'user-agent': 'pjsk-center-build/1.0 (+https://project-sekai-center.com)', 'Accept-Encoding': 'identity'}


def _get(url, timeout):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def tc_bytes(url, timeout=300):
    """url 以 TC 開頭時,Haruki 沒有這個檔就退回 Sekai-World；明指 TC_SW 的就照抓 Sekai-World。"""
    try:
        return _get(url, timeout)
    except urllib.error.HTTPError as e:
        if e.code != 404 or not url.startswith(TC):
            raise
    return _get(TC_SW + url[len(TC):], timeout)


def tc_json(url, timeout=300):
    """Haruki 那份整張是空陣列時（例如 eventSkillScoreUpLimits），看 Sekai-World 有沒有資料，有就用它。"""
    d = json.loads(tc_bytes(url, timeout))
    if isinstance(d, list) and not d and url.startswith(TC):
        try:
            alt = json.loads(_get(TC_SW + url[len(TC):], timeout))
            if alt:
                return alt
        except Exception:
            pass
    return d
