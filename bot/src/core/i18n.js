/* 斜線指令的中文名稱。
   程式內部（功能物件、custom_id、測試、AI 的 run_command 工具）一律用英文 id；註冊到 Discord 時把 name 換成中文，
   英文 id 放進 name_localizations（英文介面的使用者看到英文名），收到互動時再把中文換回英文 id。
   Discord 指令名稱允許 Unicode 字母與數字（不能有空白與符號），子指令與參數名稱同樣規則。
   COMMAND_LANG=en 可以改回註冊英文名（registrationJSON 的 lang 參數）。

   格式：en: [中文名, 參數表]；有子指令的功能，參數表的值是 [中文子指令名, 參數表]。 */

export const ZH = {
  // 🔮 占卜算命
  tarot: ['塔羅', { spread: '牌陣', question: '問題' }],
  horoscope: ['星座運勢', { sign: '星座' }],
  zodiac: ['生肖運勢', { year: '出生年', animal: '生肖' }],
  iching: ['易經', { question: '問題' }],
  omikuji: ['御神籤'],
  numerology: ['生命靈數', { birthday: '生日' }],
  runes: ['盧恩', { count: '數量', question: '問題' }],
  almanac: ['今日宜忌'],
  dream: ['解夢', { text: '夢境' }],
  birthchart: ['生日解析', { birthday: '生日' }],
  fortunecookie: ['幸運餅乾'],
  astrodice: ['占星骰', { question: '問題' }],
  // 🧠 性格測驗
  mbti: ['mbti', { test: ['測驗'], type: ['查詢', { type: '類型' }], match: ['配對', { a: '第一型', b: '第二型' }] }],
  bigfive: ['五大人格'],
  lovestyle: ['戀愛類型'],
  animal: ['靈魂動物'],
  color: ['色彩心理'],
  brain: ['左右腦'],
  enneagram: ['九型人格'],
  psytest: ['心理測驗'],
  stress: ['壓力指數'],
  bloodtype: ['血型', { type: '血型', with: '配對血型' }],
  // 💞 社交互動
  ship: ['配對', { a: '第一位', b: '第二位' }],
  zodiacmatch: ['星座配對', { a: '星座一', b: '星座二' }],
  namematch: ['姓名配對', { a: '名字一', b: '名字二' }],
  marry: ['結婚', { propose: ['求婚', { user: '對象' }], status: ['狀態', { user: '對象' }], divorce: ['離婚'] }],
  profile: ['個人檔案', { user: '對象' }],
  interact: ['互動', { action: '動作', user: '對象' }],
  rep: ['聲望', { user: '對象' }],
  birthday: ['生日', { set: ['登記', { date: '日期' }], today: ['今日壽星'], upcoming: ['即將到來'], remove: ['移除'] }],
  afk: ['離開', { reason: '原因' }],
  confess: ['匿名留言', { text: '內容' }],
  title: ['稱號'],
  // 🎮 小遊戲
  guess: ['猜數字', { start: ['開始', { max: '上限' }], try: ['猜', { number: '數字' }], giveup: ['放棄'] }],
  rps: ['剪刀石頭布', { opponent: '對手' }],
  tictactoe: ['井字遊戲', { opponent: '對手' }],
  connect4: ['四子棋', { opponent: '對手' }],
  blackjack: ['21點', { bet: '押注' }],
  slots: ['拉霸', { bet: '押注' }],
  hilo: ['比大小', { bet: '押注' }],
  minesweeper: ['踩地雷'],
  memory: ['翻牌記憶'],
  hangman: ['猜單字'],
  wordle: ['wordle'],
  reaction: ['反應速度'],
  // 🎉 趣味
  eightball: ['八號球', { question: '問題' }],
  choose: ['幫我選', { options: '選項' }],
  dice: ['擲骰', { expr: '骰子' }],
  coin: ['硬幣', { count: '數量' }],
  poll: ['投票', { question: '問題', options: '選項' }],
  wyr: ['你寧願'],
  truthdare: ['真心話大冒險', { kind: '種類', user: '對象' }],
  rate: ['評分', { thing: '東西' }],
  topic: ['話題'],
  someone: ['隨機點名', { text: '想說的話' }],
  wordchain: ['文字接龍', { start: ['開始', { word: '起始詞' }], play: ['接', { word: '詞' }], status: ['狀態'], end: ['結束'] }],
  story: ['故事接龍', { start: ['開始', { opening: '開頭' }], add: ['接一句', { sentence: '句子' }], show: ['查看'], end: ['結束'] }],
  // 💎 經濟
  daily: ['簽到'],
  balance: ['餘額', { user: '對象' }],
  pay: ['轉帳', { user: '對象', amount: '金額' }],
  work: ['打工'],
  shop: ['商店'],
  inventory: ['背包', { list: ['查看'], use: ['使用', { item: '道具' }], give: ['送禮', { user: '對象', item: '禮物' }] }],
  richlist: ['富豪榜'],
  bet: ['押注', { amount: '金額', side: '正反面' }],
  lottery: ['樂透', { buy: ['購買', { count: '張數' }], info: ['資訊'], draw: ['開獎'] }],
  bank: ['銀行', { deposit: ['存款', { amount: '金額' }], withdraw: ['提款', { amount: '金額' }], info: ['帳戶'] }],
  // 🎰 轉蛋收藏
  gacha: ['轉蛋', { mode: '模式' }],
  collection: ['圖鑑', { chara: '角色', user: '對象' }],
  pity: ['天井'],
  gachastats: ['抽卡統計', { user: '對象' }],
  trade: ['交換', { user: '對象', card: '卡片' }],
  wishlist: ['願望單', { chara: '角色', oshi: '設為推し' }],
  gachalist: ['卡池情報'],
  // 🎵 問答與音樂
  quiz: ['問答', { kind: '題型' }],
  songquiz: ['猜歌'],
  charaquiz: ['猜角色'],
  speedquiz: ['搶答', { kind: '題型' }],
  quizrank: ['問答排行'],
  song: ['歌曲', { title: '歌名' }],
  randomsong: ['隨機選曲', { diff: '難度', min: '最低等級', max: '最高等級' }],
  setlist: ['歌單', { count: '首數', diff: '難度', min: '最低等級', max: '最高等級' }],
  songbattle: ['歌曲對決'],
  event: ['活動'],
  // 🏆 等級與社群
  rank: ['等級', { user: '對象' }],
  leaderboard: ['排行榜', { by: '依據' }],
  achievements: ['成就', { user: '對象' }],
  quest: ['每日任務'],
  streak: ['簽到紀錄', { user: '對象' }],
  raffle: ['抽獎', { prize: '獎品', winners: '人數', minutes: '分鐘' }],
  team: ['分組', { groups: '組數', names: '名單' }],
  remind: ['提醒', { set: ['新增', { minutes: '分鐘', text: '內容' }], list: ['查看'], clear: ['清除'] }],
  countdown: ['倒數', { seconds: '秒數', label: '名稱' }],
  counter: ['計數器', { name: '名稱', set: '設定' }],
  // ⚙️ 伺服器
  welcome: ['歡迎訊息', { set: ['設定', { channel: '頻道', text: '內容' }], off: ['關閉'], test: ['測試'] }],
  autoreact: ['自動反應', { add: ['新增', { keyword: '關鍵字', emoji: '表情' }], remove: ['移除', { keyword: '關鍵字' }], list: ['查看'] }],
  help: ['說明', { category: '分類' }],
  settings: ['設定', { show: ['查看'], xp: ['經驗值', { enabled: '開啟' }], currency: ['貨幣', { name: '名稱' }], quizreward: ['問答獎勵', { amount: '金額' }], ai: ['ai', { enabled: '開啟', style: '風格', name: '名字', persona: '人設' }], channel: ['頻道', { action: '動作', channel: '頻道' }] }],
  botstats: ['機器人統計'],
  // 🤖 AI 對話
  chat: ['聊天', { text: '內容' }],
};

