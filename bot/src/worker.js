/* Cloudflare Workers 介接層：Discord「HTTP 互動」模式，不用 Gateway、不用常駐程序。

   請求流程：Discord → POST / → 驗 Ed25519 簽章 → 轉給單例 Durable Object（BotDO）→ 核心跑功能 →
   第一個 reply/update/showModal 直接當 HTTP 回應（Discord 要求 3 秒內），之後的 followUp/edit 走 REST。
   功能跑太久（例如 AI 解讀）會先回「延遲」，結果稍後用 REST 補上。

   狀態存在 Durable Object 的 SQLite storage：每個玩家、每個伺服器各一個鍵，只寫回這次有碰到的鍵。
   單例 DO 表示所有互動都排隊處理，經濟系統不會有競態。
   Cron（每分鐘）打 /tick 做提醒、倒數、抽獎開獎。

   限制（沒有 Gateway）：聊天經驗值改由使用指令累積；/afk 的自動回覆、/autoreact、/welcome 這三個被動功能
   與 /team 的語音頻道名單在這個版本不會動作。要完整功能請用容器版（src/index.js）。

   機密（wrangler secret put …）：DISCORD_TOKEN、DISCORD_PUBLIC_KEY、APP_ID、REGISTER_SECRET；ANTHROPIC_API_KEY 選用。 */

