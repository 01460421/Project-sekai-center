/* Cloudflare Workers 版（HTTP 互動）端對端：用假的 Durable Object storage 與假的 Discord REST，
   真的產 Ed25519 金鑰簽請求，走完整條 fetch → 驗簽 → DO → 核心 → 互動回應。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { BotDO, DOStore } from '../src/worker.js';
import { verifyDiscordRequest, parseInteraction, hexToBytes } from '../src/core/discord-http.js';

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const PUBLIC_KEY = hex(await crypto.subtle.exportKey('raw', keys.publicKey));
const USER = { id: '100000000000000001', username: 'alice', global_name: 'Alice', avatar: null };
const GUILD = '900000000000000001', CHANNEL = '800000000000000001';

/* 假的 DO storage（Map） */
function fakeStorage(map = new Map()) {
  return { map, async list() { return new Map(map); }, async put(k, v) { if (typeof k === 'object') for (const [kk, vv] of Object.entries(k)) map.set(kk, structuredClone(vv)); else map.set(k, structuredClone(v)); }, async get(k) { return map.get(k); }, async delete(k) { map.delete(k); } };
}
/* 假的環境：一個 DO 實例、記錄所有 REST 呼叫 */
function makeEnv({ storage = fakeStorage(), deferMs = 2200 } = {}) {
  const calls = [];
  const FETCH = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (url.includes('/commands')) return new Response(JSON.stringify(Array(100).fill({})), { status: 200 });
    if (url.includes('/members')) return new Response(JSON.stringify([{ user: USER }, { user: { id: '2', username: 'bob' } }]), { status: 200 });
    if (url.includes('/users/@me/guilds')) return new Response(JSON.stringify([{ id: GUILD }]), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  const env = { DISCORD_PUBLIC_KEY: PUBLIC_KEY, DISCORD_TOKEN: 'tok', APP_ID: '123', REGISTER_SECRET: 'sekret', DEFER_MS: String(deferMs), FETCH };
  let instance = null;
  env.BOT = { idFromName: n => n, get: () => ({ fetch: (url, init) => { if (!instance) instance = new BotDO({ storage }, env); return instance.fetch(new Request(url, init)); } }) };
  env.calls = calls; env.storage = storage; env.instance = () => instance;
  return env;
}
async function signed(body, { badSig = false } = {}) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = badSig ? '00'.repeat(64) : hex(await crypto.subtle.sign('Ed25519', keys.privateKey, new TextEncoder().encode(ts + body)));
  return new Request('https://bot.example/', { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-signature-ed25519': sig, 'x-signature-timestamp': ts } });
}
const base = extra => ({ id: String(Date.now()), token: 'itoken', application_id: '123', guild_id: GUILD, channel_id: CHANNEL, member: { user: USER, nick: null, permissions: '32', roles: [] }, ...extra });
const command = (name, options = [], sub) => base({ type: 2, data: { name, options: sub ? [{ type: 1, name: sub, options }] : options } });
const button = custom_id => base({ type: 3, data: { custom_id, component_type: 2 }, message: { content: '', embeds: [], components: [] } });
const modal = (custom_id, fields) => base({ type: 5, data: { custom_id, components: Object.entries(fields).map(([k, v]) => ({ type: 1, components: [{ type: 4, custom_id: k, value: v }] })) }, message: { content: '', embeds: [], components: [] } });
async function send(env, payload, opts) { const res = await worker.fetch(await signed(JSON.stringify(payload), opts), env); return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() }; }
const buttonsOf = data => (data.components || []).flatMap(r => r.components).filter(c => c.type === 2).map(c => c.custom_id);

test('驗簽：正確金鑰通過、錯誤簽章拒絕、PING 回 type 1', async () => {
  const env = makeEnv();
  assert.equal((await send(env, { type: 1 }, { badSig: true })).status, 401);
  const ping = await send(env, { type: 1 }); assert.equal(ping.status, 200); assert.deepEqual(ping.body, { type: 1 });
  assert.equal(await verifyDiscordRequest('zz', '1', 'x', 'yy'), false);
  assert.equal(hexToBytes('0aff').length, 2);
});

test('斜線指令 → type 4；同一天同一問題塔羅相同', async () => {
  const env = makeEnv();
  const r = await send(env, command('coin')); assert.equal(r.status, 200); assert.equal(r.body.type, 4); assert.match(r.body.data.content, /🪙/);
  const a = await send(env, command('tarot', [{ type: 3, name: 'spread', value: 'three' }, { type: 3, name: 'question', value: '工作' }]));
  const b = await send(env, command('tarot', [{ type: 3, name: 'spread', value: 'three' }, { type: 3, name: 'question', value: '工作' }]));
  assert.equal(a.body.data.embeds[0].description, b.body.data.embeds[0].description);
  const sub = await send(env, command('bank', [], 'info')); assert.match(sub.body.data.content, /銀行/);
});

test('按鈕 → type 7、表單 → type 9 再 type 7、自動完成 → type 8', async () => {
  const env = makeEnv();
  const t = await send(env, command('tictactoe')); const [cell] = buttonsOf(t.body.data);
  const p = await send(env, button(cell)); assert.equal(p.body.type, 7); assert.match(p.body.data.content, /井字/);
  const w = await send(env, command('wordle')); const [open] = buttonsOf(w.body.data);
  const m = await send(env, button(open)); assert.equal(m.body.type, 9); assert.match(m.body.data.custom_id, /^wordle:guess:/);
  const g = await send(env, modal(m.body.data.custom_id, { g: 'crane' })); assert.equal(g.body.type, 7); assert.match(g.body.data.content, /🟩|🟨|⬛/);
  const ac = await send(env, base({ type: 4, data: { name: 'song', options: [{ type: 3, name: 'title', value: 'tell', focused: true }] } }));
  assert.equal(ac.body.type, 8); assert.ok(ac.body.data.choices.some(c => /Tell Your World/i.test(c.name)));
});

test('狀態寫進 storage，重新建立 DO 後還在', async () => {
  const storage = fakeStorage();
  const env1 = makeEnv({ storage });
  const d = await send(env1, command('daily')); assert.match(d.body.data.embeds[0].title, /簽到成功/);
  await new Promise(r => setTimeout(r, 20));   // flush 在回應後才完成
  assert.ok(storage.map.has(`u:${GUILD}:${USER.id}`), '玩家鍵要寫回'); assert.ok(storage.map.has(`g:${GUILD}`), '伺服器鍵要寫回');
  const env2 = makeEnv({ storage });
  const b = await send(env2, command('balance')); assert.match(b.body.data.content, /1[1-9]\d/);
  const again = await send(env2, command('daily')); assert.match(again.body.data.content, /簽過了/);
});

test('cron tick：到期的提醒用 REST 送到頻道；health 有統計', async () => {
  const env = makeEnv();
  await send(env, command('remind', [{ type: 4, name: 'minutes', value: 1 }, { type: 3, name: 'text', value: '喝水' }], 'set'));
  await new Promise(r => setTimeout(r, 20));
  env.instance().store.global('reminders')[0].at = Date.now() - 1;
  const t = await worker.fetch(new Request('https://bot.example/tick', { method: 'POST' }), env);   // 走 stub 的 /tick 需要 scheduled；這裡直接打 DO
  assert.equal(t.status, 200);
  await worker.scheduled({}, env, { waitUntil: p => p });
  await new Promise(r => setTimeout(r, 20));
  const sent = env.calls.find(c => c.method === 'POST' && c.url.includes(`/channels/${CHANNEL}/messages`));
  assert.ok(sent, '應該送出提醒'); assert.match(sent.body.content, /喝水/);
  const h = await worker.fetch(new Request('https://bot.example/health'), env); const hb = await h.json(); assert.equal(hb.features, 100); assert.ok(hb.users >= 1);
});

test('/register 需要密鑰，成功時 PUT 100 個指令', async () => {
  const env = makeEnv();
  assert.equal((await worker.fetch(new Request('https://bot.example/register', { method: 'POST' }), env)).status, 401);
  const r = await worker.fetch(new Request('https://bot.example/register?guild=' + GUILD, { method: 'POST', headers: { authorization: 'Bearer sekret' } }), env);
  assert.deepEqual(await r.json(), { registered: 100 });
  const put = env.calls.find(c => c.method === 'PUT'); assert.ok(put.url.endsWith(`/guilds/${GUILD}/commands`)); assert.equal(put.body.length, 100); assert.ok(put.body.every(c => Array.isArray(c.contexts)));
});

test('功能跑太久：先回延遲（type 5），結果之後 PATCH @original', async () => {
  const env = makeEnv({ deferMs: 150 });
  await send(env, { type: 1 });
  env.BOT.get().fetch('https://bot/health');   // 讓 DO 實例存在
  await new Promise(r => setTimeout(r, 20));
  env.instance().bot.registry.add({ name: 'slowtest', description: 'slow', category: 'fun', guildOnly: false, async run(ctx) { await new Promise(r => setTimeout(r, 300)); await ctx.reply({ content: '晚到的結果' }); } });
  const t0 = Date.now(); const r = await send(env, command('slowtest')); const dt = Date.now() - t0;
  assert.equal(r.body.type, 5); assert.ok(dt < 290, `應在逾時後立刻回延遲（${dt}ms）`);
  await new Promise(r => setTimeout(r, 400));
  const patch = env.calls.find(c => c.method === 'PATCH' && c.url.endsWith('/webhooks/123/itoken/messages/@original'));
  assert.ok(patch, '要用 REST 補上結果'); assert.equal(patch.body.content, '晚到的結果');
});

test('parseInteraction：使用者、權限、選項、resolved 使用者與頻道', () => {
  const p = parseInteraction(base({ type: 2, data: { name: 'pay', options: [{ type: 6, name: 'user', value: '2' }, { type: 4, name: 'amount', value: 5 }, { type: 7, name: 'ch', value: '77' }], resolved: { users: { 2: { id: '2', username: 'bob', avatar: 'abc' } }, members: { 2: { nick: 'Bobby' } }, channels: { 77: { name: 'general' } } } } }));
  assert.equal(p.kind, 'command'); assert.equal(p.input.user.name, 'Alice'); assert.equal(p.input.member.admin, true);
  assert.equal(p.input.options.user.name, 'Bobby'); assert.match(p.input.options.user.avatar, /avatars\/2\/abc\.png/); assert.equal(p.input.options.amount, 5); assert.equal(p.input.options.ch.name, 'general');
  const dm = parseInteraction({ type: 2, id: '1', user: USER, data: { name: 'help' } }); assert.equal(dm.input.guildId, 'dm'); assert.equal(dm.input.member.admin, false);
  assert.equal(parseInteraction({ type: 99, user: USER }), null);
});

test('DOStore 只寫回碰到的鍵', async () => {
  const storage = fakeStorage(); const s = new DOStore(storage); await s.load();
  s.user('g', 'a').crystals = 5; s.guild('g'); await s.flush();
  assert.deepEqual([...storage.map.keys()].sort(), ['g:g', 'u:g:a']);
  s.data.users['g:zzz'] = { crystals: 1 }; await s.flush(); assert.ok(!storage.map.has('u:g:zzz'), '沒透過 user() 碰到的不寫');
});
