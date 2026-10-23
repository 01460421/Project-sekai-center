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
-  製作工具（站內頁，側欄「小遊戲與製作」）：**樂曲追加圖產生器** 做官方風格的「樂曲追加決定」圖，選曲自動帶入曲圖、作詞／作曲／編曲、MV、APPEND、原唱與 SEKAI ver. 成員，底圖用官方原檔、SEKAI ver. 框放官方團體標誌，附片假名轉換器（羅馬拼音／平假名 → 片假名），1920×1080 PNG；**譜面預覽產生器** 把整首官方譜面攤成直欄式的圖（點擊、關鍵、滑鍵、軌跡、長條、引導線），每小節標 combo、BPM 與技能點，也能上傳自己的 .sus
-  排程預測（追活動 → 活動總覽的分頁籤）：台服的活動與卡池 id、素材都跟日服一樣，開放時間是日服同一天、同一個當地時刻再加一年；`tools/build-schedule-forecast.py` 每一期只用它之前幾期的命中率在四條候選規則裡挑一條來預測，再跟台服 master 的實際時間比（逐期回測），把未來一年的活動與卡池預測（卡池附 PU 卡、所屬活動、分類修正量與信心，並標出跟站上卡池列表差幾天）、回測表、延遲歷史、各類卡池的偏差分布寫成 `data/schedule-forecast.js`。日服也還沒公布的期數另有第二層：用日服自己的年度規律（去年同日的下一期、結算後隔兩天 15:00；類型與長度照去年同時段、團體給最久沒輪到的前兩名；卡池每一類在去年同日／活動開始日 12:00／生日前 4 天／每月第一個週一／每月 12 日裡挑回測最準的）往後連推一年，再換成台服時間，並附連鎖回測的準度。每一期也列出角色、屬性、技能：日服已公布的照 master（加成屬性、加成角色、活動卡與 PU 卡的技能分類），沒公布的列屬性候選（屬性輪替）、4★ 可能輪空的團員、生日卡屬性（五年一輪），各自附逐期回測
-  活動資料（追活動 → 活動總覽的分頁籤）：任一期活動的時程（開始、中場發表、WL 章節、結算、排名公布、獎勵發放、結束、活動商店截止）、加成屬性與角色、活動卡分「抽卡取得」與「活動商店」、當期卡池與 PU 卡、每段名次的排名獎勵、WL 章節與嘉年華隊伍；資料由 `tools/build-event-info.py` 每天從台服 master 建成 `data/event-info.js`
-  活動分布甘特圖：卡池／活動兩種模式、12～36 個月或全部、每月固定寬度可橫向捲動、季線與年份、今天虛線、條裡寫名稱、依池種／活動類型上色附圖例、滑過看說明、點一條開卡池詳情或活動資料、匯出 PNG
-  Haruki 專區「背包」：把匯入的整份遊戲資料攤開——名片（暱稱、等級、自我介紹、名片上的三個稱號與羈絆稱號、頭像框、自訂名片、貨幣）、稱號（全部持有稱號依活動／成就／角色／生日／排位篩選，稱號底圖與名次圖；羈絆稱號）、資源（素材依種類分組、豆森素材）、跑榜（各期活動 P 與本站歷期前百的名次、World Link 各章名次、排位賽季段位與勝負）、歌曲（各難度玩過／FC／AP 與未 FC 清單）、收集（卡片、服裝、劇情閱讀率、任務）、原始資料（Haruki 給的每個區塊有幾筆）；純函式在 `js/haruki.js` 的 `hzBag*`，`tests/haruki-zone.mjs` 有測試
-  Haruki 專區 豆森「今日資源」的實際地圖：四個採集場所鋪 Lunabot／MiddleRed 的烤森俯視底圖（`img/mysekai/site-{5,6,7,8}.webp`，對位數字照 Haruki-Cloud 的場所設定，見 `js/haruki.js` 的 `HZ_MAP_CAL`），採集點照遊戲座標放，每一點排出還沒採的素材縮圖與剩餘數量，稀有資源紅框、稀有採集點紫光、出生點紅叉、採過的淡掉，可切「顯示已採完」「只看稀有」
-  台服／日服切換（頁首「伺服器・語言」）：`?srv=jp` 或記住上次選擇，換伺服器整頁重載。日服模式下首頁換成**日服現況**（`data/jp-now.js`，`tools/build-jp-now.py` 每天從 Sekai-World 日服 master 算：版本、近期與未來活動含加成與活動卡、開放中的卡池含 PU 卡、新曲），活動排名走 Worker 的 `/haruki/jp/…`（Haruki 日服追蹤器），卡片、圖鑑與 Haruki 專區改讀日服 master；每頁支援到哪裡見 `js/app.js` 的 `SRV_JP`／`SRV_TW_ONLY`，只有台服資料的頁面會在頁首提示。日服現況頁底部與資源連結頁收錄網路上仍在更新的日服資源（`JP_RES`）。Haruki 匯入在日服模式另存 IndexedDB 的 `suite-jp`，不動台服的收集率與 B30
-  介面語言（同一個按鈕）：`js/i18n.js` 在 DOM 上換字，不重畫頁面。簡中用 OpenCC（`vendor/opencc-t2cn.js`，台灣正體→大陸簡體含詞彙）整站轉換；英文、日文是介面詞典（導覽、頁名、頁首、日服現況、客服視窗），整句對得上才換，其餘維持中文。`?lang=` 或記住上次選擇
-  線上客服（每頁右下角，`js/help.js`）：**小幫手**不用登入、不花額度，當期活動、榜線、卡池、日服與語言這類「現在」的問題直接回數字，功能與玩法從 `ALIASES`、頁面說明與教學大全找，附前往按鈕；**AI 助手**就是站內助手（同一份對話）；**留言**是提問所的 `kind=support`，只有作者與管理員看得到（`worker/src/api.js`），管理員在提問所多一個「客服留言」分類可以回覆

