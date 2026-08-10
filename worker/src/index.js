/**
 * 逐局活動P 追蹤器（Cloudflare Worker + Durable Object）
 *
 * 為什麼是 Durable Object alarm 而不是 Cron Trigger：
 *   Cron 的表達式最小粒度是「分鐘」，做不到 15 秒。setAlarm() 吃的是距 epoch 的
 *   絕對毫秒數，setAlarm(Date.now()+15000) 完全合法——這是 Cloudflare 上官方唯一
 *   支援的 sub-minute 排程方式。
 *
 * 為什麼是 15 秒：
 *   一場協力最短約 150 秒（曲長＋結算＋房間），15 秒間隔絕不會把兩局併成一筆，
 *   時間戳誤差 ±15 秒。再密只是多打人家的 API，換不到更多資訊。
 *
 * 為什麼要看門狗：
 *   alarm 有 at-least-once 保證，但 handler 拋錯只會用指數退避重試 6 次；
 *   若遇上來源站較長的故障，重試耗盡後這條 alarm 鏈就永久斷掉、靜悄悄不再跑。
 *   所以另外掛一個每分鐘的 Cron Trigger，只做「沒排程就補排」這一件事。
 */

const API = 'https://api.hisekai.org/tw/event/live/top100';
const TOP_N = 50;
const TICK_MS = 15_000;
const UA = 'project-sekai-center/1.0 (+https://project-sekai-center.vercel.app) per-game-tracker';
const GAP_FACTOR = 3;          // 超過 3 個週期沒成功 → 記一段缺口
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

