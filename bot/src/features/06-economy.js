/* 經濟（10）：每日簽到、餘額、轉帳、打工、商店、背包、富豪榜、押注、樂透、銀行 */

import { str, int, sub, user as userOpt } from '../core/opts.js';
import { embed, button, row, select, modal, cid, COLORS, Style, mention, num, clean, todayTW } from '../core/ui.js';
import { award, quest, checkAchievements, achievementLine, has, consume, levelFor } from '../core/helpers.js';
import { JOBS, JOB_EVENTS, SHOP_ITEMS } from '../content/words.js';

const yesterdayTW = () => todayTW(Date.now() - 86400e3);

/* ---------- 每日簽到 ---------- */
export function dailyAmount(streak) { return Math.min(300, 100 + streak * 10); }
const daily = {
  name: 'daily', description: '每日簽到領水晶，連續簽到獎勵更多', category: 'economy',
  async run(ctx) {
    const u = ctx.u(); const today = todayTW();
    if (u.lastDaily === today) return ctx.reply({ content: `今天簽過了（連續 ${u.streak} 天）。台灣時間 00:00 重置。`, ephemeral: true });
    u.streak = u.lastDaily === yesterdayTW() ? u.streak + 1 : 1;
    u.lastDaily = today;
    let amount = dailyAmount(u.streak);
    let note = '';
    if (consume(u, 'daily_double')) { amount *= 2; note += '（簽到加倍券 ×2）'; }
    const interest = Math.min(500, Math.floor(u.bank * 0.01));
    if (interest) { u.bank += interest; note += `　銀行利息 +${num(interest)}`; }
    award(ctx, amount);
    quest(ctx, 'daily');
    const fresh = checkAchievements(ctx);
    await ctx.reply({ embeds: [embed({ title: '📅 簽到成功', color: COLORS.green, description: `+${num(amount)} ${ctx.currency}${note}\n連續 ${u.streak} 天${u.streak % 7 === 0 ? '　🎁 每滿 7 天額外 +100' : ''}\n餘額 ${num(u.streak % 7 === 0 ? award(ctx, 100) : u.crystals)}${achievementLine(fresh)}`, footer: '明天再來，連續簽到每天多 10' })] });
  },
};

/* ---------- 餘額 ---------- */
const balance = {
  name: 'balance', description: '查看水晶餘額', category: 'economy',
  options: [userOpt('user', '看誰的')],
  async run(ctx) {
    const t = ctx.opt('user') || ctx.user; const u = ctx.u(t.id);
    await ctx.reply({ content: `💎 ${clean(t.name)}：錢包 **${num(u.crystals)}**、銀行 **${num(u.bank)}** ${ctx.currency}（總計 ${num(u.crystals + u.bank)}）` });
  },
};

/* ---------- 轉帳 ---------- */
const pay = {
  name: 'pay', description: '轉水晶給別人', category: 'economy',
  options: [userOpt('user', '對象', { required: true }), int('amount', '金額', { required: true, min: 1, max: 1000000 })],
  async run(ctx) {
    const t = ctx.opt('user'); const n = ctx.opt('amount') || 0;
    if (!t || t.id === ctx.user.id) return ctx.reply({ content: '請選一個別人。', ephemeral: true });
    if (t.bot) return ctx.reply({ content: '機器人不收錢。', ephemeral: true });
    const me = ctx.u();
    if (n > me.crystals) return ctx.reply({ content: `你只有 ${num(me.crystals)} ${ctx.currency}。`, ephemeral: true });
    award(ctx, -n); award(ctx, n, t.id);
    await ctx.reply({ content: `💸 ${mention(ctx.user.id)} 轉了 **${num(n)}** ${ctx.currency} 給 ${mention(t.id)}。` });
  },
};

