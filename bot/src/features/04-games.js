/* 小遊戲（12）：猜數字、剪刀石頭布、井字、四子棋、21 點、拉霸、比大小、踩地雷、翻牌記憶、猜單字、Wordle、反應速度 */

import { str, int, sub, user as userOpt } from '../core/opts.js';
import { embed, button, row, grid, modal, cid, COLORS, Style, mention, num, clean } from '../core/ui.js';
import { award, gameResult, achievementLine } from '../core/helpers.js';
import { HANGMAN_WORDS, WORDLE_WORDS } from '../content/words.js';

const done = (ctx, uid, won) => achievementLine(gameResult(ctx, won, uid));
/* 對手是機器人時 players 裡放 'bot'，顯示時不能套 mention */
const who = id => id === 'bot' ? '機器人' : mention(id);

/* ---------- 猜數字 ---------- */
/* 進行中的那一局放在玩家紀錄 u.guess（不放模組變數：Workers 版的 DO 休眠後記憶體會清空） */
const guess = {
  name: 'guess', description: '猜數字：機器人想一個數字，你來猜（會提示大小）', category: 'games',
  options: [sub('start', '開始新的一局', [int('max', '範圍上限（預設 100）', { min: 10, max: 10000 })]), sub('try', '猜一個數字', [int('number', '你的猜測', { required: true })]), sub('giveup', '放棄')],
  async run(ctx) {
    const u = ctx.u();
    if (ctx.sub === 'giveup') { const g = u.guess; u.guess = null; ctx.store.touch(); return ctx.reply({ content: g ? `答案是 ${g.n}。下次再來。` : '你沒有進行中的猜數字。' }); }
    if (ctx.sub === 'try') {
      const g = u.guess;
      if (!g) return ctx.reply({ content: '先用 /guess start 開始一局。', ephemeral: true });
      const n = ctx.opt('number'); g.tries++; ctx.store.touch();
      if (n === g.n) { u.guess = null; const r = Math.max(5, 40 - g.tries * 3); award(ctx, r); return ctx.reply({ content: `🎯 答對了！就是 ${g.n}，你猜了 ${g.tries} 次，獲得 ${r} ${ctx.currency}。${done(ctx, ctx.user.id, true)}` }); }
      return ctx.reply({ content: `${n < g.n ? '📈 再大一點' : '📉 再小一點'}（第 ${g.tries} 次，範圍 1～${g.max}）` });
    }
    const max = ctx.opt('max') || 100;
    u.guess = { n: ctx.rng.int(1, max), max, tries: 0 }; ctx.store.touch();
    await ctx.reply({ content: `我想好了一個 1～${max} 的數字，用 /guess try 來猜！` });
  },
};

/* ---------- 剪刀石頭布 ---------- */
const RPS = { rock: ['✊', '石頭'], paper: ['✋', '布'], scissors: ['✌️', '剪刀'] };
const beats = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const rps = {
  name: 'rps', description: '剪刀石頭布：跟機器人或指定的人對戰', category: 'games',
  options: [userOpt('opponent', '對手（不填就跟機器人）')],
  async run(ctx) {
    const o = ctx.opt('opponent');
    if (o && o.id !== ctx.user.id && !o.bot) {
      const sid = ctx.bot.sessions.create('rps', { a: ctx.user.id, b: o.id, an: ctx.user.name, bn: o.name, picks: {} });
      return ctx.reply({ content: `✊✋✌️ ${mention(ctx.user.id)} 向 ${mention(o.id)} 下戰帖！兩位請出拳（別人看不到你出什麼）。`, components: [row(...Object.entries(RPS).map(([k, [e, n]]) => button({ id: cid('rps', 'pvp', sid, k), label: n, emoji: e, style: Style.primary })))] });
    }
    await ctx.reply({ content: `✊✋✌️ 出拳吧，${mention(ctx.user.id)}！`, components: [row(...Object.entries(RPS).map(([k, [e, n]]) => button({ id: cid('rps', 'bot', ctx.user.id, k), label: n, emoji: e, style: Style.primary })))] });
  },
  buttons: {
    async bot(ctx) {
      const [owner, mine] = ctx.data;
      if (!ctx.isOwner(owner)) return ctx.reply({ content: '想玩請自己用 /rps。', ephemeral: true });
      const b = ctx.rng.pick(Object.keys(RPS));
      const r = mine === b ? 0 : beats[mine] === b ? 1 : -1;
      if (r === 1) award(ctx, 10);
      await ctx.update({ content: `你出 ${RPS[mine][0]}，我出 ${RPS[b][0]}。${r === 0 ? '平手！' : r === 1 ? `你贏了，+10 ${ctx.currency}！` : '我贏了～'}${r === 0 ? '' : done(ctx, ctx.user.id, r === 1)}`, components: [row(button({ id: cid('rps', 'again', owner), label: '再來一局', style: Style.secondary }))] });
    },
    async again(ctx) {
      if (!ctx.isOwner(ctx.data[0])) return ctx.reply({ content: '想玩請自己用 /rps。', ephemeral: true });
      await ctx.update({ content: `✊✋✌️ 出拳吧，${mention(ctx.user.id)}！`, components: [row(...Object.entries(RPS).map(([k, [e, n]]) => button({ id: cid('rps', 'bot', ctx.user.id, k), label: n, emoji: e, style: Style.primary })))] });
    },
    async pvp(ctx) {
      const [sid, pick] = ctx.data;
      const s = ctx.bot.sessions.get('rps', sid);
      if (!s) return ctx.update({ content: '這場對戰已過期。', components: [] });
      if (ctx.user.id !== s.a && ctx.user.id !== s.b) return ctx.reply({ content: '你不是這場的玩家。', ephemeral: true });
      s.picks[ctx.user.id] = pick;
      if (!s.picks[s.a] || !s.picks[s.b]) return ctx.reply({ content: `你出了 ${RPS[pick][0]}，等對方。`, ephemeral: true });
      ctx.bot.sessions.del('rps', sid);
      const pa = s.picks[s.a], pb = s.picks[s.b];
      const r = pa === pb ? 0 : beats[pa] === pb ? 1 : -1;
      let text = `${mention(s.a)} 出 ${RPS[pa][0]}，${mention(s.b)} 出 ${RPS[pb][0]}。`;
      if (r === 0) text += '平手！';
      else { const w = r === 1 ? s.a : s.b, l = r === 1 ? s.b : s.a; award(ctx, 20, w); text += `${mention(w)} 獲勝，+20 ${ctx.currency}！${done(ctx, w, true)}${done(ctx, l, false)}`; }
      await ctx.update({ content: text, components: [] });
    },
  },
};

