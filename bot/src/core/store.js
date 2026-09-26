/* 持久化：一個 JSON 檔，記憶體內操作、延遲寫回、原子換檔。
   規模上百個伺服器、數萬使用者都還撐得住；要再大再換 SQLite，介面不必動。

   資料形狀：
     users[gid:uid]  每個伺服器各自一份的玩家紀錄（水晶、等級、圖鑑…）
     guilds[gid]     伺服器設定與共用狀態（投票、抽獎、計數器…）
     global[key]     跨伺服器（提醒排程、統計） */

import fs from 'node:fs';
import path from 'node:path';

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
});

export const GUILD_DEFAULTS = () => ({
  settings: { xp: true, currency: '水晶', quizReward: 15, welcomeChannel: '', welcomeText: '', autoreact: {}, starboard: { channel: '', min: 3 } },
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

export class FileStore extends MemoryStore {
  constructor(file, { debounceMs = 5000 } = {}) {
    super();
    this.file = file;
    this.debounceMs = debounceMs;
    this._timer = null;
    this.load();
  }
  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const d = JSON.parse(raw);
      this.data = { users: d.users || {}, guilds: d.guilds || {}, global: d.global || {} };
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('[store] 讀取失敗，改用空資料:', e.message);
    }
  }
  /* 有改動就排一次延遲寫入；連續操作只會寫一次 */
  touch() {
    this.dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.save().catch(e => console.error('[store] 寫入失敗:', e.message)); }, this.debounceMs);
    if (this._timer.unref) this._timer.unref();
  }
  user(gid, uid) { const u = super.user(gid, uid); this.touch(); return u; }
  guild(gid) { const g = super.guild(gid); this.touch(); return g; }
  global(k, init) { const v = super.global(k, init); this.touch(); return v; }
  async save() {
    if (!this.dirty) return;
    this.dirty = false;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(this.data));
    await fs.promises.rename(tmp, this.file);
  }
  async close() { if (this._timer) { clearTimeout(this._timer); this._timer = null; } await this.save(); }
}
