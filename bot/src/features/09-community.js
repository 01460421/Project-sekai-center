/* 等級與社群（10）：等級、排行、成就、每日任務、簽到紀錄、抽獎、隨機分組、提醒、倒數、計數器 */

import { str, int, sub, user as userOpt } from '../core/opts.js';
import { embed, button, row, cid, COLORS, Style, mention, num, clean, ts, bar, todayTW, weekTW } from '../core/ui.js';
import { levelFor, xpForLevel, award, quest, questDone, QUESTS, checkAchievements, achievementLine } from '../core/helpers.js';
import { ACHIEVEMENTS } from '../content/words.js';

/* ---------- 等級（含被動加經驗） ---------- */
const xpCooldown = new Map();
const rank = {
  name: 'rank', description: '我的等級與經驗（聊天就會累積）', category: 'community',
  options: [userOpt('user', '看誰的')],
  async run(ctx) {
    const t = ctx.opt('user') || ctx.user; const u = ctx.u(t.id);
    const lv = levelFor(u.xp), cur = xpForLevel(lv), next = xpForLevel(lv + 1);
    const all = ctx.store.users(ctx.guildId).sort((a, b) => b.rec.xp - a.rec.xp);
    const pos = all.findIndex(x => x.uid === t.id) + 1;
    await ctx.reply({ embeds: [embed({ title: `${clean(t.name)}　Lv.${lv}`, color: COLORS.blue, description: `${bar(u.xp - cur, next - cur, 20)}\n${num(u.xp)} / ${num(next)} XP（還差 ${num(next - u.xp)}）\n本伺服器第 ${pos || '-'} 名・發言 ${num(u.messages)} 則${u.xpBoostUntil > Date.now() ? '\n⚡ 經驗加倍中' : ''}`, thumbnail: t.avatar || undefined })] });
  },
  events: {
    async messageCreate(bot, m) {
      if (m.isBot || m.guildId === 'dm') return;
      const g = bot.store.guild(m.guildId); if (g.settings.xp === false) return;
      const u = bot.store.user(m.guildId, m.userId);
      u.messages++;
      const wk = weekTW(); if (u.weekly.week !== wk) u.weekly = { week: wk, msgs: 0, games: 0 }; u.weekly.msgs++;
      const today = todayTW(); if (u.quests.date !== today) u.quests = { date: today, done: {}, claimed: false }; u.quests.done.chat = (u.quests.done.chat || 0) + 1;
      const key = `${m.guildId}:${m.userId}`; const now = Date.now();
      if ((xpCooldown.get(key) || 0) > now) return;
      xpCooldown.set(key, now + 60e3);
      if (xpCooldown.size > 20000) for (const [k, v] of xpCooldown) if (v < now) xpCooldown.delete(k);
      const before = levelFor(u.xp);
      let gain = 15 + Math.floor(Math.random() * 11); if (u.xpBoostUntil > now) gain *= 2;
      u.xp += gain;
      const after = levelFor(u.xp);
      if (after > before) { u.crystals += after * 20; await m.reply(`🎉 ${mention(m.userId)} 升到 **Lv.${after}**！獎勵 ${after * 20} ${g.settings.currency || '水晶'}。`).catch(() => {}); }
      bot.store.touch();
    },
  },
};