/* ---------- 井字遊戲 ---------- */
const WIN3 = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
export function tttWinner(b) { for (const [x, y, z] of WIN3) if (b[x] && b[x] === b[y] && b[x] === b[z]) return b[x]; return b.every(Boolean) ? 'draw' : null; }
export function tttBot(b, me = 'O', op = 'X') {
  const empty = b.map((v, i) => v ? -1 : i).filter(i => i >= 0);
  for (const who of [me, op]) for (const i of empty) { const t = b.slice(); t[i] = who; if (tttWinner(t) === who) return i; }
  if (!b[4]) return 4;
  const corners = [0, 2, 6, 8].filter(i => !b[i]);
  return corners.length ? corners[Math.floor(Math.random() * corners.length)] : empty[Math.floor(Math.random() * empty.length)];
}
export function tttMsg(sid, s, over) {
  const mark = { X: '❌', O: '⭕' };
  const w = tttWinner(s.board);
  const header = over ? (w === 'draw' ? '🤝 平手！' : `🏆 ${who(s.players[w])} 獲勝！`) : `輪到 ${who(s.players[s.turn])}（${mark[s.turn]}）`;
  const rows = grid(s.board.map((v, i) => button({ id: cid('tictactoe', 'mv', sid, i), label: v ? mark[v] : '　', style: v === 'X' ? Style.danger : v === 'O' ? Style.success : Style.secondary, disabled: over || !!v })), 3);
  return { content: `⭕❌ 井字遊戲　${who(s.players.X)} vs ${who(s.players.O)}\n${header}`, components: rows };
}
const tictactoe = {
  name: 'tictactoe', description: '井字遊戲：跟機器人或指定的人下', category: 'games',
  options: [userOpt('opponent', '對手（不填就跟機器人）')],
  async run(ctx) {
    const o = ctx.opt('opponent');
    const vsBot = !o || o.id === ctx.user.id || o.bot;
    const s = { board: Array(9).fill(''), players: { X: ctx.user.id, O: vsBot ? 'bot' : o.id }, turn: 'X' };
    const sid = ctx.bot.sessions.create('tictactoe', s);
    await ctx.reply(tttMsg(sid, s, false));
  },
  buttons: {
    async mv(ctx) {
      const [sid, iS] = ctx.data;
      const s = ctx.bot.sessions.get('tictactoe', sid);
      if (!s) return ctx.update({ content: '這局已過期。', components: [] });
      if (ctx.user.id !== s.players[s.turn]) return ctx.reply({ content: '還沒輪到你。', ephemeral: true });
      const i = +iS; if (s.board[i]) return ctx.defer();
      s.board[i] = s.turn; s.turn = s.turn === 'X' ? 'O' : 'X';
      if (!tttWinner(s.board) && s.players.O === 'bot') { s.board[tttBot(s.board)] = 'O'; s.turn = 'X'; }
      const w = tttWinner(s.board);
      if (w) {
        ctx.bot.sessions.del('tictactoe', sid);
        let extra = '';
        if (w !== 'draw') { const win = s.players[w], lose = s.players[w === 'X' ? 'O' : 'X']; if (win !== 'bot') { award(ctx, 15, win); extra += done(ctx, win, true); } if (lose !== 'bot') extra += done(ctx, lose, false); }
        const m = tttMsg(sid, s, true); m.content += extra; return ctx.update(m);
      }
      await ctx.update(tttMsg(sid, s, false));
    },
  },
};

