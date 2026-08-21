-- 使用者要管理員核准才能用。第一個管理員靠 ADMIN_EMAIL 環境變數 bootstrap：
-- 該信箱登入時自動 is_admin=1 且直接 approved，不必有人先核准他。
ALTER TABLE users ADD COLUMN status      TEXT NOT NULL DEFAULT 'pending';  -- pending | approved | rejected
ALTER TABLE users ADD COLUMN apply_note  TEXT;      -- 申請時填的理由
ALTER TABLE users ADD COLUMN reviewed_at INTEGER;
ALTER TABLE users ADD COLUMN reviewed_by TEXT;
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status, created_at);
