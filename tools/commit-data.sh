#!/usr/bin/env bash
# 排程工作（榜線快照、商城資料…）共用的提交步驟。
#
#   tools/commit-data.sh "提交訊息" 路徑1 路徑2 …
#
# 取樣一跑就是一小時，期間 main 常有別的提交。以前是「先重算版本戳、再 rebase」，
# 戳記改到的 app.html / app.min.js 一跟 main 撞就 rebase 衝突，整批榜線資料推不上去。
# 現在分兩段：
#   1. 只提交資料檔（它們只有排程會寫，rebase 不會衝突）；
#   2. rebase 到最新 main 之後才重算版本戳，有變才另外補一個戳記提交。
# 推送失敗就丟掉戳記提交、重新 rebase 再算一次；戳記算不出來也照樣先把資料推上去。
set -u
msg="$1"; shift

if [ -z "$(git status --porcelain -- "$@")" ]; then
  echo "沒有新資料，不提交"
  exit 0
fi
git config user.name  "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -- "$@"
git commit -q -m "$msg [skip ci]"
# 其他步驟順手改到的檔案（例如腳本產生的暫存）不提交，免得擋住 rebase
git reset -q --hard HEAD

restamp() {
  # 戳記會連鎖(ai.js → ai.min.js → app.js)，一輪不一定收斂，最多跑三輪
  for _ in 1 2 3; do
    python3 tools/build-min.py >/dev/null || return 1
    python3 tools/stamp-assets.py >/dev/null || true
    python3 tools/stamp-assets.py --check >/dev/null && return 0
  done
  return 1
}

for i in 1 2 3 4 5; do
  if ! git pull -q --rebase origin main; then
    git rebase --abort 2>/dev/null || true
    echo "第 $i 次 rebase 失敗，稍後重試"
    sleep $((i * 5)); continue
  fi
  stamped=0
  if restamp; then
    if [ -n "$(git status --porcelain)" ]; then
      git add -u
      git commit -q -m "重算版本戳 [skip ci]" && stamped=1
    fi
  else
    echo "::warning::版本戳沒有收斂，先只推資料"
    git reset -q --hard HEAD
  fi
  if git push -q origin HEAD:main; then
    echo "已推送（第 $i 次嘗試）"
    exit 0
  fi
  # main 又前進了：戳記提交作廢，下一輪 rebase 後重算
  [ "$stamped" = 1 ] && git reset -q --hard HEAD~1
  echo "第 $i 次推送失敗，稍後重試"
  sleep $((i * 5))
done
exit 1
