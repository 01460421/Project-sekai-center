# 帳號系統與 AI 助手：上線前的設定

程式碼已經完成並通過 `wrangler deploy --dry-run`，但**還沒部署**，因為需要先設定
下面這些憑證。憑證要在各家平台自己申請，不能由自動化流程代辦。

Worker 名稱 `pjsk-games`，網域 `games.project-sekai-center.com`，
D1 資料庫 `pjsk-users`（已建立，schema 已套用）。

---

## 1. Google OAuth（登入用）

1. 到 <https://console.cloud.google.com/apis/credentials> 建立專案。
2. 「建立憑證」→「OAuth 用戶端 ID」→ 應用程式類型選「網頁應用程式」。
3. **已授權的重新導向 URI** 填：
   ```
   https://games.project-sekai-center.com/auth/google/callback
   ```
4. 同意畫面：範圍只需要 `openid`、`email`、`profile`。
   若要讓非測試帳號登入，同意畫面要送出審核或設為「外部／正式版」。
5. 取得 Client ID 與 Client Secret 後：
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```

## 2. Discord OAuth（車隊房間偵測的身分辨識）

1. <https://discord.com/developers/applications> 建立 application。
2. OAuth2 → Redirects 加入：
   ```
   https://games.project-sekai-center.com/auth/discord/callback
   ```
3. ```bash
   npx wrangler secret put DISCORD_CLIENT_ID
   npx wrangler secret put DISCORD_CLIENT_SECRET
   ```

## 3. Anthropic API（站內 AI 助手）

1. <https://console.anthropic.com/> 建立 API key。
2. ```bash
   npx wrangler secret put ANTHROPIC_API_KEY
   ```
金鑰只存在 Worker，前端拿不到，也不會出現在任何回應裡。

## 4. Resend（寄送通知信）

MailChannels 的 Workers 免費方案已於 2024 年終止，Cloudflare 官方現在推薦 Resend。
免費額度 3000 封/月、100 封/日。

1. <https://resend.com> 註冊，Domains 加入 `project-sekai-center.com`
   並照它給的 DNS 記錄完成驗證（沒驗證過的網域寄不出去）。
2. ```bash
   npx wrangler secret put RESEND_API_KEY
   ```
寄件者位址由 `wrangler.toml` 的 `MAIL_FROM` 指定，要跟驗證過的網域一致。

## 5. 管理員信箱

```bash
npx wrangler secret put ADMIN_EMAIL      # 填你的 Google 登入信箱
```
這個信箱第一次登入時會自動成為管理員且免審核 —— 否則第一個人會卡在沒人能核准他。
其他人登入後預設是 pending，要你在「管理後台」核准才能使用訂閱功能。

## 6. SESSION_SECRET

已經產生並設定好（隨機 48 bytes）。要換的話：
```bash
openssl rand -base64 48 | npx wrangler secret put SESSION_SECRET
```
換掉等於讓所有人登出。

---

## 部署

```bash
cd worker && npx wrangler deploy
```

## 部署後檢查

```bash
curl -s https://games.project-sekai-center.com/api/me            # 應回 {"user":null}
curl -s https://games.project-sekai-center.com/admin/stats       # 應回 403 not_signed_in
```
然後到 `https://project-sekai-center.com/app.html?page=account` 按登入試一次。

## 資料庫

schema 在 `sql/schema.sql`（從零建立用），`002_*.sql`／`003_*.sql` 是後續的增修。
```bash
npx wrangler d1 execute pjsk-users --remote --command "SELECT count(*) FROM users"
```
