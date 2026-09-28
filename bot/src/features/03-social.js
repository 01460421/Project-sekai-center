/* 社交互動（11）：配對指數、星座配對、姓名配對、結婚、個人檔案、互動動作、聲望、生日、AFK、匿名留言、稱號 */

import { str, sub, user as userOpt } from '../core/opts.js';
import { embed, button, row, select, cid, COLORS, Style, bar, mention, num, todayTW, clean, pad2 } from '../core/ui.js';
import { scoreOf, SIGNS, findSign, signOf, parseBirthday, validMD } from '../core/oracle.js';
import { levelFor, xpForLevel, quest, checkAchievements, achievementLine } from '../core/helpers.js';
import { charaById } from '../core/sekai.js';
import { SIGN_MATCH, SIGN_TRAITS } from '../content/fortune.js';

const shipVerdict = s => s >= 90 ? '天生一對，別再猶豫了。' : s >= 75 ? '很有火花，值得認真看待。' : s >= 55 ? '相處起來舒服，慢慢來。' : s >= 35 ? '需要一點磨合，但不是沒機會。' : s >= 15 ? '朋友比較適合。' : '……祝福你們各自安好。';

/* ---------- 配對指數 ---------- */
const ship = {
  name: 'ship', description: '配對指數：算兩個人的契合度（結果固定不會變）', category: 'social',
  options: [userOpt('a', '第一位', { required: true }), userOpt('b', '第二位（不填就是你）')],
  async run(ctx) {
    const a = ctx.opt('a'), b = ctx.opt('b') || ctx.user;
    if (!a) return ctx.reply({ content: '請選一個人。', ephemeral: true });
    const ids = [a.id, b.id].sort();
    const s = scoreOf('ship', ...ids);
    const name = (a.name || '').slice(0, Math.ceil((a.name || '').length / 2)) + (b.name || '').slice(Math.floor((b.name || '').length / 2));
    quest(ctx, 'social');
    await ctx.reply({ embeds: [embed({ title: `💞 ${clean(a.name)} × ${clean(b.name)}`, color: s >= 70 ? COLORS.pink : COLORS.grey, description: `契合度 **${s}%**\n${bar(s, 100, 20, '💗', '🤍')}\n\n${shipVerdict(s)}`, footer: `CP 名：${name}` })] });
  },
};

/* ---------- 星座配對 ---------- */
const zodiacmatch = {
  name: 'zodiacmatch', description: '星座配對：兩個星座的愛情與友情相容度', category: 'social',
  options: [str('a', '第一個星座', { required: true, choices: SIGNS.map(s => [`${s.emoji} ${s.name}`, s.key]) }), str('b', '第二個星座', { required: true, choices: SIGNS.map(s => [`${s.emoji} ${s.name}`, s.key]) })],
  async run(ctx) {
    const a = SIGNS.find(s => s.key === ctx.opt('a')) || SIGNS[0], b = SIGNS.find(s => s.key === ctx.opt('b')) || SIGNS[1];
    const best = SIGN_MATCH[a.key].includes(b.key) || SIGN_MATCH[b.key].includes(a.key);
    const sameEl = a.element === b.element;
    const compatEl = { 火: '風', 風: '火', 土: '水', 水: '土' }[a.element] === b.element;
    const base = best ? 85 : sameEl ? 75 : compatEl ? 70 : 45;
    const love = Math.min(99, base + scoreOf('zl', a.key, b.key) % 12), friend = Math.min(99, base + 5 + scoreOf('zf', a.key, b.key) % 12);
    await ctx.reply({ embeds: [embed({
      title: `${a.emoji} ${a.name} × ${b.emoji} ${b.name}`, color: COLORS.purple,
      description: `愛情 ${bar(love, 100, 15)} ${love}%\n友情 ${bar(friend, 100, 15)} ${friend}%\n\n${best ? '經典速配組合。' : sameEl ? `同為${a.element}象，頻率相近、一拍即合。` : compatEl ? `${a.element}與${b.element}互相滋養，是舒服的組合。` : `${a.element}與${b.element}的節奏不同，需要多一點理解。`}`,
      fields: [{ name: a.name, value: SIGN_TRAITS[a.key], inline: true }, { name: b.name, value: SIGN_TRAITS[b.key], inline: true }],
    })] });
  },
};

