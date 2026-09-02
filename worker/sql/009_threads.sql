-- 提問所／討論串。
--
-- 兩張表:threads 是主題(提問或討論),posts 是回覆。
-- 刻意用軟刪除(deleted=1)而不是真的刪:管理員誤刪救得回來,而且別人的回覆
-- 還掛在那個主題底下,主題真的消失會讓它們變成孤兒。
-- reply_count / last_reply_at 是反正規化的計數,列表頁排序與顯示用,
-- 不必每次 JOIN posts 去數。
CREATE TABLE IF NOT EXISTS threads (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'question',   -- question | discussion
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  reply_count   INTEGER NOT NULL DEFAULT 0,
  last_reply_at INTEGER,
  solved        INTEGER NOT NULL DEFAULT 0,          -- 提問已解決(作者或管理員標)
  locked        INTEGER NOT NULL DEFAULT 0,          -- 鎖定後不能再回(管理員)
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
  deleted     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_user   ON posts(user_id, created_at DESC);
