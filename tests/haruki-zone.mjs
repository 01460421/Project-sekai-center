/* Haruki 專區的純函式測試：角色任務 EXP、目前隊伍、預設歌曲，以及 app.js 的 compact 展開。
   用法：node tests/haruki-zone.mjs   任何一項失敗就 exit 1。 */
import fs from 'node:fs';
import { hzCharacterMissions, hzCurrentDeck, hzBestSong, hzCurrentRound, hzClearedTotal, hzLeaders, hzBonds, hzPowerBonus, hzChallenge } from '../js/haruki.js';

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

/* app.js 的 hkExpandCompact / hkNormalize（從原始碼抽出來測，不載整個 App） */
const src = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const grab = name => { const i = src.indexOf('\n  ' + name + '('); const j = src.indexOf('\n  }\n', i); return src.slice(i + 3, j + 4); };
const obj = eval('({' + grab('hkExpandCompact') + ',' + grab('hkNormalize') + '})');
const rows = obj.hkExpandCompact({ __ENUM__: { missionStatus: ['received', 'achieved'] }, characterId: [1, 2, 3], missionStatus: [1, 0], seq: [2, 5, 9] });
ok(rows.length === 2 && rows[0].missionStatus === 'achieved' && rows[1].missionStatus === 'received' && rows[1].seq === 5, 'compact 展開：列數取最短欄、字典欄換回字串');
const su = obj.hkNormalize({ compactUserMusicResults: { __ENUM__: { playResult: ['clear', 'full_combo'] }, musicId: [7], playResult: [1] }, userCards: [{ cardId: 1 }], userMusicAchievements: { __ENUM__: {}, musicId: [3] } });
ok(Array.isArray(su.userMusicResults) && su.userMusicResults[0].playResult === 'full_combo' && !('compactUserMusicResults' in su), 'compactXxx 鍵改成列形式的原鍵');
ok(su.userMusicAchievements[0].musicId === 3 && su.userCards[0].cardId === 1, '原鍵底下的 compact 也展開，列形式的不動');

console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
process.exit(fail ? 1 : 0);
