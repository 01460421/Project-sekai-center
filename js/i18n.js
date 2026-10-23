/* ---------- 站內翻譯（繁中 → 簡中／English／日本語） ----------
   網站原文是繁體中文。切換語言時不重畫頁面，而是在 DOM 上把文字節點與 placeholder／title／aria-label 換掉：
   - 簡中：OpenCC（vendor/opencc-t2cn.js，台灣正體 → 大陸簡體，連詞彙一起轉：伺服器→服务器、資料→数据），整站涵蓋。
   - English／日本語：介面詞典（導覽、頁名與說明、頁首、切換器、客服視窗、日服現況與常用按鈕），整句對得上才換；
     對不上的維持原文，不做半句中半句英的拼貼。遊戲專有名詞（曲名、卡名、玩家名）一律不動。
   原文存在 WeakMap：換語言或切回繁中時從原文重算。runtime（React）之後改寫同一個文字節點時，
   MutationObserver 會在同一個 microtask 裡接手重翻，畫面不會閃出原文。
   不翻譯：script／style／textarea／code、輸入框的值，以及 translate="no" 或 .notranslate 底下的節點。
   app.js 的 setLang() 動態載入這支並呼叫 applyLang()；語言存在 localStorage 'sekai-lang'。 */

const ATTRS = ['placeholder', 'title', 'aria-label'];
const SKIP = /^(SCRIPT|STYLE|TEXTAREA|CODE|PRE|NOSCRIPT|svg|SVG|INPUT|SELECT|OPTION)$/;
const HAN = /[㐀-鿿]/;

let lang = 'zh-TW', cnConv = null, mo = null, busy = false;
const src = new WeakMap();      // 文字節點 → 原文
const out = new WeakMap();      // 文字節點 → 我們寫進去的譯文（用來分辨「runtime 改了原文」與「是我們自己寫的」）
const asrc = new WeakMap();     // 元素 → { 屬性: 原文 }

