/* Gateway「在線」保持器：只為了讓機器人在成員列表顯示上線（綠點＋狀態文字）。
   Workers 版走 HTTP 互動，本來沒有 Gateway 連線，Discord 一律顯示離線；這裡在 Durable Object 內
   開一條對外 WebSocket 連到 Gateway，identify（intents = 0，不收任何事件）、定時心跳、斷線重連／resume。
   不處理任何事件，斜線指令仍走 HTTP 互動。

   平台相關的東西都可以注入（connect、storage、計時器），測試用假的 Gateway 跑完整個生命週期。
   關閉：環境變數 PRESENCE=0。 */

const DEFAULT_GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const FATAL_CLOSE = new Set([4004, 4010, 4011, 4012, 4013, 4014]);   // 壞 token、分片／intents 問題：重連也沒用
const FRESH_CLOSE = new Set([4007, 4009]);   // seq 錯誤、session 逾時：不能 resume，要重新 identify
const STABLE_MS = 60000;                      // 連線撐過一分鐘才把退避歸零；READY 後馬上斷的循環會一路退避上去
const IDENTIFY_DAILY_CAP = 900;               // Discord 一天 1000 次 identify，超過會被重設 token；留 100 次餘裕
const dayOf = ms => new Date(ms).toISOString().slice(0, 10);

/* Workers：優先用 WebSocket 建構子，沒有就用 fetch + Upgrade */
export async function defaultConnect(url) {
  if (typeof WebSocket === 'function') return new WebSocket(url);
  const res = await fetch(url.replace(/^wss:/, 'https:'), { headers: { Upgrade: 'websocket' } });
  const ws = res.webSocket;
  if (!ws) throw new Error(`Gateway 升級失敗：HTTP ${res.status}`);
  ws.accept();
  return ws;
}

export class GatewayPresence {
  constructor({ token = '', storage = null, connect = defaultConnect, log = () => {}, gatewayUrl = null, enabled = true, activity = '', activityType = 0, backoffMs = 1000, maxBackoffMs = 60000, now = () => Date.now(), timers = { set: (f, ms) => setTimeout(f, ms), clear: t => clearTimeout(t) } } = {}) {
    this.token = token; this.storage = storage; this.connect = connect; this.log = log; this.gatewayUrl = gatewayUrl;
    this.enabled = enabled; this.activity = activity; this.activityType = activityType;
    this.backoffMs = backoffMs; this.maxBackoffMs = maxBackoffMs; this.now = now; this.timers = timers;
    this.ws = null; this.connecting = false; this.connected = false; this.since = 0;
    this.seq = null; this.sessionId = null; this.resumeUrl = null;
    this.hbTimer = null; this.hbInterval = 0; this.awaitingAck = false; this.reconnectTimer = null;
    this.attempts = 0; this.reconnects = 0; this.lastError = ''; this.fatal = false; this.lastIdentify = 0; this.gen = 0;
    this.idDay = ''; this.idCount = 0;
    this.loaded = false;
  }
  setToken(t) { if (t !== this.token) { this.token = t; this.fatal = false; this.lastError = ''; this.restart(); } }
  status() { return { enabled: this.enabled, connected: this.connected, since: this.since, reconnects: this.reconnects, lastError: this.lastError, fatal: this.fatal, sessionId: this.sessionId ? '…' + String(this.sessionId).slice(-6) : null, identifiesToday: this.idDay === dayOf(this.now()) ? this.idCount : 0 }; }
  /* 今天的 identify 額度用完了，而且沒有可 resume 的 session：等明天（UTC）再連 */
  identifyBlocked() { return !this.sessionId && this.idDay === dayOf(this.now()) && this.idCount >= IDENTIFY_DAILY_CAP; }

