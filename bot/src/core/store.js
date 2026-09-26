/* 持久化的記憶體層：所有讀寫都在記憶體內完成，實際落地由子類別決定
   （store-file.js 寫 JSON 檔；worker.js 的 DOStore 寫 Durable Object storage）。

   資料形狀：
     users[gid:uid]  每個伺服器各自一份的玩家紀錄（水晶、等級、圖鑑…）
     guilds[gid]     伺服器設定與共用狀態（投票、抽獎、計數器…）
     global[key]     跨伺服器（提醒排程、統計） */

export const USER_DEFAULTS = () => ({
  crystals: 0, bank: 0, xp: 0, messages: 0,
  streak: 0, lastDaily: '', lastWork: 0, rep: 0, repGiven: {},
  oshi: null, title: '', titles: [], items: {},
  cards: {}, pulls: 0, pulls4: 0, sinceLast4: 0, wish: null, bestStreak4: 0,
  quiz: { pts: 0, right: 0, wrong: 0 },
  games: { played: 0, won: 0 },
  achievements: [], badges: [],
  birthday: '', marriedTo: null, marriedAt: '', afk: null,
  quests: { date: '', done: {} , claimed: false },
  weekly: { week: '', msgs: 0, games: 0 },
  interact: {}, mbti: '', enneagram: 0, bloodType: '',
  tickets: 0, lastSeen: 0, created: Date.now(),
  guess: null,   // 進行中的猜數字 { n, max, tries }（放紀錄裡，Workers 版才不會因 DO 休眠而消失）
  chat: null,    // /chat 的對話記憶 { log: [{ r:'u'|'a', t, at }], at }
});

export const GUILD_DEFAULTS = () => ({
  settings: { xp: true, currency: '水晶', quizReward: 15, welcomeChannel: '', welcomeText: '', autoreact: {}, starboard: { channel: '', min: 3 }, ai: { enabled: true, style: 'lively', persona: '', name: '' } },
  polls: {}, raffles: {}, counters: {}, stories: {}, chains: {}, lottery: { pot: 0, tickets: {}, round: 1 }, lfg: {},
  stats: { commands: 0, byCommand: {} },
});

export class MemoryStore {
  constructor() { this.data = { users: {}, guilds: {}, global: {} }; this.dirty = false; }

  user(gid, uid) {
    const k = `${gid}:${uid}`;
    let u = this.data.users[k];
    if (!u) { u = USER_DEFAULTS(); this.data.users[k] = u; }
    else {
      // 舊紀錄補上新欄位
      const d = USER_DEFAULTS();
      for (const key of Object.keys(d)) if (u[key] === undefined) u[key] = d[key];
    }
    this.dirty = true;
    return u;
  }
  /* 列出某伺服器所有玩家 [{uid, rec}] */
  users(gid) {
    const out = [];
    const pre = `${gid}:`;
    for (const k of Object.keys(this.data.users)) if (k.startsWith(pre)) out.push({ uid: k.slice(pre.length), rec: this.data.users[k] });
    return out;
  }
  guild(gid) {
    let g = this.data.guilds[gid];
    if (!g) { g = GUILD_DEFAULTS(); this.data.guilds[gid] = g; }
    else {
      const d = GUILD_DEFAULTS();
      for (const key of Object.keys(d)) if (g[key] === undefined) g[key] = d[key];
      for (const key of Object.keys(d.settings)) if (g.settings[key] === undefined) g.settings[key] = d.settings[key];
    }
    this.dirty = true;
    return g;
  }
  global(key, init) {
    if (this.data.global[key] === undefined) this.data.global[key] = typeof init === 'function' ? init() : (init ?? {});
    this.dirty = true;
    return this.data.global[key];
  }
  touch() { this.dirty = true; }
  async save() { this.dirty = false; }
  async close() {}
}
