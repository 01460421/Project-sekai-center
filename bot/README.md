# SEKAI 資源中心 伺服器機器人

Discord 伺服器機器人，**100 個娛樂與互動功能**：占卜算命、性格測驗、社交配對、小遊戲、趣味工具、經濟系統、模擬轉蛋、問答與音樂、等級社群、伺服器管理。不只世界計畫，是給任何社群用的大眾向娛樂機器人；世界計畫的曲庫、卡片、卡池資料直接讀 repo 根目錄的 `data/`，跟網站同一份。

```
/tarot spread:三張牌陣 question:這份工作該不該接
/mbti test          /iching question:搬家好嗎        /dream text:夢到掉牙
/blackjack bet:50   /minesweeper                    /wordle
/gacha mode:十連     /speedquiz                      /raffle prize:一杯手搖 minutes:10
```

## 設計重點

- **決定性占卜引擎**：塔羅、易經、星座、御神籤、盧恩……都以「使用者 + 台灣日期 + 主題 + 問題」當亂數種子。同一個人同一天問同一件事，答案不會變；換一天、換問題才會不同。像真的占卜，不是按一下就重抽。配對、評分、八號球也一樣是固定結果。
- **選用的 AI 解讀層**：設了 `ANTHROPIC_API_KEY` 之後，塔羅、易經、解夢、MBTI 的結果會多一段個人化解讀（預設 `claude-opus-5`，啟用伺服器端 fallback，每人每日次數有上限）。**沒設金鑰時整層關閉，其他 99.9% 的功能完全不受影響。**
- **核心與平台分離**：功能模組只認得 `Ctx`（`reply / update / showModal / u() / g() / rng / sessions`），不 import discord.js；`src/index.js` 是唯一的 Discord 介接層。測試直接呼叫核心，不需要 token、不需要裝 discord.js；之後要接 QQ 或網頁只要再寫一個介接層。
- **一個 JSON 檔的持久化**：`state/state.json`，延遲寫入、原子換檔。玩家紀錄以伺服器為單位（每個伺服器各自一套經濟與等級）。介面上百個伺服器都還撐得住，要再大再換 SQLite，功能模組不用改。
- **測試覆蓋每一個功能**：煙霧測試把 100 個指令（含每個子指令）都跑一遍，回應裡每個按鈕、每個選單都按過一次（本人和別人各按一次），並檢查 Discord 的硬限制（embed 長度、每列五個按鈕、custom_id 100 字…）。另有 30 幾個純邏輯與流程測試（21 點牌值、四子棋勝負、轉蛋機率、Wordle 評分、簽到轉帳、投票、結婚、搶答、提醒排程…）。

## 兩種執行方式

同一份核心與 100 個功能，兩個介接層：

| | ☁️ Cloudflare Workers 版（`src/worker.js`） | 🐳 容器版（`src/index.js`） |
|---|---|---|
| 原理 | Discord **HTTP 互動**：Discord 把互動 POST 到 Worker，不用常駐程序 | Discord **Gateway**：長連線，跟一般機器人一樣 |
| 主機 | 無。跟本站的 `worker/` 一樣用 wrangler 部署，狀態放 Durable Object | 任何能跑容器的地方：Fly.io、Railway、Render、VPS、家裡的 NAS |
| 費用 | Workers 免費額度就夠一般社群用（付費方案 US$5／月更寬裕） | 看主機，最小 256 MB 記憶體即可 |
| 功能 | 100 個指令全部可用；但**沒有 Gateway 就收不到聊天訊息**：`/afk` 的自動回覆、`/autoreact`、`/welcome` 這三個被動功能不會動作，`/team` 拿不到語音頻道名單；聊天經驗值改由使用指令累積 | 100 個全部 |
| 自動部署 | `.github/workflows/bot-deploy.yml` 的 `workers` job | 同一支的 `image` job 會把映像推到 GHCR |

### ☁️ 部署到 Cloudflare Workers（全自動，只要一個 token）

repo 已經有 `CLOUDFLARE_API_TOKEN`／`CLOUDFLARE_ACCOUNT_ID`（`worker/` 就是用它們部署的），所以你只需要：