  /* 有需要就連線（冪等）；每次 tick／alarm 都呼叫一次當看門狗 */
  ensure() {
    if (!this.enabled || !this.token || this.fatal) return;
    if (this.ws || this.connecting || this.reconnectTimer) return;
    this.connectNow().catch(e => { this.lastError = String(e && e.message || e); this.scheduleReconnect(); });
  }
  restart() { this.stop('restart'); this.attempts = 0; this.ensure(); }
  stop(reason = 'stop') {
    this.gen++;
    if (this.hbTimer) { this.timers.clear(this.hbTimer); this.hbTimer = null; }
    if (this.reconnectTimer) { this.timers.clear(this.reconnectTimer); this.reconnectTimer = null; }
    const ws = this.ws; this.ws = null; this.connecting = false; this.connected = false;
    if (ws) { try { ws.close(1000, reason); } catch {} }
  }

  async loadSession() {
    if (this.loaded || !this.storage) return;
    this.loaded = true;
    try { const s = await this.storage.get('gw'); if (s && s.sessionId) { this.sessionId = s.sessionId; this.resumeUrl = s.resumeUrl || null; this.seq = s.seq ?? null; } } catch {}
    try { const c = await this.storage.get('gwIdentify'); if (c && c.day) { this.idDay = c.day; this.idCount = Number(c.n) || 0; } } catch {}
  }
  countIdentify() {
    const day = dayOf(this.now());
    if (this.idDay !== day) { this.idDay = day; this.idCount = 0; }
    this.idCount++;
    if (this.storage) { try { Promise.resolve(this.storage.put('gwIdentify', { day: this.idDay, n: this.idCount })).catch(() => {}); } catch {} }
  }
  async saveSession() {
    if (!this.storage) return;
    try { if (this.sessionId) await this.storage.put('gw', { sessionId: this.sessionId, resumeUrl: this.resumeUrl, seq: this.seq }); else await this.storage.delete('gw'); } catch {}
  }

  async connectNow() {
    this.connecting = true;
    const gen = ++this.gen;
    await this.loadSession();
    if (this.identifyBlocked()) { this.connecting = false; this.lastError = `今天的 identify 已用 ${this.idCount} 次，明天（UTC）再連`; return; }
    const url = (this.sessionId && this.resumeUrl) ? this.resumeUrl + (this.resumeUrl.includes('?') ? '' : '/?v=10&encoding=json') : (this.gatewayUrl || DEFAULT_GATEWAY);
    const ws = await this.connect(url);
    if (gen !== this.gen) { try { ws.close(1000, 'superseded'); } catch {} return; }
    this.ws = ws; this.connecting = false;
    const on = (ev, fn) => (ws.addEventListener ? ws.addEventListener(ev, fn) : (ws['on' + ev] = fn));
    on('message', e => { if (gen !== this.gen) return; this.onMessage(typeof e.data === 'string' ? e.data : (e.data ? String(e.data) : '')); });
    on('close', e => { if (gen !== this.gen) return; this.onClose(e && e.code, e && e.reason); });
    on('error', e => { if (gen !== this.gen) return; this.lastError = String((e && e.message) || 'websocket error'); });
  }

  send(obj) { try { if (this.ws) this.ws.send(JSON.stringify(obj)); } catch (e) { this.lastError = String(e.message || e); } }

