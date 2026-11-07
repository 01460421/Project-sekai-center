-- 匿名使用統計與前端錯誤回報（src/telemetry.js）、資料管線檢查的狀態（src/pipeline.js）。
-- Worker 啟動時會自己 CREATE … IF NOT EXISTS（ensureTeleSchema），這份只是結構紀錄，可重跑。
-- tele_raw 只留 90 天；vh 是「當天 + IP + UA + 站方密鑰」的雜湊前 12 碼，不存 IP、跨日無法串起同一人。
CREATE TABLE IF NOT EXISTS tele_raw (
  t INTEGER NOT NULL,            -- 秒
  day TEXT NOT NULL,             -- 台北日期 YYYY-MM-DD
  k TEXT NOT NULL,               -- pv（頁面）／err（JS 錯誤）／dat（資料載入失敗）
  page TEXT NOT NULL DEFAULT '',
  dev TEXT NOT NULL DEFAULT '',  -- m／d
  ref TEXT NOT NULL DEFAULT '',  -- 來源主機名（本站不算）
  lang TEXT NOT NULL DEFAULT '',
  srv TEXT NOT NULL DEFAULT '',  -- tw／jp
  vh TEXT NOT NULL DEFAULT '',
  msg TEXT NOT NULL DEFAULT '',  -- 錯誤訊息（截 200 字）
  ver TEXT NOT NULL DEFAULT ''   -- 程式版本戳
);
CREATE INDEX IF NOT EXISTS idx_tele_t ON tele_raw(t);
CREATE INDEX IF NOT EXISTS idx_tele_day_k ON tele_raw(day, k);

CREATE TABLE IF NOT EXISTS ops_state (
  key TEXT PRIMARY KEY,
  val TEXT NOT NULL,
  t INTEGER NOT NULL
);
