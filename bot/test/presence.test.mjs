/* Gateway 在線保持器：用假的 Gateway 伺服器走完整個生命週期（Hello → identify → READY → 心跳 → 重連 → resume → 致命關閉） */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GatewayPresence } from '../src/core/gateway-presence.js';

/* 假 WebSocket：記錄送出的 payload，測試可以從伺服器端推訊息、關閉 */
class FakeWS {
  constructor(url) { this.url = url; this.sent = []; this.handlers = {}; this.closed = null; }
  addEventListener(ev, fn) { this.handlers[ev] = fn; }
  send(s) { this.sent.push(JSON.parse(s)); }
  close(code, reason) { this.closed = { code, reason }; }
  // 伺服器端動作
  serverSend(obj) { this.handlers.message && this.handlers.message({ data: JSON.stringify(obj) }); }
  serverClose(code, reason) { this.handlers.close && this.handlers.close({ code, reason }); }
}
/* 手動推進的計時器 */
function fakeTimers() {
  let id = 0; const pending = new Map();
  return {
    set(fn, ms) { const t = ++id; pending.set(t, { fn, at: ms }); return t; },
    clear(t) { pending.delete(t); },
    pending,
    /* 跑掉所有等待中的計時器（不管時間） */
    async flush() { for (const [t, p] of [...pending]) { pending.delete(t); await p.fn(); } },
  };
}
function fakeStorage() { const m = new Map(); return { m, async get(k) { return m.get(k); }, async put(k, v) { m.set(k, structuredClone(v)); }, async delete(k) { m.delete(k); } }; }
const tick = () => new Promise(r => setTimeout(r, 0));

function make(opts = {}) {
  const sockets = []; const timers = fakeTimers(); const storage = fakeStorage();
  const gp = new GatewayPresence({ token: 'tok', storage, timers, backoffMs: 10, activity: '/說明', connect: async url => { const ws = new FakeWS(url); sockets.push(ws); return ws; }, ...opts });
  return { gp, sockets, timers, storage };
}
const ready = (ws, id = 'sess1') => ws.serverSend({ op: 0, t: 'READY', s: 1, d: { session_id: id, resume_gateway_url: 'wss://resume.example' } });

test('Hello → identify（intents 0、在線狀態）→ READY → 已連線，session 存進 storage', async () => {
  const { gp, sockets, storage } = make();
  gp.ensure(); await tick();
  assert.equal(sockets.length, 1); assert.match(sockets[0].url, /gateway\.discord\.gg/);
  sockets[0].serverSend({ op: 10, d: { heartbeat_interval: 41250 } });
  const idf = sockets[0].sent.find(p => p.op === 2);
  assert.ok(idf, '要送 identify'); assert.equal(idf.d.token, 'tok'); assert.equal(idf.d.intents, 0); assert.equal(idf.d.presence.status, 'online'); assert.equal(idf.d.presence.activities[0].name, '/說明');
  assert.equal(gp.connected, false);
  ready(sockets[0]); await tick();
  assert.equal(gp.connected, true); assert.equal(gp.status().sessionId, '…sess1');
  assert.deepEqual(storage.m.get('gw'), { sessionId: 'sess1', resumeUrl: 'wss://resume.example', seq: 1 });
  gp.ensure(); await tick(); assert.equal(sockets.length, 1, 'ensure 是冪等的');
});

test('心跳：帶最新 seq，收到 ACK 才算活著；沒 ACK 就視為殭屍並以 resume 重連', async () => {
  const { gp, sockets, timers } = make();
  gp.ensure(); await tick(); const ws = sockets[0];
  ws.serverSend({ op: 10, d: { heartbeat_interval: 1000 } }); ready(ws); ws.serverSend({ op: 0, t: 'GUILD_CREATE', s: 7, d: {} });
  await timers.flush();                                   // 第一次心跳
  const hb = ws.sent.filter(p => p.op === 1); assert.equal(hb.length, 1); assert.equal(hb[0].d, 7);
  ws.serverSend({ op: 11 });
  await timers.flush(); assert.equal(ws.sent.filter(p => p.op === 1).length, 2, '有 ACK 就繼續心跳');
  await timers.flush();                                   // 這次沒有 ACK → 殭屍
  assert.equal(ws.closed.reason, 'reconnect'); assert.equal(gp.connected, false); assert.match(gp.lastError, /殭屍/);
  await timers.flush(); await tick();                     // 重連計時器
  assert.equal(sockets.length, 2); assert.match(sockets[1].url, /resume\.example/);
  sockets[1].serverSend({ op: 10, d: { heartbeat_interval: 1000 } });
  const res = sockets[1].sent.find(p => p.op === 6); assert.ok(res, '有 session 就 resume'); assert.equal(res.d.session_id, 'sess1'); assert.equal(res.d.seq, 7);
  sockets[1].serverSend({ op: 0, t: 'RESUMED', s: 8 }); assert.equal(gp.connected, true);
});

