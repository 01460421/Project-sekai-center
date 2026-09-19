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

## 2026-09-19 遷移：申請 IP 紀錄

```
npx wrangler d1 execute pjsk-users --remote --file=sql/014_apply_ip.sql
```
沒跑也不會壞：查詢失敗時視為 0 次、不擋申請；跑了才有「同一個 IP 一天最多 8 次申請」的保護。
