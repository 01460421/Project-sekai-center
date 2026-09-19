-- pjsk-center 使用者資料庫：完整結構快照（等同 002～016 全部跑完之後的樣子）
--
-- 用法分兩種，不要混用：
--   * 全新的 D1（本機測試、重建環境）：只跑這一支就好，不要再跑 002～016。
--       npx wrangler d1 execute pjsk-users --local --file=sql/schema.sql
--     之後跑 015 是無害的（全部 IF NOT EXISTS）；002/006/007/010～013/016 的 ADD COLUMN
--     會報 duplicate column，也是無害的（那一支整批回滾，而欄位本來就在）。
--   * 已經在用的 D1（線上）：照 SETUP.md 補跑缺的編號遷移。這支對它是 no-op
--     （全部 IF NOT EXISTS），重跑不會動到資料。
--
-- 以前這支只寫到 006 附近、而且在 CREATE TABLE events 裡沒有 read_at 卻建了用它的索引，
-- 空資料庫一跑就整批回滾（no such column: read_at），之後每一支遷移都報 no such table。
-- 新增遷移時，記得把同樣的變動也補進這裡。
--
-- session 不進資料庫：用 HMAC 簽章的 cookie 帶 user_id 與到期時間，
-- 每個請求就不必為了驗證多打一次 D1。要撤銷時靠 users.session_ver（017）。

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,          -- 內部 id
  google_sub    TEXT UNIQUE,               -- Google 的 sub（穩定不變，不要用 email 當主鍵）；Discord 直接登入建的帳號為 NULL
  email         TEXT,
  name          TEXT,
  picture       TEXT,
  discord_id    TEXT UNIQUE,               -- 車隊房間偵測要靠它
  discord_name  TEXT,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected，要管理員核准才能用（002）
  apply_note    TEXT,                             -- 申請時填的理由
  reviewed_at   INTEGER,
  reviewed_by   TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  -- 007 申請自動審核（apply_uid 是宣稱、game_uid 是證明過的，說明見 007_apply_review.sql）
  apply_uid          TEXT,
  apply_level        INTEGER,
  game_uid           TEXT,
  verify_nonce       TEXT,
  verify_expire      INTEGER,
  verify_tries       INTEGER NOT NULL DEFAULT 0,
  apply_note_dropped INTEGER NOT NULL DEFAULT 0,
  verify_total       INTEGER NOT NULL DEFAULT 0,
  review_json        TEXT,
  last_apply_at      INTEGER,
  apply_count        INTEGER NOT NULL DEFAULT 0,
  -- 016 工作階段版本：改密碼／重設密碼／解綁身分時 +1，舊 cookie 全部失效
  session_ver        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_game_uid ON users(game_uid) WHERE game_uid IS NOT NULL;

-- 站上設定（遊戲 uid、持卡、編組、自訂頁面…）。一律存 JSON 字串，
-- 前端存什麼就是什麼，後端不解讀 —— 之後前端加欄位不必動 schema。
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

-- 觸發紀錄／站內通知。留著給使用者看歷史，也避免重複寄信。
CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  watch_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  title       TEXT,
  body        TEXT,
  created_at  INTEGER NOT NULL,
  mailed_at   INTEGER,
  mail_error  TEXT,
  read_at     INTEGER,                     -- 006 已讀時間
  no_mail     INTEGER NOT NULL DEFAULT 0   -- 007 只要站內看得到、不寄信
);
CREATE INDEX IF NOT EXISTS idx_events_user    ON events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_pending ON events(mailed_at, created_at);
CREATE INDEX IF NOT EXISTS idx_events_unread  ON events(user_id, read_at, created_at DESC);