/* ---------- 四子棋 ---------- */
const C4W = 7, C4H = 6;
export function c4Winner(b) {
  const at = (c, r) => (r < 0 || r >= C4H || c < 0 || c >= C4W) ? '' : b[r * C4W + c];
  for (let r = 0; r < C4H; r++) for (let c = 0; c < C4W; c++) {
    const v = at(c, r); if (!v) continue;
    for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) if ([1, 2, 3].every(k => at(c + dc * k, r + dr * k) === v)) return v;
  }
  return b.every(Boolean) ? 'draw' : null;
}
export function c4Drop(b, col, who) { for (let r = 0; r < C4H; r++) if (!b[r * C4W + col]) { b[r * C4W + col] = who; return r; } return -1; }
export function c4Bot(b, me = 'Y', op = 'R') {
  const cols = [...Array(C4W).keys()].filter(c => !b[(C4H - 1) * C4W + c]);
  for (const who of [me, op]) for (const c of cols) { const t = b.slice(); c4Drop(t, c, who); if (c4Winner(t) === who) return c; }
  const pref = [3, 2, 4, 1, 5, 0, 6].filter(c => cols.includes(c));
  return pref[Math.floor(Math.random() * Math.min(3, pref.length))];
}
export function c4Msg(sid, s, over) {
  const w = c4Winner(s.board);
  const cell = { R: '🔴', Y: '🟡', '': '⚪' };
  let text = '';
  for (let r = C4H - 1; r >= 0; r--) { for (let c = 0; c < C4W; c++) text += cell[s.board[r * C4W + c]]; text += '\n'; }
  text += '1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣';
  const header = over ? (w === 'draw' ? '🤝 平手！' : `🏆 ${who(s.players[w])} 獲勝！`) : `輪到 ${who(s.players[s.turn])}（${cell[s.turn]}）`;
  const buttons = [...Array(C4W).keys()].map(c => button({ id: cid('connect4', 'drop', sid, c), label: String(c + 1), style: Style.secondary, disabled: over || !!s.board[(C4H - 1) * C4W + c] }));
  return { content: `🔴🟡 四子棋　${who(s.players.R)} vs ${who(s.players.Y)}\n${header}\n${text}`, components: [row(...buttons.slice(0, 4)), row(...buttons.slice(4))] };
}
const connect4 = {
  name: 'connect4', description: '四子棋：跟機器人或指定的人對戰', category: 'games',
  options: [userOpt('opponent', '對手（不填就跟機器人）')],
  async run(ctx) {
    const o = ctx.opt('opponent'); const vsBot = !o || o.id === ctx.user.id || o.bot;
    const s = { board: Array(C4W * C4H).fill(''), players: { R: ctx.user.id, Y: vsBot ? 'bot' : o.id }, turn: 'R' };
    const sid = ctx.bot.sessions.create('connect4', s);
    await ctx.reply(c4Msg(sid, s, false));
  },
  buttons: {
    async drop(ctx) {
      const [sid, cS] = ctx.data;
      const s = ctx.bot.sessions.get('connect4', sid);
      if (!s) return ctx.update({ content: '這局已過期。', components: [] });
      if (ctx.user.id !== s.players[s.turn]) return ctx.reply({ content: '還沒輪到你。', ephemeral: true });
      if (c4Drop(s.board, +cS, s.turn) < 0) return ctx.defer();
      s.turn = s.turn === 'R' ? 'Y' : 'R';
      if (!c4Winner(s.board) && s.players.Y === 'bot') { c4Drop(s.board, c4Bot(s.board), 'Y'); s.turn = 'R'; }
      const w = c4Winner(s.board);
      if (w) {
        ctx.bot.sessions.del('connect4', sid);
        let extra = '';
        if (w !== 'draw') { const win = s.players[w], lose = s.players[w === 'R' ? 'Y' : 'R']; if (win !== 'bot') { award(ctx, 25, win); extra += done(ctx, win, true); } if (lose !== 'bot') extra += done(ctx, lose, false); }
        const m = c4Msg(sid, s, true); m.content += extra; return ctx.update(m);
      }
      await ctx.update(c4Msg(sid, s, false));
    },
  },
};