/* Discord 對指令／子指令／參數名稱的規則：1～32 字，只能是字母、數字、- 與 _，有大小寫的字母要用小寫 */
export const NAME_RE = /^[-_\p{L}\p{N}]{1,32}$/u;
export const validName = s => NAME_RE.test(s) && s === s.toLowerCase();

const table = cmd => (ZH[cmd] && ZH[cmd][1]) || {};
export const zhName = cmd => (ZH[cmd] ? ZH[cmd][0] : cmd);
export function zhSub(cmd, sub) { const t = table(cmd)[sub]; return Array.isArray(t) ? t[0] : sub; }
export function zhOpt(cmd, sub, opt) {
  const t = table(cmd);
  const opts = sub ? (Array.isArray(t[sub]) ? t[sub][1] : null) : t;
  const z = opts && opts[opt];
  return typeof z === 'string' ? z : opt;
}

/* 反查表（中文 → 英文 id），啟動時建一次 */
const REV = { cmd: new Map(), sub: new Map(), opt: new Map() };
for (const [en, [zh, t]] of Object.entries(ZH)) {
  REV.cmd.set(zh, en);
  for (const [k, v] of Object.entries(t || {})) {
    if (Array.isArray(v)) {
      REV.sub.set(`${en}:${v[0]}`, k);
      for (const [ok, oz] of Object.entries(v[1] || {})) REV.opt.set(`${en}:${k}:${oz}`, ok);
    } else REV.opt.set(`${en}::${v}`, k);
  }
}
export const toEnCommand = name => REV.cmd.get(name) || name;
export const toEnSub = (cmd, name) => REV.sub.get(`${cmd}:${name}`) || name;
export const toEnOpt = (cmd, sub, name) => REV.opt.get(`${cmd}:${sub || ''}:${name}`) || name;

