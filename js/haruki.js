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

/* ---------- MySekai：照 Haruki-Cloud internal/pjsk/render/mysekai（MIT） ----------
   Haruki 的 MySekai 資料一部分在最上層（來訪角色、天氣排程），大多在 updatedResources 底下。
   地圖、天氣是「上傳那一刻」的狀態：台服每天 5:00 與 17:00 重置，過了重置時間就不準了。 */
export const HZ_MYS_SITES = [5, 7, 6, 8];
export function hzMysGet(mys, key) {
  if (!mys || typeof mys !== 'object') return undefined;
  const u = mys.updatedResources;
  return u && u[key] !== undefined ? u[key] : mys[key];
}
const hzMs = v => { v = +v || 0; return v > 0 && v < 1e12 ? v * 1000 : v; };
export function hzMysTime(mys) {
  if (!mys) return 0;
  return Math.max(hzMs(mys.now), hzMs(mys.updatedResources && mys.updatedResources.now), hzMs(mys.upload_time));
}
/* 台服（UTC+8）在 t 之前最近一次重置（5:00 或 17:00） */
export function hzMysLastReset(t) {
  const tz = 8 * 3600e3, local = t + tz, day = Math.floor(local / 86400e3) * 86400e3, h = (local - day) / 3600e3;
  return day + (h >= 17 ? 17 : h >= 5 ? 5 : -7) * 3600e3 - tz;
}
/* 稀有度：2＝最稀有（紅字）、1＝稀有（紫字）、0＝一般；清單照 Haruki-Cloud helpers_resources.go */
export function hzMysRarity(key, rarityOf) {
  const most = ['mysekai_material_5', 'mysekai_material_12', 'mysekai_material_20', 'mysekai_material_24', 'mysekai_fixture_121', 'material_17', 'material_170', 'material_173'];
  const rare = ['mysekai_material_32', 'mysekai_material_33', 'mysekai_material_34', 'mysekai_material_61', 'mysekai_material_64', 'mysekai_material_65', 'mysekai_material_66'];
  if (most.includes(key)) return 2;
  const m = /^(mysekai_material|material)_(\d+)$/.exec(key);
  if (m && m[1] === 'material' && +m[2] >= 174 && +m[2] <= 203) return 2;
  if (m && m[1] === 'mysekai_material' && +m[2] >= 67 && +m[2] <= 92) return 2;
  if (rare.includes(key) || /^mysekai_music_record_/.test(key)) return 1;
  if (m && m[1] === 'mysekai_material') { const r = rarityOf && rarityOf[+m[2]]; if (r === 'rarity_3') return 2; if (r === 'rarity_2') return 1; }
  return 0;
}
const HZ_MYS_TYPE = { material: 'material', item: 'mysekai_item', mysekai_item: 'mysekai_item', fixture: 'mysekai_fixture', mysekai_fixture: 'mysekai_fixture', music_record: 'mysekai_music_record', mysekai_music_record: 'mysekai_music_record', mysekai_material: 'mysekai_material' };
/* 今日地圖上還沒採的資源：每個場所（5、7、6、8）加總，唱片最前、再依稀有度與數量排 */
export function hzMysResources(mys, rarityOf) {
  const maps = hzMysGet(mys, 'userMysekaiHarvestMaps') || [];
  const bySite = {};
  maps.forEach(m => {
    const site = +m.mysekaiSiteId; if (!site) return;
    const c = bySite[site] || (bySite[site] = {});
    (m.userMysekaiSiteHarvestResourceDrops || []).forEach(d => {
      if ((d.mysekaiSiteHarvestResourceDropStatus || d.status) !== 'before_drop') return;
      const type = HZ_MYS_TYPE[d.resourceType || d.type] || (d.resourceType || d.type), id = +(d.resourceId || d.id);
      if (!type || !id) return;
      const k = type + '_' + id; c[k] = (c[k] || 0) + Math.max(1, +d.quantity || 1);
    });
  });
  const score = (k, n) => (/^mysekai_music_record_/.test(k) ? 1e7 : [0, 1e5, 1e6][hzMysRarity(k, rarityOf)]) + n;
  return HZ_MYS_SITES.concat(Object.keys(bySite).map(Number).filter(x => !HZ_MYS_SITES.includes(x))).filter(site => bySite[site] && Object.keys(bySite[site]).length).map(site => ({
    site, items: Object.keys(bySite[site]).sort((a, b) => score(b, bySite[site][b]) - score(a, bySite[site][a]) || (a < b ? -1 : 1)).map(k => {
      const i = k.lastIndexOf('_');
      return { key: k, type: k.slice(0, i), id: +k.slice(i + 1), qty: bySite[site][k], rare: hzMysRarity(k, rarityOf) };
    }),
  }));
}
/* 今天來訪的角色（最多 6 位；組合角色不算），isReservation＝用邀請函約來的 */
export function hzMysVisitors(mys, groups) {
  const visit = (mys && (mys.userMysekaiGateCharacterVisit || hzMysGet(mys, 'userMysekaiGateCharacterVisit'))) || {};
  const list = visit.userMysekaiGateCharacters || [];
  const byId = new Map((groups || []).map(g => [+g.id, g]));
  const out = [], seen = new Set();
  for (const e of list) {
    const g = byId.get(+e.mysekaiGameCharacterUnitGroupId);
    if (!g || +g.gameCharacterUnitId2 || !+g.gameCharacterUnitId1) continue;
    const u = +g.gameCharacterUnitId1; if (seen.has(u)) continue;
    seen.add(u); out.push({ unit: u, invited: !!e.isReservation });
    if (out.length >= 6) break;
  }
  return out;
}
/* 大門升級：mysekaiGateMaterialGroups 的 groupId＝大門×1000＋等級；累計到每一級要的素材 vs 手上的 */
export const HZ_GATE_MAX = 40;
export function hzMysGates(userGates, userMats, groupRows, levelsAhead) {
  const have = {}; (userMats || []).forEach(m => { have[+m.mysekaiMaterialId] = +m.quantity || 0; });
  const cur = {}; (userGates || []).forEach(g => { if (+g.mysekaiGateId) cur[+g.mysekaiGateId] = +g.mysekaiGateLevel || 0; });
  const need = {};
  (groupRows || []).forEach(r => {
    const gate = Math.floor(+r.groupId / 1000), lv = +r.groupId % 1000;
    if (!gate || lv <= 0 || lv > HZ_GATE_MAX) return;
    ((need[gate] = need[gate] || {})[lv] = need[gate][lv] || []).push({ id: +r.mysekaiMaterialId, n: +r.quantity || 0 });
  });
  return Object.keys(need).map(Number).sort((a, b) => a - b).map(gate => {
    const lv = cur[gate] || 0, sums = {}, steps = [];
    for (let L = lv + 1; L <= Math.min(HZ_GATE_MAX, lv + (levelsAhead || 5)); L++) {
      const mats = (need[gate][L] || []).map(m => { sums[m.id] = (sums[m.id] || 0) + m.n; return { id: m.id, n: m.n, cum: sums[m.id], have: have[m.id] || 0 }; });
      if (!mats.length) continue;
      steps.push({ lv: L, mats, ok: mats.every(m => m.have >= m.cum) });
    }
    let reach = lv; for (const st of steps) { if (st.ok) reach = st.lv; else break; }
    return { gate, lv, max: lv >= HZ_GATE_MAX, steps, reach };
  });
}
/* 唱片收集：只算現在拿得到的一般樂曲（排除 241、290、未上架與限時下架的），依團體分類 */
export function hzMysRecords(userRecs, records, musics, limited, tags, now) {
  const got = new Set((userRecs || []).map(r => +r.mysekaiMusicRecordId));
  const mus = new Map((musics || []).map(m => [+m.id, m]));
  const win = {}; (limited || []).forEach(l => { (win[+l.musicId] = win[+l.musicId] || []).push(l); });
  const tagOf = {}; (tags || []).forEach(t => { const id = +t.musicId, g = t.musicTag; if (id && g && g !== 'all' && g !== 'vocaloid' && !tagOf[id]) tagOf[id] = g; });
  const cats = {};
  (records || []).forEach(r => {
    if (r.mysekaiMusicTrackType !== 'music') return;
    const mid = +r.externalId; if (!+r.id || !mid || mid === 241 || mid === 290) return;
    const m = mus.get(mid); if (!m || +m.publishedAt > now) return;
    const w = win[mid]; if (w && w.length && !w.some(x => +x.startAt <= now && now <= +x.endAt)) return;
    const tag = tagOf[mid] || 'vocaloid';
    (cats[tag] = cats[tag] || []).push({ mid, title: m.title, abn: m.assetbundleName, got: got.has(+r.id) });
  });
  const order = ['light_music_club', 'idol', 'street', 'theme_park', 'school_refusal', 'vocaloid', 'other'];
  const list = order.concat(Object.keys(cats).filter(k => !order.includes(k))).filter(k => cats[k]).map(k => ({ tag: k, rows: cats[k], got: cats[k].filter(x => x.got).length }));
  return { cats: list, total: list.reduce((a, c) => a + c.rows.length, 0), got: list.reduce((a, c) => a + c.got, 0) };
}
/* 天氣排程：第 i 筆是「上次 5:00 起算」的第 i 個 12 小時 */
export function hzMysWeather(mys, snap) {
  const sch = (mys && (mys.mysekaiPhenomenaSchedules || hzMysGet(mys, 'mysekaiPhenomenaSchedules'))) || [];
  if (!sch.length || !snap) return [];
  let start = hzMysLastReset(snap); const tz = 8 * 3600e3;
  if (((start + tz) % 86400e3) / 3600e3 === 17) start -= 12 * 3600e3;
  return sch.map((x, i) => ({ id: +x.mysekaiPhenomenaId || 1, from: start + i * 12 * 3600e3, to: start + (i + 1) * 12 * 3600e3 }));
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
    ['自動上傳：iOS 模組與 HarukiProxy', '玩遊戲時自動上傳，資料最即時。iOS／iPadOS 在工具箱上傳頁的「iOS模組」分頁照指示設定；Android／Windows 用 HarukiProxy。',
      [['iOS 模組設定（工具箱）', 'https://haruki.seiunx.com/upload-data?tab=ios'], ['HarukiProxy 教程（Android／Windows）', 'https://neo.haruki.seiunx.com/haruki-proxy/']]],
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
    let saved = null; try { saved = JSON.parse(localStorage.getItem('sekai-hk-tab') || 'null'); } catch (e) {}
    if (saved) this.setState({ hzTrainTab: saved.train || 'crank', hzMysTab: saved.mys || 'res', hzHelpTab: saved.help || 'guide' });
    // 從別頁帶著 hzTab 進來（例如我的帳號的「完整使用教學」）就照那個；否則回到上次的分頁
    this.hzSetTab(this.state.hzTabReq || (saved && saved.t) || 'home', this.state.hzTabReqSub);
    this.setState({ hzTabReq: null, hzTabReqSub: null });
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
    // 之前匯入的資料可能沒有 userGamedata（Haruki 公開 API 不給），讀出來時一樣補上
    this._hzSuite = rec && rec.suite ? this.hkNormalize(rec.suite, rec.uid) : null; this._hzSuiteAt = rec && rec.at;
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
    this.setState({ hzCrank: { rows, has: !!(suite && suite.userCharacters), missions: !!(suite && Array.isArray(suite.userCharacterMissionV2s)), at: Date.now() } });
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
    this.setState({ hzTrain: { has: Array.isArray(U.userCharacters), leaders: hzLeaders(M.groups, U), bonds: hzBonds(M, U), power: hzPowerBonus(M, U), chal: hzChallenge(M.chal, U),
      // Haruki 公開 API／OAuth 的預設鍵清單沒有這幾項，拿不到就提示去工具箱看，不要顯示一排 0
      gotLeader: Array.isArray(U.userCharacterMissionV2s) || Array.isArray(U.userCharacterLiveUsageCounts), gotBond: Array.isArray(U.userBonds), at: Date.now() } });
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
  /* ---------- MySekai ---------- */
  async hzMysData() {
    const rec = await this.hkSuiteGet().catch(() => null);
    return rec ? { mys: rec.mys || null, suite: rec.suite || null } : { mys: null, suite: null };
  },
  async hzLoadMys() {
    if (this._hzMysP) return this._hzMysP;
    this._hzMysP = (async () => {
      const soft = f => this.tdbJson(f + '.json').catch(() => []);
      const names = ['mysekaiSites', 'mysekaiMaterials', 'mysekaiItems', 'mysekaiMusicRecords', 'mysekaiGateMaterialGroups', 'mysekaiGates', 'mysekaiGameCharacterUnitGroups', 'gameCharacterUnits', 'mysekaiPhenomenas', 'materials', 'musics', 'limitedTimeMusics', 'musicTags'];
      const got = await Promise.all(names.map(soft));
      const M = {}; names.forEach((n, i) => { M[n] = got[i] || []; });
      // 家具名稱表由 loadFixtures() 放進 this.state.fixtures（它本身不回傳資料），畫面上直接讀那裡，載好就會重繪
      this.loadFixtures();
      this._hzMysM = M;
    })().catch(e => { this._hzMysP = null; this.setState({ hzMsg: 'MySekai 資料載入失敗：' + ((e && e.message) || e) }); });
    return this._hzMysP;
  },
  async hzMysBuild() {
    await this.hzLoadMys();
    const M = this._hzMysM; if (!M) return;
    const { mys, suite } = await this.hzMysData();
    if (!mys) { this.setState({ hzMys: { has: false, at: Date.now() } }); return; }
    const rarityOf = {}; M.mysekaiMaterials.forEach(m => { rarityOf[+m.id] = m.mysekaiMaterialRarityType; });
    const snap = hzMysTime(mys), now = Date.now();
    // 大門：正在升的（等級高、沒滿）排前面，滿級的放最後；每扇只列接下來 3 級，免得一長串
    const gates = hzMysGates(hzMysGet(mys, 'userMysekaiGates') || (suite || {}).userMysekaiGates, hzMysGet(mys, 'userMysekaiMaterials') || (suite || {}).userMysekaiMaterials, M.mysekaiGateMaterialGroups, 3)
      .sort((a, b) => (a.max ? 1 : 0) - (b.max ? 1 : 0) || b.lv - a.lv || a.gate - b.gate);
    this.setState({ hzMys: { has: true, snap, stale: !!snap && snap < hzMysLastReset(now), res: hzMysResources(mys, rarityOf),
      visitors: hzMysVisitors(mys, M.mysekaiGameCharacterUnitGroups), gates,
      records: hzMysRecords(hzMysGet(mys, 'userMysekaiMusicRecords'), M.mysekaiMusicRecords, M.musics, M.limitedTimeMusics, M.musicTags, now),
      weather: hzMysWeather(mys, snap || now),
      fixOwned: new Set((hzMysGet(mys, 'userMysekaiFixtures') || []).map(f => +f.mysekaiFixtureId)).size, at: now } });
  },
  /* 總覽：一次把各分頁的摘要算好（各自的資料只下載一次，瀏覽器會快取） */
  hzHomeBuild() {
    if (!this.state.hzCrank) this.hzCrankBuild();
    if (!this.state.hzTrain) this.hzTrainBuild();
    if (!this.state.hzMys) this.hzMysBuild();
  },
  /* 匯入新資料後：丟掉用舊資料算好的結果，目前這一頁重算（引擎裡的玩家資料下次搜尋時重送） */
  hzAfterImport() {
    this._hzSuite = null; this._hzSentUser = '';
    this.setState({ hzCrank: null, hzTrain: null, hzMys: null, hzRes: null, hzArea: null }, () => { if (this.state.page === 'haruki') this.hzSetTab(this.state.hzTab); });
  },
  HZ_TABS: { home: 1, deck: 1, train: 1, mys: 1, help: 1 },
  hzSetTab(t, sub) {
    // 舊的分頁名稱（角色等級、教學、資源）併進新的五大分頁
    if (t === 'crank') { t = 'train'; sub = 'crank'; } else if (t === 'guide' || t === 'res') { sub = t; t = 'help'; }
    if (!this.HZ_TABS[t]) t = 'home';
    const patch = { hzTab: t };
    if (sub && t === 'train') patch.hzTrainTab = sub;
    if (sub && t === 'mys') patch.hzMysTab = sub;
    if (sub && t === 'help') patch.hzHelpTab = sub;
    this.setState(patch);
    try { localStorage.setItem('sekai-hk-tab', JSON.stringify({ t, train: patch.hzTrainTab || this.state.hzTrainTab, mys: patch.hzMysTab || this.state.hzMysTab, help: patch.hzHelpTab || this.state.hzHelpTab })); } catch (e) {}
    if (t === 'home') this.hzHomeBuild();
    if (t === 'train') { if (!this.state.hzCrank) this.hzCrankBuild(); if (!this.state.hzTrain) this.hzTrainBuild(); }
    if (t === 'mys' && !this.state.hzMys) this.hzMysBuild();
  },

  hzVals(s) {
    if (s.page !== 'haruki') return { hzReady: true };
    const meta = s.hzMeta, cfg = s.hkCfg || {}, tab = this.HZ_TABS[s.hzTab] ? s.hzTab : 'home';
    const tsub = s.hzTrainTab || 'crank', msub = s.hzMysTab || 'res', hsub = s.hzHelpTab || 'guide';
    const chipOn = on => on ? { bg: 'var(--ink-grad)', fg: '#fff' } : { bg: 'var(--card-2)', fg: 'var(--text-2)' };
    /* 五大分頁：每個都附一句「這裡做什麼」，選中的那顆實心 */
    const tabs = [['home', '總覽', '一眼看完'], ['deck', '組卡', '活動最佳隊伍'], ['train', '養成', '等級・加成・挑戰'], ['mys', 'MySekai', '資源・大門・唱片'], ['help', '說明', '教學與資源']]
      .map(([v, n, d]) => Object.assign({ v, n, d, on: tab === v, sub: tab === v ? 'rgba(255,255,255,.8)' : 'var(--text-3)', bd: tab === v ? 'transparent' : 'var(--border)' }, chipOn(tab === v)));
    const subChips = (list, cur) => list.map(([v, n]) => Object.assign({ v, n }, chipOn(cur === v)));
    const fmtT = t => { if (!t) return ''; const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    const cards = {}; (s.rateCards || []).forEach(c => { cards[c[0]] = c; });
    const chName = {}; (s.rateChars || []).forEach(c => { chName[c[0]] = c[1]; });
    const out = {
      hzReady: true, hzTabs: tabs, hzIsHome: tab === 'home', hzIsDeck: tab === 'deck', hzIsMys: tab === 'mys',
      hzTrainBar: tab === 'train', hzIsCrank: tab === 'train' && tsub === 'crank', hzIsTrain: tab === 'train' && tsub !== 'crank',
      hzHelpBar: tab === 'help', hzIsGuide: tab === 'help' && hsub === 'guide', hzIsRes: tab === 'help' && hsub === 'res',
      hzTrainChips: subChips([['crank', '角色等級'], ['leader', '隊長次數'], ['bond', '羈絆'], ['power', '綜合力加成'], ['chal', '挑戰 Live'], ['area', '區域道具']], tsub),
      hzHelpChips: subChips([['guide', '使用教學'], ['res', '資料與資源']], hsub),
      hzMysChips: subChips([['res', '今日資源'], ['visit', '來訪與天氣'], ['gate', '大門升級'], ['rec', '唱片收集'], ['fix', '家具與對話']], msub),
      onHzSub: e => { const d = e.currentTarget.dataset; this.hzSetTab(d.t, d.v); },
      onHzTrainRefresh: () => { this.hzCrankBuild(); this.hzTrainBuild(); },
      onHzMysRefresh: () => this.hzMysBuild(),
      hzGuide: this.HZ_GUIDE.map((g, i) => ({ n: i + 1, t: g[0], d: g[1], links: g[2].map(l => ({ n: l[0], url: l[1] })) })),
      onHzGuide: () => this.hzSetTab('help', 'guide'),
      onHzGo: e => { const d = e.currentTarget.dataset; this.hzSetTab(d.t, d.v || undefined); try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (err) {} },
      hzHas: !!meta, hzNone: !meta,
      hzWho: meta ? ((meta.name || '玩家') + (meta.rank ? '・等級 ' + meta.rank : '') + '・ID ' + meta.uid) : '',
      hzWhen: meta ? '本機資料同步於 ' + fmtT(meta.at) + (meta.upload ? '（遊戲資料上傳於 ' + fmtT(meta.upload) + '）' : '') : '',
      hzCanOAuth: !!cfg.clientId, hzLinked: !!(s.hkTok && (s.hkTok.access || s.hkTok.refresh)),
      hzUidIn: s.hkUid || s.pid || '', hzBusyImp: !!s.hkBusy, hzImpMsg: s.hkMsg || '',
      hzMsg: s.hzMsg || '', hzHasMsg: !!s.hzMsg,
      onHzTab: e => this.hzSetTab(e.currentTarget.dataset.v),
      /* 資料新鮮度：遊戲資料上傳超過 24 小時就提醒重新上傳 */
      hzStale: !!(meta && meta.upload && Date.now() - meta.upload > 86400e3),
      hzStaleMsg: meta && meta.upload ? '遊戲資料是 ' + Math.floor((Date.now() - meta.upload) / 86400e3) + ' 天前上傳的，數字可能已經跟遊戲裡不一樣；到 Haruki 工具箱重新上傳後，按「重新同步」。' : '',
      onHzSync: () => { const linked = !!(this.state.hkTok && (this.state.hkTok.access || this.state.hkTok.refresh)); this.hkImport(linked ? undefined : 'public'); },
      onHzOAuth: () => this.hkStart(),
      onHzForget: () => { if (!window.confirm('清除這台裝置上的 Haruki 遊戲資料？（收集率、B30 等已匯入的紀錄不受影響）')) return; this.hkSuiteClear().then(() => { this._hzSuite = null; this.setState({ hzMeta: null, hzRes: null, hzCrank: null, hzTrain: null, hzMys: null, hzMsg: '已清除這台裝置上的 Haruki 遊戲資料。' }); }); },
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
    if (tab === 'train' && tsub === 'crank') {
      const C = s.hzCrank, open = s.hzCrankOpen, noM = !!(C && C.has && !C.missions);
      const rows = C ? C.rows.map(r => {
        const pct = r.need > 0 ? Math.min(100, Math.round(r.curExp / r.need * 100)) : 100;
        const miss = r.rows.filter(x => x.nextNeed > 0).sort((a, b) => (b.nextExp || 0) - (a.nextExp || 0));
        return { cid: r.cid, name: chName[r.cid] || ('#' + r.cid), lv: r.lv || '—', exp: r.need ? r.curExp + ' / ' + r.need : (r.lv >= r.maxLv ? '已達上限' : String(r.curExp)),
          pct: pct + '%', pending: r.pending > 0 ? '可領 ' + r.pending + ' EXP，領完 Lv' + r.finalLv : '', hasPending: r.pending > 0,
          open: !noM && String(open) === String(r.cid), btn: String(open) === String(r.cid) ? '收起' : '任務', canOpen: !noM,
          missions: noM ? [] : miss.map(x => ({ t: x.sentence ? x.sentence.replace('{requirement}', String(x.nextNeed)) : x.type,
            p: (x.ex ? '累計 ' : '') + x.cur + ' / ' + x.nextNeed + (x.unit ? '' : ''), e: '+' + x.nextExp + ' EXP' })) };
      }) : [];
      const f = Math.max(1, +s.hzCalcFrom || 1), t = Math.max(f, +s.hzCalcTo || f);
      const a = this.hzLevelTotal(f), b = this.hzLevelTotal(t);
      Object.assign(out, {
        hzCrankLoading: !C, hzCrankRows: rows, hzCrankHas: !!(C && C.has), hzCrankNoUser: !!(C && !C.has),
        hzCrankNoMission: !!(C && C.has && !C.missions),
        hzCalcFrom: s.hzCalcFrom || '', hzCalcTo: s.hzCalcTo || '',
        hzCalcOut: a != null && b != null ? 'Lv' + f + ' → Lv' + t + ' 需要 ' + (b - a) + ' EXP' : '輸入兩個等級（1～' + (((this._hzCrankM || {}).levels || []).filter(l => l.levelType === 'character').length || 175) + '）',
        onHzCrankOpen: e => { const c = e.currentTarget.dataset.c; this.setState({ hzCrankOpen: String(this.state.hzCrankOpen) === c ? null : c }); },
        onHzCrankRefresh: () => this.hzCrankBuild(),
      });
    }
    if (tab === 'train' && tsub !== 'crank') {
      const T = s.hzTrain, sub = tsub, pct = v => (Math.round(v * 10) / 10) + '%';
      const UN = { light_sound: 'Leo/need', idol: 'MORE MORE JUMP!', street: 'Vivid BAD SQUAD', theme_park: 'ワンダショ', school_refusal: '25時', piapro: 'VIRTUAL SINGER' };
      const AT = { cute: '可愛', cool: '帥氣', pure: '純真', happy: '快樂', mysterious: '神秘' };
      const nm = c => chName[c] || ('#' + c);
      // 同名道具（例如各區的「音箱」）很多，後面標上所在區域
      const zone = {}; ((this._hzTrainM || {}).areas || []).forEach(a => { zone[a.id] = a.name; });
      const areaName = {}; ((this._hzTrainM || {}).areaItems || []).forEach(a => { areaName[a.id] = a.name + (zone[a.areaId] ? '（' + zone[a.areaId] + '）' : ''); });
      Object.assign(out, {
        hzTrainLoading: !T, hzTrainNoUser: !!(T && !T.has),
        hzTNoLeader: !!(T && T.has && sub === 'leader' && !T.gotLeader), hzTNoBond: !!(T && T.has && sub === 'bond' && !T.gotBond),
        hzTLeader: sub === 'leader' && !!(!T || !T.has || T.gotLeader), hzTBond: sub === 'bond' && !!(!T || !T.has || T.gotBond), hzTPower: sub === 'power', hzTChal: sub === 'chal', hzTArea: sub === 'area',
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
    const UNIT_TAG = { light_music_club: 'Leo/need', light_sound: 'Leo/need', idol: 'MORE MORE JUMP!', street: 'Vivid BAD SQUAD', theme_park: 'Wonderlands×Showtime', school_refusal: '25時、ナイトコードで。', vocaloid: 'VIRTUAL SINGER', piapro: 'VIRTUAL SINGER', other: '其他' };
    /* ---------- 總覽：每張卡片一個數字、一句說明、一顆前往按鈕 ---------- */
    if (tab === 'home') {
      const C = s.hzCrank, T = s.hzTrain, Y = s.hzMys, now = Date.now(), tiles = [];
      const evs = s.hzEvents || [], run = evs.find(e => e[3] <= now && now <= e[4]), next = evs.filter(e => e[3] > now).sort((a, b) => a[3] - b[3])[0], ev = run || next;
      tiles.push({ t: '組卡推薦', v: ev ? ev[1] : '任選歌曲', d: ev ? (run ? '活動進行中：找這一期分數最高的隊伍' : '下一期活動：先把隊伍準備好') : '找任何一首歌分數最高的隊伍', go: 'deck', sub: '', cta: '開始組卡' });
      if (C && C.has) {
        const avg = C.rows.length ? Math.round(C.rows.reduce((a, r) => a + (r.lv || 0), 0) / C.rows.length) : 0, pend = C.rows.reduce((a, r) => a + (r.pending || 0), 0);
        const low = C.rows.slice().sort((a, b) => (a.lv || 0) - (b.lv || 0))[0];
        tiles.push({ t: '角色等級', v: '平均 Lv ' + avg, d: pend ? '有 ' + pend + ' EXP 已達成還沒領' : (low ? '最低的是 ' + (chName[low.cid] || '') + '（Lv ' + (low.lv || 0) + '）' : ''), go: 'train', sub: 'crank', cta: '看角色等級' });
      }
      if (T && T.has) {
        const un = T.chal.reduce((a, r) => a + r.unclaimed, 0), best = T.chal.reduce((m, r) => r.hs > m.hs ? r : m, { hs: 0 });
        tiles.push({ t: '挑戰 Live', v: best.hs ? best.hs.toLocaleString() + ' 分' : '還沒打過', d: un ? '有 ' + un + ' 個分數獎勵還沒領' : (best.hs ? '最高分：' + (chName[best.cid] || '') : ''), go: 'train', sub: 'chal', cta: '看挑戰 Live' });
        const u = T.power.units.slice().sort((a, b) => b.total - a.total)[0];
        if (u) tiles.push({ t: '綜合力加成', v: (Math.round(u.total * 10) / 10) + '%', d: '最高的團體：' + (UNIT_TAG[u.u] || u.u) + '；也看區域道具升級建議', go: 'train', sub: 'power', cta: '看加成' });
      }
      if (Y && Y.has) {
        const rare = Y.res.reduce((a, x) => a + x.items.filter(i => i.rare >= 2).length, 0), recs = Y.res.reduce((a, x) => a + x.items.filter(i => i.type === 'mysekai_music_record').length, 0);
        tiles.push({ t: 'MySekai 今日資源', v: rare ? rare + ' 種稀有資源' : '沒有稀有資源', d: (recs ? '地圖上有 ' + recs + ' 張唱片；' : '') + (Y.stale ? '資料已過重置時間，重新上傳才準' : '上傳當下的地圖'), go: 'mys', sub: 'res', cta: '看今日資源' });
        const g = Y.gates.filter(x => !x.max).sort((a, b) => b.lv - a.lv)[0];
        if (g) tiles.push({ t: '大門升級', v: 'Lv ' + g.lv + ' → ' + (g.reach > g.lv ? 'Lv ' + g.reach : '素材不夠'), d: g.reach > g.lv ? '手上的素材可以直接升到 Lv ' + g.reach : '下一級還缺素材，看缺哪些', go: 'mys', sub: 'gate', cta: '看大門' });
        tiles.push({ t: '唱片收集', v: Y.records.got + ' / ' + Y.records.total, d: '還差 ' + (Y.records.total - Y.records.got) + ' 張', go: 'mys', sub: 'rec', cta: '看缺哪些' });
      } else if (Y && !Y.has) {
        tiles.push({ t: 'MySekai', v: '沒有資料', d: '在工具箱把 MySekai 也設成允許公開 API（或用授權），再按重新同步', go: 'help', sub: 'guide', cta: '看怎麼設定' });
      }
      out.hzHomeTiles = tiles; out.hzHomeLoading = !!meta && !(C && T && Y);
    }
    /* ---------- MySekai ---------- */
    if (tab === 'mys') {
      const Y = s.hzMys, M = this._hzMysM || {};
      out.hzMysLoading = !Y; out.hzMysNone = !!(Y && !Y.has);
      const has = !!(Y && Y.has);
      out.hzMysRes = has && msub === 'res'; out.hzMysVisit = has && msub === 'visit'; out.hzMysGate = has && msub === 'gate'; out.hzMysRec = has && msub === 'rec'; out.hzMysFix = has && msub === 'fix';
      if (Y && Y.has) {
        const by = (list, k) => { const o = {}; (list || []).forEach(x => { o[x[k || 'id']] = x; }); return o; };
        const mat = by(M.mysekaiMaterials), com = by(M.materials), item = by(M.mysekaiItems), rec = by(M.mysekaiMusicRecords), mus = by(M.musics), site = by(M.mysekaiSites), gate = by(M.mysekaiGates), phen = by(M.mysekaiPhenomenas), gcu = by(M.gameCharacterUnits);
        const fix = {}; ((s.fixtures || {}).rows || []).forEach(r => { fix[r[0]] = r; });
        const jk = a => this.ASSET + '/music/jacket/' + a + '/' + a + '.webp';
        const resOf = it => {
          if (it.type === 'mysekai_material') { const m = mat[it.id]; return [m ? m.name : '素材 #' + it.id, m ? this.ASSET + '/mysekai/thumbnail/material/' + m.iconAssetbundleName + '.webp' : '']; }
          if (it.type === 'material') { const m = com[it.id]; return [m ? m.name : '素材 #' + it.id, this.ASSET + '/thumbnail/material/material' + it.id + '.webp']; }
          if (it.type === 'mysekai_item') { const m = item[it.id]; return [m ? m.name : '道具 #' + it.id, m ? this.ASSET + '/mysekai/thumbnail/item/' + m.iconAssetbundleName + '.webp' : '']; }
          if (it.type === 'mysekai_fixture') { const r = fix[it.id]; return [r ? r[1] : '家具 #' + it.id, r ? this.fixImg(r) : '']; }
          if (it.type === 'mysekai_music_record') { const r = rec[it.id], m = r && mus[r.externalId]; return [m ? '唱片：' + m.title : '唱片', m ? jk(m.assetbundleName) : '']; }
          return ['#' + it.id, ''];
        };
        const RC = ['var(--text-2)', '#7c3aed', '#dc2626'];
        out.hzMysWhen = '資料時間 ' + fmtT(Y.snap) + (Y.stale ? '：已經過了 5:00／17:00 的重置，現在遊戲裡的地圖與天氣可能不一樣' : '：到下一次 5:00／17:00 重置前都有效');
        out.hzMysStale = !!Y.stale;
        if (msub === 'res') {
          out.hzMysSites = Y.res.map(x => ({ n: (site[x.site] || {}).name || ('場所 ' + x.site), cnt: x.items.length + ' 種',
            items: x.items.map(it => { const [n, img] = resOf(it); return { n, img, q: '×' + it.qty, c: RC[it.rare], w: it.rare ? 800 : 600 }; }) }));
          out.hzMysResEmpty = !Y.res.length;
        }
        if (msub === 'visit') {
          out.hzMysVisitors = Y.visitors.map(v => { const u = gcu[v.unit] || {}, cid = +u.gameCharacterId || v.unit; return { n: (chName[cid] || '#' + cid) + (v.unit > 26 && u.unit ? '（' + (UNIT_TAG[u.unit] || u.unit) + '）' : ''), img: this.charaSd(v.unit), inv: v.invited ? '邀請函' : '' }; });
          out.hzMysNoVisit = !Y.visitors.length;
          out.hzMysWeather = Y.weather.map(w => { const p = phen[w.id] || {}; const cur = w.from <= Date.now() && Date.now() < w.to; return { n: p.name || '天氣 #' + w.id, t: fmtT(w.from) + ' – ' + fmtT(w.to), cur, bg: cur ? 'color-mix(in oklab,var(--accent) 12%,transparent)' : 'transparent' }; });
          out.hzMysNoWeather = !Y.weather.length;
        }
        if (msub === 'gate') {
          out.hzMysGates = Y.gates.map(g => ({ n: (gate[g.gate] || {}).name || ('大門 #' + g.gate), lv: 'Lv ' + g.lv, max: g.max,
            sum: g.max ? '已經升滿了' : (g.reach > g.lv ? '手上的素材可以直接升到 Lv ' + g.reach : '下一級還缺素材'),
            steps: g.steps.map(st => ({ lv: 'Lv ' + st.lv, ok: st.ok, tag: st.ok ? '夠' : '不夠', tc: st.ok ? '#15803d' : '#dc2626',
              mats: st.mats.map(m => { const x = mat[m.id]; return { n: x ? x.name : '#' + m.id, img: x ? this.ASSET + '/mysekai/thumbnail/material/' + x.iconAssetbundleName + '.webp' : '', t: m.have.toLocaleString() + ' / ' + m.cum.toLocaleString(), c: m.have >= m.cum ? 'var(--text-3)' : '#dc2626' }; }) })) }));
          out.hzMysGateNote = '每一級列出「手上數量 / 升到這一級累計要的數量」，紅字表示不夠。';
        }
        if (msub === 'rec') {
          const R = Y.records, all = !!s.hzRecAll;
          out.hzMysRecSum = R.got + ' / ' + R.total + '（' + (R.total ? Math.round(R.got / R.total * 1000) / 10 : 0) + '%）';
          out.hzMysRecCats = R.cats.map(c => ({ n: UNIT_TAG[c.tag] || c.tag, p: c.got + ' / ' + c.rows.length,
            rows: c.rows.filter(r => all || !r.got).map(r => ({ t: r.title, img: jk(r.abn), got: r.got, op: r.got ? '.45' : '1' })) }));
          out.hzRecAllBtn = all ? '只看還沒拿到的' : '全部顯示'; out.onHzRecAll = () => this.setState({ hzRecAll: !this.state.hzRecAll });
        }
        if (msub === 'fix') {
          out.hzMysFixLine = Y.fixOwned ? '遊戲資料裡記錄了 ' + Y.fixOwned + ' 件家具' : '這份 MySekai 資料沒有家具清單';
          out.onHzGoPage = e => this.go(e.currentTarget.dataset.p);
        }
      }
    }
    if (tab === 'help' && hsub === 'res') {
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