/* ---------- 姓名配對 ---------- */
const namematch = {
  name: 'namematch', description: '姓名配對：輸入兩個名字算緣分', category: 'social',
  options: [str('a', '第一個名字', { required: true, maxLen: 20 }), str('b', '第二個名字', { required: true, maxLen: 20 })],
  async run(ctx) {
    const a = (ctx.opt('a') || '甲').trim(), b = (ctx.opt('b') || '乙').trim();
    const s = scoreOf('name', ...[a, b].sort());
    const kinds = ['命中注定', '相見恨晚', '細水長流', '歡喜冤家', '若即若離', '有緣無分'];
    const k = kinds[Math.min(5, Math.floor((100 - s) / 17))];
    await ctx.reply({ embeds: [embed({ title: `📛 ${clean(a)} ❤ ${clean(b)}`, color: COLORS.pink, description: `緣分指數 **${s}%**　「${k}」\n${bar(s, 100, 20)}\n\n${shipVerdict(s)}` })] });
  },
};

/* ---------- 結婚 ---------- */
const marry = {
  name: 'marry', description: '結婚系統：求婚、接受、離婚、看結婚狀態', category: 'social',
  options: [sub('propose', '向某人求婚', [userOpt('user', '對象', { required: true })]), sub('status', '看某人的婚姻狀態', [userOpt('user', '不填就是自己')]), sub('divorce', '離婚')],
  async run(ctx) {
    const me = ctx.u();
    if (ctx.sub === 'divorce') {
      if (!me.marriedTo) return ctx.reply({ content: '你目前單身。', ephemeral: true });
      const ex = ctx.u(me.marriedTo); const exId = me.marriedTo;
      me.marriedTo = null; me.marriedAt = ''; if (ex.marriedTo === ctx.user.id) { ex.marriedTo = null; ex.marriedAt = ''; }
      ctx.store.touch();
      return ctx.reply({ content: `💔 ${mention(ctx.user.id)} 與 ${mention(exId)} 已經離婚。祝兩位各自安好。` });
    }
    if (ctx.sub === 'status') {
      const t = ctx.opt('user') || ctx.user; const u = ctx.u(t.id);
      if (!u.marriedTo) return ctx.reply({ content: `${clean(t.name)} 目前單身。` });
      const days = Math.floor((Date.now() - Date.parse(u.marriedAt || todayTW())) / 86400e3);
      return ctx.reply({ embeds: [embed({ title: '💍 婚姻狀態', color: COLORS.pink, description: `${mention(t.id)} 與 ${mention(u.marriedTo)} 結婚於 ${u.marriedAt}，已經 ${days} 天。` })] });
    }
    const t = ctx.opt('user');
    if (!t) return ctx.reply({ content: '請選擇求婚對象。', ephemeral: true });
    if (t.id === ctx.user.id) return ctx.reply({ content: '愛自己很好，但這裡不能跟自己結婚。', ephemeral: true });
    if (t.bot) return ctx.reply({ content: '機器人不能結婚（它已經跟工作結婚了）。', ephemeral: true });
    if (me.marriedTo) return ctx.reply({ content: `你已經和 ${mention(me.marriedTo)} 結婚了，先 /marry divorce。`, ephemeral: true });
    if (ctx.u(t.id).marriedTo) return ctx.reply({ content: '對方已經結婚了。', ephemeral: true });
    quest(ctx, 'social');
    await ctx.reply({ content: `${mention(t.id)}，${mention(ctx.user.id)} 向你求婚了！💍`, components: [row(button({ id: cid('marry', 'yes', ctx.user.id, t.id), label: '我願意', style: Style.success, emoji: '💍' }), button({ id: cid('marry', 'no', ctx.user.id, t.id), label: '抱歉…', style: Style.danger }))] });
  },
  buttons: {
    async yes(ctx) {
      const [from, to] = ctx.data;
      if (!ctx.isOwner(to)) return ctx.reply({ content: '這不是向你求婚。', ephemeral: true });
      const a = ctx.u(from), b = ctx.u(to);
      if (a.marriedTo || b.marriedTo) return ctx.update({ content: '有一方已經結婚了，這場求婚作廢。', components: [] });
      a.marriedTo = to; b.marriedTo = from; a.marriedAt = b.marriedAt = todayTW();
      const fresh = [...checkAchievements(ctx, from), ...checkAchievements(ctx, to)];
      await ctx.update({ content: `🎉 ${mention(from)} 與 ${mention(to)} 結婚了！恭喜！${achievementLine(fresh)}`, components: [] });
    },
    async no(ctx) {
      const [from, to] = ctx.data;
      if (!ctx.isOwner(to)) return ctx.reply({ content: '這不是向你求婚。', ephemeral: true });
      await ctx.update({ content: `💔 ${mention(to)} 婉拒了 ${mention(from)} 的求婚。`, components: [] });
    },
  },
};

