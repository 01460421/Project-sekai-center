"""日服 master（Sekai-World/sekai-master-db-diff）的共用下載器，給 build-skill-table.py 與 build-gacha-pickups.py 用。

cards.json 34 MB、gachas.json 49 MB，每天抓一次很浪費：以上游 HEAD commit 當快取鍵，commit 沒變就讀本機快取
（CI 用 actions/cache 以 commit 當 key 保存 tools/.cache/jp-master）。查不到版本（離線、API 額度）就照舊直接抓。
"""
import json
import os
import pathlib
import urllib.request

JP = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-diff/main'
CACHE = pathlib.Path(os.environ.get('JP_MASTER_CACHE') or (pathlib.Path(__file__).resolve().parent / '.cache' / 'jp-master'))
_jp_rev = None


def jp_rev():
    """上游 sekai-master-db-diff 的 HEAD commit:同一個 commit 的檔案內容不會變,拿它當快取鍵。
    查不到(離線、API 額度)就回 None,照舊直接抓。"""
    global _jp_rev
    if _jp_rev is None:
        _jp_rev = ''
        try:
            headers = {'user-agent': 'pjsk-center-build/1.0', 'accept': 'application/vnd.github+json'}
            if os.environ.get('GITHUB_TOKEN'):
                headers['authorization'] = 'Bearer ' + os.environ['GITHUB_TOKEN']
            req = urllib.request.Request('https://api.github.com/repos/Sekai-World/sekai-master-db-diff/commits/main', headers=headers)
            with urllib.request.urlopen(req, timeout=30) as r:
                _jp_rev = (json.loads(r.read()).get('sha') or '')[:12]
        except Exception:
            _jp_rev = ''
    return _jp_rev or None


def get_jp(name):
    """日服 master。cards.json 有 34 MB,每天抓一次很浪費:上游 commit 沒變就讀本機快取
    (CI 用 actions/cache 以 commit 當 key 保存 tools/.cache/jp-master)。"""
    rev = jp_rev()
    f = CACHE / rev / name if rev else None
    if f and f.exists():
        return json.loads(f.read_text(encoding='utf-8'))
    req = urllib.request.Request(f'{JP}/{name}', headers={'user-agent': 'pjsk-center-build/1.0'})
    with urllib.request.urlopen(req, timeout=300) as r:
        raw = r.read()
    if f:
        try:
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(raw)
        except OSError:
            pass
    return json.loads(raw)


