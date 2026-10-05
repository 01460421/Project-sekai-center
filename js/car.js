/* ---------- 私車排班（車隊） ----------
   從 js/app.js 拆出來、進車隊頁才載的部分：班表、成員、統計、點歌、標籤、色段監測…共 232 個成員（約四分之一的 App 程式）。
   跟 haruki.js 同一套做法：匯出一個回傳成員物件的函式，App 載入後 Object.assign 到實例上；方法裡的 this 就是 App。
   登入卡與帳號頁共用的 lgVals 留在 app.js，車隊頁自己的資料在這裡的 carPageVals(s, out)。
   改這裡要記得 python3 tools/build-min.py && python3 tools/stamp-assets.py。 */
export function carMembers() {
  return {
  CAR_NAMES: ['', '一車', '二車', '三車'],

  CAR_HEX: /^#[0-9a-fA-F]{6}$/,

  async carApi(path, o) {
    o = o || {};
    if (this._mockReady) await this._mockReady;
    const q = new URLSearchParams(o.query || {});
    if (o.gid !== false) {
      const gid = o.gid != null ? o.gid : this.state.g;
      if (gid) q.set('gid', String(gid));
      q.set('car', String(o.car || this.carNo()));
    }
    const qs = q.toString();
    const init = { method: o.body ? 'POST' : 'GET', credentials: 'include', headers: {} };
    if (o.body) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(o.gid === false ? o.body : Object.assign({}, o.body, { gid: q.get('gid'), car: +q.get('car') }));
    }
    let r;
    try { r = await fetch(this.GAMES_API + '/car/api' + path + (qs ? '?' + qs : ''), init); }
    catch (e) { throw Object.assign(new Error('連不上伺服器，請檢查網路後再試'), { code: 'network', status: 0 }); }
    let d = null; try { d = await r.json(); } catch (e) {}
    if (!r.ok) {
      const code = (d && d.error) || ('HTTP ' + r.status);
      let msg = String(code);
      if (code === 'need_login') msg = '請先登入';
      else if (code === 'need_identity') msg = '這個帳號還沒綁定 Discord 或 QQ';
      // 機器人回的不是 JSON 時 Worker 會換成這兩種；代碼不給使用者看，只顯示 Worker 附的說明
      else if (code === 'bot_not_updated') msg = String((d && d.message) || '車隊機器人尚未更新或不支援這個功能');
      else if (code === 'bot_bad_response') msg = String((d && d.message) || '車隊機器人回應異常，請稍後再試');
      // 只有 need_login 才是「沒登入」；其他 401 是網站和機器人之間的簽章被拒（密鑰不符、時鐘差太多、重送），再登入一次也沒用
      else if (r.status === 401) msg = '車隊機器人驗證失敗，請通知管理員（' + String(code).slice(0, 40) + '）';
      else if (r.status >= 502 && r.status <= 504) msg = '菜根機器人暫時連不上，請稍後再試';
      else if (/^invalid token$/i.test(msg) || r.status === 403 && !d) msg = '你沒有這個車隊的權限';
      // 多車：那台車已經關掉（別處把車數調低）→ 收掉那台、切回第一台；寫入不自動重送到別台車，請使用者重新操作
      if (r.status === 400 && d && d.cars_enabled != null && o.gid !== false) {
        const c1 = this.carAClosed(q.get('gid') || '', +d.cars_enabled);
        throw Object.assign(new Error(String(d.error || '這台車已關閉') + '，已切回' + c1 + (o.body ? '，請重新操作' : '')), { status: r.status, code: 'car_closed', data: d });
      }
      throw Object.assign(new Error(msg), { status: r.status, code, data: d });
    }
    if (path === '/state' && d && Array.isArray(d.cars) && o.gid !== false) this.carASyncCars(q.get('gid') || '', d.cars);
    return d || {};
  },

  carNo() {
    const gd = this.carGuild(), cars = gd ? this.carCars(gd) : [];
    const c = +this.state.car || 1;
    return cars.length && !cars.some(x => x.no === c) ? cars[0].no : c;
  },

  carGuild() {
    const cm = this.state.carMe;
    return (cm && (cm.guilds || []).find(x => String(x.gid) === String(this.state.g))) || null;
  },

  carCars(gd) {
    const cs = (gd && Array.isArray(gd.cars) && gd.cars.length) ? gd.cars : [{ no: 1 }];
    return cs.map(c => ({ no: +c.no || 1, name: String(c.name || this.CAR_NAMES[+c.no] || (c.no + '車')) }))
      .filter(c => c.no >= 1 && c.no <= 3).slice(0, 3);
  },

  carSlot(h) {
    const m = /^(\d{2}):(\d{2})$/.exec(String(h || ''));
    if (!m) return String(h || '');
    const a = (+m[1]) % 24, b = (a + 1) % 24;
    return String(a).padStart(2, '0') + '-' + String(b).padStart(2, '0');
  },

  carDayLabel(d, today, xday) {
    const dt = new Date(String(d) + 'T00:00:00');
    if (isNaN(dt)) return String(d);
    const md = (dt.getMonth() + 1) + '/' + dt.getDate(), wk = '（' + '日一二三四五六'[dt.getDay()] + '）';
    if (xday) return md + ' 跨日';
    if (d === today) return '今天 ' + md + wk;
    const t = new Date(String(today) + 'T00:00:00');
    if (!isNaN(t) && Math.round((dt - t) / 86400000) === 1) return '明天 ' + md + wk;
    return md + wk;
  },

  carTagStyle(c) {
    const col = this.CAR_HEX.test(String(c || '')) ? c : '#8b90b5';
    return { bg: 'color-mix(in oklab,' + col + ' 17%,var(--card))', fg: 'color-mix(in oklab,' + col + ' 50%,var(--car-fg))' };
  },

  carSeatAt(no, date, hour, pos) {
    const st = (this.state.carStates || {})[no];
    if (!st) return {};
    const day = (st.days || []).find(d => d.date === date);
    const row = day && (day.rows || []).find(r => r.hour === hour);
    const seat = row && (row.seats || []).find(x => x && x.pos === pos);
    return { st, day, row, seat };
  },

  carDayOf(st, want) {
    const days = (st && st.days) || [];
    return days.find(d => d.date === want && !d.xday) || days.find(d => d.date === want)
      || days.find(d => !d.xday && st && d.date === st.today) || days.find(d => !d.xday) || days[0] || null;
  },

  async carLoad() {
    const me = this.state.me;
    if (me === undefined) { this.loadMe(); return; }
    if (!me) { this.setState({ carMe: null, carNeed: 'login', carErr: '' }); return; }
    if (this._carLoading) return;
    this._carLoading = true;
    this.setState({ carBusy: true, carErr: '' });
    try {
      const d = await this.carApi('/car/me', { gid: false });
      const guilds = (Array.isArray(d.guilds) ? d.guilds : []).filter(x => x && x.gid != null)
        .map(x => Object.assign({}, x, { gid: String(x.gid) }));
      const s = this.state;
      const g = s.g && guilds.some(x => x.gid === String(s.g)) ? String(s.g) : (guilds[0] ? guilds[0].gid : '');
      this.setState({ carMe: { guilds }, carNeed: '', g });
      if (g) await this.carLoadStates();
      if (g) this.carLoadSec(this.state.carTab, true);
    } catch (e) {
      const need = e.code === 'need_identity' ? 'identity' : e.code === 'need_login' ? 'login' : '';
      this.setState({ carMe: null, carNeed: need, carErr: need ? '' : e.message });
    } finally { this._carLoading = false; this.setState({ carBusy: false }); }
  },

  async carLoadStates(only) {
    const gd = this.carGuild(); if (!gd) return;
    const gid = gd.gid, cars = this.carCars(gd);
    const car = this.carNo();
    if (car !== +this.state.car) this.setState({ car });
    const list = only ? cars.filter(c => c.no === +only) : cars;
    if (!list.length) return;
    const res = await Promise.all(list.map(c => this.carApi('/state', { gid, car: c.no })
      .then(d => [c.no, d, ''], e => [c.no, null, e.message || '讀取失敗'])));
    if (String(this.state.g) !== gid) return;             // 抓的途中換了車隊，結果作廢
    const st = Object.assign({}, only ? (this.state.carStates || {}) : {});
    const errs = Object.assign({}, only ? (this.state.carStErr || {}) : {});
    res.forEach(([no, d, err]) => { if (d) { st[no] = d; delete errs[no]; } else { delete st[no]; errs[no] = err; } });
    this.setState({ carStates: st, carStErr: errs });
    if (!only || !this.state.carTags) this.carLoadTags();
  },

  async carLoadTags(no) {
    no = no || this.carNo();
    const key = this.state.g + ':' + no;
    try {
      const d = await this.carApi('/tags', { car: no });
      if (this.state.g + ':' + this.carNo() !== key) return;
      this.setState({ carTags: { key, pal: Array.isArray(d.tags) ? d.tags : [], colors: (Array.isArray(d.colors) ? d.colors : []).filter(c => this.CAR_HEX.test(String(c))) } });
    } catch (e) { this.setState({ carTags: { key, pal: [], colors: [] } }); }
  },

  async carLoadMembers() {
    const key = this.state.g + ':' + this.carNo();
    if (this.state.carMembers && this.state.carMembers.key === key) return;
    try {
      const d = await this.carApi('/members');
      const list = (Array.isArray(d.members) ? d.members : []).map(m => ({ name: String(m.name || ''), bonus: m.bonus, s6: m.s6_bonus })).filter(m => m.name);
      this.setState({ carMembers: { key, list } });
    } catch (e) { this.setState({ carMembers: { key, list: [] } }); }
  },

  CAR_TABS: [['sched', '班表'], ['members', '成員'], ['stats', '統計'], ['music', '點歌'], ['bridge', '合班'], ['settings', '設定', 1], ['log', '紀錄', 1], ['system', '系統', 1]],

  carSecKey(name, perCar) { return name + ':' + String(this.state.g || '') + (perCar ? ':' + this.carNo() : ''); },

  carSecOf(key) { return (this.state.carSec || {})[key] || null; },

  carSecPut(key, patch) { this.setState(st => ({ carSec: Object.assign({}, st.carSec, { [key]: Object.assign({}, (st.carSec || {})[key], patch) }) })); },

  async carSecFetch(key, path, opt, force) {
    const cur = this.carSecOf(key);
    if (cur && !force && (cur.busy || (cur.data && Date.now() - (cur.at || 0) < 15000))) return cur.data;
    const g0 = String(this.state.g || '');
    this.carSecPut(key, { busy: true, err: '' });
    let data = null, err = '';
    try { data = await this.carApi(path, opt || {}); }
    catch (e) { err = (e && e.code === 'not_found') ? '機器人版本不支援這個功能，請更新機器人' : ((e && e.message) || '讀取失敗'); }
    if (String(this.state.g || '') !== g0) return null;          // 讀到一半切了車隊：結果丟掉
    this.carSecPut(key, { data, err, busy: false, at: Date.now() });
    return data;
  },

  carLoadSec(tab, force) { const fn = this['carSec_' + (tab || this.state.carTab || 'sched')]; return typeof fn === 'function' ? fn.call(this, !!force) : null; },

  carAAddDay(d, n) {
    const t = Date.parse(String(d || '') + 'T00:00:00Z');
    return isNaN(t) ? '' : new Date(t + n * 86400000).toISOString().slice(0, 10);
  },

  carADays(today, from) {
    const out = [];
    for (let i = from || 0; i < 7; i++) {
      const d = this.carAAddDay(today, i);
      if (d) out.push({ v: d, n: (i === -1 ? '昨天 ' : '') + this.carDayLabel(d, today, false) });
    }
    return out;
  },

  carAState() { return (this.state.carStates || {})[this.carNo()] || null; },

  carADate(st, key) {
    const opts = this.carADays(st.today), v = this.state[key || 'carAD'];
    if (v && opts.some(o => o.v === v)) return v;
    const day = this.carDayOf(st, this.state.carDate);
    return day && !day.xday && opts.some(o => o.v === day.date) ? day.date : (opts[0] ? opts[0].v : String(st.today || ''));
  },

  carARange(date, txt) {
    const m = /^\s*(\d{1,2})(?::00)?\s*(?:[-~～－—到至]\s*(\d{1,2})(?::00)?)?\s*$/.exec(String(txt || ''));
    if (!m || !date) return null;
    const a = +m[1], b = m[2] ? +m[2] : a + 1;
    if (a > 47 || b > 48 || b <= a || b - a > 24) return null;
    const groups = [];
    for (let h = a; h < b; h++) {
      const d = h >= 24 ? this.carAAddDay(date, Math.floor(h / 24)) : date;
      let g = groups[groups.length - 1];
      if (!g || g.date !== d) groups.push(g = { date: d, hours: [] });
      g.hours.push(String(h % 24).padStart(2, '0') + ':00');
    }
    return { groups, n: b - a, txt: String(a).padStart(2, '0') + '-' + String(b).padStart(2, '0') };
  },

  carADayTxt(d) { const st = this.carAState(); return this.carDayLabel(d, (st && st.today) || d, false).replace(/（.）$/, ''); },

  carAMemKey() { return this.carSecKey('amem', false); },

  carAMemLoad(force) { return this.carSecFetch(this.carAMemKey(), '/members', {}, force); },

  carAMemList() { const c = this.carSecOf(this.carAMemKey()); return (c && c.data && Array.isArray(c.data.members)) ? c.data.members : []; },

  async carAFindMember(nm) {
    const low = String(nm).toLowerCase();
    const exact = l => (l || []).find(m => m && (String(m.name || '').toLowerCase() === low
      || (Array.isArray(m.aliases) && m.aliases.some(a => String(a).toLowerCase() === low))));
    let m = exact(this.carAMemList());
    if (!m) {
      let l = [];
      try { const d = await this.carApi('/members', { query: { q: String(nm) } }); l = Array.isArray(d.members) ? d.members.filter(x => x && x.name) : []; }
      catch (e) { this._toast(e.message || '讀取成員失敗'); return null; }
      m = exact(l) || (l.length === 1 ? l[0] : null);
      if (!m && l.length > 1) { this._toast('有 ' + l.length + ' 位成員符合「' + nm + '」，請輸入完整名稱'); return null; }
    }
    if (!m) { this._toast('找不到成員「' + nm + '」'); return null; }
    if (m.uid == null || m.uid === '') { this._toast('機器人沒有回傳成員 ID，請更新機器人後再代報'); return null; }
    return { uid: String(m.uid), name: String(m.name || nm) };
  },

  async carABulk(list, fn) {
    if (this._carABusy) { this._toast('上一個操作還在處理中'); return null; }
    this._carABusy = true; this.setState({ carABusy: true });
    const out = [];
    try {
      for (const x of list) { const d = await fn(x); if (!d) return { out, fail: true }; out.push(d); }
      return { out, fail: false };
    } finally { this._carABusy = false; this.setState({ carABusy: false }); }
  },

  carABulkEnd(r, okTxt, no, date) {
    if (!r) return;
    const pend = r.out.filter(d => d && d.pending);
    if (r.fail) { if (r.out.length) this._toast(String(this.state.toast || '操作失敗') + '（前 ' + r.out.length + ' 個已完成）', 4000); }
    else if (pend.length) this._toast(String(pend[0].msg || '機器人還在處理，稍後會更新'), 4000);
    else if (okTxt) this._toast(okTxt, 3000);
    if (r.out.length) { if (date) this.setState({ carDate: date, carPop: null }); this.carLoadStates(no); }
    if (pend.length) this.carALater(no);
  },

  carALater(no) {
    const g0 = String(this.state.g || '');
    setTimeout(() => { if (String(this.state.g || '') === g0) this.carLoadStates(no); }, 5000);
  },

  carAInput(st, key) {
    const date = this.carADate(st), rg = this.carARange(date, this.state[key || 'carAR']);
    if (!rg) this._toast('時段格式：20-22（跨午夜寫 22-26，單一小時寫 20）');
    return rg ? { date, rg, when: this.carADayTxt(date) + ' ' + rg.txt } : null;
  },

  async carARun(act) {
    const st = this.carAState(), no = this.carNo(); if (!st) return;
    const x = this.carAInput(st); if (!x) return;
    if (act === 'unmark' && !window.confirm('砍掉 ' + x.when + '（' + x.rg.n + ' 個時段）？\n這些時段的座位、報班與候補都會清空，也不再開放報班。')) return;
    const items = [].concat.apply([], x.rg.groups.map(g => g.hours.map(h => ({ date: g.date, hour: h }))));
    // 車隊模式：開班可以順便帶這段時間的跑者（選填；已經開著的時段也會一起改成這位跑者）
    const who = act !== 'unmark' && this.carTeamOn(no) ? this.carRunWho(this.state.carARunWho) : '';
    const r = await this.carABulk(items, it => this.carAct('/run', Object.assign({ date: it.date, hour: it.hour, action: act === 'unmark' ? 'unmark' : 'mark' }, who ? { runner: who } : {}), null, no));
    this.carABulkEnd(r, r && (act === 'unmark' ? '已砍班 ' : '已開班 ') + r.out.length + ' 個時段（' + x.when + '）' + (who ? '，跑者 ' + who : ''), no, x.rg.groups[0].date);
  },

  async carAProxy(act) {
    const s = this.state, st = this.carAState(), no = this.carNo(); if (!st) return;
    const nm = String(s.carAPxName || '').trim();
    if (!nm) { this._toast('請輸入成員名稱'); return; }
    const x = this.carAInput(st); if (!x) return;
    const mem = await this.carAFindMember(nm); if (!mem) return;
    if (act === 'cancel' && !window.confirm('取消 ' + mem.name + ' 在 ' + x.when + ' 的報班？\n他在這些時段的座位與候補也會一併清掉。')) return;
    const role = s.carASignRole === 's6' ? 's6' : 'pusher';
    const r = await this.carABulk(x.rg.groups, g => this.carAct('/signup', { date: g.date, hours: g.hours, uid: mem.uid, action: act === 'cancel' ? 'cancel' : 'add', role }, null, no));
    const sum = k => r ? r.out.reduce((n, d) => n + (Array.isArray(d[k]) ? d[k].length : 0), 0) : 0;
    const who = String((r && r.out[0] && r.out[0].name) || mem.name);
    this.carABulkEnd(r, r && who + '：' + (act === 'cancel' ? '已取消 ' : '已報 ') + sum('done') + ' 個時段' + (sum('skip') ? '（跳過 ' + sum('skip') + '：沒開班' + (act === 'cancel' ? '或沒有他的報班' : '') + '）' : ''), no, x.rg.groups[0].date);
  },

  async carASelf(act) {
    const s = this.state, st = this.carAState(), no = this.carNo(); if (!st) return;
    const x = this.carAInput(st); if (!x) return;
    if (act === 'cancel' && !window.confirm('取消你在 ' + x.when + ' 的報班？\n座位與候補也會一併取消。')) return;
    const role = s.carASignRole === 's6' ? 's6' : 'pusher';
    const r = await this.carABulk(x.rg.groups, g => this.carAct('/signup', { date: g.date, hours: g.hours, action: act === 'cancel' ? 'cancel' : 'add', role }, null, no));
    const sum = k => r ? r.out.reduce((n, d) => n + (Array.isArray(d[k]) ? d[k].length : 0), 0) : 0;
    /* 報班限制／取消期限擋下的原因（機器人回 why）優先顯示，比「沒開班或已鎖班」準 */
    const why = r ? r.out.reduce((a, d) => a.concat(Array.isArray(d && d.why) ? d.why : []), []).map(t => this.carFTxt(t)).filter((t, i, a) => t && a.indexOf(t) === i).join('；') : '';
    this.carABulkEnd(r, r && (act === 'cancel' ? '已取消 ' : '已報班 ') + sum('done') + ' 個時段'
      + (sum('skip') ? '（跳過 ' + sum('skip') + '：' + (why || (act === 'cancel' ? '這些時段沒有你的報班' : '沒開班或已鎖班')) + '）' : ''), no, x.rg.groups[0].date);
  },

  async carACopy(withPeople) {
    const s = this.state, st = this.carAState(), no = this.carNo(); if (!st) return;
    const f = this.carACpFrom(st), t = this.carACpTo(st, f);
    if (!f || !t) return;
    if (f === t) { this._toast('來源與目標相同'); return; }
    const lf = this.carADayTxt(f), lt = this.carADayTxt(t);
    if (!window.confirm('把 ' + lf + ' 的班表複製到 ' + lt + (withPeople ? '（含人員）' : '（只複製開班時段）') + '？\n' + lt + ' 同一時段原本的安排會被覆蓋。')) return;
    const d = await this.carAct('/batch', { action: 'copy', from: f, to: t, with_people: !!withPeople }, r => String(r.msg || '已複製'), no);
    // 來源／目標寫回欄位：複製完會跳到目標那天，沒寫回的話「從哪一天」會跟著跳走
    if (d) { this.setState({ carDate: t, carPop: null, carACpFrom: f, carACpTo: t }); this.carLoadStates(no); if (d.pending) this.carALater(no); }
  },

  carACpFrom(st) {
    const v = this.state.carACpFrom;
    return this.carADays(st.today, -1).some(o => o.v === v) ? v : this.carADate(st);
  },

  carACpTo(st, from) {
    const v = this.state.carACpTo, opts = this.carADays(st.today);
    if (opts.some(o => o.v === v)) return v;
    const nx = this.carAAddDay(from, 1);
    return opts.some(o => o.v === nx) ? nx : ((opts.find(o => o.v !== from) || {}).v || '');
  },

  async carARangeAct(act) {
    const st = this.carAState(), no = this.carNo(); if (!st) return;
    const x = this.carAInput(st); if (!x) return;
    if (act === 'clear' && !window.confirm('清空 ' + x.when + ' 的所有人員？\n座位、報班與候補都會清掉，開班狀態保留。')) return;
    const body = g => act === 'clear' ? { action: 'clear_range', date: g.date, hours: g.hours } : { action: 'lock', date: g.date, hours: g.hours, value: act === 'lock' };
    const r = await this.carABulk(x.rg.groups, g => this.carAct('/batch', body(g), null, no));
    this.carABulkEnd(r, r && (r.out.map(d => String(d.msg || '')).filter(Boolean).join('；') || '完成'), no, x.rg.groups[0].date);
  },

  async carAQuick(act) {
    const no = this.carNo();
    const a = act === 'board' ? 'board' : 'reseat';
    if (a === 'reseat' && !window.confirm('依報班與倍率重新排這一車今天以後的所有班？\n手動排過的時段只會補空位，其他時段的座位可能會變動。')) return;
    const d = await this.carAct('/action', { action: a }, r => String(r.msg || (a === 'board' ? '班表看板已重繪' : '已重排')), no);
    if (!d) return;
    if (d.pending) this.carALater(no);
    else if (a === 'reseat') this.carLoadStates(no);
  },

  async carAUnmark(date, hour) {
    const no = this.carNo(), st = this.carAState();
    if (st && st.today && String(date) < st.today) { this._toast('跨日時段已過日期，不能砍班'); return; }
    if (!window.confirm(this.carSlot(hour) + ' 砍班？\n這個時段的座位、報班與候補都會清空，也不再開放報班。')) return;
    const d = await this.carAct('/run', { date, hour, action: 'unmark' }, this.carSlot(hour) + ' 已砍班', no);
    if (d) { this.setState({ carPop: null }); this.carLoadStates(no); }
  },

  async carAPlaceAt(el) {
    const s = this.state, nm = String(s.carAPick || ''), d = el.dataset, no = this.carNo(), st = this.carAState();
    if (!nm || !d.h || !d.pos) return;
    if (st && st.today && String(d.d) < st.today) { this._toast('跨日時段已過日期，只能貼標記'); return; }
    const cur = String(d.nm || '');
    if (cur === nm) return;
    if (cur && !window.confirm('用 ' + nm + ' 換掉 ' + this.carSlot(d.h) + ' ' + String(d.pos).toUpperCase() + ' 的 ' + cur + '？')) return;
    const role = s.carARole === 's6' || s.carARole === 'pusher' ? s.carARole : '';
    const r = await this.carAct('/swap', { date: d.d, hour: d.h, pos: d.pos, new: nm, role },
      x => (x.name || nm) + ' → ' + this.carSlot(d.h) + ' ' + String(d.pos).toUpperCase() + (x.role === 's6' ? '（S6）' : '（推手）'), no);
    if (r) this.carLoadStates(no);
  },

  carAClosed(gid, ne) {
    const cm = this.state.carMe, gd = cm && (cm.guilds || []).find(x => String(x.gid) === String(gid));
    if (!gd) return this.CAR_NAMES[1];
    const n = Math.max(1, Math.min(3, +ne || 1));
    const keep = this.carCars(gd).filter(c => c.no <= n);
    const list = keep.length ? keep : [{ no: 1, name: this.CAR_NAMES[1] }];
    const moved = String(this.state.g) === String(gid) && +this.state.car > n;
    this.carASyncCars(gid, list);
    if (moved && Date.now() - (this._carAClosedT || 0) > 3000) {
      this._carAClosedT = Date.now();
      this._toast('這個車隊目前只開 ' + n + ' 台車，已切回' + list[0].name, 3500);
    }
    return list[0].name;
  },

  carASyncCars(gid, list) {
    const cm = this.state.carMe; if (!cm || !gid) return;
    const gd = (cm.guilds || []).find(x => String(x.gid) === String(gid)); if (!gd) return;
    const next = (Array.isArray(list) ? list : []).map(c => { const no = +(c && c.no) || 0; return { no, name: String((c && c.name) || this.CAR_NAMES[no] || (no + '車')) }; })
      .filter(c => c.no >= 1 && c.no <= 3).slice(0, 3);
    if (!next.length) return;
    const cur = this.carCars(gd);
    if (cur.length === next.length && cur.every((c, i) => c.no === next[i].no && c.name === next[i].name)) return;
    const added = next.filter(c => !cur.some(x => x.no === c.no)).map(c => c.no);
    const guilds = (cm.guilds || []).map(x => String(x.gid) === String(gid) ? Object.assign({}, x, { cars: next }) : x);
    const here = String(this.state.g) === String(gid);
    const patch = { carMe: Object.assign({}, cm, { guilds }) };
    const move = here && !next.some(c => c.no === +this.state.car);
    if (move) Object.assign(patch, { car: next[0].no, carPop: null, carAPick: '' });
    this.setState(patch);
    if (!here) return;
    setTimeout(() => {
      added.forEach(no => this.carLoadStates(no));
      if (move) { if (!(this.state.carStates || {})[next[0].no]) this.carLoadStates(next[0].no); this.carLoadTags(next[0].no); this.carLoadSec(this.state.carTab); }
    }, 0);
  },

  CAR_RUN_IDS: ['runner', '跑者', '跑推兼任', '跑推+s6'],

  carTeamOn(no) { const st = (this.state.carStates || {})[no || this.carNo()]; return !!(st && st.team_mode === true); },

  carRole(st, gd) { const r = (st && st.role) || (gd && gd.role) || 'member'; return r === 'admin' || r === 'scheduler' ? r : 'member'; },

  carIsSched(st, gd) { const r = this.carRole(st, gd); return r === 'admin' || r === 'scheduler'; },

  carRunWho(txt) {
    const t = String(txt == null ? '' : txt).trim();
    if (!t) return '';
    const low = t.toLowerCase(), l = this.carAMemList().filter(m => m && m.name);
    const m = l.find(x => String(x.name).toLowerCase() === low) || l.find(x => Array.isArray(x.aliases) && x.aliases.some(a => String(a).toLowerCase() === low));
    return m ? String(m.name) : t;
  },

  carRunHours(day, hour, chain) {
    const h0 = String(hour || ''), mm = h0.slice(2) || ':00';
    if (!chain) return [h0];
    const have = new Set(((day && day.rows) || []).map(r => String(r && r.hour)));
    const out = [];
    for (let h = +h0.slice(0, 2); out.length < 48; h++) {
      const k = String(h).padStart(2, '0') + mm;
      if (!have.has(k)) break;
      out.push(k);
    }
    return out.length ? out : [h0];
  },

  carRunSpan(hours) {
    const hs = (hours || []).map(h => +String(h).slice(0, 2)).filter(n => !isNaN(n)).sort((a, b) => a - b);
    if (!hs.length) return '';
    const cont = hs.every((n, i) => !i || n === hs[i - 1] + 1);
    const pad = n => String(n % 24).padStart(2, '0');
    return cont ? pad(hs[0]) + '-' + pad(hs[hs.length - 1] + 1) : hs.length + ' 個時段';
  },

  async carRunSend(date, hours, who, no) {
    const st = (this.state.carStates || {})[no];
    if (st && st.today && String(date) < st.today) { this._toast('跨日時段已過日期，不能改跑者'); return null; }
    if (!date || !hours || !hours.length) return null;
    const d = await this.carAct('/runner', { date, hours, runner: String(who || '') }, null, no);
    if (!d) return null;
    const done = Array.isArray(d.done) ? d.done : hours, skip = Array.isArray(d.skip) ? d.skip : [];
    const nm = String(d.name || who || '');
    this._toast(d.pending ? String(d.msg || '機器人還在處理，稍後會更新')
      : ((who ? '已指定 ' + this.carRunSpan(done) + ' 的跑者：' : '已恢復 ' + this.carRunSpan(done) + ' 的預設跑者：') + nm
        + (skip.length ? '（跳過 ' + skip.length + ' 個：還沒開班）' : '')), 3000);
    this.setState({ carPop: null });
    this.carLoadStates(no);
    if (d.pending) this.carALater(no);
    return d;
  },

  async carRunSubmit(reset) {
    const p = this.state.carPop; if (!p || p.kind !== 'runner') return;
    const { day, row } = this.carSeatAt(p.no, p.date, p.hour, '');
    if (!day || !row) { this._toast('班表已變動，請重新整理'); this.carLoadStates(p.no); return; }
    const who = reset ? '' : this.carRunWho(this.state.carRunName);
    if (!reset && !who) { this._toast('輸入或選一位跑者'); return; }
    await this.carRunSend(p.date, this.carRunHours(day, p.hour, !!this.state.carRunChain), who, p.no);
  },

  carRunClick(el, board) {
    const no = this.carNo(), st = (this.state.carStates || {})[no], d = el.dataset;
    if (!st || !this.carIsSched(st) || st.team_mode !== true || !d.h || !d.d) return;
    if (st.today && String(d.d) < st.today) return;
    if (board && this.state.carAPick && this.state.carView === 'board') this.carRunPlace(el, this.state.carAPick, true);
    else this.carOpenPop('runner', el);
  },

  async carRunPlace(el, nm, ask) {
    const d = el.dataset, no = this.carNo();
    nm = String(nm || '');
    if (!nm || !d.h || !d.d || !this.carTeamOn(no)) return;
    const cur = String(d.nm || '');
    if (cur === nm && d.c === '1') return;
    if (ask && d.c === '1' && cur && !window.confirm('用 ' + nm + ' 換掉 ' + this.carSlot(d.h) + ' 的跑者 ' + cur + '？')) return;
    await this.carRunSend(d.d, [d.h], nm, no);
  },

  async carARunTool(reset) {
    const st = this.carAState(), no = this.carNo(); if (!st) return;
    if (!this.carTeamOn(no)) { this._toast('私車模式不能指定跑者，請先切到車隊模式'); return; }
    const x = this.carAInput(st); if (!x) return;
    const who = reset ? '' : this.carRunWho(this.state.carARunSetWho);
    if (!who && !window.confirm('把 ' + x.when + '（' + x.rg.n + ' 個時段）的跑者改回預設跑者「' + String(st.p1 || '跑者') + '」？\n這些時段另外指定的跑者會被清掉。')) return;
    const soft = e => (e && e.status === 400 && e.data && Array.isArray(e.data.skip)) ? { none: true, done: [], skip: e.data.skip } : null;
    const r = await this.carABulk(x.rg.groups, g => this.carAct('/runner', { date: g.date, hours: g.hours, runner: who }, null, no, soft));
    if (!r) return;
    const sum = k => r.out.reduce((n, d) => n + (Array.isArray(d[k]) ? d[k].length : 0), 0);
    const done = sum('done'), skip = sum('skip'), hit = r.out.find(d => d && !d.none && d.name);
    if (!r.fail && !done && !r.out.some(d => d && d.pending)) { this._toast('這些時段都還沒開班，先開班再指定跑者（跳過 ' + skip + ' 個）', 3500); return; }
    const first = r.out.findIndex(d => d && !d.none);
    this.carABulkEnd(r, (who ? '已指定 ' : '已恢復 ') + done + ' 個時段的' + (who ? '跑者：' : '預設跑者：') + String((hit && hit.name) || who || st.p1 || '')
      + '（' + x.when + '）' + (skip ? '（跳過 ' + skip + ' 個：還沒開班）' : ''), no, (x.rg.groups[first < 0 ? 0 : first] || x.rg.groups[0]).date);
  },

  async carSetRunSelf(on) {
    const no = this.carNo();
    const d = await this.carAct('/setting', { key: 'runner_self_signup', value: !!on }, on ? '已開放跑者自行報跑' : '已關閉跑者自行報跑', no);
    if (d) this.carLoadStates();
  },

  async carRunSelf(groups, act, no) {
    let done = 0, last = null;
    for (const g of groups) {
      const d = await this.carAct('/runself', { date: g.date, hours: g.hours, action: act }, null, no);
      if (!d) break;
      last = d; done += (d.done || []).length;
    }
    if (last) this._toast(act === 'cancel' ? ('已取消報跑 ' + done + ' 個時段' + (last.cleared ? '（連帶清掉 ' + last.cleared + ' 位推手）' : ''))
      : (last.msg ? String(last.msg).split('；')[0] : '已報跑 ' + done + ' 個時段'), 4000);
    this.carLoadStates(no);
  },

  async carRunSelfRow(el) {
    const d = el.dataset, act = d.act === 'cancel' ? 'cancel' : 'open';
    if (!d.d || !d.h) return;
    if (act === 'cancel' && !window.confirm('取消 ' + this.carSlot(d.h) + ' 的報跑？\n這個時段已經報班的推手會一起清掉，時段也會關閉。')) return;
    await this.carRunSelf([{ date: d.d, hours: [d.h] }], act, this.carNo());
  },

  async carRunSelfTool() {
    const st = this.carAState(); if (!st) return;
    const date = this.state.carDate || st.today, rg = this.carARange(date, this.state.carRsHours);
    if (!rg) { this._toast('時段格式：20-24（跨午夜寫 22-26，單一小時寫 20）'); return; }
    await this.carRunSelf(rg.groups, 'open', this.carNo());
    this.setState({ carRsHours: '' });
  },

  async carSetMode(team) {
    const no = this.carNo(), st = (this.state.carStates || {})[no]; if (!st) return;
    team = !!team;
    if (!!st.team_mode === team) return;
    if (!team) {
      const day = this.carDayOf(st, this.state.carDate);
      const any = !!day && (day.rows || []).some(r => r && r.p1 && r.p1.custom);
      if (any && !window.confirm('切回私車後，各時段指定的跑者仍會保留並照樣顯示，只是不能在網頁上再調整；確定要切換嗎？')) return;
    }
    const d = await this.carAct('/setting', { key: 'team_mode', value: team }, team ? '已切換成車隊模式' : '已切換成私車模式', no);
    if (!d) return;
    this.setState({ carPop: null });
    this.carLoadStates();
  },

  carSec_sched(force) {
    const gd = this.carGuild(); if (!gd) return;
    const no = this.carNo(), st = (this.state.carStates || {})[no];
    if (force) this._carASchedAt = Date.now();
    else if (st && Date.now() - (this._carASchedAt || 0) > 8000) { this._carASchedAt = Date.now(); this.carLoadStates(no); }
    if (this.carIsSched(st, gd)) this.carAMemLoad(!!force);
  },

  carSecVals_sched(c) {
    const { s, gd, st, segOn } = c;
    const stAdmin = !!st && this.carIsSched(st, gd);   // 排班身份組也用得到排班工具（state 還沒載入時一律當成員）
    const busy = !!(s.carABusy || s.carActBusy);
    const fmt = v => (v === null || v === undefined || v === '' || isNaN(+v)) ? '—' : (+v).toFixed(2);
    const day = st ? this.carDayOf(st, s.carDate) : null;
    const today = (st && st.today) || '';
    const days = today ? this.carADays(today) : [];
    const teamOn = stAdmin && st.team_mode === true;       // 車隊模式才有「指定跑者」相關的操作
    const tool = ['run', 'proxy', 'copy', 'range'].concat(teamOn ? ['runner'] : []).indexOf(s.carATool) >= 0 ? s.carATool : 'run';
    const cpFrom = st && today ? this.carACpFrom(st) : '';
    const isQQ = /^qqg_/.test(String(gd.gid || ''));
    const signRole = s.carASignRole === 's6' ? 's6' : 'pusher';
    const dropRole = s.carARole === 's6' || s.carARole === 'pusher' ? s.carARole : '';

    /* 成員池（看板、管理員、非跨日）：搜尋名字或別名 */
    const memC = this.carSecOf(this.carAMemKey());
    const mems = this.carAMemList().filter(m => m && m.name);
    const pq = String(s.carAPoolQ || '').trim().toLowerCase();
    const poolShow = stAdmin && s.carView === 'board' && !!day && !day.xday;
    const pool = poolShow ? mems.filter(m => !pq || String(m.name).toLowerCase().indexOf(pq) >= 0
      || (Array.isArray(m.aliases) && m.aliases.some(a => String(a).toLowerCase().indexOf(pq) >= 0)))
      .slice(0, 300).map(m => {
        const nm = String(m.name), on = s.carAPick === nm;
        return { nm, bn: fmt(m.bonus) + (+m.s6_bonus > 0 ? ' · S6 ' + fmt(m.s6_bonus) : ''), sel: on ? 'true' : 'false',
          bg: on ? 'color-mix(in oklab,var(--accent) 16%,var(--card))' : 'var(--card-2)', bd: on ? 'var(--accent)' : 'var(--border)' };
      }) : [];
    const pick = poolShow ? String(s.carAPick || '') : '';
    const roleName = { '': '自動', s6: 'S6', pusher: '推手' };

    /* 跑者的建議名單（車隊模式）：身分是跑者的排前面；名字一個選項、每個別名也各一個選項（Safari 的 datalist 只比對 value）。
       只有用得到的時候才產生（小視窗開著、或工具停在「開班」「指定跑者」），名冊大的車隊才不會每次重繪都多畫幾百個 option */
    const runPop = !!(s.carPop && s.carPop.kind === 'runner');
    const runListOn = teamOn && (runPop || (!!today && (tool === 'run' || tool === 'runner')));
    const runOpts = [];
    if (runListOn) {
      const isRun = m => this.CAR_RUN_IDS.indexOf(String(m.identity || '')) >= 0;
      const l = mems.slice(0, 300);
      l.filter(isRun).concat(l.filter(m => !isRun(m))).forEach(m => {
        const nm = String(m.name), al = (Array.isArray(m.aliases) ? m.aliases : []).map(a => String(a == null ? '' : a)).filter(Boolean);
        runOpts.push({ v: nm, n: (isRun(m) ? '跑者 · ' : '') + fmt(m.bonus) + (al.length ? ' · ' + al.join('、') : '') });
        al.forEach(a => { if (a.toLowerCase() !== nm.toLowerCase()) runOpts.push({ v: a, n: nm + ' 的別名' }); });
      });
    }
    const pickRun = teamOn && !!pick;

    return {
      /* 排班工具（管理員）／我要報班（成員） */
      carAToolsShow: stAdmin && !!today,
      carASelfShow: !!st && !stAdmin && !!today,
      carAToolTabs: [['run', '開班']].concat(teamOn ? [['runner', '指定跑者']] : [], [['proxy', '代報班'], ['copy', '複製班表'], ['range', '整段處理']]).map(([v, n]) => Object.assign({ v, n, sel: tool === v ? 'true' : 'false' }, segOn(tool === v))),
      carAToolRun: tool === 'run', carAToolProxy: tool === 'proxy', carAToolCopy: tool === 'copy', carAToolRange: tool === 'range', carAToolRunner: tool === 'runner',
      /* 車隊模式：開班順便帶跑者、「指定跑者」工具、跑者建議名單 */
      carATeamOn: teamOn, carARunWho: s.carARunWho || '', carARunSetWho: s.carARunSetWho || '',
      carRunListOn: runListOn, carRunOpts: runOpts,
      carARunSetBtn: busy ? '處理中…' : '指定跑者',
      carARunHelp: '開班＝把這段時間設成要跑，並自動打開成員自助報班；砍班會清空座位、報班與候補。「20-22」是 20:00～22:00 兩個時段，跨午夜寫「22-26」，單一小時寫「20」。'
        + (teamOn ? '跑者選填：有填的話，這段時間（含已經開著的時段）的跑者都會改成他；留空就是車隊預設跑者。' : ''),
      carADateOpts: days, carAD: st && today ? this.carADate(st) : '', carAR: s.carAR || '',
      carACpFromOpts: today ? this.carADays(today, -1) : [], carACpToOpts: days,
      carACpFrom: cpFrom, carACpTo: st && today ? this.carACpTo(st, cpFrom) : '',
      carAPxName: s.carAPxName || '',
      carAPxOpts: stAdmin ? mems.slice(0, 300).map(m => ({ v: String(m.name), n: String(m.name) + ' · ' + fmt(m.bonus)
        + (Array.isArray(m.aliases) && m.aliases.length ? ' · ' + m.aliases.map(String).join('、') : '') })) : [],
      carASignRoles: [['pusher', '推手'], ['s6', 'S6']].map(([v, n]) => Object.assign({ v, n, sel: signRole === v ? 'true' : 'false' }, segOn(signRole === v))),
      carABusyOn: busy,
      carARunBtn: busy ? '處理中…' : '開班', carAPxBtn: busy ? '處理中…' : '代報班', carASelfBtn: busy ? '處理中…' : '報班',
      /* 快速操作（管理員）：QQ 車隊沒有 Discord 看板，不顯示重繪看板 */
      carAQuickShow: stAdmin, carABoardShow: stAdmin && !isQQ,
      /* 成員池 */
      carAPoolShow: poolShow, carAPool: pool, carAPoolQ: s.carAPoolQ || '',
      carAPoolLoading: poolShow && !!memC && !!memC.busy && !mems.length,
      carAPoolErr: poolShow && memC && memC.err ? String(memC.err) : '',
      carAPoolEmpty: poolShow && !!memC && !memC.busy && !memC.err && !pool.length,
      carAPoolEmptyTxt: pq ? '找不到符合的成員' : '名冊是空的',
      carARoles: [['', '自動'], ['s6', 'S6'], ['pusher', '推手']].map(([v, n]) => Object.assign({ v, n, sel: dropRole === v ? 'true' : 'false' }, segOn(dropRole === v))),
      carAPickShow: !!pick, carAPickTxt: pick ? '已選「' + pick + '」：點座位放進去（身分：' + roleName[dropRole] + '），可連續放好幾格' + (pickRun ? '；點 P1 格＝指定他當那個時段的跑者' : '') : '',
      carAPoolHelp: '拖到座位＝排進去（身分照上面選的）　·　座位上的人拖回這裡＝移出　·　拖到同一班的另一格＝兩人互換' + (teamOn ? '　·　拖到 P1 格＝指定成那個時段的跑者' : '') + '　·　手機：點一下成員，再點座位',

      /* 跑者（車隊模式、管理員）：表格／手機點跑者＝開小視窗；看板的 P1 格先看成員池有沒有點選中的人 */
      onCarRunner: e => { e.stopPropagation(); this.carRunClick(e.currentTarget, false); },
      onCarP1Cell: e => { if (e.target && e.target.closest && e.target.closest('button')) return; this.carRunClick(e.currentTarget, false); },       // 表格：整個 P1 格都能點
      onCarARunner: e => { e.stopPropagation(); this.carRunClick(e.currentTarget, true); },
      onCarAP1Cell: e => { if (e.target && e.target.closest && e.target.closest('button')) return; this.carRunClick(e.currentTarget, true); },   // 整個 P1 格都能點（名字那顆按鈕自己處理）
      onCarRunSet: () => this.carRunSubmit(false),
      onCarRunReset: () => this.carRunSubmit(true),
      onCarRunKey: e => { if (this.carFEnter(e)) { e.preventDefault(); this.carRunSubmit(false); } },
      onCarRunChain: e => this.setState({ carRunChain: !!e.target.checked }),
      onCarRDragOver: e => { const g = this._carDrag; if (!teamOn || !g || !g.nm || g.pos) return; e.preventDefault(); try { e.currentTarget.classList.add('car-over'); } catch (er) {} },
      onCarRDrop: e => {
        e.preventDefault(); try { e.currentTarget.classList.remove('car-over'); } catch (er) {}
        const g = this._carDrag; this._carDrag = null;
        if (!teamOn || !g || !g.nm || g.pos) return;        // 只收成員池／候補的名字；座位上的人（帶 pos）不當跑者拖
        this.carRunPlace(e.currentTarget, g.nm, false);
      },
      onCarARunTool: e => this.carARunTool(e.currentTarget.dataset.act === 'reset'),
      onCarARunToolKey: e => { if (this.carFEnter(e)) { e.preventDefault(); this.carARunTool(false); } },

      onCarATool: e => this.setState({ carATool: String(e.currentTarget.dataset.v || 'run') }),
      onCarASignRole: e => this.setState({ carASignRole: e.currentTarget.dataset.v === 's6' ? 's6' : 'pusher' }),
      onCarARole: e => { const v = String(e.currentTarget.dataset.v || ''); this.setState({ carARole: v === 's6' || v === 'pusher' ? v : '' }); },
      onCarARun: e => this.carARun(e.currentTarget.dataset.act === 'unmark' ? 'unmark' : 'mark'),
      onCarAProxy: e => this.carAProxy(e.currentTarget.dataset.act === 'cancel' ? 'cancel' : 'add'),
      onCarASelf: e => this.carASelf(e.currentTarget.dataset.act === 'cancel' ? 'cancel' : 'add'),
      onCarACopy: e => this.carACopy(e.currentTarget.dataset.p === '1'),
      onCarARange: e => { const a = String(e.currentTarget.dataset.act || ''); if (a === 'clear' || a === 'lock' || a === 'unlock') this.carARangeAct(a); },
      onCarAQuick: e => this.carAQuick(e.currentTarget.dataset.act),
      onCarAUnmark: e => { const d = e.currentTarget.dataset; this.carAUnmark(d.d, d.h); },
      /* 成員那一列的「報班」：打開選身分（推手／S6）的小視窗；取消則直接走原本的 carSign（有確認） */
      onCarARowSign: e => { const d = e.currentTarget.dataset; if (d.act === 'cancel') this.carSign(d.d, d.h, 'cancel'); else this.carOpenPop('empty', e.currentTarget); },
      onCarAPoolPick: e => { const nm = String(e.currentTarget.dataset.nm || ''); this.setState({ carAPick: this.state.carAPick === nm ? '' : nm, carPop: null }); },
      onCarAPoolKey: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const nm = String(e.currentTarget.dataset.nm || ''); this.setState({ carAPick: this.state.carAPick === nm ? '' : nm, carPop: null }); } },
      onCarAPickClear: () => this.setState({ carAPick: '' }),
      onCarASeat: e => { if (this.state.carAPick && this.state.carView === 'board') this.carAPlaceAt(e.currentTarget); else this.carOpenPop('seat', e.currentTarget); },
      onCarAEmpty: e => { if (this.state.carAPick && this.state.carView === 'board') this.carAPlaceAt(e.currentTarget); else this.carOpenPop('empty', e.currentTarget); },
      onCarAMemRetry: () => this.carAMemLoad(true),
    };
  },

  CAR_MB_ID: { pusher: '推者', runner: '跑者', s6: 'S6專職', '跑推兼任': '跑推兼任', 'pusher+s6': '推者+S6', '跑推+s6': '跑推+S6' },

  carSec_members(force) {
    if (!force && this.state.carMbEdit) this.setState({ carMbEdit: null });   // 從別的分頁切回來：不要冒出上次沒關的編輯視窗
    this.carMbLoad(force);
    if (this.state.carMbView === 'online') this.carMbOnline(force);
  },

  carMbLoad(force) { return this.carSecFetch(this.carSecKey('members'), '/members', {}, force); },

  carMbSearch(raw) {
    clearTimeout(this._carMbQT);
    const q = String(raw || '').trim();
    const sec = this.carSecOf(this.carSecKey('members')), d = sec && sec.data;
    const n = d && Array.isArray(d.members) ? d.members.length : 0;
    if (!q || !d || !((+d.total || 0) > n)) return;
    const gid = String(this.state.g || ''), seq = this._carMbQSeq = (this._carMbQSeq || 0) + 1;
    this._carMbQT = setTimeout(async () => {
      let r;
      try { r = await this.carApi('/members', { query: { q } }); }
      catch (e) { r = { members: [], total: 0, err: (e && e.message) || '搜尋失敗' }; }
      if (seq !== this._carMbQSeq || String(this.state.g || '') !== gid) return;   // 已經打了新的字或換了車隊
      this.setState({ carMbSrv: { gid, q, list: Array.isArray(r.members) ? r.members : [], total: +r.total || 0, err: String(r.err || '') } });
    }, 250);
  },

  carMbFind(uid) {
    const sec = this.carSecOf(this.carSecKey('members')), d = sec && sec.data;
    const srv = this.state.carMbSrv;
    const all = [].concat((d && Array.isArray(d.members)) ? d.members : [], (srv && Array.isArray(srv.list)) ? srv.list : []);
    return all.find(x => x && x.uid != null && String(x.uid) === String(uid)) || null;
  },

  carMbOpen(uid) {
    const m = this.carMbFind(uid); if (!m) { this._toast('找不到這位成員，請重新整理'); return; }
    const num = v => (v === null || v === undefined || v === '' || !isFinite(+v) || +v === 0) ? '' : String(+v);
    const pw = +m.power > 0 ? String(+(+m.power / 10000).toFixed(4)) : '';
    const al = (Array.isArray(m.aliases) ? m.aliases : []).filter(a => typeof a === 'string' && a.trim()).join('、');
    const f = { gid: String(this.state.g || ''), uid: String(m.uid), name: String(m.name || ''), identity: String(m.identity || ''), b0: num(m.bonus), s0: num(m.s6_bonus), p0: pw, a0: al };
    this.setState({ carMbEdit: f, carMbFB: f.b0, carMbFS: f.s0, carMbFP: f.p0, carMbFA: f.a0 });
    if (!this._carMbEsc) {   // Esc 關閉（全站的 _closeAll 不認得這個視窗）
      this._carMbEsc = e => { if (e.key === 'Escape' && this.state.carMbEdit) this.setState({ carMbEdit: null }); };
      document.addEventListener('keydown', this._carMbEsc);
    }
  },

  carMbAliases(raw) {
    const seen = new Set(), out = [];
    String(raw == null ? '' : raw).split(/[,，、\n]/).map(x => x.trim()).filter(Boolean).forEach(a => { if (!seen.has(a)) { seen.add(a); out.push(a); } });
    return out;
  },

  carMbPower(raw) {
    let t = String(raw == null ? '' : raw).trim().replace(/[,，\s]/g, '');
    if (!t) return '';
    const wan = /[萬万wW]$/.test(t); if (wan) t = t.slice(0, -1);
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    const v = +t;
    return (wan || v < 1000) ? Math.round(v * 10000) : Math.round(v);
  },

  async carMbSave() {
    const s = this.state, f = s.carMbEdit; if (!f || s.carActBusy) return;
    const body = { uid: f.uid }, bad = [];
    const rate = (raw, lb, k, orig) => {
      const t = String(raw == null ? '' : raw).trim(); if (t === '' || t === orig) return;
      if (!/^\d+(\.\d+)?$/.test(t)) { bad.push(lb + '格式錯誤（例：3.66）'); return; }
      const v = +t;
      if (v !== 0 && !(v >= 1.18 && v <= 3.88)) { bad.push(lb + '須為 0 或 1.18～3.88'); return; }
      if ((orig === '' ? 0 : +orig) === v) return;          // 3.9 對 3.90、空白對 0 都算沒改
      body[k] = v;
    };
    rate(s.carMbFB, '推手倍率', 'bonus', f.b0);
    rate(s.carMbFS, 'S6 倍率', 's6_bonus', f.s0);
    const pt = String(s.carMbFP == null ? '' : s.carMbFP).trim();
    if (pt !== '' && pt !== f.p0) {
      const p = this.carMbPower(pt);
      if (p === null) bad.push('綜合力格式錯誤（例：35.2 或 352000）');
      else if (p !== this.carMbPower(f.p0)) body.power = p;
    }
    const al = this.carMbAliases(s.carMbFA);
    if (al.length > 10) bad.push('別名最多 10 個（目前 ' + al.length + ' 個）');
    else if (al.join('、') !== this.carMbAliases(f.a0).join('、')) body.aliases = al;
    if (bad.length) { this._toast(bad[0], 2600); return; }
    if (Object.keys(body).length < 2) { this._toast('沒有變更'); return; }
    const d = await this.carAct('/member', body, r => (r && r.pending) ? String(r.msg || '已送出，稍後更新')
      : (String((r && r.name) || f.name) + '：' + String((r && r.changed) || '已更新')));
    if (!d) return;
    this.setState({ carMbEdit: null, carMembers: null, carMbSrv: null });   // carMembers＝班表彈出框的成員清單快取，倍率變了要重抓
    this.carMbLoad(true);
    if (this.state.carMbQ) this.carMbSearch(this.state.carMbQ);
    if (d.pending) setTimeout(() => this.carMbLoad(true), 5000);
  },

  async carMbOnline(force, quiet) {
    const gd = this.carGuild(); if (!gd) return null;
    const key = this.carSecKey('mbonline'), cur = this.carSecOf(key);
    this.carMbPoll();
    if (!force && cur && (cur.busy || (cur.data && Date.now() - (cur.at || 0) < 8000))) return cur.data;
    if (this._carMbOnBusy) return null;
    this._carMbOnBusy = true;
    const gid = String(gd.gid), cars = this.carCars(gd);
    if (!quiet) this.carSecPut(key, { busy: true, err: '' });
    try {
      // 機器人自己回的 503（例如「伺服器不在線」＝讀不到這個 Discord 伺服器）帶中文說明，不要被 carApi 換成「連不上」
      const why = e => (e && e.code === 'not_found') ? '機器人版本不支援這個功能，請更新機器人'
        : (e && e.status === 503 && e.data && typeof e.data.error === 'string' && /[^\x00-\x7f]/.test(e.data.error)) ? ('機器人回報：' + e.data.error.slice(0, 80))
        : ((e && e.message) || '讀取失敗');
      const res = await Promise.all(cars.map(c => this.carApi('/online', { gid, car: c.no }).then(
        d => ({ no: c.no, name: c.name, d, err: '' }),
        e => ({ no: c.no, name: c.name, d: null, err: why(e) }))));
      if (String(this.state.g || '') !== gid) return null;          // 讀到一半換了車隊
      const ok = res.some(r => r.d), prev = this.carSecOf(key);
      const firstErr = (res.find(r => r.err) || {}).err || '讀取失敗';
      this.carSecPut(key, ok ? { data: { cars: res }, err: '', busy: false, at: Date.now() }
        : { data: (quiet && prev && prev.data) || null, err: firstErr, busy: false, at: (prev && prev.at) || 0 });
      return ok ? { cars: res } : null;
    } finally { this._carMbOnBusy = false; }
  },

  carMbPoll() {
    if (this._carMbPollT) return;
    this._carMbPollT = setInterval(() => {
      const s = this.state;
      if (s.page !== 'car' || s.carTab !== 'members' || s.carMbView !== 'online' || !this.carGuild()) { clearInterval(this._carMbPollT); this._carMbPollT = null; return; }
      if ((typeof document !== 'undefined' && document.hidden) || this._carMbOnBusy) return;
      this.carMbOnline(true, true);
    }, 10000);
  },

  carSecVals_members(c) {
    const { s, gd, admin, segOn } = c;
    const view = s.carMbView === 'online' ? 'online' : 'roster';
    const gid = String(gd.gid), isDc = /^\d+$/.test(gid);
    const fmt = v => (v === null || v === undefined || v === '' || !isFinite(+v) || +v === 0) ? '—' : (+v).toFixed(2);
    const sec = this.carSecOf(this.carSecKey('members'));
    const d = sec && sec.data, all = (d && Array.isArray(d.members)) ? d.members.filter(x => x && typeof x === 'object') : [];
    const total = d ? Math.max(+d.total || 0, all.length) : 0;
    const on = this.carSecOf(this.carSecKey('mbonline'));
    const od = on && on.data, oc = (od && Array.isArray(od.cars)) ? od.cars : [];
    const g0r = oc.find(r => r && r.d && typeof r.d === 'object'), g0 = g0r ? g0r.d : null;
    const out = {
      carMbIsRoster: view === 'roster', carMbIsOnline: view === 'online', carMbAdmin: admin,
      carMbViews: [['roster', '名冊', d ? String(total) : ''], ['online', '在線人員', g0 ? String((isDc ? +g0.voice_total : +g0.web_total) || 0) : '']]
        .map(([v, n, cnt]) => Object.assign({ v, n, cnt, sel: v === view ? 'true' : 'false', cntFg: v === view ? 'var(--accent-deep)' : 'var(--text-3)' }, segOn(v === view))),
      onCarMbView: e => { const v = e.currentTarget.dataset.v === 'online' ? 'online' : 'roster'; this.setState({ carMbView: v }); if (v === 'online') setTimeout(() => this.carMbOnline(false), 0); },
      onCarMbQ: e => { const v = e.target.value; this.setState({ carMbQ: v }); this.carMbSearch(v); },
      onCarMbRetry: () => this.carMbLoad(true),
      onCarMbOnRetry: () => this.carMbOnline(true),
      onCarMbEdit: e => this.carMbOpen(e.currentTarget.dataset.uid),
      onCarMbClose: () => this.setState({ carMbEdit: null }),
      onCarMbSave: () => this.carMbSave(),
      // Enter 儲存；中文輸入法選字時的 Enter 不算（Safari 選字那一下 isComposing 是 false、keyCode 是 229）
      onCarMbKey: e => { if (e.key !== 'Enter' || e.keyCode === 229 || (e.nativeEvent && e.nativeEvent.isComposing)) return; e.preventDefault(); this.carMbSave(); },
      // 手機底部抽屜下滑關閉（全站手勢呼叫的 _closeAll 不認得這個視窗，自己處理）
      onCarMbTs: e => { const t = e.touches && e.touches[0]; this._carMbT0 = t && e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null; },
      onCarMbTe: e => {
        const a = this._carMbT0, t = e.changedTouches && e.changedTouches[0]; this._carMbT0 = null;
        if (!a || !t || !this.state.mobile) return;
        const dx = t.clientX - a.x, dy = t.clientY - a.y;
        if (dy > 90 && dy > Math.abs(dx) * 1.5 && e.currentTarget.scrollTop <= 0) this.setState({ carMbEdit: null });
      },
    };

    if (view === 'roster') {
      const qRaw = String(s.carMbQ || '').trim(), q = qRaw.toLowerCase();
      const trunc = total > all.length;
      const srv = (q && trunc && s.carMbSrv && s.carMbSrv.gid === gid && String(s.carMbSrv.q).toLowerCase() === q) ? s.carMbSrv : null;
      let list = all;
      if (q && srv) list = (srv.list || []).filter(x => x && typeof x === 'object');
      else if (q) list = all.filter(m => String(m.name || '').toLowerCase().includes(q)
        || (Array.isArray(m.aliases) ? m.aliases : []).some(a => String(a).toLowerCase().includes(q))
        || (admin && m.uid != null && String(m.uid).toLowerCase().includes(q)));
      const rows = list.slice(0, 300).map(m => {
        const al = (Array.isArray(m.aliases) ? m.aliases : []).filter(a => typeof a === 'string' && a.trim()).map(a => a.trim());
        const idc = String(m.identity || ''), id = this.CAR_MB_ID[idc] || idc;
        const pw = +m.power > 0 ? (+m.power / 10000).toFixed(1) + ' 萬' : '—';
        const uid = m.uid != null ? String(m.uid) : '';
        return { uid, canEdit: admin && !!uid, name: String(m.name || '') || '（未命名）', id, hasId: !!id,
          bonus: fmt(m.bonus), s6: fmt(m.s6_bonus), s6Fg: +m.s6_bonus > 0 ? 'var(--car-s6)' : 'var(--text-3)', power: pw,
          al: al.length ? al.join('、') : '—', hasAl: al.length > 0, alTxt: '別名：' + al.join('、'),
          line: '倍率 ' + fmt(m.bonus) + ' · S6 ' + fmt(m.s6_bonus) + (admin ? ' · 綜合 ' + pw : '') };
      });
      const head = admin ? [['名稱', 'left'], ['倍率', 'right'], ['S6', 'right'], ['綜合', 'right'], ['別名', 'left'], ['', 'right']]
        : [['名稱', 'left'], ['倍率', 'right'], ['S6', 'right'], ['別名', 'left']];
      const shown = q ? (srv ? srv.total : list.length) : total;
      let more = '';
      if (q && trunc && !srv) more = '成員超過 300 位，正在向機器人搜尋全部名單…';
      else if (srv && srv.err) more = '搜尋全部名單失敗：' + srv.err;
      else if (srv && srv.total > srv.list.length) more = '符合的人太多，只列出倍率最高的 ' + srv.list.length + ' 位。';
      else if (!q && trunc) more = '成員太多，這裡只列出倍率最高的 ' + all.length + ' 位；用上面的搜尋可以找到其他人。';
      Object.assign(out, {
        carMbQ: s.carMbQ || '', carMbQPh: admin ? '搜尋名稱、別名或 ID' : '搜尋名稱或別名', carMbQW: s.mobile ? '100%' : '320px',
        carMbLoading: !d && !(sec && sec.err), carMbErr: (!d && sec && sec.err) ? String(sec.err) : '', carMbReady: !!d,
        carMbCnt: q ? ('符合 ' + shown + ' / ' + total + ' 人') : (total + ' 人'),
        carMbNote: admin ? '點「編輯」修改倍率、綜合力與別名' : '倍率有誤請找管理員更新',
        carMbWide: !s.mobile && rows.length > 0, carMbNarrow: !!s.mobile,
        carMbCols: admin ? 'minmax(0,1.25fr) 58px 58px 70px minmax(0,1.5fr) 60px' : 'minmax(0,1.3fr) 58px 58px minmax(0,1.7fr)',
        carMbHead: head.map(([n, al]) => ({ n, al })),
        carMbRows: rows,
        carMbEmpty: !rows.length && !(q && trunc && !srv),
        carMbEmptyTxt: q ? ('找不到符合「' + qRaw + '」的成員。') : '還沒有登記的成員。成員要先在車隊裡用機器人的成員指令登記，這裡才會出現。',
        carMbMore: !!more, carMbMoreTxt: more,
      });
      /* 編輯視窗（管理員；只認這個車隊的） */
      const f = (admin && s.carMbEdit && s.carMbEdit.gid === gid) ? s.carMbEdit : null;
      if (f) {
        const pv = this.carMbPower(s.carMbFP), als = this.carMbAliases(s.carMbFA);
        Object.assign(out, {
          carMbEditShow: true, carMbEName: f.name || '（未命名）', carMbEId: this.CAR_MB_ID[f.identity] || f.identity, carMbEHasId: !!f.identity, carMbEUid: 'ID ' + f.uid,
          carMbFB: s.carMbFB == null ? '' : String(s.carMbFB), carMbFS: s.carMbFS == null ? '' : String(s.carMbFS),
          carMbFP: s.carMbFP == null ? '' : String(s.carMbFP), carMbFA: s.carMbFA == null ? '' : String(s.carMbFA),
          carMbFPHint: pv === null ? '格式不對：填 35.2（萬）或 352000' : pv === '' ? '留空＝不改' : ('＝ ' + String(pv).replace(/\B(?=(\d{3})+$)/g, ',')),
          carMbFAHint: als.length > 10 ? ('目前 ' + als.length + ' 個，最多 10 個') : (als.length + ' / 10 個別名'),
          carMbFAFg: als.length > 10 ? 'color-mix(in oklab,#d64533 55%,var(--car-fg))' : 'var(--text-3)',
          carMbFPFg: pv === null ? 'color-mix(in oklab,#d64533 55%,var(--car-fg))' : 'var(--text-3)',
          carMbAF: !s.mobile,
          carMbSaveBtn: s.carActBusy ? '處理中…' : '儲存',
        });
      } else out.carMbEditShow = false;
      return out;
    }

    /* ===== 在線人員 ===== */
    const ago = a => { a = Math.max(0, Math.floor(+a || 0)); return a < 60 ? '剛剛' : Math.floor(a / 60) + ' 分鐘前'; };
    const cap = hex => ({ bg: 'color-mix(in oklab,' + hex + ' 15%,var(--card))', fg: 'color-mix(in oklab,' + hex + ' 55%,var(--car-fg))' });
    const OK = cap('#2f9e57'), WARN = cap('#d9822b'), BAD = cap('#d64533'), NEU = { bg: 'var(--card-2)', fg: 'var(--text-3)' };
    const multi = oc.length > 1;
    const duty = oc.map(r => {
      const dd = r && r.d && typeof r.d === 'object' ? r.d : null;
      const planned = !!(dd && dd.run_planned);
      const rows = planned && Array.isArray(dd.onduty) ? dd.onduty.map(x => {
        x = x && typeof x === 'object' ? x : {};
        const has = !!x.name, v = has ? (x.voice ? OK : WARN) : NEU, k = has ? (x.checked ? OK : BAD) : NEU;
        return { pos: String(x.pos || ''), has, name: has ? String(x.name) : '空', nameFg: has ? 'var(--ink)' : 'var(--text-3)', s6: has && x.role === 's6',
          vShow: isDc && has, vTxt: has ? (x.voice ? '#' + String(x.voice) : '未進語音') : '', vBg: v.bg, vFg: v.fg,
          cShow: has, cTxt: has ? (x.checked ? '已簽到' : '未簽到') : '', cBg: k.bg, cFg: k.fg };
      }) : [];
      const seated = rows.filter(x => x.has);
      const sum = planned ? ('就位 ' + seated.length + '/' + rows.length + (isDc ? ' · 語音 ' + seated.filter(x => x.vTxt !== '未進語音').length + '/' + seated.length : '')
        + ' · 簽到 ' + seated.filter(x => x.cTxt === '已簽到').length + '/' + seated.length) : '';
      const slot = dd ? this.carSlot(dd.hour) : '';
      return { t: (multi ? String((r && r.name) || '') + ' · ' : '') + (slot || '目前時段'), sum, hasSum: !!sum,
        err: r && r.err ? String(r.err) : '', hasErr: !!(r && r.err && !dd),
        isIdle: !!dd && !planned, idle: (slot ? slot + ' ' : '') + '這個時段沒有開跑',
        rows, cols: isDc ? '34px minmax(0,1fr) minmax(0,auto) auto' : '34px minmax(0,1fr) auto' };
    });
    const voice = (g0 && Array.isArray(g0.voice) ? g0.voice : []).filter(v => v && typeof v === 'object').map(v => {
      const mem = (Array.isArray(v.members) ? v.members : []).filter(p => p && typeof p === 'object');
      return { ch: '#' + String(v.channel || ''), cnt: String(+v.count || mem.length) + ' 人',
        mem: mem.map(p => ({ n: String(p.name || p.display || '?'), title: p.display && String(p.display) !== String(p.name) ? 'Discord 名稱：' + String(p.display) : '',
          bg: p.crew ? 'color-mix(in oklab,var(--accent) 13%,var(--card))' : 'var(--card-2)', fg: p.crew ? 'var(--ink)' : 'var(--text-2)',
          fl: [p.deaf ? '拒聽' : (p.mute ? '靜音' : ''), p.stream ? '直播' : ''].filter(Boolean) })) };
    });
    const web = (g0 && Array.isArray(g0.web) ? g0.web : []).filter(w => w && typeof w === 'object')
      .map(w => ({ n: String(w.name || '?'), adm: w.role === 'admin', page: w.page ? String(w.page) : '', hasPage: !!w.page, ago: ago(w.ago) }));
    const pres = (g0 && g0.presence && typeof g0.presence === 'object')
      ? [['online', '線上', '#2f9e57'], ['idle', '閒置', '#e0a100'], ['dnd', '忙碌', '#d64533']].map(([k, lb, dot]) => {
        const a = Array.isArray(g0.presence[k]) ? g0.presence[k].map(String) : [];
        return { lb, dot, n: String(a.length), names: a.length ? a.join('、') : '—' };
      }) : [];
    const stats = g0 ? [isDc ? ['語音', +g0.voice_total || 0] : null, ['網頁', +g0.web_total || web.length], ['車隊', +g0.crew_total || 0]].filter(Boolean).map(([k, v]) => ({ k, v: String(v) + ' 人' })) : [];
    const pad = n => String(n).padStart(2, '0');
    const at = on && on.at && od ? new Date(on.at) : null;
    Object.assign(out, {
      carMbOnLoading: !od && !(on && on.err), carMbOnErr: (!od && on && on.err) ? String(on.err) : '', carMbOnReady: !!od,
      carMbOnAt: '每 10 秒自動更新' + (at ? ' · ' + pad(at.getHours()) + ':' + pad(at.getMinutes()) + ':' + pad(at.getSeconds()) : ''),
      carMbOnStale: (od && on && on.err) ? String(on.err) : '',
      carMbOnStats: stats,
      carMbDuty: duty,
      carMbOnCols: s.mobile ? 'minmax(0,1fr)' : 'minmax(0,1.15fr) minmax(0,1fr)',
      carMbVoice: voice, carMbVoiceEmpty: !voice.length,
      carMbVoiceTxt: isDc ? '目前沒有人在語音頻道。' : 'QQ 車隊沒有 Discord 語音頻道，這裡不會有資料。',
      carMbVoiceNote: voice.length ? '有底色的是車隊成員。' : '',
      carMbWeb: web, carMbWebEmpty: !web.length,
      carMbPres: pres, carMbPresShow: pres.length > 0,
      carMbEditShow: false,
    });
    return out;
  },

  CAR_ST_VIEWS: [['insight', '缺額分析'], ['hist', '歷史班表'], ['seidan', '色段監控']],

  CAR_SEI_ALERTS: [['alerted_stale', 'Auto 停止'], ['alerted_slow', '多人周回偏低'], ['alerted_doosen', '豆森偵測'], ['alerted_pt', 'Pt 異常'], ['alerted_poor_form', '狀態不佳']],

  CAR_SEI_MODES: { auto: 'Auto', multi: '多人', unknown: '偵測中', single: '單人' },

  carStView() { const v = this.state.carStView; return this.CAR_ST_VIEWS.some(x => x[0] === v) ? v : 'insight'; },

  carSeiCur() { const d = this.state.carSeiDet; return d && d.pid && String(d.g) === String(this.state.g || '') ? d : null; },

  carSec_stats(force) {
    if (!this._carStT) this._carStT = setInterval(() => this.carStTick(), 10000);
    const v = this.carStView();
    if (v === 'hist') return this.carStHistLoad(force);
    if (v === 'seidan') return this.carStSeiLoad(force);
    return this.carSecFetch(this.carSecKey('insight', true), '/insight', {}, force);
  },

  carStTick() {
    const s = this.state;
    if (s.page !== 'car' || s.carTab !== 'stats' || (typeof document !== 'undefined' && document.hidden) || !this.carGuild()) return;
    const v = this.carStView(), now = Date.now();
    if (v === 'insight') {
      const key = this.carSecKey('insight', true), cur = this.carSecOf(key);
      if (!cur || cur.busy || !cur.data || now - (cur.at || 0) < 20000) return;
      const g0 = String(s.g || '');
      this.carSecPut(key, { at: now });
      this.carApi('/insight', {}).then(d => { if (String(this.state.g || '') === g0 && d) this.carSecPut(key, { data: d, err: '', at: Date.now() }); }, () => {});
    } else if (v === 'seidan') {
      const ed = this.carSeiEdCur(), det = this.carSeiCur();
      if (ed) {                                   // 設定面板：草稿不動也每 60 秒重算一次（機器人那邊一直有新的場次）
        const pv = this.carSecOf(this.carSecKey('seipv') + ':' + ed.pid);   // 預覽失敗過：15 秒後自動重試
        if (pv && !pv.busy && now - Math.max(pv.at || 0, pv.errAt || 0) >= (pv.err ? 15000 : 60000)) this.carSeiPv(true);
      } else if (det) {                           // 完整紀錄頁：判定分析每 60 秒更新
        const an = this.carSecOf(this.carSeiAnKey(det.pid));
        if (an && an.data && !an.busy && now - (an.at || 0) >= 60000) this.carSeiAnLoad(det.pid, true);
      } else {
        const cur = this.carSecOf(this.carSecKey('seidan'));
        if (cur && cur.data && !cur.busy && cur.live !== 'busy' && now - (cur.at || 0) >= 60000) this.carStSeiLoad(true);
      }
    }
  },

  carStHistPick(idx) {
    const list = idx && Array.isArray(idx.dates) ? idx.dates.filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(String(x.date))) : [];
    const want = String(this.state.carHistDate || ''), today = String((idx && idx.today) || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(want)) return want;
    if (today && list.some(x => x.date === today)) return today;
    return list[0] ? String(list[0].date) : '';
  },

  async carStHistLoad(force) {
    const ik = this.carSecKey('histidx', true);
    const got = await this.carSecFetch(ik, '/history', { query: { dates: '1' } }, force);
    const idx = got || (this.carSecOf(ik) || {}).data;
    const date = idx ? this.carStHistPick(idx) : '';
    if (date) return this.carStHistDay(date, force);
    return null;
  },

  carStHistDay(date, force) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null;
    return this.carSecFetch(this.carSecKey('histday', true) + ':' + date, '/history', { query: { date } }, force);
  },

  async carStSeiLoad(force) {
    const det = this.carSeiCur();
    if (det) { this.carSeiAnLoad(det.pid, force); return this.carStSeiDetail(det.pid, force); }
    if (this.carSeiEdCur()) { this.carSeiPv(!!force); this.carSeiMetaLoad(!!force); }
    const key = this.carSecKey('seidan'), cur = this.carSecOf(key), g0 = String(this.state.g || '');
    if (cur && (cur.busy || cur.live === 'busy')) return null;
    if (cur && cur.data && !force && Date.now() - (cur.at || 0) < 15000) return null;
    if (!cur || !cur.data) {
      const quick = await this.carSecFetch(key, '/seidan', { query: { live: '0' } }, true);
      if (!quick || !Array.isArray(quick.players) || !quick.players.length || String(this.state.g || '') !== g0) return null;
    }
    this.carSecPut(key, { live: 'busy' });
    try {
      const d = await this.carApi('/seidan', { gid: g0 });
      if (String(this.state.g || '') !== g0) return null;
      this.carSecPut(key, { data: d, err: '', live: d && d.live_ok ? 'ok' : 'off', at: Date.now() });
    } catch (e) {
      if (String(this.state.g || '') === g0) this.carSecPut(key, { live: 'fail', at: Date.now() });
    }
    return null;
  },

  carStSeiDetail(pid, force) {
    return this.carSecFetch(this.carSecKey('seidet') + ':' + pid, '/seidan/detail', { query: { pid: String(pid), limit: '60' } }, force);
  },

  async carStSeiMore(pid) {
    const key = this.carSecKey('seidet') + ':' + pid, cur = this.carSecOf(key), d0 = cur && cur.data;
    if (!d0 || cur.more || cur.busy) return;
    const have = Array.isArray(d0.rounds) ? d0.rounds : [], g0 = String(this.state.g || '');
    this.carSecPut(key, { more: true });
    try {
      const d = await this.carApi('/seidan/detail', { query: { pid: String(pid), limit: '100', offset: String(have.length) } });
      if (String(this.state.g || '') !== g0) return;
      const seen = {}; have.forEach(r => { seen[String(r && r.time)] = 1; });      // 兩次之間又上分，位移會重疊：用時間去重
      const add = (Array.isArray(d.rounds) ? d.rounds : []).filter(r => r && !seen[String(r.time)]);
      this.carSecPut(key, { more: false, data: Object.assign({}, d0, { rounds: have.concat(add), total_rounds: d.total_rounds != null ? d.total_rounds : d0.total_rounds }) });
    } catch (e) {
      this.carSecPut(key, { more: false });
      this._toast(e.message || '讀取失敗');
    }
  },

  carStSeiPatch(pid, patch) {
    const key = this.carSecKey('seidan'), sec = this.carSecOf(key), d = sec && sec.data;
    if (!d || !Array.isArray(d.players)) return;
    const players = d.players.map(p => {
      if (!p || String(p.pid) !== String(pid)) return p;
      const q = Object.assign({}, p, patch);
      if (Object.prototype.hasOwnProperty.call(patch, 'nickname')) q.name = String(patch.nickname || '') || p.player_name || String(p.player_id || p.pid);
      return q;
    });
    this.carSecPut(key, { data: Object.assign({}, d, { players }) });
  },

  carStSeiFind(pid) {
    const sec = this.carSecOf(this.carSecKey('seidan')), d = sec && sec.data;
    return (d && Array.isArray(d.players) ? d.players : []).find(p => p && String(p.pid) === String(pid)) || null;
  },

  async carStSeiToggle(pid) {
    const p = this.carStSeiFind(pid); if (!p) return;
    const nm = String(p.name || p.pid);
    if (p.enabled && !window.confirm('確定停用「' + nm + '」的色段監控？\n\n停用後機器人不再追蹤這位玩家的分數，也不會發出任何警報。之後可以再按「啟用監控」恢復，過去的紀錄會保留。')) return;
    const d = await this.carAct('/seidan', { pid: String(pid), action: 'toggle' }, r => (r && r.enabled ? '已啟用「' + nm + '」的監控' : '已停用「' + nm + '」的監控'));
    if (d) this.carStSeiPatch(pid, { enabled: !!d.enabled });
  },

  async carStSeiClear(pid) {
    const p = this.carStSeiFind(pid); if (!p) return;
    const nm = String(p.name || p.pid);
    if (!window.confirm('確定重置「' + nm + '」的警報？\n\n已觸發過的警報（例如 Auto 停止、狀態不佳）會清掉重新計算，條件再次成立時機器人會再通知一次。')) return;
    const d = await this.carAct('/seidan', { pid: String(pid), action: 'clear_alerts' }, '已重置「' + nm + '」的警報');
    if (d) { const a = {}; this.CAR_SEI_ALERTS.forEach(([k]) => { a[k] = false; }); this.carStSeiPatch(pid, { alerts: a }); }
  },

  CAR_SEI_GROUPS: [
    ['judge', '判定', '單場分數達門檻算多人場。近 5 場有幾成達門檻就判多人；有效場數不到 3 場時，改用上下兩條線防止模式來回跳。'],
    ['stale', '斷 auto', 'Auto 模式連續幾分鐘沒上分，就在通知頻道提醒並 @ 身分組；之後每隔幾分鐘重複一次，重複填 0＝只提醒一次。'],
    ['pf', '狀態不佳', '單場低於近幾小時最高分的這個比例，就發「狀態不佳」；打回最高分以上之後，下次再掉才會再發。'],
    ['doo', '豆森／Pt 異常', '豆森：一次輪詢（約 1 分鐘）內分數增加超過單場的幾倍，或兩局間隔很短。Pt 異常：單場跟前 10 場中位數差太多倍。兩種都只發一次，重置警報後才會再發。'],
    ['multi', '多人效率', '多人模式時每個視窗結算一次（視窗到期後的下一場上分時），場數低於最低場數就警報。'],
    ['misc', '紀錄與停用', '分數快照給控分預估與時速用；太久抓不到分數（不在前百或榜線上）會自動停用監控。'],
  ],

  CAR_SEI_FIELDS: [
    ['thresh', 'judge', '判定門檻（單場分數）', 'int', '分', 20000, 200000, 1000],
    ['mode_vote_ratio', 'judge', '近 5 場判多人的比例', 'pct', '%', 30, 100, 5],
    ['hyst_up', 'judge', 'Auto → 多人（門檻 ×）', 'x', '倍', 1, 2, 0.05],
    ['hyst_down', 'judge', '多人 → Auto（門檻 ×）', 'x', '倍', 0.3, 1, 0.05],
    ['auto_stale_enabled', 'stale', '斷 auto 提醒', 'bool'],
    ['auto_stale_trigger', 'stale', '沒上分幾分鐘提醒', 'int', '分鐘', 1, 60, 1],
    ['auto_stale_repeat', 'stale', '之後每隔幾分鐘重複', 'int', '分鐘', 0, 60, 1],
    ['poor_form_hours', 'pf', '看近幾小時的最高分', 'int', '小時', 1, 24, 1],
    ['poor_form_ratio', 'pf', '低於最高分的', 'pct', '%', 50, 100, 1],
    ['poor_form_public', 'pf', '在通知頻道公開', 'bool', '', 0, 0, 0, 1],
    ['poor_form_dm', 'pf', '私訊指定對象', 'bool', '', 0, 0, 0, 1],
    ['doosen_rate', 'doo', '一次輪詢增加 ≥ 單場的', 'x', '倍', 1.1, 5, 0.1],
    ['doosen_sec', 'doo', '或兩局間隔 ≤', 'int', '秒', 0, 120, 5],
    ['pt_outlier', 'doo', 'Pt 異常：對中位數倍差 ≥', 'x', '倍', 1.2, 6, 0.1],
    ['multi_window_min', 'multi', '視窗長度', 'int', '分鐘', 5, 120, 5],
    ['multi_min_rounds', 'multi', '視窗內最少場數', 'int', '場', 1, 60, 1],
    ['snapshot_every', 'misc', '每幾次輪詢記一筆快照', 'int', '次', 1, 60, 1],
    ['auto_disable_days', 'misc', '幾天抓不到分數自動停用', 'int', '天', 1, 60, 1],
    ['runner_alert_cooldown_sec', 'notify', '跑者通知冷卻', 'int', '秒', 10, 3600, 10, 1],
  ],

  CAR_SEI_DEF: { thresh: 60000, auto_stale_enabled: false, auto_stale_trigger: 3, auto_stale_repeat: 5, poor_form_hours: 3, poor_form_ratio: 0.95, poor_form_dm: false,
    poor_form_public: true, runner_alert_mode: 'off', runner_alert_cooldown_sec: 180, multi_window_min: 20, multi_min_rounds: 10, doosen_sec: 30, doosen_rate: 1.8,
    pt_outlier: 2.5, mode_vote_ratio: 0.6, hyst_up: 1.2, hyst_down: 0.8, snapshot_every: 10, auto_disable_days: 7 },

  CAR_SEI_RANGE: { thresh: [0, 999999999], auto_stale_trigger: [1, 60], auto_stale_repeat: [0, 60], poor_form_hours: [1, 24], poor_form_ratio: [0.5, 1],
    runner_alert_cooldown_sec: [10, 3600], multi_window_min: [5, 180], multi_min_rounds: [1, 200], doosen_sec: [0, 300], doosen_rate: [1.1, 10], pt_outlier: [1.2, 20],
    mode_vote_ratio: [0.3, 1], hyst_up: [1, 3], hyst_down: [0.1, 1], snapshot_every: [1, 120], auto_disable_days: [1, 60] },

  CAR_SEI_RUNNER: [['off', '關閉'], ['dm', '私訊'], ['voice', '語音'], ['both', '私訊＋語音']],

  CAR_SEI_EVC: { poor_form: '#d64533', mode: '#7b5cd6', doosen: '#e07b00', pt: '#c2185b', slow: '#2f7fd1', stale: '#ee6644' },

  CAR_SEI_EVN: { poor_form: '狀態不佳', mode: '模式切換', doosen: '豆森偵測', pt: 'Pt 異常', slow: '多人周回偏低', stale: 'Auto 分數停止' },

  CAR_SEI_HOURS: [1, 3, 6, 12, 24],

  carSeiDefs() { const m = this.carSecOf(this.carSecKey('seimeta')), d = m && m.data && m.data.defaults; return d && typeof d === 'object' ? Object.assign({}, this.CAR_SEI_DEF, d) : this.CAR_SEI_DEF; },

  carSeiFmt(kind, v) {
    if (v === null || v === undefined || v === '' || isNaN(+v)) return '';
    /* 位數要夠把機器人存的值原樣帶回去（機器人小數存到 4 位：0.9225＝92.25%、1.125 倍），
       不然沒改的參數也會被預覽當成「草稿」、用跟機器人不一樣的值算 */
    if (kind === 'pct') return String(Math.round(+v * 10000) / 100);
    if (kind === 'x') return String(Math.round(+v * 10000) / 10000);
    return String(Math.round(+v));
  },

  carSeiEdOf(p) {
    p = p && typeof p === 'object' ? p : {};
    const cfg = p.cfg && typeof p.cfg === 'object' ? p.cfg : {}, defs = this.carSeiDefs();
    const val = k => cfg[k] !== undefined ? cfg[k] : (p[k] !== undefined ? p[k] : defs[k]);
    const f = {};
    this.CAR_SEI_FIELDS.forEach(([k, , , kind]) => { f[k] = kind === 'bool' ? !!val(k) : this.carSeiFmt(kind, val(k)); });
    const rm = String(val('runner_alert_mode') || 'off');
    f.runner_alert_mode = this.CAR_SEI_RUNNER.some(x => x[0] === rm) ? rm : 'off';
    f.enabled = !!p.enabled; f.nickname = String(p.nickname || '');
    f.channel_id = String(p.channel_id || ''); f.admin_role_id = String(p.admin_role_id || ''); f.poor_form_dm_uid = String(p.poor_form_dm_uid || '');
    f.notify_targets = (Array.isArray(p.notify_targets) ? p.notify_targets : []).map(String).filter(x => /^\d{15,21}$/.test(x));
    return f;
  },

  carSeiEdParams(f) {
    const params = {}, errs = {};
    this.CAR_SEI_FIELDS.forEach(([k, , label, kind]) => {
      if (kind === 'bool') { params[k] = !!f[k]; return; }
      const sv = String(f[k] == null ? '' : f[k]).trim().replace(/,/g, '');
      if (!/^\d+(\.\d+)?$/.test(sv)) { errs[k] = label + '要填數字'; return; }
      if (kind === 'int' && sv.indexOf('.') >= 0) { errs[k] = label + '要是整數'; return; }
      const n = kind === 'pct' ? Math.round(+sv * 100) / 10000 : +sv, rg = this.CAR_SEI_RANGE[k] || [-Infinity, Infinity];
      if (n < rg[0] || n > rg[1]) { errs[k] = label + '要在 ' + (kind === 'pct' ? Math.round(rg[0] * 100) + '～' + Math.round(rg[1] * 100) + '%' : rg[0] + '～' + rg[1]) + ' 之間'; return; }
      params[k] = n;
    });
    params.runner_alert_mode = this.CAR_SEI_RUNNER.some(x => x[0] === f.runner_alert_mode) ? f.runner_alert_mode : 'off';
    return { params, errs };
  },

  carSeiEdCur() { const e = this.state.carSeiEd; return e && e.pid && e.f && String(e.g) === String(this.state.g || '') ? e : null; },

  carSeiDirty(ed) {
    if (!ed) return [];
    return Object.keys(ed.f).filter(k => JSON.stringify(ed.f[k]) !== JSON.stringify(ed.base[k]));
  },

  carSeiEdOpen(pid) {
    const p = this.carStSeiFind(pid); if (!p) return;
    const f = this.carSeiEdOf(p);
    this.setState({ carSeiEd: { g: String(this.state.g || ''), pid: String(pid), f, base: JSON.parse(JSON.stringify(f)), hours: 6, errs: {} }, carSeiDet: null, carSeiAdd: null, carSeiEdPick: '' });
    this.carSeiMetaLoad(false);
    setTimeout(() => this.carSeiPv(true), 0);
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (er) {}
  },

  carSeiEdClose() {
    const ed = this.carSeiEdCur();
    if (ed && this.carSeiDirty(ed).length && !window.confirm('有 ' + this.carSeiDirty(ed).length + ' 項設定還沒儲存，確定離開？')) return;
    clearTimeout(this._carSeiPvT);
    this.setState({ carSeiEd: null });
    setTimeout(() => this.carStSeiLoad(false), 0);
  },

  carSeiEdSet(patch) {
    this.setState(st => st.carSeiEd ? { carSeiEd: Object.assign({}, st.carSeiEd, { f: Object.assign({}, st.carSeiEd.f, patch), errs: {} }) } : {});
    clearTimeout(this._carSeiPvT);
    this._carSeiPvT = setTimeout(() => this.carSeiPv(false), 400);
  },

  carSeiMetaLoad(force) { return this.carSecFetch(this.carSecKey('seimeta'), '/seidan', { body: { action: 'meta' } }, force); },

  async carSeiPv(force) {
    const ed = this.carSeiEdCur(); if (!ed) return;
    const params = this.carSeiEdParams(ed.f).params, hours = +ed.hours || 6;
    const key = this.carSecKey('seipv') + ':' + ed.pid, sig = JSON.stringify([params, hours]), cur = this.carSecOf(key);
    if (!force && cur && cur.sig === sig && cur.data && !cur.err) return;
    const seq = (this._carSeiPvSeq = (this._carSeiPvSeq || 0) + 1), g0 = String(this.state.g || '');
    this.carSecPut(key, { busy: true, sig });
    try {
      const d = await this.carApi('/seidan', { body: { action: 'preview', pid: ed.pid, params, hours } });
      if (seq !== this._carSeiPvSeq || String(this.state.g || '') !== g0) return;
      this.carSecPut(key, { data: d, err: '', busy: false, at: Date.now(), sig, dsig: sig, errAt: 0 });
    } catch (e) {
      if (seq !== this._carSeiPvSeq) return;
      /* 失敗：sig 退回畫面上那份結果的參數（同一份草稿之後會重送），「更新於」不跟著變；
         畫面上留著的是上一組參數的結果 → 錯誤一定要顯示（carSpvStale） */
      const had = this.carSecOf(key) || {};
      this.carSecPut(key, { err: (e && e.code === 'not_found') ? '機器人版本不支援預覽，請更新機器人' : ((e && e.message) || '預覽失敗'),
        busy: false, sig: had.dsig || '', errAt: Date.now() });
    }
  },

  async carSeiEdSave() {
    const ed = this.carSeiEdCur(); if (!ed) return;
    const { params, errs } = this.carSeiEdParams(ed.f);
    if (Object.keys(errs).length) { this.setState(st => st.carSeiEd ? { carSeiEd: Object.assign({}, st.carSeiEd, { errs }) } : {}); this._toast(errs[Object.keys(errs)[0]]); return; }
    const dirty = this.carSeiDirty(ed), cfg = {};
    dirty.forEach(k => { if (Object.prototype.hasOwnProperty.call(params, k)) cfg[k] = params[k]; else cfg[k] = ed.f[k]; });
    if (!dirty.length) { this._toast('沒有要變更的設定'); return; }
    if (cfg.nickname !== undefined) cfg.nickname = String(cfg.nickname).trim().slice(0, 30);
    if (cfg.channel_id !== undefined && !cfg.channel_id) { this._toast('要選一個通知頻道'); return; }
    const d = await this.carAct('/seidan', { action: 'config', pid: ed.pid, cfg }, r => '已儲存 ' + ((r && Array.isArray(r.changed) && r.changed.length) || dirty.length) + ' 項設定', null, e => {
      const er = e && e.data && e.data.errors;
      if (er && typeof er === 'object') this.setState(st => st.carSeiEd ? { carSeiEd: Object.assign({}, st.carSeiEd, { errs: er }) } : {});
      return null;
    });
    if (!d || !d.player || typeof d.player !== 'object') return;
    this.carStSeiPatch(ed.pid, d.player);
    const nf = this.carSeiEdOf(Object.assign({}, this.carStSeiFind(ed.pid) || {}, d.player));
    this.setState(st => st.carSeiEd && st.carSeiEd.pid === ed.pid ? { carSeiEd: Object.assign({}, st.carSeiEd, { f: nf, base: JSON.parse(JSON.stringify(nf)), errs: {} }) } : {});
    this.carSeiPv(true);
  },

  carSeiEdDefaults() {
    const ed = this.carSeiEdCur(); if (!ed) return;
    const defs = this.carSeiDefs(), patch = {};
    this.CAR_SEI_FIELDS.forEach(([k, , , kind, , , , , keep]) => { if (!keep) patch[k] = kind === 'bool' ? !!defs[k] : this.carSeiFmt(kind, defs[k]); });
    this.carSeiEdSet(patch);
    this._toast('已填入預設值，按「儲存變更」才會生效');
  },

  carSeiEdRevert() { const ed = this.carSeiEdCur(); if (!ed) return; this.carSeiEdSet(JSON.parse(JSON.stringify(ed.base))); },

  async carSeiDelete(pid) {
    const p = this.carStSeiFind(pid), nm = String((p && p.name) || pid);
    if (!window.confirm('確定刪除「' + nm + '」的色段監控？\n\n會連同所有上分紀錄與快照一起刪掉，無法復原。只想暫停的話請改用「停用監控」。')) return;
    const d = await this.carAct('/seidan', { action: 'delete', pid: String(pid) }, '已刪除「' + nm + '」');
    if (!d) return;
    const key = this.carSecKey('seidan'), sec = this.carSecOf(key);
    if (sec && sec.data && Array.isArray(sec.data.players)) this.carSecPut(key, { data: Object.assign({}, sec.data, { players: sec.data.players.filter(x => x && String(x.pid) !== String(pid)) }) });
    clearTimeout(this._carSeiPvT);
    this.setState({ carSeiEd: null });
  },

  async carSeiSetDefault(pid) {
    const d = await this.carAct('/seidan', { action: 'default', pid: String(pid || '') }, pid ? '已設為預設玩家（Discord 的 /色段 指令可以省略玩家 ID）' : '已取消預設玩家');
    if (!d) return;
    const dp = String(d.default_pid || ''), key = this.carSecKey('seidan'), sec = this.carSecOf(key);
    if (sec && sec.data && Array.isArray(sec.data.players))
      this.carSecPut(key, { data: Object.assign({}, sec.data, { default_pid: dp, players: sec.data.players.map(x => x && typeof x === 'object' ? Object.assign({}, x, { is_default: !!dp && String(x.pid) === dp }) : x) }) });
  },

  carSeiAddToggle() {
    const a = this.state.carSeiAdd;
    if (a && String(a.g) === String(this.state.g || '')) { this.setState({ carSeiAdd: null }); return; }
    const sec = this.carSecOf(this.carSecKey('seidan')), ps = sec && sec.data && Array.isArray(sec.data.players) ? sec.data.players : [], cnt = {};
    ps.forEach(p => { const c = String((p && p.channel_id) || ''); if (c) cnt[c] = (cnt[c] || 0) + 1; });
    const ch = Object.keys(cnt).sort((x, y) => cnt[y] - cnt[x])[0] || '';
    this.setState({ carSeiAdd: { g: String(this.state.g || ''), player: '', ch, nick: '', thresh: '', role: '' } });
    this.carSeiMetaLoad(false);
  },

  async carSeiAddSubmit() {
    const a = this.state.carSeiAdd; if (!a || String(a.g) !== String(this.state.g || '')) return;
    const player = String(a.player || '').trim(), th = String(a.thresh || '').trim().replace(/,/g, '');
    if (!player) { this._toast('輸入玩家 ID、名次或遊戲名稱'); return; }
    if (!a.ch) { this._toast('要選一個通知頻道（警報會發在這裡）'); return; }
    if (th && (!/^\d+$/.test(th) || +th < 1)) { this._toast('判定門檻要是正整數（留空＝60000）'); return; }
    const body = { action: 'add', player, channel_id: String(a.ch), nickname: String(a.nick || '').trim().slice(0, 30), admin_role_id: String(a.role || '') };
    if (th) body.thresh = +th;
    const d = await this.carAct('/seidan', body, r => r && r.pending ? String(r.msg || '機器人在背景新增中') : (r && r.created ? '已新增「' + String(r.name || player) + '」' : '「' + String((r && r.name) || player) + '」原本就在監控清單，已重新啟用'));
    if (!d) return;
    this.setState({ carSeiAdd: null });
    const reload = async () => { await this.carSecFetch(this.carSecKey('seidan'), '/seidan', { query: { live: '0' } }, true); this.carStSeiLoad(true); };
    if (d.pending) setTimeout(reload, 8000); else reload();
  },

  carSeiAnKey(pid) { return this.carSecKey('seian') + ':' + pid + ':' + (+this.state.carSeiAnH || 6); },

  carSeiAnLoad(pid, force) {
    if (!pid) return null;
    return this.carSecFetch(this.carSeiAnKey(pid), '/seidan/analysis', { query: { pid: String(pid), hours: String(+this.state.carSeiAnH || 6) } }, force);
  },

  carSeiMs(s) { const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : NaN; },

  carSeiHm(ms) { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); },

  carSeiChart(an, hi) {
    const W = 720, H = 300, L = 54, R = 10, T = 14, B = 26, pw = W - L - R, ph = H - T - B;
    const P = an && an.params && typeof an.params === 'object' ? an.params : {};
    const rs = (an && Array.isArray(an.rounds) ? an.rounds : []).filter(r => r && typeof r === 'object').map(r => Object.assign({ ms: this.carSeiMs(r.t) }, r)).filter(r => isFinite(r.ms));
    let t1 = this.carSeiMs(an && an.now), t0 = this.carSeiMs(an && an.since);
    if (!isFinite(t1)) t1 = rs.length ? rs[rs.length - 1].ms : Date.now();
    if (!isFinite(t0) || t0 >= t1) t0 = t1 - 6 * 3600e3;
    const th = Math.max(0, +P.thresh || 0), up = th * (+P.hyst_up || 1.2), dn = th * (+P.hyst_down || 0.8);
    const top = Math.max.apply(null, rs.map(r => +r.ep || 0).concat([up, 1000])) * 1.08;
    const x = ms => L + Math.max(0, Math.min(1, (ms - t0) / (t1 - t0))) * pw;
    const y = v => T + (1 - Math.max(0, Math.min(1, v / top))) * ph;
    const f1 = v => String(Math.round(v * 10) / 10), pctX = v => (Math.round(v / W * 10000) / 100) + '%', pctY = v => (Math.round(v / H * 10000) / 100) + '%';
    const MC = { multi: 'var(--accent)', auto: '#d99a1e', unknown: 'var(--text-3)' };
    const bands = [];
    rs.forEach((r, i) => {
      const x0 = x(r.ms), x1 = i + 1 < rs.length ? x(rs[i + 1].ms) : x(t1), last = bands[bands.length - 1];
      if (last && last.m === r.m) last.x1 = x1; else bands.push({ m: r.m, x0, x1 });
    });
    let pf = '';
    rs.forEach((r, i) => { const v = +r.pf || 0; if (v > 0) pf += 'M' + f1(x(r.ms)) + ' ' + f1(y(v)) + 'H' + f1(i + 1 < rs.length ? x(rs[i + 1].ms) : x(t1)); });
    const evn = k => this.CAR_SEI_EVN[k] || String(k);
    const tipOf = r => {
      const ev = (Array.isArray(r.e) ? r.e : []).map(evn), cd = (Array.isArray(r.c) ? r.c : []).filter(k => (r.e || []).indexOf(k) < 0).map(evn);
      return this.carSeiHm(r.ms) + ' · 單場 ' + this.carStX(r.ep) + (+r.g ? ' · 間隔 ' + (+r.g) + 's' : '') + ' · ' + (this.CAR_SEI_MODES[r.m] || String(r.m || '')) +
        (+r.pf ? ' · 狀態不佳線 ' + this.carStX(r.pf) : '') + (ev.length ? ' · 發出：' + ev.join('、') : '') + (cd.length ? ' · 條件成立但已觸發過：' + cd.join('、') : '');
    };
    const dots = rs.map(r => {
      const ev = Array.isArray(r.e) && r.e.length > 0;
      return { t: String(r.t), cx: f1(x(r.ms)), cy: f1(y(+r.ep || 0)), r: ev ? '4' : '2.8', fill: MC[r.m] || MC.unknown, tip: tipOf(r) };
    });
    const marks = [];
    rs.forEach(r => (Array.isArray(r.e) ? r.e : []).forEach((k, j) => {
      const cx = x(r.ms), cy = Math.max(T + 6, y(+r.ep || 0) - 11 - j * 9);
      marks.push({ d: 'M' + f1(cx) + ' ' + f1(cy + 5) + 'L' + f1(cx - 5) + ' ' + f1(cy - 4) + 'L' + f1(cx + 5) + ' ' + f1(cy - 4) + 'Z', c: this.CAR_SEI_EVC[k] || '#d64533', tip: this.carSeiHm(r.ms) + ' ' + evn(k) });
    }));
    const stale = (an && Array.isArray(an.events) ? an.events : []).filter(e => e && e.type === 'stale').map(e => {
      const ms = this.carSeiMs(e.t); if (!isFinite(ms)) return null;
      const cx = x(ms), by = T + ph;
      return { d: 'M' + f1(cx) + ' ' + f1(by - 1) + 'L' + f1(cx - 5) + ' ' + f1(by - 10) + 'L' + f1(cx + 5) + ' ' + f1(by - 10) + 'Z', tip: this.carSeiHm(ms) + ' ' + evn('stale') };
    }).filter(Boolean);
    const stepOf = v => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, v)))); return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => v / s <= 4) || p * 10; };
    const ys = stepOf(top), yt = [];
    for (let v = ys; v <= top; v += ys) yt.push({ y: f1(y(v)), top: pctY(y(v)), l: this.carStN(v) });      // 0 不標（跟時間軸擠在一起）
    const span = (t1 - t0) / 60000, sm = [15, 30, 60, 120, 180, 360, 720].find(m => span / m <= 6) || 1440, xt = [];
    let tt = new Date(t0).setSeconds(0, 0);
    while (tt < t0 || (new Date(tt).getHours() * 60 + new Date(tt).getMinutes()) % sm) tt += 60000;
    for (let n = 0; tt <= t1 && n < 12; tt += sm * 60000, n++) if (x(tt) > L + 16 && x(tt) < W - 18) xt.push({ x: f1(x(tt)), left: pctX(x(tt)), l: this.carSeiHm(tt) });
    const ep = rs.map(r => +r.ep || 0);
    const hd = hi ? dots.find(d => d.t === String(hi)) : null;
    return {
      W: String(W), H: String(H), L: String(L), Rx: f1(L + pw), T: String(T), ph: f1(ph), base: f1(T + ph), lw: pctX(L - 6),
      xtop: 'calc((100% - 4px) * ' + (Math.round((T + ph) / H * 10000) / 10000) + ' + 3px)',      // 外框 padding-bottom 4px；基準線下方 3px
      bands: bands.filter(b => b.m === 'multi' || b.m === 'auto').map(b => ({ x: f1(b.x0), w: f1(Math.max(0.6, b.x1 - b.x0)), fill: 'color-mix(in oklab,' + MC[b.m] + ' 11%,transparent)' })),
      /* 在 <svg> 裡不用 sc-if（外來內容）：可有可無的圖層一律給 0 或 1 筆的陣列走 sc-for */
      thL: th > 0 ? [{ y: f1(y(th)), top: pctY(y(th) - 9), l: '門檻 ' + this.carStX(th) }] : [], hyL: th > 0 ? [{ y: f1(y(up)) }, { y: f1(y(dn)) }] : [],
      pfL: pf ? [{ d: pf }] : [], hiL: hd ? [{ cx: hd.cx, cy: hd.cy }] : [],
      emptyL: rs.length ? [] : [{ l: '這段時間沒有上分紀錄' }],
      dots, marks, stale, yt, xt,
      hiTxt: hd ? hd.tip : (rs.length ? '游標停在點上（手機點一下）看那一場的細節' : ''), roFg: hd ? 'var(--ink)' : 'var(--text-3)',
      aria: rs.length ? '近 ' + (+an.hours || 6) + ' 小時 ' + rs.length + ' 場，單場 ' + this.carStX(Math.min.apply(null, ep)) + '～' + this.carStX(Math.max.apply(null, ep)) + '，門檻 ' + this.carStX(th) : '這段時間沒有上分',
    };
  },

  carSeiAnVals(an, base, draft) {
    const tfg = h => 'color-mix(in oklab,' + h + ' 55%,var(--car-fg))', tbg = h => 'color-mix(in oklab,' + h + ' 14%,var(--card))';
    const st = an && an.status && typeof an.status === 'object' ? an.status : {}, P = an && an.params && typeof an.params === 'object' ? an.params : {};
    const ML = m => this.CAR_SEI_MODES[m] || String(m || '—');
    const chips = [];
    const ml = String(st.mode_live || 'unknown'), md = String(st.mode_draft || 'unknown');
    /* 停用中機器人不輪詢、什麼都不發（詳細頁與設定面板都要看得到；「接下來」是重新啟用後才會發的） */
    if (st.enabled === false) chips.push({ k: '監控', v: '已停用：機器人現在不會發任何警報' + (st.disabled_at ? '（' + this.carStTime(st.disabled_at) + ' 起）' : ''), fg: 'var(--text-2)', bg: 'color-mix(in oklab,var(--text-3) 16%,var(--card))' });
    chips.push({ k: '目前模式', v: ML(ml) + (md !== ml ? (draft ? ' → 新參數判 ' : ' → 依目前設定重算是 ') + ML(md) : ''), fg: md !== ml ? tfg('#7b5cd6') : 'var(--ink)', bg: md !== ml ? tbg('#7b5cd6') : 'var(--card-2)' });
    chips.push({ k: '近 1 小時', v: (+st.rounds_1h || 0) + ' 場 · ' + this.carStN(st.speed_1h), fg: 'var(--ink)', bg: 'var(--card-2)' });
    chips.push({ k: '場均（10）', v: this.carStX(st.avg10), fg: 'var(--ink)', bg: 'var(--card-2)' });
    chips.push({ k: '最後上分', v: st.idle_sec == null ? '—' : this.carStIdle(st.idle_sec) + '前', fg: 'var(--ink)', bg: 'var(--card-2)' });
    if (+st.pf_line) chips.push({ k: '狀態不佳線', v: this.carStX(st.pf_line) + '（近 ' + (+P.poor_form_hours || 0) + 'h 最高 ' + this.carStX(st.peak) + '）', fg: st.pf_below ? tfg('#d64533') : 'var(--ink)', bg: st.pf_below ? tbg('#d64533') : 'var(--card-2)' });
    const w = st.window && typeof st.window === 'object' ? st.window : null;
    if (w) chips.push({ k: '多人視窗', v: (+w.rounds || 0) + '／' + (+w.min_rounds || 0) + ' 場 · ' + (w.elapsed_min == null ? '—' : Math.floor(+w.elapsed_min)) + '／' + (+w.window_min || 0) + ' 分', fg: 'var(--ink)', bg: 'var(--card-2)' });
    const fl = st.flags && typeof st.flags === 'object' ? st.flags : {};
    const on = this.CAR_SEI_ALERTS.filter(([k]) => fl[k]).map(([, n]) => n);
    if (on.length) chips.push({ k: '已觸發（等重置）', v: on.join('、'), fg: tfg('#ee6644'), bg: tbg('#ee6644') });
    const counts = an && an.counts && typeof an.counts === 'object' ? an.counts : {}, bc = base && typeof base === 'object' ? base : null;
    const cnt = Object.keys(this.CAR_SEI_EVN).map(k => {
      const n = +counts[k] || 0, b = bc ? (+bc[k] || 0) : n, diff = n - b;
      return { k, n: this.CAR_SEI_EVN[k] + ' ' + n, d: bc && diff ? '（目前 ' + b + '）' : '', c: this.CAR_SEI_EVC[k], op: n ? '1' : '.45', fg: n ? tfg(this.CAR_SEI_EVC[k]) : 'var(--text-3)', bg: n ? tbg(this.CAR_SEI_EVC[k]) : 'var(--card-2)' };
    });
    const hm = t => { const ms = this.carSeiMs(t); return isFinite(ms) ? this.carSeiHm(ms) : ''; };
    const evs = (an && Array.isArray(an.events) ? an.events : []).filter(e => e && typeof e === 'object').slice(0, 40).map(e => ({
      t: hm(e.t), day: String(e.t || '').slice(5, 10).replace('-', '/'), lbl: String(e.label || this.CAR_SEI_EVN[e.type] || e.type || ''), text: String(e.text || ''),
      c: this.CAR_SEI_EVC[e.type] || '#d64533', fg: tfg(this.CAR_SEI_EVC[e.type] || '#d64533'), bg: tbg(this.CAR_SEI_EVC[e.type] || '#d64533') }));
    const pend = (an && Array.isArray(an.pending) ? an.pending : []).concat(an && Array.isArray(an.watch) ? an.watch.map(x => Object.assign({ watch: 1 }, x)) : [])
      .filter(x => x && typeof x === 'object').map(x => ({ lbl: String(x.label || this.CAR_SEI_EVN[x.type] || ''), text: String(x.text || ''), hot: !x.watch,
        fg: x.watch ? 'var(--text-2)' : tfg(this.CAR_SEI_EVC[x.type] || '#d64533'), bg: x.watch ? 'var(--card-2)' : tbg(this.CAR_SEI_EVC[x.type] || '#d64533') }));
    const total = Object.keys(counts).reduce((a, k) => a + (+counts[k] || 0), 0);
    return { chips, cnt, evs, hasEvs: evs.length > 0, noEvs: !evs.length, pend, hasPend: pend.length > 0,
      evHead: '這段時間會發出的警報（' + total + ' 則' + (an && an.sim_truncated ? '，停太久的時段只模擬前 2000 次輪詢' : '') + '）',
      foot: (an && an.rounds_truncated ? '只畫最新 400 場。' : '') + '斷 auto 提醒以每 60 秒輪詢一次估算；抓不到分數的那幾次輪詢預覽看不到，實際提醒可能晚一點。' };
  },

  carSchTap(e) {
    const tg = e && e.target, svg = e && e.currentTarget;
    if (!svg || (tg && String(tg.tagName || '').toLowerCase() === 'circle' && tg.getAttribute('data-t'))) return;   // 點到點本身：原本的處理
    const r = svg.getBoundingClientRect ? svg.getBoundingClientRect() : null;
    if (!r || !r.width || !isFinite(+e.clientX)) return;
    const vx = (e.clientX - r.left) / r.width * 720;
    let best = null, bd = Infinity;
    Array.prototype.forEach.call(svg.querySelectorAll('circle[data-t]'), c => { const d = Math.abs(+c.getAttribute('cx') - vx); if (d < bd) { bd = d; best = c; } });
    const t = best && bd <= 24 ? String(best.getAttribute('data-t') || '') : '';
    if (t && t !== this.state.carSchHi) this.setState({ carSchHi: t });
  },

  carSeiTgAddId(inp) {
    const u = String((inp && inp.value) || '').trim(), cur = this.carSeiEdCur(); if (!cur) return;
    if (!/^\d{15,21}$/.test(u)) { this._toast('Discord 使用者 ID 是 15～21 位數字'); return; }
    const lst = (cur.f.notify_targets || []).slice();
    if (lst.length >= 25 && lst.indexOf(u) < 0) { this._toast('通知名單最多 25 人'); return; }
    if (lst.indexOf(u) < 0) lst.push(u);
    inp.value = ''; this.carSeiEdSet({ notify_targets: lst });
  },

  carSeiSw(on) { return { on: on ? 'true' : 'false', swBg: on ? 'var(--ink-grad)' : 'var(--card-2)', swBd: on ? 'transparent' : 'var(--border)', swL: on ? '20px' : '2px', swK: on ? '#fff' : 'var(--text-3)' }; },

  carStSpvVals(c) {
    const ed = this.carSeiEdCur(), pid = ed ? ed.pid : '', p = this.carStSeiFind(pid) || {};
    const f = ed.f, base = ed.base, tfg = h => 'color-mix(in oklab,' + h + ' 55%,var(--car-fg))';
    const pv = this.carSecOf(this.carSecKey('seipv') + ':' + pid), an = pv && pv.data && typeof pv.data === 'object' ? pv.data : null;
    const meta = this.carSecOf(this.carSecKey('seimeta')), md = meta && meta.data && typeof meta.data === 'object' ? meta.data : null;
    const loc = this.carSeiEdParams(f).errs, errs = Object.assign({}, loc, ed.errs || {}), defs = this.carSeiDefs();
    const dirty = this.carSeiDirty(ed), isDirty = k => dirty.indexOf(k) >= 0;
    const fld = ([k, , label, kind, unit, smin, smax, step]) => {
      const isB = kind === 'bool', e = errs[k] || '';
      const o = { k, label, isBool: isB, isNum: !isB, unit: kind === 'pct' ? '%' : (unit || ''), err: e, hasErr: !!e, dirty: isDirty(k),
        def: '預設 ' + (isB ? (defs[k] ? '開' : '關') : this.carSeiFmt(kind, defs[k]) + (kind === 'pct' ? '%' : kind === 'x' ? ' 倍' : '')),
        bd: e ? '#d64533' : isDirty(k) ? 'color-mix(in oklab,var(--accent) 60%,var(--border))' : 'var(--border)' };
      if (isB) return Object.assign(o, this.carSeiSw(!!f[k]));
      const n = parseFloat(String(f[k] || '').replace(/,/g, ''));
      return Object.assign(o, { v: String(f[k] == null ? '' : f[k]), smin: String(smin), smax: String(smax), step: String(step), sv: String(isFinite(n) ? Math.max(smin, Math.min(smax, n)) : smin),
        mode: kind === 'int' ? 'numeric' : 'decimal', hasSl: +smax > +smin });
    };
    const groups = this.CAR_SEI_GROUPS.map(([gk, gn, desc]) => {
      const flds = this.CAR_SEI_FIELDS.filter(x => x[1] === gk).map(fld);
      return { k: gk, n: gn, desc, flds, dirtyN: flds.filter(x => x.dirty).length ? '已改 ' + flds.filter(x => x.dirty).length + ' 項' : '' };
    });
    const cool = fld(this.CAR_SEI_FIELDS.find(x => x[0] === 'runner_alert_cooldown_sec'));
    /* 下拉選單 */
    const chans = md && Array.isArray(md.channels) ? md.channels.filter(x => x && /^\d{5,25}$/.test(String(x.id))) : [];
    const roles = md && Array.isArray(md.roles) ? md.roles.filter(x => x && /^\d{5,25}$/.test(String(x.id))) : [];
    const people = md && Array.isArray(md.people) ? md.people.filter(x => x && /^\d{15,21}$/.test(String(x.uid))) : [];
    const pname = u => { const q = people.find(x => String(x.uid) === String(u)); return q ? String(q.name) : 'ID ' + String(u); };
    const chOpts = [{ v: '', n: '（請選通知頻道）' }].concat(chans.map(x => ({ v: String(x.id), n: '#' + String(x.name || x.id) })));
    if (f.channel_id && !chOpts.some(o => o.v === f.channel_id)) chOpts.push({ v: f.channel_id, n: '頻道 ' + f.channel_id + (md ? '（伺服器裡找不到）' : '') });
    const roleOpts = [{ v: '', n: '不指定（改 @ 前 3 位管理員）' }].concat(roles.map(x => ({ v: String(x.id), n: '@' + String(x.name || x.id) })));
    if (f.admin_role_id && !roleOpts.some(o => o.v === f.admin_role_id)) roleOpts.push({ v: f.admin_role_id, n: '身分組 ' + f.admin_role_id });
    const dmOpts = [{ v: '', n: '（沒有指定）' }].concat(people.map(x => ({ v: String(x.uid), n: String(x.name) })));
    if (f.poor_form_dm_uid && !dmOpts.some(o => o.v === f.poor_form_dm_uid)) dmOpts.push({ v: f.poor_form_dm_uid, n: 'ID ' + f.poor_form_dm_uid });
    const tg = Array.isArray(f.notify_targets) ? f.notify_targets : [];
    const addOpts = [{ v: '', n: tg.length >= 25 ? '名單已滿 25 人' : '＋ 加入通知對象…' }].concat(tg.length >= 25 ? [] : people.filter(x => tg.indexOf(String(x.uid)) < 0).map(x => ({ v: String(x.uid), n: String(x.name) })));
    const pvBusy = !!(pv && pv.busy), pvErr = pv && pv.err ? String(pv.err) : '';
    const ch = this.carSeiChart(an, c.s.carSchHi);
    const av = this.carSeiAnVals(an, an && an.base_counts, true);
    const sumOf = o => Object.keys(o && typeof o === 'object' ? o : {}).reduce((a, k) => a + (+o[k] || 0), 0);
    const mini = !an ? (pvBusy ? '預覽計算中…' : '') : (pvBusy ? '預覽計算中… ' : '') + '預覽：近 ' + (+an.hours || 6) + ' 小時會發 ' + sumOf(an.counts) + ' 則警報'
      + (an.base_counts ? '（目前設定 ' + sumOf(an.base_counts) + ' 則）' : '') + ' · 最新判定 ' + (this.CAR_SEI_MODES[(an.status || {}).mode_draft] || '—');
    const lv = p.live && typeof p.live === 'object' ? p.live : null;
    const inv = an && an.invalid && typeof an.invalid === 'object' ? Object.keys(an.invalid) : [];
    return {
      carSeiList: false, carSeiDetail: false, carSeiEdit: true,
      carSpvName: String(p.name == null ? pid : p.name), carSpvSub: [p.nickname && p.player_name ? '遊戲名稱 ' + String(p.player_name) : '', 'ID ' + String(p.player_id || pid)].filter(Boolean).join(' · '),
      carSpvHasRank: !!(lv && lv.rank), carSpvRank: lv && lv.rank ? '第 ' + (+lv.rank) + ' 名' : '', carSpvIsDef: !!p.is_default, carSpvOff: !f.enabled,
      carSpvDirty: dirty.length > 0, carSpvDirtyTxt: dirty.length + ' 項還沒儲存',
      carSpvHours: this.CAR_SEI_HOURS.map(h => Object.assign({ v: String(h), n: h + 'h' }, c.segOn(h === (+ed.hours || 6)))),
      carSpvBusy: pvBusy, carSpvStamp: pvBusy ? '計算中…' : (pv && pv.at ? '更新於 ' + this.carSeiHm(pv.at) + (an && an.draft ? ' · 草稿參數' : ' · 目前設定') : ''),
      carSpvErr: pvErr, carSpvHasErr: !!pvErr && !an, carSpvLoading: !an && !pvErr, carSpvReady: !!an,
      /* 預覽失敗但畫面上還有上一次的結果：一定要講清楚，不然會以為新參數算出來就是這樣 */
      carSpvStaleErr: !!pvErr && !!an && !pvBusy ? '預覽更新失敗：' + pvErr + '。下面還是「' + (an.draft ? '上一組草稿參數' : '目前設定') + '」的結果，不是你剛改的參數。' : '',
      carSpvInvalid: inv.length ? '這幾項草稿不合法，預覽先用目前的值：' + inv.join('、') : '',
      carSch: ch, carSan: av, carSpvMini: mini, onCarSchHi: e => { const t = String(e.currentTarget.dataset.t || ''); if (t && t !== this.state.carSchHi) this.setState({ carSchHi: t }); },
      onCarSchTap: e => this.carSchTap(e),
      carSpvGroups: groups,
      carSpvChOpts: chOpts, carSpvCh: f.channel_id, carSpvChErr: errs.channel_id || '', carSpvChDirty: isDirty('channel_id'),
      carSpvRoleOpts: roleOpts, carSpvRole: f.admin_role_id, carSpvRoleErr: errs.admin_role_id || '',
      carSpvRun: this.CAR_SEI_RUNNER.map(([v, n]) => Object.assign({ v, n, on: v === f.runner_alert_mode ? 'true' : 'false' }, c.segOn(v === f.runner_alert_mode))),
      carSpvCool: cool,
      carSpvTargets: tg.map(u => ({ u, n: pname(u) })), carSpvHasTargets: tg.length > 0, carSpvNoTargets: !tg.length,
      carSpvAddOpts: addOpts, carSpvPick: String(c.s.carSeiEdPick || ''), carSpvTgErr: errs.notify_targets || '',
      carSpvDmOpts: dmOpts, carSpvDm: f.poor_form_dm_uid, carSpvDmErr: errs.poor_form_dm_uid || '',
      carSpvMetaErr: meta && meta.err && !md ? '頻道／身分組清單讀不到：' + String(meta.err) : '',
      carSpvNick: String(f.nickname || ''), carSpvNickPh: String(p.player_name || p.player_id || pid), carSpvNickErr: errs.nickname || '',
      carSpvEn: this.carSeiSw(!!f.enabled),
      carSpvDefBtn: p.is_default ? '取消預設玩家' : '設為預設玩家',
      carSpvSaveBtn: c.s.carActBusy ? '處理中…' : (dirty.length ? '儲存變更（' + dirty.length + ' 項）' : '儲存變更'),
      carSpvSaveOk: dirty.length > 0 && !c.s.carActBusy,
      carSpvNote: md && md.dc === false ? 'QQ 車隊沒有 Discord 頻道，色段監控不會發警報。' : '',
      onCarSpvBack: () => this.carSeiEdClose(),
      onCarSpvHours: e => {
        const h = +e.currentTarget.dataset.v || 6;
        this.setState(st => st.carSeiEd ? { carSeiEd: Object.assign({}, st.carSeiEd, { hours: h }) } : {});
        setTimeout(() => this.carSeiPv(false), 0);
      },
      onCarSpvNum: e => { const k = String(e.currentTarget.dataset.k || ''); if (!this.CAR_SEI_FIELDS.some(x => x[0] === k)) return; this.carSeiEdSet({ [k]: String(e.currentTarget.value) }); },
      onCarSpvBool: e => { const k = String(e.currentTarget.dataset.k || ''); const cur = this.carSeiEdCur(); if (!cur || (k !== 'enabled' && !this.CAR_SEI_FIELDS.some(x => x[0] === k && x[3] === 'bool'))) return; this.carSeiEdSet({ [k]: !cur.f[k] }); },
      onCarSpvSel: e => { const k = String(e.currentTarget.dataset.k || ''); if (['channel_id', 'admin_role_id', 'poor_form_dm_uid'].indexOf(k) < 0) return; this.carSeiEdSet({ [k]: String(e.currentTarget.value || '') }); },
      onCarSpvRun: e => { const v = String(e.currentTarget.dataset.v || ''); if (this.CAR_SEI_RUNNER.some(x => x[0] === v)) this.carSeiEdSet({ runner_alert_mode: v }); },
      onCarSpvNick: e => this.carSeiEdSet({ nickname: String(e.currentTarget.value).slice(0, 30) }),
      onCarSpvAddTg: e => {
        const u = String(e.currentTarget.value || ''), cur = this.carSeiEdCur();
        if (!cur || !/^\d{15,21}$/.test(u)) return;
        const lst = (cur.f.notify_targets || []).slice(); if (lst.indexOf(u) < 0 && lst.length < 25) lst.push(u);
        this.setState({ carSeiEdPick: '' }); this.carSeiEdSet({ notify_targets: lst });
      },
      onCarSpvTgId: e => { if (e.key !== 'Enter') return; e.preventDefault(); this.carSeiTgAddId(e.currentTarget); },
      /* iPhone 的數字鍵盤沒有 Enter：旁邊的「加入」按鈕做一樣的事 */
      onCarSpvTgAdd: e => { const box = e.currentTarget.parentNode, inp = box && box.querySelector('input[data-sei-tgid]'); if (inp) this.carSeiTgAddId(inp); },
      onCarSpvRmTg: e => { const u = String(e.currentTarget.dataset.u || ''), cur = this.carSeiEdCur(); if (!cur) return; this.carSeiEdSet({ notify_targets: (cur.f.notify_targets || []).filter(x => x !== u) }); },
      onCarSpvSave: () => this.carSeiEdSave(),
      onCarSpvRevert: () => this.carSeiEdRevert(),
      onCarSpvDefaults: () => this.carSeiEdDefaults(),
      onCarSpvDef: () => this.carSeiSetDefault(p.is_default ? '' : pid),
      onCarSpvDel: () => this.carSeiDelete(pid),
      onCarSpvRetry: () => this.carSeiPv(true),
      onCarSpvKey: e => { if (e.key === 'Enter') { e.preventDefault(); this.carSeiEdSave(); } },
    };
  },

  carStN(v) {
    const n = +v || 0, a = Math.abs(n), sg = n < 0 ? '-' : '';
    return sg + (a >= 1e8 ? (a / 1e8).toFixed(2) + '億' : a >= 1e4 ? (a / 1e4).toFixed(1) + '萬' : String(Math.round(a)));
  },

  carStX(v) {
    const n = +v || 0, a = Math.round(Math.abs(n)), sg = n < 0 && a ? '-' : '';
    return sg + String(a).replace(/\B(?=(\d{3})+$)/g, ',');
  },

  carStIdle(s) {
    if (s === null || s === undefined || s === '' || isNaN(+s)) return '—';
    s = Math.max(0, Math.floor(+s));
    return s < 60 ? s + '秒' : s < 3600 ? Math.floor(s / 60) + '分' : Math.floor(s / 3600) + '時' + Math.floor(s % 3600 / 60) + '分';
  },

  carStTime(v, sec) { const t = String(v || '').replace('T', ' '); return t.length >= 16 ? t.slice(5, sec ? 19 : 16) : (t || '—'); },

  carSecVals_stats(c) {
    const s = c.s, view = this.carStView(), cars = this.carCars(c.gd);
    const ins = this.carSecOf(this.carSecKey('insight', true));
    const lackN = ins && ins.data && Array.isArray(ins.data.shortage) ? ins.data.shortage.length : 0;
    const out = {
      carStViews: this.CAR_ST_VIEWS.map(([v, n]) => Object.assign({ v, n, sel: v === view ? 'true' : 'false', badge: v === 'insight' && lackN ? String(lackN) : '',
        bfg: v === view ? 'color-mix(in oklab,#d64533 55%,var(--car-fg))' : 'var(--text-3)' }, c.segOn(v === view))),
      carStCarSeg: view !== 'seidan' && cars.length > 1,
      carStIsIns: view === 'insight', carStIsHist: view === 'hist', carStIsSei: view === 'seidan',
      onCarStView: e => {
        const v = String(e.currentTarget.dataset.v || '');
        if (!this.CAR_ST_VIEWS.some(x => x[0] === v)) return;
        /* 色段設定還有沒存的變更：跟「← 返回列表」一樣先問（點「色段監控」分頁回列表也會丟掉草稿） */
        const ed = this.carSeiEdCur(), nd = ed ? this.carSeiDirty(ed).length : 0;
        if (nd && !window.confirm('有 ' + nd + ' 項設定還沒儲存，確定離開？')) return;
        clearTimeout(this._carSeiPvT);
        this.setState({ carStView: v, carSeiDet: null, carSeiEd: null, carSeiAdd: null });
        setTimeout(() => this.carSec_stats(false), 0);
      },
      onCarStRetry: () => this.carSec_stats(true),
    };
    const carName = (cars.find(x => x.no === c.carNo) || {}).name || this.CAR_NAMES[c.carNo] || '';
    if (view === 'insight') return Object.assign(out, this.carStInsVals(ins, carName));
    if (view === 'hist') return Object.assign(out, this.carStHistVals(carName));
    return Object.assign(out, this.carSeiCur() ? this.carStSdVals(c) : this.carSeiEdCur() && c.admin ? this.carStSpvVals(c) : this.carStSeiVals(c));
  },

  carStInsVals(sec, carName) {
    const d = sec && sec.data && typeof sec.data === 'object' ? sec.data : null;
    const tfg = h => 'color-mix(in oklab,' + h + ' 55%,var(--car-fg))';
    const total = d ? Math.max(0, +d.total_slots || 0) : 0, filled = d ? Math.max(0, +d.filled || 0) : 0, rate = d ? Math.max(0, Math.min(100, +d.rate || 0)) : 0;
    const tone = rate >= 80 ? '#2f9e57' : rate >= 50 ? '#d99a1e' : '#d64533';
    const nDays = d && Array.isArray(d.dates) ? d.dates.length : 0;
    const lack = d && Array.isArray(d.shortage) ? d.shortage.filter(x => x && typeof x === 'object') : [];
    const rank = d && Array.isArray(d.rank) ? d.rank.filter(x => x && typeof x === 'object') : [];
    const today = String((((this.state.carStates || {})[this.carNo()] || {}).today) || '');
    const groups = [];
    lack.forEach(x => {
      const date = String(x.date || ''), wl = (Array.isArray(x.waitlist) ? x.waitlist : []).map(v => String(v == null ? '' : v)).filter(Boolean);
      let g = groups[groups.length - 1];
      if (!g || g.date !== date) groups.push(g = { date, day: this.carDayLabel(date, today, false), rows: [] });
      const lk = (Array.isArray(x.lack) ? x.lack : []).map(v => String(v)).filter(Boolean);
      g.rows.push({ d: date, slot: this.carSlot(x.hour), lackTxt: lk.length ? '缺 ' + lk.join('、') : '缺人', noS6: !!x.no_s6,
        wl: wl.length ? '候補 ' + wl.join('、') : '沒有候補', wlFg: wl.length ? 'var(--text-2)' : 'var(--text-3)' });
    });
    const top = rank.reduce((a, x) => Math.max(a, +x.count || 0), 0) || 1;
    return {
      carInsLoading: !d && !(sec && sec.err), carInsErr: !d && sec && sec.err ? String(sec.err) : '', carInsReady: !!d,
      carInsSub: carName + ' · ' + (nDays ? '統計今天起 ' + nDays + ' 天的班表' : '今天起 7 天內還沒有班表'),
      carInsStats: [
        { k: '總位置', v: String(total), fg: 'var(--ink)' },
        { k: '已排', v: String(filled), fg: filled ? tfg('#2f9e57') : 'var(--ink)' },
        { k: '缺額', v: String(Math.max(0, total - filled)), fg: total - filled > 0 ? tfg('#d64533') : 'var(--ink)' },
        { k: '填充率', v: total ? rate + '%' : '—', fg: total ? tfg(tone) : 'var(--text-3)' },
      ],
      carInsBarW: (total ? rate : 0) + '%', carInsBarBg: tone,
      carInsLackCnt: lack.length ? lack.length + ' 個時段' : '', carInsGroups: groups, carInsHasLack: lack.length > 0,
      carInsNoLack: !lack.length, carInsNoLackTxt: total ? '未來 7 天沒有缺額' : '未來 7 天還沒有開班的時段',
      carInsRank: rank.map((x, i) => ({ i: String(i + 1), name: String(x.name == null ? '' : x.name), n: (+x.count || 0) + ' 班', w: Math.round((+x.count || 0) / top * 100) + '%' })),
      carInsHasRank: rank.length > 0, carInsNoRank: !rank.length,
      onCarInsGo: e => {
        const v = String(e.currentTarget.dataset.d || '');
        this.setState({ carTab: 'sched', carDate: v, carPop: null, carTagMgr: false });
        setTimeout(() => this.carLoadSec('sched'), 0);
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (er) {}
      },
    };
  },

  carStHistVals(carName) {
    const idx = this.carSecOf(this.carSecKey('histidx', true)), d = idx && idx.data;
    const list = d && Array.isArray(d.dates) ? d.dates.filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(String(x.date))) : [];
    const today = String((d && d.today) || ''), sel = d ? this.carStHistPick(d) : '';
    const day = sel ? this.carSecOf(this.carSecKey('histday', true) + ':' + sel) : null, dd = day && day.data;
    const fmt = v => (v === null || v === undefined || v === '' || isNaN(+v)) ? '' : (+v).toFixed(2);
    /* 跑者：那一格有存就用那一格的（r.p1.name），沒有就退回這台車現在的預設跑者 */
    const dflt = String((((this.state.carStates || {})[this.carNo()] || {}).p1) || '');
    const rows = (dd && Array.isArray(dd.rows) ? dd.rows : []).filter(r => r && typeof r === 'object').map(r => {
      const cells = ['p2', 'p3', 'p4', 'p5'].map(pos => {
        const se = (Array.isArray(r.seats) ? r.seats : []).find(x => x && x.pos === pos) || {};
        const has = se.name != null && String(se.name) !== '';
        return { P: pos.toUpperCase(), has, empty: !has, name: has ? String(se.name) : '', s6: se.role === 's6', bonus: fmt(se.bonus) };
      });
      const wl = (Array.isArray(r.waitlist) ? r.waitlist : []).filter(v => v != null && v !== '').map(String);
      const note = [];
      if (wl.length) note.push('候補 ' + wl.join('、'));
      if (+r.applicants) note.push('報班 ' + (+r.applicants));
      const rp = r.p1 && typeof r.p1 === 'object' && r.p1.name != null && String(r.p1.name) !== '' ? r.p1 : null;
      const runner = rp ? String(rp.name) : (dflt || '—'), rb = rp && +rp.bonus > 0 ? fmt(rp.bonus) : '';
      return { slot: this.carSlot(r.hour), ctype: String(r.car_type || ''), locked: !!r.locked, manual: !!r.manual, cells, note: note.join(' · ') || '—',
        runner, rSub: [String(r.car_type || ''), rb].filter(Boolean).join(' · '), rM: '跑者 ' + runner + (r.car_type ? ' · ' + String(r.car_type) : '') };
    });
    /* 資料來源：現用班表／第 N 期封存／這天沒有留下班表資料 */
    const sv = dd ? String(dd.src || '') : '', isNone = sv === 'none';
    const srcTxt = !dd ? '' : sv.indexOf('archive') === 0 ? ((sv.split(':')[1] ? '第 ' + sv.split(':')[1] + ' 期' : '期數') + '封存') : sv === 'live' ? '現用班表' : isNone ? '這天沒有留下班表資料' : sv;
    const inList = list.some(x => x.date === sel);
    const opts = list.map(x => ({ v: String(x.date), n: String(x.date) + (x.date === today ? '（今天）' : (x.past ? '' : '（未來）')) + ' · ' + (+x.hours || 0) + ' 時段' + (x.src === 'archive' ? ' · 封存' : '') }));
    if (sel && !inList) opts.unshift({ v: sel, n: sel + ' · 自選日期' });        // 日期欄選的日期不在清單裡：下拉選單也要顯示得出來
    /* 前一個／後一個日期：清單是新到舊；自選日期不在清單裡時，找它前後最近的那一天 */
    const older = sel ? list.find(x => x.date < sel) : null, newer = sel ? list.slice().reverse().find(x => x.date > sel) : null;
    const go = v => { clearTimeout(this._carHistT); this.setState({ carHistDate: v, carHistDraft: '' }); setTimeout(() => this.carStHistDay(v, false), 0); };
    const maxDay = today || this.carFYmd(new Date());
    return {
      carHistLoading: !d && !(idx && idx.err), carHistErr: !d && idx && idx.err ? String(idx.err) : '',
      carHistNone: !!d && !list.length, carHistReady: !!d && list.length > 0,
      carHistOpts: opts,
      carHistSel: sel, carHistCnt: list.length ? '共 ' + list.length + ' 天' + (d.oldest ? ' · 最早 ' + String(d.oldest) : '') : '',
      carHistPick: /^\d{4}-\d{2}-\d{2}$/.test(String(this.state.carHistDraft || '')) ? this.state.carHistDraft : (sel && sel <= maxDay ? sel : ''), carHistMax: maxDay,
      carHistDayLoading: !!sel && !dd && !(day && day.err), carHistDayErr: !dd && day && day.err ? String(day.err) : '',
      carHistSrc: dd && !isNone ? '資料來源：' + srcTxt + (dd.past ? '（過去的日期）' : '') : '', carHistSrcTag: dd && !isNone ? srcTxt : '', carHistHasSrcTag: !!dd && !isNone && !!srcTxt,
      carHistTitle: carName + ' · ' + (sel && today && sel.slice(0, 4) !== today.slice(0, 4) ? sel.slice(0, 4) + '/' : '') + (sel ? this.carDayLabel(sel, today, false) : ''),   // 跨年的日期把年份寫出來
      carHistShow: !!dd, carHistRows: rows, carHistHasRows: rows.length > 0, carHistNoRows: !!dd && !rows.length,
      carHistEmptyTxt: isNone ? '這天沒有留下班表資料' : (dd && dd.note ? String(dd.note) : '這天沒有已開班的時段'),
      carHistEmptySub: isNone ? '機器人會先找現用班表，再找最近 8 期換期時封存的班表；更早的日期或當天沒開班，就不會有資料。' : '',
      onCarHistDate: e => {
        const v = String(e.currentTarget.value || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
        go(v);
      },
      /* 日期欄：任何過去的日期都可以直接查（最晚到今天；未來的日期從下拉清單選） */
      onCarHistPickDate: e => {
        const v = String(e.currentTarget.value || '');
        clearTimeout(this._carHistT);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;                 // 清空或還沒打完：不動
        if (v > maxDay) { this.setState({ carHistDraft: '' }); this._toast('日期欄最晚只能選到今天；未來的日期請從下拉清單選'); return; }
        // 用鍵盤一格一格打日期時，每打一格瀏覽器都會送一次「完整的日期」：欄位先照打的顯示，停手 0.4 秒才真的去查
        this.setState({ carHistDraft: v });
        this._carHistT = setTimeout(() => go(v), 400);
      },
      onCarHistStep: e => {
        const x = (+e.currentTarget.dataset.v || 0) > 0 ? older : newer;
        if (x) go(String(x.date));
      },
      carHistOlderOk: !!older, carHistNewerOk: !!newer,
    };
  },

  carStSeiNb(nb) {
    const tfg = h => 'color-mix(in oklab,' + h + ' 55%,var(--car-fg))';
    return (Array.isArray(nb) ? nb : []).filter(n => n && typeof n === 'object').map(n => {
      const df = +n.diff || 0;
      return { rank: String(+n.rank || '—'), name: String(n.name == null ? '' : n.name), score: this.carStN(n.score), s1h: this.carStN(n.speed_1h),
        diff: n.me ? '—' : (df > 0 ? '+' : '') + this.carStN(df), dfg: n.me || !df ? 'var(--text-3)' : df > 0 ? tfg('#d64533') : tfg('#2f9e57'),
        me: !!n.me, bg: n.me ? 'color-mix(in oklab,var(--accent) 11%,transparent)' : 'transparent', fw: n.me ? '800' : '700' };
    });
  },

  carStSeiVals(c) {
    const key = this.carSecKey('seidan'), sec = this.carSecOf(key), d = sec && sec.data && typeof sec.data === 'object' ? sec.data : null;
    const tfg = h => 'color-mix(in oklab,' + h + ' 55%,var(--car-fg))', tbg = h => 'color-mix(in oklab,' + h + ' 15%,var(--card))';
    const ps = d && Array.isArray(d.players) ? d.players.filter(p => p && typeof p === 'object' && p.pid != null) : [];
    const live = sec && sec.live;
    let lt = '', lbg = 'var(--card-2)', lfg = 'var(--text-3)';
    if (ps.length) {
      if (live === 'busy') lt = '即時排名讀取中…';
      else if (live === 'ok' || (d && d.live_ok)) { lt = '即時'; lbg = tbg('#2f9e57'); lfg = tfg('#2f9e57'); }
      else if (live === 'fail') { lt = '即時排名讀取失敗'; lbg = tbg('#ee6644'); lfg = tfg('#ee6644'); }
      else lt = '離線（讀不到即時排名）';
    }
    const players = ps.map(p => {
      const lv = p.live && typeof p.live === 'object' ? p.live : null, pid = String(p.pid);
      const tr = (Array.isArray(p.trend) ? p.trend : []).map(v => +v || 0), mx = Math.max.apply(null, tr.concat([1]));
      const al = p.alerts && typeof p.alerts === 'object' ? p.alerts : {};
      const alerts = this.CAR_SEI_ALERTS.filter(([k]) => al[k]).map(([, n]) => n);
      const stats = [
        { k: '總分', v: this.carStN(lv ? lv.score : p.last_score), fg: 'var(--ink)' },
        { k: '1h 時速', v: this.carStN(lv ? lv.speed_1h : p.speed_log_1h), fg: 'var(--accent-deep)' },
        { k: '場均（10）', v: this.carStX(p.avg10), fg: 'var(--ink)' },
        { k: '最佳', v: this.carStX(p.best), fg: tfg('#2f9e57') },
        { k: '峰值', v: this.carStX(p.peak_round_ep), fg: 'var(--ink)' },
        { k: '場數', v: String(+p.rounds || 0), fg: 'var(--ink)' },
        { k: '間隔', v: +p.gap_avg ? (+p.gap_avg) + 's' : '—', fg: 'var(--ink)' },
        { k: '閒置', v: this.carStIdle(p.idle), fg: p.stopped ? tfg('#d64533') : 'var(--ink)' },
      ];
      if (lv) stats.push({ k: '3h 時速', v: this.carStN(lv.speed_3h), fg: 'var(--ink)' }, { k: '24h 時速', v: this.carStN(lv.speed_24h), fg: 'var(--ink)' }, { k: '近 1h 場數', v: String(+lv.count_1h || 0), fg: 'var(--ink)' });
      const nb = lv ? this.carStSeiNb(lv.neighbors) : [];
      const ratio = +p.poor_form_ratio || 0;
      return {
        pid, name: String(p.name == null ? pid : p.name), sub: p.nickname && p.player_name ? '遊戲名稱 ' + String(p.player_name) : '',
        hasRank: !!(lv && lv.rank), rankTxt: lv && lv.rank ? '第 ' + (+lv.rank) + ' 名' : '',
        stopped: !!p.stopped, stopTxt: '停車 ' + this.carStIdle(p.idle), off: !p.enabled,
        modeTxt: p.mode ? '模式 ' + (this.CAR_SEI_MODES[p.mode] || String(p.mode)) : '',
        spark: tr.map(v => Math.max(2, Math.round(Math.max(0, v) / mx * 18))), hasSpark: tr.length > 0,
        stats, hasNb: nb.length > 0, nb,
        foot: ['門檻 ' + this.carStX(p.thresh), '視窗 ' + (+p.window_rounds || 0) + ' 場', '手感 近 ' + (+p.poor_form_hours || 0) + ' 小時低於 ' + Math.round(ratio * 100) + '%',
          '斷 auto ' + (p.auto_stale_enabled ? (+p.auto_stale_trigger || 0) + ' 分提醒' : '關'), '快照 ' + (+p.snapshots || 0), '最後上分 ' + this.carStTime(p.last_time, false)].join(' · '),
        isDef: !!p.is_default,
        hasAlert: alerts.length > 0, alerts: alerts.map(n => ({ n, bg: tbg('#ee6644'), fg: tfg('#ee6644') })),
        admin: !!c.admin, togTxt: p.enabled ? '停用監控' : '啟用監控', bd: 'var(--border)',
      };
    });
    /* 新增監控表單（管理員） */
    const add = c.admin && c.s.carSeiAdd && String(c.s.carSeiAdd.g) === String(c.s.g || '') ? c.s.carSeiAdd : null;
    const meta = this.carSecOf(this.carSecKey('seimeta')), md = meta && meta.data && typeof meta.data === 'object' ? meta.data : null;
    const chOpts = [{ v: '', n: meta && meta.busy && !md ? '讀取頻道清單中…' : '（請選通知頻道）' }].concat((md && Array.isArray(md.channels) ? md.channels : []).filter(x => x && /^\d{5,25}$/.test(String(x.id))).map(x => ({ v: String(x.id), n: '#' + String(x.name || x.id) })));
    if (add && add.ch && !chOpts.some(o => o.v === String(add.ch))) chOpts.push({ v: String(add.ch), n: '頻道 ' + String(add.ch) });
    const roleOpts = [{ v: '', n: '不指定（@ 前 3 位管理員）' }].concat((md && Array.isArray(md.roles) ? md.roles : []).filter(x => x && /^\d{5,25}$/.test(String(x.id))).map(x => ({ v: String(x.id), n: '@' + String(x.name || x.id) })));
    return {
      carSeiList: true, carSeiDetail: false,
      carSeiLoading: !d && !(sec && sec.err), carSeiErr: !d && sec && sec.err ? String(sec.err) : '', carSeiReady: !!d,
      carSeiEmpty: !!d && !ps.length, carSeiHas: ps.length > 0, carSeiEdit: false,
      carSeiCanAdd: !!c.admin && !!d, carSeiAddBtn: add ? '收起' : '＋ 新增監控', carSeiAddShow: !!add,
      carSeiAddPlayer: add ? String(add.player || '') : '', carSeiAddNick: add ? String(add.nick || '') : '', carSeiAddThresh: add ? String(add.thresh || '') : '',
      carSeiAddCh: add ? String(add.ch || '') : '', carSeiAddChOpts: chOpts, carSeiAddRole: add ? String(add.role || '') : '', carSeiAddRoleOpts: roleOpts,
      carSeiAddGoTxt: c.s.carActBusy ? '查詢 HiSekai 中…' : '開始監控',
      carSeiAddMetaErr: meta && meta.err && !md ? '頻道清單讀不到：' + String(meta.err) : '',
      carSeiEmptyTxt: c.admin ? '按上面的「＋ 新增監控」輸入玩家 ID、名次或遊戲名稱，機器人就會開始追蹤分數、判斷 Auto／多人並在頻道發警報。' : '管理員可以在這裡或 Discord 的 /色段 開始 新增要追蹤的玩家，這裡就會列出他的分數、時速與警報。',
      carSeiHead: ps.length + ' 位監控中' + (d && d.event ? ' · ' + String(d.event) : ''),
      carSeiLive: lt, carSeiLiveShow: !!lt, carSeiLiveBg: lbg, carSeiLiveFg: lfg,
      carSeiLiveRetry: ps.length > 0 && live !== 'busy' && (live === 'fail' || (!!d && !d.live_ok)),
      onCarSeiLive: () => this.carStSeiLoad(true),
      carSeiPlayers: players,
      onCarSeiOpen: e => {
        const pid = String(e.currentTarget.dataset.pid || ''); if (!pid) return;
        this.setState({ carSeiDet: { g: String(this.state.g || ''), pid }, carSeiEd: null, carSeiAdd: null });
        setTimeout(() => this.carStSeiLoad(false), 0);
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (er) {}
      },
      onCarSeiToggle: e => this.carStSeiToggle(String(e.currentTarget.dataset.pid || '')),
      onCarSeiClear: e => this.carStSeiClear(String(e.currentTarget.dataset.pid || '')),
      onCarSeiEd: e => this.carSeiEdOpen(String(e.currentTarget.dataset.pid || '')),
      onCarSeiAdd: () => this.carSeiAddToggle(),
      onCarSeiAddIn: e => {
        const k = String(e.currentTarget.dataset.k || ''), v = String(e.currentTarget.value);
        if (['player', 'nick', 'thresh', 'ch', 'role'].indexOf(k) < 0) return;
        this.setState(st => st.carSeiAdd ? { carSeiAdd: Object.assign({}, st.carSeiAdd, { [k]: v }) } : {});
      },
      onCarSeiAddGo: () => this.carSeiAddSubmit(),
      onCarSeiAddKey: e => { if (e.key === 'Enter') { e.preventDefault(); this.carSeiAddSubmit(); } },
    };
  },

  carStSdVals(c) {
    const det = this.carSeiCur(), pid = det ? String(det.pid) : '';
    const sec = this.carSecOf(this.carSecKey('seidet') + ':' + pid), d = sec && sec.data && typeof sec.data === 'object' ? sec.data : null;
    const tfg = h => 'color-mix(in oklab,' + h + ' 55%,var(--car-fg))';
    const st = d && d.stats && typeof d.stats === 'object' ? d.stats : {}, lv = d && d.live && typeof d.live === 'object' ? d.live : null;
    const rounds = d && Array.isArray(d.rounds) ? d.rounds.filter(r => r && typeof r === 'object') : [];
    const total = d ? Math.max(+d.total_rounds || 0, rounds.length) : 0;
    const hv = {}; (Array.isArray(st.hourly) ? st.hourly : []).forEach(x => { if (x && /^\d{1,2}$/.test(String(x.h))) hv[+x.h] = (hv[+x.h] || 0) + (+x.v || 0); });
    const hmx = Math.max.apply(null, Object.keys(hv).map(k => hv[k]).concat([1]));
    const hours = Array.from({ length: 24 }, (_, h) => {
      const v = hv[h] || 0;
      return { px: v > 0 ? Math.max(4, Math.round(v / hmx * 64)) : 2, op: v > 0 ? '1' : '.35', t: String(h).padStart(2, '0') + '時 ' + this.carStN(v), lb: h % 3 === 0 ? String(h).padStart(2, '0') : '' };
    });
    const best = Object.keys(hv).sort((a, b) => hv[b] - hv[a])[0];
    const stats = [
      { k: '總場數', v: String(+st.rounds || 0), fg: 'var(--ink)' },
      { k: '近 1h', v: String(+st.recent_1h || 0) + ' 場', fg: 'var(--accent-deep)' },
      { k: '場均（10）', v: this.carStX(st.avg10), fg: 'var(--ink)' },
      { k: '全場均', v: this.carStX(st.avg_all), fg: 'var(--ink)' },
      { k: '最佳', v: this.carStX(st.best), fg: tfg('#2f9e57') },
      { k: '最差', v: this.carStX(st.worst), fg: tfg('#d64533') },
      { k: '平均間隔', v: +st.gap_avg ? (+st.gap_avg) + 's' : '—', fg: 'var(--ink)' },
      { k: '快照', v: String(+(d && d.total_snapshots) || 0), fg: 'var(--ink)' },
    ];
    if (lv) stats.unshift({ k: '總分', v: this.carStN(lv.score), fg: 'var(--ink)' }, { k: '1h 時速', v: this.carStN(lv.speed_1h), fg: 'var(--accent-deep)' },
      { k: '3h 時速', v: this.carStN(lv.speed_3h), fg: 'var(--ink)' }, { k: '24h 時速', v: this.carStN(lv.speed_24h), fg: 'var(--ink)' });
    const nb = lv ? this.carStSeiNb(lv.neighbors) : [];
    /* 判定分析（目前存的參數；成員也看得到） */
    const anSec = this.carSecOf(this.carSeiAnKey(pid)), an = anSec && anSec.data && typeof anSec.data === 'object' ? anSec.data : null, anH = +c.s.carSeiAnH || 6;
    const anErr = !an && anSec && anSec.err ? String(anSec.err) : '';
    return {
      carSeiList: false, carSeiDetail: true, carSeiEdit: false,
      carSdAnReady: !!an, carSdAnLoading: !an && !anErr, carSdAnErr: anErr, carSch: this.carSeiChart(an, c.s.carSchHi), carSan: this.carSeiAnVals(an, null, false),
      onCarSchHi: e => { const t = String(e.currentTarget.dataset.t || ''); if (t && t !== this.state.carSchHi) this.setState({ carSchHi: t }); },
      onCarSchTap: e => this.carSchTap(e),
      carSdAnHours: this.CAR_SEI_HOURS.map(h => Object.assign({ v: String(h), n: h + 'h' }, c.segOn(h === anH))),
      carSdAnStamp: anSec && anSec.busy ? '更新中…' : (anSec && anSec.at ? '更新於 ' + this.carSeiHm(anSec.at) + ' · 每 60 秒自動更新' : ''),
      carSdCanEd: !!c.admin && !!this.carStSeiFind(pid),
      onCarSdAnHours: e => { const h = +e.currentTarget.dataset.v || 6; this.setState({ carSeiAnH: h }); setTimeout(() => this.carSeiAnLoad(pid, false), 0); },
      onCarSdEd: () => this.carSeiEdOpen(pid),
      carSdLoading: !d && !(sec && sec.err), carSdErr: !d && sec && sec.err ? String(sec.err) : '', carSdReady: !!d,
      carSdName: d ? String(d.name == null ? pid : d.name) : '', carSdHasRank: !!(lv && lv.rank), carSdRank: lv && lv.rank ? '第 ' + (+lv.rank) + ' 名' : '',
      carSdSub: [d && d.event ? String(d.event) : '', st.first_time ? '紀錄 ' + this.carStTime(st.first_time, false) + ' 起' : '', st.last_time ? '最後上分 ' + this.carStTime(st.last_time, false) : ''].filter(Boolean).join(' · '),
      carSdStats: stats,
      carSdHours: hours, carSdHasHourly: Object.keys(hv).length > 0,
      carSdHourNote: best !== undefined ? '最近 24 小時上分最多的是 ' + String(best).padStart(2, '0') + ' 時（' + this.carStN(hv[best]) + '）' : '',
      carSdHasNb: nb.length > 0, carSdNb: nb,
      carSdRoundsTitle: '上分紀錄（最新 ' + rounds.length + ' / 共 ' + total + '）',
      carSdRounds: rounds.map(r => ({ t: this.carStTime(r.time, true), score: this.carStN(r.score), diff: this.carStX(r.diff), gap: +r.gap_sec ? (+r.gap_sec) + 's' : '—',
        dfg: (+r.diff || 0) < 0 ? tfg('#d64533') : 'var(--accent-deep)' })),
      carSdHasRounds: rounds.length > 0, carSdNoRounds: !!d && !rounds.length,
      carSdMore: !!d && rounds.length < total, carSdMoreBtn: sec && sec.more ? '讀取中…' : '載入更多（還有 ' + Math.max(0, total - rounds.length) + ' 筆）',
      onCarSeiBack: () => { this.setState({ carSeiDet: null }); setTimeout(() => this.carStSeiLoad(false), 0); },
      onCarSdMore: () => this.carStSeiMore(pid),
      onCarSdRetry: () => this.carStSeiDetail(pid, true),
    };
  },

  CAR_MU_GENRES: [['v', 'Vocaloid'], ['a', '動漫曲'], ['c', '中文抒情'], ['e', '英文流行'], ['j', '日文流行']],

  carMuIsQQ(gid) { return /^qqg_/.test(String(gid == null ? '' : gid)); },

  carMuLive() {
    const s = this.state, gd = this.carGuild();
    return s.page === 'car' && s.carTab === 'music' && !!gd && !this.carMuIsQQ(gd.gid);
  },

  carMuErr(e) { return (e && e.code === 'not_found') ? '機器人版本不支援這個功能，請更新機器人' : String((e && e.message) || '讀取失敗'); },

  carSec_music(force) {
    const gd = this.carGuild();
    if (!gd || this.carMuIsQQ(gd.gid)) { this.carMuStop(); return null; }
    this.carMuPoll();
    return this.carSecFetch(this.carSecKey('music'), '/status', { gid: gd.gid }, force);
  },

  async carMuRefresh() {
    const gd = this.carGuild();
    if (!gd || this.carMuIsQQ(gd.gid)) return;
    if (this._carMuBusy) { this._carMuAgain = true; return; }
    const gid = String(gd.gid), key = this.carSecKey('music');
    this._carMuBusy = true; this._carMuAgain = false;
    try {
      const d = await this.carApi('/status', { gid });
      if (String(this.state.g || '') === gid) this.carSecPut(key, { data: d, err: '', perr: '', busy: false, at: Date.now() });
    } catch (e) {
      if (String(this.state.g || '') === gid) {
        const cur = this.carSecOf(key);
        if (cur && cur.data) this.carSecPut(key, { perr: this.carMuErr(e), pat: Date.now() });   // 只標在畫面上；之後任何一次成功（at 較新）就不再顯示
        else this.carSecPut(key, { data: null, err: this.carMuErr(e), busy: false, at: Date.now() });
      }
    } finally {
      this._carMuBusy = false;
      if (this._carMuAgain) { this._carMuAgain = false; if (this.carMuLive()) this.carMuRefresh(); }
    }
  },

  carMuPoll() {
    if (this._carMuT) return;
    this._carMuT = setInterval(() => {
      if (!this.carMuLive()) { this.carMuStop(); return; }
      if (document.visibilityState !== 'hidden') this.carMuRefresh();
    }, 10000);
    // 切回這個瀏覽器分頁時馬上補一次（舊面板也是 visibilitychange 立刻 tick）
    this._carMuVis = () => {
      if (!this.carMuLive()) { this.carMuStop(); return; }
      if (document.visibilityState !== 'visible') return;
      const cur = this.carSecOf(this.carSecKey('music'));
      if (!cur || Date.now() - (cur.at || 0) > 5000) this.carMuRefresh();
    };
    document.addEventListener('visibilitychange', this._carMuVis);
  },

  carMuStop() {
    clearInterval(this._carMuT); this._carMuT = null;
    clearTimeout(this._carMuLaterT); this._carMuLaterT = null;
    if (this._carMuVis) { document.removeEventListener('visibilitychange', this._carMuVis); this._carMuVis = null; }
  },

  carMuLater(ms) {
    clearTimeout(this._carMuLaterT);
    this._carMuLaterT = setTimeout(() => { this._carMuLaterT = null; if (this.carMuLive()) this.carMuRefresh(); }, ms || 5000);
  },

  async carMuAct(action, extra, okMsg) {
    const gd = this.carGuild(); if (!gd) return null;
    if (this.carMuIsQQ(gd.gid)) { this._toast('QQ 車隊沒有語音頻道，不能點歌'); return null; }
    const gid = String(gd.gid), same = () => String(this.state.g || '') === gid;
    const d = await this.carAct('/music', Object.assign({ action }, extra || {}), null);
    if (!d) { if ((action === 'play' || action === 'auto') && same()) this.carMuLater(5000); return null; }   // 逾時的點歌機器人可能還是排進去了
    if (d.pending) { this._toast(String(d.msg || '已送出，機器人還在處理，稍後會更新'), 4500); if (same()) this.carMuLater(5000); return d; }
    const m = typeof okMsg === 'function' ? okMsg(d) : okMsg;
    if (m) this._toast(String(m), action === 'play' ? 3600 : 0);
    if (same()) { this.carMuRefresh(); if (action === 'play' || action === 'skip' || action === 'auto') this.carMuLater(4000); }
    return d;
  },

  carMuNote(d) {
    if (d.queued_only) return '（' + String(d.guild || '') + ' 機器人還沒進語音，進去後會自動播）';
    return d.vc ? '　→ ' + String(d.guild || '') + ' #' + String(d.vc) : '';
  },

  async carMuPlay(q, clear) {
    q = String(q || '').trim();
    if (!q) { this._toast('請輸入網址或關鍵字'); return null; }
    if (this._carActBusy) { this._toast('上一個操作還在處理中'); return null; }
    this._toast('解析中…', 20000);
    const d = await this.carMuAct('play', { query: q.slice(0, 500) },
      r => '已加入：' + String(r.title || '') + ((+r.added || 0) > 1 ? '（' + (+r.added) + ' 首）' : '') + this.carMuNote(r));
    if (d && clear && String(this.state.carMuQ || '').trim() === q) this.setState({ carMuQ: '' });
    return d;
  },

  async carMuSearch(q, tries) {
    const gd = this.carGuild(); if (!gd || this.carMuIsQQ(gd.gid)) return;
    q = String(q || '').trim();
    if (!q) { this._toast('請輸入關鍵字'); return; }
    if (/^https?:\/\//i.test(q)) { this.carMuPlay(q, true); return; }
    const gid = String(gd.gid), seq = this._carMuSeq = (this._carMuSeq || 0) + 1;
    clearTimeout(this._carMuSrchT);
    const prev = this.state.carMuRes;
    this.setState({ carMuRes: { rid: seq, gid, q, list: [], busy: true, err: '', note: tries && prev ? String(prev.note || '') : '', added: {} } });
    let d = null, err = '';
    try { d = await this.carApi('/music', { gid, body: { action: 'search', query: q.slice(0, 200), n: 12 } }); }
    catch (e) { err = this.carMuErr(e); }
    if (seq !== this._carMuSeq) return;
    if (String(this.state.g || '') !== gid) { const r = this.state.carMuRes; if (r && r.rid === seq) this.setState({ carMuRes: null }); return; }   // 搜到一半換了車隊：丟掉，免得切回來卡在「搜尋中」
    if (d && d.pending) {
      const again = (tries || 0) < 1;
      this.setState({ carMuRes: { rid: seq, gid, q, list: [], busy: again, err: '', note: String(d.msg || '搜尋比較久，請稍後再試一次'), added: {} } });
      if (again) this._carMuSrchT = setTimeout(() => {
        if (seq !== this._carMuSeq) return;
        if (this.carMuLive() && String(this.state.g || '') === gid) this.carMuSearch(q, (tries || 0) + 1);
        else { const r = this.state.carMuRes; if (r && r.rid === seq) this.setState({ carMuRes: Object.assign({}, r, { busy: false }) }); }
      }, 5000);
      return;
    }
    const list = ((d && Array.isArray(d.results)) ? d.results : [])
      .filter(r => r && typeof r.url === 'string' && /^https?:\/\//i.test(r.url)).slice(0, 20)
      .map(r => ({ title: String(r.title || '?'), url: r.url, duration: +r.duration || 0, uploader: String(r.uploader || ''), views: +r.views || 0, thumb: typeof r.thumb === 'string' ? r.thumb : '' }));
    this.setState({ carMuRes: { rid: seq, gid, q: String((d && d.query) || q), list, busy: false, err, note: '', added: {} } });
  },

  async carMuAdd(i) {
    const r = this.state.carMuRes, it = r && r.list[i];
    if (!it || (r.added || {})[i]) return;
    if (this._carActBusy) { this._toast('上一個操作還在處理中'); return; }
    const rid = r.rid;
    const mark = v => this.setState(st => {
      const cur = st.carMuRes; if (!cur || cur.rid !== rid) return null;
      const added = Object.assign({}, cur.added); if (v) added[i] = v; else delete added[i];
      return { carMuRes: Object.assign({}, cur, { added }) };
    });
    mark('busy');
    const d = await this.carMuPlay(it.url, false);
    mark(d ? 'done' : '');
  },

  carMuVol(v) {
    const gd = this.carGuild(); if (!gd) return;
    v = Math.max(5, Math.min(200, Math.round((+v || 100) / 5) * 5));
    const gid = String(gd.gid);
    this.setState({ carMuVolDraft: { gid, v } });
    clearTimeout(this._carMuVolT);
    this._carMuVolT = setTimeout(async () => {
      const d = await this.carMuAct('volume', { value: v }, r => '音量 ' + (r.volume != null ? r.volume : v) + '%');
      const key = 'music:' + gid, cur = this.carSecOf(key);
      if (d && !d.pending && d.volume != null && cur && cur.data) this.carSecPut(key, { data: Object.assign({}, cur.data, { volume: +d.volume }) });
      const dr = this.state.carMuVolDraft;
      if (dr && dr.gid === gid && dr.v === v) this.setState({ carMuVolDraft: null });
    }, 450);
  },

  carSecVals_music(c) {
    const s = c.s, gid = String((c.gd && c.gd.gid) || ''), pill = c.pill;
    if (this.carMuIsQQ(gid)) return { carMuQQ: true, carMuLoading: false, carMuErr: '', carMuReady: false };
    const fd = x => {
      x = Math.max(0, Math.floor(+x || 0)); if (!x) return '—';
      const h = Math.floor(x / 3600), mm = Math.floor(x % 3600 / 60), ss = String(x % 60).padStart(2, '0');
      return h ? h + ':' + String(mm).padStart(2, '0') + ':' + ss : mm + ':' + ss;
    };
    const fv = v => v >= 1e8 ? (v / 1e8).toFixed(1) + '億' : v >= 1e4 ? Math.round(v / 1e4) + '萬' : String(v);
    const ok = t => ({ t, bg: 'color-mix(in oklab,#2f9e57 15%,var(--card))', fg: 'color-mix(in oklab,#2f9e57 55%,var(--car-fg))' });
    const bad = t => ({ t, bg: 'color-mix(in oklab,#ee6644 15%,var(--card))', fg: 'color-mix(in oklab,#ee6644 55%,var(--car-fg))' });
    const neu = t => ({ t, bg: 'var(--card-2)', fg: 'var(--text-3)' });
    const sec = (s.carSec || {})['music:' + gid] || null;
    const d = (sec && sec.data && typeof sec.data === 'object') ? sec.data : null;
    const adm = !!c.admin && !!d && !d.member_view;
    const busy = !!s.carActBusy;
    const q = String(s.carMuQ || '');
    const R = s.carMuRes && s.carMuRes.gid === gid ? s.carMuRes : null;
    const out = {
      carMuQQ: false,
      carMuLoading: !d && !(sec && sec.err),
      carMuErr: !d && sec && sec.err ? String(sec.err) : '',
      carMuReady: !!d,
      carMuQ: q,
      carMuSearchBtn: R && R.busy ? '搜尋中…' : (/^https?:\/\//i.test(q.trim()) ? '加入佇列' : '搜尋'),
      carMuCols: s.mobile ? 'minmax(0,1fr)' : 'minmax(0,1.25fr) minmax(0,1fr)',
      onCarMuReload: () => { this.carSec_music(true); },
      onCarMuKey: e => {
        if (e.key !== 'Enter') return;
        if ((e.nativeEvent && e.nativeEvent.isComposing) || e.keyCode === 229) return;   // 注音／日文輸入法按 Enter 選字（Safari 會送 keyCode 229）不算送出
        e.preventDefault(); this.carMuSearch(this.state.carMuQ);
      },
      onCarMuSearch: () => this.carMuSearch(this.state.carMuQ),
      onCarMuPlayNow: () => this.carMuPlay(this.state.carMuQ, true),
      onCarMuResClear: () => { clearTimeout(this._carMuSrchT); this._carMuSeq = (this._carMuSeq || 0) + 1; this.setState({ carMuRes: null }); },
      onCarMuAdd: e => { const i = +e.currentTarget.dataset.i; if (i >= 0) this.carMuAdd(i); },
      onCarMuCtl: e => {
        const a = String(e.currentTarget.dataset.a || '');
        const C = {
          pause: [r => r.state === 'paused' ? '已暫停' : '繼續播放'],
          skip: ['已跳過'],
          mix: [r => '混音 ' + (r.mix ? '開啟' : '關閉')],
          stop: ['已停止並清空', '停止播放並清空佇列？\n正在播的歌會停掉、排隊中的歌全部移除，自動歌單也會一起關閉。'],
          leave: ['已離開語音頻道', '讓機器人離開語音頻道？\n會清空佇列、關閉自動歌單，並取消「語音常駐頻道」設定（之後要常駐得重新設定）。'],
        }[a];
        if (!C) return;
        if (C[1] && !window.confirm(C[1])) return;
        this.carMuAct(a, null, C[0]);
      },
      onCarMuVol: e => this.carMuVol(e.target.value),
      onCarMuGenre: e => {
        const k = String(e.currentTarget.dataset.g || '');
        if (!this.CAR_MU_GENRES.some(x => x[0] === k)) return;
        this.carMuAct('auto', { genre: k }, r => '自動播放：' + String(r.genre || ''));
      },
    };
    if (!d) return out;

    const p = d.playing && typeof d.playing === 'object' ? d.playing : null;
    const dur = p ? Math.max(0, +p.duration || 0) : 0, pos = p ? Math.max(0, +p.pos || 0) : 0;
    const pills = [d.online ? ok('機器人在線') : bad('機器人離線'),
      d.voice_connected ? ok('語音 · ' + String(d.voice_channel || '已連線')) : neu('語音未連線')];
    const gName = (this.CAR_MU_GENRES.find(x => x[0] === d.auto_genre) || [])[1] || '';
    if (adm) {
      if (d.latency != null && isFinite(+d.latency)) pills.push(neu('延遲 ' + Math.round(+d.latency) + ' ms'));
      pills.push(d.voice_home ? ok('常駐 開') : neu('常駐 關'));
      if (gName) pills.push(ok('自動歌單 ' + gName));
    }
    const qa = Array.isArray(d.queue) ? d.queue.filter(t => t && typeof t === 'object') : [];
    const qn = Math.max(qa.length, Math.floor(+d.queue_len || 0));
    const queue = qa.slice(0, 15).map((t, i) => ({ n: String(i + 1), title: String(t.title || '?'), sub: (t.requester ? String(t.requester) + ' · ' : '') + fd(t.duration) }));
    const dr = s.carMuVolDraft;
    const vol = dr && dr.gid === gid ? dr.v : Math.max(5, Math.min(200, Math.round(+d.volume || 100)));
    const list = R ? R.list : [];
    const res = list.map((x, i) => {
      const st = (R.added || {})[i] || '', th = /^https:\/\//i.test(x.thumb) ? x.thumb : '';
      return { i: String(i), title: x.title, sub: [fd(x.duration), x.uploader, x.views ? fv(x.views) + ' 次' : ''].filter(Boolean).join(' · '),
        thumb: th, hasThumb: !!th, noThumb: !th, dis: !!st, op: st ? '.5' : '1', tag: st === 'done' ? '已加入' : st === 'busy' ? '加入中…' : '' };
    });
    return Object.assign(out, {
      carMuPErr: sec && sec.perr && (sec.pat || 0) >= (sec.at || 0) ? String(sec.perr) : '',
      carMuPills: pills,
      carMuPlaying: !!p, carMuIdle: !p,
      carMuTitle: p ? String(p.title || '?') : '',
      carMuTime: p ? fd(dur ? Math.min(pos, dur) : pos) + ' / ' + fd(dur) : '',
      carMuBy: p ? String(p.requester || '—') : '',
      carMuPct: dur ? Math.max(0, Math.min(100, Math.round(pos / dur * 1000) / 10)) : 0,
      carMuNoVc: !d.voice_connected,
      carMuAdmin: adm,
      carMuBusy: busy, carMuBusyOp: busy ? '.55' : '1',
      carMuMixTxt: '混音 ' + (d.mix ? '開' : '關'),
      carMuVol: vol, carMuVolTxt: vol + '%',
      carMuGenres: this.CAR_MU_GENRES.map(([k, n]) => Object.assign({ k, n, on: d.auto_genre === k ? 'true' : 'false' }, pill(d.auto_genre === k))),
      carMuTip: adm ? '輸入關鍵字按「搜尋」挑歌，點結果加入佇列；貼網址（含播放清單）或按「直接播放」會直接排進佇列（關鍵字取第一筆）。'
        : '搜尋後點一下即可加入佇列（每人最多 3 首排隊中）；貼 YouTube 網址會直接加入。',
      carMuResShow: !!R,
      carMuResLine: !R ? '' : R.err ? (/^搜尋失敗/.test(R.err) ? R.err : '搜尋失敗：' + R.err)
        : R.note ? R.note + (R.busy ? '（稍後自動再試一次）' : '')
        : R.busy ? '搜尋中…'
        : res.length ? '「' + R.q + '」' + res.length + ' 筆 · 點一下加入佇列' : '「' + R.q + '」找不到結果',
      carMuRes: res,
      carMuQueue: queue,
      carMuQueueN: qn ? '共 ' + qn + ' 首' : '',
      carMuQueueEmpty: !queue.length,
      carMuQueueMore: qn > queue.length ? '還有 ' + (qn - queue.length) + ' 首沒列出' : '',
    });
  },

  carSec_bridge(force) { return this.carSecFetch(this.carSecKey('bridge'), '/bridge', { car: 1 }, force); },

  carBrUiOf() { return this.carSecOf(this.carSecKey('bridgeUi')) || {}; },

  carBrUi(patch) { this.carSecPut(this.carSecKey('bridgeUi'), patch); },

  carBrData() { const x = this.carSecOf(this.carSecKey('bridge')); return x && x.data && typeof x.data === 'object' ? x.data : null; },

  carBrNum(v) { return v != null && v !== '' && isFinite(+v) ? +v : null; },

  carBrDates(car) {
    const st = (this.state.carStates || {})[car || 1], pad = n => String(n).padStart(2, '0'), t0 = new Date();
    const today = /^\d{4}-\d{2}-\d{2}$/.test(String((st && st.today) || '')) ? String(st.today) : t0.getFullYear() + '-' + pad(t0.getMonth() + 1) + '-' + pad(t0.getDate());
    let ds = (st && Array.isArray(st.days) ? st.days : []).filter(x => x && !x.xday && /^\d{4}-\d{2}-\d{2}$/.test(String(x.date)) && String(x.date) >= today).map(x => String(x.date));
    if (!ds.length) {
      const [y, m, d] = today.split('-').map(Number);   // 用年月日建日期：Safari 舊版會把 'YYYY-MM-DDTHH:MM' 當 UTC
      ds = [0, 1, 2, 3, 4, 5, 6].map(i => { const x = new Date(y, m - 1, d + i); return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()); });
    }
    return Array.from(new Set(ds)).slice(0, 8).map(v => ({ v, n: this.carDayLabel(v, today) }));
  },

  async carBrPost(slot, body, okMsg, car) {
    if (this._carActBusy) { this._toast('上一個操作還在處理中'); return null; }
    const gid = String(this.state.g || '');
    const d = await this.carAct('/bridge', body, x => (x && x.pending) ? String(x.msg || '已送出，機器人正在背景處理') : String(typeof okMsg === 'function' ? okMsg(x || {}) : okMsg), car || 1);
    if (String(this.state.g || '') !== gid) return null;               // 等回應的途中切了車隊：結果不套到別隊
    // 機器人有些錯誤字串會原樣帶 gid（QQ 車隊的 key 是 qqg_<群 openid>）：不要把 openid 吐在畫面上
    this.carBrUi({ ['err_' + slot]: d ? '' : String(this.state.toast || '操作失敗').replace(/qqg_[A-Za-z0-9_-]{4,}/g, 'QQ 車隊') });
    if (d && d.pending) setTimeout(() => { if (String(this.state.g || '') === gid) this.carSec_bridge(true); }, 5000);
    return d;
  },

  async carBrCode() {
    const d0 = this.carBrData(), n0 = d0 && d0.bridged && Array.isArray(d0.peers) ? d0.peers.length : 0;
    const d = await this.carBrPost('pair', { action: 'code' }, x => '配對碼已產生：' + String(x.code || ''));
    if (!d) return;
    const code = String(d.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (!code) { this.carSec_bridge(true); return; }
    const mins = Math.min(120, Math.max(1, parseInt(d.minutes, 10) || 15)), exp = Date.now() + mins * 60000;
    this.carBrUi({ code, codeExp: exp });
    this.carBrWatch(code, exp, n0);
  },

  carBrWatch(code, exp, n0) {
    clearInterval(this._carBrPollT);
    const gid = String(this.state.g || '');
    const stop = () => { clearInterval(this._carBrPollT); this._carBrPollT = null; };
    this._carBrPollT = setInterval(async () => {
      if (String(this.state.g || '') !== gid || this.carBrUiOf().code !== code) { stop(); return; }
      if (Date.now() > exp) { stop(); this.carBrUi({ codeTick: Date.now() }); return; }   // 讓畫面換成「已過期」
      if (this.state.page !== 'car' || this.state.carTab !== 'bridge' || document.hidden || this._carActBusy) return;
      const d = await this.carSec_bridge(true);
      if (String(this.state.g || '') !== gid || this.carBrUiOf().code !== code) return;
      const n = d && d.bridged && Array.isArray(d.peers) ? d.peers.length : 0;
      if (n > n0) { stop(); this.carBrUi({ code: '', codeExp: 0 }); this._toast('有車隊用配對碼加入了'); this.carLoadStates(1); }
    }, 8000);
  },

  async carBrJoin() {
    const code = String(this.carBrUiOf().join || '').toUpperCase().replace(/[\s-]/g, '');
    if (!code) { this._toast('先填配對碼'); return; }
    if (!/^[A-Z0-9]{6}$/.test(code)) { this._toast('配對碼是 6 碼英文和數字'); return; }
    const d = await this.carBrPost('pair', { action: 'join', code }, x => '已加入橋接組' + (x.members_moved != null ? '（併入成員 ' + (this.carBrNum(x.members_moved) || 0) + ' 位、班表 ' + (this.carBrNum(x.days_merged) || 0) + ' 天）' : ''));
    if (!d) return;
    clearInterval(this._carBrPollT);
    this.carBrUi({ join: '', code: '', codeExp: 0 });
    this.carLoad();          // 班表變成共用那一份、車清單也可能變：整個車隊頁重抓（會順便重抓這個分頁）
  },

  async carBrRenew() {
    const d = await this.carBrPost('pair', { action: 'renew' }, x => this.carBrNum(x.hours_left) != null ? '已續期，還剩 ' + this.carBrNum(x.hours_left) + ' 小時' : '已續期');
    if (d) this.carSec_bridge(true);
  },

  async carBrLeave() {
    const d0 = this.carBrData(); if (!d0 || !d0.bridged) return;
    const ask = d0.is_anchor
      ? '確定要解散整個橋接組？\n\n你這隊是跑者方：跑者方退出＝整組解散。\n班表會複製一份留在各隊，之後各排各的；房號與頻道設定不再同步。'
      : '確定要退出橋接？\n\n班表會複製一份留在各隊，其他隊繼續共用；之後這一隊的班表跟橋接組分開。';
    if (!window.confirm(ask)) return;
    const d = await this.carBrPost('pair', { action: 'leave' }, x => x.dissolved ? '整組已解散' : '已退出橋接');
    if (!d) return;
    clearInterval(this._carBrPollT);
    this.carBrUi({ code: '', codeExp: 0, room: null, roomRes: null, ch: {}, err_room: '', err_px: '', err_ch: '' });
    this.carLoad();
  },

  async carBrRoom(close) {
    const d0 = this.carBrData(); if (!d0 || !d0.bridged) return;
    let room = '';
    if (close) {
      if (!window.confirm('確定要關房？\n\n整組 Discord 隊的車牌頻道會改回原名，目前的房號會清掉。')) return;
    } else {
      const ui = this.carBrUiOf();
      room = String(ui.room != null ? ui.room : (d0.room || '')).replace(/\s+/g, '');
      if (!room) { this._toast('先填房號'); return; }
      if (!/^\d{1,10}$/.test(room)) { this._toast('房號只能是數字'); return; }
    }
    const gid = String(this.state.g || '');
    this.carBrUi({ roomRes: null });
    const n = v => this.carBrNum(v) || 0;
    const d = await this.carBrPost('room', { action: 'room', room }, x => close ? '已關房（' + n(x.restored) + ' 個車牌還原）' : '房號 ' + room + '：車牌改名 ' + n(x.renamed) + ' · 公告 ' + n(x.messaged) + ' · QQ ' + n(x.qq));
    if (!d) {
      // Discord 改名有頻率限制，機器人可能還在背景跑（代理 20 秒就放棄）：稍後再看一次結果
      setTimeout(() => { if (String(this.state.g || '') === gid) this.carSec_bridge(true); }, 5000);
      return;
    }
    // 草稿清掉、輸入框改顯示機器人那邊的房號（pending 時 5 秒後重抓就會看到新房號）
    const L = a => (Array.isArray(a) ? a : []).map(x => String(x == null ? '' : x)).filter(Boolean).slice(0, 40);
    this.carBrUi({ room: null, roomRes: close || d.pending ? null : { room, ok: L(d.renamed_detail), skip: L(d.skipped), renamed: n(d.renamed), messaged: n(d.messaged), qq: n(d.qq) } });
    this.carSec_bridge(true);
  },

  carBrPxCar(gd) {
    const nos = this.carCars(gd || this.carGuild()).map(c => c.no), ui = this.carBrUiOf();
    const want = +ui.pxCar || +this.carNo() || 1;
    return nos.indexOf(want) >= 0 ? want : 1;
  },

  async carBrProxy() {
    const car = this.carBrPxCar();
    const ui = this.carBrUiOf(), dates = this.carBrDates(car);
    const name = String(ui.pxName || '').trim(), bs = String(ui.pxBonus || '').trim(), hours = String(ui.pxHours || '').trim();
    if (!name || !bs || !hours) { this._toast('名字、倍率、時段都要填'); return; }
    const bonus = Number(bs);
    if (!isFinite(bonus) || (bonus !== 0 && (bonus < 1.18 || bonus > 3.88))) { this._toast('倍率要是 0 或 1.18～3.88'); return; }
    const role = ui.pxRole === 's6' ? 's6' : 'pusher';
    const date = dates.some(o => o.v === ui.pxDate) ? ui.pxDate : (dates[0] ? dates[0].v : '');
    const body = { action: 'proxy', name, bonus, hours, date, role };
    if (role === 's6') {
      const s6 = Number(String(ui.pxS6 || '').trim());
      if (!isFinite(s6) || s6 <= 0) { this._toast('報 S6 要填 S6 倍率'); return; }
      body.s6_bonus = s6;
    }
    const multiCar = this.carCars(this.carGuild()).length > 1;
    const cname = multiCar ? '（' + (this.carCars(this.carGuild()).find(c => c.no === car) || { name: car + '車' }).name + '）' : '';
    body.car = car;
    const d = await this.carBrPost('px', body, x => {
      const ok = Array.isArray(x.hours) ? x.hours.length : 0, sk = Array.isArray(x.skipped) ? x.skipped.length : 0;
      return ok ? String(x.name || name) + ' 已代報 ' + ok + ' 個時段' + cname + (sk ? '（' + sk + ' 段沒開班，略過）' : '') : '沒有報到：這些時段都沒開班' + cname;
    }, car);
    if (!d || d.pending) return;
    if (Array.isArray(d.hours) && d.hours.length) this.carBrUi({ pxName: '' });
    this.carLoadStates(car);
  },

  async carBrChSave(g) {
    const d0 = this.carBrData(); if (!d0 || !d0.bridged) return;
    const p = (Array.isArray(d0.peers) ? d0.peers : []).find(x => x && String(x.gid) === String(g) && x.kind === 'dc');
    if (!p) return;
    const dr = (this.carBrUiOf().ch || {})[String(p.gid)] || {};
    const body = { action: 'channel', target_gid: String(p.gid) };
    let n = 0;
    for (const [k, lab] of [['board', '看板頻道'], ['plate', '車牌頻道'], ['room_ch', '房號公告頻道']]) {
      if (dr[k] == null) continue;
      const v = String(dr[k]).trim();
      if (v === String(p[k] || '')) continue;         // 只送有改的欄位：機器人每收到一次車牌／看板就會丟掉原名紀錄與舊看板訊息
      if (v && !/^\d{15,22}$/.test(v)) { this._toast(lab + '要填頻道 ID（一串數字）'); this.carBrUi({ err_ch: '「' + String(p.name || '') + '」的' + lab + '要填頻道 ID（一長串數字），或留空沿用原本的設定。' }); return; }
      body[k] = v; n++;
    }
    if (!n) { this._toast('沒有變更'); return; }
    const d = await this.carBrPost('ch', body, '已儲存「' + String(p.name || '') + '」的橋接頻道');
    if (!d) return;
    if (d.gid != null && String(d.gid) !== String(p.gid)) {
      // 舊版機器人不認得 target_gid，會把設定寫到自己這隊：講清楚，別讓人以為對方那隊已經設好
      const msg = '注意：機器人版本太舊，這次的設定被存到了本隊而不是「' + String(p.name || '') + '」。請更新機器人後再設一次，並檢查本隊的頻道設定。';
      this._toast('機器人版本太舊，設定存到了本隊');
      this.carBrUi({ err_ch: msg });
    } else {
      const ch = Object.assign({}, this.carBrUiOf().ch); delete ch[String(p.gid)];
      this.carBrUi({ ch });
    }
    this.carSec_bridge(true);
  },

  carSecVals_bridge(c) {
    const { s, gd } = c;
    const sec = this.carSecOf(this.carSecKey('bridge')) || {}, ui = this.carBrUiOf();
    const d = sec.data && typeof sec.data === 'object' ? sec.data : null;
    const busy = !!s.carActBusy, adm = !!(c.admin || (d && d.admin === true)), on = !!(d && d.bridged);
    const num = v => this.carBrNum(v);
    const peers = on && Array.isArray(d.peers) ? d.peers.filter(p => p && typeof p === 'object') : [];
    const anchorP = peers.find(p => p.anchor) || null, anchorName = anchorP ? String(anchorP.name || '') : '';
    const nCars = this.carCars(gd).length, multi = nCars > 1;
    const pxCar = this.carBrPxCar(gd);
    const hl = on ? num(d.hours_left) : null, ttl = num(d && d.ttl_hours) || 200;
    const em = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String((d && d.expires_at) || ''));   // 機器人的本地時間字串，照字面顯示不換時區
    const expTxt = em ? (+em[1]) + '/' + (+em[2]) + ' ' + em[3] + ':' + em[4] : '';
    const mix = hex => ({ bg: 'color-mix(in oklab,' + hex + ' 15%,var(--card))', fg: 'color-mix(in oklab,' + hex + ' 55%,var(--car-fg))' });
    const neutral = { bg: 'var(--card-2)', fg: 'var(--text-3)' };
    const stP = on ? mix('#2f9e57') : neutral, hrP = hl != null && hl < 24 ? mix('#ee6644') : neutral;
    const room = on ? String(d.room || '') : '', roomSrc = on ? String(d.room_src || '') : '';
    const roomNow = room ? '目前房號 ' + room + (roomSrc ? '（由 ' + roomSrc + ' 設定）' : '') : '目前沒有房號';
    /* 配對碼 */
    const code = String(ui.code || ''), codeExp = +ui.codeExp || 0, codeLive = !!code && Date.now() < codeExp;
    const hm = t => { const x = new Date(t); return String(x.getHours()).padStart(2, '0') + ':' + String(x.getMinutes()).padStart(2, '0'); };
    /* 房號同步結果 */
    const rr = on && ui.roomRes && typeof ui.roomRes === 'object' ? ui.roomRes : null;
    /* 代報 */
    const dates = this.carBrDates(pxCar);
    const pxDate = dates.some(o => o.v === ui.pxDate) ? ui.pxDate : (dates[0] ? dates[0].v : '');
    const pxS6 = ui.pxRole === 's6';
    /* 各隊頻道：本隊（Discord）有頻道清單時用選單，其他隊只能填頻道 ID（機器人沒有給別隊的頻道清單） */
    const st1 = (s.carStates || {})[1];
    const chList = st1 && Array.isArray(st1.channels) ? st1.channels.filter(x => x && /^\d{5,25}$/.test(String(x.id))).map(x => ({ v: String(x.id), n: '#' + String(x.name || x.id) })) : [];
    const chName = id => { const f = chList.find(o => o.v === String(id)); return f ? f.n : ''; };
    const drafts = ui.ch && typeof ui.ch === 'object' ? ui.ch : {};
    const FIELDS = [['board', '看板頻道', ''], ['plate', '車牌頻道', 'plate_fallback'], ['room_ch', '房號公告頻道', 'room_fallback']];
    const chRows = on && adm ? peers.filter(p => p.kind === 'dc' && /^\d+$/.test(String(p.gid))).map(p => {
      const g = String(p.gid), dr = drafts[g] || {}, pick = !!p.me && chList.length > 0;
      const fields = FIELDS.map(([k, label, fbk]) => {
        const cur = String(p[k] || ''), val = dr[k] != null ? String(dr[k]) : cur, fb = fbk ? String(p[fbk] || '') : '';
        const fbName = fb ? ((pick && chName(fb)) || fb) : '';
        const ph = k === 'board' ? '看板頻道 ID（留空＝不貼看板）' : fb ? '沿用 ' + fbName : (k === 'plate' ? '車牌頻道 ID（房號改名用）' : '房號公告頻道 ID');
        let opts = [];
        if (pick) {
          opts = [{ v: '', n: k === 'board' ? '（不貼看板）' : fb ? '（沿用 ' + fbName + '）' : '（未設定）' }].concat(chList);
          if (val && !chList.some(o => o.v === val)) opts.push({ v: val, n: '（找不到這個頻道：' + val + '）' });
        }
        return { g, k, label, val, ph, pick, raw: !pick, opts, dirty: val.trim() !== cur };
      });
      const dirty = fields.some(f => f.dirty);
      return { g, name: String(p.name || '（未命名）'), anchor: !!p.anchor, me: !!p.me, fields,
        sbg: dirty ? 'var(--ink-grad)' : 'var(--card)', sfg: dirty ? '#fff' : 'var(--text-2)', sbd: dirty ? 'transparent' : 'var(--border)' };
    }) : [];
    const setUi = (patch) => this.carBrUi(patch);
    return {
      carBrLoading: !d && !sec.err,
      carBrErr: !d && sec.err ? String(sec.err) : '',
      carBrReady: !!d,
      carBrBusy: busy, carBrOp: busy ? '.6' : '1',
      carBrAdm: adm, carBrOn: on, carBrNone: !!d && !on,
      carBrStTxt: on ? '已橋接 · ' + peers.length + ' 隊' : '未橋接', carBrStBg: stP.bg, carBrStFg: stP.fg,
      carBrHrShow: on && hl != null, carBrHrTxt: hl != null && hl > 0 ? '剩 ' + Math.round(hl * 10) / 10 + ' 小時' : '已到期', carBrHrBg: hrP.bg, carBrHrFg: hrP.fg,
      carBrHead: on
        ? '跑者方 ' + (anchorName || '（未知）') + ' · ' + peers.length + ' 隊共用' + (multi ? ' ' + nCars + ' 台車的班表（每台車各自共用）' : '一張班表') + (expTxt ? ' · ' + expTxt + ' 到期' : '') + (hl != null && hl <= 0 ? '（下一次掃描就會自動解散）' : '')
        : '一次 ' + ttl + ' 小時，到期自動解散。',
      carBrTtl: String(ttl),
      carBrCanPair: !on && adm,
      carBrMultiNote: !on && adm && multi ? '這個車隊同時開 ' + nCars + ' 台車：橋接後每台車的班表各自共用（一車對一車、二車對二車），對方加入時整組車數取兩邊較多的；各隊綁到某台車的頻道照樣報那台車。' : '',
      carBrMemberNote: !!d && !on && !adm,
      carBrMemberOnNote: on && !adm,
      carBrJoinVal: String(ui.join || ''),
      carBrPeers: peers.map((p, i) => ({ name: String(p.name || '（未命名）'), anchor: !!p.anchor, me: !!p.me,
        side: (p.anchor ? '跑者方' : '推手方') + ' · ' + (p.kind === 'qq' ? 'QQ 群' : 'Discord'),
        bt: i ? 'var(--border)' : 'transparent', bg: p.me ? 'color-mix(in oklab,var(--accent) 7%,var(--card))' : 'transparent' })),
      carBrIsAnchor: on && !!d.is_anchor,
      carBrNotAnchorNote: on && adm && !d.is_anchor ? '要再加一隊，請跑者方（' + (anchorName || '跑者方') + '）的管理員產生配對碼。' : '',
      carBrLeaveBtn: on && d.is_anchor ? '解散橋接' : '退出橋接',
      carBrRoomNow: roomNow,
      carBrCodeShow: adm && !!code && (!on || !!d.is_anchor),
      carBrCodeLive: codeLive, carBrCodeOld: !!code && !codeLive,
      carBrCode: code,
      carBrCodeLeft: codeLive ? Math.max(1, Math.ceil((codeExp - Date.now()) / 60000)) + ' 分鐘內有效（到 ' + hm(codeExp) + '）' : '',
      carBrCodeDc: '/橋接 動作:加入 配對碼:' + code, carBrCodeQq: '/桥接 ' + code,
      carBrErrPair: String(ui.err_pair || ''),
      carBrOps: on && adm,
      carBrRoomVal: ui.room != null ? String(ui.room) : room,
      carBrRoomBtn: busy ? '處理中…' : '設定並同步',
      carBrRoomRes: !!rr,
      carBrRoomResHead: rr ? '房號 ' + String(rr.room) + ' 同步結果：車牌改名 ' + (+rr.renamed || 0) + ' · 公告 ' + (+rr.messaged || 0) + ' · QQ ' + (+rr.qq || 0) : '',
      carBrRoomOk: rr ? (rr.ok || []).map(t => ({ t: String(t) + '-' + String(rr.room) })) : [],
      carBrRoomSkip: rr ? (rr.skip || []).map(t => ({ t: String(t) })) : [],
      carBrErrRoom: String(ui.err_room || ''),
      carBrPxName: String(ui.pxName || ''), carBrPxBonus: String(ui.pxBonus || ''), carBrPxHours: String(ui.pxHours || ''), carBrPxS6: String(ui.pxS6 || ''),
      carBrPxIsS6: pxS6,
      carBrPxRoles: [['pusher', '推手'], ['s6', 'S6']].map(([v, n]) => Object.assign({ v, n, sel: (v === 's6') === pxS6 ? 'true' : 'false' }, c.segOn((v === 's6') === pxS6))),
      carBrPxDates: dates.map(o => Object.assign({}, o, c.pill(o.v === pxDate))),
      carBrPxMulti: multi,
      carBrPxCars: multi ? this.carCars(gd).map(x => Object.assign({ v: String(x.no), n: x.name }, c.pill(x.no === pxCar))) : [],
      carBrPxBtn: busy ? '處理中…' : '代報',
      carBrErrPx: String(ui.err_px || ''),
      carBrChShow: on && adm,
      carBrChRows: chRows, carBrChNone: on && adm && !chRows.length,
      carBrErrCh: String(ui.err_ch || ''),
      onCarBrReload: () => this.carSec_bridge(true),
      onCarBrField: e => {
        const k = String(e.currentTarget.dataset.k || '');
        const slot = { join: 'pair', room: 'room', pxName: 'px', pxBonus: 'px', pxHours: 'px', pxS6: 'px' }[k];
        if (!slot) return;
        setUi({ [k]: String(e.currentTarget.value), ['err_' + slot]: '' });
      },
      onCarBrKey: e => {
        if (e.key !== 'Enter' || (e.nativeEvent && e.nativeEvent.isComposing) || e.keyCode === 229) return;   // 注音／拼音選字中的 Enter 不算送出（Safari 用 229 表示）
        const a = e.currentTarget.dataset.act; e.preventDefault();
        if (a === 'join') this.carBrJoin(); else if (a === 'room') this.carBrRoom(false); else if (a === 'px') this.carBrProxy();
      },
      onCarBrPxRole: e => setUi({ pxRole: e.currentTarget.dataset.v === 's6' ? 's6' : 'pusher', err_px: '' }),
      onCarBrPxDate: e => setUi({ pxDate: String(e.currentTarget.dataset.v || ''), err_px: '' }),
      onCarBrPxCar: e => { const n = +e.currentTarget.dataset.v || 1; setUi({ pxCar: n, pxDate: '', err_px: '' }); this.carLoadStates(n); },
      onCarBrChField: e => {
        const ds = e.currentTarget.dataset, g = String(ds.g || ''), k = String(ds.k || '');
        if (!g || ['board', 'plate', 'room_ch'].indexOf(k) < 0) return;
        const ch = Object.assign({}, this.carBrUiOf().ch);
        ch[g] = Object.assign({}, ch[g], { [k]: String(e.currentTarget.value) });
        setUi({ ch, err_ch: '' });
      },
      onCarBrCode: () => this.carBrCode(),
      onCarBrCopy: () => {
        const cd = String(this.carBrUiOf().code || ''); if (!cd) return;
        try { navigator.clipboard.writeText(cd).then(() => this._toast('已複製配對碼'), () => this._toast('無法自動複製，請手動抄下配對碼')); }
        catch (er) { this._toast('無法自動複製，請手動抄下配對碼'); }
      },
      onCarBrJoin: () => this.carBrJoin(),
      onCarBrRenew: () => this.carBrRenew(),
      onCarBrLeave: () => this.carBrLeave(),
      onCarBrRoom: () => this.carBrRoom(false),
      onCarBrRoomClose: () => this.carBrRoom(true),
      onCarBrProxy: () => this.carBrProxy(),
      onCarBrChSave: e => this.carBrChSave(String(e.currentTarget.dataset.g || '')),
    };
  },

  CAR_F_CARKEYS: new Set(('schedule_open schedule_auto_confirm s6_over_bonus schedule_never_lock signup_lock_enabled signup_lock_trigger_time '
    + 'signup_lock_target_day signup_lock_target_range signup_lock_allow_shortage shortage_open_all shortage_open_hours support_slots_display '
    + 'schedule_hidden_mode runner_hidden_mode auto_expand_alert last_expand_alert schedule_board_channel schedule_board_message '
    + 'schedule_board_date gsheet_id gsheet_auto gsheet_last_push '
    /* 排班參數（機器人 sched_rules.CAR_KEYS）：排位規則、當天截止、每格人數上限、滿班自動鎖 */
    + 'seat_order bonus_tie_step multi_open_policy min_bonus_pusher min_bonus_s6 signup_close_hours signup_close_s6_hours '
    + 'slot_applicant_cap auto_lock_full').split(' ')),

  CAR_F_GENRE: { v: 'Vocaloid', a: '動漫曲', c: '中文抒情', e: '英文流行', j: '日文流行' },

  carFAdm() {
    const gd = this.carGuild(), st = (this.state.carStates || {})[this.carNo()];
    return !!((st && st.role === 'admin') || (gd && gd.role === 'admin'));
  },

  carFQQ() { return /^qqg_/.test(String(this.state.g || '')); },

  carFTxt(v) { return String(v == null ? '' : v).replace(/[\u{1F000}-\u{1FAFF}\u{FE0F}\u{200D}\u{2600}-\u{2604}\u{2606}-\u{2712}\u{2714}\u{2716}-\u{27BF}]/gu, '').trim(); },

  carFMsg(d, dflt) { const m = this.carFTxt(d && d.msg); return (d && d.pending) ? (m || '已送出，機器人處理中') : (m || dflt); },

  carFLater(fn) { const g0 = String(this.state.g || ''); setTimeout(() => { if (String(this.state.g || '') !== g0) return; try { fn(); } catch (e) {} }, 5000); },

  carFEnter(e) { return !!e && e.key === 'Enter' && !(e.nativeEvent && e.nativeEvent.isComposing) && e.keyCode !== 229; },

  carFYmd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },

  carFToday() {
    const st = (this.state.carStates || {})[this.carNo()];
    return st && /^\d{4}-\d{2}-\d{2}$/.test(String(st.today || '')) ? String(st.today) : this.carFYmd(new Date());
  },

  carFAddDay(ymd, n) { const p = String(ymd).split('-').map(Number); return this.carFYmd(new Date(p[0], p[1] - 1, p[2] + n)); },

  carFCarName(no) {
    const gd = this.carGuild(), c = gd ? this.carCars(gd).find(x => x.no === +no) : null;
    return c ? c.name : (this.CAR_NAMES[+no] || (no + '車'));
  },

  carFCarSeg(segOn) {
    const gd = this.carGuild(), no = this.carNo();
    return gd ? this.carCars(gd).map(c => Object.assign({ v: String(c.no), n: c.name, sel: c.no === no ? 'true' : 'false' }, segOn(c.no === no))) : [];
  },

  async carFSeq(list, no) {
    if (this._carActBusy) { this._toast('上一個操作還在處理中'); return null; }
    this._carActBusy = true; this.setState({ carActBusy: true });
    let ok = 0, fail = 0, err = '';
    try {
      for (const it of list) {
        try { await this.carApi(it.path, { body: it.body, car: no }); ok++; }
        catch (e) {
          fail++; if (!err) err = String((e && e.message) || '失敗').slice(0, 60);
          const st = e && e.status;
          if (!st || st >= 500 || st === 401 || st === 403) break;      // 機器人連不上或沒權限：後面也一樣會失敗
        }
      }
    } finally { this._carActBusy = false; this.setState({ carActBusy: false }); }
    return { ok, fail, err };
  },

  carSec_settings(force) {
    if (!this.carFAdm()) return;
    this.carFSheetInfo(force);
  },

  carFSheetInfo(force) { return this.carSecFetch(this.carSecKey('sheet', true), '/sheet', { body: { action: 'info' } }, force); },

  carFBgInfo(force) { return this.carSecFetch(this.carSecKey('bgimg', false), '/schedbg', {}, force); },

  async carFBgAct(body, okMsg) {
    const d = await this.carAct('/schedbg', body, okMsg);
    if (d && Array.isArray(d.items)) this.carSecPut(this.carSecKey('bgimg', false), { data: d, err: '', at: Date.now() });
    return d;
  },

  async carFBgPreview(id) {
    const g0 = String(this.state.g || '');
    this.setState({ carFBgPv: { busy: true } });
    try {
      const d = await this.carApi('/schedbg', { body: { action: 'preview', id: String(id || '') } });
      if (String(this.state.g || '') !== g0) return;
      const u = d && String(d.preview || '');
      this.setState({ carFBgPv: /^data:image\/jpeg;base64,/.test(u) ? { url: u } : null });
      if (!/^data:image\/jpeg;base64,/.test(u)) this._toast('預覽失敗');
    } catch (e) { this.setState({ carFBgPv: null }); this._toast(e.message || '預覽失敗'); }
  },

  carFBgShrink(file) {
    /* 圖片 → 長邊 ≤1920 的 JPEG（base64，不含 data: 前綴）。透明背景鋪白。 */
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        try {
          const k = Math.min(1, 1920 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
          const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
          const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          const du = cv.toDataURL('image/jpeg', 0.88);
          if (!/^data:image\/jpeg;base64,/.test(du)) { reject(new Error('encode')); return; }
          resolve(du.slice(du.indexOf(',') + 1));
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  },

  async carFBgUpload(files) {
    files = (files || []).filter(f => f && (/^image\//.test(f.type || '') || /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(f.name || '')));
    if (!files.length) { this._toast('請選圖片檔（JPG／PNG／WebP）'); return; }
    if (this.state.carFBgUp) { this._toast('上一批還在上傳'); return; }
    const key = this.carSecKey('bgimg', false), g0 = String(this.state.g || '');
    const cur = (this.carSecOf(key) || {}).data || {};
    const room = Math.max(0, (+cur.max || 8) - (Array.isArray(cur.items) ? cur.items.length : 0));
    if (!room) { this._toast('圖庫滿了，請先刪掉一張'); return; }
    if (files.length > room) { this._toast('圖庫只剩 ' + room + ' 個位置，只傳前 ' + room + ' 張'); files = files.slice(0, room); }
    let ok = 0;
    try {
      for (const f of files) {
        const name = String(f.name || '插畫').replace(/\.[^.]+$/, '').slice(0, 40);
        if (f.size > 30e6) { this._toast('「' + name + '」太大了（上限 30 MB）'); continue; }
        this.setState({ carFBgUp: { name, i: 0, n: 1 } });
        let b64;
        try { b64 = await this.carFBgShrink(f); } catch (e) { this._toast('讀不到「' + name + '」，請換成 JPG／PNG'); continue; }
        const parts = [];
        for (let i = 0; i < b64.length; i += 180000) parts.push(b64.slice(i, i + 180000));
        const up = 'up' + Array.from(crypto.getRandomValues(new Uint8Array(10)), b => (b % 36).toString(36)).join('');
        let d = null;
        try {
          for (let i = 0; i < parts.length; i++) {
            if (String(this.state.g || '') !== g0) return;
            this.setState({ carFBgUp: { name, i: i + 1, n: parts.length } });
            d = await this.carApi('/schedbg', { body: { action: 'chunk', up, i, n: parts.length, data: parts[i], name } });
          }
        } catch (e) { this._toast('「' + name + '」上傳失敗：' + (e.message || '')); continue; }
        if (d && Array.isArray(d.items)) { this.carSecPut(key, { data: d, err: '', at: Date.now() }); ok++; }
      }
    } finally { this.setState({ carFBgUp: null }); }
    if (ok) this._toast('已上傳 ' + ok + ' 張插畫');
  },

  carFMeta(key) {
    const st = (this.state.carStates || {})[this.carNo()] || {};
    const m = (Array.isArray(st.settings_meta) ? st.settings_meta : []).find(x => x && x.key === key) || null;
    return { m, v: m ? (st.settings || {})[key] : undefined };
  },

  carFDk(key) { return (this.CAR_F_CARKEYS.has(key) ? this.carNo() : 'g') + ':' + key; },

  carFShort(m) { const l = String((m && (m.label || m.key)) || ''); return (l.split(/[？?（(]/)[0] || l).trim(); },

  carFCur(key) {
    const s = this.state, dk = this.carFDk(key), p = (s.carFSetPend || {})[dk];
    if (p) return p.v;
    return this.carFMeta(key).v;
  },

  async carFSetSave(key, value, okMsg) {
    const { m } = this.carFMeta(key);
    if (!m) { this._toast('找不到這個設定，請重新整理'); return null; }
    if (this._carActBusy) { this._toast('上一個操作還在處理中'); return null; }
    const no = this.carNo(), gid = String(this.state.g || ''), dk = this.carFDk(key);
    const dropPend = st => { const p = Object.assign({}, st.carFSetPend); delete p[dk]; return p; };
    this.setState(st => ({ carFSetPend: Object.assign({}, st.carFSetPend, { [dk]: { v: value } }) }));
    const d = await this.carAct('/setting', { key, value }, okMsg, no);
    if (!d || String(this.state.g || '') !== gid) { this.setState(st => ({ carFSetPend: dropPend(st) })); return null; }
    const perCar = !!m.car_label || this.CAR_F_CARKEYS.has(key);
    /* 文字欄以機器人整理過的值為準（例：鎖班時間 0:30 → 00:30、留空 → 預設 23:00）；草稿比對用送出的值 */
    const sent = value;
    if (m.type === 'text' && typeof d.value === 'string') value = d.value;
    this.setState(st => {
      const sts = Object.assign({}, st.carStates);
      Object.keys(sts).forEach(n => {
        const x = sts[n];
        if (!x || !x.settings || (perCar && +n !== no)) return;
        // team_mode（私車／車隊）另外在 /state 最上層有一份，班表分頁的開關看的是那一份：在設定頁改了也要跟著變
        sts[n] = Object.assign({}, x, { settings: Object.assign({}, x.settings, { [key]: value }) }, key === 'team_mode' ? { team_mode: !!value } : {});
      });
      const dr = Object.assign({}, st.carFSetDraft);
      if (dr[dk] != null && (m.type === 'range' || String(dr[dk]).trim() === String(value).trim() || String(dr[dk]).trim() === String(sent).trim())) delete dr[dk];
      return { carStates: sts, carFSetPend: dropPend(st), carFSetDraft: dr };
    });
    if (key === 'cars_enabled' || /^car_name_\d$/.test(key)) this.carLoad();      // 車的數量／名稱來自 /car/me：重抓，分頁才會跟著變
    return d;
  },

  carFSetDraft(key, v) { const dk = this.carFDk(key); this.setState(st => ({ carFSetDraft: Object.assign({}, st.carFSetDraft, { [dk]: v }) })); },

  carFSetText(key) {
    const { m, v } = this.carFMeta(key); if (!m) return;
    const dr = (this.state.carFSetDraft || {})[this.carFDk(key)];
    if (dr == null) return;
    let nv = String(dr);
    if (/^car_name_\d$/.test(key)) { nv = nv.trim(); if ([...nv].length > 12) { this._toast('車名最多 12 個字'); return; } }
    else nv = nv.slice(0, 200);
    if (nv === String(v == null ? '' : v)) { this.carFSetDraft(key, null); return; }
    this.carFSetSave(key, nv, this.carFShort(m) + (nv ? ' 已更新' : ' 已恢復預設'));
  },

  carFSetRange(key) {
    const { m } = this.carFMeta(key); if (!m) return;
    const dr = (this.state.carFSetDraft || {})[this.carFDk(key)];
    if (dr == null) return;
    const n = Math.max(5, Math.min(200, Math.round((+dr || 100) / 5) * 5));
    this.carFSetSave(key, n, this.carFShort(m) + ' ' + n + '%');
  },

  async carFSheet(act) {
    const no = this.carNo(), key = this.carSecKey('sheet', true), s = this.state, dk = no + ':__sheet';
    const info = (this.carSecOf(key) || {}).data || null;
    if (act === 'config') {
      const dv = (s.carFSetDraft || {})[dk];
      const v = String(dv != null ? dv : ((info && info.sheet_id) || '')).trim();
      if (v.length > 300) { this._toast('太長了，請只貼試算表網址或 ID'); return; }
      if (v && !/^[A-Za-z0-9_-]{20,}$/.test(v) && !/\/spreadsheets\/d\/[A-Za-z0-9_-]{20,}/.test(v)) { this._toast('看起來不是 Google 試算表的網址或 ID'); return; }
      const d = await this.carAct('/sheet', { action: 'config', sheet_id: v }, v ? '已儲存試算表 ID' : '已清除試算表 ID', no);
      if (!d) return;
      this.setState(st => { const dr = Object.assign({}, st.carFSetDraft); delete dr[dk]; return { carFSetDraft: dr }; });
      this.carFSheetInfo(true);
      return;
    }
    if (!info) { this._toast('試算表狀態還沒讀到，請稍候再試'); return; }
    if (!info.sheet_id) { this._toast('先貼上試算表網址或 ID 並儲存'); return; }
    const reInfo = () => this.carSecFetch(key, '/sheet', { body: { action: 'info' }, car: no }, true);
    /* v2：檢查連線（讀得到、寫得進去、班表分頁的狀況；不改班表）。結果也會存在 info.check */
    if (act === 'check') {
      this._toast('檢查連線中…', 20000);
      const before = info;
      const d = await this.carAct('/sheet', { action: 'check' }, null, no);
      if (!d) return;
      const ck = d.check && typeof d.check === 'object' ? d.check : null;
      this._toast(ck ? (ck.ok ? '連線正常' : '連線失敗：' + this.carFTxt(ck.msg)) : this.carFMsg(d, '已送出'), 4000);
      const cur = (this.carSecOf(key) || {}).data;
      if (ck && cur) this.carSecPut(key, { data: Object.assign({}, cur, { check: ck }) });
      if (d.pending) { this.carFShPoll(key, no, 'check', before); return; }
      reInfo();
      return;
    }
    /* v2：第一次同步選方向，或之後手動「以機器人為準重寫」（表上原本的內容先備份到另一個分頁） */
    if (act === 'bot' || act === 'sheet') {
      const tab = String(info.tab || '班表'), nm = this.carFCarName(no);
      const q = act === 'bot'
        ? '以機器人為準：試算表的「' + tab + '」分頁會改成「' + nm + '」現在的班表；表上原本的內容會先備份到另一個分頁。確定？'
        : '以試算表為準：「' + tab + '」分頁上跟機器人不一樣的格子，都會照表改進機器人（那些時段會標成手動）；機器人有、表上沒有的班不會被砍。確定？';
      if (!window.confirm(q)) return;
      return this.carFSheetSync(act);
    }
    if (act === 'format') {
      const d = await this.carAct('/sheet', { action: 'format' }, r => this.carFMsg(r, '已重新套用表格格式'), no);
      if (d && d.pending) this.carFLater(reInfo);
      return;
    }
    /* 雙向同步（表為準）：自動同步開關＝既有的 auto（config 的 auto 欄位）。注意：機器人的 config 一定會改寫 sheet_id，
       所以要把「已儲存的那個 ID」一起送回去（不是輸入框裡還沒存的草稿），否則會把試算表清掉 */
    if (act === 'auto') {
      const nv = !info.auto;
      const d = await this.carAct('/sheet', { action: 'config', sheet_id: String(info.sheet_id), auto: nv }, nv ? '已開啟自動同步' : '已關閉自動同步', no);
      if (!d) return;
      const cur = (this.carSecOf(key) || {}).data;
      if (cur) this.carSecPut(key, { data: Object.assign({}, cur, { auto: nv }) });
      this.carSecFetch(key, '/sheet', { body: { action: 'info' }, car: no }, true);
      return;
    }
    if (act === 'sync') return this.carFSheetSync('');
    const today = this.carFToday(), dates = [0, 1, 2, 3, 4, 5, 6].map(i => this.carFAddDay(today, i));
    const date = dates.indexOf(s.carFShDate) >= 0 ? s.carFShDate : today;
    if (act === 'pull' && !window.confirm('從試算表套用「' + this.carFCarName(no) + '」' + date + '：分頁上 P2～P5 的名字會覆蓋網頁上這一天的班表（查無成員的名字不會套用，會列出來）。確定？')) return;
    const body = act === 'week' ? { action: 'push', dates } : { action: act === 'pull' ? 'pull' : 'push', date };
    this._toast(act === 'pull' ? '讀取中…' : (act === 'week' ? '推送 7 天中…' : '推送中…'), 25000);
    const d = await this.carAct('/sheet', body, null, no);
    if (!d) return;
    const msg = this.carFMsg(d, act === 'pull' ? '已套用' : '已推送');
    this._toast(msg, 4000);
    this.setState({ carFShRes: { k: key, msg, miss: (Array.isArray(d.miss) ? d.miss : []).slice(0, 8).map(x => String(x)) } });
    if (act === 'pull') this.carLoadStates(no);
    this.carFSheetInfo(true);
    if (d.pending) this.carFLater(() => { this.carSecFetch(key, '/sheet', { body: { action: 'info' }, car: no }, true); if (act === 'pull') this.carLoadStates(no); });
  },

  carFSchedSum(cur, has) {
    const str = k => { const v = cur(k); return v == null ? '' : String(v); };
    const num = k => { const n = parseFloat(str(k)); return isFinite(n) ? n : 0; };
    const hTxt = h => h < 1 ? Math.round(h * 60) + ' 分鐘' : h + ' 小時';
    const L = [];
    const order = str('seat_order') || 'bonus', step = str('bonus_tie_step') || '0.02';
    const cmp = order === 'first' ? '報班先後' : order === 'power' ? '綜合力' : 'S6 倍率';
    if (has('schedule_auto_confirm')) L.push(cur('schedule_auto_confirm') ? '報班後直接排進座位，不用管理員確認。' : '成員在 Discord／網頁報班後先是「待確認」，管理員確認後才排進座位（QQ 報班直接排）。');
    if (order === 'first') L.push('P2～P5 依報班先後坐：先報先上。');
    else if (order === 'power') L.push('P2～P5 依綜合力由高到低坐；一樣時先報的先坐。');
    else L.push('P2～P5 依倍率由高到低坐；倍率四捨五入到 ' + step + ' 後一樣時，先報的先坐。');
    L.push('P2 是 S6 位：有人報 S6 就給 S6（多人報 S6 時比 ' + cmp + '，其餘改當推手）；沒人報 S6 時，P2 給排第一的推手。');
    const mp = num('min_bonus_pusher'), ms = num('min_bonus_s6');
    // 兩個門檻的效果不一樣（跟機器人 sched_rules 一致）：推手門檻＝只進候補；S6 門檻＝改當推手比，推手倍率也不夠才進候補
    if (mp) L.push('推手倍率未滿 ' + mp + ' 的不會自動上車，只排在候補最後（雙開／三開的第 2、3 開看二開、三開倍率；車隊報班的保留位不受影響；管理員仍可手動排）。');
    if (ms) L.push('報 S6 但 S6 倍率未滿 ' + ms + ' 的不坐 P2，改用推手倍率跟其他推手一起比' + (mp ? '（推手倍率也未滿 ' + mp + ' 才只進候補）' : '') + '。');
    const mo = str('multi_open_policy') || 'after';
    L.push(mo === 'bonus' ? '雙開／三開：第 2、3 開用二開、三開倍率跟其他人一起比。' : mo === 'none' ? '不排多開：每人只坐一個位置，多報的開不上車也不候補。' : '雙開／三開：先讓不同的人坐滿，第 2、3 開只補剩下的空位。');
    L.push('坐不下的人照同樣順序排候補；有人取消時，候補第一位自動補上。');
    if (cur('schedule_never_lock')) L.push('完全不鎖班：坐滿也照樣收報班。');
    else {
      L.push(cur('auto_lock_full') === false ? '坐滿不會自動鎖，照樣收報班（排不上的進候補）。' : 'P2～P5 都坐滿就自動鎖住，不再收報班。');
      if (cur('signup_lock_enabled')) L.push('每天 ' + (str('signup_lock_trigger_time') || '23:00') + ' 自動鎖定' + (str('signup_lock_target_day') === 'today' ? '今天' : '明天') + ' ' + (str('signup_lock_target_range') || '8-32') + ' 的時段'
        + (cur('signup_lock_allow_shortage') === false ? '，鎖定後不再收報班。' : '，鎖定後缺人的位置仍可報。'));
    }
    const c1 = str('signup_close_hours') === '' ? 1 : num('signup_close_hours'), c2 = str('signup_close_s6_hours') === '' ? 2 : num('signup_close_s6_hours');
    L.push('當天的班' + (c1 > 0 ? '在開跑前 ' + hTxt(c1) + '停止收報班' : '開跑後才停止收報班') + (c2 > c1 ? '；P2 已經有人時提早到開跑前 ' + hTxt(c2) : '') + '。');
    const lim = [];
    if (num('max_hours_per_day')) lim.push('每人每天最多 ' + num('max_hours_per_day') + ' 小時');
    if (num('max_consecutive_hours')) lim.push('連續最多 ' + num('max_consecutive_hours') + ' 小時');
    if (str('signup_days_ahead') !== '') lim.push(num('signup_days_ahead') ? '最多報 ' + num('signup_days_ahead') + ' 天內的班' : '只能報今天的班');
    if (num('slot_applicant_cap')) lim.push('每個時段最多 ' + num('slot_applicant_cap') + ' 人報名');
    if (cur('one_car_per_hour')) lim.push('同一時段只能報一台車');
    if (num('cancel_lock_hours')) lim.push('已排上的人開跑前 ' + hTxt(num('cancel_lock_hours')) + '內不能自己取消');
    if (lim.length) L.push('報班限制：' + lim.join('、') + '（管理員與排班身份組不受限）。');
    if (cur('signup_admin_only')) L.push('只有管理員能排班：成員不能自己在網頁或 QQ 報班、取消。');
    return L;
  },

  async carFSheetSync(mode) {
    const no = this.carNo(), key = this.carSecKey('sheet', true);
    const reInfo = () => this.carSecFetch(key, '/sheet', { body: { action: 'info' }, car: no }, true);
    const before = (this.carSecOf(key) || {}).data || null;                               // 背景跑的時候拿來比「有沒有變」
    this._toast('同步中…', 25000);
    let why = '';
    const d = await this.carAct('/sheet', mode ? { action: 'sync', mode } : { action: 'sync' }, null, no, e => { why = String((e && e.message) || '同步失敗'); return null; });
    if (!d) {
      if (why) this.setState({ carFShRes: { k: key, msg: '同步失敗：' + this.carFTxt(why), miss: [], bad: true, sync: true } });
      reInfo();                                                                           // 機器人會把失敗原因記在 last_err
      return;
    }
    const msg = this.carFMsg(d, '已同步');
    this._toast(msg, 4000);
    this.setState({ carFShRes: { k: key, msg, miss: (Array.isArray(d.miss) ? d.miss : []).slice(0, 12).map(x => String(x)), sync: true, warn: !!d.need_choice, pend: !!d.pending } });
    if (+d.pulled > 0 || mode) this.carLoadStates(no);                                    // 表上的修改寫回機器人了：班表跟著更新
    if (d.pending) { this.carFShPoll(key, no, 'sync', before); return; }
    reInfo();
  },

  carFShPoll(key, no, kind, before) {
    const g0 = String(this.state.g || ''), t0 = Date.now();
    const sig = i => i ? [i.synced_at, i.last_err, i.need_choice ? 1 : 0, (i.check && i.check.at) || ''].join('|') : '';
    const s0 = sig(before);
    clearTimeout(this._carFShPollT);
    const tick = async () => {
      this._carFShPollT = null;
      if (String(this.state.g || '') !== g0 || this.carNo() !== no) return;
      const d = await this.carSecFetch(key, '/sheet', { body: { action: 'info' }, car: no }, true);
      if (String(this.state.g || '') !== g0) return;
      const fin = !!d && (d.busy != null ? !d.busy : sig(d) !== s0), late = Date.now() - t0 > 90000;
      if (!fin && !late) { this._carFShPollT = setTimeout(tick, 4000); return; }
      if (kind === 'check') {
        const ck = fin && d && d.check && typeof d.check === 'object' ? d.check : null;
        if (ck) this._toast(ck.ok ? '連線正常' : '連線失敗：' + this.carFTxt(ck.msg), 4000);
        return;
      }
      if (fin) this.carLoadStates(no);
      const r = !fin ? { msg: '同步還在背景進行（超過 90 秒）；稍後按「重新整理」看結果。', warn: true }
        : d.need_choice ? { msg: '同步完成：表上和機器人都有班表而且不一樣，要先選以哪邊為準（這次什麼都沒改）。', warn: true }
        : d.last_err ? { msg: '同步失敗：' + this.carFTxt(d.last_err), bad: true }
        : { msg: '同步完成' + (d.synced_at ? '（' + String(d.synced_at) + '）' : '') + '。' };
      this.setState(st => (st.carFShRes && st.carFShRes.k === key && st.carFShRes.pend
        ? { carFShRes: Object.assign({ k: key, miss: [], sync: true, pend: false }, r) } : null));
    };
    this._carFShPollT = setTimeout(tick, 3000);
  },

  async carFShUndo(id, head) {
    const no = this.carNo(), key = this.carSecKey('sheet', true);
    if (!/^[0-9a-f]{4,16}$/.test(id)) return;
    if (!window.confirm('還原這次從試算表套用的變更？（' + head + '）\n之後又被改過的時段不會動；還原後的內容下一輪會寫回試算表。')) return;
    const d = await this.carAct('/sheet', { action: 'undo', id }, r => this.carFMsg(r, '已還原'), no);
    if (!d) return;
    this.carLoadStates(no);
    this.carSecFetch(key, '/sheet', { body: { action: 'info' }, car: no }, true);
  },

  carSecVals_settings(c) {
    const { s, st, carNo, segOn } = c, no = carNo;
    const stErr = (s.carStErr || {})[no] || '';
    const base = {
      carFSetLoading: !st && !stErr, carFSetErr: !st && stErr ? String(stErr) : '',
      carFCarSeg: this.carFCarSeg(segOn), carFSetCarName: this.carFCarName(no),
    };
    if (!st) return base;
    const meta = (Array.isArray(st.settings_meta) ? st.settings_meta : []).filter(m => m && typeof m.key === 'string' && m.key);
    const vals = (st.settings && typeof st.settings === 'object') ? st.settings : {};
    const dr = s.carFSetDraft || {}, pend = s.carFSetPend || {};
    const dk = k => (this.CAR_F_CARKEYS.has(k) ? no : 'g') + ':' + k;
    const cur = k => { const p = pend[dk(k)]; return p ? p.v : vals[k]; };
    const qq = this.carFQQ(), busy = !!s.carActBusy;
    const chList = a => (Array.isArray(a) ? a : []).filter(x => x && x.id != null).map(x => ({ id: String(x.id), name: String(x.name || '') }));
    const chans = chList(st.channels), vchans = chList(st.vchannels), roles = chList(st.roles);
    const noChTxt = qq ? 'QQ 車隊沒有 Discord 頻道，這項用不到' : '讀不到頻道清單（機器人可能不在這個伺服器）';
    const sw = on => ({ on: on ? 'true' : 'false', swBg: on ? 'var(--ink-grad)' : 'var(--card-2)', swBd: on ? 'transparent' : 'var(--border)', swL: on ? '20px' : '2px', swK: on ? '#fff' : 'var(--text-3)' });
    const TYPES = ['bool', 'select', 'channel1', 'voice1', 'role1', 'channels', 'range', 'note'];
    const row = m => {
      const k = m.key, t = TYPES.indexOf(m.type) >= 0 ? m.type : 'text', v = cur(k);
      const o = { k, label: String(m.label || k), carLbl: m.car_label ? String(m.car_label) : '', hasCarLbl: !!m.car_label,
        isBool: t === 'bool', isSel: t === 'select', isChan: t === 'channel1' || t === 'voice1' || t === 'role1', isChans: t === 'channels', isRange: t === 'range', isNote: t === 'note', isText: t === 'text' };
      o.cf = (o.isChans || o.isRange || o.isText) ? '1 1 100%' : '0 1 auto';
      if (o.isBool) Object.assign(o, sw(!!v));
      if (o.isSel) {
        const opts = (Array.isArray(m.options) ? m.options : []).filter(x => x && x.value != null).map(x => ({ v: String(x.value), n: String(x.label != null ? x.label : x.value) }));
        const cv = v == null ? '' : String(v);
        if (!opts.some(x => x.v === cv)) opts.unshift({ v: cv, n: cv ? '目前：' + cv : '（未設定）' });
        o.opts = opts; o.cur = cv;
      }
      if (o.isChan) {
        const list = t === 'voice1' ? vchans : t === 'role1' ? roles : chans, cv = v ? String(v) : '';
        const opts = [{ v: '', n: '（未設定）' }].concat(list.map(x => ({ v: x.id, n: (t === 'voice1' ? '語音 · ' : t === 'role1' ? '@' : '#') + x.name })));
        if (cv && !list.some(x => x.id === cv)) opts.push({ v: cv, n: t === 'role1' ? '（身分組已不存在）' : '（頻道已不存在）' });
        o.opts = opts; o.cur = cv; o.noCh = !list.length && !cv; o.hasCh = !o.noCh;
        o.noChTxt = t === 'role1' ? (qq ? 'QQ 車隊沒有 Discord 身分組，這項用不到' : '讀不到身分組清單（機器人可能不在這個伺服器）') : noChTxt;
      }
      if (o.isChans) {
        const set = new Set((Array.isArray(v) ? v : []).map(String));
        o.chips = chans.map(x => { const on = set.has(x.id); return { k, id: x.id, n: '#' + x.name, on: on ? 'true' : 'false', bg: on ? 'var(--ink-grad)' : 'var(--card)', fg: on ? '#fff' : 'var(--text-2)', bd: on ? 'transparent' : 'var(--border)' }; });
        o.noCh = !chans.length; o.hasChips = chans.length > 0; o.noChTxt = noChTxt;
        o.chN = set.size ? '已選 ' + set.size + ' 個' : '未選（全部不套用）';
      }
      if (o.isRange) {
        const d = dr[dk(k)], n = d != null ? +d : ((v === '' || v == null) ? 100 : +v);
        o.rv = String(isFinite(n) ? n : 100); o.rTxt = o.rv + '%';
      }
      if (o.isText) {
        const saved = v == null ? '' : String(v), d = dr[dk(k)];
        o.tv = d != null ? String(d) : saved; o.dirty = d != null && String(d) !== saved;
        o.max = /^car_name_/.test(k) ? '12' : '200'; o.ph = '留空＝預設';
      }
      return o;
    };
    const MULTI = /^(cars_enabled|car_name_[123])$/;
    const q = String(s.carFSetQ || '').trim().toLowerCase(), openMap = s.carFSetOpen || {};
    const names = [];
    (Array.isArray(st.sections) ? st.sections : []).concat(meta.map(m => m.section)).forEach(x => { const n = String(x || '其他'); if (names.indexOf(n) < 0) names.push(n); });
    let shown = 0;
    const secs = names.map(sec => {
      const items = meta.filter(m => String(m.section || '其他') === sec && !MULTI.test(m.key)
        && (!q || String(m.label || '').toLowerCase().indexOf(q) >= 0 || m.key.toLowerCase().indexOf(q) >= 0));
      if (!items.length) return null;
      shown += items.length;
      const open = !!q || !!openMap[sec], nCar = items.filter(m => m.car_label).length;
      /* 「排班規則」最上面放白話摘要（搜尋時不放，免得擋住搜尋結果） */
      const sum = sec === '排班規則' && open && !q ? this.carFSchedSum(cur, k => meta.some(m => m.key === k)).map((t, i) => ({ i: String(i), t })) : [];
      return { sec, n: items.length + ' 項' + (nCar ? ' · ' + nCar + ' 項分車' : ''), arrow: open ? '▲' : '▼', open, exp: open ? 'true' : 'false', rows: open ? items.map(row) : [],
        hasSum: sum.length > 0, sum, sumTag: this.carFCarName(no) };
    }).filter(Boolean);
    const allOpen = secs.length > 0 && secs.every(x => x.open);

    /* 多車平行排班：cars_enabled＋三個車名（改完會重抓 /car/me） */
    const hasMulti = meta.some(m => m.key === 'cars_enabled');
    const nOn = Math.max(1, Math.min(3, parseInt(cur('cars_enabled'), 10) || 1));
    const carNames = [1, 2, 3].filter(n => n <= nOn && meta.some(m => m.key === 'car_name_' + n)).map(n => {
      const k = 'car_name_' + n, saved = vals[k] == null ? '' : String(vals[k]), d = dr[dk(k)];
      return { k, lbl: this.CAR_NAMES[n] + '名稱', tv: d != null ? String(d) : saved, dirty: d != null && String(d) !== saved, ph: '留空＝' + this.CAR_NAMES[n] };
    });

    /* Google 試算表（這一車） */
    const shKey = this.carSecKey('sheet', true), sh = this.carSecOf(shKey), info = sh && sh.data;
    const shOpen = !!openMap.__sheet, today = /^\d{4}-\d{2}-\d{2}$/.test(String(st.today || '')) ? String(st.today) : this.carFYmd(new Date());
    const shDates = [0, 1, 2, 3, 4, 5, 6].map(i => { const d = this.carFAddDay(today, i); return { v: d, n: this.carDayLabel(d, today) }; });
    const shDraft = dr[no + ':__sheet'], shSaved = info ? String(info.sheet_id || '') : '';
    const shRes = s.carFShRes && s.carFShRes.k === shKey ? s.carFShRes : null;
    const okFg = 'color-mix(in oklab,#2f9e57 55%,var(--car-fg))', badFg = 'color-mix(in oklab,#ee6644 55%,var(--car-fg))', warnFg = 'color-mix(in oklab,#d08a00 62%,var(--car-fg))';
    /* 雙向同步（表為準）：info.two_way 才有（舊機器人沒有 → 只顯示舊版的推送／回讀）。
       v2（info.v >= 2）：逐格三方合併、檢查連線、第一次同步選方向、變更紀錄與復原、錯誤的「怎麼修」、自動暫停 */
    const two = !!(info && info.two_way), v2 = two && +info.v >= 2;
    const shUrl = two && /^https:\/\/docs\.google\.com\//.test(String(info.url || '')) ? String(info.url) : '';
    const shSec = two && +info.interval > 0 ? Math.round(+info.interval) : 60;
    const shTabs = two ? (Array.isArray(info.tabs) ? info.tabs : []).map(x => String(x == null ? '' : x)).filter(Boolean).slice(0, 6) : [];
    const shTab = two ? String(info.tab || shTabs[0] || '班表') : '班表';
    const shLegacy = !two || !!openMap.__sheetOld;
    /* 「檢查連線」的結果跟「上次同步失敗」是兩個各自留著的訊號：只信比較新的那個（時間都是 MM-DD HH:MM 開頭，可以直接比字串）。
       檢查失敗之後又同步成功 → 那次檢查已經過時；檢查通過而且比權限類的同步錯誤新 → 那個錯誤已經修好 */
    const shChk0 = v2 && info.check && typeof info.check === 'object' && String(info.check.sid || '') === shSaved ? info.check : null;
    const shChkAt = shChk0 ? String(shChk0.at || '').slice(0, 11) : '', shSynAt = two && info.synced_at ? String(info.synced_at).slice(0, 11) : '';
    const shErrAt = two && info.last_err ? String(info.last_err).slice(0, 11) : '';
    /* 只到「分」：同一分鐘內分不出先後 → 不猜（新版機器人自己會清掉過時的那個，這裡只是舊機器人的保險） */
    const shChk = shChk0 && !shChk0.ok && shSynAt && shSynAt > shChkAt && !shErrAt ? null : shChk0;
    const shErrFixed = !!(shChk && shChk.ok && shErrAt && shChkAt > shErrAt && /^(forbidden|read_only|not_found|no_creds|bad_creds|no_lib)$/.test(String(info.err_code || '')));
    const shErrCode = v2 && !shErrFixed ? String(info.err_code || '') : '';
    const shCredOk = !!(info && (info.creds_ok != null ? info.creds_ok : info.has_creds));
    const shHasId = !!shSaved, shSynced = !!(two && info.synced_at), shChkOk = !!(shChk && shChk.ok);
    const shNeedI = v2 && info.need_choice && info.need && typeof info.need === 'object' ? info.need : null;
    const shNeed = !!(v2 && info.need_choice) || (!!(shChk && shChk.need_choice) && !shSynced);
    const shAutoOn = !!(info && info.auto), shPaused = v2 ? String(info.paused || '') : '';
    const shLastErr = two && info.last_err && !shErrFixed ? this.carFTxt(info.last_err) : '';
    /* 只有開了自動同步（而且沒暫停）才會自己重試；沒開時舊機器人的說明還是寫「會自動重試」→ 換成按立即同步 */
    const shRetry = v2 && info.next_retry && shAutoOn && !shPaused ? '下次自動重試 ' + String(info.next_retry) : '';
    const shErrHint = v2 ? (!shAutoOn && /^(network|quota)$/.test(shErrCode) && /自動/.test(String(info.err_hint || ''))
      ? '自動同步沒開，機器人不會自己重試；過一下再按「立即同步」就好。' : String(info.err_hint || '')) : '';
    /* 設定步驟：完成／下一步／要處理（錯誤指向的那一步）／還沒到。舊機器人沒有「檢查連線」那一步 */
    const chkCode = shChk ? String(shChk.code || '') : '';
    const stBad = { 1: !!info && !shCredOk, 2: /^(forbidden|read_only)$/.test(shErrCode) || /^(forbidden|read_only)$/.test(chkCode),
      3: shErrCode === 'not_found' || chkCode === 'not_found', 4: !!shChk && !shChk.ok && !/^(forbidden|read_only|not_found|no_creds|bad_creds|no_lib)$/.test(chkCode),
      5: shNeed || shErrCode === 'header', 6: !!shPaused };
    const shChkBad = !!shChk && !shChk.ok;                // 檢查沒過：第 2、4 步不能算完成（不然「✓ 完成」下面接著「✕ 沒有權限」）
    const stDone = { 1: shCredOk, 2: !shChkBad && (shChkOk || (shSynced && !shLastErr)), 3: shHasId, 4: !shChkBad && (shChkOk || (shSynced && !shLastErr)), 5: shSynced && !shNeed, 6: shAutoOn && !shPaused };
    const stOrder = v2 ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 5, 6];
    const stCur = stOrder.find(n => stBad[n] || !stDone[n]) || 0;
    const stAll = !!info && stCur === 0, stOpen = !stAll || !!openMap.__sheetSteps;     // 全部完成就收成一行（可以再展開）
    const step = n => {
      const b = !!stBad[n], d = !!stDone[n] && !b, cu = n === stCur, i = String(stOrder.indexOf(n) + 1);
      return { badge: d ? '✓' : i, cur: cu ? 'true' : 'false', op: d && !cu ? '0.8' : '1',
        bg: b ? 'color-mix(in oklab,#ee6644 20%,var(--card))' : d ? 'color-mix(in oklab,#2f9e57 18%,var(--card))' : cu ? 'var(--ink-grad)' : 'var(--card-2)',
        fg: b ? badFg : d ? okFg : cu ? '#fff' : 'var(--text-3)',
        tag: b ? '要處理' : d ? '完成' : cu ? '下一步' : '', tagFg: b ? badFg : d ? okFg : 'var(--accent-deep)' };
    };
    /* 最上面的狀態列 */
    const shNeedTxt = shNeedI ? (shNeedI.why ? this.carFTxt(shNeedI.why) + '。' : '') + '表上有 ' + (+shNeedI.sheet_rows || 0) + ' 列、機器人有 ' + (+shNeedI.bot_rows || 0) + ' 個時段，而且內容不一樣。'
      : (shChk && shChk.need_choice ? '表上已經有 ' + (+shChk.sched_rows || 0) + ' 列、機器人有 ' + (+shChk.bot_rows || 0) + ' 個時段。' : '');
    let ban;
    if (!shHasId) ban = { kind: 'idle', t: '還沒連接試算表', sub: '照下面的步驟做，大約三分鐘。', hint: '' };
    else if (shPaused) ban = { kind: 'bad', t: '自動同步已暫停', sub: shLastErr ? '原因：' + shLastErr : '', hint: shErrHint + ' 修好之後按「檢查連線」或「立即同步」就會恢復。' };
    else if (shNeed) ban = { kind: 'warn', t: '第一次同步：要先選以哪邊為準', sub: shNeedTxt + '選好之前機器人不會動試算表。', hint: '' };
    else if (shLastErr) ban = { kind: 'bad', t: '上次同步失敗', sub: shLastErr + (shRetry ? '（' + shRetry + '）' : ''), hint: shErrHint };
    else if (shSynced) ban = { kind: 'ok', t: '同步正常', sub: '上次同步 ' + String(info.synced_at) + (shAutoOn ? ' · 每 ' + shSec + ' 秒自動同步' : ' · 自動同步還沒開'), hint: '' };
    else ban = { kind: 'idle', t: '還沒同步過', sub: shAutoOn ? '自動同步已開，第一輪會在 ' + shSec + ' 秒內跑。' : '完成下面的步驟後按「立即同步」。', hint: '' };
    const banC = { ok: [okFg, '#2f9e57'], bad: [badFg, '#ee6644'], warn: [warnFg, '#d08a00'], idle: ['var(--ink)', '#6c7bd8'] }[ban.kind];
    Object.assign(ban, { fg: banC[0], bd: 'color-mix(in oklab,' + banC[1] + ' 35%,var(--border))', bg: 'color-mix(in oklab,' + banC[1] + ' 9%,var(--card))',
      role: ban.kind === 'bad' ? 'alert' : 'status', hasSub: !!ban.sub, hasHint: !!String(ban.hint || '').trim(), hint: String(ban.hint || '').trim() });
    /* 變更紀錄（新的在前）與上次同步沒套用的列／對不到的名字／注意事項 */
    const shLogs = v2 && Array.isArray(info.log) ? info.log.filter(x => x && x.id).slice(0, 8) : [];
    const shIss = v2 ? [['skip', '沒有套用的列'], ['miss', '對不到成員的名字（照樣排上去，但沒有倍率）'], ['warn', '注意']].map(([k, t]) => {
      const a = (Array.isArray(info[k]) ? info[k] : []).map(x => this.carFTxt(x)).filter(Boolean);
      return a.length ? { k, title: t + '（' + a.length + '）', items: a.slice(0, 8).map((x, i) => ({ i: String(i), t: x })), more: a.length > 8, moreTxt: '還有 ' + (a.length - 8) + ' 筆' } : null;
    }).filter(Boolean) : [];
    const shLast = v2 && info.last && typeof info.last === 'object' ? info.last : null;
    const shLastParts = shLast ? [
      +shLast.pulled ? '從表上套用 ' + (+shLast.pulled) + ' 個時段' : '',
      Array.isArray(shLast.pushed) && shLast.pushed.length ? '更新分頁 ' + shLast.pushed.map(String).join('、') : '',
      shLast.deferred ? '有人正在改表，這次先不寫回' : '',
      shLast.backup ? '已備份到「' + String(shLast.backup) + '」' : ''].filter(Boolean) : [];
    const shLastSum = shLast ? '上次同步（' + String(shLast.at || '') + '）：' + (shLastParts.length ? shLastParts.join('；') : '沒有變更（表跟機器人一致）') : '';

    /* 班表插畫圖庫（整個車隊共用） */
    const bgKey = this.carSecKey('bgimg', false), bgS = this.carSecOf(bgKey), bg = bgS && bgS.data;
    const bgOpen = !!openMap.__bgimg, bgUp = s.carFBgUp || null, bgPv = s.carFBgPv || null;
    const bgModes = (bg && bg.modes && typeof bg.modes === 'object') ? bg.modes : { daily: '每天換一張', random: '每次隨機', fixed: '固定一張' };
    const bgMode = bg && bgModes[bg.mode] ? String(bg.mode) : 'daily', bgStyle = bg && bg.style === 'sheet' ? 'sheet' : 'classic';
    const bgItems = bg && Array.isArray(bg.items) ? bg.items.filter(x => x && x.id) : [], bgMax = (bg && +bg.max) || 8;

    return Object.assign(base, {
      carFBgShow: !q,
      carFBgOpen: bgOpen, carFBgExp: bgOpen ? 'true' : 'false', carFBgArrow: bgOpen ? '▲' : '▼',
      carFBgSum: !bg ? (bgS && bgS.err ? '讀取失敗' : '') : (bgItems.length ? bgItems.length + '/' + bgMax + ' 張 · ' + String(bgModes[bgMode]) : (bg.legacy ? '使用舊背景' : '還沒有圖')),
      carFBgLoading: bgOpen && !bg && !(bgS && bgS.err), carFBgErr: bgOpen && !bg && bgS && bgS.err ? String(bgS.err) : '',
      carFBgHas: bgOpen && !!bg,
      carFBgStyleSeg: [['classic', '經典'], ['sheet', '清單風']].map(([v, n]) => Object.assign({ v, n, sel: v === bgStyle ? 'true' : 'false' }, segOn(v === bgStyle))),
      carFBgModeSeg: Object.keys(bgModes).map(v => Object.assign({ v, n: String(bgModes[v]), sel: v === bgMode ? 'true' : 'false' }, segOn(v === bgMode))),
      carFBgItems: bgItems.map((x, i) => {
        const today = !!bg && x.id === bg.today, fixed = bgMode === 'fixed' && !!bg && x.id === bg.fixed;
        return { id: String(x.id), no: String(i + 1), name: String(x.name || '插畫'), size: (x.w && x.h) ? x.w + '×' + x.h : '',
          thumb: /^data:image\/jpeg;base64,/.test(String(x.thumb || '')) ? String(x.thumb) : '',
          hasThumb: /^data:image\/jpeg;base64,/.test(String(x.thumb || '')), today, fixed, missing: !!x.missing, canFix: !fixed,
          tag: fixed ? '固定' : today ? '今天' : '', hasTag: fixed || today };
      }),
      carFBgHasItems: bgItems.length > 0, carFBgEmpty: !!bg && !bgItems.length && !bg.legacy,
      carFBgLegacy: !!(bg && bg.legacy),
      carFBgCanAdd: !!bg && bgItems.length < bgMax && !bgUp, carFBgFull: !!bg && bgItems.length >= bgMax,
      carFBgUpTxt: bgUp ? '上傳中：' + bgUp.name + (bgUp.n > 1 ? '（' + bgUp.i + '/' + bgUp.n + ' 段）' : '…') : '',
      carFBgPv: bgPv && bgPv.url ? String(bgPv.url) : '', carFBgPvBusy: !!(bgPv && bgPv.busy),
      carFBgMax: String(bgMax),
      carFSetReady: true,
      carFSetNoMeta: !meta.length,
      carFSetCount: q ? '符合 ' + shown + ' 項' : meta.length + ' 項設定',
      carFSetQ: s.carFSetQ || '', carFSetHasQ: !!q,
      carFSetSecs: secs, carFSetHasSecs: secs.length > 0 && !q, carFSetNone: !!meta.length && !secs.length,
      carFSetAllTxt: allOpen ? '全部收合' : '全部展開',
      carFSetCarNote: '標「此項分車」的設定只改目前選的「' + this.carFCarName(no) + '」；其他設定整個車隊共用。',
      carFMultiShow: hasMulti && !q,
      carFCarsSeg: [1, 2, 3].map(n => Object.assign({ v: String(n), n: n + ' 台', sel: n === nOn ? 'true' : 'false' }, segOn(n === nOn))),
      carFCarNames: carNames,
      carFShShow: !q,
      carFShOpen: shOpen, carFShExp: shOpen ? 'true' : 'false', carFShArrow: shOpen ? '▲' : '▼',
      carFShTag: this.carFCarName(no),
      carFShSum: !info ? (sh && sh.err ? '讀取失敗' : '') : (!info.sheet_id ? '尚未連接' : two ? (shPaused ? '已暫停' : shNeed ? '等你選方向' : info.last_err ? '同步失敗' : info.synced_at ? '上次同步 ' + String(info.synced_at).slice(0, 11) : (info.auto ? '自動同步已開' : '尚未同步'))
        : (info.last_push ? '上次推送 ' + String(info.last_push) : '已連接')),
      carFShLoading: shOpen && !info && !(sh && sh.err), carFShErr: shOpen && !info && sh && sh.err ? String(sh.err) : '',
      carFShHas: shOpen && !!info,
      carFShCred: info ? (shCredOk ? '✓ 已設定 Google 服務帳號' : '✕ ' + (v2 && info.creds_msg ? this.carFTxt(info.creds_msg) : '主機沒有設定 Google 服務帳號（GDRIVE_CREDS）') + '，暫時無法同步') : '',
      carFShCredFg: shCredOk ? okFg : badFg,
      carFShCredHint: v2 && !shCredOk && info.creds_hint ? this.carFTxt(info.creds_hint) : (!shCredOk && info ? '這一步要請機器人主機的管理者處理（車隊管理員沒辦法在網站上設定）。' : ''),
      carFShLast: info ? (info.last_push ? '上次推送 ' + String(info.last_push) : '還沒推送過') : '',
      carFShId: shDraft != null ? String(shDraft) : shSaved,
      carFShDirty: shDraft != null && String(shDraft).trim() !== shSaved,
      carFShNoId: !!info && !info.sheet_id,
      carFShEmail: info && info.service_email ? String(info.service_email) : '', carFShNoEmail: !!info && !info.service_email,
      carFShDates: shDates, carFShDate: shDates.some(x => x.v === s.carFShDate) ? s.carFShDate : today,
      carFShResShow: !!shRes && !shRes.sync, carFShResMsg: shRes ? shRes.msg : '', carFShMiss: shRes ? shRes.miss.map((x, i) => ({ i: String(i), t: x })) : [], carFShHasMiss: !!(shRes && shRes.miss.length) && !(v2 && shRes.sync),   /* v2：對不到的名字另外列在下面 */
      /* 雙向同步 */
      carFShTwo: shOpen && two, carFShOneWay: shOpen && !!info && !two,
      carFShSyncAt: two ? (info.synced_at ? '上次同步 ' + String(info.synced_at) : '尚未同步') : '',
      carFShSyncFg: two && info.synced_at ? okFg : 'var(--text-3)',
      carFShLastErr: two && info.last_err ? '注意：上次同步失敗　' + this.carFTxt(info.last_err) : '', carFShHasErr: !!(two && info.last_err),
      carFShTabs: shTabs.map((t, i) => ({ t, sub: i === 0 ? '可以直接改' : '機器人維護（唯讀）', bg: i === 0 ? 'color-mix(in oklab,var(--accent) 14%,var(--card))' : 'var(--card)', fg: i === 0 ? 'var(--accent-deep)' : 'var(--text-2)' })),
      carFShUrl: shUrl, carFShHasUrl: !!shUrl,
      carFShSyncBtn: busy ? '處理中…' : '立即同步',
      carFShAutoLbl: '自動同步（每 ' + shSec + ' 秒，試算表為準）',
      carFShAuto: sw(!!(info && info.auto)),
      carFShSyncResShow: !!shRes && !!shRes.sync,
      carFShSyncResBd: shRes && shRes.bad ? 'color-mix(in oklab,#ee6644 35%,var(--border))' : 'color-mix(in oklab,var(--accent) 30%,var(--border))',
      carFShSyncResBg: shRes && shRes.bad ? 'color-mix(in oklab,#ee6644 10%,var(--card))' : 'color-mix(in oklab,var(--accent) 10%,var(--card))',
      carFShV2: shOpen && v2, carFShBan: ban,
      carFShStepsOpen: stOpen, carFShStepsAll: stAll, carFShStepsHead: !stAll,
      carFShStepsTgl: '設定步驟：全部完成 ' + (stOpen ? '▾' : '▸'), carFShStepsExp: stOpen ? 'true' : 'false',
      carFShSyncTop: v2 && stAll && !stOpen,
      carFShS1: step(1), carFShS2: step(2), carFShS3: step(3), carFShS4: step(4), carFShS5: step(5), carFShS6: step(6),
      carFShNo2: String(stOrder.indexOf(2) + 1),
      carFShChkBtn: busy ? '處理中…' : '檢查連線',
      carFShHasChk: !!shChk,
      carFShChk: shChk ? { t: (shChk.ok ? '✓ ' : '✕ ') + this.carFTxt(shChk.msg || (shChk.ok ? '連線正常' : '連線失敗')), fg: shChk.ok ? okFg : badFg,
        hint: this.carFTxt(shChk.hint || ''), hasHint: !!shChk.hint, at: '檢查時間 ' + String(shChk.at || ''),
        tabs: Array.isArray(shChk.tabs) && shChk.tabs.length ? '試算表現有分頁：' + shChk.tabs.slice(0, 8).map(String).join('、') : '', hasTabs: Array.isArray(shChk.tabs) && shChk.tabs.length > 0 } : null,
      carFShNeed: shNeed && shHasId, carFShNoNeed: !shNeed, carFShNeedTxt: shNeedTxt,
      carFShFirstNote: shSynced ? '已經同步過了；之後有變動按「立即同步」或等自動同步。' : '表上的「' + shTab + '」分頁還沒有資料時，會把機器人的班表推上去；兩邊都有資料時會先問你以哪邊為準。',
      carFShLog: shLogs.map(x => {
        const items = (Array.isArray(x.items) ? x.items : []).slice(0, 12).map((t, i) => ({ i: String(i), t: this.carFTxt(t) }));
        const isU = x.kind === 'undo', head = (isU ? '還原 ' : '從表上套用 ') + (+x.n || 0) + ' 個時段';
        return { id: String(x.id), at: String(x.at || ''), head, who: x.who ? this.carFTxt(x.who) : '', hasWho: !!x.who, items,
          more: +x.more > 0, moreTxt: '還有 ' + (+x.more || 0) + ' 筆', undo: !!x.undo && !isU, undone: !!x.undone };
      }),
      carFShHasLog: shLogs.length > 0, carFShNoLog: v2 && !shLogs.length && shSynced,
      carFShIssues: shIss, carFShHasIssues: shIss.length > 0,
      carFShLastSum: shLastSum, carFShHasLastSum: !!shLastSum,
      carFShMultiNote: v2 && !!info.multi,
      carFShAdv: v2 && shHasId,
      carFShRules: v2 ? [
        '雙向同步：機器人每 ' + shSec + ' 秒跟試算表對一次，逐格比對「上次寫上去的內容」。',
        '有人在「' + shTab + '」分頁改了某一格（車種、跑者、P2～P5、替補），就照表改進機器人；那個時段標成「手動」，之後自動排位不會重排它。沒被改過的格子以機器人為準，Discord 上剛報的班、剛砍的班不會被舊表蓋回去。',
        '表上新增一列＝開一個班；刪掉一列不會砍班（下一輪會寫回去）；改日期或時段＝另開一個班，原本的不會砍。',
        '名字要跟成員名字或別名完全一樣；S6 寫「S6 名字」，P2 會自動當 S6。對不到的名字照樣排上去，但沒有倍率。',
        '看不懂的列（日期空白、時段打錯、同一時段兩列、超過 ' + (+info.max_ahead || 60) + ' 天後）不套用，會留在分頁最下面，「狀態」欄寫原因；改好下一輪就會套用。',
        '只同步今天以後的日期；今天已經結束的時段不從表上改。',
        '「時數」「成員」兩個分頁由機器人維護（唯讀）' + (info.multi ? '，而且全車隊共用' : '') + '，改了也會被蓋回去。',
        '能編輯這張試算表的人，等於有排班權限（不受鎖班、報班規則限制），只共用給信任的人。',
      ].map((t, i) => ({ i: String(i), t })) : two ? [
        '雙向同步、試算表為準：機器人每 ' + shSec + ' 秒跟試算表對一次。',
        '有人在「' + shTab + '」分頁改了座位、跑者、車種或替補，就照表改回機器人；那個時段會標成「手動」，之後自動排位不會重排它。',
        '表上新增一列＝開一個班；刪掉一列不會砍班（下一輪會再寫回去），砍班請用班表分頁或指令。',
        '只同步今天以後的日期，過去的班表不會被試算表回頭改。',
        '「時數」「成員」兩個分頁由機器人維護（唯讀），改了也會被蓋回去。',
        '要先把試算表共用給下面的服務帳號信箱（權限選「編輯者」）。',
      ].map((t, i) => ({ i: String(i), t })) : [],
      carFShOldOpen: shLegacy, carFShOldExp: shLegacy ? 'true' : 'false', carFShOldArrow: shLegacy ? '▲' : '▼', carFShOldToggle: two,
      carFBusyTxt: busy ? '處理中…' : '',
      onCarFSetSec: e => { const k = String(e.currentTarget.dataset.sec || ''); if (!k) return; this.setState(st2 => ({ carFSetOpen: Object.assign({}, st2.carFSetOpen, { [k]: !(st2.carFSetOpen || {})[k] }) })); if (k === '__sheet') this.carFSheetInfo(false); if (k === '__bgimg') this.carFBgInfo(false); },
      onCarFBgReload: () => this.carFBgInfo(true),
      onCarFBgStyle: e => { const v = String(e.currentTarget.dataset.v || ''); if (v !== 'classic' && v !== 'sheet') return; this.carFBgAct({ action: 'style', style: v }, v === 'sheet' ? '美圖班表改成清單風' : '美圖班表改回經典版型'); },
      onCarFBgMode: e => { const v = String(e.currentTarget.dataset.v || ''); if (!bgModes[v]) return; this.carFBgAct({ action: 'mode', mode: v }, '輪換：' + String(bgModes[v])); },
      onCarFBgFix: e => { const id = String(e.currentTarget.dataset.id || ''); if (id) this.carFBgAct({ action: 'mode', mode: 'fixed', id }, '已固定用這張'); },
      onCarFBgDel: e => {
        const id = String(e.currentTarget.dataset.id || ''), nm = String(e.currentTarget.dataset.n || '這張');
        if (!id || !window.confirm('刪掉「' + nm + '」？')) return;
        this.carFBgAct({ action: 'remove', id }, '已刪除');
      },
      onCarFBgPick: e => { const fl = Array.from((e.target && e.target.files) || []); try { e.target.value = ''; } catch (er) {} this.carFBgUpload(fl); },
      onCarFBgPreview: e => { this.carFBgPreview(String(e.currentTarget.dataset.id || '')); },
      onCarFBgPvClose: () => this.setState({ carFBgPv: null }),
      onCarFSetAll: () => { const o = Object.assign({}, s.carFSetOpen); secs.forEach(x => { o[x.sec] = !allOpen; }); this.setState({ carFSetOpen: o }); },
      onCarFSetBool: e => {
        const k = String(e.currentTarget.dataset.k || ''), { m } = this.carFMeta(k); if (!m) return;
        const nv = !this.carFCur(k);
        this.carFSetSave(k, nv, this.carFShort(m) + (nv ? ' 開啟' : ' 關閉'));
      },
      onCarFSetSel: e => {
        const k = String(e.currentTarget.dataset.k || ''), raw = String(e.target.value), { m } = this.carFMeta(k); if (!m) return;
        const opt = (Array.isArray(m.options) ? m.options : []).find(x => x && x.value != null && String(x.value) === raw);
        if (!opt) return;                                              // 「目前：…」那種舊值選項不送
        this.carFSetSave(k, opt.value, this.carFShort(m) + ' 已更新');   // 照原型別送（數字選項送數字）
      },
      onCarFSetChan: e => {
        const k = String(e.currentTarget.dataset.k || ''), raw = String(e.target.value), { m } = this.carFMeta(k); if (!m) return;
        if (raw && !/^\d{1,25}$/.test(raw)) return;
        this.carFSetSave(k, raw, this.carFShort(m) + (raw ? ' 已更新' : ' 已清除'));
      },
      onCarFSetChip: e => {
        const d = e.currentTarget.dataset, k = String(d.k || ''), id = String(d.id || ''), { m } = this.carFMeta(k); if (!m || !/^\d{1,25}$/.test(id)) return;
        const cv = this.carFCur(k), set = (Array.isArray(cv) ? cv : []).map(String);
        const nv = set.indexOf(id) >= 0 ? set.filter(x => x !== id) : set.concat([id]);
        this.carFSetSave(k, nv, this.carFShort(m) + ' 已更新');
      },
      onCarFSetRange: e => {
        const k = String(e.currentTarget.dataset.k || ''); if (!k) return;
        this.carFSetDraft(k, String(e.target.value));
        clearTimeout(this._carFRangeT); this._carFRangeT = setTimeout(() => this.carFSetRange(k), 650);   // 拖完停一下才存
      },
      onCarFSetText: e => { const k = String(e.currentTarget.dataset.k || ''); if (k) this.carFSetDraft(k, String(e.target.value)); },
      onCarFSetTextKey: e => { if (this.carFEnter(e)) { e.preventDefault(); this.carFSetText(String(e.currentTarget.dataset.k || '')); } },
      onCarFSetTextSave: e => this.carFSetText(String(e.currentTarget.dataset.k || '')),
      onCarFCars: e => {
        const n = parseInt(e.currentTarget.dataset.v, 10), { m } = this.carFMeta('cars_enabled'); if (!m || !(n >= 1 && n <= 3) || n === nOn) return;
        const opt = (Array.isArray(m.options) ? m.options : []).find(x => x && String(x.value) === String(n));
        if (!opt) { this._toast('機器人不支援這個車數'); return; }
        if (n < nOn && !window.confirm('改成只開 ' + n + ' 台車：' + [2, 3].filter(x => x > n && x <= nOn).map(x => this.carFCarName(x)).join('、') + ' 會停止報班並從車隊頁隱藏（班表資料保留，之後再開回來就會出現）。確定？')) return;
        this.carFSetSave('cars_enabled', opt.value, '已改成同時開 ' + n + ' 台車');
      },
      onCarFShId: e => { const v = String(e.target.value); this.setState(st2 => ({ carFSetDraft: Object.assign({}, st2.carFSetDraft, { [no + ':__sheet']: v }) })); },
      onCarFShIdKey: e => { if (this.carFEnter(e)) { e.preventDefault(); this.carFSheet('config'); } },
      onCarFShSave: () => this.carFSheet('config'),
      onCarFSheet: e => this.carFSheet(String(e.currentTarget.dataset.a || 'push')),
      onCarFShReload: () => this.carFSheetInfo(true),
      onCarFShCopy: () => {
        const t = info && info.service_email ? String(info.service_email) : ''; if (!t) return;
        /* 剪貼簿 API 只在安全環境（https／localhost）而且有權限時才有；不行就退回「暫時的 textarea + execCommand」 */
        const old = () => {
          let ok = false;
          try {
            const ta = document.createElement('textarea');
            ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
            document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, t.length);
            ok = !!document.execCommand('copy');
            document.body.removeChild(ta);
          } catch (er) { ok = false; }
          this._toast(ok ? '已複製服務帳號' : '無法複製，請手動選取');
        };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => this._toast('已複製服務帳號'), old);
          else old();
        } catch (er) { old(); }
      },
      onCarFShOld: () => this.setState(st2 => ({ carFSetOpen: Object.assign({}, st2.carFSetOpen, { __sheetOld: !(st2.carFSetOpen || {}).__sheetOld }) })),
      onCarFShUndo: e => this.carFShUndo(String(e.currentTarget.dataset.id || ''), String(e.currentTarget.dataset.h || '')),
    });
  },

  carFLogSrc() { const v = String(this.state.carFLogSrc || ''); return ['web', 'discord', 'system'].indexOf(v) >= 0 ? v : ''; },

  carSec_log(force) {
    if (!this.carFAdm()) return;
    const src = this.carFLogSrc();
    return this.carSecFetch(this.carSecKey('log-' + (src || 'all'), false), '/log', src ? { query: { src } } : {}, force);
  },

  carSecVals_log(c) {
    const { s, segOn } = c, src = this.carFLogSrc();
    const sec = this.carSecOf(this.carSecKey('log-' + (src || 'all'), false)), d = sec && sec.data;
    const SRC = { web: ['網頁', '#2f9e57'], discord: ['Discord', '#5865f2'], system: ['系統', '#8b90b5'] };
    const q = String(s.carFLogQ || '').trim().toLowerCase();
    const all = d && Array.isArray(d.log) ? d.log.filter(x => x && typeof x === 'object') : [];
    const rows = all.map((x, i) => {
      const sc = SRC[x.src] || [this.carFTxt(x.src) || '其他', '#8b90b5'], cs = this.carTagStyle(sc[1]);
      return { i: String(i), ts: String(x.ts || ''), src: sc[0], sBg: cs.bg, sFg: cs.fg, act: this.carFTxt(x.action) || '—', det: String(x.detail == null ? '' : x.detail), who: String(x.who || '') || '—' };
    }).filter(r => !q || (r.ts + ' ' + r.act + ' ' + r.det + ' ' + r.who).toLowerCase().indexOf(q) >= 0);
    const has = rows.length > 0;
    return {
      carFLogTabs: [['', '全部'], ['web', '網頁'], ['discord', 'Discord'], ['system', '系統']].map(([v, n]) => Object.assign({ v, n, sel: v === src ? 'true' : 'false' }, segOn(v === src))),
      carFLogLoading: !d && !(sec && sec.err),
      carFLogErr: !d && sec && sec.err ? String(sec.err) : '',
      carFLogCnt: d ? (q ? '符合 ' + rows.length + ' 筆 · ' : '') + all.length + ' / ' + (Math.max(0, parseInt(d.total, 10) || 0)) + ' 筆' : '',
      carFLogRows: rows, carFLogEmpty: !!d && !has, carFLogEmptyTxt: q ? '沒有符合的紀錄' : '尚無紀錄',
      carFLogWide: has && !s.mobile, carFLogNarrow: has && !!s.mobile,
      carFLogQ: s.carFLogQ || '', carFLogHasQ: !!q,
      carFLogBusyTxt: sec && sec.busy ? '讀取中…' : '重新整理',
      onCarFLogSrc: e => { const v = String(e.currentTarget.dataset.v || ''); this.setState({ carFLogSrc: v }); setTimeout(() => this.carSec_log(false), 0); },
      onCarFLogReload: () => this.carSec_log(true),
    };
  },

  carSec_system(force) {
    if (!this.carFAdm()) return;
    this.carSecFetch(this.carSecKey('status', false), '/status', {}, force);
    if (!this._carFPollT) this._carFPollT = setInterval(() => this.carFTick(false), 10000);
    if (!this._carFVis) { this._carFVis = () => { if (!document.hidden) this.carFTick(true); }; try { document.addEventListener('visibilitychange', this._carFVis); } catch (e) {} }
  },

  carFTick(wake) {
    const s = this.state;
    if (s.page !== 'car' || s.carTab !== 'system' || !this.carGuild() || !this.carFAdm()) {
      if (!wake && this._carFPollT) { clearInterval(this._carFPollT); this._carFPollT = null; }
      return;
    }
    if (document.hidden) return;
    const key = this.carSecKey('status', false), cur = this.carSecOf(key);
    if (cur && cur.busy) return;
    if (wake && cur && cur.at && Date.now() - cur.at < 4000) return;
    this.carSecFetch(key, '/status', {}, true);
  },

  async carFAction(a) {
    const no = this.carNo(), cn = this.carFCarName(no);
    const Q = {
      reseat: '全部重排補位：依排位規則重新整理「' + cn + '」今天起每一天的班表，把卡在報名名單、還沒排上位的人補進空位（已排好的位置可能會被調整）。確定要執行？',
      top3: 'Top3 立即播報：機器人會進語音頻道播報目前的排名（會用到語音合成額度）。確定？',
    };
    if (Q[a] && !window.confirm(Q[a])) return null;
    const DONE = { board: '班表看板已重繪', extsup: '外援看板已同步', reseat: '已重排補位', top3: '已播報', backup: '已建立備份' };
    this._toast('執行中…', 25000);
    const d = await this.carAct('/action', { action: a }, null, no);
    if (!d) return null;
    this._toast(this.carFMsg(d, DONE[a] || '完成'), 3500);
    if (a === 'reseat') this.carLoadStates(no);
    if (d.pending) this.carFLater(() => { if (a === 'reseat') this.carLoadStates(no); if (this.state.carTab === 'system') this.carSecFetch(this.carSecKey('status', false), '/status', {}, true); });
    return d;
  },

  async carFMusic(action, extra) {
    if (this.carFQQ()) { this._toast('QQ 車隊沒有語音功能'); return null; }
    if (action === 'stop' && !window.confirm('停止音樂：會停掉正在播的歌並清空整個佇列（自動歌單也會關閉）。確定？')) return null;
    if (action === 'play') this._toast('解析中…', 25000);
    const d = await this.carAct('/music', Object.assign({ action }, extra || {}), null);
    if (!d) return null;
    let msg;
    if (action === 'play' && !d.pending) {
      const n = +d.added || 0;
      msg = '已加入：' + String(d.title || '') + (n > 1 ? '（' + n + ' 首）' : '') + (d.queued_only ? '（機器人還沒進語音，進去後會自動播）' : (d.vc ? '（→ ' + String(d.vc) + '）' : ''));
    } else msg = this.carFMsg(d, { stop: '已停止並清空', skip: '已跳過', volume: '音量 ' + (+d.volume || 0) + '%', play: '已加入' }[action] || '完成');
    this._toast(msg, 3200);
    const key = this.carSecKey('status', false);
    this.carSecFetch(key, '/status', {}, true);
    if (d.pending) this.carFLater(() => this.carSecFetch(this.carSecKey('status', false), '/status', {}, true));
    return d;
  },

  async carFPlay() {
    const v = String(this.state.carFPlay || '').trim();
    if (!v) { this._toast('請輸入 YouTube 網址或關鍵字'); return; }
    if (v.length > 300) { this._toast('太長了，請貼網址或簡短的關鍵字'); return; }
    const d = await this.carFMusic('play', { query: v });
    if (d) this.setState({ carFPlay: '' });
  },

  async carFRun() {
    const v = String(this.state.carFCmd || '').trim().replace(/\s+/g, ' ');
    if (!v) return;
    const no = this.carNo(), today = this.carFToday(), cn = this.carFCarName(no);
    const done = () => this.setState({ carFCmd: '' });
    const span = (a, b) => {
      a = +a; b = +b; if (b <= a) b += 24;
      if (!(a >= 0 && a <= 29 && b <= 30 && b - a <= 12)) return null;
      const hs = []; for (let h = a; h < b; h++) hs.push(String(h).padStart(2, '0') + ':00');
      return hs;
    };
    const dateOf = x => {
      if (!x || x === '今天') return today;
      if (x === '明天') return this.carFAddDay(today, 1);
      if (x === '後天') return this.carFAddDay(today, 2);
      let p = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(x);
      if (p) return p[1] + '-' + p[2].padStart(2, '0') + '-' + p[3].padStart(2, '0');
      p = /^(\d{1,2})[/-](\d{1,2})$/.exec(x);
      if (p) { let d = today.slice(0, 4) + '-' + p[1].padStart(2, '0') + '-' + p[2].padStart(2, '0'); if (d < today) d = (+today.slice(0, 4) + 1) + d.slice(4); return d; }
      return null;
    };
    const rng = hs => hs[0].slice(0, 2) + ':00～' + String(+hs[hs.length - 1].slice(0, 2) + 1).padStart(2, '0') + ':00';
    const tail = r => r.fail ? '（失敗 ' + r.fail + '：' + r.err + '）' : '';
    let m;
    try {
      if ((m = /^(?:播放|點播) (.+)$/.exec(v))) { if (await this.carFMusic('play', { query: m[1].slice(0, 300) })) done(); return; }
      if ((m = /^音量 ?(\d{1,3})%?$/.exec(v))) { if (await this.carFMusic('volume', { value: Math.max(5, Math.min(200, +m[1])) })) done(); return; }
      if (/^(?:跳過|skip)$/i.test(v)) { if (await this.carFMusic('skip')) done(); return; }
      if (/^(?:停止|stop)$/i.test(v)) { if (await this.carFMusic('stop')) done(); return; }
      if ((m = /^(?:砍班|砍|取消) ?(\d{1,2})-(\d{1,2})(?: (\S+))?$/.exec(v))) {
        const hs = span(m[1], m[2]), date = dateOf(m[3]);
        if (!hs) { this._toast('時段格式：20-24（一次最多 12 小時）'); return; }
        if (!date) { this._toast('日期格式：2026-09-20、9/20、今天或明天'); return; }
        if (!window.confirm('砍班：清空「' + cn + '」' + date + ' ' + rng(hs) + '（' + hs.length + ' 個時段）的所有人員、報名與候補，並取消這些時段。確定？')) return;
        const r = await this.carFSeq(hs.map(h => ({ path: '/run', body: { date, hour: h, action: 'unmark' } })), no);
        if (!r) return;
        this._toast('已砍班 ' + r.ok + ' 個時段' + tail(r), 3500);
        if (r.ok) { done(); this.carLoadStates(no); }
        return;
      }
      if ((m = /^(\d{1,2})-(\d{1,2})(?: ?(?:開班|開))?(?: (\S+))?$/.exec(v))) {
        const hs = span(m[1], m[2]), date = dateOf(m[3]);
        if (!hs) { this._toast('時段格式：20-24（一次最多 12 小時）'); return; }
        if (!date) { this._toast('日期格式：2026-09-20、9/20、今天或明天'); return; }
        const r = await this.carFSeq(hs.map(h => ({ path: '/run', body: { date, hour: h, action: 'mark' } })), no);
        if (!r) return;
        this._toast('已開班 ' + r.ok + ' 個時段（' + cn + ' ' + date + '）' + tail(r), 3500);
        if (r.ok) { done(); this.carLoadStates(no); }
        return;
      }
      if ((m = /^(\S+?) ?(?:補|上) ?(\d{1,2})-(\d{1,2})(?: ?(p[2-5]|s6))?$/i.exec(v))) {
        const nm = m[1], hs = span(m[2], m[3]), p = (m[4] || 'p3').toLowerCase(), pos = p === 's6' ? 'p2' : p;
        if (!hs) { this._toast('時段格式：20-24（一次最多 12 小時）'); return; }
        const r = await this.carFSeq(hs.map(h => ({ path: '/swap', body: { date: today, hour: h, pos, new: nm, role: p === 's6' ? 's6' : '' } })), no);
        if (!r) return;
        this._toast(nm + ' 已排入 ' + r.ok + ' 個時段 ' + (p === 's6' ? 'P2（S6）' : pos.toUpperCase()) + tail(r), 3500);
        if (r.ok) { done(); this.carLoadStates(no); }
        return;
      }
      if (/^(?:重排|補位|重排補位)$/.test(v)) { if (await this.carFAction('reseat')) done(); return; }
      if (/^(?:看板|重繪|重繪看板)$/.test(v)) { if (await this.carFAction('board')) done(); return; }
      this._toast('看不懂這個指令，格式請看輸入框下方的說明', 3500);
    } catch (e) { this._toast('執行失敗：' + String((e && e.message) || e).slice(0, 60)); }
  },

  carSecVals_system(c) {
    const { s, carNo, segOn } = c, qq = this.carFQQ(), busy = !!s.carActBusy;
    const sec = this.carSecOf(this.carSecKey('status', false)), d = sec && sec.data;
    const ok = 'color-mix(in oklab,#2f9e57 55%,var(--car-fg))', bad = 'color-mix(in oklab,#ee6644 55%,var(--car-fg))';
    const num = x => (x === null || x === undefined || x === '' || typeof x === 'boolean' || !isFinite(+x)) ? null : +x;
    let stats = [];
    if (d) {
      const lat = num(d.latency), vol = num(d.volume), keys = num(d.gemini_keys), ql = num(d.queue_len) || 0;
      stats = [
        ['語音', d.voice_connected ? (String(d.voice_channel || '') || '已連線') : '未連線', d.voice_connected ? ok : bad, 1],
        ['延遲', lat != null ? Math.round(lat) + ' ms' : '—', '', 1],
        ['佇列', ql + ' 首', '', 1],
        ['音量', vol != null ? Math.round(vol) + '%' : '—', '', 1],
        ['混音', d.mix ? '開' : '關', d.mix ? ok : '', 1],
        ['常駐', d.voice_home ? '開' : '關', d.voice_home ? ok : '', 1],
        ['自動歌單', d.auto_genre ? (this.CAR_F_GENRE[d.auto_genre] || String(d.auto_genre)) : '關', '', 1],
        ['Gemini 金鑰', keys != null ? keys + ' 把' : '—', keys == null ? '' : (keys > 1 ? ok : bad), 0],
        ['OpenAI 金鑰', d.openai ? '已設定' : '未設定', d.openai ? ok : '', 0],
      ].filter(x => !(qq && x[3])).map(([k, v, fg]) => ({ k, v: String(v), fg: fg || 'var(--ink)' }));
    }
    const p = d && d.playing && typeof d.playing === 'object' ? d.playing : null;
    const fd = x => { const n = num(x); if (!n) return '—'; const t = Math.floor(n); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
    const pct = p && num(p.duration) ? Math.max(0, Math.min(100, (num(p.pos) || 0) / num(p.duration) * 100)) : 0;
    const on = d ? !!d.online : null, err = sec && sec.err ? String(sec.err) : '';
    const at = sec && sec.at ? new Date(sec.at) : null;
    const acts = [['board', '重繪班表看板', 1], ['extsup', '同步外援看板', 1], ['reseat', '全部重排補位', 0], ['top3', 'Top3 立即播報', 1], ['backup', '建立備份', 0]]
      .filter(x => !(qq && x[2])).map(([a, n]) => ({ a, n }));
    const ex = ['20-22 開班', '砍 20-22', '小婉 補 20-22 p3', '重排', '看板'].concat(qq ? [] : ['播放 歌名', '音量 80', '跳過']).map(t => ({ t }));
    const cn = this.carFCarName(carNo);
    return {
      carFCarSeg: this.carFCarSeg(segOn),
      carFSysCarNote: '重排補位、重繪看板與快速指令裡的班表動作，只作用在目前選的「' + cn + '」。',
      carFSysOnTxt: d ? (on ? '機器人在線' : '機器人未連上 Discord') : (err ? '連不上機器人' : '讀取中…'),
      carFSysOnDot: d ? (on ? '#2f9e57' : '#ee6644') : (err ? '#ee6644' : '#8b90b5'),
      carFSysOnBg: d ? (on ? 'color-mix(in oklab,#2f9e57 15%,var(--card))' : 'color-mix(in oklab,#ee6644 15%,var(--card))') : 'var(--card-2)',
      carFSysOnFg: d ? (on ? ok : bad) : (err ? bad : 'var(--text-3)'),
      carFSysAt: at ? '更新於 ' + String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0') + ':' + String(at.getSeconds()).padStart(2, '0') + ' · 每 10 秒自動更新' : '',
      carFSysBusyTxt: sec && sec.busy ? '更新中…' : '重新整理',
      carFSysLoading: !d && !err, carFSysErr: !d ? err : '',
      carFSysStats: stats, carFSysHasStats: stats.length > 0,
      carFSysQQ: qq, carFSysDc: !qq,
      carFSysQQNote: '這是 QQ 車隊：語音、音樂、看板與 Top3 播報只有 Discord 車隊能用，這裡只顯示機器人本身的狀態。',
      carFSysNow: !qq && !!p, carFSysNowT: p ? String(p.title || '（沒有標題）') : '',
      carFSysNowSub: p ? fd(p.pos) + ' / ' + fd(p.duration) + (p.requester ? ' · ' + String(p.requester) + ' 點播' : '') : '',
      carFSysNowW: pct.toFixed(1) + '%',
      carFCmd: s.carFCmd || '', carFCmdEx: ex,
      carFCmdPh: qq ? '快速指令：20-22 開班 ／ 砍 20-22 ／ 小婉 補 20-22 p3' : '快速指令：20-22 開班 ／ 砍 20-22 ／ 小婉 補 20-22 p3 ／ 播放 歌名 ／ 音量 80',
      carFCmdBtn: busy ? '處理中…' : '執行',
      carFCmdHelp: '開班「20-22」或「20-22 開班 明天」；砍班「砍 20-22」；換人「小婉 補 20-22 p3」（今天，位置可寫 p2～p5 或 s6）；「重排」重排補位、「看板」重繪看板'
        + (qq ? '。' : '；音樂「播放 歌名」、「音量 80」、「跳過」、「停止」。') + '班表指令作用在「' + cn + '」。',
      carFPlay: s.carFPlay || '',
      carFActs: acts,
      carFActBusy: busy,
      onCarFSysReload: () => this.carSec_system(true),
      onCarFAct: e => this.carFAction(String(e.currentTarget.dataset.a || '')),
      onCarFPlayGo: () => this.carFPlay(),
      onCarFPlayKey: e => { if (this.carFEnter(e)) { e.preventDefault(); this.carFPlay(); } },
      onCarFStop: () => this.carFMusic('stop'),
      onCarFGoBoard: () => { this.setState({ carTab: 'sched', carView: 'board', carPop: null, carTagMgr: false }); setTimeout(() => this.carLoadSec('sched'), 0); },
      onCarFCmdKey: e => { if (this.carFEnter(e)) { e.preventDefault(); this.carFRun(); } },
      onCarFCmdGo: () => this.carFRun(),
      onCarFCmdEx: e => this.setState({ carFCmd: String(e.currentTarget.dataset.t || '') }),
    };
  },

  async carAct(path, body, okMsg, no, soft) {
    if (this._carActBusy) { this._toast('上一個操作還在處理中'); return null; }
    no = no || this.carNo();
    this._carActBusy = true; this.setState({ carActBusy: true });
    try {
      const d = await this.carApi(path, { body, car: no });
      if (okMsg) this._toast(typeof okMsg === 'function' ? okMsg(d) : okMsg);
      return d;
    } catch (e) {
      if (typeof soft === 'function') { let v = null; try { v = soft(e); } catch (er) {} if (v) return v; }
      this._toast(e.message || '操作失敗');
      if (e.status === 409 || (e.status === 404 && e.code !== 'bot_not_updated')) this.carLoadStates(no);
      return null;
    } finally { this._carActBusy = false; this.setState({ carActBusy: false }); }
  },

  carOpenPop(kind, el, extra) {
    const d = el.dataset, r = el.getBoundingClientRect();
    const pop = Object.assign({ kind, no: this.carNo(), date: d.d || '', hour: d.h || '', pos: d.pos || '', ti: d.i != null ? +d.i : -1, x: r.left, y: r.bottom, top: r.top }, extra || {});
    const patch = { carPop: pop };
    if (kind === 'addtag') Object.assign(patch, { carTagSel: '', carTagScope: 'shift', carTagDetail: '', carTagUntil: '' });
    if (kind === 'empty' || kind === 'seat') Object.assign(patch, { carPick: '', carPickRole: '' });
    if (kind === 'runner') Object.assign(patch, { carRunName: '', carRunChain: false });
    this.setState(patch);
    const st = (this.state.carStates || {})[pop.no];
    if (st && this.carIsSched(st) && (kind === 'empty' || kind === 'seat')) this.carLoadMembers();
    if (st && this.carIsSched(st) && kind === 'runner') this.carAMemLoad(false);      // 跑者的建議名單用班表分頁那份名冊（有別名與身分）
  },

  async carSign(date, hour, act, role) {
    const no = this.carNo();
    if (act === 'cancel' && !window.confirm('確定取消 ' + this.carSlot(hour) + ' 這一班？')) return;
    const d = await this.carAct('/signup', { date, hours: [hour], action: act === 'cancel' ? 'cancel' : 'add', role: role === 's6' ? 's6' : 'pusher' }, null, no);
    if (!d) return;
    const ok = (d.done || []).indexOf(hour) >= 0;
    /* 機器人的報班限制／取消期限擋下時會回 why（例：超過每人每天 6 小時上限：20-21）→ 直接講原因 */
    const why = Array.isArray(d.why) ? d.why.map(x => this.carFTxt(x)).filter(Boolean).join('；') : '';
    this._toast(ok ? ((act === 'cancel' ? '已取消 ' : '已報班 ') + this.carSlot(hour))
      : (why || (act === 'cancel' ? '這個時段沒有你的報班' : '這個時段目前不能報班（可能已鎖班或還沒開放）')), why ? 5000 : undefined);
    this.setState({ carPop: null });
    this.carLoadStates(no);
  },

  async carPlace() {
    const p = this.state.carPop, s = this.state; if (!p) return;
    const nm = String(s.carPick || '').trim();
    if (!nm) { this._toast('輸入或選一位成員'); return; }
    const d = await this.carAct('/swap', { date: p.date, hour: p.hour, pos: p.pos, new: nm, role: s.carPickRole || '' },
      r => (r.name || nm) + ' 已排入 ' + this.carSlot(p.hour) + ' ' + p.pos.toUpperCase() + (r.role === 's6' ? '（S6）' : ''), p.no);
    if (d) { this.setState({ carPop: null }); this.carLoadStates(p.no); }
  },

  async carClearSeat() {
    const p = this.state.carPop; if (!p) return;
    const { seat, st } = this.carSeatAt(p.no, p.date, p.hour, p.pos);
    if (st && st.today && String(p.date) < st.today) { this._toast('跨日時段已過日期，不能移出，只能貼標記'); return; }
    if (!window.confirm('把 ' + ((seat && seat.name) || '這個人') + ' 移出 ' + this.carSlot(p.hour) + ' ' + p.pos.toUpperCase() + '？')) return;
    const d = await this.carAct('/swap', { date: p.date, hour: p.hour, pos: p.pos, new: '' }, '已移出', p.no);
    if (d) { this.setState({ carPop: null }); this.carLoadStates(p.no); }
  },

  async carDrop(t) {
    const src = this._carDrag; this._carDrag = null;
    if (!src || !src.nm) return;
    const no = this.carNo(), date = src.d || t.d, st0 = (this.state.carStates || {})[no];
    // 跨日時段（昨天的日期）機器人只准貼標記；放進去的身分照成員池上選的（自動／S6／推手，跟舊面板一樣）
    if ([src.d, t.d].some(x => x && st0 && st0.today && String(x) < st0.today)) { this._toast('跨日時段已過日期，只能貼標記'); return; }
    const dropRole = this.state.carARole === 's6' || this.state.carARole === 'pusher' ? this.state.carARole : '';
    if (t.zone === 'out') {
      if (!src.h) return;
      const d = await this.carAct('/swap', { date, hour: src.h, pos: src.pos, new: '' }, '已移出 ' + src.nm, no);
      if (d) this.carLoadStates(no);
      return;
    }
    const h = t.h, pos = t.pos;
    if (!h || !pos || (src.h === h && src.pos === pos)) return;
    const d = await this.carAct('/swap', { date: t.d || date, hour: h, pos, new: src.nm, role: dropRole }, null, no);
    if (!d) return;
    if (src.h && src.h === h && src.pos) {
      await this.carAct('/swap', { date, hour: src.h, pos: src.pos, new: t.nm || '', role: '' }, null, no);
    }
    this._toast((d.name || src.nm) + ' → ' + this.carSlot(h) + ' ' + pos.toUpperCase() + (d.role === 's6' ? '（S6）' : ''));
    this.carLoadStates(no);
  },

  async carSetOpen() {
    const no = this.carNo(), st = (this.state.carStates || {})[no]; if (!st) return;
    const v = !(st.settings && st.settings.schedule_open);
    const d = await this.carAct('/setting', { key: 'schedule_open', value: v }, v ? '已開放成員自助報班' : '已停止報班', no);
    if (d) this.carLoadStates(no);
  },

  async carLock(hours, v) {
    const no = this.carNo(), st = (this.state.carStates || {})[no], day = this.carDayOf(st, this.state.carDate);
    if (!day || !hours.length) return;
    const d = await this.carAct('/batch', { action: 'lock', date: day.date, hours, value: !!v }, r => r.msg || (v ? '已鎖班' : '已解鎖'), no);
    if (d) this.carLoadStates(no);
  },

  async carTagPut() {
    const p = this.state.carPop, s = this.state; if (!p) return;
    if (!s.carTagSel) { this._toast('先選一個標記'); return; }
    const { seat } = this.carSeatAt(p.no, p.date, p.hour, p.pos);
    if (!seat || !seat.fp) { this._toast('座位已變動，請重新整理'); this.carLoadStates(p.no); return; }
    const body = { date: p.date, hour: p.hour, pos: p.pos, tag: s.carTagSel, scope: s.carTagScope === 'member' ? 'member' : 'shift', detail: String(s.carTagDetail || '').slice(0, 100), action: 'add', fp: seat.fp };
    if (body.scope === 'member' && s.carTagUntil) body.until = s.carTagUntil;
    const d = await this.carAct('/seattag', body, '已貼上標記', p.no);
    if (d) { this.setState({ carPop: null }); this.carLoadStates(p.no); }
  },

  async carTagDel() {
    const p = this.state.carPop; if (!p) return;
    const { seat } = this.carSeatAt(p.no, p.date, p.hour, p.pos);
    const t = seat && (seat.tags || [])[p.ti];
    if (!t || !seat.fp) { this._toast('座位已變動，請重新整理'); this.carLoadStates(p.no); return; }
    if (!window.confirm('移除「' + t.label + '」這個標記？')) return;
    const d = await this.carAct('/seattag', { date: p.date, hour: p.hour, pos: p.pos, tag: t.tag, scope: t.scope === 'member' ? 'member' : 'shift', action: 'del', fp: seat.fp }, '已移除標記', p.no);
    if (d) { this.setState({ carPop: null }); this.carLoadStates(p.no); }
  },

  carTmEdit(id) {
    const pal = (this.state.carTags && this.state.carTags.pal) || [];
    const t = id ? pal.find(x => x.id === id) : null;
    const cols = (this.state.carTags && this.state.carTags.colors) || [];
    this.setState(t ? { carTmId: t.id, carTmLabel: t.label, carTmColor: this.CAR_HEX.test(t.color) ? t.color : '#8b90b5', carTmDetail: t.detail || '', carTmVis: t.visibility === 'admin' ? 'admin' : 'all', carTmForm: true }
      : { carTmId: '', carTmLabel: '', carTmColor: cols[0] || '#3f8cf3', carTmDetail: '', carTmVis: 'all', carTmForm: true });
  },

  async carTmSave() {
    const s = this.state, lb = String(s.carTmLabel || '').trim();
    if (!lb) { this._toast('標籤名稱不能空白'); return; }
    if ([...lb].length > 6) { this._toast('標籤名稱最多 6 個字'); return; }
    if (/[<>&"'`]/.test(lb)) { this._toast('標籤名稱不能含 < > & " \' ` 這些符號'); return; }
    if (!this.CAR_HEX.test(String(s.carTmColor || ''))) { this._toast('顏色格式須為 #RRGGBB'); return; }
    const body = { action: s.carTmId ? 'edit' : 'add', label: lb, color: String(s.carTmColor).toLowerCase(), detail: String(s.carTmDetail || '').slice(0, 100), visibility: s.carTmVis === 'admin' ? 'admin' : 'all' };
    if (s.carTmId) body.id = s.carTmId;
    const no = this.carNo();
    const d = await this.carAct('/tags', body, s.carTmId ? '已更新標籤' : '已新增標籤', no);
    if (d) {
      if (Array.isArray(d.tags)) this.setState({ carTags: Object.assign({}, this.state.carTags || {}, { key: this.state.g + ':' + no, pal: d.tags }) });
      this.setState({ carTmForm: false, carTmId: '' });
      this.carLoadStates(no);
    }
  },

  async carTmDel() {
    const s = this.state; if (!s.carTmId) return;
    if (!window.confirm('刪除「' + s.carTmLabel + '」？已經貼出去的這個標記也會一併消失。')) return;
    const no = this.carNo();
    const d = await this.carAct('/tags', { action: 'del', id: s.carTmId }, '已刪除標籤', no);
    if (d) {
      if (Array.isArray(d.tags)) this.setState({ carTags: Object.assign({}, this.state.carTags || {}, { pal: d.tags }) });
      this.setState({ carTmForm: false, carTmId: '' });
      this.carLoadStates(no);
    }
  },

  carPageVals(s, out) {
    const isCar = s.page === 'car', isAcc = s.page === 'account', me = s.me, api = this.GAMES_API;
    const back = isCar ? ('/app.html?page=car' + (s.g ? '&g=' + encodeURIComponent(s.g) : '')) : '/app.html?page=account';
    const segOn = on => on ? { bg: 'var(--card)', fg: 'var(--ink)', sh: 'var(--sh-xs)' } : { bg: 'transparent', fg: 'var(--text-2)', sh: 'none' };
    const pill = on => on ? { bg: 'var(--ink-grad)', fg: '#fff', bd: 'transparent' } : { bg: 'var(--card)', fg: 'var(--text-2)', bd: 'var(--border)' };
    const q = s.lgQQ;
    const qLeft = q ? Math.max(0, Math.ceil((q.exp - (q.now || Date.now())) / 1000)) : 0;
    out.carCodeOk = true;   // 模板以此判斷車隊程式已載入（app.js 的 lgVals 在沒載入時改給 carCodeWait／carCodeErr）

    /* ===== 車隊頁 ===== */
    const cm = s.carMe, guilds = (cm && cm.guilds) || [];
    const gd = guilds.find(x => String(x.gid) === String(s.g)) || null;
    const cars = gd ? this.carCars(gd) : [];
    const carNo = cars.some(c => c.no === +s.car) ? +s.car : (cars[0] ? cars[0].no : 1);
    const curCar = cars.find(c => c.no === carNo) || { no: carNo, name: this.CAR_NAMES[carNo] || '' };
    const sts = s.carStates || {}, st = sts[carNo] || null;
    const admin = this.carIsSched(st), fullAdmin = !!(st && st.role === 'admin');   // admin＝能排班（含排班身份組）；fullAdmin＝能改設定
    const day = this.carDayOf(st, s.carDate);
    const today = (st && st.today) || '';
    const fmt = v => (v === null || v === undefined || v === '' || isNaN(+v)) ? '' : (+v).toFixed(2);
    const mine = (st && st.me && typeof st.me === 'object') ? st.me : {};
    const nowH = new Date().getHours();
    const roleTxt = { admin: '管理員', scheduler: '排班員', member: '成員' };
    const via = me ? ((me.discord ? 'Discord' : '') || ((me.qq || []).length ? 'QQ' : '') || '帳號') : '';

    /* 跨日時段（昨天 24:00 以後）日期已過：機器人只准貼標記，換人／移出／砍班／鎖班／報班一律不給按 */
    const xd = !!(day && day.xday);
    /* 私車／車隊：team_mode 是整個車隊共用的開關（舊機器人沒有這個欄位 → 不顯示開關、當成私車）。
       每一列的跑者看 r.p1（沒有就退回車隊預設跑者）；只有車隊模式的管理員、而且不是跨日列，才能改 */
    const teamKnown = !!st && typeof st.team_mode === 'boolean', teamOn = teamKnown && st.team_mode === true;
    const runEdit = admin && teamOn && !xd;
    /* 跑者自行報跑（車隊模式底下的選項；舊機器人沒有這個欄位 → 整組不顯示）：
       管理員看到開關；登記過跑者倍率的成員看到「我來開車／取消報跑」與報跑輸入框 */
    const selfKnown = teamKnown && typeof st.runner_self_signup === 'boolean', selfOn = selfKnown && teamOn && st.runner_self_signup === true;
    const meRunner = !!(st && st.me_runner === true);
    const runSelf = !admin && selfOn && meRunner && !xd;
    const rows = day ? (day.rows || []).map(r => {
      const rp = (r.p1 && typeof r.p1 === 'object' && r.p1.name != null && String(r.p1.name) !== '') ? r.p1 : null;
      const rCustom = !!(rp && rp.custom), rBonus = rp && +rp.bonus > 0 ? fmt(rp.bonus) : '';
      const my = ((mine[day.date] || []).find(x => x && x.hour === r.hour)) || null;
      const hr = +String(r.hour).slice(0, 2);
      const live = day.date === today ? hr === nowH : (!!day.xday && hr - 24 === nowH);
      const cells = ['p2', 'p3', 'p4', 'p5'].map(pos => {
        const se = (r.seats || []).find(x => x && x.pos === pos) || { pos };
        const has = !!se.name, isMine = !!(my && my.seat === pos);
        const tags = (Array.isArray(se.tags) ? se.tags : []).map((t, i) => {
          const c = this.carTagStyle(t.color);
          return { i: String(i), label: String(t.label || ''), bg: c.bg, fg: c.fg, title: String(t.label || '') + (t.detail ? '：' + t.detail : ''), h: r.hour, pos, d: day.date };
        });
        return {
          pos, P: pos.toUpperCase(), h: r.hour, d: day.date, has, empty: !has,
          name: String(se.name || ''), nm: String(se.name || ''), s6: se.role === 's6', bonus: fmt(se.bonus),
          tags: tags.slice(0, 3), hasMore: tags.length > 3, tagMore: '+' + Math.max(0, tags.length - 3),
          canTag: admin && has && !!se.fp,
          drag: admin && has && !xd ? 'true' : 'false',
          emptyTxt: xd ? '缺' : admin ? '缺 · 點此排人' : (r.locked ? '缺 · 已鎖班' : '缺 · 點此報班'),
          emptyBtn: !xd, emptyRo: xd,
          bg: isMine ? 'color-mix(in oklab,var(--accent) 13%,transparent)' : 'transparent',
          mine: isMine,
        };
      });
      const filled = cells.filter(c => c.has).length;
      const wl = (Array.isArray(r.waitlist) ? r.waitlist : []).filter(Boolean).map(String);
      const noteParts = [];
      if (wl.length) noteParts.push('候補 ' + wl.join('、'));
      if (r.applicants) noteParts.push('報班 ' + r.applicants);
      const rMine = !!(rp && rp.mine === true);
      let rsShow = false, rsTxt = '', rsAct = '';
      if (runSelf) {
        if (rMine) { rsShow = true; rsAct = 'cancel'; rsTxt = '取消報跑'; }
        else if (!rCustom && !my) { rsShow = true; rsAct = 'open'; rsTxt = '我來開車'; }
      }
      let signShow = false, signTxt = '', signAct = '';
      if (!admin && !xd) {
        if (my) { signShow = true; signAct = 'cancel'; signTxt = my.seat ? '砍班' : (my.waitlist ? '取消候補' : '取消報班'); }
        else if (!r.locked) { signShow = true; signAct = 'add'; signTxt = '報班'; }
      }
      // 報了但還沒上位也不在候補＝等管理員確認（車隊沒開自動確認時，網頁報班都是這個狀態）
      const myTxt = my ? (my.seat ? '我在 ' + my.seat.toUpperCase() : my.waitlist ? '我在候補' : '我已報班 · 待確認') : '';
      return {
        hour: r.hour, d: day.date, slot: this.carSlot(r.hour), runner: rp ? String(rp.name) : String((st && st.p1) || '跑者'), ctype: String(r.car_type || ''),
        rCustom, rC: rCustom ? '1' : '', rBonus, rSub: [String(r.car_type || ''), rBonus].filter(Boolean).join(' · '),
        rFg: rCustom ? 'var(--accent-deep)' : 'var(--ink)', rFg2: rCustom ? 'var(--accent-deep)' : 'var(--text-3)',
        rEdit: runEdit, rRo: !runEdit, rCur: runEdit ? 'pointer' : 'default', rTitle: '點一下指定這個時段的跑者',
        locked: !!r.locked, manual: !!r.manual, cells, filled,
        note: noteParts.join(' · ') || (myTxt ? '' : '—'), myTxt, hasMy: !!myTxt,
        signShow: signShow && !rMine, signTxt, signAct,
        rsShow, rsTxt, rsAct, rMine,
        lockShow: admin && !xd, lockTxt: r.locked ? '解鎖' : '鎖班', lockV: r.locked ? '0' : '1',
        unmarkShow: admin && !xd,
        wl: wl.map(n => ({ nm: n, drag: admin && !xd ? 'true' : 'false', h: '', d: day.date })), hasWl: wl.length > 0,
        bg: live ? 'color-mix(in oklab,var(--accent) 7%,var(--card))' : 'transparent',
        colBd: live ? 'color-mix(in oklab,var(--accent) 45%,var(--border))' : 'var(--border)',
      };
    }) : [];
    const allSeats = [].concat.apply([], rows.map(r => r.cells));
    const bon = allSeats.filter(c => c.has && c.bonus).map(c => +c.bonus);
    const miss = allSeats.filter(c => !c.has).length;
    const open = admin && st && st.settings ? !!st.settings.schedule_open : null;
    const allLocked = rows.length > 0 && rows.every(r => r.locked);

    /* 三車分頁：每車顯示同一天「滿員時段／總時段」 */
    const carTabs = cars.map(c => {
      const cs = sts[c.no], cd = cs && day ? ((cs.days || []).find(x => x.date === day.date && !!x.xday === !!day.xday)) : null;
      const n = cd ? (cd.rows || []).length : 0;
      const full = cd ? (cd.rows || []).filter(r => (r.seats || []).filter(x => x && x.name).length >= 4).length : 0;
      const on = c.no === carNo;
      return Object.assign({ v: String(c.no), n: c.name, cnt: cs ? (n ? full + '/' + n : '—') : ((s.carStErr || {})[c.no] ? '!' : '…'), cntFg: on ? 'var(--accent-deep)' : 'var(--text-3)' }, segOn(on));
    });
    const dates = ((st && st.days) || []).map(d => Object.assign({ v: d.date, x: d.xday ? '1' : '', n: this.carDayLabel(d.date, today, d.xday) }, pill(day && d.date === day.date && !!d.xday === !!day.xday)));

    /* 我的班：三車合併，同一天連續、同座位的時段併成一段 */
    const myList = [];
    cars.forEach(c => {
      const cs = sts[c.no]; if (!cs || !cs.me || typeof cs.me !== 'object') return;
      Object.keys(cs.me).sort().forEach(d => {
        const hs = (cs.me[d] || []).filter(x => x && /^\d{2}:\d{2}$/.test(String(x.hour))).slice().sort((a, b) => a.hour < b.hour ? -1 : 1);
        const st2 = x => (x.seat ? x.seat.toUpperCase() + (() => { const dd = (cs.days || []).find(y => y.date === d); const rr = dd && (dd.rows || []).find(y => y.hour === x.hour); const se = rr && (rr.seats || []).find(y => y && y.pos === x.seat); return se && se.role === 's6' ? ' S6' : ''; })() : x.waitlist ? '候補' : '待確認')
          + (x.locked ? ' · 已鎖' : '');
        let seg = null;
        hs.forEach(x => {
          const v = st2(x), h = +x.hour.slice(0, 2);
          if (seg && seg.v === v && seg.b === h) { seg.b = h + 1; return; }
          if (seg) myList.push(seg);
          seg = { c: c.name, d, a: h, b: h + 1, v };
        });
        if (seg) myList.push(seg);
      });
    });
    const pad = n => String(n % 24).padStart(2, '0');
    const dayShort = d => { const t = this.carDayLabel(d, today, false); return t.replace(/（.）$/, ''); };

    /* 標籤盤 */
    const tagKey = s.g + ':' + carNo;
    const pal = (s.carTags && s.carTags.key === tagKey && s.carTags.pal) || [];
    const palChips = pal.map(t => { const c = this.carTagStyle(t.color); return { id: String(t.id), label: String(t.label || ''), bg: c.bg, fg: c.fg, title: String(t.label || '') + (t.detail ? '：' + t.detail : '') + (t.visibility === 'admin' ? '（僅管理員可見）' : ''), adm: t.visibility === 'admin' }; });

    /* 彈出框 */
    const p = s.carPop;
    let pv = { carPopShow: false };
    if (p && p.no === carNo) {
      const { seat, row, day: pday } = this.carSeatAt(p.no, p.date, p.hour, p.pos);
      const W = 290, vw = (typeof window !== 'undefined' ? window.innerWidth : 1200), vh = (typeof window !== 'undefined' ? window.innerHeight : 800);
      const left = Math.max(12, Math.min(vw - W - 12, p.x - 20));
      const isRun = p.kind === 'runner';
      const below = p.y + 12, h0 = p.kind === 'tag' ? 170 : isRun ? 300 : 360;
      const top = below + h0 > vh - 12 ? Math.max(12, p.top - h0 - 10) : below;
      const mem = (s.carMembers && s.carMembers.key === tagKey && s.carMembers.list) || [];
      const tags = seat && Array.isArray(seat.tags) ? seat.tags : [];
      const t = p.kind === 'tag' ? tags[p.ti] : null;
      const tc = t ? this.carTagStyle(t.color) : null;
      const where = (curCar.name || '') + ' · ' + this.carSlot(p.hour) + (isRun ? ' · P1 跑者' : p.pos ? ' · ' + String(p.pos).toUpperCase() : '');
      const my = ((mine[p.date] || []).find(x => x && x.hour === p.hour)) || null;
      const pxd = !!(st && st.today && String(p.date) < st.today);     // 跨日時段：只能看／貼標記
      /* 這個時段的跑者（車隊模式、管理員）：目前是誰、勾了「連續時段一起改」會動到哪幾格 */
      let rv = {};
      if (isRun && row) {
        const rp = (row.p1 && typeof row.p1 === 'object' && row.p1.name) ? row.p1 : null;
        const chain = !!s.carRunChain, hs = this.carRunHours(pday, p.hour, chain);
        rv = {
          carRunCur: rp ? String(rp.name) : String((st && st.p1) || '跑者'),
          carRunCurTag: rp && rp.custom ? '指定' : '預設跑者', carRunCurFg: rp && rp.custom ? 'var(--accent-deep)' : 'var(--ink)',
          carRunName: s.carRunName || '', carRunChain: chain,
          carRunChainTxt: !chain ? '只改 ' + this.carSlot(p.hour) + ' 這一個時段'
            : hs.length > 1 ? '會一起改 ' + this.carRunSpan(hs) + '（' + hs.length + ' 個連續的開班時段）' : '後面沒有連著的開班時段，只會改 ' + this.carSlot(p.hour),
          carRunSetBtn: s.carActBusy ? '處理中…' : '指定',
          carRunDflt: '預設跑者：' + String((st && st.p1) || '跑者'),
        };
      }
      pv = Object.assign(rv, {
        carPopShow: !!(row && (p.kind === 'empty' || isRun || seat)) && (p.kind !== 'tag' || !!t) && (!isRun || (runEdit && !pxd)),
        carPopIsRun: isRun,
        carPopL: Math.round(left) + 'px', carPopT: Math.round(top) + 'px',
        carPopAdminPick: admin && (p.kind === 'empty' || p.kind === 'seat') && !pxd, carPickTitle: p.kind === 'empty' ? '排人進這個座位' : '換成別人',
        carPopWhere: where,
        carPopIsTag: p.kind === 'tag', carPopIsSeat: p.kind === 'seat', carPopIsEmpty: p.kind === 'empty', carPopIsAdd: p.kind === 'addtag',
        carPopName: String((seat && seat.name) || ''),
        carPopBonus: seat && seat.name ? ((seat.role === 's6' ? 'S6 · ' : '推手 · ') + '倍率 ' + (fmt(seat.bonus) || '—') + (admin && pxd ? ' · 跨日時段只能貼標記' : '')) : '',
        carPopTagLabel: t ? String(t.label || '') : '', carPopTagBg: tc ? tc.bg : '', carPopTagFg: tc ? tc.fg : '',
        carPopTagScope: t ? (t.scope === 'member' ? ('這個人長期' + (t.until ? '（至 ' + t.until + '）' : '')) : '只這一班') : '',
        carPopTagDetail: t ? (String(t.detail || '') || '（沒有細節）') : '',
        carPopTagBy: t && admin && t.by ? '由 ' + String(t.by) + ' 標記' + (t.vis === 'admin' ? ' · 僅管理員可見' : '') : '',
        carPopSeatTags: tags.map((x, i) => { const c = this.carTagStyle(x.color); return { i: String(i), label: String(x.label || ''), bg: c.bg, fg: c.fg, h: p.hour, pos: p.pos, d: p.date }; }),
        carPopHasTags: tags.length > 0,
        carPopAdmin: admin, carPopMember: !admin,
        carPopCanTag: admin && !!(seat && seat.fp),
        carPopMine: !admin && !!(my && my.seat === p.pos) && !pxd,
        carPopCanSign: !admin && p.kind === 'empty' && !(row && row.locked) && !my && !pxd,
        carPopLockedTxt: !admin && p.kind === 'empty' ? (pxd ? '跨日時段已過日期，不能報班。' : (row && row.locked) ? '這個時段已鎖班，暫時不能報。' : (my ? '你已經在這個時段了（' + (my.seat ? my.seat.toUpperCase() : my.waitlist ? '候補' : '待確認') + '）。' : '報班後由管理員確認（車隊開了自動確認就會直接依倍率排位）；想排 S6 請選「報 S6」。')) : '',
        carPopH: p.hour, carPopD: p.date, carPopPos: p.pos,
        carPick: s.carPick || '', carPickRole: s.carPickRole || '',
        carMemOpts: mem.slice(0, 300).map(m => ({ v: m.name, n: m.name + (m.bonus ? ' · ' + fmt(m.bonus) : '') + (m.s6 ? ' · S6 ' + fmt(m.s6) : '') })),
        carPlaceBtn: s.carActBusy ? '處理中…' : (p.kind === 'empty' ? '排入' : '換人'),
        carTagChips: palChips.map(x => Object.assign({}, x, { bd: s.carTagSel === x.id ? 'var(--ink)' : 'transparent' })),
        carTagScopeChips: [['shift', '只這一班'], ['member', '這個人長期']].map(([v, n]) => Object.assign({ v, n }, pill((s.carTagScope || 'shift') === v))),
        carTagIsMember: s.carTagScope === 'member',
        carTagDetail: s.carTagDetail || '', carTagUntil: s.carTagUntil || '', carTagMin: today,
        carTagPutBtn: s.carActBusy ? '處理中…' : '貼上',
      });
    }

    /* 標籤盤管理視窗 */
    const tmOpen = !!s.carTagMgr && admin;
    const tmv = tmOpen ? {
      carTmList: palChips.map(x => Object.assign({}, x, { on: s.carTmId === x.id, bd: s.carTmId === x.id ? 'var(--ink)' : 'transparent', vis: x.adm ? '僅管理員' : '全員可見' })),
      carTmForm: !!s.carTmForm, carTmIsEdit: !!s.carTmId,
      carTmLabel: s.carTmLabel || '', carTmColor: this.CAR_HEX.test(String(s.carTmColor || '')) ? s.carTmColor : '#8b90b5',
      carTmDetail: s.carTmDetail || '', carTmVis: s.carTmVis === 'admin' ? 'admin' : 'all',
      carTmColors: ((s.carTags && s.carTags.colors) || []).map(c => ({ v: c, bd: String(s.carTmColor).toLowerCase() === String(c).toLowerCase() ? 'var(--ink)' : 'transparent' })),
      carTmPrevBg: this.carTagStyle(s.carTmColor).bg, carTmPrevFg: this.carTagStyle(s.carTmColor).fg,
      carTmPrev: String(s.carTmLabel || '').trim() || '預覽',
      carTmSaveBtn: s.carActBusy ? '處理中…' : (s.carTmId ? '儲存變更' : '新增標籤'),
      carTmCanAdd: pal.length < 30,
    } : {};

    /* 子分頁：只算目前分頁的值（carSecVals_<id>）；分頁程式出錯只影響該分頁 */
    const secAdm = fullAdmin || !!(gd && gd.role === 'admin');   // 設定／紀錄／系統分頁只給管理員（排班身份組沒有）
    const secTabs = this.CAR_TABS.filter(t => !t[2] || secAdm);
    const secTab = secTabs.some(t => t[0] === s.carTab) ? s.carTab : 'sched';
    const secIs = {}; secTabs.forEach(t => { secIs[t[0]] = t[0] === secTab; });
    let secV = {};
    const secFn = this['carSecVals_' + secTab];
    if (gd && typeof secFn === 'function') {
      try { secV = secFn.call(this, { s, gd, st, carNo, admin: secAdm, segOn, pill }) || {}; }
      catch (e) { console.error('carSecVals_' + secTab, e); secV = {}; }
    }
    const secOut = { carSecTabs: secTabs.map(([v, n]) => Object.assign({ v, n, sel: v === secTab ? 'true' : 'false' }, segOn(v === secTab))), carTabIs: secIs, carTabCur: secTab };

    const carErrNo = (s.carStErr || {})[carNo] || '';
    return Object.assign(out, {
      carLoading: me === undefined || (!!me && cm === undefined && !s.carNeed && !s.carErr),
      carNeedId: !!me && s.carNeed === 'identity',
      carIdDiscordUrl: api + '/auth/discord?r=' + encodeURIComponent('/app.html?page=car'),
      carLogoutUrl: api + '/auth/logout?r=' + encodeURIComponent('/app.html?page=car'),   // 登出後留在車隊頁（顯示登入卡）
      carErr: (!!me && !s.carNeed && s.carErr) ? s.carErr : '',
      carNoGuild: !!cm && !guilds.length,
      carReady: !!cm && !!gd,
      carCtx: gd ? (String(gd.name || '車隊') + ' · ' + (roleTxt[(st && st.role) || gd.role] || '成員') + (via ? ' · ' + via + ' 已登入' : '')
        + (teamKnown && !admin ? ' · ' + (teamOn ? '車隊模式' : '私車模式') : '')) : '',      // 成員沒有開關：這一行最後面寫目前的模式（手機上這行會被截斷，工具列右邊另外再寫一次，見 carModeTxt）
      /* 私車／車隊開關（管理員，班表分頁的工具列）；onCarMode 在下面的事件表 */
      carModeShow: fullAdmin && teamKnown,          // 私車／車隊是設定，排班身份組不能切
      carModeSeg: [['solo', '私車'], ['team', '車隊']].map(([v, n]) => Object.assign({ v, n, sel: (teamOn ? 'team' : 'solo') === v ? 'true' : 'false' }, segOn((teamOn ? 'team' : 'solo') === v))),
      carModeNote: '私車＝整隊固定一位跑者；車隊＝每個時段可以各自指定跑者（從成員池挑或直接打名字）。'
        + (selfKnown && teamOn ? (selfOn ? '已開放跑者自行報跑：登記過跑者倍率的成員可以自己開班（Discord r20-24、QQ /r 20-24、網頁「我來開車」）。' : '想讓跑者自己開班，打開右邊的「跑者自行報跑」。') : ''),
      carRsAdmShow: fullAdmin && selfKnown && teamOn,
      carRsAdmTxt: '跑者自行報跑：' + (selfOn ? '開' : '關'), carRsAdmV: selfOn ? '0' : '1', carRsAdmPressed: selfOn ? 'true' : 'false',
      carRsAdmBg: selfOn ? 'color-mix(in oklab,var(--accent) 14%,var(--card))' : 'var(--card-2)', carRsAdmFg: selfOn ? 'var(--accent-deep)' : 'var(--text-2)',
      carRsAdmBd: selfOn ? 'color-mix(in oklab,var(--accent) 45%,var(--border))' : 'var(--border)',
      carRsToolShow: runSelf, carRsHours: s.carRsHours || '',
      carRsToolNote: '在下面選的日期開班，跑者就是你；跨午夜寫 22-26。已經開班、還沒有人開車的時段，直接按那一列的「我來開車」。',
      carRsHintShow: !admin && selfOn && !meRunner && !xd,
      carRsHint: '這個車隊開放跑者自行報跑。想開車先登記跑者倍率：Discord 打 %名字 r3.40，QQ 打 /登记 名字 r3.40，登記完重新整理就會出現「我來開車」。',
      /* 成員：工具列右邊再寫一次目前的模式（手機上最上面那一行會被截斷，看不到最後面的模式） */
      carModeTxt: teamKnown && !fullAdmin ? (teamOn ? '車隊模式' : '私車模式') : '',
      carModeTip: teamOn ? '車隊模式：每個時段可以各自指定跑者' : '私車模式：整隊固定一位跑者',
      /* 切換車隊：不用原生 <select>（macOS 深色下原生選單會畫成一顆看不到名字的鈕），改成自己畫的清單 */
      carGuildList: guilds.map(x => { const on = String(x.gid) === String(s.g || ''); return { v: String(x.gid), n: String(x.name || x.gid), role: roleTxt[x.role] || '成員', on: on ? 'true' : 'false',
        bg: on ? 'color-mix(in oklab,var(--accent) 14%,var(--card))' : 'transparent', fg: on ? 'var(--ink)' : 'var(--text-2)', rc: on ? 'var(--accent-deep)' : 'var(--text-3)' }; }),
      carGuildOpen: guilds.length > 1 && !!s.carGuildOpen, carGuildArrow: s.carGuildOpen ? '▴' : '▾', carMultiGuild: guilds.length > 1,
      carCarTabs: carTabs, carMultiCar: cars.length > 1,
      carViewTabs: [['table', '表格'], ['board', '看板']].map(([v, n]) => Object.assign({ v, n }, segOn((s.carView || 'table') === v))),
      carIsTable: (s.carView || 'table') !== 'board', carIsBoard: s.carView === 'board',
      carIsAdmin: admin,
      carTagMgrBtn: fullAdmin,                      // 標籤盤是設定類，排班身份組不能改（carTagMgrShow 是彈窗開關，別撞名）
      carOpenBtn: open ? '停止報班' : '開放報班', carOpenBg: open ? 'var(--card-2)' : 'var(--ink-grad)', carOpenFg: open ? 'var(--text-2)' : '#fff', carOpenBd: open ? 'var(--border)' : 'transparent',
      carLockBtn: allLocked ? '解鎖全天' : '鎖班', carLockV: allLocked ? '0' : '1', carLockShow: admin && !!day && !xd,
      carDates: dates, carHasDates: dates.length > 0,
      carStLoading: !st && !carErrNo, carStErr: carErrNo,
      carNoRows: !!st && rows.length === 0,
      carNoRowsTxt: (day ? '這一天' : '這幾天') + (admin ? '還沒有開班的時段。用下方「排班工具」的開班，選日期、填時段（例如 20-22）就能開。'
        : '還沒有開班的時段，管理員開班後這裡就會出現。'),
      carDayTitle: (curCar.name || '') + (day ? ' · ' + this.carDayLabel(day.date, today, day.xday).replace(/^(今天|明天) /, '') : ''),
      carStatShow: rows.length > 0,
      carStatusShow: open !== null || allLocked,
      carStatusTxt: allLocked ? '已鎖班' : (open ? '報班開放中' : '報班已關閉'),
      carStatusBg: allLocked ? 'color-mix(in oklab,#ee6644 15%,var(--card))' : open ? 'color-mix(in oklab,#2f9e57 15%,var(--card))' : 'var(--card-2)',
      carStatusFg: allLocked ? 'color-mix(in oklab,#ee6644 55%,var(--car-fg))' : open ? 'color-mix(in oklab,#2f9e57 55%,var(--car-fg))' : 'var(--text-3)',
      carAvg: bon.length ? (bon.reduce((a, b) => a + b, 0) / bon.length).toFixed(2) : '—', carMiss: String(miss),
      carRows: rows,
      carMine: myList.map(x => ({ t: x.c + ' · ' + dayShort(x.d) + ' ' + pad(x.a) + '-' + pad(x.b), v: x.v })),
      carMineEmpty: !myList.length,
      carMineTxt: admin && !(st && st.me) ? '管理員畫面不列出自己的班，請看左邊的表格。' : '這幾天還沒有你的班。',
      carPal: palChips, carHasPal: palChips.length > 0,
      carPalNote: admin ? '點名字旁的 ＋ 貼標記；可選「只這一班」或「這個人長期」。標籤盤裡設成「僅管理員」的標記，成員看不到。' : '管理員貼在座位上的標記；點標記可以看細節。',
      carTagMgrShow: tmOpen,
      carBusyTxt: s.carBusy ? '更新中…' : '重新整理',
    }, pv, tmv, secOut, secV);
  },
  };
}
