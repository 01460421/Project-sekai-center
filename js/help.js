/* ---------- 線上客服（右下角的對話窗） ----------
   三個分頁共用一個視窗：
   - 小幫手：站內即時回答，不花額度、不用登入。先看是不是在問「現在」的事（當期活動、榜線、卡池、日服、語言），
     再到功能別名表（ALIASES，五百多條玩家用語）、頁面說明與教學大全裡找，給答案和「前往」按鈕；沒把握就說沒把握，
     把問題交給 AI 助手或站長，不硬湊。
   - AI 助手：就是站內助手（js/ai.js 的 aiSend），對話與 /assistant 頁同一份 aiMsgs，「展開」直接接著聊。
   - 留言：給站長的私訊（提問所的 kind=support，只有本人與管理員看得到），站長回覆會出現在這裡並亮紅點；
     視窗開著時每 15 秒重抓一次，關著時每 90 秒看一次有沒有新回覆。
   這個檔案延後載入：開站閒下來時預載，app.js 的 loadHelp() 用 Object.assign(app, helpMembers.call(app)) 掛上。 */

const BOT_KEY = 'sekai-hp-bot', SEEN_KEY = 'sekai-hp-seen', TIP_KEY = 'sekai-hp-tip';
const CATS = [['idea', '功能建議'], ['bug', '問題回報'], ['data', '資料有誤'], ['other', '其他']];
const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* 正規化：全形轉半形、大小寫、去掉空白與常見標點（玩家打字不會照正式名稱打） */
export function hpNorm(t) {
  return String(t == null ? '' : t)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[\s・･·．.,，、!！?？~〜\-_'"「」『』（）()[\]：:;；/／]/g, '')
    .toLowerCase();
}
/* 比對分數：整段包含最高；否則用雙字組重疊（中文沒有空白，雙字組是最便宜又穩的切法） */
const FILLER = /請問|请问|想問|想问|我想知道|想知道|我想要|我想|我要|幫我|帮我|可以|怎麼|怎么|如何|哪裡|哪里|在哪|嗎|吗|呢|啊|吧|一下/g;
export function hpScore(q, key) {
  const a = hpNorm(q).replace(FILLER, '') || hpNorm(q), b = hpNorm(key);
  if (!a || !b) return 0;
  if (a === b) return 3;
  if (b.length >= 2 && a.includes(b)) return 1.6 + Math.min(1, b.length / 8);
  if (a.length >= 2 && b.includes(a)) return 1.3 + Math.min(1, a.length / 8);
  const gram = s => { const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
  const ga = gram(a), gb = gram(b);
  if (!ga.size || !gb.size) return 0;
  let n = 0; ga.forEach(x => { if (gb.has(x)) n++; });
  return n ? n / Math.sqrt(ga.size * gb.size) : 0;
}
/* 'calc（ctab=eff）'、'calc（ctab=gacha）／gachasim'、'dolls／deckpro' → { page, patch } */
export function hpTarget(t) {
  const first = String(t || '').split('／')[0];
  const m = first.match(/^([a-z_]+)(?:（([^）]*)）)?/i);
  if (!m) return null;
  const patch = {};
  (m[2] || '').split(/[，,]/).forEach(kv => { const p = kv.split('='); if (p.length === 2 && /^[a-zA-Z]+$/.test(p[0].trim())) patch[p[0].trim()] = p[1].trim(); });
  return { page: m[1], patch };
}

export function helpMembers() {
  return {
  hpInit() {
    let msgs = [];
    try { msgs = JSON.parse(sessionStorage.getItem(BOT_KEY) || '[]'); } catch (e) {}
    let seen = {};
    try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {}; } catch (e) {}
    this._hpSeen = seen;
    this.setState({ hpMsgs: Array.isArray(msgs) ? msgs.slice(-60) : [] });
    clearInterval(this._hpPoll);
    this._hpPoll = setInterval(() => this.hpPollTick(), 15000);
    setTimeout(() => this.hpLoadThreads(true), 1500);
  },

  /* ---------- 開關 ---------- */
  hpToggle(open) {
    const want = open === undefined ? !this.state.hpOpen : !!open;
    if (want) {
      try { localStorage.setItem(TIP_KEY, '1'); } catch (e) {}
      const tab = this.state.hpTab || 'bot';
      this.setState({ hpOpen: true, hpClosing: false, hpTip: false, hpTab: tab });
      if (!(this.state.hpMsgs || []).length) this.hpGreet();
      if (tab === 'msg') this.hpLoadThreads();
      if (tab === 'ai' && this.state.me && this.state.me.status === 'approved') this.loadAi().catch(() => {});
      this.hpScroll(true);
      setTimeout(() => { try { const el = document.querySelector('.hp-input'); if (el && !this.state.mobile) el.focus(); } catch (e) {} }, 320);
      return;
    }
    if (!this.state.hpOpen) return;
    this.setState({ hpClosing: true });
    clearTimeout(this._hpCloseT);
    this._hpCloseT = setTimeout(() => this.setState({ hpOpen: false, hpClosing: false }), 230);
  },
  hpSetTab(t) {
    if (!['bot', 'ai', 'msg'].includes(t)) return;
    this.setState({ hpTab: t });
    if (t === 'msg') this.hpLoadThreads();
    if (t === 'ai' && this.state.me && this.state.me.status === 'approved') this.loadAi().catch(() => {});
    this.hpScroll(true);
  },
  /* 新訊息進來時捲到底；使用者自己往上捲在看舊訊息時不打擾（離底部超過 120px 就不捲） */
  hpScroll(force) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.querySelector('.hp-body');
      if (!el) return;
      if (force || el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTo({ top: el.scrollHeight, behavior: force ? 'auto' : 'smooth' });
    }));
  },

  /* ---------- 小幫手 ---------- */
  hpPush(m) {
    const msgs = (this.state.hpMsgs || []).concat([Object.assign({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), at: Date.now() }, m)]).slice(-60);
    this.setState({ hpMsgs: msgs });
    try { sessionStorage.setItem(BOT_KEY, JSON.stringify(msgs)); } catch (e) {}
    this.hpScroll();
  },
  /* 模擬打字：字越多等越久，但最多 1.3 秒 —— 夠像人在回，又不會讓人覺得慢 */
  hpReply(m) {
    const len = String(m.text || '').length;
    const wait = Math.max(420, Math.min(1300, 320 + len * 11));
    this.setState({ hpTyping: true });
    this.hpScroll();
    clearTimeout(this._hpTypeT);
    this._hpTypeT = setTimeout(() => { this.setState({ hpTyping: false }); this.hpPush(Object.assign({ who: 'bot' }, m)); }, wait);
  },
  hpGreet() {
    const h = new Date().getHours();
    const hi = h < 5 ? '夜深了，辛苦了' : h < 11 ? '早安' : h < 14 ? '午安' : h < 18 ? '下午好' : '晚上好';
    const P = this.PAGES[this.state.page] || this.PAGES.home;
    const me = this.state.me;
    const name = me && me.name ? '，' + me.name : '';
    const where = this.state.page && this.state.page !== 'home' ? '你現在在「' + P[0] + '」。' : '';
    this.hpPush({ who: 'bot', text: hi + name + '！我是 SEKAI 小幫手。' + where + '\n想找功能、查現在的活動與榜線、或不知道從哪裡開始，直接打字問我；要算東西、做規劃可以交給 AI 助手，想跟站長說的話可以到「留言」。',
      acts: this.hpCtxActs() });
  },
  /* 依目前頁面給幾個常見的問題 */
  hpCtxActs() {
    const p = this.state.page, jp = this.SRV === 'jp';
    const by = {
      rank: [['現在 T100 多少', 'ask'], ['榜線預測怎麼看', 'ask']], home: [['現在的活動', 'ask'], ['現在 T1000 多少', 'ask']],
      calc: [['跑哪首歌最快', 'ask'], ['活動P怎麼算', 'ask']], cards: [['怎麼篩選卡片', 'ask'], ['收集率在哪裡', 'ask']],
      haruki: [['怎麼匯入 Haruki 資料', 'ask'], ['組卡推薦怎麼用', 'ask']], gacha: [['現在有哪些卡池', 'ask'], ['抽卡天井', 'ask']],
      account: [['帳號審核要多久', 'ask'], ['AI 助手怎麼用', 'ask']], jpnow: [['日服現在的活動', 'ask'], ['日服 T100', 'ask']],
    };
    const base = (by[p] || by.home).map(([l, k]) => ({ l, k, a: l }));
    return base.concat([{ l: jp ? '切回台服' : '切到日服', k: 'srv', a: jp ? 'tw' : 'jp' }, { l: '我要給建議／回報問題', k: 'tab', a: 'msg' }]);
  },
  hpIndex() {
    if (this._hpIdx && this._hpIdxN === (this.state.tutQA || []).length) return this._hpIdx;
    const idx = [];
    (this.ALIASES || []).forEach(r => {
      const tg = hpTarget(r[2]);
      if (!tg || !this.PAGES[tg.page]) return;
      idx.push({ kind: 'feat', title: String(r[0]).replace(/（[^）]*sort_by[^）]*）/, ''), page: tg.page, patch: tg.patch, keys: [r[0]].concat(String(r[3] || '').split('|').filter(Boolean)) });
    });
    Object.keys(this.PAGES).forEach(k => {
      if (/^hub/.test(k)) return;
      const P = this.PAGES[k];
      idx.push({ kind: 'page', title: P[0], sub: P[1], page: k, patch: {}, keys: [P[0], P[1]] });
    });
    (this.state.tutQA || []).forEach((t, i) => {
      const txt = String(t.a || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      idx.push({ kind: 'tut', title: t.q, text: txt, i, keys: [t.q] });
    });
    this._hpIdx = idx; this._hpIdxN = (this.state.tutQA || []).length;
    return idx;
  },
  hpSearch(q) {
    const idx = this.hpIndex();
    const scored = [];
    for (const e of idx) {
      let best = 0;
      for (const k of e.keys) { const v = hpScore(q, k); if (v > best) best = v; if (best >= 3) break; }
      if (e.kind === 'page' && e.sub) best = Math.max(best, hpScore(q, e.sub) * 0.7);
      if (best >= 0.34) scored.push([best, e]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    const feats = [], seen = new Set();
    for (const [v, e] of scored) {
      if (e.kind === 'tut') continue;
      const key = e.page + JSON.stringify(e.patch);
      if (seen.has(key)) continue;
      seen.add(key);
      feats.push({ v, e });
      if (feats.length >= 3) break;
    }
    const tut = scored.find(([, e]) => e.kind === 'tut');
    return { feats, tut: tut ? { v: tut[0], e: tut[1] } : null, top: scored.length ? scored[0][0] : 0 };
  },
  /* 「現在」的事：當期活動、榜線、卡池、日服、語言、帳號與額度 */
  hpIntent(q) {
    const n = hpNorm(q), jp = this.SRV === 'jp' || /日服|日版|日本/.test(q);
    const pad = v => String(v).padStart(2, '0');
    const fdt = t => { const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
    if (/^(hi|hello|hey|嗨|哈囉|哈啰|你好|您好|安安|在嗎|在吗)/.test(n)) return { text: '嗨！想找什麼都可以直接問我，例如「現在 T1000 多少」「跑哪首最快」「怎麼匯入 Haruki」。', acts: this.hpCtxActs() };
    if (/謝謝|感謝|謝啦|thx|thanks|3q|感恩/.test(n)) return { text: '不客氣！還有其他想問的隨時找我。', acts: [] };
    if (/簡體|简体|簡中|简中|english|英文|日文|日本語|日本语|語言|语言|繁體|繁中/.test(n)) {
      return { text: '介面語言可以在右上角的「伺服器・語言」切換，也可以直接按下面：簡體中文是整站轉換；英文與日文目前翻譯介面與主要頁面。',
        acts: [['繁體中文', 'zh-TW'], ['简体中文', 'zh-CN'], ['English', 'en'], ['日本語', 'ja']].map(([l, a]) => ({ l, k: 'lang', a })) };
    }
    if (/客服|回報|回报|建議|建议|bug|錯誤|错误|壞掉|坏掉|故障|意見|意见|反映|站長|站长|聯絡|联络|聯繫|联系/.test(n)) {
      return { text: '收到！到「留言」分頁寫給站長，選個分類、描述一下狀況就好（附上你在哪一頁、看到什麼，會更快處理）。站長回覆會出現在這個視窗並亮紅點。', acts: [{ l: '寫留言給站長', k: 'tab', a: 'msg' }] };
    }
    if (/審核|审核|核准|帳號|账号|登入|登录|註冊|注册/.test(n)) {
      const me = this.state.me;
      const st = !me ? '你目前沒有登入。' : me.status === 'approved' ? '你的帳號已核准，站上功能都能用。' : me.status === 'pending' ? '你的帳號正在等管理員核准，通常一天內會處理；等不及可以到「留言」問站長。' : '你的帳號目前不能使用需要核准的功能，有疑問請到「留言」問站長。';
      return { text: st + '\n登入用 Google 或 Discord；登入後設定與持卡會雲端同步，核准後可以用偵測訂閱與 AI 助手。', acts: [{ l: '我的帳號', k: 'go', a: 'account' }].concat(me ? [{ l: '問站長', k: 'tab', a: 'msg' }] : this.hpLoginActs()) };
    }
    if (/^(ai|助手|額度|额度)|ai助手|ai額度|問ai|问ai/.test(n)) {
      return { text: 'AI 助手會自己查站上的資料（榜線、卡池、你的卡、教學）再回答，也能做多步驟規劃。要登入且帳號核准，每天 20 次，台灣時間 00:00 重置。', acts: [{ l: '打開 AI 助手', k: 'tab', a: 'ai' }] };
    }
    if (/切到日服|切換日服|切换日服|日服模式|看日服|切回台服|台服模式/.test(n)) {
      const toJp = !/台服/.test(n);
      return { text: toJp ? '切到日服後，首頁會變成日服現況，排名、卡片與圖鑑改用日服資料；只有台服資料的頁面會在上方提示。' : '切回台服會重新載入頁面。', acts: [{ l: toJp ? '切到日服' : '切回台服', k: 'srv', a: toJp ? 'jp' : 'tw' }].concat(toJp ? [{ l: '只看日服現況', k: 'go', a: 'jpnow' }] : []) };
    }
    const tier = (() => { const m = n.match(/t(\d{1,6})|前(\d{1,6})名?|(\d{1,6})名/); return m ? +(m[1] || m[2] || m[3]) : (/前百/.test(n) ? 100 : 0); })();
    if (tier || /榜線|榜线|線多少|线多少|分數線|分数线|排名|名次/.test(n)) {
      const s = this.state;
      const brd = jp ? (this.SRV === 'jp' ? s.borders : s.jnBrd) : s.borders, top = jp ? (this.SRV === 'jp' ? s.live : s.jnLive) : s.live;
      if (jp && this.SRV !== 'jp' && !s.jnLive) { this.loadJpNow(); }
      const rows = this.bordersOf(brd), tops = this.ranksOf(top);
      const pick = r => (r <= 100 ? tops.find(x => x.rank === r) : null) || rows.find(x => x.rank === r);
      const want = tier ? [tier] : [100, 1000, 5000, 10000];
      const got = want.map(r => [r, pick(r)]).filter(x => x[1] && x[1].score != null);
      const ev = this.eventOf(top || brd || {});
      if (!got.length) return { text: (tier ? 'T' + tier + ' ' : '') + '的即時資料我這邊還沒拿到（或那個名次沒有公開的線）。到排名頁看最新的：', acts: [{ l: '活動排名', k: 'go', a: 'rank' }, { l: '榜線預測', k: 'go', a: 'analysis' }] };
      return { text: (jp ? '日服' : '台服') + (ev.name ? '「' + ev.name + '」' : '當期') + '現在的分數線：\n' + got.map(([r, x]) => 'T' + this.n(r) + '　' + this.n(x.score)).join('\n') + '\n要看走勢、時速和終線預測，往下點：',
        acts: [{ l: '活動排名', k: 'go', a: 'rank' }].concat(jp ? [{ l: '日服現況', k: 'go', a: 'jpnow' }] : [{ l: '榜線預測', k: 'go', a: 'analysis' }]) };
    }
    if (/現在.*活動|现在.*活动|當期|当期|這期|这期|本期|活動.*(結束|结束|倒數|倒数|剩)|倒數|倒数|還剩|还剩|什麼活動|什么活动/.test(n)) {
      if (jp) {
        const D = this.state.jpNow;
        if (!D) { this.loadJpNow(); return { text: '日服資料正在載入，稍等一下再問我一次，或直接看日服現況：', acts: [{ l: '日服現況', k: 'go', a: 'jpnow' }] }; }
        const now = Date.now(), cur = (D.events || []).filter(e => e[4] <= now && now < e[6]).sort((a, b) => b[4] - a[4])[0];
        if (!cur) return { text: '日服現在是活動之間的空檔。', acts: [{ l: '日服現況', k: 'go', a: 'jpnow' }] };
        return { text: '日服第 ' + cur[0] + ' 期「' + cur[1] + '」' + (now < cur[5] ? '進行中，' + fdt(cur[5]) + ' 結算（還有 ' + this.dur(cur[5] - now) + '）。' : '已結算，等待公布結果。'), acts: [{ l: '日服現況', k: 'go', a: 'jpnow' }, { l: '日服排名', k: 'go', a: 'rank' }] };
      }
      const ck = this.eventClock(), ev = this.eventOf(this.state.live);
      if (!ck || !ev.name) return { text: '當期活動的資料還在載入，或現在是活動之間的空檔。', acts: [{ l: '活動總覽', k: 'go', a: 'event' }] };
      return { text: '台服第 ' + ev.id + ' 期「' + ev.name + '」' + (ck.leftH > 0 ? '進行中，' + fdt(ck.en) + ' 結算，還有 ' + this.dur(ck.en - Date.now()) + '（進度 ' + Math.round(ck.frac * 100) + '%）。' : '已結算。'),
        acts: [{ l: '活動總覽', k: 'go', a: 'event' }, { l: '活動排名', k: 'go', a: 'rank' }, { l: '這期的活動資料', k: 'go', a: 'evinfo' }] };
    }
    if (/(現在|现在|目前|開放|开放|有哪些).*(卡池|池)|卡池.*(現在|现在|開放|开放|有哪些)|^卡池$/.test(n)) {
      if (jp) return { text: '日服開放中的卡池在日服現況頁（含 PU 卡）。', acts: [{ l: '日服現況', k: 'go', a: 'jpnow' }] };
      const t = new Date(), ymd = t.getFullYear() + '/' + pad(t.getMonth() + 1) + '/' + pad(t.getDate());
      const open = (this.state.gachas || []).filter(g => g.s <= ymd && ymd <= g.e && !/常駐/.test(g.t || '')).slice(0, 6);
      if (!open.length) return { text: '卡池資料還在載入，直接看卡池列表：', acts: [{ l: '卡池列表', k: 'go', a: 'gacha' }] };
      return { text: '台服現在開放的卡池（預測時間）：\n' + open.map(g => '・' + g.n + '（到 ' + g.e.slice(5) + '）').join('\n'), acts: [{ l: '卡池列表', k: 'go', a: 'gacha' }, { l: '抽卡模擬', k: 'go', a: 'gachasim' }] };
    }
    return null;
  },
  hpLoginActs() {
    const back = '/app.html?page=' + (this.state.page || 'home') + (this.SRV === 'jp' ? '&srv=jp' : '');
    return [{ l: '用 Google 登入', k: 'url', a: this.GAMES_API + '/auth/google?r=' + encodeURIComponent(back) },
            { l: '用 Discord 登入', k: 'url', a: this.GAMES_API + '/auth/discord?r=' + encodeURIComponent(back) }];
  },
  hpAnswer(q) {
    const it = this.hpIntent(q);
    if (it) return it;
    const r = this.hpSearch(q);
    const acts = r.feats.map(({ e }) => ({ l: e.title.length > 22 ? (this.PAGES[e.page] || [e.title])[0] : e.title, k: 'go', a: e.page + (Object.keys(e.patch || {}).length ? '|' + JSON.stringify(e.patch) : '') }));
    const sure = r.top >= 1.2;
    const me = this.state.me, aiOk = !!(me && me.status === 'approved');
    if (r.tut && r.tut.v >= 1.1) {
      const t = r.tut.e, txt = t.text.length > 150 ? t.text.slice(0, 150) + '…' : t.text;
      return { text: '教學大全裡有一則「' + t.title + '」：\n' + txt, acts: [{ l: '看完整教學', k: 'tut', a: String(t.i) }].concat(acts.slice(0, 2)) };
    }
    if (acts.length && sure) {
      const f = r.feats[0].e;
      return { text: '你要找的應該是「' + (this.PAGES[f.page] || [f.title])[0] + '」' + (f.kind === 'feat' && f.title !== (this.PAGES[f.page] || [])[0] ? '裡的「' + f.title + '」' : '') + '。' + (acts.length > 1 ? '也可能是下面這幾個：' : ''), acts };
    }
    if (acts.length) return { text: '我不太確定你要的是哪一個，最接近的是這幾個：', acts: acts.concat(aiOk ? [{ l: '交給 AI 助手回答', k: 'ai', a: q }] : []) };
    return { text: '這題我答不出來' + (aiOk ? '，交給 AI 助手吧：它會自己查站上的資料。' : '。登入並通過審核後可以問 AI 助手；或是留言給站長。'),
      acts: (aiOk ? [{ l: '交給 AI 助手回答', k: 'ai', a: q }] : (me ? [] : this.hpLoginActs())).concat([{ l: '留言給站長', k: 'tab', a: 'msg' }]) };
  },
  hpAsk(text) {
    const q = String(text || '').trim();
    if (!q) return;
    this.hpPush({ who: 'me', text: q });
    this.setState({ hpText: '' });
    let ans;
    try { ans = this.hpAnswer(q); } catch (e) { ans = { text: '我這邊出了點狀況，再問一次看看？', acts: [] }; }
    this.hpReply(ans);
  },
  hpAct(k, a, label) {
    if (k === 'ask') { this.hpAsk(a); return; }
    if (k === 'go') {
      const [page, pj] = String(a).split('|');
      let patch = {}; try { patch = pj ? JSON.parse(pj) : {}; } catch (e) {}
      this.go(page);
      if (Object.keys(patch).length) this.setState(patch);
      if (this.state.mobile) this.hpToggle(false);
      return;
    }
    if (k === 'tut') {
      const t = (this.state.tutQA || [])[+a];
      this.go('tut');
      if (t) this.setState({ tq: t.q, tcat: 'all', tOpen: { [t.cat + '::' + t.q]: 1 } });
      if (this.state.mobile) this.hpToggle(false);
      return;
    }
    if (k === 'srv') { this.setSrv(a); return; }
    if (k === 'lang') { this.setLang(a); this.hpReply({ text: a === 'zh-TW' ? '換回繁體中文了。' : '好了，換過去了。想再換可以按右上角的「伺服器・語言」。' }); return; }
    if (k === 'tab') { this.hpSetTab(a); return; }
    if (k === 'ai') { this.hpSetTab('ai'); this.hpAiSend(a); return; }
    if (k === 'url') { location.href = a; return; }
    if (k === 'cat') { this.setState({ hpNewCat: a }); setTimeout(() => { try { const el = document.querySelector('.hp-input'); if (el) el.focus(); } catch (e) {} }, 60); return; }
    if (k === 'clear') { this.setState({ hpMsgs: [] }); try { sessionStorage.removeItem(BOT_KEY); } catch (e) {} this.hpGreet(); }
  },

  /* ---------- AI 助手（同一份 aiMsgs） ---------- */
  hpAiSend(text) {
    const q = String(text || '').trim();
    if (!q || this.state.admBusy) return;
    this.setState({ hpAiText: '' });
    this.loadAi().then(() => { this.aiSend(q); this.hpScroll(true); }).catch(() => {});
    this.hpScroll(true);
  },

  /* ---------- 留言給站長（kind=support） ---------- */
  async hpLoadThreads(quiet) {
    if (!this.state.me) { if (!quiet) this.setState({ hpThreads: [] }); return; }
    if (!quiet) this.setState({ hpThLoad: !this.state.hpThreads });
    try {
      const d = await this.api('/api/qa?kind=support');
      const list = (d && d.threads) || [];
      const unread = list.filter(t => (t.reply_count || 0) > ((this._hpSeen || {})[t.id] || 0)).length;
      this.setState({ hpThreads: list, hpThLoad: false, hpUnread: unread, hpIsAdmin: !!(d && d.is_admin) });
    } catch (e) { this.setState({ hpThLoad: false }); }
  },
  async hpOpenThread(id, quiet) {
    if (!quiet) this.setState({ hpThread: id, hpPosts: null, hpThInfo: null });
    try {
      const d = await this.api('/api/qa/' + encodeURIComponent(id));
      if (this.state.hpThread !== id) return;
      const posts = (d && d.posts) || [];
      const old = (this.state.hpPosts || []).length;
      this.setState({ hpPosts: posts, hpThInfo: d && d.thread, hpThCan: !!(d && d.can_post) });
      this._hpSeen = Object.assign({}, this._hpSeen, { [id]: (d && d.thread && d.thread.reply_count) || posts.length });
      try { localStorage.setItem(SEEN_KEY, JSON.stringify(this._hpSeen)); } catch (e) {}
      const unread = (this.state.hpThreads || []).filter(t => (t.reply_count || 0) > ((this._hpSeen || {})[t.id] || 0)).length;
      this.setState({ hpUnread: unread });
      if (!quiet || posts.length > old) this.hpScroll(!quiet);
    } catch (e) { if (!quiet) this.setState({ hpMsgErr: '讀取留言失敗，請稍後再試' }); }
  },
  async hpSendMsg() {
    const text = String(this.state.hpMsgText || '').trim();
    if (!text || this.state.hpSending) return;
    if (text.length < 2) { this.setState({ hpMsgErr: '多寫幾個字吧（至少 2 個字）' }); return; }
    this.setState({ hpSending: true, hpMsgErr: '' });
    try {
      const id = this.state.hpThread;
      let d;
      if (id) {
        d = await this.api('/api/qa/' + encodeURIComponent(id) + '/reply', { method: 'POST', body: { body: text } });
      } else {
        const cat = (CATS.find(c => c[0] === this.state.hpNewCat) || CATS[3])[1];
        const where = (this.PAGES[this.state.page] || [''])[0];
        const title = '【' + cat + '】' + text.replace(/\s+/g, ' ').slice(0, 40);
        const body = text + '\n\n——\n來自：' + where + (this.SRV === 'jp' ? '（日服模式）' : '') + '・' + (this.state.mobile ? '手機' : '電腦') + '・' + (navigator.language || '');
        d = await this.api('/api/qa', { method: 'POST', body: { kind: 'support', title, body } });
        if (d && d.id) this.setState({ hpThread: d.id });
      }
      if (d && (d.ok || d.id)) {
        this.setState({ hpMsgText: '', hpSending: false, hpNewCat: '', hpJustSent: Date.now() });
        await this.hpOpenThread(this.state.hpThread, false);
        this.hpLoadThreads(true);
      } else {
        this.setState({ hpSending: false, hpMsgErr: (d && (d.message || d.error)) || '送出失敗' });
      }
    } catch (e) {
      const code = (e && e.code) || '', why = (e && e.data && e.data.message) || '';
      this.setState({ hpSending: false, hpMsgErr: code === 'cooldown' ? '發文間隔至少 60 秒，稍等一下再送' : ('送出失敗：' + (why || (e && e.message) || '請稍後再試')) });
    }
  },
  /* 即時：視窗開著、在留言分頁看某一串 → 每 15 秒重抓；其他時候每 90 秒看一次列表（亮紅點用） */
  hpPollTick() {
    if (document.hidden || !this.state.me) return;
    const s = this.state;
    if (s.hpOpen && s.hpTab === 'msg' && s.hpThread) { this.hpOpenThread(s.hpThread, true); return; }
    this._hpPollN = (this._hpPollN || 0) + 1;
    if (this._hpPollN % 6 === 0 || (s.hpOpen && s.hpTab === 'msg')) this.hpLoadThreads(true);
  },

  /* ---------- 畫面 ---------- */
  hpVals(s) {
    const me = s.me, open = !!s.hpOpen, tab = s.hpTab || 'bot';
    const aiOk = !!(me && me.status === 'approved');
    const unread = s.hpUnread || 0;
    const mob = !!s.mobile;
    const fabBottom = mob ? (s.playerOn ? 'calc(150px + env(safe-area-inset-bottom,0px))' : 'calc(84px + env(safe-area-inset-bottom,0px))') : (s.playerOn ? '100px' : '22px');
    const tm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    const out = {
      hpFabBottom: fabBottom, hpOpen: open, hpPanel: open, hpAva: this.charaSd(21), hpScrimDisplay: mob ? 'block' : 'none', hpMobOpen: mob && open, hpState: s.hpClosing ? 'closing' : (open ? 'open' : 'closed'),
      hpBadgeOn: unread > 0 && !(open && tab === 'msg'), hpBadge: unread > 9 ? '9+' : String(unread),
      hpTipOn: !!s.hpTip && !open, hpTipText: s.hpTipText || '需要幫忙嗎？找功能、查榜線，問我就好',
      hpFabLabel: open ? '關閉線上客服' : '線上客服：小幫手、AI 助手與留言給站長',
      hpPanelBottom: mob ? '0px' : 'calc(' + fabBottom + ' + 70px)',
      hpStatus: tab === 'ai' ? (aiOk ? (s.admBusy ? 'AI 助手正在查資料…' : 'AI 助手待命中・會自己查站上的資料') : '登入並核准後可以使用') : tab === 'msg' ? '站長通常一天內回覆・回覆會亮紅點' : '即時回覆・不用登入、不花額度',
      hpTabs: [['bot', '小幫手'], ['ai', 'AI 助手'], ['msg', '留言']].map(([v, n]) => ({ v, n, on: tab === v, cls: tab === v ? 'on' : '', dot: v === 'msg' && unread > 0 && tab !== 'msg' })),
      hpTabX: ({ bot: '0%', ai: '100%', msg: '200%' })[tab],
      hpIsBot: tab === 'bot', hpIsAi: tab === 'ai', hpIsMsg: tab === 'msg',
      hpText: s.hpText || '', hpAiText: s.hpAiText || '', hpMsgText: s.hpMsgText || '',
      onHpClose: () => this.hpToggle(false),
      onHpTab: e => this.hpSetTab(e.currentTarget.dataset.v),
      onHpExpand: () => { this.go(tab === 'msg' && me && me.is_admin ? 'qa' : 'assistant'); if (tab === 'msg' && me && me.is_admin) this.setState({ qaKind: 'support' }); this.hpToggle(false); },
      onHpAct: e => { const d = e.currentTarget.dataset; this.hpAct(d.k, d.a, d.l); },
      onHpTipClose: e => { if (e) e.stopPropagation(); this.setState({ hpTip: false }); try { localStorage.setItem(TIP_KEY, '1'); } catch (er) {} },
    };
    if (!open) return out;

    /* 小幫手 */
    if (tab === 'bot') {
      out.hpBotMsgs = (s.hpMsgs || []).map((m, i, arr) => ({
        id: m.id, me: m.who === 'me', bot: m.who !== 'me', text: m.text, t: tm(m.at), cls: m.who === 'me' ? 'me' : 'bot',
        head: m.who !== 'me' && (i === 0 || arr[i - 1].who === 'me'),
        acts: (m.acts || []).map(a => ({ l: a.l, k: a.k, a: a.a })), hasActs: !!(m.acts && m.acts.length),
      }));
      out.hpTyping = !!s.hpTyping;
      out.hpSugg = this.hpCtxActs().slice(0, 4);
      out.onHpInput = e => this.setState({ hpText: e.target.value });
      out.onHpKey = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.hpAsk(this.state.hpText); } };
      out.onHpSend = () => this.hpAsk(this.state.hpText);
      out.hpCantSend = !String(s.hpText || '').trim();
      out.onHpReset = () => this.hpAct('clear');
    }

    /* AI 助手 */
    if (tab === 'ai') {
      out.hpAiNeedLogin = !me; out.hpAiPending = !!(me && !aiOk); out.hpAiOk = aiOk;
      out.hpLoginActs = this.hpLoginActs();
      if (aiOk) {
        const LABEL = { set_my_uid: '設定 uid', get_my_status: '查我的狀態', get_current_event: '查當期活動', get_upcoming_events: '查未來活動', get_borders: '查榜線',
          get_gacha_schedule: '查卡池排程', get_history_borders: '查歷史榜線', search_tutorial: '查教學大全', get_my_cards: '查我的卡片', search_anything: '搜尋站上資料',
          song_efficiency: '算效率排行', calc_event_points: '算活動 P', schedule_task: '建立排程' };
        const bub = [];
        const msgs = s.aiMsgs || [];
        msgs.forEach((m, mi) => {
          if (m.role === 'user') { if (typeof m.content === 'string') bub.push({ k: mi + 'u', me: true, ai: false, tool: false, text: m.content, node: null }); return; }
          (Array.isArray(m.content) ? m.content : []).forEach((c, ci) => {
            if (c.type === 'text' && c.text && c.text.trim()) bub.push({ k: mi + '-' + ci, me: false, ai: true, tool: false, text: '', node: React.createElement('div', { className: 'hp-md', dangerouslySetInnerHTML: { __html: this.mdLite(c.text.trim()) } }) });
            else if (c.type === 'tool_use') bub.push({ k: mi + '-' + ci, me: false, ai: false, tool: true, text: (LABEL[c.name] || c.name), live: false });
          });
        });
        const lastTool = [...bub].reverse().find(b => b.tool);
        if (s.admBusy && lastTool && bub[bub.length - 1] === lastTool) lastTool.live = true;
        bub.forEach(b => { b.cls = b.me ? 'me' : b.tool ? 'tool' + (b.live ? ' live' : '') : 'bot'; b.toolText = b.tool ? (b.live ? '正在' + b.text + '…' : '已' + b.text) : ''; });
        out.hpAiBubbles = bub;
        out.hpAiEmpty = !bub.length;
        out.hpAiBusy = !!s.admBusy && !(lastTool && lastTool.live);
        out.hpAiErr = s.aiErr || '';
        const q = s.aiQuota;
        out.hpAiQuota = q ? (q.unlimited ? '不限次數' : '今日 ' + (q.ops_used == null ? q.used : q.ops_used) + ' / ' + (q.ops_cap == null ? q.cap : q.ops_cap) + ' 次') : '每天 20 次・00:00 重置';
        out.hpAiStarters = ['我這期要跑到 T1000 還要多久？', '接下來兩個月該抽哪些池？', '跑哪首歌最有效率？'].map(l => ({ l, k: 'ai', a: l }));
        out.onHpAiInput = e => this.setState({ hpAiText: e.target.value });
        out.onHpAiKey = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.hpAiSend(this.state.hpAiText); } };
        out.onHpAiSend = () => this.hpAiSend(this.state.hpAiText);
        out.hpAiCantSend = !String(s.hpAiText || '').trim() || !!s.admBusy;
        out.hpAiSendSpin = !!s.admBusy; out.hpAiSendIcon = !s.admBusy;
        out.onHpAiNew = () => this.loadAi().then(() => this.newChat()).catch(() => {});
      }
    }

    /* 留言給站長 */
    if (tab === 'msg') {
      out.hpMsgNeedLogin = !me; out.hpMsgOk = !!me;
      out.hpLoginActs = this.hpLoginActs();
      out.hpMsgErr = s.hpMsgErr || '';
      out.hpSending = !!s.hpSending; out.hpNotSending = !s.hpSending;
      out.hpInThread = !!s.hpThread; out.hpInList = !s.hpThread;
      out.hpThLoading = !!s.hpThLoad;
      const seen = this._hpSeen || {};
      out.hpThreadsList = (s.hpThreads || []).map(t => ({ id: t.id, title: t.title, by: s.hpIsAdmin ? (t.author || '') : '', ago: this.ago((t.last_reply_at || t.updated_at || t.created_at) * 1000),
        st: t.solved ? '已解決' : (t.reply_count ? '有回覆' : '等待回覆'), stC: t.solved ? '#3ea76a' : (t.reply_count ? 'var(--accent-deep)' : 'var(--text-3)'), unread: (t.reply_count || 0) > (seen[t.id] || 0) }));
      out.hpHasThreads = out.hpThreadsList.length > 0;
      out.hpCats = CATS.map(([v, n]) => ({ v, n, k: 'cat', on: (s.hpNewCat || '') === v, cls: (s.hpNewCat || '') === v ? 'on' : '' }));
      out.hpMsgPh = s.hpThread ? '回覆站長…' : ((CATS.find(c => c[0] === s.hpNewCat) || [0, ''])[1] ? '描述一下：在哪一頁、做了什麼、看到什麼' : '先選分類，再寫下想說的話');
      if (s.hpThread) {
        const T = s.hpThInfo;
        out.hpThTitle = T ? T.title : '讀取中…';
        out.hpThSub = T ? (T.solved ? '已解決' : '對話中') + '・' + this.ago(T.created_at * 1000) + '開始' : '';
        const first = T ? [{ k: 't', mine: !!T.mine, staff: !!T.author_admin && !T.mine, who: T.mine ? '你' : (T.author || ''), text: T.body, t: this.ago(T.created_at * 1000) }] : [];
        out.hpPosts = first.concat((s.hpPosts || []).filter(p => !p.deleted).map(p => ({ k: p.id, mine: !!p.mine, staff: !!p.author_admin && !p.mine, who: p.mine ? '你' : (p.author_admin ? '站長 ' + (p.author || '') : (p.author || '')), text: p.body, t: this.ago(p.created_at * 1000) })))
          .map(p => Object.assign(p, { cls: p.mine ? 'me' : 'bot', badge: p.staff }));
        out.hpPostsLoading = !s.hpPosts;
        out.hpWaitNote = T && !T.reply_count && !s.hpIsAdmin ? '已送達。站長回覆時這裡會即時出現，視窗關著也會亮紅點。' : '';
        out.hpThCan = s.hpThCan !== false;
      }
      out.onHpThOpen = e => this.hpOpenThread(e.currentTarget.dataset.id);
      out.onHpThBack = () => { this.setState({ hpThread: null, hpPosts: null, hpThInfo: null, hpMsgErr: '' }); this.hpLoadThreads(true); };
      out.onHpNewMsg = () => this.setState({ hpThread: null, hpPosts: null, hpThInfo: null, hpNewOpen: true, hpMsgErr: '' });
      out.hpComposeOn = !!s.hpThread || !!s.hpNewOpen || !(s.hpThreads || []).length;
      out.hpShowCats = !s.hpThread;
      out.onHpMsgInput = e => this.setState({ hpMsgText: e.target.value, hpMsgErr: '' });
      out.onHpMsgKey = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) { e.preventDefault(); this.hpSendMsg(); } };
      out.onHpMsgSend = () => this.hpSendMsg();
      out.hpMsgCantSend = !String(s.hpMsgText || '').trim() || !!s.hpSending || !(s.hpThread || s.hpNewCat);
      out.hpQaLink = { l: '公開的提問所', k: 'go', a: 'qa' };
    }
    return out;
  },
  };
}