/** 19 位 uid 超過 IEEE754 安全整數，JSON.parse 前先把它們轉成字串（站上踩過的老雷）。 */
function parseSafe(text) {
  return JSON.parse(text.replace(/([[:,]\s*)(\d{16,})/g, '$1"$2"'));
}

async function fetchTop100() {
  const r = await fetch(API, {
    headers: { 'user-agent': UA, 'accept-encoding': 'br, gzip' },
    cf: { cacheTtl: 0, cacheEverything: false },   // 這支要的是「此刻」，不能吃快取
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return parseSafe(await r.text());
}

export class GameTracker {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS games (
        ev INTEGER NOT NULL, uidx INTEGER NOT NULL, t INTEGER NOT NULL,
        delta INTEGER NOT NULL, rank INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS games_ev_t ON games(ev, t);
      CREATE INDEX IF NOT EXISTS games_ev_uidx ON games(ev, uidx);
      CREATE TABLE IF NOT EXISTS users (
        ev INTEGER NOT NULL, uidx INTEGER NOT NULL, uid TEXT NOT NULL,
        name TEXT, PRIMARY KEY (ev, uidx)
      );
      CREATE TABLE IF NOT EXISTS gaps (
        ev INTEGER NOT NULL, fromT INTEGER NOT NULL, toT INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS state (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    `);
  }

  get(k, d = null) {
    const r = [...this.sql.exec('SELECT v FROM state WHERE k = ?', k)];
    return r.length ? JSON.parse(r[0].v) : d;
  }

  put(k, v) {
    this.sql.exec('INSERT OR REPLACE INTO state (k, v) VALUES (?, ?)', k, JSON.stringify(v));
  }

  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // 看門狗與手動啟動都走這裡：沒排程就補排
    if (p === '/ensure') {
      const cur = await this.ctx.storage.getAlarm();
      if (cur === null) {
        await this.ctx.storage.setAlarm(Date.now() + 1000);
        return this.json({ ok: true, action: 'rearmed' });
      }
      return this.json({ ok: true, action: 'already-armed', nextAlarm: cur });
    }

    if (p === '/stop') {                       // 需要時可以手動停（維護用）
      await this.ctx.storage.deleteAlarm();
      return this.json({ ok: true, action: 'stopped' });
    }

    if (p === '/status') {
      const ev = this.get('event');
      const n = [...this.sql.exec('SELECT COUNT(*) AS n FROM games')][0].n;
      return this.json({
        event: ev,
        games: n,
        users: [...this.sql.exec('SELECT COUNT(*) AS n FROM users')][0].n,
        gaps: [...this.sql.exec('SELECT COUNT(*) AS n FROM gaps')][0].n,
        lastOk: this.get('lastOk'),
        fails: this.get('fails', 0),
        nextAlarm: await this.ctx.storage.getAlarm(),
        topN: TOP_N, intervalMs: TICK_MS,
      });
    }

    // 前端：某一期的所有局（可用 since 增量拉、uidx 只拉單一玩家）
    if (p === '/games') {
      const ev = Number(url.searchParams.get('ev') || (this.get('event') || {}).id || 0);
      const since = Number(url.searchParams.get('since') || 0);
      // 前端手上只有 uid（19 位字串），讓它直接用 uid 查，不必先抓一次對照表
      let uidx = url.searchParams.get('uidx');
      const uid = url.searchParams.get('uid');
      if (uidx === null && uid) {
        const hit = [...this.sql.exec('SELECT uidx FROM users WHERE ev = ? AND uid = ?', ev, uid)];
        uidx = hit.length ? String(hit[0].uidx) : '-1';   // 查無此人 → 回空集合而不是全部
      }
      const rows = uidx === null
        ? [...this.sql.exec('SELECT uidx,t,delta,rank FROM games WHERE ev = ? AND t >= ? ORDER BY t', ev, since)]
        : [...this.sql.exec('SELECT uidx,t,delta,rank FROM games WHERE ev = ? AND uidx = ? AND t >= ? ORDER BY t', ev, Number(uidx), since)];
      return this.json({
        ev,
        // 精簡成陣列，1.6MB 級別的資料不該用物件鍵名把體積灌大
        games: rows.map(r => [r.uidx, r.t, r.delta, r.rank]),
        users: [...this.sql.exec('SELECT uidx,uid,name FROM users WHERE ev = ? ORDER BY uidx', ev)]
          .map(r => [r.uidx, r.uid, r.name]),
        gaps: [...this.sql.exec('SELECT fromT,toT FROM gaps WHERE ev = ? ORDER BY fromT', ev)]
          .map(r => [r.fromT, r.toT]),
        event: this.get('event'),
      });
    }

    return new Response('not found', { status: 404, headers: CORS });
  }

  json(o) {
    return new Response(JSON.stringify(o), {
      headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
    });
  }

  /** 每 15 秒跑一次：抓一輪、差分、寫入，然後把下一次排好。 */
  async alarm() {
    // 先把下一棒排好再做事——這樣即使本輪拋錯，鏈也不會斷
    await this.ctx.storage.setAlarm(Date.now() + TICK_MS);

    let d;
    try {
      d = await fetchTop100();
      this.put('fails', 0);
    } catch (e) {
      // 失敗退避：不改排程間隔（下一棒已排），只記錄失敗次數供 /status 觀察
      const fails = (this.get('fails', 0) || 0) + 1;
      this.put('fails', fails);
      this.put('lastError', { at: Date.now(), msg: String(e) });
      return;
    }

    const startAt = Date.parse(d.start_at ?? d.startAt);
    const endAt = Date.parse(d.aggregate_at ?? d.closed_at ?? d.aggregateAt);
    const now = Date.now();

    // 非活動期間就把 alarm 停掉，交給每分鐘的看門狗在活動開始後重新喚醒。
    // 不必空轉打人家的 API。
    if (!Number.isFinite(startAt) || now < startAt || now > endAt) {
      await this.ctx.storage.deleteAlarm();
      this.put('idle', { at: now, reason: 'no-live-event' });
      return;
    }

    const ev = { id: d.id, name: d.name, startAt, aggregateAt: endAt };
    const prevEv = this.get('event');
    if (!prevEv || prevEv.id !== ev.id) {
      this.put('event', ev);
      this.put('prev', {});          // 換期：基準重來，第一輪不算增量
    }

    const t = Math.floor((now - startAt) / 1000);
    const lastOk = this.get('lastOk');
    if (lastOk && now - lastOk > TICK_MS * GAP_FACTOR) {
      // 中斷過久：這段的增量會是多局合併，記成缺口讓前端誠實標示
      this.sql.exec('INSERT INTO gaps (ev, fromT, toT) VALUES (?, ?, ?)',
        ev.id, Math.floor((lastOk - startAt) / 1000), t);
    }

    // 上一輪分數放在 SQL（DO 可能被驅逐，記憶體留不住）
    const prev = this.get('prev', {}) || {};
    const idxMap = new Map(
      [...this.sql.exec('SELECT uidx, uid FROM users WHERE ev = ?', ev.id)].map(r => [r.uid, r.uidx]));
    let nextIdx = idxMap.size;
    const cur = {};

    for (const r of (d.player_top_100_rankings || []).slice(0, TOP_N)) {
      const uid = r.last_player_info?.profile?.id;
      if (!uid) continue;
      cur[uid] = r.score;
      let ui = idxMap.get(uid);
      if (ui === undefined) {
        ui = nextIdx++;
        idxMap.set(uid, ui);
        this.sql.exec('INSERT OR REPLACE INTO users (ev, uidx, uid, name) VALUES (?, ?, ?, ?)',
          ev.id, ui, uid, r.name ?? null);
      }
      const old = prev[uid];
      // 第一輪、或玩家剛進榜：沒有基準值，這筆不能當成一局
      if (old !== undefined && r.score !== old) {
        this.sql.exec('INSERT INTO games (ev, uidx, t, delta, rank) VALUES (?, ?, ?, ?, ?)',
          ev.id, ui, t, r.score - old, r.rank);
      }
    }

    this.put('prev', cur);
    this.put('lastOk', now);
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    // 單例：整個追蹤器只有一個 DO 實例
    const stub = env.TRACKER.get(env.TRACKER.idFromName('main'));
    return stub.fetch(new Request(new URL(url.pathname + url.search, 'https://do'), req));
  },

  /** 看門狗：每分鐘確認 alarm 還活著；活動期外 alarm 會被停掉，這裡負責重新喚醒。 */
  async scheduled(_evt, env, ctx) {
    const stub = env.TRACKER.get(env.TRACKER.idFromName('main'));
    ctx.waitUntil(stub.fetch(new Request('https://do/ensure')));
  },
};
