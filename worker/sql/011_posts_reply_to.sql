-- 回覆可以指定「回哪一則」。互相討論要能看出誰在回誰，不然一串平鋪的回覆
-- 到第五則就對不上了。只存被回的那則 id，顯示時再從同一串裡查作者與摘要。
ALTER TABLE posts ADD COLUMN reply_to TEXT;