/* [繁中, English, 日本語]。整句比對（去掉前後空白），所以只放會單獨出現在一個文字節點裡的字串。 */
const DICT = [
  // 導覽列與功能家族
  ['主頁', 'Main', 'メイン'], ['首頁', 'Home', 'ホーム'], ['收藏與待辦', 'Favorites & To-do', 'お気に入りとToDo'], ['我的帳號', 'My Account', 'マイアカウント'],
  ['追活動', 'Events', 'イベント'], ['活動總覽', 'Event Overview', 'イベント概要'], ['排名與榜線', 'Rankings & Borders', 'ランキングとボーダー'],
  ['圖鑑與資料', 'Database', 'データベース'], ['日程與公告', 'Schedule & News', 'スケジュールとお知らせ'], ['卡片圖鑑', 'Cards', 'カード図鑑'],
  ['角色與收集', 'Characters & Collection', 'キャラとコレクション'], ['歌曲', 'Songs', '楽曲'], ['劇情與漫畫', 'Stories & Comics', 'ストーリーと漫画'],
  ['豆森 MySekai', 'MySekai', 'マイセカイ'], ['計算工具', 'Calculators', '計算ツール'], ['計算中心', 'Calculator Hub', '計算センター'],
  ['Haruki 專區', 'Haruki Zone', 'Haruki ゾーン'], ['抽卡與儲值', 'Gacha & Shop', 'ガチャと課金'], ['B30 產生器', 'B30 Generator', 'B30 ジェネレーター'],
  ['小遊戲與製作', 'Games & Makers', 'ミニゲームと作成'], ['社群與說明', 'Community & Help', 'コミュニティとヘルプ'], ['車隊', 'Team Rooms', '車（周回部屋）'],
  ['教學與社群', 'Guides & Community', 'ガイドとコミュニティ'], ['特別專案', 'Special projects', '特別プロジェクト'], ['常用', 'Frequent', 'よく使う'],
  ['SEKAI 星圖', 'SEKAI Starmap', 'SEKAI 星図'], ['衝榜劇場', 'Ranking Theater', 'ランキング劇場'], ['SEKAI 聲紋', 'SEKAI Soundprint', 'SEKAI 声紋'], ['迴響之境', 'Echoes', 'エコーズ'],
  ['經典長頁版 ↗', 'Classic one-page version ↗', 'クラシック版 ↗'], ['EP 計算器 ↗', 'EP Calculator ↗', 'EP 計算機 ↗'], ['教學大全 ↗', 'Guides ↗', 'ガイド集 ↗'],
  ['圖鑑', 'Database', '図鑑'], ['工具', 'Tools', 'ツール'], ['社群', 'Community', 'コミュニティ'], ['搜尋', 'Search', '検索'], ['更多', 'More', 'もっと見る'],
  // 頁名
  ['活動資料', 'Event Data', 'イベントデータ'], ['日服現況', 'JP Server Now', '日本版の現況'], ['排程預測', 'Schedule Forecast', 'スケジュール予測'],
  ['活動日曆', 'Event Calendar', 'イベントカレンダー'], ['卡池列表', 'Gacha List', 'ガチャ一覧'], ['歌曲清單', 'Song List', '楽曲一覧'], ['活動排名', 'Event Ranking', 'イベントランキング'],
  ['進階計算', 'Advanced Calc', '詳細計算'], ['儲值分析', 'Shop Analysis', '課金分析'], ['教學大全', 'Guides', 'ガイド集'], ['抽卡模擬', 'Gacha Simulator', 'ガチャシミュレーター'],
  ['收集室', 'Collection Room', 'コレクションルーム'], ['收集率', 'Collection Rate', '収集率'], ['分析中心', 'Analysis', '分析センター'], ['資源連結', 'Resources', 'リンク集'],
  ['榜線資料庫', 'Border Database', 'ボーダーデータベース'], ['製作與致謝', 'Credits', 'クレジット'], ['功能介紹', 'Features', '機能紹介'], ['私車排班', 'Room Scheduling', '車シフト'],
  ['菜根機器人', 'Caigen Bot', '菜根ボット'], ['管理後台', 'Admin', '管理画面'], ['站內助手', 'Site Assistant', 'サイトアシスタント'], ['通知', 'Notifications', '通知'],
  ['提問所', 'Q&A Board', '質問掲示板'], ['卡片技能庫', 'Card Skills', 'カードスキル一覧'], ['卡面下載', 'Card Art', 'カードイラスト'], ['WL 後排加成', 'WL Support Bonus', 'WL サポート補正'],
  ['理論技能倍率表', 'Skill Multiplier Table', '理論スキル倍率表'], ['月卡玩偶', 'Monthly Plushies', '月パスぬいぐるみ'], ['加分卡參考', 'Bonus Cards', 'ボーナスカード'],
  ['玩家查詢', 'Player Lookup', 'プレイヤー検索'], ['活動分布', 'Event Timeline', 'イベント分布'], ['角色圖鑑', 'Characters', 'キャラクター図鑑'], ['家具圖鑑', 'Fixtures', '家具図鑑'],
  ['豆森對話', 'MySekai Talks', 'マイセカイ会話'], ['素材圖鑑', 'Materials', '素材図鑑'], ['一格漫畫', 'One-frame Comics', '1コマ漫画'], ['原聲帶', 'Soundtrack', 'サウンドトラック'],
  ['虛擬 Live', 'Virtual Lives', 'バーチャルライブ'], ['遊戲公告', 'Game News', 'ゲームのお知らせ'], ['劇情閱讀器', 'Story Reader', 'ストーリーリーダー'], ['猜角色', 'Guess the Character', 'キャラ当て'],
  ['猜封面', 'Guess the Jacket', 'ジャケット当て'], ['貼圖製作器', 'Sticker Maker', 'スタンプメーカー'], ['樂曲追加圖產生器', 'New Song Card Maker', '楽曲追加画像メーカー'], ['譜面預覽產生器', 'Chart Preview Maker', '譜面プレビューメーカー'],
  // 頁面說明
  ['當期活動、遊戲通知、主要卡池與我的進度', 'Current event, game news, featured gacha and my progress', '開催中のイベント、お知らせ、注目ガチャと自分の進捗'],
  ['本期活動一頁看完：倒數、我的名次、榜線預測、當期卡池、加分卡與劇情', 'This event on one page: countdown, my rank, border forecast, gacha, bonus cards and story', '今回のイベントを1ページで：カウントダウン、順位、ボーダー予測、ガチャ、特効カード、ストーリー'],
  ['任一期活動的時程、加成屬性與角色、活動卡（抽卡／活動商店）、排名獎勵，WL 章節與嘉年華隊伍', 'Any event: schedule, bonus attribute and characters, event cards, ranking rewards, WL chapters and Carnival teams', '任意のイベントの日程、ボーナス属性とキャラ、イベントカード、ランキング報酬、WL 章とチアフルカーニバル'],
  ['日服目前的版本、進行中的活動與即時榜線、開放中的卡池、新曲，以及網路上的日服資源', 'JP server version, current event with live borders, open gacha, new songs and community resources', '日本版のバージョン、開催中のイベントとリアルタイムボーダー、開催中のガチャ、新曲、ネット上のリソース'],
  ['切到日服時的首頁：日服版本、進行中的活動與即時榜線、開放中的卡池與新曲', 'Home in JP mode: version, current event with live borders, open gacha and new songs', '日本版モードのホーム：バージョン、開催中のイベントとボーダー、ガチャ、新曲'],
  ['台服照日服同一天加一年、日服照自己的年度排程：未來活動與卡池的預測時間（含日服還沒公布的），逐期回測命中率與延遲歷史', 'TW follows JP one year later on the same date; forecasts of future events and gacha (incl. unannounced JP ones) with backtests', '台湾版は日本版の同日＋1年：今後のイベントとガチャの予測（日本版未発表分を含む）とバックテスト'],
  ['星號收藏的卡片、角色、家具、歌曲與卡池，加上還沒做完的事：跑榜目標、豆森缺的家具、未讀通知', 'Starred cards, characters, fixtures, songs and gacha, plus open to-dos', 'お気に入りのカード・キャラ・家具・楽曲・ガチャと、未完了のToDo'],
  ['卡池開放期間（台服預測時間）', 'Gacha periods (TW forecast times)', 'ガチャ開催期間（台湾版予測）'],
  ['台服全曲（Haruki 台服 master）＋日服未實裝曲（Sekai-World 日服 master），BPM／歌長來自社長 bot', 'All TW songs plus JP-only songs, with BPM and length', '台湾版の全楽曲＋日本版のみの楽曲（BPM・曲長つき）'],
  ['即時排名與分段榜線（HiSekai API）', 'Live ranking and borders', 'リアルタイムランキングとボーダー'],
  ['EP 精算 · 效率排行 · 摸魚表 · 活動試算 · 倍率 · 天井 · 烤森 · 排位', 'Event points · efficiency · idle table · event plan · multiplier · pity · MySekai · rank match', 'イベントP・効率・放置表・イベント試算・倍率・天井・マイセカイ・ランクマ'],
  ['綜合力 · 組卡優化 · 分數估算 · 跑榜工作室（完整引擎，即時抓主資料庫）', 'Team power · deck optimizer · score estimate · ranking studio', '総合力・編成最適化・スコア推定・周回スタジオ'],
  ['商城全商品 CP 值 · 月卡通行證攤提 · 智慧推薦最省錢購買組合', 'Value of every shop item, pass amortization and cheapest bundles', 'ショップ全商品のコスパ・パス按分・最安の購入組み合わせ'],
  ['用你在 Haruki 工具箱的遊戲資料：活動最佳組卡、角色等級 EXP，以及 master、素材與 API 資源', 'Your Haruki Toolbox data: best event decks, character rank EXP, master and API resources', 'Haruki ツールボックスのデータで：イベント最適編成、キャラランク EXP、マスターと API'],
  ['115 則問答：養成、車隊、衝榜與音遊練習', '115 Q&As: progression, rooms, ranking and practice', '115 の Q&A：育成、周回部屋、ランキング、音ゲー練習'],
  ['資源連結', 'Resources', 'リンク集'], ['官方、資訊站、社群、Wiki 與工具', 'Official, info sites, communities, wikis and tools', '公式、情報サイト、コミュニティ、Wiki、ツール'],
  ['用問的就好：榜線、卡池、編組、規劃，它會自己去查站上的資料', 'Just ask: borders, gacha, decks, plans — it looks up the site data itself', '聞くだけ：ボーダー、ガチャ、編成、計画をサイトのデータから調べます'],
  ['26 位角色的檔案：聲優、生日、身高、學校、喜好與相關卡片', 'Profiles of all 26 characters with related cards', '26 人のプロフィールと関連カード'],
  ['養成素材與 MySekai 素材一覽', 'Training and MySekai materials', '育成素材とマイセカイ素材'],
  ['遊戲內小提示的一格漫畫（台服翻譯版）', 'One-frame tip comics', 'ゲーム内の 1 コマ漫画'],
  ['遊戲內 BGM：區域、劇情、Live 與卡池音樂，站內直接播放', 'In-game BGM, playable on the site', 'ゲーム内 BGM をサイト上で再生'],
  ['卡片圖鑑勾選，即時算出各團與各稀有度的收集進度', 'Tick cards you own and see collection progress by unit and rarity', '所持カードにチェックしてユニット・レア度別の収集率を表示'],
  ['超高清原圖直連（特訓前後與去背立繪，官方素材庫）', 'Full-size card art (before/after training and cutouts)', '高解像度カードイラスト（特訓前後・立ち絵）'],
  ['豆森娃月列表與輪替', 'Monthly MySekai plushie rotation', 'マイセカイぬいぐるみの月別ローテーション'],
  ['用 ID 查任一玩家的公開資料與編組', 'Look up any player\'s public profile and deck by ID', 'ID でプレイヤーの公開プロフィールと編成を検索'],
  ['看一小塊卡面猜是誰：十題一局，猜得越快分數越高', 'Guess the character from a crop of card art', 'カードの一部からキャラを当てる'],
  ['看一小塊曲繪猜歌名：十題一局，可調選項數與難度', 'Guess the song from a crop of its jacket', 'ジャケットの一部から曲名を当てる'],
  // 頁首與切換器
  ['伺服器', 'Server', 'サーバー'], ['語言', 'Language', '言語'], ['台服', 'TW', '台湾版'], ['日服', 'JP', '日本版'],
  ['繁中 · HiSekai＋Haruki', 'Trad. Chinese · HiSekai + Haruki', '繁体字・HiSekai＋Haruki'], ['Haruki 追蹤器＋Sekai-World', 'Haruki tracker + Sekai-World', 'Haruki トラッカー＋Sekai-World'],
  ['正在切到日服…', 'Switching to JP…', '日本版に切り替え中…'], ['正在切回台服…', 'Switching to TW…', '台湾版に切り替え中…'],
  ['切換伺服器會重新載入頁面；語言立即生效', 'Switching server reloads the page; language applies instantly', 'サーバー切替でページを再読み込み、言語はすぐ反映されます'],
  ['英文與日文目前翻譯介面與主要頁面，其餘內容維持中文', 'English covers the interface and main pages; other content stays in Chinese', '日本語はインターフェースと主要ページのみ対応、その他は中国語のままです'],
  ['這一頁目前只有台服資料', 'This page only has TW data for now', 'このページは今のところ台湾版のデータのみです'],
  ['切回台服', 'Switch to TW', '台湾版に戻す'], ['日服可以看：', 'Available for JP:', '日本版で見られるページ：'],
  ['複製連結', 'Copy link', 'リンクをコピー'], ['重新整理', 'Refresh', '更新'], ['載入中…', 'Loading…', '読み込み中…'], ['顯示更多', 'Show more', 'もっと見る'],
  ['關閉', 'Close', '閉じる'], ['取消', 'Cancel', 'キャンセル'], ['確定', 'OK', 'OK'], ['返回', 'Back', '戻る'], ['前往', 'Go', '開く'], ['全部', 'All', 'すべて'],
  ['登入', 'Sign in', 'ログイン'], ['登出', 'Sign out', 'ログアウト'], ['設定', 'Settings', '設定'], ['送出', 'Send', '送信'], ['清除', 'Clear', 'クリア'],
  // 日服現況
  ['進行中的活動', 'Current event', '開催中のイベント'], ['即時榜線', 'Live borders', 'リアルタイムボーダー'], ['前十名', 'Top 10', 'トップ10'],
  ['開放中的卡池', 'Open gacha', '開催中のガチャ'], ['即將開放', 'Coming soon', 'まもなく開始'], ['新曲', 'New songs', '新曲'], ['近期活動', 'Recent events', '最近のイベント'],
  ['接下來的活動', 'Upcoming events', '今後のイベント'], ['日服資源', 'JP resources', '日本版のリソース'], ['加成屬性', 'Bonus attribute', 'ボーナス属性'], ['加成角色', 'Bonus characters', 'ボーナスキャラ'],
  ['活動卡', 'Event cards', 'イベントカード'], ['距離結算', 'Until results', '集計まで'], ['完整排名', 'Full ranking', 'ランキング全体'], ['看日服還沒公布的活動預測', 'Forecast of unannounced JP events', '未発表イベントの予測を見る'],
  ['World Link 章節', 'World Link chapters', 'World Link 各章'], ['即將公開', 'Coming soon', '公開予定'], ['進行中', 'Ongoing', '開催中'],
  ['伺服器與語言', 'Server and language', 'サーバーと言語'], ['這期的加成', 'This event\'s bonuses', '今回のボーナス'], ['日服 master', 'JP master', '日本版マスター'],
  ['Haruki 日服追蹤器', 'Haruki JP tracker', 'Haruki 日本版トラッカー'], ['依公開時間', 'By release date', '公開日順'], ['日服已公布', 'Announced in JP', '日本版で発表済み'],
  ['網路上整理好的日服工具與資料站', 'JP tools and data sites from the community', 'コミュニティの日本版ツールとデータサイト'], ['整站切到日服 →', 'Switch the whole site to JP →', 'サイト全体を日本版に →'],
  ['已結算・等待公布', 'Closed · awaiting results', '集計中・結果発表待ち'], ['已結束', 'Ended', '終了'], ['日服現況載入中…', 'Loading JP status…', '日本版の現況を読み込み中…'],
  ['馬拉松', 'Marathon', 'マラソン'], ['歡樂嘉年華', 'Cheerful Carnival', 'チアフルカーニバル'], ['混活', 'Mixed', '混合'], ['限定／PU', 'Limited / Pick-up', '限定・ピックアップ'], ['一般', 'Standard', '通常'],
  ['官方', 'Official', '公式'], ['資料庫', 'Databases', 'データベース'], ['Wiki 與攻略', 'Wikis & guides', 'Wiki・攻略'], ['榜線', 'Borders', 'ボーダー'], ['開放資料', 'Open data', 'オープンデータ'],
  ['卡片', 'Cards', 'カード'], ['角色', 'Characters', 'キャラクター'], ['活動', 'Events', 'イベント'], ['卡池', 'Gacha', 'ガチャ'],
  // 線上客服
  ['SEKAI 線上客服', 'SEKAI Help', 'SEKAI サポート'], ['小幫手', 'Helper', 'ヘルパー'], ['AI 助手', 'AI Assistant', 'AI アシスタント'], ['留言', 'Messages', 'メッセージ'],
  ['即時回覆・不用登入、不花額度', 'Instant answers · no sign-in, no quota', '即答・ログイン不要・回数制限なし'],
  ['站長通常一天內回覆・回覆會亮紅點', 'Replies usually within a day · you\'ll see a red dot', '通常 1 日以内に返信・返信は赤い点でお知らせ'],
  ['AI 助手待命中・會自己查站上的資料', 'AI assistant ready · looks up site data itself', 'AI アシスタント待機中・サイトのデータを自分で調べます'],
  ['登入並核准後可以使用', 'Available after sign-in and approval', 'ログインと承認後に利用できます'], ['重新開始', 'Start over', '最初から'], ['新對話', 'New chat', '新しい会話'],
  ['＋ 寫一則新留言', '+ New message', '＋ 新しいメッセージ'], ['功能建議', 'Suggestion', '機能の提案'], ['問題回報', 'Bug report', '不具合の報告'], ['資料有誤', 'Wrong data', 'データの誤り'], ['其他', 'Other', 'その他'],
  ['登入後就能問 AI 助手', 'Sign in to ask the AI assistant', 'ログインすると AI アシスタントに質問できます'], ['登入後留言給站長', 'Sign in to message the site owner', 'ログインして管理人にメッセージ'],
  ['帳號審核中', 'Account pending approval', 'アカウント審査中'], ['想問什麼？', 'What would you like to ask?', '何を聞きたいですか？'], ['留言給站長', 'Message the site owner', '管理人にメッセージ'],
  ['用 Google 登入', 'Sign in with Google', 'Google でログイン'], ['用 Discord 登入', 'Sign in with Discord', 'Discord でログイン'], ['看公開的提問所', 'Open the public Q&A board', '公開の質問掲示板を見る'],
  ['我要給建議／回報問題', 'Send feedback / report a problem', '提案・不具合を報告する'], ['切到日服', 'Switch to JP', '日本版に切り替え'], ['寫留言給站長', 'Write to the site owner', '管理人に書く'],
  ['交給 AI 助手回答', 'Ask the AI assistant', 'AI アシスタントに聞く'], ['看完整教學', 'Read the full guide', 'ガイド全文を読む'], ['站長', 'Owner', '管理人'], ['你', 'You', 'あなた'],
  ['問我任何事：現在的榜線、跑哪首最快、功能在哪…', 'Ask me anything: current borders, fastest song, where a feature is…', '何でも聞いてください：今のボーダー、効率の良い曲、機能の場所…'],
  ['問 AI 助手（用 1 次額度）', 'Ask the AI assistant (uses 1 of your daily quota)', 'AI アシスタントに質問（1 回分を使用）'], ['回覆站長…', 'Reply to the owner…', '管理人に返信…'],
  ['先選分類，再寫下想說的話', 'Pick a category, then write your message', 'カテゴリを選んでから書いてください'], ['描述一下：在哪一頁、做了什麼、看到什麼', 'Describe it: which page, what you did, what you saw', 'どのページで何をして何が起きたか'],
  ['開啟完整頁面', 'Open full page', 'ページで開く'], ['線上客服', 'Help', 'サポート'], ['線上客服：小幫手、AI 助手與留言給站長', 'Help: helper, AI assistant and messages to the owner', 'サポート：ヘルパー、AI アシスタント、管理人へのメッセージ'],
  ['需要幫忙嗎？找功能、查榜線，問我就好', 'Need help? Ask me about features or borders', 'お困りですか？機能やボーダーのことなら聞いてください'], ['SEKAI 小幫手', 'SEKAI Helper', 'SEKAI ヘルパー'],
];