test('op 7 要求重連、op 9 invalid session（不可 resume 就重新 identify）、伺服器要求心跳', async () => {
  const { gp, sockets, timers, storage } = make();
  gp.ensure(); await tick(); const ws = sockets[0];
  ws.serverSend({ op: 10, d: { heartbeat_interval: 1000 } }); ready(ws);
  ws.serverSend({ op: 1 }); assert.equal(ws.sent.filter(p => p.op === 1).length, 1, 'op 1 立刻心跳');
  ws.serverSend({ op: 7 }); assert.equal(ws.closed.reason, 'reconnect');
  await timers.flush(); await tick(); assert.equal(sockets.length, 2);
  sockets[1].serverSend({ op: 10, d: { heartbeat_interval: 1000 } }); assert.ok(sockets[1].sent.find(p => p.op === 6), 'op 7 之後用 resume');
  sockets[1].serverSend({ op: 9, d: false });             // session 無效
  assert.equal(storage.m.has('gw'), false, '清掉存的 session');
  await timers.flush(); await tick(); assert.equal(sockets.length, 3);
  sockets[2].serverSend({ op: 10, d: { heartbeat_interval: 1000 } });
  await timers.flush();                                   // identify 有 5 秒節流，計時器推進
  assert.ok(sockets[2].sent.find(p => p.op === 2), '改用 identify');
});

test('意外斷線用指數退避重連；4004（token 錯）致命停止，換 token 後再試', async () => {
  const { gp, sockets, timers } = make();
  gp.ensure(); await tick(); sockets[0].serverSend({ op: 10, d: { heartbeat_interval: 1000 } }); ready(sockets[0]);
  sockets[0].serverClose(1006, 'abnormal'); assert.equal(gp.connected, false); assert.equal(gp.reconnects, 1);
  assert.equal([...timers.pending.values()][0].at, 10, '第一次退避 10ms');
  await timers.flush(); await tick(); assert.equal(sockets.length, 2);
  sockets[1].serverClose(1006); assert.equal([...timers.pending.values()][0].at, 20, '第二次 20ms');
  await timers.flush(); await tick(); assert.equal(sockets.length, 3);
  sockets[2].serverClose(4004, 'Authentication failed');
  assert.equal(gp.fatal, true); assert.equal(timers.pending.size, 0, '致命關閉不再排重連');
  gp.ensure(); await tick(); assert.equal(sockets.length, 3, '致命狀態下 ensure 不連');
  gp.setToken('tok2'); await tick(); assert.equal(sockets.length, 4, '換 token 後重試'); assert.equal(gp.fatal, false);
});

test('未啟用或沒 token 就什麼都不做；DO 重建後從 storage 讀回 session 直接 resume', async () => {
  const off = make({ enabled: false }); off.gp.ensure(); await tick(); assert.equal(off.sockets.length, 0);
  const none = make({ token: '' }); none.gp.ensure(); await tick(); assert.equal(none.sockets.length, 0);
  const storage = fakeStorage(); await storage.put('gw', { sessionId: 'old', resumeUrl: 'wss://resume.example', seq: 42 });
  const { gp, sockets } = make({ storage });
  gp.ensure(); await tick(); assert.match(sockets[0].url, /resume\.example/);
  sockets[0].serverSend({ op: 10, d: { heartbeat_interval: 1000 } });
  const r = sockets[0].sent.find(p => p.op === 6); assert.deepEqual(r.d, { token: 'tok', session_id: 'old', seq: 42 });
  gp.stop(); assert.equal(sockets[0].closed.code, 1000); assert.equal(gp.status().connected, false);
});
