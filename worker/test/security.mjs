/* 安全審查的重現步驟 → 回歸測試。
   用法：
     node worker/test/security.mjs            在 Node 裡直接跑 Worker 的 fetch handler（D1 用 node:sqlite 模擬,
                                              discord.com／Google／菜根機器人用假 fetch）—— 全部情境。
     node worker/test/security.mjs --http http://localhost:8801 <本機 D1 sqlite 檔>
                                              打 `wrangler dev --local` 跑起來的 Worker（需要 .dev.vars 設
                                              SESSION_SECRET、CAIBOT_BRIDGE_SECRET=test-secret、
                                              CAIBOT_API_BASE=http://127.0.0.1:8802）；這個模式會自己在 8802
                                              開假機器人,OAuth 情境略過（wrangler 打不到假的 Discord）。
   需要 Node 22.5+（node:sqlite）。任何一項失敗就 exit 1。 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bridgeHeaders, bridgeVerify, cleanSecret } from '../src/bridge.js';
import { signToken, safePath, scriptStr, bounce } from '../src/auth.js';
import { ipKey } from '../src/accounts.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL_DIR = join(HERE, '..', 'sql');
const SITE = 'https://project-sekai-center.com';
const SECRET = 'test-secret';
const HTTP = process.argv[2] === '--http' ? process.argv[3] : null;
const W = HTTP || 'https://games.test';

/* ---------- 資料庫 ---------- */
let sq;
if (HTTP) {
  sq = new DatabaseSync(process.argv[4]);
} else {
  sq = new DatabaseSync(':memory:');
  /* schema.sql 是完整結構快照：空資料庫一次跑完必須成功（不容許任何錯誤）。
     接著把每支編號遷移逐句套上去,確認它們對「已是最新」的資料庫只會報 duplicate column / already exists,
     不會有別的錯（例如遷移引用了快照裡沒有的欄位）。 */
  sq.exec(readFileSync(join(SQL_DIR, 'schema.sql'), 'utf8'));
  const stmts = f => readFileSync(join(SQL_DIR, f), 'utf8').replace(/--[^\n]*/g, '').split(/;\s*(?:\n|$)/).map(x => x.trim()).filter(Boolean);
  for (const f of readdirSync(SQL_DIR).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort()) {
    for (const st of stmts(f)) {
      try { sq.exec(st); } catch (e) {
        if (!/duplicate column|already exists/.test(e.message)) throw new Error('migration ' + f + ': ' + e.message + ' :: ' + st.slice(0, 80));
      }
    }
  }
  for (const t of ['user_passwords', 'user_qq', 'qq_codes', 'login_fail', 'bridge_nonce']) sq.prepare('SELECT 1 FROM ' + t).get();
  sq.prepare('SELECT session_ver FROM users').get();
}
const norm = a => a.map(v => (v === undefined ? null : v));
const mkStmt = (sql, args = []) => ({
  bind: (...a) => mkStmt(sql, a),
  first: async () => sq.prepare(sql).get(...norm(args)) ?? null,
  all: async () => ({ results: sq.prepare(sql).all(...norm(args)) }),
  run: async () => { const r = sq.prepare(sql).run(...norm(args)); return { meta: { changes: Number(r.changes) } }; },
  _exec: () => sq.prepare(sql).run(...norm(args)),
});
const DB = {
  prepare: sql => mkStmt(sql),
  batch: async sts => { sq.exec('BEGIN'); try { const r = sts.map(s => s._exec()); sq.exec('COMMIT'); return r; } catch (e) { sq.exec('ROLLBACK'); throw e; } },
};
const q1 = (sql, ...a) => sq.prepare(sql).get(...a);
const qa = (sql, ...a) => sq.prepare(sql).all(...a);
const reset = () => sq.exec('DELETE FROM users; DELETE FROM user_passwords; DELETE FROM user_qq; DELETE FROM qq_codes; DELETE FROM login_fail; DELETE FROM bridge_nonce;');

