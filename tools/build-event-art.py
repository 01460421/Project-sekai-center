#!/usr/bin/env python3
"""產生 data/event-art.js（MASTER_SRV=jp → data/event-art-jp.js）：每期活動的素材名稱與活動類型。

網站首頁的活動主視覺（logo、角色圖）要用 assetbundleName，HiSekai 只給 id／名稱。以前前端每次開站都去抓
master 的 events.json（台服 1.5 MB）只為了這兩個欄位；這裡先抽好，一期約 40 bytes，整份幾 KB。

  EVART = {活動id: [assetbundleName, eventType], ...}

用法：
    python3 tools/build-event-art.py                  # 台服
    MASTER_SRV=jp python3 tools/build-event-art.py    # 日服
    python3 tools/stamp-assets.py
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from tc_source import TC, SRV_LABEL, srv_out, tc_json

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / srv_out('event-art.js')


def main():
    events = tc_json(f'{TC}/events.json') or []
    art = {str(e['id']): [e.get('assetbundleName') or '', e.get('eventType') or '']
           for e in sorted(events, key=lambda e: e.get('id') or 0) if e.get('id') is not None}
    if not art:
        print('events.json 沒有資料，不更新', file=sys.stderr)
        return 1
    text = (f'/* 由 tools/build-event-art.py 產生，勿手改。{SRV_LABEL}每期活動的素材名稱與類型（首頁活動主視覺用）。 */\n'
            f'export const EVART={json.dumps(art, ensure_ascii=False, separators=(",", ":"))};\n')
    if OUT.exists() and OUT.read_text(encoding='utf-8') == text:
        print(f'內容無變化，不更新 {OUT.name}')
        return 0
    OUT.write_text(text, encoding='utf-8')
    print(f'寫入 {OUT.name}：{len(art)} 期，{OUT.stat().st_size // 1024} KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
