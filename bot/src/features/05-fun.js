/* 趣味（12）：八號球、幫我選、擲骰、硬幣、投票、你寧願、真心話大冒險、評分、話題、隨機點名、文字接龍、故事接龍 */

import { str, int, sub, user as userOpt } from '../core/opts.js';
import { embed, button, row, cid, COLORS, Style, mention, num, clean, bar, NUM_EMOJI } from '../core/ui.js';
import { dailyRng, scoreOf } from '../core/oracle.js';
import { award } from '../core/helpers.js';
import { TRUTHS, DARES, WYR, TOPICS } from '../content/words.js';

/* ---------- 八號球 ---------- */
const BALL = ['絕對是。', '毫無疑問。', '肯定的。', '你可以相信它。', '看起來是這樣。', '很有可能。', '前景不錯。', '是的。', '跡象指向是。',
  '現在還說不準，再問一次。', '晚點再問。', '現在最好不要告訴你。', '無法預測。', '專心，再問一次。',
  '別指望。', '我的回答是不。', '我的消息來源說不。', '前景不太好。', '非常懷疑。', '想都別想。'];
const eightball = {
  name: 'eightball', description: '神奇八號球：問一個是非題', category: 'fun',
  options: [str('question', '你的問題', { required: true, maxLen: 150 })],
  async run(ctx) {
    const q = (ctx.opt('question') || '').trim();
    const rng = dailyRng(ctx.user.id, '8ball', q);
    const i = rng.int(0, BALL.length - 1);
    await ctx.reply({ embeds: [embed({ title: '🎱 神奇八號球', color: i < 9 ? COLORS.green : i < 14 ? COLORS.gold : COLORS.red, description: `**Q：** ${clean(q)}\n**A：** ${BALL[i]}`, footer: '同一天問同一件事，答案不會變，這就是命運' })] });
  },
};

/* ---------- 幫我選 ---------- */
const choose = {
  name: 'choose', description: '幫我選：用逗號、頓號或空白分開選項', category: 'fun',
  options: [str('options', '例如：拉麵, 咖哩, 壽司', { required: true, maxLen: 200 })],
  async run(ctx) {
    const list = String(ctx.opt('options') || '').split(/[,，、|\/\s]+/).map(s => s.trim()).filter(Boolean);
    if (list.length < 2) return ctx.reply({ content: '至少給我兩個選項。', ephemeral: true });
    const pick = ctx.rng.pick(list);
    await ctx.reply({ content: `🤔 ${list.map(clean).join(' / ')}\n👉 就選 **${clean(pick)}** 吧！` });
  },
};

/* ---------- 擲骰 ---------- */
export function parseDice(expr) {
  const m = /^(\d*)d(\d+)([+-]\d+)?$/i.exec(String(expr || '').replace(/\s/g, '') || 'd6');
  if (!m) return null;
  const n = Math.min(100, Math.max(1, +m[1] || 1)), sides = Math.min(1000, Math.max(2, +m[2])), mod = +(m[3] || 0);
  return { n, sides, mod };
}
const dice = {
  name: 'dice', description: '擲骰子：支援 2d6+3 這種寫法', category: 'fun',
  options: [str('expr', '例如 d20、3d6、2d10+5（預設 d6）', { maxLen: 20 })],
  async run(ctx) {
    const d = parseDice(ctx.opt('expr') || 'd6');
    if (!d) return ctx.reply({ content: '看不懂，試試 d20 或 2d6+3。', ephemeral: true });
    const rolls = Array.from({ length: d.n }, () => ctx.rng.int(1, d.sides));
    const total = rolls.reduce((a, b) => a + b, 0) + d.mod;
    await ctx.reply({ content: `🎲 ${d.n}d${d.sides}${d.mod ? (d.mod > 0 ? '+' : '') + d.mod : ''} → [${rolls.join(', ')}]${d.mod ? ` ${d.mod > 0 ? '+' : ''}${d.mod}` : ''} = **${total}**${d.n === 1 && d.sides === 20 ? (rolls[0] === 20 ? '　🌟 大成功！' : rolls[0] === 1 ? '　💀 大失敗…' : '') : ''}` });
  },
};

/* ---------- 硬幣 ---------- */
const coin = {
  name: 'coin', description: '擲硬幣（可一次擲多枚）', category: 'fun',
  options: [int('count', '幾枚（1～20）', { min: 1, max: 20 })],
  async run(ctx) {
    const n = ctx.opt('count') || 1;
    const r = Array.from({ length: n }, () => ctx.rng.chance(0.5) ? '正面' : '反面');
    const heads = r.filter(x => x === '正面').length;
    await ctx.reply({ content: n === 1 ? `🪙 ${r[0]}！` : `🪙 ${r.join('、')}\n正面 ${heads}、反面 ${n - heads}` });
  },
};

