/* Discord 介接層：把 discord.js 的事件轉成核心（src/core/bot.js）的呼叫。
   功能模組完全不碰 discord.js；要接 QQ 或其他平台時只需要再寫一個這樣的檔案。

   環境變數（可放 bot/.env）：
     DISCORD_TOKEN           必要
     STATE_FILE              預設 ./state/state.json
     ANTHROPIC_API_KEY       選用，啟用 AI：占卜／測驗的解讀、/chat 對話、@機器人 回話
     AI_MODEL                選用，預設 claude-opus-5
     AI_DAILY_PER_USER       選用，每人每日解讀次數，預設 10
     AI_CHAT_DAILY_PER_USER  選用，每人每日對話次數，預設 40
     DEFER_MS                選用，功能超過這麼多毫秒還沒回應就先告訴 Discord「稍等」，預設 2200

   Discord 要求互動 3 秒內回應。功能（尤其是要等 Claude 的）跑太久時，這裡會自動先「延遲」，
   之後第一次 reply 就變成把佔位訊息改成結果，跟 Workers 版（src/worker.js）的行為一致。 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, GatewayIntentBits, Partials, Events, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { Bot } from './core/bot.js';
import { FileStore } from './core/store-file.js';
import { createAI } from './core/ai.js';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(here, '..', '.env'));

const token = (process.env.DISCORD_TOKEN || '').trim();
if (!token) { console.error('缺 DISCORD_TOKEN（放在 bot/.env 或環境變數）。'); process.exit(1); }

const store = new FileStore(process.env.STATE_FILE || path.join(here, '..', 'state', 'state.json'));
const DEFER_MS = Number(process.env.DEFER_MS) || 2200;
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

/* 元件（按鈕／選單／來自訊息的表單）可以「延遲更新」原訊息；指令與獨立表單只能「延遲回覆」 */
const canDeferUpdate = interaction => typeof interaction.deferUpdate === 'function' && (!interaction.isModalSubmit() || interaction.isFromMessage());

/* 先告訴 Discord「稍等」。st 記錄延遲的種類：reply → 之後第一次 reply 要改佔位訊息；update → reply 另開一則 */
async function deferNow(interaction, st, ephemeral = false) {
  if (interaction.deferred || interaction.replied || st.acking) return st.pending;
  st.acking = true;
  if (canDeferUpdate(interaction)) { st.deferKind = 'update'; st.pending = interaction.deferUpdate(); }
  else { st.deferKind = 'reply'; st.pending = interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {}); }
  return st.pending;
}
/* 逾時計時器送出的延遲可能還在路上：功能這時要回應的話，先等它落地，才知道該改佔位訊息還是另開一則 */
const settled = st => (st.pending ? st.pending.catch(() => {}) : Promise.resolve());

function baseInput(interaction) {
  const st = { deferKind: '', edited: false, acking: false, pending: null };   // acking：正在送第一個回應，逾時計時器不要再插隊
  return {
    user: userOf(interaction.user, interaction.member),
    guildId: interaction.guildId || 'dm',
    guildName: interaction.guild ? interaction.guild.name : '',
    channelId: interaction.channelId,
    interactionId: interaction.id,
    member: memberInfo(interaction),
    locale: interaction.locale,
    _st: st,
    io: {
      reply: async msg => {
        await settled(st);
        if (interaction.deferred && st.deferKind === 'reply' && !st.edited) { st.edited = true; return interaction.editReply(toDiscord(msg)); }
        if (interaction.deferred || interaction.replied) return interaction.followUp(toDiscord(msg));
        st.acking = true; return interaction.reply(toDiscord(msg));
      },
      update: async msg => {
        await settled(st);
        if (interaction.deferred || interaction.replied) { st.edited = true; return interaction.editReply(toDiscord(msg)); }
        st.acking = true;
        if (typeof interaction.update === 'function' && (!interaction.isModalSubmit() || interaction.isFromMessage())) return interaction.update(toDiscord(msg));
        return interaction.reply(toDiscord(msg));
      },
      followUp: async msg => interaction.followUp(toDiscord(msg)),
      edit: async msg => { await settled(st); st.edited = true; return interaction.editReply(toDiscord(msg)); },
      defer: async ephemeral => deferNow(interaction, st, ephemeral),
      showModal: async m => { st.acking = true; return interaction.showModal(m); },
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
  const input = baseInput(interaction);
  // 功能跑超過 DEFER_MS 還沒回應（例如在等 Claude）就先延遲，避免 Discord 顯示「互動失敗」
  const timer = interaction.isAutocomplete() ? null : setTimeout(() => { deferNow(interaction, input._st).catch(() => {}); }, DEFER_MS);
  try {
    if (interaction.isChatInputCommand()) {
      const { options, sub } = flattenOptions(interaction);
      await bot.runCommand({ ...input, name: interaction.commandName, options, sub });
    } else if (interaction.isAutocomplete()) {
      const f = interaction.options.getFocused(true);
      const list = await bot.runAutocomplete({ ...input, name: interaction.commandName, focused: f.value });
      await interaction.respond(list).catch(() => {});
    } else if (interaction.isButton()) {
      await bot.runComponent('button', { ...input, customId: interaction.customId, message: messageSnapshot(interaction.message) });
    } else if (interaction.isStringSelectMenu()) {
      await bot.runComponent('select', { ...input, customId: interaction.customId, values: interaction.values, message: messageSnapshot(interaction.message) });
    } else if (interaction.isModalSubmit()) {
      const fields = {};
      for (const row of interaction.components) for (const c of row.components) fields[c.customId] = c.value;
      await bot.runComponent('modal', { ...input, customId: interaction.customId, fields, message: interaction.isFromMessage() ? messageSnapshot(interaction.message) : null });
    }
  } catch (e) { console.error('[interaction]', e); }
  finally { if (timer) clearTimeout(timer); }
});

client.on(Events.MessageCreate, async message => {
  if (!message.guildId || message.author.bot) return;
  const me = client.user;
  const mentionsBot = !!(me && message.mentions.users.has(me.id));
  const repliedToBot = !!(me && message.mentions.repliedUser && message.mentions.repliedUser.id === me.id);
  await bot.emit('messageCreate', {
    guildId: message.guildId, guildName: message.guild ? message.guild.name : '', channelId: message.channelId, userId: message.author.id, userName: message.member ? message.member.displayName : message.author.username,
    content: message.content || '', isBot: message.author.bot, mentions: [...message.mentions.users.keys()],
    // 給 /chat 的被動回話用：有沒有 @機器人、是不是在回覆機器人的訊息、拿掉 @機器人 之後的內文
    botId: me ? me.id : '', mentionsBot, repliedToBot,
    text: me ? (message.content || '').replace(new RegExp(`<@!?${me.id}>`, 'g'), '').trim() : (message.content || ''),
    typing: () => message.channel.sendTyping(),
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
