/* Haruki 授權橋接（給菜根機器人）的回歸測試：
   瀏覽器端 POST/GET/DELETE /haruki/grant、機器人端 /api/bot/haruki/*、加解密、refresh 寫回、撤銷。
   D1 用 node:sqlite 模擬（schema.sql＋全部編號遷移），Haruki 用假 fetch。
   用法：node worker/test/haruki_grant.mjs   任何一項失敗就 exit 1。 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleHaruki, handleHarukiBot, grantEnc, grantDec, grantReady } from '../src/haruki.js';
import { bridgeHeaders } from '../src/bridge.js';

let fail = 0;
const ok = (cond, name) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) fail++; };

/* ---- 假 D1 ---- */
const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'sql');
const sq = new DatabaseSync(':memory:');
sq.exec(readFileSync(join(SQL_DIR, 'schema.sql'), 'utf8'));
const stmts = f => readFileSync(join(SQL_DIR, f), 'utf8').replace(/--[^\n]*/g, '').split(/;\s*(?:\n|$)/).map(x => x.trim()).filter(Boolean);
for (const f of readdirSync(SQL_DIR).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort()) {
  for (const st of stmts(f)) { try { sq.exec(st); } catch (e) { if (!/duplicate column|already exists/.test(e.message)) throw new Error('migration ' + f + ': ' + e.message); } }
}
const norm = a => a.map(v => (v === undefined ? null : v));
const mkStmt = (sql, args = []) => ({
  bind: (...a) => mkStmt(sql, a),
  first: async () => sq.prepare(sql).get(...norm(args)) ?? null,
  all: async () => ({ results: sq.prepare(sql).all(...norm(args)) }),
  run: async () => { const r = sq.prepare(sql).run(...norm(args)); return { meta: { changes: Number(r.changes) } }; },
  _exec: () => sq.prepare(sql).run(...norm(args)),
});
const DB = { prepare: sql => mkStmt(sql), batch: async sts => { sq.exec('BEGIN'); try { const r = sts.map(s => s._exec()); sq.exec('COMMIT'); return r; } catch (e) { sq.exec('ROLLBACK'); throw e; } } };
const row = uid => sq.prepare('SELECT * FROM haruki_grants WHERE uid = ?').get(uid);
ok(!!sq.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='haruki_grants'").get(), '018 遷移建出 haruki_grants');

/* ---- 假 Haruki ---- */
const UID = '7482960281734567890', OTHER = '1234567890123';
const SITE = 'https://project-sekai-center.com';
const BRIDGE = 'a'.repeat(64);
const env = { DB, SITE_BASE: SITE, HARUKI_OAUTH_BASE: 'https://hk.test', HARUKI_OAUTH_CLIENT_ID: 'pjsk-center', HARUKI_OAUTH_CLIENT_SECRET: 'top-secret', HARUKI_GRANT_KEY: 'grant-key-123', CAIBOT_BRIDGE_SECRET: BRIDGE };
const tokens = { 'acc-browser': UID, 'acc-fresh': UID, 'acc-other': OTHER };   // access → 綁定的台服 uid
let refreshMode = 'ok';   // ok | invalid | down | rotate
const calls = [];
const SUITE = { userGamedata: { userId: UID, name: '甲' }, userCards: [{ cardId: 1 }] };
globalThis.fetch = async (u, init) => {
  const url = String(u), h = (init && init.headers) || {};
  calls.push({ url, method: (init && init.method) || 'GET', headers: h, body: init && init.body });
  const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } });
  const bearer = String(h.authorization || '').replace(/^Bearer /, '');
  if (url === 'https://hk.test/api/oauth2/user/bindings') {
    if (!tokens[bearer]) return J({ error: 'invalid_token' }, 401);
    return new Response('[{"server":"jp","userId":11112222333344445,"verified":true},{"server":"tw","userId":' + tokens[bearer] + ',"verified":true},{"server":"tw","userId":5555566666777,"verified":false}]', { status: 200 });
  }
  if (url === 'https://hk.test/api/oauth2/token') {
    const form = new URLSearchParams(String(init.body));
    if (form.get('grant_type') !== 'refresh_token' || !/^Basic /.test(h.authorization || '')) return J({ error: 'invalid_client' }, 401);
    if (refreshMode === 'invalid') return J({ error: 'invalid_grant' }, 400);
    if (refreshMode === 'down') return J({ error: 'server_error' }, 500);
    if (form.get('refresh_token') !== 'refresh-1' && form.get('refresh_token') !== 'refresh-2') return J({ error: 'invalid_grant' }, 400);
    return J(refreshMode === 'rotate' ? { access_token: 'acc-fresh', refresh_token: 'refresh-2', expires_in: 3600 } : { access_token: 'acc-fresh', expires_in: 3600 });
  }
  const g = /^https:\/\/hk\.test\/api\/oauth2\/game-data\/tw\/(suite|mysekai)\/(\d+)$/.exec(url);
  if (g) {
    if (!tokens[bearer] || bearer === 'acc-stale') return J({ error: 'invalid_token' }, 401);
    if (tokens[bearer] !== g[2]) return J({ error: 'forbidden' }, 403);
    if (g[1] === 'mysekai') return J({ error: 'not_found', message: '沒上傳' }, 404);
    return J({ updatedData: SUITE, updatedAt: 1 });
  }
  return J({ error: 'unexpected ' + url }, 599);
};

