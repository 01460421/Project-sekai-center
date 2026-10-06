/* Haruki 專區的純函式測試：角色任務 EXP、目前隊伍、預設歌曲，以及 app.js 的 compact 展開。
   用法：node tests/haruki-zone.mjs   任何一項失敗就 exit 1。 */
import fs from 'node:fs';
import { hzCharacterMissions, hzCurrentDeck, hzBestSong, hzCurrentRound, hzClearedTotal, hzLeaders, hzBonds, hzPowerBonus, hzChallenge,
  hzPlanDerive, hzPlanFor, hzPlanRank, HZ_PLAN_ASPECTS, hzPlanMats, hzMrCosts, HZ_EP_COST, hzPlanCaps, hzPlanRoute,
  hzMysGet, hzMysTime, hzMysLastReset, hzMysRarity, hzMysResources, hzMysVisitors, hzMysGates, hzMysRecords, hzMysWeather } from '../js/haruki.js';

let fail = 0;
const ok = (cond, name) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) fail++; };

/* 角色任務：普通任務取下一個門檻；EX 任務一輪一輪累加 */
const groups = [{ id: 1, seq: 1, requirement: 10, exp: 1 }, { id: 1, seq: 2, requirement: 20, exp: 1 }, { id: 1, seq: 3, requirement: 40, exp: 2 },
  { id: 101, seq: 1, requirement: 5, exp: 1 }, { id: 101, seq: 2, requirement: 10, exp: 2 }];
const levels = [{ levelType: 'character', level: 1, totalExp: 0 }, { levelType: 'character', level: 2, totalExp: 1 }, { levelType: 'character', level: 3, totalExp: 3 },
  { levelType: 'character', level: 4, totalExp: 6 }, { levelType: 'character', level: 5, totalExp: 10 }, { levelType: 'card', level: 2, totalExp: 999 }];
const M = { missions: [{ id: 1001, characterId: 1, characterMissionType: 'play_live', parameterGroupId: 1, isAchievementMission: true, sentence: '遊玩LIVE{requirement}次' },
  { id: 1002, characterId: 1, characterMissionType: 'play_live_ex', parameterGroupId: 101, isAchievementMission: true }], groups, levels };
const U = { userCharacters: [{ characterId: 1, characterRank: 3, exp: 1, totalExp: 4 }],
  userCharacterMissionV2s: [{ characterId: 1, characterMissionType: 'play_live', progress: 25 }, { characterId: 1, characterMissionType: 'play_live_ex', progress: 3 }],
  userCharacterMissionV2Statuses: [{ characterId: 1, missionId: 1001, parameterGroupId: 1, seq: 2, missionStatus: 'achieved' }, { characterId: 1, missionId: 1002, parameterGroupId: 101, seq: 1, missionStatus: 'received' }] };
const r = hzCharacterMissions(1, M, U);
ok(r.lv === 3 && r.curExp === 1 && r.need === 3, '目前等級內 EXP 用 totalExp 減等級起點，升下一級要 3');
ok(r.pending === 1 && r.finalLv === 3 && r.finalExp === 2, '已達成未領的 EXP 加上去後的等級（4＋1＝5，Lv3 起點 3）');
const pl = r.rows.find(x => x.type === 'play_live');
ok(pl.cur === 25 && pl.nextNeed === 40 && pl.nextExp === 2 && pl.upper === 40, '普通任務：下一個門檻與 EXP');
const ex = r.rows.find(x => x.type === 'play_live_ex');
ok(ex.ex && ex.cur === 8 && ex.nextNeed === 15, 'EX 任務：已領輪數累計（5）加本輪進度（3），下一輪要到 15');
ok(hzCurrentRound(groups.filter(g => g.id === 101), 8).join() === '2,3,10' && hzClearedTotal(groups.filter(g => g.id === 101), 2) === 15, 'EX 輪次換算');
ok(hzCharacterMissions(2, M, U) === null, '沒有任務資料的角色回 null');
ok(hzCharacterMissions(1, M, {}).lv === 0, '沒有玩家資料也能列任務');

/* 目前隊伍：userGamedata.deck 指到的那一隊，member1 是隊長 */
ok(hzCurrentDeck({ userGamedata: { deck: 2 }, userDecks: [{ deckId: 1, member1: 1, member2: 2, member3: 3, member4: 4, member5: 5 }, { deckId: 2, member1: 9, member2: 8, member3: 7, member4: 6, member5: 5 }] }).join() === '9,8,7,6,5', '目前隊伍取 userGamedata.deck 那一隊');
ok(hzCurrentDeck({}).length === 0, '沒有隊伍資料回空陣列');

