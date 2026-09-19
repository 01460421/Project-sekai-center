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