const site = (path, init) => { const r = new Request('https://games.test' + path, init); return handleHaruki(r, env, new URL(r.url)); };
const siteH = (tok, extra) => ({ origin: SITE, authorization: 'Bearer ' + tok, 'content-type': 'application/json', ...(extra || {}) });
const bot = async (path, opts) => {
  const o = opts || {};
  const hdr = await bridgeHeaders(o.secret || BRIDGE, { method: 'GET', pathq: o.pathq || path, ident: o.ident || '', ip: o.ip == null ? 'bot' : o.ip, body: null });
  const r = new Request('https://games.test' + path, { headers: hdr });
  return handleHarukiBot(r, env, new URL(r.url));
};
const bodies = [];   // 所有回應內容，最後掃一次確認沒有 token 外洩
const read = async res => { const t = await res.text(); bodies.push(t); let j = null; try { j = JSON.parse(t); } catch (e) {} return j; };

/* 1. 未設定 → 503 */
{
  const bare = { ...env, HARUKI_GRANT_KEY: '' };
  const r = await handleHaruki(new Request('https://games.test/haruki/grant', { method: 'POST', headers: siteH('acc-browser'), body: '{}' }), bare, new URL('https://games.test/haruki/grant'));
  ok(r.status === 503 && (await read(r)).error === 'not_configured', '沒設 HARUKI_GRANT_KEY：POST /haruki/grant 回 503 not_configured');
  const r2 = await handleHaruki(new Request('https://games.test/haruki/grant/' + UID, { headers: siteH('acc-browser') }), { ...env, HARUKI_OAUTH_CLIENT_SECRET: '' }, new URL('https://games.test/haruki/grant/' + UID));
  ok(r2.status === 503, '沒設 HARUKI_OAUTH_CLIENT_SECRET：GET /haruki/grant/{uid} 也回 503');
  const hdr = await bridgeHeaders(BRIDGE, { method: 'GET', pathq: '/api/bot/haruki/suite/' + UID, ident: '', ip: 'bot', body: null });
  const r3 = await handleHarukiBot(new Request('https://games.test/api/bot/haruki/suite/' + UID, { headers: hdr }), bare, new URL('https://games.test/api/bot/haruki/suite/' + UID));
  ok(r3.status === 503 && (await read(r3)).error === 'not_configured', '沒設金鑰時機器人端也回 503');
  ok(grantReady(env) && !grantReady(bare), 'grantReady 看 HARUKI_GRANT_KEY＋CLIENT_SECRET＋CLIENT_ID');
}

/* 2. 加解密 */
{
  const c1 = await grantEnc(env, 'refresh-1'), c2 = await grantEnc(env, 'refresh-1');
  ok(c1 !== 'refresh-1' && !c1.includes('refresh-1') && /^[\w-]+$/.test(c1), '密文是 base64url，不含明文');
  ok(c1 !== c2 && await grantDec(env, c1) === 'refresh-1' && await grantDec(env, c2) === 'refresh-1', '每次 iv 隨機、密文不同，解回同一個明文');
  let bad = false; try { await grantDec({ HARUKI_GRANT_KEY: 'other-key' }, c1); } catch (e) { bad = true; }
  ok(bad, '換金鑰解不開（AES-GCM 驗證失敗）');
}