/* ---------- 21 點 ---------- */
const SUITS = ['♠', '♥', '♦', '♣'], RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export function newDeck(rng) { const d = []; for (const s of SUITS) for (const r of RANKS) d.push(r + s); return rng.shuffle(d); }
export function handValue(hand) {
  let v = 0, aces = 0;
  for (const c of hand) { const r = c.slice(0, -1); if (r === 'A') { aces++; v += 11; } else if (['J', 'Q', 'K'].includes(r)) v += 10; else v += +r; }
  while (v > 21 && aces) { v -= 10; aces--; }
  return v;
}
function bjMsg(sid, s, over, result = '') {
  const dealer = over ? s.dealer.join(' ') + ` (${handValue(s.dealer)})` : s.dealer[0] + ' 🂠';
  return {
    embeds: [embed({ title: `🃏 21 點${s.bet ? `・押 ${num(s.bet)}` : ''}`, color: over ? (result.startsWith('🎉') ? COLORS.green : result.startsWith('🤝') ? COLORS.grey : COLORS.red) : COLORS.dark, fields: [{ name: '莊家', value: dealer }, { name: `${s.name}`, value: s.player.join(' ') + ` (${handValue(s.player)})` }], description: result || undefined })],
    components: over ? [row(button({ id: cid('blackjack', 'again', s.owner, s.bet), label: '再玩一局', style: Style.secondary }))] : [row(button({ id: cid('blackjack', 'hit', sid), label: '要牌', style: Style.primary }), button({ id: cid('blackjack', 'stand', sid), label: '停牌', style: Style.success }), button({ id: cid('blackjack', 'double', sid), label: '加倍', style: Style.danger, disabled: s.player.length !== 2 }))],
  };
}
function bjStart(ctx, bet, owner = ctx.user.id, name = ctx.user.name) {
  const rng = ctx.rng; const deck = newDeck(rng);
  const s = { deck, player: [deck.pop(), deck.pop()], dealer: [deck.pop(), deck.pop()], bet, owner, name };
  const sid = ctx.bot.sessions.create('blackjack', s);
  if (handValue(s.player) === 21) return bjSettle(ctx, sid, s, true);
  return bjMsg(sid, s, false);
}
function bjSettle(ctx, sid, s, natural = false) {
  ctx.bot.sessions.del('blackjack', sid);
  while (handValue(s.dealer) < 17) s.dealer.push(s.deck.pop());
  const p = handValue(s.player), d = handValue(s.dealer);
  let result, delta;
  if (natural && d !== 21) { result = '🎉 Blackjack！'; delta = Math.floor(s.bet * 1.5); }
  else if (p > 21) { result = '💥 爆牌，你輸了。'; delta = -s.bet; }
  else if (d > 21 || p > d) { result = '🎉 你贏了！'; delta = s.bet; }
  else if (p === d) { result = '🤝 平手，退回押注。'; delta = 0; }
  else { result = '😢 莊家贏了。'; delta = -s.bet; }
  if (delta) award(ctx, delta, s.owner);
  result += delta ? `（${delta > 0 ? '+' : ''}${num(delta)} ${ctx.currency}）` : '';
  result += done(ctx, s.owner, delta > 0);
  return bjMsg(sid, s, true, result);
}
const blackjack = {
  name: 'blackjack', description: '21 點：要牌、停牌、加倍，可以押水晶', category: 'games',
  options: [int('bet', '押注（可 0）', { min: 0, max: 100000 })],
  async run(ctx) {
    const bet = ctx.opt('bet') || 0;
    if (bet > ctx.u().crystals) return ctx.reply({ content: `你只有 ${num(ctx.u().crystals)} ${ctx.currency}。`, ephemeral: true });
    await ctx.reply(bjStart(ctx, bet));
  },
  buttons: {
    async hit(ctx) {
      const s = ctx.bot.sessions.get('blackjack', ctx.data[0]); if (!s) return ctx.update({ content: '這局已過期。', embeds: [], components: [] });
      if (!ctx.isOwner(s.owner)) return ctx.reply({ content: '這不是你的牌局。', ephemeral: true });
      s.player.push(s.deck.pop());
      if (handValue(s.player) > 21) return ctx.update(bjSettle(ctx, ctx.data[0], s));
      await ctx.update(bjMsg(ctx.data[0], s, false));
    },
    async stand(ctx) {
      const s = ctx.bot.sessions.get('blackjack', ctx.data[0]); if (!s) return ctx.update({ content: '這局已過期。', embeds: [], components: [] });
      if (!ctx.isOwner(s.owner)) return ctx.reply({ content: '這不是你的牌局。', ephemeral: true });
      await ctx.update(bjSettle(ctx, ctx.data[0], s));
    },
    async double(ctx) {
      const s = ctx.bot.sessions.get('blackjack', ctx.data[0]); if (!s) return ctx.update({ content: '這局已過期。', embeds: [], components: [] });
      if (!ctx.isOwner(s.owner)) return ctx.reply({ content: '這不是你的牌局。', ephemeral: true });
      if (s.player.length !== 2) return ctx.defer();
      if (s.bet * 2 > ctx.u().crystals) return ctx.reply({ content: `${ctx.currency}不夠加倍。`, ephemeral: true });
      s.bet *= 2; s.player.push(s.deck.pop());
      await ctx.update(bjSettle(ctx, ctx.data[0], s));
    },
    async again(ctx) {
      const [owner, betS] = ctx.data; if (!ctx.isOwner(owner)) return ctx.reply({ content: '想玩請自己用 /blackjack。', ephemeral: true });
      const bet = Math.min(+betS || 0, ctx.u().crystals);
      await ctx.update(bjStart(ctx, bet));
    },
  },
};