/* ---------- 假的外部服務 ---------- */
const botSeen = [];
function fakeBot(path, headers) {
  botSeen.push({ path, headers });
  if (path.startsWith('/api/htmlecho')) return { status: 404, ct: 'text/html; charset=utf-8', body: '<html><body>not found: ' + decodeURIComponent(path) + '</body></html>' };
  if (path.startsWith('/api/html200')) return { status: 200, ct: 'text/html', body: '<script>alert(1)</script>' };
  if (path.startsWith('/api/plain404')) return { status: 404, ct: 'text/plain; charset=utf-8', body: '404: Not Found' };
  return { status: 200, ct: 'application/json', body: JSON.stringify({ path, hdrs: headers }) };
}
let discordMe = null, googleProf = null;
const env = {
  DB, SESSION_SECRET: 'h-secret', CAIBOT_BRIDGE_SECRET: SECRET, CAIBOT_API_BASE: 'https://bot.test',
  DISCORD_CLIENT_ID: 'c', DISCORD_CLIENT_SECRET: 's', GOOGLE_CLIENT_ID: 'gc', GOOGLE_CLIENT_SECRET: 'gs',
  OAUTH_BASE: W, SITE_BASE: SITE, COOKIE_DOMAIN: '.project-sekai-center.com',
};
let worker = null, botServer = null;
if (!HTTP) {
  worker = (await import('../src/index.js')).default;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const s = String(u instanceof Request ? u.url : u);
    if (s.startsWith('https://discord.com/api/oauth2/token')) return new Response(JSON.stringify({ access_token: 'AT' }), { headers: { 'content-type': 'application/json' } });
    if (s.startsWith('https://discord.com/api/users/@me')) return new Response(JSON.stringify(discordMe));
    if (s.startsWith('https://oauth2.googleapis.com/token')) {
      const pl = Buffer.from(JSON.stringify(googleProf)).toString('base64url');
      return new Response(JSON.stringify({ id_token: 'x.' + pl + '.y' }), { headers: { 'content-type': 'application/json' } });
    }
    if (s.startsWith('https://bot.test/')) {
      const h = {}; new Headers(init && init.headers).forEach((v, k) => { h[k] = v; });
      const r = fakeBot(s.slice('https://bot.test'.length), h);
      return new Response(r.body, { status: r.status, headers: { 'content-type': r.ct } });
    }
    return realFetch(u, init);
  };
} else {
  botServer = createServer((req, res) => {
    const r = fakeBot(req.url, req.headers);
    res.writeHead(r.status, { 'Content-Type': r.ct }); res.end(r.body);
  }).listen(8802, '127.0.0.1');
}

/* ---------- 呼叫工具 ---------- */
async function send(method, path, { body, cookie, origin = SITE, ip = '1.1.1.1', headers = {}, raw } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  if (cookie) h.Cookie = cookie;
  if (ip) h['CF-Connecting-IP'] = ip;
  if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
  const init = { method, headers: h, body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)), redirect: 'manual' };
  const r = HTTP ? await fetch(W + path, init) : await worker.fetch(new Request(W + path, init), env);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch (e) { j = t; }
  return { r, j, status: r.status, text: t, h: r.headers };
}
const setCookies = r => (typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || '']);
const sessionOf = r => { for (const c of setCookies(r)) { const m = c.match(/sekai_session=([^;]+)/); if (m) return 'sekai_session=' + m[1]; } return null; };
async function bot(body) {
  const raw = JSON.stringify(body);
  const h = await bridgeHeaders(SECRET, { method: 'POST', pathq: '/car/qqbind', ident: '', ip: 'bot', body: new TextEncoder().encode(raw) });
  const init = { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: raw };
  const r = HTTP ? await fetch(W + '/car/qqbind', init) : await worker.fetch(new Request(W + '/car/qqbind', init), env);
  return await r.json();
}
const ccOf = t => { const m = String(t || '').match(/\/网页 (\d{6})/); return m ? m[1] : null; };
const start = (purpose, extra = {}) => send('POST', '/auth/qq/start', { body: { purpose, ...extra.body }, cookie: extra.cookie, ip: extra.ip || '1.1.1.1' });
const poll = k => send('GET', '/auth/qq/poll?k=' + k, { origin: null });
/* 兩步完成：送碼 → 拿確認碼 → 同一個 QQ 送確認碼 */
async function twoStep(code, g, m, name) {
  const a = await bot({ code, g, m, name });
  const cc = ccOf(a.text);
  if (!a.ok || !cc) return { a };
  const b = await bot({ code: cc, g, m, name });
  return { a, b, cc };
}
async function registerVia(username, password, g, m, name, ip) {
  const s = await start('register', { body: { username, password }, ip });
  const t = await twoStep(s.j.code, g, m, name);
  const p = await poll(s.j.k);
  return { cookie: sessionOf(p.r), s, t, p };
}
const uidOf = username => (q1('SELECT user_id FROM user_passwords WHERE username=?', username) || {}).user_id;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); }
};
const section = t => console.log('\n== ' + t);

/* ================= 情境 ================= */

section('0. ipKey 正規化');
ok('IPv4 原樣', ipKey('1.2.3.4') === '1.2.3.4');
ok('IPv6 取 /64', ipKey('2001:db8::1d') === '2001:db8:0:0::/64' && ipKey('2001:0db8:0000:0000:ffff::1') === '2001:db8:0:0::/64');
ok('IPv6 不同 /64 不同鍵', ipKey('2001:db8:0:1::1') !== ipKey('2001:db8:0:2::1'));
ok('IPv4-mapped', ipKey('::ffff:9.9.9.9') === '9.9.9.9');