/* 預設歌曲：活動倍率 × (基礎分＋技能與 fever)，只看同難度 */
const metas = [{ music_id: 1, difficulty: 'master', event_rate: 100, base_score: 1, skill_score_multi: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1], fever_score: 0 },
  { music_id: 2, difficulty: 'master', event_rate: 120, base_score: 1, skill_score_multi: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1], fever_score: 0 },
  { music_id: 3, difficulty: 'expert', event_rate: 200, base_score: 2, skill_score_multi: [1, 1, 1, 1, 1, 1], fever_score: 1 }];
ok(hzBestSong(metas, 'master', 'multi') === 2 && hzBestSong(metas, 'expert', 'multi') === 3 && hzBestSong(metas, 'append', 'multi') === null, '預設歌曲依難度挑效率最高');

/* 隊長次數：一般次數取 play_live；EX 次數＝本輪進度＋已領輪數的門檻總和，EX 等級＝已領輪數＋1 */
const L = hzLeaders(groups, U);
const l1 = L.rows.find(r => r.cid === 1);
ok(l1.play === 25 && l1.exLv === 2 && l1.exCount === 3 + 5 && L.maxPlay === 40 && L.maxEx === 5, '隊長次數與 EX 等級');
ok(hzLeaders(groups, { userCharacterLiveUsageCounts: [{ characterId: 4, characterLiveUsageType: 'leader', usageCount: 77 }] }).rows[0].cid === 4, '沒有任務進度時退回 userCharacterLiveUsageCounts，並依總次數排序');

/* 羈絆：VS 各團版本收回本尊，本級 EXP 與還差多少 */
const bondLv = [1, 2, 3].map((l, i) => ({ levelType: 'bonds', level: l, totalExp: [0, 10, 30][i] }));
const B = hzBonds({ bonds: [{ groupId: 1, characterId1: 1, characterId2: 27 }, { groupId: 2, characterId1: 2, characterId2: 3 }], levels: bondLv, gcu: [{ id: 27, gameCharacterId: 21 }] },
  { userBonds: [{ bondsGroupId: 1, rank: 2, exp: 4 }, { bondsGroupId: 2, rank: 3, exp: 0 }, { bondsGroupId: 9, rank: 1 }] });
ok(B.rows.length === 2 && B.rows[0].lv === 3 && B.rows[0].span === null && B.maxLv === 3, '羈絆依等級排序，滿級沒有下一級');
ok(B.rows[1].b2 === 21 && B.rows[1].span === 20 && B.rows[1].need === 16, 'VS 團體版收回本尊，本級 EXP 與還差多少');

/* 綜合力加成：區域道具分到角色／團體／屬性，角色等級、家具 ×0.1、大門（VS 取最高） */
const P = hzPowerBonus({ areaItemLevels: [{ areaItemId: 1, level: 5, targetUnit: 'any', targetCardAttr: 'any', targetGameCharacterId: 1, power1BonusRate: 10 },
  { areaItemId: 2, level: 3, targetUnit: 'idol', targetCardAttr: 'any', targetGameCharacterId: 0, power1BonusRate: 4 }, { areaItemId: 3, level: 2, targetUnit: 'any', targetCardAttr: 'cool', targetGameCharacterId: 0, power1BonusRate: 3 }],
  characterRanks: [{ characterId: 1, characterRank: 3, power1BonusRate: 1.5 }], gateLevels: [{ mysekaiGateId: 1, level: 20, powerBonusRate: 7 }, { mysekaiGateId: 3, level: 10, powerBonusRate: 4 }] },
  { userAreas: [{ areaItems: [{ areaItemId: 1, level: 5 }, { areaItemId: 2, level: 3 }, { areaItemId: 3, level: 2 }] }], userCharacters: U.userCharacters,
    userMysekaiFixtureGameCharacterPerformanceBonuses: [{ gameCharacterId: 1, totalBonusRate: 20 }], userMysekaiGates: [{ mysekaiGateId: 1, mysekaiGateLevel: 20 }, { mysekaiGateId: 3, mysekaiGateLevel: 10 }] });
const pc1 = P.chars.find(c => c.cid === 1), pu = k => P.units.find(u => u.u === k);
ok(pc1.area === 10 && pc1.rank === 1.5 && pc1.fix === 2 && pc1.total === 13.5, '角色：區域＋角色等級＋家具×0.1');
ok(pu('idol').total === 4 && pu('light_sound').gate === 7 && pu('street').gate === 4 && pu('piapro').gate === 7, '團體：區域＋大門，VS 取最高的大門');
ok(P.attrs.find(a => a.a === 'cool').total === 3, '屬性：區域道具');

