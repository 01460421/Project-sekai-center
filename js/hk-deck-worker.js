/* Haruki 組卡推薦引擎的 Web Worker（module worker）。
   引擎是 Team-Haruki/sekai-deck-recommend-cpp 的 WebAssembly 版（npm：haruki-sekai-deck-recommend-cpp，LGPL-2.0），
   從 jsDelivr 載入、失敗換 unpkg；master 約 17 MB，搜尋也可能跑好幾秒，所以整套放在 Worker 裡不卡畫面。
   主執行緒只傳：要載哪些 master（網址清單）、music metas 網址、玩家 suite（換帳號或重新同步才傳）、搜尋選項。 */
let engineP = null, engineName = '', dataKey = '', dataP = null, metas = null, titles = {}, ud = null, udKey = '', suiteObj = null;

const post = (type, text) => self.postMessage({ type, text });

async function engine(pkg) {
  if (engineP && engineName === pkg) return engineP;
  engineName = pkg;
  engineP = (async () => {
    let last = null;
    for (const base of ['https://cdn.jsdelivr.net/npm/' + pkg + '/', 'https://unpkg.com/' + pkg + '/']) {
      try {
        const m = await import(base + 'index.js');
        return await m.createSekaiDeckRecommend({ wasmUrl: base + 'sekai_deck_recommend.wasm',
          moduleOptions: { printErr: t => { if (!/not found/.test(String(t))) console.warn(t); } } });
      } catch (e) { last = e; }
    }
    throw new Error('組卡引擎下載失敗：' + ((last && last.message) || last));
  })();
  engineP.catch(() => { engineP = null; });
  return engineP;
}

async function getJson(urls) {
  let last = null;
  for (const u of urls) {
    try { const r = await fetch(u); if (r.ok) return await r.json(); last = new Error('HTTP ' + r.status); } catch (e) { last = e; }
  }
  throw last || new Error('fetch failed');
}

/* 同一天同一組網址只載一次；換日才重抓（master 一天內頂多更新一兩次） */
async function ensureData(d) {
  const e = await engine(d.engine);
  if (dataKey === d.key) return e;
  if (!dataP) {
    dataP = (async () => {
      post('progress', '下載 master 資料（約 17 MB，第一次比較久）…');
      const master = {}, opt = new Set(d.optional || []);
      let done = 0;
      await Promise.all(d.files.map(async f => {
        try {
          const j = await getJson(d.bases.map(b => b + '/' + f + '.json'));
          if (Array.isArray(j) || (j && typeof j === 'object')) master[f] = j;
        } catch (err) { if (!opt.has(f)) throw new Error('master ' + f + ' 載入失敗'); }
        done++; if (done % 6 === 0) post('progress', '下載 master 資料 ' + done + ' / ' + d.files.length + '…');
      }));
      post('progress', '下載 music metas…');
      metas = await getJson([d.metasUrl]);
      titles = {}; (master.musics || []).forEach(m => { titles[m.id] = m.title; });
      post('progress', '載入引擎…');
      e.loadMasterData('tw', master);
      e.loadMusicMetas('tw', metas);
      if (ud) { try { ud.dispose(); } catch (err) {} ud = null; udKey = ''; }
      dataKey = d.key;
    })();
    dataP.then(() => { dataP = null; }, () => { dataP = null; });
  }
  await dataP;
  return e;
}

/* 沒指定歌就挑 metas 裡活動效率最高的一首（跟 haruki.js 的 hzBestSong 同一條公式） */
function bestSong(diff, live) {
  let best = null, bv = -1;
  (metas || []).forEach(m => {
    if (m.difficulty !== diff) return;
    const sk = live === 'solo' ? m.skill_score_solo : live === 'auto' ? m.skill_score_auto : m.skill_score_multi;
    const sum = (Array.isArray(sk) ? sk.reduce((a, b) => a + (+b || 0), 0) : 0) + (+m.fever_score || 0);
    const v = (+m.event_rate || 100) * ((live === 'auto' ? +m.base_score_auto : +m.base_score) + sum / 5);
    if (v > bv) { bv = v; best = m.music_id; }
  });
  return best;
}

self.onmessage = async ev => {
  const m = ev.data || {};
  try {
    if (m.type !== 'recommend' && m.type !== 'area') throw new Error('unknown request');
    const e = await ensureData(m.data);
    if (m.suite) {
      if (ud) { try { ud.dispose(); } catch (err) {} }
      post('progress', '讀取你的卡片…');
      ud = e.createUserData('tw', m.suite); udKey = m.userKey; suiteObj = m.suite;
    }
    if (!ud || udKey !== m.userKey) throw new Error('玩家資料還沒送進引擎，請再按一次');
    /* 區域道具：引擎依這五張卡算每個道具升下一級加多少綜合力，連同花費回傳，照「每枚金幣換到的綜合力」排 */
    if (m.type === 'area') {
      post('progress', '計算區域道具…');
      const list = e.recommendAreaItems(Object.assign({}, m.opts, { user_data: suiteObj }));
      self.postMessage({ id: m.id, result: list });
      return;
    }
    const opts = Object.assign({}, m.opts);
    const liveBase = opts.live_type === 'cheerful' ? 'multi' : opts.live_type;
    if (!opts.music_id) opts.music_id = bestSong(opts.music_diff, liveBase) || 1;
    post('progress', '搜尋最佳組合…');
    const res = e.recommend(opts, ud);
    let current = null;
    if (m.current) {
      try {
        const c = e.recommend(Object.assign({}, opts, { fixed_cards: m.current, algorithm: 'dfs', limit: 1, best_skill_as_leader: false }), ud);
        current = (c.decks || [])[0] || null;
      } catch (err) {}
    }
    let songs = null;
    if (res.decks && res.decks[0]) {
      try {
        const mo = { region: 'tw', live_type: opts.live_type, skill_order_choose_strategy: 'average' };
        if (opts.event_id) mo.event_id = opts.event_id;
        // 引擎每首歌每個難度各回一筆；同一首只留最划算的難度，清單才看得到不同的歌
        const seen = new Set();
        songs = e.recommendMusic(mo, res.decks[0]).sort((a, b) => (b.event_point != null ? b.event_point - a.event_point : b.live_score - a.live_score))
          .filter(x => !seen.has(x.music_id) && seen.add(x.music_id)).slice(0, 10).map(x => Object.assign({ title: titles[x.music_id] || '' }, x));
      } catch (err) {}
    }
    self.postMessage({ id: m.id, result: { decks: res.decks || [], cost_ms: res.cost_ms, current, songs, musicId: opts.music_id,
      musicTitle: titles[opts.music_id] || '', diff: opts.music_diff } });
  } catch (err) {
    self.postMessage({ id: m.id, error: String((err && err.message) || err) });
  }
};
