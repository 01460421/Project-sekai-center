-- seq 重複會讓讀回來的對話順序錯亂,送回 Claude 的結構也跟著壞。
-- 原本用 MAX(seq)+1 產生,並發時會算出相同值;改成由 msg_count 回推之後
-- 再加這道唯一約束,讓資料庫替我們把關。
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_msg_seq ON chat_messages(chat_id, seq);