/* 帶數字的固定句型：[正規式, English, 日本語]（$1… 照原文帶入） */
const PATTERNS = [
  [/^(\d+)天 (\d+:\d{2}(?::\d{2})?)$/, '$1d $2', '$1日 $2'],
  [/^(\d+) 天 (\d+) 小時$/, '$1d $2h', '$1日 $2時間'], [/^(\d+) 小時 (\d+) 分$/, '$1h $2m', '$1時間 $2分'], [/^(\d+) 分$/, '$1 min', '$1分'],
  [/^剩 (.+)$/, '$1 left', '残り $1'], [/^(.+)後開放$/, 'opens in $1', '$1後に開始'], [/^(.+)後公開$/, 'out in $1', '$1後に公開'], [/^(.+)後開始$/, 'starts in $1', '$1後に開始'],
  [/^第 (\d+) 期・(.+)$/, 'Event $1 · $2', '第$1回・$2'], [/^第 (\d+) 期$/, 'Event $1', '第$1回'], [/^第 (\d+) 章・(.+)$/, 'Ch. $1 · $2', '第$1章・$2'],
  [/^(\d+) 個開放中・(\d+) 個即將開放$/, '$1 open · $2 coming', '開催中 $1・予定 $2'], [/^(\d+) 個開放中$/, '$1 open', '開催中 $1'],
  [/^更新於 (\d+:\d{2})・每 2 分鐘重抓（追蹤器約每小時一筆）$/, 'Updated $1 · refetched every 2 min (tracker samples hourly)', '$1 更新・2 分ごとに再取得（トラッカーは約 1 時間ごと）'],
];

