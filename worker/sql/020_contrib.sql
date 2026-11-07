-- 玩家榜線回報（src/contrib.js 會自己 CREATE TABLE IF NOT EXISTS；這裡只是同一份結構的紀錄）
CREATE TABLE IF NOT EXISTS contrib_pts (
  srv TEXT NOT NULL DEFAULT 'tw',   -- tw / jp
  ev INTEGER NOT NULL,              -- 活動期數
  t INTEGER NOT NULL,               -- unix 秒
  rank INTEGER NOT NULL,
  score INTEGER NOT NULL,
  uh TEXT NOT NULL                  -- 玩家雜湊 12 碼（站方密鑰 + 伺服器 + Player ID），不存 ID
);
CREATE INDEX IF NOT EXISTS idx_contrib_ev ON contrib_pts(srv, ev, t);
CREATE INDEX IF NOT EXISTS idx_contrib_uh ON contrib_pts(srv, ev, uh, t);
