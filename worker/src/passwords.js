/* 帳密雜湊：PBKDF2-HMAC-SHA256,每人 16 bytes 隨機 salt,210000 次。
   存成 pbkdf2$sha256$<次數>$<salt_b64>$<hash_b64>（標準 base64,含 padding）。
   次數寫在字串裡,驗證時照字串讀 —— 之後要調高次數,舊雜湊照樣驗得過,登入成功時再重算即可。

   為什麼有純 JS 備援：Cloudflare 線上執行環境曾限制 PBKDF2 次數不得超過 100000
   （本機 workerd 沒有這個限制,所以本機測不出來）。原生呼叫拋錯時改用下面的純 JS 版本,
   算出來的值與標準 PBKDF2 完全相同（test/sign_vector.mjs 有交叉驗證）,
   只是慢（付費方案 CPU 上限 30 秒,足夠）。格式不變,兩條路算的雜湊互通。 */

const enc = new TextEncoder();
export const PBKDF2_ITERS = 210000;
const DK_LEN = 32;

const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

let nativeBroken = false;         // 同一個 isolate 裡失敗過一次就不再試原生

async function pbkdf2Native(pw, salt, iters) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iters }, key, DK_LEN * 8));
}

/* ---- 純 JS 備援：SHA-256 壓縮函式 + 預先算好 ipad/opad 狀態的 HMAC 迴圈 ---- */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const W = new Uint32Array(64);

/* state(8 words) ← compress(state, block(16 words)) */
function compress(st, blk) {
  for (let i = 0; i < 16; i++) W[i] = blk[i];
  for (let i = 16; i < 64; i++) {
    const a = W[i - 15], b = W[i - 2];
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
  }
  let a = st[0], b = st[1], c = st[2], d = st[3], e = st[4], f = st[5], g = st[6], h = st[7];
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  st[0] = (st[0] + a) | 0; st[1] = (st[1] + b) | 0; st[2] = (st[2] + c) | 0; st[3] = (st[3] + d) | 0;
  st[4] = (st[4] + e) | 0; st[5] = (st[5] + f) | 0; st[6] = (st[6] + g) | 0; st[7] = (st[7] + h) | 0;
}

/* 一般長度訊息的 SHA-256（只用在 key 超過 64 bytes 與第一輪 HMAC,效能不重要） */
function sha256Bytes(msg) {
  const len = msg.length, total = ((len + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(total);
  buf.set(msg); buf[len] = 0x80;
  const bits = len * 8;
  buf[total - 4] = (bits >>> 24) & 255; buf[total - 3] = (bits >>> 16) & 255;
  buf[total - 2] = (bits >>> 8) & 255; buf[total - 1] = bits & 255;
  buf[total - 5] = Math.floor(bits / 2 ** 32) & 255;
  const st = Int32Array.from(IV), blk = new Int32Array(16);
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) blk[i] = (buf[o + 4 * i] << 24) | (buf[o + 4 * i + 1] << 16) | (buf[o + 4 * i + 2] << 8) | buf[o + 4 * i + 3];
    compress(st, blk);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) { out[4 * i] = st[i] >>> 24; out[4 * i + 1] = st[i] >>> 16; out[4 * i + 2] = st[i] >>> 8; out[4 * i + 3] = st[i]; }
  return out;
}

export function pbkdf2Js(pwBytes, salt, iters) {
  let key = pwBytes.length > 64 ? sha256Bytes(pwBytes) : pwBytes;
  const kb = new Uint8Array(64); kb.set(key);
  const ipad = new Uint8Array(64), opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) { ipad[i] = kb[i] ^ 0x36; opad[i] = kb[i] ^ 0x5c; }
  const toWords = u8 => { const w = new Int32Array(16); for (let i = 0; i < 16; i++) w[i] = (u8[4 * i] << 24) | (u8[4 * i + 1] << 16) | (u8[4 * i + 2] << 8) | u8[4 * i + 3]; return w; };
  const iState = Int32Array.from(IV); compress(iState, toWords(ipad));
  const oState = Int32Array.from(IV); compress(oState, toWords(opad));

  // U1 = HMAC(P, salt || INT(1))：訊息長度不固定,走一般路徑
  const inner1 = sha256Bytes(concat(ipad, salt, new Uint8Array([0, 0, 0, 1])));
  const u = sha256Bytes(concat(opad, inner1));
  const t = new Int32Array(8);
  // 之後每輪訊息都是 32 bytes：64(pad) + 32 = 96 bytes,第二個 block 的填充是固定的
  const blk = new Int32Array(16);
  blk[8] = 0x80000000 | 0; for (let i = 9; i < 15; i++) blk[i] = 0; blk[15] = (64 + 32) * 8;
  const uw = new Int32Array(8);
  for (let i = 0; i < 8; i++) { uw[i] = (u[4 * i] << 24) | (u[4 * i + 1] << 16) | (u[4 * i + 2] << 8) | u[4 * i + 3]; t[i] = uw[i]; }
  const st = new Int32Array(8);
  for (let n = 1; n < iters; n++) {
    st.set(iState); for (let i = 0; i < 8; i++) blk[i] = uw[i]; compress(st, blk);
    for (let i = 0; i < 8; i++) blk[i] = st[i];
    st.set(oState); compress(st, blk);
    for (let i = 0; i < 8; i++) { uw[i] = st[i]; t[i] ^= st[i]; }
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) { out[4 * i] = t[i] >>> 24; out[4 * i + 1] = t[i] >>> 16; out[4 * i + 2] = t[i] >>> 8; out[4 * i + 3] = t[i]; }
  return out;
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function pbkdf2(pw, salt, iters) {
  if (!nativeBroken) {
    try { return await pbkdf2Native(pw, salt, iters); }
    catch (e) { nativeBroken = true; console.warn('pbkdf2 native failed, using JS fallback:', e && e.message); }
  }
  return pbkdf2Js(enc.encode(pw), salt, iters);
}

export async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const dk = await pbkdf2(pw, salt, PBKDF2_ITERS);
  return `pbkdf2$sha256$${PBKDF2_ITERS}$${b64(salt)}$${b64(dk)}`;
}

/* 帳號不存在時也要跑一次同樣成本的運算,回應時間才不會透露帳號是否存在。 */
const DUMMY = 'pbkdf2$sha256$210000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export async function verifyPassword(pw, stored) {
  const s = stored || DUMMY;
  const m = /^pbkdf2\$sha256\$(\d{1,7})\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/.exec(s);
  if (!m) return false;
  const iters = +m[1];
  if (iters < 1000 || iters > 2000000) return false;
  let salt, want;
  try { salt = unb64(m[2]); want = unb64(m[3]); } catch (e) { return false; }
  const got = await pbkdf2(pw, salt, iters);
  if (got.length !== want.length) return false;
  let d = 0;
  for (let i = 0; i < got.length; i++) d |= got[i] ^ want[i];
  return d === 0 && !!stored;
}

/* 帳號名與密碼規則（合約第 5 節） */
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const normUsername = v => (typeof v === 'string' ? v.trim().toLowerCase() : '');
export const validPassword = v => typeof v === 'string' && v.length >= 8 && v.length <= 64;
