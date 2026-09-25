/* Haruki 專區的純函式測試：角色任務 EXP、目前隊伍、預設歌曲，以及 app.js 的 compact 展開。
   用法：node tests/haruki-zone.mjs   任何一項失敗就 exit 1。 */
import fs from 'node:fs';
import { hzCharacterMissions, hzCurrentDeck, hzBestSong, hzCurrentRound, hzClearedTotal } from '../js/haruki.js';

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