section('R. 正常流程：QQ 註冊（兩步）、登入、QQ 重設密碼');
reset();
{
  const s = await start('register', { body: { username: 'alice01', password: 'alicepass1' } });
  const a = await bot({ code: s.j.code, g: 'G1', m: 'MA1', name: '愛麗絲' });
  ok('第一步回警告＋確認碼', a.ok && ccOf(a.text) && /注册/.test(a.text), a);
  ok('群裡回覆不含帳號名', !/alice01/.test(a.text), a.text);
  ok('第一步後尚未建帳號', !uidOf('alice01'));
  const p1 = await poll(s.j.k);
  ok('輪詢 pending＋stage=confirm＋QQ 名', p1.j.status === 'pending' && p1.j.stage === 'confirm' && p1.j.qq && p1.j.qq.n === '愛麗絲', p1.j);
  const dup = await bot({ code: s.j.code, g: 'G1', m: 'MA1', name: '愛麗絲' });
  ok('同一個 QQ 重送主碼 → 同一組確認碼、不作廢', dup.ok && ccOf(dup.text) === ccOf(a.text), dup);
  const b = await bot({ code: ccOf(a.text), g: 'G1', m: 'MA1', name: '愛麗絲' });
  ok('第二步完成', b.ok && !/alice01/.test(b.text), b);
  const p2 = await poll(s.j.k);
  ok('輪詢 done 並設 cookie', p2.j.status === 'done' && !!sessionOf(p2.r), p2.j);
  const me = await send('GET', '/api/me', { cookie: sessionOf(p2.r) });
  ok('/api/me 是 alice01', me.j.user && me.j.user.username === 'alice01', me.j);
  const l = await send('POST', '/auth/password/login', { body: { username: 'alice01', password: 'alicepass1' } });
  ok('帳密登入 200', l.status === 200 && !!sessionOf(l.r), l.j);
  const r = await start('reset', { body: { username: 'alice01' } });
  const t = await twoStep(r.j.code, 'G1', 'MA1', '愛麗絲');
  ok('重設第一步警告帶遮罩帳號名', /重置/.test(t.a.text) && /al\*+1/.test(t.a.text) && !/alice01/.test(t.a.text), t.a);
  const rp = await poll(r.j.k);
  ok('重設輪詢拿到 resetToken', rp.j.status === 'done' && !!rp.j.resetToken, rp.j);
  const rs = await send('POST', '/auth/password/reset', { body: { resetToken: rp.j.resetToken, password: 'alicepass2' } });
  ok('重設 200', rs.status === 200 && !!sessionOf(rs.r), rs.j);
  ok('重設前的 cookie 失效（session_ver）', (await send('GET', '/api/me', { cookie: sessionOf(p2.r) })).j.user === null);
  ok('重設後拿到的 cookie 有效', ((await send('GET', '/api/me', { cookie: sessionOf(rs.r) })).j.user || {}).username === 'alice01');
}

