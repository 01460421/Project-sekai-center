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