## 伺服器機器人（bot/）

`bot/` 是獨立的 Discord 機器人專案，**100 個娛樂與互動功能**：塔羅／易經／星座／御神籤等占卜、MBTI／五大／九型等性格測驗、配對與結婚等社交、21 點／踩地雷／Wordle 等小遊戲、投票與真心話等趣味、簽到／商店／樂透的經濟系統、讀本站資料的模擬轉蛋與歌曲問答、等級成就與抽獎提醒、歡迎訊息等伺服器工具，以及接上 Claude 的 `/chat` **AI 對話**（有人設與記憶、認識使用者、能替他查資料或執行指令；容器版 @機器人 就會回話）。核心與 Discord 分離、每個功能都有測試。可以部署到 **Cloudflare Workers**（HTTP 互動模式，跟 `worker/` 一樣用 wrangler，`bot-deploy.yml` 自動部署）或跑成 **Docker 容器**（GHCR 映像；Fly.io／Railway／Render 設定檔都附了）。安裝、部署與完整功能清單見 [bot/README.md](bot/README.md)。

## 檔案結構

| 路徑 | 說明 | 快取 |
|---|---|---|
| `*.html` | 頁面。`app.html` 是首頁 SPA，`index.html` 同時是經典版與五個內嵌面板的來源 | 每次重新驗證 |
| `starmap.html` | 獨立頁：全曲庫星圖。只吃 `data/ep-songs.js`、`data/song-bpm.js`、`data/song-meta.js`、`data/b30-consts.js`，沒有其他依賴 | 每次重新驗證 |
| `theater.html` | 獨立頁：衝榜劇場。資料直接向 `games.project-sekai-center.com/games?ev=` 拉逐局紀錄（gzip，一期約 5 MB），活動進行中每 15 秒增量更新；活動資料用 HiSekai `/event/list` 與 `data/borders-db.js` | 每次重新驗證 |
| `soundprint.html` | 獨立頁：SEKAI 聲紋。曲庫吃 `data/ep-songs.js`、`data/song-bpm.js`、`data/song-meta.js`、`data/b30-consts.js`；音源直接向 sekai.best 資產鏡像拉全曲 mp3（約 2 MB），全部在瀏覽器的 Worker 裡做 FFT，不經本站伺服器 | 每次重新驗證 |
| `js/maker.js` | 製作工具（進「小遊戲與製作」的追加圖或譜面頁才載）：樂曲追加圖產生器（選曲自動帶入、官方底圖與團體標誌、片假名轉換器、1920×1080 PNG）與譜面預覽產生器（官方 SUS 解析照 pjsekai 引擎規則、直欄式 canvas、combo／BPM／技能點）。模板在 app.html 的 isSongcard／isChart 兩段 |
| `data/schedule-forecast.js` | 由 `tools/build-schedule-forecast.py` 產生：排程預測頁的規則與命中率、延遲歷史、活動逐期回測、卡池回測、未來活動與卡池預測；離線跑可設 `SCHED_JP_DIR` 指向放 `jp_events.json`／`jp_gachas.json` 的資料夾 |
| `data/jp-now.js` | 由 `tools/build-jp-now.py` 產生（每日排程）：日服版本、最近 4 期與進行中／未來活動（加成屬性、角色、活動卡、WL 章節）、開放中與 60 天內的卡池（PU 卡）、最新 24 首歌；離線跑可設 `SCHED_JP_DIR` | 一年 immutable（戳記） |
| `data/*-jp.js` | 日服版資料，形狀與匯出名稱跟台服那份相同，前端換 import 就好：`event-info-jp.js`、`lives-index-jp.js`、`fixtures-index-jp.js`、`stories-index-jp.js`、`mysekai-talks-index-jp.js`、`mysekai-events-jp.js`、`support-events-jp.js`（日服 master 沒有應援活動，空清單）、`data-built-jp.js`、`cards-extra-jp.js`、`gacha-pickups-jp.js`。同一支建置腳本設 `MASTER_SRV=jp` 就改吃日服 master（`tools/tc_source.py`，下載走 `tools/jp_master.py` 的快取）；`gachas-jp.js` 是日服卡池列表（形狀同 `sekai-data.js` 的 `GACHAS`），由 `tools/build-gachas-jp.py` 產生。每日排程（商城、曲庫那兩支）會重建；`cards-extra-jp.js` 跟 `cards-index-jp.js` 一樣是有新卡時手動跑 `tools/build-cards-index.py jp` | 一年 immutable（戳記） |
| `js/help.js`、`js/i18n.js` | 線上客服與介面翻譯，延後載入（不壓縮，跟 `js/haruki.js` 一樣由 `stamp-assets.py` 戳記） | 一年 immutable |
| `data/event-info.js` | 由 `tools/build-event-info.py` 產生：每期活動的時程、加成屬性與角色、活動卡（來源 0 抽卡／1 活動商店）、排名獎勵（名次區間 → 道具；稱號的名稱／稱號組／底圖與名次圖 abn、素材名、技能升級譜名、頭像框組與角色都從 master 帶來，頁面只放遊戲內圖）、WL 章節、嘉年華隊伍；活動資料頁與甘特圖的活動模式進頁才載 |
| `unit-img/` | 追加圖產生器的圖片素材：六個團體的官方標誌（webp，取自官方網站）與公告圖底圖 `songcard-bg.webp`；同源檔案所以 canvas 不會被污染、能直接匯出 |
| `echoes.html` | 獨立頁：迴響之境。單一檔案、沒有外部依賴（只有 Google Fonts），存檔在 `localStorage` 的 `sekai-echoes-v1`；`window.__echoes` 給煙霧測試用 | 每次重新驗證 |
| `js/core.js` | `index.html` 抽出的共用邏輯，五個 embed 共享同一份 | 一年 immutable |
| `css/core.css` | 同上，共用樣式 | 一年 immutable |
| `data/*.js` | 曲庫、貼圖稱號、卡片對照等靜態資料 | 一年 immutable |
| `data/song-meta.js` | 星圖用的歌曲詮釋資料（團體、發行日、作曲／作詞／編曲、書き下ろし）。`python3 tools/build-song-meta.py` 自 Sekai-World master 重建 | 一年 immutable |
| `vendor/*.js` | React | 一年 immutable |

## 注意：data/history/ 只能增加，不能刪改

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
