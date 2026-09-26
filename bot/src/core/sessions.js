/* 進行中的遊戲／流程（記憶體、有效期）。custom_id 只放 session id，狀態留在這裡。 */

export class Sessions {
  constructor() { this.map = new Map(); this._n = 0; }
  create(feature, data, ttlMs = 30 * 60e3) {
    const id = (Date.now().toString(36).slice(-5) + (this._n++).toString(36)).slice(-8);
    this.map.set(`${feature}:${id}`, { data, exp: Date.now() + ttlMs, ttl: ttlMs });
    if (this.map.size > 5000) this.sweep();
    return id;
  }
  get(feature, id) {
    const k = `${feature}:${id}`;
    const s = this.map.get(k);
    if (!s) return null;
    if (s.exp < Date.now()) { this.map.delete(k); return null; }
    s.exp = Date.now() + s.ttl;   // 有人在玩就續命
    return s.data;
  }
  del(feature, id) { this.map.delete(`${feature}:${id}`); }
  sweep() { const now = Date.now(); for (const [k, s] of this.map) if (s.exp < now) this.map.delete(k); }
  get size() { return this.map.size; }
}

export class Cooldowns {
  constructor() { this.map = new Map(); }
  /* 回傳剩餘秒數（0 = 可用並立刻上鎖） */
  hit(key, seconds, now = Date.now()) {
    const until = this.map.get(key) || 0;
    if (until > now) return Math.ceil((until - now) / 1000);
    this.map.set(key, now + seconds * 1000);
    if (this.map.size > 20000) for (const [k, v] of this.map) if (v < now) this.map.delete(k);
    return 0;
  }
  clear(key) { this.map.delete(key); }
}

/* 計時器：正式環境用 setTimeout；測試可以換成立即執行或收集起來 */
export class Timers {
  constructor(immediate = false) { this.immediate = immediate; this.pending = []; }
  after(ms, fn) {
    if (this.immediate) { this.pending.push(fn); return null; }
    const t = setTimeout(() => { Promise.resolve().then(fn).catch(e => console.error('[timer]', e)); }, ms);
    return t;
  }
  /* 測試用：把收集到的計時器一次跑完 */
  async flush() { const list = this.pending.splice(0); for (const fn of list) await fn(); }
}