/* ---------- 打工 ---------- */
const work = {
  name: 'work', description: '打工賺水晶（每小時一次）', category: 'economy',
  async run(ctx) {
    const u = ctx.u(); const left = u.lastWork + 3600e3 - Date.now();
    if (left > 0) return ctx.reply({ content: `還在休息，${Math.ceil(left / 60e3)} 分鐘後再來。`, ephemeral: true });
    const [job, lo, hi] = ctx.rng.pick(JOBS);
    const bonus = Math.floor(levelFor(u.xp) * 2);
    const n = ctx.rng.int(lo, hi) + bonus;
    u.lastWork = Date.now(); award(ctx, n);
    await ctx.reply({ content: `💼 你去${job}，${ctx.rng.pick(JOB_EVENTS)}，賺了 **${num(n)}** ${ctx.currency}${bonus ? `（含等級加成 ${bonus}）` : ''}。餘額 ${num(u.crystals)}。` });
  },
};

/* ---------- 商店 ---------- */
const shop = {
  name: 'shop', description: '商店：稱號、道具、禮物', category: 'economy',
  async run(ctx) {
    const u = ctx.u();
    await ctx.reply({ embeds: [embed({ title: '🛒 商店', color: COLORS.gold, description: SHOP_ITEMS.map(i => `**${i.name}**　${num(i.price)} ${ctx.currency}${i.kind === 'title' && u.titles.includes(i.value) ? '（已擁有）' : ''}`).join('\n'), footer: `你的餘額：${num(u.crystals)}` })], components: [select({ id: cid('shop', 'buy', ctx.user.id), placeholder: '選擇要購買的商品', options: SHOP_ITEMS.map(i => ({ label: i.name.slice(0, 100), value: i.id, description: `${num(i.price)} ${ctx.currency}` })) })] });
  },
  selects: {
    async buy(ctx) {
      if (!ctx.isOwner(ctx.data[0])) return ctx.reply({ content: '請自己用 /shop。', ephemeral: true });
      const item = SHOP_ITEMS.find(i => i.id === ctx.values[0]); const u = ctx.u();
      if (!item) return ctx.reply({ content: '沒有這個商品。', ephemeral: true });
      if (item.kind === 'title' && u.titles.includes(item.value)) return ctx.reply({ content: '你已經有這個稱號了。', ephemeral: true });
      if (u.crystals < item.price) return ctx.reply({ content: `${ctx.currency}不夠，還差 ${num(item.price - u.crystals)}。`, ephemeral: true });
      award(ctx, -item.price);
      if (item.kind === 'title') { u.titles.push(item.value); u.title = u.title || item.value; }
      else u.items[item.value] = (u.items[item.value] || 0) + 1;
      await ctx.reply({ content: `✅ 買到了 **${item.name}**，餘額 ${num(u.crystals)}。${item.kind === 'title' ? '用 /title 切換稱號。' : '用 /inventory 使用或送人。'}`, ephemeral: true });
    },
  },
};