/* 3. 瀏覽器端 POST */
{
  let r = await site('/haruki/grant', { method: 'POST', headers: { origin: SITE, 'content-type': 'application/json' }, body: JSON.stringify({ uid: UID, refresh_token: 'refresh-1' }) });
  ok(r.status === 401 && (await read(r)).error === 'invalid_token', '沒帶 Bearer → 401');
  r = await site('/haruki/grant', { method: 'POST', headers: siteH('acc-browser'), body: JSON.stringify({ uid: 'abc', refresh_token: 'refresh-1' }) });
  ok(r.status === 400 && (await read(r)).error === 'bad_uid', 'uid 不是數字 → 400 bad_uid');
  r = await site('/haruki/grant', { method: 'POST', headers: siteH('acc-browser'), body: JSON.stringify({ uid: OTHER, refresh_token: 'refresh-1' }) });
  ok(r.status === 403 && (await read(r)).error === 'uid_not_bound', '這個 Haruki 帳號沒綁這個 uid → 403 uid_not_bound');
  r = await site('/haruki/grant', { method: 'POST', headers: siteH('acc-browser'), body: JSON.stringify({ uid: '5555566666777', refresh_token: 'refresh-1' }) });
  ok(r.status === 403, '綁了但 verified=false 也不算 → 403');
  r = await site('/haruki/grant', { method: 'POST', headers: siteH('acc-nope'), body: JSON.stringify({ uid: UID, refresh_token: 'refresh-1' }) });
  ok(r.status === 401, 'Haruki 說 token 無效 → 401');
  calls.length = 0;
  r = await site('/haruki/grant', { method: 'POST', headers: siteH('acc-browser'), body: JSON.stringify({ uid: UID, refresh_token: 'refresh-1', access_token: 'acc-browser', expires_in: 3600, scope: 'offline_access game-data:read' }) });
  const j = await read(r);
  ok(r.status === 200 && j.ok === true && j.uid === UID && Number.isInteger(j.since) && j.since > 1700000000, 'POST 成功回 {ok, uid, since}');
  ok(calls.some(c => c.url.endsWith('/user/bindings') && c.headers.authorization === 'Bearer acc-browser'), '用瀏覽器的 Bearer 去 Haruki 查 bindings');
  ok(r.headers.get('access-control-allow-origin') === SITE && /DELETE/.test(r.headers.get('access-control-allow-methods') || ''), 'CORS 只給本站，且放行 DELETE');
  const g = row(UID);
  ok(g && g.refresh_enc !== 'refresh-1' && !g.refresh_enc.includes('refresh-1') && g.access_enc && !g.access_enc.includes('acc-browser'), 'D1 裡的 refresh／access 都是密文');
  ok(await grantDec(env, g.refresh_enc) === 'refresh-1' && await grantDec(env, g.access_enc) === 'acc-browser', '密文解得回原 token');
  ok(g.access_exp > Math.floor(Date.now() / 1000) + 3000 && g.revoked_at == null && g.fail_n === 0 && g.scope === 'offline_access game-data:read', 'access_exp／scope 寫入，revoked_at 空、fail_n 0');
  r = await site('/haruki/grant/' + UID, { headers: siteH('acc-browser') });
  const s = await read(r);
  ok(r.status === 200 && s.granted === true && s.since === j.since && s.last_used_at === null, 'GET /haruki/grant/{uid} 回 granted:true、since、last_used_at');
  r = await site('/haruki/grant/' + OTHER, { headers: siteH('acc-browser') });
  ok(r.status === 403, 'GET 別人的 uid → 403');
  r = await site('/haruki/grant/' + OTHER, { headers: siteH('acc-other') });
  ok(r.status === 200 && (await read(r)).granted === false, '沒授權過的 uid（但確實是本人）→ granted:false');
  r = await site('/haruki/grant', { method: 'OPTIONS', headers: { origin: SITE, 'access-control-request-method': 'POST' } });
  ok(r.status === 204 && r.headers.get('access-control-allow-origin') === SITE, 'OPTIONS 預檢 204');
}

