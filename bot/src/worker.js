/* Cloudflare Workers 介接層：Discord「HTTP 互動」模式，不用 Gateway、不用常駐程序。

   請求流程：Discord → POST / → 轉給單例 Durable Object（BotDO）→ 驗 Ed25519 簽章 → 核心跑功能 →
   第一個 reply/update/showModal 直接當 HTTP 回應（Discord 要求 3 秒內），之後的 followUp/edit 走 REST。
   功能跑太久（例如 AI 解讀）會先回「延遲」，結果稍後用 REST 補上。

   狀態存在 Durable Object 的 SQLite storage：每個玩家、每個伺服器各一個鍵，只寫回這次有碰到的鍵。
   進行中的遊戲／測驗（sessions）與指令冷卻也一樣落地（s:… 與 cd 鍵）：DO 閒置 10 秒就會休眠、記憶體全部清空，
   若只放記憶體，玩家在兩次按鈕之間停 10 秒以上這局就會「過期」。
   單例 DO 表示所有互動都排隊處理，經濟系統不會有競態。
   Cron（每分鐘）打 /tick 做提醒、倒數、抽獎開獎。

   Discord 設定有兩種來源，擇一即可：
     1. wrangler secret put DISCORD_TOKEN / DISCORD_PUBLIC_KEY / APP_ID
     2. 部署後 POST /bootstrap {"token":"<Bot token>"}：Worker 拿 token 向 Discord 驗明正身，把 token、App ID、Public Key
        存進自己的 storage，順手把 Interactions Endpoint URL 設回 Discord 並註冊 100 個指令。不需要任何 Cloudflare 金鑰。
        綁定後只接受同一個應用程式的 token（換 token 用同一支重打一次即可）。
   選用：ANTHROPIC_API_KEY（AI 解讀）、REGISTER_SECRET（POST /register 用）。

   限制（沒有 Gateway）：聊天經驗值改由使用指令累積；/afk 的自動回覆、/autoreact、/welcome 這三個被動功能
   與 /team 的語音頻道名單在這個版本不會動作。要完整功能請用容器版（src/index.js）。 */

import { Bot } from './core/bot.js';
import { MemoryStore } from './core/store.js';
import { Timers } from './core/sessions.js';
import { createAI } from './core/ai.js';
import { registrationJSON } from './core/registry.js';
import { verifyDiscordRequest, createRest, parseInteraction, toApi } from './core/discord-http.js';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const stub = env => env.BOT.get(env.BOT.idFromName('main'));