import { Bot } from './core/bot.js';
import { MemoryStore } from './core/store.js';
import { Timers } from './core/sessions.js';
import { createAI } from './core/ai.js';
import { registrationJSON } from './core/registry.js';
import { verifyDiscordRequest, createRest, parseInteraction, toApi } from './core/discord-http.js';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const stub = env => env.BOT.get(env.BOT.idFromName('main'));

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/') {
      const sig = req.headers.get('x-signature-ed25519') || '', ts = req.headers.get('x-signature-timestamp') || '';
      const body = await req.text();
      if (!(await verifyDiscordRequest(env.DISCORD_PUBLIC_KEY, ts, body, sig))) return new Response('invalid request signature', { status: 401 });
      let i; try { i = JSON.parse(body); } catch { return new Response('bad json', { status: 400 }); }
      if (i.type === 1) return json({ type: 1 });   // Discord 驗證端點用的 PING
      return stub(env).fetch('https://bot/interaction', { method: 'POST', body, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/health') return stub(env).fetch('https://bot/health');
    if (req.method === 'POST' && url.pathname === '/register') {
      // 不想在本機裝東西也能註冊指令：curl -X POST -H "Authorization: Bearer $REGISTER_SECRET" https://…/register[?guild=ID]
      if (!env.REGISTER_SECRET || req.headers.get('authorization') !== `Bearer ${env.REGISTER_SECRET}`) return new Response('unauthorized', { status: 401 });
      const rest = createRest({ token: env.DISCORD_TOKEN, appId: env.APP_ID, fetchImpl: env.FETCH });
      const list = await rest.registerCommands(registrationJSON(Bot.defaultRegistry()), url.searchParams.get('guild') || '');
      return json({ registered: (list || []).length });
    }
    return new Response('SEKAI 資源中心 機器人：這是 Discord Interactions Endpoint，請把此網址填進 Discord 開發者後台。', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(stub(env).fetch('https://bot/tick', { method: 'POST' }));
  },
};

/* Durable Object storage 版的 store：全部讀進記憶體，只寫回這次互動碰到的鍵 */
export class DOStore extends MemoryStore {
  constructor(storage) { super(); this.storage = storage; this.touched = new Set(); }
  async load() {
    const all = await this.storage.list();
    for (const [k, v] of all) {
      if (k.startsWith('u:')) this.data.users[k.slice(2)] = v;
      else if (k.startsWith('g:')) this.data.guilds[k.slice(2)] = v;
      else if (k.startsWith('x:')) this.data.global[k.slice(2)] = v;
    }
  }
  user(gid, uid) { const u = super.user(gid, uid); this.touched.add(`u:${gid}:${uid}`); return u; }
  guild(gid) { const g = super.guild(gid); this.touched.add(`g:${gid}`); return g; }
  global(k, init) { const v = super.global(k, init); this.touched.add(`x:${k}`); return v; }
  async save() { await this.flush(); }
  async flush() {
    if (!this.touched.size) return;
    const keys = [...this.touched]; this.touched.clear(); this.dirty = false;
    for (let i = 0; i < keys.length; i += 100) {
      const batch = {};
      for (const k of keys.slice(i, i + 100)) {
        const v = k.startsWith('u:') ? this.data.users[k.slice(2)] : k.startsWith('g:') ? this.data.guilds[k.slice(2)] : this.data.global[k.slice(2)];
        if (v !== undefined) batch[k] = v;
      }
      if (Object.keys(batch).length) await this.storage.put(batch);
    }
  }
}

export class BotDO {
  constructor(state, env) { this.state = state; this.env = env; this.ready = null; this.ticks = 0; }
  init() {
    if (!this.ready) this.ready = (async () => {
      this.store = new DOStore(this.state.storage);
      await this.store.load();
      this.rest = createRest({ token: this.env.DISCORD_TOKEN, appId: this.env.APP_ID, fetchImpl: this.env.FETCH });
      this.bot = await Bot.create({
        store: this.store, timers: new Timers(), ai: createAI(this.env, { store: this.store }),
        send: (channelId, msg) => this.rest.send(channelId, msg), log: (...a) => console.error('[bot]', ...a),
      });
      this.deferMs = Number(this.env.DEFER_MS) || 2200;
    })();
    return this.ready;
  }
  async fetch(req) {
    await this.init();
    const url = new URL(req.url);
    try {
      if (url.pathname === '/interaction') return json(await this.handle(await req.json()));
      if (url.pathname === '/tick') {
        await this.bot.tick();
        if (this.ticks++ % 30 === 0) this.bot.guildCount = await this.rest.guildCount().catch(() => this.bot.guildCount);
        await this.store.flush();
        return json({ ok: true, ticks: this.ticks });
      }
      if (url.pathname === '/health') return json({ ok: true, features: this.bot.registry.size, stats: this.bot.stats, users: Object.keys(this.store.data.users).length, guilds: Object.keys(this.store.data.guilds).length, ai: !!this.bot.ai });
      return new Response('not found', { status: 404 });
    } catch (e) { console.error('[do]', e); return json({ error: String((e && e.message) || e) }, 500); }
  }

  /* 回傳要給 Discord 的互動回應物件（type 4/5/6/7/8/9） */
  async handle(i) {
    const parsed = parseInteraction(i);
    if (!parsed) return { type: 4, data: { content: '不支援的互動型別。', flags: 64 } };
    const { kind, input } = parsed;
    if (kind === 'autocomplete') return { type: 8, data: { choices: await this.bot.runAutocomplete(input) } };
    const token = i.token, rest = this.rest, isComponent = kind !== 'command';
    let responded = false, deferred = false, editedOriginal = false, resolveResp;
    const respP = new Promise(r => { resolveResp = r; });
    const first = (type, data) => { if (responded) return false; responded = true; resolveResp(data === undefined ? { type } : { type, data }); return true; };
    const io = {
      reply: async msg => {
        if (first(4, toApi(msg))) return;
        if (deferred && !editedOriginal) { editedOriginal = true; return rest.editOriginal(token, msg); }
        return rest.followUp(token, msg);
      },
      update: async msg => { if (first(7, toApi(msg))) return; editedOriginal = true; return rest.editOriginal(token, msg); },
      followUp: async msg => rest.followUp(token, msg),
      edit: async msg => { editedOriginal = true; return rest.editOriginal(token, msg); },
      defer: async ephemeral => { if (first(isComponent ? 6 : 5, ephemeral ? { flags: 64 } : undefined)) deferred = true; },
      showModal: async m => { first(9, m); },
      members: async () => input.guildId === 'dm' ? [] : rest.members(input.guildId).catch(() => []),
    };
    const run = (kind === 'command' ? this.bot.runCommand({ ...input, io }) : this.bot.runComponent(kind, { ...input, io }))
      .catch(e => console.error('[handle]', e))
      .then(() => this.store.flush());
    let timer;
    const timeout = new Promise(r => { timer = setTimeout(() => r('timeout'), this.deferMs); });
    await Promise.race([respP, run, timeout]);
    clearTimeout(timer);
    if (!responded) { first(isComponent ? 6 : 5); deferred = true; }   // 逾時：先回延遲，功能跑完再用 REST 補結果
    return respP;
  }
}
