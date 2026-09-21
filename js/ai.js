  /* ---------- AI 助手：工具集 ----------
     工具在瀏覽器執行,因為站上的計算引擎、卡片資料、榜線快照、教學大全都在前端,
     Worker 沒有那些東西。Worker 只代理 Claude API(保護金鑰)與稽核。
     模型只能呼叫下面這份寫死的清單,參數由它決定但執行邏輯是我們的。 */
/* 這個檔案是從 app.js 抽出來延後載入的：AI 助手只有登入且核准的使用者用得到，
   一般訪客不該下載這 500 KB。app.js 的 loadAi() 動態 import 後把這些成員掛到實例上：
   Object.assign(app, aiMembers.call(app)) —— 用 call 是為了讓箭頭函式裡的 this 指到 app。 */
export function aiMembers() {
  return {
  AI_TOOLS: [
    { name: 'set_my_uid',
      description: '設定使用者的遊戲 ID(uid)。使用者說「我的 id 是 xxx」時用。',
      input_schema: { type: 'object', properties: {
        uid: { type: 'string', description: '遊戲內 ID，純數字' } }, required: ['uid'] } },
    { name: 'get_my_status',
      description: '目前 uid 在當期活動的狀態：分數、名次、實測時速、預測終分、距各段位還差多少分與需要幾小時。',
      input_schema: { type: 'object', properties: {} } },
    { name: 'get_current_event',
      description: '當期活動的名稱、型態(馬拉松/嘉年華/World Link)、起訖時間、已過進度、剩餘時數。',
      input_schema: { type: 'object', properties: {} } },
    { name: 'get_upcoming_events',
      description: '接下來幾期活動的排程與型態。規劃「接下來兩期怎麼跑」時用。',
      input_schema: { type: 'object', properties: {
        n: { type: 'integer', description: '要幾期，預設 3，上限 8' } } } },
    { name: 'get_borders',
      description: '當期各段位榜線：目前分數、預測終線(實測或線性)、同型態歷史加權估計與區間。',
      input_schema: { type: 'object', properties: {
        tiers: { type: 'array', items: { type: 'integer' }, description: '段位如 [100,1000,5000]，不給回全部' } } } },
    { name: 'get_gacha_schedule',
      description: '卡池排程：期間、類型、PU 角色、伴生活動。規劃「該抽哪些池」時用。',
      input_schema: { type: 'object', properties: {
        from: { type: 'string', description: '起始日 YYYY/MM/DD，預設今天' },
        to: { type: 'string', description: '結束日 YYYY/MM/DD，預設起始日 +90 天' },
        type: { type: 'string', description: '類型須完全相符：「FES池」「普通限定池」「常駐池」' } } } },
    { name: 'get_history_borders',
      description: '歷史榜線資料庫(174 期)，依型態/日數/團體篩選看各段位終線。判斷某個目標線合不合理時用。',
      input_schema: { type: 'object', properties: {
        type: { type: 'string', description: '馬拉松 / 歡樂嘉年華 / World Link' },
        days: { type: 'number', description: '活動天數' },
        unit: { type: 'string', description: '團體名' },
        limit: { type: 'integer', description: '預設 12，上限 30' } } } },
    { name: 'search_tutorial',
      description: '搜尋站上教學大全(115 則問答：養成、車隊、衝榜、音遊練習)。問玩法、規則、名詞時先查這個，引用站上說法。',
      input_schema: { type: 'object', properties: {
        q: { type: 'string', description: '關鍵字' } }, required: ['q'] } },
    { name: 'get_my_cards',
      description: '目前 uid 的持有卡片與編組（公開 API）：稀有度、屬性、角色、專精等級。要算加成或建議抽什麼時用。',
      input_schema: { type: 'object', properties: {} } },
    { name: 'schedule_task',
      description: '排一個之後才執行的提醒（存伺服器由排程跑，需管理員）。如「活動剩 12 小時時提醒我」。',
      input_schema: { type: 'object', properties: {
        title: { type: 'string' },
        action: { type: 'string', description: 'notify＝寄信通知（預設）' },
        run_at_iso: { type: 'string', description: 'ISO 8601 時間' },
        repeat_hours: { type: 'number', description: '重複週期（小時），不給只跑一次' },
        message: { type: 'string' } },
        required: ['title', 'run_at_iso'] } },
    { name: 'calc_event_points',
      description: '算單場 Live 的活動 P 與每體力／每小時效率。問「跑一場多少 P」「加成 xxx% 值不值」「哪種模式快」時用。只算單首，全曲排行用 song_efficiency。參數省略沿用計算中心共用設定。',
      input_schema: { type: 'object', properties: {
        mode: { type: 'string', enum: ['solo', 'auto', 'multi', 'cheer'], description: 'solo 單人／auto 自動／multi 協力／cheer 應援' },
        song_id: { type: 'integer', description: '歌曲 id（get_songs 查），不給用畫面選的' },
        difficulty: { type: 'string', enum: ['E', 'N', 'H', 'X', 'M', 'A'], description: 'X＝EXPERT、M＝MASTER、A＝APPEND' },
        power: { type: 'number', description: '隊伍綜合力（如 250000）' },
        bonus: { type: 'number', description: '活動加成 %（250＝+250%）' },
        skill: { type: 'number', description: '平均技能倍率（如 2.5），可由 calc_skill_multiplier 算' },
        s6: { type: 'number', description: '第 6 技能欄（S6）倍率' },
        energy: { type: 'integer', description: '吃幾火 0～10（0＝不吃火）' },
        life: { type: 'number', description: '結束時剩餘 Life，僅 cheer 用到' },
        score: { type: 'number', description: '直接指定分數，給了就不推算' },
        event_rate: { type: 'number', description: '歌曲活動倍率 %（無 song_id 時才用，預設 100）' } } } },
    { name: 'song_efficiency',
      description: '全曲庫效率排行（站上「效率排行」）。問「跑哪首最快」「效益曲排行」「哪首最省體力／一場拿最多 P」「哪首分數最高」時用——用 sort_by 區分，選錯就答非所問。參數省略沿用計算中心設定。',
      input_schema: { type: 'object', properties: {
        limit: { type: 'integer', description: '最多 100，預設 20。已是全曲庫完整排行的前 N 名，別分批拼湊' },
        offset: { type: 'integer', description: '從第幾名開始，翻頁用' },
        mode: { type: 'string', enum: ['solo', 'auto', 'multi', 'cheer'], description: 'solo 單人／auto 自動／multi 協力／cheer 應援' },
        difficulty: { type: 'string', enum: ['E', 'N', 'H', 'X', 'M', 'A'], description: 'X＝EXPERT、M＝MASTER、A＝APPEND' },
        power: { type: 'number', description: '隊伍綜合力' },
        bonus: { type: 'number', description: '活動加成 %' },
        skill: { type: 'number', description: '平均技能倍率' },
        s6: { type: 'number', description: 'S6 倍率' },
        energy: { type: 'integer', description: '每場吃幾火 0～10' },
        interval: { type: 'number', description: '每場間隔秒數（選曲／配對／結算），預設 50' },
        sort_by: { type: 'string', enum: ['eph', 'ep', 'score'], description: '預設 eph。eph＝每小時活動P（時間有限，偏短曲／效率曲）；ep＝單局活動P（體力有限，偏長曲／效益曲）；score＝單局分數，與活動倍率無關' } } } },
    { name: 'calc_skill_multiplier',
      description: '由隊長與 4 位隊員的技能加成 % 算「平均技能倍率」，即 calc_event_points／song_efficiency 的 skill 參數。隊長全額、隊員總和 ÷5。',
      input_schema: { type: 'object', properties: {
        leader: { type: 'number', description: '隊長技能加成 %（如 115）' },
        members: { type: 'array', items: { type: 'number' }, description: '4 位隊員技能加成 %，如 [110,110,110,110]' } } } },
    { name: 'gacha_odds',
      description: '抽卡機率與天井試算：預算內至少中一張的機率、期望抽數、離天井還差多少水晶。問「我這些石抽得到嗎」「還差幾抽天井」時用。只算機率，不實際模擬抽卡。單抽 300 水晶。',
      input_schema: { type: 'object', properties: {
        rate: { type: 'number', description: '單抽命中機率（小數）：指定 PU 約 0.004、任一 ★4 0.03、FES 0.06' },
        crystals: { type: 'number', description: '持有水晶數' },
        pulls_done: { type: 'number', description: '此池已抽次數（＝貼紙數）' },
        tickets: { type: 'number', description: '交換券張數，一張抵 10 貼紙、最多 10 張' },
        birthday: { type: 'boolean', description: '生日池：天井 100 抽、不可用交換券' } } } },
    { name: 'mysekai_calc',
      description: 'MySekai（烤森）採集的活動 P 試算：每點體力換多少 P、指定體力總量共多少。問「烤森採集划不划算」「橘體要不要留給烤森」時用。參數省略沿用共用設定。',
      input_schema: { type: 'object', properties: {
        power: { type: 'number', description: '隊伍綜合力' },
        bonus: { type: 'number', description: '活動加成 %' },
        fever: { type: 'number', description: '體力倍率：橘體 5、藍體 1' },
        stamina: { type: 'number', description: '打算消費的體力總量' } } } },
    { name: 'rank_match',
      description: '排位賽勝負判定與晉級試算：兩邊 PERFECT/GREAT/GOOD 誰贏、升到目標 Class 要打幾場。判定＝P×3＋G×2＋GOOD×1，同分比 PERFECT → 最大連段 → 剩餘 Life。',
      input_schema: { type: 'object', properties: {
        my_perfect: { type: 'number', description: '我方 PERFECT 數' },
        my_great: { type: 'number', description: '我方 GREAT 數' },
        my_good: { type: 'number', description: '我方 GOOD 數' },
        opp_perfect: { type: 'number', description: '對手 PERFECT 數' },
        opp_great: { type: 'number', description: '對手 GREAT 數' },
        opp_good: { type: 'number', description: '對手 GOOD 數' },
        win_rate: { type: 'number', description: '預估勝率 %（如 55）' },
        current_rp: { type: 'number', description: '目前 RP 0～5' },
        target_classes: { type: 'number', description: '想升幾個 Class（每個需 5 RP）' } } } },
    { name: 'get_songs',
      description: '查歌曲：定數、音符數、曲長、活動倍率、所屬團體、作曲者。也可把曲名轉成 song_id 餵給 calc_event_points。聽起來像曲名的陌生詞（玩家簡稱）先用 q 搜過再說，不要直接說不知道。',
      input_schema: { type: 'object', properties: {
        limit: { type: 'integer', description: '上限 100，預設 20。是完整排行前 N，別用多次小批次拼湊' },
        offset: { type: 'integer', description: '從第幾名開始，翻頁用' },
        q: { type: 'string', description: '曲名／作曲者關鍵字。曲庫存日文原名（ロキ），玩家講的簡稱也直接丟進來搜' },
        id: { type: 'integer', description: '指定歌曲 id' },
        unit: { type: 'string', enum: ['ln','mmj','vbs','wxs','n25','vs'], description: 'ln=Leo/need、mmj=MMJ、vbs=VBS、wxs=ワンダショ、n25=ニーゴ、vs=虛擬歌手' },
        difficulty: { type: 'string', enum: ['E','N','H','X','M','A'], description: '搭配 sort 的難度，預設 M（MASTER）' },
        sort: { type: 'string', enum: ['id','level','notes','newest','shortest'], description: 'level=定數高到低、notes=音符多到少、newest=最新實裝、shortest=曲長最短、id=編號' } } } },
    { name: 'analyze_player',
      description: '單一玩家節奏剖析：分數名次、1／3／24 小時實測時速、周回、動能、推估休息時數、預測終分與名次、場均百分位。問「我跑得算快嗎」「最後大概第幾名」時用。只有當期前 100 名查得到。',
      input_schema: { type: 'object', properties: {
        uid: { type: 'string', description: '玩家 uid，純數字；不給就用自己的' } } } },
    { name: 'get_player_games',
      description: '單一玩家逐局明細：每場加了多少活動 P、當下名次、場間隔，看得出在連打還是休息。每 15 秒取樣，只涵蓋當期前 100 名，且從開始追蹤後才有、不回溯。',
      input_schema: { type: 'object', properties: {
        uid: { type: 'string', description: '玩家 uid，純數字；不給就用自己的' },
        limit: { type: 'integer', description: '回最近幾場，預設 15，上限 20（統計仍用全部場次）' },
        hours: { type: 'number', description: '只看最近幾小時，不給＝整期' } } } },
    { name: 'get_player_profile',
      description: '玩家公開檔案：暱稱、玩家等級、隊伍綜合力（含基礎力與角色等級加成）、隊伍卡片、各角色等級、挑戰 Live 最高分。用來精算對方加成或看練度，比看截圖準。',
      input_schema: { type: 'object', properties: {
        uid: { type: 'string', description: '玩家 uid，純數字；不給就用自己的' } } } },
    { name: 'get_top100',
      description: '當期即時前 100 名榜單與全榜動態：誰在跑、誰在衝刺、誰停了、近 1 小時全榜幾場。問「現在前面誰在跑」「T100 有多兇」時用。',
      input_schema: { type: 'object', properties: {
        limit: { type: 'integer', description: '預設 10，上限 20' },
        board: { type: 'string', enum: ['event','world_link'], description: 'event＝活動主榜（預設）、world_link＝WL 章節榜' },
        chapter: { type: 'integer', description: 'board=world_link 時看第幾章，不給用進行中那章' },
        sort: { type: 'string', enum: ['rank','speed_1h','speed_24h'], description: '排序，預設 rank' } } } },
    { name: 'wl_team_advice',
      description: 'World Link 配隊建議：從使用者勾選的持有卡挑出「四位同團＋湊滿五色屬性」的實際 5 張，並指出缺哪一色。問「這章怎麼配隊」「我湊得出五色嗎」時用。是規則檢查，不是倍率最佳化。',
      input_schema: { type: 'object', properties: {
        character: { type: 'string', description: '角色名（繁中，如「奏」）或角色 id；不給用進行中章節的角色' },
        chapter: { type: 'integer', description: '章節 1～4，給了會覆蓋 character' } } } },
    { name: 'get_wl_status',
      description: 'World Link 章節狀態：章節角色、起訖時間、進行中／已結束、該章前幾名與分段榜線、各段位實測時速。問「WL 這章榜線多少」「哪章好衝」時用。非 WL 活動會回錯誤。',
      input_schema: { type: 'object', properties: {
        chapter: { type: 'integer', description: '只看某章（1～4），不給回全部' },
        tier: { type: 'integer', description: '要量實測時速的段位，預設 100' } } } },
    { name: 'get_collection_rate',
      description: '使用者的卡片收集率：整體、各團體、各稀有度各有幾張／缺幾張。問「我收集率多少」「哪個團最缺」時用。來自站上收集率頁的手動勾選，沒勾過就是 0。',
      input_schema: { type: 'object', properties: {} } },
    { name: 'plan_target',
      description: '衝榜規劃：算到目標段位／分數還差多少 P、要多少時速、幾場幾小時、吃多少體力、多少水晶與台幣。問「進 T1000 要花多少」「還來得及嗎」時用。段位目標取站上預測終線（末段偏低估，要當下限講）。',
      input_schema: { type: 'object', properties: {
        tier: { type: 'integer', description: '目標段位如 100／1000／5000，與 target_score 二擇一' },
        target_score: { type: 'number', description: '直接指定目標活動 P，給了就不看段位預測' },
        current_score: { type: 'number', description: '目前活動 P，不給就用站上我的分數' },
        mode: { type: 'string', enum: ['solo','auto','multi','cheer'], description: '跑哪種場次' },
        song_id: { type: 'integer', description: '跑哪首歌（影響曲長與活動倍率）' },
        difficulty: { type: 'string', enum: ['E','N','H','X','M','A'], description: '難度' },
        power: { type: 'number', description: '隊伍綜合力' },
        bonus: { type: 'number', description: '活動加成 %' },
        skill: { type: 'number', description: '平均技能倍率' },
        s6: { type: 'number', description: 'S6 倍率' },
        energy: { type: 'integer', description: '每場吃幾火 0～10' },
        natural_hours: { type: 'number', description: '自然回復的小時數（每小時 2 體）' },
        large_cans: { type: 'number', description: '大體力罐數（每罐 10 體）' },
        small_cans: { type: 'number', description: '小體力罐數（每罐 5 體）' },
        crystals: { type: 'number', description: '願意換體力的水晶數（100 石＝10 體）' },
        crystal_rate: { type: 'number', description: '水晶 CP：每 1 元台幣幾顆，預設約 7' } } } },
    { name: 'create_watch',
      description: '建立偵測訂閱，條件達成時伺服器寄信通知。「幫我盯著」「到 X 分時通知我」「活動快結束提醒我」時用。需已登入且帳號通過審核。不確定欄位就先用不完整參數呼叫一次，錯誤訊息會列出可用選項。',
      input_schema: { type: 'object', properties: {
        kind: { type: 'string', enum: ['border','player','schedule'], description: '偵測類型：border=榜線、player=玩家動態、schedule=活動與卡池排程' },
        mode: { type: 'string', description: 'border：tier_score（榜線到分）／my_rank_out（我掉出段位）；player：rank_change／started／stopped／passed_me；schedule：event_start／event_end／gacha_start／gacha_end／wl_chapter' },
        params: { type: 'object', description: '該模式的欄位，例如 {board:"event",tier:1000,op:"gte",value:3000000}、{uid:"…"}、{before_h:24}。沒填的自動補預設，缺必填會回欄位規格' },
        name: { type: 'string', description: '訂閱名稱，不給就自動命名' },
        cooldown_s: { type: 'number', description: '兩次通知最短間隔秒數，不給用該類型預設' } },
        required: ['kind','mode'] } },
    { name: 'search_anything',
      description: '**遇到任何不認識的名詞就先用這個。** 一次搜曲庫、活動、卡片、卡池、教學大全，以及站台自己的功能索引——所以也能回答「站上有沒有 X 功能」「X 在哪一頁」。玩家講的多半是簡稱或圈內叫法（余花、蝦、開闢天地），把原話直接丟進來。找不到會回最接近的候選，不要自己猜或說不知道。',
      input_schema: { type: 'object', properties: {
        q: { type: 'string', description: '使用者講的那個詞，原樣丟進來' },
        kinds: { type: 'array', items: { type: 'string', enum: ['song','event','card','gacha','tutorial'] }, description: '限定只搜某幾類，不給就全部搜' } },
        required: ['q'] } },
    { name: 'get_card_skills',
      description: '查卡片的技能類型與各等級實際數值（分數提升 %、持續秒數），資料取自官方 master skills.json。問「這張卡技能幾 %」「我該抽哪張」「我手上哪張技能最高」時用。',
      input_schema: { type: 'object', properties: {
        ids: { type: 'array', items: { type: 'integer' }, description: '指定卡片 id' },
        chara: { type: 'integer', description: '角色 id 1-26' },
        rarity: { type: 'string', description: 'rarity_4 / rarity_birthday 等' },
        mine: { type: 'boolean', description: '只看目前 uid 持有的卡（需先設 uid）' },
        top: { type: 'integer', description: '依技能數值由高到低取前幾張，預設 15、上限 30' } } } },
    { name: 'get_b30',
      description: '算使用者的 B30（前 30 名実効值平均；AP＝譜面定數、FC＝定數−1，定數用非官方難易度表）並給「下一張打哪最划算」。問「我的 B30 多少」「怎麼提升」「該打哪首」「還差多少上 32」時用。成績來自站上「B30 產生器」頁的手動勾選，沒勾會回提示。',
      input_schema: { type: 'object', properties: {
        suggest_limit: { type: 'integer', description: '建議清單筆數，預設 15、上限 50。已是全曲庫依提升幅度排序的前 N，不要分批拼湊' },
        top_limit: { type: 'integer', description: 'B30 清單筆數，預設＝上限 30' },
        max_const: { type: 'number', description: '只建議定數 ≤ 此值。「我只打得動 31 以下」時帶；不給則依最佳成績自動推上限' },
        stretch: { type: 'number', description: '自動上限在最佳成績之上多探幾點定數，預設 0.5、最大 5；有 max_const 時無效' },
        pool: { type: 'string', enum: ['all','tw','jp'], description: '建議清單的曲庫範圍，預設 all。tw＝台服打得到、jp＝只看日服限定。B30 本身不受影響' },
        target: { type: 'string', enum: ['all','fc','ap'], description: '目標種類，預設 all。fc＝先打到 FC（好上手）、ap＝補 AP' } } } },
    { name: 'get_bonus_cards',
      description: '查某期活動的加分卡：該期加成屬性／團體／主推角色、哪些角色吃加成，以及每張卡實際加成％與原因（同角色＋同屬性／只同角色／只同屬性／本期活動卡）。問「這期加分卡有哪些」「我這張吃不吃加成」「某卡這期幾％」時用。',
      input_schema: { type: 'object', properties: {
        event_id: { type: 'integer', description: '活動期數，省略用當期；太未來的期數主資料庫還沒加成設定' },
        limit: { type: 'integer', description: '回幾張，預設 30、上限 100。已是依加成由高到低的前 N，不要分批拼湊' },
        offset: { type: 'integer', description: '從第幾名開始，翻頁用' },
        master_rank: { type: 'integer', description: '假設全卡專精 0～5，預設 5。只影響稀有度那段（★4 為 MR0 10%→MR5 25%）' },
        chara: { type: 'integer', description: '只看某角色，角色 id 1～26' },
        min_percent: { type: 'number', description: '只回加成％ ≥ 此值。只想看「同角色＋同屬性」那批就給 70' },
        include_low_rarity: { type: 'boolean', description: '是否列入 ★1～★3，預設 false（只列 ★4 與生日卡）' },
        mine: { type: 'boolean', description: '只看「收集率」頁勾選為持有的卡' } } } },
    { name: 'get_dolls',
      description: '月卡玩偶（豆森娃）排程：每月的月卡附贈玩偶輪到哪些角色，台服日服對照（台服晚 9 個月，日服欄可預告台服）。問「這個月的娃是誰」「下個月輪到誰」「某某什麼時候有娃」時用。characters 空陣列＝官方尚未公布，不是那個月沒有玩偶。',
      input_schema: { type: 'object', properties: {
        month: { type: 'string', description: '要查的月份 YYYY/MM（也接受 2026/3、2026-03），哪一服由 server 定。不給就回本月起數個月' },
        server: { type: 'string', enum: ['tw','jp'], description: '月份以哪一服為準，預設 tw；回傳每列一律同時附 tw 與 jp' },
        character: { type: 'string', description: '角色名，定名或全名皆可（初音／初音未來／朝比奈真冬／MEIKO），也可給 characterId 1-26。回該角色全部出現月份與下一次' },
        limit: { type: 'integer', description: '沒給 month／character 時列幾個月，預設 12、上限 25（全表就 25 個月）。是連續完整清單，不要分批拼湊' },
        include_past: { type: 'boolean', description: 'true＝從表頭列起回顧過去，預設 false 只列本月起' } } } },
    { name: 'get_event_stats',
      description: '活動編年統計（台服 2021/10 開服至今全部 177 期彙總，不是取樣）。答「哪個角色當過最多次活動主角」「某團多久出一次」「馬拉松／嘉年華／World Link 各幾期、平均幾天」「某段期間有哪些活動」。只做期數與日程統計，要看某期實際榜線數字請改用 get_history_borders。',
      input_schema: { type: 'object', properties: {
        group_by: { type: 'string', enum: ['chara','unit','attr','type','year','none'], description: '分組維度，預設 chara。none＝不分組（只要整體統計或活動列表時用）。每組回期數、佔比、平均日數、首末期、平均間隔天數、距今天數' },
        type: { type: 'string', description: '只算某型態：馬拉松 / 歡樂嘉年華 / World Link' },
        unit: { type: 'string', description: '只算某團（完全相符）：L/N、MMJ、VBS、WXS、25、VS，「/」＝混活' },
        attr: { type: 'string', description: '只算某屬性（完全相符）：紫、藍、橘、綠、粉，World Link 期為「WL全屬性」' },
        chara: { type: 'string', description: '只算某角色，包含比對（填「未來」會一併抓到 VBS未來／25未來／WXS未來）' },
        from: { type: 'string', description: '起始日 YYYY/MM/DD，只算開始日在此之後' },
        to: { type: 'string', description: '結束日 YYYY/MM/DD，只算開始日在此之前' },
        limit: { type: 'integer', description: '最多回幾組，預設 30、上限 50。已是依期數由多到少的完整排名前 N，不要分批拼湊' },
        list_events: { type: 'boolean', description: '是否附活動明細。問「某段期間有哪些活動」「某角色當過哪幾期」時設 true' },
        event_limit: { type: 'integer', description: 'list_events 時列幾期，預設 30、上限 60，由新到舊' } } } },
    { name: 'get_missing_cards',
      description: '列出使用者「缺哪幾張卡」的清單（卡名／角色／團體／稀有度／屬性／取得類別／現在抽不抽得到）。「我缺哪幾張★4」「25時還差哪些」用這支；get_collection_rate 只給「缺幾張」的數字。回的是完整排序前 N 張非取樣，要更多調 limit 或 offset。持有資料來自「收集率」頁勾選，沒勾過會整本算缺。',
      input_schema: { type: 'object', properties: {
        unit: { type: 'string', description: '團體：ln／mmj／vbs／wxs／n25／vs，或 Leo/need、ニーゴ、25時 等寫法。含支援團' },
        rarity: { type: 'string', description: '1／2／3／4（也接受「★4」「四星」），生日卡給「生日」' },
        character: { type: 'string', description: '角色繁中簡稱、全名或角色 id' },
        supply: { type: 'string', description: '取得類別：常駐／生日限定／期間限定／彩FES限定／BLOOMFES限定／團體活動限定／聯動限定' },
        attribute: { type: 'string', description: '帥氣／快樂／神秘／可愛／純真（也接受 cool 等英文）' },
        pool_status: { type: 'string', enum: ['all','in_gacha','not_in_gacha'], description: 'in_gacha＝曾被卡池收錄過；not_in_gacha＝查不到卡池紀錄（活動報酬卡或台服未開池）。預設 all' },
        sort: { type: 'string', enum: ['rarity','newest','oldest','character'], description: 'rarity（預設，★4→生日→★3→★2→★1）／newest／oldest／character' },
        limit: { type: 'integer', description: '預設 20，上限 100' },
        offset: { type: 'integer', description: '從第幾張起（0 起算）' } } } },
    { name: 'get_shop_items',
      description: '商城儲值商品查詢與 CP 值排行（974 項，含台幣定價、App 內商店與台服官網 GamePay／MyCard）。「現在買哪個最划算」「月卡值不值得」「官網比較便宜嗎」「某組合包裡有什麼」用這支。預設只回在售且有台幣價，依每元可得水晶數排序。要算「湊到目標抽數最省怎麼買」用 shop_recommend。',
      input_schema: { type: 'object', properties: {
        q: { type: 'string', description: '關鍵字，比對商品名、說明、商店分頁與內容物' },
        category: { type: 'string', enum: ['all','jewel','set','pass','costume'], description: 'jewel＝純水晶包、set＝組合包、pass＝通行證／月卡、costume＝服裝。預設 all' },
        source: { type: 'string', enum: ['all','app','web'], description: 'app＝遊戲內商店、web＝台服官網（常有加量或專屬包）。預設 all' },
        availability: { type: 'string', enum: ['on_sale','upcoming','ended','all'], description: '販售狀態，預設 on_sale；要查過去檔位才改 ended／all' },
        sort: { type: 'string', enum: ['cp','price_asc','price_desc','jewels','ending_soon'], description: 'cp＝每元水晶數（預設）／price_asc／price_desc＝台幣價／jewels＝總水晶價值／ending_soon＝快下架的排前面' },
        limit: { type: 'integer', description: '預設 15，上限 60。是完整排序前 N 名，非取樣' },
        offset: { type: 'integer', description: '從第幾名開始翻頁' },
        include_unknown_price: { type: 'boolean', description: '納入 master 只有 9999 佔位價的商品（多為月卡／新手包），此時 price_twd 與 jewels_per_twd 為 null。預設 false' },
        include_tickets: { type: 'boolean', description: '票券以 300 水晶／抽折算進價值，預設 true' },
        include_materials: { type: 'boolean', description: '心願碎片等道具以商店標價折算，預設 true。只比純水晶時關掉' } } } },
    { name: 'get_site_map',
      description: '站台功能地圖：有哪些頁、底下有哪些子分頁、各自在做什麼、對應助手哪支工具。「站上有沒有 X」「X 在哪裡」「X 怎麼用」「這網站能做什麼」用這支。不給參數就回全部 27 頁與所有子分頁的完整地圖，一次拿得完不要分批。回來後子分頁 tools 有值就直接呼叫那支工具把答案算出來，不要只描述功能；tools 是空陣列才改成叫他去那頁自己操作。',
      input_schema: { type: 'object', properties: {
        page: { type: 'string', description: '只看某頁，傳頁面 key（calc／rank／analysis／borderdb／deckpro）' },
        q: { type: 'string', description: '關鍵字，比對頁名、說明、子分頁名與圈內別名（如「控分」「烤森」「天井」「榜線趨勢」）' },
        tool: { type: 'string', description: '反查某支工具對應站上哪一頁哪個分頁，如 song_efficiency' },
        include_aliases: { type: 'boolean', description: '附圈內別名。預設：有給 page／q／tool 時 true，全站地圖時 false' } } } },
    { name: 'query_border_db',
      description: '榜線資料庫交叉篩選（＝站上「榜線資料庫」頁）：歷期終榜線依型態／團體／日數／屬性／主角交叉篩，指定段位後可依期數或依該段位分數排行，並回平均／中位數／最高／最低。「8.25天 WXS 箱活 T1000 排行」「歷代 T100 最高哪一期」「WL2 第一章 T1000 排行」用這支；只要看某幾期完整各段位數字用 get_history_borders。events 是完整排序前 N 名非取樣，續看用 offset。',
      input_schema: { type: 'object', properties: {
        dataset: { type: 'string', enum: ['event','wl'], description: 'event＝一般活動總榜線（175 期，T1～T5000，含 WL 活動整期線）；wl＝World Link 各章節榜線（46 章，id 形如 112.1，T1～T7000）。預設 event' },
        tier: { type: 'integer', description: '段位名次，預設 100。event：1／10～100(每10)／200～500(每100)／1000／1500／2000／2500／3000／4000／5000；wl 同上但無 1500・2500、多 7000。給錯會回可用清單' },
        type: { type: 'array', items: { type: 'string' }, description: '活動型態可複選，只有「馬拉松」（＝箱活）「歡樂嘉年華」（＝嘉年華）「World Link」。dataset=wl 無此維度' },
        unit: { type: 'array', items: { type: 'string' }, description: '主辦團體可複選，寫法固定：「L/N」「MMJ」「VBS」「WXS」「25」「VS」「/」(混合)' },
        days: { type: 'array', items: { type: 'number' }, description: '天數可複選且須完全相同。event 只有 6.25／7.25／8.25／9.25／10.25／12；wl 只有 2／3。給 8 會篩不到' },
        attr: { type: 'array', items: { type: 'string' }, description: '活動加成屬性可複選：紫／藍／橘／綠／粉，WL 期為「WL全屬性」。dataset=wl 無此維度' },
        chara: { type: 'array', items: { type: 'string' }, description: '活動主角可複選，繁中名如「寧寧」。三種未來分寫「25未來」「VBS未來」「WXS未來」' },
        round: { type: 'array', items: { type: 'string' }, description: '限 dataset=wl：「WL1」或「WL2」' },
        chapter: { type: 'array', items: { type: 'integer' }, description: '限 dataset=wl：第幾章 1～6（id 小數點後那位）' },
        ids: { type: 'array', items: { type: 'string' }, description: '直接指定期數如 ["149","150"]。wl 給 "112" 回該期全章節，"112.3" 只回第 3 章' },
        sort: { type: 'string', enum: ['id','score','score_asc'], description: 'id＝期數新到舊（預設）／score＝該段位分數高到低／score_asc＝低到高（找最低幾期）。無紀錄的期數排最後' },
        limit: { type: 'integer', description: '預設 20，上限 60。統計數字仍用全部符合的期數算' },
        offset: { type: 'integer', description: '從排序後第幾筆開始，預設 0' } } } },
    { name: 'score_control',
      description: '控分速查（＝計算中心「控分速查」分頁）：已知目前活動P 與想剛好停的目標活動P，反推還要打幾局、每局吃幾火、每局分數打到哪區間。「我現在 2,847,300 想剛好到 2,850,000」「還差 2700P 怎麼收尾」用這支。活動P base 無條件捨去，同一 20,000 分級距內活動P 一樣，所以要照 score_min～score_max 講區間、不是精準分數。差額超過 10,000P 會回 status=over_range（不算控分）；加成湊不出剛好時會在 alt_bonus_plans 給鄰近可精準命中的加成。問單局活動P 用 calc_event_points，問打哪首歌用 song_efficiency。',
      input_schema: { type: 'object', properties: {
        current_points: { type: 'number', description: '目前活動P 總數（必填），如 2847300' },
        target_points: { type: 'number', description: '想剛好停的目標活動P（必填）' },
        bonus: { type: 'number', description: '活動加成 %（250＝+250%）。省略沿用計算中心共用設定' },
        limit: { type: 'integer', description: '方案數，預設 12、上限 40。依總耗體力由少到多的前 N 名，非取樣' } } } },
    { name: 'search_collection',
      description: '搜尋站上「收集室」的貼圖(1073 張)與稱號(1883 種)圖鑑，回取得條件敘述與圖片網址。「這個稱號怎麼拿」「有沒有奏的貼圖」「TOP100 稱號長怎樣」「某活動有哪些稱號」用這支。回的是完整排序前 N 筆非取樣，要更多調 limit 或 offset。',
      input_schema: { type: 'object', properties: {
        kind: { type: 'string', description: 'stamp(貼圖)／honor(稱號)／both(預設)' },
        q: { type: 'string', description: '關鍵字，比對名稱＋所屬群組＋取得條件敘述。稱號敘述用 BIRTHDAY 不是「生日」' },
        character: { type: 'string', description: '角色繁中名或 id。貼圖用官方角色欄位精準比對，稱號在名稱／群組／敘述裡找' },
        rarity: { type: 'string', description: '只限稱號：low／middle／high／highest（也可寫 低／中／高／最高）' },
        group: { type: 'string', description: '只限稱號：所屬群組名（活動名或「◯◯粉絲」）。給了就只回稱號' },
        limit: { type: 'integer', description: '預設 20，上限 60。both 時兩類平分，一類不足會讓配額' },
        offset: { type: 'integer', description: '從第幾筆開始，預設 0' } } } },
    { name: 'shop_recommend',
      description: '儲值試算（＝站上「儲值分析 → 智慧推薦」）：湊到目標抽數／水晶數最少要花多少台幣、該買哪幾樣各幾個。全商店 974 項在各自限購次數內做背包 DP，回唯一一組最低總花費解（不是貪心挑 CP 最高、也不是候選清單、不是取樣）。「天井 300 抽要多少錢」「3000 元能抽幾抽」「怎麼買最划算」「五萬石要多少錢」用這支；只想看商品排行用 get_shop_items。只做試算與建議，不會也不能執行任何購買。reached_target=false 時要照 shortfall 說差幾抽／差多少錢，別講成已達標。',
      input_schema: { type: 'object', properties: {
        target_pulls: { type: 'integer', description: '目標抽數（1 抽＝300 石，天井 300 抽）。與 target_crystals 擇一，都給以此為準' },
        target_crystals: { type: 'integer', description: '目標水晶數，與 target_pulls 擇一（使用者用「幾顆石」講時用）' },
        budget: { type: 'number', description: '預算上限（台幣）。所需金額超出時改回預算內最多水晶的方案並標 shortfall' },
        held_crystals: { type: 'integer', description: '手上已有的水晶，先從目標扣掉。預設 0' },
        include_limited: { type: 'boolean', description: '納入期間限定／特惠商品，預設 true' },
        include_tickets: { type: 'boolean', description: '票券以 300 石／抽折算進目標，預設 true。集天井貼紙建議 false（票券不累積天井）' },
        horizon_30d: { type: 'boolean', description: 'true＝每日限購×30、每週×4（一整個月慢慢買）；預設 false＝現在立刻買得到的' } } } },
    { name: 'best_bonus_deck',
      description: '加成優先的最佳 5 張隊伍＋逐卡活動加成明細。**只挑活動加成最高的卡，完全不看綜合力**——「這期最高能湊到幾%加成」「加成上限多少」「缺哪張才能再往上跳」用這支；問「哪一隊分數／活動P 最高」不要用這支。回逐卡加成拆解（屬性／團體、當期特效卡、稀有度×專精）與隊伍總加成；World Link 另回相異屬性加成與支援隊伍加成。首次呼叫要下載官方 master data，可能要好幾秒。',
      input_schema: { type: 'object', properties: {
        event_id: { type: 'integer', description: '活動期數 id，省略＝當期。大於台服最新期會自動改讀日服 master' },
        only_my_cards: { type: 'boolean', description: 'true＝只用實際持有的卡（優先讀 uid 公開資料含專精等級，沒設 uid 才用收集率勾選），並回報還缺哪張、補上能多幾%。預設 false＝理論上限' } } } },
    { name: 'calc_team_power',
      description: '精算指定 5 張卡的隊伍綜合力，回總值與每張卡六項明細（基礎表現力/前後篇/角色等級/區域道具/豆森/畫布）。what-if 專用：「換這張差多少」「等級專精拉滿差多少」「區域道具 15→20 差多少」＝改一個參數呼叫兩次相減。卡片欄位可直接沿用 get_my_cards 的輸出。',
      input_schema: { type: 'object', properties: {
        cards: { type: 'array', description: '正好 5 張卡；不是 5 張直接回錯誤（同團/同色要看整隊）',
          items: { type: 'object', properties: {
            card_id: { type: 'integer', description: '卡片 id' },
            level: { type: 'integer', description: '等級；預設該卡上限' },
            trained: { type: 'boolean', description: '是否已特訓，預設 true' },
            episodes_read: { type: 'boolean', description: '前後篇已讀，預設 true' },
            master_rank: { type: 'integer', description: '專精 0～5，預設 5' },
            character_rank: { type: 'integer', description: '該卡角色的角色等級；預設用外層值' } },
            required: ['card_id'] } },
        character_rank: { type: 'integer', description: '全隊共用角色等級 1～200，預設 50' },
        area_item_level: { type: 'integer', description: '區域道具等級；預設引擎上限 20，算台服請給 15' },
        mysekai_pct: { type: 'number', description: '豆森加成 % 0～12，預設 7。畫布不算在這裡，一定會計入' } },
        required: ['cards'] } },
    { name: 'estimate_score',
      description: '單局分數精算，六個技能窗各自獨立。回預估分數、分數區間、六窗各自貢獻，以及與平均技能倍率簡化模型的差。要看「換一張技能卡／換站位對分數的實際影響」用這支（窗權重差距可達兩倍，平均模型會抹平）。只算分數不算活動P；要換活動P 把回傳的 for_calc_event_points 丟給 calc_event_points。',
      input_schema: { type: 'object', properties: {
        song_id: { type: 'integer', description: '歌曲編號，可用 get_songs 查' },
        difficulty: { type: 'string', description: 'easy/normal/hard/expert/master/append，預設 master；無資料自動退回' },
        mode: { type: 'string', description: 'solo/auto/multi/cheer，預設沿用使用者設定' },
        power: { type: 'number', description: '隊伍綜合力，例 280000；預設沿用使用者設定' },
        skills: { type: 'array', items: { type: 'number' },
          description: '六窗加分百分比（130＝+130%），依發動順序，第 6 窗是 encore；只給一個數字＝六窗同值。協力要填每窗實際生效倍率（滿隊 130% 約 234）而非卡面%' } },
        required: ['song_id', 'skills'] } },
    { name: 'optimize_deck',
      description: '組卡優化：對 ★4／生日卡窮舉約 6.6 萬組，算出「單局活動P 最大」的 5 張隊伍（目標函數就是活動P，不是加成或綜合力）。使用者問「這期該用哪五張」「最佳隊」「幫我組卡」時用。窮舉本身要 1～3 秒且會卡住畫面，一次問清條件再打，別為了比較連續呼叫。回的是理論養成（滿級/MR5/SL4）下的最佳解。',
      input_schema: { type: 'object', properties: {
        event_id: { type: 'integer', description: '活動期數，預設當期；可帶日服未來檔期' },
        song_id: { type: 'integer', description: '歌曲 id，預設基準曲 Sage EXPERT；選不同歌會影響最佳解' },
        difficulty: { type: 'string', enum: ['E','N','H','X','M','A'], description: '難度 E/N/H/X/M/A；有帶 song_id 時預設 M' },
        energy: { type: 'integer', description: '吃幾火 0～10，預設沿用共用設定；只縮放活動P，不改隊伍' },
        only_my_cards: { type: 'boolean', description: '只用使用者在收集率頁勾選持有的卡，預設 false＝理論最強隊' },
        area_item_level: { type: 'integer', description: '區域道具等級 1～20，預設滿級' },
        character_rank: { type: 'integer', description: '角色等級，預設 100；只影響角色等級技能檔位' } } } },
    { name: 'wl_support_bonus',
      description: 'World Link 支援隊伍加成：依章節主角掃全卡池，算每張卡的支援加成％、貢獻最高的卡片清單、支援隊填滿後的加成總計。使用者問「WL 支援隊放誰」「支援加成有多少」時用。wl_team_advice 只做主隊同團＋湊五色，不算支援加成。當期不是 WL 會退回最近一期並在 resolved_from 標明。',
      input_schema: { type: 'object', properties: {
        chapter: { type: 'integer', description: '第幾章；預設進行中的章節。回傳會列 available_chapters' },
        leader_character: { type: 'string', description: '只有終章要帶：主隊隊長的角色（繁中名或 id 1～26）。終章的支援加成跟隊長角色走，沒帶只會得到下限值' },
        only_my_cards: { type: 'boolean', description: '只算勾選持有的卡，預設 false＝全卡池理論最優' } } } },
    { name: 'browse_cards',
      description: '瀏覽／篩選整本卡庫（1249 張），依技能類型、角色、團體、屬性、稀有度、取得類別篩，預設依滿級綜合力排序。使用者問「有哪些團分卡」「奶卡列給我看」「這張現在還抽不抽得到」「我勾的卡裡哪張技能最高」時用。回綜合力、技能 Lv.4 保底％與拉滿％、取得類別。單張卡逐級技能數值用 get_card_skills；某期活動加成用 get_bonus_cards。',
      input_schema: { type: 'object', properties: {
        skill_type: { type: 'string', description: '技能類型：score 分數提升／judge 判定強化／heal 體力回復／perfect P分／cfes_life 七彩血分／good 七彩GOOD以上／birthday 生日／unit 團分／bfes_char 絢爛角色／bfes_ref 絢爛吸技／bfes_vs 絢爛虛擬；也接受奶卡/判卡/大分/血分/吸技等叫法' },
        character: { type: 'string', description: '角色繁中名或 id 1～26' },
        unit: { type: 'string', description: '團體 ln／mmj／vbs／wxs／n25／vs，也接受 ニーゴ、ワンダショ 等寫法。V 家團體卡歸支援團' },
        attribute: { type: 'string', description: '屬性：帥氣/快樂/神秘/可愛/純真（cool/happy/mysterious/cute/pure）' },
        rarity: { type: 'string', description: '稀有度 1/2/3/4 或「★4」「生日」' },
        supply: { type: 'string', description: '取得類別：常駐／生日限定／期間限定／彩FES限定／BLOOMFES限定／團體活動限定／聯動限定（也接受原始代碼）' },
        only_owned: { type: 'boolean', description: '只看使用者勾選持有的卡；一張都沒勾會回錯誤' },
        live_pools: { type: 'string', enum: ['off','annotate','only'], description: '判斷現在抽不抽得到，預設 off。annotate＝加 obtainable_now 與開放中的池名；only＝只留抽得到的。取得類別只說明走哪種池，不代表現在開著。要現抓約 4.5MB 卡池資料，純看卡表不用帶' },
        min_power: { type: 'number', description: '只回滿級綜合力 ≥ 此值的卡（實務上等於篩稀有度）' },
        sort: { type: 'string', enum: ['power','skill','newest','oldest'], description: '排序，預設 power 綜合力；skill＝技能拉滿％；newest/oldest 依實裝日' },
        limit: { type: 'integer', description: '最多 60，預設 20。是完整排序後的前 N 名，不是取樣，別用多次小批次拼湊' },
        offset: { type: 'integer', description: '從第幾名開始，翻頁用' } } } },
    { name: 'gacha_simulate',
      description: '抽卡模擬器：對指定卡池照官方機率真的抽 N 次，回這輪抽到什麼＋統計，並附該池真實機率模型（各稀有度機率、每張 PU 卡由 weight 反推的單抽機率）、所有抽法與價格、該池天井抽數。使用者說「幫我抽 300 抽看看」「模擬十連」「歪的話會歪到什麼」時用。要「算機率」而不是「抽給你看」請改用 gacha_odds（期望抽數、預算內至少中 1 張的機率、還差幾抽到天井）——那支是數學期望值，這支是實際擲骰的單一樣本，數字不一致正常。rare_pulls 是完整時序清單，超過 list_limit 才截斷。只做模擬，不會執行任何實際抽卡或消費。',
      input_schema: { type: 'object', properties: {
        gacha: { type: 'string', description: '純數字＝卡池 id 完全比對；其他＝卡池名關鍵字模糊比對。預設台服進行中的池，也查得到日服未來池' },
        pulls: { type: 'integer', description: '抽數 1～3000，預設 300（一般池天井）。餘數以同幣別單抽補' },
        method: { type: 'string', description: '抽法，取自該池 available_methods 的 key：jewel_10（3000 水晶十連）／jewel_1／ticket_10／ticket_1／paid_jewel_10（只吃付費水晶）／paid_jewel_1／free_1（通行證免費）／over_rarity_4_once（必中★4）。預設 jewel_10；給錯會回錯誤並列可用的' },
        seed: { type: 'integer', description: '亂數種子（非負整數）；同 gacha/pulls/method/seed 結果完全相同。省略＝隨機並在 simulation.seed_used 回報' },
        bonus_points: { type: 'boolean', description: '是否套用招募點數保底（50 點換未持有常駐★4、100 點換該池 PU）。預設自動判定該池適不適用' },
        list_limit: { type: 'integer', description: 'rare_pulls 最多列幾筆 ★4／生日卡，1～80，預設 40' } } } },
    { name: 'get_active_players',
      description: '活動主榜前 100 名的完整活躍名單：此刻在線（15 分內有成績）／近 1 小時有周回／休息中三選一，每人附近 1 小時與 24 小時時速、周回數、場均、動能與多久沒動。使用者問「現在誰在線」「誰還在跑」「哪些人停了」「前面那群人的節奏」時用。players 是完整排序後的前 N 名，不是取樣，要更後面用 offset 翻頁。帶 series_uid 可另拿該玩家整期名次／分數的時間序列（回答「他名次怎麼變的」「什麼時候被超車」）。公開資料只涵蓋當期前 100 名。',
      input_schema: { type: 'object', properties: {
        mode: { type: 'string', enum: ['online','running','resting','all'], description: 'online＝最後一場在 15 分內（預設）／running＝近 1 小時有周回／resting＝逾 60 分沒成績／all＝前百全部。counts 一律回三種人數' },
        limit: { type: 'integer', description: '預設 20，最多 100（＝全名單）' },
        offset: { type: 'integer', description: '從排序後第幾位開始，預設 0' },
        series_uid: { type: 'string', description: '要取時間序列的玩家 uid，純數字' },
        series_points: { type: 'integer', description: '時間序列點數，預設 24，最多 80（整期等間隔抽樣，含頭尾）' } } } },
    { name: 'get_boost_table',
      description: '火倍率對照表：同一組參數下，一次回出火 0/1/2/3/5/7/10 各自的單局活動P、每火活動P（省體力）與每小時活動P（省時間），並標出每火效率最高的檔位。使用者問「該吃幾火」「吃 10 火划算嗎」「不吃火差多少」「火倍率表」時用。這是所有火數的完整對照，不要改用多次 calc_event_points 逐個火數拼湊。參數省略＝沿用計算中心的共用設定。',
      input_schema: { type: 'object', properties: {
        mode: { type: 'string', enum: ['solo','auto','multi','cheer'], description: '場次：solo 單人／auto 自動／multi 協力／cheer 應援' },
        song_id: { type: 'integer', description: '歌曲 id，預設畫面上選的那首' },
        difficulty: { type: 'string', enum: ['E','N','H','X','M','A'], description: '難度 E/N/H/X/M/A；沒有譜面係數會自動退回' },
        power: { type: 'number', description: '隊伍綜合力，例 250000' },
        bonus: { type: 'number', description: '活動加成 %（250＝+250%）' },
        skill: { type: 'number', description: '平均技能倍率，實效值例 2.5；可用 calc_skill_multiplier 算' },
        s6: { type: 'number', description: '第 6 技能欄（S6）倍率' },
        life: { type: 'number', description: '結束時剩餘 Life，只有 cheer 用到' },
        score: { type: 'number', description: '直接指定歌曲分數；給了就不用歌曲係數推算' },
        event_rate: { type: 'number', description: '歌曲活動倍率 %，沒給 song_id 時才用，預設 100' },
        all_levels: { type: 'boolean', description: 'true＝列 0～10 全十一檔；預設 false＝只列七檔' } } } },
    { name: 'get_border_matrix',
      description: '歷期×段位的榜線矩陣（期數當列、段位當欄），跨期比較用：T10000 這半年漲多少、8.25 天馬拉松的 T20000 都落在哪、這期要衝幾分。段位比 get_history_borders 廣（補 T10000～T200000；那支才有 T1～T90，兩源自動互補）。每期附型態／天數／團體／屬性／banner 角色。recent 取的是連續完整排序不是取樣，別用多次小批次拼。',
      input_schema: { type: 'object', properties: {
        event_ids: { type: 'array', items: { type: 'integer' }, description: '指定期數（活動 id），最多 30 期。給了就忽略 recent／offset／include_running' },
        recent: { type: 'integer', description: '最近 N 期已結算活動，預設 12、上限 30' },
        offset: { type: 'integer', description: '搭配 recent 往更早翻頁，跳過最新 N 期（預設 0）' },
        tiers: { type: 'array', items: { type: 'integer' }, description: '要哪些段位（填名次數字，不要寫 "T100"），最多 14 個，預設 [100,500,1000,2000,5000,10000,20000,50000,100000]。可用值：1,10,20,30,40,50,60,70,80,90,100,200,300,400,500,1000,1500,2000,2500,3000,4000,5000,10000,20000,30000,40000,50000,80000,100000,150000,200000，其他會回錯誤' },
        include_running: { type: 'boolean', description: '是否含進行中未結算的當期（預設 false）；該列 is_final=false，是即時值不是終線' } } } },
    { name: 'get_border_timeseries',
      description: '單一段位的榜線縱向走勢：等距抽樣的（時間, 分數）序列、實測時速（整段平均與近期）、量測跨距與外推終線 —— 什麼時候加速、什麼時候停滯、每小時多少 P。要各段位「現在多少／預測終線多少」的橫向比較請用 get_borders；WL 章節榜用 get_wl_status。本站時序從第 175 期才開始記，更早的期數只有終線（get_history_borders）。points 是整段等距抽樣，不要多次小批次拼。查過去期數要下載整份時序（約 3MB），第一次可能要幾秒。',
      input_schema: { type: 'object', properties: {
        tier: { type: 'integer', description: '段位名次，例如 100／1000／5000；該期沒有會回錯誤並附可用段位' },
        event_id: { type: 'integer', description: '活動期數 id；省略＝當期' },
        points: { type: 'integer', description: '回幾個資料點，預設 24、上限 120' },
        window_hours: { type: 'number', description: '「近期時速」的窗口小時數，預設 6、上限 72；跨距不足半小時會自動退回整段' } },
        required: ['tier'] } },
    { name: 'get_chart_consts',
      description: '查譜面「定數」（非官方難易度表 pentatonic V32，AP 基準，MASTER／APPEND／EXPERT 共 897 張譜、715 首曲）。定數不是遊戲內等級：level 是遊戲給的整數 Lv，const_value／const_label 是社群把同一 Lv 再細分到小數的難度排名（如 32.9+），兩者不可互相當成對方講。使用者問「某某歌定數多少」「32.5 有哪些譜面」「33 以上的 APPEND」「台服最硬的譜面」時用。只查定數表本身、不看使用者成績；算他自己的 B30 或「下一張該打哪首」用 get_b30。',
      input_schema: { type: 'object', properties: {
        q: { type: 'string', description: '曲名關鍵字，用日文原名（ヒバナ）或中文譯名（火花），羅馬拼音查不到。一首歌會回它的各難度列' },
        song_id: { type: 'integer', description: '曲目 id（同 get_songs），比曲名精準' },
        difficulty: { type: 'string', enum: ['master','append','expert'], description: '只看某難度；難易度表只收這三種，其他會回錯誤' },
        const_eq: { type: 'string', description: '指定定數，字串。「31.5」＝整帶（含 31.5+／31.5++）；「31.5+」「32.9++」＝只要那一種。區間請用 const_min／const_max' },
        const_min: { type: 'number', description: '定數下限（含）；比的是含「+」的實際值，31.5+ 算 31.55' },
        const_max: { type: 'number', description: '定數上限（含）' },
        level: { type: 'integer', description: '遊戲內等級（整數 Lv，範圍 24～38），不是定數；「定數 32」要用 const_eq' },
        level_min: { type: 'integer', description: '遊戲內等級下限（含）' },
        level_max: { type: 'integer', description: '遊戲內等級上限（含）' },
        pool: { type: 'string', enum: ['all','tw','jp'], description: '曲庫，預設 all。tw＝台服打得到、jp＝日服限定；問台服的事就帶 tw' },
        sort: { type: 'string', enum: ['const_desc','const_asc','level_desc','level_asc','song_id'], description: '排序，預設 const_desc' },
        limit: { type: 'integer', description: '回幾筆，預設 20、上限 100。是完整排序後的前 N 筆，不是取樣' },
        offset: { type: 'integer', description: '從第幾筆開始（0 起算），配合 limit 翻頁' } } } },
    { name: 'get_gacha_points',
      description: '招募點數（BPT）保底＋逐池抽卡成本。含點數換算（付費水晶 1 點/抽、免費水晶與招募票券 0.5、七彩通行證免費抽 0）、依現有點數與手上資源算各門檻（一般池 50／100 點，Recollection Festival 另有 150／200 自選）還差幾點、幾抽、幾石，以及該池官方每種抽法的石／券成本、各累積多少點數、天井要幾張貼紙。問「招募點數還差多少」「這池怎麼抽最省」「半價十連要多少付費石」「天井幾張貼紙」用這支；問機率（預算內中 1 張的機率、期望抽數、距 300 抽天井）用 gacha_odds；想模擬實際抽出什麼卡去 gachasim 頁。第一次呼叫要下載 4.4MB master data。',
      input_schema: { type: 'object', properties: {
        gacha_id: { type: 'integer', description: '卡池編號。master 只留現行與近期卡池（含已 datamine 的未來檔期）' },
        gacha_query: { type: 'string', description: '卡池名稱關鍵字（如「生日」「通行證」）。與 gacha_id 擇一，兩個都給以 gacha_id 為準；都不給回進行中的全部卡池' },
        include_pools: { type: 'boolean', description: '是否要逐池成本表，預設 true。只算點數保底時給 false，可省 4.4MB 下載' },
        limit: { type: 'integer', description: '回幾個卡池，預設 4、上限 20。依開始時間新→舊完整排序的前 N 筆，不是取樣' },
        offset: { type: 'integer', description: '卡池分頁起點' },
        current_points: { type: 'number', description: '目前累積的招募點數，可帶 0.5' },
        paid_crystals: { type: 'integer', description: '付費（有償）水晶數，每 300 顆 1 抽、每抽 1 點' },
        free_crystals: { type: 'integer', description: '免費（無償）水晶數，每 300 顆 1 抽、每抽 0.5 點。使用者只說「我有 N 顆石」通常填這裡' },
        tickets: { type: 'integer', description: '招募票券張數（1 張＝1 抽＝0.5 點）。不是換天井的貼紙交換券' },
        pool_mode: { type: 'string', enum: ['normal','rf'], description: '沒有專屬檔位資料時套哪組通則：normal（預設）＝50／100 兩檔；rf＝50／100／150／200 四檔（含自選）。master 有自己的檔位群組時忽略此值' },
        tier_group_id: { type: 'integer', description: '直接指定 master gachaBonusItemReceivableRewards 的 groupId，一般不用給' } } } },
    { name: 'get_pass_value',
      description: '月卡／通行證的攤提後 CP 值＋官網 vs App 比價。把「每日領取」的無償水晶攤提進總價值，換算石/元、比基準線給大賺／划算／看需求、算幾天回本；並比官網同價位比 App 多送多少免費水晶。問「月卡值不值得買」「七彩通行證划算嗎」「BASIC 還是 PRECIOUS」「幾天回本」「官網儲值比較划算嗎」「MyCard／GamePay 多送多少」時用。月卡在 master 幾乎都是 9999 佔位價（price_twd 為 null）：先看該筆 web_voucher，或請使用者報實售價後用 price_overrides 重算，不要自己編價格。只做試算比價，不執行任何購買或付款。水晶包完整清單用 get_shop_items；「湊到 N 抽最少花多少錢」用 shop_recommend。',
      input_schema: { type: 'object', properties: {
        section: { type: 'string', enum: ['all','pass','compare'], description: 'all＝攤提＋官網比價（預設）；pass＝只要攤提；compare＝只要官網 vs App。只問一件事時指定可讓回傳小一半' },
        price_overrides: { type: 'object', description: '自填售價 {商品id: 台幣價}，例如 {"67": 170}，用在 price_twd 為 null 的月卡。id 用回傳的 id 欄位（App 為數字、官網為字串）' },
        include_ended: { type: 'boolean', description: '是否含已結束販售的通行證，預設 false' },
        include_ticket_value: { type: 'boolean', description: '票券是否以 300 石/抽折進總價值，預設 true。正在集 300 抽天井貼紙的人建議 false' },
        include_material_value: { type: 'boolean', description: '心願碎片等道具是否以商店價折進總價值，預設 true。只看純水晶時給 false' },
        limit: { type: 'integer', description: '通行證回幾筆，預設 10、上限 40（販售中共約 18 張）' },
        offset: { type: 'integer', description: '通行證分頁起點，預設 0' } } } },
    { name: 'get_player_career',
      description: '玩家生涯紀錄：逐期掃過去各期最終前 100 名名單，算出歷屆入榜次數、最佳／平均／中位名次、最高分，以及每一期的名次與相對上次入榜的進退。問「我以前跑過幾期」「我最好排到第幾名」「這個人生涯戰績如何」「他上一期第幾名」時用。注意：耗時：一期打一次外部請求（每期約 370KB），預設掃最近 20 期約 3～6 秒、掃滿 60 期會超過 10 秒；要看更早的一次把 limit／offset 給足，不要分多次小批次。只涵蓋各期前 100 名的公開名單，沒入榜的期數查不到（不等於沒打）。',
      input_schema: { type: 'object', properties: {
        uid: { type: 'string', description: '玩家 ID（19 位數字字串）；省略＝使用者自己綁定的 uid' },
        limit: { type: 'integer', description: '往回掃最近幾期已結算活動，預設 20、上限 60。每多一期多一次外部請求' },
        offset: { type: 'integer', description: '跳過最近幾期再開始掃，預設 0' },
        event_id: { type: 'integer', description: '只查指定的某一期；給了就忽略 limit／offset' } } } },
    { name: 'get_wl_exchange',
      description: 'World Link 交換所規劃：某一屆 WL 的綜合與各章節交換所有哪些品項、單價幾徽章、最多能換幾個，以及全部換滿要多少徽章。問「WL3 交換所換滿要多少徽章」「章節交換所有什麼」「心願小瓶子多少錢」「徽章不夠該先換什麼」時用。回的是該屆完整品項清單（綜合 13 項＋每章 5 項），不是取樣。章節數各屆不同、總需求會跟著變，且章節徽章與綜合徽章不通用，回傳的 note 要轉述給使用者。終章不需規劃，沒有資料。',
      input_schema: { type: 'object', properties: {
        round: { type: 'string', description: '哪一屆，「WL2」或「WL3」（給 "3"／"wl3" 也認）。省略＝最新一屆；只有這兩屆有表' },
        chapter: { type: 'integer', description: '只回某一區：1～6＝該章節交換所、0＝綜合。省略＝全部都回。只縮小回傳區塊，totals 一律是整屆的數字' },
        chapter_count: { type: 'integer', description: '這屆實際有幾章（決定總需求算幾個章節交換所）。省略用預設 WL2＝4、WL3＝5；V 家或 3.2 版那種 6 章要明確給 6' } } } },
    { name: 'card_effective_skill',
      description: '算「這 5 張卡放在同一隊時，每張的有效 score-up %」以及可直接餵給 calc_event_points 的平均技能倍率。單看一張卡的技能數字沒有意義：團分技能算同團人數、混團技能算外團種類、花前吸技能吸隊友上限，同一張卡放在不同隊實際加分差到 50%。回傳含每張的 effective_pct／單卡底值／卡面上限、隊長技能、平均技能倍率（skill 與 s6）與換隊長建議。要單卡逐級 Lv.1～4 的數值請用 get_card_skills，這支只給「在這一隊」的值。首次呼叫要載入計算引擎與 master 資料，可能要幾秒。',
      input_schema: { type: 'object', properties: {
        cards: { type: 'array', items: { type: 'integer' }, description: '隊伍的 card_id，最多 5 張，第一張視為隊長（第 6 技能窗 encore 吃隊長）。不足 5 張也能算，但團分的「全員一致」需滿 5 張，會回低估警告' },
        master_ranks: { type: 'array', items: { type: 'integer' }, description: '各卡專精 0～5。不影響技能%（只影響綜合力與活動加成），這裡只原樣回聲；算加成用 get_bonus_cards' },
        skill_levels: { type: 'array', items: { type: 'integer' }, description: '各卡技能等級 1～4，預設 4（滿）。只給一個數字＝五張同值' },
        char_ranks: { type: 'array', items: { type: 'integer' }, description: '各卡「該角色」的角色等級，預設 100。只給一個數字＝五張同值。角色等級型技能（Bfes 花後）每 2 級 +1%、滿 100 級 +50%' },
        trained: { type: 'array', items: { type: 'boolean' }, description: '各卡是否用特訓後（花後）那一面，預設 true。只有 BloomFES／カラフェス 的 V 家卡兩面技能不同，會附另一面的值' } } } },
    { name: 'estimate_border_prior',
      description: '同型態歷史加權估計終線（先驗）：對任意一期、包含還沒開跑沒有實測的未來活動。「下一期 6.25 天箱活 T1000 大概多少」「12 天 WL 的 T100 會到哪」。當期已開跑要預測終線改用 get_borders（實測時速外推準得多）；只看某幾期實際數字用 get_history_borders，交叉篩選排行用 query_border_db。',
      input_schema: { type: 'object', properties: {
        type: { type: 'string', description: '型態：馬拉松（箱活）／歡樂嘉年華（嘉年華）／World Link。給 event_id 可省略' },
        days: { type: 'number', description: '總日數，須完全相同：6.25/7.25/8.25/9.25/10.25，World Link 為 12。給 event_id 可省略' },
        unit: { type: 'string', description: '限主辦團體：L/N、MMJ、VBS、WXS、25、VS、/（混活）。不足 3 期會自動退回不分團' },
        tier: { type: 'integer', description: '單一段位。可用 1,10,20,30,40,50,60,70,80,90,100,200,300,400,500,1000,1500,2000,2500,3000,4000,5000' },
        tiers: { type: 'array', items: { type: 'integer' }, description: '多段位如 [100,1000,5000]，最多 8 個。與 tier 擇一，都不給預設 T100/500/1000/2000/5000' },
        event_id: { type: 'integer', description: '指定期數（可為未開跑），用該期型態日數、只取該期之前當樣本。不給＝下一期' },
        samples_limit: { type: 'integer', description: '列幾期樣本明細，預設 8 上限 20；不影響估計值' } } } },
    { name: 'get_calendar',
      description: '活動日曆，以日期為軸：某一天或某個月有哪些活動與卡池，每筆標明開始／結束／進行中，附 PU 角色與伴生活動主角。「這個月有什麼」「10/15 那天有什麼在開」。要某段區間的卡池清單（例如未來三個月的 FES 池）改用 get_gacha_schedule。只讀，不切換頁面。',
      input_schema: { type: 'object', properties: {
        date: { type: 'string', description: '單日 YYYY/MM/DD，與 month 二選一' },
        month: { type: 'string', description: '整月 YYYY/MM。兩者都省略＝本月' },
        type: { type: 'string', description: '只看某類卡池：FES池／普通限定池／復刻限定池／生日池／有償池／常駐池' },
        limit: { type: 'integer', description: '卡池筆數上限，預設 24，最多 60' },
        offset: { type: 'integer', description: '卡池分頁位移，接續 next_offset' } } } },
    { name: 'get_collection_stats',
      description: '兩件事合一支：收集室圖鑑分佈（貼圖依角色／團體、稱號依稀有度／群組），以及收集率備份碼的產生與解讀。「哪個角色貼圖最多」「我的備份碼是多少」「這串碼是什麼」「跟我現在差在哪」。貼圖／稱號是全站共通的官方圖鑑總數，不是使用者持有狀況。注意：只讀不寫，絕不覆蓋持卡勾選。要收集率百分比用 get_collection_rate，缺哪幾張用 get_missing_cards。',
      input_schema: { type: 'object', properties: {
        part: { type: 'string', enum: ['all','stamps','honors','code'], description: '預設 all。stamps 才展開 26 角色逐一分佈；給了 decode 一定會解讀' },
        decode: { type: 'string', description: '要解讀的備份碼（base64）；不給＝產生使用者目前的碼' },
        limit: { type: 'integer', description: '預設 10 上限 50，用於稱號群組與解讀出的卡片' },
        offset: { type: 'integer', description: '從第幾筆開始（0 起算）' } } } },
    { name: 'get_misc_calc',
      description: '三個站上小東西，用 kind 選：挑戰 Live 活動P（公式與一般場完全不同）、站上兩組情境預設參數、我的周回／場均／總綜合力。只讀不套用。一般場（單人／自動／協力／應援）活動P 用 calc_event_points，動能／預測終分用 analyze_player，與各段榜線的差距用 get_my_status。',
      input_schema: { type: 'object', properties: {
        kind: { type: 'string', enum: ['challenge_live','presets','my_extra'], description: 'challenge_live＝挑戰Live活動P、presets＝情境預設參數、my_extra＝周回／場均／綜合力' },
        score: { type: 'number', description: '僅 challenge_live：那場歌曲分數。省略用 profile 的挑戰 Live 最高分' },
        uid: { type: 'string', description: '僅 my_extra：要查誰（19 位數字）。省略＝自己' } },
        required: ['kind'] } },
    { name: 'get_page_tutorials',
      description: '依「使用者正在用哪個功能」推薦教學：給頁面 key 或主題詞，回該情境相關的問答，也能反過來回答這個主題該去哪一頁（related_pages）。search_tutorial 是關鍵字全文搜尋，適合直接問某個名詞；這支是頁面情境對照表，適合「我在這頁該先懂什麼」。查無結果再退回 search_tutorial。只讀，不切換頁面。',
      input_schema: { type: 'object', properties: {
        page: { type: 'string', description: '頁面 key：home rank analysis borderdb calc deckpro gacha gachasim shop b30 songs rate collect calendar。與 topic 都不給會回頁面清單' },
        topic: { type: 'string', description: '主題詞或使用者原話，如「推車」「我想衝榜線」；可與 page 併用' },
        limit: { type: 'integer', description: '預設 5，上限 12' },
        answer_chars: { type: 'integer', description: '每則答案截斷字數，預設 240，上限 800' } } } },
    { name: 'get_site_meta',
      description: '站台的「關於自己」三份合一：credits＝製作與致謝（編輯群、資料表作者與原始連結、聯絡方式、著作權）、resources＝資源連結頁 6 組共 24 條站台與網址、capabilities＝助手自己的能力模塊與問題模板。「這站誰做的」「有沒有別的好用的站或表格」「你能幫我什麼」。只回站台靜態資訊，不查遊戲數據；要「哪一頁能做什麼、該叫哪支工具」用 get_site_map。',
      input_schema: { type: 'object', properties: {
        kind: { type: 'string', description: 'credits／resources／capabilities／all，預設 all。三份全回很長，只問一件事務必指定' },
        group: { type: 'string', description: '限 resources：只回某組，如「官方資源」「資訊站」「討論社群」「Wiki 百科」「社群資料表」「本站工具」' },
        with_examples: { type: 'boolean', description: '限 capabilities：附上實際問句，預設 false（回傳量約三倍）' } } } },
    { name: 'predict_card_rerun',
      description: '卡片復刻預測：某張卡（或某角色、某卡池 PU 卡）是哪種限定、下次復刻是台服已排定還是只有推估、現在抽不抽得到、離下次幾天、日服當過幾次 PU。「這張還會不會再出」「等復刻還是現在課」「這池過了還有機會嗎」。不給參數＝目前進行中卡池的 PU 卡。轉述務必分清 next_rerun.status 的「已排定」（台服官方排程，日期卡池名皆官方值）與「預估」（日服開池日＋365 天，只精確到月份）——把預估說成確定，會害人把石頭壓在不存在的日期上。',
      input_schema: { type: 'object', properties: {
        card_id: { type: 'integer', description: '卡片 id；不知道可先用 get_missing_cards 或 search_anything 找' },
        character: { type: 'string', description: '角色繁中簡稱、全名或角色 id，回該角色限定卡（預設不含常駐）' },
        gacha_name: { type: 'string', description: '卡池名關鍵字或卡池 id，回該池 PU 卡。只查得到進行中與已排程的池，舊池查不到' },
        include_permanent: { type: 'boolean', description: '搭配 character：true 才含常駐卡，預設 false' },
        limit: { type: 'integer', description: '預設 10，上限 40' },
        offset: { type: 'integer', description: '從第幾張開始（0 起算）' } } } },
    { name: 'get_card_art',
      description: '取得卡面超高清原圖的下載連結（特訓前／特訓後／去背立繪），直連官方素材庫。使用者問「這張卡的圖」「高清卡面」「桌布」時用。',
      input_schema: { type: 'object', properties: {
        q: { type: 'string', description: '卡名、角色或素材名關鍵字' },
        card_ids: { type: 'array', items: { type: 'integer' }, description: '指定 card_id' },
        rarity: { type: 'integer', description: '稀有度 1-4，生日卡是 9' },
        limit: { type: 'integer', description: '預設 5，上限 20' } } } },
    { name: 'list_my_watches',
      description: '列出使用者的偵測訂閱與最近觸發的通知。「我訂了什麼」「有沒有通知」。需已登入。',
      input_schema: { type: 'object', properties: {
        include_events: { type: 'boolean', description: '是否一併回最近觸發的通知，預設 true' } } } },
  ],

  /* 工具執行。回傳值會原樣送回模型,所以盡量給結構化又精簡的東西 ——
     整包 JSON 塞太多會吃掉 context 又讓它抓不到重點。 */

  async aiRun(name, a) {
    a = a || {};
    const n = v => (v == null ? null : this.n(v));
    switch (name) {
      case 'set_my_uid': {
        const uid = String(a.uid || '').replace(/\D/g, '');
        if (!uid) return { error: 'uid 必須是數字' };
        this.setState({ pid: uid });
        try { localStorage.setItem('sekai-pid', uid); } catch (e) {}
        if (this.state.me && this.state.me.status === 'approved') { try { await this.pushCloud(); } catch (e) {} }
        const r = this.ranksOf(this.state.live).find(x => this.sameUid(x.uid, uid));
        return { ok: true, uid, found_in_top100: !!r, current: r ? { rank: r.rank, score: r.score, name: r.name } : null };
      }
      case 'get_my_status': {
        const uid = this.state.pid;
        if (!uid) return { error: '還沒設定 uid,請先用 set_my_uid' };
        const B = this.borderAnalysis();
        const me = this.ranksOf(this.state.live).find(x => this.sameUid(x.uid, uid));
        const pd = this.state.pdata || {};
        return {
          uid, in_top100: !!me,
          my_score: pd.myScore != null ? pd.myScore : (me ? me.score : null),
          my_speed_per_hour: pd.mySpeed != null ? Math.round(pd.mySpeed) : null,
          clock: B ? { progress_pct: +(B.clock.frac * 100).toFixed(1), hours_left: +B.clock.leftH.toFixed(1) } : null,
          tiers: B ? B.rows.map(r => ({
            tier: r.rank, current: r.score, projected_final: Math.round(r.proj),
            method: r.method || (r.measured ? 'measured' : 'linear'),
            range_p10_p90: r.lo != null ? [Math.round(r.lo), Math.round(r.hi)] : null,
            gap_from_me: r.gap, hours_i_need: r.needH != null ? +r.needH.toFixed(1) : null,
            reachable: r.reach,
          })) : null,
        };
      }
      case 'get_current_event': {
        const ck = this.eventClock();
        if (!ck) return { error: '當期活動資料尚未載入' };
        const ev = this.eventOf(this.state.live);
        const DB = (typeof BORDERS_DB !== 'undefined') ? BORDERS_DB : null;
        const meta = DB ? (DB.events || []).find(e => +e.id === +ck.id) : null;
        return { id: ck.id, name: ev.name || '', type: meta ? meta.type : null, days: meta ? meta.days : null,
                 unit: meta ? meta.unit : null, chara: meta ? meta.chara : null,
                 progress_pct: +(ck.frac * 100).toFixed(1), hours_left: +ck.leftH.toFixed(1),
                 is_world_link: this.isWL() };
      }
      case 'get_upcoming_events': {
        const list = await this.loadEvList();
        const now = Date.now();
        return { events: (list || []).filter(e => new Date(e.start_at).getTime() > now - 86400000)
          .sort((x, y) => x.id - y.id).slice(0, Math.min(8, +a.n || 3))
          .map(e => ({ id: e.id, name: e.name, start: e.start_at, end: e.aggregate_at || e.closed_at })) };
      }
      case 'get_borders': {
        const B = this.borderAnalysis();
        if (!B) return { error: '榜線資料尚未載入' };
        const want = Array.isArray(a.tiers) && a.tiers.length ? a.tiers.map(Number) : null;
        return { method_note: B.useModel ? '模型＝速率剖面＋隨進度集成（4 期留一法回測：主榜 5.6%、WL 5.9%、前百逐名 11.8%；線性外推 13.8%），range_p10_p90 是模型的 P10～P90 區間' : '模型參數未載入，為實測／線性外推',
          rank_lines: (B.rankRows || []).map(r => ({ position: r.pos, current: r.score, projected_final: Math.round(r.proj), method: r.method, range_p10_p90: r.lo != null ? [Math.round(r.lo), Math.round(r.hi)] : null })),
          tiers: B.rows.filter(r => !want || want.indexOf(r.rank) >= 0).map(r => ({
          tier: r.rank, current: r.score, projected_final: Math.round(r.proj),
          method: r.method || (r.measured ? 'measured' : 'linear'),
          range_p10_p90: r.lo != null ? [Math.round(r.lo), Math.round(r.hi)] : null,
          history_weighted: r.refMed != null ? Math.round(r.refMed) : null,
          history_range: r.refLo != null ? [r.refLo, r.refHi] : null,
        })) };
      }
      case 'get_gacha_schedule': {
        const pdt = x => { const d = this.pd(x); return d ? d.getTime() : null; };
        const from = a.from ? pdt(a.from) : Date.now() - 86400000;
        const to = a.to ? pdt(a.to) : from + 90 * 86400000;
        const list = (this.state.gachas || []).filter(g => {
          const st = pdt(g.s); if (st == null) return false;
          if (st < from || st > to) return false;
          if (a.type && g.t !== a.type) return false;
          return true;
        }).slice(0, 60);
        return { count: list.length, gachas: list.map(g => ({
          name: g.n, type: g.t, start: g.s, end: g.e, pickup: g.ch || null,
          unit: g.u || null, event_id: g.eid || null, event_type: g.et || null, note: g.note || null })) };
      }
      case 'get_history_borders': {
        const DB = (typeof BORDERS_DB !== 'undefined') ? BORDERS_DB : null;
        if (!DB) { await this.loadBorderDB(); }
        const D = (typeof BORDERS_DB !== 'undefined') ? BORDERS_DB : null;
        if (!D) return { error: '歷史資料庫載入失敗' };
        let rows = D.borders.slice();
        if (a.type) rows = rows.filter(b => b.type === a.type);
        if (a.days) rows = rows.filter(b => b.days === +a.days);
        if (a.unit) rows = rows.filter(b => b.unit === a.unit);
        rows = rows.sort((x, y) => y.id - x.id).slice(0, Math.min(30, +a.limit || 12));
        return { tiers: D.tiers, events: rows.map(b => ({
          id: b.id, name: b.name, type: b.type, days: b.days, unit: b.unit, chara: b.chara, borders: b.t })) };
      }
      case 'search_tutorial': {
        const q = String(a.q || '').toLowerCase();
        if (!q) return { error: '缺少關鍵字' };
        /* 教學資料是動態 import 進來的,使用者沒進過教學頁時 state 還是空的,
           所以這裡自己補載一次 —— 否則助手查教學永遠回空。 */
        let src = this.state.tutQA || [];
        if (!src.length) {
          try {
            const m = await import('./data/tutorial-data.js?v=4befc9b27b');
            src = m.TUT_QA || [];
            this.setState({ tutQA: src, tutCats: m.TUT_CATS || [], tutDoc: m.TUT_DOC || '' });
          } catch (e) { return { error: '教學資料載入失敗' }; }
        }
        const cats = {}; (this.state.tutCats || []).forEach(c => { cats[c.id] = c.name; });
        const hit = src.filter(x => ((x.q || '') + (x.a || '')).toLowerCase().includes(q)).slice(0, 6);
        return { count: hit.length, total: src.length, items: hit.map(x => ({
          category: cats[x.cat] || x.cat, question: x.q,
          answer: String(x.a || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 900) })) };
      }
      case 'get_my_cards': {
        const uid = this.state.pid;
        if (!uid) return { error: '還沒設定 uid' };
        try {
          const d = await fetch(this.API + '/user/' + encodeURIComponent(uid) + '/profile').then(r => r.ok ? r.json() : null);
          if (!d) return { error: '查不到這個 uid 的公開資料' };
          const cards = (d.userCards || []).slice(0, 400);
          return { uid, card_count: (d.userCards || []).length,
            deck: (d.userDeck || null),
            cards: cards.map(c => ({ id: c.cardId, level: c.level, master_rank: c.masterRank,
              trained: c.specialTrainingStatus === 'done' })).slice(0, 200) };
        } catch (e) { return { error: '取得失敗:' + (e.message || '') }; }
      }
      case 'schedule_task': {
        if (!(this.state.me && this.state.me.is_admin)) return { error: '排程需要管理員權限' };
        const at = Date.parse(a.run_at_iso || '');
        if (!at) return { error: 'run_at_iso 不是合法時間' };
        try {
          const r = await this.api('/admin/tasks', { method: 'POST', body: {
            title: a.title, action: a.action || 'notify',
            params: { message: a.message || a.title },
            run_at: Math.floor(at / 1000), repeat_s: a.repeat_hours ? Math.round(a.repeat_hours * 3600) : 0 } });
          return { ok: true, task_id: r && r.task && r.task.id, run_at: a.run_at_iso };
        } catch (e) { return { error: e.message || '排程失敗' }; }
      }
      case 'calc_event_points': {
        /* 曲庫是進「計算中心」才載的模組，使用者可能沒去過那頁 → 自己補載。
           loadEpSongs 不是 async（內部走 import().then），沒有 promise 可 await，
           只能輪詢它寫回 state。4 秒等不到就當失敗。 */
        if (!(this.state.epSongs || []).length) {
          this.loadEpSongs();
          for (let i = 0; i < 40 && !(this.state.epSongs || []).length; i++) await new Promise(r => setTimeout(r, 100));
        }
        // setState 會換掉整個 state 物件，所以一定要等載完才取，不能在 await 之前先抓著舊的
        const s = this.state;
        const DK = { E: 'E', N: 'N', H: 'H', X: 'X', M: 'M', A: 'A', EASY: 'E', NORMAL: 'N', HARD: 'H', EXPERT: 'X', MASTER: 'M', APPEND: 'A' };
        const mode = ['solo', 'auto', 'multi', 'cheer'].indexOf(a.mode) >= 0 ? a.mode : (s.mode || 'multi');
        const diff = DK[String(a.difficulty || '').toUpperCase()] || s.diff || 'M';
        const power = a.power != null ? +a.power || 0 : +s.power || 0;
        const bonus = a.bonus != null ? +a.bonus || 0 : +s.bonus || 0;
        const skill = a.skill != null ? +a.skill || 0 : +s.skill || 0;
        const s6 = a.s6 != null ? +a.s6 || 0 : +s.s6 || 0;
        const life = a.life != null ? +a.life || 0 : +s.life || 0;
        const energy = a.energy != null ? Math.max(0, Math.min(10, Math.round(+a.energy || 0))) : (+s.energy || 0);
        const F = this.EM[energy] || 1;
        const song = this.songById(a.song_id != null ? a.song_id : s.songKey);
        if (a.song_id != null && !song) return { error: '找不到 song_id=' + a.song_id + ' 這首歌，可先用 get_songs 查編號' };
        const rate = song ? song.rate : (a.event_rate != null ? +a.event_rate || 100 : +s.rate || 100);
        const time = song ? song.time : 100;
        let score, usedDiff = null, scoreFrom;
        if (a.score != null) { score = +a.score || 0; scoreFrom = '呼叫時直接指定的分數'; }
        else if (song && song.d) {
          // 與 scoreNow() 同一套後備順序：指定難度沒係數就往下找有的
          const k = [diff, 'M', 'X', 'H', 'N', 'E', 'A'].find(x => song.d[x]);
          usedDiff = k || null;
          score = k ? this.calcSongScore(song.d[k], mode, power, skill, s6) : 0;
          scoreFrom = '由歌曲係數與綜合力/技能推算';
        } else { score = +s.score || 0; scoreFrom = '共用設定裡直接填的分數（沒有歌曲資料）'; }
        const ep = this.calcEPValue(mode, score, rate, bonus, F, power, life);
        const cycle = time + this.ohOf(mode);
        return {
          mode, boost_energy: energy, boost_multiplier: F,
          song: song ? { id: song.id, title: song.t, difficulty: usedDiff || diff,
            level: (song.d && song.d[usedDiff || diff]) ? song.d[usedDiff || diff][0] : null,
            length_s: song.time, event_rate_pct: song.rate } : null,
          inputs: { power, bonus_pct: bonus, skill, s6, life },
          song_score: Math.round(score), score_from: scoreFrom,
          event_points: ep,
          ep_per_energy: energy > 0 ? Math.round(ep / energy) : ep,
          ep_per_hour: cycle > 0 ? Math.round(ep * 3600 / cycle) : 0,
          cycle_s: cycle, overhead_s: this.ohOf(mode),
          note: '單局活動P ＝ ⌊base × 歌曲倍率 × (1＋加成/100)⌋ × 火倍率；base 單人場為 100＋⌊分數/20000⌋，協力/應援為 123＋⌊(分數＋0.075×綜合力×5)/17000⌋。' +
                (energy === 0 ? '　目前是 0 火（火倍率 1）。' : ''),
        };
      }

      case 'song_efficiency': {
        if (!(this.state.epSongs || []).length) {
          this.loadEpSongs();
          for (let i = 0; i < 40 && !(this.state.epSongs || []).length; i++) await new Promise(r => setTimeout(r, 100));
        }
        const s = this.state;                       // 同上：等載完才取 state
        const songs = this.state.epSongs || [];
        if (!songs.length) return { error: 'EP 曲庫尚未載入，請先開啟「計算中心」頁再問一次' };
        const DK = { E: 'E', N: 'N', H: 'H', X: 'X', M: 'M', A: 'A', EASY: 'E', NORMAL: 'N', HARD: 'H', EXPERT: 'X', MASTER: 'M', APPEND: 'A' };
        const mode = ['solo', 'auto', 'multi', 'cheer'].indexOf(a.mode) >= 0 ? a.mode : (s.mode || 'multi');
        const diff = DK[String(a.difficulty || '').toUpperCase()] || s.diff || 'M';
        const power = a.power != null ? +a.power || 0 : +s.power || 0;
        const bonus = a.bonus != null ? +a.bonus || 0 : +s.bonus || 0;
        const skill = a.skill != null ? +a.skill || 0 : +s.skill || 0;
        const s6 = a.s6 != null ? +a.s6 || 0 : +s.s6 || 0;
        const life = +s.life || 0;
        const energy = a.energy != null ? Math.max(0, Math.min(10, Math.round(+a.energy || 0))) : (+s.energy || 0);
        const iv = a.interval != null ? Math.max(0, +a.interval || 0) : (+s.interval || 50);
        const F = this.EM[energy] || 1;
        /* 排行本來就是拿全曲庫算的（下面 songs.forEach 掃完 602 首），
           截斷成 20 只是回傳時砍掉 —— 這會逼模型改用「撈前 20 名再人工拼湊」
           的取樣窮舉，既慢又不完整。放寬到 100 並支援 offset 翻頁。 */
        const lim = Math.max(1, Math.min(100, +a.limit || 20));
        const off = Math.max(0, +a.offset || 0);
        // 與 effRanking() 同一套算法，差別只在參數可覆寫、筆數可指定
        const rows = [];
        songs.forEach(song => {
          if (!song.time || song.time <= 0) return;
          const d = song.d && song.d[diff];
          if (!d) return;                                    // 這首沒有這個難度
          const score = this.calcSongScore(d, mode, power, skill, s6);
          const ep = this.calcEPValue(mode, score, song.rate, bonus, F, power, life);
          const cycle = song.time + iv;
          rows.push({ id: song.id, title: song.t, level: d[0], notes: d[1],
            length_s: song.time, event_rate_pct: song.rate, cycle_s: Math.round(cycle),
            event_points: ep, ep_per_hour: Math.round(ep * 3600 / cycle), score: Math.round(score) });
        });
        if (!rows.length) return { error: '曲庫裡沒有難度 ' + diff + ' 的資料，換一個難度試試' };

        /* 三種排序不是同一個問題的三種寫法,是三種不同的處境 ——
           而站上的效率排行頁本來就有這三個選項(effRanking 的 sortBy)。
           工具原本只寫死每小時,等於「效益曲排行」這個問題結構上就答不出來:
           效益曲的定義正是「單局 pt 高但曲長」,那要按單局 P 排,不是按每小時排。 */
        const SORTS = { eph: 'ep_per_hour', ep: 'event_points', score: 'score' };
        const sk = SORTS[String(a.sort_by || 'eph')] || 'ep_per_hour';
        rows.sort((x, y) => (y[sk] || 0) - (x[sk] || 0));
        const SORT_NOTE = {
          ep_per_hour: '每小時活動P ＝ 單局EP × 3600 ÷ (曲長＋間隔)。時間有限時看這個，會偏好短曲（俗稱效率曲／短效）。',
          event_points: '單局活動P。體力有限時看這個，會偏好長曲（俗稱效益曲／長效）——同樣一份體力拿到最多 P。',
          score: '單局分數。純粹衝分數（例如打歌活動或刷 B30）時看這個，與活動倍率無關。',
        };
        return {
          mode, difficulty: diff, boost_energy: energy, boost_multiplier: F, interval_s: iv,
          sort_by: String(a.sort_by || 'eph'),
          inputs: { power, bonus_pct: bonus, skill, s6 },
          total: rows.length, songs: rows.slice(off, off + lim),
          note: SORT_NOTE[sk] + ' 間隔含選曲、配對與結算；協力/應援另有 ' + this.ohOf(mode)
            + ' 秒固定開銷未計入此處（calc_event_points 才會加）。',
        };
      }

      case 'calc_skill_multiplier': {
        const s = this.state;
        const leader = a.leader != null ? +a.leader || 0 : +s.leader || 0;
        const src = Array.isArray(a.members) ? a.members : null;
        const m = src ? src.slice(0, 4).map(x => +x || 0) : [+s.m1 || 0, +s.m2 || 0, +s.m3 || 0, +s.m4 || 0];
        while (m.length < 4) m.push(0);
        const sum = m.reduce((x, y) => x + y, 0);
        // 與 mult() 同式：隊長全額、隊員總和 ÷ 5
        const mu = (leader + 100 + sum / 5) / 100;
        return {
          leader_pct: leader, member_pcts: m, member_sum_pct: sum,
          skill_multiplier: +mu.toFixed(4),
          note: '公式：[隊長% ＋ 100 ＋ (隊員總和% ÷ 5)] ÷ 100。這個值就是 calc_event_points／song_efficiency 的 skill 參數。',
        };
      }

      case 'gacha_odds': {
        const s = this.state;
        const bd = !!a.birthday;
        let p = a.rate != null ? +a.rate : 0.004;
        if (!(p > 0 && p < 1)) p = 0.004;
        const ceil = bd ? 100 : 300;
        const crystals = a.crystals != null ? Math.max(0, +a.crystals || 0) : (+s.gcC || 0);
        const done = a.pulls_done != null ? Math.max(0, +a.pulls_done || 0) : (+s.gcP || 0);
        const tickets = a.tickets != null ? Math.max(0, +a.tickets || 0) : (+s.gcV || 0);
        // 與 gacha() 同式
        const afford = Math.floor(crystals / 300);
        const pAfford = 1 - Math.pow(1 - p, afford);
        const eNo = 1 / p;
        const eCeil = (1 - Math.pow(1 - p, ceil)) / p;
        let toCeilPulls, note;
        if (bd) { toCeilPulls = Math.max(0, ceil - done); note = '生日池天井 100 抽，不可使用交換券'; }
        else {
          const usable = Math.min(tickets, 10);
          toCeilPulls = Math.max(0, 300 - done - usable * 10);
          note = '用 ' + usable + ' 張交換券（抵 ' + usable * 10 + ' 張貼紙）後尚需 ' + toCeilPulls + ' 抽到天井';
        }
        return {
          rate_per_pull: p, ceiling_pulls: ceil, is_birthday: bd,
          crystals, pulls_done: done, tickets,
          affordable_pulls: afford,
          prob_at_least_one_pct: +(pAfford * 100).toFixed(2),
          expected_pulls_no_ceiling: +eNo.toFixed(1),
          expected_pulls_with_ceiling: +eCeil.toFixed(1),
          pulls_to_ceiling: toCeilPulls, crystals_to_ceiling: toCeilPulls * 300,
          note: note + '。單抽 300 水晶；機率參考：任一 ★4 3%、FES 6%、指定 PU 單張約 0.4%。P(N)=1−(1−p)^N。',
        };
      }

      case 'mysekai_calc': {
        const s = this.state;
        const power = a.power != null ? +a.power || 0 : +s.power || 0;
        const bonus = a.bonus != null ? +a.bonus || 0 : +s.bonus || 0;
        const fever = a.fever != null ? (+a.fever || 1) : (+s.msFever || 1);
        const stam = a.stamina != null ? Math.max(0, +a.stamina || 0) : (+s.msStam || 0);
        // 與 mysekai() 同式
        const av = Math.floor(power / 450000 * 100) / 100;
        const b = Math.floor((av + 1) * (bonus + 100) / 100);
        const per = b * 100 * fever;
        return {
          inputs: { power, bonus_pct: bonus, fever_multiplier: fever, stamina: stam },
          a: av, b,
          ep_per_stamina: per,
          by_gather: {
            '木/石/音色（1 體力）': per,
            '發光草叢/木桶（0.5 體力）': Math.round(per * 0.5),
            '植物/寶箱（0.2 體力）': Math.round(per * 0.2),
          },
          total_event_points: Math.round(per * stam),
          note: 'a ＝ ⌊綜合力 / 450000⌋ 取兩位小數；b ＝ ⌊(a+1) × (加成+100)/100⌋；每點體力 P ＝ b × 100 × 體力倍率（橘體 5／藍體 1）。',
        };
      }

      case 'rank_match': {
        const s = this.state;
        const g = (k, sk) => (a[k] != null ? +a[k] || 0 : +s[sk] || 0);
        const ap = g('my_perfect', 'rmAp'), ag = g('my_great', 'rmAg'), ad = g('my_good', 'rmAd');
        const bp = g('opp_perfect', 'rmBp'), bg = g('opp_great', 'rmBg'), bdd = g('opp_good', 'rmBd');
        // 與 rankMatch() 同式
        const sa = ap * 3 + ag * 2 + ad, sb = bp * 3 + bg * 2 + bdd;
        const verdict = sa > sb ? '我方勝' : sb > sa ? '對手勝'
          : (ap > bp ? '同分 → 我方 PERFECT 較多，我方勝'
            : bp > ap ? '同分 → 對手 PERFECT 較多，對手勝'
            : '同分且 PERFECT 相同 → 再比最大連段 → 剩餘 Life');
        const winPct = a.win_rate != null ? +a.win_rate || 0 : +s.rmWin || 0;
        const rp = a.current_rp != null ? +a.current_rp || 0 : +s.rmRP || 0;
        const cls = a.target_classes != null ? +a.target_classes || 0 : +s.rmCls || 0;
        const p = winPct / 100;
        const needRP = 5 * Math.max(1, cls || 1) - Math.min(5, rp);
        const drift = 2 * p - 1;
        const games = drift > 0 ? Math.ceil(needRP / drift) : null;
        return {
          my_score: sa, opp_score: sb, verdict,
          win_rate_pct: winPct, current_rp: rp, target_classes: Math.max(1, cls || 1),
          need_rp: needRP,
          estimated_games: games,
          note: '判定：PERFECT×3＋GREAT×2＋GOOD×1，高者勝；同分比 PERFECT 數 → 最大連段 → 剩餘 Life。' +
                '每個 Class 需 5 RP，勝 +1 敗 −1，所以每場期望 RP ＝ 2×勝率−1；' +
                (games == null ? '勝率不到 50% 時期望不會前進，估不出場數。' : '') +
                ' 2024/09 起不再降段位，只降 Class。',
        };
      }

      /* ---------- 歌曲與玩家 ---------- */
      case 'get_songs': {
        await this.loadSongs();
        const songs = this.state.songs || [];
        if (!songs.length) return { error: '歌曲資料庫尚未載入（' + (this.state.songErr || '請稍後再試') + '）' };
        // 曲長與活動倍率只有 EP 曲庫有，缺了就只回定數，不擋整個查詢
        if (!(this.state.epSongs || []).length) {
          this.loadEpSongs();
          for (let i = 0; i < 25 && !(this.state.epSongs || []).length; i++) await new Promise(r => setTimeout(r, 100));
        }
        const DK = { E: 'easy', N: 'normal', H: 'hard', X: 'expert', M: 'master', A: 'append' };
        const SH = { E: 'E', N: 'N', H: 'H', X: 'X', M: 'M', A: 'A', EASY: 'E', NORMAL: 'N', HARD: 'H', EXPERT: 'X', MASTER: 'M', APPEND: 'A' };
        const dk = SH[String(a.difficulty || '').toUpperCase()] || 'M';
        const full = DK[dk];
        const q = String(a.q || '').trim().toLowerCase();
        let list = songs.slice();
        if (a.id != null) list = list.filter(x => +x.id === +a.id);
        if (a.unit) list = list.filter(x => (x.units || []).indexOf(a.unit) >= 0);
        if (q) list = list.filter(x => (x.title || '').toLowerCase().includes(q) || (x.composer || '').toLowerCase().includes(q));
        const total = list.length;
        if (!total) return { total: 0, songs: [], note: '沒有符合條件的歌曲；關鍵字可試試日文原曲名或作曲者。' };
        const ep = id => this.songById(id);
        const sort = a.sort || 'id';
        if (sort === 'level') list.sort((x, y) => ((y.lv || {})[full] || 0) - ((x.lv || {})[full] || 0));
        else if (sort === 'notes') list.sort((x, y) => ((y.nt || {})[full] || 0) - ((x.nt || {})[full] || 0));
        else if (sort === 'newest') list.sort((x, y) => (y.published || 0) - (x.published || 0));
        else if (sort === 'shortest') list.sort((x, y) => ((ep(x.id) || {}).time || 9999) - ((ep(y.id) || {}).time || 9999));
        else list.sort((x, y) => x.id - y.id);
        const lim = Math.max(1, Math.min(100, +a.limit || 20));
        const off = Math.max(0, +a.offset || 0);
        return {
          total, sorted_by: sort, level_difficulty: dk,
          songs: list.slice(0, lim).map(x => {
            const e = ep(x.id);
            return {
              id: x.id, title: x.title, composer: x.composer,
              units: x.units || [],
              levels: { E: (x.lv || {}).easy || null, N: (x.lv || {}).normal || null, H: (x.lv || {}).hard || null,
                        X: (x.lv || {}).expert || null, M: (x.lv || {}).master || null, A: (x.lv || {}).append || null },
              notes_at_difficulty: (x.nt || {})[full] || null,
              length_s: e ? e.time : null,
              event_rate_pct: e ? e.rate : null,
              published: x.published ? new Date(x.published).toISOString().slice(0, 10) : null,
            };
          }),
          note: 'levels 是各難度定數（E/N/H/X/M/A ＝ EASY/NORMAL/HARD/EXPERT/MASTER/APPEND）。length_s 與 event_rate_pct 來自 EP 曲庫，較舊或未收錄的曲子可能是 null。',
        };
      }

      case 'analyze_player': {
        if (!this.state.live) { try { await this.loadLive(); } catch (e) {} }
        const uid = String(a.uid || this.state.pid || '').replace(/\D/g, '');
        if (!uid) return { error: '沒有指定 uid，也還沒設定使用者自己的 uid（可先用 set_my_uid）' };
        const list = this.ranksOf(this.state.live);
        if (!list.length) return { error: '即時排名尚未載入，' + (this.state.liveErr || '請稍後再試') };
        const A = this.playerAnalysis(uid);
        if (!A) return { error: 'uid ' + uid + ' 不在當期前 100 名。公開 API 對第 101 名之後不提供本期活動分數，查不到就是查不到，不要猜。' };
        const me = A.me || {};
        const num = v => (v == null ? null : Math.round(v));
        const st = k => { const o = A[k] || {}; return { speed_per_hour: num(o.speed), rounds: o.count != null ? o.count : null, avg_per_round: num(o.average) }; };
        const S = this.playerSeries(uid);
        return {
          uid, name: me.name || null, rank: me.rank, score: me.score,
          last_round_gain: me.lastScore != null ? me.lastScore : null,
          last_played: me.lastPlayed || null,
          stats: { last_1h: st('h1'), last_3h: st('h3'), last_24h: st('h24') },
          momentum: A.mom != null ? +A.mom.toFixed(2) : null,
          rest_hours_est_24h: A.restH != null ? +A.restH.toFixed(1) : null,
          projected_final_score: A.proj != null ? Math.round(A.proj) : null,
          projected_rank: A.projRank,
          avg_per_round_percentile: A.pctile,
          clock: A.clock ? { progress_pct: +(A.clock.frac * 100).toFixed(1), hours_left: +A.clock.leftH.toFixed(1) } : null,
          rank_series: S ? { best_rank: S.best, worst_rank: S.worst, samples: S.n } : null,
          borders: (A.borders || []).slice(0, 8).map(b => ({ tier: b.rank, score: b.score,
            gap_from_player: me.score != null ? b.score - me.score : null })),
          note: 'momentum ＝ 近 1 小時時速 ÷ 近 24 小時時速（>1 是在加速，<1 是在降溫）。' +
                'rest_hours_est_24h 是用近 3 小時的節奏推估滿載周回、再與實際 24 小時周回相減，只是估計值。' +
                'projected_rank 是把前百各自用自己的 24 小時時速投影後重排的結果，末段衝刺會讓它偏樂觀。',
        };
      }

      case 'get_player_games': {
        const uid = String(a.uid || this.state.pid || '').replace(/\D/g, '');
        if (!uid) return { error: '沒有指定 uid，也還沒設定使用者自己的 uid' };
        /* loadGames 對同一個 uid 會直接 return（避免重複打），所以不能只 await 它——
           上一次呼叫可能還在飛。await 之後再輪詢 gamesLoad 才保險。 */
        await this.loadGames(uid);
        for (let i = 0; i < 40 && this.state.gamesLoad; i++) await new Promise(r => setTimeout(r, 150));
        if (this.state.gamesErr) return { error: this.state.gamesErr };
        const all = this.state.gamesRows;
        if (!all) return { error: '逐局紀錄尚未載入完成，請稍後再問一次' };
        if (!all.length) return { uid, total: 0, games: [],
          note: '這位玩家沒有逐局紀錄。逐局紀錄只涵蓋當期前 100 名（公開資料對第 101 名之後不給本期分數），且從開始追蹤後才累積，不會回溯。' };
        const ev = this.state.gamesEv || {};
        const startMs = ev.startAt || 0;
        const abs = t => (startMs ? new Date(startMs + t * 1000).toISOString() : null);
        let rows = all;
        if (a.hours != null && +a.hours > 0) {
          const nowRel = startMs ? Math.floor((Date.now() - startMs) / 1000) : all[all.length - 1].t;
          const cut = nowRel - (+a.hours) * 3600;
          rows = all.filter(g => g.t >= cut);
        }
        if (!rows.length) return { uid, total: all.length, in_range: 0, games: [], note: '這個時間範圍內沒有紀錄。' };
        const ds = rows.map(g => g.delta).slice().sort((x, y) => x - y);
        const sum = ds.reduce((x, y) => x + y, 0);
        const mid = ds.length % 2 ? ds[(ds.length - 1) / 2] : Math.round((ds[ds.length / 2 - 1] + ds[ds.length / 2]) / 2);
        const spanH = rows.length > 1 ? (rows[rows.length - 1].t - rows[0].t) / 3600 : 0;
        const lim = Math.max(1, Math.min(20, +a.limit || 15));
        const tail = rows.slice(-lim);
        return {
          uid, total: all.length, in_range: rows.length,
          range_hours: +spanH.toFixed(1),
          first_at: abs(rows[0].t), last_at: abs(rows[rows.length - 1].t),
          sum_event_points: sum,
          avg_per_game: Math.round(sum / rows.length),
          median_per_game: mid, max_per_game: ds[ds.length - 1], min_per_game: ds[0],
          games_per_hour: spanH > 0 ? +(rows.length / spanH).toFixed(1) : null,
          points_per_hour: spanH > 0 ? Math.round(sum / spanH) : null,
          recent_games: tail.map((g, i) => ({
            at: abs(g.t), event_points: g.delta, rank_at_that_time: g.rank,
            gap_from_prev_s: i > 0 ? tail[i].t - tail[i - 1].t : null })),
          record_gaps: (this.state.gamesGaps || []).length,
          note: '每 15 秒取樣一次，一場協力最短約 150 秒，所以一筆就是一場。record_gaps 是本期紀錄中斷的段數，' +
                '中斷區間內的點可能是多場合併，場均會被高估。',
        };
      }

      case 'get_player_profile': {
        const uid = String(a.uid || this.state.pid || '').replace(/\D/g, '');
        if (!uid) return { error: '沒有指定 uid，也還沒設定使用者自己的 uid' };
        let d;
        try { d = await this.apiFetch('/user/' + encodeURIComponent(uid) + '/profile'); }
        catch (e) { return { error: '查不到這個 uid 的公開資料（' + ((e && e.message) || '請求失敗') + '）' }; }
        if (!d) return { error: '查不到這個 uid 的公開資料' };
        const u = d.user || d.userProfile || d.profile || d || {};
        const gd = d.userGamedata || d.user_gamedata || u.gamedata || u;
        const tp = d.totalPower || {};
        const deck = d.userDeck || {};
        const deckCards = Object.keys(deck).filter(k => /member/i.test(k))
          .map(k => deck[k]).filter(v => v != null && String(v).match(/^\d+$/)).map(Number);
        const chars = (d.userCharacters || []).slice()
          .sort((x, y) => (y.characterRank || 0) - (x.characterRank || 0));
        return {
          uid, name: gd.name || u.name || null, player_rank: gd.rank || u.rank || null,
          total_power: tp.totalPower || tp.total_power || u.total_power || null,
          base_card_power: tp.basicCardTotalPower != null ? tp.basicCardTotalPower : null,
          character_rank_bonus: tp.characterRankBonus != null ? tp.characterRankBonus : null,
          area_item_bonus: tp.areaItemBonus != null ? tp.areaItemBonus : null,
          deck_name: deck.name || null, deck_card_ids: deckCards,
          owned_cards_visible: (d.userCards || []).length,
          character_ranks: chars.slice(0, 10).map(c => ({ character: this.chNameOf(c.characterId), rank: c.characterRank })),
          character_rank_total: chars.reduce((x, c) => x + (c.characterRank || 0), 0),
          challenge_high_score: (d.userChallengeLiveSoloResult && d.userChallengeLiveSoloResult.highScore) || null,
          music_clear: (d.userMusicDifficultyClearCount || []).map(m => ({
            difficulty: m.musicDifficultyType, clear: m.liveClear, full_combo: m.fullCombo, all_perfect: m.allPerfect })),
          note: '這些都是遊戲的公開資料。userCards 只公開隊伍與展示卡（約 14 張），不是完整持有清單，' +
                '不要拿 owned_cards_visible 當收集率。',
        };
      }

      case 'get_top100': {
        if (!this.state.live) { try { await this.loadLive(); } catch (e) {} }
        let list, label = '活動主榜', ch = null;
        if (a.board === 'world_link') {
          const chs = this.wlChapters();
          if (!chs.length) return { error: '當期不是 World Link 活動，沒有章節榜' };
          const pick = a.chapter != null ? chs.find(c => +c.chapter === +a.chapter)
            : (chs.find(c => c.live) || chs[chs.length - 1]);
          if (!pick) return { error: '找不到第 ' + a.chapter + ' 章', available: chs.map(c => c.chapter) };
          list = pick.ranks || []; ch = pick.chapter; label = 'World Link 第 ' + pick.chapter + ' 章（' + pick.name + '）';
        } else {
          list = this.ranksOf(this.state.live);
        }
        if (!list.length) return { error: '即時排名尚未載入，' + (this.state.liveErr || '請稍後再試') };
        const sp = (r, k) => (r.stats && r.stats[k] && r.stats[k].speed) || null;
        const cnt = (r, k) => (r.stats && r.stats[k] && r.stats[k].count != null) ? r.stats[k].count : null;
        const now = Date.now();
        let rows = list.slice();
        if (a.sort === 'speed_1h') rows.sort((x, y) => (sp(y, 'h1') || 0) - (sp(x, 'h1') || 0));
        else if (a.sort === 'speed_24h') rows.sort((x, y) => (sp(y, 'h24') || 0) - (sp(x, 'h24') || 0));
        else rows.sort((x, y) => x.rank - y.rank);
        const lim = Math.max(1, Math.min(20, +a.limit || 10));
        // 整體動態只有主榜算得出來（activeAnalysis 讀的是 state.live）
        const AA = (a.board === 'world_link') ? null : this.activeAnalysis();
        return {
          board: label, chapter: ch, total: list.length, sorted_by: a.sort || 'rank',
          players: rows.slice(0, lim).map(r => ({
            rank: r.rank, name: r.name, uid: r.uid, score: r.score,
            last_round_gain: r.lastScore != null ? r.lastScore : null,
            speed_1h_per_hour: sp(r, 'h1') != null ? Math.round(sp(r, 'h1')) : null,
            speed_24h_per_hour: sp(r, 'h24') != null ? Math.round(sp(r, 'h24')) : null,
            rounds_1h: cnt(r, 'h1'),
            minutes_since_last_play: r.lastPlayed ? Math.round((now - new Date(r.lastPlayed).getTime()) / 60000) : null,
          })),
          activity: AA ? {
            online_within_15min: AA.online.length,
            grinding_last_1h: AA.grinding.length,
            idle_over_60min: AA.idle.length,
            total_rounds_last_1h: AA.rounds1h,
            surging: AA.surging.slice(0, 5).map(x => ({ rank: x.r.rank, name: x.r.name,
              ratio_1h_vs_24h: +(x.s1 / x.s24).toFixed(2) })),
            cooling: AA.cooling.slice(0, 5).map(x => ({ rank: x.r.rank, name: x.r.name,
              ratio_1h_vs_24h: +(x.s1 / x.s24).toFixed(2) })),
          } : null,
          note: '時速單位是活動P／小時。surging＝近 1 小時時速是自己 24 小時均速的 1.2 倍以上；cooling＝掉到 0.5 倍以下。',
        };
      }

      /* ---------- World Link ---------- */
      case 'wl_team_advice': {
        await this.loadCards();
        const cards = this.state.rateCards || [];
        if (!cards.length) return { error: '卡片索引尚未載入（' + (this.state.rateErr || '請先開啟「收集率」頁') + '）' };
        let charId = null, from = '';
        if (a.chapter != null) {
          const chs = this.wlChapters();
          const c = chs.find(x => +x.chapter === +a.chapter);
          if (!c) return { error: '當期查不到第 ' + a.chapter + ' 章', available: chs.map(x => x.chapter) };
          charId = c.character; from = 'chapter ' + c.chapter;
        } else if (a.character != null && String(a.character).trim() !== '') {
          const t = String(a.character).trim();
          charId = /^\d+$/.test(t) ? +t : this.CHARA_ID[t];
          if (!charId) return { error: '不認得角色「' + t + '」', hint: '請用繁中角色名，例如 一歌／咲希／穗波／志步／實乃理／遙／愛莉／雫／心羽／杏／彰人／冬彌／司／笑夢／寧寧／類／奏／真冬／繪名／瑞希／未來／鈴／連／流歌／MEIKO／KAITO' };
          from = 'character';
        } else {
          const chs = this.wlChapters();
          const c = chs.find(x => x.live) || chs[chs.length - 1];
          if (!c) return { error: '當期不是 World Link 活動，也沒指定 character' };
          charId = c.character; from = '目前進行中的章節';
        }
        const chk = this.wlCheck(charId);
        const sug = this.wlSuggest(charId);
        const ATTR = ['cool', 'happy', 'mysterious', 'cute', 'pure'];
        const WLB = { 3: 75, 4: 100, 5: 125 };
        const info = c => ({
          card_id: c[0], card_name: c[7] || '', character: this.chNameOf(c[1]),
          rarity: (this.RARITY.find(r => r[0] === c[2]) || [null, '?'])[1],
          attribute: this.ATTR_ZH[ATTR[c[3]]] || String(c[3]),
          supply: this.SUPPLYN[c[4]] || '',
          support_unit: c[5] >= 0 ? ((this.UNITS[this.UNIT_OF[c[5]]] || {}).n || null) : null,
        });
        return {
          character: this.chNameOf(charId), character_id: charId, resolved_from: from,
          rules: this.WL_RULES.map(r => ({ scenario: r[0], points: r[1] })),
          owned_check: chk ? {
            owned_high_rarity_total: chk.total,
            owned_same_unit: chk.unitCards,
            attributes_covered: chk.attrHave,
            missing_attributes: chk.missing,
            by_attribute: chk.byAttr.map(x => ({ attribute: x.n, owned: x.c })),
          } : null,
          suggestion: sug ? {
            colors: sug.colors,
            world_link_attr_bonus_pct: WLB[sug.colors] || 0,
            same_unit_natives: sug.natives,
            team: sug.team.map(info),
          } : null,
          note: '這是規則檢查（四位同團＋五色屬性），不是倍率最佳化——WL 的加成公式沒有可靠來源，硬算會給錯的隊伍。' +
                '持有清單來自站上「收集率」頁的手動勾選（存在瀏覽器），沒勾就等於沒有；suggestion 為 null 代表勾選的 ★4／生日卡不足以組出隊伍。' +
                (sug && sug.colors < 5 ? '　目前只湊得出 ' + sug.colors + ' 色，五色加成 125% 拿不到。' : ''),
        };
      }

      case 'get_wl_status': {
        if (!this.state.live) { try { await this.loadLive(); } catch (e) {} }
        const chs = this.wlChapters();
        if (!chs.length) return { error: '當期不是 World Link 活動（沒有章節榜）' };
        // wlSpeed 讀的是公用快照（state.hist），沒載就量不到實測時速
        if (!this.state.hist) { try { await this.loadBorderHistory(); } catch (e) {} }
        const tier = +a.tier || 100;
        const pick = a.chapter != null ? chs.filter(c => +c.chapter === +a.chapter) : chs;
        if (!pick.length) return { error: '找不到第 ' + a.chapter + ' 章', available: chs.map(c => c.chapter) };
        return {
          total_chapters: chs.length, speed_tier: tier,
          chapters: pick.map(c => {
            const sp = this.wlSpeed(c.chapter, tier, 6);
            const ranks = c.ranks || [];
            return {
              chapter: c.chapter, character: c.name,
              start: c.start ? new Date(c.start).toISOString() : null,
              end: c.end ? new Date(c.end).toISOString() : null,
              status: c.live ? 'live' : c.done ? 'ended' : 'upcoming',
              hours_left: c.live && c.end ? +((c.end - Date.now()) / 3600000).toFixed(1) : null,
              top1_score: ranks.length ? ranks[0].score : null,
              top100_score: ranks.length >= 100 ? ranks[99].score : null,
              borders: (c.borders || []).map(b => ({ tier: b.rank, score: b.score })),
              measured_speed_per_hour: sp ? Math.round(sp.rate) : null,
              measured_span_h: sp ? +sp.spanH.toFixed(1) : null,
              measured_samples: sp ? sp.n : null,
            };
          }),
          note: '實測時速取最近 6 小時的窗口（跨距不足才退回整段），單位是活動P／小時。' +
                'WL 期間 API 偶爾會回串到別處的值，站上已用 running-min 修過單調性。' +
                '章節只有 3 天，末段衝刺很兇，拿整段平均推剩餘時間會明顯低估。',
        };
      }

      /* ---------- 收集率 ---------- */
      case 'get_collection_rate': {
        await this.loadCards();
        if (!(this.state.rateCards || []).length) return { error: '卡片索引尚未載入（' + (this.state.rateErr || '請先開啟「收集率」頁') + '）' };
        const st = this.rateStat();
        if (!st || !st.all || !st.all.n) return { error: '收集率統計算不出來，卡片資料可能不完整' };
        const p = (h, n) => +this.pct(h, n).toFixed(1);
        return {
          overall: { owned: st.all.have, total: st.all.n, missing: st.all.n - st.all.have, pct: p(st.all.have, st.all.n) },
          by_unit: Object.keys(st.byU).filter(k => st.byU[k].n > 0).map(k => ({
            unit: k, name: (this.UNITS[k] || {}).n || k,
            owned: st.byU[k].have, total: st.byU[k].n,
            missing: st.byU[k].n - st.byU[k].have, pct: p(st.byU[k].have, st.byU[k].n) })),
          by_rarity: this.RARITY.filter(r => st.byR[r[0]] && st.byR[r[0]].n > 0).map(r => ({
            rarity: r[1],
            owned: st.byR[r[0]].have, total: st.byR[r[0]].n,
            missing: st.byR[r[0]].n - st.byR[r[0]].have, pct: p(st.byR[r[0]].have, st.byR[r[0]].n) })),
          note: st.all.have === 0
            ? '目前一張都沒勾選。收集率是站上「收集率」頁手動勾選的（存在這台瀏覽器），不是從遊戲抓的——公開 API 只給隊伍與展示卡，拿不到完整持有清單。'
            : '資料來自站上「收集率」頁的手動勾選（存在這台瀏覽器）。unit 的分類會優先看卡片的支援團。',
        };
      }

      /* ---------- 規劃 ---------- */
      case 'plan_target': {
        if (!this.state.live) { try { await this.loadLive(); } catch (e) {} }
        if (!(this.state.epSongs || []).length) {
          this.loadEpSongs();
          for (let i = 0; i < 40 && !(this.state.epSongs || []).length; i++) await new Promise(r => setTimeout(r, 100));
        }
        /* 一定要等 loadLive 之後才取 state：matchMyRank 會在那時才把 pdata.myScore
           寫進去，先抓的話拿到的是還沒有我的分數的舊物件。 */
        const s = this.state;
        const B = this.borderAnalysis();
        // 目標分數：優先用明確指定的，否則取該段位的預測終線
        let goal = null, tierRow = null;
        if (a.target_score != null) goal = Math.max(0, +a.target_score || 0);
        else if (a.tier != null) {
          if (!B) return { error: '榜線資料尚未載入，無法取得段位預測；可以改用 target_score 直接指定目標分數' };
          tierRow = B.rows.find(r => +r.rank === +a.tier);
          if (!tierRow) return { error: '當期沒有 T' + a.tier + ' 這一段榜線', available_tiers: B.rows.map(r => r.rank) };
          goal = Math.round(tierRow.proj);
        } else return { error: '要給 tier（目標段位）或 target_score（目標分數）其中一個' };

        const cur = a.current_score != null ? Math.max(0, +a.current_score || 0)
          : ((s.pdata && s.pdata.myScore != null) ? s.pdata.myScore : 0);
        const left = Math.max(0, goal - cur);
        const ck = (B && B.clock) || this.eventClock();
        const leftH = ck ? ck.leftH : null;

        // 單場產出：與 calc_event_points 同一套（epResult() 的參數化版本）
        const DK = { E: 'E', N: 'N', H: 'H', X: 'X', M: 'M', A: 'A', EASY: 'E', NORMAL: 'N', HARD: 'H', EXPERT: 'X', MASTER: 'M', APPEND: 'A' };
        const mode = ['solo', 'auto', 'multi', 'cheer'].indexOf(a.mode) >= 0 ? a.mode : (s.mode || 'multi');
        const diff = DK[String(a.difficulty || '').toUpperCase()] || s.diff || 'M';
        const power = a.power != null ? +a.power || 0 : +s.power || 0;
        const bonus = a.bonus != null ? +a.bonus || 0 : +s.bonus || 0;
        const skill = a.skill != null ? +a.skill || 0 : +s.skill || 0;
        const s6 = a.s6 != null ? +a.s6 || 0 : +s.s6 || 0;
        const energy = a.energy != null ? Math.max(0, Math.min(10, Math.round(+a.energy || 0))) : (+s.energy || 0);
        const F = this.EM[energy] || 1;
        const song = this.songById(a.song_id != null ? a.song_id : s.songKey);
        const rate = song ? song.rate : (+s.rate || 100);
        const time = song ? song.time : 100;
        let score = 0;
        if (song && song.d) {
          const k = [diff, 'M', 'X', 'H', 'N', 'E', 'A'].find(x => song.d[x]);
          score = k ? this.calcSongScore(song.d[k], mode, power, skill, s6) : 0;
        } else score = +s.score || 0;
        const ep = this.calcEPValue(mode, score, rate, bonus, F, power, +s.life || 0);
        const cycle = time + this.ohOf(mode);
        if (!(ep > 0)) return { error: '算出來單場 0 P，請檢查綜合力／加成／歌曲設定' };

        // 與 plan() 同式的體力與花費換算
        const plays = Math.ceil(left / ep);
        const totalMin = plays * cycle / 60;
        const totalEnergy = plays * energy;
        const natHr = a.natural_hours != null ? +a.natural_hours || 0 : +s.natHr || 0;
        const lCan = a.large_cans != null ? +a.large_cans || 0 : +s.lCan || 0;
        const sCan = a.small_cans != null ? +a.small_cans || 0 : +s.sCan || 0;
        const crys = a.crystals != null ? +a.crystals || 0 : +s.crys || 0;
        const recoverable = natHr * 2 + lCan * 10 + sCan * 5 + crys * 10;
        const net = Math.max(0, totalEnergy - recoverable);
        const crystal = Math.ceil(net / 10) * 100;
        const jRate = Math.max(0.1, a.crystal_rate != null ? +a.crystal_rate || 7 : +s.jRate || 7);
        const needSpeed = (leftH && leftH > 0) ? left / leftH : null;
        const epPerHour = Math.round(ep * 3600 / cycle);
        return {
          target: { tier: a.tier != null ? +a.tier : null, target_score: goal,
            target_from: a.target_score != null ? '呼叫時指定' : (tierRow ? (tierRow.method === 'model' ? '該段位的模型預測（速率剖面＋集成）' : tierRow.measured ? '該段位的實測時速外推' : '該段位的線性外推') : null),
            history_weighted: tierRow && tierRow.refMed != null ? Math.round(tierRow.refMed) : null,
            history_range: tierRow && tierRow.refLo != null ? [tierRow.refLo, tierRow.refHi] : null },
          current_score: cur, gap: left,
          clock: ck ? { progress_pct: +(ck.frac * 100).toFixed(1), hours_left: +ck.leftH.toFixed(1) } : null,
          per_play: { mode, song: song ? { id: song.id, title: song.t } : null,
            difficulty: diff, boost_energy: energy, boost_multiplier: F,
            event_points: ep, cycle_s: cycle, ep_per_hour: epPerHour },
          required: {
            speed_per_hour: needSpeed != null ? Math.round(needSpeed) : null,
            plays, hours_of_play: +(totalMin / 60).toFixed(1),
            energy: totalEnergy,
            recoverable_energy: recoverable, energy_to_buy: net,
            crystals: crystal, twd: Math.round(crystal / jRate),
            ep_per_twd: energy > 0 ? Math.round(ep / (energy * 10) * jRate) : null,
          },
          feasible: (needSpeed != null && leftH != null) ? {
            enough_time: totalMin / 60 <= leftH,
            required_vs_achievable_pct: epPerHour > 0 ? +(needSpeed / epPerHour * 100).toFixed(0) : null,
          } : null,
          note: '段位目標取站上的預測終線（模型：4 期留一法回測主榜平均誤差 5.6%，T100 仍有一成多、越前面越不準；未載入模型時為外推法，末段會低估），安全起見再往上抓一成。' +
                '體力換算：可回復 ＝ 自然回復小時×2 ＋ 大罐×10 ＋ 小罐×5 ＋ 石×10；不足的部分每 10 體 100 石，水晶 CP 用 ' + jRate + ' 石/元。' +
                'required.speed_per_hour 是「剩餘時間內平均要跑多快」，per_play.ep_per_hour 是「照這個配置滿載能跑多快」，兩者相比就知道還有沒有餘裕。',
        };
      }

      /* ---------- 偵測訂閱 ---------- */
      case 'create_watch': {
        /* loadMe 有 _meLoading 去重，開站時那次可能還在飛 → await 完再輪詢一下，
           否則會誤判成「尚未登入」。 */
        if (this.state.me === undefined) {
          try { await this.loadMe(); } catch (e) {}
          for (let i = 0; i < 30 && this.state.me === undefined; i++) await new Promise(r => setTimeout(r, 100));
        }
        const me = this.state.me;
        if (!me) return { error: '尚未登入，無法建立訂閱。請使用者先到「帳號」頁用 Google 或 Discord 登入。' };
        if (me.status !== 'approved') return { error: '帳號目前狀態是「' + (me.status || '未知') + '」，通過審核後才能建立訂閱。' };
        /* loadWatchKinds 已經在跑就會直接 return，所以要輪詢它寫回 state */
        if (!this.state.watchKinds) {
          this.loadWatchKinds();
          for (let i = 0; i < 40 && !this.state.watchKinds; i++) await new Promise(r => setTimeout(r, 100));
        }
        const K = this.state.watchKinds || {};
        if (!Object.keys(K).length) return { error: '偵測規格尚未載入，請稍後再試' };
        const kind = K[a.kind];
        if (!kind) return { error: '沒有「' + a.kind + '」這種偵測類型', allowed: Object.keys(K) };
        if (kind.available === false) return { error: '「' + (kind.label || a.kind) + '」目前不可用', reason: kind.unavailable_reason || '' };
        const modes = kind.modes || {};
        const mode = String(a.mode || '');
        if (!modes[mode]) return { error: '「' + (kind.label || a.kind) + '」沒有 mode=' + mode,
          allowed: Object.keys(modes).map(k => ({ mode: k, label: modes[k].label, example: modes[k].example || null })) };
        const fields = [].concat(kind.common_fields || [], modes[mode].fields || []);
        const spec = fields.map(f => ({ key: f.key, label: f.label, type: f.type,
          required: !!f.required, default: f.default != null ? f.default : null,
          options: f.options ? f.options.map(o => o.value) : null, hint: f.hint || null }));
        const src = (a.params && typeof a.params === 'object') ? a.params : {};
        const params = {};
        if (kind.mode_key) params[kind.mode_key] = mode;
        const missing = [];
        for (const fd of fields) {
          let v = src[fd.key];
          if (v == null || v === '') v = fd.default;
          if (v == null || v === '') { if (fd.required) missing.push(fd.key); continue; }
          // 與 createWatch() 一致：只有 number 型別轉數字，其餘原樣送（uid 是 19 位大整數，轉數字會失精）
          params[fd.key] = fd.type === 'number' ? Number(v) : v;
        }
        if (missing.length) return { error: '缺少必填參數：' + missing.join('、'), fields: spec,
          example: modes[mode].example || null };
        let r;
        try {
          r = await this.api('/api/watches', { method: 'POST', body: {
            kind: a.kind,
            name: a.name || ((kind.label || '') + '・' + (modes[mode].label || mode)),
            params, cooldown_s: a.cooldown_s != null ? Number(a.cooldown_s) : (kind.default_cooldown_s || 3600) } });
        } catch (e) { return { error: (e && e.message) || '建立失敗', fields: spec }; }
        this.loadWatches();   // 讓「帳號」頁的清單跟著更新；失敗不影響這次回覆
        const w = (r && r.watch) || {};
        const caps = this.state.caps || {};
        return { ok: true,
          watch: { id: w.id, kind: w.kind, name: w.name, params: w.params, enabled: w.enabled, cooldown_s: w.cooldown_s },
          mode_note: modes[mode].note || null,
          kind_limits: kind.limits || null,
          delivery: caps.mail === false ? '注意：站方目前沒有設定寄信服務，訂閱會建立成功但通知寄不出去。' : '通知會寄到帳號綁定的信箱。',
        };
      }

      case 'get_b30': {
        /* 定數資料是獨立的 classic script（掛 window.B30_CONSTS），App 這邊平常不載，
           所以第一次呼叫要自己拉。vercel.json 已對 /data/b30-consts.js 設 must-revalidate，
           不掛版本號才不會黏在改版前的舊定數上（跟經典版 B30 走同一份檔）。 */
        if (!window.B30_CONSTS) {
          if (!this._b30Loading) {
            this._b30Loading = new Promise(res => {
              const s = document.createElement('script');
              s.src = 'data/b30-consts.js?v=7f878df18f';
              s.onload = () => res();
              s.onerror = () => { this._b30Loading = null; res(); };   // 清掉才允許下次重試
              document.head.appendChild(s);
            });
          }
          await this._b30Loading;
        }
        const D = window.B30_CONSTS;
        if (!D || !(D.charts || []).length) return { error: '定數資料（data/b30-consts.js）載入失敗，請重新整理後再試一次。' };

        /* 成績是使用者在「B30 產生器」頁手動勾的，存這台瀏覽器的 localStorage。
           App 與經典版同網域共用 localStorage，所以直接讀同一把 key。1=FC、2=AP。 */
        let marks = {};
        try { marks = JSON.parse(localStorage.getItem('sekai-b30-marks') || '{}') || {}; } catch (e) { marks = {}; }

        /* 以下四個常數／算式必須跟 js/core.js 的 B30Maker 完全一致，否則兩邊會報不同的 B30：
           「+」記號一律計入運算（+ = +0.05、++ = +0.09999999，貼著下一帶但嚴格小於），
           実効值 AP=定數、FC=定數−1，B30 分母固定 30（不足 30 張也除以 30）。 */
        const PLUS = [0, 0.05, 0.09999999];
        const cval = c => c.c + PLUS[c.p || 0];
        const clab = c => c.c.toFixed(1) + '+'.repeat(c.p || 0);
        const key = c => c.d[0] + c.id;                       // 'm329' / 'a487' / 'e162'
        const eff = (c, m) => (m === 2 ? cval(c) : m === 1 ? cval(c) - 1 : 0);
        const DN = { master: 'MASTER', append: 'APPEND', expert: 'EXPERT' };
        const r2 = v => +v.toFixed(2), r3 = v => +v.toFixed(3), r4 = v => +v.toFixed(4);

        let ap = 0, fc = 0, bestAp = 0, bestFc = 0;
        const marked = [];
        D.charts.forEach(c => {
          const m = marks[key(c)] | 0;
          if (m !== 1 && m !== 2) return;
          if (m === 2) { ap++; if (cval(c) > bestAp) bestAp = cval(c); } else fc++;
          if (cval(c) > bestFc) bestFc = cval(c);            // AP 也算 FC（能 AP 必然能 FC）
          marked.push({ c, m, v: eff(c, m) });
        });
        if (!marked.length) {
          return { error: '你還沒勾選任何譜面，所以算不出 B30（不是 0，是沒有資料）。'
            + '台服公開 API 拿不到逐曲成績，成績要自己勾：站上「計算 → B30 產生器」頁（App 內 page=b30，'
            + '或經典版 index.html#b30-maker），在曲目清單點一下＝FC、點兩下＝AP，勾完再回來問我。'
            + '勾選只存在這台瀏覽器。' };
        }

        marked.sort((x, y) => y.v - x.v);
        const top = marked.slice(0, 30);
        const sum = top.reduce((s, x) => s + x.v, 0);
        const b30 = sum / 30;
        const t30 = top.length >= 30 ? top[29].v : 0;         // 門檻＝第 30 名的実効值；不滿 30 張時任何一張都進得去
        const inTop = new Set(top.map(x => key(x.c)));

        /* 建議上限：直接列「全曲庫最硬的那幾張」等於沒建議，所以用玩家自己的最佳成績當天花板，
           只推他打得動的範圍（stretch 是往上探的幅度）。已經 FC 的譜面不套上限——
           那本來就是他打得動的曲子，補 AP 是最自然的下一步。 */
        const stretch = a.stretch == null ? 0.5 : Math.max(0, Math.min(5, +a.stretch || 0));
        const hardCap = Number.isFinite(+a.max_const) ? +a.max_const : null;
        const apCap = hardCap != null ? hardCap : (bestAp > 0 ? bestAp : Math.max(0, bestFc - 1)) + stretch;
        const fcCap = hardCap != null ? hardCap : bestFc + stretch;
        const pool = ['all', 'tw', 'jp'].indexOf(a.pool) >= 0 ? a.pool : 'all';
        const want = ['all', 'fc', 'ap'].indexOf(a.target) >= 0 ? a.target : 'all';

        const cands = [];
        D.charts.forEach(c => {
          if (pool === 'tw' && c.jp) return;
          if (pool === 'jp' && !c.jp) return;
          const k = key(c), m = marks[k] | 0, base = cval(c);
          const plans = m === 0 ? [['FC', base - 1, fcCap], ['AP', base, apCap]]
                      : m === 1 ? [['AP', base, Infinity]]                      // 已 FC 的不套上限
                      : [];
          plans.forEach(([tg, nv, cap]) => {
            if (want === 'fc' && tg !== 'FC') return;
            if (want === 'ap' && tg !== 'AP') return;
            if (base > cap) return;
            /* 提升幅度用增量公式算，跟「整包重排再平均」等價：
               已在 B30 內的譜面不會擠掉別人，直接換掉自己的舊值；
               不在 B30 內的則要高過門檻才有意義，擠掉的正是第 30 名。 */
            let after;
            if (inTop.has(k)) after = sum - eff(c, m) + nv;
            else if (nv > t30) after = sum - t30 + nv;
            else return;
            const gain = (after - sum) / 30;
            if (gain <= 1e-9) return;
            cands.push({
              song_id: c.id, title: c.t, title_tc: c.tc || null,
              difficulty: DN[c.d] || c.d, level: c.lv,
              const_value: r2(base), const_label: clab(c),
              current: m === 1 ? 'FC' : '未標記', target: tg,
              value_after: r2(nv),
              b30_gain: r4(gain), b30_after: r3(after / 30),
              jp_only: !!c.jp, estimated_const: !!c.e,
              reason: inTop.has(k)
                ? (m === 1 ? '已在 B30 內，補到 AP 就是原地 +1 実効值' : '已在 B30 內')
                : (top.length < 30 ? '目前不滿 30 張，直接補位' : '擠掉門檻 ' + r2(t30)),
            });
          });
        });
        // 同樣的提升幅度就把好打的排前面（定數低優先），不然模型會叫他去打最硬的那張
        cands.sort((x, y) => y.b30_gain - x.b30_gain || x.const_value - y.const_value || x.level - y.level);

        const tLim = Math.max(1, Math.min(30, +a.top_limit || 30));
        const sLim = Math.max(1, Math.min(50, +a.suggest_limit || 15));

        return {
          b30: r3(b30),
          counted: top.length,
          marked_total: marked.length, marked_ap: ap, marked_fc: fc,
          threshold: {
            value: r2(t30),
            need_ap_const: top.length >= 30 ? r2(t30) : null,
            need_fc_const: top.length >= 30 ? r2(t30 + 1) : null,
            desc: top.length >= 30
              ? '要擠進 B30：AP 一張定數 ≥ ' + r2(t30) + '，或 FC 一張定數 ≥ ' + r2(t30 + 1) + '。'
              : '還沒滿 30 張，任何一張新標記都會直接進榜。',
          },
          tw_theory_max: r3(D.charts.filter(c => !c.jp).map(cval).sort((x, y) => y - x)
            .slice(0, 30).reduce((s, v) => s + v, 0) / 30),
          top30: top.slice(0, tLim).map((x, i) => ({
            rank: i + 1, song_id: x.c.id, title: x.c.t, title_tc: x.c.tc || null,
            difficulty: DN[x.c.d] || x.c.d, level: x.c.lv,
            const_value: r2(cval(x.c)), const_label: clab(x.c),
            mark: x.m === 2 ? 'AP' : 'FC', value: r2(x.v),
            jp_only: !!x.c.jp, estimated_const: !!x.c.e,
          })),
          suggestions: cands.slice(0, sLim),
          suggestion_basis: {
            best_ap_const: bestAp ? r2(bestAp) : null,
            best_fc_const: bestFc ? r2(bestFc) : null,
            max_const_for_ap: hardCap != null ? hardCap : r2(apCap),
            max_const_for_fc: hardCap != null ? hardCap : r2(fcCap),
            stretch: hardCap != null ? null : stretch,
            pool, target: want,
            candidates_total: cands.length,
          },
          data_source: D.source, chart_count: D.charts.length,
          updated: D.builtAt ? new Date(D.builtAt).toISOString().slice(0, 10) : null,
          note: '実効值：AP＝定數、FC＝定數−1；B30＝前 30 名実効值總和 ÷ 30（分母固定 30，不足 30 張會被稀釋）。'
            + '定數是非官方難易度表（' + D.source + '，AP 基準），「+」計入運算（+＝+0.05、++≈+0.1），'
            + 'const_label 是表上的寫法、const_value 是實際參與計算的數值。'
            + 'suggestions 是把全曲庫 ' + D.charts.length + ' 張譜面都算過、依 b30_gain 由高到低排序的完整結果的前 '
            + Math.min(sLim, cands.length) + ' 名（共 ' + cands.length + ' 個可行目標），不是取樣，也不需要分批再撈。'
            + (hardCap != null
                ? '這次只看定數 ≤ ' + hardCap + ' 的譜面（max_const）。'
                : '預設只推薦定數 ≤ 玩家自己最佳成績 +' + stretch + ' 的譜面（已 FC 的補 AP 不受此限），要看更硬的目標就調大 stretch 或直接給 max_const。')
            + 'jp_only=true 是日服限定曲，台服玩不到（標了一樣計入 B30）；estimated_const=true 是難易度表未收錄、以等級推估的定數。'
            + '成績來自使用者在「B30 產生器」頁的手動勾選（只存這台瀏覽器），沒勾的譜面一律當未達成。'
            + (cands.length ? '' : '這次沒有任何能拉高 B30 的目標：不是已經全 AP，就是上限卡太緊——放寬 stretch／max_const 再問一次。'),
        };
      }

      case 'get_bonus_cards': {
        /* 站上的「加分卡參考」頁(index.html #bonus-cards)只是靜態說明文,逐卡加成其實是
           js/core.js 的 RunStudio._cardBonus 在「跑榜工作室」裡算的。app.html 沒有載
           core.js,所以這裡照同一條規則自己重算一次,不去注入引擎 —— 規則寫在 note 裡。
           資料全部來自台服主資料庫(this.TDB)與站上已有的卡片圖鑑,不需要 core.js。 */
        const CU = ['light_sound', 'idol', 'street', 'theme_park', 'school_refusal', 'piapro'];  // = cards-index.js 的 UNITS 順序
        const CA = ['cool', 'happy', 'mysterious', 'cute', 'pure'];                              // = cards-index.js 的 ATTRS 順序
        const RAR = { 1: 'rarity_1', 2: 'rarity_2', 3: 'rarity_3', 4: 'rarity_4', 9: 'rarity_birthday' };

        // 期數:沒給就用當期;當期資料還沒載到就退回活動清單裡最新一期已開始的
        let evId = a.event_id != null ? +a.event_id : 0;
        if (!evId) { const ck = this.eventClock(); evId = ck ? +ck.id : 0; }
        if (!evId) {
          const l = await this.loadEvList();
          const st = (l || []).filter(e => new Date(e.start_at).getTime() <= Date.now()).sort((x, y) => y.id - x.id);
          evId = st.length ? +st[0].id : 0;
        }
        if (!evId) return { error: '判斷不出目前是第幾期,請直接指定 event_id' };

        // 卡片圖鑑是懶載入的模組,使用者沒進過收集率頁時 state 還是空的 → 自己補載
        await this.loadCards();
        const CARDS = this.state.rateCards || [], CHARAS = this.state.rateChars || [];
        if (!CARDS.length) return { error: '卡片圖鑑載入失敗,算不了加成' };

        if (!this._bonusCache) {
          try {
            const [deck, evCards, rar, gcu] = await Promise.all([
              fetch(this.TDB + '/eventDeckBonuses.json').then(r => r.json()),
              fetch(this.TDB + '/eventCards.json').then(r => r.json()),
              fetch(this.TDB + '/eventRarityBonusRates.json').then(r => r.json()),
              fetch(this.TDB + '/gameCharacterUnits.json').then(r => r.json()),
            ]);
            const g = {}; (gcu || []).forEach(x => { g[x.id] = { cid: x.gameCharacterId, unit: x.unit }; });
            const m = {}; (rar || []).forEach(x => { (m[x.cardRarityType] = m[x.cardRarityType] || {})[x.masterRank] = Math.round(x.bonusRate * 10) / 10; });
            this._bonusCache = { deck: deck || [], evCards: evCards || [], mr: m, gcu: g };
          } catch (e) { return { error: '活動加成資料載入失敗:' + (e.message || '') }; }
        }
        const { deck: DECK, evCards: EVC, mr: MR, gcu: GCU } = this._bonusCache;

        const rows = DECK.filter(x => +x.eventId === evId);
        if (!rows.length) return { error: '主資料庫還沒有第 ' + evId + ' 期的加成設定(未來的期數通常要接近開活動才會下發)' };

        /* World Link 是唯一一種「加成條目完全沒有 cardAttr」的活動型態(主隊不分屬性,
           全角色同一個低倍率),拿這個當判別比猜活動名稱或翻 events.json(1.3MB)可靠。 */
        const attrs = [...new Set(rows.map(x => x.cardAttr).filter(Boolean))];
        const isWL = attrs.length === 0;
        const evAttr = attrs[0] || null;
        const bUnits = [...new Set(rows.filter(x => x.gameCharacterUnitId != null)
          .map(x => (GCU[x.gameCharacterUnitId] || {}).unit).filter(Boolean))];
        const evUnit = bUnits.length === 1 ? bUnits[0] : null;   // 只有一個團 = 箱活;多個團 = 混活

        const unitZh = u => { const k = this.UNIT_OF[CU.indexOf(u)]; return (this.UNITS[k] || {}).n || u; };
        const nameOf = {}; CHARAS.forEach(c => { nameOf[c[0]] = c[1]; });

        const charRate = {};   // 角色 → 該角色能吃到的最高隊伍加成
        rows.forEach(x => {
          const g = x.gameCharacterUnitId != null ? GCU[x.gameCharacterUnitId] : null;
          if (g) charRate[g.cid] = Math.max(charRate[g.cid] || 0, x.bonusRate);
        });
        // 本期實際的三種檔位(直接從資料讀,不寫死 50/25 —— WL 就是 5%)
        const attrOnlyRate = Math.max(0, ...rows.filter(x => x.gameCharacterUnitId == null && x.cardAttr).map(x => x.bonusRate));
        const charAttrRate = Math.max(0, ...rows.filter(x => x.gameCharacterUnitId != null && x.cardAttr).map(x => x.bonusRate));
        const charOnlyRate = Math.max(0, ...rows.filter(x => x.gameCharacterUnitId != null && !x.cardAttr).map(x => x.bonusRate));

        const mrLv = Math.max(0, Math.min(5, a.master_rank == null ? 5 : (a.master_rank | 0)));
        const ecOf = {}; EVC.forEach(x => { if (+x.eventId === evId) ecOf[x.cardId] = x; });

        // c = [id, 角色, 稀有度(1-4,9=生日), 屬性idx, 取得idx, 支援團idx(-1=無), 卡池可得, 卡名, 素材名]
        const calc = c => {
          const cid = c[1], attr = CA[c[3]], sup = c[5] >= 0 ? CU[c[5]] : null;
          let ca = 0, co = 0, ao = 0;   // 同角色+同屬性 / 只同角色 / 只同屬性
          for (const e of rows) {
            if (e.cardAttr && e.cardAttr !== attr) continue;
            if (e.gameCharacterUnitId != null) {
              const g = GCU[e.gameCharacterUnitId];
              if (!g || g.cid !== cid) continue;
              // VS 卡:副團不是「無」時,必須與該條目的團體一致;純 V 卡(無副團)則不受限,所以每個箱活都吃得到
              if (cid >= 21 && sup && g.unit !== sup) continue;
              if (e.cardAttr) ca = Math.max(ca, e.bonusRate); else co = Math.max(co, e.bonusRate);
            } else if (e.cardAttr) ao = Math.max(ao, e.bonusRate);
          }
          const d = Math.max(ca, co, ao);
          const ec = ecOf[c[0]];
          const sp = ec ? (ec.bonusRate || 0) : 0;
          const mrB = (MR[RAR[c[2]]] && MR[RAR[c[2]]][mrLv]) || 0;
          // 70 的特殊加成(BFES 卡)是「取代」隊伍加成而非疊加,其餘一律相加 —— 與 core.js RunStudio._cardBonus 同規則
          const per = sp === 70 ? 70 + mrB : d + sp + mrB;
          return { per: Math.round(per * 10) / 10, d, ca, co, ao, sp, mrB,
                   lead: ec ? (ec.leaderBonusRate || 0) : 0 };
        };

        const lowOK = !!a.include_low_rarity;
        const wantCh = a.chara ? +a.chara : 0;
        const minPct = a.min_percent != null ? +a.min_percent : null;
        let own = null;
        if (a.mine) {
          own = this.ownSet();
          if (!own || !own.size) return { error: '收集率頁還沒勾選任何持有卡片,mine 篩不出東西' };
        }

        const list = [];
        for (const c of CARDS) {
          if (!lowOK && c[2] !== 4 && c[2] !== 9) continue;          // ★1-3 沒人拿來跑榜,預設不列
          if (wantCh && c[1] !== wantCh) continue;
          if (own && !own.has(c[0])) continue;
          const r = calc(c);
          if (r.d <= 0 && r.sp <= 0) continue;                        // 只吃到稀有度加成 = 不算這期的加分卡
          if (minPct != null && r.per < minPct) continue;
          list.push({ c, r });
        }
        list.sort((x, y) => y.r.per - x.r.per || y.c[2] - x.c[2] || y.c[0] - x.c[0]);

        const tiers = {};
        list.forEach(x => { tiers[x.r.per] = (tiers[x.r.per] || 0) + 1; });

        const off = Math.max(0, +a.offset || 0);
        const lim = Math.max(1, Math.min(100, +a.limit || 30));
        const page = list.slice(off, off + lim);

        // 活動的中文名/主推角色/型態:主資料庫沒有,靠站上兩份既有資料補
        // (卡池表 GACHAS 的 ech/et/u 有圈內講法;BORDERS_DB 是歷史表,只到已結束的期數)
        const gk = (this.state.gachas || []).find(x => String(x.eid) === String(evId) && (x.ech || x.et));
        const BDB = (typeof BORDERS_DB !== 'undefined' && BORDERS_DB.events) ? BORDERS_DB.events : null;
        const bd = BDB ? BDB.find(e => +e.id === evId) : null;
        const evl = await this.loadEvList().catch(() => []);
        const ev = (evl || []).find(e => +e.id === evId) || null;

        const why = (c, r) => {
          const p = [];
          if (r.ca) p.push('同角色＋同屬性 +' + r.ca + '%');
          else if (r.co) p.push((isWL ? '本章加成角色' : '同角色但屬性不符') + ' +' + r.co + '%');
          else if (r.ao) p.push('同屬性但角色不在加成名單 +' + r.ao + '%');
          if (r.sp) p.push(r.sp === 70 ? '本期特殊加成 70%(取代隊伍加成,不與上面相加)' : '本期活動卡 +' + r.sp + '%');
          p.push('稀有度＋專精(MR' + mrLv + ') +' + r.mrB + '%');
          if (r.lead) p.push('放隊長位另加 +' + r.lead + '%(未計入上面的數字)');
          return p.join('；');
        };

        return {
          event: {
            // 不拿卡池名當活動名 —— 一期活動常有好幾個池,名字對不上
            id: evId, name: (ev && ev.name) || (bd && bd.name) || null,
            // 兩個「型態」是不同軸,分開給,免得模型混著講:
            // format=賽制(馬拉松/歡樂嘉年華/World Link)、bonus_type=加成結構(箱活/混活)
            format: (bd && bd.type) || (isWL ? 'World Link' : null),
            bonus_type: (gk && gk.et) || (isWL ? 'World Link' : (evUnit ? '箱活' : '混活')),
            lead_chara: (gk && gk.ech) || (bd && bd.chara) || null,
            unit: evUnit ? unitZh(evUnit) : (gk ? (gk.u || null) : null),
            attr: isWL ? '不分屬性' : (evAttr ? this.ATTR_ZH[evAttr] : null),
            is_world_link: isWL,
          },
          bonus_characters: Object.keys(charRate).map(Number).sort((x, y) => x - y).map(cid => ({
            id: cid, name: nameOf[cid] || String(cid), max_deck_bonus_percent: charRate[cid],
          })),
          attr_only_bonus_percent: attrOnlyRate || 0,
          master_rank_assumed: mrLv,
          total_bonus_cards: list.length,
          tier_counts: Object.keys(tiers).map(Number).sort((x, y) => y - x).map(p => ({ percent: p, cards: tiers[p] })),
          offset: off, shown: page.length,
          cards: page.map(({ c, r }) => ({
            card_id: c[0], name: c[7], chara: nameOf[c[1]] || String(c[1]),
            rarity: c[2] === 9 ? '生日' : '★' + c[2],
            attr: this.ATTR_ZH[CA[c[3]]] || CA[c[3]],
            supply: this.SUPPLYN[c[4]] || null,
            support_unit: c[5] >= 0 ? unitZh(CU[c[5]]) : null,
            bonus_percent: r.per,
            breakdown: { deck: r.d, event_card: r.sp, rarity_master: r.mrB },
            matched_by: r.ca ? 'char+attr' : r.co ? 'char' : r.ao ? 'attr' : 'event_card',
            reason: why(c, r),
          })),
          note: '加成％＝隊伍加成＋活動卡特殊加成＋稀有度/專精加成，單位都是百分點，五張卡相加就是隊伍總加成。'
            + '隊伍加成取「符合的條目中最高的一條」，本期的檔位是：'
            + [charAttrRate ? '同角色＋同屬性 ' + charAttrRate + '%' : '',
               charOnlyRate ? (isWL ? '本章加成角色（不分屬性）' : '只同角色、屬性不符') + ' ' + charOnlyRate + '%' : '',
               attrOnlyRate ? '只同屬性、角色不符 ' + attrOnlyRate + '%' : ''].filter(Boolean).join('、')
            + '，三者不疊加。'
            + '稀有度/專精加成每張卡都吃、與符不符合活動無關（★4 為 MR0 10%→MR5 25%，生日卡 5%→15%）。'
            + '本次假設所有卡都是 MR' + mrLv + '，實際專精不同數字會變（可用 master_rank 改）。'
            + (list.length
                ? '這是完整清單依加成由高到低排序的前 ' + page.length + ' 名（共 ' + list.length + ' 張符合），不是取樣，不要用多次小批次去拼湊；'
                : '目前的篩選條件一張都沒選到，放寬 chara／min_percent／mine 再試；')
            + '預設只列 ★4 與生日卡，要 ★1-3 請帶 include_low_rarity。'
            + (isWL ? ' 注意：這是 World Link：這裡算的只有「主隊」加成（全角色一律 ' + charOnlyRate + '%），'
                    + 'WL 真正的大頭是支援隊伍加成（另一套 worldBloomSupportDeckBonuses 規則、依章節主角變動），本工具不涵蓋，'
                    + '要看支援隊請改用站上「跑榜工作室」或 wl_team_advice。' : ''),
        };
      }

      case 'get_dolls': {
        /* 豆森娃資料在 sekai-data.js，是 componentDidMount 裡非同步 import 進來的：
           使用者一進站就問、或那次 import 失敗時 state.dolls 還是空的，
           所以這裡比照 search_tutorial 自己補載一次，否則助手查玩偶永遠回空陣列。
           版本號要跟 componentDidMount 那行一致，才會命中同一份模組快取而不是重抓。 */
        let src = this.state.dolls || [];
        if (!src.length) {
          try {
            const m = await import('./data/sekai-data.js?v=8d2812dda5');
            src = m.DOLLS || [];
            if (src.length) this.setState({ dolls: src, gachas: (this.state.gachas || []).length ? this.state.gachas : (m.GACHAS || []) });
          } catch (e) { return { error: '豆森娃月列表載入失敗' }; }
        }
        if (!src.length) return { error: '豆森娃月列表尚未載入，請稍後再試' };

        /* 站上是台服視角，所以預設走 tw 欄；問日服排程的人才切 jp。
           表上 25 列的日服月份全部恰好比台服早 9 個月（逐列驗過無例外），
           因此表外的月份也能直接用 ±9 換算給出對應月。 */
        const server = String(a.server || 'tw').toLowerCase() === 'jp' ? 'jp' : 'tw';
        const key = server;
        const LAG = 9;
        const norm = t => { const mm = String(t == null ? '' : t).match(/(\d{4})\D?(\d{1,2})/); if (!mm) return null;
          const mo = +mm[2]; if (mo < 1 || mo > 12) return null; return mm[1] + '/' + String(mo).padStart(2, '0'); };
        const shift = (ym, k) => { const p = ym.split('/'); const d = new Date(+p[0], +p[1] - 1 + k, 1);
          return d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0'); };
        const now = new Date();
        const curYm = now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0');
        // 原始資料的 chars 是逗號字串，切成陣列模型才好逐一比對；空字串＝官方尚未公布，不是「沒有玩偶」
        const row = d => ({ tw: d.tw, jp: d.jp, type: d.type, round: d.round,
          characters: d.chars ? d.chars.split(',').map(x => x.trim()).filter(Boolean) : [],
          announced: !!d.chars, is_all_characters: (d.chars || '').indexOf('全員') >= 0 });
        const sorted = src.filter(d => d[key]).slice().sort((x, y) => (x[key] < y[key] ? -1 : 1));
        const span = sorted.length ? [sorted[0][key], sorted[sorted.length - 1][key]] : null;
        const unann = sorted.filter(d => !d.chars).map(d => d[key]);
        const BASE = '月卡每月附贈的 MySekai 玩偶（豆森娃）排程，資料整理：瑞憶春希。'
          + '台服比日服晚 ' + LAG + ' 個月，看日服欄就知道台服接下來輪到誰。'
          + '類型：初始衣裝＝首波全員、CFES＝彩色祭配色、普限＝普通限定配色；'
          + 'round＝輪替輪次，同一輪（約 4 個月）內 26 位角色各出現一次。';

        if (a.character != null && String(a.character).trim() !== '') {
          const t = String(a.character).trim();
          const used = {};
          sorted.forEach(d => (d.chars || '').split(',').forEach(x => { const nm = x.trim();
            if (nm && nm !== '全員') used[nm] = this.CHARA_ID[nm] || null; }));
          /* 表上寫的是給定名（未來寫成「初音」），使用者講的可能是全名或別名，
             所以先用 CHARA_ID 收斂成 characterId 再回推表上用的那個名字，
             最後才退回大小寫／包含比對（「初音未來」「meiko」「朝比奈真冬」都要能問）。 */
          const id = /^\d+$/.test(t) ? +t : this.CHARA_ID[t];
          const names = Object.keys(used);
          let target = Object.prototype.hasOwnProperty.call(used, t) ? t : null;
          if (!target && id) target = names.find(nm => used[nm] === id) || null;
          if (!target) target = names.find(nm => nm.toUpperCase() === t.toUpperCase()) || null;
          if (!target) target = names.find(nm => t.indexOf(nm) >= 0) || null;
          if (!target) return { error: '不認得角色「' + t + '」', hint: '請用繁中角色名：' + names.join('／') };
          // 「全員」那列（初始衣裝）每個人都拿得到，查單一角色時不能漏掉
          const hits = sorted.filter(d => { const c = row(d).characters; return c.indexOf(target) >= 0 || c.indexOf('全員') >= 0; });
          const later = hits.filter(d => d[key] >= curYm);
          return { character: target, character_id: used[target], server, current_month: curYm,
            appearance_count: hits.length, appearances: hits.map(row),
            next: later.length ? row(later[0]) : null, unannounced_months: unann,
            note: BASE + ' 這是該角色在完整排程（' + sorted.length + ' 個月，' + span[0] + '～' + span[1] + '）中的全部出現月份，不是取樣。'
              + (unann.length ? ' ' + unann.join('、') + ' 的角色官方尚未公布，該角色仍可能出現在其中。' : '')
              + ' 「全員」那列是初始衣裝，所有角色都算在內。' };
        }

        if (a.month != null && String(a.month).trim() !== '') {
          const ym = norm(a.month);
          if (!ym) return { error: '看不懂月份「' + a.month + '」，請用 YYYY/MM 格式，例如 2026/08' };
          const hit = sorted.find(d => d[key] === ym);
          // 查不到時把對應的另一服月份一起給出來，模型才不會誤判成「那個月沒有玩偶」
          if (!hit) return { error: ym + '（' + (server === 'tw' ? '台服' : '日服') + '）不在表上',
            available_range: span,
            counterpart: server === 'tw' ? { jp: shift(ym, -LAG) } : { tw: shift(ym, LAG) },
            note: BASE };
          return { server, query_month: ym, current_month: curYm, is_current_month: ym === curYm,
            doll: row(hit),
            note: BASE + (hit.chars ? '' : ' 這個月的角色官方尚未公布。') };
        }

        const lim = Math.max(1, Math.min(25, Math.round(+a.limit) || 12));
        const idx = sorted.findIndex(d => d[key] >= curYm);
        const start = a.include_past ? 0 : (idx < 0 ? sorted.length : idx);
        const list = sorted.slice(start, start + lim);
        const cur = sorted.find(d => d[key] === curYm) || null;
        return { server, current_month: curYm, total_months: sorted.length, range: span,
          current: cur ? row(cur) : null,
          months: list.map(row),
          note: BASE + ' 已回傳' + (a.include_past ? '從表頭' : '從本月') + '起連續 ' + list.length + ' 個月（全表共 '
            + sorted.length + ' 個月，' + span[0] + '～' + span[1] + '），需要更多請調大 limit，要看過去月份用 include_past。'
            + ' characters 為空陣列＝官方尚未公布。'
            + (cur ? '' : ' 本月（' + curYm + '）不在表的涵蓋範圍內。') };
      }

      case 'get_event_stats': {
        /* 榜線資料庫是懶載入的,使用者沒開過榜線／分析頁時 BORDERS_DB 還不存在,
           所以這裡自己補載一次 —— 否則統計永遠回空。 */
        const DB = (typeof BORDERS_DB !== 'undefined') ? BORDERS_DB : null;
        if (!DB) { await this.loadBorderDB(); }
        const D = (typeof BORDERS_DB !== 'undefined') ? BORDERS_DB : null;
        if (!D || !Array.isArray(D.events)) return { error: '活動資料庫載入失敗,無法統計' };

        const GK = { chara: e => e.chara, unit: e => e.unit, attr: e => e.attr,
                     type: e => e.type, year: e => String(e.start).slice(0, 4), none: () => '全部' };
        const g = String(a.group_by || 'chara');
        if (!GK[g]) return { error: 'group_by 只能是 chara / unit / attr / type / year / none' };

        /* 資料裡混了一筆沒有日期的測試活動(id 166「歡樂嘉年華活動測試活動」),
           它會污染平均日數與間隔,所以一律排除,並把排除筆數回報出去。 */
        const all = D.events;
        const dated = all.filter(e => e.start && e.end && e.days != null);

        const dt = v => { const d = this.pd(v); return d ? d.getTime() : NaN; };
        let fromT = null, toT = null;
        if (a.from) { fromT = dt(a.from); if (isNaN(fromT)) return { error: 'from 日期格式要是 YYYY/MM/DD' }; }
        if (a.to)   { toT   = dt(a.to);   if (isNaN(toT))   return { error: 'to 日期格式要是 YYYY/MM/DD' }; }
        const cq = String(a.chara || '');

        const rows = dated.filter(e => {
          if (a.type && e.type !== a.type) return false;
          if (a.unit && e.unit !== a.unit) return false;
          if (a.attr && e.attr !== a.attr) return false;
          // chara 用包含比對,「未來」才抓得到 VBS未來／25未來／WXS未來 這三筆混活
          if (cq && String(e.chara).indexOf(cq) < 0) return false;
          const st = dt(e.start);
          if (fromT != null && st < fromT) return false;
          if (toT != null && st > toT) return false;
          return true;
        }).sort((x, y) => dt(x.start) - dt(y.start));

        const filters = { type: a.type || null, unit: a.unit || null, attr: a.attr || null,
                          chara: a.chara || null, from: a.from || null, to: a.to || null };
        if (!rows.length) return { matched_events: 0, filters_applied: filters,
          error: '沒有符合條件的活動。可用值:type=馬拉松/歡樂嘉年華/World Link,'
            + 'unit=L/N、MMJ、VBS、WXS、25、VS、/(混活),attr=紫/藍/橘/綠/粉/WL全屬性' };

        const DAY = 86400000, now = Date.now();
        const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
        const tally = (list, f) => { const m = {}; list.forEach(e => { const k = f(e); m[k] = (m[k] || 0) + 1; }); return m; };
        /* 「多久出一次」用相鄰兩期「開始日」的平均間隔,等價於 (末期−首期)÷(期數−1)。
           取開始日而不是結束日,才不會被各期活動長度不一影響。 */
        const stat = list => {
          const st = list.map(e => dt(e.start));
          return { count: list.length,
            avg_days: r2(list.reduce((s, e) => s + (+e.days || 0), 0) / list.length),
            first_event: { id: list[0].id, name: list[0].name, start: list[0].start },
            last_event: { id: list[list.length - 1].id, name: list[list.length - 1].name, start: list[list.length - 1].start },
            avg_gap_days: list.length > 1 ? r1((st[st.length - 1] - st[0]) / DAY / (list.length - 1)) : null,
            days_since_last: r1((now - st[st.length - 1]) / DAY) };
        };

        const out = { group_by: g, matched_events: rows.length,
          total_events_in_db: all.length, excluded_no_date: all.length - dated.length,
          filters_applied: filters,
          overall: Object.assign(stat(rows), { by_type: tally(rows, e => e.type),
            by_attr: tally(rows, e => e.attr), by_unit: tally(rows, e => e.unit) }) };

        if (g !== 'none') {
          const m = new Map();
          rows.forEach(e => { const k = GK[g](e); if (!m.has(k)) m.set(k, []); m.get(k).push(e); });
          const groups = [...m.entries()].map(([key, list]) => {
            const o = Object.assign({ key }, stat(list));
            o.share_pct = r1(list.length / rows.length * 100);
            // 分組維度自己的 breakdown 沒有資訊量(全部同一個值),省掉以免回傳肥大
            if (g !== 'type') o.by_type = tally(list, e => e.type);
            if (g !== 'attr') o.by_attr = tally(list, e => e.attr);
            if (g !== 'unit' && g !== 'chara') o.by_unit = tally(list, e => e.unit);
            return o;
          }).sort((x, y) => y.count - x.count || dt(y.last_event.start) - dt(x.last_event.start));
          out.group_count = groups.length;
          out.groups = groups.slice(0, Math.max(1, Math.min(50, +a.limit || 30)));
        }

        if (a.list_events) {
          const cap = Math.max(1, Math.min(60, +a.event_limit || 30));
          out.events = rows.slice(-cap).reverse().map(e => ({ id: e.id, name: e.name, chara: e.chara,
            unit: e.unit, attr: e.attr, type: e.type, start: e.start, end: e.end, days: e.days }));
          out.events_note = rows.length > cap
            ? ('符合條件的共 ' + rows.length + ' 期,這裡只列最近 ' + cap + ' 期(由新到舊)')
            : '全部符合條件的活動,由新到舊';
        }

        out.note = 'days=活動總日數,含結算前 6 小時,所以馬拉松/嘉年華常是 x.25 天(World Link 為整數 12 天)。'
          + 'avg_gap_days=(該組最後一期開始日−第一期開始日)÷(期數−1),即平均多久輪到一次(天);'
          + 'days_since_last=最後一期開始日距今幾天。share_pct=佔篩選後總期數的百分比。'
          + 'unit「/」是混活(無主打團)、「VS」是 VIRTUAL SINGER 主打;'
          + 'World Link 期的 chara 是「World Link」、attr 是「WL全屬性」,不屬於單一角色或屬性;'
          + 'chara「VBS未來/25未來/WXS未來」是初音未來穿各團服裝的混活。'
          + (out.groups ? ('groups 已按期數由多到少完整排序,回的是前 ' + out.groups.length
              + ' 組(共 ' + out.group_count + ' 組),不是取樣。') : '');
        return out;
      }

      case 'get_missing_cards': {
        await this.loadCards();
        const cards = this.state.rateCards || [];
        if (!cards.length) return { error: '卡片索引尚未載入（' + (this.state.rateErr || '請先開啟「收集率」頁') + '）' };
        // loadCards() 只有真的去載卡片那次才會順便 ownLoad()；卡片已在記憶體時要自己補讀，
        // 否則 ownSet() 會憑空給一個空 Set，把「還沒讀持有清單」誤判成「一張都沒有」
        if (!this._own) this.ownLoad();
        const own = this.ownSet();
        const chars = this.state.rateChars || [];
        if (!chars.length) return { error: '角色索引尚未載入，無法判斷團體，請先開啟「收集率」頁' };

        /* cards-index.js 的欄位順序：[id,角色,稀有度(1-4,9=生日),屬性,取得類別,支援團(-1=無),卡池可得,卡名,素材名] */
        const ATTR = ['cool', 'happy', 'mysterious', 'cute', 'pure'];
        const SUPPLY_CODE = ['normal', 'birthday', 'term_limited', 'colorful_festival_limited',
                             'bloom_festival_limited', 'unit_event_limited', 'collaboration_limited'];
        const uOf = {}, fullOf = {};
        chars.forEach(c => { uOf[c[0]] = this.UNIT_OF[c[2]] || 'vs'; fullOf[c[0]] = c[1]; });
        // 有支援團的卡（VS 角色的團體卡）要算進支援團，和收集率頁的統計同一套規則
        const unitOf = c => (c[5] >= 0 ? this.UNIT_OF[c[5]] : uOf[c[1]]) || 'vs';
        const nz = v => String(v == null ? '' : v).trim().toLowerCase();

        /* ---- 參數正規化：同一個團／稀有度使用者會有十種寫法，比對不到就回錯誤而不是靜靜給全部 ---- */
        let unit = null;
        if (nz(a.unit) && nz(a.unit) !== 'all' && nz(a.unit) !== '全部') {
          const q = nz(a.unit).replace(/[\s／/]/g, '');
          const UAL = {
            ln: ['ln', 'leoneed', 'leo/need', '萊歐尼德', '萊歐'],
            mmj: ['mmj', 'moremorejump', 'morejump', '摩摩'],
            vbs: ['vbs', 'vividbadsquad', 'vivid'],
            wxs: ['wxs', 'ws', 'wonderlands', 'wonderlandsxshowtime', 'wonderlands×showtime', 'ワンダショ', 'ワンダーランズ'],
            n25: ['n25', '25', '25時', 'ニーゴ', 'niigo', '25時夜鳴', '25時、ナイトコードで。'],
            vs: ['vs', 'virtualsinger', 'vsinger', '虛擬歌手', '虚拟歌手', '無副團', 'piapro', 'v家']
          };
          unit = Object.keys(this.UNITS).find(k => {
            if (k === q) return true;
            const n = nz((this.UNITS[k] || {}).n).replace(/[\s／/]/g, '');
            if (n === q || (q.length >= 2 && n.indexOf(q) >= 0)) return true;
            return (UAL[k] || []).some(x => nz(x).replace(/[\s／/]/g, '') === q);
          }) || null;
          if (!unit) return { error: '不認得團體「' + a.unit + '」',
            available_units: Object.keys(this.UNITS).map(k => k + '（' + this.UNITS[k].n + '）') };
        }

        let rarity = null;
        if (nz(a.rarity) && nz(a.rarity) !== 'all' && nz(a.rarity) !== '全部') {
          const q = nz(a.rarity).replace(/[★☆*\s]/g, '').replace(/星$/, '');
          const RM = { '1': 1, '一': 1, '2': 2, '二': 2, '3': 3, '三': 3, '4': 4, '四': 4,
                       '9': 9, '生日': 9, '生日卡': 9, '生日限定': 9, 'birthday': 9, 'bd': 9 };
          rarity = RM[q] == null ? null : RM[q];
          if (rarity == null) return { error: '不認得稀有度「' + a.rarity + '」',
            available_rarities: this.RARITY.map(r => r[1]) };
        }

        let supply = null;
        if (nz(a.supply) && nz(a.supply) !== 'all' && nz(a.supply) !== '全部') {
          const q = nz(a.supply);
          let i = this.SUPPLYN.findIndex(nm => nz(nm) === q);
          if (i < 0) i = SUPPLY_CODE.findIndex(cd => cd === q);
          if (i < 0) i = this.SUPPLYN.findIndex(nm => q.length >= 2 && nz(nm).indexOf(q) >= 0);
          if (i < 0) return { error: '不認得取得類別「' + a.supply + '」', available_supplies: this.SUPPLYN.slice() };
          supply = i;
        }

        let charId = null;
        if (a.character != null && String(a.character).trim() !== '') {
          const t = String(a.character).trim();
          if (/^\d+$/.test(t)) charId = +t;
          else {
            if (this.CHARA_ID[t]) charId = this.CHARA_ID[t];
            if (!charId) { const h = chars.find(c => c[1] === t) || chars.find(c => String(c[1]).indexOf(t) >= 0); if (h) charId = h[0]; }
            if (!charId) { const k = Object.keys(this.CHARA_ID).find(n => t.indexOf(n) >= 0); if (k) charId = this.CHARA_ID[k]; }
          }
          if (!charId || !chars.some(c => c[0] === charId)) return { error: '不認得角色「' + t + '」',
            available_characters: chars.map(c => c[1]) };
        }

        let attr = null;
        if (nz(a.attribute) && nz(a.attribute) !== 'all' && nz(a.attribute) !== '全部') {
          const q = nz(a.attribute);
          let i = ATTR.indexOf(q);
          if (i < 0) i = ATTR.findIndex(x => nz(this.ATTR_ZH[x]) === q);
          if (i < 0) return { error: '不認得屬性「' + a.attribute + '」',
            available_attributes: ATTR.map(x => this.ATTR_ZH[x]) };
          attr = i;
        }

        const pool = ['in_gacha', 'not_in_gacha'].indexOf(nz(a.pool_status)) >= 0 ? nz(a.pool_status) : 'all';

        /* ---- 篩選 ---- */
        const hit = cards.filter(c => {
          if (unit && unitOf(c) !== unit) return false;
          if (rarity != null && c[2] !== rarity) return false;
          if (supply != null && c[4] !== supply) return false;
          if (charId != null && c[1] !== charId) return false;
          if (attr != null && c[3] !== attr) return false;
          if (pool === 'in_gacha' && c[6] !== 1) return false;
          if (pool === 'not_in_gacha' && c[6] === 1) return false;
          return true;
        });
        const miss = hit.filter(c => !own.has(c[0]));

        /* ---- 排序：預設稀有度優先，與收集率頁 RARITY 的顯示順序一致（★4→生日→★3→★2→★1） ---- */
        const RPRI = {}; this.RARITY.forEach((r, i) => { RPRI[r[0]] = i; });
        const sort = ['rarity', 'newest', 'oldest', 'character'].indexOf(nz(a.sort)) >= 0 ? nz(a.sort) : 'rarity';
        const pr = c => (RPRI[c[2]] == null ? 99 : RPRI[c[2]]);
        miss.sort((x, y) => {
          if (sort === 'newest') return y[0] - x[0];
          if (sort === 'oldest') return x[0] - y[0];
          if (sort === 'character') return (x[1] - y[1]) || (pr(x) - pr(y)) || (x[0] - y[0]);
          return (pr(x) - pr(y)) || (x[0] - y[0]);
        });

        let lim = a.limit == null ? 20 : Math.round(+a.limit);
        if (!(lim > 0)) lim = 20;                       // 0／負數／NaN 一律當沒給，不要縮成 1 張
        const limit = Math.min(100, lim);
        const offset = Math.max(0, a.offset == null ? 0 : Math.round(+a.offset) || 0);
        const page = miss.slice(offset, offset + limit);

        /* 「現在還抽不抽得到」：cards-index 的卡池旗標是建置時掃 gachas.json 全部卡池歷史算的，
           所以 false 同時涵蓋「活動報酬卡」與「台服還沒開過這張的池」，只能當參考不能當保證 */
        const avail = c => {
          const inG = c[6] === 1;
          if (c[2] === 1) return '★1 初始卡，不是抽的（新手／任務取得）';
          const base = [
            inG ? '常駐池，隨時抽得到' : '標為常駐但台服還沒有卡池收錄過（多半是活動報酬或尚未開池）',
            '生日限定，只在該角色生日期間的生日池',
            '期間限定，只有當期池或之後的復刻池',
            '彩FES 限定，只在 Colorful Festival 池',
            'BLOOM FES 限定，只在 Bloom Festival 池',
            '團體活動限定，只在對應的團體活動池',
            '聯動限定，聯動結束後不一定會再開'
          ][c[4]] || '取得方式不明';
          if (c[4] > 0 && !inG) return base + '（台服目前查不到收錄它的卡池紀錄）';
          return base;
        };
        const row = c => ({
          card_id: c[0],
          card_name: c[7] || '',
          character: fullOf[c[1]] || this.chNameOf(c[1]),
          unit: (this.UNITS[unitOf(c)] || {}).n || unitOf(c),
          rarity: (this.RARITY.find(r => r[0] === c[2]) || [null, '?'])[1],
          attribute: this.ATTR_ZH[ATTR[c[3]]] || String(c[3]),
          supply: this.SUPPLYN[c[4]] || '',
          support_unit: c[5] >= 0 ? ((this.UNITS[this.UNIT_OF[c[5]]] || {}).n || null) : null,
          in_gacha_pool: c[6] === 1,
          availability: avail(c)
        });

        const cnt = (arr, keyf) => { const m = {}; arr.forEach(c => { const k = keyf(c); m[k] = (m[k] || 0) + 1; }); return m; };
        const mR = cnt(miss, c => c[2]), mU = cnt(miss, unitOf);

        /* 三種空結果意義完全不同（條件打不到卡／這塊已收齊／翻過頭了），分開講模型才不會亂解讀 */
        let head;
        if (!hit.length) head = '這個篩選條件下沒有任何卡片，可能是條件組合本身就不存在（例如 ★3 沒有限定卡）。';
        else if (!miss.length) head = '這個條件下的 ' + hit.length + ' 張全都勾了，沒有缺卡。';
        else if (!page.length) head = 'offset ' + offset + ' 已經超過缺卡總數 ' + miss.length + ' 張，請把 offset 調小。';
        else head = 'cards 是套用篩選後、依 sort（預設稀有度 ★4→生日→★3→★2→★1，同稀有度依卡片 id 由小到大）完整排序的第 '
          + (offset + 1) + '～' + (offset + page.length) + ' 張，不是抽樣；符合條件的缺卡共 ' + miss.length
          + ' 張，要看更多請調 limit（上限 100）或 offset 續取，不要重複用小批次拼。';

        return {
          filter: {
            unit: unit ? (this.UNITS[unit] || {}).n : '全部',
            rarity: rarity == null ? '全部' : (this.RARITY.find(r => r[0] === rarity) || [null, '?'])[1],
            character: charId == null ? '全部' : (fullOf[charId] || this.chNameOf(charId)),
            supply: supply == null ? '全部' : this.SUPPLYN[supply],
            attribute: attr == null ? '全部' : this.ATTR_ZH[ATTR[attr]],
            pool_status: pool, sort: sort
          },
          library_total: cards.length,
          owned_total: own.size,
          missing_total: cards.length - own.size,
          matched_total: hit.length,
          matched_owned: hit.length - miss.length,
          matched_missing: miss.length,
          returned: page.length,
          offset: offset,
          has_more: offset + page.length < miss.length,
          missing_by_rarity: this.RARITY.filter(r => mR[r[0]]).map(r => ({ rarity: r[1], missing: mR[r[0]] })),
          missing_by_unit: Object.keys(this.UNITS).filter(k => mU[k]).map(k => ({ unit: this.UNITS[k].n, missing: mU[k] })),
          cards: page.map(row),
          never_checked: own.size === 0,
          note: (own.size === 0
              ? '目前一張都沒勾選，所以「缺卡」等於整本圖鑑。收集率是站上「收集率」頁手動勾選的（存在這台瀏覽器），公開 API 只給隊伍與展示卡，抓不到完整持有清單——回答前先提醒使用者去勾。'
              : '持有清單來自站上「收集率」頁的手動勾選（存在這台瀏覽器），沒勾就等於沒有。')
            + '　' + head
            + '　in_gacha_pool 是建置索引時掃台服 master DB 全部卡池歷史算的：true 代表曾經有卡池收錄過，false 可能是活動報酬卡，也可能只是台服還沒開到收錄它的池（新卡與生日卡常是後者），'
            + '兩者都不代表「現在正開著」——現在開哪些池要看站上「卡池列表」頁。'
            + '　unit 的歸屬優先看卡片的支援團，所以 VS 角色的團體卡會算進該團而不是 VIRTUAL SINGER。'
        };
      }

      case 'get_shop_items': {
        await this.loadBilling();
        const D = (typeof BILLING_DATA !== 'undefined') ? BILLING_DATA : null;
        if (!D || !Array.isArray(D.items) || !D.items.length) {
          return { error: '商城商品資料尚未載入（' + (this.state.billErr || '請稍後再試') + '）' };
        }
        const PULL = 300;
        const incT = a.include_tickets !== false;
        const incM = a.include_materials !== false;
        const MAT_SKIP = { ticket: 1, colorful_pass: 1, colorful_pass_v2: 1, mysekai_colorful_pass: 1, costume: 1 };
        const MAT_MINQ = 10;
        const cKey = c => c[0] + ' ' + c[2];
        let mi = this._billMi;
        if (!mi || mi.built !== D.builtAt) {
          const idx = {};
          D.items.forEach(r => {
            const cs = (r.c || []).concat(r.bc || []);
            if (!r.exch || r.paid || r.free || cs.length !== 1) return;
            const c = cs[0], q = c[1];
            if (!(q > 0) || MAT_SKIP[c[0]] || q < MAT_MINQ) return;
            const per = r.exch / q;
            if (!(per > 0)) return;
            const k = cKey(c);
            if (idx[k] == null || per < idx[k].per) idx[k] = { per, n: c[2] };
          });
          mi = this._billMi = { built: D.builtAt, idx };
        }
        const idx = mi.idx;
        const passJ = r => {
          let s = 0;
          (r.c || []).forEach(c => {
            if (c[0] === 'colorful_pass' && c[3] != null) s += (D.passes.v1Daily[c[3]] || 0) * ((D.passes.v1[0] || {}).expireDays || 30);
            if (c[0] === 'colorful_pass_v2' && c[3] != null) {
              const t = (D.passes.v2 || []).find(p => p.id === c[3]) || {};
              s += (D.passes.v2Daily[c[3]] || 0) * (t.expireDays || 30);
            }
          });
          return s;
        };
        const matJ = r => {
          if (!incM) return 0;
          const acc = {};
          (r.c || []).concat(r.bc || []).forEach(c => {
            const h = idx[cKey(c)];
            if (!h || !(c[1] > 0)) return;
            acc[cKey(c)] = (acc[cKey(c)] || 0) + c[1] * h.per;
          });
          return Object.keys(acc).reduce((s, k) => s + acc[k], 0);
        };
        /* 官網商店有幾筆的品項說明寫成「免費水晶*420」(星號),build-billing.py 的
           抓取正則只認 ×/x,水晶數會落在 web_item 文字裡沒被計數 —— 不撈回來的話
           這幾筆 CP 會變成 0,看起來像是最爛的商品。 */
        const webJ = r => {
          if (r.src !== 'web' || r.paid || r.free) return 0;
          let s = 0;
          (r.c || []).forEach(c => {
            if (c[0] !== 'web_item') return;
            const m = String(c[2]).match(/水晶\s*[*x×]\s*([\d,]+)/);
            if (m) s += +m[1].replace(/,/g, '') || 0;
          });
          return s;
        };
        const pullJ = r => r.paid + r.free + webJ(r) + passJ(r) + (incT ? r.pulls * PULL : 0);
        const NOW = Date.now();
        const onSale = r => (!r.s || r.s <= NOW) && (!r.e || r.e >= NOW);
        let base = 0;
        D.items.forEach(r => {
          if (!r.src && r.t === 'jewel' && r.lim.t === 'unlimited' && r.pk && onSale(r)) base = Math.max(base, (r.paid + r.free) / r.price);
        });
        base = base || 3.9;
        const CAT = r => (r.t === 'jewel' ? 'jewel' : r.t === 'value_set' ? 'set' : r.t === 'costume_3d' ? 'costume' : 'pass');
        const limTxt = r => {
          const L = r.lim || {};
          if (L.t === 'unlimited' || L.v == null || L.v < 0) return '不限購';
          const c = L.v + ' 次';
          if (L.r === 'day') return '每日 ' + c;
          if (L.r === 'weekly') return '每週 ' + c;
          if (L.r === 'monthly') return '每月 ' + c;
          if (L.t === 'user_rank') return '新手限定 ' + c;
          return '總共限購 ' + c;
        };
        const cat = String(a.category || 'all');
        const src = String(a.source || 'all');
        const avail = String(a.availability || 'on_sale');
        const q = String(a.q || '').trim().toLowerCase();
        const wantUnknown = a.include_unknown_price === true;
        let list = D.items.filter(r => {
          if (cat !== 'all' && CAT(r) !== cat) return false;
          if (src === 'app' && r.src) return false;
          if (src === 'web' && r.src !== 'web') return false;
          if (avail === 'on_sale' && !onSale(r)) return false;
          if (avail === 'upcoming' && !(r.s && r.s > NOW)) return false;
          if (avail === 'ended' && !(r.e && r.e < NOW)) return false;
          if (q) {
            if (r._q == null) r._q = (r.n + ' ' + r.d + ' ' + r.tab + ' ' + r.lab + ' ' + (r.c || []).concat(r.bc || []).map(c => c[2]).join(' ')).toLowerCase();
            if (!r._q.includes(q)) return false;
          }
          return true;
        });
        const unknownN = list.filter(r => !r.pk || !(r.price > 0)).length;
        if (!wantUnknown) list = list.filter(r => r.pk && r.price > 0);
        const rows = list.map(r => {
          const pj = pullJ(r), mj = matJ(r), tj = pj + mj;
          const price = (r.pk && r.price > 0) ? r.price : null;
          return { r, price, pj, mj, tj, rate: price ? tj / price : null };
        });
        const sort = String(a.sort || 'cp');
        const SORTF = {
          cp: (x, y) => (y.rate || -1) - (x.rate || -1),
          price_asc: (x, y) => (x.price == null ? 1e9 : x.price) - (y.price == null ? 1e9 : y.price),
          price_desc: (x, y) => (y.price || 0) - (x.price || 0),
          jewels: (x, y) => y.tj - x.tj,
          ending_soon: (x, y) => (x.r.e || 8e15) - (y.r.e || 8e15),
        };
        rows.sort(SORTF[sort] || SORTF.cp);
        const total = rows.length;
        if (!total) return { total: 0, items: [], note: '沒有符合條件的商品；可放寬 availability（改 "all" 含已結束/未開賣）或改用關鍵字搜尋。' };
        const lim = Math.max(1, Math.min(60, +a.limit || 15));
        const off = Math.max(0, +a.offset || 0);
        const fd = ms => { const d = new Date(ms); return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate(); };
        return {
          currency: 'TWD（新台幣，商店標價）',
          data_built_at: D.builtAt ? new Date(D.builtAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : null,
          web_shop_url: 'https://gamepay.ariel.com.tw/topup/5245',
          total, offset: off, sorted_by: sort,
          baseline_jewels_per_twd: +base.toFixed(2),
          filters_applied: { q: q || null, category: cat, source: src, availability: avail,
            tickets_counted: incT, materials_counted: incM },
          unknown_price_count: unknownN,
          material_price_index: Object.keys(idx).map(k => idx[k].n + ' ' + (+idx[k].per.toFixed(3)) + ' 石/個'),
          items: rows.slice(off, off + lim).map(x => {
            const r = x.r;
            return {
              id: r.id, name: r.n, category: CAT(r), type: r.t,
              source: r.src === 'web' ? '官網商店(GamePay/MyCard・信用卡)' : 'App 內商店(iOS/Android 同價)',
              tab: [r.tabP, r.tab].filter((v, i, arr) => v && arr.indexOf(v) === i).join('／') || null,
              label: r.lab || null,
              price_twd: x.price, price_known: !!(r.pk && r.price > 0),
              paid_jewels: r.paid, free_jewels: r.free + webJ(r),
              gacha_pulls_from_tickets: r.pulls || 0,
              pass_claimable_jewels: passJ(r) || 0,
              jewels_for_gacha: Math.round(x.pj),
              material_value_jewels: Math.round(x.mj),
              total_value_jewels: Math.round(x.tj),
              jewels_per_twd: x.rate == null ? null : +x.rate.toFixed(2),
              vs_baseline_pct: x.rate == null ? null : Math.round((x.rate / base - 1) * 100),
              buy_with_paid_jewels: r.exch || null,
              purchase_limit: limTxt(r),
              on_sale_now: onSale(r),
              starts: r.s ? fd(r.s) : null,
              ends: r.e && r.e - NOW < 3650 * 86400000 ? fd(r.e) : null,
              days_left: r.e && r.e > NOW && r.e - NOW < 3650 * 86400000 ? Math.ceil((r.e - NOW) / 86400000) : null,
              web_same_as_app_item_id: r.ref || null,
              contents: [r.paid ? '有償水晶×' + this.n(r.paid) : null,
                (r.free + webJ(r)) ? '無償水晶×' + this.n(r.free + webJ(r)) : null]
                .concat((r.c || []).concat(r.bc || [])
                  .filter(c => !(webJ(r) && c[0] === 'web_item' && /水晶\s*[*x×]\s*[\d,]+/.test(c[2])))
                  .map(c => c[2] + (c[0] === 'web_item' || c[0] === 'costume' ? '' : '×' + this.n(c[1]))))
                .filter(Boolean).slice(0, 10),
            };
          }),
          note: '這是全部 ' + D.items.length + ' 項商品經上述篩選後、依 ' + sort + ' 完整排序的第 '
            + (off + 1) + '～' + Math.min(off + lim, total) + ' 名（共 ' + total + ' 項符合），不是取樣，不要用多次小批次拼湊。'
            + ' jewels_per_twd（CP 值）＝ total_value_jewels ÷ price_twd；'
            + 'total_value_jewels ＝ 有償水晶＋無償水晶＋通行證每日領取合計'
            + (incT ? '＋招募票券以 300 石/抽折算' : '（票券未折算）')
            + (incM ? '＋道具以商店價折算（單價見 material_price_index，取自「只裝單一道具的有償水晶包」，同道具多檔取最低價；心願碎片等道具不能拿去抽卡，只算價值不算抽數）' : '（道具未折算）')
            + '。基準 ' + base.toFixed(2) + ' 石/元＝App 內商店常駐不限購水晶包的最佳值，vs_baseline_pct 就是跟它的差距，>0 代表比買常駐大包划算。'
            + ' unknown_price_count 是被排除的「master 只有 9999 佔位價」商品（多為月卡/新手包，實售價只在商店顯示）；'
            + '要看它們請帶 include_unknown_price:true，price_twd 會是 null，須請使用者到商店確認售價。'
            + ' 官網商店少數商品的水晶數是從品項說明文字撈回來的（原始資料寫成「免費水晶*420」漏抓），已併入 free_jewels。'
            + ' 演出服裝（costume）多數是用有償水晶兌換（buy_with_paid_jewels），沒有台幣標價、CP 值算不出來；'
            + '服裝部件本身一律不折算成石，所以含服裝的商品 total_value_jewels 只算得到裡面的水晶，會偏低，別直接拿去跟水晶包比。'
            + ' 官網商店的「兌換券版」與 App 版是同一件商品的兩個通路（web_same_as_app_item_id 指向 App 版），比價時別當成兩件。',
        };
      }

      case 'get_site_map': {
        /* 站上真正的功能顆粒度在「子分頁」這一層 —— calc 有 8 個 ctab、analysis 有 4 個
           anaTab、rank 有 5 個 rankTab、collect 2 個、admin 5 個,全部寫死在 renderVals 的
           模板裡,沒有任何一份清單。PAGES 只描述到「頁」,search_anything 也只搜得到頁,
           所以使用者問「效率排行在哪」時,助手答得出「計算中心」卻答不出「計算中心裡的
           效率排行分頁」,更接不上該呼叫哪支工具 —— 於是它只能描述功能,不能算給人看。
           這張表補的就是那一層。頁名與一句話說明仍然向 PAGES 取、沒有工具的工具清單向
           AI_TOOLS 取,不在這裡再寫一份,免得改了那邊卻忘了改這裡。
           欄位:[頁 key, 導覽群組, 存取條件(''=公開), [該頁層級的工具], [子分頁…], 備註]
           子分頁:[子分頁 id, 顯示名稱, 在做什麼, [對應工具](空陣列=助手沒有對應工具)] */
        const MAP = [
          ['home', '主頁', '', ['get_current_event', 'get_my_status', 'get_borders'], [],
            '當期活動 hero、我的進度與近期卡池;綁定 uid 後這裡就是個人儀表板。'],
          ['calendar', '資料', '', ['get_gacha_schedule', 'get_upcoming_events'], [],
            '月曆格子,點某天看當日開放中的活動與卡池(台服預測時間)。'],
          ['gacha', '資料', '', ['get_gacha_schedule'], [],
            '台服預測卡池 235 筆(資料到 2027/6),可依類型／PU 角色／是否進行中篩選。'],
          ['songs', '資料', '', ['get_songs', 'search_anything'], [],
            '完整樂曲資料庫(台服 613 首＋日服未實裝曲,標 jp),列表／方格兩種檢視,含 BPM、歌長、note 數與播放器。'],
          ['cardlib', '資料', '', ['get_card_skills'], [],
            '逐張卡的技能敘述與各等級數值,直接讀官方 master 的 skills.json。'],
          ['dolls', '資料', '', [], [], '豆森娃(MySekai 玩偶)月列表與輪替。'],
          ['lives', '資料', '', [], [], '歷代虛擬 Live:類型、期間、每場時間、歌單與出演角色。'],
          ['news', '資料', '', [], [], '台服遊戲內公告一覽,依類型(活動／招募／樂曲／更新…)篩選與搜尋,連到官方公告頁。'],
          ['story', '資料', '', [], [], '劇情閱讀器:活動／主線／卡片／區域對話／個人／特別劇情的台服翻譯文本,逐句附語音、背景與字幕。'],
          ['cards', '圖鑑', '', [], [], '卡片圖鑑:台服全部卡片依團體／角色／屬性／稀有度／來源篩選與排序,詳情有滿等數值、特訓加成、技能敘述(Lv1／Lv4)、釋出日、招募台詞。'],
          ['chars', '圖鑑', '', [], [], '26 位角色的檔案(聲優、生日、身高、學校、喜好、介紹)與相關卡片。'],
          ['fixtures', '圖鑑', '', [], [], 'MySekai 家具圖鑑:主／子分類與角色標籤篩選,尺寸、顏色與製作素材。'],
          ['mstalk', '圖鑑', '', [], [], 'MySekai 角色對話清單:每則對話的角色與解鎖條件(家具／劇情／天氣／來訪次數),可勾選已看過,家具檢視列出還缺的家具與製作素材。'],
          ['materials', '圖鑑', '', [], [], '養成素材與 MySekai 素材一覽,含說明。'],
          ['comics', '圖鑑', '', [], [], '遊戲內小提示的一格漫畫(台服翻譯版),可放大與開啟原圖。'],
          ['ost', '圖鑑', '', [], [], '遊戲內 BGM(區域、劇情、Live、卡池…)站內直接播放。'],
          ['guesswho', '遊戲', '', [], [], '猜角色:看一小塊卡面猜是誰,十題一局,可選難度／團體／稀有度／限時。'],
          ['guessjacket', '遊戲', '', [], [], '猜封面:看一小塊曲繪猜歌名,十題一局,可選難度／團體／選項數／限時。'],
          ['stickers', '工具', '', [], [], '貼圖製作器:官方貼圖或上傳的圖加上文字(大小、位置、旋轉、描邊、字型),匯出 PNG 或複製。'],
          ['rank', '追蹤', '', [], [
            ['live', '即時排名', '前 100 名即時分數與 1h 均速;點某人開「排名詳情」看逐局紀錄', ['get_top100', 'get_player_games']],
            ['border', '分段榜線', 'T100～T10萬 各段位目前分數與預測終線', ['get_borders']],
            ['wl', 'WL 個榜', 'World Link 各章節個人榜與配隊規則(只有 WL 活動期間才出現這個分頁)', ['get_wl_status', 'wl_team_advice']],
            ['past', '歷代活動', '任選一期看該期最終前百與各段榜線(含歷代 WL 章節榜)', ['get_history_borders']],
            ['trend', '榜線趨勢', '最近 N 期(預設 12)各段位榜線並排比較,標示相對前期增減', ['get_history_borders']],
          ], '逐局紀錄每 15 秒採樣,只有前 100 名有。'],
          ['analysis', '追蹤', '', [], [
            ['border', '榜線分析', '各段位預測終線:實測時速外推、線性外推與同型態歷史加權', ['get_borders']],
            ['player', '玩家分析', '單一玩家節奏剖析:瞬時／1h 均速、加速或降速、推估休息時數、預測終分與名次', ['analyze_player']],
            ['active', '活躍分析', '此刻誰在跑、誰停了,依近 1 小時時速把全榜排序', ['get_top100']],
            ['history', '生涯紀錄', '輸入 uid 逐期掃描過去的前百紀錄,交叉比對以往名次', []],
          ], ''],
          ['borderdb', '追蹤', '', [], [
            ['bdb', '歷期榜線交叉篩選', '依活動型態／日數／團體／屬性／角色複選篩選歷期榜線,可切換依期數或依分數排行', ['get_history_borders']],
            ['ex', 'WL 交換所規劃', 'World Link 各屆各章的交換所票券規劃表', []],
          ], '資料源自 good果汁 的台服全榜線紀錄。'],
          ['lookup', '追蹤', '', ['get_player_profile', 'get_player_games'], [],
            '用遊戲 ID 查任一玩家的公開資料:名片、隊伍綜合力與編組。'],
          ['distrib', '追蹤', '', [], [], '歷屆活動的時間分布甘特圖,看各團／各角色的排期密度。'],
          ['calc', '工具', '', [], [
            ['ep', 'EP 精算', '單場 Live 拿多少活動P,以及每體力／每分／每小時效率;附火倍率對照表', ['calc_event_points']],
            ['eff', '效率排行', '在指定模式／難度／隊伍條件下把全曲庫排序,三種排法:eph 每小時活動P、ep 單局活動P、score 單局分數', ['song_efficiency']],
            ['plan', '活動試算', '從目標 EP 反推還要打幾場、幾小時、幾體力、幾顆石、約多少台幣', ['plan_target']],
            ['mult', '推隊倍率', '由隊長%與四位隊員%算出平均技能倍率(隊長全額、隊員總和除以 5)', ['calc_skill_multiplier']],
            ['gacha', '抽卡天井', '期望抽數、天井、招募點數保底、現有水晶在預算內至少中 1 張的機率', ['gacha_odds']],
            ['mysekai', 'MySekai', '烤森採集每點體力拿多少活動P(橘體×5／藍體×1)與各採集物換算', ['mysekai_calc']],
            ['rank', '排位賽', '判定分對戰的勝負判定與段位點數(RP)增減、升降段', ['rank_match']],
            ['ctrl', '控分速查', '反推「還差多少分才跨過下一階活動P」的方案,用在結算前的最後微調', []],
          ], '八個分頁共用同一組隊伍設定(綜合力／加成／技能倍率／火數),換分頁不用重填。'],
          ['deckpro', '工具', '', [], [],
            'iframe 內嵌的完整引擎(index.html?embed=calc):綜合力精算(逐道具算 area item、角色等級、豆森門＋娃)、組卡優化器、分數估算、跑榜工作室。'],
          ['gachasim', '工具', '', [], [],
            'iframe 內嵌(index.html?embed=gachasim),依官方機率模型模擬抽卡,可選期數與卡池、單抽／十連含保底。要「算機率」而不是「模擬」請改用 gacha_odds。'],
          ['shop', '工具', '', [], [],
            'iframe 內嵌(index.html?embed=shop):商城 930+ 項商品的內容物與台幣定價、CP 值排行、月卡通行證攤提、依預算算最省錢購買組合。'],
          ['b30', '工具', '', [], [],
            'iframe 內嵌(index.html?embed=b30):勾選 FC/AP 譜面產生 Best 30 実効值圖卡,可下載 PNG。'],
          ['tut', '學習', '', ['search_tutorial'], [],
            '115 則問答,分類含養成、車隊、衝榜與音遊練習;問玩法與名詞時先查這裡。'],
          ['collect', '更多', '', [], [
            ['stamp', '貼圖', '貼圖圖鑑與取得條件(官方素材)', []],
            ['honor', '稱號', '稱號圖鑑與取得條件', []],
          ], '純圖鑑瀏覽;要「收集進度百分比」是 rate 頁的 get_collection_rate。'],
          ['rate', '更多', '', ['get_collection_rate', 'get_my_cards'], [],
            '卡片圖鑑逐張勾選持有,即時算出各團與各稀有度的收集率,可用代碼匯出匯入。'],
          ['bonuscards', '更多', '', [], [],
            '各活動的加成卡一覽與組合建議(團分／普限輪／書下／Banner 主角色卡)。'],
          ['res', '更多', '', [], [],
            '外部連結索引,六類:官方資源、資訊站、討論社群、Wiki 百科、社群資料表(good果汁的榜線／控分／交換所表)、本站工具。'],
          ['credits', '更多', '', [], [], '共同作者、合作夥伴與感謝名單。'],
          ['whatsnew', '更多', '', ['search_anything'], [],
            '本站功能一覽與快速前往(CHANGELOG 22 則),下方是系統更新記錄(SYSLOG 101 則)。'],
          ['account', '帳號', '登入後才有雲端同步', ['set_my_uid', 'list_my_watches'], [],
            '綁定遊戲 ID、雲端同步設定、管理偵測訂閱與通知,以及備份匯出／匯入。'],
          ['notices', '帳號', '需登入', ['list_my_watches', 'create_watch'], [],
            '偵測訂閱觸發時的站內通知列表。'],
          ['assistant', '帳號', '需登入', [], [],
            '就是你自己(站內助手)。使用者在這一頁問話,你去查站上的資料回答。'],
          ['admin', '帳號', '需管理員', ['schedule_task'], [
            ['overview', '總覽', '站台整體統計與新使用者／AI 呼叫／通知事件趨勢圖', []],
            ['users', '使用者', '使用者審核與名單', []],
            ['watches', '訂閱', '全站偵測訂閱清單', []],
            ['ai', 'AI 稽核', '助手呼叫紀錄稽核', []],
            ['health', '系統健康', '後端與資料來源健康檢查', []],
          ], '一般使用者連入口都不會出現;schedule_task 同樣要管理員權限。'],
        ];

        const P = this.PAGES || {};
        if (!Object.keys(P).length) return { error: '頁面清單(PAGES)尚未初始化,無法產生站台地圖' };

        /* 圈內用語對照。ALIASES 第三欄寫的就是「所在頁面」,格式像 'calc（ctab=eff）／gachasim';
           先用全形／半形斜線切開再剝掉括號才能精準比對 —— 直接用 includes 會把
           'gachasim' 誤判成 'gacha' 的別名。 */
        const aliasOf = key => (this.ALIASES || []).filter(row =>
          String(row[2] || '').split(/[／\/]/).some(seg =>
            seg.replace(/[（(][^）)]*[）)]/g, '').trim() === key)
        ).slice(0, 12).map(row => ({
          name: row[0], tool: row[1] || null,
          aliases: String(row[3] || '').split('|').slice(0, 6),
        }));

        const wantPage = String(a.page || '').trim();
        const wantTool = String(a.tool || '').trim();
        const q = String(a.q || '').trim().toLowerCase();
        /* 全站列表已經夠長了,別名只在「問到某一頁／某個詞」時才附上。 */
        const withAlias = a.include_aliases != null ? !!a.include_aliases : !!(wantPage || q || wantTool);

        const me = this.state.me;
        const wlOn = (() => { try { return this.isWL(); } catch (e) { return false; } })();

        const build = row => {
          const [key, group, access, tools, subs, note] = row;
          const meta = P[key] || [key, ''];
          const all = tools.slice();
          subs.forEach(sb => sb[3].forEach(t => { if (all.indexOf(t) < 0) all.push(t); }));
          const o = {
            page: key, name: meta[0], desc: meta[1],
            nav_group: group, url: '?page=' + key, tools: all,
            subtabs: subs.map(sb => {
              const t = { id: sb[0], name: sb[1], does: sb[2], tools: sb[3] };
              if (key === 'rank' && sb[0] === 'wl') t.visible_now = wlOn;
              return t;
            }),
          };
          if (access) {
            o.access = access;
            /* me === undefined 代表還沒問過後端,不能當成「未登入」講死。 */
            if (me !== undefined) o.you_can_access = access === '需管理員' ? !!(me && me.is_admin) : !!me;
          }
          if (note) o.note = note;
          if (withAlias) { const al = aliasOf(key); if (al.length) o.player_terms = al; }
          return o;
        };

        let rows = MAP;
        if (wantPage) {
          rows = MAP.filter(r => r[0] === wantPage);
          if (!rows.length) return { error: '沒有這一頁:' + wantPage + '。可用的頁 key:' + MAP.map(r => r[0]).join('、') };
        } else if (wantTool) {
          rows = MAP.filter(r => r[3].indexOf(wantTool) >= 0 || r[4].some(sb => sb[3].indexOf(wantTool) >= 0));
          if (!rows.length) return { tool: wantTool, found: 0,
            note: '這支工具在站上沒有對應的頁面或分頁 —— 它只存在於助手,使用者在網站 UI 上找不到同樣的東西。' };
        } else if (q) {
          const hit = t => String(t || '').toLowerCase().includes(q);
          rows = MAP.filter(r => {
            const meta = P[r[0]] || [];
            return hit(r[0]) || hit(meta[0]) || hit(meta[1]) || hit(r[5]) || r[3].some(hit)
              || r[4].some(sb => hit(sb[0]) || hit(sb[1]) || hit(sb[2]) || sb[3].some(hit))
              || aliasOf(r[0]).some(x => hit(x.name) || x.aliases.some(hit));
          });
        }

        /* 反查索引:工具 → 站上哪一頁哪個分頁。使用者問「這個數字站上哪裡看得到」時用。 */
        const index = {};
        MAP.forEach(r => {
          r[3].forEach(t => { if (!index[t]) index[t] = r[0]; });
          r[4].forEach(sb => sb[3].forEach(t => { if (!index[t]) index[t] = r[0] + '（' + sb[0] + '＝' + sb[1] + '）'; }));
        });
        /* 哪些工具在 UI 上沒有對應位置,直接跟 AI_TOOLS 對帳算出來 ——
           以後加新工具忘了更新這張表,這裡會自己把它列出來,不會默默漏掉。 */
        const orphan = (this.AI_TOOLS || []).map(t => t.name).filter(n2 => !index[n2]);

        const narrowed = !!(wantPage || wantTool || q);
        return {
          site: 'Project SEKAI 台服資源站（project-sekai-center）',
          page_count: MAP.length,
          returned: rows.length,
          scope: wantPage ? ('單頁：' + wantPage) : wantTool ? ('反查工具：' + wantTool)
            : q ? ('關鍵字：' + a.q) : '全站',
          pages: rows.map(build),
          tool_to_place: narrowed ? undefined : index,
          tools_without_page: narrowed ? undefined : orphan,
          note: '這是站台完整的功能地圖（全部 ' + MAP.length + ' 頁與其下所有子分頁），不是取樣或前幾筆。'
            + 'subtabs 的 tools 有值時，不要只描述功能 —— 直接呼叫那支工具把結果算給使用者看，'
            + '再順帶告訴他這功能在「哪一頁的哪個分頁」；tools 是空陣列代表助手算不了，'
            + '要請使用者自己去那一頁操作。切頁靠側邊選單（nav_group 就是它在選單裡的分組），'
            + 'url 的 ?page=xxx 可直接開該頁；子分頁是進頁之後上方那排膠囊按鈕，網址無法直接指定。',
        };
      }

      case 'query_border_db': {
        /* 為什麼另開一支而不是擴充 get_history_borders:舊那支只吃 type/days/unit,
           而榜線資料庫頁(page 'borderdb')真正的能力是「五維度交叉 + 指定段位 + 依分數排行 + 統計」。
           使用者問「時長 8.25 天的 WXS 箱活 T1000 排行」時,舊工具給不出排行也給不出段位,
           模型只能把全表撈回來自己算,又慢又常算錯。這支直接對齊那一頁的邏輯。 */
        await this.loadBorderDB().catch(() => {});
        const D = (typeof BORDERS_DB !== 'undefined') ? BORDERS_DB : null;
        if (!D) return { error: '榜線資料庫載入失敗，請稍後再試' };

        /* 一般活動走 borders(22 個段位),World Link 章節走 wl(21 個段位,沒有 T1500/T2500 但多 T7000)。
           兩份的段位表不同,所以 tier 一定要對各自的 tiers 查索引,不能寫死。 */
        const isWL = String(a.dataset || 'event') === 'wl';
        const all = isWL ? (D.wl || []) : (D.borders || []);
        const tiers = isWL ? (D.wlTiers || []) : (D.tiers || []);
        if (!all.length) return { error: isWL ? '這份資料沒有 World Link 章節榜線' : '榜線總表是空的' };
        const tier = (a.tier == null || a.tier === '') ? 100 : +a.tier;
        const ti = tiers.indexOf(tier);
        if (ti < 0) return { error: 'T' + tier + ' 不是這份資料有的段位，可用段位：' + tiers.map(t => 'T' + t).join('、') };

        /* 屬性只有活動一覽(events)有,榜線總表沒這欄,得靠期數對回去 —— 榜線頁也是這樣做的。
           WL 章節的 id 是 "112.1" 這種,整數部分才是母活動期數,拿來補起訖日期。 */
        const evOf = {};
        (D.events || []).forEach(e => { evOf[e.id] = e; });
        const rows0 = all.map(r => {
          const ev = evOf[isWL ? Math.floor(parseFloat(r.id)) : r.id] || {};
          return Object.assign({}, r, {
            attr: isWL ? '' : (r.attr || ev.attr || ''),
            chara: isWL ? (r.name || r.chara || '') : (r.chara || ev.chara || ''),
            start: ev.start || '', end: ev.end || '',
          });
        });

        // 每個維度都允許複選,同維度內任一符合即算(和榜線頁的 chips 行為一致);傳單一值也吃
        const arr = v => (v == null || v === '') ? []
          : (Array.isArray(v) ? v : [v]).map(x => String(x).trim()).filter(Boolean);
        const fType = arr(a.type), fUnit = arr(a.unit), fDays = arr(a.days), fAttr = arr(a.attr),
              fChara = arr(a.chara), fRound = arr(a.round), fCh = arr(a.chapter), fIds = arr(a.ids);
        const anyOf = (list, v) => !list.length || list.indexOf(String(v == null ? '' : v)) >= 0;
        const chOf = r => String(r.id).split('.')[1] || '';
        const hit = rows0.filter(r =>
          anyOf(fType, r.type) && anyOf(fUnit, r.unit) && anyOf(fDays, r.days)
          && anyOf(fAttr, r.attr) && anyOf(fChara, r.chara)
          && anyOf(fRound, r.round) && anyOf(fCh, chOf(r))
          // ids 給 "112" 時,WL 的 112.1~112.6 全算命中(使用者講的是那一期)
          && (!fIds.length || fIds.indexOf(String(r.id)) >= 0
              || fIds.indexOf(String(Math.floor(parseFloat(r.id)))) >= 0));

        const uniq = k => [...new Set(rows0.map(r => r[k]).filter(v => v !== '' && v != null))]
          .sort((x, y) => (typeof x === 'number' && typeof y === 'number') ? x - y : String(x).localeCompare(String(y)));
        /* 篩空時把該資料集實際存在的值一起回去,模型才有辦法自己修正用詞,
           而不是回一個空陣列讓它以為「這個組合歷史上沒發生過」。 */
        if (!hit.length) {
          return { error: '沒有符合條件的期數，請改用 available 裡實際存在的值重問',
            hint: isWL ? 'World Link 章節線沒有 type／attr 這兩個維度，用它們篩一定是空的' : undefined,
            filters: { type: fType, unit: fUnit, days: fDays, attr: fAttr, chara: fChara, round: fRound, chapter: fCh, ids: fIds },
            available: { type: isWL ? [] : uniq('type'), unit: uniq('unit'), days: uniq('days'),
              attr: isWL ? [] : uniq('attr'), chara: uniq('chara'), round: isWL ? uniq('round') : [] } };
        }

        const val = r => { const v = (r.t || [])[ti]; return (v == null || v === '') ? null : +v; };
        const scored = hit.map(val).filter(v => v != null);
        const asc = scored.slice().sort((x, y) => x - y);
        const mid = asc.length ? (asc.length % 2 ? asc[(asc.length - 1) / 2]
          : Math.round((asc[asc.length / 2 - 1] + asc[asc.length / 2]) / 2)) : null;
        const pick = v => { const r = hit.find(x => val(x) === v); return r ? { id: r.id, name: r.name, score: v } : null; };

        const mode = a.sort === 'score' ? 'score' : a.sort === 'score_asc' ? 'score_asc' : 'id';
        const sorted = hit.slice().sort((x, y) => {
          if (mode === 'id') return parseFloat(y.id) - parseFloat(x.id);
          const vx = val(x), vy = val(y);
          /* T1500/T2500 是後期才開始記錄的(175 期裡有 107 期是 null)。
             把 null 當 0 會讓它們霸佔「最低」那一頭,所以一律沉底。 */
          if (vx == null && vy == null) return parseFloat(y.id) - parseFloat(x.id);
          if (vx == null) return 1;
          if (vy == null) return -1;
          return mode === 'score' ? (vy - vx) : (vx - vy);
        });
        const off = Math.max(0, Math.floor(+a.offset || 0));
        const lim = Math.min(60, Math.max(1, Math.floor(+a.limit || 20)));
        const page = sorted.slice(off, off + lim);

        return {
          dataset: isWL ? 'wl' : 'event',
          tier: 'T' + tier,
          tier_meaning: '活動結束時第 ' + this.n(tier) + ' 名的最終活動分數（PT）',
          matched_count: hit.length,
          scored_count: scored.length,
          stats: {
            avg: scored.length ? Math.round(scored.reduce((s2, v) => s2 + v, 0) / scored.length) : null,
            median: mid,
            max: scored.length ? pick(Math.max.apply(null, scored)) : null,
            min: scored.length ? pick(Math.min.apply(null, scored)) : null },
          sort: mode, offset: off, returned: page.length, has_more: sorted.length > off + page.length,
          filters: { type: fType, unit: fUnit, days: fDays, attr: fAttr, chara: fChara, round: fRound, chapter: fCh, ids: fIds },
          events: page.map((r, i) => ({
            rank: mode === 'id' ? null : (off + i + 1),
            id: r.id, name: r.name,
            type: isWL ? 'World Link 章節' : (r.type || null),
            round: r.round || null, chapter: isWL ? (+chOf(r) || null) : null,
            unit: r.unit || null, chara: r.chara || null, attr: r.attr || null,
            days: r.days == null ? null : r.days,
            start: r.start || null, end: r.end || null,
            wl_bonus: r.bonus == null ? null : r.bonus,
            score: val(r),
          })),
          available_tiers: tiers,
          note: '分數單位是活動分數（PT），1W = 10,000。stats 的平均／中位數／最高／最低是用全部 '
            + hit.length + ' 期符合條件的資料算的，不受 limit 影響；events 是完整排序後的第 '
            + (off + 1) + '～' + (off + page.length) + ' 名，不是抽樣，要更多請加 offset。'
            + (scored.length < hit.length ? ' 其中 ' + (hit.length - scored.length)
                + ' 期在 T' + tier + ' 沒有紀錄（score: null，早期沒記到這個段位），已排除在 stats 外並排到最後。' : '')
            + (isWL ? ' days 是該章節本身的天數（WL 每章 2～3 天），wl_bonus 是該屆的章節加成倍率。' : ''),
        };
      }

      case 'score_control': {
        /* 控分速查：演算法與計算中心「控分速查」分頁（renderVals 裡 s.ctab === 'ctrl' 的區塊）
           完全相同、逐行照搬 —— 畫面顯示的方案與這支工具的回答必須是同一組答案，
           否則使用者會拿到兩種說法。任何「順手優化」都會破壞這件事。
           控分之所以成立：活動P 的 base 是無條件捨去的，分數落在同一個 20,000 級距內活動P 一樣，
           所以真正要回答的問題是「每局把分數打到哪個區間」而不是「打到幾分」。 */
        if (a.target_points == null) return { error: '請給 target_points（目標活動P），例如 2850000' };
        if (a.current_points == null) return { error: '請給 current_points（目前活動P），例如 2847300' };
        const s = this.state;
        const now = Math.max(0, +a.current_points || 0), goal = Math.max(0, +a.target_points || 0);
        // 加成省略就沿用計算中心的共用設定，跟站上那頁的預設行為一致
        const bo = a.bonus != null ? (+a.bonus || 0) : (+s.bonus || 0);
        const D = goal - now;                      // 還差多少活動P
        const step = 20000;                        // 單人場每 20,000 分 base +1
        const MAX_D = 10000;                       // 控分是最後微調用的，差額超過一萬就不是控分了
        // 單局活動P ＝ ⌊base × (1+加成)⌋ × 火倍率；base ＝ 100 + ⌊歌曲分數/20000⌋。
        // 分數打得出來才算數：單人場滿分實務上約 260 萬。
        const MAX_SCORE = 2600000, MIN_BASE = 100;
        const MAX_BASE = MIN_BASE + Math.floor(MAX_SCORE / step);
        const ENERGY = [0, 1, 2, 3, 5, 7, 10];
        const k = 1 + bo / 100;
        const scoreOf = base => ({ s1: (base - MIN_BASE) * step, s2: (base - MIN_BASE + 1) * step - 1 });

        // 先把「一段」能打出的所有活動P 列成表：一段 ＝ 同一配置(火 f、每局 base)打 n 局。
        // 之後兩段組合只要查表，不必再巢狀枚舉。
        const segs = [];                       // {f,m,n,base,per,val}
        const byVal = new Map();               // 活動P → 最省體力的那一段
        if (D > 0 && D <= MAX_D) {
          for (const f of ENERGY) {
            const m = this.EM[f] || 1;
            for (let base = MIN_BASE; base <= MAX_BASE; base++) {
              const per = Math.floor(base * k) * m;      // 這個配置每局的活動P
              if (per <= 0 || per > D) continue;
              for (let n = 1; n <= 8; n++) {
                const val = per * n;
                if (val > D) break;
                const seg = { f, m, n, base, per, val, energy: f * n };
                segs.push(seg);
                const old = byVal.get(val);
                if (!old || seg.energy < old.energy) byVal.set(val, seg);
              }
            }
          }
        }
        // 單段：一次到位
        const plans = [];
        const one = byVal.get(D);
        if (one) plans.push({ segs: [one], energy: one.energy, n: one.n });
        // 兩段：主體 ＋ 尾巴。加成湊不出整除時，混搭不同火倍率往往就有解。
        if (D > 0 && D <= MAX_D) {
          const seen = new Set();
          for (const x of segs) {
            const rest = D - x.val;
            if (rest <= 0) continue;
            const b2 = byVal.get(rest);
            if (!b2) continue;
            const key = [x.f, x.n, x.base, b2.f, b2.n, b2.base].join('|');
            const key2 = [b2.f, b2.n, b2.base, x.f, x.n, x.base].join('|');
            if (seen.has(key) || seen.has(key2)) continue;
            seen.add(key);
            plans.push({ segs: [x, b2], energy: x.energy + b2.energy, n: x.n + b2.n });
            if (plans.length > 400) break;
          }
        }
        plans.sort((x, y) => (x.energy - y.energy) || (x.n - y.n) || (x.segs.length - y.segs.length));
        // 湊不出來時掃鄰近加成（加成可用換卡微調）
        const alts = [];
        if (D > 0 && D <= MAX_D && !plans.length) {
          for (let db = 1; db <= 80 && alts.length < 6; db++) {
            for (const cand of [bo - db * 0.5, bo + db * 0.5]) {
              if (cand < 0 || alts.some(x => x.bonus === cand)) continue;
              const kk = 1 + cand / 100;
              let hit = null;
              for (const f of ENERGY) {
                const m = this.EM[f] || 1;
                for (let base = MIN_BASE; base <= MAX_BASE && !hit; base++) {
                  const per = Math.floor(base * kk) * m;
                  if (per <= 0 || per > D) continue;
                  for (let n = 1; n <= 8; n++) {
                    if (per * n === D) { hit = { f, n, base, per, energy: f * n }; break; }
                    if (per * n > D) break;
                  }
                }
                if (hit) break;
              }
              if (hit) alts.push(Object.assign({ bonus: cand }, hit, scoreOf(hit.base)));
            }
          }
        }

        // 站上只顯示前 12 個方案，預設也回 12 筆 → 兩邊看到的內容一致
        const limit = Math.max(1, Math.min(40, a.limit != null ? Math.round(+a.limit || 0) || 12 : 12));
        const status = D > MAX_D ? 'over_range' : D > 0 ? (plans.length ? 'ok' : (alts.length ? 'need_bonus_change' : 'no_solution'))
          : D === 0 ? 'already_reached' : 'exceeded';
        return {
          current_points: now, target_points: goal, bonus_pct: bo,
          bonus_from: a.bonus != null ? '呼叫時指定' : '計算中心的共用設定',
          diff_points: D,                       // 還差多少活動P（負數＝已經超過目標）
          status,
          over_range: D > MAX_D, max_diff_points: MAX_D,
          plan_count: plans.length,
          plans: plans.slice(0, limit).map((pl, i) => ({
            rank: i + 1,
            total_energy: pl.energy,            // 總耗體力（火數總和），排序主鍵
            total_games: pl.n,                  // 總局數
            segment_count: pl.segs.length,
            segments: pl.segs.map(x => {
              const r = scoreOf(x.base);
              return {
                boost_energy: x.f,              // 這一段每局吃幾火（0＝不用火）
                boost_multiplier: x.m,          // 對應火倍率
                games: x.n,                     // 這一段打幾局
                score_min: r.s1, score_max: r.s2, // 每局分數要落在這個區間（含端點）
                ep_per_game: x.per,             // 這一段單局活動P
                ep_subtotal: x.val,             // 這一段小計活動P
                energy_cost: x.energy,          // 這一段耗體力 ＝ 火數 × 局數
              };
            }),
          })),
          alt_bonus_plans: alts.map(x => ({
            bonus_pct: x.bonus,                 // 換成這個加成就能剛好命中
            boost_energy: x.f, games: x.n,
            score_min: x.s1, score_max: x.s2,
            ep_per_game: x.per, energy_cost: x.energy,
          })),
          note: '單局活動P ＝ ⌊(100 ＋ ⌊歌曲分數 / 20,000⌋) × (1 ＋ 加成/100)⌋ × 火倍率（單人場）。'
            + '分數只要落在該段的 score_min ～ score_max 之間，活動P 就固定是 ep_per_game，不必打到精準分數。'
            + 'plans 依 total_energy（總耗體力）由少到多排序，同體力再比總局數；'
            + '每段最多 8 局、分數上限以單人場實務滿分 260 萬為界。'
            + (status === 'over_range' ? '　差額超過 ' + MAX_D + ' P，這時照平常打就好 —— 控分是為了最後精準收尾。'
              : status === 'already_reached' ? '　已經剛好等於目標。'
              : status === 'exceeded' ? '　目前活動P 已超過目標 ' + (-D) + ' P。'
              : status === 'need_bonus_change' ? '　這個差額用目前加成湊不出剛好的數字，alt_bonus_plans 是最接近、且能精準命中的加成（加成可用換卡微調）。'
              : status === 'no_solution' ? '　這個差額用目前加成湊不出來，鄰近加成也沒有解；可考慮改動目標或先打一局再重算。'
              : '　可以分段：不同火倍率混搭常常比單一配置更容易湊到剛好。')
            + '　控分表原始資料（独りんぼエンヴィー／蝦・單人 0 體）：good果汁 改良、原作 SYLVIA0x0。',
        };
      }

      case 'search_collection': {
        await this.loadCollect();
        // loadCollect 碰到「別處正在載入中」會直接 return，此時 state 還是空的；
        // 不等一下就判定失敗會誤報，所以這裡輪詢等它填好
        for (let i = 0; i < 25 && !(this.state.stamps || []).length && !(this.state.honors || []).length; i++) await new Promise(r => setTimeout(r, 100));
        const stamps = this.state.stamps || [], honors = this.state.honors || [];
        if (!stamps.length && !honors.length) return { error: '收集室資料尚未載入（' + (this.state.colErr || '請稍後再試') + '）' };

        const KMAP = { stamp: 'stamp', stamps: 'stamp', '貼圖': 'stamp', honor: 'honor', honors: 'honor', '稱號': 'honor' };
        const kind = KMAP[String(a.kind || '').trim().toLowerCase()] || 'both';
        const RMAP = { low: 'low', middle: 'middle', high: 'high', highest: 'highest', '低': 'low', '中': 'middle', '高': 'high', '最高': 'highest' };
        const RZH = { low: '低階', middle: '中階', high: '高階', highest: '最高階' };
        let rarity = null;
        if (a.rarity != null && String(a.rarity).trim() !== '') {
          rarity = RMAP[String(a.rarity).trim().toLowerCase()];
          if (!rarity) return { error: '不認得稀有度「' + a.rarity + '」', hint: '稀有度只有 low / middle / high / highest（也可寫 低／中／高／最高）' };
        }

        // 貼圖有 characterId1 可直接比對；稱號沒有角色欄位，只能從名稱／群組／取得敘述裡找角色名
        let charId = null, charName = '';
        if (a.character != null && String(a.character).trim() !== '') {
          const t = String(a.character).trim();
          charId = /^\d+$/.test(t) ? +t : this.CHARA_ID[t];
          if (!charId) return { error: '不認得角色「' + t + '」', hint: '請用繁中角色名，例如 一歌／咲希／穗波／志步／實乃理／遙／愛莉／雫／心羽／杏／彰人／冬彌／司／笑夢／寧寧／類／奏／真冬／繪名／瑞希／未來／鈴／連／流歌／MEIKO／KAITO' };
          charName = this.chNameOf(charId);
        }

        const q = String(a.q || '').trim().toLowerCase();
        const gq = String(a.group || '').trim().toLowerCase();
        const hay = x => ((x.name || '') + ' ' + (x.group || '') + ' ' + (x.desc || '')).toLowerCase();
        // 名稱命中的排前面，其餘照 id；讓模型第一頁就拿到最相關的，不必翻頁湊
        const rank = (x, y) => ((q && (x.name || '').toLowerCase().includes(q) ? 0 : 1) - (q && (y.name || '').toLowerCase().includes(q) ? 0 : 1)) || (x.id - y.id);
        // group 是稱號專屬欄位（活動名／粉絲系列等），有指定就不要回貼圖
        const wantS = kind !== 'honor' && !gq, wantH = kind !== 'stamp';

        const sHit = !wantS ? [] : stamps.filter(x => {
          if (q && !hay(x).includes(q)) return false;
          // 有些貼圖沒有 characterId，退而用貼圖名開頭的角色名比對
          if (charId && !(x.cid === charId || (!x.cid && charName && (x.name || '').includes(charName)))) return false;
          return true;
        }).sort(rank);
        const hHit = !wantH ? [] : honors.filter(x => {
          if (q && !hay(x).includes(q)) return false;
          if (rarity && x.rarity !== rarity) return false;
          if (gq && !(x.group || '').toLowerCase().includes(gq)) return false;
          if (charId && !hay(x).includes(charName.toLowerCase())) return false;
          return true;
        }).sort(rank);

        const lim = Math.max(1, Math.min(60, +a.limit || 20));
        const off = Math.max(0, +a.offset || 0);
        let ls = wantS ? (wantH ? Math.ceil(lim / 2) : lim) : 0;
        let lh = wantH ? (wantS ? lim - ls : lim) : 0;
        // 兩邊都要時，一邊沒吃滿的配額讓給另一邊，免得單邊結果被無謂腰斬
        if (wantS && wantH) {
          const avS = Math.max(0, sHit.length - off), avH = Math.max(0, hHit.length - off);
          if (avS < ls) lh = Math.min(avH, lh + (ls - avS));
          else if (avH < lh) ls = Math.min(avS, ls + (lh - avH));
        }

        const out = {
          query: { kind, q: a.q || null, character: charName || null, rarity, group: a.group || null, limit: lim, offset: off },
          library_total: { stamps: stamps.length, honors: honors.length },
          matched: { stamps: wantS ? sHit.length : null, honors: wantH ? hHit.length : null }
        };
        if (wantS) out.stamps = sHit.slice(off, off + ls).map(x => ({
          id: x.id, name: x.name,
          character: x.cid ? this.chNameOf(x.cid) : null,
          how_to_get: x.desc || '（官方資料沒寫取得方式）',
          image: this.ASSET + '/stamp/' + x.abn + '/' + x.abn + '.webp'
        }));
        if (wantH) out.honors = hHit.slice(off, off + lh).map(x => ({
          id: x.id, name: x.name,
          rarity: x.rarity || null, rarity_zh: RZH[x.rarity] || null,
          group: x.group || null, levels: x.lvCount,
          how_to_get: x.desc || '（官方資料沒寫取得條件）',
          image: this.ASSET + '/honor/' + x.abn + '/degree_main.webp'
        }));
        const shown = (out.stamps || []).length + (out.honors || []).length;
        if (!shown) {
          out.note = '沒有符合條件的項目。q 是對「名稱＋群組＋取得敘述」做子字串比對，可換活動名、角色名或條件關鍵字再試（實測有效的例如「TOP100」「BIRTHDAY」「登入」「商店」；注意稱號敘述用的是「BIRTHDAY」而不是「生日」）。'
            + (kind !== 'both' ? '也可以把 kind 改成 both 一起找貼圖與稱號。' : '');
          return out;
        }
        out.note = '圖鑑共收錄貼圖 ' + stamps.length + ' 張、稱號 ' + honors.length + ' 種（只收 CDN 實際有圖的；稱號依圖檔去重，同名不同級只留一筆，所以會比遊戲內總數少）。'
          + '上面是符合條件的完整排序結果的前 ' + shown + ' 筆（名稱命中優先，其餘依 id），不是抽樣；要更多請把 limit 調大或用 offset 翻頁，不要用多次小批次拼湊。'
          + ' how_to_get 就是官方資料寫的取得條件，可以直接轉述給使用者；稱號的 levels 大於 1 代表該稱號有多個等級，how_to_get 是最高等級的條件。'
          + ' 稀有度由低到高為 low / middle / high / highest。image 是可直接顯示的圖片網址。';
        return out;
      }

      case 'shop_recommend': {
        // 儲值商品是懶載入的靜態檔(只有「儲值分析」頁會掛),AI 這邊得自己掛一次;
        // 沒載到要回 error,不能讓後面拿空陣列去解、算出一個「不用花錢」的假方案。
        if (typeof BILLING_DATA === 'undefined') {
          await new Promise(res => {
            const s = document.createElement('script');
            s.src = 'data/billing.js?v=770d45726e';   // CI 每 30~90 分鐘重建,vercel.json 已設 must-revalidate,不帶版本參數
            s.onload = res; s.onerror = res;
            document.head.appendChild(s);
          });
        }
        const D = (typeof BILLING_DATA !== 'undefined') ? BILLING_DATA : null;
        if (!D || !Array.isArray(D.items) || D.items.length < 100) {
          return { error: '儲值商品資料載入失敗,請稍後再試一次' };
        }

        const PULL = 300;   // 單抽 300 水晶
        // 使用者在「儲值分析」頁填過的售價 / 勾過的「已買過」跟這裡同源共用 localStorage,
        // 不讀的話會把他早就買過的一次性特惠又排進方案。
        let priceOv = {}, owned = {};
        try { priceOv = JSON.parse(localStorage.getItem('sekai-shop-price-ov') || '{}') || {}; } catch (e) {}
        try { owned = JSON.parse(localStorage.getItem('sekai-shop-owned') || '{}') || {}; } catch (e) {}

        const now = Date.now();
        const onSale = r => (!r.s || r.s <= now) && (!r.e || r.e >= now);
        const isLimited = r => !!(r.e && (r.e - now) < 200 * 86400000) || !!r.lab;
        const catOf = r => r.t === 'jewel' ? 'jewel' : r.t === 'value_set' ? 'set' : r.t === 'costume_3d' ? 'costume' : 'pass';
        const CAT_NAME = { jewel: '水晶包', set: '優惠組合', pass: '通行證', costume: '裝扮' };
        // master 對未公開價的商品塞佔位價(pk=false),照用會算出一堆 NT$9999 的假方案;
        // 只有使用者自填過售價才把它當可買。
        const priceOf = r => { const ov = +priceOv[r.id]; if (!r.pk && ov > 0) return ov; return r.pk ? r.price : null; };
        // 通行證的無償石是「每日領」分天入帳,要攤完整個效期才算得出它真正的石/元
        const passJ = r => {
          let sum = 0;
          (r.c || []).forEach(c => {
            if (c[0] === 'colorful_pass' && c[3] != null) sum += (D.passes.v1Daily[c[3]] || 0) * ((D.passes.v1[0] || {}).expireDays || 30);
            if (c[0] === 'colorful_pass_v2' && c[3] != null) {
              const t = (D.passes.v2 || []).find(p => p.id === c[3]) || {};
              sum += (D.passes.v2Daily[c[3]] || 0) * (t.expireDays || 30);
            }
          });
          return sum;
        };
        const incTicket = a.include_tickets !== false;
        // 計價貨幣只認「真的能拿去抽卡的石」:心願碎片這類道具不能抽卡,
        // 算進目標會讓方案宣稱湊到 300 抽卻抽不了,所以道具只列為附帶收穫。
        const pullJ = r => r.paid + r.free + passJ(r) + (incTicket ? r.pulls * PULL : 0);
        const limTxt = r => {
          const L = r.lim;
          if (L.t === 'unlimited' || L.v == null || L.v < 0) return '不限購';
          const n = L.v + ' 次';
          if (L.r === 'day') return '每日 ' + n;
          if (L.r === 'weekly') return '每週 ' + n;
          if (L.r === 'monthly') return '每月 ' + n;
          if (L.t === 'user_rank') return '新手限定 ' + n;
          return '限購 ' + n;
        };
        // 基準線:App 常駐不限購水晶包的最佳石/元(官網包另計,才顯得出官網多送多少)
        let base = 0;
        D.items.forEach(r => { if (!r.src && r.t === 'jewel' && r.lim.t === 'unlimited' && r.pk && onSale(r)) base = Math.max(base, (r.paid + r.free) / r.price); });
        base = base || 3.9;

        const incLimited = a.include_limited !== false;
        const horizon30 = a.horizon_30d === true;
        const cands = [];
        D.items.forEach(r => {
          if (!onSale(r) || r.exch) return;          // exch = 用有償水晶兌換(裝扮),不是花錢買的
          if (owned[r.id]) return;
          if (!incLimited && isLimited(r)) return;
          const p = priceOf(r); if (!(p > 0)) return;
          const j = pullJ(r); if (j <= 0) return;
          const L = r.lim;
          let max = Infinity;
          if (!(L.t === 'unlimited' || L.v == null || L.v < 0)) {
            max = L.v;
            if (horizon30) { if (L.r === 'day') max *= 30; else if (L.r === 'weekly') max *= 4; }
          }
          // 通行證/月卡最多算 1 份:每日領取與資格不會疊加
          if (catOf(r) === 'pass') max = Math.min(max, 1);
          cands.push({ r, p, j, max, rate: j / p });
        });
        if (!cands.length) return { error: '目前沒有任何可計算的商品(可能都被篩選條件排除了)' };

        // 有限背包(最少花費達到 ≥ 目標石):二進位拆包把「同商品買 k 個」變成 0/1 物品,
        // 再分層保留 dp 快照回溯出到底選了哪幾包。granularity 隨目標放大,避免大目標時陣列爆掉。
        const dpMin = (cs, targetJ) => {
          const G = targetJ > 120000 ? 50 : 10, N = Math.max(1, Math.ceil(targetJ / G)), S = N + 1;
          const L = [];
          cs.forEach((c, ci) => {
            let k = Math.min(c.max, Math.ceil(targetJ / c.j) + 1);
            let m = 1;
            while (k > 0) {
              const t = Math.min(m, k);
              const ju = Math.floor(c.j * t / G);
              if (ju > 0) L.push({ ci, cnt: t, cost: c.p * t, ju: Math.min(N, ju) });
              k -= t; m *= 2;
            }
          });
          let dp = new Float64Array(S).fill(Infinity); dp[0] = 0;
          const layers = [];
          for (let bi = 0; bi < L.length; bi++) {
            const b = L[bi], par = new Int32Array(S).fill(-1);
            for (let s = S - 1; s >= 0; s--) {
              if (dp[s] === Infinity) continue;
              const ns = Math.min(N, s + b.ju), nc = dp[s] + b.cost;
              if (nc < dp[ns] - 1e-7) { dp[ns] = nc; par[ns] = s; }
            }
            layers.push({ par, val: dp.slice() });
          }
          // 目標可能因限購上限根本達不到:退而求其次取可達的最高水位
          let goal = N;
          if (dp[N] === Infinity) { goal = -1; for (let s = N; s >= 0; s--) if (dp[s] < Infinity) { goal = s; break; } }
          if (goal <= 0) return { ok: false, cost: 0, counts: {}, gotJ: 0, reached: false };
          const counts = {};
          let s = goal;
          for (let bi = L.length - 1; bi >= 0; bi--) {
            const prev = bi > 0 ? layers[bi - 1].val : null;
            const pv = prev ? prev[s] : (s === 0 ? 0 : Infinity);
            if (layers[bi].val[s] < pv - 1e-7) {   // 這層值比上一層小 = 有選這包
              const b = L[bi];
              counts[b.ci] = (counts[b.ci] || 0) + b.cnt;
              s = layers[bi].par[s];
              if (s < 0) break;
            }
          }
          let cost = 0, gotJ = 0;
          Object.keys(counts).forEach(ci => { const c = cs[ci]; cost += c.p * counts[ci]; gotJ += c.j * counts[ci]; });
          return { ok: true, cost, counts, gotJ, reached: goal === N && dp[N] < Infinity };
        };
        // 預算模式沒有直接解:二分搜尋「花得起的最高目標石」,每一輪跑一次背包
        const bestUnder = (cs, budget) => {
          const bestRate = Math.max(...cs.map(c => c.rate));
          let lo = 0, hi = Math.ceil(budget * bestRate * 1.05) + 3000, best = null;
          for (let it = 0; it < 18 && lo <= hi; it++) {
            const mid = Math.floor((lo + hi) / 2 / 10) * 10;
            if (mid <= 0) break;
            const r = dpMin(cs, mid);
            if (r.ok && r.reached && r.cost <= budget) { best = r; lo = mid + 10; } else hi = mid - 10;
          }
          return best;
        };

        // ---- 解析目標 ----
        const held = Math.max(0, Math.round(+a.held_crystals || 0));
        let warning = null, wantPulls = null, wantJ = null;
        if (+a.target_pulls > 0) {
          wantPulls = Math.round(+a.target_pulls); wantJ = wantPulls * PULL;
          if (+a.target_crystals > 0 && Math.round(+a.target_crystals) !== wantJ) {
            warning = 'target_pulls 與 target_crystals 同時給了且互相矛盾,已採用 target_pulls(' + wantPulls + ' 抽 = ' + wantJ + ' 石)';
          }
        } else if (+a.target_crystals > 0) {
          wantJ = Math.round(+a.target_crystals); wantPulls = Math.floor(wantJ / PULL);
        } else {
          return { error: 'target_pulls 或 target_crystals 至少要給一個(擇一即可):想抽幾抽,或想要幾顆水晶' };
        }
        const budget = +a.budget > 0 ? Math.min(Math.round(+a.budget), 500000) : null;
        // 背包 DP 的狀態數跟目標成正比,60 萬石(2000 抽)以上是前端跑不動的量級,先砍掉並記下來,
        // 否則後面會拿被砍過的目標去宣稱「已達標」。
        const CAP_J = 600000;
        const capped = (wantJ - held) > CAP_J;
        const needJ = Math.max(0, Math.min(wantJ - held, CAP_J));
        if (needJ <= 0) {
          return { ok: true, reached_target: true, need_to_pay: false,
            target: { pulls: wantPulls, crystals: wantJ, held_crystals: held },
            note: '持有水晶 ' + held + ' 顆已經達到目標 ' + wantJ + ' 顆(' + wantPulls + ' 抽),不需要儲值。' };
        }

        const res = dpMin(cands, needJ);
        if (!res.ok || !Object.keys(res.counts).length) {
          return { error: '在目前的限購/篩選條件下湊不出任何方案,試試 horizon_30d:true(納入每日/每週會重置的限購)或 include_limited:true' };
        }

        // 預算不夠就改算「預算內最多能拿多少」,並且要講清楚差多少 —— 不能回一個湊不到目標的組合當答案
        let use = res, withinBudget = false;
        if (budget != null && res.cost > budget) {
          const alt = bestUnder(cands, budget);
          if (!alt || !Object.keys(alt.counts).length) {
            return { ok: true, reached_target: false, reason: 'budget_too_low',
              target: { pulls: wantPulls, crystals: wantJ, held_crystals: held, crystals_needed: needJ },
              budget_ntd: budget,
              min_cost_to_reach_target_ntd: res.cost,
              shortfall_ntd: res.cost - budget,
              note: '預算 NT$' + budget + ' 連最便宜的一個檔位都買不到(現有最便宜可算商品的單價已超過預算)。達成 ' + wantPulls + ' 抽最少要 NT$' + res.cost + ',還差 NT$' + (res.cost - budget) + '。' };
          }
          use = alt; withinBudget = true;
        }

        const rows = Object.keys(use.counts).map(ci => ({ c: cands[ci], n: use.counts[ci] }))
          .sort((x, y) => y.c.rate - x.c.rate);
        const gotJ = use.gotJ, cost = use.cost;
        const pulls = Math.floor(gotJ / PULL);
        const totalPulls = Math.floor((gotJ + held) / PULL);
        const bag = {};
        const plan = rows.map(x => {
          const r = x.c.r;
          // 附帶道具:票券與通行證資格已經在水晶欄位折算過,再列一次會被誤讀成雙倍
          const extras = (r.c || []).concat(r.bc || [])
            .filter(c => c[0] !== 'ticket' && c[0] !== 'colorful_pass' && c[0] !== 'colorful_pass_v2' && c[0] !== 'mysekai_colorful_pass')
            .map(c => { (bag[c[2]] = (bag[c[2]] || 0) + c[1] * x.n); return c[2] + (c[1] > 1 ? '×' + c[1] : ''); });
          return {
            name: r.n,
            category: CAT_NAME[catOf(r)],
            channel: r.src === 'web' ? '官方網頁商店(GamePay,MyCard/信用卡)' : 'App 內商店',
            unit_price_ntd: x.c.p,
            qty: x.n,
            subtotal_ntd: x.c.p * x.n,
            crystals_each: x.c.j,
            crystals_subtotal: x.c.j * x.n,
            crystals_per_ntd: +x.c.rate.toFixed(2),
            paid_crystals_each: r.paid, free_crystals_each: r.free,
            daily_claim_crystals_each: passJ(r) || undefined,
            gacha_tickets_each: r.pulls || undefined,
            purchase_limit: limTxt(r),
            price_source: r.pk ? 'master 官方定價' : '使用者自填售價',
            ends_in_days: r.e ? Math.max(0, Math.ceil((r.e - now) / 86400000)) : undefined,
            extras: extras.length ? extras.slice(0, 6) : undefined,
          };
        });
        const bonusItems = Object.keys(bag).map(k => k + '×' + bag[k]).slice(0, 10);
        const baseCost = Math.round(gotJ / base);
        const notes = [
          '演算法:以「每項商品在自己的限購上限內買 0~N 個」做有限背包 DP(二進位拆包),解出達到目標水晶數的最低總花費——不是貪心挑 CP 最高的包,所以會出現大包配小包補尾數。',
          '計價只算「能拿去抽卡的石」= 有償水晶 + 無償水晶 + 通行證每日領取總額' + (incTicket ? ' + 招募票券×300 石/抽' : '(票券未折算)') + ';心願碎片等道具不能抽卡,只列在 bonus_items 當附帶收穫。',
          '每抽平均成本 = 總價 ÷ 換算抽數;石/元 = 總水晶 ÷ 總價。基準線 ' + base.toFixed(2) + ' 石/元是 App 常駐不限購水晶包的最佳值。',
          '通行證的水晶分 14~30 天陸續入帳(每日領取),今天就要抽完的話那部分要當之後的存量。',
        ];
        if (rows.some(x => x.c.r.pulls) && incTicket) notes.push('方案含招募票券:票券抽卡通常不累積天井貼紙,正在集 300 抽天井的話票券抽數不能算進去。');
        if (rows.some(x => x.c.r.src === 'web')) notes.push('標示官方網頁商店的商品要到 gamepay.ariel.com.tw 買(付款完水晶直接進遊戲帳號),同檔位比 App 多送免費水晶。');
        if (!horizon30 && rows.some(x => ['day', 'weekly', 'monthly'].indexOf(x.c.r.lim.r) >= 0)) notes.push('方案裡有會重置的限購商品,想看整個月能吃到多少優惠請帶 horizon_30d:true 重算。');
        // 佔位價商品往往才是全店 CP 最高的(月卡/月度禮包),不講的話使用者不知道方案可能還能更便宜
        const missing = D.items.filter(r => onSale(r) && !r.exch && !r.pk && !(+priceOv[r.id] > 0) && pullJ(r) > 0);
        const out = {
          ok: true,
          reached_target: !withinBudget && use.reached && !capped,
          target: { pulls: wantPulls, crystals: wantJ, held_crystals: held, crystals_to_buy: needJ },
          budget_ntd: budget,
          plan,
          total_ntd: cost,
          total_crystals: gotJ,
          pulls_from_plan: pulls,
          pulls_including_held: totalPulls,
          cost_per_pull_ntd: +(cost / Math.max(1, pulls)).toFixed(1),
          crystals_per_ntd: +(gotJ / cost).toFixed(2),
          baseline_crystals_per_ntd: +base.toFixed(2),
          same_crystals_at_baseline_ntd: baseCost,
          saving_vs_baseline_ntd: baseCost - cost,
          saving_vs_baseline_pct: baseCost ? Math.round((baseCost - cost) / baseCost * 100) : 0,
          bonus_items: bonusItems.length ? bonusItems : undefined,
          data_built_at: D.builtAt ? new Date(D.builtAt).toISOString() : undefined,
          settings: { include_limited: incLimited, include_tickets: incTicket, horizon_30d: horizon30,
            excluded_owned_items: Object.keys(owned).length },
          note: notes.join(' '),
        };
        if (warning) out.warning = warning;
        if (withinBudget) {
          out.reason = 'budget';
          out.shortfall = {
            crystals_short: Math.max(0, needJ - gotJ),
            pulls_short: Math.max(0, wantPulls - totalPulls),
            min_cost_to_reach_target_ntd: res.cost,
            extra_ntd_needed: res.cost - budget,
          };
          out.note = '【預算不足以達標】預算 NT$' + budget + ' 買不到 ' + wantPulls + ' 抽:達標最少要 NT$' + res.cost
            + ',還差 NT$' + (res.cost - budget) + '。以下是預算內能拿到最多水晶的方案,只到 ' + totalPulls + ' 抽,差 '
            + Math.max(0, wantPulls - totalPulls) + ' 抽(' + Math.max(0, needJ - gotJ) + ' 石)。回答時要把差額講清楚,不要說這個組合達成了目標。 ' + out.note;
        } else if (capped) {
          out.reason = 'target_too_large';
          out.shortfall = { crystals_short: Math.max(0, wantJ - held - gotJ), pulls_short: Math.max(0, wantPulls - totalPulls) };
          out.note = '【目標超過單次試算上限】一次最多只算到 600,000 石(2,000 抽),以下方案只涵蓋到這個上限,離 '
            + wantPulls + ' 抽還差 ' + Math.max(0, wantPulls - totalPulls) + ' 抽。要更多請分批問。 ' + out.note;
        } else if (!use.reached) {
          out.reason = 'purchase_limit';
          out.shortfall = { crystals_short: Math.max(0, needJ - gotJ), pulls_short: Math.max(0, wantPulls - totalPulls) };
          out.note = '【限購上限內湊不滿】就算不設預算,現有商品在各自的限購次數內最多只能買到 ' + gotJ + ' 石('
            + totalPulls + ' 抽),差 ' + Math.max(0, wantPulls - totalPulls) + ' 抽。可以帶 horizon_30d:true 看整個月分批買能不能補齊。 ' + out.note;
        }
        if (missing.length) {
          out.excluded_no_price = {
            count: missing.length,
            examples: missing.slice(0, 5).map(r => r.n),
            note: '這些商品在 master 資料庫只有佔位價(遊戲沒公開定價),所以沒被納入計算;月卡/月度禮包這類通常是全商店 CP 最高的,使用者到「儲值分析 → 商品總覽」自填實際售價後重算,方案可能更便宜。',
          };
        }
        return out;
      }

      case 'best_bonus_deck': {
        let E;
        try { E = await this.ensureEngine(); }
        catch (e) { return { error: '計算引擎載入失敗：' + (e.message || '') }; }
        const { RunStudio, EventCalc, MasterDB, EventScan, PowerEngine } = E;
        if (!RunStudio || !EventCalc || !EventScan || !MasterDB) return { error: '計算引擎不完整' };
        if (!(await EventCalc.ensure())) return { error: '台服 master data 載入失敗，稍後再試' };

        /* 期數：省略就取「已開始的最新一期」。
           不呼叫 RunStudio.ensure()——那支是給經典版頁面用的，會去填活動下拉、
           寫 rsTeam／rsBonus。這裡只補 _isJP() 需要的 _twMax，其餘資料源自己組，
           確保這支工具完全不碰畫面。 */
        const evList = await EventScan.loadList();
        if (!evList.length) return { error: '活動清單載入失敗，無法判斷期數' };
        const twMax = evList.reduce((m, x) => Math.max(m, x.id), 0);
        RunStudio._twMax = twMax;
        const nowT = Date.now();
        const startedEv = evList.filter(x => new Date(x.start_at).getTime() <= nowT).sort((x, y) => y.id - x.id);
        const evId = (a.event_id != null && String(a.event_id) !== '') ? +a.event_id
                   : (startedEv.length ? startedEv[0].id : twMax);
        if (!evId || isNaN(evId)) return { error: 'event_id 不是合法期數' };
        const isJP = evId > twMax;

        let src;
        if (!isJP) {
          const [cards, evCards] = await Promise.all([MasterDB.get('cards.json'), MasterDB.get('eventCards.json')]);
          src = { deck: EventCalc._deck, cards, evCards, type: EventCalc._types[evId], ev: EventScan.evInfo(evId), isJP: false };
        } else {
          const jp = await RunStudio._loadJP();   // 日服 cards／eventDeckBonuses／eventCards，純資料不碰 DOM
          if (!jp || !jp.cards) return { error: '日服 master data 載入失敗' };
          src = { deck: jp.deck || [], cards: jp.cards, evCards: jp.evCards || [], type: null,
                  ev: (RunStudio._jpEv || {})[evId] || null, isJP: true };
        }

        /* 型態只有「是不是 World Link」會改變加成公式（WL 的 eventDeckBonuses 沒有屬性條目，
           另外吃隊伍異色與支援隊）。日服期數沒載 events.json（2.7MB），改用小檔
           worldBlooms.json 判定：有這期的章節就是 WL。 */
        let type = src.type || null;
        if (!type) {
          try {
            const wb = isJP ? await fetch(RunStudio.JP + '/worldBlooms.json').then(r => r.json())
                            : await MasterDB.get('worldBlooms.json');
            type = (wb || []).some(w => w.eventId === evId) ? 'world_bloom' : 'marathon';
          } catch (e) { type = null; }
        }
        const isWL = type === 'world_bloom';

        /* 持有清單：優先用 uid 的公開 API（帶得回實際專精等級，專精會改變加成），
           沒設 uid 才退回站上「收集率」頁的勾選（只知道有沒有，專精一律當理論值 MR5）。 */
        let own = null, mrOf = null, ownSrc = null;
        if (a.only_my_cards) {
          const uid = this.state.pid;
          if (uid) {
            try {
              const d = await fetch(this.API + '/user/' + encodeURIComponent(uid) + '/profile').then(r => r.ok ? r.json() : null);
              const uc = (d && d.userCards) || [];
              if (uc.length) {
                own = new Set(uc.map(x => x.cardId));
                mrOf = {}; uc.forEach(x => { mrOf[x.cardId] = x.masterRank || 0; });
                ownSrc = 'uid ' + uid + ' 的公開資料（含實際專精等級）';
              }
            } catch (e) {}
          }
          if (!own) {
            const s = RunStudio._ownedSet();   // 收集率頁的 bitmap，只讀 localStorage
            if (s && s.size) { own = s; ownSrc = '站上「收集率」頁的勾選（沒有專精資訊，一律以 MR5 計）'; }
          }
          if (!own) return { error: '沒有可用的持有卡清單',
            hint: '請先用 set_my_uid 設定遊戲 id，或到站上「收集率」頁勾選持有卡片' };
        }

        const HI = c => c.cardRarityType === 'rarity_4' || c.cardRarityType === 'rarity_birthday';
        /* 理論池只放 ★4／生日：其餘稀有度的稀有度加成一定更低，擠不進前五。
           只用我的卡時反而要全稀有度放行，不然 ★4 不夠的人湊不滿 5 格。 */
        const pool0 = own ? src.cards.filter(c => own.has(c.id)) : src.cards.filter(HI);
        if (!pool0.length) return { error: own ? '持有清單裡沒有這個伺服器的卡' : '查無卡片資料' };

        // mrLv 傳 null＝理論值 MR5；有實際專精就帶實際值
        const scoreOf = (c, mrOverride) => {
          const mr = mrOverride !== undefined ? mrOverride : (mrOf ? (mrOf[c.id] || 0) : null);
          return Object.assign({ c, mrUsed: mr == null ? 5 : mr }, RunStudio._cardBonus(c, evId, src, mr));
        };

        // core.js 的 WL_ATTR_BONUS 是頂層 const 但不在 ensureEngine 的取用清單裡，原值照抄
        const WLB = { 1: 0, 2: 0, 3: 75, 4: 100, 5: 125 };
        const ATTRS = ['cool', 'happy', 'mysterious', 'cute', 'pure'];
        const r1 = v => Math.round(v * 10) / 10;

        // WL 才需要 PowerEngine：_wlBonusTeam 會讀 cardUnits 判斷同團、用 baseSum 當同分時的取捨
        let powerOK = false;
        if (isWL) {
          try { powerOK = await PowerEngine.ensure(); } catch (e) { powerOK = false; }
          if (powerOK && src.isJP && RunStudio._mergeJPEpi) RunStudio._mergeJPEpi();
        }
        const withBase = x => {
          if (!powerOK || x._bs) return x;
          try {
            const b = PowerEngine.basePowerCached(x.c, PowerEngine.cardMaxLevel(x.c), true, true, 5);
            x.baseSum = b[0] + b[1] + b[2];
          } catch (e) { x.baseSum = 0; }
          x._bs = 1; return x;
        };

        /* 選隊。一隊每角色最多一張（プロセカ規則）。
           非 WL：加成逐卡相加、卡與卡互不影響 → 每角色留最高再取前五就是最佳解。
           WL：屬性加成看「隊伍相異屬性數」，是全隊一個值，貪心會漏解 →
               每（角色×屬性）留最佳一張後小窮舉，直接用 core.js 的 _wlBonusTeam。 */
        const bestTeam = arr => {
          if (!isWL) {
            const byChar = {};
            arr.forEach(x => { const k = x.c.characterId; if (!byChar[k] || x.per > byChar[k].per) byChar[k] = x; });
            const t = Object.values(byChar).sort((p, q) => q.per - p.per).slice(0, 5);
            return { team: t, colors: new Set(t.map(x => x.c.attr)).size, attrBonus: 0, sameUnit: null };
          }
          const byCA = {};
          arr.forEach(x => { const k = x.c.characterId + ':' + x.c.attr; if (!byCA[k] || x.per > byCA[k].per) byCA[k] = x; });
          const ranked = Object.values(byCA).sort((p, q) => q.per - p.per);
          const pool = ranked.slice(0, 30);   // C(30,5) 窮舉，毫秒級
          // 截斷保底：每色至少留 3 張、池裡至少 5 個相異角色，否則補色的那張會被截掉
          for (const at of ATTRS) {
            let n = pool.filter(x => x.c.attr === at).length;
            for (const x of ranked) { if (n >= 3) break; if (pool.indexOf(x) < 0 && x.c.attr === at) { pool.push(x); n++; } }
          }
          for (;;) {
            const chars = new Set(pool.map(x => x.c.characterId));
            if (chars.size >= 5) break;
            const add = ranked.find(x => pool.indexOf(x) < 0 && !chars.has(x.c.characterId));
            if (!add) break;
            pool.push(add);
          }
          pool.forEach(withBase);
          /* _wlBonusTeam 只在 pool 有 5 個以上相異角色時才挑得出解：
             ≤5 張時它直接取前五、不檢查角色重複，湊不到 5 個相異角色時內部的 best 會是 null。
             持有卡太少的玩家會踩到，所以這兩種情況自己挑。 */
          const distinct = new Set(pool.map(x => x.c.characterId)).size;
          if (pool.length <= 5 || distinct < 5) {
            const seen = new Set(), t = [];
            for (const x of ranked) { if (seen.has(x.c.characterId)) continue; seen.add(x.c.characterId); t.push(x); if (t.length === 5) break; }
            const colors = new Set(t.map(x => x.c.attr)).size;
            return { team: t, colors, attrBonus: WLB[colors] || 0, sameUnit: null };
          }
          const r = RunStudio._wlBonusTeam(pool);
          return { team: r.team, colors: r.colors, attrBonus: r.attrBonus || 0, sameUnit: !!r.sameUnit };
        };
        const deckSum = r => r1(r.team.reduce((s, x) => s + x.per, 0) + (r.attrBonus || 0));

        const scored = pool0.map(c => scoreOf(c));
        const mine = bestTeam(scored);
        const cardSum = r1(mine.team.reduce((s, x) => s + x.per, 0));

        /* WL 支援隊伍：不把 own 傳進 _wlSupport——它的快取鍵用的是「收集率」頁的
           localStorage 原字串，拿 API 來的持有清單去呼叫會跟別的持有狀態共用同一格快取。
           改成拿它算好的全卡清單，自己套持有過濾與主隊排除（forDeck 做的就是這件事）。
           清單一律以 MR5／技能 Lv4 估，是理論滿配值。 */
        const supRaw = isWL ? await RunStudio._wlSupport(src, evId, null) : null;
        const supSum = (excludeIds, ownSet) => {
          if (!supRaw) return null;
          const ex = new Set(excludeIds); let sum = 0, k = 0;
          for (const r of supRaw.list) {
            if (ex.has(r.id) || (ownSet && !ownSet.has(r.id))) continue;
            sum += r.bonus; if (++k >= supRaw.n) break;
          }
          return { total_pct: r1(sum), slots: supRaw.n, filled: k, chapter: supRaw.chapterNo, chapter_label: supRaw.label };
        };
        const supInfo = supSum(mine.team.map(x => x.c.id), own);
        const total = r1(cardSum + (mine.attrBonus || 0) + (supInfo ? supInfo.total_pct : 0));

        const RARN = { rarity_4: '★4', rarity_birthday: '生日', rarity_3: '★3', rarity_2: '★2', rarity_1: '★1' };
        const row = (x, i) => ({
          slot: i + 1, card_id: x.c.id, card_name: x.c.prefix || ('#' + x.c.id),
          character: this.chNameOf(x.c.characterId),
          attribute: this.ATTR_ZH[x.c.attr] || x.c.attr,
          rarity: RARN[x.c.cardRarityType] || x.c.cardRarityType,
          bonus_pct: x.per,
          breakdown: {
            attr_or_unit_pct: x.deck, event_card_pct: x.special,
            rarity_and_master_rank_pct: x.mr, master_rank_used: x.mrUsed,
            is_character_match: !!x.charMatch,
          },
        });

        const out = {
          event: { id: evId, name: (src.ev && src.ev.name) || null, type: type || 'unknown',
                   is_world_link: isWL, server: isJP ? 'jp（台服約一年後才會有）' : 'tw' },
          scope: own ? 'only_my_cards' : 'theoretical',
          owned_source: ownSrc,
          deck: mine.team.map(row),
          deck_size: mine.team.length,
          card_bonus_total_pct: cardSum,
          world_link: isWL ? {
            distinct_attributes: mine.colors,
            attribute_bonus_pct: mine.attrBonus || 0,
            support_deck: supInfo,
            same_unit: mine.sameUnit,
          } : null,
          total_bonus_pct: total,
        };

        /* 缺哪張：拿理論池裡沒持有的卡逐張試裝，看隊伍總加成會漲多少。
           只試逐卡加成最高的一批（加成低於現有第五名的卡，除非能補色，否則不可能改善），
           WL 另外保證每色都有候選，不然補色的那張會被截掉。 */
        if (own) {
          const theoryAll = src.cards.filter(HI).map(c => scoreOf(c, null));   // 一律 MR5
          const theory = bestTeam(theoryAll);
          const supTh = supSum(theory.team.map(x => x.c.id), null);
          out.theoretical_max_pct = r1(deckSum(theory) + (supTh ? supTh.total_pct : 0));
          out.gap_to_theoretical_pct = r1(out.theoretical_max_pct - total);
          // 我的卡全部練滿 MR5 的話能到多少 → 讓「缺卡」與「專精沒滿」分得開
          const mineMax = bestTeam(pool0.map(c => scoreOf(c, null)));
          out.my_cards_at_mr5_pct = r1(deckSum(mineMax) + (supInfo ? supInfo.total_pct : 0));

          const full = mine.team.length >= 5;
          const minPer = full ? Math.min(...mine.team.map(x => x.per)) : -1;
          const missAll = theoryAll.filter(x => !own.has(x.c.id)).sort((p, q) => q.per - p.per);
          const cand = missAll.slice(0, 30);
          if (isWL) for (const at of ATTRS) {
            let n = cand.filter(x => x.c.attr === at).length;
            for (const x of missAll) { if (n >= 3) break; if (cand.indexOf(x) < 0 && x.c.attr === at) { cand.push(x); n++; } }
          }
          const base = cardSum + (mine.attrBonus || 0);
          const gains = [];
          for (const x of cand) {
            if (!isWL && x.per <= minPer) continue;   // 非 WL 逐卡相加，擠不進前五就是 0
            const r = bestTeam(scored.concat([x]));
            if (!r.team.some(y => y.c.id === x.c.id)) continue;
            const g = r1(deckSum(r) - base);
            if (g > 0) gains.push({ x, g, colors: r.colors });
          }
          gains.sort((p, q) => q.g - p.g);
          out.missing_upgrades = gains.slice(0, 5).map(o => {
            const mr0 = scoreOf(o.x.c, 0);   // 剛抽到是 MR0，專精加成還沒吃到
            return {
              card_id: o.x.c.id, card_name: o.x.c.prefix || ('#' + o.x.c.id),
              character: this.chNameOf(o.x.c.characterId),
              attribute: this.ATTR_ZH[o.x.c.attr] || o.x.c.attr,
              rarity: RARN[o.x.c.cardRarityType] || o.x.c.cardRarityType,
              card_bonus_pct_at_mr5: o.x.per, card_bonus_pct_at_mr0: mr0.per,
              team_gain_pct_at_mr5: o.g,
              team_gain_pct_at_mr0: r1(deckSum(bestTeam(scored.concat([mr0]))) - base),
              new_distinct_attributes: isWL ? o.colors : undefined,
            };
          });
          if (!out.missing_upgrades.length) out.missing_upgrades_note =
            '沒有任何一張沒抽到的卡能再往上加——現有的卡已經組得出這期加成的上限。';
        }

        out.note = '逐卡加成 ＝ 屬性／團體加成（eventDeckBonuses 取所有符合條目的最大值，不是相加）'
          + ' ＋ 當期特效卡加成（eventCards.bonusRate；BloomFes 的 70% 是取代式，不再疊屬性／團體）'
          + ' ＋ 稀有度×專精加成（eventRarityBonusRates；每張卡都吃，不看符不符合活動）。'
          + '隊伍總加成 ＝ 5 張逐卡加成相加'
          + (isWL ? ' ＋ World Link 隊伍相異屬性加成（3色75%／4色100%／5色125%，全隊一個值）'
                  + ' ＋ 支援隊伍前 ' + (supRaw ? supRaw.n : 'N') + ' 張（以 MR5／技能Lv4 滿配估）' : '')
          + '。一隊每角色只能放一張。'
          + (own ? '持有清單來源：' + ownSrc + '；未持有的卡以 MR5 估。' : '不分持有與否，全部以 MR5 估的理論上限。')
          + (isWL && !supRaw ? '　支援隊伍未估（終章或章節資料缺），總加成不含支援。' : '')
          + (own ? '　missing_upgrades 的漲幅只算主隊 5 張，沒把支援隊伍的變化算進去。' : '')
          + '　這支只看加成、不看綜合力與技能——要「每局活動P 最大」得另外權衡綜合力。';
        return out;
      }

      case 'calc_team_power': {
        /* 為什麼要借 core.js 的引擎:hisekai 只回得到玩家「當下」編組的 totalPower,
           一問「換這張會多多少」「area item 升滿差多少」就完全沒有答案。
           綜合力的完整算式(三維逐維 floor、區域道具 allMatch 翻倍、畫布併進基礎表現力
           所以會被各種 % 一起吃到)只存在 PowerEngine,在這裡複寫一份遲早會跟站上對不起來。 */
        let E;
        try { E = await this.ensureEngine(); }
        catch (e) { return { error: '計算引擎載入失敗：' + (e.message || '') }; }
        const PE = E && E.PowerEngine;
        // PE.ensure() 自己吞掉錯誤回 false(不是 throw),所以要看回傳值,不能只靠 try
        if (!PE || !(await PE.ensure())) return { error: '卡片／區域道具 master 資料載入失敗，請稍後再試一次' };

        const list = Array.isArray(a.cards) ? a.cards : [];
        if (list.length !== 5) {
          return { error: '需要正好 5 張卡，目前收到 ' + list.length + ' 張。'
            + '（同團/同色會讓區域道具翻倍，湊不滿 5 張算出來的數字沒有意義）'
            + '可先用 get_my_cards 拿玩家的持卡與編組。' };
        }

        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        const int = (v, lo, hi) => clamp(Math.round(+v || 0), lo, hi);
        const RAR = { rarity_4: '★4', rarity_birthday: '生日', rarity_3: '★3', rarity_2: '★2', rarity_1: '★1' };

        /* 角色等級 50 是經典版 pwCharRank 的預設值,沿用以免同一站兩個地方算出不同數字 */
        const gRank = a.character_rank != null ? int(a.character_rank, 1, 200) : 50;
        /* PE.areaMaxLv 是「台服 Lv1-15 ＋ 日服 Lv16-20」合併後的上限(實測目前 20)。
           預設照經典版帶滿級,但台服現階段只到 15 —— 所以一定要在回傳裡講清楚用了幾級。 */
        const areaLv = a.area_item_level != null ? int(a.area_item_level, 1, PE.areaMaxLv) : PE.areaMaxLv;
        /* 豆森 7% = 滿級大門 4% ＋ 三個玩偶各 1%,站上各處都用這個數 */
        const myPct = a.mysekai_pct != null ? clamp(+a.mysekai_pct || 0, 0, 12) : 7;

        const members = [], bad = [];
        list.forEach((c, i) => {
          c = c || {};
          const card = PE.cardById[+c.card_id];
          if (!card) { bad.push(c.card_id != null ? c.card_id : '第' + (i + 1) + '張未給 card_id'); return; }
          const maxLv = PE.cardMaxLevel(card);   // 上限隨稀有度與突破而異,不能寫死 60
          members.push({
            card,
            level: c.level != null ? int(c.level, 1, maxLv) : maxLv,
            trained: c.trained != null ? !!c.trained : true,
            epiRead: c.episodes_read != null ? !!c.episodes_read : true,
            mr: c.master_rank != null ? int(c.master_rank, 0, 5) : 5,
            rank: c.character_rank != null ? int(c.character_rank, 1, 200) : gRank,
            _maxLv: maxLv,
          });
        });
        if (bad.length) return { error: '查不到這些 card_id：' + bad.join('、') + '。可用 get_my_cards 或 search_anything 先查卡片編號。' };

        /* same_unit / same_attr 是 teamPower 內部判斷但沒回傳的東西(它只回 total 與逐卡明細),
           而使用者最想知道的就是「我這隊有沒有吃到 allMatch」,所以照同一套規則重算一次。
           規則:優先找全隊都有的非 piapro 實體團(VS 卡可用支援團體湊),否則看是否全員都算 piapro。 */
        const poss = members.map(m => PE.cardUnits(m.card));
        let commonUnit = null;
        for (const u of poss[0]) { if (u !== 'piapro' && poss.every(s => s.indexOf(u) >= 0)) { commonUnit = u; break; } }
        if (!commonUnit && poss.every(s => s.indexOf('piapro') >= 0)) commonUnit = 'piapro';
        const sameAttr = members.every(m => m.card.attr === members[0].card.attr);

        const { total, per } = PE.teamPower(members, areaLv, myPct);
        const sum = k => per.reduce((s, p) => s + (p[k] || 0), 0);

        const cids = members.map(m => m.card.characterId);
        const warn = [];
        if (cids.some((x, i) => cids.indexOf(x) !== i)) warn.push('隊伍裡有重複角色，遊戲內不允許這樣編組，數字只能當 what-if 參考。');
        if (areaLv > 15) warn.push('area_item_level=Lv' + areaLv + ' 含日服 5 週年才開的 Lv16-20；台服現階段上限是 Lv15，要算台服請傳 area_item_level: 15。');

        return {
          total_power: total,
          same_unit: !!commonUnit, common_unit: commonUnit, same_attr: sameAttr,
          applied: { character_rank: gRank, area_item_level: areaLv, area_item_level_max: PE.areaMaxLv, mysekai_pct: myPct },
          cards: per.map((p, i) => {
            const m = members[i], c = m.card;
            return {
              card_id: c.id, name: c.prefix || ('#' + c.id),
              character: this.chNameOf(c.characterId),
              rarity: RAR[c.cardRarityType] || c.cardRarityType, attr: c.attr,
              level: m.level, level_max: m._maxLv, trained: m.trained,
              master_rank: m.mr, episodes_read: m.epiRead, character_rank: m.rank,
              base_power: p.base,
              episodes_bonus: p.epi,
              canvas_bonus: p.canvas,
              char_rank_bonus: p.charBonus,
              area_item_bonus: p.areaBonus,
              mysekai_bonus: p.mysekai,
              total: p.total,
            };
          }),
          subtotals: {
            base_power: sum('base'), episodes_bonus: sum('epi'), canvas_bonus: sum('canvas'),
            char_rank_bonus: sum('charBonus'), area_item_bonus: sum('areaBonus'), mysekai_bonus: sum('mysekai'),
          },
          units: { power: '綜合力點數', area_item_level: 'Lv', mysekai_pct: '%' },
          warnings: warn.length ? warn : undefined,
          note: '每張卡：total = base_power ＋ char_rank_bonus ＋ area_item_bonus ＋ mysekai_bonus。'
            + 'base_power 已經含 episodes_bonus（前後篇）與 canvas_bonus（MySekai 畫布，★4 每張 1500、生日 1200、★3 900），'
            + '這兩項只是明細，不可以再加一次。'
            + '角色等級與區域道具都是對三維（表現力/技術力/體力）分別乘率後逐維無條件捨去再相加，所以不等於「總力×總%」。'
            + '區域道具在 same_unit 或 same_attr 成立時改吃 allMatch 加倍率。'
            + 'mysekai_bonus = floor(base_power × mysekai_pct%)，7% = 滿級大門 4% ＋ 三個玩偶各 1%。'
            + '畫布因為併進基礎表現力，所以會再被角色等級/區域道具/豆森的 % 吃到一次，這是對齊遊戲內 basicCardTotalPower 的作法。'
            + 'what-if 用法：改一個欄位（換 card_id、調 level/master_rank、area_item_level 15→20）再呼叫一次，兩次 total_power 相減就是差值。',
        };
      }

      case 'estimate_score': {
        let E;
        try { E = await this.ensureEngine(); }
        catch (e) { return { error: '計算引擎載入失敗:' + (e.message || '') }; }

        /* SongEff.ensure() 內部收尾會呼叫 render(),但 render() 第二行取不到 #seResult
           就 return —— 那個 id 只在 index.html。所以這裡不會動到本頁任何畫面。 */
        await E.SongEff.ensure();
        const metas = E.SongEff._metas;
        if (!metas) return { error: 'music_metas 載入失敗(2.3MB,直連 storage.sekai.best)。稍後再問一次。' };

        const mid = +a.song_id;
        const diffs = metas[mid];
        if (!diffs) return { error: '找不到 song_id=' + a.song_id + ' 的譜面資料,可先用 get_songs 查編號' };

        // 難度後備順序與 core.js calcScore 一致:指定的沒有就往 master / expert / 任一檔退
        const want = String(a.difficulty || 'master').toLowerCase();
        const usedDiff = diffs[want] ? want
          : diffs.master ? 'master'
          : diffs.expert ? 'expert'
          : Object.keys(diffs)[0];
        const meta = diffs[usedDiff];

        const st = this.state;
        const modeIn = String(a.mode || st.mode || 'multi').toLowerCase();
        const mode = ['solo', 'auto', 'multi', 'cheer'].indexOf(modeIn) >= 0 ? modeIn : 'multi';
        // 應援(cheer)的「計分」與協力同一套,差別只在活動P 換算;auto 走 metas 的 auto 係數組
        const coop = mode === 'multi' || mode === 'cheer';
        const power = a.power != null ? +a.power || 0 : +st.power || 0;
        if (!(power > 0)) return { error: '需要隊伍綜合力 power(可先用 get_player_profile 取 total_power,或直接問使用者)' };

        // 少填就拿最後一個值補滿六窗:只給一個數字＝六窗同值,等同 deckpro 的「全部同值」按鈕
        const raw = Array.isArray(a.skills) ? a.skills.map(v => +v || 0) : [];
        if (!raw.length) return { error: 'skills 至少要給一個數字(六窗加分%,130 代表 +130%)' };
        const sk = [0, 1, 2, 3, 4, 5].map(i => raw[i] != null ? raw[i] : raw[raw.length - 1]);

        const arr = (coop ? meta.skill_score_multi
          : mode === 'auto' ? meta.skill_score_auto
          : meta.skill_score_solo) || [];
        if (arr.length < 6) return { error: '此譜面的技能窗權重資料不完整' };
        const baseScore = (mode === 'auto' ? meta.base_score_auto : meta.base_score) || 0;
        const fever = coop ? (meta.fever_score || 0) * 0.5 : 0;   // FEVER 只有協力/應援吃,且只算一半

        const scoreOf = part => Math.floor((baseScore + fever + part) * power * 4);
        const skillPart = arr.reduce((t, w, i) => t + w * sk[i] / 100, 0);
        const mult = baseScore + fever + skillPart;
        const score = scoreOf(skillPart);

        const windows = arr.map((w, i) => ({
          window: i + 1,
          weight: +w.toFixed(6),
          skill_pct: sk[i],
          points: Math.round(w * sk[i] / 100 * power * 4),
          share_of_score_pct: mult > 0 ? +(w * sk[i] / 100 / mult * 100).toFixed(2) : 0,
        }));

        /* 分數區間 = 同一組技能倍率換不同的落窗順序。core.js 的 calcScore 沒有這個概念,
           是這支自己補的:六窗權重不等,同樣六個倍率配到不同窗分數就不同。
           上下界用重排不等式取:倍率由大到小配權重由大到小＝最好,反配＝最壞。
           單人可以靠站位挑,協力靠發動順序,玩家控制不了全部,所以給區間而不是單一值。 */
        const ws = arr.slice().sort((x, y) => y - x);
        const ss = sk.slice().sort((x, y) => y - x);
        const partAt = order => ws.reduce((t, w, i) => t + w * order[i] / 100, 0);
        const best = scoreOf(partAt(ss));
        const worst = scoreOf(partAt(ss.slice().reverse()));

        /* 與平均模型的差:重現 calcSongScore 的口徑(窗1~5 權重和 × 五窗平均倍率 ＋ 窗6 單獨算),
           這樣 delta 就是「calc_event_points 少看到的那一截」,而不是隨便另編一個平均。 */
        const w15 = arr.slice(0, 5).reduce((t, w) => t + w, 0);
        const avg5 = sk.slice(0, 5).reduce((t, v) => t + v, 0) / 5;
        const avgScore = scoreOf(w15 * avg5 / 100 + arr[5] * sk[5] / 100);

        let title = null;
        try {
          const musics = await E.MasterDB.get('musics.json');
          const m = (musics || []).find(x => x.id === mid);
          if (m) title = m.title || null;
        } catch (e) {}   // 只是曲名,拿不到不該讓整支估算失敗

        const heavy = windows.slice().sort((x, y) => y.weight - x.weight);
        return {
          song: { id: mid, title, difficulty: usedDiff,
            difficulty_requested: want, event_rate_pct: meta.event_rate, length_s: meta.music_time },
          mode, power, skills_pct: sk,
          score,
          score_range: { min: worst, max: best, spread: best - worst,
            spread_pct: worst > 0 ? +((best / worst - 1) * 100).toFixed(2) : 0 },
          score_multiplier: +mult.toFixed(4),
          breakdown: {
            base_points: Math.round(baseScore * power * 4),
            fever_points: Math.round(fever * power * 4),
            skill_points: Math.round(skillPart * power * 4),
          },
          windows,
          heaviest_window: heavy[0].window, lightest_window: heavy[5].window,
          vs_average_model: {
            avg_model_score: avgScore,
            delta: score - avgScore,
            delta_pct: avgScore > 0 ? +((score / avgScore - 1) * 100).toFixed(3) : 0,
            avg_skill_pct_used: +avg5.toFixed(2),
          },
          // 要接 calc_event_points 換活動P 時直接用這組(那支的 skill/s6 是倍數不是 %)
          for_calc_event_points: { score, skill: +(avg5 / 100).toFixed(4), s6: +(sk[5] / 100).toFixed(4),
            event_rate: meta.event_rate, mode },
          note: '分數 ＝ ⌊(base_score' + (coop ? ' ＋ fever_score×0.5' : '') +
            ' ＋ Σᵢ skill_score[i]×窗ᵢ%/100) × 綜合力 × 4⌋;第 6 窗是 encore(隊長)。' +
            '權重取自 music_metas 的譜面模擬,單位為分。' +
            (coop ? '　協力請填「每窗實際生效倍率」而非卡面技能%:每次發動全隊得(發動者 ＋ 其他四人÷5),' +
              '滿隊同值 130% 時實際約 234%,直接填 130 會嚴重低估。' : '') +
            '　score_range 是同一組倍率配到不同落窗順序的上下界(本工具自行推導,非 core.js 原有)。' +
            '　未計協力活躍加分(需房間總綜合力)。',
        };
      }

      case 'optimize_deck': {
        /* 為什麼直接借 core.js 的 RunStudio._computeBest,而不在這裡重寫一套：
           「哪五張最強」不是排個序就好 —— 加成、綜合力、技能三者互相牽制
           (同團才吃 area 道具翻倍、團分技能要看實際隊伍組成、協力場只有隊長技能會發動),
           經典版那支 DFS 已經把這些耦合都算進去並實測校準過。重寫等於再踩一次同樣的坑。 */
        const E = await this.ensureEngine();
        const RS = E.RunStudio;
        if (!RS) return { error: '計算引擎載入了，但取不到 RunStudio' };

        /* ---- 事前備料 ----
           刻意「不」呼叫 RunStudio.ensure()：那支是給經典版頁面用的,會去填 #rsEvent /
           #rsSong 下拉並在結尾跑一次 onEvent() 渲染 —— 本頁沒有那些節點,等於白跑一輪
           而且會把 _evId 留成 null。改成照 RunStudio.miniRun() 的做法,只備 _computeBest
           真正會讀到的欄位。 */
        try {
          await E.EventCalc.ensure();                       // _gcu / _mr / _deck(eventDeckBonuses) / _types
          await E.SongEff.ensure();                         // music_metas：沒有它就退回「綜合力×加成」目標
          if (!RS._cards || !RS._evCards) {
            [RS._cards, RS._evCards] = await Promise.all([
              E.MasterDB.get('cards.json'), E.MasterDB.get('eventCards.json'),
            ]);
          }
        } catch (e) { return { error: '計算引擎的 master 資料載入失敗：' + (e.message || '') }; }

        // _isJP 靠 _twMax 判斷資料源要走台服還是日服 master,一定要先填
        const evList = await this.loadEvList().catch(() => []);
        RS._twMax = (evList || []).reduce((m, x) => Math.max(m, x.id), 0);

        // 期數：省略就用當期（eventClock 讀 state.live,沒載就補載一次）
        let evId = a.event_id != null ? +a.event_id : null;
        if (!evId) {
          if (!this.state.live) { try { await this.loadLive(); } catch (e) {} }
          const ck = this.eventClock();
          evId = ck ? ck.id : RS._twMax;
        }
        if (!evId) return { error: '取不到活動期數，請帶 event_id' };
        // 日服未來檔期(id > 台服最大期)的加成表在日服 master,得先把日服活動清單載進來
        if (evId > RS._twMax) { try { await RS._loadJPEvents(); } catch (e) {} }

        /* _cardBonus 是從 this._evId 讀期數的(不是從 opts),所以一定要自己設。
           經典版是靠 onEvent() 從 #rsEvent 下拉同步這個值,本頁沒有那個下拉。 */
        RS._evId = evId;

        let src;
        try { src = await RS._src(evId); } catch (e) { return { error: '取不到第 ' + evId + ' 期的加成資料' }; }
        if (!src || !src.cards || !src.cards.length) return { error: '第 ' + evId + ' 期查無卡片/加成資料' };

        // 歌曲：省略就用 RunStudio 的基準曲(Sage EXPERT;沒 metas 就退 event_rate 最高的歌)
        const DK = { E: 'easy', N: 'normal', H: 'hard', X: 'expert', M: 'master', A: 'append',
                     EASY: 'easy', NORMAL: 'normal', HARD: 'hard', EXPERT: 'expert', MASTER: 'master', APPEND: 'append' };
        const songId = a.song_id != null ? +a.song_id : RS._miniSong();
        const diff = a.song_id != null
          ? (DK[String(a.difficulty || '').toUpperCase()] || 'master')
          : (a.difficulty ? (DK[String(a.difficulty).toUpperCase()] || RS._miniDiff()) : RS._miniDiff());
        const energy = a.energy != null
          ? Math.max(0, Math.min(10, Math.round(+a.energy || 0)))
          : (+this.state.energy || 0);
        const areaLv = Math.max(1, Math.min(20, +a.area_item_level || E.PowerEngine.areaMaxLv || 15));
        const charRank = Math.max(1, Math.min(200, +a.character_rank || 100));

        /* ⚠ 唯一會碰 DOM 的地方：_computeBest 內部用 this._ownedOn() 決定要不要只算持有卡,
           而 _ownedOn 讀的是經典版的 #rsOwnedOnly 勾選框。本頁沒有那個節點 → 它一律回 false,
           only_my_cards 會被無聲吃掉。所以呼叫前用參數蓋掉,結束後還原(引擎是共用單例)。
           持有清單本身走 localStorage('sekai-cards-own'),與本頁「收集率」頁同一把鑰匙、
           同一種 bitmap 編碼,不需要另外轉。 */
        const onlyMine = !!a.only_my_cards;
        const ownedOn0 = RS._ownedOn;
        RS._ownedOn = () => onlyMine;

        let r;
        try {
          // DFS 是同步的 ~C(26,5)=66k 組合 × teamPower,會卡住主執行緒 1–3 秒,先讓一幀畫面吐出去
          await new Promise(res => setTimeout(res, 0));
          r = await RS._computeBest(src, src.type, { areaLv, charRank, songId, diff, boostN: energy });
        } catch (e) {
          return { error: '最佳化計算失敗：' + (e.message || '') };
        } finally { RS._ownedOn = ownedOn0; }

        if (!r || !r.ok) {
          return { error: (r && r.reason) || '找不到可組成的隊伍',
                   hint: onlyMine ? '「只用我持有的卡」開著 —— 收集率頁勾選的 ★4／生日卡可能不足 5 個角色，可改成 only_my_cards=false 看理論最強隊' : null };
        }

        // ---- 整理輸出（引擎回的東西很大，只挑講得清楚的欄位）----
        const UNITN = { light_sound: 'Leo/need', idol: 'MMJ', street: 'VBS', theme_park: 'ワンダショ',
                        school_refusal: 'ニーゴ', piapro: 'VIRTUAL SINGER' };
        const RARN = { rarity_4: '★4', rarity_birthday: '生日', rarity_3: '★3', rarity_2: '★2', rarity_1: '★1' };
        const ATTRN = { cool: '帥氣', cute: '可愛', pure: '純真', happy: '快樂', mysterious: '神秘' };
        const chosen = r.chosen, per = (r.best.pw && r.best.pw.per) || [], skills = r.best.skills || [];
        const cards = chosen.map(x => x.c);

        /* 全隊同團判定：照 PowerEngine.teamPower 的規則重算一次(V 家卡可用 piapro 或支援團湊),
           同團的意義是 area 道具吃 allMatch 檔位 → 五張的綜合力一起翻,不是只有那一張變強。 */
        const unitsOf = cards.map(c => E.PowerEngine.cardUnits(c) || []);
        let commonUnit = null;
        for (const u of (unitsOf[0] || [])) { if (u !== 'piapro' && unitsOf.every(s => s.includes(u))) { commonUnit = u; break; } }
        if (!commonUnit && unitsOf.every(s => s.includes('piapro'))) commonUnit = 'piapro';
        const sameAttr = cards.every(c => c.attr === cards[0].attr);

        const leaderSk = skills.length ? Math.max(...skills) : 0;
        const leaderIdx = skills.indexOf(leaderSk);
        // 跑隊倍率＝[隊長 + 100 + 隊友總和/5]/100，與站上倍率計算器同式
        const teamMult = skills.length ? (leaderSk + 100 + (skills.reduce((s, v) => s + v, 0) - leaderSk) / 5) / 100 : 0;
        const sumOf = k => per.reduce((s, p) => s + (p[k] || 0), 0);
        const baseSum = sumOf('base');

        const meta = r.meta || null;
        const usedDiff = meta ? (Object.keys((E.SongEff._metas || {})[songId] || {}).find(k => (E.SongEff._metas[songId] || {})[k] === meta) || diff) : null;
        let songTitle = null;
        try { songTitle = ((await E.MasterDB.get('musics.json')) || []).find(s => s.id === songId); } catch (e) {}

        const team = chosen.map((x, i) => {
          const b = RS._cardBonus(x.c, evId, src);   // 純計算,拿逐項拆解(deck / 特效 / 稀有度+專精)
          return {
            slot: i + 1, card_id: x.c.id, card_name: x.c.prefix || ('#' + x.c.id),
            character: this.chNameOf(x.c.characterId),
            unit: UNITN[E.PowerEngine.charBands[x.c.characterId]] || (x.c.characterId >= 21 ? 'VIRTUAL SINGER' : null),
            support_unit: (x.c.supportUnit && x.c.supportUnit !== 'none') ? (UNITN[x.c.supportUnit] || x.c.supportUnit) : null,
            rarity: RARN[x.c.cardRarityType] || x.c.cardRarityType,
            attribute: ATTRN[x.c.attr] || x.c.attr,
            card_bonus_pct: x.bonus,
            bonus_breakdown: { attr_or_unit_pct: b.deck, event_special_pct: b.special, rarity_master_rank_pct: b.mr },
            role: (!x.charMatch && !x.special) ? '湊數卡(無角色加成,只吃稀有度/專精;負責湊同團或湊色)' : (x.special ? '當期特效卡' : '加成角色'),
            skill_pct: skills[i] != null ? Math.round(skills[i] * 10) / 10 : null,
            is_leader: i === leaderIdx,
            power: per[i] ? per[i].total : null,
          };
        });

        const why = [];
        why.push(commonUnit
          ? '全隊同團（' + (UNITN[commonUnit] || commonUnit) + '）→ area 道具吃 allMatch 檔位，五張的綜合力一起翻倍，不是只有一張變強'
          : '未能全隊同團 → area 道具不翻倍；候選池裡湊不出同團的第 5 張（加成更高的卡把它換掉更划算）');
        if (sameAttr) why.push('全隊同色（' + (ATTRN[cards[0].attr] || cards[0].attr) + '）→ 屬性向的 area 道具也吃 allMatch');
        why.push('協力場每位玩家只有「隊長」的技能會為全隊發動，所以隊伍的技能代表值是五張裡的最高值：'
          + team[leaderIdx >= 0 ? leaderIdx : 0].card_name + ' ' + Math.round(leaderSk) + '%（跑隊倍率 ×' + teamMult.toFixed(2) + '）');
        const fillers = team.filter(t => t.role.indexOf('湊數卡') === 0);
        if (fillers.length) why.push('第 ' + fillers.map(t => t.slot).join('/') + ' 位是湊數卡（'
          + fillers.map(t => t.card_name).join('、') + '）：一隊每角色只能放一張，加成角色不足 5 個時要有人補位，'
          + '選它是因為它同時能湊同團／湊色與戰力');
        why.push('目標函數是「單局活動P」本身，不是加成或綜合力單看 —— 所以會出現「捨一點加成換更高綜合力／技能」的取捨');

        return {
          event: { id: evId, name: (src.ev && (src.ev.name)) || null,
                   type: { marathon: '馬拉松', cheerful_carnival: '嘉年華', world_bloom: 'World Link' }[src.type] || src.type || null,
                   data_source: src.isJP ? '日服 master（台服未來檔期預測）' : '台服 master' },
          song: { id: songId, title: songTitle ? (songTitle.title || ('#' + songId)) : ('#' + songId),
                  difficulty: usedDiff || diff, event_rate_pct: r.R },
          settings: { energy, boost_multiplier: r.F, area_item_level: areaLv, character_rank: charRank,
                      only_my_cards: onlyMine,
                      candidate_pool: onlyMine ? (RS._poolNote || null) : '全部 ★4／生日卡（理論最強隊）' },
          team,
          totals: {
            team_bonus_pct: r.totalBonus,
            team_power: r.best.pw.total,
            leader_skill_pct: Math.round(leaderSk * 10) / 10,
            team_multiplier: +teamMult.toFixed(2),
            event_points_per_game: r.useEP ? Math.round(r.obj) : null,
            event_points_per_game_at_0_boost: r.useEP ? Math.round(r.obj / (r.F || 1)) : null,
            objective: r.useEP ? '單局活動P（協力場）' : '綜合力×加成（music_metas 沒載到，算不了活動P）',
          },
          power_breakdown: { base: baseSum, character_rank: sumOf('charBonus'), area_item: sumOf('areaBonus'),
                             mysekai: sumOf('mysekai'), canvas: sumOf('canvas'), episodes: sumOf('epi') },
          world_link: r.wl ? { colors: r.wl.colors, attr_bonus_pct: r.wl.attrBonus,
                               support_deck_bonus_pct: r.wl.hasSup ? r.wl.support : null,
                               support_deck_chapter: r.wl.hasSup ? r.wl.label : null,
                               card_bonus_sum_pct: r.wl.cardSum,
                               note: r.wl.hasSup ? '支援隊伍加成已含在 team_bonus_pct 裡，別再手動加'
                                                 : '支援隊伍未估（終章或章節資料缺），team_bonus_pct 不含支援，要自己加上' } : null,
          why,
          note: '單局活動P ＝ ⌊base × 歌曲倍率R/100 × (1＋加成/100)⌋ × 火倍率；協力場 base ＝ 123＋⌊(分數＋0.075×綜合力×5)/17000⌋。'
              + '分數由歌曲 metas 的 6 個技能窗推算，協力場每窗都是 1.8×隊長技能（6 次發動＝5 名玩家＋encore，隊友假設同我）。'
              + '窮舉範圍是候選池前 26 張（每角色留最佳、V 家卡按支援團分開保留）取 5 張不同角色，約 6.6 萬組全算。',
          caveats: [
            '養成一律以理論值計：滿級、已特訓、前後篇已讀、專精 MR5、技能 SL4、MySekai +7%（門 4＋數套娃 3）、卡片畫布加成滿。實際沒練滿的話綜合力與活動P都會低於這裡的數字。',
            'character_rank 只影響「角色等級技能」的檔位（例如 110%＋角色等級加成那類卡）；綜合力那邊的角色等級加成一律以滿級（rank 200 檔）計，不吃這個參數。',
            'only_my_cards 的持有清單來自站上「收集率」頁的手動勾選（存在這台瀏覽器的 localStorage），沒勾就等於沒有；它只縮小候選池，不會改變養成假設（照樣算成 MR5／滿級）。',
            '為了讓 only_my_cards 生效，呼叫期間暫時覆寫了引擎的 RunStudio._ownedOn()（它原本讀經典版頁面的 #rsOwnedOnly 勾選框，本頁沒有那個節點，不蓋掉就會永遠當成「用全部卡」）。算完已還原，過程中沒有動到任何畫面。',
            '這是「單局活動P 最大」的隊，不是「加成最大」的隊 —— 想看純加成最高的組合請看經典版跑榜工作室的「理論隊伍」模式。',
            '沒選歌（或 music_metas 沒載到）時目標會退回「綜合力×加成」，那個數字不是活動P，不能拿來估終分。',
          ].concat(src.isJP ? ['這期用的是日服 master（台服約一年後才上），卡池與加成表都可能在台服上線前改動。'] : []),
        };
      }

      case 'wl_support_bonus': {
        /* 為什麼不直接呼叫引擎現成的 WL 函式,而是照同一套規則自己算:
           EventCalc.calcWL() 讀 #wlMR / #wlSL / #wlChapter 再寫回 #ecWLResult ——
           那三個節點只存在於經典版頁面,在這裡 getElementById 回 null,取 .value 直接拋;
           EventCalc.ensureWL() 更會先 innerHTML 一個載入中的畫面。
           RunStudio._wlSupport() 雖然是純計算,但它寫死 MR5/SL4、章節只認 Date.now(),
           吃不到 chapter 參數,而且終章一律回 null。
           所以這裡只借 MasterDB(純 fetch + IndexedDB 快取,不碰 DOM),規則逐條對齊 core.js。 */
        const E = await this.ensureEngine();
        const MDB = E && E.MasterDB;
        if (!MDB) return { error: '計算引擎載入了，但取不到 MasterDB' };

        let wbAll, supTbl, limAll, cards, gcu, evCards;
        try {
          [wbAll, supTbl, limAll, cards, gcu, evCards] = await Promise.all([
            MDB.get('worldBlooms.json'),
            MDB.get('worldBloomSupportDeckBonuses.json'),
            MDB.get('worldBloomSupportDeckUnitEventLimitedBonuses.json'),
            MDB.get('cards.json'),
            MDB.get('gameCharacterUnits.json'),
            MDB.get('eventCards.json'),
          ]);
        } catch (e) { return { error: 'master data 載入失敗：' + ((e && e.message) || '') }; }
        if (!Array.isArray(wbAll) || !wbAll.length) return { error: 'worldBlooms.json 讀不到，判斷不出 WL 章節' };
        if (!Array.isArray(supTbl) || !supTbl.length) return { error: 'worldBloomSupportDeckBonuses.json 讀不到，算不了支援加成' };

        const now = Date.now();
        /* 先確定是哪一期 WL。優先序:正在跑的章節 > 當期活動剛好是 WL > 最近一期已開跑 > 下一期。
           不能只信 state.live —— 使用者常在非 WL 期間問這題,那時 live 是別種活動。 */
        if (!this.state.live) { try { await this.loadLive(); } catch (e) {} }
        const liveId = +((this.eventOf(this.state.live) || {}).id) || null;
        const ongoing = wbAll.find(w => now >= w.chapterStartAt && now <= w.aggregateAt);
        let evId, evFrom;
        if (ongoing) { evId = ongoing.eventId; evFrom = '目前進行中的 WL 章節'; }
        else if (liveId && wbAll.some(w => w.eventId === liveId)) { evId = liveId; evFrom = '當期活動'; }
        else {
          const past = wbAll.filter(w => w.chapterStartAt <= now).sort((x, y) => y.chapterStartAt - x.chapterStartAt)[0];
          const next = wbAll.filter(w => w.chapterStartAt > now).sort((x, y) => x.chapterStartAt - y.chapterStartAt)[0];
          if (past) { evId = past.eventId; evFrom = '最近一期已開跑的 WL（當期不是 WL 活動）'; }
          else if (next) { evId = next.eventId; evFrom = '下一期 WL（還沒開始）'; }
          else return { error: 'worldBlooms.json 裡沒有任何章節' };
        }
        const chs = wbAll.filter(w => w.eventId === evId).sort((x, y) => x.chapterNo - y.chapterNo);

        let ch, chFrom;
        if (a.chapter != null && String(a.chapter).trim() !== '') {
          ch = chs.find(c => c.chapterNo === +a.chapter);
          if (!ch) return { error: '#' + evId + ' 這期沒有第 ' + a.chapter + ' 章', available_chapters: chs.map(c => c.chapterNo) };
          chFrom = '指定 chapter=' + a.chapter;
        } else {
          ch = chs.find(c => now >= c.chapterStartAt && now <= c.aggregateAt)
            || (now < chs[0].chapterStartAt ? chs[0] : chs[chs.length - 1]);
          chFrom = (now >= ch.chapterStartAt && now <= ch.aggregateAt) ? '目前進行中的章節' : '最接近現在的章節';
        }
        // 終章的 gameCharacterId 在 master 裡是「整個欄位缺席」而不是 null,所以要用 == null 一起接
        const isFinale = ch.gameCharacterId == null;
        /* 終章：支援隊與一般 WL2 章節相同，只差角色限制 —— 不限團體，specific 檔（多的 5%）與 WL1 限定卡 +20
           都改成跟「主隊隊長的角色」走。沒帶隊長角色就沒有任何一張吃得到這兩項，回傳會提醒要帶 leader_character。 */
        let leaderId = null;
        if (isFinale && a.leader_character != null && String(a.leader_character).trim() !== '') {
          const q = String(a.leader_character).trim();
          if (/^\d+$/.test(q) && +q >= 1 && +q <= 26) leaderId = +q;
          else for (let i = 1; i <= 26; i++) {
            const nm = this.chNameOf(i) || '';
            if (nm && (nm === q || nm.indexOf(q) >= 0 || q.indexOf(nm) >= 0)) { leaderId = i; break; }
          }
        }
        const special = isFinale ? leaderId : ch.gameCharacterId;

        /* 角色的原生團體:V 家(id≥21)一律 piapro,人類角色查 gameCharacterUnits。
           同一個 characterId 有多筆(V 家還有各團的應援分身),取 id 最小的那筆才是原生團。 */
        const natUnit = {};
        (gcu || []).slice().sort((x, y) => x.id - y.id).forEach(g => {
          if (natUnit[g.gameCharacterId] == null) natUnit[g.gameCharacterId] = g.unit;
        });
        const nativeUnit = cid => (cid >= 21 ? 'piapro' : natUnit[cid]);
        const chUnit = isFinale ? null : nativeUnit(special);
        // 支援隊位置數依屆數(與 core.js wlSupCount 同一條判定)
        const slots = evId <= 140 ? 12 : evId <= 180 ? 20 : 25;

        /* 這一期自己的 4 張新卡不能進後排 —— 那是拿來組前排主隊的。
           master data 沒有單獨一張表寫這件事，只能從 eventCards 的活動歸屬反推。
           只排這一期;先前幾屆 WL 的卡照進，而且還帶著 limMap 的 +20，
           常常就是整個後排單張最高的一格 —— 把「團體活動限定」整類排掉會少算十幾個百分點。 */
        const banned = {};
        (evCards || []).forEach(x => { if (+x.eventId === evId) banned[+x.cardId] = 1; });

        const byRar = {}; supTbl.forEach(t => { byRar[t.cardRarityType] = t; });
        const pickRate = (arr, k, v) => { const f = (arr || []).find(o => o[k] === v); return f ? (+f.bonusRate || 0) : 0; };
        const MR_FULL = 5, SL_FULL = 4;   // MR0 與 SL1 在五種稀有度都是 0,所以「沒練」的下限＝只剩角色檔＋限定卡

        /* 前期 WL 限定卡 +20:一般章節綁 eventId＋本章主角,只有那一張吃得到。
           終章不同 —— master 把 26 位角色的 WL 卡全列在同一個 eventId 底下,
           照資料讀就是每一張都 +20。經典版 WL 頁對終章是整段跳過限定卡的,兩邊會差一截,
           所以下面 estimated 要標起來。 */
        const limMap = {};
        (limAll || []).forEach(x => {
          if (x.eventId !== evId) return;
          if (x.gameCharacterId !== special) return;   // 終章也一樣：只認隊長那一位（special＝隊長角色）
          limMap[x.cardId] = +x.bonusRate || 20;
        });

        let own = null;
        if (a.only_my_cards) {
          await this.loadCards();
          if (!this._own) { try { this.ownLoad(); } catch (e) {} }
          own = this.ownSet();
        }

        const r1 = v => Math.round(v * 10) / 10;
        const RAR_ZH = { rarity_4: '★4', rarity_birthday: '生日', rarity_3: '★3', rarity_2: '★2', rarity_1: '★1' };
        const U_KEY = { light_sound: 'ln', idol: 'mmj', street: 'vbs', theme_park: 'wxs', school_refusal: 'n25', piapro: 'vs' };
        const unitZh = u => (u && (this.UNITS[U_KEY[u]] || {}).n) || u || null;

        const rows = [];
        (cards || []).forEach(c => {
          if (banned[c.id]) return;                                  // 這一期自己的卡放前排，不進後排
          const su = (c.supportUnit && c.supportUnit !== 'none') ? c.supportUnit : null;
          const vs = c.characterId >= 21 && su === chUnit;            // V 家卡以「應援團體」進池
          if (!isFinale && nativeUnit(c.characterId) !== chUnit && !vs) return;   // 終章不限團體
          const t = byRar[c.cardRarityType]; if (!t) return;
          const isMain = special != null && c.characterId === special;   // 本章主角（終章＝主隊隊長的角色）本人才吃 specific 檔
          const chB = pickRate(t.worldBloomSupportDeckCharacterBonuses, 'worldBloomSupportDeckCharacterType', isMain ? 'specific' : 'others');
          const lim = limMap[c.id] || 0;
          const full = chB + pickRate(t.worldBloomSupportDeckMasterRankBonuses, 'masterRank', MR_FULL)
            + pickRate(t.worldBloomSupportDeckSkillLevelBonuses, 'skillLevel', SL_FULL) + lim;
          rows.push({
            id: c.id, cid: c.characterId, name: c.prefix || '', rar: c.cardRarityType,
            full: r1(full), floor: r1(chB + lim), main: isMain, lim: !!lim, vs,
            owned: own ? own.has(c.id) : null,
          });
        });
        if (!rows.length) return { error: '這一章算不出任何合格的支援卡，master data 可能不完整', event_id: evId, chapter: ch.chapterNo };

        // 每張卡的加成互不影響,所以排序取前 N 就是最優解,不必窮舉
        rows.sort((x, y) => y.full - x.full || x.id - y.id);
        const sumF = arr => r1(arr.reduce((s, r) => s + r.full, 0));
        const sumL = arr => r1(arr.reduce((s, r) => s + r.floor, 0));
        const bestAll = rows.slice(0, slots);
        const mineAll = own ? rows.filter(r => r.owned) : null;
        const bestMine = mineAll ? mineAll.slice(0, slots) : null;
        const shown = bestMine || bestAll;

        const TOPN = 15;
        const info = r => ({
          card_id: r.id, card_name: r.name, character: this.chNameOf(r.cid),
          rarity: RAR_ZH[r.rar] || r.rar,
          bonus_pct: r.full, bonus_pct_at_mr0_sl1: r.floor,
          tags: [r.main ? '本章主角' : null, r.lim ? '前期 WL 限定卡 +20' : null, r.vs ? 'V 家卡以應援團體入池' : null].filter(Boolean),
          owned: r.owned,
        });

        return {
          event_id: evId, resolved_from: evFrom,
          chapter: ch.chapterNo, chapter_resolved_from: chFrom,
          chapter_kind: isFinale ? 'finale' : 'game_character',
          chapter_character: isFinale ? null : this.chNameOf(special),
          chapter_start: new Date(ch.chapterStartAt).toISOString(),
          chapter_end: new Date(ch.aggregateAt).toISOString(),
          chapter_status: now < ch.chapterStartAt ? 'upcoming' : now <= ch.aggregateAt ? 'live' : 'ended',
          available_chapters: chs.map(c => c.chapterNo),
          support_deck_slots: slots,
          eligible_unit: isFinale ? null : unitZh(chUnit),
          estimated: isFinale && leaderId == null,
          finale_leader: isFinale ? (leaderId != null ? this.chNameOf(leaderId) : null) : undefined,
          finale_main_deck: isFinale ? {
            rule: '終章主隊：所有角色都是 5%（五張固定 25%）；WL2 限定卡每張另 +25%，最多計 4 張；稀有度與專精照一般活動，單張最多 25%（★4 MR5）；隊內異色 3／4／5 色 ＝ 75／100／125%；隊長是 WL2 限定卡 +20%；主稱號是隊長角色那一章的排名稱號（台服 T500 以內、角色要與隊長一致）+50%。',
            theory_pct: { main_deck: 375, leader: 20, title: 50, main_shown_in_game: 445, support: 370, total: 815 },
            limits: '限制以 master 為準：eventSkillScoreUpLimits（scoreUpRateLimit 是分數倍率，240＝單張技能 +140%）——撰寫時台服第 180 期寫 300＝+200%，等於不設限，日服當時是 240（滿配跑隊倍率最高 3.20、推隊 3.52）；eventMysekaiFixtureGameCharacterPerformanceBonusLimits＝玩偶的角色綜合力加成上限 2%（平常 10%，滿配綜合力約 36.15 萬）；eventCardBonusLimits＝WL2 限定卡最多計 4 張。排名報酬角色看終章期間用最多次的隊長；單場控分最低 125 pt。跑榜工作室的最佳化會自動套用這三張表。',
            where: '站上「WL 後排加成」頁選到終章那一期，就有主隊五格的逐項試算與總加成。',
          } : undefined,
          how_it_works: {
            formula: '單張支援卡加成％ = 角色檔(specific／others) ＋ 專精檔(MR) ＋ 技能等級檔(SL) ＋ 前期 WL 限定卡 20；'
              + '支援隊 ' + slots + ' 個位置各自獨立，支援加成總計 = 合格卡池裡加成最高的前 ' + slots + ' 張相加。',
            eligibility: (isFinale
              ? '終章不限團體，全卡池都能進支援隊。'
              : '合格＝卡片的「原生團體」或「應援團體」等於本章主角的原生團體（' + unitZh(chUnit) + '）。'
                + '主角是 VIRTUAL SINGER 時原生團＝piapro，等於全 V 家卡合格、人類卡全部排除。')
              + '　另外，這一期活動自己的 ' + Object.keys(banned).length + ' 張新卡不能進支援隊（那是拿來組前排主隊的），'
              + '已從候選池排除。先前幾屆 World Link 的卡不受影響，照樣可以放，而且還帶著它們那一屆的限定 +20，'
              + '常常是後排單張加成最高的一格 —— 不要把「團體活動限定」整類排掉。',
            specific_vs_others: isFinale
              ? (leaderId != null ? ('終章：只有與主隊隊長同角色（' + this.chNameOf(leaderId) + '）的卡吃 specific 檔，其餘一律 others 檔。')
                                  : '終章：specific 檔跟主隊隊長的角色走；這次沒帶 leader_character，所以全部卡都先以 others 檔計。')
              : '只有「' + this.chNameOf(special) + '」本人的卡吃 specific 檔，同團其他角色一律 others 檔。',
            rate_table: '★4：specific 12.5％／others 7.5％，MR0→5 = 0／0.5／1／1.5／2／2.5，SL1→4 = 0／0.25／1／2.5。'
              + '生日卡：10％／5％，MR 最高 2、SL 最高 2。★3：7／2。★2：6／1。★1：5.5／0.5。',
            slots_rule: '支援隊位置數依屆數：活動 id ≤140 → 12 張、≤180 → 20 張、之後 → 25 張。本期 ' + slots + ' 張。',
            why_sorting_is_optimal: '每張卡的加成彼此不影響（不看屬性、不看團體重複），所以排序取前 N 張就是最優解。',
          },
          assumptions: { master_rank: MR_FULL, skill_level: SL_FULL, note: 'bonus_pct 一律以滿配 MR5／SL4 計；bonus_pct_at_mr0_sl1 是完全沒練的下限。' },
          eligible_pool: { total_cards: rows.length, owned_cards: mineAll ? mineAll.length : null },
          top_cards: shown.slice(0, TOPN).map(info),
          top_cards_omitted: Math.max(0, Math.min(shown.length, slots) - TOPN),
          totals: {
            best_possible_pct: sumF(bestAll),
            best_possible_at_mr0_sl1_pct: sumL(bestAll),
            my_cards_pct: bestMine ? sumF(bestMine) : null,
            my_cards_at_mr0_sl1_pct: bestMine ? sumL(bestMine) : null,
            my_slots_filled: bestMine ? bestMine.length : null,
            my_slots_empty: bestMine ? Math.max(0, slots - bestMine.length) : null,
            gap_to_best_pct: bestMine ? r1(sumF(bestAll) - sumF(bestMine)) : null,
          },
          note: '這是「支援隊伍」單獨的加成％，要再加上主隊 5 張的逐卡加成與 WL 隊內異色加成（3／4／5 色 = 75／100／125％），才是活動總加成。'
            + '　MR／SL 站上拿不到，一律假設滿配 MR5／SL4，實際沒練滿會低於 bonus_pct，下限看 bonus_pct_at_mr0_sl1。'
            + (own
              ? (own.size
                ? '　only_my_cards 的持有清單來自站上「收集率」頁的手動勾選（存在這台瀏覽器），沒勾就等於沒有。'
                : '　目前一張都沒勾選，my_cards_* 全是 0；請先到「收集率」頁勾選持有卡。')
              : '　目前算的是全卡池理論最優，沒有過濾持有；要看自己實際湊得到多少請帶 only_my_cards=true。')
            + (isFinale
              ? (leaderId != null
                ? '　這是終章：支援隊不限團體；與隊長（' + this.chNameOf(leaderId) + '）同角色的卡吃 specific 檔，WL1 限定卡的 +20 也只認隊長那一位；這一期的 26 張 WL2 限定卡留給主隊。主隊怎麼算看 finale_main_deck。'
                : '　這是終章：支援加成跟主隊隊長的角色走，請問使用者隊長要放誰，再帶 leader_character 重算；沒帶的話這裡只有 others 檔的下限值。主隊怎麼算看 finale_main_deck。')
              : ''),
        };
      }

      case 'browse_cards': {
        /* 為什麼不是把 get_card_skills 加參數就好：那支是「指定幾張卡、看它的逐級技能數值」，
           而使用者在卡庫頁真正在做的是「先篩再排」——排序基準是綜合力、篩選軸是技能類型與取得類別，
           回傳欄位與分頁需求都不一樣，硬塞成一支只會兩邊都不好用。 */
        await this.loadCards();
        const idx = this.state.rateCards || [];
        if (!idx.length) return { error: '卡片索引尚未載入（' + (this.state.rateErr || '請先開啟「收集率」頁') + '）' };
        const chars = this.state.rateChars || [];
        if (!chars.length) return { error: '角色索引尚未載入，無法判斷團體，請先開啟「收集率」頁' };

        /* 技能與綜合力只有官方 master 有：cards-index.js 為了壓到 100 KB 只留了圖鑑欄位。
           載入方式照抄 get_card_skills，並刻意共用同一個 _cardSkillCache——
           同一次對話裡兩支工具只會抓一次 cards.json / skills.json。 */
        const DB = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-tc-diff/main';
        if (!this._cardSkillCache) {
          try {
            const [mc, ms] = await Promise.all([
              fetch(DB + '/cards.json').then(r => r.json()),
              fetch(DB + '/skills.json').then(r => r.json()),
            ]);
            const byId = {}; ms.forEach(k => { byId[k.id] = k; });
            this._cardSkillCache = { cards: mc, skills: byId };
          } catch (e) { return { error: '官方卡片／技能資料載入失敗：' + (e.message || '') }; }
        }
        const { cards: mcards, skills } = this._cardSkillCache;
        if (!mcards || !mcards.length) return { error: '官方卡片資料是空的，取不到技能與綜合力' };
        const mById = {}; mcards.forEach(c => { mById[c.id] = c; });

        /* 分類表照抄 core.js 的 CardModule.SKILL_CAT —— 那份就是站上卡庫頁在用的分類，
           照抄才不會出現「AI 講的類型和卡庫頁標的不一樣」。它掛在 CardModule 底下，
           而 ensureEngine() 取得到的清單裡沒有 CardModule，所以只能複製不能引用。
           skills.json 目前只到 24（沒有 20／21）；表以外的 skillId 歸「其他」，
           不像 core.js 那樣預設塞進「分數提升」——免得日後的新技能被默默講成大分卡。 */
        const SKILL_CAT = {
          1: 'score', 2: 'score', 3: 'score', 4: 'score',
          5: 'judge', 6: 'judge', 7: 'judge',
          8: 'heal', 9: 'heal', 10: 'heal',
          11: 'perfect', 12: 'cfes_life', 13: 'good', 14: 'birthday',
          15: 'unit', 16: 'unit', 17: 'unit', 18: 'unit', 19: 'unit',
          22: 'bfes_char', 23: 'bfes_ref', 24: 'bfes_vs',
        };
        const CAT_NAME = {
          score: '分數提升', judge: '判定強化', heal: '體力回復', perfect: 'P分',
          cfes_life: '七彩血分', good: '七彩GOOD以上', birthday: '生日', unit: '團分',
          bfes_char: '絢爛角色', bfes_ref: '絢爛吸技', bfes_vs: '絢爛虛擬', other: '其他',
        };
        // 玩家講的是圈內叫法（奶卡／判卡／大分／吸技），比對不到就回錯誤並附完整清單
        const CAT_ALIAS = {
          score: ['score', '分數提升', '大分', '大分卡', '一般分數加成', '普通分'],
          judge: ['judge', '判定強化', '判卡', '判分', 'bad轉perfect', '判定'],
          heal: ['heal', '體力回復', '奶卡', '回血', '治癒', '回復', 'life'],
          perfect: ['perfect', 'p分', 'p分卡', 'perfect分數加成', 'p卡'],
          cfes_life: ['cfes_life', '七彩血分', '血分', 'cfes血分', 'cfes', '體力型'],
          good: ['good', '七彩good以上', 'good以上', 'keep', '判定保持'],
          birthday: ['birthday', '生日', '生日卡', 'bd'],
          unit: ['unit', '團分', '同團加分', '同團'],
          bfes_char: ['bfes_char', '絢爛角色', 'bfes角色', 'bloomfes角色', '角色等級型'],
          bfes_ref: ['bfes_ref', '絢爛吸技', '吸技', 'bfes吸技', '吸取隊友'],
          bfes_vs: ['bfes_vs', '絢爛虛擬', 'bfes虛擬', '虛擬', '外團型', '異團型'],
        };

        const ATTR = ['cool', 'happy', 'mysterious', 'cute', 'pure'];
        const nz = v => String(v == null ? '' : v).trim().toLowerCase();
        const uOf = {}, fullOf = {};
        chars.forEach(c => { uOf[c[0]] = this.UNIT_OF[c[2]] || 'vs'; fullOf[c[0]] = c[1]; });
        // 有支援團的 V 家卡要算進支援團，和收集率頁／get_missing_cards 同一套規則
        const unitOf = c => (c[5] >= 0 ? this.UNIT_OF[c[5]] : uOf[c[1]]) || 'vs';

        /* ---- 參數正規化（與 get_missing_cards 同一套）：
               比對不到一律回錯誤，不要靜靜當成「不篩」而回整本圖鑑 ---- */
        let cat = null;
        if (nz(a.skill_type) && nz(a.skill_type) !== 'all' && nz(a.skill_type) !== '全部') {
          const q = nz(a.skill_type).replace(/[\s★☆*（）()]/g, '');
          cat = Object.keys(CAT_ALIAS).find(k => k === q
            || nz(CAT_NAME[k]).replace(/\s/g, '') === q
            || (CAT_ALIAS[k] || []).some(x => nz(x) === q)) || null;
          if (!cat) return { error: '不認得技能類型「' + a.skill_type + '」',
            available_skill_types: Object.keys(CAT_NAME).map(k => k + '（' + CAT_NAME[k] + '）') };
        }

        let unit = null;
        if (nz(a.unit) && nz(a.unit) !== 'all' && nz(a.unit) !== '全部') {
          const q = nz(a.unit).replace(/[\s／/]/g, '');
          const UAL = {
            ln: ['ln', 'leoneed', 'leo/need', '萊歐尼德', '萊歐'],
            mmj: ['mmj', 'moremorejump', 'morejump', '摩摩'],
            vbs: ['vbs', 'vividbadsquad', 'vivid'],
            wxs: ['wxs', 'ws', 'wonderlands', 'wonderlandsxshowtime', 'wonderlands×showtime', 'ワンダショ'],
            n25: ['n25', '25', '25時', 'ニーゴ', 'niigo', '25時、ナイトコードで。'],
            vs: ['vs', 'virtualsinger', 'vsinger', '虛擬歌手', '無副團', 'piapro', 'v家'],
          };
          unit = Object.keys(this.UNITS).find(k => {
            if (k === q) return true;
            const n = nz((this.UNITS[k] || {}).n).replace(/[\s／/]/g, '');
            if (n === q || (q.length >= 2 && n.indexOf(q) >= 0)) return true;
            return (UAL[k] || []).some(x => nz(x).replace(/[\s／/]/g, '') === q);
          }) || null;
          if (!unit) return { error: '不認得團體「' + a.unit + '」',
            available_units: Object.keys(this.UNITS).map(k => k + '（' + this.UNITS[k].n + '）') };
        }

        let rarity = null;
        if (nz(a.rarity) && nz(a.rarity) !== 'all' && nz(a.rarity) !== '全部') {
          const q = nz(a.rarity).replace(/[★☆*\s]/g, '').replace(/星$/, '');
          const RM = { '1': 1, '一': 1, '2': 2, '二': 2, '3': 3, '三': 3, '4': 4, '四': 4,
                       '9': 9, '生日': 9, '生日卡': 9, '生日限定': 9, 'birthday': 9, 'bd': 9 };
          rarity = RM[q] == null ? null : RM[q];
          if (rarity == null) return { error: '不認得稀有度「' + a.rarity + '」',
            available_rarities: this.RARITY.map(r => r[1]) };
        }

        let supply = null;
        if (nz(a.supply) && nz(a.supply) !== 'all' && nz(a.supply) !== '全部') {
          const q = nz(a.supply);
          const SUPPLY_CODE = ['normal', 'birthday', 'term_limited', 'colorful_festival_limited',
                               'bloom_festival_limited', 'unit_event_limited', 'collaboration_limited'];
          let i = this.SUPPLYN.findIndex(nm => nz(nm) === q);
          if (i < 0) i = SUPPLY_CODE.findIndex(cd => cd === q);
          if (i < 0) i = this.SUPPLYN.findIndex(nm => q.length >= 2 && nz(nm).indexOf(q) >= 0);
          if (i < 0) return { error: '不認得取得類別「' + a.supply + '」', available_supplies: this.SUPPLYN.slice() };
          supply = i;
        }

        let charId = null;
        if (a.character != null && String(a.character).trim() !== '') {
          const t = String(a.character).trim();
          if (/^\d+$/.test(t)) charId = +t;
          else {
            if (this.CHARA_ID[t]) charId = this.CHARA_ID[t];
            if (!charId) { const h = chars.find(c => c[1] === t) || chars.find(c => String(c[1]).indexOf(t) >= 0); if (h) charId = h[0]; }
            if (!charId) { const k = Object.keys(this.CHARA_ID).find(n => t.indexOf(n) >= 0); if (k) charId = this.CHARA_ID[k]; }
          }
          if (!charId || !chars.some(c => c[0] === charId)) return { error: '不認得角色「' + t + '」',
            available_characters: chars.map(c => c[1]) };
        }

        let attr = null;
        if (nz(a.attribute) && nz(a.attribute) !== 'all' && nz(a.attribute) !== '全部') {
          const q = nz(a.attribute);
          let i = ATTR.indexOf(q);
          if (i < 0) i = ATTR.findIndex(x => nz(this.ATTR_ZH[x]) === q);
          if (i < 0) return { error: '不認得屬性「' + a.attribute + '」',
            available_attributes: ATTR.map(x => this.ATTR_ZH[x]) };
          attr = i;
        }

        /* 刻意不提供「依 cards-index 卡池旗標篩選」的參數：那個旗標會過期（理由見下面 live_pools），
           開出來只會被當成「抽不抽得到」誤用。要問抽不抽得到一律走 live_pools。 */
        const LIVE = ['off', 'annotate', 'only'].indexOf(nz(a.live_pools)) >= 0 ? nz(a.live_pools) : 'off';

        /* only_owned 讀的是「收集率」頁的手動勾選（localStorage）。
           loadCards() 只有真的去載卡片那一次才會順便 ownLoad()，卡片已在記憶體時要自己補讀，
           否則 ownSet() 會回一個空 Set，把「還沒讀持有清單」誤判成「一張都沒有」。 */
        if (!this._own) this.ownLoad();
        const own = this.ownSet();
        const onlyOwned = !!a.only_owned;
        if (onlyOwned && !own.size) return { error: '「收集率」頁一張都還沒勾選，只看持有卡會是空的。'
          + '持有清單只存在這台瀏覽器（公開 API 抓不到完整持有），請先去勾，或把 only_owned 拿掉。' };

        /* ---- 現在正開著的卡池（live_pools ≠ off 才抓）----
           為什麼要另外抓 gachas.json 而不是用 cards-index 的「卡池可得」旗標：
           那個旗標是建置時掃 gachas.json 算的，而 gachas.json 只是一份約 70 個池的「滾動視窗」，
           不是完整歷史 —— 池輪出視窗後旗標就再也不會被補回來。實測 BLOOM FES 的 12 張卡
           在索引裡全部標 false，但它們現在確實在 gachas.json 的 gachaDetails 裡。
           所以「現在抽不抽得到」只能靠現抓，旗標只能當弱參考。
           代價是 gachas.json 約 4.5 MB，所以預設不抓，並且抓到就快取 30 分鐘。 */
        let live = null;
        if (LIVE !== 'off') {
          const fresh = this._gachaLive && (Date.now() - this._gachaLive.at < 1800000);
          if (!fresh) {
            try {
              const gs = await fetch(DB + '/gachas.json').then(r => r.json());
              const now = Date.now(), byCard = {};
              (gs || []).forEach(g => {
                const st = +g.startAt || 0, en = +g.endAt || 0;
                if (!(st <= now && now <= en)) return;
                (g.gachaDetails || []).forEach(d => {
                  if (!d.cardId) return;
                  (byCard[d.cardId] = byCard[d.cardId] || []).push({ name: g.name || ('#' + g.id), type: g.gachaType || '', end: en });
                });
              });
              this._gachaLive = { at: Date.now(), byCard: byCard, pools: (gs || []).filter(g => (+g.startAt || 0) <= now && now <= (+g.endAt || 0)).length };
            } catch (e) { return { error: '卡池資料載入失敗，無法判斷現在抽不抽得到：' + (e.message || '') }; }
          }
          live = this._gachaLive;
        }

        /* Lv.4 技能% 的取法與 get_card_skills 同一套規則：base＝保底值、max＝條件拉滿值。
           逐級明細（Lv.1～4）仍請用 get_card_skills，這裡只回 Lv.4 兩個數，避免一次列 20 張就爆掉。
           只取第一個效果會低估的組合：
             score_up + score_up_character_rank  110% 起，角色等級每 2 級 +1%，滿級 +50 → 160%
             score_up + score_up_unit_count      90% 起，每 1 種外團 +30%，最多 2 種 → 150%
             score_up + skillEnhance(同團)       100% 起，每位同團 +10%、全員同團再 +10 → 150%
             score_up_condition_life / _keep     整串本身就是完整值，第一條是拉滿、最後一條是保底 */
        const skillOf = card => {
          const sk = card && skills[card.skillId];
          if (!sk) return null;
          const effs = sk.skillEffects || [];
          const of = t => effs.filter(e => (e.skillEffectType || '') === t);
          const at = (e, lv) => { const d = (e && e.skillEffectDetails) || [];
            const f = d.find(x => x.level === lv) || d[d.length - 1]; return f ? +f.activateEffectValue : 0; };
          const durOf = e => { const d = (e && e.skillEffectDetails) || [];
            const f = d.find(x => x.level === 4) || d[d.length - 1]; return f ? f.activateEffectDuration : null; };
          const life = of('score_up_condition_life'), keep = of('score_up_keep');
          const plain = of('score_up'), rank = of('score_up_character_rank');
          const ucnt = of('score_up_unit_count'), ref = of('other_member_score_up_reference_rate');
          const enh = effs.map(e => e.skillEnhance).find(Boolean);
          let baseEff = null, maxEff = null, add = 0, note = '';
          if (life.length || keep.length) {
            const arr = life.length ? life : keep;
            maxEff = arr[0]; baseEff = arr[arr.length - 1];
            note = life.length ? '體力越高越接近上限（協力滿血可視為上限）' : '判定保持 GOOD 以上才是上限值';
          } else if (plain.length) {
            baseEff = plain[0]; maxEff = plain[0];
            if (enh && /sub_unit_score_up/.test(enh.skillEnhanceType || '')) {
              const per = +enh.activateEffectValue || 0; add = per * 5;
              note = '除自己外每 1 位同團成員 +' + per + '%（最多 4 位），全員同團再 +' + per + '%';
            } else if (rank.length) {
              add = Math.max.apply(null, rank.map(e => at(e, 4)));
              note = '角色等級每 2 級 +1%，滿級達上限';
            } else if (ucnt.length) {
              add = Math.max.apply(null, ucnt.map(e => at(e, 4)));
              note = '編組內每有 1 種外團 +30%，最多 2 種';
            } else if (ref.length) {
              note = '另外取隊上隨機 1 人技能上限的 ' + Math.max.apply(null, ref.map(e => at(e, 4))) + '%，實際值看隊伍';
            }
          } else return null;
          const heal = of('life_recovery'), judge = of('judgment_up');
          return {
            base: at(baseEff, 4), max: at(maxEff, 4) + add, duration: durOf(baseEff), note: note,
            heal: heal.length ? at(heal[0], 4) : null,
            judge_dur: judge.length ? durOf(judge[0]) : null,
          };
        };

        /* 滿級綜合力＝三維最後一級相加，★3／★4 再加特訓加成 ——
           與站上「卡片技能庫」頁顯示的「最大綜合力」同一算法（core.js 的 CardModule.maxPower），
           數字才對得上使用者眼前的畫面。刻意不含前後篇／專精／角色等級／區域道具／豆森：
           那些是帳號狀態而不是卡本身的屬性，要含那些請用 calc_team_power。 */
        const powerOf = card => {
          const p = (card && card.cardParameters) || {};
          const last = arr => (Array.isArray(arr) && arr.length ? (+arr[arr.length - 1] || 0) : 0);
          let s = last(p.param1) + last(p.param2) + last(p.param3);
          if (!s) return null;
          if (card.cardRarityType === 'rarity_3' || card.cardRarityType === 'rarity_4') {
            s += (card.specialTrainingPower1BonusFixed || 0)
               + (card.specialTrainingPower2BonusFixed || 0)
               + (card.specialTrainingPower3BonusFixed || 0);
          }
          return s;
        };

        /* 取得類別本身就是「這張卡走哪種池」的可靠答案（它是卡的固有屬性），
           所以 gacha_status／availability 只看 supply 與稀有度，不摻那個會過期的卡池旗標。 */
        const STATUS = ['permanent', 'birthday_only', 'limited_rerun', 'limited_rerun',
                        'limited_rerun', 'limited_rerun', 'collab_limited'];
        const AVAIL = [
          '常駐，常駐池隨時抽得到',
          '生日限定，只在該角色生日期間的生日池（每年生日會復刻）',
          '期間限定，只有當期池或之後的復刻池',
          '彩FES 限定，只在 Colorful Festival 池',
          'BLOOM FES 限定，只在 Bloom Festival 池',
          '團體活動限定，只在對應的團體活動池',
          '聯動限定，聯動結束後不一定會再開',
        ];
        const statusOf = c => (c[2] === 1 ? 'not_from_gacha' : (STATUS[c[4]] || 'unknown'));
        const availOf = c => (c[2] === 1 ? '★1 初始卡，不是抽的（新手／任務取得）'
                                        : (AVAIL[c[4]] || '取得方式不明'));

        /* ---- 篩選 ---- */
        const minPw = a.min_power == null ? null : (+a.min_power || 0);
        const rows = [];
        let catInLibrary = 0;
        idx.forEach(c => {
          const m = mById[c[0]] || null;
          const g = m ? (SKILL_CAT[m.skillId] || 'other') : null;
          if (cat && g === cat) catInLibrary++;         // 用來分辨「條件寫錯」和「台服還沒實裝這種卡」
          if (unit && unitOf(c) !== unit) return;
          if (rarity != null && c[2] !== rarity) return;
          if (supply != null && c[4] !== supply) return;
          if (charId != null && c[1] !== charId) return;
          if (attr != null && c[3] !== attr) return;
          if (onlyOwned && !own.has(c[0])) return;
          if (cat && g !== cat) return;
          const pw = powerOf(m);
          if (minPw != null && !(pw != null && pw >= minPw)) return;
          const op = live ? (live.byCard[c[0]] || []) : null;
          if (LIVE === 'only' && !(op && op.length)) return;
          rows.push({ c: c, m: m, g: g, pw: pw, sk: skillOf(m), op: op });
        });

        /* ---- 排序：預設滿級綜合力由高到低。
               綜合力／技能取不到值的卡（master 還沒收錄）一律沉到最後，
               不要讓 null 排到第一名假裝自己是最強卡。 ---- */
        const SORTS = ['power', 'skill', 'newest', 'oldest'];
        const sort = SORTS.indexOf(nz(a.sort)) >= 0 ? nz(a.sort) : 'power';
        const rel = x => (x.m && +x.m.releaseAt) || 0;
        const pwv = x => (x.pw == null ? -1 : x.pw);
        rows.sort((x, y) => {
          if (sort === 'newest') return (rel(y) - rel(x)) || (y.c[0] - x.c[0]);
          if (sort === 'oldest') return (rel(x) - rel(y)) || (x.c[0] - y.c[0]);
          if (sort === 'skill') {
            const sx = x.sk ? x.sk.max : -1, sy = y.sk ? y.sk.max : -1;
            return (sy - sx) || (pwv(y) - pwv(x)) || (x.c[0] - y.c[0]);
          }
          return (pwv(y) - pwv(x)) || (x.c[0] - y.c[0]);
        });

        let lim = a.limit == null ? 20 : Math.round(+a.limit);
        if (!(lim > 0)) lim = 20;                      // 0／負數／NaN 一律當沒給，不要縮成 1 張
        const limit = Math.min(60, lim);
        const offset = Math.max(0, a.offset == null ? 0 : Math.round(+a.offset) || 0);
        const page = rows.slice(offset, offset + limit);

        const RN = {}; this.RARITY.forEach(r => { RN[r[0]] = r[1]; });
        const out = page.map(x => {
          const c = x.c, sk = x.sk;
          const o = {
            card_id: c[0],
            card_name: c[7] || '',
            character: fullOf[c[1]] || this.chNameOf(c[1]),
            unit: (this.UNITS[unitOf(c)] || {}).n || unitOf(c),
            rarity: RN[c[2]] || String(c[2]),
            attribute: this.ATTR_ZH[ATTR[c[3]]] || String(c[3]),
            supply: this.SUPPLYN[c[4]] || '',
            support_unit: c[5] >= 0 ? ((this.UNITS[this.UNIT_OF[c[5]]] || {}).n || null) : null,
            power_max_level: x.pw,
            skill_type: x.g ? CAT_NAME[x.g] : null,
            skill_name: (x.m && x.m.cardSkillName) || null,
            skill_base_percent: sk ? sk.base : null,
            skill_max_percent: sk ? sk.max : null,
            skill_duration_s: sk ? sk.duration : null,
            gacha_status: statusOf(c),
            availability: availOf(c),
          };
          if (sk && sk.note) o.skill_condition = sk.note;
          if (sk && sk.heal != null) o.skill_heal_life = sk.heal;              // 回復量，單位＝體力點
          if (sk && sk.judge_dur != null) o.judge_duration_s = sk.judge_dur;   // Bad 以上轉 PERFECT 的秒數
          if (live) {
            o.obtainable_now = !!(x.op && x.op.length);
            if (x.op && x.op.length) o.open_pools = x.op.slice(0, 3).map(p => p.name);
          }
          if (own.size) o.owned = own.has(c[0]);
          return o;
        });

        const cnt = keyf => { const m = {}; rows.forEach(x => { const k = keyf(x); if (k != null) m[k] = (m[k] || 0) + 1; }); return m; };
        const bySkill = cnt(x => x.g), bySup = cnt(x => x.c[4]);
        const pws = rows.map(pwv).filter(v => v >= 0);

        let head;
        if (!rows.length && cat && !catInLibrary) {
          head = '「' + CAT_NAME[cat] + '」這個技能類型台服 master 目前一張卡都沒有（不是篩選條件寫錯）。'
            + '例如絢爛角色（BloomFES 角色等級型）台服就還沒實裝。';
        } else if (!rows.length) {
          head = '這個篩選條件下沒有任何卡片，可能是條件組合本身就不存在（例如 ★3 沒有限定卡、生日技能只出現在生日卡）。';
        } else if (!page.length) {
          head = 'offset ' + offset + ' 已經超過符合條件的 ' + rows.length + ' 張，請把 offset 調小。';
        } else {
          head = 'cards 是套用篩選後、依 sort（' + sort + '）完整排序的第 ' + (offset + 1) + '～'
            + (offset + page.length) + ' 名，不是抽樣；符合條件共 ' + rows.length
            + ' 張，要看更多請調 limit（上限 60）或用 offset 續取，不要重複用小批次拼湊。';
        }

        return {
          filter: {
            skill_type: cat ? CAT_NAME[cat] : '全部',
            unit: unit ? (this.UNITS[unit] || {}).n : '全部',
            rarity: rarity == null ? '全部' : (RN[rarity] || String(rarity)),
            character: charId == null ? '全部' : (fullOf[charId] || this.chNameOf(charId)),
            attribute: attr == null ? '全部' : this.ATTR_ZH[ATTR[attr]],
            supply: supply == null ? '全部' : this.SUPPLYN[supply],
            only_owned: onlyOwned, live_pools: LIVE,
            min_power: minPw, sort: sort,
          },
          library_total: idx.length,
          matched_total: rows.length,
          returned: page.length,
          offset: offset,
          has_more: offset + page.length < rows.length,
          power_range: pws.length ? { min: Math.min.apply(null, pws), max: Math.max.apply(null, pws) } : null,
          open_pool_count: live ? live.pools : undefined,
          matched_by_skill_type: Object.keys(bySkill).sort((p, q) => bySkill[q] - bySkill[p])
            .map(k => ({ skill_type: CAT_NAME[k] || k, count: bySkill[k] })),
          matched_by_supply: Object.keys(bySup).sort((p, q) => bySup[q] - bySup[p])
            .map(k => ({ supply: this.SUPPLYN[k] || k, count: bySup[k] })),
          cards: out,
          note: head
            + '　power_max_level＝滿等三維（param1＋param2＋param3 的最後一級）相加，★3／★4 再加特訓加成，'
            + '單位是綜合力點數，與站上「卡片技能庫」頁的「最大綜合力」同一算法。'
            + '注意：同稀有度的卡基礎綜合力幾乎一樣（本次結果的 power_range 就是全距），'
            + '所以「誰比較強」實際上是看技能與活動加成，不是看綜合力——不要只憑 power_max_level 推薦卡。'
            + '它不含前後篇、專精、角色等級、區域道具、豆森；要換算：前後篇已讀 ★4 +2550／生日 +2370／'
            + '★3 +2100／★2 +1350／★1 +900，專精每 1 級 ★4 +600／生日 +540／★3 +450／★2 +300／★1 +150；'
            + '要精算整隊請用 calc_team_power。'
            + '　skill_base_percent／skill_max_percent 都是技能 Lv.4：base 是保底、max 是條件拉滿'
            + '（絢爛角色＝角色等級滿、絢爛虛擬＝湊滿 2 種外團、團分＝全隊同團、七彩血分＝滿血、'
            + '七彩GOOD以上＝判定保持 GOOD 以上）；絢爛吸技要看隊友技能，單看一張卡算不死，'
            + '條件都寫在 skill_condition。逐級（Lv.1～4）明細請用 get_card_skills。'
            + '　availability／gacha_status 只依卡片的取得類別判斷——那是卡的固有屬性，不會過期。'
            + (live
                ? '　obtainable_now 是現抓 gachas.json 算的：現在有 ' + live.pools
                  + ' 個池開著，open_pools 是收錄這張卡且正開著的池名（新手限定／任務／選擇清單池也算在內，'
                  + '一般玩家不一定抽得到，請看池名判斷）。'
                : '　「現在正開著哪些池」預設沒查——要精確回答「這張現在還抽不抽得到」請帶 live_pools:"annotate"'
                  + '（或 "only" 只留現在抽得到的），它會現抓卡池資料。'
                  + '也不要拿別的工具（例如 get_missing_cards）的 in_gacha_pool 當答案：那份是建置索引時掃 gachas.json 算的，'
                  + '而 gachas.json 只是約 70 個池的滾動視窗不是完整歷史，池輪出後旗標不會補回，'
                  + '實測 BLOOM FES 的 12 張全被標成「無卡池紀錄」。')
            + '　unit 的歸屬優先看卡片的支援團，所以 V 家角色的團體卡會算進該團而不是 VIRTUAL SINGER。'
            + (own.size ? '　owned 來自站上「收集率」頁的手動勾選（只存在這台瀏覽器）。' : ''),
        };
      }

      case 'gacha_simulate': {
        /* 為什麼借 core.js 的 GachaSim 而不自己寫一套抽卡:
           官方的模型不是「★4 3%」那麼單純 —— 是「先依 gachaCardRarityRates 抽稀有度,
           再在該稀有度的卡池內依 gachaDetails[].weight 加權抽一張」。PU 的 weight 被官方
           調成剛好 0.4%/張(實測 #846:PU weight 400000 / ★4 總權重 2999864 × 3% = 0.40002%),
           十連的 ★3 保底也是「佔掉第 10 抽」而不是額外加送一張。這些 gachasim 頁那支
           已經照 master data 實作並對過官方公告的機率,重寫等於再踩一次同樣的坑。
           GachaSim 沒被 ensureEngine 收進取用清單,但它跟 MasterDB 一樣是 core.js 的頂層
           const,用同一招 new Function 就取得到。 */
        const E = await this.ensureEngine();
        const gPick = n => { try { return new Function('return typeof ' + n + ' !== "undefined" ? ' + n + ' : null')(); } catch (e) { return null; } };
        const GS = E.GachaSim || (E.GachaSim = gPick('GachaSim'));
        if (!GS) return { error: '計算引擎載入了，但取不到 GachaSim（抽卡模擬器）' };
        const cidName = E.EC_cidName || (E.EC_cidName = gPick('EC_cidName')) || (id => '#' + id);

        // _load 會併台服 + 日服的 gachas/cards(日服是為了台服還沒實裝的未來池),回 { gById, cById, list, twIds, stdPool }
        let D;
        try { D = await GS._load(); } catch (e) { return { error: '卡池 master data 載入失敗：' + (e.message || '請稍後再試') }; }
        if (!D || !(D.list || []).length) return { error: '卡池 master data 載入了，但沒有任何含機率表的卡池' };

        // 預設要挑「台服的」當期池;D.list 是台日混合的,直接取 list[0] 會挑到日服的未來池
        let twGid = null;
        try { const tw = await E.MasterDB.get('gachas.json'); twGid = new Set((tw || []).map(x => x.id)); } catch (e) {}

        const now = Date.now();
        const q = String(a.gacha == null ? '' : a.gacha).trim();
        let g;
        if (q) {
          g = GS._find(q);   // 純數字＝卡池 id 完全比對,否則卡池名稱模糊比對
          if (!g) return { error: '找不到卡池「' + q + '」。可給卡池 id（數字）或名稱關鍵字，例如「倒映在眼裡的花束」「HAPPY BIRTHDAY」。' };
        } else {
          const twList = D.list.filter(x => !twGid || twGid.has(x.id));
          g = twList.find(x => x.startAt <= now && x.endAt >= now) || twList.find(x => x.startAt <= now) || D.list[0];
        }
        if (!g) return { error: '取不到可模擬的卡池' };

        GS._g = g; GS._reset();
        const P = GS._pool;
        if (!P || !(P.rates || []).length) return { error: '第 ' + g.id + ' 號卡池（' + (g.name || '') + '）沒有機率表，無法模擬' };

        const RN = { rarity_1: '★1', rarity_2: '★2', rarity_3: '★3', rarity_4: '★4', rarity_birthday: '生日' };
        const KEY = { jewel: 'jewel', paid_jewel: 'paid_jewel', gacha_ticket: 'ticket' };
        const fdt = ms => { try { return new Date(ms).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }); } catch (e) { return null; } };

        /* ---- 官方機率模型 ---- */
        // 同一稀有度可能有兩列(例:5週年 FES 把 ★4 拆成 2.8%+3.2%),要先合併再比對
        const rateBy = {};
        P.rates.forEach(r => { rateBy[r.cardRarityType] = (rateBy[r.cardRarityType] || 0) + r.rate; });
        const rarityRows = Object.keys(rateBy).map(k => ({
          key: k, rarity: RN[k] || k,
          official_rate_pct: +rateBy[k].toFixed(4),
          pool_cards: ((P.byRar[k] || {}).items || []).length,
        })).sort((x, y) => GS._rank(y.key) - GS._rank(x.key) || y.official_rate_pct - x.official_rate_pct);

        const pickup = [...P.pick].map(id => {
          const c = D.cById[id]; if (!c) return null;
          const k = c.cardRarityType, grp = P.byRar[k] || {};
          const it = (grp.items || []).find(i => i.cardId === id);
          const p = (it && grp.total) ? (rateBy[k] || 0) * it.w / grp.total : null;
          return { card_id: id, name: c.prefix || ('#' + id), character: cidName(c.characterId),
            rarity: RN[k] || k, rate_pct: p == null ? null : +p.toFixed(4),
            weight: it ? it.w : null, in_tw_master: D.twIds.has(id) };
        }).filter(Boolean).sort((x, y) => (y.rate_pct || 0) - (x.rate_pct || 0));

        // 非 PU ★4 每張的平均機率 —— 用來回答「歪掉的話會歪到什麼」
        let nonPuEach = null;
        const g4 = P.byRar.rarity_4;
        if (g4 && g4.items.length && g4.total) {
          const puW = g4.items.filter(i => P.pick.has(i.cardId)).reduce((s, i) => s + i.w, 0);
          const nN = g4.items.filter(i => !P.pick.has(i.cardId)).length;
          if (nN) nonPuEach = +((rateBy.rarity_4 || 0) * (g4.total - puW) / g4.total / nN).toFixed(5);
        }

        /* ---- 可用抽法(照官方 gachaBehaviors,去重) ---- */
        const methods = [], behs = [], byKey = {}, seenM = new Set();
        (g.gachaBehaviors || []).filter(b => b.spinCount).forEach(b => {
          const ct = b.costResourceType || '', bt = b.gachaBehaviorType || '';
          const key = (ct ? (KEY[ct] || ct) : 'free') + '_' + b.spinCount;
          if (seenM.has(key)) return; seenM.add(key);
          const gr = /over_rarity_4/.test(bt) ? 4 : /over_rarity_3/.test(bt) ? 3 : 0;
          // 免費抽官方就是沒有 costResourceType/Quantity(null),不能直接串字串
          const label = (!ct || b.costResourceQuantity == null)
            ? (/once_a_week/.test(bt) ? '通行證每週免費' : /once_a_day/.test(bt) ? '通行證每日免費' : '免費')
            : ct === 'paid_jewel' ? ('付費水晶 ' + b.costResourceQuantity + '（只吃有償石）')
            : ct === 'jewel' ? (b.costResourceQuantity + ' 水晶')
            : (b.costResourceQuantity + ' 張招募券');
          const m = { key, spin_count: b.spinCount, cost_type: ct || null,
            cost_quantity: b.costResourceQuantity == null ? null : b.costResourceQuantity,
            cost_label: label, paid_jewel_only: ct === 'paid_jewel',
            guarantee: gr === 4 ? '最後一抽必中 ★4' : gr === 3 ? '最後一抽保底 ★3 以上' : null,
            guarantee_rank: gr, execute_limit: b.executeLimit || null, behavior_type: bt || null };
          methods.push(m); behs.push(b); byKey[key] = { m, b };
        });
        if (!methods.length) return { error: '第 ' + g.id + ' 號卡池沒有抽法資料（gachaBehaviors 是空的）' };

        let mk = a.method ? String(a.method).trim() : '';
        if (mk && !byKey[mk]) return { error: '這個卡池沒有「' + mk + '」這種抽法。可用：' + methods.map(m => m.key).join('／') };
        if (!mk) mk = ['jewel_10', 'jewel_1', 'ticket_10', 'ticket_1', 'paid_jewel_10', 'paid_jewel_1'].find(k => byKey[k]) || methods[0].key;
        const M = byKey[mk];

        const pulls = Math.max(1, Math.min(3000, Math.round(+a.pulls || 300)));
        const batches = Math.floor(pulls / M.b.spinCount);
        let rem = pulls % M.b.spinCount;
        // 餘數用「同幣別的單抽」補;該池沒有單抽就無條件捨去並在 note 說明
        const remKey = (M.m.cost_type ? (KEY[M.m.cost_type] || M.m.cost_type) : 'free') + '_1';
        const RM = (rem && byKey[remKey] && byKey[remKey].b.spinCount === 1) ? byKey[remKey] : null;
        if (!RM) rem = 0;
        const actual = batches * M.b.spinCount + rem;
        if (!actual) return { error: 'pulls=' + pulls + ' 不足一次「' + mk + '」（一次 ' + M.b.spinCount + ' 抽），請調高 pulls 或改用單抽的 method' };

        /* ---- 天井:抽數要從 gachaCeilExchangeSummaries 反查,不是一律 300 ----
           #801 Recollection Festival 是 200,生日池是 100,寫死 300 會錯。 */
        let ceiling = { has_ceiling: false, note: '此卡池沒有天井（沒有招募貼紙）' };
        if (g.gachaCeilItemId) {
          let need = null, sub = null, itemName = null, from = 'master';
          try {
            const [items, sums] = await Promise.all([
              E.MasterDB.get('gachaCeilItems.json'), E.MasterDB.get('gachaCeilExchangeSummaries.json')]);
            const it = (items || []).find(x => x.id === g.gachaCeilItemId);
            itemName = it ? it.name : null;
            (sums || []).forEach(su => (su.gachaCeilExchanges || []).forEach(ex => {
              const c = ex.gachaCeilExchangeCost || {};
              if (c.resourceType !== 'gacha_ceil_item' || c.resourceId !== g.gachaCeilItemId) return;
              if (need == null || c.quantity > need) {   // 同一張貼紙還能換素材/心願碎片(1、10 張),換成員的才是天井＝最大那筆
                need = c.quantity;
                const sc = (ex.gachaCeilExchangeSubstituteCosts || [])[0];
                sub = sc ? { per_ticket_stickers: sc.substituteQuantity, max_tickets: ex.substituteLimit || 0 } : null;
              }
            }));
          } catch (e) { from = 'fallback'; }
          if (need == null) { need = rateBy.rarity_birthday ? 100 : 300; from = 'fallback'; sub = null; }
          ceiling = { has_ceiling: true, sticker_name: itemName, pulls_needed: need,
            crystals_needed: need * 300, derived_from: from,
            exchange_ticket: sub ? { per_ticket_stickers: sub.per_ticket_stickers, max_tickets: sub.max_tickets,
              min_pulls_with_tickets: Math.max(0, need - sub.per_ticket_stickers * sub.max_tickets) } : null,
            note: '每抽到 1 位成員得 1 張貼紙；' + need + ' 張可在該池交換所指定換一名成員'
              + (sub ? ('。限定招募貼紙交換券 1 張抵 ' + sub.per_ticket_stickers + ' 張、最多 ' + sub.max_tickets + ' 張') : '（此池不可用交換券）') };
        }

        /* ---- 招募點數(gachaBonusPoints):付費水晶 1 點、免費水晶與招募券各 0.5 點 ----
           不是每個池都吃 —— 生日池、復刻池、通行證池的官方說明會寫「招募附贈點數不適用」。 */
        const desc = ((g.gachaInformation || {}).description || '');
        const bptAuto = !/附贈點數不適用/.test(desc);
        const useBpt = a.bonus_points != null ? !!a.bonus_points : bptAuto;

        /* ---- 種子化亂數(xorshift32)。不用 Math.random:同 seed 要能重現 ---- */
        const seed = (a.seed != null ? Math.abs(Math.round(+a.seed)) : Date.now()) >>> 0;
        let _s = seed || 0x9e3779b9;
        const rng = () => { _s ^= _s << 13; _s >>>= 0; _s ^= _s >>> 17; _s ^= _s << 5; _s >>>= 0; return _s / 4294967296; };

        const listLimit = Math.max(1, Math.min(80, Math.round(+a.list_limit || 40)));
        const costs = { jewel: 0, paid_jewel: 0, gacha_ticket: 0, free_pulls: 0 };
        const rare = [];
        let curGuar = 0, n = 0, rareTotal = 0;

        /* ⚠ 三處覆蓋(都在同步區間內,結束一定還原;引擎是共用單例)：
           1. GS._render —— doSpin 收尾會呼叫它去抓 #gachaSimCard 重繪。本頁沒有那個節點
              (它在 index.html?embed=gachasim 的 iframe 裡),而且工具本來就不該動畫面。
           2. GS.spin —— doSpin 內部寫死 `this.spin(n, guard ? 3 : 0)`,吃不到
              over_rarity_4_once(必中★4,例如「必中★4成員招募」、5週年高級禮物招募)。
              包一層把正確的保底階級傳進去。
           3. Math.random —— 引擎的 _rollRarity / _drawOne / _bptAward 都用它,換成種子化 RNG
              才有可重現性。這段全同步、沒有 await,不會跟其他程式交錯。 */
        const oRandom = Math.random, oSpin = GS.spin, oRender = GS._render;
        GS._render = function () {};
        GS.spin = function (cnt) { return oSpin.call(this, cnt, curGuar); };
        Math.random = rng;
        try {
          const runBatches = (entry, times) => {
            for (let i = 0; i < times; i++) {
              curGuar = entry.m.guarantee_rank;
              // ct 傳空字串＝這池不吃招募點數,_bptPer 會回 0
              GS.doSpin(entry.b.spinCount, false, 0, useBpt ? (entry.b.costResourceType || '') : '');
              const ct = entry.b.costResourceType;
              if (ct && entry.b.costResourceQuantity != null) costs[ct] = (costs[ct] || 0) + entry.b.costResourceQuantity;
              else costs.free_pulls += entry.b.spinCount;
              (GS._hist || []).forEach(r => {
                n++;
                if (GS._rank(r.rarity) < 4) return;
                rareTotal++;
                if (rare.length >= listLimit) return;
                const c = D.cById[r.cardId] || {};
                rare.push({ pull: n, card_id: r.cardId, name: c.prefix || ('#' + r.cardId),
                  character: cidName(c.characterId), rarity: RN[r.rarity] || r.rarity,
                  is_pickup: !!r.isPickup, from_bonus_point: r.bonus || null });
              });
            }
          };
          runBatches(M, batches);
          if (rem) runBatches(RM, rem);
        } finally { Math.random = oRandom; GS.spin = oSpin; GS._render = oRender; }

        /* ---- 統計 ---- */
        const T = GS._tally || {}, got = GS._got || {};
        const by_rarity = rarityRows.map(r => {
          const cnt = T[r.key] || 0, pct = cnt / actual * 100;
          return { rarity: r.rarity, count: cnt, actual_pct: +pct.toFixed(3),
            official_pct: r.official_rate_pct, diff_pp: +(pct - r.official_rate_pct).toFixed(3),
            pool_cards: r.pool_cards };
        });
        const is4 = k => GS._rank(k) >= 4;
        const s4 = Object.keys(T).filter(is4).reduce((s, k) => s + T[k], 0);
        const uniq4 = Object.keys(got).filter(id => { const c = D.cById[id]; return c && is4(c.cardRarityType); });
        const uniqPk = Object.keys(got).filter(id => P.pick.has(+id));
        const gaps = GS._gapsTo4 || [];
        const bptAwards = (GS._bptGot || []).map(x => {
          const c = D.cById[x.cardId] || {};
          return { at_points: x.need, reward: x.label, card_id: x.cardId,
            name: c.prefix || ('#' + x.cardId), character: cidName(c.characterId) };
        });

        return {
          gacha: { id: g.id, name: g.name || ('#' + g.id), gacha_type: g.gachaType || null,
            server: (twGid && !twGid.has(g.id)) ? 'jp（台服尚未實裝，機率取自日服 master）' : 'tw',
            start: fdt(g.startAt), end: fdt(g.endAt),
            is_running: g.startAt <= now && g.endAt >= now, total_cards_in_pool: (g.gachaDetails || []).length },
          rarity_rates: by_rarity.map(r => ({ rarity: r.rarity, official_pct: r.official_pct, pool_cards: r.pool_cards })),
          pickup_cards: pickup,
          non_pickup_star4_each_pct: nonPuEach,
          available_methods: methods,
          ceiling,
          bonus_points: { applies: useBpt, auto_detected: bptAuto,
            points_per_pull: { paid_jewel: 1, jewel: 0.5, gacha_ticket: 0.5, free: 0 },
            tiers: (GS.BPT_TIERS || []).map(t => ({ points: t[0], reward: t[1] })),
            note: useBpt ? '招募點數保底是「佔掉這 n 抽裡的最後幾張」，不是額外加送'
              : '此卡池的官方說明寫明「招募附贈點數不適用於本招募」，已關閉' },
          simulation: {
            seed_used: seed, reproducible: true,
            method: mk, method_label: M.m.cost_label + (M.m.guarantee ? '（' + M.m.guarantee + '）' : ''),
            batches, remainder_pulls: rem, pulls_requested: pulls, pulls_actual: actual,
            cost: { jewel: costs.jewel, paid_jewel: costs.paid_jewel,
              crystals_total: costs.jewel + costs.paid_jewel,
              gacha_tickets: costs.gacha_ticket, free_pulls: costs.free_pulls },
            by_rarity,
            star4_total: s4, star4_unique: uniq4.length,
            avg_pulls_per_star4: s4 ? +(actual / s4).toFixed(2) : null,
            avg_gap_between_star4: gaps.length ? +(gaps.reduce((s, x) => s + x, 0) / gaps.length).toFixed(1) : null,
            longest_drought_pulls: Math.max(GS._sinceLast4 || 0, ...(gaps.length ? gaps : [0])),
            pickup_hits: GS._pkHits || 0, pickup_unique: uniqPk.length,
            pickup_expected: +(pickup.reduce((s, p) => s + (p.rate_pct || 0), 0) / 100 * actual).toFixed(2),
            bonus_points_earned: GS._bpt || 0, bonus_point_awards: bptAwards,
            ceiling_progress: ceiling.has_ceiling
              ? { stickers: actual, needed: ceiling.pulls_needed,
                  remaining: Math.max(0, ceiling.pulls_needed - actual),
                  reached: actual >= ceiling.pulls_needed } : null,
            rare_pulls: rare, rare_pulls_total: rareTotal,
            rare_pulls_truncated: rareTotal > rare.length,
          },
          note: '模型（與遊戲一致）：① 依 gachaCardRarityRates 抽稀有度 ② 在該稀有度內依 gachaDetails[].weight 加權抽卡'
            + '（PU 的 weight 被官方調成剛好每張 0.4%）③ 十連保底佔掉第 10 抽而非加送。'
            + '單張機率 ＝ 該稀有度官方機率 × 該卡 weight ÷ 該稀有度總 weight。'
            + '實際 ★3／★4 佔比會略高於官方值，因為保底把不足的那一抽拉上去了——這是正常的，不是模擬有誤。'
            + '這是「真的抽一輪」的結果，樣本只有 ' + actual + ' 抽，本來就會偏離官方機率；'
            + '要期望值／天井／預算內至少中一張的機率請改用 gacha_odds。'
            + (M.m.execute_limit ? '　※「' + mk + '」官方限每期／每日 ' + M.m.execute_limit + ' 次，模擬的 '
                + batches + ' 批等於要跨 ' + batches + ' 個週期，不是一口氣抽得完。' : '')
            + (pulls !== actual ? '　※ pulls=' + pulls + ' 不是 ' + M.b.spinCount + ' 的倍數且此池沒有同幣別單抽，已捨去到 ' + actual + ' 抽。' : ''),
        };
      }

      case 'get_active_players': {
        /* 站上「活躍分析」分頁只顯示計數與前 5／8／10 名，這支要能把整份名單交出去。
           分桶條件直接沿用 activeAnalysis()，才不會出現「頁面說 37 人在線、助手說 41 人」。 */
        if (!this.state.live) { try { await this.loadLive(); } catch (e) {} }
        const V = this.activeAnalysis();
        if (!V) return { error: '即時排名尚未載入，' + (this.state.liveErr || '請稍後再試') };

        const mode = String(a.mode || 'online');
        const bucket = { online: V.online, running: V.grinding, resting: V.idle, all: V.list }[mode];
        if (!bucket) return { error: 'mode 只能是 online／running／resting／all，收到的是「' + a.mode + '」' };

        const ev = this.eventOf(this.state.live);
        const now = Date.now();
        const st = (r, k, f) => (r.stats && r.stats[k] && r.stats[k][f] != null) ? r.stats[k][f] : null;
        const idleMin = r => { const m = V.mins(r); return m == null ? null : Math.round(m); };

        /* resting 桶裡大家時速都是 0，用時速排等於沒排序，改用「停多久」由久到近；
           其餘桶依近 1 小時時速由快到慢，同速再依名次。 */
        const rows = bucket.slice().sort(mode === 'resting'
          ? (x, y) => { const a1 = V.mins(x), b1 = V.mins(y);
                        if (a1 == null && b1 == null) return x.rank - y.rank;
                        if (a1 == null) return -1;
                        if (b1 == null) return 1;
                        return b1 - a1 || x.rank - y.rank; }
          : (x, y) => V.sp(y, 'h1') - V.sp(x, 'h1') || x.rank - y.rank);

        const off = Math.max(0, +a.offset || 0);
        const lim = Math.max(1, Math.min(100, +a.limit || 20));
        const page = rows.slice(off, off + lim);

        // 三個桶會重疊（在線的人通常也在跑），status 標的是「最貼切的那一個」
        const statusOf = r => {
          const m = V.mins(r);
          if (m == null || m > 60) return 'resting';
          if (m <= 15) return V.cnt1(r) > 0 ? 'online_running' : 'online_idle';
          return V.cnt1(r) > 0 ? 'running' : 'slowing';
        };

        const out = {
          event: { id: ev.id != null ? ev.id : null, name: ev.name || null },
          mode,
          counts: {
            board_size: V.list.length,
            online_within_15min: V.online.length,
            running_last_1h: V.grinding.length,
            resting_over_60min: V.idle.length,
            total_rounds_last_1h: V.rounds1h,
            surging: V.surging.length,
            cooling: V.cooling.length,
          },
          matched: rows.length, offset: off, returned: page.length,
          players: page.map(r => {
            const s1 = V.sp(r, 'h1'), s24 = V.sp(r, 'h24');
            return {
              rank: r.rank, name: r.name, uid: r.uid, score: r.score,
              status: statusOf(r),
              speed_1h_per_hour: Math.round(s1),
              speed_24h_per_hour: Math.round(s24),
              rounds_1h: st(r, 'h1', 'count'),
              avg_per_round_1h: st(r, 'h1', 'average') != null ? Math.round(st(r, 'h1', 'average')) : null,
              momentum: s24 > 0 ? +(s1 / s24).toFixed(2) : null,
              minutes_since_last_play: idleMin(r),
              last_round_gain: r.lastScore != null ? r.lastScore : null,
            };
          }),
          note: '時速單位是活動P／小時，score 是累計活動P。' +
            'online＝最後一場在 15 分鐘內；running＝近 1 小時 count>0；resting＝逾 60 分沒有成績（或公開資料完全沒有 last_played_at）。' +
            '這三桶會重疊，每個人的 status 欄標的是最貼切的那一個。' +
            'momentum ＝ 近 1 小時時速 ÷ 近 24 小時時速（>1 加速、<1 降溫）；counts.surging／cooling 用的是站上同一組門檻 ≥1.2 與 ≤0.5。' +
            'players 是整桶依上述規則完整排序後的第 ' + (off + 1) + '～' + (off + page.length) + ' 名，不是取樣；要更後面請帶 offset。' +
            '公開資料只有前 100 名，第 101 名之後沒有任何本期分數；沒有回報時速的人時速欄會是 0 而不是 null。',
        };

        // 名次／分數時間序列：只有帶 series_uid 才算，省得每次都塞一大包點位回去
        if (a.series_uid != null && String(a.series_uid).trim() !== '') {
          const suid = String(a.series_uid).replace(/\D/g, '');
          /* roster 走的是 GitHub 上的公用快照（每 5～10 分一筆），跟 live 是兩份資料，
             沒載到就得自己補載；loadBorderHistory 用 _histFor 去重，重複呼叫不會多打。 */
          if (!this.state.hist) { try { await this.loadBorderHistory(); } catch (e) {} }
          // 上一次呼叫可能還在飛（去重旗標已設、資料還沒回），await 完再輪詢才保險
          for (let i = 0; i < 20 && !this.state.hist; i++) await new Promise(r => setTimeout(r, 150));
          const h = this.state.hist;
          if (!h || h.eventId !== ev.id || !Array.isArray(h.roster) || !h.roster.length) {
            out.series = null;
            out.series_error = '本期的公用時序快照還沒載到（或還沒累積到任何一筆），時間序列查不了';
          } else {
            const ui = (h.users || []).findIndex(u => this.sameUid(u, suid));
            if (ui < 0) {
              out.series = null;
              out.series_error = 'uid ' + suid + ' 從來沒有出現在本期的前百快照裡';
            } else {
              const scoreAt = {};
              (h.ranks || []).forEach(r => { scoreAt[r[0]] = r; });
              const pts = [];
              h.roster.forEach(row => {
                const pos = row.indexOf(ui, 1);      // 位置就是當下名次；找不到＝那個時間點不在前百
                if (pos < 1) return;
                const sr = scoreAt[row[0]];
                pts.push({ t: row[0] * 1000, rank: pos, score: (sr && sr[pos] != null) ? sr[pos] : null });
              });
              /* 補上此刻的即時名次當最後一點：快照最多落後十分鐘，
                 不補的話序列的尾巴會跟同一次回傳的 players 對不起來。 */
              const live = V.list.find(r => this.sameUid(r.uid, suid));
              if (live && live.rank && (!pts.length || now - pts[pts.length - 1].t > 60000)) {
                pts.push({ t: now, rank: live.rank, score: live.score != null ? live.score : null });
              }
              if (!pts.length) {
                out.series = null;
                out.series_error = 'uid ' + suid + ' 在本期快照裡沒有任何在前百的時間點';
              } else {
                const want = Math.max(2, Math.min(80, +a.series_points || 24));
                // 等間隔抽點（頭尾一定保留），不是取最後幾筆，整期形狀才看得出來
                const n = pts.length;
                const idx = n <= want ? pts.map((_, i) => i)
                  : Array.from({ length: want }, (_, i) => Math.round(i * (n - 1) / (want - 1)));
                const uniq = idx.filter((v, i) => i === 0 || v !== idx[i - 1]);
                const ranks = pts.map(p => p.rank);
                const withScore = pts.filter(p => p.score != null);
                const spanH = (pts[n - 1].t - pts[0].t) / 3600000;
                out.series = {
                  uid: suid, name: live ? live.name : null,
                  samples_total: n, points_returned: uniq.length,
                  span_hours: +spanH.toFixed(1),
                  first_at: new Date(pts[0].t).toISOString(),
                  last_at: new Date(pts[n - 1].t).toISOString(),
                  best_rank: Math.min.apply(null, ranks),
                  worst_rank: Math.max.apply(null, ranks),
                  score_gain: withScore.length > 1 ? withScore[withScore.length - 1].score - withScore[0].score : null,
                  avg_speed_per_hour: (withScore.length > 1 && spanH > 0)
                    ? Math.round((withScore[withScore.length - 1].score - withScore[0].score) / spanH) : null,
                  points: uniq.map(i => ({
                    at: new Date(pts[i].t).toISOString(), rank: pts[i].rank, score: pts[i].score })),
                  note: 'points 是實際點位（不是擬合線）：at 為 UTC 時刻、rank 是當下第幾名、score 是當下累計活動P。' +
                    '快照由 GitHub Actions 每 5～10 分鐘記一筆，只涵蓋這位玩家「在前百」的時段，掉出去的時間點不會有點。' +
                    '共 ' + n + ' 筆，這裡等間隔抽 ' + uniq.length + ' 點（含頭尾）；要更密就把 series_points 調大（上限 80）。' +
                    '最後一點是此刻的即時名次，比快照新。',
                };
              }
            }
          }
        }
        return out;
      }

      case 'get_boost_table': {
        /* 站上計算中心 ctab='ep' 下方那張「各火數效率比較」表的工具版，
           算法逐行照搬 renderVals 裡的 boostTable（this.epFor(b) → calcEPValue）。
           不直接呼叫 epFor()：epFor 只吃 this.state，呼叫端沒辦法只蓋掉其中一個參數，
           所以改用 calcEPValue 的參數化版本（參數解析與 calc_event_points 同一套），
           全程只讀 state、不呼叫 setState，因此不會觸發 re-render 動到畫面。
           這支的存在理由：吃幾火是每天都要做的取捨，一次只回一個火數的話
           模型得連打七次 calc_event_points 才拼得出這張表。 */
        if (!(this.state.epSongs || []).length) {
          // loadEpSongs 不是 async（內部走 import().then），沒有 promise 可 await，只能輪詢它寫回 state
          this.loadEpSongs();
          for (let i = 0; i < 40 && !(this.state.epSongs || []).length; i++) await new Promise(r => setTimeout(r, 100));
        }
        // setState 會換掉整個 state 物件，所以一定要等載完才取，不能在 await 之前先抓著舊的
        const s = this.state;
        const songs = s.epSongs || [];
        const DK = { E: 'E', N: 'N', H: 'H', X: 'X', M: 'M', A: 'A', EASY: 'E', NORMAL: 'N', HARD: 'H', EXPERT: 'X', MASTER: 'M', APPEND: 'A' };
        const mode = ['solo', 'auto', 'multi', 'cheer'].indexOf(a.mode) >= 0 ? a.mode : (s.mode || 'multi');
        const diff = DK[String(a.difficulty || '').toUpperCase()] || s.diff || 'M';
        const power = a.power != null ? +a.power || 0 : +s.power || 0;
        const bonus = a.bonus != null ? +a.bonus || 0 : +s.bonus || 0;
        const skill = a.skill != null ? +a.skill || 0 : +s.skill || 0;
        const s6 = a.s6 != null ? +a.s6 || 0 : +s.s6 || 0;
        const life = a.life != null ? +a.life || 0 : +s.life || 0;

        if (a.song_id != null && !songs.length) return { error: 'EP 曲庫尚未載入，請先開啟「計算中心」頁再問一次' };
        const song = this.songById(a.song_id != null ? a.song_id : s.songKey);
        if (a.song_id != null && !song) return { error: '找不到 song_id=' + a.song_id + ' 這首歌，可先用 get_songs 查編號' };
        const rate = song ? song.rate : (a.event_rate != null ? +a.event_rate || 100 : +s.rate || 100);
        const time = song ? song.time : 100;

        let score, usedDiff = null, scoreFrom;
        if (a.score != null) { score = +a.score || 0; scoreFrom = '呼叫時直接指定的分數'; }
        else if (song && song.d) {
          // 與 scoreNow() 同一套後備順序：指定難度沒係數就往下找有的
          const k = [diff, 'M', 'X', 'H', 'N', 'E', 'A'].find(x => song.d[x]);
          usedDiff = k || null;
          score = k ? this.calcSongScore(song.d[k], mode, power, skill, s6) : 0;
          scoreFrom = '由歌曲係數與綜合力/技能推算';
        } else { score = +s.score || 0; scoreFrom = '共用設定裡直接填的分數（沒有歌曲資料）'; }
        // 分數推不出來的話整張表會全是 0 —— 那是假的答案，寧可講清楚缺什麼
        if (!(score > 0)) return { error: '算不出歌曲分數，整張對照表會是 0。請給 score（直接指定分數），或給 song_id ＋ power/skill 讓它推算' };

        const cycle = time + this.ohOf(mode);     // 火數不影響單局耗時，整張表共用
        // 站上那張表固定列 0/1/2/3/5/7/10 這七檔（玩家實際會用的），all_levels 才展開 0～10
        const LEVELS = a.all_levels ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [0, 1, 2, 3, 5, 7, 10];
        const rows = LEVELS.map(e => {
          const F = this.EM[e] || 1;
          const ep = this.calcEPValue(mode, score, rate, bonus, F, power, life);
          return {
            boost_energy: e,                                  // 吃幾火（＝消耗幾點體力）
            boost_multiplier: F,                              // 火倍率
            ep_per_game: ep,                                  // 單局活動P
            // 0 火不耗體力，「每火活動P」沒有意義（站上那欄顯示「—」），所以給 null 而不是 0
            ep_per_energy: e > 0 ? Math.round(ep / e) : null,
            ep_per_hour: cycle > 0 ? Math.round(ep * 3600 / cycle) : 0,   // 不間斷周回
            energy_per_hour: cycle > 0 ? Math.round(e * 3600 / cycle) : 0, // 這個火數每小時燒掉的體力
            is_current_setting: e === (+s.energy || 0),       // 計算中心目前選的那一檔
          };
        });

        // 每火效率用未四捨五入的比值比，避免 Math.round 把本來相同的名次拆開
        const withE = rows.filter(r => r.boost_energy > 0);
        const bestRatio = Math.max.apply(null, withE.map(r => r.ep_per_game / r.boost_energy));
        const bestPerEnergy = withE.filter(r => Math.abs(r.ep_per_game / r.boost_energy - bestRatio) < 1e-9)
                                   .map(r => r.boost_energy);
        const bestPerHour = rows.reduce((x, y) => (y.ep_per_hour > x.ep_per_hour ? y : x), rows[0]).boost_energy;

        return {
          mode, difficulty: usedDiff || diff,
          song: song ? { id: song.id, title: song.t, length_s: song.time, event_rate_pct: song.rate } : null,
          inputs: { power, bonus_pct: bonus, skill, s6, life, event_rate_pct: rate },
          inputs_from: (a.mode == null && a.power == null && a.bonus == null && a.skill == null
                        && a.s6 == null && a.score == null && a.song_id == null)
            ? '全部沿用計算中心的共用設定' : '呼叫時指定的參數，其餘沿用計算中心的共用設定',
          song_score: Math.round(score), score_from: scoreFrom,
          cycle_s: cycle, overhead_s: this.ohOf(mode),
          current_setting_energy: +s.energy || 0,
          table: rows,
          best_ep_per_energy: {
            boost_energy: bestPerEnergy,                      // 可能同時多檔並列
            ep_per_energy: Math.round(bestRatio),
            tied: bestPerEnergy.length > 1,
          },
          best_ep_per_hour: { boost_energy: bestPerHour },
          note: '單局活動P ＝ ⌊base × 歌曲倍率 × (1＋加成/100)⌋ × 火倍率；'
            + 'base 單人場為 100＋⌊分數/20000⌋，協力/應援為 123＋⌊(分數＋0.075×綜合力×5)/17000⌋。'
            + '火倍率表：0→1、1→5、2→10、3→15、4→20、5→25、6→27、7→29、8→31、9→33、10→35。'
            + ' table 是這組參數下 ' + rows.length + ' 個火數的完整對照（不是取樣，不用再逐一呼叫 calc_event_points）。'
            + ' ep_per_energy＝單局活動P ÷ 火數，是省體力指標；ep_per_hour＝單局活動P × 3600 ÷ (歌長＋'
            + this.ohOf(mode) + 's 結算間隔)，是省時間指標；0 火的 ep_per_energy 是 null（不耗體力，沒有這個比值）。'
            + ' 結構上 1～5 火的倍率剛好都是 ×5/火（5/10/15/20/25），每火效率完全相同；6 火起倍率遞減（27/29/31/33/35），'
            + '每火效率越吃越差。所以：體力有限就吃 1～5 火（其中吃 5 火局數最少、最省時間），'
            + '時間有限或活動最後衝刺才吃 10 火 —— 用 3.5 倍的每火成本換 7 倍的每小時產出。',
        };
      }

      case 'get_border_matrix': {
        await this.loadBorderDB();
        const DB = (typeof BORDERS_DB !== 'undefined') ? BORDERS_DB : null;
        if (!DB) return { error: '榜線資料庫載入失敗，無法標註各期的活動型態與日數' };
        const evl = await this.loadEvList().catch(() => []);
        if (!evl || !evl.length) return { error: '活動清單載入失敗，無法決定要查哪幾期' };

        // 段位白名單＝兩份資料源歷來出現過的所有段位。不在名單上的直接擋掉,
        // 否則整欄都是 null,模型會誤讀成「那期沒人跑到這個名次」。
        const DB_T = DB.tiers || [];
        const API_T = [10000, 20000, 30000, 40000, 50000, 80000, 100000, 150000, 200000];
        const ALL_T = DB_T.concat(API_T).filter((t, i, s) => s.indexOf(t) === i).sort((x, y) => x - y);
        const DEF_T = [100, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
        let tiers = (Array.isArray(a.tiers) && a.tiers.length) ? a.tiers.map(Number) : DEF_T;
        const bad = tiers.filter(t => ALL_T.indexOf(t) < 0);
        if (bad.length) return { error: '沒有這些段位:' + bad.join('、') + '。可用段位:' + ALL_T.join('、') };
        tiers = tiers.filter((t, i, s) => s.indexOf(t) === i).sort((x, y) => x - y).slice(0, 14);

        const now = Date.now();
        const endOf = e => new Date(e.aggregate_at || e.closed_at || e.start_at).getTime();
        const isFinal = e => endOf(e) <= now;
        let pick = [], notFound = [];
        if (Array.isArray(a.event_ids) && a.event_ids.length) {
          const want = a.event_ids.map(Number).slice(0, 30);
          pick = want.map(id => evl.find(e => +e.id === id)).filter(Boolean);
          notFound = want.filter(id => !evl.some(e => +e.id === id));
          if (!pick.length) return { error: '這些期數都不存在:' + want.join('、') };
        } else {
          // 依期數新到舊的連續一段,不是取樣;要看更早的用 offset 往後翻
          const pool = evl.filter(e => isFinal(e)
            || (a.include_running && new Date(e.start_at).getTime() <= now))
            .sort((x, y) => y.id - x.id);
          const off = Math.max(0, Math.min(300, +a.offset || 0));
          pick = pool.slice(off, off + Math.max(1, Math.min(30, +a.recent || 12)));
          if (!pick.length) return { error: 'offset 超過已結算的期數，這個範圍內沒有活動' };
        }

        /* 一期一個請求,所以分批 8 個送(與榜線趨勢同一個節流),並把已結算的期數
           快取起來 —— 它的終線不會再變。進行中的那期每分鐘都在動,不能快取。 */
        const cache = (this._bmCache = this._bmCache || {});
        const live = {}, failed = [];
        const need = pick.filter(e => !cache[e.id]);
        for (let i = 0; i < need.length; i += 8) {
          await Promise.all(need.slice(i, i + 8).map(async e => {
            try {
              const rows = this.bordersOf(await this.apiFetch('/event/' + e.id + '/border'));
              if (!rows.length) throw new Error('empty');
              if (isFinal(e)) cache[e.id] = rows; else live[e.id] = rows;
            } catch (err) { failed.push(+e.id); }
          }));
        }

        const dbIdx = {}; DB_T.forEach((t, i) => { dbIdx[t] = i; });
        const cover = {}; tiers.forEach(t => { cover[t] = 0; });
        const events = pick.map(e => {
          const api = {};
          (cache[e.id] || live[e.id] || []).forEach(r => { api[r.rank] = r.score; });
          const db = (DB.borders || []).find(x => +x.id === +e.id) || null;
          const meta = (DB.events || []).find(x => +x.id === +e.id) || null;
          // 卡池表帶的圈內講法(箱活/混活/World Link),有就補,沒有不強求
          const g = (this.state.gachas || []).find(x => String(x.eid) === String(e.id) && x.et);
          const borders = {}, notOffered = [], fromDB = [];
          tiers.forEach(t => {
            let v = (api[t] != null) ? api[t] : null;
            if (v == null && db && dbIdx[t] != null && db.t[dbIdx[t]] != null) {
              v = db.t[dbIdx[t]]; fromDB.push(t);
            }
            borders['T' + t] = v;
            if (v == null) notOffered.push(t); else cover[t]++;
          });
          return {
            event_id: +e.id,
            name: e.name || (meta ? meta.name : ''),
            type: meta ? meta.type : ((e.chapters || []).length ? 'World Link' : null),
            days: meta ? meta.days : +((endOf(e) - new Date(e.start_at).getTime()) / 86400000).toFixed(2),
            unit: meta ? meta.unit : null,
            attr: meta ? meta.attr : null,
            banner_chara: meta ? meta.chara : null,
            banner_scope: g ? g.et : null,
            start: e.start_at,
            aggregate_at: e.aggregate_at || e.closed_at,
            is_final: isFinal(e),
            borders,
            tiers_not_offered: notOffered.length ? notOffered : null,
            tiers_from_static_db: fromDB.length ? fromDB : null,
            fetch_failed: failed.indexOf(+e.id) >= 0 ? true : null,
          };
        });

        return {
          score_unit: '活動P（點）',
          tiers,
          events_returned: events.length,
          events,
          tier_coverage: tiers.map(t => ({ tier: 'T' + t, events_with_value: cover[t], of: events.length })),
          not_found_event_ids: notFound.length ? notFound : null,
          fetch_failed_event_ids: failed.length ? failed : null,
          note: 'borders["T◯"] ＝ 該期第 ◯ 名玩家的累計活動P（is_final=true 是結算終線，false 是此刻的即時值）。'
            + 'T5000 以下同時有 good果汁靜態表與 HiSekai API，兩邊在 #175 的十二個重疊段位逐位相同；'
            + 'T10000 以上只有 API，T1～T90 只有靜態表（tiers_from_static_db 標出哪幾段是從靜態表補的）。'
            + 'null 代表「那期官方沒有開放這個段位」，不是沒人跑到：'
            + '#1～#107 有 T100000（#65～#106 部分期另有 T200000）、沒有 T1500／T2500；'
            + '#108～#165 改成 T80000＋T150000（少數期只有 T80000），並開始有 T1500／T2500；'
            + '#167 起回到 T100000、不再有 T80000／T150000（#166 是官方的測試活動，沒有榜線）。'
            + '跨期比較前務必先看 type 與 days —— 12 天的 World Link 與 6.25 天的短馬拉松不能直接並列；'
            + '另外榜線兩年來整體通膨（T100 約漲 2.8 倍），比較最好限縮在相近期數。'
            + 'World Link 這裡給的是主榜，各章個榜不在這支。',
        };
      }

      case 'get_border_timeseries': {
        const tier = +a.tier;
        if (!tier) return { error: '缺少 tier（段位），例如 100 / 1000 / 5000' };
        if (!this.state.live) { try { await this.loadLive(); } catch (e) {} }
        const curId = this.eventOf(this.state.live).id;
        const evId = (a.event_id != null && a.event_id !== '') ? +a.event_id : (curId != null ? +curId : null);
        if (evId == null) return { error: '取不到活動期數，即時排名資料尚未載入' };
        const isCur = (curId != null && +curId === evId);

        let pts = [], avail = [], evName = null, stMs = 0, enMs = 0, source = '', localN = 0;
        if (isCur) {
          // 當期直接用站上那條合併好的時間軸：公用時序 ＋ 這台瀏覽器自己記的快照。
          // 跟 analysis 頁的走勢圖、實測時速吃的是同一個 snapList，數字才不會兩套。
          if (!this.state.hist) { try { await this.loadBorderHistory(); } catch (e) {} }
          const list = this.snapList(evId);
          if (!list.length) return { error: '第 ' + evId + ' 期還沒有任何榜線快照' };
          const h = (this.state.hist && this.state.hist.eventId === evId) ? this.state.hist : {};
          avail = (h.tiers || []).slice();
          if (!avail.length) avail = ((list[list.length - 1] || [])[1] || []).map(x => x[0]);
          if (avail.length && avail.indexOf(tier) < 0) {
            return { error: '第 ' + evId + ' 期沒有 T' + tier + ' 這一段', available_tiers: avail };
          }
          pts = list.map(s => {
            const f = (s[1] || []).find(x => x[0] === tier);
            return (f && f[1] != null) ? [s[0], f[1]] : null;
          }).filter(Boolean);
          localN = this.snapLocal(evId).length;
          const ev = this.eventOf(this.state.live);
          evName = ev.name || h.name || null;
          stMs = new Date(ev.start_at || h.startAt || 0).getTime() || 0;
          enMs = new Date(ev.aggregate_at || ev.closed_at || h.aggregateAt || 0).getTime() || 0;
          source = 'public_timeseries+local_snapshots';
        } else {
          // 過去期數自己抓，刻意不走 loadBorderHistory —— 那支會 setState({hist})，
          // 把 analysis 頁正在畫的走勢圖整個換成別期。這裡只讀不寫 state。
          // 檔案不小（#176 那種 12 天 WL 期有 3MB），所以在實例上留一份快取。
          this._btsCache = this._btsCache || {};
          let d = this._btsCache[evId];
          if (!d) {
            try {
              d = await fetch(this.HIST + '/' + evId + '.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null);
            } catch (e) { d = null; }
            if (!d || !Array.isArray(d.samples) || !d.samples.length) {
              let ids = null;
              try { ids = await fetch(this.HIST + '/index.json').then(r => r.ok ? r.json() : null); } catch (e) {}
              return { error: '第 ' + evId + ' 期沒有公用榜線時序（本站是從第 175 期才開始記的）',
                       available_event_ids: Array.isArray(ids) ? ids : null };
            }
            this._btsCache[evId] = d;
          }
          avail = (d.tiers || []).slice();
          const ci = avail.indexOf(tier);
          if (ci < 0) return { error: '第 ' + evId + ' 期沒有 T' + tier + ' 這一段', available_tiers: avail };
          // 一樣要先修單調：WL 期間 API 會把別的榜的值串進來，站上各處都吃修過的資料
          pts = this.fixMono(d.samples, avail.length)
            .map(s => (s[ci + 1] != null ? [s[0] * 1000, s[ci + 1]] : null)).filter(Boolean);
          evName = d.name || null;
          stMs = new Date(d.startAt || 0).getTime() || 0;
          enMs = new Date(d.aggregateAt || 0).getTime() || 0;
          source = 'public_timeseries';
        }
        if (pts.length < 2) {
          return { error: '第 ' + evId + ' 期的 T' + tier + ' 只有 ' + pts.length + ' 筆快照，量不出走勢',
                   available_tiers: avail };
        }

        const first = pts[0], last = pts[pts.length - 1], now = Date.now();
        const gaps = [];
        for (let j = 1; j < pts.length; j++) gaps.push(pts[j][0] - pts[j - 1][0]);
        gaps.sort((x, y) => x - y);
        const medGapMin = gaps[Math.floor(gaps.length / 2)] / 60000;
        const maxGapH = gaps[gaps.length - 1] / 3600000;

        /* 時速＝窗口內最早一筆到最後一筆的分數差 ÷ 跨距。跨距不足半小時量到的是雜訊，
           退回整段（與 wlSpeed 同一套規則）。winH 給 null 就是整段，那條剛好等於
           snapSpeed 給榜線分析用的「實測時速」。 */
        const spd = winH => {
          let a0 = winH ? pts.find(p => last[0] - p[0] <= winH * 3600000) : pts[0];
          if (!a0 || (last[0] - a0[0]) / 3600000 < 0.5) a0 = pts[0];
          const h = (last[0] - a0[0]) / 3600000;
          if (h < 0.5) return null;
          return { rate: (last[1] - a0[1]) / h, spanH: h, from: a0,
                   n: pts.filter(p => p[0] >= a0[0]).length };
        };
        const winH = Math.max(0.5, Math.min(72, +a.window_hours || 6));
        const full = spd(null), rec = spd(winH);

        // 外推的基準是「最後一筆快照」而不是此刻：快照可能已經放了幾小時，
        // 拿現在的時間去配舊分數會憑空多算一段。data_age_h 讓模型自己判斷新舊。
        const leftH = enMs ? Math.max(0, (enMs - last[0]) / 3600000) : null;
        const frac = (stMs && enMs && enMs > stMs)
          ? Math.min(1, Math.max(0.001, (last[0] - stMs) / (enMs - stMs))) : null;
        const ended = enMs ? now >= enMs : false;
        const pj = r => (r == null || leftH == null) ? null : Math.round(last[1] + r * leftH);

        // 均勻抽樣：整段等距取，不是取最近 N 筆，也不是隨機
        const want = Math.max(2, Math.min(120, Math.round(+a.points || 24)));
        const step = Math.max(1, Math.ceil(pts.length / want));
        const picked = [];
        for (let j = 0; j < pts.length; j += step) picked.push(pts[j]);
        if (picked[picked.length - 1] !== last) picked.push(last);
        const iso = ms => new Date(ms).toISOString();

        return {
          event: { id: evId, name: evName, status: ended ? 'ended' : 'live',
                   start: stMs ? iso(stMs) : null, end: enMs ? iso(enMs) : null,
                   progress_pct_at_last_point: frac != null ? +(frac * 100).toFixed(1) : null,
                   hours_left_from_last_point: leftH != null ? +leftH.toFixed(2) : null },
          tier,
          source, local_snapshot_count: isCur ? localN : 0,
          available_tiers: avail,
          series: {
            total_points: pts.length, returned_points: picked.length, sampled_every_nth: step,
            raw_interval_median_min: +medGapMin.toFixed(1),
            sampled_interval_avg_min: +(((last[0] - first[0]) / 60000) / (picked.length - 1)).toFixed(1),
            largest_hole_h: +maxGapH.toFixed(1),
            covers: [iso(first[0]), iso(last[0])],
            data_age_h: +((now - last[0]) / 3600000).toFixed(2),
          },
          current_score: last[1],
          measured_full: full ? { speed_per_hour: Math.round(full.rate), span_h: +full.spanH.toFixed(2),
                                  points_in_span: full.n, from: iso(full.from[0]), from_score: full.from[1] } : null,
          measured_recent: rec ? { requested_window_h: winH, speed_per_hour: Math.round(rec.rate),
                                   span_h: +rec.spanH.toFixed(2), points_in_span: rec.n,
                                   from: iso(rec.from[0]), from_score: rec.from[1] } : null,
          projection: ended ? null : {
            from_full_span_speed: pj(full ? full.rate : null),
            from_recent_speed: pj(rec ? rec.rate : null),
            linear: frac ? Math.round(last[1] / frac) : null,
            site_value: pj(full ? full.rate : null),
          },
          points: picked.map((p, j) => {
            const q = j ? picked[j - 1] : null;
            const dh = q ? (p[0] - q[0]) / 3600000 : 0;
            return { t: iso(p[0]), score: p[1],
                     gain: q ? p[1] - q[1] : null,
                     speed_per_hour: (q && dh > 0) ? Math.round((p[1] - q[1]) / dh) : null };
          }),
          note: '分數單位是活動P，時速是活動P／小時。' +
                'points 是整段活動「等距抽樣」的結果（每 ' + step + ' 筆取 1 筆），不是最近幾筆也不是隨機，' +
                '總共 ' + pts.length + ' 筆；要更密就把 points 調大（上限 120），不要多次呼叫拼湊。' +
                '每點的 speed_per_hour 是「與上一個回傳點之間」的平均時速，抽樣越疏越平滑。　' +
                '實測時速＝(最後一筆分數 − 窗口起點分數) ÷ 跨距小時；' +
                '預測終線＝最後一筆分數 ＋ 時速 × 剩餘小時；' +
                '線性外推＝最後一筆分數 ÷ 活動已過比例（完全不看實測速度，末段一定低估）。' +
                'site_value 就是站上「榜線分析」那欄預測終線的算法（整段實測速度外推）。　' +
                'measured_full 是整段平均，會被前期的慢速拖平 —— #176 第三章 T100 整段平均 41.4 萬/h、' +
                '最近 6 小時卻是 91.9 萬/h，差 2.2 倍；要回答「現在跑多快」看 measured_recent。　' +
                '外推對末段衝刺是低估的：活動過六成後，回測 #150～#176 顯示 T5000 約低估 2～6%、' +
                'T1000 10～13%、T100 14～22%，請當下限而不是保證線。　' +
                '快照由 GitHub Actions 記錄（每 30 分鐘觸發一次，每次在同一個 job 內每 5 分鐘取樣、連記 12 筆，' +
                '所以原始間隔中位數約 5 分鐘）；Actions 誤點或失敗時會出現數小時的空洞，' +
                'largest_hole_h 就是本期最大的一個洞，measured_recent 的 span_h 可能因此遠小於要求的窗口。　' +
                '分數只增不減，站上已用 running-min 修過 WL 期間 API 串值造成的下降。　' +
                'World Link 的章節榜不在這支裡（那是各章獨立的榜），要看章節走勢用 get_wl_status。',
        };
      }

      case 'get_chart_consts': {
        /* 定數資料是獨立的 classic script（掛 window.B30_CONSTS），App 這邊平常不載。
           載法與 get_b30 一字不差，並刻意共用同一支 this._b30Loading ——
           兩支工具在同一輪先後被叫到時，才不會各自再下載一次 88 KB。 */
        if (!window.B30_CONSTS) {
          if (!this._b30Loading) {
            this._b30Loading = new Promise(res => {
              const s = document.createElement('script');
              s.src = 'data/b30-consts.js?v=7f878df18f';
              s.onload = () => res();
              s.onerror = () => { this._b30Loading = null; res(); };   // 清掉才允許下次重試
              document.head.appendChild(s);
            });
          }
          await this._b30Loading;
        }
        const D = window.B30_CONSTS;
        if (!D || !(D.charts || []).length) return { error: '定數資料（data/b30-consts.js）載入失敗，請重新整理後再試一次。' };

        /* cval／clab 必須跟 get_b30 與 core.js 的 B30Maker 完全一致：
           「+」是定數的一部分（+＝+0.05、++＝+0.09999999，貼著下一帶但嚴格小於），
           區間篩選與排序都得用含「+」的值，否則 31.5++ 會被當成 31.5 排在 31.5+ 前面。 */
        const PLUS = [0, 0.05, 0.09999999];
        const cval = c => c.c + PLUS[c.p || 0];
        const clab = c => c.c.toFixed(1) + '+'.repeat(c.p || 0);
        const DN = { master: 'MASTER', append: 'APPEND', expert: 'EXPERT' };
        const r2 = v => +v.toFixed(2);
        // 模型很愛把沒用到的參數塞 null，而 +null===0 會變成「篩 0」，所以不能只用 Number.isFinite
        const num = v => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);

        const DA = { M: 'master', MAS: 'master', MASTER: 'master', A: 'append', APD: 'append', APPEND: 'append',
                     X: 'expert', EX: 'expert', EXPERT: 'expert' };
        let diff = null;
        if (a.difficulty != null && String(a.difficulty).trim()) {
          diff = DA[String(a.difficulty).trim().toUpperCase()] || null;
          if (!diff) return { error: 'difficulty 只能是 master／append／expert。難易度表只收這三個難度，EASY／NORMAL／HARD 沒有定數。' };
        }

        /* 表上的「31.5」其實是 31.5／31.5+／31.5++ 三種列，使用者說「31.5 的譜面」通常指整帶，
           所以不寫「+」就整帶都給；明確寫 "31.5+" 才只挑那一種。 */
        let eqBase = null, eqPlus = null;
        if (a.const_eq != null && String(a.const_eq).trim()) {
          const m = String(a.const_eq).trim().match(/^(\d+(?:\.\d+)?)(\++)?$/);
          if (!m) return { error: 'const_eq 格式錯誤，要寫成 "31.5"（含 31.5+／31.5++）或 "31.5+"、"32.9++"（只要那一種）。' };
          eqBase = +m[1]; eqPlus = m[2] ? m[2].length : null;
          if (eqPlus > 2) return { error: 'const_eq 最多兩個「+」，表上只有 + 與 ++。' };
        }

        // 曲名比對去空白：英文曲名使用者常打成「tellyourworld」，日文原名不受影響
        const nz = s => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '');
        const q = nz(a.q);
        const songId = num(a.song_id);
        const cMin = num(a.const_min), cMax = num(a.const_max);
        const lv = num(a.level), lvMin = num(a.level_min), lvMax = num(a.level_max);
        const pool = ['all', 'tw', 'jp'].indexOf(a.pool) >= 0 ? a.pool : 'all';

        const hit = D.charts.filter(c => {
          if (diff && c.d !== diff) return false;
          if (pool === 'tw' && c.jp) return false;
          if (pool === 'jp' && !c.jp) return false;
          if (songId != null && c.id !== songId) return false;
          if (eqBase != null) {
            if (Math.abs(c.c - eqBase) > 1e-9) return false;
            if (eqPlus != null && (c.p || 0) !== eqPlus) return false;
          }
          const v = cval(c);
          if (cMin != null && v < cMin - 1e-9) return false;
          if (cMax != null && v > cMax + 1e-9) return false;
          if (lv != null && c.lv !== lv) return false;
          if (lvMin != null && c.lv < lvMin) return false;
          if (lvMax != null && c.lv > lvMax) return false;
          if (q && nz(c.t).indexOf(q) < 0 && nz(c.tc).indexOf(q) < 0) return false;
          return true;
        });

        // 查無資料不是錯誤，但要講清楚「為什麼是空的」，免得模型改用更爛的條件亂試
        if (!hit.length) {
          return { total: 0, charts: [],
            note: '沒有符合條件的譜面（不是資料壞掉）。曲名請用日文原曲名（例如「ヒバナ」而不是 Hibana）或社群中文譯名；'
              + '難易度表只收 MASTER／APPEND／EXPERT 共 ' + D.charts.length + ' 張譜面（涵蓋 '
              + new Set(D.charts.map(c => c.id)).size + ' 首曲子）、定數 24.9～38.0，'
              + '條件超出這個範圍（例如 const_min 39、只有 EXPERT 的冷門曲）就會是空的。' };
        }

        const sort = ['const_desc', 'const_asc', 'level_desc', 'level_asc', 'song_id'].indexOf(a.sort) >= 0 ? a.sort : 'const_desc';
        const byC = (x, y) => cval(x) - cval(y) || x.lv - y.lv || x.id - y.id;
        hit.sort(sort === 'const_asc' ? byC
          : sort === 'level_desc' ? ((x, y) => y.lv - x.lv || cval(y) - cval(x) || x.id - y.id)
          : sort === 'level_asc' ? ((x, y) => x.lv - y.lv || cval(x) - cval(y) || x.id - y.id)
          : sort === 'song_id' ? ((x, y) => x.id - y.id || cval(y) - cval(x))
          : ((x, y) => byC(y, x)));

        const lim = Math.max(1, Math.min(100, +a.limit || 20));
        const off = Math.max(0, +a.offset || 0);
        const page = hit.slice(off, off + lim);
        const cs = hit.map(cval);

        return {
          total: hit.length, returned: page.length, offset: off,
          has_more: off + page.length < hit.length,
          sorted_by: sort,
          filters: { q: a.q || null, song_id: songId, difficulty: diff, pool,
            const_eq: a.const_eq || null, const_min: cMin, const_max: cMax,
            level: lv, level_min: lvMin, level_max: lvMax },
          matched_const_range: { min: r2(Math.min.apply(null, cs)), max: r2(Math.max.apply(null, cs)) },
          matched_by_difficulty: {
            MASTER: hit.filter(c => c.d === 'master').length,
            APPEND: hit.filter(c => c.d === 'append').length,
            EXPERT: hit.filter(c => c.d === 'expert').length,
          },
          charts: page.map(c => ({
            song_id: c.id, title: c.t, title_tc: c.tc || null,
            difficulty: DN[c.d] || c.d,
            level: c.lv,                       // 遊戲內等級（整數 Lv）
            const_label: clab(c),              // 表上的寫法，例如 "31.5+"
            const_value: r2(cval(c)),          // 實際參與計算的數值，例如 31.55
            jp_only: !!c.jp, estimated_const: !!c.e,
          })),
          data_source: D.source, chart_count: D.charts.length,
          updated: D.builtAt ? new Date(D.builtAt).toISOString().slice(0, 10) : null,
          note: 'const_label／const_value 是「非官方難易度表」（' + D.source + '，AP 基準）的定數，不是遊戲內等級：'
            + 'level 才是遊戲裡顯示的 Lv（整數，同一個 Lv 內實際難度可以差很多）；'
            + '定數是社群把同一個 Lv 再細分到小數的難度排名值（通常落在該 Lv 的 x.0～x.9），兩者不相等也不該互相換算，'
            + '講給使用者聽時要說「難易度表定數」而不是「等級」。'
            + '「+」是定數的一部分且計入運算：+＝+0.05、++＝+0.09999999（幾乎貼齊下一帶但嚴格小於），'
            + '所以 ++ 的 const_value 四捨五入後會顯示成下一個整數（34.9++ → 35），要唸出來請以 const_label 為準。'
            + 'difficulty 只有 MASTER／APPEND／EXPERT——難易度表沒收 EASY／NORMAL／HARD，也不是每首曲子都有 EXPERT 列（全表只有 36 張），'
            + '查不到不等於那張譜面不存在，只是表沒收。'
            + 'jp_only=true 是日服限定曲、台服點不到；estimated_const=true 是難易度表未收錄、由等級推估的定數（全表 7 張，要註明是估的）。'
            + 'charts 是全部 ' + hit.length + ' 筆符合條件的譜面依 ' + sort + ' 完整排序後的第 '
            + (off + 1) + '～' + (off + page.length) + ' 筆，不是取樣；要更多就調 limit（最多 100）／offset，不要用多次小批次拼湊。'
            + 'song_id 可直接餵給 get_songs 查作曲者／音符數／曲長；要算使用者自己的 B30 或「下一張打哪首最划算」請用 get_b30。',
        };
      }

      case 'get_gacha_points': {
        /* 招募點數(BPT)＝ 依「這抽花了什麼資源」累積的點數,跟 300 抽天井是兩套獨立保底。
           為什麼不直接呼叫 GachaBonus.calc():那支讀 #gbHave/#gbPaid… 再把 HTML 寫回 #gbResult ——
           那些節點只存在於經典版頁面,在這裡 getElementById 回 null 會直接拋,而且會動到畫面。
           所以只借它的規則常數(PT／COST／MODES),數字自己算;點數換算再用官方
           gachaBonusPoints.json 覆寫一次,master 改了不必回頭改這裡。 */
        const E = await this.ensureEngine();
        const GB = E && E.GachaBonus;
        if (!GB) return { error: '計算引擎載入了，但取不到 GachaBonus（招募點數規則）' };
        const MDB = E && E.MasterDB;
        if (!MDB) return { error: '計算引擎載入了，但取不到 MasterDB' };

        const COST = GB.COST || 300;
        const num = (v, d) => (v == null || v === '' || !isFinite(+v)) ? d : Math.max(0, +v);
        const r1 = n => Math.round(n * 10) / 10;
        const wantPools = a.include_pools !== false;

        let bpRaw = null, tierRaw = null;
        try {
          [bpRaw, tierRaw] = await Promise.all([
            MDB.get('gachaBonusPoints.json').catch(() => null),
            MDB.get('gachaBonusItemReceivableRewards.json').catch(() => null),
          ]);
        } catch (e) { return { error: '招募點數 master 資料載入失敗：' + (e.message || '') }; }

        const PT = { paid_jewel: GB.PT.paid, jewel: GB.PT.free, gacha_ticket: GB.PT.ticket };
        let ptSrc = 'core.js GachaBonus.PT（master 表沒載到，用站上內建值）';
        if (Array.isArray(bpRaw) && bpRaw.length) {
          bpRaw.forEach(r => { if (r && r.resourceType && r.point != null) PT[r.resourceType] = +r.point; });
          ptSrc = '官方 master data gachaBonusPoints.json';
        }
        const perPull = ct => (ct && PT[ct] != null) ? PT[ct] : 0;

        const now = Date.now();
        let pools = [], total = 0, off = 0;
        if (wantPools) {
          let gachas;
          try { gachas = await MDB.get('gachas.json'); }
          catch (e) { return { error: '卡池 master 資料（gachas.json）載入失敗：' + (e.message || '') }; }
          if (!Array.isArray(gachas) || !gachas.length) return { error: '卡池 master 資料（gachas.json）是空的' };

          const q = String(a.gacha_query || '').trim().toLowerCase();
          const gid = a.gacha_id != null ? String(a.gacha_id) : '';
          let picked;
          if (gid) {
            picked = gachas.filter(g => String(g.id) === gid);
            if (!picked.length) return { error: '找不到編號 ' + gid + ' 的卡池（台服 master 只留現行與近期卡池，太舊的池查不到）' };
          } else if (q) {
            picked = gachas.filter(g => String(g.name || '').toLowerCase().includes(q));
            if (!picked.length) return { error: '找不到名稱含「' + a.gacha_query + '」的卡池；不指定 gacha_id／gacha_query 就會回現在進行中的全部卡池' };
          } else {
            picked = gachas.filter(g => g.startAt <= now && now <= g.endAt);
            if (!picked.length) return { error: '目前沒有進行中的卡池（master 資料可能還沒更新）' };
          }
          picked = picked.slice().sort((x, y) => (y.startAt || 0) - (x.startAt || 0));
          total = picked.length;
          const lim = Math.min(20, Math.max(1, Math.round(num(a.limit, 4))));
          off = Math.round(num(a.offset, 0));
          const page = picked.slice(off, off + lim);

          const needCeil = page.some(g => g.gachaCeilItemId);
          const needTk = page.some(g => (g.gachaBehaviors || []).some(b => b.costResourceType === 'gacha_ticket'));
          const [sums, ceilItems, mats, tks] = await Promise.all([
            needCeil ? MDB.get('gachaCeilExchangeSummaries.json').catch(() => null) : Promise.resolve(null),
            needCeil ? MDB.get('gachaCeilItems.json').catch(() => null) : Promise.resolve(null),
            needCeil ? MDB.get('materials.json').catch(() => null) : Promise.resolve(null),
            needTk ? MDB.get('gachaTickets.json').catch(() => null) : Promise.resolve(null),
          ]);
          const sumBy = {}; (sums || []).forEach(s => { if (s.gachaCeilItemId) sumBy[s.gachaCeilItemId] = s; });
          const ciBy = {}; (ceilItems || []).forEach(c => { ciBy[c.id] = c; });
          const matBy = {}; (mats || []).forEach(m => { matBy[m.id] = m; });
          const tkBy = {}; (tks || []).forEach(t => { tkBy[t.id] = t; });

          const GUARD = { over_rarity_3_once: '該次至少 1 張 ★3 以上', over_rarity_4_once: '該次必中 1 張 ★4' };
          const RESET = { once_a_day: '每日 1 次', once_a_week: '每週 1 次' };

          pools = page.map(g => {
            const seen = new Set(), methods = [];
            (g.gachaBehaviors || []).filter(b => b.spinCount).forEach(b => {
              const key = b.spinCount + ':' + b.costResourceType + ':' + b.costResourceQuantity + ':' + b.gachaBehaviorType;
              if (seen.has(key)) return; seen.add(key);
              const ct = b.costResourceType || '', qty = b.costResourceQuantity;
              const free = !ct || qty == null;
              const paidOnly = ct === 'paid_jewel';
              const isTk = ct === 'gacha_ticket';
              const tkName = isTk ? ((tkBy[b.costResourceId] || {}).name || '招募票券') : null;
              const pp = free ? 0 : perPull(ct);
              methods.push({
                spins: b.spinCount,
                cost_label: free
                  ? (b.gachaSpinnableType === 'colorful_pass' ? '免費（七彩通行證，' + (RESET[b.gachaBehaviorType] || '限次') + '）' : '免費')
                  : isTk ? (qty + ' 張' + tkName)
                  : paidOnly ? ('付費水晶 ' + qty.toLocaleString('en-US') + ' 顆（無償水晶不能用）')
                  : ct === 'jewel' ? (qty.toLocaleString('en-US') + ' 水晶（付費／免費皆可）')
                  : (qty + ' ' + ct),
                cost_resource: ct || null,
                cost_quantity: qty == null ? null : qty,
                crystals_per_pull: (ct === 'jewel' || ct === 'paid_jewel') ? Math.round(qty / b.spinCount) : null,
                ticket_name: tkName,
                paid_crystals_only: paidOnly,
                is_free: free,
                pass_only: b.gachaSpinnableType === 'colorful_pass',
                reset: RESET[b.gachaBehaviorType] || null,
                execute_limit: b.executeLimit != null ? b.executeLimit : null,
                guarantee: GUARD[b.gachaBehaviorType] || null,
                bonus_points_per_pull: pp,
                bonus_points_total: r1(pp * b.spinCount),
              });
            });

            let ceil = null;
            const cid = g.gachaCeilItemId;
            if (cid && sumBy[cid]) {
              const su = sumBy[cid];
              const rows = (su.gachaCeilExchanges || []).map(e => ({
                n: (e.gachaCeilExchangeCost || {}).quantity || 0,
                sub: (e.gachaCeilExchangeSubstituteCosts || [])[0] || null,
                subLimit: e.substituteLimit != null ? e.substituteLimit : null,
              }));
              const top = rows.reduce((m, r) => Math.max(m, r.n), 0);
              const main = rows.filter(r => r.n === top);
              const sub = main[0] && main[0].sub;
              const subMax = main[0] ? main[0].subLimit : null;
              // subMax 是 master 的 substituteLimit。沒有這個欄位時代表官方沒寫上限,
              // 不能自作主張當成「無限折抵」——那會算出「0 抽就能天井」這種假結果,所以留 null。
              const covered = (sub && subMax != null) ? subMax * sub.substituteQuantity : null;
              ceil = {
                sticker_name: (ciBy[cid] || {}).name || null,
                stickers_per_card: top,
                pulls_to_ceil: top,
                crystals_to_ceil: top * COST,
                exchange_slots: main.length,
                substitute_ticket: sub ? {
                  name: (matBy[sub.resourceId] || {}).name || ('material#' + sub.resourceId),
                  material_id: sub.resourceId,
                  stickers_each: sub.substituteQuantity,
                  max_tickets_per_slot: subMax,
                  pulls_to_ceil_with_max_tickets: covered == null ? null : Math.max(0, top - covered),
                  crystals_to_ceil_with_max_tickets: covered == null ? null : Math.max(0, top - covered) * COST,
                } : null,
                minor_exchange_costs: [...new Set(rows.map(r => r.n).filter(x => x !== top))].sort((x, y) => y - x),
              };
            }

            return {
              id: g.id, name: g.name || ('#' + g.id), gacha_type: g.gachaType || null,
              is_active: g.startAt <= now && now <= g.endAt,
              start_at: g.startAt ? new Date(g.startAt).toISOString() : null,
              end_at: g.endAt ? new Date(g.endAt).toISOString() : null,
              spin_limit: g.spinLimit != null ? g.spinLimit : null,
              bonus_reward_group_id: g.gachaBonusItemReceivableRewardGroupId != null ? g.gachaBonusItemReceivableRewardGroupId : null,
              methods, ceil,
            };
          });
        }

        // ---- 檔位表 ----
        const CARD_RT = { not_owned_random_rarity4_fixed: 1, selectable_rarity4_fixed: 1 };
        const grpId = (a.tier_group_id != null) ? +a.tier_group_id
          : (pools.length === 1 && pools[0].bonus_reward_group_id != null ? pools[0].bonus_reward_group_id : null);
        let tiers = null, tierSrc = '', itemTiers = null;
        if (grpId != null && Array.isArray(tierRaw)) {
          const rows = tierRaw.filter(r => r.groupId === grpId)
            .sort((x, y) => x.gachaBonusBorderPoint - y.gachaBonusBorderPoint);
          if (rows.length) {
            const cards = rows.filter(r => CARD_RT[r.gachaBonusRewardType]);
            itemTiers = rows.length - cards.length;
            tiers = (cards.length ? cards : rows).map(r => ({
              points: r.gachaBonusBorderPoint,
              reward: r.description || (CARD_RT[r.gachaBonusRewardType] ? '★4 成員' : '道具'),
              is_card: !!CARD_RT[r.gachaBonusRewardType],
            }));
            tierSrc = '官方 master data gachaBonusItemReceivableRewards.json groupId ' + grpId + '（該池實際檔位）'
              + (cards.length ? '，另有 ' + itemTiers + ' 檔每 10 點的道具獎勵未列出' : '，這一池的 50／100 只給道具、不給卡');
          }
        }
        if (!tiers) {
          const mode = (a.pool_mode === 'rf') ? 'rf' : 'normal';
          const M = (GB.MODES && GB.MODES[mode]) || GB.MODES.normal;
          tiers = M.map(t => ({ points: t[0], reward: t[1], is_card: true }));
          tierSrc = 'core.js GachaBonus.MODES.' + mode + '（站上通則，'
            + (mode === 'rf' ? 'Recollection Festival 這類特殊池的四檔含自選' : '常駐／一般池 50／100 兩檔，沒有自選檔')
            + '）；這一池的 master 沒指定專屬檔位群組';
        }

        // ---- 保底試算 ----
        const have = num(a.current_points, 0);
        const paid = num(a.paid_crystals, 0), freeC = num(a.free_crystals, 0), tk = num(a.tickets, 0);
        const paidPulls = Math.floor(paid / COST), freePulls = Math.floor(freeC / COST);
        const gain = paidPulls * PT.paid_jewel + freePulls * PT.jewel + tk * PT.gacha_ticket;
        const after = r1(have + gain);
        const prog = tiers.map(t => {
          const short = Math.max(0, t.points - have);
          return {
            points: t.points, reward: t.reward,
            status: have >= t.points ? 'reached' : after >= t.points ? 'affordable' : 'short',
            points_short: r1(short),
            points_still_short_after_spending: r1(Math.max(0, t.points - after)),
            pulls_needed_paid: short && PT.paid_jewel > 0 ? Math.ceil(short / PT.paid_jewel) : 0,
            paid_crystals_needed: short && PT.paid_jewel > 0 ? Math.ceil(short / PT.paid_jewel) * COST : 0,
            pulls_needed_free: short && PT.jewel > 0 ? Math.ceil(short / PT.jewel) : 0,
            free_crystals_needed: short && PT.jewel > 0 ? Math.ceil(short / PT.jewel) * COST : 0,
          };
        });

        return {
          point_rules: {
            points_per_pull: { paid_jewel: PT.paid_jewel, jewel: PT.jewel, gacha_ticket: PT.gacha_ticket, colorful_pass_free_pull: 0 },
            crystals_per_pull: COST, source: ptSrc,
            note: '付費（有償）水晶抽 1 點／抽；免費（無償）水晶與招募票券 0.5 點／抽；七彩通行證的免費抽 0 點。'
              + '同樣抽數，免費水晶只拿到付費水晶一半的點數，所以免費抽要兩倍抽數才追平。'
              + '招募票券 1 張＝1 抽＝0.5 點，跟免費水晶同檔，pulls_needed_free 就等於需要的券數。',
          },
          bonus_tiers: tiers,
          tier_source: tierSrc,
          tier_item_only_count: itemTiers,
          progress: {
            current_points: r1(have),
            from_paid_crystals: { crystals: paid, pulls: paidPulls, points: r1(paidPulls * PT.paid_jewel) },
            from_free_crystals: { crystals: freeC, pulls: freePulls, points: r1(freePulls * PT.jewel) },
            from_tickets: { tickets: tk, pulls: tk, points: r1(tk * PT.gacha_ticket) },
            points_gained: r1(gain),
            points_after: after,
            tiers: prog,
            note: '點數 ＝ ⌊付費水晶/300⌋×1 ＋ ⌊免費水晶/300⌋×0.5 ＋ 券數×0.5。'
              + 'pulls_needed_* 是「從 current_points 起算」還要再抽幾次，'
              + '不是扣掉手上資源後的缺口；扣完資源的缺口看 points_still_short_after_spending。',
          },
          pools_total: total, pools_offset: off, pools_shown: pools.length, pools,
          note: '招募點數與 300 抽天井是兩套各自獨立的保底：天井是抽卡累積貼紙、湊滿去交換所換卡；'
            + '招募點數是依「花了什麼資源」累積點數、跨過門檻直接發卡。'
            + 'pools 是符合條件的完整清單依開始時間新→舊排序後的前 N 筆（pools_total 是總數），不是取樣。',
          caveats: [
            '只讀規則常數（GachaBonus.PT／COST／MODES）與官方 master 檔，全程沒有呼叫 GachaBonus.calc()——那支會去讀寫經典版頁面的 #gbHave／#gbResult 節點，本頁沒有那些節點，而且會動到畫面。',
            '「未持有」是看你帳號倉庫，本工具無從得知，所以 50／100 點保底實際會發哪張卡算不出來，只能講規則。',
            '台服 gachas.json 只留現行與近期卡池（約 70 餘個），太舊的池查不到；資料含已datamine 到的未來檔期，is_active=false 的是還沒開或已結束。',
            '天井貼紙以「1 抽＝1 張」計；通行證的免費抽是否給貼紙、master 沒有欄位可證實，未納入計算。',
            'substitute_ticket 是官方 master 寫的貼紙交換券折抵（1 張抵 10 貼紙、每個兌換格上限 max_tickets_per_slot）。注意生日池在 master 裡同樣有折抵設定，與站上 gacha_odds 目前寫的「生日池不可用交換券」不一致，以遊戲內交換所畫面為準。',
            '第一次呼叫要下載 gachas.json（約 4.4 MB）等 master 檔，可能要幾秒；之後走 IndexedDB 快取（12 小時）。只想算點數不看卡池成本時給 include_pools:false 可以省掉這筆下載。',
          ],
        };
      }

      case 'get_pass_value': {
        await this.loadBilling();
        const D = (typeof BILLING_DATA !== 'undefined') ? BILLING_DATA : null;
        if (!D || !Array.isArray(D.items) || D.items.length < 100) {
          return { error: '商城商品資料尚未載入（' + (this.state.billErr || '請稍後再試') + '）' };
        }
        // passes 是通行證每日領取量的唯一來源,沒有它就只能算到票面,攤提整個失真 —— 寧可回錯誤
        if (!D.passes || !D.passes.v2 || !D.passes.v2Daily) return { error: '商品資料裡沒有通行證設定（passes），算不出每日領取的攤提' };

        const PULL = 300;                       // 單抽 300 水晶
        const NOW = Date.now();
        const onSale = r => (!r.s || r.s <= NOW) && (!r.e || r.e >= NOW);
        const catOf = r => r.t === 'jewel' ? 'jewel' : r.t === 'value_set' ? 'set' : r.t === 'costume_3d' ? 'costume' : 'pass';
        const fd = ms => { const d = new Date(ms); return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate(); };
        const limTxt = r => {
          const L = r.lim || {};
          if (L.t === 'live_point') return '需當月 LIVE P 達 ' + this.n(L.v) + '（每月重置）';
          if (L.t === 'unlimited' || L.v == null || L.v < 0) return '不限購';
          const c = L.v + ' 次';
          if (L.r === 'day') return '每日 ' + c;
          if (L.r === 'weekly') return '每週 ' + c;
          if (L.r === 'monthly') return '每月 ' + c;
          if (L.t === 'user_rank') return '新手限定 ' + c;
          return '總共限購 ' + c;
        };

        const incT = a.include_ticket_value !== false;
        const incM = a.include_material_value !== false;

        /* 售價三層優先序,照站上「儲值分析」:本次呼叫指定 > 使用者在儲值分析頁自填 > master 定價。
           月卡/通行證在 master 幾乎都是 9999 佔位價(pk=false),不吃自填就整頁都算不出 CP 值。
           localStorage 只讀不寫,跟儲值分析頁同一個 key,不會動到使用者的設定。 */
        let priceOv = {};
        try { priceOv = JSON.parse(localStorage.getItem('sekai-shop-price-ov') || '{}') || {}; } catch (e) { priceOv = {}; }
        const argOv = (a.price_overrides && typeof a.price_overrides === 'object') ? a.price_overrides : {};
        const ovOf = r => +argOv[r.id] || +priceOv[r.id] || 0;
        const priceOf = r => { const o = ovOf(r); if (!r.pk && o > 0) return o; return (r.pk && r.price > 0) ? r.price : null; };
        const priceSrc = r => (r.pk && r.price > 0) ? 'master 官方定價'
          : ovOf(r) > 0 ? (+argOv[r.id] > 0 ? '本次呼叫帶入的售價' : '使用者在「儲值分析」頁自填的售價') : null;

        /* 道具→有償水晶單價表,跟 get_shop_items 共用同一份快取與同一套規則:
           只認「單一內容物＋有償水晶兌換價＋不含水晶」的純道具包,那是遊戲對該道具的自報價。 */
        const MAT_SKIP = { ticket: 1, colorful_pass: 1, colorful_pass_v2: 1, mysekai_colorful_pass: 1, costume: 1 };
        const MAT_MINQ = 10;
        const cKey = c => c[0] + ' ' + c[2];
        let mi = this._billMi;
        if (!mi || mi.built !== D.builtAt) {
          const idx0 = {};
          D.items.forEach(r => {
            const cs = (r.c || []).concat(r.bc || []);
            if (!r.exch || r.paid || r.free || cs.length !== 1) return;
            const c = cs[0], q = c[1];
            if (!(q > 0) || MAT_SKIP[c[0]] || q < MAT_MINQ) return;
            const per = r.exch / q;
            if (!(per > 0)) return;
            const k = cKey(c);
            if (idx0[k] == null || per < idx0[k].per) idx0[k] = { per, n: c[2] };
          });
          mi = this._billMi = { built: D.builtAt, idx: idx0 };
        }
        const idx = mi.idx;
        /* 官網商品的內容物在原始資料裡型別一律是 web_item,cKey 對不上 material,
           所以站上主表沒把官網附贈的心願碎片折算成石。這張「只看名稱」的表專供
           uncounted_extras_est_jewels 用,刻意不進主 CP —— 進去會跟站上數字對不起來。 */
        const byName = {};
        Object.keys(idx).forEach(k => { const h = idx[k]; if (byName[h.n] == null || h.per < byName[h.n]) byName[h.n] = h.per; });

        // 通行證每日領取的無償石:資料在 colorful_pass(_v2) 的 resource box(禮物盒發放 = 無償)
        const dailyOf = r => {
          let total = 0, days = 0, tier = null, kind = null;
          (r.c || []).forEach(c => {
            if (c[0] === 'colorful_pass' && c[3] != null) {
              const d = ((D.passes.v1 || [])[0] || {}).expireDays || 30;
              total += (D.passes.v1Daily[c[3]] || 0) * d; days = Math.max(days, d); kind = 'colorful_pass_v1'; tier = c[3];
            }
            if (c[0] === 'colorful_pass_v2' && c[3] != null) {
              const p = (D.passes.v2 || []).find(x => x.id === c[3]) || {};
              const d = p.expireDays || 30;
              total += (D.passes.v2Daily[c[3]] || 0) * d; days = Math.max(days, d); kind = 'colorful_pass_v2'; tier = c[3];
            }
            if (c[0] === 'mysekai_colorful_pass') {
              kind = 'mysekai_colorful_pass'; tier = c[3] != null ? c[3] : null;
              days = Math.max(days, (D.passes.mysekai || {}).expireDays || 30);   // 世界通行證沒有每日水晶,只有期限
            }
          });
          return { total, days, tier, kind };
        };
        const matBag = r => {
          const acc = {};
          (r.c || []).concat(r.bc || []).forEach(c => {
            const h = idx[cKey(c)];
            if (!h || !(c[1] > 0)) return;
            (acc[cKey(c)] || (acc[cKey(c)] = { name: c[2], per: h.per, qty: 0 })).qty += c[1];
          });
          return Object.keys(acc).map(k => acc[k]).map(x => (x.jewels = Math.round(x.qty * x.per), x)).sort((p, q) => q.jewels - p.jewels);
        };
        /* 官網有幾筆的水晶數寫在品項說明文字裡(「免費水晶*420」,build-billing.py 的正則只認 ×/x),
           不撈回來這幾筆會顯示 0 石、看起來像全店最爛。跟 get_shop_items 同一套補救。 */
        const webFree = r => {
          if (r.src !== 'web' || r.paid || r.free) return 0;
          let s = 0;
          (r.c || []).forEach(c => {
            if (c[0] !== 'web_item') return;
            const m = String(c[2]).match(/水晶\s*[*x×]\s*([\d,]+)/);
            if (m) s += +m[1].replace(/,/g, '') || 0;
          });
          return s;
        };
        // 站上主表算不到價的內容物(官網 web_item…)的補充估值,只做參考、不進 CP
        const extraEst = r => {
          let s = 0;
          (r.c || []).concat(r.bc || []).forEach(c => {
            if (idx[cKey(c)] || !(c[1] > 0) || MAT_SKIP[c[0]]) return;
            const per = byName[c[2]];
            if (per > 0) s += c[1] * per;
          });
          return Math.round(s);
        };
        // 官方說明有時寫著跟資料庫不一樣的天數(七彩通行證舊版寫「最多14日」,master 的 expireDays 是 30)
        const descDays = r => { const m = String(r.d || '').match(/最多\s*(\d+)\s*日/); return m ? +m[1] : null; };

        // 基準線:App 商店「常駐不限購」水晶包的最佳石/元。官網包不列入,才顯得出官網多送多少
        let base = 0, baseR = null;
        D.items.forEach(r => {
          if (r.src || r.t !== 'jewel' || r.lim.t !== 'unlimited' || !r.pk || !onSale(r)) return;
          const v = (r.paid + r.free) / r.price;
          if (v > base) { base = v; baseR = r; }
        });
        base = base || 3.9;

        const PERK = {
          colorful_pass_v1: p => ['LIVE P 獲得 ×' + (p.livePointMultiple || 1),
            '每日限定有償招募 ' + (p.dailyPaidGachaSpinLimit || 0) + ' 次',
            '活力補給上限 ' + (p.boostRecoveryLimit || 0), '每日自動 LIVE ' + (p.dailyAutoLimit || 0) + ' 次'],
          colorful_pass_v2: p => ['挑戰 LIVE P 獲得 ×' + (p.challengeLivePointRate || 1), 'LIVE P 獲得 ×' + (p.livePointRate || 1),
            p.dailyFreeGachaSpinLimit ? '每日免費招募 ' + p.dailyFreeGachaSpinLimit + ' 次' : '',
            '每日限定有償招募 ' + (p.dailyPaidGachaSpinLimit || 0) + ' 次',
            'LIVE BONUS 上限 ' + (p.maxLiveBonusCount || 0), '自動 LIVE 次數 ' + (p.maxAutoPlayCount || 0)].filter(Boolean),
          mysekai_colorful_pass: p => ['家具製作時間 −' + Math.round((p.mysekaiConvertFixtureConvertMinutesDecreaseRate || 0) * 100) + '%',
            '住宅版型預設槽位保留 ' + (p.mysekaiSiteHousingPresetSlotExpireDays || 0) + ' 天'],
        };
        const perksOf = r => {
          const d = dailyOf(r);
          let out = [];
          if (d.kind === 'colorful_pass_v1') out = PERK.colorful_pass_v1((D.passes.v1 || [])[0] || {});
          if (d.kind === 'colorful_pass_v2') out = PERK.colorful_pass_v2((D.passes.v2 || []).find(x => x.id === d.tier) || {});
          if (d.kind === 'mysekai_colorful_pass') out = PERK.mysekai_colorful_pass(D.passes.mysekai || {});
          if (r.t.indexOf('live_mission_pass') === 0) out = out.concat(['解鎖當月高階任務獎勵軌（進度水晶／限定服裝／素材，不在票面內，實際價值高於帳面）']);
          if (r.t.indexOf('mysekai_mission_pass') === 0) out = out.concat(['解鎖「世界」任務獎勵軌（不在票面內）']);
          return out;
        };

        // 官網兌換券 ←→ App 直購版:同一件商品的兩個通路(ref 指向 App 版的 id),比價時別當兩件
        const voucherFor = {};
        D.items.forEach(r => { if (r.src === 'web' && r.ref != null) voucherFor[r.ref] = r; });

        const row = r => {
          const d = dailyOf(r);
          const price = priceOf(r);
          const freeNow = r.free + webFree(r);
          const mats = incM ? matBag(r) : [];
          const matJ = mats.reduce((s, x) => s + x.jewels, 0);
          const tick = incT ? r.pulls * PULL : 0;
          const nowJ = r.paid + freeNow + matJ + tick;      // 買下當天就入帳的價值
          const total = nowJ + d.total;                      // 站上口徑 totalJ:每日領取已全額攤提進來
          const rate = (price && total) ? total / price : null;
          /* 回本天數:同一筆錢拿去買 App 常駐最佳水晶包能換到幾顆石,就是門檻;
             立即入帳的先抵,不足的部分由每日領取一天一天補。0 = 當天就已回本。 */
          const need = price ? price * base : null;
          const perDay = d.days ? d.total / d.days : 0;
          let be = null, beNote;
          if (!price) beNote = '售價未公布，無法算回本天數（請看 web_voucher 或用 price_overrides 帶入實售價）';
          else if (need <= nowJ) { be = 0; beNote = '不用等每日領取，買下當天入帳的價值就已超過「同樣的錢買常駐最佳水晶包」'; }
          else if (perDay > 0) {
            const k = Math.ceil((need - nowJ) / perDay);
            if (k <= d.days) { be = k; beNote = '登入領到第 ' + k + ' 天追平「同樣的錢買常駐最佳水晶包」，之後每天都是純賺'; }
            else beNote = '整期 ' + d.days + ' 天全部領完仍追不平基準線，價值主要在特典（LIVE P 倍率、免費招募）而不是水晶';
          } else beNote = '沒有每日領取，價值全在購買當下入帳（任務通行證的獎勵軌另計，不在票面內）';
          const verdict = !price ? '需先確認售價' : rate >= base * 1.5 ? '大賺' : rate >= base ? '划算' : '看需求';
          const web = (r.src !== 'web' && voucherFor[r.id]) ? voucherFor[r.id] : null;
          const dd = descDays(r), est = extraEst(r);
          return {
            id: r.id, name: r.n, type: r.t,
            channel: r.src === 'web' ? '官網商店（GamePay/MyCard・信用卡）' : 'App 內商店（iOS/Android 同價）',
            price_twd: price, price_source: priceSrc(r), verdict: verdict,
            paid_jewels_now: r.paid,          // 有償水晶：能抽有償限定池、能兌換演出服裝
            free_jewels_now: freeNow,         // 無償水晶：買下當天就入帳的那部分
            daily_claim: d.total ? {
              free_jewels_per_day: Math.round(perDay), days: d.days, free_jewels_total: d.total,
              kind: '無償水晶（禮物盒發放，不能抽有償限定池）',
              data_conflict: (dd && dd !== d.days)
                ? '官方說明寫「最多 ' + dd + ' 日」，但 master 的 expireDays 是 ' + d.days + ' 天。本工具與站上一致採用 ' + d.days + ' 天；若實際只有 ' + dd + ' 天，每日領取合計只有 ' + this.n(perDay * dd) + ' 石（現在算 ' + this.n(d.total) + ' 石），CP 值會高估。回答時請提醒使用者以遊戲內商店說明為準。'
                : null,
            } : null,
            ticket_pulls: r.pulls || 0,
            ticket_value_jewels: tick || 0,
            material_value_jewels: matJ,
            materials: mats.slice(0, 6).map(x => x.name + '×' + this.n(x.qty) + '（' + (+x.per.toFixed(3)) + ' 石/個，計 ' + this.n(x.jewels) + ' 石）'),
            value_at_purchase_jewels: Math.round(nowJ),
            total_value_jewels: Math.round(total),
            jewels_per_twd: rate == null ? null : +rate.toFixed(2),
            vs_baseline_pct: rate == null ? null : Math.round((rate / base - 1) * 100),
            breakeven_days: be, breakeven_note: beNote,
            uncounted_extras_est_jewels: est || null,
            perks: perksOf(r),
            purchase_limit: limTxt(r), on_sale_now: onSale(r),
            ends: r.e && r.e - NOW < 3650 * 86400000 ? fd(r.e) : null,
            official_desc: r.d ? r.d.replace(/\n/g, ' / ').slice(0, 120) : null,
            web_voucher: web ? {
              id: web.id, name: web.n, price_twd: web.price,
              extra_free_jewels: web.free + webFree(web),
              extra_paid_jewels: Math.max(0, web.paid - r.paid),
              hint: '官網買兌換券、遊戲內兌換成同一張通行證；App 版沒公布定價時可拿這個當參考價',
            } : null,
            app_same_item_id: r.src === 'web' ? (r.ref != null ? r.ref : null) : null,
          };
        };

        const section = ['all', 'pass', 'compare'].indexOf(String(a.section || 'all')) >= 0 ? String(a.section || 'all') : 'all';
        const expire = (((D.passes.v2 || [])[0] || {}).expireDays) || 30;
        const out = {
          ok: true,
          currency: 'TWD（新台幣，商店標價）',
          data_built_at: D.builtAt ? new Date(D.builtAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : null,
          web_shop_url: 'https://gamepay.ariel.com.tw/topup/5245',
          pull_cost_jewels: PULL,
          baseline_jewels_per_twd: +base.toFixed(2),
          baseline_source: baseR ? ('App 內商店常駐不限購水晶包的最佳值＝' + baseR.n + '（' + this.n(baseR.paid + baseR.free) + ' 石／NT$' + this.n(baseR.price) + '）')
            : '資料裡找不到常駐水晶包，退回預設 3.9 石/元',
          verdict_rule: 'jewels_per_twd ≥ 基準×1.5 →「大賺」；≥ 基準 →「划算」；低於基準 →「看需求」（與站上「儲值分析 → 月卡·通行證」同一條線）',
          assumptions: {
            paid_vs_free: 'paid_jewels_now 是有償水晶（可抽有償限定池、可兌換演出服裝）；free_jewels_now 與 daily_claim.free_jewels_total 是無償水晶（不能抽有償池）。CP 值計算時兩者同權相加，站上算法就是這樣，但對只想抽有償池的人要另外看 paid。',
            amortization: '每日領取的石分 ' + expire + ' 天入帳，站上算法把整期全額攤提進 total_value_jewels，等於假設「天天登入、領好領滿」；少登入一天就少一天的量，中途棄坑等於白花。',
            breakeven: 'breakeven_days = 同一筆錢改買基準水晶包（' + base.toFixed(2) + ' 石/元）能換到的石當門檻，扣掉購買當下入帳的價值後，還要領幾天才追平。0 = 當天就回本；null 配上 breakeven_note 表示追不平或售價未知。',
            tickets_counted: incT, materials_counted: incM,
            material_pricing: '道具單價從資料反推：只認「單一內容物＋有償水晶兌換價＋不含水晶」的純道具包，同道具多檔取最低價，且只採計量 ≥10 的檔位（小包單價含便利溢價，外推會嚴重灌水）。折算出來是商店賣價，不等於實用價值。',
            official_desc_caveat: 'official_desc 是 master 原文，部分品項還是未在地化的日文舊文案，數字（水晶量、天數）可能跟現行內容物對不上；一切以本工具算出的欄位（來自 resource box）與遊戲內商店顯示為準。',
            not_counted: '任務通行證（live_mission_pass／mysekai_mission_pass）的任務獎勵軌（進度水晶、限定服裝、素材）不在票面內，也沒進 total_value_jewels，所以這幾張實際價值高於帳面；演出服裝部件一律不折算。',
          },
        };

        if (section !== 'compare') {
          const rows = D.items.filter(r => catOf(r) === 'pass' && (a.include_ended === true || onSale(r)))
            .map(row).filter(x => x.total_value_jewels > 0 || x.price_twd != null);
          // 未定價的排最後:它們的 jewels_per_twd 是 null,不能跟有價的混排
          rows.sort((x, y) => (y.jewels_per_twd == null ? -1 : y.jewels_per_twd) - (x.jewels_per_twd == null ? -1 : x.jewels_per_twd));
          /* 預設 30 筆時整包回傳約 23.8 KB(≈9,500 tokens),一次呼叫就吃掉大量脈絡。
           回答「月卡划算嗎」用不到那麼多,10 筆足夠;要看更多再用 offset 翻頁。 */
        const lim = Math.max(1, Math.min(40, +a.limit || 10));
          const off = Math.max(0, +a.offset || 0);
          out.passes_total = rows.length;
          out.offset = off;
          out.has_more = off + lim < rows.length;
          out.unpriced_count = rows.filter(x => x.price_twd == null).length;
          out.passes = rows.slice(off, off + lim);
          out.passes_note = '這是台服' + (a.include_ended === true ? '（含已結束）' : '目前販售中') + '全部 ' + rows.length
            + ' 張月卡／通行證，依 jewels_per_twd 由高到低完整排序後的第 ' + (off + 1) + '～' + Math.min(off + lim, rows.length)
            + ' 名，不是取樣，不要用多次小批次拼湊。price_twd 為 null 的是 master 只有 9999 佔位價的商品（月卡幾乎都這樣）：'
            + '先看它的 web_voucher（官網兌換券版價格已知，還常多送水晶），或請使用者到商店確認售價後用 price_overrides 重算。'
            + ' 同一張通行證會同時出現「App 直購版」與「官網兌換券版」兩筆（用 app_same_item_id／web_voucher 互指），那是同一件商品的兩個通路，不是兩張，別加總。';
        }

        if (section !== 'pass') {
          // 官網 vs App 水晶包:以「有償水晶數」配對同一檔位(台幣定價兩邊相同,差別在官網多送無償)
          const appT = {}, webT = {};
          D.items.forEach(r => {
            if (r.t !== 'jewel' || !r.pk || !onSale(r)) return;
            if (!r.src && r.lim.t === 'unlimited') appT[r.paid] = r;
            if (r.src === 'web' && /官網專屬水晶/.test(r.n)) webT[r.paid] = r;
          });
          const tiers = Object.keys(webT).map(Number).sort((x, y) => x - y).map(paid => {
            const w = webT[paid], ap = appT[paid];
            const wr = (w.paid + w.free) / w.price;
            const ar = ap ? (ap.paid + ap.free) / ap.price : null;
            return {
              tier_paid_jewels: paid,
              app: ap ? { name: ap.n, price_twd: ap.price, free_jewels: ap.free, jewels_per_twd: +ar.toFixed(2), purchase_limit: limTxt(ap) } : null,
              web: { name: w.n, price_twd: w.price, free_jewels: w.free, jewels_per_twd: +wr.toFixed(2), purchase_limit: limTxt(w) },
              web_extra_free_jewels: w.free - (ap ? ap.free : 0),
              web_extra_items: (w.c || []).concat(w.bc || []).filter(c => c[1] > 0).map(c => c[2] + '×' + this.n(c[1])),
              web_extra_items_est_jewels: extraEst(w) || null,
              web_advantage_pct: ar ? Math.round((wr / ar - 1) * 100) : null,
              status: ar ? '同價位、官網多送無償水晶' : '官網限定檔位（App 沒有這個級距）',
            };
          });
          // 官網兌換券 vs App 直購:同一張通行證的兩個通路
          const vouchers = D.items.filter(r => r.src === 'web' && r.ref != null && onSale(r)).map(w => {
            const m = D.items.find(x => x.id === w.ref) || null;
            const mp = m ? priceOf(m) : null;
            return {
              web_id: w.id, name: w.n, web_price_twd: w.price,
              app_item_id: w.ref, app_name: m ? m.n : null, app_price_twd: mp,
              web_extra_free_jewels: w.free + webFree(w),
              web_extra_paid_jewels: m ? Math.max(0, w.paid - m.paid) : null,
              diff: mp == null ? '遊戲內未公布定價，官網券價可當參考價'
                : w.price < mp ? '官網便宜 NT$' + this.n(mp - w.price)
                  : w.price === mp ? '同價，官網多送' : '官網貴 NT$' + this.n(w.price - mp),
            };
          });
          // 官網限定、App 完全沒有的商品(見面禮、官網組合包…)
          const webOnly = D.items.filter(r => r.src === 'web' && r.ref == null && onSale(r) && r.pk && !/官網專屬水晶/.test(r.n))
            .map(r => {
              const f = r.free + webFree(r);
              const t = r.paid + f + (incT ? r.pulls * PULL : 0) + (incM ? matBag(r).reduce((s, x) => s + x.jewels, 0) : 0);
              return {
                id: r.id, name: r.n, price_twd: r.price,
                paid_jewels: r.paid, free_jewels: f, ticket_pulls: r.pulls || 0,
                jewels_per_twd: r.price ? +(t / r.price).toFixed(2) : null,
                uncounted_extras_est_jewels: extraEst(r) || null,
                contents: (r.c || []).concat(r.bc || [])
                  .filter(c => !(f && c[0] === 'web_item' && /水晶\s*[*x×]\s*[\d,]+/.test(c[2])))
                  .map(c => c[2] + (c[0] === 'web_item' ? '' : '×' + this.n(c[1]))).slice(0, 8),
                purchase_limit: limTxt(r),
                ends: r.e && r.e - NOW < 3650 * 86400000 ? fd(r.e) : null,
              };
            }).sort((x, y) => (y.jewels_per_twd || 0) - (x.jewels_per_twd || 0));
          out.web_vs_app = {
            crystal_tiers: tiers,
            pass_vouchers: vouchers,
            web_only_items: webOnly.slice(0, 12),
            note: '同一檔位（以有償水晶數配對）官網與 App 的台幣定價相同，差別在官網「多送無償水晶」：'
              + 'web_extra_free_jewels 就是多送的量，web_advantage_pct 是石/元的提升幅度。'
              + '官網商品的內容物在原始資料裡型別是 web_item，對不上道具單價表，所以 jewels_per_twd 沒把附贈的心願碎片等算進去'
              + '（web_extra_items_est_jewels 是用名稱回推的補充估值，站上主表同樣沒計，僅供口頭補充）——'
              + '也就是官網的實際優勢比表上的百分比再大一些。'
              + '官網要到 gamepay.ariel.com.tw 用 MyCard／信用卡結帳，付款後水晶與道具直接進遊戲帳號；'
              + '兌換券版買到的是「券」，要再到遊戲內兌換。**本工具只做試算與比價，不會也不能執行任何購買或付款。**',
          };
        }

        out.note = '所有數字都照站上「儲值分析 → 月卡·通行證／CP 排行」的同一套算法重算（本工具自己算，不會動到畫面上的儲值分析區）。'
          + 'total_value_jewels ＝ 有償水晶 ＋ 立即入帳的無償水晶 ＋ 每日領取無償水晶總額'
          + (incT ? ' ＋ 招募票券×300 石/抽' : '（票券未折算）')
          + (incM ? ' ＋ 道具以商店價折算' : '（道具未折算）')
          + '；jewels_per_twd ＝ total_value_jewels ÷ price_twd。'
          + '每日領取的石是分 ' + expire + ' 天入帳的，急著今天抽完的人不能把它當現貨，回答時務必照實說「要慢慢領」。'
          + '價格為資料庫定價（資料時間見 data_built_at），實際以遊戲內商店與官網即時顯示為準。'
          + '**本工具只做試算，不會也不能執行任何購買或交易。**';
        return out;
      }

      case 'get_player_career': {
        const uid = String(a.uid || this.state.pid || '').replace(/\D/g, '');
        if (!uid) return { error: '沒有指定 uid，也還沒設定使用者自己的 uid（可先用 set_my_uid）' };
        const all = await this.loadEvList();
        if (!all || !all.length) return { error: '活動清單載入失敗，無法掃描歷期前百' };
        const now = Date.now();
        // 只掃已結算的期數：還在跑的當期名次隨時在變，混進生涯統計沒有意義
        const done = all.filter(e => new Date(e.aggregate_at || e.closed_at || e.start_at).getTime() <= now)
                        .sort((x, y) => y.id - x.id);
        if (!done.length) return { error: '沒有任何已結算的活動' };

        let pick;
        if (a.event_id != null && a.event_id !== '') {
          pick = done.filter(e => +e.id === +a.event_id);
          if (!pick.length) return { error: '找不到第 ' + a.event_id + ' 期，或該期尚未結算' };
        } else {
          const off = Math.max(0, Math.min(done.length, Math.floor(+a.offset || 0)));
          const lim = Math.max(1, Math.min(60, Math.floor(+a.limit || 20)));
          pick = done.slice(off, off + lim);
          if (!pick.length) return { error: 'offset ' + off + ' 已超過已結算期數（共 ' + done.length + ' 期）' };
        }

        // 每期 top100 約 370 KB，一期一個外部請求；同一次對話重複問（換 uid、換區段）直接吃快取
        this._careerCache = this._careerCache || new Map();
        const fetchEv = async e => {
          if (this._careerCache.has(e.id)) return this._careerCache.get(e.id);
          try {
            const d = await this.apiFetch('/event/' + e.id + '/top100');
            const rows = this.ranksOf(d).map(r => ({ uid: r.uid, rank: r.rank, score: r.score, name: r.name }));
            if (rows.length) this._careerCache.set(e.id, rows);
            return rows;
          } catch (err) { return null; }
        };

        const hits = [];
        let failed = 0;
        const BATCH = 6;   // 與站上 loadHistory 同一個併發度，一口氣全轟過去會被擋
        for (let i = 0; i < pick.length; i += BATCH) {
          const part = pick.slice(i, i + BATCH);
          const res = await Promise.all(part.map(e => fetchEv(e).then(rows => ({ e, rows }))));
          res.forEach(({ e, rows }) => {
            if (!rows) { failed++; return; }
            const hit = rows.find(r => this.sameUid(r.uid, uid));
            if (hit) hits.push({ e, rank: hit.rank, score: hit.score, name: hit.name });
          });
        }
        hits.sort((x, y) => y.e.id - x.e.id);

        const okN = pick.length - failed;
        if (!hits.length) {
          return { uid, scanned_events: okN, failed_events: failed,
            scanned_range: { newest_event_id: pick[0].id, oldest_event_id: pick[pick.length - 1].id },
            total_finished_events: done.length,
            appearances: 0, records: [],
            note: '掃描的 ' + okN + ' 期已結算活動裡，這位玩家都沒有進過前 100 名。'
              + '公開 API 只提供各期前 100 名的名單，第 101 名之後查不到，所以「沒入榜」不等於「沒打」。' };
        }

        const ranks = hits.map(h => h.rank);
        const srt = ranks.slice().sort((x, y) => x - y);
        const med = srt.length % 2 ? srt[(srt.length - 1) / 2] : (srt[srt.length / 2 - 1] + srt[srt.length / 2]) / 2;
        const bestH = hits.reduce((b, h) => (h.rank < b.rank ? h : b), hits[0]);
        const bestS = hits.reduce((b, h) => (h.score > b.score ? h : b), hits[0]);

        return {
          uid,
          latest_name: hits[0].name || null,
          scanned_events: okN,
          failed_events: failed,
          scanned_range: { newest_event_id: pick[0].id, oldest_event_id: pick[pick.length - 1].id },
          total_finished_events: done.length,
          appearances: hits.length,
          appearance_rate_pct: okN ? +(hits.length / okN * 100).toFixed(1) : null,
          best_rank: bestH.rank,
          best_rank_event: { id: bestH.e.id, name: bestH.e.name || null },
          average_rank: +(ranks.reduce((s, r) => s + r, 0) / ranks.length).toFixed(1),
          median_rank: med,
          worst_rank: Math.max.apply(null, ranks),
          best_score: bestS.score,
          best_score_event: { id: bestS.e.id, name: bestS.e.name || null },
          latest: { event_id: hits[0].e.id, rank: hits[0].rank, score: hits[0].score },
          records: hits.map((h, i) => {
            const prev = hits[i + 1];   // 陣列由新到舊，i+1 就是「上一次入榜」
            return {
              event_id: h.e.id, event_name: h.e.name || null,
              ended_at: h.e.aggregate_at || h.e.closed_at || null,
              rank: h.rank, score: h.score,
              delta_vs_prev_appearance: prev ? prev.rank - h.rank : null
            };
          }),
          note: 'rank ＝ 該期活動最終榜（前 100 名）的名次；score 單位是活動 P（event point）。'
            + 'delta_vs_prev_appearance ＝ 上一次入榜名次 − 這次名次，正數代表進步（名次數字變小）；'
            + '比的是「上一次入榜的那期」而不是「上一期活動」，中間沒入榜的期數會被跳過。'
            + 'appearance_rate_pct ＝ appearances ÷ scanned_events × 100（單位 %）。'
            + '只涵蓋各期前 100 名的公開名單，沒進前百的期數查不到，因此 best／average／median 都是「在有入榜的期數之中」算的。'
        };
      }

      case 'get_wl_exchange': {
        /* 交換所表不是獨立檔，是 BORDERS_DB.exchange（tools/build-goodjuice.py 由
           good果汁的規劃表同步進 data/borders-db.js）。整份榜線資料庫是懶載入的，
           使用者沒開過榜線／資料庫頁時 BORDERS_DB 還不存在，不補載會誤回「查無資料」。 */
        await this.loadBorderDB().catch(() => {});
        const D = (typeof BORDERS_DB !== 'undefined') ? BORDERS_DB : null;
        const EX = D && D.exchange ? D.exchange : null;
        if (!EX) return { error: 'WL 交換所規劃表載入失敗（榜線資料庫沒載進來），請稍後再試' };

        const rounds = Object.keys(EX).sort();
        // 模型常常只丟數字（3）或小寫（wl3），統一正規化成 'WL3'
        const want = String(a.round == null ? '' : a.round).trim().toUpperCase().replace(/^WL/, '');
        const key = want ? ('WL' + want) : rounds[rounds.length - 1];
        const secs = EX[key];
        if (!Array.isArray(secs) || !secs.length) {
          return { error: '沒有 ' + key + ' 的交換所資料', available_rounds: rounds };
        }

        /* 表上每屆都列滿 6 個章節交換所，但實際章節數各場不同，而且這件事沒辦法從
           表本身推出來 —— 與畫面那段 CH_OPTS 是同一份知識，改一邊要改兩邊。
             WL2 —— OC 團 4 章、V 家 6 章
             WL3 —— 5 章，其中 3.2 是 6 章
             終章 —— 只有一個交換所、不需要規劃，所以不列在選項裡 */
        const CH_OPTS = {
          WL2: [[4, 'OC 團 4 章'], [6, 'V 家 6 章']],
          WL3: [[5, '5 章'], [6, '3.2 版 6 章']],
        };
        const opts = CH_OPTS[key] || [[4, '4 章'], [6, '6 章']];

        const chSecs = [], ovSecs = [];
        secs.forEach(sec => (/章節/.test(sec.title) ? chSecs : ovSecs).push(sec));

        const cc = a.chapter_count != null ? Math.round(+a.chapter_count) : opts[0][0];
        if (!(cc >= 0) || cc > chSecs.length) {
          return { error: 'chapter_count 只能是 0～' + chSecs.length + ' 的整數',
            standard_options: opts.map(([v, n2]) => ({ chapters: v, label: n2 })) };
        }

        const sum = its => its.reduce((t, it) => t + (it.cost || 0) * (it.max || 0), 0);
        const mk = (sec, no) => ({
          section: sec.title,
          kind: no ? 'chapter' : 'overall',
          chapter: no || null,
          counted: no ? no <= cc : true,   // 超出這屆實際章節數的不計入總需求
          currency: no ? '章節徽章' : '綜合徽章',
          item_count: sec.items.length,
          section_badges: sum(sec.items),
          items: sec.items.map(it => ({ item: it.n, cost_each: it.cost, max: it.max,
            subtotal: (it.cost || 0) * (it.max || 0) })),
        });
        const all = ovSecs.map(x => mk(x, 0)).concat(chSecs.map((x, i) => mk(x, i + 1)));

        // chapter 只縮小「回傳哪幾區」，totals 仍然是整屆的，免得模型分批問再自己加錯
        let show = all;
        if (a.chapter != null) {
          const c = Math.round(+a.chapter);
          show = all.filter(x => (c === 0 ? x.kind === 'overall' : x.chapter === c));
          if (!show.length) {
            return { error: '找不到第 ' + a.chapter + ' 章的交換所',
              available_chapters: chSecs.map((_, i) => i + 1),
              hint: 'chapter=0 是綜合交換所，省略則回全部' };
          }
        }

        const ovB = ovSecs.reduce((t, x) => t + sum(x.items), 0);
        const perCh = chSecs.map((x, i) => ({ chapter: i + 1, badges: sum(x.items), counted: i + 1 <= cc }));
        const chB = perCh.filter(x => x.counted).reduce((t, x) => t + x.badges, 0);
        const total = ovB + chB;

        /* 各章的品項是同一組（只有主角不同），逐章列會是同樣的字重複 N 遍，
           所以按「品項×計入章數」聚合，直接看得出徽章花在哪幾樣上。 */
        const agg = {};
        const push = (it, from) => {
          const k = from + '｜' + it.n;
          if (!agg[k]) agg[k] = { item: it.n, from, cost_each: it.cost, copies_each: it.max, times: 0, badges: 0 };
          agg[k].times += 1;
          agg[k].badges += (it.cost || 0) * (it.max || 0);
        };
        ovSecs.forEach(x => x.items.forEach(it => push(it, '綜合交換所')));
        chSecs.slice(0, cc).forEach(x => x.items.forEach(it => push(it, '章節交換所')));
        const sinks = Object.keys(agg).map(k => agg[k]).sort((x, y) => y.badges - x.badges)
          .map(x => Object.assign({}, x, { pct_of_total: total ? +(x.badges / total * 100).toFixed(1) : 0 }));

        return {
          round: key,
          available_rounds: rounds,
          chapter_count: cc,
          chapter_count_label: (opts.find(o => o[0] === cc) || [0, cc + ' 章'])[1],
          chapter_count_is_standard: opts.some(o => o[0] === cc),
          chapter_count_options: opts.map(([v, n2]) => ({ chapters: v, label: n2 })),
          sections: show,
          totals: {
            overall_exchange_badges: ovB,
            per_chapter_badges: perCh,
            chapters_counted_badges: chB,
            total_badges: total,
            summary: '全部換滿需 ' + this.n(total) + ' 徽章（綜合 ' + this.n(ovB)
              + ' ＋ ' + cc + ' 章共 ' + this.n(chB) + '）',
          },
          allocation: {
            per_chapter_budget: perCh.filter(x => x.counted).map(x => ({ chapter: x.chapter, badges: x.badges })),
            biggest_sinks: sinks,
            note: '每章要換滿都是各自獨立的 ' + this.n(perCh.length ? perCh[0].badges : 0)
              + ' 章節徽章，章與章之間不能互相補；綜合交換所的 ' + this.n(ovB)
              + ' 綜合徽章要另外從章節徽章換過去。徽章不夠時只能在「同一章之內」取捨，'
              + 'biggest_sinks 是依耗量排序的事實，站上沒有品項價值的評分表，要不要換得看玩家自己的需求。',
          },
          source: D.source || null,
          data_built_at: D.builtAt ? new Date(D.builtAt).toISOString() : null,
          note: '單位都是徽章。小計＝單價×可換上限；總需求＝綜合交換所小計 ＋ 已計入章節的小計加總。'
            + '兩種徽章不通用：章節交換所只吃該章的章節徽章，綜合交換所只吃「由章節徽章兌換成的綜合徽章」，'
            + '所以 total_badges 是把兩者相加的概數，不是同一個池子。'
            + '章節交換所的品項名帶「(角色)」，實際是該章主角的專屬道具，'
            + '當期各章是誰用 get_wl_status 查（那支只認當期活動）。'
            + '這是該屆完整的交換所清單，不是取樣或前幾筆；chapter 只縮小回傳的區塊，totals 一律是整屆的。',
        };
      }

      case 'card_effective_skill': {
        /* 為什麼不是把 get_card_skills 加參數就好：那支回的是「這張卡自己能到多少」(base/max)，
           而團分技能的加成量取決於同隊有幾位同團、混團技能取決於隊上有幾種外團、花前吸技能
           取決於隊友的技能上限 —— 同一張卡換一隊就是不同的數字，非得有整隊 5 張才算得出來。
           算式一律走 core.js 的 SkillEngine（站上組隊最佳化、跑榜工作室用的同一支），
           不在這裡自己重寫一份，免得兩邊講出不同的數。 */
        const raw = Array.isArray(a.cards) ? a.cards : (a.cards != null ? [a.cards] : []);
        const ids = raw.map(x => Math.round(+x || 0)).filter(n => n > 0);
        if (!ids.length) return { error: '請給 cards：隊伍的 card_id 陣列（最多 5 張，第一張視為隊長）' };
        if (ids.length > 5) return { error: '一隊最多 5 張，收到 ' + ids.length + ' 張' };
        /* 重複 id 一定要擋：SkillEngine 判斷「這位是不是我自己」用的是物件 identity，
           同一個 id 拿到同一個物件 → 會被當成自己而漏算一位同團，靜靜地少算 10%。 */
        if (new Set(ids).size !== ids.length) return { error: 'cards 有重複的 card_id，一隊不能放兩張同一張卡' };

        let E;
        try { E = await this.ensureEngine(); } catch (e) { return { error: e.message || '計算引擎載入失敗' }; }
        const PE = E.PowerEngine, SK = E.SkillEngine, cidName = E.EC_cidName;
        if (!PE || !SK) return { error: '計算引擎載入了，但取不到 PowerEngine／SkillEngine' };
        // SkillEngine._units 要查 PowerEngine.charBands 才知道人類角色屬於哪個團，兩邊都得 ensure
        const [okP, okS] = await Promise.all([PE.ensure(), SK.ensure()]);
        if (!okP || !okS) return { error: '卡片／技能 master 資料載入失敗，請稍後再試' };

        const team = ids.map(id => PE.cardById[id]);
        const miss = ids.filter((id, i) => !team[i]);
        if (miss.length) return { error: '查不到 card_id：' + miss.join('、') + '（台服 master 沒有這幾張）' };

        // 參數展開：允許只給一個數字代表五張同值(常見情況)，缺的補預設
        const arr = (v, dflt, lo, hi) => ids.map((_, i) => {
          const x = Array.isArray(v) ? v[i] : v;
          const n = x == null || x === '' ? dflt : Math.round(+x || 0);
          return Math.max(lo, Math.min(hi, isNaN(n) ? dflt : n));
        });
        const sls = arr(a.skill_levels, 4, 1, 4);
        const crs = arr(a.char_ranks, 100, 1, 200);
        const trs = ids.map((_, i) => {
          const v = Array.isArray(a.trained) ? a.trained[i] : a.trained;
          return v == null ? true : !!v;
        });

        const unitsOf = team.map(c => PE.cardUnits(c) || []);
        // 全隊同團：五張的可用團體交集不為空(VS 卡的支援團算數)，與 PowerEngine.teamPower 判定一致
        const common = unitsOf.reduce((acc, u) => acc.filter(x => u.includes(x)), unitsOf[0] ? unitsOf[0].slice() : []);

        const rows = team.map((c, i) => {
          const sid = (trs[i] && c.specialTrainingSkillId) ? c.specialTrainingSkillId : c.skillId;
          const sk = SK.skills[sid] || {};
          const effs = sk.skillEffects || [];
          const has = t => effs.some(e => e.skillEffectType === t);
          const enh = effs.map(e => e.skillEnhance).find(Boolean);
          const condUnit = enh && (enh.skillEnhanceCondition || {}).unit || null;
          const kind = condUnit ? 'same_unit'
            : has('score_up_unit_count') ? 'unit_count'
            : has('score_up_character_rank') ? 'character_rank'
            : has('other_member_score_up_reference_rate') ? 'reference'
            : has('score_up_condition_life') ? 'condition_life'
            : has('score_up_keep') ? 'keep' : 'score_up';

          const at = (e, lv) => { const d = e.skillEffectDetails || [];
            const f = d.find(x => x.level === lv) || d[d.length - 1]; return f ? (f.activateEffectValue || 0) : 0; };

          const eff = SK.effSkillTeam(c, trs[i], sls[i], crs[i], team);
          const alone = SK.effSkillTeam(c, trs[i], sls[i], crs[i], [c]);   // 同一張卡「隊伍條件全不成立」的底值
          let cap = SK.effSkillMax(c, trs[i], sls[i], crs[i]);             // 卡面上限(＝get_card_skills 的 max)
          /* effSkillMax 是「不知道隊伍時」的同團上限估計，裡面沒有混團加成 —— 直接拿來當上限，
             混團卡會冒出 cap(90) < effective(150) 的怪數字，所以這裡把混團那一段補回去。 */
          if (kind === 'unit_count') cap += Math.max.apply(null,
            effs.filter(e => e.skillEffectType === 'score_up_unit_count').map(e => at(e, sls[i])));
          const row = {
            slot: i + 1, card_id: c.id, name: c.prefix || ('#' + c.id),
            chara: cidName ? cidName(c.characterId) : ('#' + c.characterId),
            unit: unitsOf[i].join('/'), skill_type: kind, skill_level: sls[i], char_rank: crs[i],
            trained: trs[i], effective_pct: Math.round(eff * 10) / 10,
            alone_pct: Math.round(alone * 10) / 10, card_cap_pct: Math.round(cap * 10) / 10,
            team_gain_pct: Math.round((eff - alone) * 10) / 10,
          };
          if (kind === 'same_unit') {
            const mates = team.filter((m, j) => j !== i && unitsOf[j].includes(condUnit)).length;
            row.same_unit = condUnit;
            row.same_unit_mates = mates;   // 除自己外的同團人數(0～4)
          }
          if (kind === 'unit_count') {
            const own = c.characterId <= 20 ? unitsOf[i][0] : 'piapro';
            row.other_units = new Set(unitsOf.flat().filter(u => u && u !== own)).size;
          }
          /* BloomFES／カラフェス 的 V 家卡花前花後是兩個不同技能(常見是「吸隊友」對「角色等級」)，
             玩家可以自己選要用哪一面 —— 這是實際會影響決策的事，順手把另一面在同一隊的值也算出來。 */
          if (c.specialTrainingSkillId && c.specialTrainingSkillId !== c.skillId) {
            row.other_side = { trained: !trs[i],
              effective_pct: Math.round(SK.effSkillTeam(c, !trs[i], sls[i], crs[i], team) * 10) / 10 };
          }
          /* 花前吸技能(BloomFES 未特訓面)：SkillEngine 一律給滿 activateEffectValue2，
             但實際是「隨機挑另 1 名成員，吸其技能上限的 v%」，隊友上限不夠高就吃不滿。
             主數值仍照引擎(＝站上其他頁面的數)，這裡另外附上這一隊的期望值。 */
          if (kind === 'reference') {
            const e = effs.find(x => x.skillEffectType === 'other_member_score_up_reference_rate');
            const d = (e.skillEffectDetails || []).find(x => x.level === sls[i]) || (e.skillEffectDetails || []).slice(-1)[0];
            const rate = d ? (d.activateEffectValue || 0) : 0, refCap = d ? (d.activateEffectValue2 || 0) : 0;
            const each = team.map((m, j) => j === i ? null
              : Math.min(refCap, rate / 100 * SK.effSkillMax(m, trs[j], sls[j], crs[j]))).filter(x => x != null);
            const avg = each.length ? each.reduce((s, x) => s + x, 0) / each.length : 0;
            row.reference = {
              rate_pct: rate, cap_pct: refCap,
              per_mate_pct: each.map(x => Math.round(x * 10) / 10),
              expected_pct: Math.round(avg * 10) / 10,
              effective_pct_expected: Math.round((eff - refCap + avg) * 10) / 10,
            };
          }
          return row;
        });

        // 平均技能倍率：與 calc_skill_multiplier／跑榜工作室同式(隊長全額、其餘四張總和÷5)
        const mult = idx => {
          const lead = rows[idx].effective_pct;
          const sum = rows.reduce((s, r, j) => s + (j === idx ? 0 : r.effective_pct), 0);
          return +((lead + 100 + sum / 5) / 100).toFixed(4);
        };
        const skillMult = mult(0);
        // 第一張不是技能最高的那張時，值得提醒 —— 第 6 窗(encore)吃的是隊長，換人站頭排就多一截
        const bestIdx = rows.reduce((b, r, j) => r.effective_pct > rows[b].effective_pct ? j : b, 0);

        const out = {
          team: rows,
          leader: { card_id: rows[0].card_id, name: rows[0].name, effective_pct: rows[0].effective_pct,
            coop_window_pct: Math.round(1.8 * rows[0].effective_pct * 10) / 10 },
          skill_multiplier: skillMult,
          for_calc_event_points: { skill: skillMult, s6: skillMult },
          team_units: common.length ? common.join('/') : '(混團)',
          all_same_unit: common.length > 0,
          assumptions: { skill_levels: sls, char_ranks: crs, trained: trs },
          note: '有效% ＝ 基礎% ＋ 角色等級加成(每 2 級 +1%，滿 100 級 +50%) ＋ 團分加成'
            + '(除自己外每 1 位同團 +e%，5 張全同團再 +e%) ＋ 混團加成(每多 1 種外團) ＋ 花前吸取值；'
            + '平均技能倍率 ＝ [隊長% ＋ 100 ＋ (其餘四張總和 ÷ 5)] ÷ 100，與 calc_skill_multiplier 同式，'
            + '可直接餵給 calc_event_points／song_efficiency 的 skill 與 s6（第 6 窗 encore 就是隊長再發動一次）。'
            + ' coop_window_pct ＝ 協力場一次隊長發動全員實得(1.8×隊長%，四位隊友假設與你同倍率)。'
            + ' 專精(MR)不影響技能%，只影響綜合力與活動加成，所以 master_ranks 只回聲不參與計算。',
        };
        if (a.master_ranks != null) out.master_ranks_echo = Array.isArray(a.master_ranks) ? a.master_ranks : [a.master_ranks];
        if (ids.length < 5) out.warning = '只給了 ' + ids.length + ' 張：團分技能的「全員一致」獎勵需要滿 5 張才算，'
          + '目前這幾張的有效% 是低估值。';
        if (bestIdx !== 0) out.leader_hint = { suggest_card_id: rows[bestIdx].card_id, name: rows[bestIdx].name,
          effective_pct: rows[bestIdx].effective_pct, skill_multiplier: mult(bestIdx),
          note: '這張比目前的隊長高 ' + Math.round((rows[bestIdx].effective_pct - rows[0].effective_pct) * 10) / 10
            + '%，換它當隊長(第 6 窗 encore 才吃得到)平均倍率由 ' + skillMult + ' 升到 ' + mult(bestIdx) + '。' };
        return out;
      }

      case 'estimate_border_prior': {
        /* 為什麼要獨立一支:bdbRef() 的同型態加權估計只吃「當期 id」,而且一定要
           在 BORDERS_DB.events 裡查得到那一期。使用者最常問的其實是還沒開跑的那一期
           ——「下一期 6.25 天箱活 T1000 大概多少」—— 那期沒有實測資料,連活動條目
           都可能還沒進資料庫,現行的 get_borders 完全接不到。這支把同一套算式
           (半衰期 6 期的對數加權平均)拆出來,改成吃「型態＋日數」這組屬性,
           所以任意一期(過去、當期、未開跑)都能算。演算法與站上「史」那一行逐字相同,
           不另立一套,免得同一個問題在兩個地方給出兩個數字。 */
        const DB0 = (typeof BORDERS_DB !== 'undefined') ? BORDERS_DB : null;
        if (!DB0) { await this.loadBorderDB().catch(() => {}); }
        const D = (typeof BORDERS_DB !== 'undefined') ? BORDERS_DB : null;
        if (!D) return { error: '榜線資料庫載入失敗，請稍後再試' };

        /* 使用者講的是圈內用語,資料庫存的是三種正式名稱。不做這層對應的話,
           「箱活」「嘉年華」「WL」會全部篩成空集合,而空集合看起來很像
           「歷史上沒發生過」,比報錯還誤導。 */
        const TYPE_ALIAS = {
          '箱活': '馬拉松', '馬拉松': '馬拉松', 'marathon': '馬拉松',
          '嘉年華': '歡樂嘉年華', '歡樂嘉年華': '歡樂嘉年華', '應援': '歡樂嘉年華',
          'cheerful': '歡樂嘉年華', 'cheerful_carnival': '歡樂嘉年華',
          'wl': 'World Link', 'world link': 'World Link', 'world_bloom': 'World Link', 'World Link': 'World Link',
        };
        const normType = s => { const k = String(s == null ? '' : s).trim(); return TYPE_ALIAS[k] || TYPE_ALIAS[k.toLowerCase()] || k; };

        const evs = D.events || [], bds = D.borders || [], TIERS = D.tiers || [];
        if (!bds.length || !TIERS.length) return { error: '榜線總表是空的' };
        const maxB = bds.reduce((m, b) => Math.max(m, +b.id || 0), 0);

        let type = null, days = null, srcEv = null, anchor = null;
        let unit = (a.unit == null || a.unit === '') ? null : String(a.unit).trim();
        if (a.event_id != null && a.event_id !== '') {
          anchor = Math.floor(+a.event_id);
          srcEv = evs.find(e => +e.id === anchor) || null;
          /* 活動一覽會比榜線總表多出幾期(已排程但還沒結算),所以「查得到活動、
             查不到榜線」是正常狀態,正是這支要服務的情境;真的整期都查不到才要求補參數。 */
          if (srcEv) { type = srcEv.type; days = srcEv.days; }
          else if (a.type == null || a.days == null) {
            return { error: '資料庫裡沒有第 ' + anchor + ' 期的活動資料，請改直接給 type 與 days' };
          }
        }
        if (a.type != null && a.type !== '') type = normType(a.type);
        if (a.days != null && a.days !== '') days = +a.days;
        /* 沒指定期數就當「下一期還沒結算的活動」。權重是相對值,分子分母同乘一個常數會約掉,
           所以 anchor 差一兩期完全不影響估計值,它唯一的作用是決定樣本的截止點。 */
        if (anchor == null) anchor = maxB + 1;
        if (!type || days == null || !isFinite(days)) {
          return { error: '請給 type 與 days（或給 event_id）',
            type_values: ['馬拉松（＝箱活）', '歡樂嘉年華（＝嘉年華）', 'World Link'],
            days_values: [...new Set(bds.map(b => b.days).filter(v => v != null))].sort((x, y) => x - y) };
        }

        // 只取「本期之前、同型態、同日數」——日數必須完全相同,6.25 天與 8.25 天的終線差一截
        const before = bds.filter(b => +b.id < anchor);
        const byTD = before.filter(b => b.type === type && b.days === days);
        if (byTD.length < 3) {
          const cmb = {};
          before.forEach(b => { const k = b.type + '|' + b.days; cmb[k] = (cmb[k] || 0) + 1; });
          return { error: '「' + type + '・' + days + ' 天」在第 ' + anchor + ' 期之前只有 ' + byTD.length + ' 期，樣本太少，不給估計',
            hint: '日數要完全相同，馬拉松／嘉年華是 6.25 / 7.25 / 8.25 / 9.25 / 10.25，給 6 或 8 會篩不到',
            available_combos: Object.keys(cmb).filter(k => cmb[k] >= 3)
              .map(k => ({ type: k.split('|')[0], days: +k.split('|')[1], n: cmb[k] }))
              .sort((x, y) => x.type.localeCompare(y.type) || x.days - y.days) };
        }

        /* 團體是額外收窄:原本的「史」不分團,加上團之後樣本常常只剩 3～6 期,
           少到權重會集中在一兩期上。不足 3 期就退回不分團,並且明講退回了,
           不要讓使用者以為他拿到的是分團結果。 */
        let same = byTD, unitApplied = false, unitNote = null;
        if (unit) {
          const u = byTD.filter(b => b.unit === unit);
          if (u.length >= 3) { same = u; unitApplied = true; }
          else unitNote = '團體「' + unit + '」在同型態同日數裡只有 ' + u.length + ' 期，樣本不足，已退回不分團體的樣本';
        }
        same = same.slice().sort((x, y) => y.id - x.id);   // 新到舊,後面取「最近 8 期」要靠這個順序

        /* 段位預設只回 5 條。全部 22 個段位乘上樣本明細會讓回傳膨脹到十幾 KB,
           而使用者問的通常就是自己卡的那一條線。 */
        let want = (Array.isArray(a.tiers) && a.tiers.length) ? a.tiers.map(Number)
          : (a.tier != null && a.tier !== '') ? [Math.floor(+a.tier)]
          : [100, 500, 1000, 2000, 5000];
        want = want.filter((t, i, arr) => TIERS.indexOf(t) >= 0 && arr.indexOf(t) === i).slice(0, 8);
        if (!want.length) return { error: '沒有可用的段位', available_tiers: TIERS };

        const rows = [];
        let primaryDen = 0;
        want.forEach(rk => {
          const i = TIERS.indexOf(rk);
          const v = same.map(b => ({ id: b.id, v: b.t[i] })).filter(x => x.v != null);
          // T1500/T2500 是後期才開始記錄的,樣本不足時寧可回 null 也不要拿兩期硬算
          if (v.length < 3) { rows.push({ tier: 'T' + rk, estimate: null, reason: '只有 ' + v.length + ' 期有這個段位的紀錄' }); return; }
          /* 半衰期 6 期的對數加權平均,與 bdbRef() 完全同式。取對數是因為榜線是乘性成長
             (通膨),算術平均會被舊期的低值往下拉;半衰期 6 期則讓權重自然衰減,
             不必再設期數上限。回測 #150～#176 逐期驗證過,偏誤在 2% 以內。 */
          let num = 0, den = 0;
          v.forEach(x => { const w = Math.pow(0.5, (anchor - x.id) / 6); num += w * Math.log(x.v); den += w; });
          const est = Math.exp(num / den);
          // 區間刻意用「最近 8 期的實際值域」而不是統計信賴區間 —— 給的是離散度,真的發生過的數字比較有意義
          const recent = v.slice(0, 8).map(x => x.v).sort((x, y) => x - y);
          const ws = v.map(x => Math.pow(0.5, (anchor - x.id) / 6)).sort((x, y) => y - x);
          if (!primaryDen) primaryDen = den;
          rows.push({
            tier: 'T' + rk,
            estimate: Math.round(est), estimate_short: this.short(est),
            range: [recent[0], recent[recent.length - 1]],
            range_short: this.short(recent[0]) + ' ～ ' + this.short(recent[recent.length - 1]),
            sample_n: v.length, range_n: Math.min(8, v.length),
            top4_weight_pct: +(ws.slice(0, 4).reduce((s, w) => s + w, 0) / den * 100).toFixed(1),
          });
        });

        /* 樣本一定要列出來,否則使用者沒辦法判斷這個估計可不可信 ——
           權重集中在一期爆線的活動上時,數字看起來一樣漂亮,但完全不能用。
           只列權重最高的前幾期,再往後權重已經衰減到看了也沒意義。 */
        const lim = Math.min(20, Math.max(3, Math.floor(+a.samples_limit || 8)));
        const samples = same.slice(0, lim).map(b => {
          const w = Math.pow(0.5, (anchor - b.id) / 6);
          const sc = {};
          want.forEach(rk => { const x = b.t[TIERS.indexOf(rk)]; if (x != null) sc['T' + rk] = x; });
          return { id: b.id, name: b.name, unit: b.unit, days: b.days,
            weight_pct: primaryDen ? +(w / primaryDen * 100).toFixed(1) : null, scores: sc };
        });

        return {
          basis: {
            event_id: anchor, event_name: srcEv ? srcEv.name : null,
            type, days, unit: unitApplied ? unit : null, unit_note: unitNote,
            has_own_border_record: anchor <= maxB,
          },
          method: '半衰期 6 期的對數加權平均（＝榜線分析頁「史」那一行的同一套算式）',
          sample_count: same.length,
          tiers: rows,
          samples_shown: samples.length, samples,
          note: '估計值 ＝ exp( Σ w·ln(該期該段位終線) ÷ Σ w )，其中 w = 0.5^((' + anchor + ' − 期數) ÷ 6)，'
            + '也就是每往前 6 期權重減半。權重是相對值（分子分母同乘常數會約掉），所以 anchor 只決定樣本截止到第幾期，不影響估計值本身。'
            + '樣本條件：期數 < ' + anchor + '、型態 ＝「' + type + '」、日數 ＝ ' + days + ' 天（日數必須完全相同）'
            + (unitApplied ? '、團體 ＝「' + unit + '」' : '、不分團體') + '。'
            + 'range 是最近 ' + Math.min(8, same.length) + ' 期同型態的「實際值域」，不是信賴區間 —— 它只表示離散度，估計值不保證落在中間，'
            + '同型態之間差 2～3 倍是常有的事。分數單位是活動分數（PT），1W ＝ 10,000。'
            + '這是先驗估計，不含任何當期實測資料；活動開跑後請改用 get_borders 的實測時速外推，那支準得多。'
            + '（回測 #150～#176：單用歷史估計當預測，T100 誤差約 −42%、T1000 −22%、T5000 −13%。）',
        };
      }

      case 'get_calendar': {
        /* 模型很愛把日期寫成 2026-10-15、2026年10月15日,或省略年份只給 10/15。
           分隔符不同就查錯月份太蠢,這裡一律正規化再切。 */
        const parseYmd = raw => {
          const p = String(raw || '').trim().replace(/[.\-年月]/g, '/').replace(/日/g, '')
            .split('/').filter(x => x !== '');
          if (!p.length) return null;
          const n = p.map(Number);
          if (n.some(x => !isFinite(x))) return null;
          if (p.length >= 3) return { kind: 'date', y: n[0], m: n[1] - 1, d: n[2] };
          // 四位數開頭才當年月;否則是「10/15」這種省略年份的寫法 → 補今年
          if (p[0].length === 4) return { kind: 'month', y: n[0], m: n[1] - 1 };
          const t = new Date();
          return { kind: 'date', y: t.getFullYear(), m: n[0] - 1, d: n[1] };
        };

        const raw = a.date || a.month || '';
        const q = raw ? parseYmd(raw) : null;
        if (raw && !q) return { error: '日期看不懂，請用 YYYY/MM/DD（單日）或 YYYY/MM（整月）' };
        const now = new Date(), nowMs = now.getTime();
        // 參數省略 → 本月;把 month 誤填成完整日期(或反之)也照解析結果走,不用怪使用者填錯欄位
        const view = q || { kind: 'month', y: now.getFullYear(), m: now.getMonth() };
        const isDay = view.kind === 'date';
        const lo = isDay ? new Date(view.y, view.m, view.d).getTime() : new Date(view.y, view.m, 1).getTime();
        const hi = isDay ? lo + 86399999 : new Date(view.y, view.m + 1, 1).getTime() - 1;

        /* 卡池表在 sekai-data.js,是 componentDidMount 非同步 import 的:使用者一進站就問、
           或那次 import 失敗時 state.gachas 還是空的 → 比照 get_dolls 自己補載一次。
           版本號要跟 componentDidMount 那行一致,才會命中同一份模組快取而不是重抓。 */
        let src = this.state.gachas || [];
        if (!src.length) {
          try {
            const m = await import('./data/sekai-data.js?v=8d2812dda5');
            src = m.GACHAS || [];
            if (src.length) this.setState({ gachas: src, dolls: (this.state.dolls || []).length ? this.state.dolls : (m.DOLLS || []) });
          } catch (e) { return { error: '卡池排程資料載入失敗' }; }
        }
        if (!src.length) return { error: '卡池排程資料尚未載入，請稍後再試' };

        const f2 = v => String(v).padStart(2, '0');
        const ymd = ms => { const d = new Date(ms); return d.getFullYear() + '/' + f2(d.getMonth() + 1) + '/' + f2(d.getDate()); };
        const fmt = ms => { const d = new Date(ms); return ymd(ms) + ' ' + f2(d.getHours()) + ':' + f2(d.getMinutes()); };

        // 狀態是「相對於查詢區間」的,不是相對於今天 —— 問 2026/02 就該回「本月開始/本月結束」,
        // 問某一天就該回「當日開始/當日結束」;跨越整段的才是進行中
        const statOf = (s, e) => {
          const inS = s >= lo && s <= hi, inE = e >= lo && e <= hi;
          if (inS && inE) return isDay ? '當日開始並結束' : '本月開始並結束';
          if (inS) return isDay ? '當日開始' : '本月開始';
          if (inE) return isDay ? '當日結束' : '本月結束';
          return isDay ? '進行中' : '整月進行中';
        };
        // 查的區間含今天才附 open_now/running_now;查未來月份時這欄永遠 false,只是浪費 token
        const cur = nowMs >= lo && nowMs <= hi;
        // 卡池表的 e 欄是「最後一天」而不是關閉時刻,結束日整天都還抽得到 —— 站上日曆
        // (eventsOn/filteredGachas)也是這樣算的,這裡沿用同一條規則,免得日曆與助手講不同話
        const gEnd = d => d.getTime() + 86399999;

        const type = a.type ? String(a.type) : '';
        const lim = Math.max(1, Math.min(60, +a.limit || 24));
        const off = Math.max(0, +a.offset || 0);

        // 活動清單走 API,離線/失敗時只回卡池而不整個報錯 —— 卡池是本機資料,一定拿得到
        const evl = await this.loadEvList().catch(() => []);
        const evEnd = e => new Date(e.aggregate_at || e.closed_at || e.start_at).getTime();
        const events = (evl || []).map(e => ({ e, s: new Date(e.start_at).getTime(), t: evEnd(e) }))
          .filter(x => x.s && x.t && x.s <= hi && x.t >= lo)
          .sort((x, y) => x.s - y.s)
          .map(x => {
            // /event/list 只給名稱與時間,主推角色與加成型態要靠卡池表的伴生欄補(gacha.eid → ech/et)
            const gk = src.find(g => String(g.eid) === String(x.e.id) && (g.ech || g.et));
            const o = { id: +x.e.id, name: x.e.name, start: fmt(x.s), end: fmt(x.t), status: statOf(x.s, x.t) };
            if (gk && gk.ech) o.lead_chara = gk.ech;
            if (gk && gk.et) o.event_type = gk.et;
            if (cur) o.running_now = nowMs >= x.s && nowMs <= x.t;
            return o;
          });

        const rows = src.map(g => ({ g, s: this.pd(g.s), e: this.pd(g.e) }))
          .filter(x => x.s && x.e && (!type || x.g.t === type) && x.s.getTime() <= hi && gEnd(x.e) >= lo)
          .sort((x, y) => x.s - y.s || x.e - y.e);
        const gachas = rows.slice(off, off + lim).map(x => {
          const s = x.s.getTime(), e = gEnd(x.e);
          const o = { name: x.g.n, type: x.g.t, start: x.g.s, end: x.g.e, status: statOf(s, e) };
          if (x.g.ch) o.pickup = x.g.ch;
          if (x.g.eid) {
            o.event_id = +x.g.eid;
            if (x.g.et) o.event_type = x.g.et;
            if (x.g.ech) o.event_lead = x.g.ech;
          }
          // note 偶有很長的說明(井數、限購規則),日曆視角只需要一眼認出是什麼池 → 截短
          if (x.g.note) o.note = x.g.note.length > 60 ? x.g.note.slice(0, 58) + '…' : x.g.note;
          if (cur) o.open_now = nowMs >= s && nowMs <= e;
          return o;
        });

        const out = {
          view: isDay ? 'day' : 'month',
          range: isDay ? ymd(lo) : ymd(lo) + ' – ' + ymd(hi),
          today: ymd(nowMs),
          events, gachas, gacha_total: rows.length,
        };
        if (off + gachas.length < rows.length) out.next_offset = off + gachas.length;
        if (!(evl || []).length) out.events_note = '活動清單（/event/list）暫時取不到，本次只有卡池';
        out.note = 'status 相對於' + (isDay ? '查詢當日' : '查詢當月') + '（開始／結束／進行中）。'
          + '卡池 end 是最後一天，當天整日仍可抽（判定用 end + 23:59:59）；'
          + '活動 end 取 aggregate_at，沒有才用 closed_at。時間為使用者本地時區，卡池日期為台服預測排程。';
        return out;
      }

      case 'get_collection_stats': {
        /* 兩件事共用一支：收集室（貼圖／稱號）的分佈統計，以及收集率備份碼的產生與解讀。
           備份碼一律只讀不寫 —— 覆蓋持卡勾選是破壞性動作，必須由使用者自己在收集率頁按下還原。 */
        const PMAP = { all: 'all', '全部': 'all', stamp: 'stamps', stamps: 'stamps', '貼圖': 'stamps',
                       honor: 'honors', honors: 'honors', '稱號': 'honors', code: 'code', '備份碼': 'code' };
        const part = PMAP[String(a.part == null ? 'all' : a.part).trim().toLowerCase()] || 'all';
        const lim = Math.max(1, Math.min(50, a.limit != null ? (Math.round(+a.limit) || 10) : 10));
        const off = Math.max(0, Math.round(+a.offset) || 0);
        const raw = a.decode == null ? '' : String(a.decode).trim();
        // 明確給了 decode 就是要解讀，別因為 part 沒寫對而默默不做
        const wantCol = part === 'all' || part === 'stamps' || part === 'honors';
        const wantCode = part === 'all' || part === 'code' || !!raw;
        const out = {};

        /* 角色名／團體對照要靠 cards-index 的 CHARAS，備份碼解讀也要 CARDS，一次載齊 */
        await this.loadCards();
        const CARDS = this.state.rateCards || [], CHARAS = this.state.rateChars || [];
        const nameOf = {}, unitOf = {};
        CHARAS.forEach(c => { nameOf[c[0]] = c[1]; unitOf[c[0]] = this.UNIT_OF[c[2]] || 'vs'; });
        const uName = u => (this.UNITS[u] || {}).n || u;

        /* ---------- 收集室分佈（全站共通圖鑑，不是使用者的持有狀況） ---------- */
        if (wantCol) {
          await this.loadCollect();
          // loadCollect 碰到「別處正在載入中」會直接 return，此時 state 還是空的；不等一下會誤報失敗
          for (let i = 0; i < 25 && !(this.state.stamps || []).length && !(this.state.honors || []).length; i++)
            await new Promise(r => setTimeout(r, 100));
          const stamps = this.state.stamps || [], honors = this.state.honors || [];
          if (!stamps.length && !honors.length) return { error: '收集室資料尚未載入（' + (this.state.colErr || '請稍後再試') + '）' };

          if (part !== 'honors') {
            const byC = {}, byU = {};
            stamps.forEach(s => {
              byC[s.cid] = (byC[s.cid] || 0) + 1;
              const u = s.cid ? unitOf[s.cid] : null;
              if (u) byU[u] = (byU[u] || 0) + 1;
            });
            out.stamps = { total: stamps.length, no_character: byC[0] || 0,
              by_unit: Object.keys(this.UNITS).filter(u => byU[u])
                .map(u => ({ unit: u, name: uName(u), count: byU[u] })).sort((x, y) => y.count - x.count) };
            // 26 個角色一次全列約佔 2KB，只有指名要貼圖時才展開，避免 part=all 回一大包
            if (part === 'stamps') out.stamps.by_character = Object.keys(byC).map(k => +k).filter(id => id > 0)
              .map(id => ({ character_id: id, character: nameOf[id] || ('#' + id), unit: unitOf[id] || null, count: byC[id] }))
              .sort((x, y) => y.count - x.count || x.character_id - y.character_id);
            else out.stamps.hint = '要依角色逐一列出請用 part="stamps"';
          }

          if (part !== 'stamps') {
            const RL = { low: '普通', middle: '罕見', high: '稀有', highest: '最高' };
            const byR = {}, byG = {};
            let multi = 0;
            honors.forEach(h => {
              byR[h.rarity || '（未標）'] = (byR[h.rarity || '（未標）'] || 0) + 1;
              byG[h.group || '（無群組）'] = (byG[h.group || '（無群組）'] || 0) + 1;
              if (h.lvCount > 1) multi++;
            });
            const groups = Object.keys(byG).map(g => ({ group: g, count: byG[g] }))
              .sort((x, y) => y.count - x.count || (x.group < y.group ? -1 : 1));
            out.honors = {
              total: honors.length,
              multi_level: multi,
              groups_total: groups.length,
              by_rarity: Object.keys(byR).sort((x, y) => ['low', 'middle', 'high', 'highest'].indexOf(x) - ['low', 'middle', 'high', 'highest'].indexOf(y))
                .map(r => ({ rarity: r, label: RL[r] || r, count: byR[r] })),
              top_groups: groups.slice(off, off + lim),
              groups_shown: Math.max(0, Math.min(lim, groups.length - off)),
              groups_offset: off,
            };
          }
        }

        /* ---------- 備份碼 ---------- */
        if (wantCode) {
          if (!CARDS.length) return { error: '卡片索引尚未載入（' + (this.state.rateErr || '請先開啟「收集率」頁') + '）' };
          // loadCards() 只有真的去載那次才會順便 ownLoad()；卡片已在記憶體時要自己補讀，
          // 否則 ownSet() 會憑空給一個空 Set，把「還沒讀持有清單」誤判成「一張都沒勾」
          if (!this._own) this.ownLoad();
          const mine = this.ownSet();

          const metaOf = {}; CARDS.forEach(c => { metaOf[c[0]] = c; });
          const rarLabel = {}, rarRank = {};
          this.RARITY.forEach((r, i) => { rarLabel[r[0]] = r[1]; rarRank[r[0]] = i; });
          const cardUnit = c => (c[5] >= 0 ? this.UNIT_OF[c[5]] : unitOf[c[1]]) || 'vs';
          const tally = ids => {
            const byU = {}, byR = {};
            ids.forEach(id => {
              const c = metaOf[id]; if (!c) return;
              const u = cardUnit(c); byU[u] = (byU[u] || 0) + 1; byR[c[2]] = (byR[c[2]] || 0) + 1;
            });
            return {
              by_unit: Object.keys(this.UNITS).filter(u => byU[u]).map(u => ({ unit: u, name: uName(u), count: byU[u] })),
              by_rarity: this.RARITY.filter(r => byR[r[0]]).map(r => ({ rarity: r[1], count: byR[r[0]] })),
            };
          };

          if (raw) {
            /* 解讀：整段自己解 bitmap，絕不呼叫 ownFromCode() —— 那會把 this._own 換掉，等於覆蓋使用者的紀錄 */
            if (raw.length > 4000) return { error: '這串太長了（' + raw.length + ' 字元），不像本站的備份碼；全 ' + CARDS.length + ' 張也只要約 212 字元' };
            if (!/^[A-Za-z0-9+/=]+$/.test(raw)) return { error: '備份碼含有非 base64 的字元，可能是複製時被截斷或混到別的文字' };
            let bin = '';
            try { bin = atob(raw); } catch (e) { return { error: '備份碼無法解碼（不是合法的 base64），請確認整串都複製到了' }; }
            const ids = [];
            for (let i = 0; i < bin.length; i++) {
              const v = bin.charCodeAt(i);
              for (let k = 0; k < 8; k++) if (v & (1 << k)) ids.push((i << 3) + k);
            }
            if (!ids.length) return { error: '這串備份碼解出來一張卡都沒有（可能是還沒勾選任何卡時複製到的空碼）' };
            const inCode = new Set(ids);
            const unknown = ids.filter(id => !metaOf[id]);
            let both = 0; mine.forEach(id => { if (inCode.has(id)) both++; });
            const sorted = ids.slice().sort((x, y) => {
              const cx = metaOf[x], cy = metaOf[y];
              const rx = cx && rarRank[cx[2]] != null ? rarRank[cx[2]] : 99;
              const ry = cy && rarRank[cy[2]] != null ? rarRank[cy[2]] : 99;
              return rx - ry || x - y;
            });
            out.decoded = Object.assign({
              input_length_chars: raw.length,
              cards_in_code: ids.length,
              known_cards: ids.length - unknown.length,
              unknown_count: unknown.length,
              unknown_ids: unknown.slice(0, 20),
            }, tally(ids), {
              compare_with_my_record: {
                my_cards: mine.size, in_both: both,
                only_in_code: ids.length - both, only_in_my_record: mine.size - both,
                identical: mine.size === both && ids.length === both,
              },
              cards: sorted.slice(off, off + lim).map(id => {
                const c = metaOf[id];
                return c ? { id, name: c[7] || '', character: nameOf[c[1]] || ('#' + c[1]),
                             unit: cardUnit(c), rarity: rarLabel[c[2]] || String(c[2]), in_my_record: mine.has(id) }
                         : { id, name: '（不在目前的卡片索引裡，可能是更新後的新卡）', in_my_record: mine.has(id) };
              }),
              cards_shown: Math.max(0, Math.min(lim, sorted.length - off)),
              cards_offset: off,
              note: '只做解讀，沒有動到使用者的持卡紀錄。cards 依稀有度（★4→生日→★3→★2→★1）再依卡片 id 排序後由第 ' + off +
                ' 張起取 ' + lim + ' 張，要更多用 limit／offset。注意：only_in_my_record 是「你有、這串沒有」的卡：' +
                '在收集率頁貼上這串還原會整份蓋掉（不是合併），所以要先提醒使用者把自己現在的碼備份下來。',
            });
          } else {
            /* 產生：ownCode() 是純讀取（bitmap→base64），不寫 localStorage、不改畫面 */
            const code = this.ownCode();
            const ids = []; mine.forEach(id => ids.push(id));
            out.backup_code = Object.assign({
              code: code || null,
              length_chars: code.length,
              owned_cards: mine.size,
              total_cards: CARDS.length,
              pct: CARDS.length ? +(mine.size / CARDS.length * 100).toFixed(1) : 0,
            }, tally(ids), {
              note: code
                ? '這是使用者目前的備份碼，整串複製到另一台裝置，在「收集率」頁的「貼上備份碼還原…」欄位貼上即可。'
                  + '編碼方式＝持有的卡片 id 當 bitmap（第 id 個 bit，每位元組低位在前），再 base64；'
                  + '所以長度只跟最大的卡片 id 有關，跟勾了幾張無關。'
                : '目前一張都沒勾選，所以沒有備份碼。收集率是在站上「收集率」頁手動勾選的（存這台瀏覽器的 localStorage，鍵名 ' + this.CARD_KEY + '）。',
            });
          }
        }

        out.note = (wantCol ? '貼圖／稱號是官方素材圖鑑（全站共通的總數），不是使用者的持有狀況 —— 遊戲沒有公開這兩項的持有清單。' : '')
          + (wantCode ? (wantCol ? ' ' : '') + '備份碼這段對應的收集率，才是使用者自己在「收集率」頁勾選的紀錄。'
              + '本工具只產生與解讀備份碼，不會寫入或覆蓋任何勾選；真的要還原請引導使用者自己到「收集率」頁貼上。' : '');
        return out;
      }

      case 'get_misc_calc': {
        const kind = String(a.kind || '');

        if (kind === 'challenge_live') {
          const pd = this.state.pdata || {};
          // 分數省略時退回 profile 的挑戰 Live 最高分（loadPlayer 已存進 pdata.chHigh）——
          // 使用者問「我打挑戰 Live 有多少活動P」時，預設要算的就是他自己那一場。
          const score = a.score != null ? Math.max(0, Math.round(+a.score || 0))
            : (pd.chHigh != null ? +pd.chHigh : null);
          if (score == null) return { error: '要給 score（挑戰 Live 的歌曲分數）；或先用 set_my_uid 綁 uid，就會拿你 profile 上的挑戰 Live 最高分來算' };
          const base = 100 + Math.floor(score / 20000);
          const ep = base * 120;
          const cp = 200 + Math.floor(score / 8000);
          // 同一個分數改打單人場的對照（沿用計算中心的加成與火）：
          // 挑戰場不吃加成也不吃火，值不值得只有跟一般場並排才看得出來。
          const s = this.state, F = this.EM[s.energy] || 1;
          const soloEp = this.calcEPValue('solo', score, 100, +s.bonus || 0, F, +s.power || 0, 0);
          // 整期概算只在 live 已經在手上時附送——這支是純算式工具，不該為了它去打網路。
          const ck = this.state.live ? this.eventClock() : null;
          const daysLeft = ck ? Math.max(0, Math.ceil(ck.leftH / 24)) : null;
          return {
            kind, score,
            score_from: a.score != null ? '呼叫時指定' : '你 profile 上的挑戰 Live 最高分',
            base, event_points: ep,
            compare_solo_same_score: { event_points: soloEp, bonus_pct: +s.bonus || 0, energy: s.energy, boost_multiplier: F },
            challenge_points: cp, challenge_points_with_colorful_pass: cp * 2,
            days_left_est: daysLeft,
            event_points_if_played_daily: daysLeft != null ? ep * daysLeft : null,
            note: '挑戰 Live 單場活動P ＝ (100 ＋ ⌊分數/20000⌋) × 120 ＝ (100＋⌊' + score + '/20000⌋) × 120 ＝ ' + ep + ' P。'
              + '這條式子不吃歌曲倍率、不吃活動加成、也不吃火（站上活動P計算器切到挑戰模式時，倍率與火兩欄會變灰）。'
              + '挑戰 Live 每天只能打 1 場、凌晨 4:00 重置，所以 event_points_if_played_daily 只是「剩餘天數每天都打」的概算，'
              + '沒有精算 4:00 這條界線。challenge_points（＝200＋⌊分數/8000⌋，七彩通行證雙倍）是升 STAGE 用的挑戰點數，'
              + '跟活動P 是兩種東西，別混著講。',
          };
        }

        if (kind === 'presets') {
          /* 曲庫是進「計算中心」才載的模組，使用者可能沒去過那頁 → 自己補載。
             loadEpSongs 不是 async（內部走 import().then），沒有 promise 可 await，只能輪詢它寫回 state。 */
          if (!(this.state.epSongs || []).length) {
            this.loadEpSongs();
            for (let i = 0; i < 40 && !(this.state.epSongs || []).length; i++) await new Promise(r => setTimeout(r, 100));
          }
          const s = this.state;   // setState 會換掉整個 state 物件，一定要等載完才取
          const dFull = k => { const d = (this.DIFFS || []).find(x => x[0] === k); return d ? d[1] : k; };
          const pack = (key, p) => {
            const song = this.songById(p.song), F = this.EM[p.energy] || 1;
            // 與 scoreNow() 同一套後備順序：指定難度沒係數就往下找有的
            const k = (song && song.d) ? [p.diff, 'M', 'X', 'H', 'N', 'E', 'A'].find(x => song.d[x]) : null;
            const score = k ? this.calcSongScore(song.d[k], p.mode, p.power, p.skill, p.s6) : null;
            const ep = score != null ? this.calcEPValue(p.mode, score, song.rate, p.bonus, F, p.power, 0) : null;
            const cycle = song ? song.time + this.ohOf(p.mode) : null;
            return {
              key, name: p.n, mode: p.mode,
              power: p.power, bonus_pct: p.bonus,
              energy: p.energy, boost_multiplier: F,
              skill: p.skill, s6: p.s6,
              difficulty: p.diff, difficulty_full: dFull(p.diff),
              song: song ? { id: song.id, title: song.t, event_rate_pct: song.rate, length_s: song.time } : { id: p.song, title: null },
              score_mode: p.scoreMode, goal_event_points: p.goal,
              estimate: ep == null ? null : {
                difficulty_used: k, song_score: Math.round(score), event_points: ep,
                ep_per_hour: cycle ? Math.round(ep * 3600 / cycle) : null, cycle_s: cycle,
              },
            };
          };
          return {
            kind,
            presets: Object.keys(this.PRESETS).map(k => pack(k, this.PRESETS[k])),
            current: {
              mode: s.mode, power: +s.power || 0, bonus_pct: +s.bonus || 0,
              energy: s.energy, boost_multiplier: this.EM[s.energy] || 1,
              skill: s.skill, s6: s.s6, life: s.life,
              difficulty: s.diff, song_id: s.songKey, score_mode: s.scoreMode,
              goal_event_points: s.goal, preset_applied: s.preset || null,
            },
            note: 'presets 是站上寫死的兩組情境（計算中心與指令面板的「套用情境」按的就是這些值），可以直接當基準值報給使用者。'
              + '本工具只讀不套用，不會動到畫面上的設定——要真的套用請使用者自己按，或改用 calc_event_points 帶參數試算。'
              + 'power＝綜合力、bonus_pct＝活動加成%、energy＝吃幾火（火倍率 boost_multiplier 由 0→1、1→5、2→10、3→15、4→20、5→25、6→27、7→29、8→31、9→33、10→35）、'
              + 'skill／s6＝平均技能倍率與第 6 技能欄、goal_event_points＝該情境預設的活動P 目標。'
              + 'estimate 是現算的：單局活動P ＝ ⌊base × 歌曲倍率 × (1＋加成/100)⌋ × 火倍率，'
              + '協力/應援 base ＝ ⌊(分數＋0.075×綜合力×5)/17000⌋＋123，單人/自動 base ＝ 100＋⌊分數/20000⌋；'
              + 'ep_per_hour 已含場間 overhead（單人 15 秒、協力/應援 45 秒）。current 是使用者當下的共用設定，用來跟預設對照。',
          };
        }

        if (kind === 'my_extra') {
          const uid = String(a.uid || this.state.pid || '').replace(/\D/g, '');
          if (!uid) return { error: '還沒設定 uid，請先用 set_my_uid' };
          if (!this.state.live) { try { await this.loadLive(); } catch (e) {} }
          const me = this.ranksOf(this.state.live).find(x => this.sameUid(x.uid, uid));
          const st = (me && me.stats) || {};
          const cnt = k => (st[k] && st[k].count != null) ? st[k].count : null;   // 周回數（近 1／3／24 小時）
          const pd = this.state.pdata || {};
          const own = this.sameUid(uid, this.state.pid);
          let power = own ? pd.power : null, basePower = own ? pd.basePower : null,
              crBonus = own ? pd.charRankBonus : null, pRank = own ? pd.rank : null;
          /* 綜合力不在排名回應裡、只有 profile 有。使用者若還沒開過首頁小卡就是空的，
             這裡自己補打一次公開 profile —— 但刻意不寫回 state，工具不該順手改到畫面。 */
          if (power == null) {
            try {
              const d = await this.apiFetch('/user/' + encodeURIComponent(uid) + '/profile');
              const tp = (d && d.totalPower) || {}, gd = (d && (d.userGamedata || d.user_gamedata)) || {};
              if (tp.totalPower != null) power = tp.totalPower;
              if (tp.basicCardTotalPower != null) basePower = tp.basicCardTotalPower;
              if (tp.characterRankBonus != null) crBonus = tp.characterRankBonus;
              if (gd.rank != null) pRank = gd.rank;
            } catch (e) {}
          }
          return {
            kind, uid, in_top100: !!me, is_my_own_uid: own,
            rounds_1h: cnt('h1'), rounds_3h: cnt('h3'), rounds_24h: cnt('h24'),
            avg_per_round_1h: (st.h1 && st.h1.average != null) ? Math.round(st.h1.average) : null,
            speed_1h: (me && me.speed1h != null) ? Math.round(me.speed1h) : null,
            last_round_gain: (me && me.lastScore != null) ? me.lastScore : null,
            last_played: (me && me.lastPlayed) || null,
            total_power: power, base_card_power: basePower, character_rank_bonus: crBonus,
            player_rank: pRank,
            note: 'rounds_*＝該時段的周回數（局）、avg_per_round_1h＝近 1 小時場均（活動P/局）、speed_1h＝近 1 小時時速（活動P/小時）、'
              + 'last_round_gain＝上一局實得活動P（不是累計）。這些統計來自 HiSekai 的前百名單，'
              + '沒進前 100 名就全部是 null（in_top100=false），公開 API 對第 101 名之後不給本期分數，查不到就是查不到、不要猜。'
              + 'total_power 是遊戲讀取的編組總綜合力（點），＝base_card_power ＋ character_rank_bonus ＋ 區域道具等加成，是實際值不是理論值。'
              + '要動能／休息時數／預測終分那類完整節奏剖析用 analyze_player；要與各段榜線的差距用 get_my_status。',
          };
        }

        return { error: 'kind 必須是 challenge_live、presets 或 my_extra 三者之一' };
      }

      case 'get_page_tutorials': {
        /* 頁面底部那條教學提示只有「人」看得到（pageTutorials 讀 state.tutQA 現算），
           助手拿不到 —— 於是使用者在某頁問「這頁怎麼用」時，助手只能關鍵字亂猜。
           這支把同一張 PAGE_TUT 對照表開放給助手，讓它按「使用者正在用哪個功能」推薦。 */
        let src = this.state.tutQA || [], cats0 = this.state.tutCats || [];
        /* 教學資料是動態 import 的，沒進過教學頁時 state 是空的。這裡刻意「只載不寫回 state」：
           search_tutorial 會 setState 回去，但那會讓當前頁面底部憑空多出一條教學提示條
           （tutHintOn 由 pageTutorials 的結果決定）—— 工具不該改動使用者的畫面。
           dynamic import 有模組快取，重複呼叫不會重新下載。 */
        if (!src.length) {
          try {
            const m = await import('./data/tutorial-data.js?v=4befc9b27b');
            src = m.TUT_QA || []; cats0 = m.TUT_CATS || [];
          } catch (e) { return { error: '教學資料載入失敗' }; }
        }
        const cats = {}; cats0.forEach(c => { cats[c.id] = c.name; });
        const page = String(a.page || '').trim();
        const topic = String(a.topic || '').trim();
        const allPages = Object.keys(this.PAGE_TUT);
        const title = p => (this.PAGES[p] || [])[0] || p;
        if (!page && !topic) {
          return { error: '要給 page 或 topic',
            pages: allPages.map(p => ({ page: p, title: title(p), keywords: this.PAGE_TUT[p] })) };
        }
        let kws = [], related = [], min = 3;
        if (page) {
          kws = (this.PAGE_TUT[page] || []).slice();
          if (!kws.length) return { error: '這個頁面沒有對照的教學關鍵字（不是每頁都有）',
            page, pages_with_tutorials: allPages };
        }
        if (topic) {
          /* topic 走「雙向包含」比對：使用者講「我想衝榜線」也要能對到 rank／borderdb 的『榜線』。
             命中的頁面關鍵字併進評分詞，讓 topic 借到那頁同義詞組的召回率。 */
          const t = topic.toLowerCase();
          allPages.forEach(p => {
            const hit = this.PAGE_TUT[p].filter(w => t.includes(w.toLowerCase()) || w.toLowerCase().includes(t));
            if (hit.length) {
              related.push({ page: p, title: title(p), matched: hit });
              hit.forEach(w => { if (kws.indexOf(w) < 0) kws.push(w); });
            }
          });
          if (kws.indexOf(topic) < 0) kws.push(topic);
          /* 單一 topic 只有一個詞，套 page 模式的 3 分門檻會把「只在關鍵字欄命中（2 分）」的條目全砍光 */
          if (!page) min = 2;
        }
        const cut = Math.min(800, Math.max(80, +a.answer_chars || 240));
        const lim = Math.min(12, Math.max(1, +a.limit || 5));
        /* 評分刻意照抄 pageTutorials，助手講的順序才會跟使用者眼前那條提示條一致 */
        const scored = src.map(x => {
          const q = String(x.q || ''), ans = String(x.a || ''), k = String(x.kw || '');
          let sc = 0;
          kws.forEach(w => { if (q.includes(w)) sc += 3; if (k.includes(w)) sc += 2; if (ans.includes(w)) sc += 1; });
          return { x, sc };
        }).filter(r => r.sc >= min).sort((m, n) => n.sc - m.sc);
        const out = {
          page: page || undefined, page_title: page ? title(page) : undefined,
          topic: topic || undefined, keywords: kws,
          related_pages: topic ? related.slice(0, 6) : undefined,
          hits: scored.length, shown: Math.min(lim, scored.length), total_qa: src.length,
          items: scored.slice(0, lim).map(r => ({
            category: cats[r.x.cat] || r.x.cat, question: r.x.q,
            answer: String(r.x.a || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, cut),
            relevance: r.sc,
          })),
          note: '相關度分 = 關鍵字命中加總（標題 +3 分、關鍵字欄 +2 分、內文 +1 分），門檻 ' + min +
            ' 分；page 模式的排序與該頁底部顯示的教學完全一致。答案已去 HTML 並截到 ' + cut + ' 字。',
        };
        if (!scored.length) out.hint = '這組關鍵字沒有對到教學條目，改用 search_tutorial 直接搜使用者的原話。';
        return out;
      }

      case 'get_site_meta': {
        /* 這三份東西全是寫死在 class 上的常數,沒有載入器、也不會跟著遊戲資料變 ——
           所以整支不 await 任何東西,也不動畫面。
           分 kind 回是因為三份加起來太長:問「這站誰做的」的人完全用不到 24 條外部連結,
           而 capabilities 的示範問句一攤開就佔掉一半篇幅,所以另外用 with_examples 控制。 */
        const kind = String(a.kind || 'all').toLowerCase().trim();
        const want = k => kind === 'all' || kind === k;
        const ex = !!a.with_examples;
        const abs = u => (/^[a-z]+:\/\//i.test(u) ? u
          : (typeof location !== 'undefined' ? location.origin + '/' : '') + String(u).replace(/^\.?\//, ''));
        const out = { site: 'Project SEKAI 台服資源站', kind };

        if (want('credits')) {
          out.credits = {
            /* 名單原樣照列,不排序也不去重 —— 順序是提供者給的加入順序,重排等於改了原意 */
            editors: {
              group: '世界計畫開瓶器編輯群',
              role: '教學大全 115 則問答的撰寫者;search_tutorial 查到的內容就是出自他們',
              order_note: '順序僅為加入順序,無先後之分',
              count: this.CREDIT_EDITORS.length,
              names: this.CREDIT_EDITORS,
            },
            data_authors: this.CREDIT_WORKS.map(w => ({
              who: w.who,
              works: w.items.map(it => ({ name: it.n, desc: it.d, url: it.u || null })),
            })),
            advisors: { role: '提供建議並實際採納', count: this.CREDIT_ADVISORS.length, names: this.CREDIT_ADVISORS },
            contact: { who: 'Omega', discord: 'euler_formula_best', purpose: '資料有誤、想加功能、回報問題' },
            copyright: '歡迎轉載,但請註明作者出處。各份資料表與教學問答的著作權均屬原作者所有,引用時請一併標註原始連結。',
            note: '本站只是把這些人的成果整合起來;有原始連結的一律以原版為準,那裡永遠比站上新。',
          };
        }

        if (want('resources')) {
          const groups = this.RES_GROUPS || [];
          const g = String(a.group || '').trim();
          const hit = g ? groups.filter(x => x.label === g || x.label.indexOf(g) >= 0) : groups;
          if (g && !hit.length) {
            out.resources = { error: '沒有這一組:' + g, available_groups: groups.map(x => x.label) };
          } else {
            out.resources = {
              group_count: groups.length,
              link_count: groups.reduce((s2, x) => s2 + x.items.length, 0),
              groups: hit.map(x => ({
                group: x.label,
                links: x.items.map(it => ({
                  name: it.name, desc: it.sub, url: abs(it.url),
                  // 「本站工具」那組是相對路徑,單獨貼給使用者會連不到,所以補成完整網址並標出來
                  internal: !/^[a-z]+:\/\//i.test(it.url),
                })),
              })),
              note: '這是資源連結頁(?page=res)的完整索引,轉述時請一併附上網址。',
            };
          }
        }

        if (want('capabilities')) {
          out.capabilities = {
            tool_count: (this.AI_TOOLS || []).length,
            /* 模塊與模板不是同一種東西,回傳時要分開講,不然助手會把兩邊混著唸:
               模塊＝照著問就有答案;模板＝〔〕裡的字要換成使用者自己的數字。 */
            modules: this.AI_MODULES.map(m => Object.assign(
              { id: m.id, name: m.n, does: m.d, example_count: m.q.length },
              ex ? { examples: m.q } : {})),
            templates: this.AI_TEMPLATES.map(t => Object.assign(
              { name: t.n, template_count: t.q.length },
              ex ? { fill_in_the_blank: t.q } : {})),
            note: 'modules 是站內助手頁上點一下就填進輸入框的示範問句(照著問就有答案);'
              + 'templates 是填空句,〔〕裡的內容要換成使用者自己的 ID、分數、加成、預算。',
          };
          if (!ex) out.capabilities.hint = '要看每一項的實際問句,帶 with_examples:true 再呼叫一次(回傳量約三倍)。';
        }

        if (!out.credits && !out.resources && !out.capabilities) {
          return { error: '不認得的 kind:' + kind, valid_kind: ['credits', 'resources', 'capabilities', 'all'] };
        }
        return out;
      }

      case 'predict_card_rerun': {
        /* 為什麼借 core.js 的 RerunModule，而不在這裡自己推一套：
           台服 gachas.json 是「線上快照」不是歷史檔 —— 實測整支只有 74 個卡池
           (3 個沒清掉的舊新手池 ＋ 17 個進行中 ＋ 54 個已排程)，台服過去開過什麼
           完全查不到。所以能回答「下次什麼時候再出」的來源就只有 RerunModule 用的
           那兩個：台服 master 裡已經排進去的未來卡池(＝官方已排定)，以及日服同一張卡
           的開池日 ＋365 天(＝推估)。兩者必須在回傳裡分得一清二楚 —— 把推估講得像
           排定，會直接害人把石頭壓在一個不存在的日期上。
           推估的準度是量過的（2026/08 取樣）：當時 192 張「台服已排定 且 日服有對應紀錄」
           的卡，日服＋365 天與台服實際排定日的誤差中位數 0 天、99% 落在 ±31 天內 ——
           台服基本上是把日服的排程整份往後推一年，所以這個平移敢拿來用。 */
        await this.loadCards();
        const cards = this.state.rateCards || [];
        if (!cards.length) return { error: '卡片索引尚未載入（' + (this.state.rateErr || '請先開啟「收集率」頁') + '）' };

        let E;
        try { E = await this.ensureEngine(); }
        catch (e) { return { error: '計算引擎載入失敗：' + (e.message || '請稍後再試') }; }
        const R = E.RerunModule;
        if (!R) return { error: '計算引擎載入了，但取不到 RerunModule（復刻推算）' };
        if (!(await R.ensure())) return { error: '復刻資料載入失敗（台服／日服 gachas.json 抓不到），稍後再試' };

        /* RerunModule 只留下 startAt，卡池名稱、期間、類型要自己補一份。
           gachas.json 在 R.ensure() 裡已經抓過，MasterDB 會回同一個 Promise，不會再打一次網路。 */
        let twG = [];
        try { twG = (await E.MasterDB.get('gachas.json')) || []; } catch (e) {}
        if (!twG.length) return { error: '台服卡池表載入失敗，稍後再試' };

        const now = Date.now();
        const KIND = { ceil: '限定／復刻池（有天井）', normal: '一般池（高級禮物／選擇清單／必中票券等）',
                       beginner: '新手限定池', subeginner: '新手限定池', return: '回歸玩家池' };
        const puBy = {}, liveIn = {};
        twG.forEach(g => {
          (g.gachaPickups || []).forEach(p => { (puBy[p.cardId] = puBy[p.cardId] || []).push(g); });
          /* 「現在抽不抽得到」要看進行中卡池的完整 gachaDetails，不能只看 PU：
             實測 5 週年 FES 池的名單裡收了全部 27 張彩FES ＋ 12 張 BLOOMFES 卡，
             它們都不是 PU 卻真的抽得到 —— 這正是「要不要現在抽」最關鍵的一格。 */
          if (g.startAt <= now && g.endAt >= now) (g.gachaDetails || []).forEach(d => { (liveIn[d.cardId] = liveIn[d.cardId] || []).push(g); });
        });
        Object.keys(puBy).forEach(k => puBy[k].sort((x, y) => x.startAt - y.startAt));

        // 台灣固定 UTC+8 且無日光節約，位移 8 小時再讀 UTC 就是正確的台北日期，不必碰 toLocaleString
        const pad = v => String(v).padStart(2, '0');
        const tpe = ms => { const d = new Date(ms + 8 * 3600000);
          return { ymd: d.getUTCFullYear() + '/' + pad(d.getUTCMonth() + 1) + '/' + pad(d.getUTCDate()),
                   ym: d.getUTCFullYear() + '/' + pad(d.getUTCMonth() + 1) }; };
        const days = ms => Math.round((ms - now) / 86400000);

        const ATTR = ['cool', 'happy', 'mysterious', 'cute', 'pure'];
        const SUPPLY_CODE = ['normal', 'birthday', 'term_limited', 'colorful_festival_limited',
                             'bloom_festival_limited', 'unit_event_limited', 'collaboration_limited'];
        const byId = {}; cards.forEach(c => { byId[c[0]] = c; });
        const schedUntil = twG.reduce((m, g) => Math.max(m, g.startAt || 0), 0);

        const predict = c => {
          const id = c[0];
          const type = R.cardType[id] || SUPPLY_CODE[c[4]] || 'normal';   // 以 RerunModule 的分類為準，和經典版頁面同源
          const inf = R.info(id);                                          // { type, next, isJP }
          const zh = this.SUPPLYN[SUPPLY_CODE.indexOf(type)] || this.SUPPLYN[c[4]] || '';
          const live = (liveIn[id] || []).slice().sort((x, y) => x.endAt - y.endAt);
          const pus = puBy[id] || [];
          // 同一張卡可能同時掛在好幾個進行中的池（含 2099 才結束的新手池），
          // 「還剩多久」要取最快結束的那個，取第一個會回到新手池那種假期限
          const livePu = pus.filter(g => g.startAt <= now && g.endAt >= now).sort((x, y) => x.endAt - y.endAt);
          const twNext = pus.find(g => g.startAt > now) || null;           // 台服 master 真的排進去了 ＝ 已排定
          const jpPast = (R.appearJP[id] || []).filter(s => s <= now).length;

          let next;
          if (type === 'normal') {
            // 常駐卡沒有「復刻」這回事，講成已排定復刻會誤導；有未來卡池就當「下次成為 PU」講
            const t = twNext ? tpe(twNext.startAt) : null;
            next = {
              status: '常駐', is_confirmed: true, schedule_conflict: false,
              date: t ? t.ymd : null, year_month: t ? t.ym : null,
              days_from_now: twNext ? days(twNext.startAt) : null,
              gacha_id: twNext ? twNext.id : null, gacha_name: twNext ? twNext.name : null,
              gacha_kind: twNext ? (KIND[twNext.gachaType] || twNext.gachaType) : null,
              source: twNext ? 'tw_master_scheduled' : null,
              caveat: c[6] === 1 ? null : '標為常駐，但台服查不到任何卡池收錄過（多半是活動報酬卡）',
            };
          } else if (twNext) {
            const t = tpe(twNext.startAt);
            next = {
              status: '已排定', is_confirmed: true, schedule_conflict: false,
              date: t.ymd, year_month: t.ym, days_from_now: days(twNext.startAt),
              gacha_id: twNext.id, gacha_name: twNext.name,
              gacha_kind: KIND[twNext.gachaType] || twNext.gachaType || null,
              source: 'tw_master_scheduled',
              caveat: twNext.gachaType === 'ceil' ? null
                : '這不是復刻 PU 池，是「' + (KIND[twNext.gachaType] || twNext.gachaType) + '」把這張卡收進名單的另一種取得管道',
            };
          } else if (inf.next && inf.isJP) {
            /* 台服排程已經公布到 schedUntil，如果推估日落在那之前卻沒被排進去，
               這個推估等於已經被官方排程否決了 —— 不標出來，模型會照著一個
               已知不可能的月份叫人存石頭 */
            const conflict = inf.next < schedUntil;
            next = {
              status: '預估', is_confirmed: false, schedule_conflict: conflict,
              date: null, year_month: tpe(inf.next).ym, days_from_now: days(inf.next),
              gacha_id: null, gacha_name: null, gacha_kind: null,
              source: 'jp_offset_' + Math.round(R.OFFSET / 86400000) + 'd',
              caveat: conflict ? '台服排程已公布到 ' + tpe(schedUntil).ymd + '、裡面沒有這張，所以實際一定比這個推估晚；這個月份只能當「日服的節奏」看' : null,
            };
          } else {
            const why = type === 'birthday'
                ? '目前沒有排定，但台服慣例是每年該角色生日檔期同時開當年新卡與歷年復刻池（實測曉山瑞希檔期同時掛了 2026 新卡＋2025／2024／初代三個復刻池）'
              : (type === 'colorful_festival_limited' || type === 'bloom_festival_limited')
                ? 'FES 限定卡首次登場後就長駐在 FES 池的抽卡名單裡（只是不再是 PU），下次 FES 期間仍抽得到，只是機率低很多；PU 復刻很罕見'
              : type === 'collaboration_limited'
                ? '聯動限定，聯動結束後日服也沒有再開的紀錄，不保證會復刻'
              : '台服沒有排程，日服也沒有可平移的未來開池紀錄，推不出來';
            next = { status: '無排定', is_confirmed: false, schedule_conflict: false,
                     date: null, year_month: null, days_from_now: null,
                     gacha_id: null, gacha_name: null, gacha_kind: null,
                     source: null, caveat: why };
          }

          return {
            card_id: id, card_name: c[7] || '', character: this.chNameOf(c[1]),
            rarity: (this.RARITY.find(r => r[0] === c[2]) || [null, '?'])[1],
            attribute: this.ATTR_ZH[ATTR[c[3]]] || String(c[3]),
            limited_type: zh, limited_type_code: type,
            obtainable_now: live.length ? {
              is_pickup_now: livePu.length > 0,
              in_pools: live.slice(0, 2).map(g => g.name),
              pool_count: live.length,
              pickup_ends_at: livePu.length ? tpe(livePu[0].endAt).ymd : null,
              pickup_hours_left: livePu.length ? +((livePu[0].endAt - now) / 3600000).toFixed(1) : null,
            } : null,
            next_rerun: next,
            jp_pickup_count: jpPast,
          };
        };

        /* ---- 目標選定：card_id ＞ gacha_name ＞ character ＞（都不給）進行中卡池的 PU 卡 ---- */
        const nz = v => String(v == null ? '' : v).trim();
        let targets = [], scope = '';
        if (nz(a.card_id)) {
          const t = nz(a.card_id);
          if (!/^\d+$/.test(t)) return { error: 'card_id 必須是數字卡片 id；要用角色或卡池名請改給 character／gacha_name' };
          const c = byId[+t];
          if (!c) return { error: '卡片索引裡沒有 id ' + t + ' 這張卡（台服共 ' + cards.length + ' 張）' };
          targets = [c]; scope = 'card_id ' + t;
        } else if (nz(a.gacha_name)) {
          const q = nz(a.gacha_name), lc = q.toLowerCase();
          const hit = /^\d+$/.test(q) ? twG.find(g => String(g.id) === q)
                                      : twG.find(g => String(g.name || '').toLowerCase().indexOf(lc) >= 0);
          if (!hit) return {
            error: '台服卡池表裡找不到「' + q + '」',
            hint: '台服 gachas.json 是線上快照（目前 ' + twG.length + ' 個卡池），只有進行中與已排程的池，查不到早就結束的舊池；查舊池的卡請改用 card_id 或 character。',
            current_and_upcoming: twG.filter(g => g.endAt >= now).sort((x, y) => x.startAt - y.startAt).slice(0, 15).map(g => g.name),
          };
          targets = (hit.gachaPickups || []).map(p => byId[p.cardId]).filter(Boolean);
          scope = '卡池 #' + hit.id + '「' + hit.name + '」的 PU 卡';
          if (!targets.length) return { error: '卡池 #' + hit.id + '「' + hit.name + '」沒有 PU 卡（或 PU 的卡台服卡庫裡還沒有）' };
        } else if (nz(a.character)) {
          const t = nz(a.character);
          let charId = /^\d+$/.test(t) ? +t : (this.CHARA_ID[t] || null);
          if (!charId) { const k = Object.keys(this.CHARA_ID).find(nm => t.indexOf(nm) >= 0); if (k) charId = this.CHARA_ID[k]; }
          if (!charId) return { error: '不認得角色「' + t + '」', available_characters: Object.keys(this.CHARA_ID) };
          const perm = a.include_permanent === true;
          targets = cards.filter(c => c[1] === charId && (perm || (R.cardType[c[0]] || SUPPLY_CODE[c[4]]) !== 'normal'));
          scope = this.chNameOf(charId) + (perm ? ' 的全部卡片' : ' 的限定卡（不含常駐，要含常駐請給 include_permanent=true）');
          if (!targets.length) return { error: scope + '：找不到符合的卡' };
        } else {
          /* 只取「真的當期池」：新手／回歸池與 endAt 掛到 2099 的常設池也有 PU 名單，
             全撈進來會回一堆常駐卡（實測 71 張，其中大半是新手選擇招募的 26 張），
             使用者問的從來不是那個 */
          const seen = {};
          twG.filter(g => g.startAt <= now && g.endAt >= now
                       && ['beginner', 'subeginner', 'return'].indexOf(g.gachaType) < 0
                       && (g.endAt - g.startAt) <= 120 * 86400000)
            .sort((x, y) => x.startAt - y.startAt)
            .forEach(g => (g.gachaPickups || []).forEach(p => {
              if (!seen[p.cardId] && byId[p.cardId]) { seen[p.cardId] = 1; targets.push(byId[p.cardId]); }
            }));
          scope = '目前進行中卡池的 PU 卡';
          if (!targets.length) return { error: '目前沒有進行中的 PU 卡池，請指定 card_id／character／gacha_name' };
        }

        /* ---- 排序：現在就是 PU ＞ 已排定 ＞ 預估 ＞ 推不出來，同組再依日期由近到遠 ---- */
        const rows = targets.map(predict);
        // 排序優先權：現在就是 PU ＞ 已排定 ＞ 乾淨的預估 ＞ 被排程否決的預估 ＞ 常駐 ＞ 推不出來
        const ord = r => (r.obtainable_now && r.obtainable_now.is_pickup_now) ? 0
                       : r.next_rerun.status === '已排定' ? 1
                       : r.next_rerun.status === '預估' ? (r.next_rerun.schedule_conflict ? 3 : 2)
                       : r.next_rerun.status === '常駐' ? 4 : 5;
        const dd = r => r.next_rerun.days_from_now == null ? 1e9 : r.next_rerun.days_from_now;
        rows.sort((x, y) => ord(x) - ord(y) || dd(x) - dd(y) || x.card_id - y.card_id);

        let lim = a.limit == null ? 10 : Math.round(+a.limit);
        if (!(lim > 0)) lim = 10;                          // 0／負數／NaN 一律當沒給，不要縮成 1 張
        const limit = Math.min(40, lim);
        const offset = Math.max(0, a.offset == null ? 0 : Math.round(+a.offset) || 0);
        const page = rows.slice(offset, offset + limit);

        let head;
        if (!page.length && offset) head = 'offset ' + offset + ' 已經超過符合的 ' + rows.length + ' 張，請把 offset 調小。';
        else head = 'cards 是排序後（現在就是 PU ＞ 已排定 ＞ 預估 ＞ 推不出來）的第 ' + (offset + 1) + '～' + (offset + page.length)
          + ' 張，共 ' + rows.length + ' 張；要更多請調 limit（上限 40）或用 offset 續取。';

        return {
          scope, matched: rows.length, showing: page.length, limit, offset,
          cards: page,
          data_freshness: {
            tw_gacha_entries: twG.length,
            tw_scheduled_until: schedUntil ? tpe(schedUntil).ymd : null,
            queried_at_taipei: tpe(now).ymd,
          },
          note: head
            + '　next_rerun.status 有四種（已排定／預估／常駐／無排定），帶得動抽卡決策的是前兩種，而且必須分開講：'
            + '「已排定」＝台服官方 master data 已經把這張卡排進某個未來卡池，日期與卡池名都是官方值；'
            + '「預估」＝台服還沒公布，用日服同一張卡的開池日 ＋365 天平移出來的推算，只精確到月份，不是官方排程，別當成承諾。'
            + '推估準度是實測過的（2026/08 取樣）：當時 192 張同時有「台服已排定」與「日服對應紀錄」的卡，日服＋365 天與台服實際排定日誤差中位數 0 天、99% 落在 ±31 天內 —— 準，但仍然是推算。'
            + '　台服排程只公布到 ' + (schedUntil ? tpe(schedUntil).ymd : '—') + '，在那之後的一律只可能是「預估」。'
            + '　台服 gachas.json 是線上快照而不是歷史檔（目前只有 ' + twG.length + ' 個卡池），查不到台服的過去開池紀錄；'
            + 'jp_pickup_count＝這張卡在日服至今當過幾次 PU，是「還會不會再出」目前唯一有長度的證據（日服平均：期間限定 3.8 次、生日 3.4 次、團體活動限定 3.0 次、聯動 2.0 次、彩FES 1.2 次、BLOOMFES 1.2 次）。'
            + '　schedule_conflict=true 代表推估的月份落在台服已公布的排程之內、但官方沒排這張，實際一定會更晚，別照那個月份給建議。'
            + '　obtainable_now 看的是進行中卡池的完整抽卡名單而不是只有 PU；is_pickup_now=false 代表抽得到但沒有 PU 加權，中的機率低很多。'
            + '　status「常駐」＝常駐池隨時抽得到、沒有復刻問題，此時 date／gacha 指的是它下次被列為 PU 的卡池而不是復刻。'
            + 'source 短碼：tw_master_scheduled＝台服 master 已排程（官方值）、jp_offset_365d＝日服日期＋365 天推算。'
            + '　日期都是台北時間（UTC+8）；days_from_now 單位是天，pickup_hours_left 單位是小時。',
        };
      }

      case 'get_card_art': {
        /* 超高清卡面的下載連結。直連官方素材庫,本站不轉存 —— 回傳的網址就是
           資料庫裡那一份。特訓後只有 ★3/★4 才有(生日卡實測 404,不要憑稀有度猜)。 */
        await this.loadCards();
        const cards = this.state.rateCards || [];
        if (!cards.length) return { error: '卡片索引尚未載入（' + (this.state.rateErr || '請稍後再試') + '）' };
        const nOf = {}; (this.state.rateChars || []).forEach(c => { nOf[c[0]] = c[1]; });
        const q = String(a.q == null ? '' : a.q).trim().toLowerCase();
        const ids = Array.isArray(a.card_ids) ? a.card_ids.map(Number) : null;
        let rows = cards;
        if (ids && ids.length) { const set = new Set(ids); rows = rows.filter(c => set.has(c[0])); }
        if (q) rows = rows.filter(c =>
          ((c[7] || '') + ' ' + (nOf[c[1]] || '') + ' ' + (c[8] || '')).toLowerCase().indexOf(q) >= 0);
        if (a.rarity != null) rows = rows.filter(c => c[2] === +a.rarity);
        if (!rows.length) {
          return { error: '找不到符合的卡片。可先用 browse_cards 或 search_anything 找到卡名／card_id 再查。' };
        }
        const lim = Math.max(1, Math.min(20, +a.limit || 5));
        const A = this.ASSET;
        return {
          matched: rows.length, returned: Math.min(lim, rows.length),
          source: '官方素材庫（storage.sekai.best），本站不轉存，連結即資料庫原始檔',
          cards: rows.slice(0, lim).map(c => {
            const abn = c[8], tr = (c[2] === 3 || c[2] === 4);
            return {
              card_id: c[0], name: c[7], character: nOf[c[1]] || '',
              rarity: (this.RARITY.find(r => r[0] === c[2]) || [0, '?'])[1],
              supply: this.SUPPLYN[c[4]] || '',
              art_normal: A + '/character/member/' + abn + '/card_normal.png',
              art_after_training: tr ? (A + '/character/member/' + abn + '/card_after_training.png') : null,
              cutout: A + '/character/member_cutout/' + abn + '/normal.png',
            };
          }),
          note: '全解析度 PNG 每張約 3～4 MB；去背立繪約 150 KB。'
            + '特訓後只有 ★3／★4 有，其餘為 null（生日卡也沒有）。'
            + '站上「卡面下載」頁（?page=art）可以用角色／稀有度／取得類別篩選後整批瀏覽。',
        };
      }

      case 'list_my_watches': {
        if (this.state.me === undefined) {
          try { await this.loadMe(); } catch (e) {}
          for (let i = 0; i < 30 && this.state.me === undefined; i++) await new Promise(r => setTimeout(r, 100));
        }
        const me = this.state.me;
        if (!me) return { error: '尚未登入，看不到訂閱清單' };
        if (me.status !== 'approved') return { error: '帳號目前狀態是「' + (me.status || '未知') + '」，通過審核後才會有訂閱' };
        let d;
        try { d = await this.api('/api/watches'); }
        catch (e) { return { error: (e && e.message) || '讀取訂閱失敗' }; }
        const ws = (d && d.watches) || [];
        let evs = null;
        if (a.include_events !== false) {
          try { const e = await this.api('/api/events?limit=10'); evs = (e && e.events) || []; } catch (er) { evs = null; }
        }
        // 順便讓「帳號」頁同步；沒查通知就別把既有的 wEvents 清掉
        this.setState(evs ? { watches: ws, wEvents: evs } : { watches: ws });
        return {
          total: ws.length, max: d && d.max != null ? d.max : null,
          watches: ws.slice(0, 20).map(w => ({
            id: w.id, kind: w.kind, name: w.name, params: w.params,
            enabled: w.enabled, cooldown_s: w.cooldown_s,
            last_fired: w.last_fired || null, created_at: w.created_at })),
          /* 申請審核的通知要整段排除:它的 body 含有申請者自己打的字,
             而這裡的回傳值會直接變成模型的 tool_result —— 等於讓外人
             對管理員正在用的助手下指令。watch_id 的 apply: 前綴就是給這個用的。 */
          recent_events: evs ? evs.filter(e => String(e.watch_id || '').indexOf('apply:') !== 0)
            .slice(0, 8).map(e => ({
              watch_id: e.watch_id, title: e.title,
              body: String(e.body || '').replace(/\s+/g, ' ').slice(0, 300),
              created_at: e.created_at })) : null,
          note: 'last_fired 是最後一次觸發的時間戳（秒），null 代表還沒觸發過。',
        };
      }
      case 'search_anything': {
        /* 使用者不會知道一個詞屬於哪一類,所以一次搜完再讓模型判斷。
           比對前先正規化：全形轉半形、大小寫統一、去掉空白與常見標點 ——
           玩家打字不會照著官方全名打。找不到精確結果時退一步用「任一字元命中」
           給候選,總比回一句「查不到」有用。 */
        const raw = String(a.q || '').trim();
        if (!raw) return { error: '缺少關鍵字' };
        const norm = t => String(t == null ? '' : t)
          .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
          .replace(/[\s・･·．.,，、!！?？~〜ー\-_'"「」『』（）()\[\]]/g, '')
          .toLowerCase();
        /* 玩家常整句丟過來(「余花那期」「絢爛那次」),而曲名/活動名裡沒有「那期」,
           直接比對會整個落空。所以額外準備剝掉尾綴量詞的變體一起比。
           只剝尾綴,不剝開頭 —— 開頭剝離會把「本気」這種曲名砍成「気」,一個字很容易亂命中。
           剝完少於兩字也不採用,同樣是為了避免過度比對。 */
        const strip = t => t.replace(/(那|這|該|上|下|前|本)?(一)?(期|次|回|張|首|個|池|團|活動|卡池|的)+$/, '');
        const base = norm(raw), alt = strip(base);
        const qs = [...new Set([base].concat(alt !== base && alt.length >= 2 ? [alt] : []))];
        const q = qs[0];
        const want = Array.isArray(a.kinds) && a.kinds.length ? a.kinds
          : ['song', 'event', 'card', 'gacha', 'tutorial', 'feature'];
        const hit = (t) => { const n2 = norm(t);
          return !!n2 && qs.some(v => n2.includes(v) || v.includes(n2)); };
        const loose = (t) => { const n2 = norm(t); return n2 && [...q].some(ch => n2.includes(ch)); };
        const out = {}; const near = {};

        if (want.indexOf('song') >= 0) {
          await this.loadSongs();
          const songs = this.state.songs || [];
          const ex = songs.filter(x => hit(x.title) || hit(x.composer));
          /* 玩家說「余花那期」時,指的是那首歌所屬的活動,不是歌本身。
             eventMusics 有這層關聯（余花にみとれて → 第 150 期）,查到就一併帶出來,
             否則助手只會回一首歌,答非所問。 */
          if (ex.length && !this._evMusic) {
            this._evMusic = await fetch(this.TDB + '/eventMusics.json')
              .then(r => r.json()).catch(() => []);
          }
          const evl = ex.length ? await this.loadEvList().catch(() => []) : [];
          const evOf = id => (evl || []).find(x => +x.id === +id) || null;
          out.songs = ex.slice(0, 8).map(x => {
            const link = (this._evMusic || []).find(l => +l.musicId === +x.id);
            const ev = link ? evOf(link.eventId) : null;
            return { id: x.id, title: x.title, composer: x.composer,
              units: x.units, master_lv: (x.lv || {}).master,
              event: link ? { id: link.eventId, name: ev ? ev.name : undefined,
                              start: ev ? ev.start_at : undefined } : null,
              hint: link ? ('這首是第 ' + link.eventId + ' 期的活動曲；使用者說「' + raw + '那期」多半是指那一期')
                         : undefined };
          });
          if (!ex.length) near.songs = songs.filter(x => loose(x.title)).slice(0, 5).map(x => x.title);
        }
        if (want.indexOf('event') >= 0) {
          /* 榜線資料庫是懶載入的,使用者沒開過榜線頁時 BORDERS_DB 還不存在,
             不先載就會誤判成「查無此活動」。 */
          await this.loadBorderDB().catch(() => {});
          const DB = (typeof BORDERS_DB !== 'undefined') ? BORDERS_DB : null;
          const evs = (DB && DB.events) || [];
          const ex = evs.filter(x => hit(x.name) || hit(x.chara) || hit(x.unit));
          out.events = ex.slice(0, 8).map(x => ({ id: x.id, name: x.name, type: x.type,
            days: x.days, unit: x.unit, chara: x.chara, start: x.start }));
          if (!ex.length && evs.length) near.events = evs.filter(x => loose(x.name)).slice(0, 5).map(x => x.name);
        }
        if (want.indexOf('gacha') >= 0) {
          const gs = this.state.gachas || [];
          /* 「bfes 那期」「cfes 那期」指的是那種池伴生的活動。note 欄位就寫著
             「4.25 BFES/153期伴生」,所以類型關鍵字也要一起比對,並把 eid 帶出來。 */
          const ex = gs.filter(x => hit(x.n) || hit(x.ch) || hit(x.t) || hit(x.note));
          const evl2 = ex.length ? await this.loadEvList().catch(() => []) : [];
          const evOf2 = id => (evl2 || []).find(x => +x.id === +id) || null;
          out.gachas = ex.slice(0, 10).map(x => {
            const ev = x.eid ? evOf2(x.eid) : null;
            return { name: x.n, type: x.t, start: x.s, end: x.e, pickup: x.ch, note: x.note || undefined,
              event: x.eid ? { id: +x.eid, name: ev ? ev.name : undefined,
                               start: ev ? ev.start_at : undefined } : null };
          });
          if (ex.length && /fes|フェス|慶典/i.test(raw)) {
            out.gacha_note = '這類講法（bfes／cfes／絢爛／七彩）通常是在指那個池伴生的活動期數，'
              + '每筆的 event 欄位就是；有多期時要問使用者是哪一次。';
          }
        }
        if (want.indexOf('card') >= 0) {
          try {
            const DBU = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-tc-diff/main';
            if (!this._cardSkillCache) {
              const [cards, skills] = await Promise.all([
                fetch(DBU + '/cards.json').then(r => r.json()),
                fetch(DBU + '/skills.json').then(r => r.json()),
              ]);
              const byId = {}; skills.forEach(k => { byId[k.id] = k; });
              this._cardSkillCache = { cards, skills: byId };
            }
            const ex = this._cardSkillCache.cards.filter(c => hit(c.prefix));
            out.cards = ex.slice(0, 8).map(c => ({ id: c.id, name: c.prefix,
              rarity: c.cardRarityType, chara_id: c.characterId }));
          } catch (e) { out.cards_error = '卡片資料載入失敗'; }
        }
        if (want.indexOf('tutorial') >= 0) {
          let src = this.state.tutQA || [];
          if (!src.length) {
            try { const m = await import('./data/tutorial-data.js?v=4befc9b27b'); src = m.TUT_QA || [];
                  this.setState({ tutQA: src }); } catch (e) {}
          }
          const ex = src.filter(x => hit(x.q) || hit(x.kw) || String(x.a || '').includes(raw));
          out.tutorial = ex.slice(0, 5).map(x => ({ question: x.q,
            answer: String(x.a || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400) }));
        }

        /* 站台自己的功能索引。這是助手原本完全碰不到的一塊 ——
           它能搜曲庫、活動、卡片,卻不知道「這個網站有哪些功能」,
           所以使用者問「效益曲排行」時,它去找一首叫效益曲的歌,當然找不到。
           三份資料合起來就是站台對自己的完整描述:
           PAGES(26 頁一句話)、CHANGELOG(22 則功能介紹)、SYSLOG(101 則詳細更新記錄)。 */
        /* 別名查表。玩家講的幾乎都是圈內叫法,而站上存的是正式名稱 ——
           這一步先做,命中就直接告訴模型「這個詞對應哪支工具」,
           它就不必從一堆搜尋結果裡自己猜。 */
        {
          const al = [];
          (this.ALIASES || []).forEach(row => {
            const names = [row[0]].concat(String(row[3] || '').split('|'));
            if (names.some(n2 => hit(n2))) {
              al.push({ name: row[0], tool: row[1] || null, page: row[2] || null });
            }
          });
          if (al.length) {
            out.terms = al.slice(0, 5);
            out.term_note = '這是圈內用語對照。有 tool 欄位的話,'
              + '**直接呼叫那支工具把結果算出來**,不要只解釋名詞 ——'
              + '使用者問的是答案,不是定義。';
          }
        }

        if (want.indexOf('feature') >= 0) {
          const P = this.PAGES || {};
          const pg = Object.keys(P).filter(k2 => hit(P[k2][0]) || hit(P[k2][1]) || hit(k2))
            .slice(0, 6).map(k2 => ({ page: k2, name: P[k2][0], desc: P[k2][1] }));
          const cl = (this.CHANGELOG || []).filter(x => hit(x.title) || hit(x.desc))
            .slice(0, 6).map(x => ({ name: x.title, desc: x.desc, page: x.to || null }));
          const sl = (this.SYSLOG || []).filter(x => hit(x.t) || hit(x.s))
            .slice(0, 6).map(x => ({ date: x.d, name: x.t, detail: String(x.s || '').slice(0, 400) }));
          if (pg.length) out.pages = pg;
          if (cl.length) out.features = cl;
          if (sl.length) out.changelog = sl;
          if (pg.length || cl.length || sl.length) {
            out.feature_note = '這個詞指的是站上的一項功能,不是遊戲內容。'
              + '回答時要說明它在哪一頁、怎麼用,並且優先用對應的工具實際算給使用者看,而不是只描述功能。';
          }
        }

        const found = Object.keys(out).reduce((n2, k) => n2 + (Array.isArray(out[k]) ? out[k].length : 0), 0);
        return {
          query: raw, found, ...out,
          near_misses: found ? undefined : near,
          note: found
            ? '這些是名稱或關鍵字命中的結果，請判斷使用者指的是哪一個；不確定就直接問。'
            : '完全沒有命中。near_misses 是字元層級的近似候選，僅供參考，不要當成答案；請問使用者那是指什麼。',
        };
      }

      case 'get_card_skills': {
        /* 站上的卡庫（classic 的 cardlib）本來就在讀官方 skills.json,
           但那份解析在 core.js、不在這裡,所以工具自己抓一次並快取。
           技能 % 就是 skillEffectDetails 裡對應等級的 activateEffectValue。 */
        const DB = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-tc-diff/main';
        if (!this._cardSkillCache) {
          try {
            const [cards, skills] = await Promise.all([
              fetch(DB + '/cards.json').then(r => r.json()),
              fetch(DB + '/skills.json').then(r => r.json()),
            ]);
            const byId = {}; skills.forEach(k => { byId[k.id] = k; });
            this._cardSkillCache = { cards, skills: byId };
          } catch (e) { return { error: '技能資料載入失敗：' + (e.message || '') }; }
        }
        const { cards, skills } = this._cardSkillCache;
        const nOf = {}; (this.state.rateChars || []).forEach(x => { nOf[x[0]] = x[1]; });

        let pool = cards;
        if (Array.isArray(a.ids) && a.ids.length) { const set = new Set(a.ids.map(Number)); pool = pool.filter(c => set.has(c.id)); }
        if (a.chara) pool = pool.filter(c => +c.characterId === +a.chara);
        if (a.rarity) pool = pool.filter(c => c.cardRarityType === a.rarity);
        if (a.mine) {
          const uid = this.state.pid;
          if (!uid) return { error: '還沒設定 uid,請先用 set_my_uid' };
          try {
            const d = await fetch(this.API + '/user/' + encodeURIComponent(uid) + '/profile').then(r => r.ok ? r.json() : null);
            const own = new Set(((d && d.userCards) || []).map(x => x.cardId));
            pool = pool.filter(c => own.has(c.id));
          } catch (e) { return { error: '取得持卡失敗' }; }
        }
        if (!pool.length) return { count: 0, cards: [], note: '沒有符合條件的卡' };

        /* 技能值不能只看第一個效果 —— 有幾種是「基礎＋條件加成」的組合,
           只取基礎會低估：
             score_up + score_up_character_rank  基礎 110％,角色等級每 2 級 +1％,
                                                 100 級時 +50％ → 最大 160％
             score_up + score_up_unit_count      基礎 90％,每有 1 種外團 +30％,
                                                 最多 2 種 → 最大 150％
             score_up_condition_life / _keep     那一串本身就是完整值,取最大即可
             other_member_score_up_reference_rate 取隊友技能上限的 %,依隊伍而定,
                                                 沒辦法單看一張卡算死,另外標註
           回傳同時給 base 與 max,讓模型講得清楚「保底多少、拉滿多少」。 */
        const val = c => {
          const sk = skills[c.skillId];
          if (!sk) return null;
          const effs = sk.skillEffects || [];
          const lvls = e => (e.skillEffectDetails || []).map(x => [x.level, +x.activateEffectValue]);
          const at = (e, lv) => { const d = e.skillEffectDetails || [];
            const f = d.find(x => x.level === lv) || d[d.length - 1]; return f ? +f.activateEffectValue : 0; };
          const of = t => effs.filter(e => (e.skillEffectType || '') === t);
          const enh = effs.map(e => e.skillEnhance).find(Boolean);

          const life = of('score_up_condition_life'), keep = of('score_up_keep');
          const plain = of('score_up'), rank = of('score_up_character_rank');
          const unit = of('score_up_unit_count'), ref = of('other_member_score_up_reference_rate');

          /* base 與 max 各自都有分級,不必推估：
             體力型／keep 型是「同一種 effectType 排成一串」,第一條是條件拉滿值、
             最後一條是保底值,兩條都帶 Lv1-4;
             其餘型態則是 score_up 那條帶分級,加成部分(同團 +10、角色等級 +50、
             外團 +60)是固定值不隨技能等級變。 */
          let kind = '', baseEff = null, maxEff = null, addFixed = 0, note = '', dur = null;
          if (life.length || keep.length) {
            const arr = life.length ? life : keep;
            kind = life.length ? 'condition_life' : 'keep';
            maxEff = arr[0]; baseEff = arr[arr.length - 1];
            note = life.length ? '體力越高越接近上限（協力滿血可視為上限）'
                               : '判定保持 GOOD 以上才是上限值';
          } else if (plain.length) {
            baseEff = plain[0]; maxEff = plain[0];
            if (enh && /sub_unit_score_up/.test(enh.skillEnhanceType || '')) {
              const per = +enh.activateEffectValue || 0;
              kind = 'same_unit'; addFixed = per * 5;
              note = '除自己外每 1 位同團成員 +' + per + '%（最多 4 位），全員同團再 +' + per + '%';
            } else if (rank.length) {
              kind = 'character_rank'; addFixed = Math.max(...rank.map(e => at(e, 4)));
              note = '角色等級每 2 級 +1%，滿級達上限';
            } else if (unit.length) {
              kind = 'unit_count'; addFixed = Math.max(...unit.map(e => at(e, 4)));
              note = '編組內每有 1 種外團 +30%，最多 2 種';
            } else if (ref.length) {
              kind = 'reference';
              note = '另外取隊上隨機 1 人技能上限的 ' + Math.max(...ref.map(e => at(e, 4))) + '%，實際值看隊伍';
            } else kind = 'score_up';
          } else return null;

          dur = baseEff ? (baseEff.skillEffectDetails || []).slice(-1)[0] : null;
          const baseLv = lvls(baseEff), maxLv = lvls(maxEff);
          const mk = lv => ({ base: at(baseEff, lv), max: at(maxEff, lv) + addFixed });
          return {
            kind, note, add_fixed: addFixed,
            base: at(baseEff, 4), max: at(maxEff, 4) + addFixed,
            duration: dur ? dur.activateEffectDuration : null,
            base_by_level: baseLv,
            max_by_level: maxLv.map(([l, v]) => [l, v + addFixed]),
            at_level: mk,
          };
        };

        const rows = pool.map(c => ({ c, v: val(c) })).filter(x => x.v)
          .sort((x, y) => (y.v.max || 0) - (x.v.max || 0))
          .slice(0, Math.min(30, +a.top || 15));
        return {
          count: rows.length, total_matched: pool.length,
          note: 'skill_base_percent 是保底值,skill_max_percent 是條件拉滿的上限（角色等級型滿級、'
              + '外團型湊滿 2 種、體力型滿血）。數值皆為技能 Lv.4。',
          cards: rows.map(x => ({
            id: x.c.id, name: x.c.prefix, chara: nOf[x.c.characterId] || x.c.characterId,
            rarity: x.c.cardRarityType, attr: x.c.attr, supply: x.c.cardSupplyId,
            skill_kind: x.v.kind, skill_base_percent: x.v.base, skill_max_percent: x.v.max,
            duration_s: x.v.duration, note: x.v.note || undefined,
            base_by_level: x.v.base_by_level, max_by_level: x.v.max_by_level,
          })),
        };
      }

      default: return { error: '未知的工具:' + name };
    }
  },

  /* 能力模塊。27 個工具藏在對話裡等於不存在 —— 使用者不會知道可以問什麼。
     依「想解決什麼問題」分組（不是依工具分），每組給幾個真的會問的句子,
     點了直接填進輸入框。 */
  /* 問題模板。跟 AI_MODULES 的示範問題分開:那些是「照著問就有答案」,
     這裡是「把〔〕裡的東西換成你自己的」—— 教的是怎麼把手上的數字組成一個好問題。
     多數人卡住不是不知道能問什麼,是不知道要一次講清楚哪些條件,
     於是來回問了五輪還沒拿到答案。模板把該給的條件先擺在那裡。 */

  AI_TEMPLATES: [
    { n: '報上身家，一次算完', c: '#4ad1e8', q: [
      '我的 id 是〔ID〕，這期想進 T〔1000〕，幫我算還要跑多久、吃多少體力、大概多少錢',
      '我的 id 是〔ID〕，我現在這隊多少綜合力？換成理論最佳隊能多多少',
      '我的 id 是〔ID〕，用我實際持有的卡，這期最高能湊到幾 % 加成？還缺哪張',
      '我的 id 是〔ID〕，看一下我的生涯紀錄，歷屆最好打到第幾名',
    ] },
    { n: '結算前控分', c: '#ffd94d', q: [
      '我現在〔2847300〕P，想剛好停在〔2850000〕，加成〔300〕%，該怎麼打',
      '還差〔2700〕P 收尾，用最少體力的打法是什麼',
    ] },
    { n: '選曲與吃火', c: '#b8e561', q: [
      '綜合力〔300000〕、加成〔300〕%、技能倍率〔2.5〕，效益曲排行前十給我',
      '同樣條件，時間有限的話該打哪首？跟省體力的選擇差在哪',
      '這組條件下吃 0/1/2/3/5/7/10 火分別多少 P，哪個每火效率最高',
    ] },
    { n: '抽卡決策', c: '#c39df2', q: [
      '我有〔30000〕石，接下來三個月的池該怎麼分配',
      '〔卡池名〕想抽到 PU，期望多少石？天井要多少',
      '幫我模擬抽〔100〕抽〔卡池名〕，大概會抽到什麼',
      '我招募點數還有〔40〕點，付費石〔6000〕，離保底還差多少',
    ] },
    { n: '榜線判讀', c: '#ff9db4', q: [
      '〔8.25〕天的〔WXS〕箱活，T〔1000〕歷史都落在什麼範圍',
      'T〔1000〕這期的時間走勢跟預測終線，可信嗎',
      '這期跟同型態的前五期交叉比對，終線會落在哪、理由是什麼',
    ] },
    { n: '查東西', c: '#f5a3c7', q: [
      '〔曲名〕是哪一期的活動曲？定數跟音符數多少',
      '〔稱號名〕要怎麼拿',
      '站上有沒有〔功能〕？在哪一頁、怎麼用',
      '我缺哪些〔25時〕的〔★4〕？哪些現在還抽得到',
    ] },
    { n: '儲值划算度', c: '#8be0d0', q: [
      '我要湊〔100〕抽，預算〔3000〕元，最省錢的買法是什麼',
      '月卡跟通行證現在買划算嗎？攤提下來一顆石多少錢',
      '官網商店跟 App 同價位差多少',
    ] },
  ],

  AI_MODULES: [
    { id: 'run', n: '跑榜規劃', c: '#4ad1e8',
      d: '算出你該跑多少、還來不來得及、要花多少體力與錢',
      q: ['我的 id 是 　，幫我算這期還要跑多久才追得上 T1000',
          '我現在時速多少？照這個速度最後會落在第幾名',
          '我想進 T500，從現在開始每天要打幾場、要花多少體力',
          '我一天只擠得出兩小時，這樣進得了 T1000 嗎',
          '照我現在的節奏，最後大概會停在哪一段',
          '衝 T100 要花多少錢？值不值得'] },
    { id: 'border', n: '榜線判讀', c: '#ff9db4',
      d: '這期算高還低、預測終線可不可信、跟歷史比如何',
      q: ['這期是什麼型態？跟同型態的歷史比算高還是低',
          'T100 到 T5000 現在各是多少，預測終線分別多少',
          '幫我看最近幾期同型態活動的終線範圍',
          '這期終線會比上期高還是低？理由是什麼',
          '同樣是 6.25 天的箱活，T500 通常落在什麼區間',
          'World Link 這章各段位現在的實測時速是多少'] },
    { id: 'gacha', n: '抽卡決策', c: '#c39df2',
      d: '該不該抽、抽到天井要多少、招募點數還差多少',
      q: ['接下來三個月有哪些池？以我的持卡該抽哪些',
          '我想抽到指定 PU，期望要多少石？天井呢',
          '招募點數的保底怎麼算，我還差多少',
          '我有三萬石，接下來三個月怎麼分配最好',
          'bfes 那期是第幾期？那個池值得抽嗎',
          '常駐池的 50 點保底跟 100 點保底差在哪'] },
    { id: 'deck', n: '編組與加成', c: '#b8e561',
      d: '加成怎麼疊、WL 五色怎麼湊、缺什麼卡',
      q: ['這期我能湊到多少加成？缺什麼',
          'World Link 這章我該怎麼配隊，五色齊了嗎',
          '我的收集率如何？哪個團最缺',
          '我這五張卡的平均技能倍率是多少',
          '同團加成跟角色加成是怎麼疊起來的',
          '再抽到哪一張，我的加成才會再往上跳一階'] },
    { id: 'calc', n: '效率試算', c: '#ffd94d',
      d: '打哪首最划算、單場多少 P、烤森與排位',
      q: ['效益曲排行給我看看',
          '我體力有限，打哪首最省火',
          '時間有限跟體力有限，該打的歌一樣嗎',
          '這樣的加成跑一場多少活動 P，每體力效率多少',
          '烤森採集怎麼配最有效率',
          '排位賽從 Class 3 升到 Class 5 大概要打幾場'] },
    { id: 'site', n: '站台與查詢', c: '#f5a3c7',
      d: '站上有什麼、在哪一頁、名詞是什麼意思',
      q: ['站上有哪些功能是我可能沒用過的',
          '效率排行在哪一頁？怎麼用',
          '余花是哪一期的活動曲',
          '幫我查這首歌的定數跟音符數',
          '控分是什麼？站上有工具嗎',
          '榜線資料庫可以怎麼交叉篩選'] },
    { id: 'deep', n: '深度規劃', c: '#9aa9ff',
      d: '多步驟的複雜問題，它會自己串起需要的資料再回答',
      q: ['我的 id 是 　，幫我算接下來兩期的最佳跑榜隊伍，以及這幾個月該抽哪些池',
          '我現在時速多少、要跑多久、打什麼，才追得上 T500',
          '把這期跟同型態的前五期交叉比對，告訴我終線會落在哪、理由是什麼',
          '以我的持卡和現有石頭，規劃接下來三個月的抽卡與跑榜',
          '我想在半年內進一次 T100，從現在開始該怎麼準備'] },
    { id: 'watch', n: '通知與排程', c: '#8be0d0',
      d: '幫你盯著，條件成立時發站內通知',
      q: ['幫我訂閱：T1000 榜線超過 300 萬時通知我',
          '我訂了哪些通知？最近有觸發嗎',
          '活動結算前 12 小時提醒我',
          '有人超過我的分數時通知我',
          '這期開始跑之前提醒我把加成卡換上'] },
  ],

  AI_SYSTEM: `你是 Project SEKAI 台服資源站的站內助手，服務對象是這個站的管理員與進階玩家。
他們比你更熟遊戲，所以講錯會被當場抓到——寧可說「我查不到」，也不要給一個聽起來合理的數字。

## 查證紀律（最重要）

- **任何具體數字都必須來自工具回傳值。** 不准憑印象、不准從記憶裡拿遊戲數據、
  不准用「大約」「通常」帶過一個你沒查過的量。
- **算完之後回頭對一次。** 把工具回的原始欄位跟你寫出來的數字比對，
  特別是有換算的地方（每小時／每體力／百分比／倍率）。單位換錯是最常見的錯。
- **不確定就再查一次，換個角度查。** 例如榜線預測同時看實測與歷史加權，
  兩者差很多就直接說「這兩種方法差 X%，可信度低」，不要挑一個好看的講。
- **工具能一次給完的，不要拆成多次取樣。** 排行類工具的 limit 最多 100、
  另有 offset 可翻頁，而且它們是拿全曲庫／全期數算完再排序的完整結果。
  用「撈前 20 名再自己拼湊」去代替完整查詢，會得到錯的榜單。
- 送出前自問一次：這段話裡每個數字，我都指得出是哪個工具的哪個欄位嗎？
  指不出來的就刪掉或改成「查不到」。

## 專業判定

使用者要的通常不是一張數字表，而是「所以我該怎麼做」。所以：

- **先給結論與建議**，再用數字支撐。
- **講清楚依據與前提**：是實測還是外推、樣本多少、什麼條件下成立。
- **主動點出風險**：榜線預測是回測過的模型（4 期留一法：主榜平均誤差 5.6%、
  WL 章節 5.9%、前百逐名 11.8%；T100 與前三名仍有一成多，越前面越不準），
  給目標線時要連 P10～P90 區間一起講，並提醒往上抓一成當安全圈。
- **區分保底值與上限值**：技能有 base 與 max 兩種（例如同團型 100／150、
  角色等級型 110／160），講的時候要說清楚是哪一種、要怎樣才拉得滿。
- 資料本身有疑點就直說。例如某段位的樣本只有 3 期、或歷史區間跨度達 3 倍，
  那個中位數就沒有代表性，要講出來而不是照抄。

## 圈內用語（使用者會直接這樣講，你也要聽得懂並跟著用）

車隊與跑榜：
- 車隊／共跑：一起跑活動的固定班底。私車＝熟人房，野房＝隨機湊的房。
- 報跑／報班：向車隊登記某個時段要跑。砍班＝取消已報的班。
- 車頭／P1：房主，站位第一的人，通常負責開房與選曲。站位＝在房內的順位。
- 推車／推隊：專門用來衝分的那一隊（高加成高技能），跟平常玩的隊伍分開。
- 炸房：房間中途解散。跳車：中途離開房間。
- 掛名／還債：掛在房裡不出力，之後補跑還回去。
- 周回：重複打同一首刷分。時速＝每小時能拿多少活動 P。

曲目：
- 蝦＝独りんぼエンヴィー，拍蝦＝打這首刷分。捉迷藏也是常見的刷分曲。
- 長效／效益曲／CP 值曲：單局 pt 高但曲子長，省體力費時間。
  → 問「效益曲排行」「哪首最省體力」「一場拿最多 P」= song_efficiency(sort_by='ep')。
- 短效／效率曲：曲子短，單位時間場次多，周回快但費體力。
  → 問「效率排行」「跑哪首最快」= song_efficiency(sort_by='eph')。
  這兩個是相反的排序,選錯就是答非所問:效益曲要按單局 P 排,不是按每小時排。
- 開闢天地＝初音天地開闢神話，全曲庫活動倍率最高（130%）。
- 魔王曲：難度極高的譜面。

卡片與技能：
- 團分：同團加分卡（技能會依隊上同團人數加成，滿隊 150%）。
- 奶卡：治癒型技能（回體力），分數加成低，放隊長會虧很多。
- 判卡：判定強化型（GREAT 轉 PERFECT 那類）。
- 大分／P分：純分數提升型。s6＝技能第 6 順位（協力場的第 6 次發動）。
- BFES／絢爛慶典、CFES／七彩慶典：兩種 Fes 限定卡池與其限定卡。
- 專精＝特訓後的精進等級（影響活動加成）。

抽卡：
- 綠券＝招募貼紙換的券，粉券＝限定招募貼紙。天井＝300 抽保底。
- 暗鍋：內容物很雜、不指定的池。PU＝pick up，該池主打的卡。

其他：
- 烤森／豆森＝MySekai。控分＝刻意把分數打在特定區間。
- 單裝：只帶一張加成卡的打法。雙開／多開：同時操作多個帳號或裝置。
- AP＝全 PERFECT，FC＝Full Combo。L1／P1 是站位代號。

不確定使用者指的是哪一個時就直接問，不要猜著回答。

**認得一個名詞不等於答得出來 —— 名詞背後如果是站上的某個功能，要實際去算給他看。**
使用者說的往往是圈內叫法,而站上的功能名稱是另一套。你的詞彙表能解釋那個詞的意思,
不代表你回答了他的問題:他問「效益曲排行」要的是一張排行表,不是一句名詞解釋。
先想「站上有沒有哪個工具能產出這個東西」,有就去呼叫它。

**遇到沒見過的專有名詞，一律先 search_anything(q=那個詞)，不要直接回「不知道那是什麼」。**
它會一次搜曲庫、活動、卡片、卡池與教學大全並告訴你那可能是什麼。

**特別注意「某某那期」這種講法**——玩家常拿一個東西去指它所屬的活動期數：
- 講曲名時多半指那首的活動期。search_anything 回傳的 songs[].event 就是答案
  （「余花」→ 余花にみとれて → 第 150 期）。
- 講 bfes／cfes／絢爛慶典 時,指的是那種池伴生的活動期,回傳的 gachas[].event 就是。
  這類池有很多期,不要自己挑一期,要把命中的期數列出來問使用者是哪一次。
所以看到 event 欄位就直接拿它回答,不要只回一首歌或一個池就交差。

為什麼一定要查：玩家講的幾乎都是簡稱或圈內叫法，而站上存的是正式名稱。
「余花」＝余花にみとれて、「蝦」＝独りんぼエンヴィー、「開闢天地」＝初音天地開闢神話。
你沒見過那個詞，不代表站上沒有——多半只是名字不一樣。

查完之後：
- 命中一個 → 直接用，順帶告訴使用者你理解成哪一個。
- 命中多個 → 列出來問使用者指的是哪個，不要自己挑。
- 完全沒命中 → 才說查不到，並問那是什麼。回傳的 near_misses 只是字元層級的
  近似候選，不可以當成答案講出去。

## 其他

- 講玩法、規則、名詞先 search_tutorial，引用站上既有的說法，保持一致。
- 站上的活動、榜線、卡池資料都是從官方 API 抓的，站方不能編輯——
  看到奇怪的值不要叫使用者去後台修改，那種頁面不存在，直接說明數字看起來異常即可。
- 你只能呼叫工具清單裡的工具。沒有工具能做到的事就直說做不到，不要繞路猜。
- 用繁體中文，結論先講，再用條列或表格展開。不要用 emoji。`,

  /* 對話存檔。原本對話只活在 state 裡,重新整理就沒了。
     存檔時只送「還沒存過的」那幾則 —— 一輪對話會產生 assistant／tool_result
     好幾則訊息,每次整串重送會讓 D1 塞進大量重複內容。 */

  async loadChats() {
    try { const d = await this.api('/api/chats'); this.setState({ chatList: (d && d.chats) || [] }); }
    catch (e) { this.setState({ chatList: [] }); }
  },

  async saveChat() {
    const msgs = this.state.aiMsgs || [];
    const saved = this._savedN || 0;
    const fresh = msgs.slice(saved);
    if (!fresh.length) return;
    const pack = fresh.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }));
    try {
      if (!this.state.chatId) {
        const d = await this.api('/api/chats', { method: 'POST', body: { messages: pack } });
        if (d && d.chat) { this.setState({ chatId: d.chat.id }); this._savedN = msgs.length; this.loadChats(); }
      } else {
        await this.api('/api/chats/' + encodeURIComponent(this.state.chatId) + '/messages', { method: 'POST', body: { messages: pack } });
        this._savedN = msgs.length;
        this.loadChats();
      }
    } catch (e) { /* 存檔失敗不該打斷對話,下一輪會再試 */ }
  },

  async openChat(id) {
    try {
      const d = await this.api('/api/chats/' + encodeURIComponent(id));
      const ms = ((d && d.chat && d.chat.messages) || []).map(m => {
        let c = m.content;
        // content 存的是 JSON 字串(助手訊息含 tool_use 區塊),能解就解回陣列
        if (typeof c === 'string' && (c.startsWith('[') || c.startsWith('{'))) { try { c = JSON.parse(c); } catch (e) {} }
        return { role: m.role, content: c };
      });
      this._savedN = ms.length;
      this.setState({ aiMsgs: ms, chatId: id, aiErr: '' });
    } catch (e) { this.setState({ aiErr: '載入對話失敗' }); }
  },

  async deleteChat(id) {
    try { await this.api('/api/chats/' + encodeURIComponent(id), { method: 'DELETE' });
          if (this.state.chatId === id) { this._savedN = 0; this.setState({ aiMsgs: [], chatId: null }); }
          this.loadChats(); } catch (e) {}
  },

  newChat() { this._savedN = 0; this.setState({ aiMsgs: [], chatId: null, aiErr: '' }); },

  setAiDual(on) {
    const v = !!on;
    try { localStorage.setItem('sekai-ai-dual', v ? '1' : '0'); } catch (e) {}
    this.setState({ aiDual: v });
  },

  /* 從 /api/chat 的回應裡挑出某個工具的輸出。
     雙路模式下 results[] 會有兩家的答案,這時用 validate 決定採用誰:
     兩家都過就用主路的,只有一家過就用那家,都沒過就回主路的讓上層報錯。
     回傳 { input, provider, agreed } —— agreed 給 UI 標示「兩家講的一樣嗎」。 */

  aiPickLane(r, toolName, validate) {
    const grab = (content) => {
      const u = ((content) || []).find(c => c.type === 'tool_use' && c.name === toolName);
      return (u && u.input) || null;
    };
    const ok = (x) => { try { return !!x && (!validate || validate(x)); } catch (e) { return false; } };
    const lanes = ((r && r.results) || []).filter(l => l && l.ok)
      .map(l => ({ provider: l.provider, input: grab(l.content) }));
    if (!lanes.length) {
      const input = grab(r && r.content);
      return { input, provider: (r && r.model) || '', agreed: null };
    }
    const good = lanes.filter(l => ok(l.input));
    const pick = good[0] || lanes[0];
    let agreed = null;
    if (lanes.length > 1) {
      try { agreed = JSON.stringify(lanes[0].input) === JSON.stringify(lanes[1].input); } catch (e) { agreed = null; }
    }
    return { input: pick.input, provider: pick.provider, agreed, lanes };
  },

  /* 對話迴圈:模型要工具就在瀏覽器執行,把結果送回,直到它給出文字結論。
     上限 12 輪是防呆 —— 正常的複雜任務大約 3～6 輪,跑到 12 通常代表它卡住了。 */

  async aiSend(text) {
    const q = String(text || '').trim();
    if (!q || this.state.admBusy) return;
    let cur = (this.state.aiMsgs || []).concat([{ role: 'user', content: q }]);
    this.setState({ aiMsgs: cur, admBusy: true, admAsk: '', aiErr: '' });
    try {
      const op = await this.aiOpStart('chat');
      for (let guard = 0; guard < 12; guard++) {
        const r = await this.api('/api/chat', { method: 'POST', body: {
          messages: cur, tools: this.AI_TOOLS, system: this.AI_SYSTEM, op,
          dual: !!this.state.aiDual } });
        if (r && r.quota) this.setState({ aiQuota: r.quota });
        const content = (r && r.content) || [];
        /* 只有主路的工具會真的執行。aiRun 裡的 set_my_uid／schedule_task 有副作用,
           兩路各跑一次會寫兩份。副路只取它的文字結論拿來對照。 */
        const alt = (() => {
          const ls = (r && r.results) || [];
          if (ls.length < 2) return null;
          const sec = ls.find(l => l.model !== r.model) || ls[1];
          if (!sec) return null;
          if (!sec.ok) return { provider: sec.provider, err: sec.error };
          const t = (sec.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
          return t ? { provider: sec.provider, text: t } : null;
        })();
        const amsg = { role: 'assistant', content };
        if (alt) amsg._alt = alt;
        cur = cur.concat([amsg]);
        this.setState({ aiMsgs: cur });
        const calls = content.filter(c => c.type === 'tool_use');
        if (!calls.length) break;
        const results = [];
        for (const c of calls) {
          let out;
          try { out = await this.aiRun(c.name, c.input); }
          catch (e) { out = { error: (e && e.message) || String(e) }; }
          results.push({ type: 'tool_result', tool_use_id: c.id,
                         content: JSON.stringify(out).slice(0, 24000) });
        }
        cur = cur.concat([{ role: 'user', content: results }]);
        this.setState({ aiMsgs: cur });
      }
    } catch (e) {
      this.setState({ aiErr: (e && e.message) || '呼叫失敗' });
    } finally {
      this.setState({ admBusy: false });
      if (this.state.me && this.state.me.status === 'approved') this.saveChat();
    }
  },

  /* 沒有畫面的助手迴圈：給提問所「請助手回答」用。
     跟 aiSend 同一套工具與 system，但對話留在區域變數，不動助手頁的 aiMsgs。
     回傳最後一則助手訊息裡的文字；查不到就回空字串。 */

  async aiAsk(question) {
    const q = String(question || '').trim();
    if (!q) return '';
    let cur = [{ role: 'user', content: q }];
    let text = '';
    const op = await this.aiOpStart('qa');
    for (let guard = 0; guard < 12; guard++) {
      const r = await this.api('/api/chat', { method: 'POST', body: {
        messages: cur, tools: this.AI_TOOLS, system: this.AI_SYSTEM, op,
        dual: !!this.state.aiDual } });
      if (r && r.quota) this.setState({ aiQuota: r.quota });
      const content = (r && r.content) || [];
      cur = cur.concat([{ role: 'assistant', content }]);
      text = content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim() || text;
      const calls = content.filter(c => c.type === 'tool_use');
      if (!calls.length) break;
      const results = [];
      for (const c of calls) {
        let out;
        try { out = await this.aiRun(c.name, c.input); } catch (e) { out = { error: (e && e.message) || String(e) }; }
        results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out).slice(0, 24000) });
      }
      cur = cur.concat([{ role: 'user', content: results }]);
    }
    return text;
  },
  };
}