/* ---------- 排行 ---------- */
const leaderboard = {
  name: 'leaderboard', description: '等級排行榜（本伺服器）', category: 'community',
  options: [str('by', '排序依據', { choices: [['等級', 'xp'], ['發言', 'messages'], ['聲望', 'rep'], ['遊戲勝場', 'wins'], ['本週發言', 'weekly']] })],
  async run(ctx) {
    const by = ctx.opt('by') || 'xp'; const wk = weekTW();
    const val = r => by === 'xp' ? r.xp : by === 'messages' ? r.messages : by === 'rep' ? r.rep : by === 'wins' ? r.games.won : (r.weekly.week === wk ? r.weekly.msgs : 0);
    const label = { xp: 'XP', messages: '則', rep: '聲望', wins: '勝', weekly: '則（本週）' }[by];
    const rows = ctx.store.users(ctx.guildId).map(x => ({ uid: x.uid, v: val(x.rec), lv: levelFor(x.rec.xp) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 10);
    await ctx.reply({ embeds: [embed({ title: `🏆 排行榜・${{ xp: '等級', messages: '發言', rep: '聲望', wins: '遊戲勝場', weekly: '本週發言' }[by]}`, color: COLORS.gold, description: rows.length ? rows.map((r, i) => `${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} ${mention(r.uid)}　${num(r.v)} ${label}${by === 'xp' ? `（Lv.${r.lv}）` : ''}`).join('\n') : '還沒有資料。' })] });
  },
};

/* ---------- 成就 ---------- */
const achievements = {
  name: 'achievements', description: '成就一覽：已解鎖與未解鎖', category: 'community',
  options: [userOpt('user', '看誰的')],
  async run(ctx) {
    const t = ctx.opt('user') || ctx.user;
    const fresh = checkAchievements(ctx, t.id); const u = ctx.u(t.id);
    const got = ACHIEVEMENTS.filter(a => u.achievements.includes(a.id)), rest = ACHIEVEMENTS.filter(a => !u.achievements.includes(a.id));
    await ctx.reply({ embeds: [embed({ title: `🏅 ${clean(t.name)} 的成就 ${got.length}/${ACHIEVEMENTS.length}`, color: COLORS.gold, fields: [{ name: '已解鎖', value: got.map(a => `${a.emoji} **${a.name}**　${a.desc}`).join('\n') || '還沒有', inline: false }, { name: '未解鎖', value: rest.map(a => `🔒 ${a.name}　${a.desc}`).join('\n').slice(0, 1024) || '全部解鎖了！', inline: false }], footer: fresh.length ? `剛剛解鎖：${fresh.map(a => a.name).join('、')}` : undefined })] });
  },
};

/* ---------- 每日任務 ---------- */
const questCmd = {
  name: 'quest', description: '每日任務：完成後領取獎勵', category: 'community',
  async run(ctx) {
    const u = ctx.u(); const today = todayTW();
    if (u.quests.date !== today) u.quests = { date: today, done: {}, claimed: false };
    const doneList = QUESTS.filter(q => questDone(u, q));
    const total = doneList.reduce((s, q) => s + q.reward, 0);
    const allDone = doneList.length === QUESTS.length;
    await ctx.reply({ embeds: [embed({ title: `📋 每日任務 ${today}`, color: COLORS.green, description: QUESTS.map(q => `${questDone(u, q) ? '✅' : '⬜'} **${q.name}**　${q.desc}　+${q.reward}${q.id === 'chat' ? `（${Math.min(20, u.quests.done.chat || 0)}/20）` : ''}`).join('\n'), footer: u.quests.claimed ? '今天已領取' : `完成 ${doneList.length}/${QUESTS.length}，可領 ${total}${allDone ? '＋全完成加碼 100' : ''}` })], components: u.quests.claimed || !doneList.length ? [] : [row(button({ id: cid('quest', 'claim', ctx.user.id), label: `領取 ${total + (allDone ? 100 : 0)} ${ctx.currency}`, style: Style.success }))] });
  },
  buttons: {
    async claim(ctx) {
      if (!ctx.isOwner(ctx.data[0])) return ctx.reply({ content: '請自己用 /quest。', ephemeral: true });
      const u = ctx.u(); if (u.quests.claimed || u.quests.date !== todayTW()) return ctx.update({ content: '今天已經領過了。', embeds: [], components: [] });
      const doneList = QUESTS.filter(q => questDone(u, q)); const total = doneList.reduce((s, q) => s + q.reward, 0) + (doneList.length === QUESTS.length ? 100 : 0);
      u.quests.claimed = true; award(ctx, total);
      await ctx.update({ content: `🎁 領取 ${num(total)} ${ctx.currency}！${doneList.length < QUESTS.length ? '（今天剩下的任務完成後不能再領，明天再來）' : '全部完成，太棒了！'}`, embeds: [], components: [] });
    },
  },
};

/* ---------- 簽到紀錄 ---------- */
const streak = {
  name: 'streak', description: '連續簽到與活躍統計', category: 'community',
  options: [userOpt('user', '看誰的')],
  async run(ctx) {
    const t = ctx.opt('user') || ctx.user; const u = ctx.u(t.id); const wk = weekTW();
    await ctx.reply({ embeds: [embed({ title: `🔥 ${clean(t.name)} 的活躍紀錄`, color: COLORS.orange, fields: [{ name: '連續簽到', value: `${u.streak} 天`, inline: true }, { name: '上次簽到', value: u.lastDaily || '從未', inline: true }, { name: '下一個里程碑', value: `${Math.ceil((u.streak + 1) / 7) * 7} 天`, inline: true }, { name: '本週發言', value: num(u.weekly.week === wk ? u.weekly.msgs : 0), inline: true }, { name: '本週遊戲', value: num(u.weekly.week === wk ? u.weekly.games : 0), inline: true }, { name: '加入紀錄', value: ts(u.created, 'D'), inline: true }] })] });
  },
};

/* ---------- 抽獎 ---------- */
function raffleMsg(rid, r) {
  return { embeds: [embed({ title: `🎁 抽獎：${r.prize}`, color: r.closed ? COLORS.grey : COLORS.pink, description: r.closed ? (r.winners.length ? `🎉 得獎者：${r.winners.map(mention).join('、')}` : '沒有人參加。') : `按下方按鈕參加，抽出 ${r.n} 位。\n目前 ${r.entries.length} 人參加${r.endAt ? `\n${ts(r.endAt)} 自動開獎` : ''}`, footer: `發起人 ${r.ownerName}` })], components: r.closed ? [] : [row(button({ id: cid('raffle', 'join', rid), label: '參加', style: Style.success, emoji: '🎟️' }), button({ id: cid('raffle', 'draw', rid), label: '開獎（發起人）', style: Style.primary }))] };
}
function drawRaffle(ctx, r) {
  r.closed = true; r.winners = ctx.rng.sample(r.entries, Math.min(r.n, r.entries.length)); ctx.store.touch();
}
const raffle = {
  name: 'raffle', description: '抽獎：大家按按鈕參加，發起人或時間到自動開獎', category: 'community',
  options: [str('prize', '獎品', { required: true, maxLen: 80 }), int('winners', '抽幾位（預設 1）', { min: 1, max: 20 }), int('minutes', '幾分鐘後自動開獎（不填就手動）', { min: 1, max: 10080 })],
  async run(ctx) {
    const g = ctx.g(); const rid = Date.now().toString(36).slice(-6);
    g.raffles[rid] = { prize: String(ctx.opt('prize')).slice(0, 80), n: ctx.opt('winners') || 1, entries: [], owner: ctx.user.id, ownerName: ctx.user.name, closed: false, winners: [], channelId: ctx.channelId, endAt: ctx.opt('minutes') ? Date.now() + ctx.opt('minutes') * 60e3 : 0, at: Date.now() };
    for (const k of Object.keys(g.raffles)) if (g.raffles[k].closed && Date.now() - g.raffles[k].at > 7 * 86400e3) delete g.raffles[k];
    await ctx.reply(raffleMsg(rid, g.raffles[rid]));
  },
  buttons: {
    async join(ctx) { const r = ctx.g().raffles[ctx.data[0]]; if (!r || r.closed) return ctx.reply({ content: '這個抽獎已結束。', ephemeral: true }); if (r.entries.includes(ctx.user.id)) return ctx.reply({ content: '你已經參加了。', ephemeral: true }); r.entries.push(ctx.user.id); ctx.store.touch(); await ctx.update(raffleMsg(ctx.data[0], r)); },
    async draw(ctx) { const r = ctx.g().raffles[ctx.data[0]]; if (!r || r.closed) return ctx.reply({ content: '這個抽獎已結束。', ephemeral: true }); if (!ctx.isOwner(r.owner) && !ctx.member.admin) return ctx.reply({ content: '只有發起人或管理員能開獎。', ephemeral: true }); drawRaffle(ctx, r); await ctx.update(raffleMsg(ctx.data[0], r)); },
  },
  async tick(bot, now) {
    for (const gid of Object.keys(bot.store.data.guilds)) for (const r of Object.values(bot.store.data.guilds[gid].raffles || {})) {
      if (r.closed || !r.endAt || r.endAt > now) continue;
      bot.store.guild(gid);   // 標記這個伺服器有變動（Workers 版靠這個決定要寫回哪些鍵）
      r.closed = true; r.winners = bot.rng.sample(r.entries, Math.min(r.n, r.entries.length)); bot.store.touch();
      await bot.send(r.channelId, { content: r.winners.length ? `🎁 抽獎「${r.prize}」開獎！得獎者：${r.winners.map(mention).join('、')}` : `🎁 抽獎「${r.prize}」時間到，但沒有人參加。` });
    }
  },
};

/* ---------- 隨機分組 ---------- */
const team = {
  name: 'team', description: '隨機分組：把名單（或你所在語音頻道的人）分成 N 組', category: 'community',
  options: [int('groups', '分幾組', { required: true, min: 2, max: 10 }), str('names', '名單，用逗號分開（不填就用你的語音頻道成員）', { maxLen: 500 })],
  async run(ctx) {
    const n = ctx.opt('groups') || 2;
    let names = String(ctx.opt('names') || '').split(/[,，、|\n]+/).map(s => s.trim()).filter(Boolean);
    if (!names.length) names = (ctx.member.voiceMembers || []).map(m => mention(m.id));
    if (names.length < n) return ctx.reply({ content: `人數（${names.length}）比組數少，請給名單或進語音頻道。`, ephemeral: true });
    const list = ctx.rng.shuffle(names); const groups = Array.from({ length: n }, () => []);
    list.forEach((x, i) => groups[i % n].push(x));
    await ctx.reply({ embeds: [embed({ title: `👥 分成 ${n} 組`, color: COLORS.green, fields: groups.map((g, i) => ({ name: `第 ${i + 1} 組（${g.length}）`, value: g.map(x => x.startsWith('<@') ? x : clean(x)).join('\n'), inline: true })) })] });
  },
};

/* ---------- 提醒 ---------- */
const remind = {
  name: 'remind', description: '設定提醒：幾分鐘後在這個頻道 @ 你', category: 'community',
  options: [sub('set', '新增提醒', [int('minutes', '幾分鐘後（1～10080）', { required: true, min: 1, max: 10080 }), str('text', '提醒內容', { required: true, maxLen: 200 })]), sub('list', '看我的提醒'), sub('clear', '清除我的所有提醒')],
  async run(ctx) {
    const list = ctx.store.global('reminders', () => []);
    if (ctx.sub === 'list') { const mine = list.filter(r => r.uid === ctx.user.id); return ctx.reply({ content: mine.length ? mine.map(r => `・${ts(r.at)}　${clean(r.text)}`).join('\n') : '沒有提醒。', ephemeral: true }); }
    if (ctx.sub === 'clear') { const n = list.length; const keep = list.filter(r => r.uid !== ctx.user.id); list.length = 0; list.push(...keep); ctx.store.touch(); return ctx.reply({ content: `已清除 ${n - keep.length} 個提醒。`, ephemeral: true }); }
    if (list.filter(r => r.uid === ctx.user.id).length >= 10) return ctx.reply({ content: '最多 10 個提醒。', ephemeral: true });
    const at = Date.now() + (ctx.opt('minutes') || 1) * 60e3;
    list.push({ uid: ctx.user.id, channelId: ctx.channelId, at, text: String(ctx.opt('text') || '').slice(0, 200) }); ctx.store.touch();
    await ctx.reply({ content: `⏰ 好，${ts(at)} 提醒你：${clean(ctx.opt('text'))}` });
  },
  async tick(bot, now) {
    const list = bot.store.global('reminders', () => []);
    const due = list.filter(r => r.at <= now); if (!due.length) return;
    const keep = list.filter(r => r.at > now); list.length = 0; list.push(...keep); bot.store.touch();
    for (const r of due) await bot.send(r.channelId, { content: `⏰ ${mention(r.uid)} 提醒：${clean(r.text)}` });
  },
};

/* ---------- 倒數 ---------- */
const countdown = {
  name: 'countdown', description: '倒數計時：顯示動態倒數，時間到會通知', category: 'community',
  options: [int('seconds', '秒數（10～86400）', { required: true, min: 10, max: 86400 }), str('label', '倒數什麼', { maxLen: 60 })],
  async run(ctx) {
    const sec = ctx.opt('seconds') || 60; const label = String(ctx.opt('label') || '倒數').slice(0, 60); const at = Date.now() + sec * 1000;
    await ctx.reply({ content: `⏳ **${clean(label)}**　${ts(at)}（${ts(at, 'T')}）` });
    const list = ctx.store.global('countdowns', () => []);
    list.push({ uid: ctx.user.id, channelId: ctx.channelId, at, label }); ctx.store.touch();
  },
  async tick(bot, now) {
    const list = bot.store.global('countdowns', () => []);
    const due = list.filter(r => r.at <= now); if (!due.length) return;
    const keep = list.filter(r => r.at > now); list.length = 0; list.push(...keep); bot.store.touch();
    for (const r of due) await bot.send(r.channelId, { content: `⏰ ${mention(r.uid)}「${clean(r.label)}」時間到！` });
  },
};

/* ---------- 計數器 ---------- */
const counter = {
  name: 'counter', description: '共用計數器：例如記今天打了幾場協力，大家都能按 +1', category: 'community',
  options: [str('name', '計數器名稱', { required: true, maxLen: 30 }), int('set', '直接設定成某個數', { min: 0 })],
  async run(ctx) {
    const g = ctx.g(); const name = String(ctx.opt('name')).slice(0, 30);
    if (!g.counters[name]) g.counters[name] = { v: 0, by: {} };
    if (ctx.opt('set') != null) g.counters[name].v = ctx.opt('set');
    ctx.store.touch();
    await ctx.reply(counterMsg(name, g.counters[name]));
  },
  buttons: {
    async add(ctx) { const [name, d] = ctx.data; const g = ctx.g(); const c = g.counters[name]; if (!c) return ctx.update({ content: '這個計數器已被刪除。', embeds: [], components: [] }); c.v = Math.max(0, c.v + (+d)); c.by[ctx.user.id] = (c.by[ctx.user.id] || 0) + (+d); ctx.store.touch(); await ctx.update(counterMsg(name, c)); },
    async reset(ctx) { const g = ctx.g(); const c = g.counters[ctx.data[0]]; if (!c) return ctx.defer(); c.v = 0; c.by = {}; ctx.store.touch(); await ctx.update(counterMsg(ctx.data[0], c)); },
  },
};
function counterMsg(name, c) {
  const top = Object.entries(c.by).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { embeds: [embed({ title: `🔢 ${name}`, color: COLORS.brand, description: `# ${num(c.v)}`, fields: top.length ? [{ name: '貢獻', value: top.map(([u, n]) => `${mention(u)} ${n > 0 ? '+' : ''}${n}`).join('\n') }] : [] })], components: [row(button({ id: cid('counter', 'add', name, 1), label: '+1', style: Style.success }), button({ id: cid('counter', 'add', name, 5), label: '+5', style: Style.success }), button({ id: cid('counter', 'add', name, -1), label: '-1', style: Style.danger }), button({ id: cid('counter', 'reset', name), label: '歸零', style: Style.secondary }))] };
}

export default [rank, leaderboard, achievements, questCmd, streak, raffle, team, remind, countdown, counter];
