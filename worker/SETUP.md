# 帳號系統與 AI 助手：設定進度

## 目前狀態（2026/08/22）

已完成並上線：

- [x] **D1 資料庫** `pjsk-users`（8 張表，schema 已套用）
- [x] **SESSION_SECRET**
- [x] **ADMIN_EMAIL** — yiqiz1332@gmail.com（登入即為管理員，免審核）
- [x] **Google OAuth** — 已驗證可登入，資料庫確認 `omega / approved / is_admin=1`
- [x] **Anthropic API key** — 已設定（模型 `claude-opus-5`）
- [x] Worker 已部署，網域 `games.project-sekai-center.com`
- [x] 前端：登入、雲端同步、Discord 綁定入口、偵測訂閱管理、通知紀錄、
      站內助手、管理後台（審核＋統計）

尚未設定（功能會顯示為未啟用，不影響其他部分）：

- [ ] **Resend** — 沒有它，訂閱條件會照常判定並記錄，但不會真的寄出 Email
- [ ] **Discord OAuth** — 綁定按鈕會回報未設定；車隊房間偵測本來就還沒有資料源

---

## 下一步：Resend（寄信）



MailChannels 的 Workers 免費方案已於 2024 年終止，Cloudflare 官方現在推薦 Resend。
免費額度 3000 封/月、100 封/日。

1. <https://resend.com> 註冊，Domains 加入 `project-sekai-center.com`
   並照它給的 DNS 記錄完成驗證（沒驗證過的網域寄不出去）。
2. ```bash
   npx wrangler secret put RESEND_API_KEY
   ```
寄件者位址由 `wrangler.toml` 的 `MAIL_FROM` 指定，要跟驗證過的網域一致。


---

## 之後：Discord OAuth（選用）

車隊房間偵測目前沒有資料源，所以這一項可以晚點再做。步驟：
<https://discord.com/developers/applications> 建 application →
OAuth2 → Redirects 加入 `https://games.project-sekai-center.com/auth/discord/callback` →
```bash
npx wrangler secret put GEMINI_API_KEY   # 選用：AI 雙路並行的第二家
npx wrangler secret put DISCORD_CLIENT_ID
npx wrangler secret put DISCORD_CLIENT_SECRET
```

---

## 瀏覽器推播（Web Push，選用）

沒設定時「我的帳號」會顯示「站方尚未設定推播金鑰」，其他功能不受影響。

1. 產一組 VAPID 金鑰（任何有 Node 的機器）：
   ```bash
   npx web-push generate-vapid-keys
   ```
2. 放進 Worker：
   ```bash
   npx wrangler secret put VAPID_PUBLIC     # Public Key（base64url，87 字元）
   npx wrangler secret put VAPID_PRIVATE    # Private Key（base64url，43 字元）
   npx wrangler secret put VAPID_SUBJECT    # 選用，mailto:你的信箱；預設 mailto:noreply@project-sekai-center.com
   ```
3. 套用資料表：
   ```bash
   npx wrangler d1 execute pjsk-users --remote --file=sql/015_push.sql
   ```
   （`events` 已經有 `pushed_at` 欄的話最後一句會報 duplicate column，忽略即可。）
4. `npx wrangler deploy`。

運作方式：cron 每分鐘把還沒推過的事件依使用者合併，對每台登記的裝置送一個「不帶內容」的推播；
網站的 service worker 收到後自己去 `/api/events` 拿最新通知來顯示。推播服務回 404／410 的訂閱會自動刪掉。

## 行事曆訂閱源

`GET /cal/sekai.ics` 從台服 master 產活動與卡池的 iCalendar（近 60 天到未來），邊緣快取一小時；
網站活動日曆的「訂閱」按鈕指到 `webcal://games.project-sekai-center.com/cal/sekai.ics`。不需要設定。

## 每次改完 Worker 都要

```bash
cd ~/pjsk-center/worker && npx wrangler deploy
```

部署後有 1～2 分鐘傳播，立刻 curl 可能還是舊行為，不要急著當成 bug。

## 常用檢查

```bash
npx wrangler secret list
npx wrangler d1 execute pjsk-users --remote --command "SELECT name,status,is_admin FROM users"
npx wrangler tail
```

## 全新的 D1（本機測試／重建環境）

`sql/schema.sql` 是 002～016 全部跑完之後的完整結構快照，空資料庫只跑這一支：
```
npx wrangler d1 execute pjsk-users --local --persist-to <目錄> --file=sql/schema.sql
```
不要接著跑 002～016（ADD COLUMN 會報 duplicate column，無害但沒必要）。線上已經在用的 D1 照下面各節補跑缺的編號遷移；
對它跑 schema.sql 是 no-op。之後新增遷移時，同樣的變動也要補進 schema.sql。