/* 挑戰 Live：下一個獎勵門檻與沒領的個數 */
const C = hzChallenge([{ id: 1, characterId: 1, highScore: 100000 }, { id: 2, characterId: 1, highScore: 500000 }, { id: 3, characterId: 1, highScore: 3000000 }],
  { userChallengeLiveSoloResults: [{ characterId: 1, highScore: 800000 }], userChallengeLiveSoloStages: [{ characterId: 1, rank: 12 }], userChallengeLiveSoloHighScoreRewards: [{ challengeLiveHighScoreRewardId: 1 }] });
ok(C.length === 26 && C[0].hs === 800000 && C[0].stage === 12 && C[0].next === 3000000 && C[0].unclaimed === 1, '挑戰 Live：最高分、關卡、下一個門檻、沒領的個數');

/* MySekai：資料在 updatedResources 底下；重置在台灣時間 5:00 與 17:00 */
const mys = { upload_time: 1790290800, updatedResources: { now: 1790290000000,
  userMysekaiHarvestMaps: [{ mysekaiSiteId: 5, userMysekaiSiteHarvestResourceDrops: [
    { resourceType: 'mysekai_material', resourceId: 1, quantity: 3, mysekaiSiteHarvestResourceDropStatus: 'before_drop' },
    { resourceType: 'mysekai_material', resourceId: 5, quantity: 1, mysekaiSiteHarvestResourceDropStatus: 'before_drop' },
    { resourceType: 'mysekai_music_record', resourceId: 9, quantity: 1, mysekaiSiteHarvestResourceDropStatus: 'before_drop' },
    { resourceType: 'mysekai_material', resourceId: 1, quantity: 2, mysekaiSiteHarvestResourceDropStatus: 'before_drop' },
    { resourceType: 'mysekai_material', resourceId: 2, quantity: 9, mysekaiSiteHarvestResourceDropStatus: 'dropped' }] },
    { mysekaiSiteId: 6, userMysekaiSiteHarvestResourceDrops: [] }] },
  userMysekaiGateCharacterVisit: { userMysekaiGateCharacters: [{ mysekaiGameCharacterUnitGroupId: 1, isReservation: true }, { mysekaiGameCharacterUnitGroupId: 2 }, { mysekaiGameCharacterUnitGroupId: 1 }] },
  mysekaiPhenomenaSchedules: [{ mysekaiPhenomenaId: 3 }, { mysekaiPhenomenaId: 1 }] };
ok(hzMysGet(mys, 'userMysekaiHarvestMaps').length === 2 && hzMysGet(mys, 'userMysekaiGateCharacterVisit') === mys.userMysekaiGateCharacterVisit, 'MySekai 鍵先找 updatedResources 再找最上層');
ok(hzMysTime(mys) === 1790290800000, '資料時間取 now 與 upload_time（秒換毫秒）較新的');
const T0 = Date.UTC(2026, 8, 25, 1, 0);   // 台灣 9:00
ok(hzMysLastReset(T0) === Date.UTC(2026, 8, 24, 21, 0) && hzMysLastReset(Date.UTC(2026, 8, 25, 10, 0)) === Date.UTC(2026, 8, 25, 9, 0) && hzMysLastReset(Date.UTC(2026, 8, 24, 19, 0)) === Date.UTC(2026, 8, 24, 9, 0), '上一次重置：台灣 5:00／17:00');
ok(hzMysRarity('mysekai_material_5') === 2 && hzMysRarity('mysekai_material_33') === 1 && hzMysRarity('mysekai_material_70') === 2 && hzMysRarity('mysekai_material_40', { 40: 'rarity_2' }) === 1 && hzMysRarity('mysekai_music_record_3') === 1 && hzMysRarity('mysekai_material_1') === 0, '資源稀有度');
const R = hzMysResources(mys, {});
ok(R.length === 1 && R[0].site === 5 && R[0].items.map(i => i.key).join() === 'mysekai_music_record_9,mysekai_material_5,mysekai_material_1' && R[0].items[2].qty === 5, '今日資源：只算未採的、同種加總、唱片最前再依稀有度，空的場所不列');
const V = hzMysVisitors(mys, [{ id: 1, gameCharacterUnitId1: 17 }, { id: 2, gameCharacterUnitId1: 3, gameCharacterUnitId2: 4 }]);
ok(V.length === 1 && V[0].unit === 17 && V[0].invited, '來訪角色：組合角色與重複的略過，邀請函標記');
const G = hzMysGates([{ mysekaiGateId: 1, mysekaiGateLevel: 2 }], [{ mysekaiMaterialId: 1, quantity: 10 }, { mysekaiMaterialId: 2, quantity: 1 }],
  [{ groupId: 1001, mysekaiMaterialId: 1, quantity: 1 }, { groupId: 1003, mysekaiMaterialId: 1, quantity: 4 }, { groupId: 1004, mysekaiMaterialId: 1, quantity: 5 }, { groupId: 1004, mysekaiMaterialId: 2, quantity: 1 }, { groupId: 1005, mysekaiMaterialId: 1, quantity: 5 }, { groupId: 2040, mysekaiMaterialId: 1, quantity: 1 }], 5);
