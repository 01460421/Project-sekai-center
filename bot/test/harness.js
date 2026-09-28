/* 測試用的假介接層：不需要 discord.js，直接呼叫核心。 */

import assert from 'node:assert/strict';
import { Bot } from '../src/core/bot.js';
import { MemoryStore } from '../src/core/store.js';
import { Rng } from '../src/core/rng.js';
import { Timers } from '../src/core/sessions.js';
import { createAI } from '../src/core/ai.js';
import { useFetch, clearCache } from '../src/core/live.js';

/* 測試不打真的網路：core/live.js 的 fetch 預設回 404；mockLive({ 網址片段: 物件或字串 }) 餵假資料，resetFetch() 還原 */
const notFound = async () => new Response('not found', { status: 404 });
export function mockLive(map) { useFetch(async url => { for (const [k, v] of Object.entries(map)) if (String(url).includes(k)) return new Response(typeof v === 'string' ? v : JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } }); return notFound(); }); }
export function resetFetch() { useFetch(notFound); clearCache(); }
resetFetch();

let registry = null;
export async function loadRegistry() { if (!registry) registry = Bot.defaultRegistry(); return registry; }

export const USERS = {
  alice: { id: '100000000000000001', name: 'Alice', bot: false },
  bob: { id: '100000000000000002', name: 'Bob', bot: false },
  carol: { id: '100000000000000003', name: 'Carol', bot: false },
  robot: { id: '100000000000000009', name: 'Robo', bot: true },
};
export const GUILD = '900000000000000001', CHANNEL = '800000000000000001';

/* 假的 Claude client：script 是回應陣列（用完就重複最後一個）或 (params, i) => 回應 的函式。呼叫參數都記在 calls */
export function fakeClaude(script) {
  const calls = [];
  return { calls, beta: { messages: { create: async params => { calls.push(params); const i = calls.length - 1; let r = typeof script === 'function' ? script(params, i) : script[Math.min(i, script.length - 1)]; if (typeof r === 'function') r = r(params, i); if (r instanceof Error) throw r; return r; } } } };
}
export const aiText = t => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
export const aiTool = (name, input, id = 'tu_1', lead = '我查一下') => ({ stop_reason: 'tool_use', content: [{ type: 'text', text: lead }, { type: 'tool_use', id, name, input }] });
export const aiRefusal = () => ({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: null }, content: [] });

/* claude：給 fakeClaude() 的回傳值就會啟用 AI；aiEnv 可覆寫 AI_* 環境變數 */
export async function makeBot({ seed = 42, claude = null, aiEnv = {} } = {}) {
  const registry = await loadRegistry();
  const sent = [];
  const store = new MemoryStore();
  const ai = claude ? createAI({ ANTHROPIC_API_KEY: 'test', ...aiEnv }, { store, client: claude }) : null;
  const bot = new Bot({ registry, store, ai, rng: new Rng(seed), timers: new Timers(true), send: async (channelId, msg) => { validateMessage(msg); sent.push({ channelId, msg }); }, log: () => {} });
  bot.sent = sent;
  bot.errors = [];
  bot.log = (...a) => bot.errors.push(a.map(x => x && x.stack ? x.stack : String(x)).join(' '));
  return bot;
}

/* 一次互動的紀錄 */
function makeIO(rec) {
  return {
    reply: async msg => { validateMessage(msg); rec.replies.push(msg); },
    update: async msg => { validateMessage(msg); rec.updates.push(msg); },
    followUp: async msg => { validateMessage(msg); rec.followUps.push(msg); },
    edit: async msg => { validateMessage(msg); rec.edits.push(msg); },
    defer: async () => { rec.deferred = true; },
    showModal: async m => { validateModal(m); rec.modals.push(m); },
    members: () => Object.values(USERS).map(u => ({ id: u.id, name: u.name, bot: u.bot })),
  };
}
const newRec = () => ({ replies: [], updates: [], followUps: [], edits: [], modals: [], deferred: false });

export async function runCmd(bot, name, { options = {}, sub = '', user = USERS.alice, guildId = GUILD, channelId = CHANNEL, admin = false, voiceMembers = [] } = {}) {
  const rec = newRec();
  const ctx = await bot.runCommand({ name, options, sub, user, guildId, guildName: 'Test Guild', channelId, member: { admin, roles: [], voiceMembers }, io: makeIO(rec) });
  rec.ctx = ctx;
  rec.last = rec.updates[rec.updates.length - 1] || rec.replies[rec.replies.length - 1] || null;
  rec.all = [...rec.replies, ...rec.updates, ...rec.followUps, ...rec.edits];
  return rec;
}

export async function press(bot, customId, { user = USERS.alice, values = [], fields = {}, message = null, guildId = GUILD, channelId = CHANNEL, admin = false, kind } = {}) {
  const rec = newRec();
  const k = kind || (values.length ? 'select' : Object.keys(fields).length ? 'modal' : 'button');
  const ctx = await bot.runComponent(k, { customId, values, fields, message, user, guildId, guildName: 'Test Guild', channelId, member: { admin, roles: [], voiceMembers: [] }, io: makeIO(rec) });
  rec.ctx = ctx;
  rec.last = rec.updates[rec.updates.length - 1] || rec.replies[rec.replies.length - 1] || null;
  rec.all = [...rec.replies, ...rec.updates, ...rec.followUps, ...rec.edits];
  return rec;
}