1. **建 Discord 應用程式**：<https://discord.com/developers/applications> → New Application → Bot 分頁 → **Reset Token**，複製 token。
   （同一頁往下，Privileged Gateway Intents 開 **Server Members Intent**，`/someone`、`/team` 列成員才有資料。）
2. **把 token 放進 GitHub**：repo → Settings → Secrets and variables → Actions → New repository secret → 名稱 `DISCORD_TOKEN`。
   想要 AI 解讀就再加 `ANTHROPIC_API_KEY`。
3. **合併這個 PR 到 main**（或 Actions 頁手動跑 `bot-deploy`）。工作流程會自己：部署 Worker → 向 Discord 取 Application ID 與 Public Key → 寫進 Worker 機密 → 把 **Interactions Endpoint URL** 設回 Discord → 註冊 100 個斜線指令。
4. **邀請機器人**：OAuth2 → URL Generator，scopes 勾 `bot` 與 `applications.commands`，權限勾 `Send Messages`、`Embed Links`、`Add Reactions`、`Read Message History` → 開產生的連結選伺服器。

之後每次 main 上動到 `bot/`（或曲庫資料每日更新）都會自動重新部署。檢查：`https://pjsk-bot.<你的子網域>.workers.dev/health` 會回功能數、玩家數與統計（網址在 Actions 的 deploy 步驟會印出來）。

手動做也行（在 `bot/`，第一次會開瀏覽器登入 Cloudflare）：
```bash
npm install
npm run deploy:workers                                         # 印出 Worker 網址
DISCORD_TOKEN=… WORKER_URL=https://pjsk-bot.xxx.workers.dev node scripts/setup-discord.mjs   # 機密＋Endpoint＋註冊指令一次做完
```
自訂網域：把 `wrangler.toml` 的 `[[routes]]` 打開，並在 repo Variables 設 `WORKER_URL`。

本機驗證（不需要任何帳號，會啟動真的 workerd 執行環境，模擬 Discord 簽過名的互動打進來）：`node scripts/probe-workers.mjs`。

Workers 版的內部設計：單例 Durable Object 收所有互動、狀態放它的 SQLite storage（每個玩家、每個伺服器各一個鍵，只寫回這次碰到的鍵），所有互動排隊處理所以經濟系統沒有競態；功能跑超過 2.2 秒（例如 AI 解讀）會先回「延遲」再用 REST 補上結果；每分鐘的 Cron 打 `/tick` 處理提醒、倒數、抽獎。

### 🐳 部署成容器（完整功能）

映像由 GitHub Actions 自動建好：`ghcr.io/01460421/sekai-center-bot:latest`（建置上下文是 repo 根目錄，因為要帶上 `data/` 的四個資料檔）。

```bash
# 任何有 Docker 的機器
docker run -d --name sekai-bot --restart unless-stopped \
  -e DISCORD_TOKEN=… -e APP_ID=… \
  -v sekai-bot-data:/data ghcr.io/01460421/sekai-center-bot:latest
# 自己建：在 repo 根目錄
docker build -f bot/Dockerfile -t sekai-center-bot .
```

| 平台 | 設定檔 | 做法 |
|---|---|---|
| **Fly.io** | `bot/fly.toml` | 在 repo 根目錄：`fly launch --no-deploy --copy-config --config bot/fly.toml`（改 app 名）→ `fly volumes create bot_data --size 1 --region nrt --config bot/fly.toml` → `fly secrets set DISCORD_TOKEN=… APP_ID=… --config bot/fly.toml` → `fly deploy . --config bot/fly.toml` |
| **Railway** | `bot/railway.json` | New Project → Deploy from GitHub → 服務設定 Root Directory 留根目錄、Config-as-code 填 `bot/railway.json`；Variables 加 `DISCORD_TOKEN`、`APP_ID`；Volumes 掛到 `/data` |
| **Render** | `render.yaml`（repo 根目錄） | New → Blueprint → 選 repo；Environment 填 `DISCORD_TOKEN`、`APP_ID` |
| **VPS／NAS** | `bot/Dockerfile` | 上面的 `docker run`；或不用 Docker：`git clone` → `cd bot && npm ci --omit=dev` → pm2／systemd（見下方） |