/* ---------- 拉霸 ---------- */
const REELS = [['🍒', 30], ['🍋', 25], ['🔔', 18], ['⭐', 12], ['💎', 8], ['7️⃣', 4]];
const PAY3 = { '🍒': 5, '🍋': 6, '🔔': 10, '⭐': 20, '💎': 50, '7️⃣': 100 };
export function spinSlots(rng) { return [0, 1, 2].map(() => rng.weighted(REELS)); }
/* 期望回收率約 88%：三同依表，兩同退回押注 */
export function slotPayout(r, bet) { if (r[0] === r[1] && r[1] === r[2]) return bet * PAY3[r[0]]; if (r[0] === r[1] || r[1] === r[2] || r[0] === r[2]) return bet; return 0; }
function slotsPlay(ctx, bet) {
  const u = ctx.u();
  if (bet > u.crystals) return { content: `你只有 ${num(u.crystals)} ${ctx.currency}。`, embeds: [], components: [] };
  const r = spinSlots(ctx.rng); const win = slotPayout(r, bet);
  award(ctx, win - bet);
  const three = r[0] === r[1] && r[1] === r[2];
  return { embeds: [embed({ title: '🎰 拉霸', color: win > bet ? COLORS.gold : COLORS.grey, description: `**${r.join(' │ ')}**\n\n${three ? `🎉 三個 ${r[0]}！` : win ? '兩個一樣，退回押注。' : '沒中。'} ${win > bet ? `贏得 ${num(win)}` : win ? '不賺不賠' : `損失 ${num(bet)}`} ${ctx.currency}（餘額 ${num(ctx.u().crystals)}）${done(ctx, ctx.user.id, win > bet)}`, footer: '賠率：三同 🍒5 🍋6 🔔10 ⭐20 💎50 7️⃣100 倍，兩同退回押注' })], components: [row(button({ id: cid('slots', 'spin', ctx.user.id, bet), label: `再轉（${bet}）`, style: Style.primary, emoji: '🎰' }))] };
}
const slots = {
  name: 'slots', description: '拉霸機：押注轉一把', category: 'games',
  options: [int('bet', '押注（預設 10）', { min: 1, max: 10000 })],
  async run(ctx) { await ctx.reply(slotsPlay(ctx, ctx.opt('bet') || 10)); },
  buttons: { async spin(ctx) { const [owner, bet] = ctx.data; if (!ctx.isOwner(owner)) return ctx.reply({ content: '想玩請自己用 /slots。', ephemeral: true }); await ctx.update(slotsPlay(ctx, +bet || 10)); } },
};

/* ---------- 比大小 ---------- */
const CARD = n => RANKS[n - 1];
function hiloMsg(sid, s, text) {
  return { embeds: [embed({ title: `🔼🔽 比大小・彩池 ${num(s.pot)}`, color: COLORS.orange, description: `目前的牌：**${CARD(s.cur)}**\n下一張會比它大還是小？（A 最小、K 最大，同點數重抽）\n${text || ''}` })], components: [row(button({ id: cid('hilo', 'hi', sid), label: '更大', style: Style.primary, emoji: '🔼' }), button({ id: cid('hilo', 'lo', sid), label: '更小', style: Style.primary, emoji: '🔽' }), button({ id: cid('hilo', 'cash', sid), label: `收手拿 ${num(s.pot)}`, style: Style.success, disabled: s.streak === 0 }))] };
}
const hilo = {
  name: 'hilo', description: '比大小：連續猜對彩池越滾越大，隨時可以收手', category: 'games',
  options: [int('bet', '押注（預設 10）', { min: 1, max: 10000 })],
  async run(ctx) {
    const bet = ctx.opt('bet') || 10;
    if (bet > ctx.u().crystals) return ctx.reply({ content: `你只有 ${num(ctx.u().crystals)} ${ctx.currency}。`, ephemeral: true });
    award(ctx, -bet);
    const s = { owner: ctx.user.id, bet, pot: bet, cur: ctx.rng.int(1, 13), streak: 0 };
    const sid = ctx.bot.sessions.create('hilo', s);
    await ctx.reply(hiloMsg(sid, s));
  },
  buttons: {
    async hi(ctx) { return hiloGuess(ctx, true); }, async lo(ctx) { return hiloGuess(ctx, false); },
    async cash(ctx) {
      const s = ctx.bot.sessions.get('hilo', ctx.data[0]); if (!s) return ctx.update({ content: '這局已過期。', embeds: [], components: [] });
      if (!ctx.isOwner(s.owner)) return ctx.reply({ content: '這不是你的牌局。', ephemeral: true });
      ctx.bot.sessions.del('hilo', ctx.data[0]); award(ctx, s.pot);
      await ctx.update({ embeds: [embed({ title: '💰 收手', color: COLORS.green, description: `連對 ${s.streak} 次，帶走 ${num(s.pot)} ${ctx.currency}！${done(ctx, ctx.user.id, s.pot > s.bet)}` })], components: [] });
    },
  },
};
async function hiloGuess(ctx, higher) {
  const s = ctx.bot.sessions.get('hilo', ctx.data[0]); if (!s) return ctx.update({ content: '這局已過期。', embeds: [], components: [] });
  if (!ctx.isOwner(s.owner)) return ctx.reply({ content: '這不是你的牌局。', ephemeral: true });
  let next = ctx.rng.int(1, 13); while (next === s.cur) next = ctx.rng.int(1, 13);
  const ok = higher ? next > s.cur : next < s.cur;
  if (!ok) { ctx.bot.sessions.del('hilo', ctx.data[0]); return ctx.update({ embeds: [embed({ title: '💥 猜錯了', color: COLORS.red, description: `下一張是 **${CARD(next)}**，彩池 ${num(s.pot)} 沒了。${done(ctx, ctx.user.id, false)}` })], components: [] }); }
  s.streak++; s.pot = Math.floor(s.pot * 1.5) + 1; s.cur = next;
  await ctx.update(hiloMsg(ctx.data[0], s, `✅ 猜對了！連對 ${s.streak} 次。`));
}

