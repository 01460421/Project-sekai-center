-- AI 呼叫紀錄補上模型、快取與種類。
-- 費用要算得準,光有 tokens_in/out 不夠:同一筆請求裡快取讀取只收一成、快取寫入多收 25%,
-- 而模型不同單價差五倍。kind 分開站內助手／管理員提問／自動審核,統計時才對得到帳。
ALTER TABLE admin_log ADD COLUMN model TEXT;
ALTER TABLE admin_log ADD COLUMN cache_read INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admin_log ADD COLUMN cache_write INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admin_log ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat';
UPDATE admin_log SET kind='review' WHERE prompt='[auto_review]';
CREATE INDEX IF NOT EXISTS idx_admin_log_user ON admin_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_log_at ON admin_log(created_at);
