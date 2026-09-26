/* 在本機用 wrangler dev（真的 workerd 執行環境）跑 Workers 版，並模擬 Discord 送簽過名的互動進來：
     node scripts/probe-workers.mjs
   會自己產一組 Ed25519 金鑰、寫 .dev.vars、啟動 wrangler dev、打 PING／斜線指令／按鈕／health／cron，然後關掉。
   不需要 Cloudflare 帳號、不需要 Discord token（REST 呼叫會失敗但不影響互動回應）。 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const PORT = Number(process.env.PORT) || await freePort();

const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const pub = hex(await crypto.subtle.exportKey('raw', keys.publicKey));
const devVars = path.join(root, '.dev.vars');
fs.writeFileSync(devVars, `DISCORD_PUBLIC_KEY=${pub}\nDISCORD_TOKEN=dummy\nAPP_ID=123\nREGISTER_SECRET=probe\nDEFER_MS=2200\n`);

// 直接跑 wrangler 的執行檔（不經 npx），並開成獨立 process group，結束時整組砍掉，不留 workerd 殭屍
const bin = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
if (!fs.existsSync(bin)) { console.error('找不到 wrangler，先 npm install'); process.exit(1); }
// 狀態放暫存目錄，每次都是乾淨的（wrangler dev 預設會把 Durable Object 狀態留在 .wrangler/state）
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'pjsk-bot-probe-'));
const child = spawn(process.execPath, [bin, 'dev', '--port', String(PORT), '--test-scheduled', '--log-level', 'warn', '--persist-to', persist], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' } });
let log = '';
child.stdout.on('data', d => { log += d; });
child.stderr.on('data', d => { log += d; });
const kill = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch {} try { child.kill('SIGTERM'); } catch {} };
process.on('exit', kill);

async function ready() {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/`); if (r.status) return; } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('wrangler dev 沒有在 120 秒內啟動\n' + log.slice(-2000));
}
async function interaction(payload) {
  const body = JSON.stringify(payload); const ts = String(Math.floor(Date.now() / 1000));
  const sig = hex(await crypto.subtle.sign('Ed25519', keys.privateKey, new TextEncoder().encode(ts + body)));
  const r = await fetch(`http://127.0.0.1:${PORT}/`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-signature-ed25519': sig, 'x-signature-timestamp': ts } });
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; } catch { return { status: r.status, body: { error: text.slice(0, 200) } }; }
}
const USER = { id: '100000000000000001', username: 'alice', global_name: 'Alice' };
const base = extra => ({ id: String(Date.now()), token: 'itoken', application_id: '123', guild_id: '900000000000000001', channel_id: '800000000000000001', member: { user: USER, permissions: '32', roles: [] }, ...extra });
const buttonsOf = data => (data.components || []).flatMap(r => r.components).filter(c => c.type === 2).map(c => c.custom_id);

let fail = 0;
const ok = (cond, name, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); if (!cond) fail++; };
try {
  await ready();
  const ping = await interaction({ type: 1 }); ok(ping.status === 200 && ping.body.type === 1, 'PING → type 1', JSON.stringify(ping.body).slice(0, 120));
  const bad = await fetch(`http://127.0.0.1:${PORT}/`, { method: 'POST', body: '{"type":1}', headers: { 'x-signature-ed25519': '00'.repeat(64), 'x-signature-timestamp': '1' } }); ok(bad.status === 401, '錯誤簽章 → 401');
  const coin = await interaction(base({ type: 2, data: { name: 'coin' } })); ok(coin.body.type === 4 && /🪙/.test(coin.body.data.content), '/coin', JSON.stringify(coin.body).slice(0, 120));
  const tarot = await interaction(base({ type: 2, data: { name: 'tarot', options: [{ type: 3, name: 'spread', value: 'three' }] } })); ok(tarot.body.type === 4 && tarot.body.data.embeds?.[0]?.title?.includes('塔羅'), '/tarot 三張');
  const daily = await interaction(base({ type: 2, data: { name: 'daily' } })); ok(daily.body.type === 4 && /簽到/.test(JSON.stringify(daily.body.data)), '/daily');
  const bal = await interaction(base({ type: 2, data: { name: 'balance' } })); ok(/1[1-9]\d/.test(bal.body.data.content), '/balance 有簽到的錢', bal.body.data.content);
  const ttt = await interaction(base({ type: 2, data: { name: 'tictactoe' } })); const cell = buttonsOf(ttt.body.data)[0];
  const press = await interaction(base({ type: 3, data: { custom_id: cell, component_type: 2 }, message: { content: '', embeds: [], components: [] } })); ok(press.body.type === 7 && /井字/.test(press.body.data.content), '井字按鈕 → type 7');
  const ac = await interaction(base({ type: 4, data: { name: 'song', options: [{ type: 3, name: 'title', value: 'tell', focused: true }] } })); ok(ac.body.type === 8 && ac.body.data.choices.length > 0, '自動完成 → type 8');
  const mbti = await interaction(base({ type: 2, data: { name: 'mbti', options: [{ type: 1, name: 'type', options: [{ type: 3, name: 'type', value: 'INFP' }] }] } })); ok(mbti.body.type === 4 && /INFP/.test(mbti.body.data.embeds[0].title), '/mbti type INFP（子指令）');
  const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json(); ok(health.ok && health.features === 100 && health.users >= 1, '/health', JSON.stringify(health).slice(0, 160));
  const cron = await fetch(`http://127.0.0.1:${PORT}/__scheduled?cron=*+*+*+*+*`); ok(cron.status === 200, 'cron tick');
  const reg = await fetch(`http://127.0.0.1:${PORT}/register`, { method: 'POST' }); ok(reg.status === 401, '/register 無密鑰 → 401');
  const setup = await fetch(`http://127.0.0.1:${PORT}/setup`); ok(setup.status === 200 && /Bot token/.test(await setup.text()), '/setup 設定頁');
  const boot = await fetch(`http://127.0.0.1:${PORT}/bootstrap`, { method: 'POST', body: '{}' }); ok(boot.status === 400, '/bootstrap 缺 token → 400');
} catch (e) { ok(false, '流程中斷', e.message); }
kill();
await new Promise(r => setTimeout(r, 500));
try { fs.unlinkSync(devVars); } catch {}
try { fs.rmSync(persist, { recursive: true, force: true }); } catch {}
if (fail) { console.log('\n--- wrangler 輸出（節錄）---\n' + log.replace(/\n\s+at .*$/gm, '').slice(-1500)); process.exit(1); }
console.log('\nWorkers 版在本機 workerd 上全部通過。');