/* ---------- 背包 ---------- */
const ITEM_NAME = Object.fromEntries(SHOP_ITEMS.filter(i => i.kind !== 'title').map(i => [i.value, i.name.replace(/（.*$/, '')]));
const inventory = {
  name: 'inventory', description: '背包：查看、使用道具，或把禮物送人', category: 'economy',
  options: [sub('list', '看背包'), sub('use', '使用道具', [str('item', '道具', { required: true, choices: [['經驗加倍券', 'xp_boost'], ['改名卡', 'rename_card']] })]), sub('give', '送禮物給別人', [userOpt('user', '對象', { required: true }), str('item', '禮物', { required: true, choices: [['🌸 花', '🌸'], ['🎂 蛋糕', '🎂'], ['👑 皇冠', '👑']] })])],
  async run(ctx) {
    const u = ctx.u();
    if (ctx.sub === 'use') {
      const it = ctx.opt('item');
      if (!has(u, it)) return ctx.reply({ content: '你沒有這個道具。', ephemeral: true });
      if (it === 'xp_boost') { consume(u, it); u.xpBoostUntil = Date.now() + 3600e3; return ctx.reply({ content: '⚡ 經驗加倍一小時開始！' }); }
      if (it === 'rename_card') return ctx.showModal(modal({ id: cid('inventory', 'rename'), title: '自訂稱號', fields: [{ id: 't', label: '新稱號（最多 12 字）', max: 12 }] }));
    }
    if (ctx.sub === 'give') {
      const t = ctx.opt('user'); const it = ctx.opt('item');
      if (!t || t.id === ctx.user.id) return ctx.reply({ content: '請選一個別人。', ephemeral: true });
      if (!consume(u, it)) return ctx.reply({ content: '你沒有這個禮物，去 /shop 買。', ephemeral: true });
      const r = ctx.u(t.id); r.items[it] = (r.items[it] || 0) + 1; r.gifts = (r.gifts || 0) + 1;
      quest(ctx, 'social');
      return ctx.reply({ content: `${it} ${mention(ctx.user.id)} 送了一份禮物給 ${mention(t.id)}！` });
    }
    const lines = Object.entries(u.items).map(([k, v]) => `${ITEM_NAME[k] || k} ×${v}`);
    await ctx.reply({ embeds: [embed({ title: `🎒 ${clean(ctx.user.name)} 的背包`, color: COLORS.brand, description: lines.length ? lines.join('\n') : '空空如也。去 /shop 逛逛。', fields: [{ name: '稱號', value: u.titles.length ? u.titles.join('、') : '無', inline: true }, { name: '收到的禮物', value: String(u.gifts || 0), inline: true }] })], ephemeral: true });
  },
  modals: {
    async rename(ctx) {
      const u = ctx.u(); const t = String(ctx.fields.t || '').trim().slice(0, 12);
      if (!t) return ctx.reply({ content: '稱號不能是空的。', ephemeral: true });
      if (!consume(u, 'rename_card')) return ctx.reply({ content: '你沒有改名卡。', ephemeral: true });
      u.titles.push(t); u.title = t;
      await ctx.reply({ content: `✨ 新稱號：「${clean(t)}」`, ephemeral: true });
    },
  },
};

/* ---------- 富豪榜 ---------- */
const richlist = {
  name: 'richlist', description: '本伺服器富豪榜（錢包＋銀行）', category: 'economy',
  async run(ctx) {
    const rows = ctx.store.users(ctx.guildId).map(x => ({ uid: x.uid, total: x.rec.crystals + x.rec.bank })).filter(x => x.total > 0).sort((a, b) => b.total - a.total).slice(0, 10);
    await ctx.reply({ embeds: [embed({ title: '💰 富豪榜', color: COLORS.gold, description: rows.length ? rows.map((r, i) => `${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} ${mention(r.uid)}　${num(r.total)}`).join('\n') : '還沒有人有錢，快 /daily 簽到。' })] });
  },
};

/* ---------- 押注 ---------- */
const bet = {
  name: 'bet', description: '押注猜硬幣：猜對翻倍', category: 'economy',
  options: [int('amount', '押多少', { required: true, min: 1, max: 100000 }), str('side', '正面或反面', { required: true, choices: [['正面', 'h'], ['反面', 't']] })],
  async run(ctx) {
    const n = ctx.opt('amount') || 1; const side = ctx.opt('side') || 'h'; const u = ctx.u();
    if (n > u.crystals) return ctx.reply({ content: `你只有 ${num(u.crystals)} ${ctx.currency}。`, ephemeral: true });
    const r = ctx.rng.chance(0.5) ? 'h' : 't'; const win = r === side;
    award(ctx, win ? n : -n);
    await ctx.reply({ content: `🪙 ${r === 'h' ? '正面' : '反面'}！${win ? `你贏了 **+${num(n)}**` : `你輸了 **-${num(n)}**`} ${ctx.currency}，餘額 ${num(u.crystals)}。` });
  },
};

