/* 一鍵接上 Discord：只要 Bot token 與 Worker 網址，剩下全自動。
     DISCORD_TOKEN=… WORKER_URL=https://pjsk-bot.xxx.workers.dev node scripts/setup-discord.mjs
   做的事：
     1. GET /applications/@me 取得 Application ID 與 Public Key（不用手抄）
     2. wrangler secret bulk 把 DISCORD_TOKEN / DISCORD_PUBLIC_KEY / APP_ID（＋選用的 ANTHROPIC_API_KEY、REGISTER_SECRET）寫進 Worker
     3. PATCH /applications/@me 把 Interactions Endpoint URL 設成 Worker 網址（Discord 會當場 PING 驗證）
     4. 註冊 100 個斜線指令（GUILD_ID 有設就只註冊到該伺服器）
   加 --skip-secrets 可跳過第 2 步（例如容器版只想設定指令）。GitHub Actions 的 bot-deploy.yml 就是呼叫這支。 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Bot } from '../src/core/bot.js';
import { registrationJSON } from '../src/core/registry.js';
import { createRest } from '../src/core/discord-http.js';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..');
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const token = (process.env.DISCORD_TOKEN || '').trim();
const workerUrl = (process.env.WORKER_URL || '').trim().replace(/\/+$/, '');
const guildId = (process.env.GUILD_ID || '').trim();
const skipSecrets = process.argv.includes('--skip-secrets');
if (!token) { console.error('需要 DISCORD_TOKEN。'); process.exit(1); }

/* 1. 應用程式資訊 */
const probe = createRest({ token, appId: '' });
const app = await probe.call('GET', '/applications/@me');
const appId = app.id, publicKey = app.verify_key;
console.log(`應用程式：${app.name}（${appId}）`);

/* 2. Worker 機密 */
if (workerUrl && !skipSecrets) {
  const secrets = { DISCORD_TOKEN: token, DISCORD_PUBLIC_KEY: publicKey, APP_ID: appId };
  for (const k of ['ANTHROPIC_API_KEY', 'REGISTER_SECRET', 'AI_MODEL']) if ((process.env[k] || '').trim()) secrets[k] = process.env[k].trim();
  const file = path.join(root, '.secrets.tmp.json');
  fs.writeFileSync(file, JSON.stringify(secrets));
  try {
    const r = spawnSync(process.execPath, [path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'secret', 'bulk', file], { cwd: root, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
    if (r.status !== 0) { console.error('wrangler secret bulk 失敗'); process.exit(1); }
  } finally { fs.unlinkSync(file); }
  console.log(`已寫入 Worker 機密：${Object.keys(secrets).join('、')}`);
}

/* 3. Interactions Endpoint URL */
const rest = createRest({ token, appId });
if (workerUrl) {
  const endpoint = workerUrl + '/';
  if (app.interactions_endpoint_url === endpoint) console.log(`Interactions Endpoint 已是 ${endpoint}`);
  else {
    try { await rest.call('PATCH', '/applications/@me', { interactions_endpoint_url: endpoint }); console.log(`Interactions Endpoint 設為 ${endpoint}`); }
    catch (e) { console.error(`設定 Interactions Endpoint 失敗：${e.message}\n（Discord 會先 PING 這個網址驗證；剛部署完請等 30 秒再重跑，或確認 Worker 機密 DISCORD_PUBLIC_KEY 已寫入）`); process.exit(1); }
  }
}

/* 4. 斜線指令 */
const list = await rest.registerCommands(registrationJSON(Bot.defaultRegistry()), guildId);
console.log(`已註冊 ${list.length} 個指令到 ${guildId ? `伺服器 ${guildId}` : '全域（最多一小時生效）'}。`);