/* 4. 機器人端 */
{
  let r = await bot('/api/bot/haruki/suite/' + UID, { secret: 'b'.repeat(64) });
  ok(r.status === 401 && (await read(r)).error === 'bad_signature', '簽章用錯密鑰 → 401');
  r = await bot('/api/bot/haruki/suite/' + UID, { ident: 'someone' });
  ok(r.status === 401 && (await read(r)).why === 'bad_direction', 'ident 非空（不是機器人方向）→ 401');
  r = await bot('/api/bot/haruki/suite/' + UID, { ip: 'x' });
  ok(r.status === 401, 'ip 不是 "bot" → 401');
  r = await bot('/api/bot/haruki/suite/' + UID, { pathq: '/api/bot/haruki/suite/' + OTHER });
  ok(r.status === 401, 'pathq 與實際路徑不同 → 401');
  r = await bot('/api/bot/haruki/suite/' + OTHER);
  ok(r.status === 404 && (await read(r)).error === 'no_grant', '沒授權的 uid → 404 no_grant');
  r = await bot('/api/bot/haruki/profile/' + UID);
  ok(r.status === 404, '不認得的類型 → 404');
  r = await bot('/api/bot/haruki/grant/' + UID);
  let j = await read(r);
  ok(r.status === 200 && j.granted === true && j.uid === UID && j.types.join() === 'suite,mysekai' && Number.isInteger(j.since), 'grant 狀態端點回 {granted, since, types}');

  calls.length = 0;
  r = await bot('/api/bot/haruki/suite/' + UID);
  j = await read(r);
  ok(r.status === 200 && j.updatedData && j.updatedData.userGamedata.name === '甲', 'access 還有效：直接讀 suite，回應原樣轉回');
  ok(!calls.some(c => c.url.endsWith('/api/oauth2/token')), '沒有去換 token');
  ok(calls.some(c => /game-data\/tw\/suite\//.test(c.url) && c.headers.authorization === 'Bearer acc-browser'), '用存起來的 access 打 game-data');
  ok(r.headers.get('cache-control') === 'private, max-age=60', 'cache-control: private, max-age=60');
  ok(Number.isInteger(row(UID).last_used_at), '200 之後更新 last_used_at');
  r = await bot('/api/bot/haruki/mysekai/' + UID);
  ok(r.status === 404 && (await read(r)).message === '沒上傳' && r.headers.get('cache-control') === 'no-store', 'Haruki 回 404 就照樣回 404，不快取');

  // 重放：同一組標頭送兩次
  const hdr = await bridgeHeaders(BRIDGE, { method: 'GET', pathq: '/api/bot/haruki/grant/' + UID, ident: '', ip: 'bot', body: null });
  const mk = () => handleHarukiBot(new Request('https://games.test/api/bot/haruki/grant/' + UID, { headers: hdr }), env, new URL('https://games.test/api/bot/haruki/grant/' + UID));
  const a = await mk(), b = await mk();
  ok(a.status === 200 && b.status === 401 && (await read(b)).error === 'replay', '同一個 nonce 第二次 → 401 replay');
  await read(a);

  // access 過期 → refresh（輪替）→ 寫回
  sq.prepare('UPDATE haruki_grants SET access_exp = ? WHERE uid = ?').run(Math.floor(Date.now() / 1000) - 10, UID);
  refreshMode = 'rotate'; calls.length = 0;
  r = await bot('/api/bot/haruki/suite/' + UID);
  j = await read(r);
  const tk = calls.find(c => c.url.endsWith('/api/oauth2/token'));
  ok(r.status === 200 && j.updatedData && tk, 'access 過期：先換 token 再讀，仍回 200');
  ok(tk && tk.method === 'POST' && tk.headers.authorization === 'Basic ' + btoa('pjsk-center:top-secret') && new URLSearchParams(String(tk.body)).get('grant_type') === 'refresh_token' && new URLSearchParams(String(tk.body)).get('refresh_token') === 'refresh-1' && !new URLSearchParams(String(tk.body)).has('client_id'), 'refresh 用 client_secret_basic（Basic 認證、表單不帶 client_id）');
  ok(calls.some(c => /game-data/.test(c.url) && c.headers.authorization === 'Bearer acc-fresh'), '讀資料改用新的 access');
  let g = row(UID);
  ok(await grantDec(env, g.access_enc) === 'acc-fresh' && await grantDec(env, g.refresh_enc) === 'refresh-2' && g.access_exp > Math.floor(Date.now() / 1000) + 3000, '新的 access 與輪替後的 refresh 都加密寫回');

  // 存起來的 access 被對方提前作廢（401）→ 自動換一次
  sq.prepare('UPDATE haruki_grants SET access_enc = ?, access_exp = ? WHERE uid = ?').run(await grantEnc(env, 'acc-stale'), Math.floor(Date.now() / 1000) + 3000, UID);
  tokens['acc-stale'] = UID; refreshMode = 'ok'; calls.length = 0;
  r = await bot('/api/bot/haruki/suite/' + UID);
  ok(r.status === 200 && calls.filter(c => /game-data/.test(c.url)).length === 2 && calls.some(c => c.url.endsWith('/api/oauth2/token')), 'access 未到期卻被 Haruki 回 401：換一次 token 重讀');
  await read(r);

  // refresh 失敗（非 invalid_grant）→ 502、fail_n+1，授權保留
  sq.prepare('UPDATE haruki_grants SET access_exp = ? WHERE uid = ?').run(0, UID);
  refreshMode = 'down';
  r = await bot('/api/bot/haruki/suite/' + UID);
  ok(r.status === 502 && (await read(r)).error === 'refresh_failed' && row(UID).fail_n === 1 && row(UID).revoked_at == null, 'Haruki 換 token 掛了 → 502，fail_n+1，授權不撤');

  // invalid_grant → 撤銷
  refreshMode = 'invalid';
  r = await bot('/api/bot/haruki/suite/' + UID);
  ok(r.status === 404 && (await read(r)).error === 'revoked' && Number.isInteger(row(UID).revoked_at), 'refresh 回 invalid_grant → 設 revoked_at，回 404 revoked');
  r = await bot('/api/bot/haruki/grant/' + UID);
  ok(r.status === 404 && (await read(r)).error === 'revoked', '撤銷後 grant 狀態端點也回 404 revoked');
  r = await site('/haruki/grant/' + UID, { headers: siteH('acc-browser') });
  ok((await read(r)).granted === false, '瀏覽器端看到 granted:false');
}

/* 5. 重新允許 → 撤銷 */
{
  refreshMode = 'ok';
  let r = await site('/haruki/grant', { method: 'POST', headers: siteH('acc-browser'), body: JSON.stringify({ uid: UID, refresh_token: 'refresh-1', access_token: 'acc-browser', expires_in: 3600 }) });
  const j = await read(r);
  const g = row(UID);
  ok(r.status === 200 && g.revoked_at == null && g.fail_n === 0 && j.since === g.created_at, '重新允許：revoked_at 清空、fail_n 歸零，since 仍是第一次允許的時間');
  r = await bot('/api/bot/haruki/suite/' + UID);
  ok(r.status === 200, '重新允許後機器人又讀得到'); await read(r);
  r = await site('/haruki/grant/' + UID, { method: 'DELETE', headers: siteH('acc-other') });
  ok(r.status === 403 && row(UID).revoked_at == null, '別人的 token 不能撤銷我的授權');
  r = await site('/haruki/grant/' + UID, { method: 'DELETE', headers: siteH('acc-browser') });
  ok(r.status === 200 && (await read(r)).ok === true && Number.isInteger(row(UID).revoked_at), 'DELETE 撤銷 → 設 revoked_at');
  r = await bot('/api/bot/haruki/suite/' + UID);
  ok(r.status === 404 && (await read(r)).error === 'revoked', '撤銷後機器人端 404 revoked');
  r = await site('/haruki/grant/' + UID, { headers: siteH('acc-browser') });
  ok((await read(r)).granted === false, '撤銷後 GET 回 granted:false');
}

/* 6. 沒有任何回應外洩 token */
{
  const leak = bodies.filter(b => /refresh-1|refresh-2|acc-browser|acc-fresh|acc-stale|top-secret|grant-key/.test(b));
  if (leak.length) console.log('  外洩的回應：', leak.map(x => x.slice(0, 160)));
  ok(bodies.length > 20 && leak.length === 0, '全部 ' + bodies.length + ' 個回應都不含 refresh／access／secret');
}

console.log(fail ? ('\n' + fail + ' 項失敗') : '\n全部通過');
process.exit(fail ? 1 : 0);
