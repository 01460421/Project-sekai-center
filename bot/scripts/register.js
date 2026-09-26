/* 把 100 個斜線指令註冊到 Discord。
     node scripts/register.js            → 全域註冊（最多一小時生效）
     GUILD_ID=xxx node scripts/register.js → 只註冊到一個伺服器（立即生效，開發用）
   需要 DISCORD_TOKEN 與 APP_ID（bot/.env 或環境變數）。不需要安裝 discord.js。
   Workers 版也可以改打 https://<worker>/register（見 src/worker.js）。 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bot } from '../src/core/bot.js';
import { registrationJSON } from '../src/core/registry.js';
import { createRest } from '../src/core/discord-http.js';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  for (const line of fs.readFileSync(path.join(here, '..', '.env'), 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const token = (process.env.DISCORD_TOKEN || '').trim(), appId = (process.env.APP_ID || '').trim(), guildId = (process.env.GUILD_ID || '').trim();
if (!token || !appId) { console.error('需要 DISCORD_TOKEN 與 APP_ID。'); process.exit(1); }

const rest = createRest({ token, appId });
try {
  const list = await rest.registerCommands(registrationJSON(Bot.defaultRegistry()), guildId);
  console.log(`已註冊 ${list.length} 個指令到 ${guildId ? `伺服器 ${guildId}` : '全域'}。`);
} catch (e) { console.error('註冊失敗:', e.message); process.exit(1); }
