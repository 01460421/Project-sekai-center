# Project SEKAI 資源中心

世界計畫 彩色舞台 feat. 初音未來 資訊整合網站

## 功能

-  活動日曆 - 卡池開放時間視覺化
-  卡池列表 - 台服卡池時間表
-  歌曲資料庫 - 完整樂曲清單
-  EP 計算器 - 精確 EP 計算、活動試算、控分工具

## 檔案結構

| 路徑 | 說明 | 快取 |
|---|---|---|
| `*.html` | 頁面。`app.html` 是首頁 SPA，`index.html` 同時是經典版與五個內嵌面板的來源 | 每次重新驗證 |
| `js/core.js` | `index.html` 抽出的共用邏輯，五個 embed 共享同一份 | 一年 immutable |
| `css/core.css` | 同上，共用樣式 | 一年 immutable |
| `data/*.js` | 曲庫、貼圖稱號、卡片對照等靜態資料 | 一年 immutable |
| `vendor/*.js` | React | 一年 immutable |

## ⚠️ data/history/ 只能增加，不能刪改

`data/history/{期數}.json` 是由 GitHub Actions 每 30 分鐘累積的榜線時序，
記錄了 17 段榜線與前 100 名各自的分數曲線。

**這種資料時間過了就永遠補不回來** —— 台服沒有任何現成的時序來源
（HiSekai API 的 `/history`、`/graph` 全是 404；`api.sekai.best` 只追日服，
`region=tw` 回空），刪掉就是真的沒了。

所以：

- **不要 `rm`、不要重新產生、不要改既有的時間戳或數值**
- 要重跑腳本測試，請複製到別的目錄，不要對 `data/history/` 動手
- 腳本與 workflow 都有防線：既有檔案讀不出來會中止而非覆蓋、
  段位組成改變會中止而非重排、樣本數沒增加會中止、
  提交前比對 HEAD 確認沒有任何檔案樣本變少或消失

## 部署

靜態網站，push 到 main 由 Vercel 自動部署。

**改完 `js/`、`css/`、`data/`、`vendor/` 或 `support.js` 之後，提交前務必跑一次：**

```bash
python3 tools/stamp-assets.py
```

這會依檔案內容重算雜湊，更新各 HTML 裡的 `?v=` 版本戳。因為這些檔案用一年期
immutable 快取，沒重新戳記的話使用者會拿到舊檔，出現「新 HTML 配舊 JS」的錯配。
指令是冪等的，多跑幾次沒關係；HTML 本身每次都會重新驗證，不需要戳記。

本地預覽：

```bash
python3 -m http.server 8899
```

## 開發備忘（2026-09）
- `app.html` 只剩模板；邏輯在 `js/app.js`（由 `tools/split-app.py` 從內嵌 script 抽出）。**改邏輯請改 `js/app.js`**，改完跑 `python3 tools/stamp-assets.py`。語法檢查：`node --check js/app.js`。
- `support.js` 的 `boot()` 看到 `data-dc-script` 有 `src` 而內容為空時會先 fetch 再啟動。
