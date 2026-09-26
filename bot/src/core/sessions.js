/* 進行中的遊戲／流程（有效期）。custom_id 只放 session id，狀態留在這裡。
   容器版放記憶體就夠；Workers 版的 Durable Object 閒置 10 秒就會休眠、記憶體全丟，
   所以每次互動結束後由 worker.js 呼叫 drain() 把碰到的 session 寫進 storage，DO 重建時再 load() 回來。 */

export class Sessions {
  constructor() { this.map = new Map(); this._n = 0; this.touched = new Set(); this.removed = new Set(); }
  create(feature, data, ttlMs = 30 * 60e3) {
    let id, k;
    do { id = (Date.now().toString(36).slice(-5) + (this._n++).toString(36)).slice(-8); k = `${feature}:${id}`; } while (this.map.has(k));
    this.map.set(k, { data, exp: Date.now() + ttlMs, ttl: ttlMs });
    this.touched.add(k);
    if (this.map.size > 5000) this.sweep();
    return id;
  }
  get(feature, id) {
    const k = `${feature}:${id}`;
    const s = this.map.get(k);
    if (!s) return null;
    if (s.exp < Date.now()) { this._drop(k); return null; }
    s.exp = Date.now() + s.ttl;   // 有人在玩就續命
    this.touched.add(k);          // 功能會直接改 data，之後要寫回
    return s.data;
  }
  del(feature, id) { this._drop(`${feature}:${id}`); }
  _drop(k) { if (this.map.delete(k)) this.removed.add(k); this.touched.delete(k); }
  sweep() { const now = Date.now(); for (const [k, s] of this.map) if (s.exp < now) this._drop(k); }
  get size() { return this.map.size; }

  /* 持久化用：取出這次有動到的（要寫回）與刪掉的（要從 storage 移除），並清空紀錄 */
  drain() {
    const put = {};
    for (const k of this.touched) { const s = this.map.get(k); if (s) put[k] = s; }
    const del = [...this.removed];
    this.touched.clear(); this.removed.clear();
    return { put, del };
  }
  /* 重新載入（DO 重建後）：entries = [[key, {data, exp, ttl}], …]；已過期的不收，並記下來讓下次 drain 把它們從 storage 刪掉 */
  load(entries) {
    const now = Date.now();
    for (const [k, s] of entries || []) {
      if (s && typeof s === 'object' && s.exp > now) this.map.set(k, s);
      else this.removed.add(k);
    }
  }
}

export class Cooldowns {
  constructor() { this.map = new Map(); this.changed = false; }
  /* 回傳剩餘秒數（0 = 可用並立刻上鎖） */
  hit(key, seconds, now = Date.now()) {
    const until = this.map.get(key) || 0;
    if (until > now) return Math.ceil((until - now) / 1000);
    this.map.set(key, now + seconds * 1000); this.changed = true;
    if (this.map.size > 20000) for (const [k, v] of this.map) if (v < now) this.map.delete(k);
    return 0;
  }
  clear(key) { if (this.map.delete(key)) this.changed = true; }
  /* 持久化用：有變動才回傳（只留還沒到期的），沒變動回 null */
  drain(now = Date.now()) {
    if (!this.changed) return null;
    this.changed = false;
    const out = {};
    for (const [k, v] of this.map) if (v > now) out[k] = v;
    return out;
  }
  load(obj) { for (const [k, v] of Object.entries(obj || {})) if (typeof v === 'number') this.map.set(k, v); }
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