/* ---------- 踩地雷 ---------- */
const MW = 5, MH = 5, MINES = 4;
export function makeMines(rng, safe) { const cells = [...Array(MW * MH).keys()].filter(i => i !== safe); return new Set(rng.sample(cells, MINES)); }
export function neighbors(i) { const x = i % MW, y = Math.floor(i / MW); const out = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx >= 0 && nx < MW && ny >= 0 && ny < MH) out.push(ny * MW + nx); } return out; }
export function reveal(s, i) {
  const stack = [i];
  while (stack.length) { const c = stack.pop(); if (s.open.has(c) || s.mines.has(c)) continue; s.open.add(c); const n = neighbors(c).filter(k => s.mines.has(k)).length; if (n === 0) for (const k of neighbors(c)) if (!s.open.has(k)) stack.push(k); }
}
function mineMsg(sid, s, over, boom = -1) {
  const btns = [...Array(MW * MH).keys()].map(i => {
    const open = s.open.has(i) || (over && s.mines.has(i));
    let label = '　', style = Style.secondary;
    if (over && s.mines.has(i)) { label = '💣'; style = i === boom ? Style.danger : Style.secondary; }
    else if (s.open.has(i)) { const n = neighbors(i).filter(k => s.mines.has(k)).length; label = n ? String(n) : '·'; style = Style.success; }
    else if (!over) style = Style.primary;
    return button({ id: cid('minesweeper', 'open', sid, i), label, style, disabled: over || open });
  });
  const left = MW * MH - MINES - s.open.size;
  return { content: `💣 踩地雷 5×5，${MINES} 顆雷　${mention(s.owner)}\n${over ? (boom >= 0 ? '💥 踩到了！' : '🎉 全部清完，太厲害了！') : `還剩 ${left} 格安全區`}${over ? s.extra || '' : ''}`, components: grid(btns, 5) };
}
const minesweeper = {
  name: 'minesweeper', description: '踩地雷：5×5、4 顆雷，第一步保證安全', category: 'games',
  async run(ctx) {
    const s = { owner: ctx.user.id, mines: null, open: new Set() };
    const sid = ctx.bot.sessions.create('minesweeper', s);
    await ctx.reply(mineMsg(sid, s, false));
  },
  buttons: {
    async open(ctx) {
      const [sid, iS] = ctx.data; const s = ctx.bot.sessions.get('minesweeper', sid);
      if (!s) return ctx.update({ content: '這局已過期。', components: [] });
      if (!ctx.isOwner(s.owner)) return ctx.reply({ content: '這不是你的雷區。', ephemeral: true });
      const i = +iS;
      if (!s.mines) s.mines = makeMines(ctx.rng, i);
      if (s.mines.has(i)) { ctx.bot.sessions.del('minesweeper', sid); s.extra = done(ctx, ctx.user.id, false); return ctx.update(mineMsg(sid, s, true, i)); }
      reveal(s, i);
      if (s.open.size === MW * MH - MINES) { ctx.bot.sessions.del('minesweeper', sid); award(ctx, 40); s.extra = `　+40 ${ctx.currency}` + done(ctx, ctx.user.id, true); return ctx.update(mineMsg(sid, s, true)); }
      await ctx.update(mineMsg(sid, s, false));
    },
  },
};

