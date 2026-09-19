-- 2026-09 工作階段版本：改密碼／重設密碼／解綁身分時 +1,舊的 session cookie 全部失效。
-- session 是無狀態簽章 cookie（30 天）,沒有這個欄位就沒辦法把盜用者踢出去。
-- 執行：npx wrangler d1 execute pjsk-users --remote --file=sql/017_session_ver.sql
-- SQLite 的 ADD COLUMN 沒有 IF NOT EXISTS：這支只能跑一次,重跑會報 duplicate column（無害）。
ALTER TABLE users ADD COLUMN session_ver INTEGER NOT NULL DEFAULT 0;
