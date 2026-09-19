-- 申請送出的 IP 紀錄：自動核准後用來限制同一個 IP 一天的申請次數
CREATE TABLE IF NOT EXISTS apply_ip (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_apply_ip ON apply_ip(ip, at);