/* ---------- 個人檔案 ---------- */
const profile = {
  name: 'profile', description: '個人檔案：等級、水晶、稱號、推し、測驗結果、成就', category: 'social',
  options: [userOpt('user', '看誰的（不填就是自己）')],
  async run(ctx) {
    const t = ctx.opt('user') || ctx.user; const u = ctx.u(t.id);
    const lv = levelFor(u.xp), next = xpForLevel(lv + 1), cur = xpForLevel(lv);
    const oshi = u.oshi ? charaById(u.oshi) : null;
    const b = parseBirthday(u.birthday); const sign = b ? signOf(b.m, b.d) : null;
    await ctx.reply({ embeds: [embed({
      title: `${u.title ? `「${u.title}」` : ''}${clean(t.name)}`, color: oshi ? oshi.color : COLORS.brand,
      thumbnail: oshi ? oshi.sd : (t.avatar || undefined),
      fields: [
        { name: `等級 ${lv}`, value: `${bar(u.xp - cur, next - cur, 12)} ${num(u.xp)} XP`, inline: false },
        { name: ctx.currency, value: `${num(u.crystals)}（銀行 ${num(u.bank)}）`, inline: true }, { name: '聲望', value: String(u.rep), inline: true }, { name: '連續簽到', value: `${u.streak} 天`, inline: true },
        { name: '推し', value: oshi ? `${oshi.name}（${oshi.unit.key}）` : '未設定', inline: true }, { name: '星座', value: sign ? `${sign.emoji} ${sign.name}` : '未登記', inline: true }, { name: 'MBTI', value: u.mbti || '未測', inline: true },
        { name: '遊戲', value: `${u.games.won} 勝 / ${u.games.played} 場`, inline: true }, { name: '轉蛋', value: `${num(u.pulls)} 抽・${u.pulls4} 張 4★`, inline: true }, { name: '問答', value: `${u.quiz.right} 對 ${u.quiz.wrong} 錯`, inline: true },
        { name: '成就', value: `${u.achievements.length} 個`, inline: true }, { name: '婚姻', value: u.marriedTo ? `與 ${mention(u.marriedTo)}` : '單身', inline: true }, { name: '發言', value: num(u.messages), inline: true },
      ],
    })] });
  },
};

/* ---------- 互動動作 ---------- */
const ACTIONS = {
  hug: ['抱抱', '🤗', ['{a} 給了 {b} 一個大大的擁抱', '{a} 從背後抱住 {b}', '{a} 張開雙手撲向 {b}']],
  pat: ['摸頭', '🫳', ['{a} 摸了摸 {b} 的頭', '{a} 拍拍 {b}：乖', '{a} 輕輕揉了揉 {b} 的頭髮']],
  poke: ['戳戳', '👉', ['{a} 戳了 {b} 一下', '{a} 戳戳 {b}：在嗎？', '{a} 用力戳 {b}']],
  highfive: ['擊掌', '🙏', ['{a} 和 {b} 擊掌！', '{a} 對 {b} 舉起手：耶！', '{a} 與 {b} 帥氣擊掌']],
  cheer: ['加油', '📣', ['{a} 對 {b} 大喊：加油！', '{a} 舉著加油牌站在 {b} 旁邊', '{a} 幫 {b} 打氣：你可以的！']],
  bonk: ['敲頭', '🔨', ['{a} 拿紙扇敲了 {b} 一下', '{a} bonk 了 {b}', '{a} 對 {b}：去反省！']],
  feed: ['餵食', '🍰', ['{a} 餵了 {b} 一口蛋糕', '{a} 把珍奶塞給 {b}', '{a} 請 {b} 吃飯糰']],
  wave: ['揮手', '👋', ['{a} 對 {b} 揮揮手', '{a} 遠遠地跟 {b} 打招呼', '{a} 跳起來跟 {b} 揮手']],
};
const interact = {
  name: 'interact', description: '互動動作：抱抱、摸頭、戳戳、擊掌、加油、敲頭、餵食、揮手', category: 'social',
  options: [str('action', '動作', { required: true, choices: Object.entries(ACTIONS).map(([k, v]) => [`${v[1]} ${v[0]}`, k]) }), userOpt('user', '對象', { required: true })],
  async run(ctx) {
    const k = ACTIONS[ctx.opt('action')] ? ctx.opt('action') : 'hug'; const t = ctx.opt('user');
    if (!t) return ctx.reply({ content: '請選一個對象。', ephemeral: true });
    const [name, emoji, lines] = ACTIONS[k];
    const u = ctx.u(); u.interact[k] = (u.interact[k] || 0) + 1;
    quest(ctx, 'social');
    const fresh = checkAchievements(ctx);
    const total = u.interact[k];
    await ctx.reply({ content: `${emoji} ${ctx.rng.pick(lines).replace('{a}', mention(ctx.user.id)).replace('{b}', t.id === ctx.user.id ? '自己' : mention(t.id))}${t.id === ctx.user.id ? '（自己對自己也可以啦）' : ''}\n-# 這是 ${clean(ctx.user.name)} 第 ${total} 次${name}${achievementLine(fresh)}` });
  },
};

