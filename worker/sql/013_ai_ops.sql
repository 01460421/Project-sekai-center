-- 額度單位改成「操作」:一次提問、一次截圖辨識、一次請助手答提問所,各算一次。
-- 中間跑幾輪工具都記在同一個 op 上,做到完為止;不再逐輪計額度。
CREATE TABLE IF NOT EXISTS ai_ops (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'chat',   -- chat | qa | scan
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,               -- 逾時就不能再拿來跑,防一個 op 被無限重用
  rounds      INTEGER NOT NULL DEFAULT 0,     -- 這次操作已跑的 /api/chat 輪數
  paid        INTEGER NOT NULL DEFAULT 0,     -- 免費次數用完後扣點開的
  last_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ai_ops_user ON ai_ops(user_id, created_at);
ALTER TABLE admin_log ADD COLUMN op_id TEXT;