/* ---------- 投票 ---------- */
function pollMsg(pid, p) {
  const total = Object.keys(p.votes).length;
  const counts = p.opts.map((_, i) => Object.values(p.votes).filter(v => v === i).length);
  return {
    embeds: [embed({ title: `📊 ${p.q}`, color: p.closed ? COLORS.grey : COLORS.blue, description: p.opts.map((o, i) => `${NUM_EMOJI[i]} ${o}\n${bar(counts[i], total || 1, 15)} ${counts[i]} 票`).join('\n\n'), footer: `${total} 人投票・${p.closed ? '已結束' : '點下方按鈕投票，可改票'}` })],
    components: p.closed ? [] : [row(...p.opts.map((_, i) => button({ id: cid('poll', 'v', pid, i), label: String(i + 1), emoji: NUM_EMOJI[i], style: Style.primary }))), row(button({ id: cid('poll', 'end', pid), label: '結束投票（發起人）', style: Style.danger }))],
  };
}
const poll = {
  name: 'poll', description: '發起投票（最多 5 個選項，用 | 分開）', category: 'fun',
  options: [str('question', '問題', { required: true, maxLen: 100 }), str('options', '選項，用 | 分開，例如 拉麵|咖哩|壽司', { required: true, maxLen: 300 })],
  async run(ctx) {
    const opts = String(ctx.opt('options') || '').split(/[|｜]/).map(s => s.trim()).filter(Boolean).slice(0, 5);
    if (opts.length < 2) return ctx.reply({ content: '至少兩個選項，用 | 分開。', ephemeral: true });
    const g = ctx.g(); const pid = Date.now().toString(36).slice(-6);
    g.polls[pid] = { q: String(ctx.opt('question')).slice(0, 100), opts, votes: {}, owner: ctx.user.id, closed: false, at: Date.now() };
    for (const k of Object.keys(g.polls)) if (Date.now() - g.polls[k].at > 7 * 86400e3) delete g.polls[k];
    await ctx.reply(pollMsg(pid, g.polls[pid]));
  },
  buttons: {
    async v(ctx) {
      const [pid, iS] = ctx.data; const p = ctx.g().polls[pid];
      if (!p || p.closed) return ctx.reply({ content: '這個投票已結束。', ephemeral: true });
      p.votes[ctx.user.id] = +iS; ctx.store.touch();
      await ctx.update(pollMsg(pid, p));
    },
    async end(ctx) {
      const p = ctx.g().polls[ctx.data[0]]; if (!p) return ctx.reply({ content: '找不到這個投票。', ephemeral: true });
      if (!ctx.isOwner(p.owner) && !ctx.member.admin) return ctx.reply({ content: '只有發起人或管理員能結束。', ephemeral: true });
      p.closed = true; ctx.store.touch();
      await ctx.update(pollMsg(ctx.data[0], p));
    },
  },
};

/* ---------- 你寧願 ---------- */
function wyrMsg(sid, s) {
  const a = s.votes.filter(v => v === 0).length, b = s.votes.length - a;
  return { embeds: [embed({ title: '🤔 你寧願…', color: COLORS.purple, description: `🅰️ **${s.pair[0]}**　${a} 票\n${bar(a, s.votes.length || 1, 15)}\n\n🅱️ **${s.pair[1]}**　${b} 票\n${bar(b, s.votes.length || 1, 15)}`, footer: `${s.votes.length} 人投票` })], components: [row(button({ id: cid('wyr', 'v', sid, 0), label: 'A', emoji: '🅰️', style: Style.primary }), button({ id: cid('wyr', 'v', sid, 1), label: 'B', emoji: '🅱️', style: Style.primary }), button({ id: cid('wyr', 'next'), label: '下一題', style: Style.secondary }))] };
}
const wyr = {
  name: 'wyr', description: '你寧願：二選一，大家一起投', category: 'fun',
  async run(ctx) { const s = { pair: ctx.rng.pick(WYR), votes: [], voters: new Set() }; await ctx.reply(wyrMsg(ctx.bot.sessions.create('wyr', s, 2 * 3600e3), s)); },
  buttons: {
    async v(ctx) {
      const [sid, k] = ctx.data; const s = ctx.bot.sessions.get('wyr', sid);
      if (!s) return ctx.update({ content: '這題已過期。', embeds: [], components: [] });
      if (s.voters.has(ctx.user.id)) return ctx.reply({ content: '你投過了。', ephemeral: true });
      s.voters.add(ctx.user.id); s.votes.push(+k);
      await ctx.update(wyrMsg(sid, s));
    },
    async next(ctx) { const s = { pair: ctx.rng.pick(WYR), votes: [], voters: new Set() }; await ctx.update(wyrMsg(ctx.bot.sessions.create('wyr', s, 2 * 3600e3), s)); },
  },
};

