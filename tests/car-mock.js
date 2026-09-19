// 私車排班的本機假後端（只供開發與截圖測試）。
// app.js 只在 location.hostname 是 localhost／127.0.0.1、而且網址帶 ?carmock=<模式> 時才會 import 這支；
// tests/ 不在 vercel.json 的 builds 裡，正式站根本沒有這個檔案。
// 模式：out＝未登入　admin＝Discord 登入的管理員（兩個車隊，第一個有三車）
//       member＝一般成員　qq＝只有 QQ 身分的成員　noid＝已登入但沒綁 Discord／QQ　down＝機器人連不上
//       badsig＝已登入，但機器人拒絕網站的簽章（/car/api/* 回 401 bad_signature，不是 need_login）
//       botold＝已登入，但機器人還沒更新（Worker 把非 JSON 的 404 換成 {error:'bot_not_updated', message}）
// QQ 驗證碼跟正式 Worker 一樣兩段式：第 2 次輪詢起回 stage:'confirm'（QQ 已送碼、等確認碼），第 4 次才 done。
//   帳號名填 taken（註冊）→ 作廢 reason username_taken；填 contested（重設）→ 作廢 reason contested
// QQ 忘記密碼重設成功時，跟正式 Worker 一樣順便登入（之後變成 qq 模式）
// 本機帳號密碼登入：demo / password1（登入後變成 member 模式）

const today = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
const addDay = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const MEMBERS = [
  ['u1', '菜根', 3.95, 4.10], ['u2', '小明', 3.88, 3.95], ['u3', '阿華', 3.72, 0], ['u4', '小美', 3.55, 0], ['u5', '大雄', 3.61, 0],
  ['u6', '靜香', 3.80, 3.70], ['u7', '胖虎', 3.40, 0], ['u8', '<b>小夫</b>', 3.30, 0], ['me', '我自己', 3.66, 3.50],
].map(([uid, name, bonus, s6]) => ({ uid, name, bonus, s6_bonus: s6 }));
const PAL0 = [['t1', '遲到', '#d64533', 'all'], ['t2', '早退', '#ee6644', 'all'], ['t3', '新手', '#3f8cf3', 'all'], ['t4', '半場', '#aa66cc', 'all'], ['t5', '備用', '#2f9e57', 'all'], ['t6', '注意', '#ffbb33', 'admin']];
const COLORS = PAL0.map(x => x[2]);
const fg = c => { const n = parseInt(c.slice(1), 16), l = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); const L = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; return (1.05 / (L + 0.05)) >= 4.5 ? '#ffffff' : '#111111'; };

function seat(m, role) { return m ? { user_id: m.uid, name: m.name, role, bonus: role === 's6' ? m.s6_bonus : m.bonus } : null; }
function mkCar(no) {
  const by = n => MEMBERS.find(m => m.name === n);
  const hours = no === 1 ? ['20:00', '21:00', '22:00', '23:00', '24:00'] : no === 2 ? ['19:00', '20:00', '21:00'] : [];
  const plan = {
    '20:00': ['菜根', '小明', '阿華', '小美'], '21:00': ['菜根', '小明', '阿華', '小美'], '22:00': ['小明', '大雄', '靜香', null],
    '23:00': ['小明', '大雄', '靜香', null], '24:00': [null, '阿華', '小美', null], '19:00': ['靜香', '胖虎', '<b>小夫</b>', '我自己'],
  };
  const sched = {};
  [today, addDay(today, 1), addDay(today, 2), addDay(today, 3)].forEach((d, di) => {
    sched[d] = {};
    (di === 3 ? hours.slice(0, 2) : hours).forEach(h => {
      const ppl = (no === 2 && h === '20:00') ? ['我自己', '胖虎', null, null] : (plan[h] || []);
      const sh = { run_planned: true, car_type: '蝦', locked: di === 0 && h === '24:00', applicants: [], waitlist: [] };
      ['p2', 'p3', 'p4', 'p5'].forEach((p, i) => { const m = by(ppl[i]); sh[p] = seat(m, p === 'p2' && m && m.s6_bonus ? 's6' : 'pusher'); });
      if (h === '22:00') sh.waitlist = [{ user_id: 'u7', name: '胖虎' }];
      if (no === 1 && h === '21:00' && di === 1) sh.applicants = [{ user_id: 'me', name: '我自己' }];
      sched[d][h] = sh;
    });
  });
  const pal = {}; PAL0.forEach(([id, label, color, vis]) => { pal[id] = { label, color, detail: '', visibility: vis }; });
  const seatTags = {};
  seatTags[today + '|20:00|u2'] = [{ tag: 't1', detail: '晚 10 分到，先請大雄代推前兩首。', by: '菜根', at: '17:42' }];
  const memTags = { u4: [{ tag: 't3', detail: '', by: '菜根' }], u1: [{ tag: 't6', detail: '倍率需要再確認', by: '菜根' }], u6: [{ tag: 't5', detail: '', by: '菜根' }] };
  return { sched, pal, seatTags, memTags, open: no === 1, p1: no === 1 ? '跑者A' : '跑者B' };
}
const DB = {};
const carOf = (gid, no) => { const k = gid + ':' + no; if (!DB[k]) DB[k] = mkCar(gid === '222' ? 2 : +no); return DB[k]; };

