/* 把 100 個斜線指令註冊到 Discord。
     node scripts/register.js            → 全域註冊（最多一小時生效）
     GUILD_ID=xxx node scripts/register.js → 只註冊到一個伺服器（立即生效，開發用）
   需要 DISCORD_TOKEN 與 APP_ID（bot/.env 或環境變數）。不需要安裝 discord.js。 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Registry } from '../src/core/registry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  for (const line of fs.readFileSync(path.join(here, '..', '.env'), 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const token = (process.env.DISCORD_TOKEN || '').trim(), appId = (process.env.APP_ID || '').trim(), guildId = (process.env.GUILD_ID || '').trim();
if (!token || !appId) { console.error('需要 DISCORD_TOKEN 與 APP_ID。'); process.exit(1); }

const reg = await Registry.loadDir(Registry.defaultDir());
const body = reg.commandJSON().map(c => {
  const o = { ...c };
  if (o.dm_permission === false) { delete o.dm_permission; o.contexts = [0]; } else o.contexts = [0, 1, 2];
  o.integration_types = [0];
  return o;
});
const url = guildId ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands` : `https://discord.com/api/v10/applications/${appId}/commands`;
const res = await fetch(url, { method: 'PUT', headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const text = await res.text();
if (!res.ok) { console.error(`註冊失敗 ${res.status}:`, text.slice(0, 2000)); process.exit(1); }
console.log(`已註冊 ${JSON.parse(text).length} 個指令到 ${guildId ? `伺服器 ${guildId}` : '全域'}。`);