const g1 = G.find(g => g.gate === 1);
ok(g1.lv === 2 && g1.steps.map(x => x.lv).join() === '3,4,5' && g1.steps[1].mats[0].cum === 9 && g1.steps[1].ok && !g1.steps[2].ok && g1.reach === 4, '大門：從目前等級往上累計素材，算出手上的能升到幾級');
ok(G.find(g => g.gate === 2).lv === 0 && G.find(g => g.gate === 2).steps.length === 0, '沒有這扇門的紀錄就從 0 開始，只列前 5 級內有素材表的');
const REC = hzMysRecords([{ mysekaiMusicRecordId: 1 }], [{ id: 1, externalId: 10, mysekaiMusicTrackType: 'music' }, { id: 2, externalId: 11, mysekaiMusicTrackType: 'music' }, { id: 3, externalId: 241, mysekaiMusicTrackType: 'music' },
  { id: 4, externalId: 12, mysekaiMusicTrackType: 'music' }, { id: 5, externalId: 13, mysekaiMusicTrackType: 'bgm' }, { id: 6, externalId: 14, mysekaiMusicTrackType: 'music' }],
  [{ id: 10, title: 'a', publishedAt: 0 }, { id: 11, title: 'b', publishedAt: 0 }, { id: 12, title: 'c', publishedAt: 9e15 }, { id: 14, title: 'd', publishedAt: 0 }, { id: 241, title: 'x', publishedAt: 0 }],
  [{ musicId: 14, startAt: 0, endAt: 1 }], [{ musicId: 10, musicTag: 'idol' }, { musicId: 10, musicTag: 'all' }], Date.now());
ok(REC.total === 2 && REC.got === 1 && REC.cats[0].tag === 'idol' && REC.cats[0].got === 1 && REC.cats[1].tag === 'vocaloid', '唱片：排除 241／未上架／限時下架／非樂曲，依團體分類');
const W = hzMysWeather(mys, T0);
ok(W.length === 2 && W[0].from === Date.UTC(2026, 8, 24, 21, 0) && W[1].from === Date.UTC(2026, 8, 25, 9, 0) && W[0].id === 3, '天氣：從上一次 5:00 起每 12 小時一段');
ok(hzMysWeather(mys, Date.UTC(2026, 8, 25, 10, 0))[0].from === Date.UTC(2026, 8, 24, 21, 0), '17:00 之後也從當天 5:00 那段算起');

/* app.js 的 hkExpandCompact / hkNormalize（從原始碼抽出來測，不載整個 App） */
const src = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const grab = name => { const i = src.indexOf('\n  ' + name + '('); const j = src.indexOf('\n  }\n', i); return src.slice(i + 3, j + 4); };
const obj = eval('({' + grab('hkExpandCompact') + ',' + grab('hkNormalize') + '})');
const rows = obj.hkExpandCompact({ __ENUM__: { missionStatus: ['received', 'achieved'] }, characterId: [1, 2, 3], missionStatus: [1, 0], seq: [2, 5, 9] });
ok(rows.length === 2 && rows[0].missionStatus === 'achieved' && rows[1].missionStatus === 'received' && rows[1].seq === 5, 'compact 展開：列數取最短欄、字典欄換回字串');
const su = obj.hkNormalize({ compactUserMusicResults: { __ENUM__: { playResult: ['clear', 'full_combo'] }, musicId: [7], playResult: [1] }, userCards: [{ cardId: 1 }], userMusicAchievements: { __ENUM__: {}, musicId: [3] } });
ok(Array.isArray(su.userMusicResults) && su.userMusicResults[0].playResult === 'full_combo' && !('compactUserMusicResults' in su), 'compactXxx 鍵改成列形式的原鍵');
ok(su.userMusicAchievements[0].musicId === 3 && su.userCards[0].cardId === 1, '原鍵底下的 compact 也展開，列形式的不動');
const pub = obj.hkNormalize({ userDecks: [{ deckId: 3, member1: 1 }], userProfile: { userId: 9 } }, '7482960281734567890');
ok(pub.userGamedata && pub.userGamedata.userId === '7482960281734567890' && pub.userGamedata.deck === 3, '公開 API 沒給 userGamedata 時補一份（引擎必需），目前隊伍取 userDecks 第一隊');
ok(obj.hkNormalize({ userGamedata: { userId: 1, deck: 5, name: 'x' } }, '2').userGamedata.deck === 5, '有 userGamedata 就不動');

