/* Worker ⇄ 菜根機器人 的簽章（兩個方向共用同一格式）。

   權威格式在 MERGE_CONTRACT.md 第 1 節,機器人端用 Python 照同一份實作 ——
   被簽字串多一個換行、編碼差一個字,兩邊就全部驗不過。所以:
   - 這個檔案不 import 任何東西,Node 測試腳本(test/sign_vector.mjs)直接拿它算測試向量;
   - 被簽字串只在 bridgeString() 一個地方組,不要在別處自己拼。

   被簽字串(UTF-8,以 \n 分隔,沒有結尾換行):
     v1\n{METHOD}\n{PATH_AND_QUERY}\n{TS}\n{NONCE}\n{IDENT}\n{IP}\n{BODY_SHA256}
   簽章 = HMAC-SHA256(secret.strip(), 被簽字串) 的小寫 hex。 */

const enc = new TextEncoder();

export const BRIDGE_MAX_SKEW = 60;          // |now - ts| 上限（秒）

const toHex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');

/* 密鑰一律去頭尾空白（wrangler secret put 很容易多吃一個換行）。
   Python 的 str.strip() 去的是空白字元,這裡用 JS 的 trim() —— 兩者在
   ASCII 空白（空格、\t、\n、\r、\v、\f）上一致,而密鑰是 hex,不會有其他字元。 */
export const cleanSecret = s => String(s == null ? '' : s).trim();

export function randomHex(nBytes) {
  return toHex(crypto.getRandomValues(new Uint8Array(nBytes)));
}

/* body 可以是 ArrayBuffer / Uint8Array / 字串 / null（null = 空 body） */
export async function sha256Hex(body) {
  let bytes;
  if (body == null) bytes = new Uint8Array(0);
  else if (typeof body === 'string') bytes = enc.encode(body);
  else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
  else bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

export async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(cleanSecret(secret)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

/* 身分 JSON → base64url（無 padding）。JSON 先用 UTF-8 編碼再轉 base64。 */
export function b64urlJson(obj) {
  const bytes = enc.encode(JSON.stringify(obj));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* 唯一組被簽字串的地方 */
export function bridgeString({ method, pathq, ts, nonce, ident, ip, bodyHash }) {
  return ['v1', String(method).toUpperCase(), String(pathq), String(ts), String(nonce),
          String(ident || ''), String(ip || ''), String(bodyHash)].join('\n');
}

export async function bridgeSign(secret, parts) {
  return hmacHex(secret, bridgeString(parts));
}

/* 常數時間比較（逐位元 XOR）。長度不同直接 false —— 簽章是固定 64 字元,長度不是秘密。 */
export function ctEq(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* 產生一組要送出的標頭（Worker → 機器人）。 */
export async function bridgeHeaders(secret, { method, pathq, ident, ip, body, ts, nonce }) {
  const t = ts == null ? Math.floor(Date.now() / 1000) : ts;
  const n = nonce || randomHex(16);
  const bodyHash = await sha256Hex(body);
  const sig = await bridgeSign(secret, { method, pathq, ts: t, nonce: n, ident, ip, bodyHash });
  return {
    'X-Caibot-Ts': String(t),
    'X-Caibot-Nonce': n,
    'X-Caibot-Ident': ident || '',
    'X-Caibot-Ip': ip || '',
    'X-Caibot-Sig': sig,
  };
}

/* 驗證收到的請求（機器人 → Worker）。nonce 去重由呼叫端負責（要看存哪裡）。
   回 { ok:true, ts, nonce, ident, ip } 或 { ok:false, why }。 */
export async function bridgeVerify(secret, req, pathq, bodyBuf, nowS) {
  if (!cleanSecret(secret)) return { ok: false, why: 'no_secret' };
  const h = k => req.headers.get(k) || '';
  const ts = h('X-Caibot-Ts'), nonce = h('X-Caibot-Nonce'), sig = h('X-Caibot-Sig').toLowerCase();
  const ident = h('X-Caibot-Ident'), ip = h('X-Caibot-Ip');
  if (!/^\d{1,12}$/.test(ts)) return { ok: false, why: 'bad_ts' };
  if (!/^[0-9a-f]{32}$/.test(nonce)) return { ok: false, why: 'bad_nonce' };
  if (!/^[0-9a-f]{64}$/.test(sig)) return { ok: false, why: 'bad_sig' };
  const t = nowS == null ? Math.floor(Date.now() / 1000) : nowS;
  if (Math.abs(t - Number(ts)) > BRIDGE_MAX_SKEW) return { ok: false, why: 'stale' };
  const want = await bridgeSign(secret, {
    method: req.method, pathq, ts, nonce, ident, ip, bodyHash: await sha256Hex(bodyBuf),
  });
  if (!ctEq(sig, want)) return { ok: false, why: 'sig_mismatch' };
  return { ok: true, ts: Number(ts), nonce, ident, ip };
}
