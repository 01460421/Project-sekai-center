/* ---------- 製作工具：樂曲追加圖產生器（songcard）與譜面預覽產生器（chart） ----------
   原本是兩個獨立頁，現在做進站內：進「小遊戲與製作」的這兩個分頁籤才載。做法同 haruki.js／car.js：
   匯出一個回傳成員物件的函式，App 載入後 Object.assign 到實例上，方法裡的 this 就是 App；
   表單值與按鈕都在 mkVals(s) 回給模板（模板在 app.html 的 isSongcard／isChart 兩段）。
   表單狀態放 state.sc（追加圖）與 state.cp（譜面），圖片物件與解析結果放 this._sc／this._cp（不進 state）。
   改這裡要記得 python3 tools/stamp-assets.py（檔案清單在 CODE）。 */
export function makerMembers() {
  /* ===================== 共用資料 ===================== */
  const CH = [
    [1, '星乃一歌', '星乃一歌', 'ln'], [2, '天馬咲希', '天馬咲希', 'ln'], [3, '望月穂波', '望月穗波', 'ln'], [4, '日野森志歩', '日野森志步', 'ln'],
    [5, '花里みのり', '花里實乃理', 'mmj'], [6, '桐谷遥', '桐谷遙', 'mmj'], [7, '桃井愛莉', '桃井愛莉', 'mmj'], [8, '日野森雫', '日野森雫', 'mmj'],
    [9, '小豆沢こはね', '小豆澤心羽', 'vbs'], [10, '白石杏', '白石杏', 'vbs'], [11, '東雲彰人', '東雲彰人', 'vbs'], [12, '青柳冬弥', '青柳冬彌', 'vbs'],
    [13, '天馬司', '天馬司', 'wxs'], [14, '鳳えむ', '鳳笑夢', 'wxs'], [15, '草薙寧々', '草薙寧寧', 'wxs'], [16, '神代類', '神代類', 'wxs'],
    [17, '宵崎奏', '宵崎奏', 'n25'], [18, '朝比奈まふゆ', '朝比奈真冬', 'n25'], [19, '東雲絵名', '東雲繪名', 'n25'], [20, '暁山瑞希', '曉山瑞希', 'n25'],
    [21, '初音ミク', '初音未來', 'vs'], [22, '鏡音リン', '鏡音鈴', 'vs'], [23, '鏡音レン', '鏡音連', 'vs'], [24, '巡音ルカ', '巡音流歌', 'vs'], [25, 'MEIKO', 'MEIKO', 'vs'], [26, 'KAITO', 'KAITO', 'vs'],
  ];
  const UNITS = {
    ln: { jp: 'Leo/need', tw: 'Leo/need', c: '#4455dd', c2: '#7f8cf5', logo: 'unit-img/ln.webp' },
    mmj: { jp: 'MORE MORE JUMP！', tw: 'MORE MORE JUMP！', c: '#88dd44', c2: '#a9ef73', logo: 'unit-img/mmj.webp' },
    vbs: { jp: 'Vivid BAD SQUAD', tw: 'Vivid BAD SQUAD', c: '#ee1166', c2: '#ff5c95', logo: 'unit-img/vbs.webp' },
    wxs: { jp: 'ワンダーランズ×ショウタイム', tw: 'Wonderlands×Showtime', c: '#ff9900', c2: '#ffc04d', logo: 'unit-img/wxs.webp' },
    n25: { jp: '25時、ナイトコードで。', tw: '25點，Nightcord見。', c: '#884499', c2: '#b574c9', logo: 'unit-img/n25.webp' },
    vs: { jp: 'バーチャル・シンガー', tw: '虛擬歌手', c: '#33ccbb', c2: '#6ee6d9', logo: 'unit-img/vs.webp' },
  };
  const UNIT_ORDER = ['ln', 'mmj', 'vbs', 'wxs', 'n25', 'vs'];
  const LBL = {
    jp: { head: '楽曲追加決定!', vs: 'バーチャル・シンガーver.', sk: 'セカイver.', lyr: '作詞', comp: '作曲', arr: '編曲', append: 'APPEND' },
    tw: { head: '樂曲追加決定!', vs: '虛擬歌手ver.', sk: 'SEKAI ver.', lyr: '作詞', comp: '作曲', arr: '編曲', append: 'APPEND' },
  };
  const FOOT = 'This is an independent fan creation. Any depicted trademarks remain property of their respective owners.';
  const F_ROUND = '"M PLUS Rounded 1c","Noto Sans JP","Noto Sans TC",sans-serif';
  const F_SANS = '"Noto Sans JP","Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  const font = (w, px, fam) => w + ' ' + px + 'px ' + (fam || F_SANS);
  const JDB = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-diff/main';
  const ASSET = 'https://storage.sekai.best/sekai-jp-assets', ASSET_TC = 'https://storage.sekai.best/sekai-tc-assets';
  const JACKET = abn => ASSET + '/music/jacket/' + abn + '/' + abn + '.png';
  const JACKET_TC = abn => ASSET_TC + '/music/jacket/' + abn + '/' + abn + '.png';
  const SCORE = (id, diff) => ASSET + '/music/music_score/' + String(id).padStart(4, '0') + '_01/' + diff + '.txt';
  const DIFFS = ['easy', 'normal', 'hard', 'expert', 'master', 'append'];
  const DIFF_COL = { easy: '#5bd15b', normal: '#4aa8ff', hard: '#ffb340', expert: '#ff5a7a', master: '#c95cff', append: '#ff7fc0' };
  const MPC = [4, 6, 8, 10, 12, 16];
  const chName = (id, lang) => { const c = CH[id - 1]; return c ? (lang === 'tw' ? c[2] : c[1]) : ''; };
  const unitOfChar = id => (CH[id - 1] || [])[3] || '';
  const mulberry = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const SC_DEF = () => ({ lang: 'jp', title: '', lyr: '', comp: '', arr: '', mv: '3d', append: false, vs: '', unit: '', chars: [], extra: '', foot: FOOT, seed: 7, bg: 'img', q: '', jacketLabel: '', logoLabel: '', tainted: false, songId: 0, imgV: 0 });
  const CP_DEF = () => ({ lang: 'jp', mpc: 8, combo: true, bpm: true, skill: true, zoom: 'fit', songId: 0, diff: 'master', q: '', warn: '', susName: '', customTitle: '', v: 0, busy: false });

  /* ===================== SUS 解析（照 Ched／Sekai 的慣例） =====================
     #mmm02: 小節拍數；#BPMzz: 速度定義、#mmm08: 變速點；#mmm1x: 單點（x=軌道 hex，資料兩字一組＝種類＋寬度）；
     #mmm3xy: 長條（y=頻道；1 起點、2 終點、3 可見中繼、5 隱形中繼）；#mmm9xy: 引導線；#mmm5x: 方向（1 上、3 左、4 右＝滑鍵；2 進緩、5/6 出緩）。 */
  function parseSus(text) {
    let tpb = 480; const meta = {}, barLen = [], bpmDef = {}, bpmRaw = [], taps = [], airs = [], streams = new Map();
    for (const ln of String(text).split(/\r?\n/)) {
      const l = ln.trim(); if (!l.startsWith('#')) continue;
      const m = l.match(/^#(\w+)\s*:\s*(.*)$/);
      if (!m) {
        const mm = l.match(/^#(\w+)\s+(.*)$/);
        if (mm) { const k = mm[1].toUpperCase(), v = mm[2].trim().replace(/^"|"$/g, ''); if (k === 'REQUEST') { const r = v.match(/ticks_per_beat\s+(\d+)/); if (r) tpb = +r[1]; } else meta[k] = v; }
        continue;
      }
      const h = m[1], data = m[2].trim();
      if (/^BPM\w\w$/i.test(h)) { bpmDef[h.slice(3)] = parseFloat(data) || 0; continue; }
      if (!/^\d{3}/.test(h)) continue;
      const meas = +h.slice(0, 3), ch = h.slice(3);
      if (ch === '02') { barLen.push({ measure: meas, length: parseFloat(data) || 4 }); continue; }
      const ps = data.match(/.{2}/g) || []; if (!ps.length) continue;
      const put = (list, lane) => ps.forEach((v, i) => { if (v !== '00') list.push({ meas, i, n: ps.length, lane, type: parseInt(v[0], 36), width: parseInt(v[1], 36), v }); });
      if (ch === '08') { ps.forEach((v, i) => { if (v !== '00') bpmRaw.push({ meas, i, n: ps.length, v }); }); continue; }
      if (ch.length === 2 && ch[0] === '1') put(taps, parseInt(ch[1], 36));
      else if (ch.length === 2 && ch[0] === '5') put(airs, parseInt(ch[1], 36));
      else if (ch.length === 3 && (ch[0] === '3' || ch[0] === '9')) { const k = ch[2] + '-' + ch[0]; if (!streams.has(k)) streams.set(k, { type: +ch[0], notes: [] }); put(streams.get(k).notes, parseInt(ch[1], 36)); }
    }
    barLen.sort((a, b) => a.measure - b.measure);
    if (!barLen.length || barLen[0].measure > 0) barLen.unshift({ measure: 0, length: 4 });
    let acc = 0;
    const bars = barLen.map((b, i, arr) => { if (i) { const p = arr[i - 1]; acc += (b.measure - p.measure) * p.length * tpb; } return { measure: b.measure, len: b.length, tpm: b.length * tpb, ticks: acc }; });
    const barOf = m => { let bar = bars[0]; for (const b of bars) if (m >= b.measure) bar = b; return bar; };
    const toTick = (m, p, q) => { const bar = barOf(m); return bar.ticks + (m - bar.measure) * bar.tpm + p * bar.tpm / q; };
    const fix = n => { n.tick = toTick(n.meas, n.i, n.n); return n; };
    taps.forEach(fix); airs.forEach(fix);
    const bpms = bpmRaw.map(fix).map(r => ({ tick: r.tick, bpm: bpmDef[r.v] || 0 })).filter(b => b.bpm > 0).sort((a, b) => a.tick - b.tick);
    if (!bpms.length) bpms.push({ tick: 0, bpm: parseFloat(Object.values(bpmDef)[0]) || 120 });
    const slides = [];
    for (const st of streams.values()) {
      st.notes.forEach(fix); st.notes.sort((a, b) => a.tick - b.tick);
      let cur = null;
      for (const n of st.notes) { if (!cur) { cur = { type: st.type, notes: [] }; slides.push(cur); } cur.notes.push(n); if (n.type === 2) cur = null; }
    }
    let maxTick = 0;
    taps.forEach(n => { maxTick = Math.max(maxTick, n.tick); }); slides.forEach(s => s.notes.forEach(n => { maxTick = Math.max(maxTick, n.tick); }));
    const measures = []; let m = 0, start = 0;
    while (start <= maxTick || measures.length < 1) { const len = barOf(m).tpm; measures.push({ m, start, len }); start += len; m++; if (m > 2000) break; }
    return { tpb, meta, bpms, taps, airs, slides, measures, maxTick };
  }
  /* 譜面模型（照 pjsekai 引擎的 SUS→USC 規則）：單點與長條點重疊（同軌道同 tick）時單點只當修飾：2＝關鍵、5／6＝軌跡、3＝中繼改附著、7／8＝起終點不判定。
     長條每半拍一個隱藏判定點（起終點之間），可見中繼、附著中繼與起終點都算 combo，隱形中繼不算；用五張官方譜面對過官方 Notes 數全部一致。 */
  function buildChart(sc) {
    const key = n => n.lane + '-' + Math.round(n.tick);
    const prevent = new Set();
    for (const sl of sc.slides) if (sl.type === 3) for (const n of sl.notes) if (n.type === 1 || n.type === 2 || n.type === 3 || n.type === 5) prevent.add(key(n));
    const flick = new Map(), ease = new Map();
    for (const a of sc.airs) { const k = key(a); if (a.type === 1) flick.set(k, 'up'); else if (a.type === 3) flick.set(k, 'left'); else if (a.type === 4) flick.set(k, 'right'); else if (a.type === 2) ease.set(k, 'in'); else if (a.type === 5 || a.type === 6) ease.set(k, 'out'); }
    const crit = new Set(), trace = new Set(), tickRemove = new Set(), endRemove = new Set();
    for (const t of sc.taps) { const k = key(t); if (t.type === 2) crit.add(k); else if (t.type === 5) trace.add(k); else if (t.type === 6) { trace.add(k); crit.add(k); } else if (t.type === 3) tickRemove.add(k); else if (t.type === 7) endRemove.add(k); else if (t.type === 8) { crit.add(k); endRemove.add(k); } }
    const singles = [], skills = [], seen = new Set();
    for (const t of sc.taps) {
      if (t.type === 4 && t.lane === 0) { skills.push(t.tick); continue; }
      if (t.lane <= 1 || t.lane >= 14 || !(t.type === 1 || t.type === 2 || t.type === 5 || t.type === 6)) continue;
      const k = key(t); if (prevent.has(k) || seen.has(k)) continue; seen.add(k);
      singles.push({ tick: t.tick, lane: t.lane, width: t.width, critical: t.type === 2 || t.type === 6, trace: t.type === 5 || t.type === 6, flick: flick.get(k) || null });
    }
    const slides = [], dedupe = new Map();
    for (const sl of sc.slides) {
      const start = sl.notes.find(n => n.type === 1 || n.type === 2); if (!start) continue;
      const active = sl.type === 3, critical = crit.has(key(start));
      const o = { active, critical, conns: [] };
      for (const n of sl.notes) {
        const k = key(n), e = ease.get(k) || 'linear', base = { tick: n.tick, lane: n.lane, width: n.width, ease: e };
        if (n.type === 1) o.conns.push(Object.assign(base, (!active || endRemove.has(k)) ? { type: 'ignore' } : { type: 'start', trace: trace.has(k), critical: critical || crit.has(k) }));
        else if (n.type === 2) o.conns.push(Object.assign(base, (!active || endRemove.has(k)) ? { type: 'ignore' } : { type: 'end', trace: trace.has(k), critical: critical || crit.has(k), flick: flick.get(k) || null }));
        else if (n.type === 3) { if (tickRemove.has(k)) o.conns.push({ type: 'attach', tick: n.tick, critical: critical || crit.has(k) }); else o.conns.push(Object.assign(base, { type: 'tick', trace: trace.has(k), critical: critical || crit.has(k) })); }
        else if (n.type === 5) { if (!tickRemove.has(k)) o.conns.push(Object.assign(base, { type: 'ignore' })); }
      }
      o.conns.sort((a, b) => a.tick - b.tick);
      o.joints = o.conns.filter(c => c.type !== 'attach');
      if (o.joints.length < 2) continue;
      o.t0 = o.joints[0].tick; o.t1 = o.joints[o.joints.length - 1].tick;
      o.hidden = [];
      if (active) { const half = sc.tpb / 2, b0 = o.t0 / half; for (let i = Math.max(Math.ceil(b0), Math.floor(b0 + 1)); i * half < o.t1 - 1e-6; i++) o.hidden.push(i * half); }
      slides.push(o);
      if (active) { const k = key(start), d = dedupe.get(k); if (d) slides.splice(slides.indexOf(d), 1); dedupe.set(k, o); }
    }
    const judged = singles.map(s => s.tick);
    for (const o of slides) { for (const c of o.conns) if (c.type === 'start' || c.type === 'end' || c.type === 'tick' || c.type === 'attach') judged.push(c.tick); for (const h of o.hidden) judged.push(h); }
    judged.sort((a, b) => a - b);
    return { singles, slides, skills: skills.sort((a, b) => a - b), judged, total: judged.length };
  }
  const comboBefore = (judged, tick) => { let lo = 0, hi = judged.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (judged[mid] < tick - 1e-6) lo = mid + 1; else hi = mid; } return lo; };
  function secondsAt(sc, tick) {
    let t = 0, prev = { tick: 0, bpm: sc.bpms[0].bpm };
    for (const b of sc.bpms) { if (b.tick >= tick) break; if (b.tick > prev.tick) t += (b.tick - prev.tick) / sc.tpb * 60 / prev.bpm; prev = { tick: Math.max(prev.tick, b.tick), bpm: b.bpm }; }
    t += Math.max(0, tick - prev.tick) / sc.tpb * 60 / prev.bpm; return t;
  }
  /* 手寫的小段範例，各種音符都有一個（Notes 49） */
  const DEMO = [
    '#TITLE "範例譜面"', '#ARTIST "SEKAI 資源中心"', '#REQUEST "ticks_per_beat 480"', '#00002: 4', '#BPM01: 150', '#BPM02: 174', '#00008: 01', '#00508: 02',
    '#00110: 41', '#00112: 13000013', '#00117: 23000000', '#0011b: 00130000', '#0015b: 00100000', '#00118: 00001300', '#00158: 00003000',
    '#00214: 53000053', '#00218: 00630000', '#0021c: 00001300', '#0025c: 00004000', '#00210: 41',
    '#00332a: 13003300', '#00436a: 53000023', '#00416: 13000000', '#00456: 23000013', '#00314: 00001300',
    '#00539b: 13003300', '#00519: 23000000', '#00639b: 23000000', '#00512: 13000013', '#00510: 41',
    '#00692c: 13000000', '#00796c: 00230000', '#00612: 00001313', '#00714: 13131313', '#00718: 00002300',
    '#00812: 13000000', '#00817: 00530000', '#00916: 00000013', '#00956: 00000010', '#0091a: 23000000', '#00910: 41',
  ].join('\n');

  /* 譜面圖的版面常數與顏色 */
  const LW = 24, NL = 12, GL = 46, GR = 56, BH = 48, NH = 14, GAP = 22, PAD = 28, HEAD = 178, FOOT_H = 48;
  const COL = { tap: '#3fc8ff', crit: '#ffd43b', flick: '#ff6b9d', slide: '#5be38b', traceTap: '#8fe8ff', traceCrit: '#ffe066', traceFlick: '#ff8fb3' };
  const BAND = { slide: ['rgba(90,230,140,.32)', 'rgba(140,255,185,.65)'], crit: ['rgba(255,214,80,.32)', 'rgba(255,232,130,.65)'], guide: ['rgba(120,170,255,.2)', 'rgba(165,200,255,.45)'], guideCrit: ['rgba(255,214,80,.16)', 'rgba(255,230,140,.4)'] };
  const EASE = { linear: p => p, in: p => p * p, out: p => 1 - (1 - p) * (1 - p) };


  /* ===================== 片假名轉換器 =====================
     羅馬拼音 → 片假名（平文式與訓令式常見拼法都收：shi/si、chi/ti、tsu/tu、fu/hu、ja/zya…；促音＝重複子音、撥音＝n 後接子音或 nn／n'，
     長音＝同母音連寫或 ou／oo、ei 不併），平假名 → 片假名直接位移。其餘字元原樣保留。 */
  const KANA = [
    ['kya','キャ'],['kyu','キュ'],['kyo','キョ'],['gya','ギャ'],['gyu','ギュ'],['gyo','ギョ'],['sha','シャ'],['shu','シュ'],['sho','ショ'],['she','シェ'],['sya','シャ'],['syu','シュ'],['syo','ショ'],
    ['ja','ジャ'],['ju','ジュ'],['jo','ジョ'],['je','ジェ'],['zya','ジャ'],['zyu','ジュ'],['zyo','ジョ'],['jya','ジャ'],['jyu','ジュ'],['jyo','ジョ'],['cha','チャ'],['chu','チュ'],['cho','チョ'],['che','チェ'],['tya','チャ'],['tyu','チュ'],['tyo','チョ'],
    ['nya','ニャ'],['nyu','ニュ'],['nyo','ニョ'],['hya','ヒャ'],['hyu','ヒュ'],['hyo','ヒョ'],['bya','ビャ'],['byu','ビュ'],['byo','ビョ'],['pya','ピャ'],['pyu','ピュ'],['pyo','ピョ'],['mya','ミャ'],['myu','ミュ'],['myo','ミョ'],['rya','リャ'],['ryu','リュ'],['ryo','リョ'],
    ['tsa','ツァ'],['tsi','ツィ'],['tse','ツェ'],['tso','ツォ'],['thi','ティ'],['dhi','ディ'],['dhu','デュ'],['dyu','デュ'],['tyu','テュ'],['fya','フャ'],['fyu','フュ'],['fyo','フョ'],['vya','ヴャ'],['vyu','ヴュ'],['vyo','ヴョ'],
    ['shi','シ'],['chi','チ'],['tsu','ツ'],['ti','ティ'],['di','ディ'],['tu','トゥ'],['du','ドゥ'],['fa','ファ'],['fi','フィ'],['fe','フェ'],['fo','フォ'],['fu','フ'],['hu','フ'],['va','ヴァ'],['vi','ヴィ'],['vu','ヴ'],['ve','ヴェ'],['vo','ヴォ'],
    ['wi','ウィ'],['we','ウェ'],['wo','ヲ'],['wu','ウ'],['ye','イェ'],['si','シ'],['zi','ジ'],['ji','ジ'],['zu','ズ'],
    ['ka','カ'],['ki','キ'],['ku','ク'],['ke','ケ'],['ko','コ'],['ga','ガ'],['gi','ギ'],['gu','グ'],['ge','ゲ'],['go','ゴ'],['sa','サ'],['su','ス'],['se','セ'],['so','ソ'],['za','ザ'],['ze','ゼ'],['zo','ゾ'],
    ['ta','タ'],['te','テ'],['to','ト'],['da','ダ'],['de','デ'],['do','ド'],['na','ナ'],['ni','ニ'],['nu','ヌ'],['ne','ネ'],['no','ノ'],['ha','ハ'],['hi','ヒ'],['he','ヘ'],['ho','ホ'],
    ['ba','バ'],['bi','ビ'],['bu','ブ'],['be','ベ'],['bo','ボ'],['pa','パ'],['pi','ピ'],['pu','プ'],['pe','ペ'],['po','ポ'],['ma','マ'],['mi','ミ'],['mu','ム'],['me','メ'],['mo','モ'],
    ['ya','ヤ'],['yu','ユ'],['yo','ヨ'],['ra','ラ'],['ri','リ'],['ru','ル'],['re','レ'],['ro','ロ'],['la','ラ'],['li','リ'],['lu','ル'],['le','レ'],['lo','ロ'],['wa','ワ'],
    ['ca','カ'],['ci','シ'],['cu','ク'],['ce','セ'],['co','コ'],['cya','チャ'],['cyu','チュ'],['cyo','チョ'],
    ['a','ア'],['i','イ'],['u','ウ'],['e','エ'],['o','オ'],['n','ン'],
  ];
  // 沒接母音的子音（英文字常見）：用該行的ウ段（t／d 用オ段）湊個近似音
  const CONS = { b: 'ブ', c: 'ク', d: 'ド', f: 'フ', g: 'グ', h: 'フ', j: 'ジ', k: 'ク', l: 'ル', m: 'ム', p: 'プ', q: 'ク', r: 'ル', s: 'ス', t: 'ト', v: 'ヴ', w: 'ウ', x: 'クス', y: 'イ', z: 'ズ' };
  const KANA_MAP = new Map(KANA);
  function toKatakana(input) {
    let out = '', s = String(input || '');
    for (let i = 0; i < s.length;) {
      const code = s.charCodeAt(i);
      if (code >= 0x3041 && code <= 0x3096) { out += String.fromCharCode(code + 0x60); i++; continue; }   // 平假名 → 片假名
      const rest = s.slice(i).toLowerCase();
      if (!/^[a-z'-]/.test(rest)) { out += s[i]; i++; continue; }
      if (rest[0] === '-' || rest[0] === "'") { if (rest[0] === '-') out += 'ー'; i++; continue; }   // 連字號＝長音、撇號＝分音
      const c0 = rest[0], c1 = rest[1] || '';
      const vowel = 'aeiou';
      const c2 = rest[2] || '';
      // 撥音：n 後接子音（非 y）或字尾；nn 後面接母音時是「ン＋ナ行」（shinnen→シンネン），接子音或字尾才整個當ン
      if (c0 === 'n' && (!c1 || (!vowel.includes(c1) && c1 !== 'y' && /^[a-z]/.test(c1)))) { out += 'ン'; i += (c1 === 'n' && (!c2 || (!vowel.includes(c2) && c2 !== 'y'))) ? 2 : 1; continue; }
      // 促音：同子音連寫（tch、ck 也算）
      if (!vowel.includes(c0) && c0 !== 'n' && c1 === c0 && /^[a-z]/.test(c0)) { out += 'ッ'; i++; continue; }
      if ((c0 === 't' && rest.startsWith('tch')) || (c0 === 'c' && c1 === 'k')) { out += 'ッ'; i++; continue; }
      let hit = '';
      for (const len of [3, 2, 1]) { const seg = rest.slice(0, len); if (/^[a-z]+$/.test(seg) && KANA_MAP.has(seg)) { hit = seg; break; } }
      if (!hit) { if (CONS[c0]) { out += CONS[c0]; i++; } else { out += s[i]; i++; } continue; }
      let kana = KANA_MAP.get(hit); i += hit.length;
      // 長音：同母音緊接（aa/ii/uu/ee/oo）或 ou → ー
      const lastV = hit[hit.length - 1], nx = s[i] ? s[i].toLowerCase() : '';
      if (vowel.includes(lastV) && (nx === lastV || (lastV === 'o' && nx === 'u'))) { kana += 'ー'; i++; }
      out += kana;
    }
    return out;
  }

  return {
  MK_UNITS: UNITS,
  mkKana: toKatakana,

  /* ===================== 模組啟動：還原兩頁的設定、準備圖片 ===================== */
  mkInit() {
    const sc = SC_DEF(), cp = CP_DEF();
    try { const d = JSON.parse(localStorage.getItem('sekai-songcard-v1') || 'null'); if (d && typeof d === 'object') { ['lang', 'title', 'lyr', 'comp', 'arr', 'mv', 'vs', 'unit', 'extra', 'foot', 'bg'].forEach(k => { if (typeof d[k] === 'string') sc[k] = d[k]; }); if (typeof d.append === 'boolean') sc.append = d.append; if (Array.isArray(d.chars)) sc.chars = d.chars.filter(x => Number.isInteger(x) && x >= 1 && x <= 26); if (Number.isInteger(d.seed)) sc.seed = d.seed; } } catch (e) {}
    if (!LBL[sc.lang]) sc.lang = 'jp'; if (!['3d', '2d', 'none'].includes(sc.mv)) sc.mv = '3d'; if (sc.unit && !UNITS[sc.unit]) sc.unit = ''; if (sc.bg !== 'draw') sc.bg = 'img';
    try { const d = JSON.parse(localStorage.getItem('sekai-chart-v1') || 'null'); if (d && typeof d === 'object') { if (d.lang === 'tw' || d.lang === 'jp') cp.lang = d.lang; if (MPC.includes(d.mpc)) cp.mpc = d.mpc; ['combo', 'bpm', 'skill'].forEach(k => { if (typeof d[k] === 'boolean') cp[k] = d[k]; }); if (d.zoom === 'zoom') cp.zoom = 'zoom'; if (Number.isInteger(d.songId)) cp.songId = d.songId; if (DIFFS.includes(d.diff)) cp.diff = d.diff; } } catch (e) {}
    this._sc = { jacket: null, logo: null, bg: null, bgReady: false, units: {}, song: null };
    this._cp = { score: null, chart: null, song: null, diff: '', level: 0, title: '', artist: '', jacket: null, custom: false, officialNotes: 0, req: 0, drawKey: '' };
    const bg = new Image(); bg.onload = () => { this._sc.bgReady = true; this.scRedraw(); }; bg.src = 'unit-img/songcard-bg.webp'; this._sc.bg = bg;
    if (!this._mkPaste) {
      this._mkPaste = e => {
        if (this.state.page !== 'songcard') return;
        const a = document.activeElement, tag = a && a.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        const items = (e.clipboardData && e.clipboardData.items) || []; for (const it of items) if (it.type && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) { e.preventDefault(); this.scPickFile(f, 'jacket'); return; } }
      };
      document.addEventListener('paste', this._mkPaste);
    }
    try { Promise.all(['800 72px "M PLUS Rounded 1c"', '900 92px "Noto Sans JP"', '700 46px "Noto Sans JP"', '700 40px "Noto Sans TC"', '900 40px "Noto Sans TC"'].map(f => document.fonts.load(f).catch(() => null))).then(() => { this._mkFonts = true; this.scRedraw(); this._cp.drawKey = ''; this.cpRedraw(); }); } catch (e) {}
    this.setState({ sc, cp, mkReady: true, mkErr: '' });
    this.mkDbLoad();
    if (cp.songId) this.loadSongs().then(() => { const s = (this.state.songs || []).find(x => x.id === cp.songId); if (s && !this._cp.score) this.cpApplySong(s, cp.diff); });
  },

  /* 曲庫細節：台服／日服 master 的 musics（作詞曲編、分類）、musicVocals（誰唱）、outsideCharacters（站外歌手名）。
     歌曲清單本身用 App 的 loadSongs（有難度、Notes、封面素材名）。 */
  mkDbLoad() {
    if (this._mkDbP) return this._mkDbP;
    const j = u => fetch(u).then(r => r.ok ? r.json() : []).catch(() => []);
    this._mkDbP = Promise.all([this.tdbJson('musics.json').catch(() => []), this.tdbJson('musicVocals.json').catch(() => []), this.tdbJson('outsideCharacters.json').catch(() => []),
      j(JDB + '/musics.json'), j(JDB + '/musicVocals.json'), j(JDB + '/outsideCharacters.json')])
      .then(([ms, mv, oc, jms, jmv, joc]) => {
        const db = { tw: {}, jp: {}, vTw: {}, vJp: {}, ocTw: {}, ocJp: {}, ok: (ms.length + jms.length) > 0 };
        ms.forEach(m => { db.tw[m.id] = m; }); jms.forEach(m => { db.jp[m.id] = m; });
        mv.forEach(v => { (db.vTw[v.musicId] = db.vTw[v.musicId] || []).push(v); }); jmv.forEach(v => { (db.vJp[v.musicId] = db.vJp[v.musicId] || []).push(v); });
        oc.forEach(o => { db.ocTw[o.id] = o.name; }); joc.forEach(o => { db.ocJp[o.id] = o.name; });
        this._mkDb = db; this.setState({ mkDb: db.ok ? 1 : 2 }); return db;
      }).catch(() => { this._mkDbP = null; this.setState({ mkDb: 2 }); return null; });
    return this._mkDbP;
  },
  mkJpTitle(song) { const db = this._mkDb; const m = db && db.jp[song.id]; return (m && m.title) || song.title; },
  mkTwTitle(song) { return song.jp ? '' : song.title; },
  mkSongTitle(song, lang) { const jp = this.mkJpTitle(song), tw = this.mkTwTitle(song); return lang === 'tw' ? (tw || jp) : (jp || tw); },
  /* 選曲下拉：用 App 的歌曲清單（台服為主、日服補），日文／台服標題都找 */
  mkSearch(q, lang) {
    q = String(q || '').trim().toLowerCase(); if (!q) return [];
    const songs = this.state.songs || [], db = this._mkDb;
    return songs.filter(s => { const jp = db && db.jp[s.id] ? db.jp[s.id].title : ''; return String(s.title || '').toLowerCase().includes(q) || jp.toLowerCase().includes(q) || String(s.id) === q; }).slice(0, 12)
      .map(s => ({ id: s.id, t: this.mkSongTitle(s, lang), sub: (this.mkTwTitle(s) && this.mkTwTitle(s) !== this.mkJpTitle(s) ? this.mkTwTitle(s) + '・' : '') + '#' + s.id + (s.composer ? '・' + s.composer : ''), img: ASSET + '/music/jacket/' + s.jkt + '/' + s.jkt + '.webp', jp: !!s.jp }));
  },

  /* ===================== 模板資料與按鈕 ===================== */
  mkVals(s) {
    const out = {};
    if (s.page === 'songcard') Object.assign(out, this.scVals(s));
    if (s.page === 'chart') Object.assign(out, this.cpVals(s));
    return out;
  },

  /* ===================== 追加圖：狀態 ===================== */
  scSet(patch) {
    const sc = Object.assign({}, this.state.sc, patch);
    this.setState({ sc });
    try { localStorage.setItem('sekai-songcard-v1', JSON.stringify({ bg: sc.bg, lang: sc.lang, title: sc.title, lyr: sc.lyr, comp: sc.comp, arr: sc.arr, mv: sc.mv, append: sc.append, vs: sc.vs, unit: sc.unit, chars: sc.chars, extra: sc.extra, foot: sc.foot, seed: sc.seed })); } catch (e) {}
  },
  scRedraw() { clearTimeout(this._scD); this._scD = setTimeout(() => this.scDraw(), 30); },
  scVals(s) {
    const sc = s.sc || SC_DEF(), L = LBL[sc.lang] || LBL.jp;
    const chip = on => on ? { bg: 'var(--ink-grad)', fg: '#fff', bd: 'transparent' } : { bg: 'var(--card-2)', fg: 'var(--text-2)', bd: 'var(--border)' };
    const vsNames = []; const db = this._mkDb;
    if (db) { const list = (sc.songId && (db.vTw[sc.songId] || db.vJp[sc.songId])) || []; list.forEach(v => (v.characters || []).forEach(c => { const n = c.characterType === 'game_character' ? chName(c.characterId, sc.lang) : (sc.lang === 'tw' ? (db.ocTw[c.characterId] || db.ocJp[c.characterId]) : (db.ocJp[c.characterId] || db.ocTw[c.characterId])); if (n && !vsNames.includes(n)) vsNames.push(n); })); }
    this.scRedraw();
    return {
      scLangs: [['jp', '日文'], ['tw', '繁中']].map(([v, n]) => Object.assign({ v, n }, chip(sc.lang === v))),
      scQ: sc.q, scResults: this.mkSearch(sc.q, sc.lang), scHasResults: !!sc.q.trim(),
      scDbNote: !(s.songs || []).length ? (s.songErr || '曲庫載入中…') : s.mkDb === 2 ? '曲庫共 ' + s.songs.length + ' 首；作詞曲編與演唱者的細節抓不到，選曲只帶曲圖與曲名，其餘手填。' : s.mkDb ? '曲庫共 ' + s.songs.length + ' 首（台服 master 為主，日服補台服未實裝曲）。選一首就帶入；帶入後仍可逐項修改。' : '曲庫共 ' + s.songs.length + ' 首；作詞曲編與演唱者載入中…',
      scTitle: sc.title, scLyr: sc.lyr, scComp: sc.comp, scArr: sc.arr, scVs: sc.vs, scExtra: sc.extra, scFoot: sc.foot,
      scJacketName: sc.jacketLabel || '點這裡選擇曲圖', scJacketHas: !!this._sc.jacket, scTaint: !!sc.tainted,
      scLogoName: sc.logoLabel || '上傳團體標誌（可選）', scLogoHas: !!this._sc.logo,
      scMv: [['3d', '3D MV'], ['2d', '2D MV'], ['none', '沒有 MV']].map(([v, n]) => Object.assign({ v, n }, chip(sc.mv === v))),
      scAppend: !!sc.append,
      scVsChips: vsNames.map(n => Object.assign({ n }, chip(sc.vs.split(/[\n／/]+/).map(x => x.trim()).includes(n)))),
      scUnits: UNIT_ORDER.map(k => Object.assign({ v: k, n: sc.lang === 'tw' ? UNITS[k].tw : UNITS[k].jp }, chip(sc.unit === k))).concat([Object.assign({ v: '', n: '無' }, chip(!sc.unit))]),
      scChars: CH.map(c => Object.assign({ v: c[0], n: sc.lang === 'tw' ? c[2] : c[1], col: this.CHARA_COLOR[c[0]] || 'var(--border)' }, chip(sc.chars.includes(c[0])))),
      scBgImg: sc.bg !== 'draw',
      scHead: L.head,
      scKanaIn: sc.kanaIn || '', scKanaOut: toKatakana(sc.kanaIn || ''), scKanaHas: !!(sc.kanaIn || '').trim(),
      onScKanaIn: e => this.scSet({ kanaIn: e.target.value }),
      onScKanaApply: e => { const k = e.currentTarget.dataset.k, v = toKatakana(this.state.sc.kanaIn || '').trim(); if (!v) return; if (k === 'vs' || k === 'extra') { const cur = (this.state.sc[k] || '').trim(); this.scSet({ [k]: cur ? cur + '／' + v : v }); } else this.scSet({ [k]: v }); this._toast('已填到' + (k === 'title' ? '曲名' : k === 'vs' ? '原唱' : '其他演唱者')); },
      onScKanaCopy: () => { const v = toKatakana(this.state.sc.kanaIn || '').trim(); if (!v) return; try { navigator.clipboard.writeText(v).then(() => this._toast('已複製 ' + v)).catch(() => this._toast('這個瀏覽器不支援複製')); } catch (e) { this._toast('這個瀏覽器不支援複製'); } },
      onScLang: e => this.scSetLang(e.currentTarget.dataset.v),
      onScQ: e => this.scSet({ q: e.target.value }),
      onScPickSong: e => { const id = +e.currentTarget.dataset.id, song = (this.state.songs || []).find(x => x.id === id); if (song) this.scApplySong(song); },
      onScField: e => { const d = e.currentTarget.dataset; this.scSet({ [d.k]: e.target.value }); },
      onScChip: e => { const d = e.currentTarget.dataset; this.scSet({ [d.k]: d.v }); },
      onScAppend: e => this.scSet({ append: !!e.target.checked }),
      onScVsChip: e => { const n = e.currentTarget.dataset.n, list = this.state.sc.vs.split(/[\n／/]+/).map(x => x.trim()).filter(Boolean); const i = list.indexOf(n); if (i >= 0) list.splice(i, 1); else list.push(n); this.scSet({ vs: list.join('／') }); },
      onScChar: e => { const v = +e.currentTarget.dataset.v, cur = this.state.sc.chars.slice(); const i = cur.indexOf(v); if (i >= 0) cur.splice(i, 1); else cur.push(v); cur.sort((a, b) => a - b); const patch = { chars: cur }; if (!this.state.sc.unit && cur.length) { const cnt = {}; cur.forEach(id => { const u = unitOfChar(id); if (u && u !== 'vs') cnt[u] = (cnt[u] || 0) + 1; }); const u = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0]; if (u) patch.unit = u; } this.scSet(patch); },
      onScJacket: e => { const f = e.target.files && e.target.files[0]; if (f) this.scPickFile(f, 'jacket'); e.target.value = ''; },
      onScJacketClear: () => { this._sc.jacket = null; this._sc.song = null; this.scSet({ jacketLabel: '', tainted: false, songId: 0, imgV: this.state.sc.imgV + 1 }); },
      onScLogo: e => { const f = e.target.files && e.target.files[0]; if (f) this.scPickFile(f, 'logo'); e.target.value = ''; },
      onScLogoClear: () => { this._sc.logo = null; this.scSet({ logoLabel: '', imgV: this.state.sc.imgV + 1 }); },
      onScShuffle: () => this.scSet({ bg: 'draw', seed: (this.state.sc.seed * 31 + 7) % 100000 }),
      onScBgImg: () => this.scSet({ bg: 'img' }),
      onScSample: () => this.scSample(),
      onScReset: () => { this._sc.jacket = null; this._sc.logo = null; this._sc.song = null; this.scSet(Object.assign(SC_DEF(), { lang: this.state.sc.lang, imgV: this.state.sc.imgV + 1 })); },
      onScSave: () => this.scExport('save'),
      onScCopy: () => this.scExport('copy'),
      onScDragOver: e => { e.preventDefault(); e.currentTarget.style.outline = '3px solid var(--accent)'; },
      onScDragLeave: e => { e.currentTarget.style.outline = ''; },
      onScDrop: e => { e.preventDefault(); e.currentTarget.style.outline = ''; const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) this.scPickFile(f, 'jacket'); },
      scRef: el => { if (el && el !== this._scCanvas) { this._scCanvas = el; this.scDraw(); } },
    };
  },
  scSetLang(lang) {
    if (!LBL[lang]) return;
    const sc = this.state.sc, patch = { lang }, song = this._sc.song;
    if (song) { const v = this.scVocals(song, lang); patch.title = this.mkSongTitle(song, lang); patch.vs = v.vs.join('／'); if (v.sekai) patch.extra = v.sekai.extra.join('／'); }
    this.scSet(patch);
  },
  scPickFile(f, kind) {
    const url = URL.createObjectURL(f), im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      if (kind === 'logo') { this._sc.logo = im; this.scSet({ logoLabel: f.name, imgV: this.state.sc.imgV + 1 }); }
      else { this._sc.jacket = im; this._sc.song = null; this.scSet({ jacketLabel: f.name, tainted: false, songId: 0, imgV: this.state.sc.imgV + 1 }); }
    };
    im.onerror = () => { URL.revokeObjectURL(url); this._toast('圖片讀不進來'); };
    im.src = url;
  },
  /* 誰唱：虛擬歌手 ver.（沒有就用原曲）與 SEKAI ver.（團體依成員多數決） */
  scVocals(song, lang) {
    const db = this._mkDb || { vTw: {}, vJp: {}, ocTw: {}, ocJp: {} };
    const vl = (song.jp ? db.vJp[song.id] : (db.vTw[song.id] || db.vJp[song.id])) || [];
    const names = v => (v.characters || []).map(c => c.characterType === 'game_character' ? chName(c.characterId, lang) : (lang === 'tw' ? (db.ocTw[c.characterId] || db.ocJp[c.characterId]) : (db.ocJp[c.characterId] || db.ocTw[c.characterId])) || '').filter(Boolean);
    const vsE = vl.filter(v => v.musicVocalType === 'virtual_singer'), orig = vl.filter(v => v.musicVocalType === 'original_song'), sk = vl.filter(v => v.musicVocalType === 'sekai');
    const vs = []; (vsE.length ? vsE : orig).forEach(v => names(v).forEach(n => { if (!vs.includes(n)) vs.push(n); }));
    const k = sk[0] ? (() => { const ids = (sk[0].characters || []).filter(c => c.characterType === 'game_character').map(c => c.characterId); const cnt = {}; ids.forEach(id => { const u = unitOfChar(id); if (u && u !== 'vs') cnt[u] = (cnt[u] || 0) + 1; }); const unit = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || (ids.length ? 'vs' : ''); const extra = (sk[0].characters || []).filter(c => c.characterType === 'outside_character').map(c => (lang === 'tw' ? (db.ocTw[c.characterId] || db.ocJp[c.characterId]) : (db.ocJp[c.characterId] || db.ocTw[c.characterId])) || '').filter(Boolean); return { unit, ids, extra }; })() : null;
    return { vs, sekai: k };
  },
  scApplySong(song) {
    const sc = this.state.sc, lang = sc.lang, db = this._mkDb, m = (db && (db.tw[song.id] || db.jp[song.id])) || {};
    const cats = (m.categories || []).map(c => c.musicCategoryName);
    const v = this.scVocals(song, lang);
    const patch = { songId: song.id, q: '', title: this.mkSongTitle(song, lang), lyr: m.lyricist || '', comp: m.composer || song.composer || '', arr: m.arranger || '',
      append: !!(song.lv && song.lv.append), vs: v.vs.join('／'), unit: v.sekai ? v.sekai.unit : '', chars: v.sekai ? v.sekai.ids.slice() : [], extra: v.sekai ? v.sekai.extra.join('／') : '', logoLabel: '' };
    if (m.categories) patch.mv = cats.includes('mv') ? '3d' : cats.includes('mv_2d') ? '2d' : 'none';
    this._sc.logo = null; this._sc.song = song;
    this.scSet(patch);
    this.scLoadJacket(song);
  },
  scLoadJacket(song) {
    const abn = song.jkt || ('jacket_s_' + String(song.id).padStart(3, '0'));
    const tryUrl = (url, cors) => new Promise((res, rej) => { const im = new Image(); if (cors) im.crossOrigin = 'anonymous'; im.referrerPolicy = 'no-referrer'; im.onload = () => res(im); im.onerror = rej; im.src = url; });
    const urls = [JACKET(abn), JACKET_TC(abn)];
    (async () => {
      let im = null, tainted = false;
      for (const u of urls) { try { im = await tryUrl(u, true); break; } catch (e) {} }
      if (!im) for (const u of urls) { try { im = await tryUrl(u, false); tainted = true; break; } catch (e) {} }
      if (this._sc.song !== song) return;
      if (!im) { this._toast('曲圖抓不到，請自己上傳'); return; }
      this._sc.jacket = im; this.scSet({ jacketLabel: abn + '.png（素材鏡像）', tainted, imgV: this.state.sc.imgV + 1 });
    })();
  },
  scSample() {
    this._sc.jacket = null; this._sc.logo = null; this._sc.song = null;
    this.scSet({ lang: 'jp', songId: 0, q: '', title: 'FIRE BIRD', lyr: '上松範康（Elements Garden）', comp: '上松範康（Elements Garden）', arr: '藤永龍太郎（Elements Garden）', mv: '3d', append: true,
      vs: '夢ノ結唱 ROSE', unit: 'n25', chars: [17, 18, 19, 20, 21], extra: '', jacketLabel: '', logoLabel: '', tainted: false, imgV: this.state.sc.imgV + 1 });
    this._toast('已填入範例，曲圖請自己放');
  },
  scExport(mode) {
    const cv = this._scCanvas; if (!cv) return;
    if (this.state.sc.tainted) { this._toast('這張曲圖來自外站而且拿不到跨網域授權，無法匯出；改成上傳圖片檔就可以'); return; }
    this.scDraw();
    try {
      cv.toBlob(b => {
        if (!b) { this._toast('匯出失敗'); return; }
        if (mode === 'copy') {
          try { navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]).then(() => this._toast('已複製到剪貼簿')).catch(() => this._toast('這個瀏覽器不支援複製圖片，改用下載')); }
          catch (e) { this._toast('這個瀏覽器不支援複製圖片，改用下載'); }
          return;
        }
        const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'songcard-' + (this.state.sc.title || 'untitled').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) + '.png'; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 3000); this._toast('已下載 ' + a.download);
      }, 'image/png');
    } catch (e) { this._toast('匯出失敗：圖片來源不允許跨域使用'); }
  },

  /* ===================== 追加圖：畫 ===================== */
  scDraw() {
    const cv = this._scCanvas, sc = this.state.sc; if (!cv || !sc || this.state.page !== 'songcard') return;
    const ctx = cv.getContext('2d'), L = LBL[sc.lang] || LBL.jp, I = this._sc;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, 1920, 1080);
    const rr = (x, y, w, h, r) => { const rs = Array.isArray(r) ? r : [r, r, r, r]; ctx.beginPath(); ctx.moveTo(x + rs[0], y); ctx.lineTo(x + w - rs[1], y); ctx.quadraticCurveTo(x + w, y, x + w, y + rs[1]); ctx.lineTo(x + w, y + h - rs[2]); ctx.quadraticCurveTo(x + w, y + h, x + w - rs[2], y + h); ctx.lineTo(x + rs[3], y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - rs[3]); ctx.lineTo(x, y + rs[0]); ctx.quadraticCurveTo(x, y, x + rs[0], y); ctx.closePath(); };
    const fit = (text, maxW, px, min, w, fam) => { for (let s = px; s >= min; s--) { ctx.font = font(w, s, fam); if (ctx.measureText(text).width <= maxW) return s; } return min; };
    const wrapNames = (items, sep, maxW, px, min, w, fam, maxLines) => {
      for (let s = px; s >= min; s--) {
        ctx.font = font(w, s, fam); const lines = []; let cur = '';
        for (const it of items) { const t = cur ? cur + sep + it : it; if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = it; } }
        if (cur) lines.push(cur);
        if (lines.length <= maxLines && lines.every(l => ctx.measureText(l).width <= maxW)) return { lines, size: s };
        if (s === min) return { lines: lines.slice(0, maxLines), size: s };
      }
      return { lines: [items.join(sep)], size: min };
    };
    /* 底：官方公告圖原檔壓成鋼藍灰；載不到或選自繪才畫 */
    if (sc.bg !== 'draw' && I.bgReady && I.bg.naturalWidth) {
      ctx.save(); try { ctx.filter = 'saturate(.6) brightness(.9)'; } catch (e) {}
      ctx.drawImage(I.bg, 0, 0, 1920, 1080); ctx.restore();
      ctx.fillStyle = 'rgba(58,60,92,.38)'; ctx.fillRect(0, 0, 1920, 1080);
    } else {
      const g = ctx.createLinearGradient(0, 0, 1920, 1080);
      g.addColorStop(0, '#5d6189'); g.addColorStop(.32, '#414e70'); g.addColorStop(.68, '#3c4a6f'); g.addColorStop(1, '#5b5a90');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 1920, 1080);
      const glow = (x, y, r, col) => { const gg = ctx.createRadialGradient(x, y, 0, x, y, r); gg.addColorStop(0, col); gg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gg; ctx.fillRect(0, 0, 1920, 1080); };
      glow(60, 1040, 980, 'rgba(150,160,232,.42)'); glow(1920, 1080, 560, 'rgba(150,115,210,.36)'); glow(0, 0, 460, 'rgba(140,118,176,.34)'); glow(1920, 100, 420, 'rgba(60,110,150,.28)');
      const rnd = mulberry(sc.seed * 7919 + 13);
      const tri = (x, y, sz, rot) => { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.beginPath(); ctx.moveTo(0, -sz * .62); ctx.lineTo(sz * .56, sz * .38); ctx.lineTo(-sz * .56, sz * .38); ctx.closePath(); ctx.restore(); };
      ctx.save(); try { ctx.filter = 'blur(22px)'; } catch (e) {}
      [[-60, 420, 760, .55, .09], [300, 1180, 900, -2.3, .1], [1400, -80, 760, 2.4, .07], [1780, 760, 620, .9, .08], [1120, 980, 520, -.6, .06]].forEach(([x, y, sz, rot, a]) => { tri(x, y, sz, rot); ctx.fillStyle = 'rgba(255,255,255,' + a + ')'; ctx.fill(); });
      ctx.restore();
      const dots = (x0, y, x1) => { ctx.fillStyle = 'rgba(255,255,255,.28)'; for (let x = x0; x < x1; x += 11) ctx.fillRect(x, y, 5, 2); };
      dots(1270, 96, 1900); dots(1430, 1004, 1900); dots(60, 1040, 420);
      ctx.lineWidth = 3;
      [[1702, 100, 46, .32], [1622, 648, 42, .26], [1120, 500, 70, .13], [1870, 940, 36, .2]].forEach(([x, y, r, a]) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.stroke(); });
      [[1892, 24, 54, .35, .28], [1250, 650, 44, .6, .16], [1830, 560, 30, .4, .22]].forEach(([x, y, sz, rot, a]) => { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.strokeRect(-sz / 2, -sz / 2, sz, sz); ctx.restore(); });
      const cols = ['140,232,240', '240,130,205', '255,255,255', '255,255,255', '190,170,255'];
      for (let i = 0; i < 30; i++) {
        const x = rnd() * 1920, y = rnd() * 1080, sz = 22 + rnd() * 120, col = cols[(rnd() * cols.length) | 0], a = .07 + rnd() * .16, kind = rnd();
        if (kind < .62) tri(x, y, sz, rnd() * 6.28);
        else if (kind < .8) { ctx.beginPath(); ctx.arc(x, y, sz * .4, 0, 6.3); }
        else { ctx.save(); ctx.translate(x, y); ctx.rotate(rnd() * 6.28); ctx.beginPath(); ctx.rect(-sz * .35, -sz * .35, sz * .7, sz * .7); ctx.restore(); }
        if (rnd() < .4) { ctx.strokeStyle = 'rgba(' + col + ',' + (a + .1) + ')'; ctx.lineWidth = 3; ctx.stroke(); }
        else { ctx.fillStyle = 'rgba(' + col + ',' + a + ')'; ctx.fill(); }
      }
      for (let i = 0; i < 70; i++) { const x = rnd() * 1920, y = rnd() * 1080, r = 1 + rnd() * 2.2; ctx.fillStyle = 'rgba(255,255,255,' + (.1 + rnd() * .25) + ')'; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill(); }
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) { const x = 200 + rnd() * 1700; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - 560, 1080); ctx.stroke(); }
    }
    /* 曲圖 */
    { const x = 65, y = 55, w = 680;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 14; ctx.fillStyle = '#1b1a30'; ctx.fillRect(x, y, w, w); ctx.restore();
      if (I.jacket) { const im = I.jacket, s = Math.max(w / im.naturalWidth, w / im.naturalHeight), sw = w / s, sh = w / s, sx = (im.naturalWidth - sw) / 2, sy = (im.naturalHeight - sh) / 2; ctx.drawImage(im, sx, sy, sw, sh, x, y, w, w); }
      else {
        const g = ctx.createLinearGradient(x, y, x + w, y + w); g.addColorStop(0, '#5a4f8f'); g.addColorStop(1, '#2e2b55'); ctx.fillStyle = g; ctx.fillRect(x, y, w, w);
        ctx.save(); ctx.setLineDash([16, 12]); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 4; ctx.strokeRect(x + 22, y + 22, w - 44, w - 44); ctx.restore();
        ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = font('900', 64, F_SANS); ctx.fillText('曲圖', x + w / 2, y + w / 2 - 20); ctx.font = font('700', 26, F_SANS); ctx.fillText('上傳、拖進來或 Ctrl+V 貼上', x + w / 2, y + w / 2 + 40);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      }
    }
    /* 標頭：音符圖示＋漸層字 */
    { const cx = 835, cy = 97;
      const g = ctx.createLinearGradient(cx - 32, cy - 32, cx + 32, cy + 32); g.addColorStop(0, '#8ff0ee'); g.addColorStop(1, '#f4a6d2');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 30, 0, 6.3); ctx.fill();
      ctx.fillStyle = '#2a2850'; ctx.beginPath(); ctx.arc(cx, cy, 24, 0, 6.3); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = font('800', 34, F_ROUND); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('♪', cx + 1, cy + 1);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.font = font('800', 72, F_ROUND);
      const tg = ctx.createLinearGradient(885, 0, 885 + ctx.measureText(L.head).width, 0); tg.addColorStop(0, '#a7f5f2'); tg.addColorStop(1, '#ffc3e4');
      ctx.save(); ctx.lineJoin = 'round'; ctx.strokeStyle = '#262349'; ctx.lineWidth = 10; ctx.strokeText(L.head, 885, 122); ctx.restore();
      ctx.fillStyle = tg; ctx.fillText(L.head, 885, 122);
    }
    /* 曲名 */
    rr(760, 150, 1120, 170, 8); ctx.fillStyle = 'rgba(50,50,74,.86)'; ctx.fill();
    { const t = sc.title || '曲名', size = fit(t, 1040, 92, 40, '900', F_SANS);
      ctx.font = font('900', size); ctx.fillStyle = sc.title ? '#fff' : 'rgba(255,255,255,.35)'; ctx.textBaseline = 'middle'; ctx.fillText(t, 812, 237); ctx.textBaseline = 'alphabetic'; }
    /* 作詞曲編 */
    rr(760, 335, 1120, 255, 8); ctx.fillStyle = 'rgba(88,90,140,.55)'; ctx.fill();
    [[L.lyr, sc.lyr], [L.comp, sc.comp], [L.arr, sc.arr]].forEach(([k, v], i) => {
      const y = 390 + i * 74; ctx.textBaseline = 'middle';
      ctx.font = font('900', 46); ctx.fillStyle = '#fff'; ctx.fillText(k, 808, y);
      ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillRect(928, y - 26, 3, 52);
      const txt = v || '—', size = fit(txt, 900, 46, 24, '700', F_SANS);
      ctx.font = font('700', size); ctx.fillStyle = v ? '#fff' : 'rgba(255,255,255,.35)'; ctx.fillText(txt, 952, y); ctx.textBaseline = 'alphabetic';
    });
    /* MV 與 APPEND 徽章 */
    { const on = sc.mv !== 'none', col = sc.mv === '2d' ? '#1fb5c9' : '#f0518c', grey = '#b9b7cb';
      rr(808, 618, 120, 110, 12); ctx.fillStyle = on ? '#fff' : 'rgba(255,255,255,.55)'; ctx.fill(); ctx.strokeStyle = on ? col : grey; ctx.lineWidth = 5; ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (on) { ctx.font = font('900', 44, F_SANS); ctx.fillStyle = col; ctx.fillText(sc.mv === '2d' ? '2D' : '3D', 868, 648); }
      const fy = on ? 690 : 673, fcol = on ? col : grey;   // 底片格
      ctx.strokeStyle = fcol; ctx.lineWidth = 4; rr(838, fy - 16, 60, 32, 5); ctx.stroke(); ctx.fillStyle = fcol; for (let i = 0; i < 4; i++) { ctx.fillRect(846 + i * 13, fy - 10, 7, 6); ctx.fillRect(846 + i * 13, fy + 4, 7, 6); }
      if (!on) { ctx.strokeStyle = grey; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(830, 640); ctx.lineTo(906, 708); ctx.stroke(); }
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      if (sc.append) { const cx = 1008, cy = 673, r = 56;
        const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r); g.addColorStop(0, '#7d6bf2'); g.addColorStop(1, '#f582cf');
        ctx.beginPath(); ctx.arc(cx, cy, r + 5, 0, 6.3); ctx.fillStyle = g; ctx.fill();
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.3); ctx.fillStyle = '#fff'; ctx.fill();
        ctx.font = font('900', 26, F_SANS); const tg = ctx.createLinearGradient(cx - 46, 0, cx + 46, 0); tg.addColorStop(0, '#6c5de8'); tg.addColorStop(1, '#e864c0');
        ctx.fillStyle = tg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(L.append, cx, cy + 1); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; }
    }
    /* 兩個演唱框 */
    const tab = (x, w, text, noteCol) => {
      rr(x, 760, w, 70, [10, 10, 0, 0]); ctx.fillStyle = 'rgba(50,50,78,.94)'; ctx.fill();
      ctx.fillStyle = noteCol; ctx.font = font('800', 34, F_ROUND); ctx.textBaseline = 'middle'; ctx.fillText('♪', x + 32, 796);
      const size = fit(text, w - 110, 34, 20, '800', F_ROUND); ctx.font = font('800', size, F_ROUND); ctx.fillStyle = '#fff'; ctx.fillText(text, x + 80, 796); ctx.textBaseline = 'alphabetic';
    };
    const vsItems = sc.vs.split(/[\n／/]+/).map(x => x.trim()).filter(Boolean);
    const skNames = sc.chars.map(id => chName(id, sc.lang)).filter(Boolean).concat(sc.extra.split(/[\n／/]+/).map(x => x.trim()).filter(Boolean));
    const hasSk = skNames.length > 0 || !!sc.unit || !!I.logo;
    const vw = hasSk ? 775 : 1815;
    tab(65, 495, L.vs, '#8ff0ee');
    rr(65, 830, vw, 195, [0, 10, 10, 10]); ctx.fillStyle = '#74e1d5'; ctx.fill();
    { const w1 = wrapNames(vsItems.length ? vsItems : ['—'], ' / ', vw - 80, 42, 24, '700', F_SANS, 3);
      ctx.fillStyle = vsItems.length ? '#1f3548' : 'rgba(31,53,72,.5)'; ctx.font = font('700', w1.size); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const lh = w1.size * 1.3, y0 = 927 - ((w1.lines.length - 1) * lh) / 2; w1.lines.forEach((l, i) => ctx.fillText(l, 65 + vw / 2, y0 + i * lh)); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; }
    if (hasSk) {
      tab(865, 485, L.sk, '#f4a6d2');
      rr(865, 830, 1015, 195, [0, 10, 10, 10]); ctx.fillStyle = '#ee74a6'; ctx.fill();
      const im = I.logo || this.scUnitLogo(sc.unit), hasLogo = !!(im || sc.unit), tx = hasLogo ? 1245 : 905, maxW = 1880 - tx - 30;
      if (im) { const bw = 320, bh = 124, k = Math.min(bw / im.naturalWidth, bh / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k; ctx.drawImage(im, 1058 - w / 2, 927 - h / 2, w, h); }
      else if (sc.unit) { const u = UNITS[sc.unit], name = sc.lang === 'tw' ? u.tw : u.jp, g = ctx.createLinearGradient(988, 887, 1128, 967); g.addColorStop(0, u.c); g.addColorStop(1, u.c2);
        const w = wrapNames(name.split(/(?<=[、，・×])|(?=[、，・×])/).filter(Boolean), '', 128, 30, 16, '800', F_ROUND, 3), lh = w.size * 1.15, h = w.lines.length * lh + 26;
        rr(980, 927 - h / 2, 156, h, 14); ctx.fillStyle = g; ctx.fill();
        ctx.save(); ctx.lineJoin = 'round'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = font('800', w.size, F_ROUND);
        w.lines.forEach((l, i) => { const y = 927 - ((w.lines.length - 1) * lh) / 2 + i * lh; ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = 5; ctx.strokeText(l, 1058, y); ctx.fillStyle = '#fff'; ctx.fillText(l, 1058, y); });
        ctx.restore(); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; }
      const w2 = wrapNames(skNames.length ? skNames : ['—'], ' / ', maxW, 36, 22, '700', F_SANS, 3);
      ctx.fillStyle = skNames.length ? '#2b2140' : 'rgba(43,33,64,.5)'; ctx.font = font('700', w2.size); ctx.textBaseline = 'middle';
      const lh2 = w2.size * 1.4, y1 = 927 - ((w2.lines.length - 1) * lh2) / 2; w2.lines.forEach((l, i) => ctx.fillText(l, tx, y1 + i * lh2)); ctx.textBaseline = 'alphabetic';
    }
    /* 底部 */
    ctx.save(); ctx.font = font('700', 44, F_ROUND); ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillText('P J : S E K A I', 65, 1064); ctx.restore();
    if (sc.foot) { ctx.font = font('700', 20); ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.textAlign = 'right'; ctx.fillText(sc.foot, 1880, 1066); ctx.textAlign = 'left'; }
  },
  scUnitLogo(k) {
    const u = UNITS[k]; if (!u) return null;
    let im = this._sc.units[k];
    if (!im) { im = this._sc.units[k] = new Image(); im.onload = () => { if (this.state.sc && this.state.sc.unit === k) this.scRedraw(); }; im.src = u.logo; }
    return im.complete && im.naturalWidth ? im : null;
  },

  /* ===================== 譜面預覽：狀態 ===================== */
  cpSet(patch) {
    const cp = Object.assign({}, this.state.cp, patch);
    this.setState({ cp });
    try { localStorage.setItem('sekai-chart-v1', JSON.stringify({ lang: cp.lang, mpc: cp.mpc, combo: cp.combo, bpm: cp.bpm, skill: cp.skill, zoom: cp.zoom, songId: cp.songId, diff: cp.diff })); } catch (e) {}
  },
  cpRedraw() { clearTimeout(this._cpD); this._cpD = setTimeout(() => this.cpRender(), 30); },
  cpVals(s) {
    const cp = s.cp || CP_DEF(), C = this._cp;
    const chip = (on, c) => on ? { bg: c || 'var(--ink-grad)', fg: '#fff', bd: 'transparent' } : { bg: 'var(--card-2)', fg: 'var(--text-2)', bd: 'var(--border)' };
    const song = C.song;
    const key = [cp.mpc, cp.combo, cp.bpm, cp.skill, cp.lang, cp.v, cp.customTitle, C.score ? 1 : 0].join('|');
    if (key !== C.drawKey) { C.drawKey = key; this.cpRedraw(); }
    return {
      cpLangs: [['jp', '日文'], ['tw', '繁中']].map(([v, n]) => Object.assign({ v, n }, chip(cp.lang === v))),
      cpQ: cp.q, cpResults: this.mkSearch(cp.q, cp.lang), cpHasResults: !!cp.q.trim(),
      cpDbNote: !(s.songs || []).length ? (s.songErr || '曲庫載入中…') : '曲庫共 ' + s.songs.length + ' 首（台服 master 為主，日服補台服未實裝曲）。譜面檔來自素材鏡像的官方 SUS。',
      cpDiffHint: song ? this.mkSongTitle(song, cp.lang) : '先選一首歌',
      cpDiffs: DIFFS.map(d => { const lv = song && song.lv && song.lv[d], nt = song && song.nt && song.nt[d]; const has = !song || lv != null; return Object.assign({ v: d, n: d.toUpperCase(), sub: lv != null ? 'Lv.' + lv + (nt ? '・' + nt : '') : '', dis: !has, col: DIFF_COL[d] }, chip(!!song && d === C.diff && !C.custom, DIFF_COL[d])); }),
      cpWarn: cp.warn, cpHasWarn: !!cp.warn,
      cpMpc: MPC.map(n => Object.assign({ v: n, n: String(n) }, chip(cp.mpc === n))),
      cpCombo: !!cp.combo, cpBpm: !!cp.bpm, cpSkill: !!cp.skill,
      cpSusName: cp.susName || '選擇 .sus 或 .txt 譜面檔', cpCustomTitle: cp.customTitle,
      cpCanvasStyle: cp.zoom === 'zoom' ? 'width:auto;height:auto;max-width:none;display:block' : 'width:100%;height:auto;display:block', cpZoomLabel: cp.zoom === 'zoom' ? '符合視窗寬度' : '原尺寸檢視',
      cpBusy: !!cp.busy, cpHasChart: !!C.score,
      onCpLang: e => { const lang = e.currentTarget.dataset.v; if (C.song) C.title = this.mkSongTitle(C.song, lang); this.cpSet({ lang }); },
      onCpQ: e => this.cpSet({ q: e.target.value }),
      onCpPickSong: e => { const id = +e.currentTarget.dataset.id, song = (this.state.songs || []).find(x => x.id === id); if (song) this.cpApplySong(song, this.state.cp.diff); },
      onCpDiff: e => { const d = e.currentTarget.dataset.v; if (C.song) this.cpApplySong(C.song, d); else this.cpSet({ diff: d }); },
      onCpMpc: e => this.cpSet({ mpc: +e.currentTarget.dataset.v }),
      onCpToggle: e => { const d = e.currentTarget.dataset; this.cpSet({ [d.k]: !!e.target.checked }); },
      onCpZoom: () => this.cpSet({ zoom: this.state.cp.zoom === 'zoom' ? 'fit' : 'zoom' }),
      onCpCustomTitle: e => { const v = e.target.value; if (C.custom) C.title = v.trim() || (C.score && C.score.meta.TITLE) || '自訂譜面'; this.cpSet({ customTitle: v }); },
      onCpSus: e => { const f = e.target.files && e.target.files[0]; if (f) this.cpReadFile(f); e.target.value = ''; },
      onCpDragOver: e => { e.preventDefault(); e.currentTarget.style.outline = '3px solid var(--accent)'; },
      onCpDragLeave: e => { e.currentTarget.style.outline = ''; },
      onCpDrop: e => { e.preventDefault(); e.currentTarget.style.outline = ''; const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) this.cpReadFile(f); },
      onCpDemo: () => this.cpDemo(),
      onCpReset: () => { Object.assign(C, { score: null, chart: null, song: null, jacket: null, custom: false, diff: '', level: 0, officialNotes: 0, drawKey: '' }); this.cpSet({ songId: 0, q: '', warn: '', susName: '', v: this.state.cp.v + 1 }); },
      onCpPng: () => this.cpExport('image/png'),
      onCpJpg: () => this.cpExport('image/jpeg'),
      cpRef: el => { if (el && el !== this._cpCanvas) { this._cpCanvas = el; C.drawKey = ''; this.cpRedraw(); } },
    };
  },
  cpReadFile(f) {
    const rd = new FileReader();
    rd.onload = () => { if (this.cpLoadSus(String(rd.result))) { this.cpSet({ susName: f.name }); this._toast('已載入 ' + f.name); } };
    rd.readAsText(f);
  },
  async cpApplySong(song, diff) {
    const C = this._cp, avail = DIFFS.filter(d => song.lv && song.lv[d] != null);
    if (!avail.length) { this._toast('這首沒有難度資料'); return; }
    if (!avail.includes(diff)) diff = avail.includes('master') ? 'master' : avail[avail.length - 1];
    const my = ++C.req;
    Object.assign(C, { song, diff, level: song.lv[diff], officialNotes: (song.nt && song.nt[diff]) || 0, custom: false, title: this.mkSongTitle(song, this.state.cp.lang), artist: song.composer || '' });
    this.cpSet({ songId: song.id, diff, q: '', warn: '', busy: true });
    let text = '';
    try { const r = await fetch(SCORE(song.id, diff)); if (!r.ok) throw new Error('HTTP ' + r.status); text = await r.text(); }
    catch (e) { if (my !== C.req) return; this.cpSet({ busy: false, warn: '抓不到這首的 ' + diff.toUpperCase() + ' 譜面檔（' + ((e && e.message) || e) + '）。可能還沒上素材鏡像，或瀏覽器擋了跨網域請求。' }); return; }
    if (my !== C.req) return;
    this.cpLoadSus(text, { keepSong: true });
    this.cpSet({ busy: false });
    const abn = song.jkt || ('jacket_s_' + String(song.id).padStart(3, '0'));
    const tryUrl = url => new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.referrerPolicy = 'no-referrer'; im.onload = () => res(im); im.onerror = rej; im.src = url; });
    let im = null; for (const u of [JACKET(abn), JACKET_TC(abn)]) { try { im = await tryUrl(u); break; } catch (e) {} }
    if (my !== C.req) return;
    C.jacket = im; C.drawKey = ''; this.cpRedraw();
  },
  cpLoadSus(text, opt) {
    opt = opt || {}; const C = this._cp;
    let sc; try { sc = parseSus(text); } catch (e) { this._toast('譜面檔讀不懂：' + ((e && e.message) || e)); return false; }
    if (!sc.taps.length && !sc.slides.length) { this._toast('這個檔裡沒有音符'); return false; }
    C.score = sc; C.chart = buildChart(sc);
    if (!opt.keepSong) {
      Object.assign(C, { song: null, custom: true, diff: opt.diff || '', level: 0, officialNotes: 0, jacket: null, req: C.req + 1,
        title: opt.title || (this.state.cp.customTitle || '').trim() || sc.meta.TITLE || '自訂譜面', artist: opt.artist || sc.meta.ARTIST || '' });
      this.cpSet({ songId: 0, warn: '', v: this.state.cp.v + 1 });
    } else this.cpSet({ v: this.state.cp.v + 1 });
    C.drawKey = ''; this.cpRedraw(); return true;
  },
  cpDemo() { this.cpLoadSus(DEMO, { title: '範例譜面', artist: 'SEKAI 資源中心', diff: 'master' }); this.cpSet({ q: '', susName: '' }); this._toast('這是手寫的小段範例，各種音符都有一個'); },
  cpExport(type) {
    const cv = this._cpCanvas, C = this._cp; if (!cv || !C.score) { this._toast('還沒有譜面'); return; }
    const name = (C.song ? 'chart-' + C.song.id + '-' + C.diff : 'chart-' + (C.title || 'custom').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40)) + (type === 'image/jpeg' ? '.jpg' : '.png');
    try { cv.toBlob(b => { if (!b) { this._toast('匯出失敗'); return; } const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); this._toast('已下載 ' + name); }, type, .92); }
    catch (e) { this._toast('匯出失敗'); }
  },

  /* ===================== 譜面預覽：畫 ===================== */
  cpRender() {
    const cv = this._cpCanvas, C = this._cp, cp = this.state.cp; if (!cv || !cp || this.state.page !== 'chart') return;
    const ctx = cv.getContext('2d');
    const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
    const fitText = (t, maxW, px, min, w, fam) => { for (let s = px; s >= min; s--) { ctx.font = font(w, s, fam); if (ctx.measureText(t).width <= maxW) return s; } return min; };
    const sc = C.score, ch = C.chart;
    if (!sc) {
      cv.width = 1200; cv.height = 500; ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#171a2b'; ctx.fillRect(0, 0, 1200, 500);
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = font('800', 34, F_ROUND); ctx.fillText('選一首歌與難度，或上傳 SUS 譜面檔', 600, 230);
      ctx.font = font('500', 18); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillText('也可以先按「看範例譜面」看看長什麼樣', 600, 280);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; return;
    }
    /* 版面：每欄 mpc 小節，時間由下往上；超過 iOS canvas 面積上限就整張縮小 */
    const cols = []; const ms = sc.measures;
    for (let i = 0; i < ms.length; i += cp.mpc) { const part = ms.slice(i, i + cp.mpc); cols.push({ ms: part, t0: part[0].start, t1: part[part.length - 1].start + part[part.length - 1].len }); }
    const span = Math.max(...cols.map(c => c.t1 - c.t0)), colH = span * BH / sc.tpb, CW = GL + NL * LW + GR, laneW = NL * LW, k = BH / sc.tpb;
    const W = PAD * 2 + cols.length * CW + (cols.length - 1) * GAP, H = HEAD + 18 + colH + 30 + FOOT_H;
    const SC = Math.min(1, Math.sqrt(16e6 / (W * H)));
    cv.width = Math.round(W * SC); cv.height = Math.round(H * SC);
    ctx.setTransform(SC, 0, 0, SC, 0, 0);
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#191c30'); g.addColorStop(1, '#141726');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    /* 標頭 */
    { const jx = PAD, jy = 22, js = 130;
      rr(jx, jy, js, js, 12); ctx.fillStyle = '#2a2f4a'; ctx.fill();
      if (C.jacket) { ctx.save(); rr(jx, jy, js, js, 12); ctx.clip(); ctx.drawImage(C.jacket, jx, jy, js, js); ctx.restore(); }
      else { ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.font = font('800', 40, F_ROUND); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('♪', jx + js / 2, jy + js / 2); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; }
      const tx = jx + js + 26;
      const legend = [['點擊', COL.tap], ['關鍵', COL.crit], ['滑鍵', COL.flick], ['軌跡', COL.traceTap], ['長條', COL.slide], ['引導線', 'rgba(165,200,255,.8)']];
      ctx.font = font('500', 15); let lw = 0; legend.forEach(([t]) => { lw += ctx.measureText(t).width + 26 + 18; });
      let lx = W - PAD - lw; const ly = 44;
      legend.forEach(([t, c]) => { rr(lx, ly - 7, 26, 14, 5); ctx.fillStyle = c; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.fillStyle = '#c9cde0'; ctx.textBaseline = 'middle'; ctx.fillText(t, lx + 32, ly + 1); lx += ctx.measureText(t).width + 26 + 18; });
      ctx.textBaseline = 'alphabetic';
      const diff = C.diff || 'custom', label = (DIFFS.includes(diff) ? diff.toUpperCase() : 'CUSTOM') + (C.level ? ' ' + C.level : '');
      ctx.font = font('800', 24, F_ROUND); const bw = ctx.measureText(label).width + 34;
      rr(tx, 30, bw, 42, 21); ctx.fillStyle = DIFF_COL[diff] || '#8b93ac'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(label, tx + 17, 52); ctx.textBaseline = 'alphabetic';
      const title = (C.title || '（未命名）') + (C.artist ? ' - ' + C.artist : '');
      const maxW = Math.max(300, W - tx - PAD - (W > 1400 ? lw + 30 : 0));
      const ts = fitText(title, maxW, 44, 22, '900', F_SANS);
      ctx.font = font('900', ts, F_SANS); ctx.fillStyle = '#fff'; ctx.fillText(title, tx, 121);
      const bpmList = []; sc.bpms.forEach(b => { if (!bpmList.includes(b.bpm)) bpmList.push(b.bpm); });
      const bpmText = bpmList.length > 1 ? Math.min(...bpmList) + '–' + Math.max(...bpmList) : String(bpmList[0] || '—');
      const last = ch.judged.length ? ch.judged[ch.judged.length - 1] : 0, sec = Math.round(secondsAt(sc, last));
      const dur = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
      const parts = ['Notes ' + ch.total + (C.officialNotes && C.officialNotes !== ch.total ? '（官方 ' + C.officialNotes + '）' : ''), 'BPM ' + bpmText, sc.measures.length + ' 小節', '長度 ' + dur, '每欄 ' + cp.mpc + ' 小節'];
      ctx.font = font('500', 19); ctx.fillStyle = '#aab0cc'; ctx.fillText(parts.join('　·　'), tx, 158);
    }
    /* 頁尾 */
    { const y = H - 18, a = 'project-sekai-center.com／譜面預覽產生器　·　版面參考 pjsekai.moe', b = '譜面資料 © SEGA / Colorful Palette / Crypton Future Media　·　僅供學習與交流';
      ctx.font = font('500', 15); ctx.fillStyle = '#7f86a6';
      const two = ctx.measureText(a).width + ctx.measureText(b).width + 40 > W - PAD * 2;
      ctx.fillText(a, PAD, two ? y - 20 : y); ctx.textAlign = 'right'; ctx.fillText(b, W - PAD, y); ctx.textAlign = 'left'; }
    /* 各欄 */
    cols.forEach((col, i) => {
      const x = PAD + i * (CW + GAP), lx = x + GL, top = HEAD + 18, bottom = top + colH;
      const y = t => bottom - (t - col.t0) * k, colTop = y(col.t1);
      ctx.fillStyle = '#0c0f1e'; ctx.fillRect(lx, colTop, laneW, bottom - colTop);
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.07)';
      for (let l = 1; l < NL; l++) { ctx.beginPath(); ctx.moveTo(lx + l * LW + .5, colTop); ctx.lineTo(lx + l * LW + .5, bottom); ctx.stroke(); }
      ctx.font = font('700', 13); ctx.textBaseline = 'alphabetic';
      for (const m of col.ms) {
        const beats = Math.max(1, Math.round(m.len / sc.tpb));
        for (let b = 0; b < beats; b++) {
          const ty = Math.round(y(m.start + b * sc.tpb)) + .5;
          ctx.beginPath(); ctx.moveTo(lx, ty); ctx.lineTo(lx + laneW, ty);
          if (b === 0) { ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1;
            if (cp.combo) { ctx.fillStyle = '#dfe3f5'; ctx.textAlign = 'right'; ctx.fillText(String(m.m + 1), lx - 8, ty - 4); const c = comboBefore(ch.judged, m.start); if (c > 0) { ctx.fillStyle = '#aab0cc'; ctx.textAlign = 'left'; ctx.fillText(String(c), lx + laneW + 8, ty - 4); } ctx.textAlign = 'left'; }
          } else { ctx.strokeStyle = 'rgba(255,255,255,.13)'; ctx.stroke(); }
        }
      }
      if (cp.combo && i === cols.length - 1) { const ty = Math.round(colTop) + .5; ctx.fillStyle = '#ffd166'; ctx.textAlign = 'left'; ctx.fillText(String(ch.total), lx + laneW + 8, ty + 15); }
      ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 1; ctx.strokeRect(lx + .5, Math.round(colTop) + .5, laneW - 1, Math.round(bottom - colTop) - 1);
      const inCol = t => t >= col.t0 && t < col.t1;
      if (cp.bpm) { ctx.font = font('700', 12); sc.bpms.forEach((b, bi) => { if (!inCol(b.tick) && !(bi === 0 && i === 0)) return; const ty = Math.round(y(Math.max(b.tick, col.t0))) + .5; ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(255,209,102,.7)'; ctx.beginPath(); ctx.moveTo(lx, ty); ctx.lineTo(lx + laneW, ty); ctx.stroke(); ctx.restore(); ctx.fillStyle = '#ffd166'; ctx.textAlign = 'left'; ctx.fillText('BPM ' + b.bpm, lx + laneW + 8, ty + 14); }); }
      if (cp.skill) { ctx.font = font('700', 12); ch.skills.forEach(t => { if (!inCol(t)) return; const ty = Math.round(y(t)) + .5; ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(140,240,238,.75)'; ctx.beginPath(); ctx.moveTo(lx, ty); ctx.lineTo(lx + laneW, ty); ctx.stroke(); ctx.restore(); ctx.fillStyle = '#8ff0ee'; ctx.textAlign = 'right'; ctx.fillText('SKILL', lx - 8, ty + 14); ctx.textAlign = 'left'; }); }
      ctx.save(); ctx.beginPath(); ctx.rect(lx - 3, colTop - 26, laneW + 6, bottom - colTop + 52); ctx.clip();
      const slack = sc.tpb, overlaps = o => o.t1 >= col.t0 - slack && o.t0 <= col.t1 + slack;
      const xl = c => lx + (c.lane - 2) * LW, xr = c => lx + (c.lane - 2 + c.width) * LW;
      const band = (o, kind) => {
        const J = o.joints, seg = (a, b, side, rev) => {
          const f = EASE[a.ease] || EASE.linear, ya = y(a.tick), yb = y(b.tick), n = Math.max(2, Math.ceil(Math.abs(yb - ya) / 6));
          const xa = side === 'l' ? xl(a) + 1 : xr(a) - 1, xb = side === 'l' ? xl(b) + 1 : xr(b) - 1;
          for (let s = 0; s <= n; s++) { const p = (rev ? n - s : s) / n, e = f(p); ctx.lineTo(xa + (xb - xa) * e, ya + (yb - ya) * p); }
        };
        ctx.beginPath(); ctx.moveTo(xl(J[0]) + 1, y(J[0].tick));
        for (let j = 0; j < J.length - 1; j++) seg(J[j], J[j + 1], 'l', false);
        for (let j = J.length - 1; j > 0; j--) seg(J[j - 1], J[j], 'r', true);
        ctx.closePath(); ctx.fillStyle = BAND[kind][0]; ctx.fill(); ctx.strokeStyle = BAND[kind][1]; ctx.lineWidth = 1.5; ctx.stroke();
      };
      const posAt = (o, t) => { const J = o.joints; for (let j = 0; j < J.length - 1; j++) { const a = J[j], b = J[j + 1]; if (t >= a.tick - 1e-6 && t <= b.tick + 1e-6) { const p = b.tick > a.tick ? (t - a.tick) / (b.tick - a.tick) : 0, e = (EASE[a.ease] || EASE.linear)(p); return [xl(a) + (xl(b) - xl(a)) * e, xr(a) + (xr(b) - xr(a)) * e]; } } const a = J[J.length - 1]; return [xl(a), xr(a)]; };
      const diamond = (cx, cy, r, color, border) => { ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = border || 'rgba(255,255,255,.95)'; ctx.lineWidth = 1.5; ctx.stroke(); };
      const note = (x0, x1, yc, color, thin) => { const h = thin ? 7 : NH; rr(x0 + 1.5, yc - h / 2, x1 - x0 - 3, h, thin ? 3 : 5); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = thin ? 1.2 : 2; ctx.stroke(); if (thin) diamond((x0 + x1) / 2, yc, 4.5, '#fff', color); };
      const arrow = (cx, yc, dir, color) => { ctx.save(); ctx.translate(cx, yc - NH / 2 - 7); ctx.rotate(dir === 'left' ? -.55 : dir === 'right' ? .55 : 0); ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(-9, 5); ctx.lineTo(0, -5); ctx.lineTo(9, 5); ctx.stroke(); ctx.restore(); };
      ch.slides.forEach(o => { if (!o.active && overlaps(o)) band(o, o.critical ? 'guideCrit' : 'guide'); });
      ch.slides.forEach(o => { if (o.active && overlaps(o)) band(o, o.critical ? 'crit' : 'slide'); });
      ch.slides.forEach(o => {
        if (!o.active || !overlaps(o)) return;
        const base = o.critical ? COL.crit : COL.slide;
        o.conns.forEach(c => {
          if (c.tick < col.t0 - slack || c.tick > col.t1 + slack) return;
          const yc = y(c.tick);
          if (c.type === 'tick') { const cx = (xl(c) + xr(c)) / 2; diamond(cx, yc, 7, c.critical ? COL.crit : COL.slide); if (c.trace) diamond(cx, yc, 3, '#fff', c.critical ? COL.crit : COL.slide); }
          else if (c.type === 'attach') { const [a, b] = posAt(o, c.tick); diamond((a + b) / 2, yc, 5.5, c.critical ? COL.crit : COL.slide); }
          else if (c.type === 'start') note(xl(c), xr(c), yc, c.critical ? COL.crit : base, c.trace);
          else if (c.type === 'end') { const color = c.flick ? (c.critical ? COL.crit : COL.flick) : (c.critical ? COL.crit : base); note(xl(c), xr(c), yc, color, c.trace); if (c.flick) arrow((xl(c) + xr(c)) / 2, yc, c.flick, c.critical ? COL.crit : COL.flick); }
        });
      });
      ch.singles.forEach(n => {
        if (n.tick < col.t0 - slack || n.tick > col.t1 + slack) return;
        const yc = y(n.tick), x0 = xl(n), x1 = xr(n);
        const color = n.trace ? (n.flick ? COL.traceFlick : n.critical ? COL.traceCrit : COL.traceTap) : (n.flick ? (n.critical ? COL.crit : COL.flick) : n.critical ? COL.crit : COL.tap);
        note(x0, x1, yc, color, n.trace);
        if (n.flick) arrow((x0 + x1) / 2, yc, n.flick, n.critical ? COL.crit : COL.flick);
      });
      ctx.restore();
    });
  },
  };
}