/* ---------- 聲望 ---------- */
const rep = {
  name: 'rep', description: '給某人一點聲望（每人每天對同一個人一次）', category: 'social',
  options: [userOpt('user', '對象', { required: true })],
  async run(ctx) {
    const t = ctx.opt('user');
    if (!t) return ctx.reply({ content: '請選一個人。', ephemeral: true });
    if (t.id === ctx.user.id) return ctx.reply({ content: '不能給自己聲望。', ephemeral: true });
    const me = ctx.u(); const today = todayTW();
    if (me.repGiven[t.id] === today) return ctx.reply({ content: '你今天已經給過這個人了，明天再來。', ephemeral: true });
    me.repGiven[t.id] = today;
    for (const k of Object.keys(me.repGiven)) if (me.repGiven[k] !== today) delete me.repGiven[k];
    const u = ctx.u(t.id); u.rep++;
    quest(ctx, 'social');
    const fresh = checkAchievements(ctx, t.id);
    await ctx.reply({ content: `👍 ${mention(ctx.user.id)} 給了 ${mention(t.id)} 一點聲望（目前 ${u.rep}）${achievementLine(fresh)}` });
  },
};

/* ---------- 生日 ---------- */
const birthday = {
  name: 'birthday', description: '登記生日、看今日壽星與即將到來的生日', category: 'social',
  options: [sub('set', '登記生日', [str('date', 'yyyy/mm/dd 或 mm/dd', { required: true, maxLen: 12 })]), sub('today', '今天誰生日'), sub('upcoming', '未來 30 天的壽星'), sub('remove', '移除登記')],
  async run(ctx) {
    const today = todayTW();
    if (ctx.sub === 'set') {
      const b = parseBirthday(ctx.opt('date'));
      if (!b || !validMD(b.m, b.d)) return ctx.reply({ content: '格式不對，例如 2000/08/31 或 8/31。', ephemeral: true });
      const u = ctx.u(); u.birthday = `${b.y ? b.y + '/' : ''}${pad2(b.m)}/${pad2(b.d)}`;
      const sign = signOf(b.m, b.d);
      return ctx.reply({ content: `🎂 已登記生日 ${u.birthday}（${sign.emoji} ${sign.name}）。/horoscope、/numerology、/birthchart 都會自動用它。`, ephemeral: true });
    }
    if (ctx.sub === 'remove') { ctx.u().birthday = ''; return ctx.reply({ content: '已移除生日登記。', ephemeral: true }); }
    const md = u => { const b = parseBirthday(u.birthday); return b ? `${pad2(b.m)}-${pad2(b.d)}` : ''; };
    const all = ctx.store.users(ctx.guildId).filter(x => x.rec.birthday);
    if (ctx.sub === 'today') {
      const list = all.filter(x => md(x.rec) === today.slice(5));
      return ctx.reply({ content: list.length ? `🎉 今天的壽星：${list.map(x => mention(x.uid)).join('、')}　生日快樂！` : '今天沒有人生日。用 /birthday set 登記你的吧。' });
    }
    const now = Date.parse(today + 'T00:00:00Z');
    const rows = all.map(x => {
      const [m, d] = md(x.rec).split('-').map(Number);
      const y = new Date(now).getUTCFullYear();
      let t = Date.UTC(y, m - 1, d); if (t < now) t = Date.UTC(y + 1, m - 1, d);
      return { uid: x.uid, days: Math.round((t - now) / 86400e3), m, d };
    }).filter(r => r.days <= 30).sort((a, b) => a.days - b.days);
    await ctx.reply({ embeds: [embed({ title: '🎂 未來 30 天的壽星', color: COLORS.pink, description: rows.length ? rows.map(r => `${pad2(r.m)}/${pad2(r.d)}　${mention(r.uid)}${r.days === 0 ? '（今天！）' : `（${r.days} 天後）`}`).join('\n') : '這一個月沒有人生日。' })] });
  },
};