/* 養成策略：推算進度、下一步排序、做幾件升級、先練誰 */
{
  const PG = [];
  const grp = (id, reqs, exp) => reqs.forEach((r, i) => PG.push({ id, seq: i + 1, requirement: r, exp: exp || 1 }));
  grp(14, [2, 4, 6, 8], 2); grp(6, [1, 2, 3]); grp(7, [1, 2, 3]); grp(18, [1, 2, 3, 5]); grp(17, [1, 2]); grp(16, [1, 2]); grp(15, [1, 2]); grp(1, [10, 20, 40]); grp(9, [1, 2, 3]); grp(11, [2, 4]); grp(13, [5, 10]); grp(20, [1, 2]); grp(4, [2, 3]);
  const mk = (id, type, pg) => ({ id, characterId: 1, characterMissionType: type, parameterGroupId: pg, sentence: type + '{requirement}', isAchievementMission: false });
  const PM = { missions: [mk(1, 'collect_member', 14), mk(2, 'read_card_episode_first', 6), mk(3, 'read_card_episode_second', 7), mk(4, 'master_rank_up_standard', 18), mk(5, 'master_rank_up_rare', 17),
    mk(6, 'skill_level_up_standard', 16), mk(7, 'skill_level_up_rare', 15), mk(8, 'play_live', 1), mk(9, 'area_item_level_up_character', 9), mk(10, 'area_item_level_up_unit', 11), mk(11, 'area_item_level_up_reality_world', 13),
    mk(12, 'collect_mysekai_fixture', 20), mk(13, 'collect_stamp', 4)], groups: PG,
    levels: [1, 2, 3, 4, 5, 6].map((lv, i) => ({ levelType: 'character', level: lv, totalExp: [0, 1, 2, 4, 7, 10][i] })) };
  const cardChar = { 101: { ch: 1, rar: 4, name: 'A' }, 102: { ch: 1, rar: 2, name: 'B' }, 103: { ch: 1, rar: 3, name: 'C' }, 201: { ch: 2, rar: 4, name: 'Z' } };
  const PU = { userCharacters: [{ characterId: 1, characterRank: 3, exp: 1, totalExp: 3 }],
    userCards: [{ cardId: 101, masterRank: 2, skillLevel: 3, episodes: [{ cardEpisodeId: 1001, scenarioStatus: 'already_read' }, { cardEpisodeId: 1002, scenarioStatus: 'unread' }] },
      { cardId: 102, masterRank: 1, skillLevel: 1, episodes: [{ cardEpisodeId: 1003, scenarioStatus: 'already_read' }, { cardEpisodeId: 1004, scenarioStatus: 'already_read' }] }, { cardId: 103, masterRank: 0, skillLevel: 2 }, { cardId: 201, masterRank: 5 }],
    userCharacterLiveUsageCounts: [{ characterId: 1, characterLiveUsageType: 'leader', usageCount: 25 }],
    userAreas: [{ areaItems: [{ areaItemId: 1, level: 3 }, { areaItemId: 2, level: 2 }, { areaItemId: 3, level: 4 }, { areaItemId: 4, level: 1 }] }] };
  const ctx = { cardChar, unitOf: { 1: 'light_sound' },
    areaItemLevels: [{ areaItemId: 1, level: 1, targetGameCharacterId: 1, targetUnit: 'any' }, { areaItemId: 2, level: 1, targetGameCharacterId: 0, targetUnit: 'light_sound' }, { areaItemId: 3, level: 1, targetGameCharacterId: 0, targetUnit: 'any', targetCardAttr: 'cool' }, { areaItemId: 4, level: 1, targetGameCharacterId: 2, targetUnit: 'any' }],
    areaItems: [{ id: 1, areaId: 5 }, { id: 2, areaId: 11 }, { id: 3, areaId: 1 }, { id: 4, areaId: 5 }], areas: [{ id: 5, areaType: 'spirit_world' }, { id: 11, areaType: 'reality_world' }, { id: 1, areaType: 'reality_world' }],
    fixRows: [[10, 'ichika doll', 1, 1, [1, 7]], [11, 'saki doll', 1, 1, [2]], [12, 'lamp', 1, 1, []]], tagChar: { 1: 1, 2: 2 }, mysFix: [10, 11, 12] };
  const d = hzPlanDerive(1, Object.assign({ U: PU }, ctx));
  ok(d.collect_member === 3 && d.master_rank_up_rare === 2 && d.master_rank_up_standard === 1 && d.skill_level_up_rare === 2 && d.skill_level_up_standard === 1, '推算：持卡 3 張、★4 專精 2 次、★1～3 專精 1 次、技能升級 2／1 次');
  ok(d.read_card_episode_first === 2 && d.read_card_episode_second === 1, '推算：卡片故事前篇 2、後篇 1（依 episode id 排序）');
  ok(d.play_live === 25 && d.area_item_level_up_character === 3 && d.area_item_level_up_unit === 2 && d.area_item_level_up_reality_world === 6, '推算：隊長 25 場、角色道具 3、團體道具 2、現實世界道具 6（不含角色道具）');
  ok(d.collect_mysekai_fixture === 1, '推算：帶角色標籤的持有家具 1 件');
  ok(hzPlanDerive(1, { U: {} }).collect_member === undefined, '沒有 userCards 就不回持卡相關的推算');
  const p = hzPlanFor(1, PM, PU, ctx);
  ok(p && !p.hasMission && p.rows.find(r => r.type === 'collect_member').cur === 3 && p.rows.find(r => r.type === 'collect_member').nextNeed === 4 && p.rows.find(r => r.type === 'collect_member').src === 'derived', '沒有任務進度時用推算值算下一個門檻（持卡 3 → 下個 4）');
  ok(p.rows.find(r => r.type === 'collect_stamp').known === false && p.unknown === 1, '推算不到的任務標未知');
  ok(/^read_card_episode_/.test(p.steps[0].type) && p.steps[0].remain === 1 && p.steps[0].cost === 1 && p.steps.find(x => x.type === 'play_live').cost === 4.5, '最省力的第一步是讀 1 篇卡片故事；隊長 15 場的成本 4.5 排後面');
  ok(p.toLevel && p.toLevel.left === 1 && p.toLevel.k === 1 && p.toLevel.exp === 1, 'Lv3 → Lv4 還差 1 EXP，做 1 件就升級');
  const PU2 = Object.assign({}, PU, { userCharacterMissionV2s: [{ characterId: 1, characterMissionType: 'collect_member', progress: 7 }, { characterId: 1, characterMissionType: 'collect_stamp', progress: 2 }] });
  const p2 = hzPlanFor(1, PM, PU2, ctx);
  ok(p2.hasMission && p2.rows.find(r => r.type === 'collect_member').cur === 7 && p2.rows.find(r => r.type === 'collect_member').src === 'mission' && p2.rows.find(r => r.type === 'collect_stamp').known, '有任務進度就全用任務進度（持卡 7、貼圖 2），不再推算');
  const rank = hzPlanRank([
    { cid: 1, lv: 50, extra: { bfes: [], theory: ['Leo/need×可愛'] }, route: { done: false, reach: true, left: 300, cost: 900 } },
    { cid: 2, lv: 80, extra: { bfes: ['x'], theory: [] }, route: { done: false, reach: true, left: 120, cost: 500 } },
    { cid: 3, lv: 100, extra: { bfes: ['y'], theory: [] }, route: { done: true, reach: true, left: 0, cost: 0 } },
    { cid: 4, lv: 30, extra: { bfes: [], theory: [] }, route: { done: false, reach: false, left: 600, cost: 100 } },
    { cid: 5, lv: 60, extra: { bfes: ['z'], theory: [] }, route: { done: false, reach: true, left: 200, cost: 100 } }]);
  ok(rank.map(r => r.cid).join(',') === '2,5,1,4,3', '先練誰：BFES 持卡者先（離目標近的優先）、再理論組卡、再其他；已達目標最後');
  ok(HZ_PLAN_ASPECTS.length === 8, '八個面向');
  ok(HZ_PLAN_ASPECTS.reduce((a, x) => a + x.types.length, 0) === 22, '22 種角色任務都分到面向');
}

