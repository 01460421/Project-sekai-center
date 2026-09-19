/* 橋接簽章的固定測試向量（合約第 1 節）。
   用法：node worker/test/sign_vector.mjs [輸出 JSON 路徑]
   - 用 Worker 實際跑的 src/bridge.js 算簽章,
   - 再用 node:crypto 獨立照合約重算一次交叉比對（兩者不同就 exit 1）,
   - 把向量寫成 JSON,機器人端（Python）拿同一份檔案驗證兩邊一致。
   順便驗 src/passwords.js 的純 JS PBKDF2 備援與原生 PBKDF2 算出一樣的值。 */
import { createHash, createHmac, pbkdf2Sync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { bridgeString, bridgeSign, sha256Hex, b64urlJson, bridgeHeaders, bridgeVerify } from '../src/bridge.js';
import { pbkdf2Js, hashPassword, verifyPassword } from '../src/passwords.js';

const SECRET = 'test-secret';
const out = process.argv[2] || null;
let failed = 0;
const check = (name, a, b) => { if (a !== b) { failed++; console.error('MISMATCH', name, '\n  ', a, '\n  ', b); } };

/* node:crypto 獨立實作（不經過 bridge.js） */
function refSign(secret, v) {
  const bodyHash = createHash('sha256').update(v.body_bytes).digest('hex');
  const s = ['v1', v.method, v.path_and_query, String(v.ts), v.nonce, v.ident, v.ip, bodyHash].join('\n');
  return { bodyHash, s, sig: createHmac('sha256', Buffer.from(secret.trim(), 'utf8')).update(Buffer.from(s, 'utf8')).digest('hex') };
}

const identity = {
  v: 1, uid: '0b6f1c2e-5a7d-4e8f-9a10-112233445566', name: '菜根測試員',
  dc: '123456789012345678', dn: 'caigen_tester',
  qq: [{ g: 'C0FFEE00GROUPOPENID', m: 'ABCDEF0123MEMBEROPENID', n: '测试成员' }],
};
const identQQOnly = { v: 1, uid: 'u-qq-only', name: 'qq_user', dc: null, dn: null, qq: [{ g: 'G1', m: 'M1', n: '小明' }] };

const cases = [
  { name: 'worker_to_bot_get_with_query', method: 'GET', path_and_query: '/api/state?gid=123456789012345678&car=2',
    ts: 1758240000, nonce: '00112233445566778899aabbccddeeff', identity, ip: '203.0.113.7', body: '' },
  { name: 'worker_to_bot_post_json_utf8', method: 'POST', path_and_query: '/api/signup?gid=123456789012345678&car=1',
    ts: 1758240001, nonce: 'ffeeddccbbaa99887766554433221100', identity: identQQOnly, ip: '2001:db8::1',
    body: '{"date":"2026-09-19","hour":20,"note":"推手 早點到"}' },
  { name: 'worker_to_bot_get_no_query', method: 'GET', path_and_query: '/api/car/me',
    ts: 1758240002, nonce: '0123456789abcdef0123456789abcdef', identity, ip: '198.51.100.23', body: '' },
  { name: 'bot_to_worker_qqbind', method: 'POST', path_and_query: '/car/qqbind',
    ts: 1758240003, nonce: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', identity: null, ip: 'bot',
    body: '{"code":"042917","g":"C0FFEE00GROUPOPENID","m":"ABCDEF0123MEMBEROPENID","name":"测试成员"}' },
];

const vectors = [];
for (const c of cases) {
  const identityJson = c.identity ? JSON.stringify(c.identity) : '';
  const ident = c.identity ? b64urlJson(c.identity) : '';
  // base64url 交叉檢查
  check(c.name + ' ident', ident, Buffer.from(identityJson, 'utf8').toString('base64url'));
  const bodyBytes = Buffer.from(c.body, 'utf8');
  const bodyHash = await sha256Hex(c.body === '' ? null : new Uint8Array(bodyBytes));
  const parts = { method: c.method, pathq: c.path_and_query, ts: c.ts, nonce: c.nonce, ident, ip: c.ip, bodyHash };
  const signed = bridgeString(parts);
  const sig = await bridgeSign(SECRET, parts);
  const ref = refSign(SECRET, { ...c, ident, body_bytes: bodyBytes });
  check(c.name + ' body', bodyHash, ref.bodyHash);
  check(c.name + ' string', signed, ref.s);
  check(c.name + ' sig', sig, ref.sig);
  // 密鑰前後有空白／換行也要得到同一個簽章（兩邊都 strip）
  check(c.name + ' sig(secret\\n)', await bridgeSign(SECRET + '\n', parts), sig);
  // bridgeHeaders 產生的標頭,bridgeVerify 要驗得過
  const h = await bridgeHeaders(SECRET, { method: c.method, pathq: c.path_and_query, ident, ip: c.ip, body: c.body === '' ? null : bodyBytes, ts: c.ts, nonce: c.nonce });
  check(c.name + ' headers sig', h['X-Caibot-Sig'], sig);
  const fakeReq = { method: c.method, headers: new Headers(h) };
  const v = await bridgeVerify(SECRET, fakeReq, c.path_and_query, c.body === '' ? null : bodyBytes, c.ts + 30);
  check(c.name + ' verify', v.ok, true);
  const vBad = await bridgeVerify(SECRET, fakeReq, c.path_and_query + 'x', c.body === '' ? null : bodyBytes, c.ts);
  check(c.name + ' verify tampered', vBad.ok, false);
  const vOld = await bridgeVerify(SECRET, fakeReq, c.path_and_query, c.body === '' ? null : bodyBytes, c.ts + 61);
  check(c.name + ' verify stale', vOld.why, 'stale');

  vectors.push({
    name: c.name, method: c.method, path_and_query: c.path_and_query, ts: String(c.ts), nonce: c.nonce,
    identity_json: identityJson, ident, ip: c.ip, body_utf8: c.body, body_sha256: bodyHash,
    signed_string: signed, sig,
    headers: { 'X-Caibot-Ts': String(c.ts), 'X-Caibot-Nonce': c.nonce, 'X-Caibot-Ident': ident, 'X-Caibot-Ip': c.ip, 'X-Caibot-Sig': sig },
  });
}

/* PBKDF2：純 JS 備援 == 原生 */
for (const [pw, iters] of [['password123', 1000], ['密碼測試abc', 4096], ['x'.repeat(100), 2000], ['correct horse', 210000]]) {
  const salt = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
  const js = Buffer.from(pbkdf2Js(new TextEncoder().encode(pw), new Uint8Array(salt), iters)).toString('hex');
  const nat = pbkdf2Sync(Buffer.from(pw, 'utf8'), salt, iters, 32, 'sha256').toString('hex');
  check(`pbkdf2 ${iters}`, js, nat);
}
const h = await hashPassword('hunter2hunter2');
check('hash format', /^pbkdf2\$sha256\$210000\$[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}$/.test(h), true);
check('verify ok', await verifyPassword('hunter2hunter2', h), true);
check('verify bad', await verifyPassword('hunter2hunter3', h), false);
check('verify null', await verifyPassword('hunter2hunter2', null), false);

const doc = {
  contract: 'MERGE_CONTRACT.md §1',
  secret: SECRET,
  note: 'signed_string = "v1\\n{METHOD}\\n{PATH_AND_QUERY}\\n{TS}\\n{NONCE}\\n{IDENT}\\n{IP}\\n{BODY_SHA256}" (UTF-8, no trailing newline); '
      + 'sig = hex(HMAC-SHA256(secret.strip(), signed_string)); ident = base64url(no padding) of identity_json UTF-8 bytes; '
      + 'bot->Worker uses ident="" and ip="bot"; empty body hashes to sha256("").',
  generated_by: 'worker/test/sign_vector.mjs',
  vectors,
};
if (out) writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
for (const v of vectors) console.log(v.name.padEnd(32), v.sig);
if (failed) { console.error(failed + ' check(s) failed'); process.exit(1); }
console.log('all checks passed' + (out ? ' → ' + out : ''));