-- AI 呼叫紀錄（稽核＋計費，見 012／013）
CREATE TABLE IF NOT EXISTS admin_log (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  prompt      TEXT,
  reply       TEXT,
  tokens_in   INTEGER,
  tokens_out  INTEGER,
  created_at  INTEGER NOT NULL,
  model       TEXT,
  cache_read  INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  kind        TEXT NOT NULL DEFAULT 'chat',
  op_id       TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_log_user ON admin_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_log_at   ON admin_log(created_at);

-- 多步驟排程（見 003_tasks.sql 的說明；lease_until 見 007）
CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  title       TEXT,
  action      TEXT NOT NULL,
  params      TEXT NOT NULL,
  run_at      INTEGER NOT NULL,
  repeat_s    INTEGER,
  status      TEXT NOT NULL DEFAULT 'pending',
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  result      TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  lease_until INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tasks_due  ON tasks(status, run_at);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tool_log (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  tool        TEXT NOT NULL,
  args        TEXT,
  ok          INTEGER NOT NULL DEFAULT 1,
  result      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_log ON tool_log(created_at DESC);

-- AI 助手對話（見 004／005）
CREATE TABLE IF NOT EXISTS chats (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  msg_count   INTEGER NOT NULL DEFAULT 0,
  chars       INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY,
  chat_id     TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id, seq);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_msg_seq ON chat_messages(chat_id, seq);

-- AI 點數（見 008）
CREATE TABLE IF NOT EXISTS ai_credits (
  user_id     TEXT PRIMARY KEY,
  balance     INTEGER NOT NULL DEFAULT 0,
  lifetime    INTEGER NOT NULL DEFAULT 0,
  spent       INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_orders (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  plan          TEXT NOT NULL,
  points        INTEGER NOT NULL,
  price         INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'TWD',
  ref           TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  note          TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  confirmed_at  INTEGER,
  confirmed_by  TEXT,
  confirm_token TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_orders_ref    ON ai_orders(ref);
CREATE INDEX IF NOT EXISTS        idx_ai_orders_user   ON ai_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS        idx_ai_orders_status ON ai_orders(status, created_at);

-- 提問所／討論串（見 009～011）
CREATE TABLE IF NOT EXISTS threads (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'question',
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  reply_count   INTEGER NOT NULL DEFAULT 0,
  last_reply_at INTEGER,
  solved        INTEGER NOT NULL DEFAULT 0,
  locked        INTEGER NOT NULL DEFAULT 0,
  deleted       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_threads_list ON threads(deleted, kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_user ON threads(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS posts (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0,
  via_ai      INTEGER NOT NULL DEFAULT 0,
  reply_to    TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_user   ON posts(user_id, created_at DESC);

-- AI 操作額度（見 013）
CREATE TABLE IF NOT EXISTS ai_ops (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'chat',
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  rounds      INTEGER NOT NULL DEFAULT 0,
  paid        INTEGER NOT NULL DEFAULT 0,
  last_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ai_ops_user ON ai_ops(user_id, created_at);

-- 申請 IP 紀錄（見 014）
CREATE TABLE IF NOT EXISTS apply_ip (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_apply_ip ON apply_ip(ip, at);

-- 車隊頁：帳密、QQ 身分、QQ 綁定碼、限流、橋接 nonce（見 015）
CREATE TABLE IF NOT EXISTS user_passwords (
  user_id     TEXT PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE,
  hash        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_qq (
  group_openid   TEXT NOT NULL,
  member_openid  TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  name           TEXT,
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (group_openid, member_openid)
);
CREATE INDEX IF NOT EXISTS idx_user_qq_user ON user_qq(user_id);

CREATE TABLE IF NOT EXISTS qq_codes (
  code          TEXT PRIMARY KEY,
  purpose       TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  browser_key   TEXT NOT NULL UNIQUE,
  exp           INTEGER NOT NULL,
  ip            TEXT,
  done_json     TEXT
);
CREATE INDEX IF NOT EXISTS idx_qq_codes_exp ON qq_codes(exp);

CREATE TABLE IF NOT EXISTS login_fail (
  kind  TEXT NOT NULL,
  k     TEXT NOT NULL,
  at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_fail    ON login_fail(kind, k, at);
CREATE INDEX IF NOT EXISTS idx_login_fail_at ON login_fail(at);

CREATE TABLE IF NOT EXISTS bridge_nonce (
  nonce  TEXT PRIMARY KEY,
  at     INTEGER NOT NULL
);
