/* 亂數：可指定種子（mulberry32），測試時可重現；占卜引擎也靠它做「同一人同一天結果相同」。 */

export function hashStr(s) {
  // FNV-1a 32 位元
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export class Rng {
  /* seed 省略＝真隨機（Math.random）；給數字或字串＝決定性序列 */
  constructor(seed) {
    if (seed == null) { this.next = Math.random; return; }
    let a = (typeof seed === 'number' ? seed : hashStr(seed)) >>> 0;
    this.next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* 閉區間整數 */
  int(min, max) { return Math.floor(this.next() * (max - min + 1)) + min; }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  /* 不重複取 n 個 */
  sample(arr, n) { return this.shuffle(arr).slice(0, n); }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  /* 加權挑選：items = [[value, weight], ...] */
  weighted(items) {
    const total = items.reduce((s, x) => s + x[1], 0);
    let r = this.next() * total;
    for (const [v, w] of items) { r -= w; if (r < 0) return v; }
    return items[items.length - 1][0];
  }
}

export const seeded = (...parts) => new Rng(parts.join('|'));
