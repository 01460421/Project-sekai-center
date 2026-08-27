-- 站內通知。原本的設計是寄 Email(mailed_at 記錄寄出時間),但改成站內通知之後
-- 「有沒有送到」就不再是問題 —— 事件寫進 events 的當下使用者就看得到了。
-- 真正要記的是「看過沒有」,所以加 read_at。
-- mailed_at 保留不動:之後若要補寄 Email,兩者是各自獨立的狀態。
ALTER TABLE events ADD COLUMN read_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_events_unread ON events(user_id, read_at, created_at DESC);
