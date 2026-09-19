-- Web Push 訂閱（一個帳號可有多台裝置）；events 多一欄 pushed_at 記「叮過了」
CREATE TABLE IF NOT EXISTS push_subs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT,
  auth       TEXT,
  ua         TEXT,
  created_at INTEGER NOT NULL,
  fail_n     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subs(user_id);
-- 已經加過這一欄的資料庫再跑一次會報 duplicate column，忽略即可
ALTER TABLE events ADD COLUMN pushed_at INTEGER;
