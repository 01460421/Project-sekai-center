-- 2026-10 Haruki 授權橋接給菜根機器人：玩家在「我的帳號」按「允許機器人讀取」後，
-- Worker 把 Haruki OAuth 的 refresh／access token 加密（AES-GCM，金鑰來自 secret HARUKI_GRANT_KEY）存在這裡，
-- 機器人用簽章呼叫 /api/bot/haruki/{suite|mysekai}/{uid} 時由 Worker 代為換 token 讀存檔。撤銷＝設 revoked_at。
-- 執行：npx wrangler d1 execute pjsk-users --remote --file=sql/018_haruki_grants.sql（可重跑）
CREATE TABLE IF NOT EXISTS haruki_grants (
  uid          TEXT PRIMARY KEY,
  haruki_user  TEXT,
  refresh_enc  TEXT NOT NULL,
  access_enc   TEXT,
  access_exp   INTEGER,
  scope        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  revoked_at   INTEGER,
  last_used_at INTEGER,
  fail_n       INTEGER NOT NULL DEFAULT 0
);
