/* Discord 介接層：把 discord.js 的事件轉成核心（src/core/bot.js）的呼叫。
   功能模組完全不碰 discord.js；要接 QQ 或其他平台時只需要再寫一個這樣的檔案。

   環境變數（可放 bot/.env）：
     DISCORD_TOKEN       必要
     STATE_FILE          預設 ./state/state.json
     ANTHROPIC_API_KEY   選用，啟用占卜／測驗的 AI 解讀
     AI_MODEL            選用，預設 claude-opus-5
     AI_DAILY_PER_USER   選用，預設 10 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, GatewayIntentBits, Partials, Events, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { Bot } from './core/bot.js';
import { FileStore } from './core/store.js';
import { createAI } from './core/ai.js';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(here, '..', '.env'));

const token = (process.env.DISCORD_TOKEN || '').trim();
if (!token) { console.error('缺 DISCORD_TOKEN（放在 bot/.env 或環境變數）。'); process.exit(1); }

const store = new FileStore(process.env.STATE_FILE || path.join(here, '..', 'state', 'state.json'));
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates],
  partials: [Partials.Channel],
});

const bot = await Bot.create({
  store,
  ai: createAI(process.env, { store }),
  send: async (channelId, msg) => { const ch = await client.channels.fetch(channelId).catch(() => null); if (ch && ch.isTextBased()) await ch.send(toDiscord(msg)); },
});
console.log(`載入 ${bot.registry.size} 個功能${bot.ai ? `，AI 解讀已啟用（${bot.ai.model}）` : ''}`);

/* ---- 訊息物件轉換：ephemeral → flags ---- */
function toDiscord(msg) {
  const out = { ...msg };
  if (out.ephemeral) out.flags = MessageFlags.Ephemeral;
  delete out.ephemeral;
  if (out.content === undefined && !out.embeds && !out.components) out.content = '​';
  return out;
}

function userOf(u, member) {
  return { id: u.id, name: (member && member.displayName) || u.globalName || u.username, avatar: u.displayAvatarURL ? u.displayAvatarURL({ size: 128 }) : undefined, bot: !!u.bot };
}

function flattenOptions(interaction) {
  const out = {}; let sub = '';
  const walk = list => { for (const o of list || []) {
    if (o.type === 1) { sub = o.name; walk(o.options); continue; }
    if (o.type === 2) { walk(o.options); continue; }
    if (o.type === 6) out[o.name] = userOf(o.user, o.member);
    else if (o.type === 7) out[o.name] = { id: o.channel.id, name: o.channel.name };
    else out[o.name] = o.value;
  } };
  walk(interaction.options.data);
  return { options: out, sub };
}

function memberInfo(interaction) {
  const m = interaction.member;
  const admin = !!(interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild));
  const voice = m && m.voice && m.voice.channel ? [...m.voice.channel.members.values()].filter(x => !x.user.bot).map(x => ({ id: x.id, name: x.displayName })) : [];
  return { admin, roles: m && m.roles && m.roles.cache ? [...m.roles.cache.keys()] : [], voiceMembers: voice };
}

function baseInput(interaction) {
  return {
    user: userOf(interaction.user, interaction.member),
    guildId: interaction.guildId || 'dm',
    guildName: interaction.guild ? interaction.guild.name : '',
    channelId: interaction.channelId,
    interactionId: interaction.id,
    member: memberInfo(interaction),
    locale: interaction.locale,
    io: {
      reply: async msg => { if (interaction.deferred || interaction.replied) return interaction.followUp(toDiscord(msg)); return interaction.reply(toDiscord(msg)); },
      update: async msg => {
        if (typeof interaction.update === 'function' && (!interaction.isModalSubmit || !interaction.isModalSubmit() || interaction.isFromMessage())) return interaction.update(toDiscord(msg));
        return interaction.reply(toDiscord(msg));
      },
      followUp: async msg => interaction.followUp(toDiscord(msg)),
      edit: async msg => interaction.editReply(toDiscord(msg)),
      defer: async ephemeral => {
        if (interaction.deferred || interaction.replied) return;
        if (typeof interaction.deferUpdate === 'function') return interaction.deferUpdate();
        return interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
      },
      showModal: async m => interaction.showModal(m),
      members: async () => {
        const g = interaction.guild; if (!g) return [];
        // 小伺服器一次把成員抓齊（快取不一定完整）；大伺服器就用快取裡有的
        if (g.memberCount <= 2000 && g.members.cache.size < g.memberCount) await g.members.fetch().catch(() => {});
        return [...g.members.cache.values()].map(x => ({ id: x.id, name: x.displayName, bot: x.user.bot }));
      },
    },
  };
}

function messageSnapshot(msg) {
  if (!msg) return null;
  return { content: msg.content, embeds: msg.embeds.map(e => e.toJSON()), components: msg.components.map(c => c.toJSON()) };
}

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const { options, sub } = flattenOptions(interaction);
      await bot.runCommand({ ...baseInput(interaction), name: interaction.commandName, options, sub });
    } else if (interaction.isAutocomplete()) {
      const f = interaction.options.getFocused(true);
      const list = await bot.runAutocomplete({ ...baseInput(interaction), name: interaction.commandName, focused: f.value });
      await interaction.respond(list).catch(() => {});
    } else if (interaction.isButton()) {
      await bot.runComponent('button', { ...baseInput(interaction), customId: interaction.customId, message: messageSnapshot(interaction.message) });
    } else if (interaction.isStringSelectMenu()) {
      await bot.runComponent('select', { ...baseInput(interaction), customId: interaction.customId, values: interaction.values, message: messageSnapshot(interaction.message) });
    } else if (interaction.isModalSubmit()) {
      const fields = {};
      for (const row of interaction.components) for (const c of row.components) fields[c.customId] = c.value;
      await bot.runComponent('modal', { ...baseInput(interaction), customId: interaction.customId, fields, message: interaction.isFromMessage() ? messageSnapshot(interaction.message) : null });
    }
  } catch (e) { console.error('[interaction]', e); }
});

client.on(Events.MessageCreate, async message => {
  if (!message.guildId || message.author.bot) return;
  await bot.emit('messageCreate', {
    guildId: message.guildId, channelId: message.channelId, userId: message.author.id, userName: message.member ? message.member.displayName : message.author.username,
    content: message.content || '', isBot: message.author.bot, mentions: [...message.mentions.users.keys()],
    reply: text => message.reply(typeof text === 'string' ? { content: text, allowedMentions: { repliedUser: false, users: [] } } : text),
    react: emoji => message.react(emoji),
  });
});

client.on(Events.GuildMemberAdd, async member => {
  await bot.emit('memberJoin', { guildId: member.guild.id, userId: member.id, guildName: member.guild.name });
});

client.once(Events.ClientReady, c => {
  bot.guildCount = c.guilds.cache.size;
  console.log(`已登入 ${c.user.tag}，${bot.guildCount} 個伺服器`);
  setInterval(() => { bot.guildCount = c.guilds.cache.size; bot.tick().catch(e => console.error('[tick]', e)); }, 30e3).unref();
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { console.log('關閉中…'); await store.close(); client.destroy(); process.exit(0); });

client.login(token).catch(e => { console.error('登入失敗:', e.message); process.exit(1); });

/* 極簡 .env 讀取（不想為了這個多裝一個套件） */
function loadEnv(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}
