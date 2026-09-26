/* 伺服器（5）：歡迎訊息、關鍵字自動反應、指令清單、設定、機器人統計 */

import { str, sub, channel as channelOpt, bool } from '../core/opts.js';
import { embed, select, cid, COLORS, mention, num, clean, ts } from '../core/ui.js';
import { CATEGORIES } from '../core/registry.js';

/* ---------- 歡迎訊息 ---------- */
const welcome = {
  name: 'welcome', description: '設定新成員歡迎訊息（{user} 會換成 @ 對方，{server} 換成伺服器名）', category: 'server', admin: true,
  options: [sub('set', '設定', [channelOpt('channel', '發到哪個頻道', { required: true }), str('text', '訊息內容', { required: true, maxLen: 300 })]), sub('off', '關閉'), sub('test', '測試一次')],
  async run(ctx) {
    const s = ctx.settings;
    if (ctx.sub === 'off') { s.welcomeChannel = ''; s.welcomeText = ''; ctx.store.touch(); return ctx.reply({ content: '已關閉歡迎訊息。', ephemeral: true }); }
    if (ctx.sub === 'test') { if (!s.welcomeChannel) return ctx.reply({ content: '還沒設定。', ephemeral: true }); await ctx.send(s.welcomeChannel, { content: s.welcomeText.replace(/\{user\}/g, mention(ctx.user.id)).replace(/\{server\}/g, ctx.guildName || '本伺服器') }); return ctx.reply({ content: '已送出測試訊息。', ephemeral: true }); }
    const ch = ctx.opt('channel'); if (!ch) return ctx.reply({ content: '請選頻道。', ephemeral: true });
    s.welcomeChannel = ch.id; s.welcomeText = String(ctx.opt('text') || '歡迎 {user} 加入 {server}！').slice(0, 300); ctx.store.touch();
    await ctx.reply({ content: `已設定：<#${ch.id}>\n${clean(s.welcomeText)}`, ephemeral: true });
  },
  events: {
    async memberJoin(bot, m) {
      const s = bot.store.guild(m.guildId).settings;
      if (!s.welcomeChannel || !s.welcomeText) return;
      await bot.send(s.welcomeChannel, { content: s.welcomeText.replace(/\{user\}/g, mention(m.userId)).replace(/\{server\}/g, m.guildName || '本伺服器') });
    },
  },
};

/* ---------- 自動反應 ---------- */
const autoreact = {
  name: 'autoreact', description: '關鍵字自動反應：訊息包含某個詞時機器人加上表情', category: 'server', admin: true,
  options: [sub('add', '新增', [str('keyword', '關鍵字', { required: true, maxLen: 30 }), str('emoji', '表情（Unicode 或 <:name:id>）', { required: true, maxLen: 60 })]), sub('remove', '移除', [str('keyword', '關鍵字', { required: true, maxLen: 30 })]), sub('list', '列出全部')],
  async run(ctx) {
    const s = ctx.settings; s.autoreact = s.autoreact || {};
    if (ctx.sub === 'add') { if (Object.keys(s.autoreact).length >= 30) return ctx.reply({ content: '最多 30 個。', ephemeral: true }); s.autoreact[String(ctx.opt('keyword')).toLowerCase()] = String(ctx.opt('emoji')); ctx.store.touch(); return ctx.reply({ content: `已新增：「${clean(ctx.opt('keyword'))}」→ ${ctx.opt('emoji')}`, ephemeral: true }); }
    if (ctx.sub === 'remove') { delete s.autoreact[String(ctx.opt('keyword')).toLowerCase()]; ctx.store.touch(); return ctx.reply({ content: '已移除。', ephemeral: true }); }
    const list = Object.entries(s.autoreact);
    await ctx.reply({ content: list.length ? list.map(([k, e]) => `・${clean(k)} → ${e}`).join('\n') : '沒有設定任何自動反應。', ephemeral: true });
  },
  events: {
    async messageCreate(bot, m) {
      if (m.isBot || m.guildId === 'dm') return;
      const map = bot.store.guild(m.guildId).settings.autoreact || {};
      const text = m.content.toLowerCase(); let n = 0;
      for (const [k, e] of Object.entries(map)) if (text.includes(k) && n++ < 3) await m.react(e).catch(() => {});
    },
  },
};

