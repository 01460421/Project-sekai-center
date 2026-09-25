/* ---------- Haruki 專區 ----------
   把 Team-Haruki 開源生態系能用的東西集中在一頁：
   - 組卡推薦：Haruki 維護的 sekai-deck-recommend-cpp（WebAssembly，LGPL-2.0），在 Web Worker 裡跑，
     master 用 Haruki 的台服 master（GitHub），music metas 經自家 Worker 轉送 Haruki 的 master 登錄處。
   - 角色等級：照 Haruki 工具箱「角色任務」的算法（移植自 Haruki-Cloud），算目前 EXP、可領未領與領完後的等級。
   - 資源：master 版本、素材源、Sekai API 反代狀態、開源專案清單。
   玩家資料來自「我的帳號 → Haruki 工具箱匯入」存在這台瀏覽器 IndexedDB 的整份 suite，不上傳。
   這個檔案延後載入（只有進這一頁才下載），app.js 的 hzLoad() 用 Object.assign(app, hzMembers.call(app)) 掛上。 */

const HZ_DECK_FILES = [
  'areaItemLevels', 'areaItems', 'areas', 'cardEpisodes', 'cards', 'cardRarities', 'characterRanks', 'eventCards', 'eventDeckBonuses',
  'eventExchangeSummaries', 'eventHonorBonuses', 'events', 'eventItems', 'eventRarityBonusRates', 'gameCharacters', 'gameCharacterUnits',
  'honors', 'masterLessons', 'musicDifficulties', 'musics', 'musicVocals', 'shopItems', 'skills', 'worldBloomDifferentAttributeBonuses',
  'worldBlooms', 'worldBloomSupportDeckBonuses', 'worldBloomSupportDeckUnitEventLimitedBonuses', 'cardMysekaiCanvasBonuses',
  'mysekaiFixtureGameCharacterGroups', 'mysekaiFixtureGameCharacterGroupPerformanceBonuses', 'mysekaiGates', 'mysekaiGateLevels',
  'eventCardBonusLimits', 'eventSkillScoreUpLimits', 'eventTotalPowerLimits'];
const HZ_DECK_OPTIONAL = ['eventCardBonusLimits', 'eventSkillScoreUpLimits', 'eventTotalPowerLimits', 'cardMysekaiCanvasBonuses',
  'mysekaiFixtureGameCharacterGroups', 'mysekaiFixtureGameCharacterGroupPerformanceBonuses', 'mysekaiGates', 'mysekaiGateLevels',
  'worldBloomSupportDeckUnitEventLimitedBonuses'];

/* 角色任務：EX 類是一輪一輪重複的（照 Haruki-Cloud snapshot_character_missions.go） */
const HZ_MISSION_EX = new Set(['play_live_ex', 'waiting_room_ex']);
const HZ_MISSION_BASIC = ['collect_member', 'collect_stamp', 'collect_costume_3d', 'collect_character_archive_voice', 'collect_another_vocal',
  'read_mysekai_fixture_unique_character_talk', 'read_area_talk'];

/* 純函式：角色任務一覽（抽出來給測試用）。groups 為同一 parameterGroupId、依 seq 排好的列 */
export function hzReqForRound(groups, round) { let v = 0; for (const g of groups) { if (g.seq > round) break; v = g.requirement; } return round > 0 ? v : 0; }
export function hzExpForRound(groups, round) { let v = 0; for (const g of groups) { if (g.seq > round) break; v = g.exp; } return round > 0 ? v : 0; }
export function hzClearedTotal(groups, seq) { let t = 0; for (let r = 1; r <= seq; r++) t += hzReqForRound(groups, r); return t; }
export function hzCurrentRound(groups, total) {
  let left = Math.max(total, 0), round = 1;
  for (;;) { const need = hzReqForRound(groups, round); if (need <= 0 || left < need) return [round, left, need]; left -= need; round++; }
}
export function hzCharacterMissions(cid, M, U) {
  const missions = (M.missions || []).filter(m => m.characterId === cid).sort((a, b) => a.id - b.id);
  if (!missions.length) return null;
  const byGroup = new Map();
  (M.groups || []).forEach(g => { const id = g.id || g.gameId; if (!byGroup.has(id)) byGroup.set(id, []); byGroup.get(id).push(g); });
  byGroup.forEach(l => l.sort((a, b) => a.seq - b.seq));
  const levels = (M.levels || []).filter(l => String(l.levelType).toLowerCase() === 'character').sort((a, b) => a.level - b.level);
  const startOf = new Map(levels.map(l => [l.level, l.totalExp]));
  const uc = (U.userCharacters || []).find(c => +c.characterId === cid) || {};
  const lv = +uc.characterRank || 0, rawExp = +uc.exp || 0, totalExp = +uc.totalExp || 0;
  const base = startOf.get(lv);
  const curExp = lv > 0 && totalExp > 0 && base != null && totalExp >= base ? totalExp - base : rawExp;
  const statuses = (U.userCharacterMissionV2Statuses || []).filter(s => +s.characterId === cid);
  let pending = 0;
  statuses.forEach(s => { if (String(s.missionStatus || '').toLowerCase() === 'achieved') pending += hzExpForRound(byGroup.get(+s.parameterGroupId) || [], +s.seq || 0); });
  let baseTotal = totalExp; if (baseTotal <= 0 && lv > 0 && base != null) baseTotal = base + curExp;
  const finalTotal = Math.max(baseTotal, 0) + pending;
  let finalLv = 1, finalStart = 0;
  for (const l of levels) { if (l.totalExp > finalTotal) break; finalLv = l.level; finalStart = l.totalExp; }
  const nextStart = startOf.get(lv + 1);
  const progress = new Map();
  (U.userCharacterMissionV2s || []).forEach(r => { if (+r.characterId === cid) progress.set(r.characterMissionType, Math.max(progress.get(r.characterMissionType) || 0, +r.progress || 0)); });
  const seqByMission = new Map(), seqByGroup = new Map();
  statuses.forEach(s => { seqByMission.set(+s.missionId, Math.max(seqByMission.get(+s.missionId) || 0, +s.seq || 0)); seqByGroup.set(+s.parameterGroupId, Math.max(seqByGroup.get(+s.parameterGroupId) || 0, +s.seq || 0)); });
  const rows = missions.map(m => {
    const groups = byGroup.get(m.parameterGroupId) || [], ex = HZ_MISSION_EX.has(m.characterMissionType);
    const recv = Math.max(seqByMission.get(m.id) || 0, seqByGroup.get(m.parameterGroupId) || 0);
    let cur = progress.get(m.characterMissionType) || 0;
    if (ex) { const cleared = hzClearedTotal(groups, recv); cur = cur > 0 && cur < cleared ? cleared + cur : Math.max(cur, cleared); }
    else if (cur <= 0 && recv > 0) cur = hzReqForRound(groups, recv);
    let upper = 0, nextNeed = 0, nextExp = 0;
    if (ex) {
      for (let r = 1; r <= 30; r++) upper += hzReqForRound(groups, r);
      const [round, inRound, need] = hzCurrentRound(groups, cur);
      if (need > 0) { nextNeed = cur + Math.max(need - inRound, 0); nextExp = hzExpForRound(groups, round); }
    } else {
      groups.forEach(g => { if (g.requirement > upper) upper = g.requirement; });
      const nx = groups.find(g => g.requirement > cur); if (nx) { nextNeed = nx.requirement; nextExp = nx.exp; }
    }
    return { id: m.id, type: m.characterMissionType, ex, ach: !!m.isAchievementMission, cur, upper, nextNeed, nextExp,
      sentence: m.sentence || '', unit: m.progressSentence || '' };
  });
  return { cid, lv, curExp, need: nextStart != null && base != null ? nextStart - base : 0, pending, finalLv, finalExp: finalTotal - finalStart, rows,
    maxLv: levels.length ? levels[levels.length - 1].level : 0 };
}