## 2026-09-19 遷移：申請 IP 紀錄

```
npx wrangler d1 execute pjsk-users --remote --file=sql/014_apply_ip.sql
```
沒跑也不會壞：查詢失敗時視為 0 次、不擋申請；跑了才有「同一個 IP 一天最多 8 次申請」的保護。

## 2026-09 遷移：私車排班頁（Discord 直接登入、帳密、QQ 綁定、代理到菜根機器人）

```
npx wrangler d1 execute pjsk-users --remote --file=sql/016_car_accounts.sql
npx wrangler d1 execute pjsk-users --remote --file=sql/017_session_ver.sql
```
015 新增 user_passwords、user_qq、qq_codes、login_fail、bridge_nonce 五張表；
016 在 users 加 `session_ver`（改密碼／重設密碼／解綁身分時 +1，舊的 session cookie 全部失效）。016 只能跑一次，重跑會報 duplicate column（無害）。
**要先跑兩支遷移再部署**：015 沒跑的話 /api/me 仍正常（新欄位當作沒設），但帳密登入、QQ 綁定、代理會回 500；
016 沒跑的話登入照常，但改密碼／重設密碼會回 500（刻意不默默略過 —— 那等於盜用者的 cookie 撤不掉）。

設定：
- `wrangler.toml` 的 `[vars]` 已加 `CAIBOT_API_BASE = "https://bot.project-sekai-center.com"`
- 機密 `CAIBOT_BRIDGE_SECRET`（64 字元 hex，機器人端設同一個值）；沒設時 `/car/api/*` 回 503、`/car/qqbind` 回 503
- 本機測前端要從 localhost 打 POST 時，在 `.dev.vars` 設 `CAR_ALLOW_LOCALHOST=1`（線上不要設）

新路由：
| 路徑 | 說明 |
|---|---|
| `GET /auth/discord` | 沒 session → 用 Discord 登入／建帳號；有 session → 綁定（被別的帳號綁走時拒絕，回跳網址帶 `auth_error=discord_taken`） |
| `POST /auth/password/login` `set` `reset` | 帳密（PBKDF2-SHA256 210000 次）。限流：同一 IP（IPv6 以 /64 計）15 分鐘 20 次失敗；同一「帳號名＋IP」8 次；同一帳號名總計 50 次後只放行該帳號成功登入過的 IP（不全面鎖死，被擋的新裝置可走 QQ 重設） |
| `POST /auth/qq/start`、`GET /auth/qq/poll?k=` | QQ 綁定碼（register／link／reset）。輪詢狀態：`pending`（QQ 已送碼、等確認時多帶 `stage:"confirm"`、`qq:{n}`）／`done`／`fail`（碼已作廢，帶 `reason`、`message`，要重新取碼）／`expired` |
| `POST /car/qqbind` | 機器人回呼（驗 HMAC 簽章）。**兩步確認**：QQ 第一次送碼只回警告＋一組綁在該 QQ 身分上的 6 位確認碼，同一個 QQ 再送確認碼才執行；碼一經送出就不會放回重用，另一個 QQ 照抄同一個碼整張作廢 |
| `* /car/api/<rest>` | 代理到 `CAIBOT_API_BASE/api/<rest>`，加簽章與身分；GET 也擋跨站（Sec-Fetch-Site／Origin）；機器人回應非 JSON 時改回我們的 JSON（404 → `bot_not_updated`），一律加 nosniff＋CSP |
| `POST /api/qq/unlink` `{g}` | 解除某個群的 QQ 身分（其他裝置登出，本瀏覽器換發 cookie） |

OAuth（Google／Discord）發起時種 `oauth_n` cookie（只在 Worker 網域、Path=/auth/、10 分鐘），回呼時要跟 state 裡的 nonce 對上，擋登入 CSRF。
`/api/*` 與 `/admin/*` 的非 GET 請求要求 Origin 是本站／Worker 自己／localhost，擋同網站子網域（bot.*）的 CSRF。

簽章測試向量：`node worker/test/sign_vector.mjs <輸出.json>`（同時交叉驗證 node:crypto 與純 JS PBKDF2 備援）。
安全回歸測試（審查的重現步驟）：`node worker/test/security.mjs`（Node 22.5+，D1 用 node:sqlite 模擬）；
也可以打本機 `wrangler dev --local`：`node worker/test/security.mjs --http http://localhost:8801 <本機 D1 sqlite 檔>`
（dev 要帶 `--var CAIBOT_BRIDGE_SECRET:test-secret --var CAIBOT_API_BASE:http://127.0.0.1:8802`）。
