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
-  存石規劃（`plan.html`）- 把 `data/schedule-forecast.js` 的未來卡池（日服加一年的預測，官方已排標綠）排成 6～24 個月的時間軸，每池的 PU 卡對照 Haruki 公開 suite 的持卡標出已有／缺；填免費／付費水晶、招募券與每日／每期活動／每月收入，推算到每一池時有幾顆、可抽幾抽，勾「想抽」（10／50／100／天井）後算夠不夠、抽完剩多少、至少中一張 PU 的機率，SVG 走勢圖標出不夠的池。計畫存 `localStorage` 的 `sekai-plan-v1`，分享連結把輸入值與勾選編進 hash。
-  帳號分析（`profile.html`）- 填 Player ID 把公開遊戲資料整理成分析：綜合力拆解、各難度 Clear／FC／AP（台服曲目數為分母）、角色平均等級與最低五位、每位角色的挑戰 Live 分數與關卡進度、各難度最容易補的下一首 FC／AP（依 EMERALD 定數）與最難紀錄、各稀有度與各角色 4★ 收集率、豆森材料庫存，兩個 ID 並排比較。台服讀 HiSekai 公開檔案，兩服再讀 Haruki 工具箱公開 suite（`games.project-sekai-center.com/haruki/public/…`）；大數字 ID 以字串解析。
-  豆森工作室（`mystudio.html`）- 圖片／文字／角色頭像轉成 MySekai 彩色方塊或瓷磚的像素畫（Oklab 配色＋抖色），算每色塊數與木材／小石子／花瓣材料、逐列／逐色／由中心的建築步驟、匯出帶座標的設計圖、一格一格播放建造過程；內部設計分頁用 `data/fixtures-index.js` 全部家具在格子上擺設（旋轉、順序、材料、播放）；生日模板選角色做代表色看板。作品存 `localStorage` 的 `sekai-mystudio-v1`，分享連結把格子 RLE 進 hash。資料 `data/mysekai-studio.js` 由 `tools/build-mysekai-studio.py` 產（色碼表寫在腳本裡，新顏色上市補一行）。
-  迴響之境（`echoes.html`）- 在六個 SEKAI 之間漂流的抽象網頁冒險：跟著每個世界的 BPM 踩拍前進（Perfect 累積順暢度）、ATB 戰鬥與共鳴爆發、每 5 層三選一的和弦強化、會出事的選擇事件、按住調音的鍛造、煉金、攪拌料理、擦唱片打工、一筆連線的礦脈採集、天賦星圖、扭蛋機與成就；另有致敬《災難公關》的「危機記者會」填詞派對（和三位口味不同的 NPC 輪流當評審）。存檔在 localStorage，聲音全用 WebAudio 即時合成
-  製作工具（站內頁，側欄「小遊戲與製作」）：**樂曲追加圖產生器** 做官方風格的「樂曲追加決定」圖，選曲自動帶入曲圖、作詞／作曲／編曲、MV、APPEND、原唱與 SEKAI ver. 成員，底圖用官方原檔、SEKAI ver. 框放官方團體標誌，附片假名轉換器（羅馬拼音／平假名 → 片假名），1920×1080 PNG；**譜面預覽產生器** 把整首官方譜面攤成直欄式的圖（點擊、關鍵、滑鍵、軌跡、長條、引導線），每小節標 combo、BPM 與技能點，也能上傳自己的 .sus
-  排程預測（追活動 → 活動總覽的分頁籤）：台服的活動與卡池 id、素材都跟日服一樣，開放時間是日服同一天、同一個當地時刻再加一年；`tools/build-schedule-forecast.py` 每一期只用它之前幾期的命中率在四條候選規則裡挑一條來預測，再跟台服 master 的實際時間比（逐期回測），把未來一年的活動與卡池預測（卡池附 PU 卡、所屬活動、分類修正量與信心，並標出跟站上卡池列表差幾天）、回測表、延遲歷史、各類卡池的偏差分布寫成 `data/schedule-forecast.js`。日服也還沒公布的期數另有第二層：用日服自己的年度規律（去年同日的下一期、結算後隔兩天 15:00；類型與長度照去年同時段、團體給最久沒輪到的前兩名；卡池每一類在去年同日／活動開始日 12:00／生日前 4 天／每月第一個週一／每月 12 日裡挑回測最準的）往後連推一年，再換成台服時間，並附連鎖回測的準度。每一期也列出角色、屬性、技能：日服已公布的照 master（加成屬性、加成角色、活動卡與 PU 卡的技能分類），沒公布的列屬性候選（屬性輪替）、4★ 可能輪空的團員、生日卡屬性（五年一輪），各自附逐期回測
-  活動資料（追活動 → 活動總覽的分頁籤）：任一期活動的時程（開始、中場發表、WL 章節、結算、排名公布、獎勵發放、結束、活動商店截止）、加成屬性與角色、活動卡分「抽卡取得」與「活動商店」、當期卡池與 PU 卡、每段名次的排名獎勵、WL 章節與嘉年華隊伍；資料由 `tools/build-event-info.py` 每天從台服 master 建成 `data/event-info.js`
-  活動分布甘特圖：卡池／活動兩種模式、12～36 個月或全部、每月固定寬度可橫向捲動、季線與年份、今天虛線、條裡寫名稱、依池種／活動類型上色附圖例、滑過看說明、點一條開卡池詳情或活動資料、匯出 PNG
-  Haruki 專區「背包」：把匯入的整份遊戲資料攤開——名片（暱稱、等級、自我介紹、名片上的三個稱號與羈絆稱號、頭像框、自訂名片、貨幣）、稱號（全部持有稱號依活動／成就／角色／生日／排位篩選，稱號底圖與名次圖；羈絆稱號）、資源（素材依種類分組、豆森素材）、跑榜（各期活動 P 與本站歷期前百的名次、World Link 各章名次、排位賽季段位與勝負）、歌曲（各難度玩過／FC／AP 與未 FC 清單）、收集（卡片、服裝、劇情閱讀率、任務）、原始資料（Haruki 給的每個區塊有幾筆）；純函式在 `js/haruki.js` 的 `hzBag*`，`tests/haruki-zone.mjs` 有測試
-  Haruki 專區 豆森「今日資源」的實際地圖：四個採集場所鋪 Lunabot／MiddleRed 的烤森俯視底圖（`img/mysekai/site-{5,6,7,8}.webp`，對位數字照 Haruki-Cloud 的場所設定，見 `js/haruki.js` 的 `HZ_MAP_CAL`），採集點照遊戲座標放，每一點排出還沒採的素材縮圖與剩餘數量，稀有資源紅框、稀有採集點紫光、出生點紅叉、採過的淡掉，可切「顯示已採完」「只看稀有」
-  台服／日服切換（頁首「伺服器・語言」）：`?srv=jp` 或記住上次選擇，換伺服器整頁重載。日服模式下首頁換成**日服現況**（`data/jp-now.js`，`tools/build-jp-now.py` 每天從 Sekai-World 日服 master 算：版本、近期與未來活動含加成與活動卡、開放中的卡池含 PU 卡、新曲），活動排名走 Worker 的 `/haruki/jp/…`（Haruki 日服追蹤器），卡片、圖鑑與 Haruki 專區改讀日服 master；每頁支援到哪裡見 `js/app.js` 的 `SRV_JP`／`SRV_TW_ONLY`，只有台服資料的頁面會在頁首提示。日服現況頁底部與資源連結頁收錄網路上仍在更新的日服資源（`JP_RES`）。Haruki 匯入在日服模式另存 IndexedDB 的 `suite-jp`，不動台服的收集率與 B30
-  介面語言（同一個按鈕）：`js/i18n.js` 在 DOM 上換字，不重畫頁面。簡中用 OpenCC（`vendor/opencc-t2cn.js`，台灣正體→大陸簡體含詞彙）整站轉換；英文、日文是介面詞典（導覽、頁名、頁首、日服現況、客服視窗），整句對得上才換，其餘維持中文。`?lang=` 或記住上次選擇
-  顯示版本（`sekai-skin`）：原版／文青版／舞台版，加上六個團體的セカイ版。文青版在同一套版面上換成深藍 × 香檳金、襯線標題（Noto Serif TC）、Cormorant Garamond 數字與直角細框，網站 icon、分頁與主畫面 icon、PWA manifest（`manifest-literary.webmanifest`）一起換成「世」字章（`icons/icon-literary*`）。樣式全在 `app.html` 的 `:root.skin-literary` 區塊：色票走變數，inline style 的圓角與字型用 `!important` 統一改寫（50% 的圓形照舊，`.lit-keep` 保留原樣）；頁首小腳本在第一次繪製前掛 class、換 icon。第一次進站的功能引導第一步、「自訂首頁 → 資料設定」與功能介紹頁都能切換；選了文青版時配色風格（tone）、團體主題色（unit）與合鳴只記住、不套用，切回原版就恢復
-  舞台版（`skin-stage`）：參考 Awwwards 近年得獎站的手法（超大字級、等寬標註與細線、單一強色、捲動進場與換頁轉場），把整站當成一座演唱會舞台。側欄群組是五幕節目單（CSS counter 的 ACT I–V），內容區頂端是演目大標（`.stage-head`：幕次、群組、頁面路徑、頁名），區塊標題前是曲目編號（M01…）；首頁主視覺是透視的譜面軌道＋判定線，倒數用 Doto 點陣字的 LED 看板、36 格亮起的進度條，最上面是當期活動與今日摘要的跑馬燈（`stageTicker`）；捲動進場用 `animation-timeline: view()`，換頁是 View Transition 的布幕，滑鼠追光圈（`_stageFx`）只在有滑鼠、沒開減少動態時建立。燈色 `--sig` 預設訊號橘，團體主題色在這一版不停用而是換燈色（應援色）；按鈕白字用 `--sig-btn`（深一階、對比 ≥ 4.5）。字型 Archivo／Doto／JetBrains Mono／Noto Sans TC 只在選了舞台版時載入。樣式在 `app.html` 的 `:root.skin-stage` 區塊，內嵌的經典面板由 `js/core.js` 的 `applySkin` 與 `css/core.css` 套同一組色票；icon 是黑底點陣「世」（`icons/icon-stage*`、`manifest-stage.webmanifest`）
-  六個團體的セカイ版（`skin-sekai` ＋ `skin-<版本>`）：筆記本版 `notebook`（Leo/need・教室：橫線筆記本、藍原子筆、紙膠帶，深色是黑板粉筆）、偶像版 `idol`（MMJ・舞台：雷射膜小卡、粉彩、星星閃粉）、街頭版 `street`（VBS・街頭：孔版海報、網點、貼紙、封鎖膠帶）、樂園版 `park`（ワンダショ・樂園：馬戲團海報、條紋帳篷、跑馬燈泡、票根）、留白版 `void`（ニーゴ・誰もいないセカイ：霧白虛空、髮絲線、極細大字、訊號干擾）、音軌版 `track`（虛擬歌手・VOCALOID 編輯器：鋼琴捲簾、音符方塊、播放頭）。六版共用一層骨架，全部走 `--sk-*` 變數（字型、圓角、主視覺、側欄、分頁、底部導覽），每版只給色票與自己的招牌細節；團體主題色在這六版照常掛，`--sk-u`／`--sk-u-ink`／`--sk-u-ink-d` 是那一團的原色、淺底文字色、深底文字色，沒選就是該版自己的團。頁頭大標沿用 `.stage-head`（多了頁序 `.sk-no` 與日期 `.sk-date`），首頁跑馬燈沿用 `.stage-ticker`。字型只在選了那一版時載入（`SKIN_FONTS`）；icon 與 manifest 是 `icons/icon-<版本>*`、`manifest-<版本>.webmanifest`；內嵌的經典面板用 `css/core.css` 最後的同一組色票
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
| `data/borders-db-jp.js` | 由 `tools/build-borders-db-jp.py` 產生（每日排程）：日服版榜線資料庫，形狀同 `data/borders-db.js`（`window.BORDERS_DB`，交換所為空）。活動資訊取自日服 master，主榜終線取自 Sekai Viewer 的排名快照（Haruki 活動追蹤器當後備與對照），WL 章節榜取自 Haruki；抓過的終線快取在 `tools/border_model/jp-finals.json`，每天只補新結束的期數 | 一年 immutable（戳記） |
| `data/*-jp.js` | 日服版資料，形狀與匯出名稱跟台服那份相同，前端換 import 就好：`event-info-jp.js`、`lives-index-jp.js`、`fixtures-index-jp.js`、`stories-index-jp.js`、`mysekai-talks-index-jp.js`、`mysekai-events-jp.js`、`support-events-jp.js`（日服 master 沒有應援活動，空清單）、`data-built-jp.js`、`cards-extra-jp.js`、`gacha-pickups-jp.js`。同一支建置腳本設 `MASTER_SRV=jp` 就改吃日服 master（`tools/tc_source.py`，下載走 `tools/jp_master.py` 的快取）；`gachas-jp.js` 是日服卡池列表（形狀同 `sekai-data.js` 的 `GACHAS`），由 `tools/build-gachas-jp.py` 產生；`gachasim-jp.js` 是日服抽卡模擬的卡池（近 13 個月＋進行中與已排好的池，卡片 id 集合以連續段與差分壓縮，約 60 KB，前端解回台服 master 形狀），由 `tools/build-gachasim-jp.py` 產生。每日排程（商城、曲庫那兩支）會重建；`cards-extra-jp.js` 跟 `cards-index-jp.js` 一樣是有新卡時手動跑 `tools/build-cards-index.py jp` | 一年 immutable（戳記） |
| `js/help.js`、`js/i18n.js` | 線上客服與介面翻譯，延後載入（不壓縮，跟 `js/haruki.js` 一樣由 `stamp-assets.py` 戳記） | 一年 immutable |
| `data/event-info.js` | 由 `tools/build-event-info.py` 產生：每期活動的時程、加成屬性與角色、活動卡（來源 0 抽卡／1 活動商店）、排名獎勵（名次區間 → 道具；稱號的名稱／稱號組／底圖與名次圖 abn、素材名、技能升級譜名、頭像框組與角色都從 master 帶來，頁面只放遊戲內圖）、WL 章節、嘉年華隊伍；活動資料頁與甘特圖的活動模式進頁才載 |
| `unit-img/` | 追加圖產生器的圖片素材：六個團體的官方標誌（webp，取自官方網站）與公告圖底圖 `songcard-bg.webp`；同源檔案所以 canvas 不會被污染、能直接匯出 |
| `plan.html` | 獨立頁：存石規劃。吃 `data/schedule-forecast.js`、`data/mysekai-studio.js`、`data/cards-index.js`；持卡從 Haruki 公開 suite 抓；`window.__plan` 給煙霧測試 | 每次重新驗證 |
| `profile.html` | 獨立頁：帳號分析。吃 `data/mysekai-studio.js`（角色、挑戰關卡數）、`data/songs-index.js`、`data/cards-index.js`、`data/fixtures-index.js`、`data/b30-consts.js`；資料來源 HiSekai 與 Haruki 公開 suite 都在瀏覽器直接抓；`window.__profile` 給煙霧測試 | 每次重新驗證 |
| `mystudio.html` | 獨立頁：豆森工作室。只吃 `data/mysekai-studio.js` 與 `data/fixtures-index.js`（戳記由 `stamp-assets.py` 改寫），家具與素材縮圖從 storage.sekai.best 抓；`window.__mystudio` 給煙霧測試 | 每次重新驗證 |
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

