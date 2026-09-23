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
  /* 車隊模式的種子資料：一車今天 22:00 指定成員「阿華」當跑者（帶倍率）、23:00 是沒註冊的跑者（純文字名字） */
  if (no === 1 && sched[today]) {
    if (sched[today]['22:00']) sched[today]['22:00'].p1 = { name: '阿華', fixed: true, custom: true, user_id: 'u3', bonus: 3.72 };
    if (sched[today]['23:00']) sched[today]['23:00'].p1 = { name: '外援小王', fixed: true, custom: true };
  }
  const pal = {}; PAL0.forEach(([id, label, color, vis]) => { pal[id] = { label, color, detail: '', visibility: vis }; });
  const seatTags = {};
  seatTags[today + '|20:00|u2'] = [{ tag: 't1', detail: '晚 10 分到，先請大雄代推前兩首。', by: '菜根', at: '17:42' }];
  const memTags = { u4: [{ tag: 't3', detail: '', by: '菜根' }], u1: [{ tag: 't6', detail: '倍率需要再確認', by: '菜根' }], u6: [{ tag: 't5', detail: '', by: '菜根' }] };
  return { sched, pal, seatTags, memTags, open: no === 1, p1: no === 1 ? '跑者A' : '跑者B' };
}
const DB = {};
const carOf = (gid, no) => { const k = gid + ':' + no; if (!DB[k]) DB[k] = mkCar(gid === '222' ? 2 : +no); return DB[k]; };
/* 車隊模式（R 組：跑者／私車車隊開關／歷史任意日期／試算表雙向同步）共用的假資料與測試開關。
   team_mode 是整個車隊共用（不分車）：'111' 一開始是車隊模式（才測得到跑者的操作）、'222' 是私車。
   測試開關：sessionStorage 'sekai-carmockR'（逗號分隔）或執行中改 globalThis.__mockR：
     oldbot   /state 不帶每一列的 p1 與 team_mode（舊機器人）；/runner 回 404 bot_not_updated
     oldsheet /sheet info 不帶雙向同步的欄位（舊機器人）
   __mockR.sheet = 'err'｜'pending'｜''：下一次 /sheet sync 回 500 {error}／{ok, pending, msg}／正常
   __mockR.runPending = true：下一次 /runner 回 {ok, pending, msg} */