/* 素材花費：專精挑最便宜的卡、故事挑沒讀的低星卡、家具挑素材夠的；庫存不夠就往後排 */
{
  const lessons = [{ cardRarityType: 'rarity_1', masterRank: 1, costs: [{ resourceId: 15, quantity: 1 }, { resourceId: 101, characterId: 1, quantity: 1 }, { resourceId: 127, quantity: 1 }] },
    { cardRarityType: 'rarity_2', masterRank: 1, costs: [{ resourceId: 15, quantity: 5 }] }, { cardRarityType: 'rarity_2', masterRank: 2, costs: [{ resourceId: 15, quantity: 5 }] },
    { cardRarityType: 'rarity_4', masterRank: 1, costs: [{ resourceId: 15, quantity: 2000 }, { resourceId: 16, quantity: 1 }, { resourceId: 159, quantity: 1 }] }];
  const mr = hzMrCosts(lessons);
  ok(mr[1].length === 1 && mr[1][0].n === 1 && mr[2][0].n === 5 && mr[4].length === 2 && mr[4][1].id === 16, 'masterLessons → 各稀有度每級通用花費（忽略角色／團體專用碎片）');
  const cc = { 11: { ch: 1, rar: 1, attr: 'cool', name: 'r1' }, 12: { ch: 1, rar: 2, attr: 'cute', name: 'r2' }, 13: { ch: 1, rar: 4, attr: 'pure', name: 'r4' } };
  const U = { userCards: [{ cardId: 11, masterRank: 4, episodes: [{ cardEpisodeId: 1, scenarioStatus: 'already_read' }, { cardEpisodeId: 2, scenarioStatus: 'unread' }] }, { cardId: 12, masterRank: 3, episodes: [{ cardEpisodeId: 3, scenarioStatus: 'unread' }, { cardEpisodeId: 4, scenarioStatus: 'unread' }] }, { cardId: 13, masterRank: 0, episodes: [{ cardEpisodeId: 5, scenarioStatus: 'unread' }, { cardEpisodeId: 6, scenarioStatus: 'unread' }] }],
    userMaterials: [{ materialId: 15, quantity: 5 }, { materialId: 1, quantity: 1000 }] };
  const rows = [{ type: 'master_rank_up_standard', known: true, nextNeed: 10, cur: 7, remain: 3, cost: 9 }, { type: 'read_card_episode_second', known: true, nextNeed: 2, cur: 1, remain: 1, cost: 1 },
    { type: 'read_card_episode_first', known: true, nextNeed: 3, cur: 1, remain: 2, cost: 2 }, { type: 'collect_mysekai_fixture', known: true, nextNeed: 2, cur: 1, remain: 1, cost: 3 }, { type: 'collect_stamp', known: false, nextNeed: 2, cur: 0, remain: 0, cost: Infinity }];
  const ctx = { U, cardChar: cc, mrCost: mr, fixRows: [[342, '一歌的玩偶/S', 29, 1, [1], [1, 1, 1], '', '', '', [], [[35, 3], [22, 2]], 'any', 1, 0, 0], [343, '一歌的玩偶/M', 29, 1, [1], [1, 1, 1], '', '', '', [], [[35, 8]], 'any', 1, 0, 0], [12, 'lamp', 1, 1, [], [1, 1, 1], '', '', '', [], [[1, 1]], 'any', 1, 0, 0]],
    tagChar: { 1: 1 }, mysFix: [], mysMats: [{ mysekaiMaterialId: 35, quantity: 8 }, { mysekaiMaterialId: 22, quantity: 0 }] };
  hzPlanMats(rows, 1, ctx);
  const m = rows[0];
  ok(m.mats.length === 1 && m.mats[0].id === 15 && m.mats[0].n === 11 && m.lack === 6 && m.afford === false && m.cost === 22.5 && m.picks.length === 2, '專精 3 級：★1 MR4→5（1 顆）＋★2 MR3→5（10 顆）＝11 顆心願碎片，庫存 5 → 缺 6，成本 ×2.5');
  const e2 = rows[1];
  ok(e2.mats.some(x => x.id === 2 && x.n === 50) && e2.afford === false && e2.picks[0] === '★1 r1', '後篇 1 篇：挑沒讀過的 ★1（帥氣碎片 50，庫存沒有 → 缺）');
  const e1 = rows[2];
  ok(e1.mats.some(x => x.id === 1 && x.n === 200) && e1.mats.some(x => x.id === 3 && x.n === 1000) && e1.short === 0, '前篇 2 篇：沒讀過的 ★2 可愛 200 ＋ ★4 純真 1000（★1 前篇已讀）');
  const f = rows[3];
  ok(f.mys && f.picks[0] === '一歌的玩偶/M' && f.afford === true, '家具 1 件：素材夠的玩偶/M 先於較便宜但缺素材的玩偶/S');
  ok(rows[4].mats === undefined, '進度未知的列不算素材');
  const rowsShort = [{ type: 'master_rank_up_rare', known: true, nextNeed: 10, cur: 0, remain: 10, cost: 60 }];
  hzPlanMats(rowsShort, 1, ctx);
  ok(rowsShort[0].short === 5 && rowsShort[0].cost === Infinity && rowsShort[0].mats[0].n === 10000, '★4 只有一張（5 級）不夠 10 級：標 short、成本無限大（不列入下一步）');
  ok(HZ_EP_COST[3][1][2] === 80 && HZ_EP_COST[4][1][0] === 4000, '故事花費表：★3 後篇 80 奇蹟寶石、★4 後篇 4000 屬性碎片');
}

