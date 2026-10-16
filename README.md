# Project SEKAI 資源中心

世界計畫 彩色舞台 feat. 初音未來 資訊整合網站

## 功能

-  活動日曆 - 卡池開放時間視覺化
-  卡池列表 - 台服卡池時間表
-  歌曲資料庫 - 完整樂曲清單
-  EP 計算器 - 精確 EP 計算、活動試算、控分工具
-  SEKAI 星圖（`starmap.html`）- 全曲庫化成一片可互動的星空：BPM×定數、年代×定數、曲長×密度三種投影，團體上色、作曲者星座、搜尋高亮、可分享的星星連結；詳情可試聽（與曲庫頁同音源：第 10 秒起 60 秒、淡入淡出），「星空電台」在看得見的星之間隨機漫遊播放
-  衝榜劇場（`theater.html`）- 前百名的每一場：Worker 每 15 秒記一次的逐場紀錄攤成脈動牆（時間×名次）、節奏熱圖、選手剖析（場次、分布、作息分段、名次軌跡）、此刻統計與即時紀錄，拖曳時間可回放整期
-  SEKAI 聲紋（`soundprint.html`）- 每一首歌的傅立葉肖像：在瀏覽器裡對全曲音訊做短時傅立葉轉換（Hann 2048／跳距 512／128 對數頻帶），畫成時間繞一圈、頻率由內而外的極座標聲紋；另有攤平頻譜與自相似矩陣的結構圖，推算調性（Krumhansl）、速度（自相關，與官方 BPM 對照）、亮度、動態、低中高頻與段落；可試聽任一刻、輸出海報
-  迴響之境（`echoes.html`）- 在六個 SEKAI 之間漂流的抽象網頁冒險：跟著每個世界的 BPM 踩拍前進（Perfect 累積順暢度）、ATB 戰鬥與共鳴爆發、每 5 層三選一的和弦強化、會出事的選擇事件、按住調音的鍛造、煉金、攪拌料理、擦唱片打工、一筆連線的礦脈採集、天賦星圖、扭蛋機與成就；另有致敬《災難公關》的「危機記者會」填詞派對（和三位口味不同的 NPC 輪流當評審）。存檔在 localStorage，聲音全用 WebAudio 即時合成

## 伺服器機器人（bot/）

`bot/` 是獨立的 Discord 機器人專案，**100 個娛樂與互動功能**：塔羅／易經／星座／御神籤等占卜、MBTI／五大／九型等性格測驗、配對與結婚等社交、21 點／踩地雷／Wordle 等小遊戲、投票與真心話等趣味、簽到／商店／樂透的經濟系統、讀本站資料的模擬轉蛋與歌曲問答、等級成就與抽獎提醒、歡迎訊息等伺服器工具，以及接上 Claude 的 `/chat` **AI 對話**（有人設與記憶、認識使用者、能替他查資料或執行指令；容器版 @機器人 就會回話）。核心與 Discord 分離、每個功能都有測試。可以部署到 **Cloudflare Workers**（HTTP 互動模式，跟 `worker/` 一樣用 wrangler，`bot-deploy.yml` 自動部署）或跑成 **Docker 容器**（GHCR 映像；Fly.io／Railway／Render 設定檔都附了）。安裝、部署與完整功能清單見 [bot/README.md](bot/README.md)。

## 檔案結構

| 路徑 | 說明 | 快取 |
|---|---|---|
| `*.html` | 頁面。`app.html` 是首頁 SPA，`index.html` 同時是經典版與五個內嵌面板的來源 | 每次重新驗證 |
| `starmap.html` | 獨立頁：全曲庫星圖。只吃 `data/ep-songs.js`、`data/song-bpm.js`、`data/song-meta.js`、`data/b30-consts.js`，沒有其他依賴 | 每次重新驗證 |
| `theater.html` | 獨立頁：衝榜劇場。資料直接向 `games.project-sekai-center.com/games?ev=` 拉逐局紀錄（gzip，一期約 5 MB），活動進行中每 15 秒增量更新；活動資料用 HiSekai `/event/list` 與 `data/borders-db.js` | 每次重新驗證 |
| `soundprint.html` | 獨立頁：SEKAI 聲紋。曲庫吃 `data/ep-songs.js`、`data/song-bpm.js`、`data/song-meta.js`、`data/b30-consts.js`；音源直接向 sekai.best 資產鏡像拉全曲 mp3（約 2 MB），全部在瀏覽器的 Worker 裡做 FFT，不經本站伺服器 | 每次重新驗證 |
| `echoes.html` | 獨立頁：迴響之境。單一檔案、沒有外部依賴（只有 Google Fonts），存檔在 `localStorage` 的 `sekai-echoes-v1`；`window.__echoes` 給煙霧測試用 | 每次重新驗證 |
| `js/core.js` | `index.html` 抽出的共用邏輯，五個 embed 共享同一份 | 一年 immutable |
| `css/core.css` | 同上，共用樣式 | 一年 immutable |
| `data/*.js` | 曲庫、貼圖稱號、卡片對照等靜態資料 | 一年 immutable |
| `data/song-meta.js` | 星圖用的歌曲詮釋資料（團體、發行日、作曲／作詞／編曲、書き下ろし）。`python3 tools/build-song-meta.py` 自 Sekai-World master 重建 | 一年 immutable |
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
- `app.html` 只剩模板；邏輯在 `js/app.js`（由 `tools/split-app.py` 從內嵌 script 抽出）。**改邏輯請改 `js/app.js`**，改完跑 `python3 tools/build-min.py && python3 tools/stamp-assets.py`（`app.html` 載的是壓縮後的 `js/app.min.js`；AI 助手在 `js/ai.js`，登入核准後才動態載入 `js/ai.min.js`；stamp-assets 會核對兩個壓縮檔是不是由目前的來源壓出來的，過期會直接失敗）。語法檢查：`node --check js/app.js`。
- `support.js` 的 `boot()` 看到 `data-dc-script` 有 `src` 而內容為空時會先 fetch 再啟動。
- 側邊欄「特別專案」群組列出星圖與劇場：項目 id 以 `x_` 開頭、網址在 `EXTERNAL` 表，`go()` 看到就直接換頁，不進 PAGES、sitemap、OG 與自訂版面。
- 星圖的彩蛋入口有三個，都走 `openStarmap()`（先一道流星、畫面漸暗再換頁）：首頁右上角那顆會閃的小星（`.egg-star`）、指令面板打「星圖／星空／星座」、任何頁面輸入 Konami 密碼（上上下下左右左右 B A）。
- 私車排班（`?page=car`）呼叫 Worker 的 `/car/api/*`（代理到菜根機器人）與 `/auth/*`。本機開發可用假後端：`python3 -m http.server 8765` 後開 `http://127.0.0.1:8765/app.html?page=car&carmock=admin`（模式：`out`／`admin`／`member`／`qq`／`noid`／`down`，`carmock=off` 關閉；帳密 `demo`/`password1`）。假後端在 `tests/car-mock.js`，只有主機名是 localhost／127.0.0.1 才會載入，`tests/` 也不在 Vercel 部署範圍內。
