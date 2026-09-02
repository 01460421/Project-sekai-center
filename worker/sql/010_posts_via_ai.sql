-- 提問所回覆可以是「請站內助手回答」的結果。
-- 標記起來,畫面上才分得出是人寫的還是助手查資料寫的;助手可能查錯,讀者要知道來源。
ALTER TABLE posts ADD COLUMN via_ai INTEGER NOT NULL DEFAULT 0;