程式裡載資料檔一律寫 `import(scData('ep-songs.js'))`，不要把 `data/…?v=` 寫死：資料檔的雜湊放在
`data/stamps.js`（每次都向伺服器確認），每日排程重建資料只改那個小檔，`js/app.min.js` 與 `app.html` 不必換新。
寫死的戳記會讓 `stamp-assets.py --check` 失敗。

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
- 觀測（2026-11）：`worker/src/telemetry.js` 收匿名使用統計與前端錯誤（`POST /t`，前端 `js/app.js` 的 `teleTrack`／`teleErr`；設定頁可關、尊重 DNT；管理頁「流量與錯誤」分頁看 `/admin/tele`）。`worker/src/pipeline.js` 每小時查 GitHub Actions，排程工作失敗或太久沒成功就寫 events 通知管理員；`/ops/status` 公開給 `?page=status`（系統狀態頁），`data/stamps.js` 的 `SC_DATA_AT` 是各資料檔最近變動日。`.github/workflows/canary.yml` 每小時打正式站關鍵端點，壞了 job 變紅。
- 隊伍分享連結（2026-11）：跑榜工作室（`js/core.js` 的 `RunStudio`）的 `sharePreset()` 把 `_presetVals()` 編成 base64url JSON 放在 `/deckpro?rs=…`；App 的 `URL_KEYS.deckpro = ['rs']`，`deckProSrc` 把 `rs` 原封不動轉給內嵌的 `index.html?embed=calc&rs=…#run-studio`，`RunStudio.ensure()` 資料就緒後 `_applyUrlPreset()` 套上（`_decodePreset` 只收白名單欄位、每欄最多 40 字）。換到別頁就清掉 `rs`。
- 玩家榜線回報（2026-11）：`worker/src/contrib.js` 的 `POST /contrib`（text/plain，只收本站 Origin；每人每期 20 分鐘一筆，Player ID 在 Worker 端雜湊成 12 碼，不存 ID／IP）與 `GET /contrib?ev=&srv=`（每人最新一筆，邊緣快取 60 秒）。前端 `js/app.js` 的 `contribPush()`（拿到自己名次後、每 30 分鐘一筆，`sekai-contrib`='0' 關閉）、`loadContrib()`、`contribEstimate()`（官方段位當錨點，回報點要落在所屬段位的分數區間內，目標名次用 log 名次內插）；排名頁「分段榜線」分頁顯示，回顧頁顯示人數。測試 `worker/test/contrib.mjs`。
- 可讀性（2026-11）：遊戲屬性色、技能分類色拿來當文字用 `this.txt(色)`（回 `color-mix(in oklab, 色 k%, var(--ink))`，淺色主題壓深、深色主題提亮；只能給 CSS，不能給 canvas），`SM_ATTR`／`CL_GROUP`／卡片頁 `ATTR`／豆森 `TYPE` 都已是文字安全版。狀態色用 `--ok`／`--warn`／`--bad`，不要再寫死 `#2fb37a` 這類淺色。手機（`pointer:coarse`）按鈕至少 32px、分頁籤 40px；`max-width:640px` 時 9～10.5px 的字一律 11px（app.html 那段 `@media` 列了所有相關 class，新增小字 class 請加進去）。全站體檢腳本的做法見 `tests/a11y.mjs`（axe-core），基準 serious ≤ 100。
- 一鍵訂閱（2026-11）：活動頁／首頁活動卡、卡池列表、排名頁分段榜線上的 🔔 走 `onWatchGo`（js/app.js handlers）：把 `wForm` 帶好（kind／mode／vals）再 `go('account')` 捲到 `#ac-watch`；訂閱種類與欄位來自 Worker 的 `/api/watch-kinds`（榜線門檻、進出段位、玩家動態、活動開始／結算、卡池開放／結束、WL 章節），正式站的推播金鑰（VAPID）已設好。計算中心活動試算的逐日配速表（`planDays`）、素材圖鑑的收藏家具材料總計（收藏 kind=fix ＋ `data/fixtures-index.js` 的製作素材；持有量讀 Haruki 公開 suite）、設定頁的 CSV 匯出（`bkExportCsv`：持有卡片是 `CARD_KEY` bitmap 解碼）也在這一輪。
- 網址（2026-11）：分頁網址是路徑形式 `/songs`、`/recap?recapEv=183`（`_urlOf`／`_readUrl`；`?page=X` 仍認得，本機 `python3 -m http.server` 只給 `/app.html` 所以 localhost 上維持 `?page=`）。vercel.json 的 catch-all 回 app.html、尾斜線 308、爬蟲改寫到 `share/<page>.html` 有 `/X` 與 `?page=X` 兩條；`sw.js` 把這些路徑都併進 `/app.html` 這個快取鍵（獨立頁 starmap／theater… 除外）；sitemap 與 share 頁的 canonical 都是路徑形式。站內要產分享連結用 `this._linkTo(page, extra)`。
- 品質門檻（2026-11，都在 ci.yml）：`tools/validate-data.mjs` 驗資料檔結構（`tools/commit-data.sh` 提交前也跑，驗不過不提交）；`tests/budget.mjs` 首屏檔案 gzip 預算（要調上限連同原因一起改）；`tests/i18n-gap.mjs` 英日翻譯缺漏不能多於基準（補了翻譯就把 MAX 往下調）；`tests/a11y.mjs` axe-core critical 零、serious 不超過基準；`tests/sw.mjs` 含路徑形式；`tests/share-pages.mjs`。本機跑 a11y：`npm i --no-save axe-core`（或 `AXE=` 指到 axe.min.js）。
- 頁面模組化：進頁才載的程式都走同一個做法——`js/<x>.js` 匯出 `xMembers()` 回傳成員物件，App 用 `import('./js/x.js?v=…').then(m => Object.assign(this, m.xMembers.call(this)))` 掛上（`loadCar`／`loadMaker`／`loadRecapMod`），`stamp-assets.py` 的 `CODE` 表要加那個檔，`tools/i18n-strings.mjs` 的檔案表也要加。`js/recap.js`（活動回顧與預測準確度）是範例：app.js 只留 `loadRecap`／`loadAccuracy` 兩個「先載模組再呼叫」的殼，模板在模組載好前拿到 `recapLoad`／`accLoad`。
- 活動回顧與預測準確度（2026-11）：`?page=recap` 讀 `data/history/<期數>.json`（結算後就是完整的）、`BORDERS_DB` 的官方終線與 `bdbRef` 歷屆對照、`data/border-accuracy.json`（`tools/build-border-accuracy.py` 每天在 billing-refresh 重擬模型後跑，每期留一法在 25／50／75／90% 進度各預測一次）與這台裝置的本機快照（`sekai-snap-<期數>`）。`?page=accuracy` 只讀 `data/border-accuracy.json`。