function stateOut(gid, no, role) {
  const c = carOf(gid, no), admin = role === 'admin';
  const tagsOf = (d, h, p) => {
    if (!p) return [];
    const out = [];
    [['shift', c.seatTags[d + '|' + h + '|' + p.user_id] || []], ['member', c.memTags[p.user_id] || []]].forEach(([scope, lst]) => lst.forEach(e => {
      const t = c.pal[e.tag]; if (!t) return; if (t.visibility === 'admin' && !admin) return;
      const r = { tag: e.tag, label: t.label, color: t.color, fg: fg(t.color), detail: e.detail || t.detail || '', scope };
      if (e.until) r.until = e.until; if (admin) { r.vis = t.visibility; r.by = e.by || ''; }
      out.push(r);
    }));
    return out;
  };
  const days = Object.keys(c.sched).sort().map(d => ({ date: d, rows: Object.keys(c.sched[d]).sort().map(h => {
    const sh = c.sched[d][h];
    return { hour: h, car_type: sh.car_type, locked: !!sh.locked, manual: false,
      seats: ['p2', 'p3', 'p4', 'p5'].map(p => { const x = sh[p]; const o = { pos: p, name: x ? x.name : null, role: x ? x.role : null, bonus: x ? x.bonus : null, tags: tagsOf(d, h, x) }; if (admin && x) o.fp = 'fp-' + d + h + p + x.user_id; return o; }),
      applicants: sh.applicants.length, waitlist: sh.waitlist.map(w => w.name) };
  }) }));
  const me = {};
  Object.keys(c.sched).forEach(d => { const hs = []; Object.keys(c.sched[d]).sort().forEach(h => { const sh = c.sched[d][h];
    const st = ['p2', 'p3', 'p4', 'p5'].find(p => sh[p] && sh[p].user_id === 'me') || null;
    const ap = sh.applicants.some(a => a.user_id === 'me'), wl = sh.waitlist.some(w => w.user_id === 'me');
    if (st || ap || wl) hs.push({ hour: h, seat: st, applied: ap, waitlist: wl, locked: !!sh.locked }); }); if (hs.length) me[d] = hs; });
  const base = { guild: gid === '111' ? '菜根車隊' : '測試車隊', p1: c.p1, today, days };
  if (!admin) return Object.assign(base, { role: 'member', settings: {}, me });
  return Object.assign(base, { role: 'admin', settings: { schedule_open: c.open }, me });
}

