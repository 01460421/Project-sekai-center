/* WL3 專區：World Link 3 一頁看完。資料在 data/wl3-zone.js（tools/build-wl3-zone.py 每天從活動資料、榜線資料庫與 WL3 計算器的規則表挑出來）。
   這頁本身不算東西：時程、榜線、限定卡、規則與滿配加成都是建好的數字，這裡只負責「依伺服器挑時間、排版、連到對應的工具」。
   台服：master 已經有的那幾期用正式時間，其他照排程預測（日服同一時刻加 lagH 小時）並標「預估」；日服：日服 master 的時間。 */
const ATTRS = ['cool', 'happy', 'mysterious', 'cute', 'pure'];   // 與 cards-index.js 相同順序
const KEY = 'sekai-wl3zone';

export function wzMembers() {
  return {
    wzInit() {
      if (this.state.wzReady) return;
      import(scData('wl3-zone.js')).then(m => {
        this._wz = m.WL3Z;
        let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
        this.setState({ wzReady: true, wz: Object.assign({ tier: 1000 }, saved || {}) });
      }).catch(() => this.setState({ wzErr: 'WL3 專區的資料載入失敗，請檢查網路後重試。' }));
    },
    wzSet(patch) {
      const wz = Object.assign({}, this.state.wz, patch);
      try { localStorage.setItem(KEY, JSON.stringify(wz)); } catch (e) {}
      this.setState({ wz });
    },
    wzVals(s) {
      if (!s.wzReady || !this._wz) return { wzOn: false };
      const key = (s.lang || '') + this.SRV + JSON.stringify(s.wz) + (s.gachas || []).length + Math.floor(Date.now() / 60000);
      if (this._wzKey === key && this._wzOut) return this._wzOut;
      const Z = this._wz, jp = this.SRV === 'jp', now = Date.now(), out = { wzOn: true };
      const jpName = s.lang === 'ja' || s.lang === 'en' || jp;   // 日文、英文介面與日服模式用日服原名
      const T = e => (jp ? e.jpT : e.twT), CT = c => (jp ? [c[2], c[3]] : [c[4], c[5]]);
      const p2 = n => String(n).padStart(2, '0');
      const fdt = t => { const d = new Date(t); return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
      const fd = t => { const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate(); };
      const fdy = t => { const d = new Date(t); return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate(); };
      const nm = e => (jpName || !e.tw ? e.jp : e.tw);
      const chip = on => on ? { bg: 'var(--ink-grad)', fg: '#fff', bd: 'transparent' } : { bg: 'var(--card)', fg: 'var(--text-2)', bd: 'var(--border)' };
      const evTag = e => (e.fin ? '終章' : '第 ' + e.part + ' 期');
      const wan = v => (v == null ? '—' : (v >= 1e8 ? (v / 1e8).toFixed(2) + ' 億' : Math.round(v / 1e4).toLocaleString() + ' 萬'));
      const charN = c => this.charShort(c) || '#' + c;
      const E = Z.events, first = E[0], last = E[E.length - 1];

      /* ---- 狀態：還沒開始（倒數）／進行中（哪一期哪一章）／已結束 ---- */
      const st = T(first)[0], en = T(last)[1];
      const curE = E.find(e => T(e)[0] <= now && now <= T(e)[1]);
      const curC = curE ? curE.ch.find(c => CT(c)[0] <= now && now <= CT(c)[1] && c[1]) : null;
      const srvN = jp ? '日服' : '台服';
      if (now < st) {
        const days = Math.ceil((st - now) / 86400000);
        out.wzState = srvN + ' WL3 第一期「' + nm(first) + '」' + fdt(st) + ' 開跑' + (!jp && first.twOff ? '（台服已公布）' : !jp ? '（預估）' : '');
        out.wzCount = '還有 ' + days + ' 天';
      } else if (curE) {
        out.wzState = '進行中：' + evTag(curE) + '「' + nm(curE) + '」' + (curC ? '第 ' + curC[0] + ' 章・' + charN(curC[1]) + '（到 ' + fdt(CT(curC)[1]) + '）' : '（到 ' + fdt(T(curE)[1]) + '）');
        out.wzCount = '';
      } else if (now > en) {
        out.wzState = srvN + ' WL3 已在 ' + fdy(en) + ' 全部結束；下面是完整的時程、榜線與限定卡。';
        out.wzCount = '';
      } else {
        const nx = E.find(e => T(e)[0] > now);
        out.wzState = '兩期之間：下一期' + (nx ? '「' + nm(nx) + '」' + fdt(T(nx)[0]) + ' 開跑' : '');
        out.wzCount = nx ? '還有 ' + Math.ceil((T(nx)[0] - now) / 86400000) + ' 天' : '';
      }
      out.wzHasCount = !!out.wzCount;
      out.wzLive = !!curE;
      out.wzRange = srvN + ' ' + fdy(st) + ' – ' + fdy(en) + (jp ? '' : '（日服 ' + fdy(first.jpT[0]) + ' – ' + fdy(last.jpT[1]) + '）');
      out.wzTzNote = jp ? '時間是你裝置的時區。' : '時間是你裝置的時區；台服 master 還沒有的期數照「日服同一時刻加一年」推估（排程預測頁有逐期回測命中率）。';

      /* ---- 重點數字 ---- */
      const ch1 = E.find(e => !e.fin) || first, fin = E.find(e => e.fin) || last;
      const nCh = E.reduce((a, e) => a + e.ch.filter(c => c[1]).length, 0);
      out.wzStats = [
        { k: '期數', v: E.length + ' 期・' + nCh + ' 章' },
        { k: '總合力上限', v: ch1.cap ? this.n(ch1.cap) : '—' },
        { k: '後排支援隊', v: Z.supN + ' 張' },
        { k: '滿配加成', v: ch1.bAll + '%／' + fin.bAll + '%', n: '章節／終章' },
      ];

      /* ---- 時程 ---- */
      out.wzEvents = E.map(e => {
        const [a, b] = T(e), on = a <= now && now <= b, done = now > b;
        return {
          id: String(e.id), tag: evTag(e), name: nm(e), sub: !jpName && e.tw && e.tw !== e.jp ? e.jp : '', hasSub: false,
          logo: this.ASSET + '/event/' + e.abn + '/logo/logo.webp',
          when: fdt(a) + ' – ' + fdt(b), whenTag: jp ? '日服' : (e.twOff ? '台服公布' : '台服預估'),
          other: jp ? '' : '日服 ' + fdy(e.jpT[0]) + ' – ' + fdy(e.jpT[1]),
          st: on ? '進行中' : done ? '已結束' : '還沒開始', stC: on ? '#3ec49a' : done ? 'var(--text-3)' : 'var(--accent-deep)',
          hasInfo: jp || e.twOff,
          infoPatch: JSON.stringify({ eiId: e.id }),
          chs: e.ch.filter(c => c[1]).map(c => {
            const [ca, cb] = CT(c), cOn = ca <= now && now <= cb;
            return { n: charN(c[1]), img: this.charaSd(c[1]), no: '第 ' + c[0] + ' 章', d: fd(ca) + ' – ' + fd(cb), c: this.CHARA_COLOR[c[1]] || 'var(--border)', on: cOn, bd: cOn ? '2px solid #3ec49a' : '1px solid var(--border)' };
          }),
          isFin: e.fin,
          finNote: e.fin ? '終章不分章節，26 位角色一起；排名報酬看你終章期間最常用的隊長是誰。' : '',
        };
      });
      out.wzEvents.forEach(x => { x.hasSub = !!x.sub; x.hasChs = x.chs.length > 0; });

      /* ---- 規則與滿配（數字都來自 master，跟 WL3 計算器同一份規則表） ---- */
      const shu = Object.entries(fin.shuffle || {}).sort((a, b) => a[0] - b[0]);
      const sp = Z.sup;
      out.wzRules = [
        { k: '總合力上限', v: ch1.cap ? this.n(ch1.cap) : '—', n: '每一期都一樣，超過的綜合力不計分。區域道具、MySekai 大門、玩偶要練到哪裡，用 WL3 計算器看。', p: 'wl3pow' },
        { k: '章節：主隊', v: '+' + ch1.bMain + '%', n: '本章角色的卡 +' + ch1.cb + '%、本期活動卡 +' + ch1.ec + '%、★4 專精 5 +' + Z.rar4 + '%，五張再加五色 +' + Z.attr5 + '%。', p: 'wl3pow' },
        { k: '後排支援隊', v: '+' + ch1.bSup + '%', n: Z.supN + ' 張（WL2 是 20 張、WL1 12 張）；本章角色的 ★4 每張 ' + sp.spec + '%＋專精 ' + sp.mr + '＋技能 ' + sp.sl + '，前幾屆的 WL 限定卡再 +20（WL1、WL2 各一張）。當期活動卡不能放後排。', p: 'wlsup' },
        { k: '終章：主隊', v: '+' + fin.bMain + '%', n: 'WL3 限定卡每張 +' + fin.ec + '%（' + (fin.limMax == null ? '五張都算' : '最多計 ' + fin.limMax + ' 張') + '）、全角色 +' + fin.cb + '%、五色 +125%'
          + (shu.length ? '、混團 ' + shu.map(x => x[0]).join('／') + ' 團 +' + shu.map(x => x[1]).join('／') + '%（WL3 新增，VS 卡算 VIRTUAL SINGER）' : '')
          + '、隊長是限定卡 +' + fin.lead + '%、主稱號 +' + fin.title + '%。', p: 'wl3pow' },
        { k: '終章：上限', v: (fin.skill != null ? '技能 +' + fin.skill + '%' : '') + (fin.doll != null ? '・玩偶 ' + fin.doll + '%' : ''), n: '終章期間單張卡的技能效果最多 +' + (fin.skill != null ? fin.skill : '—') + '%，MySekai 玩偶給的綜合力最多 ' + (fin.doll != null ? fin.doll : '—') + '%（平常 10%）。跑榜工作室的最佳化已經套用。', p: 'deckpro' },
        { k: '滿配合計', v: ch1.bAll + '%／' + fin.bAll + '%', n: '章節 ' + ch1.bMain + '＋' + ch1.bSup + '；終章 ' + fin.bMain + '＋' + fin.bSup + '（含主稱號）。', p: 'wl3pow' },
      ];

      /* ---- 日服最終榜線 ---- */
      const tiers = Z.tiers, ti = Math.max(0, tiers.indexOf(+(s.wz && s.wz.tier) || 1000));
      out.wzTiers = tiers.map(t => Object.assign({ v: String(t), n: 'T' + t.toLocaleString() }, chip(t === tiers[ti])));
      out.wzTierN = 'T' + tiers[ti].toLocaleString();
      out.wzBorders = E.map(e => ({
        tag: evTag(e), name: nm(e), main: wan((e.main || [])[ti]),
        rows: e.ch.filter(c => c[1]).map(c => ({ n: charN(c[1]), img: this.charaSd(c[1]), no: '第 ' + c[0] + ' 章', v: wan((c[6] || [])[ti]) })),
      }));
      out.wzBorders.forEach(x => { x.hasRows = x.rows.length > 0; });
      out.wzBorderNote = '日服每一章（章節榜）與整期（總榜）的最終榜線，資料來自本站的日服榜線資料庫。台服人數與日服不同，只能當量級參考；台服開跑後即時榜線看「WL 個榜」。';

      /* ---- WL3 限定卡 ---- */
      const evTagById = {}; E.forEach(e => { evTagById[e.id] = evTag(e); });
      out.wzCards = Z.cards.map(c => {
        const at = (this.SM_ATTR || {})[ATTRS[c[2]]] || ['', 'var(--text-3)'];
        return { img: this.cardImg(c[3], 4), name: (jpName || !c[5]) ? c[4] : c[5], ch: charN(c[1]), at: at[0], atC: at[1], ev: evTagById[c[6]] || '' };
      });
      out.wzCardNote = '各章的活動卡就是 WL3 限定卡：章節期間是本期活動卡（+' + ch1.ec + '%），終章 26 張一起當限定卡（每張 +' + fin.ec + '%）。下一屆 WL 時，它們在後排會再多 +20。';

      /* ---- 相關卡池（台服預測卡池表裡掛在 WL3 期數的池） ---- */
      const ids = new Set(E.map(e => String(e.id)));
      const pools = (s.gachas || []).filter(g => g.eid && ids.has(String(g.eid)) && /World Link/.test(g.t || ''));
      out.wzPools = pools.map(g => ({ n: g.n || '', t: g.t || '', d: (g.s || '') + ' – ' + (g.e || ''), ch: g.ch || '', note: g.note || '', hasNote: !!g.note, patch: JSON.stringify({ gachaGid: g.id }) }));
      out.wzHasPools = out.wzPools.length > 0;
      out.wzPoolNote = jp ? '' : '台服卡池是預測時間（照日服同一天加一年），目前排到 ' + ((s.gachas || []).reduce((m, g) => (g.s && g.s > m ? g.s : m), '') || '—') + ' 開始的池。';   // 用開始日：常駐池的結束日寫 2099

      out.wzPRank = JSON.stringify({ rankTab: 'wl' }); out.wzPBdb = JSON.stringify({ bdbWL: true }); out.wzPTut = JSON.stringify({ tq: 'World Link' });
      this._wzKey = key; this._wzOut = out;
      return out;
    },
    wzHandlers() {
      return {
        onWzTier: e => this.wzSet({ tier: +e.currentTarget.dataset.v || 1000 }),
        /* 連到別頁並帶狀態（活動資料的期數、榜線資料庫切到 WL、排名切到 WL 個榜、卡池選定那一池） */
        onWzGo: e => {
          const d = e.currentTarget.dataset; let patch = {};
          try { patch = JSON.parse(d.patch || '{}') || {}; } catch (err) {}
          if (Object.keys(patch).length) this.setState(patch);
          if (d.p) this.go(d.p);
        },
      };
    },
  };
}