/* ---------- 真心話大冒險 ---------- */
function tdMsg(kind, rng, target) {
  const truth = kind === 'truth';
  return { embeds: [embed({ title: truth ? '💬 真心話' : '🔥 大冒險', color: truth ? COLORS.blue : COLORS.red, description: `${target ? `${mention(target)}，` : ''}${rng.pick(truth ? TRUTHS : DARES)}` })], components: [row(button({ id: cid('truthdare', 'truth'), label: '真心話', style: Style.primary }), button({ id: cid('truthdare', 'dare'), label: '大冒險', style: Style.danger }), button({ id: cid('truthdare', 'random'), label: '隨機', style: Style.secondary }))] };
}
const truthdare = {
  name: 'truthdare', description: '真心話大冒險', category: 'fun',
  options: [str('kind', '哪一種', { choices: [['真心話', 'truth'], ['大冒險', 'dare'], ['隨機', 'random']] }), userOpt('user', '指定誰來回答')],
  async run(ctx) { const k = ctx.opt('kind') || 'random'; await ctx.reply(tdMsg(k === 'random' ? ctx.rng.pick(['truth', 'dare']) : k, ctx.rng, ctx.opt('user') ? ctx.opt('user').id : null)); },
  buttons: {
    async truth(ctx) { await ctx.update(tdMsg('truth', ctx.rng, ctx.user.id)); },
    async dare(ctx) { await ctx.update(tdMsg('dare', ctx.rng, ctx.user.id)); },
    async random(ctx) { await ctx.update(tdMsg(ctx.rng.pick(['truth', 'dare']), ctx.rng, ctx.user.id)); },
  },
};

/* ---------- 評分 ---------- */
const rate = {
  name: 'rate', description: '幫任何東西打分數（0～10，結果固定）', category: 'fun',
  options: [str('thing', '要評分的東西', { required: true, maxLen: 100 })],
  async run(ctx) {
    const t = (ctx.opt('thing') || '').trim();
    const s = scoreOf('rate', t.toLowerCase()) % 101 / 10;
    const c = s >= 9 ? '神作等級。' : s >= 7 ? '很不錯。' : s >= 5 ? '普通，還行。' : s >= 3 ? '有待加強。' : '……我盡力了。';
    await ctx.reply({ content: `📏 我給「${clean(t)}」打 **${s.toFixed(1)} / 10**　${bar(s, 10, 10)}\n${c}` });
  },
};

/* ---------- 話題 ---------- */
const topic = {
  name: 'topic', description: '沒話聊？抽一個聊天話題', category: 'fun',
  async run(ctx) { await ctx.reply({ content: `💬 **${ctx.rng.pick(TOPICS)}**`, components: [row(button({ id: cid('topic', 'next'), label: '換一個', style: Style.secondary }))] }); },
  buttons: { async next(ctx) { await ctx.update({ content: `💬 **${ctx.rng.pick(TOPICS)}**`, components: ctx.message ? ctx.message.components : [] }); } },
};

/* ---------- 隨機點名 ---------- */
const someone = {
  name: 'someone', description: '隨機點一個伺服器成員', category: 'fun',
  options: [str('text', '要對他說的話', { maxLen: 100 })],
  async run(ctx) {
    const list = (await ctx.members()).filter(m => !m.bot);
    if (!list.length) return ctx.reply({ content: '找不到成員（可能還沒載入）。', ephemeral: true });
    const m = ctx.rng.pick(list);
    await ctx.reply({ content: `🎯 ${mention(m.id)}${ctx.opt('text') ? `，${clean(ctx.opt('text'))}` : '，就是你了！'}` });
  },
};

