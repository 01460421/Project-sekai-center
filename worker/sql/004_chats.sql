-- AI 助手的對話持久化。原本對話只活在瀏覽器記憶體裡,重新整理就沒了;
-- 存進 D1 之後才能跨裝置接續,也才回得去看昨天問過什麼。
--
-- 為什麼拆成兩張表而不是把整串對話塞成一個 JSON 欄位:
--   一次追加一則訊息時,單欄 JSON 得「讀出整串→改→整串寫回」,對話愈長愈貴,
--   而且兩個分頁同時追加會互相覆蓋。分成 chat_messages 之後追加就是純 INSERT。
--
-- 這個檔可以重複執行（全部 IF NOT EXISTS）。

-- 一則對話。msg_count / chars 是「快取值」,真正的來源永遠是 chat_messages;
-- 放在這裡是為了列表頁不必為每列各跑一次 COUNT。額度檢查則一律回 chat_messages
-- 現算（見 chats.js 的 appendMessages）,免得快取漂移把上限也一起弄歪。
CREATE TABLE IF NOT EXISTS chats (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',   -- 空字串＝還沒有標題,第一則使用者訊息進來時自動取前 N 字
  msg_count   INTEGER NOT NULL DEFAULT 0, -- 快取:訊息數
  chars       INTEGER NOT NULL DEFAULT 0, -- 快取:所有訊息 content 的字元數,拿來擋單一對話膨脹
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
-- 列表固定是「我的對話,最近更新在前」,索引就照那個形狀開
CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id, updated_at DESC);

-- 一則訊息。content 存 JSON 字串:助手的訊息帶 tool_use / tool_result 區塊,
-- 是結構化陣列而不只是文字,後端不解讀內容,原樣存原樣還給前端。
--
-- user_id 是刻意的冗餘:每一支查詢都能直接帶 user_id 條件,不必 JOIN chats 就能
-- 保證讀不到別人的訊息(IDOR)。少一次 JOIN,也少一個「哪天忘了加條件」的破口。
CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY,
  chat_id     TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  seq         INTEGER NOT NULL,           -- 對話內序號(0 起)。時間戳同秒會撞,排序要靠它
  role        TEXT NOT NULL,              -- user | assistant
  content     TEXT NOT NULL,              -- JSON:字串或 content block 陣列
  created_at  INTEGER NOT NULL
);
-- 取單一對話就是這個形狀:某對話的訊息照 seq 排
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id, seq);
-- 之後要做「某人的用量統計 / 清舊資料」時不必全表掃
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id, created_at);

-- 沒有宣告 FOREIGN KEY ... ON DELETE CASCADE:那要靠 PRAGMA foreign_keys 開著才生效,
-- 而那個狀態不在這支 migration 的掌控裡。刪除改成 chats.js 用 db.batch() 明確刪兩張表
-- (D1 的 batch 是單一交易,不會刪一半)。行為看得見,不依賴連線設定。