/* ---------- 樂透 ---------- */
const TICKET = 50;
const lottery = {
  name: 'lottery', description: '樂透：買彩券進彩池，開獎抽一位幸運兒', category: 'economy',
  options: [sub('buy', '買彩券（每張 50）', [int('count', '幾張', { min: 1, max: 100 })]), sub('info', '看目前彩池'), sub('draw', '開獎（管理員）')],
  async run(ctx) {
    const g = ctx.g(); const L = g.lottery;
    if (ctx.sub === 'buy') {
      const n = ctx.opt('count') || 1; const u = ctx.u();
      if (n * TICKET > u.crystals) return ctx.reply({ content: `${n} 張要 ${num(n * TICKET)}，你只有 ${num(u.crystals)}。`, ephemeral: true });
      award(ctx, -n * TICKET); L.pot += Math.floor(n * TICKET * 0.9); L.tickets[ctx.user.id] = (L.tickets[ctx.user.id] || 0) + n; ctx.store.touch();
      return ctx.reply({ content: `🎟️ 買了 ${n} 張（第 ${L.round} 期），你共有 ${L.tickets[ctx.user.id]} 張，彩池 ${num(L.pot)}。` });
    }
    if (ctx.sub === 'draw') {
      if (!ctx.member.admin) return ctx.reply({ content: '需要管理員權限。', ephemeral: true });
      const entries = Object.entries(L.tickets);
      if (!entries.length) return ctx.reply({ content: '這一期沒有人買彩券。', ephemeral: true });
      const winner = ctx.rng.weighted(entries.map(([uid, n]) => [uid, n]));
      const pot = L.pot; award(ctx, pot, winner);
      const total = entries.reduce((s, [, n]) => s + n, 0);
      g.lottery = { pot: 0, tickets: {}, round: L.round + 1 }; ctx.store.touch();
      return ctx.reply({ content: `🎉 第 ${L.round} 期開獎！共 ${total} 張彩券，得主是 ${mention(winner)}，獲得 **${num(pot)}** ${ctx.currency}！` });
    }
    const total = Object.values(L.tickets).reduce((s, n) => s + n, 0);
    await ctx.reply({ embeds: [embed({ title: `🎟️ 樂透第 ${L.round} 期`, color: COLORS.gold, description: `彩池 **${num(L.pot)}** ${ctx.currency}\n${total} 張彩券・${Object.keys(L.tickets).length} 人參加\n你有 ${L.tickets[ctx.user.id] || 0} 張（中獎率 ${total ? ((L.tickets[ctx.user.id] || 0) / total * 100).toFixed(1) : 0}%）`, footer: '每張 50，九成進彩池；由管理員 /lottery draw 開獎' })] });
  },
};

/* ---------- 銀行 ---------- */
const bank = {
  name: 'bank', description: '銀行：存款每天簽到時領 1% 利息（上限 500）', category: 'economy',
  options: [sub('deposit', '存款', [int('amount', '金額（不填就全部）', { min: 1 })]), sub('withdraw', '提款', [int('amount', '金額（不填就全部）', { min: 1 })]), sub('info', '看帳戶')],
  async run(ctx) {
    const u = ctx.u();
    if (ctx.sub === 'deposit') {
      const n = Math.min(u.crystals, ctx.opt('amount') || u.crystals);
      if (n <= 0) return ctx.reply({ content: '錢包沒錢可存。', ephemeral: true });
      u.crystals -= n; u.bank += n; ctx.store.touch();
      return ctx.reply({ content: `🏦 存入 ${num(n)}，銀行 ${num(u.bank)}、錢包 ${num(u.crystals)}。` });
    }
    if (ctx.sub === 'withdraw') {
      const n = Math.min(u.bank, ctx.opt('amount') || u.bank);
      if (n <= 0) return ctx.reply({ content: '銀行沒錢可提。', ephemeral: true });
      u.bank -= n; u.crystals += n; ctx.store.touch();
      return ctx.reply({ content: `🏦 提出 ${num(n)}，銀行 ${num(u.bank)}、錢包 ${num(u.crystals)}。` });
    }
    await ctx.reply({ content: `🏦 銀行 **${num(u.bank)}**、錢包 **${num(u.crystals)}** ${ctx.currency}。明天簽到可領利息 ${num(Math.min(500, Math.floor(u.bank * 0.01)))}。` });
  },
};

export default [daily, balance, pay, work, shop, inventory, richlist, bet, lottery, bank];
