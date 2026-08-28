-- AI 點數（beta）。
--
-- 這裡刻意「不」接金流。beta 階段的訂單只記錄「誰要買哪個方案」與一組對帳碼，
-- 實際收款在站外完成（轉帳、超商、或站主自己決定的方式），管理員確認收到款項後
-- 才在後台按下入帳。理由有兩個:接金流要有特約商店與一連串合規工作,那是另一個
-- 專案;而且這樣站上從頭到尾不碰任何卡號或付款資訊,不必為此承擔保管責任。
--
-- 點數與每日免費額度是兩個獨立的池:免費額度每天重置,點數不會過期。
-- 呼叫時先扣免費額度,用完才扣點數 —— 反過來的話,買了點數的人會在還有免費
-- 額度時就被扣款,那是在懲罰付費的人。
CREATE TABLE IF NOT EXISTS ai_credits (
  user_id     TEXT PRIMARY KEY,
  balance     INTEGER NOT NULL DEFAULT 0,   -- 目前剩餘點數
  lifetime    INTEGER NOT NULL DEFAULT 0,   -- 累計購入（對帳與客服用）
  spent       INTEGER NOT NULL DEFAULT 0,   -- 累計消耗
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_orders (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  plan         TEXT NOT NULL,               -- 方案代號（伺服器端白名單，不信任前端送來的價格）
  points       INTEGER NOT NULL,            -- 下單當下的點數，寫死在訂單裡
  price        INTEGER NOT NULL,            -- 下單當下的金額，同上
  currency     TEXT NOT NULL DEFAULT 'TWD',
  ref          TEXT NOT NULL,               -- 對帳碼，使用者匯款時附註這組
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending | paid | cancelled
  note         TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  confirmed_at INTEGER,
  confirmed_by TEXT,
  -- 入帳用的一次性識別碼。入帳是「改訂單狀態」＋「加點數」兩件事,必須一起成立:
  -- 只做前者使用者付了錢沒拿到點,只做後者可以被重複入帳。D1 的 batch 是一個交易,
  -- 所以把兩句放進同一個 batch,並讓第二句只認這組 token —— 狀態沒真的翻過去的那次,
  -- 沒有任何一列帶著它的 token,自然加不到點。
  confirm_token TEXT
);
-- 對帳碼要唯一:它是管理員把一筆匯款對到一張訂單的唯一依據，撞號就對不出來了
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_orders_ref    ON ai_orders(ref);
CREATE INDEX IF NOT EXISTS        idx_ai_orders_user   ON ai_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS        idx_ai_orders_status ON ai_orders(status, created_at);