/* 到目標等級的路線：上限、每 EXP 成本排序、同一任務前段先、素材合計、撿不夠回報能到幾級 */
{
  const PG = [];
  const grp = (id, reqs, exp) => reqs.forEach((r, i) => PG.push({ id, seq: i + 1, requirement: r, exp: exp || 1 }));
  grp(14, [2, 4, 6], 2); grp(6, [1, 2, 3, 4]); grp(18, [1, 2, 3, 5, 8]); grp(1, [10, 20, 40, 80]); grp(101, [500, 600]);
  const mk = (id, type, pg, ach) => ({ id, characterId: 1, characterMissionType: type, parameterGroupId: pg, sentence: type + '{requirement}', isAchievementMission: !!ach });
  const M = { missions: [mk(1, 'collect_member', 14), mk(2, 'read_card_episode_first', 6), mk(4, 'master_rank_up_standard', 18), mk(8, 'play_live', 1, true), mk(9, 'play_live_ex', 101, true)], groups: PG,
    levels: [1, 2, 3, 4, 5, 6, 7, 8].map((lv, i) => ({ levelType: 'character', level: lv, totalExp: [0, 1, 2, 4, 7, 10, 14, 18][i] })) };
  const cc = { 11: { ch: 1, rar: 1, attr: 'cool', name: 'r1' }, 12: { ch: 1, rar: 2, attr: 'cute', name: 'r2' } };
  const U = { userCharacters: [{ characterId: 1, characterRank: 2, exp: 0, totalExp: 1 }],
    userCards: [{ cardId: 11, masterRank: 4, episodes: [{ cardEpisodeId: 1, scenarioStatus: 'unread' }, { cardEpisodeId: 2, scenarioStatus: 'unread' }] }, { cardId: 12, masterRank: 3, episodes: [{ cardEpisodeId: 3, scenarioStatus: 'already_read' }, { cardEpisodeId: 4, scenarioStatus: 'unread' }] }],
    userMaterials: [{ materialId: 15, quantity: 100 }, { materialId: 2, quantity: 0 }], userCharacterLiveUsageCounts: [{ characterId: 1, characterLiveUsageType: 'leader', usageCount: 5 }] };
  const ctx = { cardChar: cc, mrCost: { 1: [{ id: 15, n: 1 }], 2: [{ id: 15, n: 5 }] } };
  const p = hzPlanFor(1, M, U, ctx);
  const caps = hzPlanCaps(p, Object.assign({ U }, ctx));
  ok(caps.master_rank_up_standard === 10 && caps.read_card_episode_first === 2 && caps.collect_member === 2, '上限：專精已 7 級（推算）還能升 3 級→10、前篇已讀 1 還有 1 篇→2、持有張數不靠任務');
  const r = hzPlanRoute(p, M, Object.assign({ U }, ctx), 5);
  ok(r.target === 5 && r.left === 6 && r.reach === true, 'Lv2（總 1）到 Lv5（總 7）差 6 EXP，撿得到');
  const types = r.rows.map(x => x.type);
  ok(!types.includes('collect_member'), '路線不含持有張數（靠抽卡）');
  const mr = r.rows.find(x => x.type === 'master_rank_up_standard'), ep = r.rows.find(x => x.type === 'read_card_episode_first');
  ok(ep && ep.from === 1 && ep.to === 2 && ep.exp === 1, '前篇 1 → 2（只剩 1 篇沒讀，上限 2）');
  ok(mr && mr.from === 7 && mr.to === 8 && mr.exp === 1 && mr.mats[0].n === 1 && mr.afford === true && /★1/.test(mr.picks[0]), '專精 7 → 8 級：挑 ★1 升一級＝1 顆心願碎片，庫存夠');
  ok(r.exp >= 6 && r.items === 77 && r.mats.some(m => m.id === 15 && m.n === 1), '路線總 EXP 夠（故事 1＋專精 1＋隊長 4 段）、共 77 單位、素材合計 1 顆心願碎片');
  const pl = r.rows.find(x => x.type === 'play_live');
  ok(pl && pl.from === 5 && pl.to === 80 && pl.n === 4 && pl.exp === 4, '隊長次數 5 → 80：四段都撿、前段先');
  const far = hzPlanRoute(p, M, Object.assign({ U }, ctx), 8);
  ok(far.reach === false && far.reachLv >= 5 && far.reachLv < 8 && far.exp > 0, '目標太高：撿完所有可做的也到不了，回報能到幾級');
  const done = hzPlanRoute(Object.assign({}, p, { lv: 6 }), M, Object.assign({ U }, ctx), 5);
  ok(done.done === true && done.left === 0, '已達目標');
}

console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
process.exit(fail ? 1 : 0);