/* 把一個 Discord 指令 JSON（英文 id）換成中文名稱，英文 id 放進 name_localizations */
const loc = en => ({ 'en-US': en, 'en-GB': en });
export function localizeCommand(c) {
  const en = c.name; const zh = zhName(en);
  const out = { ...c, name: zh };
  if (zh !== en) out.name_localizations = loc(en);
  if (c.options) out.options = c.options.map(o => localizeOption(en, '', o));
  return out;
}
function localizeOption(cmd, sub, o) {
  if (o.type === 1) {
    const zh = zhSub(cmd, o.name); const out = { ...o, name: zh };
    if (zh !== o.name) out.name_localizations = loc(o.name);
    if (o.options) out.options = o.options.map(p => localizeOption(cmd, o.name, p));
    return out;
  }
  const zh = zhOpt(cmd, sub, o.name); const out = { ...o, name: zh };
  if (zh !== o.name) out.name_localizations = loc(o.name);
  return out;
}

/* 訊息裡的指令提示（例如「先用 /guess start」「/settings ai enabled:true」）換成使用者實際看到的中文名。
   只換清單裡有的指令；前面是字母、數字、/、: 等（網址、路徑、分數）的不動。 */
const HINT_RE = /(^|[^\p{L}\p{N}_/:.@#<&-])\/([a-z][a-z0-9_-]*)((?: [a-z][a-z0-9_-]*(?::[^\s]*)?)*)/gu;
export function localizeHints(text) {
  if (typeof text !== 'string' || !text.includes('/')) return text;
  return text.replace(HINT_RE, (m, pre, cmd, rest) => {
    if (!ZH[cmd]) return m;
    let out = `${pre}/${zhName(cmd)}`; let sub = ''; let stop = false;
    const words = rest ? rest.trim().split(' ').filter(Boolean) : [];
    for (const w of words) {
      if (stop) { out += ' ' + w; continue; }
      const i = w.indexOf(':');
      if (i > 0) { const opt = w.slice(0, i); const z = zhOpt(cmd, sub, opt); if (z === opt && !isOpt(cmd, sub, opt)) { stop = true; out += ' ' + w; } else out += ` ${z}${w.slice(i)}`; continue; }
      if (!sub && isSub(cmd, w)) { sub = w; out += ' ' + zhSub(cmd, w); continue; }
      stop = true; out += ' ' + w;   // 不是這個指令的子指令：後面的字照抄
    }
    return out;
  });
}
function isSub(cmd, sub) { return Array.isArray(table(cmd)[sub]); }
function isOpt(cmd, sub, opt) { const t = table(cmd); const opts = sub ? (Array.isArray(t[sub]) ? t[sub][1] : null) : t; return !!(opts && typeof opts[opt] === 'string'); }
export function localizeMessage(msg) {
  if (!msg || typeof msg !== 'object') return msg;
  if (typeof msg.content === 'string') msg.content = localizeHints(msg.content);
  for (const e of msg.embeds || []) {
    if (typeof e.title === 'string') e.title = localizeHints(e.title);
    if (typeof e.description === 'string') e.description = localizeHints(e.description);
    for (const f of e.fields || []) { if (typeof f.name === 'string') f.name = localizeHints(f.name); if (typeof f.value === 'string') f.value = localizeHints(f.value); }
    if (e.footer && typeof e.footer.text === 'string') e.footer.text = localizeHints(e.footer.text);
  }
  return msg;
}
