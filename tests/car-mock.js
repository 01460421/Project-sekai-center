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