註冊斜線指令一次即可（任一台有 `.env` 的機器）：`npm run register`，或 `node scripts/setup-discord.mjs --skip-secrets`（不用手抄 Application ID）。

容器版與 Workers 版**不要同時接同一個 Discord 應用程式**：設了 Interactions Endpoint URL 之後 Discord 會把互動送去 Worker，Gateway 那邊就收不到斜線指令。要換回容器版，把 Discord 後台的 Interactions Endpoint URL 清空即可。

## 本機開發

需要 Node.js 22 以上。

1. **建立 Discord 應用程式**：<https://discord.com/developers/applications> → New Application → Bot 分頁 → Reset Token 取得 token。
   在 Bot 分頁的 Privileged Gateway Intents 開啟 **Server Members Intent** 與 **Message Content Intent**（歡迎訊息、聊天經驗值、AFK、自動反應需要）。
2. **邀請機器人**：OAuth2 → URL Generator，scopes 勾 `bot` 與 `applications.commands`，權限至少 `Send Messages`、`Embed Links`、`Add Reactions`、`Read Message History`、`Use External Emojis`。
3. **設定**：
   ```bash
   cd bot
   cp .env.example .env      # 填 DISCORD_TOKEN、APP_ID（General Information 的 Application ID）
   npm install
   ```
4. **註冊斜線指令**：
   ```bash
   GUILD_ID=你的伺服器ID npm run register   # 開發：只註冊到一個伺服器，立即生效
   npm run register                          # 正式：全域註冊，最多一小時生效
   ```
5. **啟動**：
   ```bash
   npm start
   ```

### 常駐執行

pm2：
```bash
npm i -g pm2
pm2 start src/index.js --name sekai-bot --cwd /path/to/bot
pm2 save && pm2 startup
```

