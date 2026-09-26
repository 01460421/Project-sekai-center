/* 功能模組看到的世界。介接層（Discord、測試用假物件）各自實作 reply/update/followUp 等方法，
   功能本身不知道底下是誰。 */

export class Ctx {
  constructor(o) {
    this.bot = o.bot;
    this.user = o.user;                       // { id, name, avatar }
    this.guildId = o.guildId || 'dm';
    this.guildName = o.guildName || '';
    this.channelId = o.channelId || '';
    this.member = o.member || { roles: [], admin: false, voiceMembers: [] };
    this.interactionId = o.interactionId || String(Date.now());
    this.locale = o.locale || 'zh-TW';
    this._opts = o.options || {};
    this.sub = o.sub || '';                   // 子指令名稱
    // 元件互動才有：
    this.customId = o.customId || '';
    this.action = o.action || '';
    this.data = o.data || [];                 // custom_id 以 : 切開後的資料段
    this.values = o.values || [];             // 選單選到的值
    this.fields = o.fields || {};             // modal 欄位
    this.message = o.message || null;         // 元件所在訊息（content/embeds/components）
    this._io = o.io;                          // { reply, update, followUp, defer, showModal, edit, fetchMembers }
    this.replied = false;
  }
  opt(name, dflt) { const v = this._opts[name]; return v === undefined ? dflt : v; }
  get store() { return this.bot.store; }
  get rng() { return this.bot.rng; }
  /* 目前伺服器的玩家紀錄（預設自己） */
  u(id = this.user.id) { return this.store.user(this.guildId, id); }
  g() { return this.store.guild(this.guildId); }
  get settings() { return this.g().settings; }
  get currency() { return this.settings.currency || '水晶'; }

  async reply(msg) { this.replied = true; return this._io.reply(norm(msg)); }
  async update(msg) { this.replied = true; return this._io.update(norm(msg)); }
  async followUp(msg) { return this._io.followUp(norm(msg)); }
  async edit(msg) { return this._io.edit(norm(msg)); }
  /* 先告訴 Discord「稍等」（要花超過 3 秒時用），之後用 edit() 補結果 */
  async defer(ephemeral = false) { this.replied = true; return this._io.defer(ephemeral); }
  async showModal(m) { this.replied = true; return this._io.showModal(m); }
  /* 之後（例如倒數結束）主動送訊息到頻道 */
  async send(channelId, msg) { return this.bot.send(channelId, norm(msg)); }
  /* 選用的 AI 解讀；未設定金鑰時回空字串 */
  async ai(prompt, opts) { return this.bot.ai ? this.bot.ai.narrate(prompt, { userId: this.user.id, ...opts }) : ''; }
  /* 只有自己能按：檢查按鈕擁有者 */
  isOwner(uid) { return String(uid) === String(this.user.id); }
  /* 伺服器成員（快取內的），[{ id, name, bot }] */
  async members() { return this._io.members ? this._io.members() : []; }
}

export function norm(msg) {
  if (typeof msg === 'string') return { content: msg };
  return msg || {};
}