/* 簡中的補充詞：OpenCC 的 twp 詞典沒有、但大陸慣用的說法 */
const CN_FIX = [['帐号', '账号'], ['帐户', '账户']];

let MAP = null;
function dictMap() {
  if (MAP) return MAP;
  MAP = { en: new Map(), ja: new Map() };
  DICT.forEach(([zh, en, ja]) => { MAP.en.set(zh, en); MAP.ja.set(zh, ja); });
  return MAP;
}

export function tr(text) {
  if (lang === 'zh-TW' || !text || !HAN.test(text)) return text;
  if (lang === 'zh-CN') {
    if (!cnConv) return text;
    let t = cnConv(text);
    for (const [a, b] of CN_FIX) if (t.includes(a)) t = t.split(a).join(b);
    return t;
  }
  const m = dictMap()[lang];
  if (!m) return text;
  const core = text.trim();
  let hit = m.get(core);
  if (hit == null) {
    const i = lang === 'en' ? 1 : 2;
    for (const p of PATTERNS) if (p[0].test(core)) { hit = core.replace(p[0], p[i]); break; }
    if (hit == null) return text;
  }
  return text.replace(core, hit);
}

function skipEl(el) {
  for (let e = el; e && e.nodeType === 1; e = e.parentNode) {
    if (SKIP.test(e.nodeName) || e.isContentEditable) return true;
    if (e.getAttribute('translate') === 'no' || (e.classList && e.classList.contains('notranslate'))) return true;
    if (e === document.body) break;
  }
  return false;
}