/* 瀏覽器版的 /bootstrap：開 https://<worker>/setup，貼 Bot token，按一下就設定完成 */
const SETUP_PAGE = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>機器人設定</title>
<style>body{font:16px/1.6 system-ui,-apple-system,"Noto Sans TC",sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#222;background:#fafafa}h1{font-size:22px}label{display:block;margin:16px 0 4px;font-weight:600}input{width:100%;box-sizing:border-box;padding:10px;font-size:15px;border:1px solid #bbb;border-radius:8px}button{margin-top:16px;padding:10px 18px;font-size:16px;border:0;border-radius:8px;background:#33ccbb;color:#fff;cursor:pointer}button:disabled{opacity:.5}pre{white-space:pre-wrap;background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px}small{color:#666}a{color:#0077dd}</style>
<h1>SEKAI 資源中心 機器人・第一次設定</h1>
<p>貼上 Discord 開發者後台 <b>Bot → Token</b>。Worker 會用它向 Discord 驗明正身，把設定存起來、把 Interactions Endpoint URL 設成這個網址、註冊 100 個斜線指令。token 只會送到這個 Worker 與 Discord，不會出現在其他地方。</p>
<label for="t">Bot token</label><input id="t" type="password" autocomplete="off" placeholder="MTU1…">
<label for="g">只註冊到某個伺服器（選填，伺服器 ID；留空＝全域，最多一小時生效）</label><input id="g" placeholder="123456789012345678">
<button id="b">開始設定</button>
<pre id="o" hidden></pre>
<p><small>已經設定過想換 token？同樣在這裡重貼即可（只接受同一個應用程式的 token）。狀態：<a href="/health">/health</a></small></p>
<script>
const $=s=>document.querySelector(s);$('#b').onclick=async()=>{const token=$('#t').value.trim();if(!token)return alert('請貼上 token');$('#b').disabled=true;$('#o').hidden=false;$('#o').textContent='設定中…';
try{const r=await fetch('/bootstrap',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,guild:$('#g').value.trim()})});const j=await r.json();
if(j.ok){$('#o').textContent='✅ 完成！應用程式 '+j.app.name+'（'+j.app.id+'）\\nInteractions Endpoint：'+(j.endpoint?j.endpoint.url:'未設定')+'\\n已註冊指令：'+j.commands+' 個\\n\\n邀請機器人進伺服器：\\n'+j.invite;$('#o').innerHTML+='\\n\\n<a href="'+j.invite+'" target="_blank">👉 開啟邀請連結</a>';}
else $('#o').textContent='❌ '+JSON.stringify(j,null,2);}catch(e){$('#o').textContent='❌ '+e.message}$('#b').disabled=false;};
</script></html>`;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const forward = async path => stub(env).fetch('https://bot' + path, {
      method: 'POST', body: await req.text(),
      headers: { 'content-type': 'application/json', 'x-signature-ed25519': req.headers.get('x-signature-ed25519') || '', 'x-signature-timestamp': req.headers.get('x-signature-timestamp') || '', 'x-origin': url.origin, 'authorization': req.headers.get('authorization') || '', 'x-query': url.search },
    });
    if (req.method === 'POST' && url.pathname === '/') return forward('/interaction');
    if (req.method === 'POST' && url.pathname === '/bootstrap') return forward('/bootstrap');
    if (req.method === 'POST' && url.pathname === '/register') return forward('/register');
    if (url.pathname === '/health') return stub(env).fetch('https://bot/health');
    if (url.pathname === '/setup') return new Response(SETUP_PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    return new Response('SEKAI 資源中心 機器人：這是 Discord Interactions Endpoint。第一次設定請開 /setup；說明見 bot/README.md。', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(stub(env).fetch('https://bot/tick', { method: 'POST' }));
  },
};

/* Durable Object storage 版的 store：全部讀進記憶體，只寫回這次互動碰到的鍵。
   鍵：u:gid:uid 玩家、g:gid 伺服器、x:key 跨伺服器、s:feature:id 進行中的遊戲、cd 指令冷卻、cfg /bootstrap 的設定 */
export class DOStore extends MemoryStore {
  constructor(storage) { super(); this.storage = storage; this.touched = new Set(); this.sessions = []; this.cooldowns = null; }
  async load() {
    const all = await this.storage.list();
    for (const [k, v] of all) {
      if (k.startsWith('u:')) this.data.users[k.slice(2)] = v;
      else if (k.startsWith('g:')) this.data.guilds[k.slice(2)] = v;
      else if (k.startsWith('x:')) this.data.global[k.slice(2)] = v;
      else if (k.startsWith('s:')) this.sessions.push([k.slice(2), v]);
      else if (k === 'cd') this.cooldowns = v;
    }
  }
  /* 進行中的遊戲與冷卻：寫回這次動到的、刪掉結束或過期的 */
  async saveTransient(bot) {
    const { put, del } = bot.sessions.drain();
    const keys = Object.keys(put);
    for (let i = 0; i < keys.length; i += 100) { const batch = {}; for (const k of keys.slice(i, i + 100)) batch['s:' + k] = put[k]; await this.storage.put(batch); }
    for (let i = 0; i < del.length; i += 100) await this.storage.delete(del.slice(i, i + 100).map(k => 's:' + k));
    const cd = bot.cooldowns.drain();
    if (cd) await this.storage.put('cd', cd);
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
      this.cfg = (await this.state.storage.get('cfg')) || {};
      this.applyConfig();
      this.bot = await Bot.create({
        store: this.store, timers: new Timers(), ai: createAI(this.env, { store: this.store }),
        send: (channelId, msg) => this.rest.send(channelId, msg), log: (...a) => console.error('[bot]', ...a),
      });
      // DO 重建（休眠後醒來）：把進行中的遊戲與冷卻讀回來
      this.bot.sessions.load(this.store.sessions); this.store.sessions = [];
      this.bot.cooldowns.load(this.store.cooldowns);
      this.deferMs = Number(this.env.DEFER_MS) || 2200;
    })();
    return this.ready;
  }
  /* 每次互動／tick 結束後：玩家與伺服器資料、進行中的遊戲、冷卻全部落地 */
  async persist() {
    try { await this.store.flush(); await this.store.saveTransient(this.bot); }
    catch (e) { console.error('[do] 寫入 storage 失敗:', e); }
  }
  /* 環境變數優先，其次是 /bootstrap 存下來的設定 */
  applyConfig() {
    const e = this.env, c = this.cfg;
    this.token = (e.DISCORD_TOKEN || c.token || '').trim();
    this.publicKey = (e.DISCORD_PUBLIC_KEY || c.publicKey || '').trim();
    this.appId = (e.APP_ID || c.appId || '').trim();
    this.rest = createRest({ token: this.token, appId: this.appId, fetchImpl: this.env.FETCH });
  }
  get configured() { return !!(this.token && this.publicKey && this.appId); }

  async fetch(req) {
    await this.init();
    const url = new URL(req.url);
    try {
      if (url.pathname === '/interaction') return this.interaction(req);
      if (url.pathname === '/bootstrap') return this.bootstrap(req);
      if (url.pathname === '/register') {
        if (!this.env.REGISTER_SECRET || req.headers.get('authorization') !== `Bearer ${this.env.REGISTER_SECRET}`) return new Response('unauthorized', { status: 401 });
        if (!this.configured) return json({ error: '尚未設定 Discord（POST /bootstrap 或 wrangler secret put）' }, 409);
        const guild = new URLSearchParams(req.headers.get('x-query') || '').get('guild') || '';
        const list = await this.rest.registerCommands(registrationJSON(this.bot.registry, { lang: this.env.COMMAND_LANG === 'en' ? 'en' : 'zh' }), guild);
        return json({ registered: (list || []).length, guild: guild || 'global' });
      }
      if (url.pathname === '/tick') {
        await this.bot.tick();
        if (this.configured && this.ticks++ % 30 === 0) this.bot.guildCount = await this.rest.guildCount().catch(() => this.bot.guildCount);
        await this.persist();
        return json({ ok: true, ticks: this.ticks });
      }
      if (url.pathname === '/health') return json({ ok: true, configured: this.configured, app: this.appId ? { id: this.appId, name: this.cfg.name || '' } : null, features: this.bot.registry.size, stats: this.bot.stats, users: Object.keys(this.store.data.users).length, guilds: Object.keys(this.store.data.guilds).length, sessions: this.bot.sessions.size, ai: !!this.bot.ai });
      return new Response('not found', { status: 404 });
    } catch (e) { console.error('[do]', e); return json({ error: String((e && e.message) || e) }, 500); }
  }

  async interaction(req) {
    const body = await req.text();
    if (!this.publicKey) return new Response('not configured: POST /bootstrap with the bot token first', { status: 401 });
    if (!(await verifyDiscordRequest(this.publicKey, req.headers.get('x-signature-timestamp'), body, req.headers.get('x-signature-ed25519')))) return new Response('invalid request signature', { status: 401 });
    let i; try { i = JSON.parse(body); } catch { return new Response('bad json', { status: 400 }); }
    if (i.type === 1) return json({ type: 1 });   // Discord 驗證端點用的 PING
    return json(await this.handle(i));
  }

  /* 只憑 Bot token 完成設定：驗證 token → 存設定 → 設 Interactions Endpoint → 註冊指令 */
  async bootstrap(req) {
    let body = {}; try { body = JSON.parse(await req.text()); } catch {}
    const token = String(body.token || '').trim();
    if (!token) return json({ error: '請帶 {"token": "<Bot token>"}' }, 400);
    const probe = createRest({ token, appId: '', fetchImpl: this.env.FETCH });
    let app;
    try { app = await probe.call('GET', '/applications/@me'); } catch (e) { return json({ error: 'token 無效或 Discord 拒絕：' + e.message.slice(0, 200) }, 401); }
    if (!app || !app.id || !app.verify_key) return json({ error: 'Discord 回應不完整' }, 502);
    const bound = this.env.APP_ID || this.cfg.appId;
    if (bound && bound !== app.id) return json({ error: `這個 Worker 已綁定應用程式 ${bound}，不接受其他應用程式的 token` }, 403);
    this.cfg = { token, appId: app.id, publicKey: app.verify_key, name: app.name, at: Date.now() };
    await this.state.storage.put('cfg', this.cfg);
    this.applyConfig();
    const origin = String(body.url || req.headers.get('x-origin') || '').replace(/\/+$/, '');
    const result = { ok: true, app: { id: app.id, name: app.name }, endpoint: null, commands: 0 };
    if (origin) {
      const endpoint = origin + '/';
      if (app.interactions_endpoint_url === endpoint) result.endpoint = { url: endpoint, changed: false };
      else {
        try { await this.rest.call('PATCH', '/applications/@me', { interactions_endpoint_url: endpoint }); result.endpoint = { url: endpoint, changed: true }; }
        catch (e) { result.endpoint = { url: endpoint, error: e.message.slice(0, 300) }; result.ok = false; }
      }
    }
    try {
      const list = await this.rest.registerCommands(registrationJSON(this.bot.registry, { lang: this.env.COMMAND_LANG === 'en' ? 'en' : 'zh' }), String(body.guild || ''));
      result.commands = (list || []).length;
    } catch (e) { result.commandsError = e.message.slice(0, 300); result.ok = false; }
    result.invite = `https://discord.com/oauth2/authorize?client_id=${app.id}&scope=bot%20applications.commands&permissions=277025508416`;
    return json(result, result.ok ? 200 : 502);
  }

  /* 回傳要給 Discord 的互動回應物件（type 4/5/6/7/8/9） */
  async handle(i) {
    const parsed = parseInteraction(i);
    if (!parsed) return { type: 4, data: { content: '不支援的互動型別。', flags: 64 } };
    const { kind, input } = parsed;
    if (kind === 'autocomplete') return { type: 8, data: { choices: await this.bot.runAutocomplete(input) } };
    const token = i.token, rest = this.rest, isComponent = kind !== 'command';
    let responded = false, deferType = 0, editedOriginal = false, resolveResp;
    const respP = new Promise(r => { resolveResp = r; });
    const first = (type, data) => { if (responded) return false; responded = true; resolveResp(data === undefined ? { type } : { type, data }); return true; };
    const defer = ephemeral => { const t = isComponent ? 6 : 5; if (first(t, ephemeral ? { flags: 64 } : undefined)) deferType = t; };
    const io = {
      reply: async msg => {
        if (first(4, toApi(msg))) return;
        // 指令先回了「延遲」（type 5）：第一次 reply 就是把那則佔位訊息改成結果。
        // 元件先回了「延遲更新」（type 6）：reply 要另開一則訊息，不能蓋掉按鈕所在的那則（例如「這不是你的按鈕」）。
        if (deferType === 5 && !editedOriginal) { editedOriginal = true; return rest.editOriginal(token, msg); }
        return rest.followUp(token, msg);
      },
      update: async msg => { if (first(7, toApi(msg))) return; editedOriginal = true; return rest.editOriginal(token, msg); },
      followUp: async msg => rest.followUp(token, msg),
      edit: async msg => { editedOriginal = true; return rest.editOriginal(token, msg); },
      defer: async ephemeral => defer(ephemeral),
      showModal: async m => { first(9, m); },
      members: async () => input.guildId === 'dm' ? [] : rest.members(input.guildId).catch(() => []),
    };
    const run = (kind === 'command' ? this.bot.runCommand({ ...input, io }) : this.bot.runComponent(kind, { ...input, io }))
      .catch(e => console.error('[handle]', e))
      .then(() => this.persist());
    let timer;
    const timeout = new Promise(r => { timer = setTimeout(() => r('timeout'), this.deferMs); });
    await Promise.race([respP, run, timeout]);
    clearTimeout(timer);
    if (!responded) defer(false);   // 逾時：先回延遲，功能跑完再用 REST 補結果
    return respP;
  }
}
