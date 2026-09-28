import { toEnCommand, toEnSub, toEnOpt } from './i18n.js';

/* Discord「HTTP 互動」（不經 Gateway）的共用工具：Ed25519 驗簽、REST 呼叫、互動 payload → 核心輸入。
   只用 fetch 與 WebCrypto，Node 22 與 Cloudflare Workers 都能跑，不需要 discord.js。 */

export function hexToBytes(hex) {
  const s = String(hex || '').trim();
  if (!/^[0-9a-fA-F]*$/.test(s) || s.length % 2) return new Uint8Array(0);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/* Discord 要求：驗證 X-Signature-Ed25519 是否為 timestamp + body 的簽章 */
export async function verifyDiscordRequest(publicKeyHex, timestamp, body, signatureHex) {
  const pub = hexToBytes(publicKeyHex), sig = hexToBytes(signatureHex);
  if (pub.length !== 32 || sig.length !== 64 || !timestamp) return false;
  const msg = new TextEncoder().encode(String(timestamp) + String(body));
  for (const algo of [{ name: 'Ed25519' }, { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' }]) {
    try {
      const key = await crypto.subtle.importKey('raw', pub, algo, false, ['verify']);
      return await crypto.subtle.verify(algo.name === 'Ed25519' ? 'Ed25519' : algo, key, sig, msg);
    } catch { /* 換下一種演算法名稱 */ }
  }
  return false;
}

/* ephemeral → flags；空訊息補零寬字元 */
export function toApi(msg) {
  const out = { ...(typeof msg === 'string' ? { content: msg } : msg) };
  if (out.ephemeral) out.flags = (out.flags || 0) | 64;
  delete out.ephemeral;
  if (out.content === undefined && !out.embeds && !out.components) out.content = '​';
  return out;
}

export function createRest({ token, appId, fetchImpl, base = 'https://discord.com/api/v10' }) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  async function call(method, path, body) {
    const res = await doFetch(base + path, { method, headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'DiscordBot (sekai-center-bot, 1.0)' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new Error(`Discord ${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }
  const memberOf = m => ({ id: m.user.id, name: m.nick || m.user.global_name || m.user.username, bot: !!m.user.bot });
  return {
    call, appId,
    send: (channelId, msg) => call('POST', `/channels/${channelId}/messages`, toApi(msg)),
    followUp: (itoken, msg) => call('POST', `/webhooks/${appId}/${itoken}`, toApi(msg)),
    editOriginal: (itoken, msg) => call('PATCH', `/webhooks/${appId}/${itoken}/messages/@original`, toApi(msg)),
    members: guildId => call('GET', `/guilds/${guildId}/members?limit=1000`).then(list => (list || []).map(memberOf)),
    guildCount: () => call('GET', '/users/@me/guilds?limit=200').then(list => (list || []).length),
    registerCommands: (json, guildId) => call('PUT', guildId ? `/applications/${appId}/guilds/${guildId}/commands` : `/applications/${appId}/commands`, json),
  };
}

const avatarUrl = u => u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${u.avatar.startsWith('a_') ? 'gif' : 'png'}?size=128` : undefined;
const snapshot = m => m ? { content: m.content, embeds: m.embeds || [], components: m.components || [] } : null;

/* 互動 payload → 核心的輸入。回 { kind, input } 或 null（不支援的型別）。
   kind：command / autocomplete / button / select / modal */
export function parseInteraction(i) {
  const raw = i.member ? i.member.user : i.user;
  if (!raw) return null;
  const user = { id: raw.id, name: (i.member && i.member.nick) || raw.global_name || raw.username, avatar: avatarUrl(raw), bot: !!raw.bot };
  let perms = 0n; try { perms = BigInt((i.member && i.member.permissions) || 0); } catch {}
  const member = { admin: (perms & 32n) !== 0n || (perms & 8n) !== 0n, roles: (i.member && i.member.roles) || [], voiceMembers: [] };
  const base = { user, guildId: i.guild_id || 'dm', guildName: '', channelId: i.channel_id || '', interactionId: i.id, member, locale: i.locale || 'zh-TW' };
  const resolved = (i.data && i.data.resolved) || {};
  const resolveUser = id => {
    const u = resolved.users && resolved.users[id], m = resolved.members && resolved.members[id];
    return u ? { id, name: (m && m.nick) || u.global_name || u.username, avatar: avatarUrl(u), bot: !!u.bot } : { id, name: id, bot: false };
  };
  if (i.type === 2 || i.type === 4) {
    const name = toEnCommand(i.data.name);   // 註冊的是中文名，內部一律英文 id
    const options = {}; let sub = ''; let focused = null;
    const walk = list => { for (const o of list || []) {
      if (o.type === 1) { sub = toEnSub(name, o.name); walk(o.options); }
      else if (o.type === 2) walk(o.options);
      else {
        if (o.focused) focused = o.value;
        options[toEnOpt(name, sub, o.name)] = o.type === 6 ? resolveUser(o.value) : o.type === 7 ? { id: o.value, name: (resolved.channels && resolved.channels[o.value] && resolved.channels[o.value].name) || '' } : o.value;
      }
    } };
    walk(i.data.options);
    return { kind: i.type === 4 ? 'autocomplete' : 'command', input: { ...base, name, options, sub, focused: focused == null ? '' : String(focused) } };
  }
  if (i.type === 3) {
    const isSelect = i.data.component_type === 3;
    return { kind: isSelect ? 'select' : 'button', input: { ...base, customId: i.data.custom_id, values: i.data.values || [], message: snapshot(i.message) } };
  }
  if (i.type === 5) {
    const fields = {};
    for (const row of i.data.components || []) for (const c of row.components || []) fields[c.custom_id] = c.value;
    return { kind: 'modal', input: { ...base, customId: i.data.custom_id, fields, message: snapshot(i.message) } };
  }
  return null;
}