/* ---------- 翻牌記憶 ---------- */
const MEMO = ['🍎', '🍇', '🍉', '🍓', '🍒', '🥝', '🍑', '🍍'];
function memoMsg(sid, s, over) {
  const btns = s.cards.map((c, i) => { const show = s.matched.has(i) || s.up.includes(i); return button({ id: cid('memory', 'flip', sid, i), label: show ? c : '❔', style: s.matched.has(i) ? Style.success : show ? Style.primary : Style.secondary, disabled: over || s.matched.has(i) }); });
  return { content: `🃏 翻牌記憶　${mention(s.owner)}　翻了 ${s.moves} 次${over ? `\n🎉 全部配對完成！${s.extra || ''}` : ''}`, components: grid(btns, 4) };
}
const memory = {
  name: 'memory', description: '翻牌記憶：4×4 找出 8 組配對，越少步越多獎勵', category: 'games',
  async run(ctx) {
    const s = { owner: ctx.user.id, cards: ctx.rng.shuffle([...MEMO, ...MEMO]), matched: new Set(), up: [], moves: 0 };
    const sid = ctx.bot.sessions.create('memory', s);
    await ctx.reply(memoMsg(sid, s, false));
  },
  buttons: {
    async flip(ctx) {
      const [sid, iS] = ctx.data; const s = ctx.bot.sessions.get('memory', sid);
      if (!s) return ctx.update({ content: '這局已過期。', components: [] });
      if (!ctx.isOwner(s.owner)) return ctx.reply({ content: '這不是你的牌。', ephemeral: true });
      const i = +iS; if (s.matched.has(i) || s.up.includes(i)) return ctx.defer();
      if (s.up.length === 2) s.up = [];
      s.up.push(i);
      if (s.up.length === 2) { s.moves++; if (s.cards[s.up[0]] === s.cards[s.up[1]]) { s.matched.add(s.up[0]); s.matched.add(s.up[1]); s.up = []; } }
      if (s.matched.size === 16) { ctx.bot.sessions.del('memory', sid); const r = Math.max(10, 60 - s.moves * 2); award(ctx, r); s.extra = `+${r} ${ctx.currency}` + done(ctx, ctx.user.id, true); return ctx.update(memoMsg(sid, s, true)); }
      await ctx.update(memoMsg(sid, s, false));
    },
  },
};

/* ---------- 猜單字 ---------- */
const HANG = ['', '😶', '😐', '😟', '😰', '😱', '💀'];
function hangMsg(sid, s, over) {
  const shown = s.word.split('').map(ch => s.guessed.has(ch) ? ch : '＿').join(' ');
  const status = over ? (s.won ? `🎉 答對了！${s.extra || ''}` : `💀 失敗，答案是 **${s.word}**${s.extra || ''}`) : `${HANG[s.wrong]} 錯誤 ${s.wrong}/6`;
  return { content: `🔤 猜單字　${mention(s.owner)}\n\`${shown}\`\n已猜：${[...s.guessed].sort().join(' ') || '（無）'}\n${status}`, components: over ? [] : [row(button({ id: cid('hangman', 'open', sid), label: '猜一個字母或整個字', style: Style.primary }))] };
}
const hangman = {
  name: 'hangman', description: '猜單字（音樂與世界計畫主題的英文字）', category: 'games',
  async run(ctx) {
    const s = { owner: ctx.user.id, word: ctx.rng.pick(HANGMAN_WORDS), guessed: new Set(), wrong: 0 };
    const sid = ctx.bot.sessions.create('hangman', s);
    await ctx.reply(hangMsg(sid, s, false));
  },
  buttons: {
    async open(ctx) {
      const s = ctx.bot.sessions.get('hangman', ctx.data[0]); if (!s) return ctx.update({ content: '這局已過期。', components: [] });
      if (!ctx.isOwner(s.owner)) return ctx.reply({ content: '這不是你的遊戲。', ephemeral: true });
      await ctx.showModal(modal({ id: cid('hangman', 'guess', ctx.data[0]), title: '猜單字', fields: [{ id: 'g', label: '一個字母，或直接猜整個單字', max: 20 }] }));
    },
  },
  modals: {
    async guess(ctx) {
      const s = ctx.bot.sessions.get('hangman', ctx.data[0]); if (!s) return ctx.update({ content: '這局已過期。', components: [] });
      const g = String(ctx.fields.g || '').toUpperCase().replace(/[^A-Z]/g, '');
      if (!g) return ctx.reply({ content: '請輸入英文字母。', ephemeral: true });
      if (g.length > 1) { if (g === s.word) { for (const ch of s.word) s.guessed.add(ch); } else s.wrong++; }
      else { if (s.guessed.has(g)) return ctx.reply({ content: '這個字母猜過了。', ephemeral: true }); s.guessed.add(g); if (!s.word.includes(g)) s.wrong++; }
      const won = s.word.split('').every(ch => s.guessed.has(ch));
      if (won || s.wrong >= 6) { ctx.bot.sessions.del('hangman', ctx.data[0]); s.won = won; if (won) { award(ctx, 30); s.extra = `　+30 ${ctx.currency}`; } s.extra = (s.extra || '') + done(ctx, ctx.user.id, won); return ctx.update(hangMsg(ctx.data[0], s, true)); }
      await ctx.update(hangMsg(ctx.data[0], s, false));
    },
  },
};