const TEAM = { '111': true, '222': false };
const mockR = () => globalThis.__mockR || (globalThis.__mockR = (() => {
  let f = ''; try { f = sessionStorage.getItem('sekai-carmockR') || ''; } catch (e) {}
  const has = k => f.split(',').indexOf(k) >= 0;
  /* 跑者自行報跑（S 組）：selfrun＝一開始就開放；notrunner＝登入的人沒登記跑者倍率（預設有）；
     oldself＝機器人還沒有這個功能（/state 不帶 runner_self_signup、/runself 回 404） */
  return { oldbot: has('oldbot'), oldsheet: has('oldsheet'), sheet: '', runPending: false,
    selfrun: has('selfrun'), notrunner: has('notrunner'), oldself: has('oldself') };
})());
const RUNSELF = {};
const R_ALIAS = { u2: ['阿明'], u5: ['Nobita'], u6: ['shizuka'] };
/* 跟機器人的 _slot_runner 一樣：另外指定過（custom／有 user_id／名字跟預設不同）才算 custom，其餘＝車隊預設跑者 */
const slotRunner = (c, sh) => {
  const p = sh && sh.p1;
  if (p && p.name && (p.custom || p.user_id || String(p.name) !== c.p1)) {
    const o = { name: String(p.name), custom: true, bonus: p.bonus || null };
    if (p.user_id === 'me') o.mine = true;               // 跟機器人一樣：只告訴網頁「這格是不是我」，不送別人的 uid
    return o;
  }
  return { name: c.p1, custom: false, bonus: null };
};
/* 跟機器人的 _runner_entry 一樣：uid／名字／別名（再來是前綴、子字串）對得到成員就帶 user_id 與倍率，對不到就當純文字名字；空字串回 null */
const runnerEntry = who => {
  const t = String(who || '').trim(); if (!t) return null;
  const l = t.toLowerCase(), al = x => (R_ALIAS[x.uid] || []).map(a => a.toLowerCase());
  const m = MEMBERS.find(x => x.uid === t) || MEMBERS.find(x => x.name.toLowerCase() === l) || MEMBERS.find(x => al(x).indexOf(l) >= 0)
    || MEMBERS.find(x => x.name.toLowerCase().startsWith(l)) || MEMBERS.find(x => x.name.toLowerCase().indexOf(l) >= 0);
  if (m) return { name: m.name, fixed: true, custom: true, user_id: m.uid, bonus: m.bonus };
  const nm = t.replace(/[\x00-\x1f\x7f<>@#`]/g, '').trim().slice(0, 24);
  return nm ? { name: nm, fixed: true, custom: true } : null;
};

function stateOut(gid, no, role) {
  const c = carOf(gid, no), admin = role === 'admin', sched = admin || role === 'scheduler';
  const tagsOf = (d, h, p) => {
    if (!p) return [];
    const out = [];
    [['shift', c.seatTags[d + '|' + h + '|' + p.user_id] || []], ['member', c.memTags[p.user_id] || []]].forEach(([scope, lst]) => lst.forEach(e => {
      const t = c.pal[e.tag]; if (!t) return; if (t.visibility === 'admin' && !sched) return;
      const r = { tag: e.tag, label: t.label, color: t.color, fg: fg(t.color), detail: e.detail || t.detail || '', scope };
      if (e.until) r.until = e.until; if (admin) { r.vis = t.visibility; r.by = e.by || ''; }
      out.push(r);
    }));
    return out;
  };
  const old = mockR().oldbot;                       // 舊機器人：每一列沒有 p1、最上層沒有 team_mode
  const days = Object.keys(c.sched).sort().map(d => ({ date: d, rows: Object.keys(c.sched[d]).sort().map(h => {
    const sh = c.sched[d][h];
    const row = { hour: h, car_type: sh.car_type, locked: !!sh.locked, manual: false,
      seats: ['p2', 'p3', 'p4', 'p5'].map(p => { const x = sh[p]; const o = { pos: p, name: x ? x.name : null, role: x ? x.role : null, bonus: x ? x.bonus : null, tags: tagsOf(d, h, x) }; if (sched && x) o.fp = 'fp-' + d + h + p + x.user_id; return o; }),
      applicants: sh.applicants.length, waitlist: sh.waitlist.map(w => w.name) };
    if (!old) row.p1 = slotRunner(c, sh);
    return row;
  }) }));
  const me = {};
  Object.keys(c.sched).forEach(d => { const hs = []; Object.keys(c.sched[d]).sort().forEach(h => { const sh = c.sched[d][h];
    const st = ['p2', 'p3', 'p4', 'p5'].find(p => sh[p] && sh[p].user_id === 'me') || null;
    const ap = sh.applicants.some(a => a.user_id === 'me'), wl = sh.waitlist.some(w => w.user_id === 'me');
    if (st || ap || wl) hs.push({ hour: h, seat: st, applied: ap, waitlist: wl, locked: !!sh.locked }); }); if (hs.length) me[d] = hs; });
  const base = { guild: gid === '111' ? '菜根車隊' : '測試車隊', p1: c.p1, today, days };
  if (!old) base.team_mode = !!TEAM[gid];
  if (!old && !mockR().oldself) {
    if (RUNSELF[gid] === undefined) RUNSELF[gid] = !!mockR().selfrun;
    base.runner_self_signup = !!TEAM[gid] && !!RUNSELF[gid];
    base.me_runner = !mockR().notrunner;
  }
  if (!sched) return Object.assign(base, { role: 'member', settings: {}, me });
  return Object.assign(base, { role, settings: { schedule_open: c.open }, me });
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
      discord: (mode === 'admin' || mode === 'sched' || mode === 'member' || mode === 'down' || mode === 'badsig' || mode === 'botold') ? { id: '123', name: '菜根#0001' } : null,
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
    const role0 = mode === 'admin' ? 'admin' : mode === 'sched' ? 'scheduler' : 'member';    // sched＝排班身份組
    if (rest === '/car/me') {
      const g = [{ gid: '111', name: '菜根車隊', role: role0, cars: [{ no: 1, name: '一車' }, { no: 2, name: '二車' }, { no: 3, name: '三車' }] }];
      if (mode === 'admin') g.push({ gid: '222', name: '測試車隊', role: 'member', cars: [{ no: 1, name: '一車' }] });
      return J({ guilds: g });
    }
    const gid = q.get('gid') || body.gid, no = +(q.get('car') || body.car || 1);
    if (!gid) return J({ error: 'missing gid' }, 400);
    const role = gid === '222' ? 'member' : role0, admin = role === 'admin', sched = admin || role === 'scheduler';
    const c = carOf(gid, no);
    /* 各分頁的假後端：每一組只寫在自己的 @@MOCK 標記下面；回傳 Response 就結束，回 undefined 就交給後面的路由。
       可用：rest、m（方法）、q（query）、body、gid、no、role、admin、c（該車資料）、J(obj, status)、MEMBERS */
    /* @@MOCK-R@@ runner（車隊模式：POST /runner、POST /setting team_mode；/run 帶 runner 寫在 A 組的 /run 裡、
       /history 的跑者與任意日期寫在 C 組、/sheet 的雙向同步寫在 F 組） */
    {
      const R = mockR();
      if (rest === '/runner' && m === 'POST') {
        if (R.oldbot) return J({ error: 'bot_not_updated', message: '車隊機器人尚未更新或不支援這個功能' }, 404);
        if (!sched) return J({ error: '此功能僅限管理員', role, need: 'admin' }, 403);
        const { date, hours, runner } = body;
        if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return J({ error: '日期格式須為 YYYY-MM-DD' }, 400);
        if (!Array.isArray(hours) || !hours.length || hours.length > 48 || !hours.every(h => typeof h === 'string' && /^\d{2}:\d{2}$/.test(h))) return J({ error: '時段格式須為 HH:MM 的清單' }, 400);
        if (runner != null && typeof runner !== 'string') return J({ error: '跑者須為文字' }, 400);
        if (typeof runner === 'string' && runner.length > 60) return J({ error: '跑者名稱太長' }, 400);
        if (date < today) return J({ error: date + ' 已過去，歷史班表為唯讀' }, 400);
        const ent = runnerEntry(runner), day = c.sched[date] || {}, done = [], skip = [];
        hours.forEach(h => {
          const sh = day[h];
          if (!sh || !sh.run_planned) { skip.push(h); return; }
          sh.p1 = ent ? Object.assign({}, ent) : { name: c.p1, fixed: true };
          done.push(h);
        });
        if (!done.length) return J({ error: '這些時段都還沒開班，先開班再指定跑者', skip }, 400);
        if (String(runner || '').trim()) TEAM[gid] = true;            // 跟機器人一樣：第一次指定跑者＝開始用車隊模式
        if (R.runPending) { R.runPending = false; return J({ ok: true, pending: true, msg: '跑者還在處理，稍後會自動更新' }); }
        return J({ ok: true, done, skip, name: ent ? ent.name : c.p1, custom: !!String(runner || '').trim() });
      }
      if (rest === '/setting' && m === 'POST' && body.key === 'runner_self_signup') {
        if (!admin) return J({ error: '此功能僅限管理員', role, need: 'admin' }, 403);
        if (R.oldbot || R.oldself) return J({ error: 'bad key' }, 400);
        RUNSELF[gid] = !!body.value;
        if (RUNSELF[gid]) TEAM[gid] = true;                           // 跟機器人一樣：打開它＝一起開車隊模式
        return J({ ok: true, key: 'runner_self_signup', value: RUNSELF[gid] });
      }
      if (rest === '/runself' && m === 'POST') {
        if (R.oldbot || R.oldself) return J({ error: 'bot_not_updated', message: '車隊機器人尚未更新或不支援這個功能' }, 404);
        const { date, hours } = body, act = body.action || 'open';
        if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return J({ error: '日期格式須為 YYYY-MM-DD' }, 400);
        if (!Array.isArray(hours) || !hours.length || hours.length > 48 || !hours.every(h => typeof h === 'string' && /^\d{2}:\d{2}$/.test(h))) return J({ error: '時段格式須為 HH:MM 的清單' }, 400);
        if (act !== 'open' && act !== 'cancel') return J({ error: 'action 只能是 open 或 cancel' }, 400);
        if (date < today) return J({ error: date + ' 已過去，歷史班表為唯讀' }, 400);
        if (R.notrunner) return J({ error: '你還沒登記跑者倍率：Discord 打 %名字 r3.40，QQ 打 /登记 名字 r3.40' }, 403);
        if (!(TEAM[gid] && RUNSELF[gid]) && !admin) return J({ error: '這個車隊沒有開放跑者自行報跑，請找管理員指定' }, 403);
        const day = c.sched[date] || (c.sched[date] = {});
        const meEnt = { name: '我自己', fixed: true, custom: true, user_id: 'me', bonus: 3.4 };
        if (act === 'cancel') {
          const done = []; let cleared = 0;
          hours.forEach(h => { const sh = day[h]; if (!sh || !sh.run_planned || !sh.p1 || sh.p1.user_id !== 'me') return;
            ['p2', 'p3', 'p4', 'p5'].forEach(k => { if (sh[k]) { cleared++; sh[k] = null; } });
            delete day[h]; done.push(h); });
          if (!done.length) return J({ error: '這些時段的跑者不是你' }, 400);
          return J({ ok: true, done, cleared });
        }
        const opened = [], took = [], msgs = [];
        hours.forEach(h => {
          const sh = day[h];
          if (sh && sh.run_planned) {
            const r = slotRunner(c, sh);
            if (r.mine) { msgs.push('本來就是你：' + h); return; }
            if (r.custom) { msgs.push(h + ' 已經有跑者 ' + r.name + '，沒有動'); return; }
            if (['p2', 'p3', 'p4', 'p5'].some(k => sh[k] && sh[k].user_id === 'me') || (sh.applicants || []).some(a => a.user_id === 'me')) { msgs.push(h + ' 你已經報了推手班'); return; }
            sh.p1 = Object.assign({}, meEnt); took.push(h); return;
          }
          day[h] = { car_type: '蝦', p1: Object.assign({}, meEnt), p2: null, p3: null, p4: null, p5: null, applicants: [], waitlist: [], run_planned: true };
          opened.push(h);
        });
        const done = opened.concat(took).sort();
        if (!done.length) return J({ error: msgs.join('；') || '這些時段都沒有動' }, 400);
        return J({ ok: true, done, opened, took, msg: [date + ' ' + done.join('、') + ' 由你開車'].concat(msgs).join('；') });
      }
      if (rest === '/setting' && m === 'POST' && body.key === 'team_mode') {
        if (!admin) return J({ error: '此功能僅限管理員', role, need: 'admin' }, 403);
        if (R.oldbot) return J({ error: 'bad key' }, 400);
        TEAM[gid] = !!body.value;
        return J({ ok: true, key: 'team_mode', value: TEAM[gid] });
      }
    }
    /* ---------- end @@MOCK-R@@ ---------- */
    /* @@MOCK-A@@ sched */
    {
      /* 班表（A 組）：/run、/signup、/swap、/batch（copy／clear_range／lock）、/action（reseat／board）照機器人的行為與回應形狀。
         測試開關（預設全關，關著時不碰 /state、/members，留給其他分頁的假後端）：
           sessionStorage 'sekai-carmockA' 或執行中改 globalThis.__mockA：
             state   /state 加上 manual（手動）、跨日列（昨天 24:00 以後，xday）、cars 清單，日期只留今天以後 7 天
             members /members 回機器人管理員版（uid／aliases／power），支援 ?q=
             auto    成員自助報班直接確認（等同開了 schedule_auto_confirm）；關著＝待管理員確認
             pending 下一次 /action 回 {pending:true}（模擬機器人 12 秒內做不完）
           __mockA.cars = { '111': 2 }：這個車隊只開 2 台車，car=3 的請求回 400 {cars_enabled}（跟 _web_car_mw 一樣）*/
      const A = globalThis.__mockA || (globalThis.__mockA = (() => {
        let f = ''; try { f = sessionStorage.getItem('sekai-carmockA') || ''; } catch (e) {}
        const has = k => f.split(',').indexOf(k) >= 0;
        return { state: has('state'), members: has('members'), auto: has('auto'), pending: has('pending'), cars: {} };
      })());
      const AG = ['/me', '/switch', '/status', '/qqcode', '/music', '/members', '/member', '/tags', '/bridge', '/log', '/seidan', '/seidan/detail'];
      const ne = A.cars && +A.cars[gid];
      if (ne && no > ne && AG.indexOf(rest) < 0) return J({ error: '這個車隊目前只開 ' + ne + ' 台車（car=' + no + ' 不存在）', cars_enabled: ne }, 400);
      const POS = ['p2', 'p3', 'p4', 'p5'];
      const ALIAS = { u2: ['阿明'], u5: ['Nobita'], u6: ['shizuka'] };
      const noAdm = () => J({ error: '此功能僅限管理員', role, need: 'admin' }, 403);
      const guard = (d, f) => { if (!d) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return J({ error: (f || '日期') + '格式須為 YYYY-MM-DD' }, 400); if (String(d) < today) return J({ error: d + ' 已過去，歷史班表為唯讀' }, 400); return null; };
      const findM = nm => { const l = String(nm).toLowerCase(); return MEMBERS.find(x => x.name.toLowerCase() === l || (ALIAS[x.uid] || []).some(a => a.toLowerCase() === l)); };
      const seatIt = (sh, mem, rl) => {       // 假的 refresh_schedule：已在座位就不動；有空位就坐（S6 優先 P2），滿了進候補
        if (POS.some(p => sh[p] && sh[p].user_id === mem.uid)) return;
        const free = rl === 's6' && !sh.p2 ? 'p2' : POS.find(p => !sh[p]);
        if (free) { sh[free] = seat(mem, rl === 's6' && free === 'p2' ? 's6' : 'pusher'); sh.waitlist = (sh.waitlist || []).filter(w => w.user_id !== mem.uid); }
        else if (!(sh.waitlist || []).some(w => w.user_id === mem.uid)) (sh.waitlist = sh.waitlist || []).push({ user_id: mem.uid, name: mem.name });
      };
      if (A.state && !c.aSeed) {            // 跨日列與手動時段的種子資料（只在 state 開關打開時加）
        c.aSeed = 1;
        const yd = addDay(today, -1), by = n => MEMBERS.find(x => x.name === n);
        c.sched[yd] = c.sched[yd] || {};
        ['24:00', '25:00'].forEach((h, i) => { c.sched[yd][h] = { run_planned: true, car_type: '蝦', applicants: [], waitlist: [], p2: seat(by('菜根'), 's6'), p3: seat(by('小明'), 'pusher'), p4: i ? null : seat(by('阿華'), 'pusher'), p5: null }; });
        c.sched[yd]['24:00'].p1 = { name: '大雄', fixed: true, custom: true, user_id: 'u5', bonus: 3.61 };      // R 組：跨日列也有指定跑者（只能看、不能改）
        const t21 = (c.sched[today] || {})['21:00']; if (t21) t21.manual_override = true;
      }
      if (rest === '/state' && A.state) {
        const out = stateOut(gid, no, role), yd = addDay(today, -1);
        out.days.forEach(dy => (dy.rows || []).forEach(r => { const sh = (c.sched[dy.date] || {})[r.hour]; r.manual = !!(sh && sh.manual_override); }));
        const y = out.days.find(dy => dy.date === yd);
        const xr = y ? y.rows.filter(r => r.hour >= '24:00') : [];
        out.days = (xr.length ? [{ date: yd, rows: xr, xday: true }] : []).concat(out.days.filter(dy => dy.date >= today).slice(0, 7));
        if (out.me) Object.keys(out.me).forEach(d => { if (d < today) delete out.me[d]; });
        const n = +(A.cars && A.cars[gid]) || (gid === '222' ? 1 : 3);
        out.cars = [1, 2, 3].slice(0, n).map(k => ({ no: k, name: ['', '一車', '二車', '三車'][k] }));
        out.car = no;
        return J(out);
      }
      if (rest === '/members' && m === 'GET' && A.members) {
        const qq = String(q.get('q') || '').trim().toLowerCase();
        const list = MEMBERS.filter(x => !qq || x.name.toLowerCase().indexOf(qq) >= 0 || (ALIAS[x.uid] || []).some(a => a.toLowerCase().indexOf(qq) >= 0) || (admin && x.uid.indexOf(qq) >= 0))
          .map(x => { const r = { name: x.name, bonus: x.bonus, s6_bonus: x.s6_bonus, identity: '', aliases: (ALIAS[x.uid] || []).slice() }; if (admin) { r.uid = x.uid; r.power = 300000; } return r; })
          .sort((a, b) => (b.bonus - a.bonus) || (a.name < b.name ? -1 : 1));
        return J({ members: list.slice(0, 300), total: list.length });
      }
      if (rest === '/run' && m === 'POST') {
        if (!sched) return noAdm();
        const { date, hour, action } = body;
        if (!(date && hour && (action === 'mark' || action === 'unmark'))) return J({ error: 'bad params' }, 400);
        if (typeof hour !== 'string' || !/^\d{2}:\d{2}$/.test(hour)) return J({ error: '時段格式須為 HH:MM' }, 400);
        const g = guard(date); if (g) return g;
        if (A.pending) { A.pending = false; return J({ ok: true, pending: true, msg: '開班還在處理，稍後會自動更新' }); }
        const day = c.sched[date] || (c.sched[date] = {});
        if (action === 'mark') {
          const sh = day[hour] || (day[hour] = { car_type: '蝦', p2: null, p3: null, p4: null, p5: null, applicants: [], waitlist: [] }); sh.run_planned = true; c.open = true;
          const ent = typeof body.runner === 'string' && body.runner.trim() ? runnerEntry(body.runner) : null;      // R 組：開班順便帶跑者（已經開著的時段也會改）
          if (ent) sh.p1 = ent;
        }
        else delete day[hour];              // 機器人是拿掉 run_planned 並清空；共用的 stateOut 不濾 run_planned，所以這裡直接刪
        return J({ ok: true });
      }
      if (rest === '/swap' && m === 'POST') {
        if (!sched) return noAdm();
        const g = guard(body.date); if (g) return g;
        const sh = (c.sched[body.date] || {})[body.hour];
        if (!sh || POS.indexOf(body.pos) < 0) return J({ error: 'bad target' }, 400);
        const nm = String(body.new || '').trim();
        if (!nm) { sh[body.pos] = null; sh.manual_override = true; return J({ ok: true, cleared: true }); }
        const mm = findM(nm); if (!mm) return J({ error: '找不到成員「' + nm + '」' }, 404);
        const want = String(body.role || '').toLowerCase();
        if (want === 's6' && !(mm.s6_bonus > 0)) return J({ error: mm.name + ' 沒有登記 S6 倍率，無法排 S6' }, 400);
        const rl = want === 's6' ? 's6' : want === 'pusher' ? 'pusher' : (body.pos === 'p2' && mm.s6_bonus > 0 ? 's6' : 'pusher');
        sh[body.pos] = seat(mm, rl); sh.manual_override = true;
        return J({ ok: true, name: mm.name, role: rl });
      }
      if (rest === '/signup' && m === 'POST') {
        let uid = String(body.uid || ''); const act = body.action, rl = body.role || 'pusher';
        if (!sched) { if (uid && uid !== 'me') return J({ error: '只能報自己的班' }, 403); uid = 'me'; }
        if (!body.date || typeof body.date !== 'string') return J({ error: '日期格式須為 YYYY-MM-DD' }, 400);
        const g = guard(body.date); if (g) return g;
        const mem = MEMBERS.find(x => x.uid === uid); if (!mem) return J({ error: '找不到成員' }, 404);
        if (rl === 's6' && !(mem.s6_bonus > 0)) return J({ error: '此成員沒有登記 S6 倍率' }, 400);
        const day = c.sched[body.date] || {}, done = [], skip = [];
        (Array.isArray(body.hours) ? body.hours : []).forEach(h => {
          const sh = day[h];
          if (!sh || !sh.run_planned) { skip.push(h); return; }
          if (!sched && sh.locked && act !== 'cancel') { skip.push(h); return; }
          sh.applicants = sh.applicants || []; sh.waitlist = sh.waitlist || [];
          if (act === 'cancel') {
            const n0 = sh.applicants.length;
            sh.applicants = sh.applicants.filter(a => a.user_id !== uid);
            POS.forEach(p => { if (sh[p] && sh[p].user_id === uid) sh[p] = null; });
            sh.waitlist = sh.waitlist.filter(w => w.user_id !== uid);
            (sh.applicants.length !== n0 ? done : skip).push(h); return;
          }
          const ok = admin || A.auto;
          const a2 = { user_id: uid, name: mem.name, role: rl, status: ok ? 'confirmed' : 'pending' };
          const i = sh.applicants.findIndex(a => a.user_id === uid); if (i < 0) sh.applicants.push(a2); else sh.applicants[i] = a2;
          if (ok) seatIt(sh, mem, rl);
          done.push(h);
        });
        return J({ ok: true, done, skip, name: mem.name });
      }
      if (rest === '/batch' && m === 'POST') {
        if (!sched) return noAdm();
        if (body.action === 'copy') {
          if (!body.to) return J({ error: '目的地格式須為 YYYY-MM-DD' }, 400);
          const g = guard(body.to, '目的地'); if (g) return g;
          const src = c.sched[body.from] || {};
          if (!Object.keys(src).length) return J({ error: body.from + ' 沒有班表' }, 400);
          const dst = c.sched[body.to] || (c.sched[body.to] = {});
          let n = 0;
          Object.keys(src).forEach(h => {
            const s0 = src[h]; if (!s0 || !s0.run_planned) return;
            const nw = { car_type: s0.car_type || '蝦', p2: null, p3: null, p4: null, p5: null, applicants: [], waitlist: [], run_planned: true };
            if (body.with_people) { POS.forEach(p => { if (s0[p]) { nw[p] = Object.assign({}, s0[p]); nw.applicants.push({ user_id: s0[p].user_id, name: s0[p].name, role: s0[p].role, status: 'confirmed' }); } }); nw.manual_override = true; }
            dst[h] = nw; n++;
          });
          return J({ ok: true, msg: '已複製 ' + n + ' 個時段到 ' + body.to + (body.with_people ? '（含人員）' : '（僅開班）') });
        }
        if (body.action === 'clear_range' || body.action === 'lock') {
          const g = guard(body.date); if (g) return g;
          const day = c.sched[body.date] || {}; let n = 0;
          (Array.isArray(body.hours) ? body.hours : []).forEach(h => {
            const sh = day[h]; if (!sh) return;
            if (body.action === 'clear_range') { POS.forEach(p => { sh[p] = null; }); sh.applicants = []; sh.waitlist = []; delete sh.manual_override; sh.locked = false; n++; }
            else if (sh.run_planned) { sh.locked = !!body.value; n++; }
          });
          return J({ ok: true, msg: body.action === 'lock' ? '已' + (body.value ? '鎖定' : '解鎖') + ' ' + n + ' 個時段' : '已清空 ' + n + ' 個時段的人員' });
        }
        return J({ error: 'unknown action' }, 400);
      }
      if (rest === '/action' && m === 'POST' && (body.action === 'reseat' || body.action === 'board')) {
        if (!sched) return noAdm();
        if (A.pending) { A.pending = false; return J({ ok: true, pending: true, msg: body.action === 'board' ? '看板重繪中，完成後頻道裡的看板會自動更新' : '重排補位還在處理，稍後會自動更新' }); }
        if (body.action === 'board') return J({ ok: true, msg: '班表看板已重繪' });
        let n = 0;
        Object.keys(c.sched).forEach(d => {
          if (d < today) return; n++;
          Object.keys(c.sched[d]).forEach(h => { const sh = c.sched[d][h]; (sh.applicants || []).filter(a => a.status === 'confirmed').forEach(a => { const mem = MEMBERS.find(x => x.uid === a.user_id); if (mem) seatIt(sh, mem, a.role); }); });
        });
        return J({ ok: true, msg: '已重排 ' + n + ' 個日期（含卡住的報班補位）' });
      }
    }

    /* ---------- end @@MOCK-A@@ ---------- */
    /* @@MOCK-B@@ members */
    /* 成員名冊 GET /members、成員編輯 POST /member（管理員）、在線人員 GET /online —— 形狀照 engine_omega
       _web_api_members／_web_api_member_edit／_web_api_online（網頁在線照合約 C3：每個請求記下 (gid, 誰) 最後出現時間）。
       名冊是整個車隊共用（不分車），存在 globalThis.__mockB.mem[gid]；在線的「本時段就位」看該車的班表。
       測試開關（sessionStorage）：sekai-carmock-b-big=1 → 名冊多 340 人（超過 300，走機器人端搜尋）；
         sekai-carmock-b-err=members|online → 該 API 回錯誤；sekai-carmock-b-empty=1 → 名冊是空的。 */
    {
      const B = globalThis.__mockB || (globalThis.__mockB = { mem: {}, seen: {} });
      const flag = k => { try { return sessionStorage.getItem('sekai-carmock-b-' + k); } catch (e) { return null; } };
      const pyf = v => Number.isInteger(v) ? v.toFixed(1) : String(v);          // Python 的 f"{float}"
      const memOf = g => {
        if (B.mem[g]) return B.mem[g];
        const ID = { u1: 'pusher+s6', u2: 'pusher+s6', u3: 'runner', u4: 'pusher', u5: '跑推兼任', u6: 'pusher+s6', u7: 'pusher', u8: '', me: 'pusher+s6' };
        const AL = { u1: ['老菜', 'caigen'], u2: ['明明'], u6: ['<i>香香</i>', '靜'], u8: ['<script>alert(1)</script>'], me: ['自己'] };
        const PW = { u1: 402000, u2: 385000, u3: 352000, u4: 330500, u5: 341000, u6: 377000, u7: 298000, u8: 0, me: 360000 };
        const o = {};
        if (!flag('empty')) MEMBERS.forEach(x => { o[x.uid] = { name: x.name, bonus: x.bonus, s6_bonus: x.s6_bonus, identity: ID[x.uid] || '', aliases: (AL[x.uid] || []).slice(), power: PW[x.uid] || 0 }; });
        if (flag('big')) for (let i = 1; i <= 340; i++) o['9' + String(i).padStart(17, '0')] = { name: '路人' + String(i).padStart(3, '0'), bonus: 1.5 + (i % 150) / 100, s6_bonus: 0, identity: 'pusher', aliases: i % 7 ? [] : ['別名' + i], power: 200000 + i * 100 };
        return (B.mem[g] = o);
      };
      const who = mode === 'admin' ? ['u1', '菜根', 'admin'] : mode === 'qq' ? ['qq_abc', 'QQ 玩家', 'member'] : ['me', '我自己', 'member'];
      const PAGE = { '/state': '班表', '/online': '在線人員', '/members': '成員名冊', '/member': '成員名冊', '/insight': '缺額分析', '/history': '歷史班表', '/status': '音樂', '/music': '音樂', '/log': '操作紀錄', '/setting': '設定', '/swap': '排班', '/signup': '報班', '/tags': '標記', '/seattag': '標記' };
      (B.seen[gid] = B.seen[gid] || {})[who[0]] = { name: who[1], role: role === 'admin' ? 'admin' : 'member', t: Date.now(), page: PAGE[rest] || '' };

      if (rest === '/members' && m === 'GET') {
        if (flag('err') === 'members') return J({ error: '讀取成員失敗（模擬）' }, 500);
        const qq = (q.get('q') || '').trim().toLowerCase(), slim = !sched, out = [];
        Object.entries(memOf(gid)).forEach(([uid, x]) => {
          const al = (x.aliases || []).map(a => String(a).toLowerCase());
          if (qq && !String(x.name).toLowerCase().includes(qq) && !al.some(a => a.includes(qq)) && !(!slim && uid.includes(qq))) return;
          const row = { name: x.name, bonus: x.bonus || 0, s6_bonus: x.s6_bonus || 0, identity: x.identity || '', aliases: (x.aliases || []).slice() };
          if (!slim) { row.uid = uid; row.power = x.power || 0; }
          out.push(row);
        });
        out.sort((a, b) => (b.bonus || 0) - (a.bonus || 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        return J({ members: out.slice(0, 300), total: out.length });
      }
      if (rest === '/member' && m === 'POST') {
        if (!admin) return J({ error: '此功能僅限管理員', role, need: 'admin' }, 403);
        const x = memOf(gid)[String(body.uid || '')];
        if (!x) return J({ error: '找不到成員' }, 404);
        const changed = [], num = v => (typeof v === 'number' ? v : (String(v).trim() === '' ? NaN : Number(v)));
        for (const [k, lb] of [['bonus', '倍率'], ['s6_bonus', 'S6倍率']]) {
          if (body[k] != null && String(body[k]) !== '') {
            const v = num(body[k]);
            if (!isFinite(v)) return J({ error: lb + '格式錯誤' }, 400);
            if (v !== 0 && !(v >= 1.18 && v <= 3.88)) return J({ error: lb + '須為 0 或 1.18~3.88' }, 400);
            x[k] = v; changed.push(lb + '=' + pyf(v));
          }
        }
        if (body.power != null && String(body.power) !== '') {
          const p = num(body.power);
          if (!isFinite(p)) return J({ error: '綜合力格式錯誤' }, 400);
          x.power = p < 1000 ? Math.trunc(p * 10000) : Math.trunc(p); changed.push('綜合力=' + x.power);
        }
        if (body.aliases != null) {
          const al = (Array.isArray(body.aliases) ? body.aliases : []).map(a => String(a).trim()).filter(Boolean).slice(0, 10);
          x.aliases = al; changed.push('別名' + al.length + '個');
        }
        if (!changed.length) return J({ error: '沒有變更' }, 400);
        return J({ ok: true, name: x.name, changed: changed.join('、') });
      }
      if (rest === '/online' && m === 'GET') {
        if (flag('err') === 'online') return J({ error: '伺服器不在線' }, 503);
        const mem = memOf(gid), crew = uid => (mem[uid] || {}).name || null, slim = !sched;
        const now = new Date(), hk = String(now.getHours()).padStart(2, '0') + ':00';
        // 1) 語音（整個車隊共用；222 當成沒人在語音的車隊）
        const VC = gid === '111' ? [
          ['推車語音 1', '900000000000000001', [['u1', '菜根', { stream: true }], ['u2', '小明', { mute: true }], ['u8', '<b>小夫</b>', {}], ['x1', '路過的人', {}]]],
          ['<img src=x onerror=alert(1)>', '900000000000000002', [['u6', '靜香', { mute: true, deaf: true }]]],
        ] : [];
        const inVoice = {};
        const voice = VC.map(([ch, id, ppl]) => ({ channel: ch, id, count: ppl.length, members: ppl.map(([uid, disp, f]) => {
          inVoice[uid] = ch;
          const r = { name: crew(uid) || disp, display: disp === '菜根' ? '菜根 (Discord)' : disp, crew: !!crew(uid), mute: !!f.mute, deaf: !!f.deaf, stream: !!f.stream };
          if (!slim) r.uid = uid; return r;
        }).sort((a, b) => (a.crew === b.crew ? (a.name < b.name ? -1 : 1) : a.crew ? -1 : 1)) })).sort((a, b) => b.count - a.count);
        // 2) 本時段就位（跟車走）：這一車現在這個小時有開班就照班表；一車沒有就假造一班，方便測畫面
        let sh = (c.sched[today] || {})[hk];
        if (!sh && gid === '111' && no === 1) {
          const by = n => { const e = Object.entries(mem).find(([, v]) => v.name === n); return e ? { user_id: e[0], name: e[1].name, role: 'pusher', bonus: e[1].bonus } : null; };
          sh = { run_planned: true, p2: Object.assign(by('菜根') || {}, { role: 's6' }), p3: by('小明'), p4: null, p5: by('<b>小夫</b>') };
          if (!sh.p2.user_id) sh.p2 = null;
        }
        const checked = new Set(['u1', 'u8']);
        const onduty = [];
        if (sh && sh.run_planned) ['p2', 'p3', 'p4', 'p5'].forEach(pp => {
          const p = sh[pp];
          if (!p) { onduty.push({ pos: pp.toUpperCase(), name: null }); return; }
          const uid = String(p.user_id || '');
          onduty.push({ pos: pp.toUpperCase(), name: p.name, role: p.role, bonus: p.bonus, voice: inVoice[uid] || null, checked: checked.has(uid) });
        });
        // 3) Discord 在線（222 當成沒開 presences intent）
        const presence = gid === '111' ? { online: ['小明', '菜根'], idle: ['阿華'], dnd: [] } : null;
        // 4) 網頁在線（合約 C3：網站的簽章請求也算；10 分鐘內，同一人只算一次）
        const nowTs = Date.now(), seen = Object.assign({}, B.seen[gid] || {});
        if (gid === '111') { seen.u2 = seen.u2 || { name: '小明', role: 'member', t: nowTs - 250000, page: '班表' }; seen.u8 = seen.u8 || { name: '<b>小夫</b>', role: 'member', t: nowTs - 30000, page: '' }; }
        const web = Object.entries(seen).filter(([, s]) => nowTs - s.t <= 600000)
          .map(([uid, s]) => { const r = { name: crew(uid) || s.name || '?', role: s.role || 'member', ago: Math.floor((nowTs - s.t) / 1000), page: s.page || '' }; if (!slim) r.uid = uid; return r; })
          .sort((a, b) => a.ago - b.ago);
        return J({ voice, voice_total: voice.reduce((a, v) => a + v.count, 0), web, web_total: web.length, onduty, hour: hk,
          run_planned: !!(sh && sh.run_planned), presence, presence_available: !!presence, crew_total: Object.keys(mem).length });
      }
    }
    /* ---------- end @@MOCK-B@@ ---------- */
    /* @@MOCK-C@@ stats */
    {
      /* 統計分頁：/insight、/history（每車）與 /seidan、/seidan/detail（整個車隊共用）。形狀照 engine_omega 的
         _web_api_insight／_web_api_history／_web_api_seidan*。測試開關（在頁面的 console 設）：
           globalThis.__mockC.fail = {'/insight': 500}   讓某條 GET 失敗
           globalThis.__mockC.liveOff = true             /seidan live=1 讀不到即時榜（live_ok:false）
           globalThis.__mockC.liveErr = true             /seidan live=1 整個請求 504（Worker 逾時） */
      const MC = globalThis.__mockC || (globalThis.__mockC = { arch: {}, sei: {} });
      const p2 = n => String(n).padStart(2, '0');
      const iso = ms => { const d = new Date(ms); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()); };
      const DRE = /^\d{4}-\d{2}-\d{2}$/, HRE = /^\d{2}:\d{2}$/;
      const failSt = MC.fail && MC.fail[rest];
      if (failSt && m === 'GET') return J(failSt === 404 ? { error: 'not_found' } : { error: 'mock_fail: ' + rest }, failSt);
      /* 封存班表（schedule_archive）：拿這台車今天的時段，往前做 5 天、分兩期 */
      const archOf = () => {
        const k = gid + ':' + no;
        if (MC.arch[k]) return MC.arch[k];
        const hs = Object.keys(c.sched[today] || {}).filter(h => HRE.test(h)), ar = {};
        const who = [['菜根', '小明', '阿華', '小美'], ['小明', '大雄', '靜香', null], ['<b>小夫</b>', '胖虎', null, '我自己']];
        [1, 2, 3, 4, 5].forEach(n => {
          if (!hs.length) return;
          const ev = n <= 2 ? '143' : '142', d = addDay(today, -n), day = {};
          hs.forEach((h, i) => {
            const ppl = who[(n + i) % who.length];
            const sh = { car_type: '蝦', run_planned: true, locked: n === 1 && i === 0, manual_override: n === 2 && i === 1, applicants: i === 0 ? [{ user_id: 'u9', name: '路人' }] : [], waitlist: i === 1 ? [{ name: '胖虎' }] : [] };
            /* R 組：封存的班表也留著跑者（昨天第一個時段是另外指定的跑者，其餘是當時的預設跑者；前天第二個時段故意不留 → 前端退回預設跑者） */
            if (!(n === 2 && i === 1)) sh.p1 = n === 1 && i === 0 ? { name: '靜香', user_id: 'u6', bonus: 3.8, fixed: true, custom: true } : { name: c.p1, fixed: true, custom: false };
            ['p2', 'p3', 'p4', 'p5'].forEach((p, j) => { const mm = MEMBERS.find(x => x.name === ppl[j]); sh[p] = mm ? { name: mm.name, bonus: j === 0 && mm.s6_bonus ? mm.s6_bonus : mm.bonus, role: j === 0 && mm.s6_bonus ? 's6' : 'pusher', user_id: mm.uid } : null; });
            day[h] = sh;
          });
          ((ar[ev] = ar[ev] || { saved_at: iso(Date.now()), schedule: {} }).schedule)[d] = day;
        });
        return (MC.arch[k] = ar);
      };
      if (rest === '/insight' && m === 'GET') {
        const sched = c.sched || {}, dates = Object.keys(sched).filter(d => d >= today).sort().slice(0, 7);
        const shortage = [], counts = {}; let total = 0, filled = 0;
        dates.forEach(d => Object.keys(sched[d]).sort().forEach(h => {
          const sh = sched[d][h] || {}; if (!sh.run_planned) return;
          const lack = []; let s6 = false;
          ['p2', 'p3', 'p4', 'p5'].forEach(p => { const x = sh[p]; total++;
            if (x && typeof x === 'object') { filled++; if (x.name) counts[x.name] = (counts[x.name] || 0) + 1; if (x.role === 's6') s6 = true; } else lack.push(p.toUpperCase()); });
          if (lack.length) shortage.push({ date: d, hour: h, lack, no_s6: !s6, waitlist: (sh.waitlist || []).map(w => String((w || {}).name || '')) });
        }));
        const rank = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, count]) => ({ name, count }));
        return J({ dates, total_slots: total, filled, rate: total ? Math.round(filled / total * 100) : 0, shortage: shortage.slice(0, 40), rank });
      }
      if (rest === '/history' && m === 'GET') {
        const sched = c.sched || {}, ar = archOf(), d = q.get('date') || '';
        if (!d || q.get('dates')) {
          const idx = [];
          Object.keys(sched).filter(x => DRE.test(x)).sort().forEach(dd => {
            const n = Object.values(sched[dd] || {}).filter(s => s && typeof s === 'object' && (s.run_planned || s.p2 || (s.applicants || []).length)).length;
            if (n) idx.push({ date: dd, hours: n, past: dd < today, src: 'live' });
          });
          Object.keys(ar).sort().reverse().forEach(ev => Object.keys(ar[ev].schedule || {}).sort().forEach(dd => {
            if (!idx.some(x => x.date === dd)) idx.push({ date: dd, hours: Object.keys(ar[ev].schedule[dd]).length, past: true, src: 'archive' });
          }));
          idx.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
          return J({ dates: idx, today, oldest: idx.length ? idx[idx.length - 1].date : '' });
        }
        if (!DRE.test(d)) return J({ error: '日期格式須為 YYYY-MM-DD' }, 400);
        let raw = sched[d] && Object.keys(sched[d]).length ? sched[d] : null, src = 'live';
        if (!raw) for (const ev of Object.keys(ar).sort().reverse()) { const cand = (ar[ev].schedule || {})[d]; if (cand) { raw = cand; src = 'archive:' + ev; break; } }
        /* R 組：任何日期都能查。30 天前那一天是「第 178 期封存」裡的班表，但故意不放進日期索引
           （機器人的索引有 30 秒快取，也可能剛換期）→ 測「清單裡沒有的日期，用日期欄一樣查得到」 */
        if (!raw && d === addDay(today, -30) && gid === '111' && no === 1) {           // 只有一車有（歷史班表是每車各自的）
          const mk = (nm, rl) => { const mm = MEMBERS.find(x => x.name === nm); return mm ? { name: mm.name, bonus: rl === 's6' ? mm.s6_bonus : mm.bonus, role: rl, user_id: mm.uid } : null; };
          raw = { '20:00': { car_type: '蝦', run_planned: true, p1: { name: '阿華', user_id: 'u3', bonus: 3.72, fixed: true, custom: true }, p2: mk('菜根', 's6'), p3: mk('小明', 'pusher'), p4: mk('<b>小夫</b>', 'pusher'), p5: null, applicants: [], waitlist: [] },
            '21:00': { car_type: '蝦', run_planned: true, p1: { name: '老跑者', fixed: true, custom: false }, p2: mk('靜香', 's6'), p3: null, p4: null, p5: mk('大雄', 'pusher'), applicants: [], waitlist: [{ name: '胖虎' }] } };
          src = 'archive:178';
        }
        if (!raw) return J({ date: d, rows: [], src: 'none', readonly: true, note: '這天沒有留下班表資料' });
        const rows = Object.keys(raw).filter(h => HRE.test(h)).sort().map(h => { const sh = raw[h] || {};
          const row = { hour: h, car_type: sh.car_type || '蝦', locked: !!sh.locked, manual: !!sh.manual_override,
            seats: ['p2', 'p3', 'p4', 'p5'].map(p => { const x = sh[p]; return { pos: p, name: x ? x.name : null, role: x ? x.role : null, bonus: x ? x.bonus : null }; }),
            applicants: (sh.applicants || []).filter(a => a && typeof a === 'object').length,
            waitlist: (sh.waitlist || []).filter(w => w && typeof w === 'object').map(w => w.name) };
          if (sh.p1 && sh.p1.name && !mockR().oldbot) row.p1 = { name: String(sh.p1.name), bonus: sh.p1.bonus || null };     // 跟 _web_hist_rows 一樣：那一格有存跑者才帶
          return row; });
        return J({ date: d, rows, src, readonly: true, past: d < today });
      }
      /* 色段監控：bot_data.seidan[gid]，'111' 有三位（一位停用、一位不在前百），'222' 沒設定 */
      if (rest === '/seidan' || rest === '/seidan/detail') {
        const now = Date.now();
        if (!MC.board) {           /* 假的活動前百榜 */
          MC.board = Array.from({ length: 100 }, (_, i) => ({ rank: i + 1, name: i === 34 ? '<i>路人</i>' : '玩家' + (i + 1), score: 52000000 - i * 185000 - (i * 7919 % 50000),
            last_score: 0, speed_1h: 1500000 - i * 9000, count_1h: 22 - (i % 7), speed_3h: 1400000 - i * 8000, speed_24h: 1100000 - i * 6000, last_played_at: iso(now - (i % 9) * 60000), player_id: 'x' + i }));
          MC.board.forEach(r => { r.last_score = r.score - 70000; });
        }
        if (!MC.sei['111']) {
          const mk = (pid, o) => {
            const rl = [], snaps = [], tLast = now - o.idle * 1000;
            const gaps = Array.from({ length: o.n }, (_, i) => (i ? o.gap + (i * 37 % 23) - 11 : 0));
            let t = tLast - gaps.reduce((a, b) => a + b, 0) * 1000, score = 0;
            for (let i = 0; i < o.n; i++) {
              const gap = gaps[i], diff = o.ep + (i * 7919 % 9000) - 4500;
              t += gap * 1000; score += diff;
              rl.push({ ms: t, time: iso(t), score, diff, gap_sec: gap });
              if (i % 4 === 0) snaps.push({ time: iso(t), score });
            }
            const row = o.rank ? MC.board[o.rank - 1] : null, target = row ? row.score : 9000000 + o.n * 1000;
            const off = target - score; rl.forEach(r => { r.score += off; }); snaps.forEach(x => { x.score += off; });
            if (row) row.player_id = pid;
            return Object.assign({ enabled: true, player_id: pid, channel_id: '1100000000000000001', admin_role_id: '1200000000000000002', nickname: '', player_name: '',
              thresh: 60000, last_score: target, last_fetch_time: iso(now - 30000), last_change_time: rl.length ? rl[rl.length - 1].time : '', round_log: rl, snapshot_log: snaps,
              mode: 'unknown', window_start: iso(now - 3 * 3600000), window_rounds: 12, alerted_stale: false, alerted_slow: false, alerted_doosen: false, alerted_pt: false, alerted_poor_form: false,
              last_stale_alert_time: '', peak_round_ep: Math.max.apply(null, rl.map(r => r.diff).concat([0])), poor_form_hours: 3, poor_form_ratio: 0.95, poor_form_dm: false, poor_form_public: true, poor_form_dm_uid: '',
              auto_stale_trigger: 3, auto_stale_repeat: 5, source: 'hisekai' }, o.cfg || {});
          };
          MC.sei['111'] = {
            _default_pid: '5823749102938475',
            '5823749102938475': mk('5823749102938475', { n: 420, gap: 110, ep: 72000, idle: 45, rank: 37, cfg: { nickname: '跑者A', player_name: 'Runner_A', mode: 'multi' } }),
            '7300000000000000001': mk('7300000000000000001', { n: 60, gap: 130, ep: 41000, idle: 1500, rank: 52, cfg: { player_name: '<b>小夫</b>', mode: 'auto', alerted_stale: true, alerted_poor_form: true, poor_form_dm: true, poor_form_dm_uid: '998877665544332211' } }),
            '1234567890': mk('1234567890', { n: 5, gap: 200, ep: 30000, idle: 7200, rank: 0, cfg: { nickname: '三號', player_name: 'Player3', enabled: false, auto_stale_trigger: 0, auto_stale_repeat: 0 } }),
          };
        }
        const sd = MC.sei[gid] || (MC.sei[gid] = {});
        const statsOf = s => {
          const rl = s.round_log || [], recent = [], diffs = [], gaps = [], hourly = {}, sum = a => a.reduce((x, y) => x + y, 0);
          rl.forEach(r => { const d = r.diff || 0; if (d) diffs.push(d); if (r.gap_sec) gaps.push(r.gap_sec); const age = (now - r.ms) / 1000;
            if (age <= 3600) recent.push(r); if (age <= 86400) { const hh = p2(new Date(r.ms).getHours()); hourly[hh] = (hourly[hh] || 0) + d; } });
          const last = rl.length ? rl[rl.length - 1] : null, idle = last ? Math.floor((now - last.ms) / 1000) : null;
          const g10 = gaps.slice(-10), gapAvg = g10.length ? Math.round(sum(g10) / g10.length) : 0, d10 = diffs.slice(-10);
          const lim = Math.floor(Math.max(300, Math.min(900, (gapAvg || 300) * 2.5)));
          return { rounds: rl.length, recent_1h: recent.length, avg10: d10.length ? Math.round(sum(d10) / d10.length) : 0, avg_all: diffs.length ? Math.round(sum(diffs) / diffs.length) : 0,
            best: diffs.length ? Math.max.apply(null, diffs) : 0, worst: diffs.length ? Math.min.apply(null, diffs) : 0, speed_log_1h: sum(recent.map(r => r.diff || 0)),
            gap_avg: gapAvg, gap_last: gaps.length ? gaps[gaps.length - 1] : 0, idle, idle_limit: lim, stopped: idle != null && idle > lim,
            trend: rl.slice(-30).map(r => r.diff || 0), hourly: Object.keys(hourly).sort().map(h => ({ h, v: hourly[h] })),
            first_time: rl.length ? rl[0].time : '', last_time: last ? last.time : '' };
        };
        const nbOf = (rank, span) => { const i = MC.board.findIndex(r => r.rank === rank); if (i < 0) return [];
          const me = MC.board[i].score; return MC.board.slice(Math.max(0, i - span), i + span + 1).map(r => ({ rank: r.rank, name: r.name, score: r.score, speed_1h: r.speed_1h, diff: r.score - me, me: r.rank === rank })); };
        const lvOf = pid => MC.board.find(r => r.player_id === pid) || null;
        const wantLive = rest === '/seidan/detail' || q.get('live') !== '0';
        if (m === 'GET' && wantLive) {
          await new Promise(r => setTimeout(r, rest === '/seidan' ? 900 : 500));      // 機器人要先抓 HiSekai 前百（最多 15 秒）
          if (MC.liveErr) return J({ error: 'bot_unreachable', message: '車隊機器人目前連不上，請稍後再試' }, 504);
        }
        const liveOk = wantLive && !MC.liveOff;
        const nameOf = (pid, s) => s.nickname || s.player_name || String(s.player_id || pid);
        if (rest === '/seidan' && m === 'GET') {
          const players = Object.keys(sd).filter(pid => pid[0] !== '_' && sd[pid] && typeof sd[pid] === 'object').map(pid => {
            const s = sd[pid], real = String(s.player_id || pid), lv = liveOk ? lvOf(real) : null;
            const it = Object.assign({ pid, player_id: real, name: nameOf(pid, s), player_name: s.player_name || '', nickname: s.nickname || '', source: s.source || '', mode: s.mode || '',
              enabled: !!s.enabled, thresh: s.thresh, window_rounds: s.window_rounds || 0, window_start: s.window_start || '',
              channel_id: String(s.channel_id || ''), admin_role_id: String(s.admin_role_id || ''),
              auto_stale_trigger: s.auto_stale_trigger || 0, auto_stale_repeat: s.auto_stale_repeat || 0,
              poor_form_hours: s.poor_form_hours || 0, poor_form_ratio: s.poor_form_ratio || 0, poor_form_dm: !!s.poor_form_dm, poor_form_public: !!s.poor_form_public,
              poor_form_dm_uid: String(s.poor_form_dm_uid || ''), last_score: s.last_score || 0, peak_round_ep: s.peak_round_ep || 0,
              last_fetch_time: s.last_fetch_time || '', last_change_time: s.last_change_time || '', last_stale_alert_time: s.last_stale_alert_time || '',
              alerts: { alerted_doosen: !!s.alerted_doosen, alerted_slow: !!s.alerted_slow, alerted_stale: !!s.alerted_stale, alerted_pt: !!s.alerted_pt, alerted_poor_form: !!s.alerted_poor_form },
              snapshots: (s.snapshot_log || []).length }, statsOf(s));
            it.live = lv ? { rank: lv.rank, score: lv.score, last_score: lv.last_score, speed_1h: lv.speed_1h, count_1h: lv.count_1h, speed_3h: lv.speed_3h, speed_24h: lv.speed_24h, last_played_at: lv.last_played_at, neighbors: nbOf(lv.rank, 3) } : null;
            if (!admin) { delete it.channel_id; delete it.admin_role_id; delete it.poor_form_dm_uid; }    // 合約 C5：成員看不到 Discord id
            return it;
          });
          players.sort((a, b) => ((a.live ? -a.live.score : 0) - (b.live ? -b.live.score : 0)) || ((b.last_score || 0) - (a.last_score || 0)));
          return J({ players, event: liveOk ? '第 142 期 · 夏日祭典' : '', live_ok: liveOk, top: liveOk ? MC.board.slice(0, 20) : [] });
        }
        if (rest === '/seidan/detail' && m === 'GET') {
          const pid = q.get('pid') || '', s = sd[pid];
          if (!s || typeof s !== 'object' || pid[0] === '_') return J({ error: '找不到監控對象' }, 404);
          let limit = parseInt(q.get('limit') || '120', 10), offset = parseInt(q.get('offset') || '0', 10);
          if (isNaN(limit) || isNaN(offset)) { limit = 120; offset = 0; }
          limit = Math.max(1, Math.min(500, limit)); offset = Math.max(0, offset);
          const rl = (s.round_log || []).slice().reverse(), real = String(s.player_id || pid), lv = liveOk ? lvOf(real) : null;
          const snaps = (s.snapshot_log || []).slice().reverse();
          const out = { pid, player_id: real, name: nameOf(pid, s), stats: statsOf(s), rounds: rl.slice(offset, offset + limit).map(r => ({ time: r.time, score: r.score, diff: r.diff, gap_sec: r.gap_sec })),
            total_rounds: rl.length, offset, limit, snapshots: snaps.slice(0, 200), total_snapshots: snaps.length,
            live: lv ? { rank: lv.rank, score: lv.score, speed_1h: lv.speed_1h, speed_3h: lv.speed_3h, speed_24h: lv.speed_24h, last_played_at: lv.last_played_at, neighbors: nbOf(lv.rank, 5) } : null,
            event: liveOk ? '第 142 期 · 夏日祭典' : '' };
          if (admin) { const raw = {}; Object.keys(s).forEach(k => { if (k !== 'round_log' && k !== 'snapshot_log') raw[k] = s[k]; }); out.raw = raw; }   // 合約 C5
          return J(out);
        }
        if (rest === '/seidan' && m === 'POST') {
          if (!admin) return J({ error: '此功能僅限管理員', role, need: 'admin' }, 403);
          const pid = String(body.pid || ''), s = sd[pid];
          if (!s || typeof s !== 'object' || pid[0] === '_') return J({ error: '找不到監控對象' }, 404);
          if (body.action === 'toggle') { s.enabled = !s.enabled; return J({ ok: true, enabled: s.enabled }); }
          if (body.action === 'field') {
            const kind = { thresh: 'int', window_rounds: 'int', auto_stale_trigger: 'int', auto_stale_repeat: 'int', poor_form_hours: 'int', poor_form_ratio: 'float', poor_form_dm: 'bool', poor_form_public: 'bool', nickname: 'str', mode: 'str' }[body.key];
            if (!kind) return J({ error: '不可修改的欄位' }, 400);
            let v = body.value;
            if (kind === 'int' || kind === 'float') {      // Python int()／float()：數字或數字字串；int('1.5') 會失敗
              const str = typeof v === 'string' ? v.trim() : v;
              const okN = typeof str === 'number' || typeof str === 'boolean' || (typeof str === 'string' && (kind === 'int' ? /^[+-]?\d+$/ : /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/).test(str));
              if (!okN || (typeof str === 'number' && !isFinite(str))) return J({ error: '值的格式不對' }, 400);
              v = kind === 'int' ? Math.trunc(Number(str)) : Number(str);
            } else if (kind === 'bool') v = !!v && v !== 0 && v !== '';
            else v = v == null ? 'None' : String(v);
            if (body.key === 'poor_form_ratio') v = Math.max(0, Math.min(2, v));
            else if (kind === 'int') v = Math.max(0, v);
            else if (body.key === 'mode' && v !== 'single' && v !== 'multi') return J({ error: '模式只能是 single 或 multi' }, 400);
            s[body.key] = v;
            return J({ ok: true, key: body.key, value: v });
          }
          if (body.action === 'clear_alerts') { ['alerted_doosen', 'alerted_slow', 'alerted_stale', 'alerted_pt', 'alerted_poor_form'].forEach(k => { s[k] = false; }); return J({ ok: true }); }
          return J({ error: 'unknown action' }, 400);
        }
      }
    }
    /* ---------- end @@MOCK-C@@ ---------- */
    /* @@MOCK-D@@ music */
    /* 照 engine_omega _web_api_status／_web_api_music：/status 成員拿精簡版（member_view），/music 成員只能 search／play（403）、
       每人最多 3 首排隊（429）；整個車隊共用一份（不分車）。111 正在播＋佇列（含 XSS 探針），222 沒進語音、空佇列。
       測試用關鍵字：搜尋 fail＝500、none＝0 筆、slow＝一直 pending、slow1＝第一次 pending 第二次有結果；
       點播網址含 slow（或清單網址含 slow）＝回 pending、2.5 秒後才真的加入；非 YouTube 網址＝解析失敗 500。
       auto 在機器人還沒進語音但有常駐頻道時回 pending（模擬連語音很久）。 */
    if (rest === '/status' || rest === '/music') {
      const MD = (globalThis.__mockD = globalThis.__mockD || { g: {}, titles: {}, slow1: 0 });
      const GN = { v: 'Vocaloid', a: '動漫曲', c: '中文抒情', e: '英文流行', j: '日文流行' };
      const guildName = gid === '111' ? '菜根車隊' : '測試車隊';
      const tr = (title, duration, requester) => ({ title, duration, requester });
      const S = MD.g[gid] || (MD.g[gid] = gid === '111'
        ? { online: true, vc: '語音大廳', home: true, mix: false, vol: 100, auto: null, paused: false,
            now: Object.assign(tr('DECO*27 - ヴァンパイア feat. 初音ミク', 222, '網頁'), { pos0: 64, t0: Date.now() }),
            queue: [tr('YOASOBI「アイドル」Official Music Video', 214, '小明'), tr('<b>小夫</b> 的 <img src=x onerror=alert(1)> 點歌', 185, '<b>小夫</b>'),
              tr('Ado - 唱（直播版）', 0, '網頁'), tr('米津玄師 - KICK BACK', 193, '我自己'),
              tr('一首很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長的歌名', 3725, '阿華')] }
        : { online: true, vc: '', home: false, mix: false, vol: 80, auto: null, paused: false, now: null, queue: [] });
      const posOf = () => S.now ? Math.min(S.now.duration || 1e9, Math.floor(S.now.pos0 + (S.paused ? 0 : (Date.now() - S.now.t0) / 1000))) : 0;
      const next = () => {
        S.paused = false;
        if (S.queue.length) S.now = Object.assign(S.queue.shift(), { pos0: 0, t0: Date.now() });
        else if (S.auto && S.vc) S.now = Object.assign(tr(GN[S.auto] + ' 自動選曲 ' + (Math.random() * 100 | 0), 240, '自動歌單'), { pos0: 0, t0: Date.now() });
        else S.now = null;
      };
      if (rest === '/status') {
        if (m !== 'GET') return J({ error: 'method_not_allowed' }, 405);
        if (S.now && S.now.duration && posOf() >= S.now.duration) next();   // 播完換下一首
        const played = S.now ? { title: S.now.title, duration: S.now.duration, pos: posOf(), requester: S.now.requester } : null;
        const qv = S.queue.slice(0, 15).map(t => ({ title: t.title, duration: t.duration, requester: t.requester }));
        if (!admin) return J({ online: S.online, voice_connected: !!S.vc, voice_channel: S.vc || null, playing: played, queue_len: S.queue.length, queue: qv, member_view: true });
        return J({ online: S.online, voice_connected: !!S.vc, voice_channel: S.vc || null, voice_home: S.home, mix: S.mix, volume: S.vol, auto_genre: S.auto,
          playing: played, queue: qv, queue_len: S.queue.length, gemini_keys: 2, openai: false, latency: S.vc ? 42 : null });
      }
      if (m !== 'POST') return J({ error: 'method_not_allowed' }, 405);
      const a = body.action, who = admin ? '網頁' : '我自己';
      if (!admin && a !== 'search' && a !== 'play') return J({ error: '播放控制僅限管理員，你可以搜尋與點歌' }, 403);
      if (a === 'search') {
        const qs = String(body.query || '').trim();
        if (!qs) return J({ error: '請輸入搜尋關鍵字' }, 400);
        if (qs === 'fail') return J({ error: '搜尋失敗 ERROR: [youtube] HTTP Error 429: Too Many Requests' }, 500);
        if (qs === 'slow') return J({ ok: true, pending: true, msg: '搜尋比較久，機器人還在找' });
        if (qs === 'slow1' && (MD.slow1++ % 2 === 0)) return J({ ok: true, pending: true, msg: '搜尋比較久，機器人還在找' });
        if (qs === 'none') return J({ ok: true, results: [], query: qs });
        const n = Math.max(1, Math.min(20, parseInt(body.n, 10) || 12));
        const ids = ['dQw4w9WgXcQ', 'kJQP7kiw5Fk', '9bZkp7q19f0', 'e-ORhEE9VVg', 'OPf0YbXqDm0'];
        const results = Array.from({ length: n }, (_, i) => {
          const id = ids[i % ids.length], url = 'https://www.youtube.com/watch?v=' + id + (i >= ids.length ? '&t=' + i : '');
          const title = i === 1 ? '<b>小夫</b> 翻唱 <img src=x onerror=alert(1)> ' + qs
            : qs + ' 搜尋結果 ' + (i + 1) + (i === 5 ? '（非常長的標題會自動換行而且最多顯示兩行，超過的部分要被截掉，才不會把整個版面撐開或讓手機出現橫向捲動）' : '');
          MD.titles[url] = title;
          return { title, url, duration: i === 2 ? 0 : 150 + i * 37, uploader: i === 1 ? '<b>小夫</b>' : 'Channel ' + (i + 1), views: [1234, 56789, 123456789, 0, 98765432][i % 5],
            thumb: i === 3 ? 'javascript:alert(1)' : i === 4 ? '' : i === 6 ? 'http://i.ytimg.com/vi/' + id + '/mqdefault.jpg' : 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg' };
        });
        return J({ ok: true, results, query: qs });
      }
      if (a === 'play') {
        const qs = String(body.query || '').trim();
        if (!qs) return J({ error: 'empty' }, 400);
        const mine = S.queue.filter(t => String(t.requester || '').startsWith(who)).length;
        if (!admin && mine >= 3) return J({ error: '你已經有 ' + mine + ' 首在佇列中（每人上限 3 首），等播完再點' }, 429);
        if (/^https?:\/\//i.test(qs) && !/^https?:\/\/([a-z0-9-]+\.)?(youtube\.com|youtu\.be)\//i.test(qs)) return J({ error: '解析失敗 ERROR: Unsupported URL: ' + qs.slice(0, 40) }, 500);
        if (!S.vc && S.home) S.vc = '語音大廳';   // 連線順序：現有連線 → 常駐頻道 →（點歌者所在頻道，假後端沒有）
        const add = list => { S.queue.push(...list); if (!S.now && S.vc) next(); };
        if (/list=/.test(qs) && /:\/\//.test(qs)) {
          const list = [1, 2, 3, 4].map(k => tr('Mock 播放清單 第 ' + k + ' 首', 200 + k * 11, who));
          if (/slow/i.test(qs)) { setTimeout(() => add(list), 2500); return J({ ok: true, pending: true, msg: '播放清單比較長，機器人背景解析中，完成後會自動加入佇列' }); }
          add(list);
          return J({ ok: true, added: list.length, title: 'Mock 播放清單', queued_only: !S.vc, guild: guildName, vc: S.vc || '' });
        }
        const title = MD.titles[qs] || (/^https?:\/\//i.test(qs) ? 'YouTube 影片 ' + qs.slice(-11) : qs + '（第一筆搜尋結果）');
        const t = tr(title, 201, who);
        if (/slow/i.test(qs)) { setTimeout(() => add([t]), 2500); return J({ ok: true, pending: true, msg: '機器人還在解析這首歌，完成後會自動加入佇列' }); }
        add([t]);
        return J({ ok: true, added: 1, title, queued_only: !S.vc, guild: guildName, vc: S.vc || '' });
      }
      if (a === 'auto') {
        if (!GN[body.genre]) return J({ error: 'bad genre' }, 400);
        if (!S.vc && !S.home) return J({ error: '機器人不在語音頻道。先進語音頻道再用 /語音 播放，或設定 /頻道 語音常駐 讓它常駐' }, 400);
        S.auto = body.genre;
        if (!S.vc) { setTimeout(() => { S.vc = '語音大廳'; if (!S.now) next(); }, 2500); return J({ ok: true, pending: true, msg: '機器人正在進語音頻道，自動歌單稍後開始' }); }
        if (!S.now) next();
        return J({ ok: true, genre: GN[body.genre] });
      }
      if (a === 'skip') { next(); return J({ ok: true }); }
      if (a === 'stop') { S.auto = null; S.queue = []; S.now = null; S.paused = false; return J({ ok: true }); }
      if (a === 'pause') {
        if (!S.vc || !S.now) return J({ error: '沒在播' }, 400);
        if (S.paused) { S.now.t0 = Date.now(); S.paused = false; return J({ ok: true, state: 'resumed' }); }
        S.now.pos0 = posOf(); S.paused = true; return J({ ok: true, state: 'paused' });
      }
      if (a === 'volume') { const v = parseInt(body.value == null ? 100 : body.value, 10); if (!isFinite(v)) return J({ error: 'bad value' }, 400); S.vol = Math.max(5, Math.min(200, v)); return J({ ok: true, volume: S.vol }); }
      if (a === 'mix') { S.mix = !S.mix; return J({ ok: true, mix: S.mix }); }
      if (a === 'leave') { S.home = false; S.auto = null; S.queue = []; S.now = null; S.vc = ''; S.paused = false; return J({ ok: true }); }
      return J({ error: 'unknown action' }, 400);
    }
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
    {
      /* 設定／紀錄／系統的假後端：形狀照 engine_omega 的 /api/state（管理員版設定目錄）、/api/setting、/api/log、/api/status、
         /api/action、/api/sheet、/api/run、/api/music（play／stop／skip／volume）。權限照 _WEB_TIER：成員打管理員端點回 403。
         合約 C1：外援同步、推送 7 天、含 list= 的點歌 → 先回 {ok, pending, msg}，背景完成。C4：寫入都記 who（操作者）。 */
      const F = globalThis.__mockF || (globalThis.__mockF = { g: {} });
      const CAT = F.cat || (F.cat = [["art_bonus","顯示倍率小字？","bool","班表表格","display"],["art_s6_badge","S6 用主色徽章？（否＝純文字前綴）","bool","班表表格","display"],["art_empty_que","空位顯示「缺」？（否＝顯示 —）","bool","班表表格","display"],["art_loose","行高寬鬆＋表頭加高？（否＝緊湊）","bool","班表表格","display"],["art_time_strong","時段欄加粗＋淡色底強調？","bool","班表表格","display"],["art_zebra","隔行斑馬紋？","bool","班表表格","display"],["art_grid","格線樣式","select","班表表格","display",[["全格線（橫＋直）","full"],["僅橫線","h"],["無格線","none"]]],["schedule_art_color","主色（表頭/斑馬紋/頁底）","select","班表表格","settings",[["保持現狀","__keep__"],["櫻粉","#FF9AA2"],["珊瑚","#FF6F61"],["緋紅","#E63946"],["橘陽","#FF8C42"],["琥珀","#FFB703"],["鵝黃","#FFD166"],["抹茶","#B5C99A"],["嫩綠","#8AC926"],["翡翠","#2EC4B6"],["湖水","#4ECDC4"],["天青","#48CAE4"],["海藍","#4361EE"]]],["schedule_hidden_mode","班表隱藏模式","select","班表行為","settings",[["不隱藏","off"],["全部隱藏","full"],["隱藏姓名","hide_names"],["隱藏倍率","hide_bonus"],["嚴格（僅見自己）","strict"]]],["schedule_open","開放成員自助報班？","bool","班表行為","settings"],["schedule_default_show_waitlist","班表預設顯示候補名單？","bool","班表行為","settings"],["mobile_schedule","預設使用手機直式班表？","bool","班表行為","settings"],["auto_dm_schedule","報班成功自動私訊班表？","bool","班表行為","settings"],["shortage_open_all","缺人時自動對全員開放報班？","bool","班表行為","settings"],["s6_over_bonus","S6 優先於倍率？（S6 一定佔 P2，砍人先砍推手）","bool","班表行為","settings"],["signup_lock_enabled","啟用報班鎖定（時間到自動鎖班）？","bool","報班鎖定","settings"],["mod_as_admin","版主也算管理員？（有管訊息／踢人／禁言等任一權限即可用全功能）","bool","班表行為","settings"],["signup_lock_allow_shortage","鎖定後缺人時段仍可報？","bool","報班鎖定","settings"],["schedule_never_lock","完全不鎖班？（滿員也不鎖，已鎖的下次重排自動解開）","bool","報班鎖定","settings"],["rank_speed","列表顯示 1h 時速？","bool","排名顯示","display"],["rank_count","列表顯示 1h 場次？","bool","排名顯示","display"],["rank_last","列表顯示上局 PT？","bool","排名顯示","display"],["rank_gap","顯示與前後名分差？","bool","排名顯示","display"],["rank_speedboard","列表底部顯示時速榜？","bool","排名顯示","display"],["rank_profile","詳情顯示綜合力／稱號／隊長？","bool","排名顯示","display"],["rank_images","詳情顯示隊長縮圖／稱號圖？","bool","排名顯示","display"],["rank_theme","排名配色主題","select","排名顯示","settings",[["pjsk（預設）","pjsk"],["經典","經典"],["深色","深色"],["高對比","高對比"],["商務藍","商務藍"],["櫻花粉","櫻花粉"],["薄荷綠","薄荷綠"],["薰衣草紫","薰衣草紫"],["復古橘","復古橘"],["海洋藍","海洋藍"],["暮色金","暮色金"]]],["shortcuts_enabled","啟用純文字捷徑（b/m/榜線/pt1…）？","bool","聊天捷徑","settings"],["shortcuts_limit","捷徑只在特定頻道生效？（否＝所有頻道）","bool","聊天捷徑","settings"],["shortcuts_channels","捷徑允許頻道（複選）","channels","聊天捷徑","settings"],["shortcut_strict","嚴格捷徑（裸 b/c/e/m/t 與 08-12 僅在指定頻道生效，防誤觸）？","bool","聊天捷徑","settings"],["query_only_mode","啟用查分模式（只放行查分捷徑）？","bool","聊天捷徑","settings"],["silent_channels","禁止主動發言頻道（複選，捷徑/自動觸發全停）","channels","聊天捷徑","settings"],["reminder_enabled","啟用整點前排班提醒？","bool","排班提醒","settings"],["reminder_lead_min","提前幾分鐘提醒","select","排班提醒","settings",[["5 分鐘",5],["10 分鐘",10],["15 分鐘",15],["20 分鐘",20],["30 分鐘",30]]],["reminder_mention","提醒時 @ 提及上車成員？","bool","排班提醒","settings"],["reminder_show_car","提醒內容包含車種？","bool","排班提醒","settings"],["reminder_show_bonus","提醒內容包含平均倍率？","bool","排班提醒","settings"],["reminder_channel","排班提醒頻道（單選）","channel1","排班提醒","checkin"],["coop_schedule_open","開放共跑報班？","bool","共跑","settings"],["coop_reg_channel","共跑快捷註冊頻道（單選；輸入 r2.05 28.5w 即註冊）","channel1","共跑","settings"],["recruit_text_channel","文字招募讀取頻道（單選；招募文含「提醒：是」才追蹤報名並於開班前10分在車廂發簽到，否則忽略；機器人不主動點表符）","channel1","共跑","settings"],["coop_noshow_enabled","鴿班紀錄（開車 2 分未簽＝遲到、逾 5 分＝鴿班）？","bool","共跑","settings"],["coop_reminder_enabled","啟用共跑整點前提醒？","bool","共跑","settings"],["coop_reminder_channel","共跑提醒頻道（單選）","channel1","共跑","settings"],["ai_multiturn","AI 問答接續上下文（每頻道記近 6 輪）？","bool","AI","settings"],["ai_autorespond","AI 聊天頻道自動回覆？","bool","AI","settings"],["ai_chat_channel","AI 聊天頻道（單選）","channel1","AI","settings"],["daily_announce_enabled","啟用每日公告？","bool","每日公告","settings"],["daily_announce_channel","每日公告頻道（單選）","channel1","每日公告","settings"],["daily_morning_reminder","早上提醒（當日班表概況）？","bool","每日公告","settings"],["daily_evening_announce","晚間公告（明日班表）？","bool","每日公告","settings"],["daily_announce_lock_room","每日公告附房間鎖定狀態？","bool","每日公告","settings"],["welcome","新成員加入發送歡迎訊息？","bool","歡迎感謝","settings"],["welcome_channel","歡迎訊息頻道（單選）","channel1","歡迎感謝","settings"],["thanks_enabled","整點後自動發下班感謝？","bool","歡迎感謝","settings"],["thanks_channel_id","下班感謝頻道（單選）","channel1","歡迎感謝","settings"],["room_lock_enabled","啟用房間鎖定系統？","bool","房間語音","settings"],["room_lock_notify_channel","房間鎖定通知頻道（單選）","channel1","房間語音","settings"],["room_entry_track","追蹤房號進出紀錄？","bool","房間語音","settings"],["show_voice_status","顯示語音頻道狀態？","bool","房間語音","settings"],["voice_report","語音上下車自動回報？","bool","房間語音","settings"],["voice_log_channel","語音紀錄頻道（單選）","channel1","房間語音","settings"],["admin_notify_channel","管理通知頻道（單選）","channel1","系統通知","settings"],["error_channel","錯誤回報頻道（單選）","channel1","系統通知","settings"],["auto_dm_owner","異常時私訊車主？","bool","系統通知","settings"],["auto_dm_inviter","新人加入私訊邀請人？","bool","系統通知","settings"],["hidden_mode_bypass_log","隱藏模式被繞過時記錄日誌？","bool","系統通知","settings"],["schedule_theme","班表圖配色主題","select","班表表格","settings",[["pjsk（預設）","pjsk"],["淡米","淡米"],["深色","深色"],["高對比","高對比"],["商務藍","商務藍"],["櫻花粉","櫻花粉"],["薄荷綠","薄荷綠"],["薰衣草紫","薰衣草紫"],["復古橘","復古橘"],["海洋藍","海洋藍"],["暮色金","暮色金"]]],["schedule_auto_confirm","報班自動確認（免管理員按確認）","bool","班表行為","settings"],["schedule_board_channel","班表看板頻道（自動更新置頂班表）","channel1","班表行為","settings"],["voice_home_channel","語音常駐頻道（斷線自動回家、沒人也不離開）","voice1","語音・音樂","settings"],["voice_mix","混音模式（說話與音樂同時出聲）","bool","語音・音樂","settings"],["voice_say_channels","快念頻道（頻道內所有訊息都朗讀）","channels","語音・音樂","settings"],["tts_say_allowed_note","／語音 說 授權名單請用 Discord 指令管理","note","語音・音樂","settings"],["voice_volume_pct","播放音量（5-200%）","range","語音・音樂","settings"],["tts_voice","TTS 預設音色","select","語音・音樂","settings",[["Kore","Kore"],["Puck","Puck"],["Charon","Charon"],["Aoede","Aoede"],["Fenrir","Fenrir"],["Leda","Leda"],["Orus","Orus"],["Zephyr","Zephyr"],["[OpenAI] nova","nova"],["[OpenAI] shimmer","shimmer"],["[OpenAI] alloy","alloy"],["[OpenAI] echo","echo"],["[OpenAI] onyx","onyx"],["[OpenAI] fable","fable"]]],["ext_sup_enabled","私車外援系統啟用","bool","私車外援","settings"],["ext_sup_announce_channel","外援班表公告／報班頻道","channel1","私車外援","settings"],["ext_sup_room_channel","外援車房頻道","channel1","私車外援","settings"],["ext_sup_plate_channel","外援 1 車車牌頻道","channel1","私車外援","settings"],["cars_enabled","同時平行開幾台車（1＝單車，跟以前一樣）","select","多車排班","settings",[["1 台（預設）","1"],["2 台","2"],["3 台","3"]]],["car_name_1","一車顯示名稱（留空＝一車）","text","多車排班","settings"],["car_name_2","二車顯示名稱（留空＝二車）","text","多車排班","settings"],["car_name_3","三車顯示名稱（留空＝三車）","text","多車排班","settings"],["car_channels_2","綁定到二車的 Discord 頻道（在這些頻道報班＝二車）","channels","多車排班","settings"],["car_channels_3","綁定到三車的 Discord 頻道（在這些頻道報班＝三車）","channels","多車排班","settings"]]);
      if (!CAT.some(r => r[0] === 'team_mode')) CAT.push(['team_mode', '車隊模式（多位跑者：每個時段可以各自指定跑者）', 'bool', '班表行為', 'settings']);
      if (!CAT.some(r => r[0] === 'art_p1')) CAT.push(['art_p1', '車隊模式：每個時段顯示 P1 跑者？（美圖班表多一欄；私車模式不顯示）', 'bool', '班表表格', 'display']);
      if (!CAT.some(r => r[0] === 'scheduler_role_on')) CAT.push(['scheduler_role_on', '排班身份組：有這個身分組的成員可以排班（開班、換人、鎖班、確認、指定跑者…），但不能改設定', 'bool', '權限', 'settings']);
      if (!CAT.some(r => r[0] === 'scheduler_role')) CAT.push(['scheduler_role', '排班身份組（選一個 Discord 身分組；QQ 車隊用不到）', 'role1', '權限', 'settings']);
      const ROLES = gid === '111' ? [{ id: '900000000000000001', name: '排班員' }, { id: '900000000000000002', name: '跑者' }] : [];      // R 組：新的設定鍵照樣從 settings_meta 進來
      const CARK = F.cark || (F.cark = new Set(['schedule_open', 'schedule_auto_confirm', 's6_over_bonus', 'schedule_never_lock', 'signup_lock_enabled', 'signup_lock_allow_shortage', 'shortage_open_all', 'schedule_hidden_mode', 'schedule_board_channel', 'gsheet_id', 'gsheet_auto', 'gsheet_last_push']));
      const CH = gid === '111' ? [['1234567890123456789', '排班公告'], ['1234567890123456790', '報班區'], ['1234567890123456791', '聊天室'], ['1234567890123456792', '<b>小夫</b>的頻道'], ['1234567890123456793', '機器人指令']].map(([id, name]) => ({ id, name })) : [];
      const VCH = gid === '111' ? [['2234567890123456789', '語音大廳'], ['2234567890123456790', '車房一']].map(([id, name]) => ({ id, name })) : [];
      const ts = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); };
      const gF = F.g[gid] || (F.g[gid] = {
        set: { cars_enabled: gid === '111' ? '3' : '1', welcome: true, reminder_enabled: true, reminder_lead_min: 10, reminder_channel: '1234567890123456789', shortcuts_channels: ['1234567890123456790'],
          voice_home_channel: '2234567890123456789', voice_volume_pct: 80, tts_voice: 'Kore', rank_theme: 'pjsk', schedule_theme: 'pjsk', art_grid: 'full', art_bonus: true, schedule_art_color: '#5C7AEA', car_name_2: '', car_name_3: '' },
        log: [
          { ts: '09-18 21:03:11', src: 'discord', action: '報跑', detail: '2026-09-19 20-24', who: '菜根' },
          { ts: '09-18 21:10:45', src: 'web', action: '換人', detail: '2026-09-19 22:00 P5 → <b>小夫</b>', who: '<b>小夫</b>' },
          { ts: '09-18 23:59:59', src: 'system', action: '自動鎖班', detail: '2026-09-19 24:00', who: '' },
          { ts: '09-19 08:00:02', src: 'discord', action: '簽到', detail: '小明 20:00（二車）', who: '小明' },
          { ts: '09-19 12:30:00', src: 'web', action: '改設定', detail: '開放成員自助報班？ = True（一車）', who: '菜根' },
        ],
        st: { online: true, vc: gid === '111' ? '語音大廳' : '', mix: false, vol: 80, auto: 'v', now: gid === '111' ? { title: 'ロキ / <b>みきとP</b>', duration: 214, pos: 63, requester: '小明' } : null,
          queue: gid === '111' ? [{ title: '千本桜', duration: 245, requester: '網頁' }, { title: '<img src=x onerror=alert(1)>', duration: 180, requester: '<b>小夫</b>' }] : [] },
      });
      const cF = c.fF || (c.fF = { schedule_hidden_mode: 'off', schedule_auto_confirm: no === 1, signup_lock_enabled: true, schedule_board_channel: no === 1 ? '1234567890123456789' : '',
        gsheet_id: no === 1 ? '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789' : '', gsheet_last_push: no === 1 ? '09-19 18:30' : '', gsheet_auto: false });
      const carsN = () => Math.max(1, Math.min(3, parseInt(gF.set.cars_enabled, 10) || 1));
      const carNm = n => String(gF.set['car_name_' + n] || '') || ['', '一車', '二車', '三車'][n];
      const sfx = () => carsN() > 1 ? '（' + carNm(no) + '）' : '';
      const logF = (action, detail) => { gF.log.push({ ts: ts(), src: 'web', action, detail: String(detail).slice(0, 180), who: '菜根' }); if (gF.log.length > 400) gF.log.splice(0, gF.log.length - 400); };
      const deny = () => J({ error: '此功能僅限管理員', role, need: 'admin' }, 403);
      const getV = k => k === 'team_mode' ? !!TEAM[gid] : CARK.has(k) ? (k === 'schedule_open' ? c.open : cF[k]) : gF.set[k];
      if (rest === '/state' && m === 'GET' && sched) {
        const o = stateOut(gid, no, role), meta = [], vals = {};
        const lbl = carsN() > 1 ? '此項分車（目前：' + carNm(no) + '）' : '';
        CAT.forEach(([key, label, type, section, target, opts]) => {
          const x = { key, label, type, section, target, options: type === 'select' ? opts.map(([a, b]) => ({ label: a, value: b })) : null };
          if (lbl && target === 'settings' && CARK.has(key)) x.car_label = lbl;
          meta.push(x);
          const v = getV(key);
          vals[key] = type === 'bool' ? !!v : type === 'channels' ? (v || []).map(String) : (type === 'channel1' || type === 'voice1' || type === 'role1') ? (v ? String(v) : '') : key === 'voice_volume_pct' ? (+v || 100) : (v != null ? v : '');
        });
        const full = Object.assign(o, { settings: vals, settings_meta: meta, sections: meta.map(x => x.section).filter((s, i, a) => a.indexOf(s) === i), channels: CH, vchannels: VCH, roles: ROLES,
          cars: [1, 2, 3].filter(n => n <= carsN()).map(n => ({ no: n, name: carNm(n) })), car: no });
        if (role === 'scheduler') {           // 跟機器人一樣：排班員只拿幾個排班相關的值，沒有目錄／頻道／身分組清單
          const keep = ['schedule_open', 'signup_admin_only', 'team_mode', 'runner_self_signup', 'schedule_auto_confirm', 'shortage_open_all', 'shortage_open_hours', 'cars_enabled', 'schedule_board_channel'];
          const sv = {}; keep.forEach(k => { if (k in vals) sv[k] = vals[k]; });
          Object.assign(full, { role: 'scheduler', settings: sv, settings_meta: [], sections: [], channels: [], vchannels: [], roles: [] });
        }
        return J(full);
      }
      if (rest === '/setting' && m === 'POST') {
        if (!admin && !(sched && body.key === 'schedule_open')) return deny();    // 排班身份組只能開關報班
        const spec = CAT.find(r => r[0] === body.key); if (!spec) return J({ error: 'bad key' }, 400);
        const [key, label, type, , , opts] = spec, raw = body.value;
        if (type === 'role1' && raw && !ROLES.some(r => r.id === String(raw))) return J({ error: String(raw) === '111' ? '不能用 @everyone 當排班身份組' : '找不到這個身分組' }, 400);
        let val;
        if (type === 'bool') val = !!raw;
        else if (type === 'select') { if (!opts.some(o => o[1] === raw)) return J({ error: 'bad option' }, 400); val = raw; }      // 型別要一樣（跟 Python 的 in 一樣：5 ≠ '5'）
        else if (type === 'channel1' || type === 'voice1' || type === 'role1') val = /^\d+$/.test(String(raw)) ? String(raw) : null;
        else if (type === 'channels') val = (Array.isArray(raw) ? raw : []).map(String).filter(x => /^\d+$/.test(x));
        else if (type === 'range') { const n = parseInt(raw, 10); if (isNaN(n)) return J({ error: 'bad value' }, 400); val = Math.max(5, Math.min(200, n)); }
        else if (type === 'note') return J({ error: 'read only' }, 400);
        else val = String(raw || '').slice(0, 200);
        if (/^car_name_/.test(key)) val = String(val).trim().slice(0, 12);
        if (key === 'schedule_open') c.open = val; else if (CARK.has(key)) cF[key] = val; else gF.set[key] = val;
        if (key !== 'voice_volume_pct') logF('改設定', label + ' = ' + (Array.isArray(val) ? '[' + val.join(', ') + ']' : val) + (CARK.has(key) ? sfx() : ''));
        else gF.st.vol = val;
        /* 機器人回的 value：頻道是 int（19 位數 JSON 數字，JS 讀了會失真）——前端不能拿它來用 */
        const out = (type === 'channel1' || type === 'voice1' || type === 'role1') ? (val == null ? null : Number(val)) : type === 'channels' ? val.map(Number) : val;
        return J({ ok: true, key, value: out });
      }
      if (rest === '/log' && m === 'GET') {
        if (!admin) return deny();
        const src = q.get('src') || '', lg = gF.log.filter(x => !src || x.src === src);
        return J({ log: lg.slice(-150).reverse(), total: gF.log.length });
      }
      if (rest === '/status' && m === 'GET') {
        const S = gF.st, qq = S.queue.map(t => ({ title: t.title, duration: t.duration, requester: t.requester }));
        const base = { online: S.online, voice_connected: !!S.vc, voice_channel: S.vc || null, playing: S.now, queue_len: S.queue.length, queue: qq.slice(0, 15) };
        if (!admin) return J(Object.assign(base, { member_view: true }));
        return J(Object.assign(base, { voice_home: !!gF.set.voice_home_channel, mix: S.mix, volume: S.vol, auto_genre: S.auto || null, gemini_keys: 3, openai: false, latency: S.vc ? 42 : null }));
      }
      if (rest === '/music' && m === 'POST' && ['play', 'stop', 'skip', 'volume'].indexOf(body.action) >= 0) {
        const S = gF.st;
        if (!admin && body.action !== 'play') return J({ error: '播放控制僅限管理員，你可以搜尋與點歌' }, 403);
        if (body.action === 'play') {
          const qy = String(body.query || '').trim(); if (!qy) return J({ error: 'empty' }, 400);
          if (/list=|清單/.test(qy)) {
            setTimeout(() => { for (let i = 1; i <= 3; i++) S.queue.push({ title: '清單歌曲 ' + i, duration: 200, requester: '網頁' }); }, 2000);
            logF('點歌清單', qy.slice(0, 60));
            return J({ ok: true, pending: true, msg: '歌單解析中，完成後會自動加入佇列' });
          }
          const title = /^https?:\/\//.test(qy) ? '測試歌曲（網址）' : qy.slice(0, 60);
          S.queue.push({ title, duration: 213, requester: admin ? '網頁' : '菜根' }); if (!S.now) S.now = Object.assign({ pos: 0 }, S.queue.shift());
          logF('點歌', title);
          return J({ ok: true, added: 1, title, queued_only: !S.vc, guild: '菜根車隊', vc: S.vc || '' });
        }
        if (body.action === 'stop') { S.queue = []; S.now = null; S.auto = null; logF('停止音樂', ''); return J({ ok: true }); }
        if (body.action === 'skip') { const n = S.queue.shift(); S.now = n ? Object.assign({ pos: 0 }, n) : null; return J({ ok: true }); }
        const v = Math.max(5, Math.min(200, parseInt(body.value, 10) || 100)); S.vol = v; gF.set.voice_volume_pct = v; return J({ ok: true, volume: v });
      }
      if (rest === '/action' && m === 'POST') {
        if (!sched) return deny(); if (!admin && (body.action === 'backup' || body.action === 'top3')) return deny();
        const a = body.action;
        if (a === 'board') { logF('重繪看板', sfx()); return J({ ok: true, msg: '班表看板已重繪' }); }
        if (a === 'extsup') { logF('同步外援看板', ''); return J({ ok: true, pending: true, msg: '外援看板同步中（2 服），完成後會自動更新' }); }
        if (a === 'top3') return J({ error: '尚未設定 top3 播報' }, 400);
        if (a === 'backup') { logF('建立備份', ''); return J({ ok: true, msg: '已建立備份' }); }
        if (a === 'reseat') { const n = Object.keys(c.sched).filter(d => d >= today).length; logF('重排補位', n + ' 個日期' + sfx()); return J({ ok: true, msg: '已重排 ' + n + ' 個日期（含卡住的報班補位）' }); }
        return J({ error: 'unknown action' }, 400);
      }
      if (rest === '/sheet' && m === 'POST') {
        if (!admin) return deny();
        const act = body.action || 'info';
        /* R 組：雙向同步（表為準）。info 多回 two_way／tab／tabs／synced_at／last_err／interval／url；action:'sync' 馬上對一次。
           __mockR.sheet = 'err' → 500 {error}（也會記到 last_err）；'pending' → {ok, pending, msg}，約 2.5 秒後才更新 synced_at */
        const RS = mockR(), tabNm = no === 1 ? '班表' : '班表-' + carNm(no);
        if (act === 'info') return J(Object.assign({ sheet_id: cF.gsheet_id || '', service_email: 'caibot-sheet@caibot-sync.iam.gserviceaccount.com', has_creds: true, last_push: cF.gsheet_last_push || '', auto: !!cF.gsheet_auto },
          RS.oldsheet ? {} : { two_way: true, tab: tabNm, tabs: [tabNm, '時數', '成員'], synced_at: cF.gsheet_synced_at || '', last_err: cF.gsheet_last_err || '', interval: 60,
            url: cF.gsheet_id ? 'https://docs.google.com/spreadsheets/d/' + cF.gsheet_id + '/edit' : '' }));
        if (act === 'sync') {
          if (RS.oldsheet) return J({ error: 'unknown action' }, 400);
          if (!cF.gsheet_id) return J({ error: '尚未設定試算表 ID' }, 400);
          if (RS.sheet === 'err') {
            const why = '機器人沒有這張試算表的權限：把試算表共用給服務帳號信箱（編輯者）';
            cF.gsheet_last_err = ts().slice(0, 11) + ' ' + why;
            return J({ error: why }, 500);
          }
          const fin = () => { cF.gsheet_synced_at = ts(); cF.gsheet_last_push = ts().slice(0, 11); delete cF.gsheet_last_err; };
          if (RS.sheet === 'pending') { setTimeout(fin, 2500); logF('試算表同步', '背景處理中' + sfx()); return J({ ok: true, pending: true, msg: '正在跟試算表雙向同步，完成後狀態會更新' }); }
          /* 假裝有人在表上把今天第一個時段的 P5 填了「阿華」、又填了一個名冊裡沒有的名字 */
          const day0 = c.sched[today] || {}, h0 = Object.keys(day0).sort()[0], sh0 = h0 ? day0[h0] : null, ah = MEMBERS.find(x => x.name === '阿華');
          let pulled = 0; const miss = [];
          if (sh0 && !cF.gsheet_synced_at) { if (!sh0.p5 && ah) { sh0.p5 = { user_id: ah.uid, name: ah.name, role: 'pusher', bonus: ah.bonus }; } sh0.manual_override = true; pulled = 1; miss.push(h0 + ' P4:<b>路人甲</b>'); }
          fin(); logF('試算表同步', (pulled ? '以表為準套用 ' + pulled + ' 個時段' : '沒有變更') + sfx());
          const pushed = pulled ? [tabNm, '時數'] : [], bits = [];
          if (pulled) bits.push('以表為準套用 ' + pulled + ' 個時段');
          if (pushed.length) bits.push('已更新分頁：' + pushed.join('、'));
          if (miss.length) bits.push('表上有 ' + miss.length + ' 個名字對不到成員（照樣排上去，但沒有倍率）');
          return J({ ok: true, msg: bits.join('；') || '表跟機器人一致，沒有要更新的', pulled, created: 0, pushed, miss, err: '' });
        }
        if (act === 'config') {
          const raw = String(body.sheet_id || '').trim(), mm = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(raw);
          cF.gsheet_id = mm ? mm[1] : raw; if (body.auto != null) cF.gsheet_auto = !!body.auto;
          logF('試算表設定', (cF.gsheet_id ? '已連接' : '已清除') + sfx());
          return J({ ok: true, sheet_id: cF.gsheet_id });
        }
        if (!cF.gsheet_id) return J({ error: '尚未設定試算表 ID' }, 400);
        const dates = Array.isArray(body.dates) && body.dates.length ? body.dates : [body.date || today];
        const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); cF.gsheet_last_push = p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
        if (act === 'push') {
          if (dates.length > 1) { setTimeout(stamp, 2500); logF('推送試算表', dates.length + ' 天' + sfx()); return J({ ok: true, pending: true, msg: '推送 ' + Math.min(7, dates.length) + ' 天中，完成後「上次推送」會更新' }); }
          stamp(); logF('推送試算表', dates[0] + sfx());
          return J({ ok: true, msg: '已推送 ' + dates[0] + '(' + Object.keys(c.sched[dates[0]] || {}).length + '列)' });
        }
        if (act === 'pull') {
          const d0 = dates[0];
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d0))) return J({ error: '日期格式須為 YYYY-MM-DD' }, 400);
          if (d0 < today) return J({ error: d0 + ' 已過去，歷史班表為唯讀' }, 400);
          const day = c.sched[d0]; if (!day || !Object.keys(day).length) return J({ error: '分頁「' + d0 + '」沒有資料' }, 400);
          const h = Object.keys(day).sort()[0], sh = day[h], who2 = MEMBERS.find(x => x.name === '阿華');
          if (sh && !sh.p5 && who2) sh.p5 = { user_id: who2.uid, name: who2.name, role: 'pusher', bonus: who2.bonus };
          logF('試算表套用', d0 + sfx());
          return J({ ok: true, msg: '已套用 1 個時段；查無成員 2 筆', changed: [h], miss: [h + ' P4:路人甲', h + ' P5:<b>不存在</b>'] });
        }
        return J({ error: 'unknown action' }, 400);
      }
      if (rest === '/run' && m === 'POST') {
        if (!sched) return deny();
        const date = body.date, hour = body.hour, act = body.action;
        if (!(date && hour && (act === 'mark' || act === 'unmark'))) return J({ error: 'bad params' }, 400);
        if (!/^\d{2}:\d{2}$/.test(String(hour))) return J({ error: '時段格式須為 HH:MM' }, 400);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return J({ error: '日期格式須為 YYYY-MM-DD' }, 400);
        if (date < today) return J({ error: date + ' 已過去，歷史班表為唯讀' }, 400);
        const day = c.sched[date] || (c.sched[date] = {});
        if (act === 'mark') { if (!day[hour]) day[hour] = { run_planned: true, car_type: '蝦', locked: false, applicants: [], waitlist: [], p2: null, p3: null, p4: null, p5: null }; c.open = true; }
        else delete day[hour];
        logF(act === 'mark' ? '開班' : '砍班', date + ' ' + hour + sfx());
        return J({ ok: true });
      }
    }
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
    if (!sched) return J({ error: '此功能僅限管理員' }, 403);
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