/* ---------- 文字接龍 ---------- */
const lastChar = w => { const s = [...w]; return s[s.length - 1]; };
const firstChar = w => [...w][0];
const wordchain = {
  name: 'wordchain', description: '文字接龍：下一個詞的第一個字要接上一個詞的最後一個字', category: 'fun',
  options: [sub('start', '開始一局（可指定起始詞）', [str('word', '起始詞', { maxLen: 10 })]), sub('play', '接一個詞', [str('word', '你的詞', { required: true, maxLen: 10 })]), sub('status', '看目前狀態'), sub('end', '結束這一局')],
  async run(ctx) {
    const g = ctx.g(); const ch = ctx.channelId;
    if (ctx.sub === 'start') {
      const w = (ctx.opt('word') || ctx.rng.pick(['音樂', '世界', '星星', '未來', '夢想', '奇蹟', '舞台', '天空'])).trim();
      g.chains[ch] = { words: [w], by: {}, last: '' , at: Date.now() };
      return ctx.reply({ content: `🔗 接龍開始！第一個詞：**${clean(w)}**\n用 /wordchain play 接「${lastChar(w)}」開頭的詞。` });
    }
    const c = g.chains[ch];
    if (ctx.sub === 'end') { delete g.chains[ch]; return ctx.reply({ content: c ? `接龍結束，共 ${c.words.length} 個詞：${c.words.map(clean).join(' → ').slice(0, 1500)}` : '這個頻道沒有進行中的接龍。' }); }
    if (!c) return ctx.reply({ content: '這個頻道還沒開始接龍，用 /wordchain start。', ephemeral: true });
    if (ctx.sub === 'status') return ctx.reply({ content: `🔗 目前 ${c.words.length} 個詞，最後是「${clean(c.words[c.words.length - 1])}」，下一個要以「${lastChar(c.words[c.words.length - 1])}」開頭。\n${c.words.slice(-10).map(clean).join(' → ')}` });
    const w = (ctx.opt('word') || '').trim();
    const prev = c.words[c.words.length - 1];
    if (!w) return ctx.reply({ content: '請輸入一個詞。', ephemeral: true });
    if (c.last === ctx.user.id) return ctx.reply({ content: '不能連續接兩次，等別人接。', ephemeral: true });
    if (firstChar(w).toLowerCase() !== lastChar(prev).toLowerCase()) return ctx.reply({ content: `要以「${lastChar(prev)}」開頭才行。`, ephemeral: true });
    if (c.words.includes(w)) return ctx.reply({ content: '這個詞已經出現過了。', ephemeral: true });
    c.words.push(w); c.last = ctx.user.id; c.by[ctx.user.id] = (c.by[ctx.user.id] || 0) + 1; ctx.store.touch();
    award(ctx, 5);
    await ctx.reply({ content: `✅ ${clean(prev)} → **${clean(w)}**（第 ${c.words.length} 個，+5 ${ctx.currency}）下一個接「${lastChar(w)}」。` });
  },
};

/* ---------- 故事接龍 ---------- */
const story = {
  name: 'story', description: '故事接龍：大家一人一句寫故事', category: 'fun',
  options: [sub('start', '開始一個新故事', [str('opening', '開頭句', { required: true, maxLen: 150 })]), sub('add', '接下一句', [str('sentence', '你的句子', { required: true, maxLen: 150 })]), sub('show', '看目前的故事'), sub('end', '結束並公布全文')],
  async run(ctx) {
    const g = ctx.g(); const ch = ctx.channelId;
    if (ctx.sub === 'start') { g.stories[ch] = { lines: [{ u: ctx.user.id, t: String(ctx.opt('opening')).slice(0, 150) }], last: ctx.user.id, at: Date.now() }; return ctx.reply({ content: `📖 故事開始：\n> ${clean(ctx.opt('opening'))}\n用 /story add 接下一句！` }); }
    const s = g.stories[ch];
    if (!s) return ctx.reply({ content: '這個頻道沒有進行中的故事，用 /story start。', ephemeral: true });
    if (ctx.sub === 'add') {
      if (s.last === ctx.user.id) return ctx.reply({ content: '不能連續接兩句，等別人。', ephemeral: true });
      if (s.lines.length >= 60) return ctx.reply({ content: '這個故事已經 60 句了，用 /story end 收尾吧。', ephemeral: true });
      s.lines.push({ u: ctx.user.id, t: String(ctx.opt('sentence')).slice(0, 150) }); s.last = ctx.user.id; ctx.store.touch();
      award(ctx, 5);
      return ctx.reply({ content: `✍️ 第 ${s.lines.length} 句：${clean(ctx.opt('sentence'))}` });
    }
    const text = s.lines.map(l => l.t).join('');
    if (ctx.sub === 'end') { delete g.stories[ch]; const authors = [...new Set(s.lines.map(l => l.u))]; return ctx.reply({ embeds: [embed({ title: '📖 故事全文', color: COLORS.gold, description: text.slice(0, 4000), footer: `${s.lines.length} 句・${authors.length} 位作者` })] }); }
    await ctx.reply({ embeds: [embed({ title: `📖 故事進行中（${s.lines.length} 句）`, color: COLORS.blue, description: s.lines.slice(-12).map(l => `${mention(l.u)}：${clean(l.t)}`).join('\n').slice(0, 4000) })] });
  },
};

export default [eightball, choose, dice, coin, poll, wyr, truthdare, rate, topic, someone, wordchain, story];
