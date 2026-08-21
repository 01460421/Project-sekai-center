-- 多步驟排程。管理員的 Claude 不執行程式碼,它只能呼叫白名單工具;
-- 需要「等一下再做」或「每天做」的動作就排進這張表,由 cron 執行。
-- params 是該動作的參數 JSON,action 必須是程式裡寫死的白名單之一。
CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,            -- 誰排的（稽核用）
  title       TEXT,
  action      TEXT NOT NULL,            -- 白名單動作代號
  params      TEXT NOT NULL,            -- JSON
  run_at      INTEGER NOT NULL,         -- 下次執行時間（秒）
  repeat_s    INTEGER,                  -- 週期；NULL 表示只跑一次
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending | done | failed | cancelled
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  result      TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(status, run_at);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, created_at DESC);

-- Claude 的工具呼叫稽核：每一次動作都要留痕,包含它自己決定的參數
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