/* ---------- Wordle ---------- */
export function wordleScore(answer, g) {
  const res = Array(5).fill('⬛'); const left = {};
  for (let i = 0; i < 5; i++) { if (g[i] === answer[i]) res[i] = '🟩'; else left[answer[i]] = (left[answer[i]] || 0) + 1; }
  for (let i = 0; i < 5; i++) if (res[i] !== '🟩' && left[g[i]]) { res[i] = '🟨'; left[g[i]]--; }
  return res.join('');
}
function wordleMsg(sid, s, over) {
  const rows = s.tries.map(([g, r]) => `${r}  \`${g.toUpperCase()}\``);
  for (let i = s.tries.length; i < 6; i++) rows.push('⬜⬜⬜⬜⬜');
  const status = over ? (s.won ? `🎉 ${s.tries.length} 次猜中！${s.extra || ''}` : `💀 答案是 **${s.answer.toUpperCase()}**${s.extra || ''}`) : `第 ${s.tries.length + 1}/6 次`;
  return { content: `🟩 Wordle　${mention(s.owner)}\n${rows.join('\n')}\n${status}`, components: over ? [] : [row(button({ id: cid('wordle', 'open', sid), label: '猜一個五字母英文字', style: Style.primary }))] };
}
const wordle = {
  name: 'wordle', description: 'Wordle：六次機會猜出五字母英文單字', category: 'games',
  async run(ctx) {
    const s = { owner: ctx.user.id, answer: ctx.rng.pick(WORDLE_WORDS), tries: [] };
    const sid = ctx.bot.sessions.create('wordle', s);
    await ctx.reply(wordleMsg(sid, s, false));
  },
  buttons: {
    async open(ctx) {
      const s = ctx.bot.sessions.get('wordle', ctx.data[0]); if (!s) return ctx.update({ content: '這局已過期。', components: [] });
      if (!ctx.isOwner(s.owner)) return ctx.reply({ content: '這不是你的遊戲。', ephemeral: true });
      await ctx.showModal(modal({ id: cid('wordle', 'guess', ctx.data[0]), title: 'Wordle', fields: [{ id: 'g', label: '五字母英文單字', max: 5, min: 5 }] }));
    },
  },
  modals: {
    async guess(ctx) {
      const s = ctx.bot.sessions.get('wordle', ctx.data[0]); if (!s) return ctx.update({ content: '這局已過期。', components: [] });
      const g = String(ctx.fields.g || '').toLowerCase().replace(/[^a-z]/g, '');
      if (g.length !== 5) return ctx.reply({ content: '要剛好五個英文字母。', ephemeral: true });
      s.tries.push([g, wordleScore(s.answer, g)]);
      const won = g === s.answer;
      if (won || s.tries.length >= 6) { ctx.bot.sessions.del('wordle', ctx.data[0]); s.won = won; if (won) { const r = 70 - s.tries.length * 10; award(ctx, r); s.extra = `　+${r} ${ctx.currency}`; } s.extra = (s.extra || '') + done(ctx, ctx.user.id, won); return ctx.update(wordleMsg(ctx.data[0], s, true)); }
      await ctx.update(wordleMsg(ctx.data[0], s, false));
    },
  },
};

/* ---------- 反應速度 ---------- */
const reaction = {
  name: 'reaction', description: '反應速度測試：按鈕變綠的瞬間按下去，比誰快', category: 'games',
  async run(ctx) {
    const s = { owner: ctx.user.id, go: 0 };
    const sid = ctx.bot.sessions.create('reaction', s, 5 * 60e3);
    await ctx.reply({ content: `⏱️ ${mention(ctx.user.id)} 準備… 按鈕變成 **綠色** 的瞬間按下去！`, components: [row(button({ id: cid('reaction', 'hit', sid), label: '等一下…', style: Style.danger }))] });
    const delay = ctx.rng.int(1500, 5000);
    ctx.bot.timers.after(delay, async () => {
      const live = ctx.bot.sessions.get('reaction', sid); if (!live || live.done) return;
      live.go = Date.now();
      await ctx.edit({ content: `⏱️ ${mention(ctx.user.id)} 就是現在！`, components: [row(button({ id: cid('reaction', 'hit', sid), label: '按！', style: Style.success }))] });
    });
  },
  buttons: {
    async hit(ctx) {
      const s = ctx.bot.sessions.get('reaction', ctx.data[0]); if (!s) return ctx.update({ content: '已過期。', components: [] });
      if (!ctx.isOwner(s.owner)) return ctx.reply({ content: '這不是你的測試。', ephemeral: true });
      s.done = true; ctx.bot.sessions.del('reaction', ctx.data[0]);
      if (!s.go) return ctx.update({ content: `🚫 ${mention(ctx.user.id)} 偷跑！按鈕還沒變綠。`, components: [] });
      const ms = Date.now() - s.go; const u = ctx.u();
      const best = u.bestReaction && u.bestReaction < ms ? u.bestReaction : ms; u.bestReaction = best;
      const grade = ms < 200 ? '⚡ 閃電' : ms < 300 ? '🔥 很快' : ms < 450 ? '👍 不錯' : '🐢 再練練';
      await ctx.update({ content: `⏱️ ${mention(ctx.user.id)} 反應時間 **${ms} ms**　${grade}（個人最佳 ${best} ms）${done(ctx, ctx.user.id, ms < 300)}`, components: [] });
    },
  },
};

export default [guess, rps, tictactoe, connect4, blackjack, slots, hilo, minesweeper, memory, hangman, wordle, reaction];