section('A. 碼失敗後不再放回：同群旁觀者不能接手');
reset();
{
  const V = await registerVia('victim01', 'victimpass1', 'G1', 'MV', '受害者', '1.1.1.1');
  await registerVia('oldacct', 'oldpass123', 'G2', 'MV2', '受害者舊號', '1.1.1.2');
  ok('前置：兩個帳號都註冊成功', !!V.cookie && !!uidOf('oldacct'));
  const s = await start('link', { cookie: V.cookie });
  const v1 = await bot({ code: s.j.code, g: 'G2', m: 'MV2', name: '受害者' });
  ok('受害者用已綁別帳號的 QQ 送碼 → 失敗', v1.ok === false, v1);
  const a1 = await bot({ code: s.j.code, g: 'G2', m: 'MA', name: '路人' });
  ok('旁觀者照抄同一個碼 → 無效（沒有被放回）', a1.ok === false && !ccOf(a1.text), a1);
  ok('攻擊者 QQ 沒有綁上受害者帳號', !q1("SELECT 1 FROM user_qq WHERE group_openid='G2' AND member_openid='MA'"));
  const p = await poll(s.j.k);
  ok('受害者網頁輪詢拿到 fail(qq_taken)', p.j.status === 'fail' && p.j.reason === 'qq_taken' && !!p.j.message, p.j);
  ok('fail 兌換後 k 失效', (await poll(s.j.k)).j.status === 'expired');
  const r1 = await start('reset', { body: { username: 'victim01' }, ip: '6.6.6.6' });
  const ar = await twoStep(r1.j.code, 'G2', 'MA', '路人');
  ok('攻擊者拿自己的 QQ 重設受害者密碼 → 拒絕', ar.a.ok === false && !ar.b, ar);
  ok('重設輪詢 fail(not_linked)、沒有 resetToken', (await poll(r1.j.k)).j.status === 'fail');
  ok('受害者舊密碼仍可登入', (await send('POST', '/auth/password/login', { body: { username: 'victim01', password: 'victimpass1' } })).status === 200);

  section('A2. 等確認時另一個 QQ 照抄主碼 → 整張作廢');
  const s2 = await start('link', { cookie: V.cookie });
  const v2 = await bot({ code: s2.j.code, g: 'G3', m: 'MV3', name: '受害者' });
  const cc = ccOf(v2.text);
  ok('受害者第一步拿到確認碼（警告寫出目標帳號名）', v2.ok && !!cc && /受害者/.test(v2.text), v2);
  const a2 = await bot({ code: s2.j.code, g: 'G3', m: 'MA3', name: '受害者' });
  ok('旁觀者照抄主碼 → 拒絕', a2.ok === false, a2);
  const v3 = await bot({ code: cc, g: 'G3', m: 'MV3', name: '受害者' });
  ok('作廢後本人的確認碼也失效', v3.ok === false, v3);
  const p2 = await poll(s2.j.k);
  ok('輪詢 fail(contested)', p2.j.status === 'fail' && p2.j.reason === 'contested', p2.j);
  ok('沒有任何 G3 身分被綁上', !q1("SELECT 1 FROM user_qq WHERE group_openid='G3'"));

  section('A3. 旁觀者照抄確認碼 → 拒絕,本人仍可完成');
  const s3 = await start('link', { cookie: V.cookie });
  const w1 = await bot({ code: s3.j.code, g: 'G4', m: 'MV4', name: '受害者' });
  const cc3 = ccOf(w1.text);
  const w2 = await bot({ code: cc3, g: 'G4', m: 'MA4', name: '路人' });
  ok('別人送確認碼 → 不是發給你的', w2.ok === false && /不是发给你/.test(w2.text), w2);
  const w3 = await bot({ code: cc3, g: 'G4', m: 'MV4', name: '受害者' });
  ok('本人送確認碼 → 完成', w3.ok === true, w3);
  const p3 = await poll(s3.j.k);
  ok('輪詢 done(link)', p3.j.status === 'done' && p3.j.purpose === 'link', p3.j);
  ok('綁上的是本人 G4:MV4', (q1("SELECT user_id FROM user_qq WHERE group_openid='G4' AND member_openid='MV4'") || {}).user_id === uidOf('victim01')
    && !q1("SELECT 1 FROM user_qq WHERE member_openid='MA4'"));

  section('A4. 處理中出錯也作廢,不放回');
  if (HTTP) console.log('  (http 模式略過：要暫時改名資料表)');
  else {
  const s4 = await start('link', { cookie: V.cookie });
  sq.exec('ALTER TABLE user_qq RENAME TO user_qq_x');
  const e1 = await bot({ code: s4.j.code, g: 'G5', m: 'MV5', name: '受害者' });
  sq.exec('ALTER TABLE user_qq_x RENAME TO user_qq');
  ok('出錯回 ok:false', e1.ok === false, e1);
  const e2 = await bot({ code: s4.j.code, g: 'G5', m: 'MA5', name: '路人' });
  ok('出錯後同一個碼不能再用', e2.ok === false && !ccOf(e2.text), e2);
  ok('輪詢 fail(error)', (await poll(s4.j.k)).j.status === 'fail');
  }
}