export async function sendMessage(bot, { user = USERS.alice, content = 'hello', guildId = GUILD, channelId = CHANNEL, mentions = [], mentionsBot = false, repliedToBot = false, text } = {}) {
  const replies = [], reacts = []; let typed = 0;
  await bot.emit('messageCreate', { guildId, guildName: 'Test Guild', channelId, userId: user.id, userName: user.name, content, text: text != null ? text : content, isBot: user.bot, mentions, botId: USERS.robot.id, mentionsBot, repliedToBot, typing: async () => { typed++; }, reply: async t => { if (typeof t === 'object') validateMessage(t); replies.push(t); }, react: async e => reacts.push(e) });
  return { replies, reacts, typed, texts: replies.map(t => typeof t === 'string' ? t : t.content || '') };
}

/* 訊息裡所有的按鈕／選單 custom_id */
export function buttonsOf(msg) { const out = []; for (const row of (msg && msg.components) || []) for (const c of row.components || []) if (c.type === 2 && c.custom_id) out.push({ id: c.custom_id, label: c.label, disabled: !!c.disabled, style: c.style }); return out; }
export function selectsOf(msg) { const out = []; for (const row of (msg && msg.components) || []) for (const c of row.components || []) if (c.type === 3) out.push({ id: c.custom_id, options: c.options.map(o => o.value) }); return out; }
export const textOf = msg => [msg && msg.content, ...((msg && msg.embeds) || []).flatMap(e => [e.title, e.description, ...(e.fields || []).flatMap(f => [f.name, f.value]), e.footer && e.footer.text])].filter(Boolean).join('\n');

/* Discord 的硬限制 */
export function validateMessage(msg) {
  assert.ok(msg && typeof msg === 'object', '訊息要是物件');
  if (msg.content != null) assert.ok(String(msg.content).length <= 2000, `content 超過 2000：${String(msg.content).length}`);
  const embeds = msg.embeds || [];
  assert.ok(embeds.length <= 10, 'embeds 最多 10 個');
  let total = 0;
  for (const e of embeds) {
    if (e.title) { assert.ok(e.title.length <= 256); total += e.title.length; }
    if (e.description) { assert.ok(e.description.length <= 4096, `description 超過 4096：${e.description.length}`); total += e.description.length; }
    assert.ok((e.fields || []).length <= 25, 'fields 最多 25');
    for (const f of e.fields || []) { assert.ok(f.name && f.name.length <= 256, `field name 空或太長：${JSON.stringify(f.name)}`); assert.ok(f.value && f.value.length <= 1024, `field value 空或太長：${JSON.stringify(f.value).slice(0, 80)}`); total += f.name.length + f.value.length; }
    if (e.footer) total += e.footer.text.length;
    assert.ok(total <= 6000, 'embed 總長超過 6000');
  }
  const rows = msg.components || [];
  assert.ok(rows.length <= 5, 'components 最多 5 列');
  for (const row of rows) {
    assert.equal(row.type, 1);
    assert.ok(row.components.length >= 1 && row.components.length <= 5, '每列 1~5 個元件');
    for (const c of row.components) {
      if (c.type === 2) { if (!c.url) { assert.ok(c.custom_id && c.custom_id.length <= 100, `custom_id 太長：${c.custom_id}`); } assert.ok(c.label || c.emoji, '按鈕要有 label 或 emoji'); if (c.label) assert.ok(c.label.length <= 80); }
      else if (c.type === 3) { assert.ok(c.custom_id.length <= 100); assert.ok(c.options.length >= 1 && c.options.length <= 25, '選單 1~25 個選項'); assert.equal(row.components.length, 1, '選單要獨占一列'); const vals = new Set(c.options.map(o => o.value)); assert.equal(vals.size, c.options.length, '選單 value 重複'); }
      else assert.fail(`未知元件型別 ${c.type}`);
    }
  }
  return true;
}
export function validateModal(m) {
  assert.ok(m.custom_id && m.custom_id.length <= 100); assert.ok(m.title && m.title.length <= 45);
  assert.ok(m.components.length >= 1 && m.components.length <= 5);
  for (const row of m.components) for (const c of row.components) { assert.equal(c.type, 4); assert.ok(c.custom_id && c.label && c.label.length <= 45); }
}

/* 依參數定義生成一組合理的測試值 */
export function sampleOptions(opts) {
  const out = {};
  for (const o of opts || []) {
    if (o.type === 1) continue;
    if (o.choices && o.choices.length) { out[o.name] = o.choices[0].value; continue; }
    switch (o.type) {
      case 3: out[o.name] = SAMPLE_STR[o.name] || 'test'; break;
      case 4: out[o.name] = o.min_value != null ? Math.max(o.min_value, Math.min(o.max_value ?? 5, SAMPLE_INT[o.name] ?? 5)) : (SAMPLE_INT[o.name] ?? 5); break;
      case 5: out[o.name] = true; break;
      case 6: out[o.name] = USERS.bob; break;
      case 7: out[o.name] = { id: CHANNEL, name: 'general' }; break;
      case 10: out[o.name] = 1.5; break;
      default: out[o.name] = 'x';
    }
  }
  return out;
}
const SAMPLE_STR = { question: '今天會順利嗎', birthday: '2000/08/31', date: '2000/08/31', text: '我夢到在天上飛然後掉下去', options: '拉麵|咖哩|壽司', expr: '2d6+1', title: 'Tell Your World', thing: '珍珠奶茶', type: 'INFP', a: 'INFP', b: 'ENFJ', name: '協力場數', names: '甲,乙,丙,丁', word: '音樂', sentence: '然後天空亮了起來。', opening: '很久很久以前，有一台機器人。', prize: '一杯手搖', keyword: '早安', emoji: '☀️', label: '開播', reason: '去吃飯', chara: '一歌', with: 'B', amount: '20' };
const SAMPLE_INT = { max: 100, number: 50, bet: 5, count: 3, groups: 2, minutes: 1, seconds: 10, year: 2000, card: 4, winners: 1, set: 3 };