function fixText(n, force) {
  const v = n.nodeValue;
  const mine = src.has(n) && out.get(n) === v;       // 現在的內容是我們寫的（或已處理過、沒變）
  if (mine && !force) return;
  if (!mine) src.set(n, v);                          // runtime 換了內容：這就是新的原文
  const s = src.get(n);
  if (!s || !HAN.test(s) || skipEl(n.parentNode)) { out.delete(n); return; }
  const t = tr(s);
  out.set(n, t);
  if (t !== v) n.nodeValue = t;
}

function fixAttrs(el) {
  if (!el.getAttribute || skipEl(el.parentNode || el)) return;
  let rec = asrc.get(el);
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v == null) continue;
    if (!rec) { rec = {}; asrc.set(el, rec); }
    if (!rec[a] || (rec[a].out !== v)) rec[a] = { src: v, out: null };
    if (!HAN.test(rec[a].src)) continue;
    const t = tr(rec[a].src);
    rec[a].out = t;
    if (t !== v) el.setAttribute(a, t);
  }
}

function walk(root, force) {
  if (!root) return;
  if (root.nodeType === 3) { fixText(root, force); return; }
  if (root.nodeType !== 1 || SKIP.test(root.nodeName)) return;
  fixAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: n => (n.nodeType === 1 && SKIP.test(n.nodeName)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) fixText(n, force); else fixAttrs(n); }
}