section('B. 重設釣魚：攻擊者發碼、騙受害者送出 → 受害者看到警告,只送第一步的話攻擊者拿不到 token');
reset();
{
  const V = await registerVia('victim02', 'victimpass2', 'G1', 'MV', '受害者', '1.1.1.1');
  const r1 = await start('reset', { body: { username: 'victim02' }, ip: '6.6.6.6' });
  const b1 = await bot({ code: r1.j.code, g: 'G1', m: 'MV', name: '受害者' });
  ok('受害者第一次送碼：回警告（重設密碼、別人叫你發的請忽略）,不是「驗證成功」',
    b1.ok && /重置/.test(b1.text) && /忽略/.test(b1.text) && !/验证成功/.test(b1.text), b1);
  const p = await poll(r1.j.k);
  ok('攻擊者輪詢只拿到 pending,沒有 resetToken', p.j.status === 'pending' && !p.j.resetToken, p.j);
  const rs = await send('POST', '/auth/password/reset', { body: { resetToken: 'x.y', password: 'pwned12345' }, ip: '6.6.6.6' });
  ok('沒有 token 無法重設', rs.status === 400);
  ok('受害者密碼沒變', (await send('POST', '/auth/password/login', { body: { username: 'victim02', password: 'victimpass2' } })).status === 200);

  section('B2. 綁定釣魚：受害者第一次送攻擊者的 link 碼 → 警告寫出攻擊者帳號名,不綁');
  const A = await registerVia('attacker', 'attackpass', 'G9', 'MA', '攻擊者', '6.6.6.6');
  const s = await start('link', { cookie: A.cookie, ip: '6.6.6.6' });
  const b2 = await bot({ code: s.j.code, g: 'G3', m: 'MV3', name: '受害者' });
  ok('警告寫明要綁到「攻擊者」帳號', b2.ok && /绑定到网页账号「攻擊者」/.test(b2.text) && /忽略/.test(b2.text), b2);
  ok('第一步後沒有綁上', !q1("SELECT 1 FROM user_qq WHERE group_openid='G3' AND member_openid='MV3'"));
  const pr = await send('GET', '/car/api/car/me', { cookie: A.cookie, origin: null });
  const idn = JSON.parse(Buffer.from(pr.j.hdrs['x-caibot-ident'], 'base64url').toString());
  ok('代理送給機器人的身分只有攻擊者自己的 QQ', idn.qq.map(x => x.g + ':' + x.m).join(',') === 'G9:MA', idn.qq);
  ok('V cookie 仍有效', ((await send('GET', '/api/me', { cookie: V.cookie })).j.user || {}).username === 'victim02');
  // 假設受害者還是被騙完成了兩步 → 可以從 QQ 端自己解開
  const s5 = await start('link', { cookie: A.cookie, ip: '6.6.6.6' });
  await twoStep(s5.j.code, 'G6', 'MV6', '受害者');
  ok('（被騙完成兩步）G6:MV6 綁到攻擊者', (q1("SELECT user_id FROM user_qq WHERE group_openid='G6' AND member_openid='MV6'") || {}).user_id === uidOf('attacker'));
  const u1 = await bot({ action: 'unlink', g: 'G6', m: 'MV6', name: '受害者' });
  ok('受害者從 QQ 端 action:unlink 自己解開', u1.ok && !q1("SELECT 1 FROM user_qq WHERE group_openid='G6' AND member_openid='MV6'"), u1);
  ok('攻擊者帳號的 session 全部失效', (await send('GET', '/api/me', { cookie: A.cookie })).j.user === null);
  ok('攻擊者自己的 G9:MA 綁定不受影響', !!q1("SELECT 1 FROM user_qq WHERE group_openid='G9' AND member_openid='MA'"));
}

