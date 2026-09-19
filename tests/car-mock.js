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

    /* ---------- end @@MOCK-E@@ ---------- */
    /* @@MOCK-F@@ settings */
    {
      /* 設定／紀錄／系統的假後端：形狀照 engine_omega 的 /api/state（管理員版設定目錄）、/api/setting、/api/log、/api/status、
         /api/action、/api/sheet、/api/run、/api/music（play／stop／skip／volume）。權限照 _WEB_TIER：成員打管理員端點回 403。
         合約 C1：外援同步、推送 7 天、含 list= 的點歌 → 先回 {ok, pending, msg}，背景完成。C4：寫入都記 who（操作者）。 */
      const F = globalThis.__mockF || (globalThis.__mockF = { g: {} });
      const CAT = F.cat || (F.cat = [["art_bonus","顯示倍率小字？","bool","班表表格","display"],["art_s6_badge","S6 用主色徽章？（否＝純文字前綴）","bool","班表表格","display"],["art_empty_que","空位顯示「缺」？（否＝顯示 —）","bool","班表表格","display"],["art_loose","行高寬鬆＋表頭加高？（否＝緊湊）","bool","班表表格","display"],["art_time_strong","時段欄加粗＋淡色底強調？","bool","班表表格","display"],["art_zebra","隔行斑馬紋？","bool","班表表格","display"],["art_grid","格線樣式","select","班表表格","display",[["全格線（橫＋直）","full"],["僅橫線","h"],["無格線","none"]]],["schedule_art_color","主色（表頭/斑馬紋/頁底）","select","班表表格","settings",[["保持現狀","__keep__"],["櫻粉","#FF9AA2"],["珊瑚","#FF6F61"],["緋紅","#E63946"],["橘陽","#FF8C42"],["琥珀","#FFB703"],["鵝黃","#FFD166"],["抹茶","#B5C99A"],["嫩綠","#8AC926"],["翡翠","#2EC4B6"],["湖水","#4ECDC4"],["天青","#48CAE4"],["海藍","#4361EE"]]],["schedule_hidden_mode","班表隱藏模式","select","班表行為","settings",[["不隱藏","off"],["全部隱藏","full"],["隱藏姓名","hide_names"],["隱藏倍率","hide_bonus"],["嚴格（僅見自己）","strict"]]],["schedule_open","開放成員自助報班？","bool","班表行為","settings"],["schedule_default_show_waitlist","班表預設顯示候補名單？","bool","班表行為","settings"],["mobile_schedule","預設使用手機直式班表？","bool","班表行為","settings"],["auto_dm_schedule","報班成功自動私訊班表？","bool","班表行為","settings"],["shortage_open_all","缺人時自動對全員開放報班？","bool","班表行為","settings"],["s6_over_bonus","S6 優先於倍率？（S6 一定佔 P2，砍人先砍推手）","bool","班表行為","settings"],["signup_lock_enabled","啟用報班鎖定（時間到自動鎖班）？","bool","報班鎖定","settings"],["mod_as_admin","版主也算管理員？（有管訊息／踢人／禁言等任一權限即可用全功能）","bool","班表行為","settings"],["signup_lock_allow_shortage","鎖定後缺人時段仍可報？","bool","報班鎖定","settings"],["schedule_never_lock","完全不鎖班？（滿員也不鎖，已鎖的下次重排自動解開）","bool","報班鎖定","settings"],["rank_speed","列表顯示 1h 時速？","bool","排名顯示","display"],["rank_count","列表顯示 1h 場次？","bool","排名顯示","display"],["rank_last","列表顯示上局 PT？","bool","排名顯示","display"],["rank_gap","顯示與前後名分差？","bool","排名顯示","display"],["rank_speedboard","列表底部顯示時速榜？","bool","排名顯示","display"],["rank_profile","詳情顯示綜合力／稱號／隊長？","bool","排名顯示","display"],["rank_images","詳情顯示隊長縮圖／稱號圖？","bool","排名顯示","display"],["rank_theme","排名配色主題","select","排名顯示","settings",[["pjsk（預設）","pjsk"],["經典","經典"],["深色","深色"],["高對比","高對比"],["商務藍","商務藍"],["櫻花粉","櫻花粉"],["薄荷綠","薄荷綠"],["薰衣草紫","薰衣草紫"],["復古橘","復古橘"],["海洋藍","海洋藍"],["暮色金","暮色金"]]],["shortcuts_enabled","啟用純文字捷徑（b/m/榜線/pt1…）？","bool","聊天捷徑","settings"],["shortcuts_limit","捷徑只在特定頻道生效？（否＝所有頻道）","bool","聊天捷徑","settings"],["shortcuts_channels","捷徑允許頻道（複選）","channels","聊天捷徑","settings"],["shortcut_strict","嚴格捷徑（裸 b/c/e/m/t 與 08-12 僅在指定頻道生效，防誤觸）？","bool","聊天捷徑","settings"],["query_only_mode","啟用查分模式（只放行查分捷徑）？","bool","聊天捷徑","settings"],["silent_channels","禁止主動發言頻道（複選，捷徑/自動觸發全停）","channels","聊天捷徑","settings"],["reminder_enabled","啟用整點前排班提醒？","bool","排班提醒","settings"],["reminder_lead_min","提前幾分鐘提醒","select","排班提醒","settings",[["5 分鐘",5],["10 分鐘",10],["15 分鐘",15],["20 分鐘",20],["30 分鐘",30]]],["reminder_mention","提醒時 @ 提及上車成員？","bool","排班提醒","settings"],["reminder_show_car","提醒內容包含車種？","bool","排班提醒","settings"],["reminder_show_bonus","提醒內容包含平均倍率？","bool","排班提醒","settings"],["reminder_channel","排班提醒頻道（單選）","channel1","排班提醒","checkin"],["coop_schedule_open","開放共跑報班？","bool","共跑","settings"],["coop_reg_channel","共跑快捷註冊頻道（單選；輸入 r2.05 28.5w 即註冊）","channel1","共跑","settings"],["recruit_text_channel","文字招募讀取頻道（單選；招募文含「提醒：是」才追蹤報名並於開班前10分在車廂發簽到，否則忽略；機器人不主動點表符）","channel1","共跑","settings"],["coop_noshow_enabled","鴿班紀錄（開車 2 分未簽＝遲到、逾 5 分＝鴿班）？","bool","共跑","settings"],["coop_reminder_enabled","啟用共跑整點前提醒？","bool","共跑","settings"],["coop_reminder_channel","共跑提醒頻道（單選）","channel1","共跑","settings"],["ai_multiturn","AI 問答接續上下文（每頻道記近 6 輪）？","bool","AI","settings"],["ai_autorespond","AI 聊天頻道自動回覆？","bool","AI","settings"],["ai_chat_channel","AI 聊天頻道（單選）","channel1","AI","settings"],["daily_announce_enabled","啟用每日公告？","bool","每日公告","settings"],["daily_announce_channel","每日公告頻道（單選）","channel1","每日公告","settings"],["daily_morning_reminder","早上提醒（當日班表概況）？","bool","每日公告","settings"],["daily_evening_announce","晚間公告（明日班表）？","bool","每日公告","settings"],["daily_announce_lock_room","每日公告附房間鎖定狀態？","bool","每日公告","settings"],["welcome","新成員加入發送歡迎訊息？","bool","歡迎感謝","settings"],["welcome_channel","歡迎訊息頻道（單選）","channel1","歡迎感謝","settings"],["thanks_enabled","整點後自動發下班感謝？","bool","歡迎感謝","settings"],["thanks_channel_id","下班感謝頻道（單選）","channel1","歡迎感謝","settings"],["room_lock_enabled","啟用房間鎖定系統？","bool","房間語音","settings"],["room_lock_notify_channel","房間鎖定通知頻道（單選）","channel1","房間語音","settings"],["room_entry_track","追蹤房號進出紀錄？","bool","房間語音","settings"],["show_voice_status","顯示語音頻道狀態？","bool","房間語音","settings"],["voice_report","語音上下車自動回報？","bool","房間語音","settings"],["voice_log_channel","語音紀錄頻道（單選）","channel1","房間語音","settings"],["admin_notify_channel","管理通知頻道（單選）","channel1","系統通知","settings"],["error_channel","錯誤回報頻道（單選）","channel1","系統通知","settings"],["auto_dm_owner","異常時私訊車主？","bool","系統通知","settings"],["auto_dm_inviter","新人加入私訊邀請人？","bool","系統通知","settings"],["hidden_mode_bypass_log","隱藏模式被繞過時記錄日誌？","bool","系統通知","settings"],["schedule_theme","班表圖配色主題","select","班表表格","settings",[["pjsk（預設）","pjsk"],["淡米","淡米"],["深色","深色"],["高對比","高對比"],["商務藍","商務藍"],["櫻花粉","櫻花粉"],["薄荷綠","薄荷綠"],["薰衣草紫","薰衣草紫"],["復古橘","復古橘"],["海洋藍","海洋藍"],["暮色金","暮色金"]]],["schedule_auto_confirm","報班自動確認（免管理員按確認）","bool","班表行為","settings"],["schedule_board_channel","班表看板頻道（自動更新置頂班表）","channel1","班表行為","settings"],["voice_home_channel","語音常駐頻道（斷線自動回家、沒人也不離開）","voice1","語音・音樂","settings"],["voice_mix","混音模式（說話與音樂同時出聲）","bool","語音・音樂","settings"],["voice_say_channels","快念頻道（頻道內所有訊息都朗讀）","channels","語音・音樂","settings"],["tts_say_allowed_note","／語音 說 授權名單請用 Discord 指令管理","note","語音・音樂","settings"],["voice_volume_pct","播放音量（5-200%）","range","語音・音樂","settings"],["tts_voice","TTS 預設音色","select","語音・音樂","settings",[["Kore","Kore"],["Puck","Puck"],["Charon","Charon"],["Aoede","Aoede"],["Fenrir","Fenrir"],["Leda","Leda"],["Orus","Orus"],["Zephyr","Zephyr"],["[OpenAI] nova","nova"],["[OpenAI] shimmer","shimmer"],["[OpenAI] alloy","alloy"],["[OpenAI] echo","echo"],["[OpenAI] onyx","onyx"],["[OpenAI] fable","fable"]]],["ext_sup_enabled","私車外援系統啟用","bool","私車外援","settings"],["ext_sup_announce_channel","外援班表公告／報班頻道","channel1","私車外援","settings"],["ext_sup_room_channel","外援車房頻道","channel1","私車外援","settings"],["ext_sup_plate_channel","外援 1 車車牌頻道","channel1","私車外援","settings"],["cars_enabled","同時平行開幾台車（1＝單車，跟以前一樣）","select","多車排班","settings",[["1 台（預設）","1"],["2 台","2"],["3 台","3"]]],["car_name_1","一車顯示名稱（留空＝一車）","text","多車排班","settings"],["car_name_2","二車顯示名稱（留空＝二車）","text","多車排班","settings"],["car_name_3","三車顯示名稱（留空＝三車）","text","多車排班","settings"],["car_channels_2","綁定到二車的 Discord 頻道（在這些頻道報班＝二車）","channels","多車排班","settings"],["car_channels_3","綁定到三車的 Discord 頻道（在這些頻道報班＝三車）","channels","多車排班","settings"]]);
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
      const getV = k => CARK.has(k) ? (k === 'schedule_open' ? c.open : cF[k]) : gF.set[k];
      if (rest === '/state' && m === 'GET' && admin) {
        const o = stateOut(gid, no, role), meta = [], vals = {};
        const lbl = carsN() > 1 ? '此項分車（目前：' + carNm(no) + '）' : '';
        CAT.forEach(([key, label, type, section, target, opts]) => {
          const x = { key, label, type, section, target, options: type === 'select' ? opts.map(([a, b]) => ({ label: a, value: b })) : null };
          if (lbl && target === 'settings' && CARK.has(key)) x.car_label = lbl;
          meta.push(x);
          const v = getV(key);
          vals[key] = type === 'bool' ? !!v : type === 'channels' ? (v || []).map(String) : (type === 'channel1' || type === 'voice1') ? (v ? String(v) : '') : key === 'voice_volume_pct' ? (+v || 100) : (v != null ? v : '');
        });
        return J(Object.assign(o, { settings: vals, settings_meta: meta, sections: meta.map(x => x.section).filter((s, i, a) => a.indexOf(s) === i), channels: CH, vchannels: VCH,
          cars: [1, 2, 3].filter(n => n <= carsN()).map(n => ({ no: n, name: carNm(n) })), car: no }));
      }
      if (rest === '/setting' && m === 'POST') {
        if (!admin) return deny();
        const spec = CAT.find(r => r[0] === body.key); if (!spec) return J({ error: 'bad key' }, 400);
        const [key, label, type, , , opts] = spec, raw = body.value;
        let val;
        if (type === 'bool') val = !!raw;
        else if (type === 'select') { if (!opts.some(o => o[1] === raw)) return J({ error: 'bad option' }, 400); val = raw; }      // 型別要一樣（跟 Python 的 in 一樣：5 ≠ '5'）
        else if (type === 'channel1' || type === 'voice1') val = /^\d+$/.test(String(raw)) ? String(raw) : null;
        else if (type === 'channels') val = (Array.isArray(raw) ? raw : []).map(String).filter(x => /^\d+$/.test(x));
        else if (type === 'range') { const n = parseInt(raw, 10); if (isNaN(n)) return J({ error: 'bad value' }, 400); val = Math.max(5, Math.min(200, n)); }
        else if (type === 'note') return J({ error: 'read only' }, 400);
        else val = String(raw || '').slice(0, 200);
        if (/^car_name_/.test(key)) val = String(val).trim().slice(0, 12);
        if (key === 'schedule_open') c.open = val; else if (CARK.has(key)) cF[key] = val; else gF.set[key] = val;
        if (key !== 'voice_volume_pct') logF('改設定', label + ' = ' + (Array.isArray(val) ? '[' + val.join(', ') + ']' : val) + (CARK.has(key) ? sfx() : ''));
        else gF.st.vol = val;
        /* 機器人回的 value：頻道是 int（19 位數 JSON 數字，JS 讀了會失真）——前端不能拿它來用 */
        const out = (type === 'channel1' || type === 'voice1') ? (val == null ? null : Number(val)) : type === 'channels' ? val.map(Number) : val;
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
        if (!admin) return deny();
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
        if (act === 'info') return J({ sheet_id: cF.gsheet_id || '', service_email: 'caibot-sheet@caibot-sync.iam.gserviceaccount.com', has_creds: true, last_push: cF.gsheet_last_push || '', auto: !!cF.gsheet_auto });
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
        if (!admin) return deny();
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