systemd（`/etc/systemd/system/sekai-bot.service`）：
```ini
[Unit]
Description=SEKAI 資源中心 機器人
After=network-online.target

[Service]
WorkingDirectory=/path/to/Project-sekai-center/bot
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

狀態檔預設在 `bot/state/state.json`（已 gitignore），備份這個檔就是備份全部玩家資料。關機訊號（SIGINT／SIGTERM）會先把未寫入的變更存檔。

### 環境變數

| 變數 | 必要 | 說明 |
|---|---|---|
| `DISCORD_TOKEN` | 是 | Bot token |
| `APP_ID` | 註冊指令時 | Application ID |
| `DISCORD_PUBLIC_KEY` | Workers 版 | 驗證 Discord 請求簽章 |
| `REGISTER_SECRET` | Workers 版（選用） | `POST /register` 的密鑰 |
| `GUILD_ID` | 否 | 設了就只註冊到這個伺服器（開發用） |
| `STATE_FILE` | 否 | 容器版狀態檔路徑，預設 `bot/state/state.json`（Docker 映像預設 `/data/state.json`） |
| `ANTHROPIC_API_KEY` | 否 | 啟用 AI 解讀 |
| `AI_MODEL` | 否 | 預設 `claude-opus-5` |
| `AI_DAILY_PER_USER` | 否 | 每人每日 AI 解讀次數上限，預設 10 |

### 套件

| 套件 | 用途 | 誰需要 |
|---|---|---|
| `discord.js` ^14 | Gateway 介接層 | 容器版 |
| `@anthropic-ai/sdk` | AI 解讀（動態載入，沒設金鑰不會碰） | 兩版皆選用 |
| `wrangler` ^4（dev） | Workers 打包／部署／本機 workerd | Workers 版 |

核心、100 個功能、註冊腳本與測試不依賴任何套件，`npm test` 不需要 `npm install`。`package-lock.json` 已提交，`npm ci` 可重現。

## 測試

```bash
cd bot
npm test                      # node --test；不需要 token 也不需要 npm install
npm run check                 # 全部檔案 node --check
npm run build:workers         # wrangler 打包檢查（不上傳）
node scripts/probe-workers.mjs  # 真的 workerd 上跑 Workers 版，模擬簽過名的 Discord 互動
npm run features              # 印出 100 個功能的 Markdown 表格（README 下方那份）
```

測試分四支：`registry`（恰好 100、指令 JSON 合法）、`smoke`（每個指令與每個按鈕／選單）、`logic`（純邏輯與流程）、`worker`（Workers 版端對端：真的產 Ed25519 金鑰簽請求，走完驗簽 → Durable Object → 互動回應 → 持久化 → cron → 延遲回應）。

CI（`.github/workflows/ci.yml` 的 `bot` job）每次 PR 都會跑檢查與測試；`bot-deploy.yml` 在 main 上部署。

## 目錄結構

```
bot/
  src/index.js          容器版介接層（discord.js v14 Gateway）
  src/worker.js         Cloudflare Workers 版介接層（HTTP 互動 + Durable Object 儲存 + Cron）
  wrangler.toml         Workers 設定；Dockerfile / fly.toml / railway.json 容器版設定（render.yaml 在 repo 根目錄）
  src/core/
    discord-http.js     HTTP 互動共用：Ed25519 驗簽、REST、互動 payload → 核心輸入（Node 與 Workers 通用）
    store-file.js       FileStore：容器版的 JSON 檔持久化
    bot.js              核心：指令／按鈕／選單／表單分派、冷卻、權限、被動事件、排程 tick
    ctx.js              功能看到的世界（reply/update/showModal/u()/g()/rng/ai）
    registry.js         功能註冊表：驗證、彙整成 Discord 指令 JSON、分類
    store.js            MemoryStore（記憶體層；FileStore 與 Workers 的 DOStore 都繼承它）
    ui.js               embed／按鈕／選單／modal 的原生 JSON 建構、custom_id 編解碼
    opts.js             斜線指令參數簡寫
    oracle.js           占卜引擎：日期種子、星座、生肖、靈數、問卷流程
    sessions.js         進行中的遊戲（記憶體、TTL）、冷卻、計時器
    helpers.js          發錢、任務、成就、等級換算
    sekai.js            世界計畫資料存取（讀 ../../data/*.js）
    ai.js               選用的 AI 解讀（@anthropic-ai/sdk，動態載入）
    rng.js              可種子化的亂數
  src/content/          塔羅 78、易經 64、盧恩 24、星座／生肖文案、MBTI／五大／九型／心理測驗題庫、
                        解夢字典、籤詩、宜忌、幸運餅乾、Wordle／猜單字詞庫、真心話大冒險、話題、題庫…
  src/features/         100 個功能，10 個分類檔，每檔 default export 一個功能陣列
  scripts/register.js   註冊斜線指令（純 fetch，不需要 discord.js）
  scripts/setup-discord.mjs  只憑 token 把 Discord 接好：取 App ID／Public Key、寫 Worker 機密、設 Endpoint、註冊指令
  scripts/list-features.js
  scripts/probe-workers.mjs  本機 workerd 上跑 Workers 版並模擬 Discord 互動
  test/                 harness（假介接層）、registry／smoke／logic／worker 測試
```

## 新增功能

一個功能就是一個物件，放進 `src/features/` 任一檔案的陣列裡：

```js
const hello = {
  name: 'hello', description: '打招呼', category: 'fun',
  options: [str('name', '對誰', { maxLen: 20 })],          // Discord API 原生 option（見 core/opts.js）
  cooldown: 5,                                              // 秒（選用）；admin: true 需要「管理伺服器」；guildOnly: false 允許私訊
  async run(ctx) {
    await ctx.reply({ content: `嗨 ${ctx.opt('name') || ctx.user.name}`, components: [row(button({ id: cid('hello', 'again', ctx.user.id), label: '再一次' }))] });
  },
  buttons: { async again(ctx) { if (!ctx.isOwner(ctx.data[0])) return ctx.reply({ content: '不是你的按鈕', ephemeral: true }); await ctx.update({ content: '嗨嗨' }); } },
  // selects: { action(ctx) }、modals: { action(ctx) }、autocomplete(ctx, focused)、
  // events: { messageCreate(bot, m), memberJoin(bot, m) }、tick(bot, now)
};
```

`custom_id` 一律用 `cid(功能名, 動作, ...資料)` 產生，核心會依功能名與動作分派到 `buttons/selects/modals` 裡的同名處理器，`ctx.data` 是後面的資料段。多步驟狀態放 `ctx.bot.sessions`（記憶體、30 分鐘 TTL），玩家的持久資料放 `ctx.u()`（本伺服器的紀錄）或 `ctx.g()`（伺服器設定與共用狀態）。

寫完跑 `npm test`：煙霧測試會自動把新功能跑一遍並按過每個按鈕。

## 100 個功能

### 🔮 占卜算命（12）

| # | 指令 | 說明 | 互動 |
|---|---|---|---|
| 1 | `/tarot` | 塔羅占卜：單張、三張、二選一、戀愛、五張十字牌陣 | 按鈕 |
| 2 | `/horoscope` | 星座今日運勢（愛情／事業／財運／健康，含幸運色與數字） | 選單 |
| 3 | `/zodiac` | 生肖今日運勢與本命年、相合相沖 | — |
| 4 | `/iching` | 易經卜卦：三枚銅錢起六爻，看本卦與變卦 | — |
| 5 | `/omikuji` | 抽御神籤：大吉到大凶，附願望、戀愛、學業、工作等籤文 | 按鈕 |
| 6 | `/numerology` | 生命靈數：由生日算出主命數、生日數、流年數 | — |
| 7 | `/runes` | 盧恩符文占卜：抽一枚或三枚古弗薩克符文 | — |
| 8 | `/almanac` | 今日宜忌：像老黃曆一樣，但是給現代人看的 | — |
| 9 | `/dream` | 解夢：輸入夢境關鍵字或描述，找出象徵意義 | — |
| 10 | `/birthchart` | 生日全解析：星座、生肖、生命靈數、誕生花與誕生石一次看 | — |
| 11 | `/fortunecookie` | 掰開今天的幸運餅乾：一句籤語加六個幸運數字 | — |
| 12 | `/astrodice` | 占星骰：擲出行星、星座、宮位三顆骰子，快速回答一個問題 | — |

### 🧠 性格測驗（10）

| # | 指令 | 說明 | 互動 |
|---|---|---|---|
| 13 | `/mbti` | MBTI 十六型人格測驗（16 題），或查詢某型與配對 | 按鈕 |
| 14 | `/bigfive` | 五大人格測驗（15 題）：開放、盡責、外向、親和、神經質 | 按鈕 |
| 15 | `/lovestyle` | 戀愛類型測驗（8 題）：烈焰、大地、深海、微風還是全能型？ | 按鈕 |
| 16 | `/animal` | 靈魂動物測驗（8 題）：找出最像你的動物 | 按鈕 |
| 17 | `/color` | 色彩心理測驗：憑直覺選一個顏色，看看現在的你 | 選單 |
| 18 | `/brain` | 左右腦測驗（10 題）：你是邏輯派還是直覺派？ | 按鈕 |
| 19 | `/enneagram` | 九型人格測驗（18 題） | 按鈕 |
| 20 | `/psytest` | 心理測驗：一題定生死的情境小測驗，每次隨機一題 | 按鈕 |
| 21 | `/stress` | 壓力指數測驗（10 題），看看最近的你有多緊繃 | 按鈕 |
| 22 | `/bloodtype` | 血型性格與血型配對 | — |

### 💞 社交互動（11）

| # | 指令 | 說明 | 互動 |
|---|---|---|---|
| 23 | `/ship` | 配對指數：算兩個人的契合度（結果固定不會變） | — |
| 24 | `/zodiacmatch` | 星座配對：兩個星座的愛情與友情相容度 | — |
| 25 | `/namematch` | 姓名配對：輸入兩個名字算緣分 | — |
| 26 | `/marry` | 結婚系統：求婚、接受、離婚、看結婚狀態 | 按鈕 |
| 27 | `/profile` | 個人檔案：等級、水晶、稱號、推し、測驗結果、成就 | — |
| 28 | `/interact` | 互動動作：抱抱、摸頭、戳戳、擊掌、加油、敲頭、餵食、揮手 | — |
| 29 | `/rep` | 給某人一點聲望（每人每天對同一個人一次） | — |
| 30 | `/birthday` | 登記生日、看今日壽星與即將到來的生日 | — |
| 31 | `/afk` | 設定 AFK 狀態；有人 @ 你時機器人會代為說明，你一發言就自動解除 | 被動事件 |
| 32 | `/confess` | 匿名留言／告白：機器人代為發到這個頻道，不會記錄是誰 | — |
| 33 | `/title` | 選擇顯示在個人檔案的稱號（從商店購買或成就取得） | 選單 |

### 🎮 小遊戲（12）

| # | 指令 | 說明 | 互動 |
|---|---|---|---|
| 34 | `/guess` | 猜數字：機器人想一個數字，你來猜（會提示大小） | — |
| 35 | `/rps` | 剪刀石頭布：跟機器人或指定的人對戰 | 按鈕 |
| 36 | `/tictactoe` | 井字遊戲：跟機器人或指定的人下 | 按鈕 |
| 37 | `/connect4` | 四子棋：跟機器人或指定的人對戰 | 按鈕 |
| 38 | `/blackjack` | 21 點：要牌、停牌、加倍，可以押水晶 | 按鈕 |
| 39 | `/slots` | 拉霸機：押注轉一把 | 按鈕 |
| 40 | `/hilo` | 比大小：連續猜對彩池越滾越大，隨時可以收手 | 按鈕 |
| 41 | `/minesweeper` | 踩地雷：5×5、4 顆雷，第一步保證安全 | 按鈕 |
| 42 | `/memory` | 翻牌記憶：4×4 找出 8 組配對，越少步越多獎勵 | 按鈕 |
| 43 | `/hangman` | 猜單字（音樂與世界計畫主題的英文字） | 按鈕、表單 |
| 44 | `/wordle` | Wordle：六次機會猜出五字母英文單字 | 按鈕、表單 |
| 45 | `/reaction` | 反應速度測試：按鈕變綠的瞬間按下去，比誰快 | 按鈕 |

### 🎉 趣味（12）

| # | 指令 | 說明 | 互動 |
|---|---|---|---|
| 46 | `/eightball` | 神奇八號球：問一個是非題 | — |
| 47 | `/choose` | 幫我選：用逗號、頓號或空白分開選項 | — |
| 48 | `/dice` | 擲骰子：支援 2d6+3 這種寫法 | — |
| 49 | `/coin` | 擲硬幣（可一次擲多枚） | — |
| 50 | `/poll` | 發起投票（最多 5 個選項，用 \| 分開） | 按鈕 |
| 51 | `/wyr` | 你寧願：二選一，大家一起投 | 按鈕 |
| 52 | `/truthdare` | 真心話大冒險 | 按鈕 |
| 53 | `/rate` | 幫任何東西打分數（0～10，結果固定） | — |
| 54 | `/topic` | 沒話聊？抽一個聊天話題 | 按鈕 |
| 55 | `/someone` | 隨機點一個伺服器成員 | — |
| 56 | `/wordchain` | 文字接龍：下一個詞的第一個字要接上一個詞的最後一個字 | — |
| 57 | `/story` | 故事接龍：大家一人一句寫故事 | — |

### 💎 經濟（10）

| # | 指令 | 說明 | 互動 |
|---|---|---|---|
| 58 | `/daily` | 每日簽到領水晶，連續簽到獎勵更多 | — |
| 59 | `/balance` | 查看水晶餘額 | — |
| 60 | `/pay` | 轉水晶給別人 | — |
| 61 | `/work` | 打工賺水晶（每小時一次） | — |
| 62 | `/shop` | 商店：稱號、道具、禮物 | 選單 |
| 63 | `/inventory` | 背包：查看、使用道具，或把禮物送人 | 表單 |
| 64 | `/richlist` | 本伺服器富豪榜（錢包＋銀行） | — |
| 65 | `/bet` | 押注猜硬幣：猜對翻倍 | — |
| 66 | `/lottery` | 樂透：買彩券進彩池，開獎抽一位幸運兒 | — |
| 67 | `/bank` | 銀行：存款每天簽到時領 1% 利息（上限 500） | — |

### 🎰 轉蛋收藏（8）

| # | 指令 | 說明 | 互動 |
|---|---|---|---|
| 68 | `/gacha` | 模擬轉蛋：單抽、十連、百連（4★ 3%、3★ 8.5%，十連保底 3★） | 按鈕 |
| 69 | `/collection` | 我的圖鑑：擁有的卡片統計，可依角色查看 | — |
| 70 | `/pity` | 天井進度：距離上次 4★ 幾抽、離 300 抽交換還有多遠 | — |
| 71 | `/gachastats` | 抽卡統計：4★ 率、期望值比較、最愛角色 | — |
| 72 | `/luckrank` | 歐洲人排行：本伺服器 4★ 率最高的人（至少 50 抽） | — |
| 73 | `/trade` | 把你的重複卡送給別人（對方要按接受） | 按鈕 |
| 74 | `/wishlist` | 願望單與推し：設定最想抽到的角色，抽到 4★ 時會特別提示 | 自動完成 |
| 75 | `/gachalist` | 台服卡池情報：進行中與兩週內的卡池 | — |

### 🎵 問答與音樂（10）

| # | 指令 | 說明 | 互動 |
|---|---|---|---|
| 76 | `/quiz` | 綜合問答：世界計畫題或常識題，答對得水晶 | 按鈕 |
| 77 | `/songquiz` | 猜歌：從 BPM、長度、難度等提示猜出是哪一首 | 按鈕 |
| 78 | `/charaquiz` | 猜角色：從生日、團體、暱稱猜出是誰 | 按鈕 |
| 79 | `/speedquiz` | 搶答：全頻道一起搶，最先答對的人得分 | 按鈕 |
| 80 | `/quizrank` | 問答排行榜（本伺服器） | — |
| 81 | `/song` | 歌曲查詢：難度、物量、BPM、長度 | 自動完成 |
| 82 | `/randomsong` | 隨機選一首歌（可指定難度與等級範圍） | 按鈕 |
| 83 | `/setlist` | 隨機歌單：協力前抽 N 首歌 | — |
| 84 | `/songbattle` | 歌曲對決：兩首歌，大家投票選出比較喜歡的 | 按鈕 |
| 85 | `/event` | 台服活動與卡池日曆：進行中與即將開始 | — |

### 🏆 等級與社群（10）

| # | 指令 | 說明 | 互動 |
|---|---|---|---|
| 86 | `/rank` | 我的等級與經驗（聊天就會累積） | 被動事件 |
| 87 | `/leaderboard` | 等級排行榜（本伺服器） | — |
| 88 | `/achievements` | 成就一覽：已解鎖與未解鎖 | — |
| 89 | `/quest` | 每日任務：完成後領取獎勵 | 按鈕 |
| 90 | `/streak` | 連續簽到與活躍統計 | — |
| 91 | `/raffle` | 抽獎：大家按按鈕參加，發起人或時間到自動開獎 | 按鈕、排程 |
| 92 | `/team` | 隨機分組：把名單（或你所在語音頻道的人）分成 N 組 | — |
| 93 | `/remind` | 設定提醒：幾分鐘後在這個頻道 @ 你 | 排程 |
| 94 | `/countdown` | 倒數計時：顯示動態倒數，時間到會通知 | 排程 |
| 95 | `/counter` | 共用計數器：例如記今天打了幾場協力，大家都能按 +1 | 按鈕 |

### ⚙️ 伺服器（5）

| # | 指令 | 說明 | 互動 |
|---|---|---|---|
| 96 | `/welcome` | 設定新成員歡迎訊息（{user} 會換成 @ 對方，{server} 換成伺服器名） | 被動事件 |
| 97 | `/autoreact` | 關鍵字自動反應：訊息包含某個詞時機器人加上表情 | 被動事件 |
| 98 | `/help` | 指令清單：依分類查看全部功能 | 選單 |
| 99 | `/settings` | 伺服器設定：經驗值開關、貨幣名稱、問答獎勵 | — |
| 100 | `/botstats` | 機器人統計：上線時間、用量、最熱門的指令 | — |

## 資料來源與致謝

- 曲庫、卡片、卡池資料：本 repo `data/`（由網站的 GitHub Actions 每日更新）
- 角色 SD 頭像與卡片縮圖：storage.sekai.best
- 塔羅、易經、盧恩、星座等文案為本專案原創整理，僅供娛樂
