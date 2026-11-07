#!/usr/bin/env python3
"""資料管線檢查（給 .github/workflows/canary.yml 用）：從 stdin 讀 GitHub Actions 的 runs JSON，
排程工作最新一次失敗、或太久沒成功就印出原因並以非零結束，讓探針工作變紅（GitHub 會寄信給 repo 擁有者）。

規則跟 worker/src/pipeline.js 的 summarize() 一樣（改一邊要改另一邊）；這裡多一道是因為 Worker 向 GitHub
查詢偶爾會被共用出口 IP 的限流擋下，而 Actions 裡用 GITHUB_TOKEN 查永遠查得到。

    gh api "repos/<owner>/<repo>/actions/runs?per_page=100" | python3 tools/pipeline-check.py
"""
import json
import sys
import time

SCHED = {
    'billing-refresh.yml': ('儲值商品與每日資料更新', 36),
    'ep-songs-refresh.yml': ('EP 曲庫與圖鑑索引更新', 36),
    'bot-deploy.yml': ('機器人部署', 36),
    'border-snapshot.yml': ('榜線快照', 3),
}
BAD = {'failure', 'timed_out', 'startup_failure'}


def parse_ts(s):
    return time.mktime(time.strptime(s, '%Y-%m-%dT%H:%M:%SZ')) - time.timezone


def check(runs, now=None):
    now = time.time() if now is None else now
    by = {}
    for r in runs:
        f = (r.get('path') or '').split('/')[-1]
        if not f:
            continue
        t = parse_ts(r.get('updated_at') or r.get('created_at'))
        w = by.setdefault(f, {'done': None, 'ok': None})
        if r.get('status') == 'completed' and (not w['done'] or t > w['done'][0]):
            w['done'] = (t, r.get('conclusion'), r.get('html_url'))
        if r.get('status') == 'completed' and r.get('conclusion') == 'success' and (not w['ok'] or t > w['ok']):
            w['ok'] = t
    lines, bad = [], []
    for f, (label, max_h) in SCHED.items():
        w = by.get(f, {'done': None, 'ok': None})
        age = (now - w['ok']) / 3600 if w['ok'] else None
        problems = []
        if w['done'] and w['done'][1] in BAD:
            problems.append('最新一次 ' + str(w['done'][1]) + '：' + (w['done'][2] or ''))
        if age is None or age > max_h:
            problems.append('已 %s 沒成功（門檻 %d 小時）' % (('%.0f 小時' % age) if age is not None else '從未', max_h))
        lines.append('%-14s 上次成功 %-12s %s' % (label, ('%.1f 小時前' % age) if age is not None else '無', '；'.join(problems) or '正常'))
        if problems:
            bad.append(label + '：' + '；'.join(problems))
    return lines, bad


def main():
    try:
        runs = json.load(sys.stdin).get('workflow_runs', [])
    except Exception as e:
        print('::error::讀不到 runs JSON：' + str(e))
        return 1
    lines, bad = check(runs)
    print('\n'.join(lines))
    if bad:
        print('::error::資料管線異常：' + '；'.join(bad))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