section('C. OAuth 登入 CSRF：state 必須跟發起的瀏覽器綁在一起');
if (HTTP) console.log('  (http 模式略過)');
else {
  reset();
  const t = Math.floor(Date.now() / 1000);
  sq.exec(`INSERT INTO users (id,google_sub,email,name,picture,discord_id,discord_name,is_admin,status,created_at,updated_at) VALUES
    ('u-victim','gsub-v','v@x','受害者','',NULL,NULL,0,'approved',${t},${t}), ('u-att',NULL,'','攻擊者','','777','att',0,'pending',${t},${t})`);
  const vcookie = 'sekai_session=' + await signToken('h-secret', { u: 'u-victim', v: 0, e: t + 3600 });
  for (const prov of ['discord', 'google']) {
    const r1 = await worker.fetch(new Request(W + '/auth/' + prov + '?r=/app.html?page=account', { redirect: 'manual' }), env);
    const state = new URL(r1.headers.get('location')).searchParams.get('state');
    const nc = setCookies(r1).find(c => c.startsWith('oauth_n='));
    ok(prov + '：發起時種 oauth_n（HttpOnly、Path=/auth/、不跨子網域）', !!nc && /HttpOnly/.test(nc) && /Path=\/auth\//.test(nc) && !/Domain=/i.test(nc), nc);
    discordMe = { id: '777', username: 'att' };
    googleProf = { sub: 'gsub-att', email: 'a@x', name: 'att', email_verified: true };
    const r2 = await worker.fetch(new Request(W + '/auth/' + prov + '/callback?code=ATTACKERCODE&state=' + encodeURIComponent(state), { headers: { Cookie: vcookie } }), env);
    ok(prov + '：受害者瀏覽器帶攻擊者的 state → 400、不發 session', r2.status === 400 && !sessionOf(r2), { status: r2.status });
    // 正常：同一個瀏覽器（帶著 oauth_n）完成
    const jar = nc.split(';')[0];
    const r3 = await worker.fetch(new Request(W + '/auth/' + prov + '/callback?code=OK&state=' + encodeURIComponent(state), { headers: { Cookie: jar } }), env);
    ok(prov + '：本人瀏覽器正常登入', r3.status === 200 && !!sessionOf(r3), { status: r3.status });
    ok(prov + '：用過的 nonce 被清掉', setCookies(r3).some(c => /^oauth_n=;/.test(c) || /^oauth_n=[^;]*;.*Max-Age=0/.test(c)), setCookies(r3));
    const r4 = await worker.fetch(new Request(W + '/auth/' + prov + '/callback?code=OK&state=' + encodeURIComponent(state), { headers: { Cookie: 'oauth_n=' } }), env);
    ok(prov + '：同一個 state 不能重用', r4.status === 400);
  }
}

section('D. 帳號名鎖定：別人打錯密碼不會讓本人登不進去');
reset();
{
  await registerVia('lockme', 'correctpw1', 'G1', 'MV', 'x', '1.1.1.1');
  for (let i = 0; i < 8; i++) await send('POST', '/auth/password/login', { body: { username: 'lockme', password: 'wrongpw' + i + 'xx' }, ip: '9.9.9.' + i });
  const l = await send('POST', '/auth/password/login', { body: { username: 'lockme', password: 'correctpw1' }, ip: '1.1.1.1' });
  ok('8 次錯誤來自別的 IP 後,本人從自己的 IP 正確登入 200', l.status === 200, l.j);
  for (let i = 0; i < 8; i++) await send('POST', '/auth/password/login', { body: { username: 'lockme', password: 'wrongpw' + i + 'xx' }, ip: '5.5.5.5' });
  const l2 = await send('POST', '/auth/password/login', { body: { username: 'lockme', password: 'correctpw1' }, ip: '5.5.5.5' });
  ok('同一個 IP 對同一帳號錯 8 次 → 該 IP 429', l2.status === 429, l2.j);
  sq.exec("DELETE FROM login_fail WHERE kind IN ('ip','userip')");
  for (let i = 0; i < 50; i++) sq.prepare("INSERT INTO login_fail (kind,k,at) VALUES ('user','lockme',?)").run(Math.floor(Date.now() / 1000));
  const l3 = await send('POST', '/auth/password/login', { body: { username: 'lockme', password: 'correctpw1' }, ip: '7.7.7.7' });
  ok('總失敗 ≥50 時新 IP 被擋 429', l3.status === 429, l3.j);
  const l4 = await send('POST', '/auth/password/login', { body: { username: 'lockme', password: 'correctpw1' }, ip: '1.1.1.1' });
  ok('總失敗 ≥50 時本人成功登入過的 IP 仍可登入', l4.status === 200, l4.j);
}

section('E. IPv6 /64 輪換不能繞過 IP 限流');
reset();
{
  const st = {};
  for (let i = 0; i < 30; i++) {
    const r = await send('POST', '/auth/password/login', { body: { username: 'spray' + i, password: 'Password1' }, ip: '2001:db8::' + i.toString(16) });
    st[r.status] = (st[r.status] || 0) + 1;
  }
  ok('30 次來自同一 /64 → 20 次 401 後 429', st[401] === 20 && st[429] === 10, st);
  sq.exec('DELETE FROM login_fail');
  let last;
  for (let i = 0; i < 11; i++) last = await start('reset', { body: { username: 'someone' }, ip: '2001:db8::' + (100 + i).toString(16) });
  ok('發碼上限也以 /64 計（第 11 次 429）', last.status === 429, last.j);
}

section('F. 代理：只收 JSON、加 nosniff／CSP、GET 也擋跨站');
reset();
{
  const V = await registerVia('proxyu', 'proxypass1', 'G1', 'MV', 'x', '1.1.1.1');
  const r = await send('GET', '/car/api/htmlecho?q=%3Cscript%3Ealert(document.domain)%3C/script%3E', { cookie: V.cookie, origin: null });
  ok('機器人回 text/html 404 → 我們自己的 JSON 404（不回顯）', r.status === 404 && /application\/json/.test(r.h.get('content-type')) && !/script/i.test(r.text) && r.j.error === 'bot_not_updated', { s: r.status, ct: r.h.get('content-type'), t: r.text });
  ok('nosniff＋CSP', r.h.get('x-content-type-options') === 'nosniff' && /default-src 'none'/.test(r.h.get('content-security-policy') || '') && /sandbox/.test(r.h.get('content-security-policy') || ''));
  const r2 = await send('GET', '/car/api/html200', { cookie: V.cookie, origin: null });
  ok('機器人回 200 text/html → 502 JSON', r2.status === 502 && /application\/json/.test(r2.h.get('content-type')) && !/script/.test(r2.text), { s: r2.status, t: r2.text });
  const r3 = await send('GET', '/car/api/plain404', { cookie: V.cookie, origin: null });
  ok('aiohttp 純文字 404（機器人還沒更新）→ JSON 404 bot_not_updated', r3.status === 404 && r3.j.error === 'bot_not_updated', r3.j);
  const r4 = await send('GET', '/car/api/car/me', { cookie: V.cookie, origin: null });
  ok('正常 JSON 照轉,仍帶 nosniff/CSP', r4.status === 200 && r4.j.path === '/api/car/me' && r4.h.get('x-content-type-options') === 'nosniff');
  const r5 = await send('GET', '/car/api/state?gid=1', { cookie: V.cookie, origin: null, headers: { 'Sec-Fetch-Site': 'cross-site' } });
  ok('GET＋Sec-Fetch-Site: cross-site → 403', r5.status === 403, r5.j);
  const r6 = await send('GET', '/car/api/state?gid=1', { cookie: V.cookie, origin: 'https://evil.example' });
  ok('GET＋外站 Origin → 403', r6.status === 403, r6.j);
  const r7 = await send('GET', '/car/api/state?gid=1', { cookie: V.cookie, origin: SITE, headers: { 'Sec-Fetch-Site': 'same-site' } });
  ok('主站 fetch（same-site）放行', r7.status === 200, r7.j);
  const r8 = await send('GET', '/car/api/car/me', { cookie: V.cookie + '; other=1', origin: null, headers: { 'X-Caibot-Ident': 'forged', 'X-Caibot-Sig': 'f'.repeat(64), Authorization: 'Bearer x' } });
  const hk = Object.keys(r8.j.hdrs || {});
  ok('客戶端的 Cookie／Authorization／偽造 X-Caibot-* 不會轉給機器人', !hk.includes('cookie') && !hk.includes('authorization') && r8.j.hdrs['x-caibot-ident'] !== 'forged', hk);
  const vv = await bridgeVerify(cleanSecret(SECRET), { headers: new Headers(r8.j.hdrs), method: 'GET' }, '/api/car/me', new Uint8Array(0)).catch(e => ({ ok: false, why: e.message }));
  ok('轉給機器人的簽章可驗', vv.ok === true, vv);
  const r9 = await send('POST', '/car/api/car/me', { cookie: V.cookie, origin: 'https://bot.project-sekai-center.com', body: 'x', raw: true });
  ok('POST＋bot.* 子網域 Origin → 403', r9.status === 403);
  const r10 = await send('POST', '/car/qqbind', { origin: null, body: '{"code":"123456","g":"G","m":"M"}', raw: true });
  ok('/car/qqbind 沒簽章 → 401', r10.status === 401);
}

section('G. 全站錯碼很多時不再全面封鎖；正在猜碼的群被擋');
reset();
{
  for (let i = 0; i < 60; i++) for (let k = 0; k < 5; k++) await bot({ code: '000000', g: 'GX' + (i % 12), m: 'bad' + i, name: '' });
  const s = await start('register', { body: { username: 'innocent1', password: 'innocent12' }, ip: '1.2.3.4' });
  const t = await twoStep(s.j.code, 'G1', 'NEW', '好人');
  ok('300 筆錯碼後,乾淨的群仍可正常註冊', t.a.ok && t.b && t.b.ok, t);
  const s2 = await start('register', { body: { username: 'innocent2', password: 'innocent12' }, ip: '1.2.3.5' });
  const g2 = await bot({ code: s2.j.code, g: 'GX0', m: 'fresh', name: '' });
  ok('猜碼的群被擋（每群上限收緊）', g2.ok === false && /次数过多/.test(g2.text), g2);
}

section('H. /api 會改狀態的請求要檢查 Origin；解綁與改密碼會登出其他裝置');
reset();
{
  const V = await registerVia('unl', 'unlinkpass1', 'G1', 'MV', 'x', '1.1.1.1');
  const other = await send('POST', '/auth/password/login', { body: { username: 'unl', password: 'unlinkpass1' }, ip: '8.8.8.8' });
  const oc = sessionOf(other.r);
  const n1 = await send('POST', '/api/qq/unlink', { cookie: V.cookie, origin: null, body: { g: 'G1' } });
  ok('沒有 Origin → 403', n1.status === 403, n1.j);
  const n2 = await send('POST', '/api/qq/unlink', { cookie: V.cookie, origin: 'https://bot.project-sekai-center.com', body: 'g=G1', raw: true, headers: { 'Content-Type': 'text/plain' } });
  ok('bot.* 子網域的 text/plain 表單 → 403', n2.status === 403, n2.j);
  const n3 = await send('POST', '/api/discord/unlink', { cookie: V.cookie, origin: 'https://evil.example' });
  ok('外站 Origin → 403', n3.status === 403);
  ok('GET /api/me 不受影響', (await send('GET', '/api/me', { cookie: V.cookie, origin: null })).status === 200);
  const n4 = await send('POST', '/api/qq/unlink', { cookie: V.cookie, body: { g: 'G1' } });
  ok('本站 Origin → 200 並換發 cookie', n4.status === 200 && !!sessionOf(n4.r), n4.j);
  ok('解綁後其他裝置的 cookie 失效', (await send('GET', '/api/me', { cookie: oc })).j.user === null);
  ok('解綁後本瀏覽器的舊 cookie 失效、新 cookie 有效',
    (await send('GET', '/api/me', { cookie: V.cookie })).j.user === null
    && ((await send('GET', '/api/me', { cookie: sessionOf(n4.r) })).j.user || {}).username === 'unl');
  const c2 = sessionOf(n4.r);
  const o2 = sessionOf((await send('POST', '/auth/password/login', { body: { username: 'unl', password: 'unlinkpass1' }, ip: '8.8.8.8' })).r);
  const ch = await send('POST', '/auth/password/set', { cookie: c2, body: { password: 'newpass1234', current: 'unlinkpass1' } });
  ok('改密碼 200 並換發 cookie', ch.status === 200 && !!sessionOf(ch.r), ch.j);
  ok('改密碼後其他裝置失效', (await send('GET', '/api/me', { cookie: o2 })).j.user === null);
  ok('改密碼後本瀏覽器新 cookie 有效', ((await send('GET', '/api/me', { cookie: sessionOf(ch.r) })).j.user || {}).username === 'unl');
  const oldTok = 'sekai_session=' + await signToken('h-secret', { u: uidOf('unl'), e: Math.floor(Date.now() / 1000) + 3600 });
  ok('沒有 v 的舊版 cookie 在版本 >0 後失效', HTTP || (await send('GET', '/api/me', { cookie: oldTok })).j.user === null);
}

/* ---------- 登入跳轉頁：返回網址白名單＋script 字串跳脫＋CSP（OAuth ?r= 反射 XSS） ---------- */
{
  const bad = ['/x</script><b>M</b>', '/a"b', "/a'b", '/a b', '/a`b', '/\\evil', '//evil.com', '/中文', 'https://evil.example/'];
  ok('safePath 擋掉含 < > 引號 空白 反斜線 非 ASCII 的返回網址', bad.every(v => safePath(v) === '/app.html?page=account'), bad.map(v => safePath(v)));
  const good = ['/app.html?page=car', '/app.html?page=car&g=123', '/app.html?page=car&g=qqg_A%20B', '/app.html?page=account#x'];
  ok('safePath 放行站內正常網址', good.every(v => safePath(v) === v), good.map(v => safePath(v)));
  ok('scriptStr 跳脫 </script> 與 &', !/[<>&]/.test(scriptStr('</script><script>alert(1)</script>&')));
  const res = bounce('https://project-sekai-center.com/x</script><script>alert(1)</script>');
  const body = await res.text();
  ok('bounce 頁沒有被插入 script', !/<\/script><script>alert/.test(body) && (body.match(/<script>/g) || []).length === 1);
  const csp = res.headers.get('content-security-policy') || '';
  ok('bounce 頁有 CSP 禁止連線', /default-src 'none'/.test(csp) && !/connect-src/.test(csp) && res.headers.get('x-content-type-options') === 'nosniff');
  const cb = await send('GET', '/auth/discord/callback?error=access_denied', { origin: null });
  ok('真實路由的跳轉頁也帶 CSP', /default-src 'none'/.test(cb.r.headers.get('content-security-policy') || ''), cb.status);
}

/* ---------- 登出：清 cookie、依 r 回到站內頁面、r 不合格退回安全頁 ---------- */
{
  const lo = await send('GET', '/auth/logout?r=' + encodeURIComponent('/app.html?page=car'), { origin: null });
  const lb = lo.text;
  ok('登出清掉 session cookie', /sekai_session=;/.test(lo.r.headers.get('set-cookie') || '') , lo.r.headers.get('set-cookie'));
  ok('登出後回車隊頁', lb.includes('/app.html?page=car"'), lb.slice(0, 200));
  const lo2 = await send('GET', '/auth/logout?r=' + encodeURIComponent('//evil.example/x'), { origin: null });
  ok('登出 r 指向外站 → 不跳外站', !lo2.text.includes('evil.example'));
  const lo3 = await send('GET', '/auth/logout', { origin: null });
  ok('登出沒帶 r → 回首頁', lo3.text.includes('/app.html"'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (botServer) botServer.close();
process.exit(fail ? 1 : 0);