/* ---------- AFK ---------- */
const afk = {
  name: 'afk', description: '設定 AFK 狀態；有人 @ 你時機器人會代為說明，你一發言就自動解除', category: 'social',
  options: [str('reason', '原因', { maxLen: 100 })],
  async run(ctx) {
    const u = ctx.u(); u.afk = { reason: (ctx.opt('reason') || '暫時離開').slice(0, 100), since: Date.now() };
    await ctx.reply({ content: `💤 已設定 AFK：${clean(u.afk.reason)}` });
  },
  events: {
    async messageCreate(bot, m) {
      if (m.isBot || m.guildId === 'dm') return;
      const me = bot.store.user(m.guildId, m.userId);
      if (me.afk) { const mins = Math.round((Date.now() - me.afk.since) / 60e3); me.afk = null; await m.reply(`歡迎回來，${mention(m.userId)}！你離開了 ${mins} 分鐘。`).catch(() => {}); }
      const away = (m.mentions || []).filter(id => id !== m.userId).map(id => ({ id, rec: bot.store.user(m.guildId, id) })).filter(x => x.rec.afk);
      if (away.length) await m.reply(away.map(x => `💤 ${mention(x.id)} 目前 AFK：${clean(x.rec.afk.reason)}（${Math.round((Date.now() - x.rec.afk.since) / 60e3)} 分鐘前）`).join('\n')).catch(() => {});
    },
  },
};

/* ---------- 匿名留言 ---------- */
const confess = {
  name: 'confess', description: '匿名留言／告白：機器人代為發到這個頻道，不會記錄是誰', category: 'social', cooldown: 300,
  options: [str('text', '想說的話', { required: true, maxLen: 300 })],
  async run(ctx) {
    const text = (ctx.opt('text') || '').trim();
    if (!text) return ctx.reply({ content: '什麼都沒寫。', ephemeral: true });
    await ctx.send(ctx.channelId, { embeds: [embed({ title: '💌 匿名留言', color: COLORS.pink, description: text.slice(0, 300), footer: '由 /confess 匿名送出' })] });
    await ctx.reply({ content: '已匿名送出。', ephemeral: true });
  },
};

/* ---------- 稱號 ---------- */
const title = {
  name: 'title', description: '選擇顯示在個人檔案的稱號（從商店購買或成就取得）', category: 'social',
  async run(ctx) {
    const u = ctx.u();
    const list = [...new Set(u.titles)];
    if (!list.length) return ctx.reply({ content: '你還沒有任何稱號。去 /shop 看看，或解鎖成就。', ephemeral: true });
    await ctx.reply({ content: `目前稱號：${u.title || '（無）'}`, components: [select({ id: cid('title', 'pick', ctx.user.id), placeholder: '選擇稱號', options: [{ label: '（不顯示稱號）', value: '-' }, ...list.map(t => ({ label: t, value: t }))] })], ephemeral: true });
  },
  selects: {
    async pick(ctx) {
      if (!ctx.isOwner(ctx.data[0])) return ctx.reply({ content: '這是別人的選單。', ephemeral: true });
      const u = ctx.u(); const v = ctx.values[0];
      u.title = v === '-' ? '' : (u.titles.includes(v) ? v : u.title);
      await ctx.update({ content: `已設定稱號：${u.title || '（無）'}`, components: [] });
    },
  },
};

export default [ship, zodiacmatch, namematch, marry, profile, interact, rep, birthday, afk, confess, title];