  onMessage(raw) {
    let p; try { p = JSON.parse(raw); } catch { return; }
    if (p.s != null) this.seq = p.s;
    switch (p.op) {
      case 10: {   // Hello
        this.hbInterval = Math.max(1000, Number(p.d && p.d.heartbeat_interval) || 41250);
        this.awaitingAck = false;
        this.scheduleHeartbeat(Math.floor(this.hbInterval * Math.random()));
        if (this.sessionId && this.seq != null) this.send({ op: 6, d: { token: this.token, session_id: this.sessionId, seq: this.seq } });
        else this.identify();
        break;
      }
      case 11: this.awaitingAck = false; break;                       // Heartbeat ACK
      case 1: this.heartbeat(); break;                                // 伺服器要求立刻心跳
      case 7: this.lastError = 'gateway 要求重連'; this.reconnect(true); break;   // Reconnect（可 resume）
      case 9: {                                                       // Invalid Session
        if (!p.d) { this.sessionId = null; this.resumeUrl = null; this.seq = null; this.saveSession(); }
        this.lastError = 'invalid session' + (p.d ? '（可 resume）' : '');
        this.reconnect(!!p.d, 2000 + Math.floor(Math.random() * 3000));
        break;
      }
      case 0: {                                                       // Dispatch：只關心 READY / RESUMED
        if (p.t === 'READY') { this.sessionId = p.d.session_id; this.resumeUrl = p.d.resume_gateway_url || null; this.saveSession(); this.markConnected(); }
        else if (p.t === 'RESUMED') this.markConnected();
        break;
      }
      default: break;
    }
  }
  markConnected() { this.connected = true; this.since = this.now(); this.lastError = ''; }
  /* 斷線時：撐過 STABLE_MS 的連線才把退避歸零 */
  noteDrop() { if (this.connected && this.now() - this.since >= STABLE_MS) this.attempts = 0; }

  identify() {
    const now = this.now();
    const wait = Math.max(0, this.lastIdentify + 5500 - now);        // identify 每 5 秒最多一次
    const go = () => {
      if (this.identifyBlocked()) { this.lastError = `今天的 identify 已用 ${this.idCount} 次，明天（UTC）再連`; this.stop('identify-cap'); return; }
      this.lastIdentify = this.now();
      this.countIdentify();
      const presence = { status: 'online', since: null, afk: false, activities: this.activity ? [{ name: this.activity, type: this.activityType }] : [] };
      this.send({ op: 2, d: { token: this.token, intents: 0, properties: { os: 'cloudflare', browser: 'sekai-center-bot', device: 'sekai-center-bot' }, presence } });
    };
    if (wait) this.timers.set(go, wait); else go();
  }

  scheduleHeartbeat(ms) { if (this.hbTimer) this.timers.clear(this.hbTimer); this.hbTimer = this.timers.set(() => { this.hbTimer = null; this.heartbeat(); }, ms); }
  heartbeat() {
    if (!this.ws) return;
    if (this.awaitingAck) { this.lastError = '心跳沒有回應（殭屍連線）'; this.reconnect(true); return; }
    this.awaitingAck = true;
    this.send({ op: 1, d: this.seq });
    this.scheduleHeartbeat(this.hbInterval);
  }

  /* 關閉目前連線並排程重連；resume=true 保留 session（下次用 op 6） */
  reconnect(resume, delayMs) {
    this.noteDrop();
    if (!resume) { this.sessionId = null; this.resumeUrl = null; this.seq = null; this.saveSession(); }
    this.stop('reconnect'); this.reconnects++;
    this.scheduleReconnect(delayMs);
  }
  scheduleReconnect(delayMs) {
    if (this.reconnectTimer || this.fatal || !this.enabled) return;
    const delay = delayMs ?? Math.min(this.maxBackoffMs, this.backoffMs * 2 ** Math.min(6, this.attempts++));
    this.reconnectTimer = this.timers.set(() => { this.reconnectTimer = null; this.ensure(); }, delay);
  }
  onClose(code, reason) {
    const c = Number(code) || 0;
    this.lastError = `連線關閉 ${c}${reason ? ' ' + reason : ''}`;
    if (this.hbTimer) { this.timers.clear(this.hbTimer); this.hbTimer = null; }
    this.noteDrop();
    this.ws = null; this.connected = false; this.connecting = false;
    if (FRESH_CLOSE.has(c)) { this.sessionId = null; this.resumeUrl = null; this.seq = null; this.saveSession(); }
    if (FATAL_CLOSE.has(c)) { this.fatal = true; this.sessionId = null; this.resumeUrl = null; this.seq = null; this.saveSession(); this.log(`Gateway 致命關閉 ${c}，停止重連（換 token 後會再試）`); return; }
    this.reconnects++;
    this.scheduleReconnect();
  }
}
