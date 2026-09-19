-- 2026-09 車隊頁併入：Discord 直接登入、帳密登入、QQ 身分綁定。
-- 執行：npx wrangler d1 execute pjsk-users --remote --file=sql/016_car_accounts.sql
-- users 表不動：Discord 直接登入建的帳號 google_sub 為 NULL（原本就允許 NULL,UNIQUE 不擋多個 NULL）。

-- 帳密。一個帳號最多一組；username 存小寫、全站唯一。
-- hash 格式：pbkdf2$sha256$<次數>$<salt_b64>$<hash_b64>
CREATE TABLE IF NOT EXISTS user_passwords (
  user_id     TEXT PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE,
  hash        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- QQ 身分。QQ 官方機器人給的 member_openid 只在同一個群裡有意義,所以 (群, 成員) 才是一個身分。
-- 一個 QQ 身分只能綁一個帳號；一個帳號可以綁多個（不同群）。
CREATE TABLE IF NOT EXISTS user_qq (
  group_openid   TEXT NOT NULL,
  member_openid  TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  name           TEXT,
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (group_openid, member_openid)
);
CREATE INDEX IF NOT EXISTS idx_user_qq_user ON user_qq(user_id);

-- QQ 綁定碼（6 位數字,120 秒）。purpose: register | link | reset
-- payload_json：register {username, hash}／link {uid}／reset {username}
-- done_json：NULL=未使用；{"status":"processing"}=處理中；完成後放結果（reset 另含 rt_used）
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

-- 失敗紀錄（限流）。kind: ip | user | qqm | qqall | qqstart
CREATE TABLE IF NOT EXISTS login_fail (
  kind  TEXT NOT NULL,
  k     TEXT NOT NULL,
  at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_fail ON login_fail(kind, k, at);
CREATE INDEX IF NOT EXISTS idx_login_fail_at ON login_fail(at);

-- 機器人 → Worker 簽章的 nonce 去重（5 分鐘）。Worker 有很多個 isolate,記憶體 LRU 擋不住跨 isolate 的重放。
CREATE TABLE IF NOT EXISTS bridge_nonce (
  nonce  TEXT PRIMARY KEY,
  at     INTEGER NOT NULL
);