/* ---------- 指令清單 ---------- */
function helpEmbed(reg, cat) {
  const byCat = reg.byCategory();
  if (cat && CATEGORIES[cat]) {
    const c = CATEGORIES[cat];
    return embed({ title: `${c.emoji} ${c.name}（${byCat[cat].length}）`, color: COLORS.brand, description: byCat[cat].map(f => `**/${f.name}**　${f.description}`).join('\n') });
  }
  return embed({ title: `📖 指令清單・共 ${reg.size} 個功能`, color: COLORS.brand, description: Object.entries(CATEGORIES).map(([k, c]) => `${c.emoji} **${c.name}**（${byCat[k].length}）　${byCat[k].slice(0, 6).map(f => `/${f.name}`).join(' ')}${byCat[k].length > 6 ? ' …' : ''}`).join('\n'), footer: '用下方選單看各分類的完整說明' });
}
const help = {
  name: 'help', description: '指令清單：依分類查看全部功能', category: 'server', guildOnly: false,
  options: [str('category', '分類', { choices: Object.entries(CATEGORIES).map(([k, c]) => [`${c.emoji} ${c.name}`, k]) })],
  async run(ctx) {
    await ctx.reply({ embeds: [helpEmbed(ctx.bot.registry, ctx.opt('category'))], components: [select({ id: cid('help', 'cat'), placeholder: '選擇分類', options: [{ label: '總覽', value: 'all' }, ...Object.entries(CATEGORIES).map(([k, c]) => ({ label: c.name, value: k, emoji: c.emoji }))] })] });
  },
  selects: { async cat(ctx) { await ctx.update({ embeds: [helpEmbed(ctx.bot.registry, ctx.values[0] === 'all' ? null : ctx.values[0])], components: ctx.message ? ctx.message.components : [] }); } },
};

/* ---------- 設定 ---------- */
const settings = {
  name: 'settings', description: '伺服器設定：經驗值開關、貨幣名稱、問答獎勵', category: 'server', admin: true,
  options: [sub('show', '顯示目前設定'), sub('xp', '聊天經驗值開關', [bool('enabled', '開啟或關閉', { required: true })]), sub('currency', '貨幣名稱', [str('name', '例如 水晶、金幣、貓罐頭', { required: true, maxLen: 8 })]), sub('quizreward', '答對一題的獎勵', [str('amount', '數字', { required: true, maxLen: 5 })])],
  async run(ctx) {
    const s = ctx.settings;
    if (ctx.sub === 'xp') { s.xp = !!ctx.opt('enabled'); ctx.store.touch(); return ctx.reply({ content: `聊天經驗值：${s.xp ? '開啟' : '關閉'}`, ephemeral: true }); }
    if (ctx.sub === 'currency') { s.currency = String(ctx.opt('name')).slice(0, 8); ctx.store.touch(); return ctx.reply({ content: `貨幣名稱改為「${clean(s.currency)}」`, ephemeral: true }); }
    if (ctx.sub === 'quizreward') { const n = parseInt(ctx.opt('amount'), 10); if (!(n >= 0 && n <= 1000)) return ctx.reply({ content: '請輸入 0～1000 的數字。', ephemeral: true }); s.quizReward = n; ctx.store.touch(); return ctx.reply({ content: `問答獎勵改為 ${n}`, ephemeral: true }); }
    await ctx.reply({ embeds: [embed({ title: '⚙️ 伺服器設定', color: COLORS.grey, fields: [{ name: '聊天經驗值', value: s.xp ? '開啟' : '關閉', inline: true }, { name: '貨幣', value: s.currency, inline: true }, { name: '問答獎勵', value: String(s.quizReward), inline: true }, { name: '歡迎訊息', value: s.welcomeChannel ? `<#${s.welcomeChannel}>` : '關閉', inline: true }, { name: '自動反應', value: `${Object.keys(s.autoreact || {}).length} 個`, inline: true }] })], ephemeral: true });
  },
};

/* ---------- 機器人統計 ---------- */
const botstats = {
  name: 'botstats', description: '機器人統計：上線時間、用量、最熱門的指令', category: 'server', guildOnly: false,
  async run(ctx) {
    const st = ctx.bot.stats; const g = ctx.guildId !== 'dm' ? ctx.g().stats : null;
    const top = Object.entries((g || st).byCommand).sort((a, b) => b[1] - a[1]).slice(0, 8);
    await ctx.reply({ embeds: [embed({ title: '🤖 機器人統計', color: COLORS.brand, fields: [
      { name: '上線自', value: ts(st.started, 'R'), inline: true }, { name: '伺服器數', value: num(ctx.bot.guildCount), inline: true }, { name: '功能數', value: String(ctx.bot.registry.size), inline: true },
      { name: '指令總數', value: num(st.commands), inline: true }, { name: '按鈕／選單', value: num(st.components), inline: true }, { name: '錯誤', value: num(st.errors), inline: true },
      { name: g ? '本伺服器熱門指令' : '熱門指令', value: top.map(([k, v]) => `/${k} ×${v}`).join('\n') || '—' },
    ], footer: `AI 解讀：${ctx.bot.ai ? '已啟用（' + ctx.bot.ai.model + '）' : '未啟用'}` })] });
  },
};

export default [welcome, autoreact, help, settings, botstats];
