-- pjsk-center 使用者資料庫
-- session 不進資料庫：用 HMAC 簽章的 cookie 帶 user_id 與到期時間，
-- 每個請求就不必為了驗證多打一次 D1。代價是不能即時撤銷，所以效期壓在 30 天。

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,          -- 內部 id
  google_sub    TEXT UNIQUE,               -- Google 的 sub（穩定不變，不要用 email 當主鍵）
  email         TEXT,
  name          TEXT,
  picture       TEXT,
  discord_id    TEXT UNIQUE,               -- 車隊房間偵測要靠它
  discord_name  TEXT,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected，要管理員核准才能用
  apply_note    TEXT,                             -- 申請時填的理由
  reviewed_at   INTEGER,
  reviewed_by   TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- 站上設定（遊戲 uid、持卡、編組、自訂頁面…）。一律存 JSON 字串，
-- 前端存什麼就是什麼，後端不解讀 —— 之後前端加欄位不必動 schema。
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status, created_at);

CREATE TABLE IF NOT EXISTS prefs (
  user_id     TEXT NOT NULL,
  k           TEXT NOT NULL,
  v           TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, k)
);

-- 偵測訂閱
CREATE TABLE IF NOT EXISTS watches (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,               -- border | player | team | schedule
  name        TEXT,
  params      TEXT NOT NULL,               -- JSON，各 kind 自己定義
  enabled     INTEGER NOT NULL DEFAULT 1,
  cooldown_s  INTEGER NOT NULL DEFAULT 3600,
  last_fired  INTEGER,
  last_state  TEXT,                        -- JSON，上次比對用的狀態（偵測「變化」需要）
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_watches_user    ON watches(user_id);
CREATE INDEX IF NOT EXISTS idx_watches_enabled ON watches(enabled, kind);

-- 觸發紀錄。留著給使用者看歷史，也避免重複寄信。
CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  watch_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  title       TEXT,
  body        TEXT,
  created_at  INTEGER NOT NULL,
  mailed_at   INTEGER,
  mail_error  TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_pending ON events(mailed_at, created_at);

-- 管理員的 Claude 對話紀錄（稽核用：誰在什麼時候問了什麼）
CREATE TABLE IF NOT EXISTS admin_log (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  prompt      TEXT,
  reply       TEXT,
  tokens_in   INTEGER,
  tokens_out  INTEGER,
  created_at  INTEGER NOT NULL
);

-- 多步驟排程（見 003_tasks.sql 的說明）
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT,
  action TEXT NOT NULL, params TEXT NOT NULL,
  run_at INTEGER NOT NULL, repeat_s INTEGER,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT, result TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(status, run_at);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tool_log (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, tool TEXT NOT NULL,
  args TEXT, ok INTEGER NOT NULL DEFAULT 1, result TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_log ON tool_log(created_at DESC);

-- 站內通知的已讀狀態（見 006_read.sql）
-- events.read_at INTEGER
CREATE INDEX IF NOT EXISTS idx_events_unread ON events(user_id, read_at, created_at DESC);