export function install(BASE, mode0) {
  const orig = window.fetch.bind(window);
  let mode = mode0;
  const J = (d, st) => Promise.resolve(new Response(JSON.stringify(d), { status: st || 200, headers: { 'Content-Type': 'application/json' } }));
  let polls = 0, pending = null, failWhy = '';
  const user = () => {
    if (mode === 'out') return null;
    const u = { id: 7, name: mode === 'qq' ? 'QQ 玩家' : '菜根', picture: '', email: mode === 'admin' ? 'demo@example.com' : null, status: 'approved', is_admin: false,
      username: mode === 'member' || mode === 'qq' ? 'demo' : null, hasPassword: mode === 'member' || mode === 'qq',
      discord: (mode === 'admin' || mode === 'member' || mode === 'down' || mode === 'badsig' || mode === 'botold') ? { id: '123', name: '菜根#0001' } : null,
      qq: mode === 'qq' ? [{ g: 'GROUPOPENID1234567', n: 'QQ 玩家' }] : [] };
    return u;
  };
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith(BASE)) return orig(input, init);
    const u = new URL(url), path = u.pathname, q = u.searchParams, m = ((init && init.method) || 'GET').toUpperCase();
    let body = {}; try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) {}
    await new Promise(r => setTimeout(r, 120));
    if (path === '/api/me') return J({ user: user() });
    if (path === '/auth/password/login') {
      if (body.username === 'demo' && body.password === 'password1') { mode = 'member'; try { sessionStorage.setItem('sekai-carmock', 'member'); } catch (e) {} return J({ ok: true }); }
      return J({ error: '帳號或密碼錯誤' }, 401);
    }
    if (path === '/auth/qq/start') {
      polls = 0; pending = body.purpose;
      failWhy = body.username === 'taken' ? 'username_taken' : body.username === 'contested' ? 'contested' : '';
      return J({ code: '482913', k: 'mockkey', ttl: 120 });
    }
    if (path === '/auth/qq/poll') {
      ++polls;
      if (failWhy && polls >= 2) return J({ status: 'fail', purpose: pending, reason: failWhy,
        message: failWhy === 'username_taken' ? '這個帳號名剛剛被別人註冊了，請換一個帳號名。' : '有其他 QQ 也送出了同一組驗證碼，為了安全這組碼已作廢。請重新取得，並注意不要讓別人看到後搶先送出。' });
      if (polls < 2) return J({ status: 'pending', ttl: 118, purpose: pending });
      if (polls < 4) return J({ status: 'pending', ttl: 115, purpose: pending, stage: 'confirm', qq: { n: '測試 QQ' } });
      if (pending === 'reset') return J({ status: 'done', resetToken: 'rt' });
      mode = pending === 'link' ? 'qq' : 'qq'; try { sessionStorage.setItem('sekai-carmock', mode); } catch (e) {}
      return J({ status: 'done' });
    }
    if (path === '/auth/password/reset') {
      if (body.resetToken !== 'rt') return J({ error: '重設連結已失效' }, 400);
      mode = 'qq'; try { sessionStorage.setItem('sekai-carmock', mode); } catch (e) {}   // 正式 Worker 會 Set-Cookie 登入
      return J({ ok: true });
    }
    if (path === '/auth/password/set') return J({ ok: true });
    if (!path.startsWith('/car/api/')) return orig(input, init);
    if (mode === 'out') return J({ error: 'need_login' }, 401);
    if (mode === 'noid') return J({ error: 'need_identity' }, 403);
    if (mode === 'down') return J({ error: 'bad_gateway' }, 502);
    if (mode === 'badsig') return J({ ok: false, error: 'bad_signature', why: 'bad_mac' }, 401);
    if (mode === 'botold') return J({ error: 'bot_not_updated', message: '車隊機器人尚未更新或不支援這個功能' }, 404);
    const rest = path.slice('/car/api'.length);
    const role0 = mode === 'admin' ? 'admin' : 'member';
    if (rest === '/car/me') {
      const g = [{ gid: '111', name: '菜根車隊', role: role0, cars: [{ no: 1, name: '一車' }, { no: 2, name: '二車' }, { no: 3, name: '三車' }] }];
      if (mode === 'admin') g.push({ gid: '222', name: '測試車隊', role: 'member', cars: [{ no: 1, name: '一車' }] });
      return J({ guilds: g });
    }
    const gid = q.get('gid') || body.gid, no = +(q.get('car') || body.car || 1);
    if (!gid) return J({ error: 'missing gid' }, 400);
    const role = gid === '222' ? 'member' : role0, admin = role === 'admin';
    const c = carOf(gid, no);
    /* 各分頁的假後端：每一組只寫在自己的 @@MOCK 標記下面；回傳 Response 就結束，回 undefined 就交給後面的路由。
       可用：rest、m（方法）、q（query）、body、gid、no、role、admin、c（該車資料）、J(obj, status)、MEMBERS */
    /* @@MOCK-A@@ sched */

    /* ---------- end @@MOCK-A@@ ---------- */
    /* @@MOCK-B@@ members */

    /* ---------- end @@MOCK-B@@ ---------- */
    /* @@MOCK-C@@ stats */

    /* ---------- end @@MOCK-C@@ ---------- */
    /* @@MOCK-D@@ music */

    /* ---------- end @@MOCK-D@@ ---------- */
    /* @@MOCK-E@@ bridge */
    // 橋接（合班）：照 engine_omega _web_api_bridge／_web_api_bridge_act 的回應格式與錯誤字串。
    //   GET /bridge 成員可看；POST /bridge 只有管理員（_WEB_TIER 預設 admin → 403 {error:'此功能僅限管理員', role, need}）。
    //   初始：'222'（admin 模式下是成員身分）在「星空車隊」當跑者方的橋接組裡（含 QQ 群與 <b>小夫</b> XSS 測試隊名）；'111' 未橋接。
    //   配對碼 STAR23＝加入星空車隊那一組（假後端刻意不燒掉，方便重測）；其他碼要先由某一隊產生。
    //   產生配對碼約 2.5 秒後，假裝「夜櫻車隊」（第二次起是 QQ 二群）拿碼加入，本隊變跑者方。
    //   房號 99999＝機器人來不及做完（合約 C1：{ok, pending, msg}，3 秒後才真的設好）；星空、<b>小夫</b> 兩隊示範改名被略過。
    //   channel 用 target_gid 指定哪一隊（合約 C2），沒帶才退回 gid。
    //   注意：機器人會拒絕多車車隊橋接（crew_merge_preview）；假後端不擋，前端自己會擋多車（測試時把 111 的車數改成 1 再點）。
    if (rest === '/bridge') {
      const H = 3600e3, now = Date.now();
      const E = globalThis.__mockE || (globalThis.__mockE = {
        teams: {
          '111': { name: '菜根車隊', plate_fb: '1300000000000000011', room_fb: '1300000000000000012', set: {}, plateName: '車牌' },
          '222': { name: '測試車隊', plate_fb: '', room_fb: '1300000000000000022', set: { board: '1300000000000000021' }, plateName: '測試車牌' },
          '900': { name: '星空車隊', plate_fb: '1300000000000000901', room_fb: '', set: { plate: '1300000000000000902' }, plateName: '星空車牌', limit: true },
          '901': { name: '<b>小夫</b>車隊', plate_fb: '', room_fb: '', set: {}, limit: true },
          '902': { name: '夜櫻車隊', plate_fb: '1300000000000000921', room_fb: '1300000000000000922', set: {}, plateName: '夜櫻車牌' },
          qqg_MOCKQQ01: { name: 'QQ 夥伴群', set: {} },
          qqg_MOCKQQ02: { name: 'QQ 二群', set: {} },
        },
        groups: { '900': { peers: ['900', '222', 'qqg_MOCKQQ01', '901'], room: { id: '54321', src_name: '星空車隊' }, exp: now + 150 * H } },
        codes: { STAR23: '900' },
        joiners: ['902', 'qqg_MOCKQQ02'],
      });
      const iso = t => { const x = new Date(t), p = n => String(n).padStart(2, '0'); return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate()) + 'T' + p(x.getHours()) + ':' + p(x.getMinutes()) + ':' + p(x.getSeconds()) + '.000000'; };
      const grpOf = g => Object.keys(E.groups).find(k => E.groups[k].peers.indexOf(g) >= 0) || null;
      const team = g => E.teams[g] || (E.teams[g] = { name: g, set: {} });
      const a = grpOf(gid), G = a ? E.groups[a] : null, T = team(gid);
      if (m === 'GET') {
        const peers = G ? G.peers.map(p => { const t = team(p); return { gid: p, name: t.name, anchor: p === a, me: p === gid, kind: /^\d+$/.test(p) ? 'dc' : 'qq',
          board: t.set.board || '', plate: t.set.plate || '', plate_fallback: t.plate_fb || '', room_ch: t.set.room_ch || '', room_fallback: t.room_fb || '' }; }) : [];
        return J({ bridged: !!a, anchor: a, is_anchor: a === gid, peers, room: G && G.room ? G.room.id : '', room_src: G && G.room ? G.room.src_name : '',
          expires_at: G ? iso(G.exp) : '', hours_left: G ? Math.round((G.exp - Date.now()) / H * 10) / 10 : null, ttl_hours: 200,
          admin, me: gid, my_name: T.name, board_channel: T.set.board || '', plate_channel: T.set.plate || '', room_channel: T.set.room_ch || '' });
      }
      if (!admin) return J({ error: '此功能僅限管理員', role, need: 'admin' }, 403);
      const act = String(body.action || '').trim();
      if (act === 'code') {
        if (a && a !== gid) return J({ error: '這個車隊已經在別組橋接裡（跑者方 ' + a + '），先解除才能發起' }, 400);
        Object.keys(E.codes).forEach(k => { if (E.codes[k] === gid) delete E.codes[k]; });
        const AL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let code = '';
        for (let i = 0; i < 6; i++) code += AL[Math.floor(Math.random() * AL.length)];
        E.codes[code] = gid;
        setTimeout(() => {                       // 假裝對方拿碼加入
          const j = E.joiners.find(x => !grpOf(x));
          if (!j || E.codes[code] !== gid) return;
          delete E.codes[code];
          const G2 = E.groups[gid] || (E.groups[gid] = { peers: [gid], room: null, exp: Date.now() + 200 * H });
          if (G2.peers.indexOf(j) < 0) G2.peers.push(j);
        }, 2500);
        return J({ ok: true, code, minutes: 15 });
      }
      if (act === 'join') {
        const code = String(body.code || '').trim().toUpperCase(), src = E.codes[code];
        if (!src) return J({ error: '配對碼無效或已過期（15 分鐘內有效），請對方重新產生' }, 400);
        if (src === gid) return J({ error: '不能跟自己橋接' }, 400);
        if (a === src) return J({ error: '你們已經在同一組了' }, 400);
        if (a) return J({ error: '這個車隊已經在別組橋接裡（跑者方 ' + a + '），先解除' }, 400);
        const G2 = E.groups[src] || (E.groups[src] = { peers: [src], room: null, exp: Date.now() + 200 * H });
        G2.peers.push(gid);
        if (code !== 'STAR23') delete E.codes[code];
        return J({ ok: true, anchor: src, joined: gid, members_moved: 3, days_merged: 4 });
      }
      if (act === 'leave') {
        if (!a) return J({ error: '這個車隊沒有在橋接中' }, 400);
        if (gid === a) { delete E.groups[a]; return J({ ok: true, dissolved: true }); }
        G.peers = G.peers.filter(p => p !== gid);
        if (G.peers.length <= 1) { delete E.groups[a]; return J({ ok: true, dissolved: true }); }
        return J({ ok: true, dissolved: false });
      }
      if (act === 'renew') {
        if (!a) return J({ error: '這個車隊沒有在橋接中' }, 400);
        G.exp = Date.now() + 200 * H;
        return J({ ok: true, expires_at: iso(G.exp), hours_left: 200.0 });
      }
      if (act === 'room') {
        const room = String(body.room || '').trim();
        if (room && !/^\d+$/.test(room)) return J({ error: '房號只能是數字' }, 400);
        await new Promise(r => setTimeout(r, 700));            // 改名要等 Discord：讓「處理中」看得到
        const dcWithPlate = () => (G ? G.peers : []).filter(p => /^\d+$/.test(p) && (team(p).set.plate || team(p).plate_fb));
        if (!room) { const n = dcWithPlate().length; if (G) G.room = null; return J({ ok: true, room: '', restored: n }); }
        if (!a) return J({ error: '這個車隊沒有在橋接中' }, 400);
        const push = () => {
          G.room = { id: room, src_name: T.name };
          const out = { renamed: [], messaged: [], qq: [], skipped: [] };
          G.peers.forEach(p => {
            const t = team(p);
            if (!/^\d+$/.test(p)) { out.qq.push(p); return; }
            if (!(t.set.plate || t.plate_fb)) out.skipped.push(t.name + '：沒設車牌頻道（/房間 設定車牌 或網頁橋接頁填）');
            else if (t.limit) out.skipped.push(t.name + '：改名失敗（多半是 Discord 改名限流 2 次/10 分）');
            else out.renamed.push(t.name + '｜#' + (t.plateName || '車牌'));
            if (t.set.room_ch || t.room_fb) out.messaged.push(p);
          });
          return out;
        };
        if (room === '99999') { setTimeout(() => { if (E.groups[a] === G) push(); }, 3000); return J({ ok: true, pending: true, msg: '房號同步中（Discord 改名比較慢），稍後重新整理看結果' }); }
        const out = push();
        return J({ ok: true, room, renamed: out.renamed.length, renamed_detail: out.renamed, messaged: out.messaged.length, qq: out.qq.length, skipped: out.skipped });
      }
      if (act === 'proxy') {
        const s = String(body.hours || '').replace(/[~到至]/g, '-').replace(/[點时時:\s]/g, '');
        let hrs = []; const mm = /^(\d{1,2})-(\d{1,2})/.exec(s);
        if (mm) { const x = +mm[1]; let y = +mm[2]; if (x <= 24 && y <= 24) { if (y <= x) y += 24; for (let h = x; h < y; h++) hrs.push(String(h % 24).padStart(2, '0') + ':00'); } }
        else if (/^\d{1,2}$/.test(s) && +s < 24) hrs = [String(+s).padStart(2, '0') + ':00'];
        if (!hrs.length) return J({ error: '時段看不懂，例：20-24' }, 400);
        const date = String(body.date || '').trim() || today;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return J({ error: '日期格式須為 YYYY-MM-DD' }, 400);
        if (date < today) return J({ error: date + ' 已過去，歷史班表為唯讀' }, 400);
        const nm = String(body.name || '').trim();
        if (!nm) return J({ error: '要有名字' }, 400);
        const b = Number(body.bonus || 0);
        if (!isFinite(b)) return J({ error: "could not convert string to float: '" + String(body.bonus) + "'" }, 400);
        if (b !== 0 && !(b >= 1.18 && b <= 3.88)) return J({ error: '倍率要是 0 或 1.18~3.88，收到 ' + b }, 400);
        const s6 = Number(body.s6_bonus || 0) || 0, r6 = body.role === 's6';
        if (r6 && s6 <= 0) return J({ error: nm + ' 沒有 S6 倍率，不能報 S6' }, 400);
        let hsh = 0; for (const ch of nm) hsh = (hsh * 31 + ch.codePointAt(0)) >>> 0;
        const uid = 'ghost_' + hsh.toString(16), c1 = carOf(gid, 1), day = c1.sched[date] || {}, ok = [], skipped = [];
        hrs.forEach(h => {
          const sh = day[h]; if (!sh) { skipped.push(h); return; }
          if (['p2', 'p3', 'p4', 'p5'].some(p => sh[p] && sh[p].user_id === uid) || sh.waitlist.some(w => w.user_id === uid)) { ok.push(h); return; }
          const who = { user_id: uid, name: nm, role: r6 ? 's6' : 'pusher', bonus: r6 ? s6 : b };
          const empty = ['p2', 'p3', 'p4', 'p5'].find(p => !sh[p]);
          if (empty) sh[empty] = who; else sh.waitlist.push({ user_id: uid, name: nm });
          ok.push(h);
        });
        return J({ ok: true, uid, name: nm, date, hours: ok, skipped });
      }
      if (act === 'channel') {
        const tgt = String(body.target_gid || body.gid || gid);
        if (tgt !== gid && !(G && G.peers.indexOf(tgt) >= 0)) return J({ error: '那一隊不在你的橋接組裡' }, 403);
        const t = team(tgt);
        ['board', 'plate', 'room_ch'].forEach(k => { if (k in body) { const v = String(body[k] || '').trim(); if (v) t.set[k] = v; else delete t.set[k]; } });
        return J({ ok: true, gid: tgt });
      }
      return J({ error: 'unknown action' }, 400);
    }
    /* ---------- end @@MOCK-E@@ ---------- */
    /* @@MOCK-F@@ settings */

    /* ---------- end @@MOCK-F@@ ---------- */
    if (rest === '/state') return J(stateOut(gid, no, role));
    if (rest === '/tags' && m === 'GET') return J({ tags: Object.entries(c.pal).filter(([, t]) => admin || t.visibility !== 'admin').map(([id, t]) => ({ id, label: t.label, color: t.color, fg: fg(t.color), detail: t.detail, visibility: t.visibility })), colors: COLORS });
    if (rest === '/members') return J({ members: MEMBERS.map(x => ({ name: x.name, bonus: x.bonus, s6_bonus: x.s6_bonus, identity: '', aliases: [] })), total: MEMBERS.length });
    const sh = (c.sched[body.date] || {})[body.hour];
    if (rest === '/signup') {
      const done = [], skip = [];
      (body.hours || []).forEach(h => { const s = (c.sched[body.date] || {})[h]; if (!s) { skip.push(h); return; }
        if (body.action === 'cancel') { const n = s.applicants.length; s.applicants = s.applicants.filter(a => a.user_id !== 'me'); let hit = n !== s.applicants.length;
          ['p2', 'p3', 'p4', 'p5'].forEach(p => { if (s[p] && s[p].user_id === 'me') { s[p] = null; hit = true; } }); (hit ? done : skip).push(h); return; }
        if (s.locked) { skip.push(h); return; }
        const empty = ['p2', 'p3', 'p4', 'p5'].find(p => !s[p]); const me = MEMBERS.find(x => x.uid === 'me');
        if (empty) s[empty] = seat(me, body.role === 's6' && empty === 'p2' ? 's6' : 'pusher'); else s.waitlist.push({ user_id: 'me', name: me.name });
        done.push(h); });
      return J({ ok: true, done, skip, name: '我自己' });
    }
    if (!admin) return J({ error: '此功能僅限管理員' }, 403);
    if (rest === '/swap') {
      if (!sh) return J({ error: 'bad target' }, 400);
      if (!body.new) { sh[body.pos] = null; return J({ ok: true, cleared: true }); }
      const mm = MEMBERS.find(x => x.name === body.new); if (!mm) return J({ error: '找不到成員「' + body.new + '」' }, 404);
      const role2 = body.role === 's6' ? 's6' : body.role === 'pusher' ? 'pusher' : (body.pos === 'p2' && mm.s6_bonus ? 's6' : 'pusher');
      if (role2 === 's6' && !mm.s6_bonus) return J({ error: mm.name + ' 沒有登記 S6 倍率，無法排 S6' }, 400);
      sh[body.pos] = seat(mm, role2); return J({ ok: true, name: mm.name, role: role2 });
    }
    if (rest === '/setting') { if (body.key === 'schedule_open') c.open = !!body.value; return J({ ok: true }); }
    if (rest === '/batch' && body.action === 'lock') { let n = 0; (body.hours || []).forEach(h => { const s = (c.sched[body.date] || {})[h]; if (s) { s.locked = !!body.value; n++; } }); return J({ ok: true, msg: '已' + (body.value ? '鎖定' : '解鎖') + ' ' + n + ' 個時段' }); }
    if (rest === '/seattag') {
      if (!sh || !sh[body.pos]) return J({ error: '這個位置沒有人（可能剛被換掉），請重新整理' }, 400);
      const p = sh[body.pos]; if (body.fp !== 'fp-' + body.date + body.hour + body.pos + p.user_id) return J({ error: '座位已變動（可能有人剛換人），請重新整理後再標記' }, 409);
      const key = body.date + '|' + body.hour + '|' + p.user_id;
      const lst = body.scope === 'member' ? (c.memTags[p.user_id] = c.memTags[p.user_id] || []) : (c.seatTags[key] = c.seatTags[key] || []);
      const i = lst.findIndex(e => e.tag === body.tag);
      if (body.action === 'del') { if (i < 0) return J({ error: '這個人沒有這個標記' }, 404); lst.splice(i, 1); return J({ ok: true }); }
      if (i >= 0) lst.splice(i, 1); const e = { tag: body.tag, detail: body.detail || '', by: '菜根' }; if (body.until) e.until = body.until; lst.push(e); return J({ ok: true });
    }
    if (rest === '/tags') {
      const out = () => Object.entries(c.pal).map(([id, t]) => ({ id, label: t.label, color: t.color, fg: fg(t.color), detail: t.detail, visibility: t.visibility }));
      if (body.action === 'add') { const id = 't' + Date.now(); c.pal[id] = { label: body.label, color: body.color, detail: body.detail || '', visibility: body.visibility }; return J({ ok: true, id, tags: out() }); }
      if (body.action === 'edit') { if (!c.pal[body.id]) return J({ error: '找不到這個標籤' }, 404); Object.assign(c.pal[body.id], { label: body.label, color: body.color, detail: body.detail, visibility: body.visibility }); return J({ ok: true, tags: out() }); }
      if (body.action === 'del') { delete c.pal[body.id]; return J({ ok: true, tags: out() }); }
    }
    return J({ error: 'unknown' }, 400);
  };
  return true;
}
