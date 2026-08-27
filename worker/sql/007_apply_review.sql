-- 申請自動審核。
--
-- 設計上最重要的一件事:apply_uid 與 game_uid 是兩個不同的東西。
-- apply_uid 是申請者「宣稱」的遊戲 id,任何人都能從站上的 T100 榜單抄一個高分玩家的
-- uid 填進來 —— 所以它本身不構成任何證據。game_uid 是「證明過」的:申請者把我們發的
-- 一次性驗證碼寫進遊戲內自我介紹,後端從公開 API 讀回來比對成功才會寫進去。
-- 只有 game_uid 有唯一性約束,因為唯有它代表真的擁有那個帳號。
ALTER TABLE users ADD COLUMN apply_uid     TEXT;      -- 宣稱的遊戲 id（未經證明）
ALTER TABLE users ADD COLUMN apply_level   INTEGER;   -- 宣稱的等級（未經證明）
ALTER TABLE users ADD COLUMN game_uid      TEXT;      -- 已通過所有權驗證的遊戲 id
ALTER TABLE users ADD COLUMN verify_nonce  TEXT;      -- 一次性驗證碼
ALTER TABLE users ADD COLUMN verify_expire INTEGER;   -- 驗證碼到期（秒）
ALTER TABLE users ADD COLUMN verify_tries  INTEGER NOT NULL DEFAULT 0;   -- 本組驗證碼已重試幾次
-- 收件當下清洗掉了多少字元。要存下來而不是事後重算:apply_note 存進來之前
-- 就已經清洗過一次了,對它再清一次必然是 0,「有沒有藏東西」的訊號會整個消失。
ALTER TABLE users ADD COLUMN apply_note_dropped INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN verify_total  INTEGER NOT NULL DEFAULT 0;   -- 累計驗證比對次數（換碼不會歸零）
ALTER TABLE users ADD COLUMN review_json   TEXT;      -- 審核結果快照 JSON（判定當下的證據）
ALTER TABLE users ADD COLUMN last_apply_at INTEGER;   -- 上次送出申請（冷卻用）
ALTER TABLE users ADD COLUMN apply_count   INTEGER NOT NULL DEFAULT 0;   -- 累計送出次數（上限用）

-- partial index:NULL 不參與唯一性,所以還沒驗證的人不會互相衝突。
-- 有了它,「同一個遊戲帳號被兩個網站帳號綁走」由資料庫擋,不必先 SELECT 再寫（會有競態）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_game_uid ON users(game_uid) WHERE game_uid IS NOT NULL;

-- 站內通知會被 flushMail 撈去寄 Email（條件是 mailed_at IS NULL）。
-- 管理員的審核通知量大且只需要站內看得到,不該吃掉 Resend 的每日額度 ——
-- 那個額度是留給使用者真正訂閱的偵測通知的。
ALTER TABLE events ADD COLUMN no_mail INTEGER NOT NULL DEFAULT 0;

-- 排程任務的租約。cron 每分鐘觸發一次,而 dueTasks 只看 status='pending',
-- status 要到 finishTask 才改 —— 一輪跑超過 60 秒,下一輪就會撈到同一批,
-- 於是同一筆審核打兩次 AI（雙倍費用）、發兩次通知。
-- 有了 lease_until 就能用條件式 UPDATE 搶佔:搶到的才執行。
ALTER TABLE tasks ADD COLUMN lease_until INTEGER;
