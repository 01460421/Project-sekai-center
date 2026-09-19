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
        if (!admin) return noAdm();
        const { date, hour, action } = body;
        if (!(date && hour && (action === 'mark' || action === 'unmark'))) return J({ error: 'bad params' }, 400);
        if (typeof hour !== 'string' || !/^\d{2}:\d{2}$/.test(hour)) return J({ error: '時段格式須為 HH:MM' }, 400);
        const g = guard(date); if (g) return g;
        if (A.pending) { A.pending = false; return J({ ok: true, pending: true, msg: '開班還在處理，稍後會自動更新' }); }
        const day = c.sched[date] || (c.sched[date] = {});
        if (action === 'mark') { const sh = day[hour] || (day[hour] = { car_type: '蝦', p2: null, p3: null, p4: null, p5: null, applicants: [], waitlist: [] }); sh.run_planned = true; c.open = true; }
        else delete day[hour];              // 機器人是拿掉 run_planned 並清空；共用的 stateOut 不濾 run_planned，所以這裡直接刪
        return J({ ok: true });
      }
      if (rest === '/swap' && m === 'POST') {
        if (!admin) return noAdm();
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
        if (!admin) { if (uid && uid !== 'me') return J({ error: '只能報自己的班' }, 403); uid = 'me'; }
        if (!body.date || typeof body.date !== 'string') return J({ error: '日期格式須為 YYYY-MM-DD' }, 400);
        const g = guard(body.date); if (g) return g;
        const mem = MEMBERS.find(x => x.uid === uid); if (!mem) return J({ error: '找不到成員' }, 404);
        if (rl === 's6' && !(mem.s6_bonus > 0)) return J({ error: '此成員沒有登記 S6 倍率' }, 400);
        const day = c.sched[body.date] || {}, done = [], skip = [];
        (Array.isArray(body.hours) ? body.hours : []).forEach(h => {
          const sh = day[h];
          if (!sh || !sh.run_planned) { skip.push(h); return; }
          if (!admin && sh.locked && act !== 'cancel') { skip.push(h); return; }
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
        if (!admin) return noAdm();
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
        if (!admin) return noAdm();
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
        const qq = (q.get('q') || '').trim().toLowerCase(), slim = !admin, out = [];
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
        const mem = memOf(gid), crew = uid => (mem[uid] || {}).name || null, slim = !admin;
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
        if (!raw) return J({ date: d, rows: [], src: 'none', readonly: true, note: '這天沒有留下班表資料' });
        const rows = Object.keys(raw).filter(h => HRE.test(h)).sort().map(h => { const sh = raw[h] || {};
          return { hour: h, car_type: sh.car_type || '蝦', locked: !!sh.locked, manual: !!sh.manual_override,
            seats: ['p2', 'p3', 'p4', 'p5'].map(p => { const x = sh[p]; return { pos: p, name: x ? x.name : null, role: x ? x.role : null, bonus: x ? x.bonus : null }; }),
            applicants: (sh.applicants || []).filter(a => a && typeof a === 'object').length,
            waitlist: (sh.waitlist || []).filter(w => w && typeof w === 'object').map(w => w.name) }; });
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

    /* ---------- end @@MOCK-D@@ ---------- */
    /* @@MOCK-E@@ bridge */

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