function observe() {
  if (mo) return;
  mo = new MutationObserver(list => {
    if (busy) return;
    busy = true;
    try {
      for (const m of list) {
        if (m.type === 'characterData') fixText(m.target);
        else if (m.type === 'attributes') fixAttrs(m.target);
        else m.addedNodes.forEach(walk);
      }
    } finally { busy = false; }
  });
  mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

function loadOpenCC(url) {
  if (cnConv) return Promise.resolve();
  return new Promise((ok, bad) => {
    const done = () => { try { cnConv = window.OpenCC.Converter({ from: 'twp', to: 'cn' }); ok(); } catch (e) { bad(e); } };
    if (window.OpenCC) { done(); return; }
    const s = document.createElement('script');
    s.src = url; s.async = true; s.onload = done; s.onerror = () => bad(new Error('OpenCC 載入失敗'));
    document.head.appendChild(s);
  });
}

/* 換語言：先把整頁從原文重算一次，再交給 observer 盯後續的變動 */
export async function applyLang(next) {
  next = ['zh-CN', 'en', 'ja'].includes(next) ? next : 'zh-TW';
  if (next === 'zh-CN') await loadOpenCC('./vendor/opencc-t2cn.js?v=1801065fcd');
  lang = next;
  document.documentElement.lang = { 'zh-TW': 'zh-Hant-TW', 'zh-CN': 'zh-Hans-CN', en: 'en', ja: 'ja' }[next];
  busy = true;
  try { walk(document.body, true); } finally { busy = false; }
  if (next === 'zh-TW') { if (mo) { mo.disconnect(); mo = null; } } else observe();
  return next;
}

export function currentLang() { return lang; }