/* 純函式：目前隊伍的五張卡（userGamedata.deck 指到 userDecks；member1 是隊長） */
export function hzCurrentDeck(suite) {
  const g = (suite && suite.userGamedata) || {}, decks = (suite && suite.userDecks) || [];
  const d = decks.find(x => +x.deckId === +g.deck) || decks[0];
  if (!d) return [];
  return [d.member1, d.member2, d.member3, d.member4, d.member5].map(Number).filter(n => n > 0);
}

/* 純函式：沒指定歌時的預設曲 —— metas 裡這個難度「活動倍率 × 基礎分＋技能」最高的一首 */
export function hzBestSong(metas, diff, live) {
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

/* ---------- 養成：照 Haruki 工具箱 training/lib 的算法（MIT，移植自 Haruki-Cloud） ---------- */
/* 隊長次數：play_live 進度＝一般次數；EX 等級＝已領輪數＋1，EX 次數＝本輪進度＋已領輪數的門檻總和 */
export function hzLeaders(groups, U) {
  const exReq = (groups || []).filter(g => (g.id || g.gameId) === 101).sort((a, b) => a.seq - b.seq);
  let maxPlay = 0; (groups || []).forEach(g => { if ((g.id || g.gameId) === 1 && g.requirement > maxPlay) maxPlay = g.requirement; });
  const reqFor = seq => { let v = 0; for (const g of exReq) { if (g.seq > seq) break; v = g.requirement; } return seq > 0 ? v : 0; };
  const play = new Map(), ex = new Map(), hasEx = new Set(); let hasPlay = false;
  (U.userCharacterMissionV2s || []).forEach(r => {
    const c = +r.characterId, t = String(r.characterMissionType || '').toLowerCase();
    if (t === 'play_live') { play.set(c, +r.progress || 0); hasPlay = true; } else if (t === 'play_live_ex') { ex.set(c, +r.progress || 0); hasEx.add(c); }
  });
  if (!hasPlay) (U.userCharacterLiveUsageCounts || []).forEach(r => { if (String(r.characterLiveUsageType).toLowerCase() === 'leader') play.set(+r.characterId, +r.usageCount || 0); });
  const lv = new Map();
  (U.userCharacterMissionV2Statuses || []).forEach(r => {
    if (+r.parameterGroupId !== 101) return;
    const c = +r.characterId, seq = +r.seq || 0;
    lv.set(c, Math.max(lv.get(c) || 0, seq)); ex.set(c, (ex.get(c) || 0) + reqFor(seq));
  });
  const rows = [];
  for (let c = 1; c <= 26; c++) rows.push({ cid: c, play: play.get(c) || 0, exLv: (lv.get(c) || 0) + (hasEx.has(c) ? 1 : 0), exCount: ex.get(c) || 0 });
  rows.sort((a, b) => (b.play + b.exCount) - (a.play + a.exCount) || a.cid - b.cid);
  let maxEx = 0; const top = exReq.length ? exReq[exReq.length - 1].seq : 0; for (let q = 1; q < top; q++) maxEx += reqFor(q);
  return { rows, maxPlay: maxPlay || rows.reduce((m, r) => Math.max(m, r.play), 0), maxEx };
}
/* 羈絆：userBonds 的 rank／exp（exp 是本級內），配 bonds 的角色對；VS 各團版本（id > 26）收回本尊 */
export function hzBonds(M, U) {
  const styles = new Map((M.gcu || []).map(g => [+g.id, +g.gameCharacterId || 0]));
  const base = id => styles.get(id) > 0 ? styles.get(id) : id;
  const byGroup = new Map((M.bonds || []).map(b => [+b.groupId, b]));
  const tot = new Map(); let maxLv = 0;
  (M.levels || []).forEach(l => { if (String(l.levelType).toLowerCase() === 'bonds') { tot.set(+l.level, +l.totalExp || 0); if (+l.level > maxLv) maxLv = +l.level; } });
  const rows = [];
  (U.userBonds || []).forEach(u => {
    const m = byGroup.get(+u.bondsGroupId); if (!m) return;
    const rank = +u.rank || 0, exp = +u.exp || 0, a = tot.get(rank), b = tot.get(rank + 1);
    const span = rank > 0 && rank < maxLv && a != null && b != null ? b - a : null;
    rows.push({ g: m.groupId, c1: +m.characterId1, c2: +m.characterId2, b1: base(+m.characterId1), b2: base(+m.characterId2), lv: rank, exp, span, need: span != null ? Math.max(span - exp, 0) : null });
  });
  rows.sort((x, y) => y.lv - x.lv || x.c1 - y.c1 || x.c2 - y.c2);
  return { rows, maxLv };
}
/* 綜合力加成：區域道具（角色／團體／屬性）、角色等級、MySekai 家具（×0.1）與大門（各團；VS 取最高的一扇） */
export const HZ_UNITS = ['light_sound', 'idol', 'street', 'theme_park', 'school_refusal', 'piapro'];
export const HZ_ATTRS = ['cute', 'cool', 'pure', 'happy', 'mysterious'];
export function hzPowerBonus(M, U) {
  const ch = {}, un = {}, at = {};
  for (let c = 1; c <= 26; c++) ch[c] = { area: 0, rank: 0, fix: 0 };
  HZ_UNITS.forEach(u => { un[u] = { area: 0, gate: 0 }; }); HZ_ATTRS.forEach(a => { at[a] = 0; });
  const own = new Map();
  (U.userAreas || []).forEach(a => (a.areaItems || []).forEach(i => { const id = +i.areaItemId, l = +i.level || 0; if (id > 0 && l > (own.get(id) || 0)) own.set(id, l); }));
  const ail = new Map((M.areaItemLevels || []).map(l => [l.areaItemId + ':' + l.level, l]));
  own.forEach((l, id) => {
    const r = ail.get(id + ':' + l); if (!r || l <= 0) return;
    const v = +r.power1BonusRate || 0;
    if (+r.targetGameCharacterId > 0 && ch[r.targetGameCharacterId]) ch[r.targetGameCharacterId].area += v;
    if (un[r.targetUnit]) un[r.targetUnit].area += v;
    if (at[r.targetCardAttr] != null) at[r.targetCardAttr] += v;
  });
  const cr = new Map((M.characterRanks || []).map(r => [r.characterId + ':' + r.characterRank, +r.power1BonusRate || 0]));
  (U.userCharacters || []).forEach(c => { const v = cr.get(c.characterId + ':' + c.characterRank); if (v && ch[c.characterId]) ch[c.characterId].rank += v; });
  (U.userMysekaiFixtureGameCharacterPerformanceBonuses || []).forEach(f => { if (ch[f.gameCharacterId]) ch[f.gameCharacterId].fix += (+f.totalBonusRate || 0) * 0.1; });
  const gl = new Map((M.gateLevels || []).map(l => [l.mysekaiGateId + ':' + l.level, +l.powerBonusRate || 0]));
  const GATE = { 1: 'light_sound', 2: 'idol', 3: 'street', 4: 'theme_park', 5: 'school_refusal' };
  let maxGate = 0;
  (U.userMysekaiGates || []).forEach(g => { const v = gl.get(g.mysekaiGateId + ':' + g.mysekaiGateLevel); if (v == null) return; if (GATE[g.mysekaiGateId]) un[GATE[g.mysekaiGateId]].gate += v; maxGate = Math.max(maxGate, v); });
  un.piapro.gate += maxGate;
  return {
    chars: Object.keys(ch).map(c => Object.assign({ cid: +c, total: ch[c].area + ch[c].rank + ch[c].fix }, ch[c])),
    units: HZ_UNITS.map(u => Object.assign({ u, total: un[u].area + un[u].gate }, un[u])),
    attrs: HZ_ATTRS.map(a => ({ a, total: at[a] })),
  };
}
/* 挑戰 Live：最高分、關卡、下一個獎勵門檻；已達到但沒領的獎勵只算個數（寶箱內容表太大，不下載） */
export function hzChallenge(rewards, U) {
  const score = new Map((U.userChallengeLiveSoloResults || []).map(r => [+r.characterId, +r.highScore || 0]));
  const stage = new Map(); (U.userChallengeLiveSoloStages || []).forEach(r => { const c = +r.characterId, k = +r.rank || 0; if (k > (stage.get(c) || 0)) stage.set(c, k); });
  const got = new Set((U.userChallengeLiveSoloHighScoreRewards || []).map(r => +r.challengeLiveHighScoreRewardId));
  const rows = [];
  for (let c = 1; c <= 26; c++) {
    const hs = score.get(c) || 0, mine = (rewards || []).filter(r => +r.characterId === c).sort((a, b) => a.highScore - b.highScore);
    const next = mine.find(r => r.highScore > hs);
    rows.push({ cid: c, hs, stage: stage.get(c) || 0, next: next ? next.highScore : 0, unclaimed: mine.filter(r => r.highScore <= hs && !got.has(+r.id)).length });
  }
  return rows;
}

export function hzMembers() {
  return {
  HZ_ENGINE: 'haruki-sekai-deck-recommend-cpp@0.3.8',
  HZ_ASSETS: {
    global: ['海外節點', 'https://sekai-assets-bdf29c81.seiunx.net'],
    china: ['中國節點', 'https://sekai-assets.haruki.seiunx.com'],
    china_cdn: ['中國 CDN', 'https://toolbox-sekai-assets.haruki.seiunx.com'],
  },
  HZ_REPOS: [
    ['Haruki-Toolbox', 'https://github.com/Team-Haruki/Haruki-Toolbox', '工具箱前端（MIT）：角色任務、組卡等算法參考', '角色等級'],
    ['Haruki-Toolbox-Backend', 'https://github.com/Team-Haruki/Haruki-Toolbox-Backend', '工具箱後端：OAuth2、遊戲資料上傳與公開 API', '帳號授權、資料匯入'],
    ['sekai-deck-recommend-cpp', 'https://github.com/Team-Haruki/sekai-deck-recommend-cpp', '組卡推薦引擎（C++／WebAssembly，LGPL-2.0）', '組卡推薦'],
    ['Haruki-Event-Tracker', 'https://github.com/Team-Haruki/Haruki-Event-Tracker', '活動排名追蹤與公開 web API', '活動排名備援'],
    ['haruki-sekai-tc-master', 'https://github.com/Team-Haruki/haruki-sekai-tc-master', '台服 master 資料', '全站台服資料'],
    ['haruki-sekai-master', 'https://github.com/Team-Haruki/haruki-sekai-master', '日服 master 資料', '—'],
  ],
  HZ_DIFFS: ['easy', 'normal', 'hard', 'expert', 'master', 'append'],
  /* Haruki 工具箱教學：網址全取自 Haruki-Toolbox 原始碼（路由與站內教學連結），照第一次使用的順序排 */
  HZ_GUIDE: [
    ['註冊 Haruki 工具箱帳號', '工具箱是 Team Haruki 的 Project SEKAI 資料服務；先註冊並登入。',
      [['註冊', 'https://haruki.seiunx.com/user/register'], ['登入', 'https://haruki.seiunx.com/user/login'], ['工具箱首頁', 'https://haruki.seiunx.com']]],
    ['綁定並驗證台服帳號', '在「遊戲帳號綁定」新增台服（tw）的 Player ID，照指示把驗證碼貼進遊戲內的個性簽名，回主頁存好後再按驗證。已驗證的綁定才能授權給其他網站讀資料。',
      [['遊戲帳號綁定', 'https://haruki.seiunx.com/user/game-account-bindings']]],
    ['上傳遊戲資料（三選一）', '把你的遊戲資料（Suite，另可含 MySekai）上傳到工具箱；之後資料有變動再上傳一次，這裡按「重新同步」就會拿到新的。繼承碼上傳會讓工具箱用繼承碼代為登入，請自行評估。',
      [['繼承碼上傳', 'https://haruki.seiunx.com/upload-data?tab=inherit'], ['檔案上傳', 'https://haruki.seiunx.com/upload-data?tab=file'], ['iOS 模組上傳', 'https://haruki.seiunx.com/upload-data?tab=ios']]],
    ['iOS 模組與抓包教學', '用 iOS 模組或 Haruki 代理在玩遊戲時自動上傳，資料最即時。',
      [['iOS 模組教學', 'https://neo.haruki.seiunx.com/toolbox-tutorial/ios-module.html'], ['Haruki 代理教學', 'https://neo.haruki.seiunx.com/haruki-proxy/']]],
    ['開放給本站讀取（二選一）', '方法一：在遊戲帳號綁定裡，把 Suite 的「允許公開API訪問」打開（MySekai 選填），回本站填 Player ID 即可，不必登入。方法二：用 Haruki 帳號授權本站（不必公開），在「我的帳號」按「連結 Haruki 帳號」。',
      [['開啟允許公開API訪問', 'https://haruki.seiunx.com/user/game-account-bindings']]],
    ['管理或撤銷授權', '不想讓本站再讀你的資料：在工具箱的「OAuth 授權」撤銷，或在本站「我的帳號」按「解除連結」；公開 API 則回綁定頁關掉。',
      [['OAuth 授權管理', 'https://haruki.seiunx.com/user/oauth-authorizations'], ['帳號設定', 'https://haruki.seiunx.com/user/settings']]],
    ['工具箱自己的工具', '工具箱本身也有組卡推薦、活動規劃、養成進度與排名追蹤，可以對照使用。',
      [['組卡推薦', 'https://haruki.seiunx.com/deck-recommend'], ['活動規劃', 'https://haruki.seiunx.com/event-planner'], ['養成進度', 'https://haruki.seiunx.com/training'], ['排名追蹤', 'https://haruki.seiunx.com/rank-border'], ['關於', 'https://haruki.seiunx.com/about']]],
  ],

  hzAssetRoot() { const k = this.state.hzAsset; return (this.HZ_ASSETS[k] || this.HZ_ASSETS.global)[1]; },
  hzThumb(abn, trained) { return this.hzAssetRoot() + '/tw-assets/startapp/thumbnail/chara/' + abn + (trained ? '_after_training.png' : '_normal.png'); },

  async hzInit() {
    let asset = 'global'; try { asset = localStorage.getItem('sekai-hk-asset') || 'global'; } catch (e) {}
    this.setState({ hzAsset: this.HZ_ASSETS[asset] ? asset : 'global' });
    this.loadCards();
    this.hkLoadCfg();
    const meta = await this.hkSuiteMeta().catch(() => null);
    this.setState({ hzMeta: meta });
    this.hzLoadLists();
    fetch(this.GAMES_API + '/haruki/master/tw/current').then(r => r.ok ? r.json() : null).then(v => this.setState({ hzVer: v || false })).catch(() => this.setState({ hzVer: false }));
  },
  async hzSuite() {
    if (this._hzSuite && this._hzSuiteAt === (this.state.hzMeta || {}).at) return this._hzSuite;
    const rec = await this.hkSuiteGet();
    this._hzSuite = rec && rec.suite; this._hzSuiteAt = rec && rec.at;
    return this._hzSuite;
  },
  /* 下拉選單要的活動與歌曲：只拿小表 */
  async hzLoadLists() {
    if (this._hzListsP) return this._hzListsP;
    this._hzListsP = (async () => {
      const [events, musics, wbs] = await Promise.all([this.tdbJson('events.json'), this.tdbJson('musics.json'), this.tdbJson('worldBlooms.json').catch(() => [])]);
      const now = Date.now(), D = 86400000;
      const evs = (events || []).filter(e => e.startAt <= now + 45 * D && e.aggregateAt >= now - 60 * D).sort((a, b) => b.startAt - a.startAt);
      const cur = evs.find(e => e.startAt <= now && now <= e.aggregateAt) || evs.filter(e => e.startAt > now).pop() || evs[0];
      const songs = (musics || []).filter(m => m.publishedAt <= now + 7 * D).sort((a, b) => b.publishedAt - a.publishedAt).map(m => [m.id, m.title]);
      this._hzWb = wbs || [];
      this.setState({ hzEvents: evs.map(e => [e.id, e.name, e.eventType, e.startAt, e.aggregateAt]), hzSongs: songs,
        hzEv: this.state.hzEv || (cur ? String(cur.id) : '') });
    })().catch(e => { this._hzListsP = null; this.setState({ hzMsg: '活動或歌曲清單載入失敗：' + ((e && e.message) || e) }); });
    return this._hzListsP;
  },
  hzWlChapters(evId) {
    return (this._hzWb || []).filter(w => w.eventId === +evId && w.gameCharacterId > 0).sort((a, b) => a.chapterNo - b.chapterNo);
  },

  /* ---------- 組卡引擎（Web Worker） ---------- */
  hzWorker() {
    if (this._hzW) return this._hzW;
    const w = new Worker('/js/hk-deck-worker.js?v=0f64580d3f', { type: 'module' });
    this._hzW = w; this._hzReq = new Map(); this._hzSeq = 0; this._hzSentUser = '';
    w.onmessage = e => {
      const d = e.data || {};
      if (d.type === 'progress') { this.setState({ hzPhase: d.text }); return; }
      const p = this._hzReq.get(d.id); if (!p) return;
      this._hzReq.delete(d.id);
      d.error ? p.reject(new Error(d.error)) : p.resolve(d.result);
    };
    w.onerror = e => { const err = new Error((e && e.message) || '組卡引擎載入失敗'); this._hzReq.forEach(p => p.reject(err)); this._hzReq.clear(); this._hzW = null; };
    return w;
  },
  hzCall(msg, transfer) {
    const w = this.hzWorker(), id = ++this._hzSeq;
    return new Promise((resolve, reject) => { this._hzReq.set(id, { resolve, reject }); w.postMessage(Object.assign({ id }, msg), transfer || []); });
  },
  hzDataMsg() {
    return { bases: [this.TDB, this.TDB_SW], files: HZ_DECK_FILES, optional: HZ_DECK_OPTIONAL, metasUrl: this.GAMES_API + '/haruki/metas/tw/music_metas.json',
      engine: this.HZ_ENGINE, key: 'tw:' + new Date().toISOString().slice(0, 10) };
  },
  hzOpts(suite) {
    const s = this.state, ev = (s.hzEvents || []).find(e => String(e[0]) === String(s.hzEv));
    const live = s.hzLive || 'multi';
    const o = { region: 'tw', live_type: live, target: s.hzTarget || 'score', algorithm: s.hzAlgo || 'ga', music_diff: s.hzDiff || 'master',
      limit: 5, timeout_ms: 20000, member: 5, best_skill_as_leader: true,
      skill_order_choose_strategy: 'average', skill_reference_choose_strategy: 'average' };
    if (s.hzMusic) o.music_id = +s.hzMusic;
    if (ev) o.event_id = ev[0];
    if (ev && ev[2] === 'world_bloom') {
      const ch = this.hzWlChapters(ev[0]);
      const pick = ch.find(w => String(w.gameCharacterId) === String(s.hzWlChar)) || ch.find(w => w.chapterStartAt <= Date.now() && Date.now() <= w.aggregateAt) || ch[0];
      if (pick) o.world_bloom_character_id = pick.gameCharacterId;
    }
    if (ev && ev[2] === 'cheerful_carnival' && live === 'multi') o.live_type = 'cheerful';
    const cfg = { level_max: !!s.hzMaxLv, episode_read: !!s.hzMaxLv, master_max: !!s.hzMaxMr, skill_max: !!s.hzMaxSk };
    ['rarity_1_config', 'rarity_2_config', 'rarity_3_config', 'rarity_4_config', 'rarity_birthday_config'].forEach(k => { o[k] = cfg; });
    const fixed = String(s.hzFixed || '').match(/\d+/g);
    if (fixed && fixed.length) o.fixed_cards = fixed.map(Number).slice(0, 5);
    const ex = String(s.hzExclude || '').match(/\d+/g);
    if (ex && ex.length && suite) {
      const drop = new Set(ex.map(Number));
      o.single_card_configs = (suite.userCards || []).filter(c => drop.has(+c.cardId)).map(c => ({ card_id: +c.cardId, disable: true }));
    }
    return o;
  },
  /* 送一次搜尋；玩家資料只在換帳號或重新同步後才整份送進 Worker */
  async hzEngine(suite, opts, current) {
    const userKey = this._hzSuiteAt + ':' + (this.state.hzMeta || {}).uid;
    const r = await this.hzCall({ type: 'recommend', data: this.hzDataMsg(), userKey, suite: this._hzSentUser !== userKey ? suite : null, opts, current: current || null });
    this._hzSentUser = userKey;
    return r;
  },
  /* 計算中心「從 Haruki 帶入目前隊伍」：用引擎算遊戲裡目前那一隊在進行中活動的綜合力、加成與實效技能 */
  async hzTeamStats(live) {
    const suite = await this.hzSuite().catch(() => null);
    if (!suite || !Array.isArray(suite.userCards)) throw new Error('先在 Haruki 專區或我的帳號讀取你的遊戲資料');
    const cur = hzCurrentDeck(suite);
    if (cur.length !== 5) throw new Error('遊戲資料裡找不到目前隊伍');
    await this.hzLoadLists();
    // 進行中那期；兩期之間就用下一期（正在為它準備隊伍），加成才不會變成 0
    const now = Date.now(), evs = this.state.hzEvents || [];
    const ev = evs.find(e => e[3] <= now && now <= e[4]) || evs.filter(e => e[3] > now).sort((a, b) => a[3] - b[3])[0];
    const opts = { region: 'tw', live_type: live === 'solo' ? 'solo' : live === 'auto' ? 'auto' : 'multi', target: 'score', algorithm: 'dfs', music_diff: 'master',
      limit: 1, member: 5, fixed_cards: cur, best_skill_as_leader: false, skill_order_choose_strategy: 'average', skill_reference_choose_strategy: 'average' };
    if (ev) {
      opts.event_id = ev[0];
      if (ev[2] === 'world_bloom') { const chs = this.hzWlChapters(ev[0]); const ch = chs.find(w => w.chapterStartAt <= now && now <= w.aggregateAt) || chs.find(w => w.chapterStartAt > now) || chs[0]; if (ch) opts.world_bloom_character_id = ch.gameCharacterId; }
    }
    const r = await this.hzEngine(suite, opts, null);
    const d = (r.decks || [])[0];
    if (!d) throw new Error('引擎沒有算出這一隊');
    return { power: d.total_power, bonus: Math.round((d.event_bonus_rate || 0) * 10) / 10, skill: Math.round((1 + (d.multi_live_score_up || 0) / 100) * 100) / 100, ev: ev ? ev[1] : '' };
  },
  async hzRun() {
    if (this.state.hzBusy) return;
    const suite = await this.hzSuite().catch(() => null);
    if (!suite || !Array.isArray(suite.userCards)) { this.setState({ hzMsg: '先匯入你的遊戲資料（上方「讀取我的資料」），組卡要知道你有哪些卡。' }); return; }
    await this.hzLoadLists();
    this.setState({ hzBusy: true, hzMsg: '', hzPhase: '準備組卡引擎…' });
    const t0 = Date.now();
    try {
      const opts = this.hzOpts(suite);
      const cur = hzCurrentDeck(suite);
      const r = await this.hzEngine(suite, opts, cur.length === 5 ? cur : null);
      if (r.musicId && !this.state.hzMusic) this.setState({ hzMusic: String(r.musicId) });
      this.setState({ hzBusy: false, hzPhase: '', hzRes: Object.assign({ at: Date.now(), ms: Date.now() - t0 }, r) });
    } catch (e) {
      const m = (e && e.message) || String(e);
      this.setState({ hzBusy: false, hzPhase: '', hzMsg: '組卡失敗：' + m + (/import|fetch|Failed/i.test(m) ? '（組卡引擎從 jsDelivr／unpkg 下載，請確認網路沒有擋這兩個網站）' : '') });
    }
  },

  /* ---------- 角色等級 ---------- */
  async hzLoadCrank() {
    if (this._hzCrankP) return this._hzCrankP;
    this._hzCrankP = (async () => {
      const [missions, groups, levels] = await Promise.all(['characterMissionV2s', 'characterMissionV2ParameterGroups', 'levels'].map(f => this.tdbJson(f + '.json')));
      this._hzCrankM = { missions: missions || [], groups: groups || [], levels: levels || [] };
      this.setState({ hzCrankReady: Date.now() });
    })().catch(e => { this._hzCrankP = null; this.setState({ hzMsg: '角色任務資料載入失敗：' + ((e && e.message) || e) }); });
    return this._hzCrankP;
  },
  async hzCrankBuild() {
    await this.hzLoadCrank();
    const suite = await this.hzSuite().catch(() => null);
    if (!this._hzCrankM) return;
    const rows = [];
    for (let c = 1; c <= 26; c++) { const r = hzCharacterMissions(c, this._hzCrankM, suite || {}); if (r) rows.push(r); }
    this.setState({ hzCrank: { rows, has: !!(suite && suite.userCharacters), at: Date.now() } });
  },
  hzLevelTotal(lv) { const l = ((this._hzCrankM || {}).levels || []).find(x => x.levelType === 'character' && x.level === lv); return l ? l.totalExp : null; },

  /* ---------- 養成進度 ---------- */
  async hzLoadTrain() {
    if (this._hzTrainP) return this._hzTrainP;
    this._hzTrainP = (async () => {
      const soft = f => this.tdbJson(f + '.json').catch(() => []);
      const [groups, bonds, levels, gcu, characterRanks, areaItemLevels, gateLevels, chal, areaItems, areas] = await Promise.all(
        ['characterMissionV2ParameterGroups', 'bonds', 'levels', 'gameCharacterUnits', 'characterRanks', 'areaItemLevels', 'mysekaiGateLevels', 'challengeLiveHighScoreRewards', 'areaItems', 'areas'].map(soft));
      this._hzTrainM = { groups, bonds, levels, gcu, characterRanks, areaItemLevels, gateLevels, chal, areaItems, areas };
    })().catch(e => { this._hzTrainP = null; this.setState({ hzMsg: '養成資料載入失敗：' + ((e && e.message) || e) }); });
    return this._hzTrainP;
  },
  async hzTrainBuild() {
    await this.hzLoadTrain();
    const M = this._hzTrainM; if (!M) return;
    const U = (await this.hzSuite().catch(() => null)) || {};
    this.setState({ hzTrain: { has: Array.isArray(U.userCharacters), leaders: hzLeaders(M.groups, U), bonds: hzBonds(M, U), power: hzPowerBonus(M, U), chal: hzChallenge(M.chal, U), at: Date.now() } });
  },
  async hzAreaRun() {
    if (this.state.hzAreaBusy) return;
    const suite = await this.hzSuite().catch(() => null);
    if (!suite || !Array.isArray(suite.userCards)) { this.setState({ hzMsg: '先讀取你的遊戲資料。' }); return; }
    const deck = hzCurrentDeck(suite);
    if (deck.length !== 5) { this.setState({ hzMsg: '遊戲資料裡找不到目前隊伍。' }); return; }
    this.setState({ hzAreaBusy: true, hzMsg: '' });
    try {
      await this.hzLoadTrain();
      const userKey = this._hzSuiteAt + ':' + (this.state.hzMeta || {}).uid;
      const list = await this.hzCall({ type: 'area', data: this.hzDataMsg(), userKey, suite: this._hzSentUser !== userKey ? suite : null, opts: { region: 'tw', card_ids: deck } });
      this._hzSentUser = userKey;
      this.setState({ hzAreaBusy: false, hzPhase: '', hzArea: list || [] });
    } catch (e) { this.setState({ hzAreaBusy: false, hzPhase: '', hzMsg: '區域道具建議失敗：' + ((e && e.message) || e) }); }
  },
  hzSetTab(t) {
    this.setState({ hzTab: t });
    if (t === 'crank' && !this.state.hzCrank) this.hzCrankBuild();
    if (t === 'train' && !this.state.hzTrain) this.hzTrainBuild();
  },

  hzVals(s) {
    if (s.page !== 'haruki') return { hzReady: true };
    const meta = s.hzMeta, cfg = s.hkCfg || {}, tab = s.hzTab || 'deck';
    const chipOn = on => on ? { bg: 'var(--ink-grad)', fg: '#fff' } : { bg: 'var(--card-2)', fg: 'var(--text-2)' };
    const tabs = [['deck', '組卡推薦'], ['crank', '角色等級'], ['train', '養成進度'], ['guide', '使用教學'], ['res', '資源']].map(([v, n]) => Object.assign({ v, n }, chipOn(tab === v)));
    const fmtT = t => { if (!t) return ''; const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    const cards = {}; (s.rateCards || []).forEach(c => { cards[c[0]] = c; });
    const chName = {}; (s.rateChars || []).forEach(c => { chName[c[0]] = c[1]; });
    const out = {
      hzReady: true, hzTabs: tabs, hzIsDeck: tab === 'deck', hzIsCrank: tab === 'crank', hzIsTrain: tab === 'train', hzIsRes: tab === 'res', hzIsGuide: tab === 'guide',
      hzGuide: this.HZ_GUIDE.map((g, i) => ({ n: i + 1, t: g[0], d: g[1], links: g[2].map(l => ({ n: l[0], url: l[1] })) })),
      onHzGuide: () => this.hzSetTab('guide'),
      hzHas: !!meta, hzNone: !meta,
      hzWho: meta ? ((meta.name || '玩家') + (meta.rank ? '・等級 ' + meta.rank : '') + '・ID ' + meta.uid) : '',
      hzWhen: meta ? '本機資料同步於 ' + fmtT(meta.at) + (meta.upload ? '（遊戲資料上傳於 ' + fmtT(meta.upload) + '）' : '') : '',
      hzCanOAuth: !!cfg.clientId, hzLinked: !!(s.hkTok && (s.hkTok.access || s.hkTok.refresh)),
      hzUidIn: s.hkUid || s.pid || '', hzBusyImp: !!s.hkBusy, hzImpMsg: s.hkMsg || '',
      hzMsg: s.hzMsg || '', hzHasMsg: !!s.hzMsg,
      onHzTab: e => this.hzSetTab(e.currentTarget.dataset.v),
      onHzSync: () => { const linked = !!(this.state.hkTok && (this.state.hkTok.access || this.state.hkTok.refresh)); this.hkImport(linked ? undefined : 'public'); },
      onHzOAuth: () => this.hkStart(),
      onHzForget: () => { this.hkSuiteClear().then(() => { this._hzSuite = null; this.setState({ hzMeta: null, hzRes: null, hzCrank: null, hzMsg: '已清除這台裝置上的 Haruki 遊戲資料。' }); }); },
    };
    if (tab === 'deck') {
      const evs = s.hzEvents || [], ev = evs.find(e => String(e[0]) === String(s.hzEv));
      const TYPE = { marathon: '馬拉松', cheerful_carnival: '歡樂嘉年華', world_bloom: 'World Link' };
      const wl = ev && ev[2] === 'world_bloom' ? this.hzWlChapters(ev[0]) : [];
      const live = s.hzLive || 'multi', target = s.hzTarget || 'score', diff = s.hzDiff || 'master', algo = s.hzAlgo || 'ga';
      Object.assign(out, {
        hzEvOpts: [{ v: '', n: '不指定活動（只看分數與綜合力）' }].concat(evs.map(e => ({ v: String(e[0]), n: '#' + e[0] + ' ' + e[1] + '（' + (TYPE[e[2]] || e[2]) + '）' }))),
        hzEv: s.hzEv || '', hzIsWl: wl.length > 0,
        hzWlOpts: wl.map(w => ({ v: String(w.gameCharacterId), n: '第 ' + w.chapterNo + ' 章・' + (chName[w.gameCharacterId] || '#' + w.gameCharacterId) })),
        hzWlChar: s.hzWlChar || String((wl.find(w => w.chapterStartAt <= Date.now() && Date.now() <= w.aggregateAt) || wl[0] || {}).gameCharacterId || ''),
        hzLiveChips: [['multi', '多人'], ['solo', '單人'], ['auto', '自動']].map(([v, n]) => Object.assign({ v, n }, chipOn(live === v))),
        hzTargetChips: [['score', ev ? '活動 PT' : '分數'], ['power', '綜合力'], ['bonus', '加成'], ['skill', '技能']].map(([v, n]) => Object.assign({ v, n }, chipOn(target === v))),
        hzDiffChips: this.HZ_DIFFS.map(v => Object.assign({ v, n: v.toUpperCase() }, chipOn(diff === v))),
        hzAlgoChips: [['ga', '基因演算法'], ['sa', '模擬退火'], ['dfs', '窮舉（慢）']].map(([v, n]) => Object.assign({ v, n }, chipOn(algo === v))),
        hzSongOpts: [{ v: '', n: '自動挑活動效率最高的歌' }].concat((s.hzSongs || []).map(m => ({ v: String(m[0]), n: m[1] }))),
        hzMusic: s.hzMusic || '',
        hzMaxLvOn: !!s.hzMaxLv, hzMaxMrOn: !!s.hzMaxMr, hzMaxSkOn: !!s.hzMaxSk,
        hzMaxLvBg: chipOn(!!s.hzMaxLv).bg, hzMaxLvFg: chipOn(!!s.hzMaxLv).fg, hzMaxMrBg: chipOn(!!s.hzMaxMr).bg, hzMaxMrFg: chipOn(!!s.hzMaxMr).fg,
        hzMaxSkBg: chipOn(!!s.hzMaxSk).bg, hzMaxSkFg: chipOn(!!s.hzMaxSk).fg,
        hzFixed: s.hzFixed || '', hzExclude: s.hzExclude || '', hzAdvOpen: !!s.hzAdv, hzAdvBtn: s.hzAdv ? '收起進階設定' : '進階設定',
        hzBusy: !!s.hzBusy, hzIdle: !s.hzBusy, hzPhase: s.hzPhase || '', hzRunLabel: s.hzBusy ? '計算中…' : '開始組卡',
        onHzPick: e => { const d = e.currentTarget.dataset; this.setState({ [d.k]: d.v }); },
        onHzToggle: e => { const k = e.currentTarget.dataset.k; this.setState({ [k]: !this.state[k] }); },
        onHzAdv: () => this.setState({ hzAdv: !this.state.hzAdv }),
        onHzRun: () => this.hzRun(),
      });
      const R = s.hzRes, pt = target === 'score';
      const unitOf = { score: ev ? ' PT' : ' 分', power: '', bonus: '%', skill: '%' };
      const deckRow = (d, i, label) => {
        const headline = target === 'power' ? d.total_power : target === 'bonus' ? d.event_bonus_rate : target === 'skill' ? d.multi_live_score_up : d.score;
        return {
          i, label: label || ('第 ' + (i + 1) + ' 名'),
          main: (Math.round(headline * 10) / 10).toLocaleString() + (unitOf[target] || ''),
          sub: [pt && ev ? '分數 ' + (d.live_score || 0).toLocaleString() : '', '綜合力 ' + (d.total_power || 0).toLocaleString(), ev ? '加成 ' + (Math.round((d.event_bonus_rate || 0) * 10) / 10) + '%' : '',
            live === 'multi' ? '實效 ' + (Math.round((d.multi_live_score_up || 0) * 10) / 10) + '%' : ''].filter(Boolean).join('・'),
          cards: (d.cards || []).map((c, k) => {
            const x = cards[c.card_id];
            return { id: c.card_id, img: x ? this.hzThumb(x[8], c.default_image === 'special_training' || (c.after_training && c.default_image !== 'original')) : '',
              lead: k === 0, name: x ? (chName[x[1]] || '') + '・' + x[7] : '#' + c.card_id,
              badge: 'Lv' + c.level + '・MR' + c.master_rank + '・SL' + c.skill_level + (ev ? '・+' + (Math.round((c.event_bonus_rate || 0) * 10) / 10) + '%' : '') };
          }),
        };
      };
      const decks = R ? (R.decks || []).map((d, i) => deckRow(d, i)) : [];
      const curRow = R && R.current ? deckRow(R.current, -1, '目前隊伍') : null;
      Object.assign(out, {
        hzHasRes: !!(R && decks.length), hzEmptyRes: !!(R && !decks.length),
        hzDecks: decks, hzHasCur: !!curRow, hzCur: curRow ? [curRow] : [],
        hzResNote: R ? ((R.musicTitle ? '歌曲：' + R.musicTitle + '（' + String(R.diff || '').toUpperCase() + '）・' : '') + '搜尋 ' + Math.round(R.cost_ms || 0) + ' ms，總耗時 ' + ((R.ms || 0) / 1000).toFixed(1) + ' 秒') : '',
        hzSongRank: R && R.songs ? R.songs.slice(0, 8).map((m, i) => ({ i: i + 1, t: m.title || ('#' + m.music_id), d: String(m.difficulty || '').toUpperCase(),
          v: m.event_point != null ? Math.round(m.event_point).toLocaleString() + ' PT' : Math.round(m.live_score || 0).toLocaleString() + ' 分' })) : [],
        hzHasSongRank: !!(R && R.songs && R.songs.length),
      });
    }
    if (tab === 'crank') {
      const C = s.hzCrank, open = s.hzCrankOpen;
      const rows = C ? C.rows.map(r => {
        const pct = r.need > 0 ? Math.min(100, Math.round(r.curExp / r.need * 100)) : 100;
        const miss = r.rows.filter(x => x.nextNeed > 0).sort((a, b) => (b.nextExp || 0) - (a.nextExp || 0));
        return { cid: r.cid, name: chName[r.cid] || ('#' + r.cid), lv: r.lv || '—', exp: r.need ? r.curExp + ' / ' + r.need : (r.lv >= r.maxLv ? '已達上限' : String(r.curExp)),
          pct: pct + '%', pending: r.pending > 0 ? '可領 ' + r.pending + ' EXP，領完 Lv' + r.finalLv : '', hasPending: r.pending > 0,
          open: String(open) === String(r.cid), btn: String(open) === String(r.cid) ? '收起' : '任務',
          missions: miss.map(x => ({ t: x.sentence ? x.sentence.replace('{requirement}', String(x.nextNeed)) : x.type,
            p: (x.ex ? '累計 ' : '') + x.cur + ' / ' + x.nextNeed + (x.unit ? '' : ''), e: '+' + x.nextExp + ' EXP' })) };
      }) : [];
      const f = Math.max(1, +s.hzCalcFrom || 1), t = Math.max(f, +s.hzCalcTo || f);
      const a = this.hzLevelTotal(f), b = this.hzLevelTotal(t);
      Object.assign(out, {
        hzCrankLoading: !C, hzCrankRows: rows, hzCrankHas: !!(C && C.has), hzCrankNoUser: !!(C && !C.has),
        hzCalcFrom: s.hzCalcFrom || '', hzCalcTo: s.hzCalcTo || '',
        hzCalcOut: a != null && b != null ? 'Lv' + f + ' → Lv' + t + ' 需要 ' + (b - a) + ' EXP' : '輸入兩個等級（1～' + (((this._hzCrankM || {}).levels || []).filter(l => l.levelType === 'character').length || 175) + '）',
        onHzCrankOpen: e => { const c = e.currentTarget.dataset.c; this.setState({ hzCrankOpen: String(this.state.hzCrankOpen) === c ? null : c }); },
        onHzCrankRefresh: () => this.hzCrankBuild(),
      });
    }
    if (tab === 'train') {
      const T = s.hzTrain, sub = s.hzTrainTab || 'leader', pct = v => (Math.round(v * 10) / 10) + '%';
      const UN = { light_sound: 'Leo/need', idol: 'MORE MORE JUMP!', street: 'Vivid BAD SQUAD', theme_park: 'ワンダショ', school_refusal: '25時', piapro: 'VIRTUAL SINGER' };
      const AT = { cute: '可愛', cool: '帥氣', pure: '純真', happy: '快樂', mysterious: '神秘' };
      const nm = c => chName[c] || ('#' + c);
      // 同名道具（例如各區的「音箱」）很多，後面標上所在區域
      const zone = {}; ((this._hzTrainM || {}).areas || []).forEach(a => { zone[a.id] = a.name; });
      const areaName = {}; ((this._hzTrainM || {}).areaItems || []).forEach(a => { areaName[a.id] = a.name + (zone[a.areaId] ? '（' + zone[a.areaId] + '）' : ''); });
      Object.assign(out, {
        hzTrainLoading: !T, hzTrainNoUser: !!(T && !T.has),
        hzTrainChips: [['leader', '隊長次數'], ['bond', '羈絆'], ['power', '綜合力加成'], ['chal', '挑戰 Live'], ['area', '區域道具']].map(([v, n]) => Object.assign({ v, n }, chipOn(sub === v))),
        onHzTrainTab: e => this.setState({ hzTrainTab: e.currentTarget.dataset.v }),
        onHzTrainRefresh: () => this.hzTrainBuild(),
        hzTLeader: sub === 'leader', hzTBond: sub === 'bond', hzTPower: sub === 'power', hzTChal: sub === 'chal', hzTArea: sub === 'area',
      });
      if (T && sub === 'leader') {
        const L = T.leaders;
        out.hzLeaderNote = '一般隊長次數上限 ' + L.maxPlay.toLocaleString() + '；EX 等級封頂需累計 ' + L.maxEx.toLocaleString() + ' 次';
        out.hzLeaderRows = L.rows.map(r => ({ n: nm(r.cid), play: r.play.toLocaleString(), ex: 'EX Lv' + r.exLv + '・' + r.exCount.toLocaleString(), w: (L.maxPlay ? Math.min(100, Math.round(r.play / L.maxPlay * 100)) : 0) + '%' }));
      }
      if (T && sub === 'bond') {
        out.hzBondNote = T.bonds.rows.length ? '共 ' + T.bonds.rows.length + ' 組，羈絆等級上限 ' + T.bonds.maxLv : '還沒有羈絆資料';
        out.hzBondRows = T.bonds.rows.slice(0, 120).map(r => ({ n: nm(r.b1) + ' × ' + nm(r.b2), lv: 'Lv ' + r.lv, p: r.span != null ? r.exp + ' / ' + r.span + '（還差 ' + r.need + '）' : (r.lv >= T.bonds.maxLv ? '已滿級' : '') }));
      }
      if (T && sub === 'power') {
        const P = T.power;
        out.hzPowChars = P.chars.slice().sort((a, b) => b.total - a.total || a.cid - b.cid).map(c => ({ n: nm(c.cid), v: pct(c.total), d: '區域 ' + pct(c.area) + '・等級 ' + pct(c.rank) + (c.fix ? '・家具 ' + pct(c.fix) : '') }));
        out.hzPowUnits = P.units.map(u => ({ n: UN[u.u] || u.u, v: pct(u.total), d: '區域 ' + pct(u.area) + (u.gate ? '・大門 ' + pct(u.gate) : '') }));
        out.hzPowAttrs = P.attrs.map(a => ({ n: AT[a.a] || a.a, v: pct(a.total), d: '區域道具' }));
      }
      if (T && sub === 'chal') {
        out.hzChalRows = T.chal.slice().sort((a, b) => b.hs - a.hs || a.cid - b.cid).map(r => ({ n: nm(r.cid), hs: r.hs ? r.hs.toLocaleString() : '—', st: r.stage ? '關卡 ' + r.stage : '', next: r.next ? '下個獎勵 ' + r.next.toLocaleString() : '獎勵已全拿', un: r.unclaimed ? '有 ' + r.unclaimed + ' 個獎勵沒領' : '', hasUn: r.unclaimed > 0 }));
      }
      if (sub === 'area') {
        const A = s.hzArea;
        out.hzAreaBusy = !!s.hzAreaBusy; out.hzAreaBtn = s.hzAreaBusy ? '計算中…' : (A ? '重新計算' : '依目前隊伍算最划算的升級');
        out.hzAreaHas = !!(A && A.length); out.hzAreaEmpty = !!(A && !A.length);
        out.hzAreaRows = (A || []).slice(0, 20).map((x, i) => ({ i: i + 1, n: (areaName[x.area_item_id] || ('道具 #' + x.area_item_id)) + ' → Lv' + x.next_level,
          c: [(x.cost && x.cost.coin ? x.cost.coin.toLocaleString() + ' 金幣' : ''), (x.cost && x.cost.seed ? x.cost.seed + ' 不可思議的種子' : ''), (x.cost && x.cost.szk ? x.cost.szk + ' 祈願水滴' : '')].filter(Boolean).join('・'),
          v: '+' + Math.round(x.power || 0).toLocaleString() + ' 綜合力' }));
        out.onHzAreaRun = () => this.hzAreaRun();
      }
    }
    if (tab === 'res') {
      const v = s.hzVer;
      Object.assign(out, {
        hzVerLine: v ? ('台服 master ' + (v.dataVersion || '?') + (v.cdnVersion ? '（CDN ' + v.cdnVersion + '）' : '')) : v === false ? '暫時讀不到 master 版本' : '讀取中…',
        hzAssetChips: Object.keys(this.HZ_ASSETS).map(k => Object.assign({ v: k, n: this.HZ_ASSETS[k][0], url: this.HZ_ASSETS[k][1] }, chipOn((s.hzAsset || 'global') === k))),
        hzAssetNow: this.hzAssetRoot(), hzAssetDemo: this.hzThumb('res001_no001', false),
        hzApiLine: cfg.clientId ? 'OAuth 已開通（client：' + cfg.clientId + '）' : 'OAuth 尚未開通',
        hzTokenLine: cfg.apiToken ? '已設定：排名與玩家資料可經本站 Worker 反代 Haruki Sekai API' : '未設定：目前只用不需 token 的 Event Tracker 與公開 API',
        hzRepos: this.HZ_REPOS.map(r => ({ n: r[0], url: r[1], d: r[2], use: r[3] })),
        onHzAsset: e => { const k = e.currentTarget.dataset.v; try { localStorage.setItem('sekai-hk-asset', k); } catch (err) {} this.setState({ hzAsset: k }); },
      });
    }
    return out;
  },
  };
}
