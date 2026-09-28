/* 機器人核心：跟平台無關。介接層（Discord）把事件轉成這裡的呼叫；測試直接呼叫。 */

import { Ctx } from './ctx.js';
import { Registry } from './registry.js';
import { Sessions, Cooldowns, Timers } from './sessions.js';
import { MemoryStore } from './store.js';
import { Rng } from './rng.js';
import { parseCid, todayTW, weekTW } from './ui.js';
import FEATURES from '../features/index.js';

export class Bot {
  constructor({ registry, store, rng, timers, ai, send, log } = {}) {
    this.registry = registry || new Registry();
    this.store = store || new MemoryStore();
    this.rng = rng || new Rng();
    this.timers = timers || new Timers();
    this.sessions = new Sessions();
    this.cooldowns = new Cooldowns();
    this.ai = ai || null;
    this._send = send || (async () => {});
    this.log = log || ((...a) => console.log('[bot]', ...a));
    this.stats = { started: Date.now(), commands: 0, components: 0, errors: 0, byCommand: {} };
    this.guildCount = 0;
    this.userCount = 0;
  }
  static defaultRegistry() { return Registry.fromList(FEATURES); }
  static async create(opts = {}) {
    return new Bot({ ...opts, registry: opts.registry || Bot.defaultRegistry() });
  }
  async send(channelId, msg) { return this._send(channelId, msg); }

  /* ---- 指令 ---- */
  async runCommand(input) {
    const f = this.registry.get(input.name);
    if (!f) return input.io.reply({ content: '找不到這個指令，可能還沒重新註冊。', ephemeral: true });
    const ctx = new Ctx({ ...input, bot: this });
    if (f.guildOnly !== false && ctx.guildId === 'dm') return ctx.reply({ content: '這個功能只能在伺服器裡使用。', ephemeral: true });
    if (f.admin && !ctx.member.admin) return ctx.reply({ content: '需要「管理伺服器」權限。', ephemeral: true });
    if (!f.admin && !this.channelAllowed(ctx.guildId, ctx.channelId)) return ctx.reply({ content: this.channelHint(ctx.guildId), ephemeral: true });
    if (f.cooldown) {
      const left = this.cooldowns.hit(`${f.name}:${ctx.guildId}:${ctx.user.id}`, f.cooldown);
      if (left) return ctx.reply({ content: `冷卻中，還要 ${left} 秒。`, ephemeral: true });
    }
    this.stats.commands++;
    this.stats.byCommand[f.name] = (this.stats.byCommand[f.name] || 0) + 1;
    if (ctx.guildId !== 'dm') {
      const g = ctx.g(); g.stats.commands++; g.stats.byCommand[f.name] = (g.stats.byCommand[f.name] || 0) + 1;
      this.trackActivity(ctx);
    }
    try {
      await f.run(ctx);
      if (!ctx.replied) await ctx.reply({ content: '（這個功能沒有回應任何內容）', ephemeral: true });
    } catch (e) {
      this.stats.errors++;
      this.log(`指令 ${f.name} 出錯:`, e);
      const msg = { content: '出了點問題：' + String(e.message || e).slice(0, 200), ephemeral: true };
      try { await (ctx.replied ? ctx.followUp(msg) : ctx.reply(msg)); } catch {}
    }
    return ctx;
  }

  /* ---- 元件（按鈕／選單／modal） ---- */
  async runComponent(kind, input) {
    const { feature, action, data } = parseCid(input.customId);
    const f = this.registry.get(feature);
    const table = f && (kind === 'button' ? f.buttons : kind === 'select' ? f.selects : f.modals);
    const handler = table && table[action];
    const ctx = new Ctx({ ...input, bot: this, action, data });
    if (!handler) return ctx.reply({ content: '這個按鈕已經失效了。', ephemeral: true });
    if (!f.admin && !this.channelAllowed(ctx.guildId, ctx.channelId)) return ctx.reply({ content: this.channelHint(ctx.guildId), ephemeral: true });
    this.stats.components++;
    try {
      await handler(ctx);
      if (!ctx.replied) await ctx.defer();   // 沒回應就默默確認，避免 Discord 顯示「互動失敗」
    } catch (e) {
      this.stats.errors++;
      this.log(`元件 ${feature}:${action} 出錯:`, e);
      try { await (ctx.replied ? ctx.followUp : ctx.reply).call(ctx, { content: '出了點問題：' + String(e.message || e).slice(0, 200), ephemeral: true }); } catch {}
    }
    return ctx;
  }

  async runAutocomplete(input) {
    const f = this.registry.get(input.name);
    if (!f || !f.autocomplete) return [];
    try {
      const ctx = new Ctx({ ...input, bot: this });
      const list = await f.autocomplete(ctx, input.focused);
      return (list || []).slice(0, 25).map(x => ({ name: String(x.name).slice(0, 100), value: String(x.value).slice(0, 100) }));
    } catch (e) { this.log('autocomplete 出錯:', e); return []; }
  }

  /* ---- 固定頻道：管理員用 /settings channel 限制機器人只在哪些頻道回應（管理員指令不受限） ---- */
  allowedChannels(gid) { return gid === 'dm' ? [] : (this.store.guild(gid).settings.channels || []); }
  channelAllowed(gid, cid) { const list = this.allowedChannels(gid); return !list.length || list.includes(String(cid)); }
  channelHint(gid) { return `這個機器人只在 ${this.allowedChannels(gid).map(id => `<#${id}>`).join('、')} 回應。`; }

  /* ---- 被動事件：功能模組可提供 events.messageCreate / memberJoin / reactionAdd ---- */
  async emit(event, payload) {
    if (event === 'messageCreate' && payload && payload.guildId && !this.channelAllowed(payload.guildId, payload.channelId)) {
      // 不在固定頻道：經驗值照算，但機器人不說話、不加反應（/chat 的被動回話會自己看 allowed）
      payload.allowed = false; payload.reply = async () => {}; payload.react = async () => {};
    }
    for (const f of this.registry.features) {
      const h = f.events && f.events[event];
      if (!h) continue;
      try { await h(this, payload); } catch (e) { this.stats.errors++; this.log(`事件 ${event} @ ${f.name} 出錯:`, e); }
    }
  }
  /* 排程：每 30 秒由介接層呼叫一次；功能模組可提供 tick(bot, now) */
  async tick(now = Date.now()) {
    for (const f of this.registry.features) {
      if (!f.tick) continue;
      try { await f.tick(this, now); } catch (e) { this.stats.errors++; this.log(`tick @ ${f.name} 出錯:`, e); }
    }
    this.sessions.sweep();
  }

  /* 每次使用指令都順手記錄活躍度（每週統計、每日任務用），並給一點經驗值：
     Workers 版沒有 Gateway、收不到聊天訊息，等級就靠這個累積。 */
  trackActivity(ctx) {
    const u = ctx.u();
    const now = Date.now();
    if (now - (u.lastCmdXp || 0) > 60e3 && ctx.settings.xp !== false) { u.lastCmdXp = now; u.xp += u.xpBoostUntil > now ? 16 : 8; }
    u.lastSeen = now;
    const wk = weekTW();
    if (u.weekly.week !== wk) u.weekly = { week: wk, msgs: 0, games: 0 };
    const today = todayTW();
    if (u.quests.date !== today) u.quests = { date: today, done: {}, claimed: false };
  }
}
