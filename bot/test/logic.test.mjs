/* 純邏輯與流程的單元測試 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Rng, hashStr, seeded } from '../src/core/rng.js';
import { MemoryStore } from '../src/core/store.js';
import { FileStore } from '../src/core/store-file.js';
import { cid, parseCid, embed, todayTW } from '../src/core/ui.js';
import { signOf, findSign, zodiacOf, reduceNum, parseBirthday, dailyRng, scoreOf } from '../src/core/oracle.js';
import { levelFor, xpForLevel } from '../src/core/helpers.js';
import { tttWinner, tttBot, tttMsg, c4Winner, c4Drop, c4Bot, c4Msg, handValue, newDeck, spinSlots, slotPayout, makeMines, reveal, neighbors, wordleScore } from '../src/features/04-games.js';
import { Sessions, Cooldowns } from '../src/core/sessions.js';
import { parseDice } from '../src/features/05-fun.js';
import { pullMany, RATES } from '../src/features/07-gacha.js';
import { genSekaiQ, genSongQ, genCharaQ, genTrivia } from '../src/features/08-quiz.js';
import { dailyAmount } from '../src/features/06-economy.js';
import { hexByLines, HEXAGRAMS } from '../src/content/iching.js';
import { TAROT } from '../src/content/tarot.js';
import { makeBot, loadRegistry, runCmd, press, sendMessage, buttonsOf, selectsOf, textOf, USERS, GUILD, CHANNEL, fakeClaude, aiText, aiTool, aiRefusal, mockLive, resetFetch } from './harness.js';
import { normalizeLive, trend, fetchLive, parseSafe, clearCache, useFetch } from '../src/core/live.js';
import { searchCards, cardExtra, skillText } from '../src/core/sekai.js';
import { createAI } from '../src/core/ai.js';
import { runFeature, buildSystem, STYLES } from '../src/features/11-ai.js';
import { ZH, validName, localizeHints, toEnCommand, toEnSub, toEnOpt } from '../src/core/i18n.js';
import { registrationJSON } from '../src/core/registry.js';
import { parseInteraction } from '../src/core/discord-http.js';

test('種子亂數可重現、無種子則不同', () => {
  const a = new Rng('x'), b = new Rng('x');
  assert.deepEqual([a.int(1, 100), a.int(1, 100), a.next()], [b.int(1, 100), b.int(1, 100), b.next()]);
  assert.equal(hashStr('abc'), hashStr('abc'));
  assert.notEqual(hashStr('abc'), hashStr('abd'));
  const s = seeded('u', 'd').sample([1, 2, 3, 4, 5], 3); assert.equal(new Set(s).size, 3);
  const w = new Rng(1); const counts = { a: 0, b: 0 }; for (let i = 0; i < 2000; i++) counts[w.weighted([['a', 9], ['b', 1]])]++; assert.ok(counts.a > 1600 && counts.b > 100);
});

test('同一人同一天同一問題結果相同，不同問題不同', () => {
  const a = dailyRng('u1', 'tarot', '工作').int(0, 77), b = dailyRng('u1', 'tarot', '工作').int(0, 77);
  assert.equal(a, b);
  const many = new Set(); for (let i = 0; i < 30; i++) many.add(dailyRng('u1', 'tarot', 'q' + i).int(0, 77)); assert.ok(many.size > 10);
  assert.equal(scoreOf('ship', 'a', 'b'), scoreOf('ship', 'a', 'b')); assert.ok(scoreOf('x') >= 0 && scoreOf('x') <= 100);
});

test('星座、生肖、靈數、生日解析', () => {
  assert.equal(signOf(8, 31).name, '處女座'); assert.equal(signOf(12, 25).name, '摩羯座'); assert.equal(signOf(1, 5).name, '摩羯座'); assert.equal(signOf(3, 21).name, '牡羊座'); assert.equal(signOf(2, 18).name, '水瓶座');
  assert.equal(findSign('雙魚').key, 'pisces'); assert.equal(findSign('8/31').key, 'virgo'); assert.equal(findSign('nope'), null);
  assert.equal(['鼠', '牛', '虎', '兔', '龍', '蛇', '馬', '羊', '猴', '雞', '狗', '豬'][zodiacOf(2000)], '龍'); assert.equal(zodiacOf(1990), 6);
  assert.equal(reduceNum(29), 11); assert.equal(reduceNum(29, false), 2); assert.equal(reduceNum('2000831'), 5);
  assert.deepEqual(parseBirthday('2000/08/31'), { y: 2000, m: 8, d: 31 }); assert.deepEqual(parseBirthday('8-31'), { y: 0, m: 8, d: 31 }); assert.equal(parseBirthday('abc'), null);
});

test('等級曲線單調', () => { let prev = -1; for (let xp = 0; xp < 100000; xp += 137) { const l = levelFor(xp); assert.ok(l >= prev); prev = l; } assert.equal(levelFor(xpForLevel(10)), 10); assert.equal(levelFor(xpForLevel(10) - 1), 9); });

test('custom_id 編解碼', () => { const id = cid('feat', 'act', 'a:b', 5); assert.deepEqual(parseCid(id), { feature: 'feat', action: 'act', data: ['a', 'b', '5'] }); assert.throws(() => cid('x', 'y', 'z'.repeat(100))); });

test('embed 截斷', () => { const e = embed({ title: 'a'.repeat(300), description: 'b'.repeat(5000), fields: Array(30).fill({ name: '', value: '' }) }); assert.equal(e.title.length, 256); assert.equal(e.description.length, 4096); assert.equal(e.fields.length, 25); assert.equal(e.fields[0].name, '​'); });

test('FileStore 寫入與讀回', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-store-')); const file = path.join(dir, 'state.json');
  const s = new FileStore(file, { debounceMs: 1 }); s.user('g', 'u').crystals = 123; s.guild('g').settings.currency = '金幣'; s.global('reminders', () => []).push({ at: 1 });
  await s.close();
  const s2 = new FileStore(file); assert.equal(s2.user('g', 'u').crystals, 123); assert.equal(s2.guild('g').settings.currency, '金幣'); assert.equal(s2.global('reminders').length, 1);
  assert.equal(s2.user('g', 'u').games.played, 0, '舊紀錄要補上預設欄位');
  fs.rmSync(dir, { recursive: true, force: true });
  const m = new MemoryStore(); m.user('g', 'a'); m.user('g', 'b'); m.user('h', 'c'); assert.equal(m.users('g').length, 2);
});

test('井字：勝負判定與機器人會擋', () => {
  assert.equal(tttWinner(['X', 'X', 'X', '', '', '', '', '', '']), 'X'); assert.equal(tttWinner(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X']), 'draw'); assert.equal(tttWinner(Array(9).fill('')), null);
  assert.equal(tttBot(['X', 'X', '', '', 'O', '', '', '', '']), 2, '要擋 X 連線'); assert.equal(tttBot(['O', 'O', '', 'X', 'X', '', '', '', '']), 2, '能贏就贏');
});

test('四子棋：落子、勝負、機器人', () => {
  const b = Array(42).fill(''); assert.equal(c4Drop(b, 0, 'R'), 0); assert.equal(c4Drop(b, 0, 'Y'), 1); assert.equal(c4Winner(b), null);
  for (const c of [1, 2, 3]) c4Drop(b, c, 'R'); assert.equal(c4Winner(b), 'R');
  const b2 = Array(42).fill(''); for (const c of [0, 1, 2]) c4Drop(b2, c, 'R'); assert.equal(c4Bot(b2), 3, '要擋');
  const b3 = Array(42).fill(''); for (let i = 0; i < 3; i++) c4Drop(b3, 5, 'Y'); assert.equal(c4Bot(b3), 5, '能贏就贏');
});

test('21 點牌值', () => { assert.equal(handValue(['A♠', 'K♥']), 21); assert.equal(handValue(['A♠', 'A♥', '9♦']), 21); assert.equal(handValue(['A♠', 'A♥', 'A♦', 'A♣', 'K♠']), 14); assert.equal(handValue(['10♠', 'J♥', '5♦']), 25); assert.equal(newDeck(new Rng(1)).length, 52); assert.equal(new Set(newDeck(new Rng(1))).size, 52); });

test('拉霸賠率與期望值合理（回收率 < 100%）', () => {
  assert.equal(slotPayout(['⭐', '⭐', '⭐'], 10), 200); assert.equal(slotPayout(['⭐', '⭐', '🍒'], 10), 10); assert.equal(slotPayout(['⭐', '🍋', '🍒'], 10), 0);
  const rng = new Rng(7); let paid = 0; const N = 20000; for (let i = 0; i < N; i++) paid += slotPayout(spinSlots(rng), 10); const rtp = paid / (N * 10); assert.ok(rtp > 0.6 && rtp < 1.0, `RTP ${rtp}`);
});

test('踩地雷：地雷數、第一步安全、連鎖展開', () => {
  const rng = new Rng(3); const mines = makeMines(rng, 12); assert.equal(mines.size, 4); assert.ok(!mines.has(12));
  assert.equal(neighbors(0).length, 3); assert.equal(neighbors(12).length, 8);
  const s = { mines: new Set([24]), open: new Set() }; reveal(s, 0); assert.ok(s.open.size >= 20, '幾乎全開');
});

test('Wordle 評分（含重複字母）', () => { assert.equal(wordleScore('crane', 'crane'), '🟩🟩🟩🟩🟩'); assert.equal(wordleScore('abbey', 'bbbbb'), '⬛🟩🟩⬛⬛'); assert.equal(wordleScore('crane', 'nacre'), '🟨🟨🟨🟨🟩'); });

test('骰子表達式', () => { assert.deepEqual(parseDice('2d6+3'), { n: 2, sides: 6, mod: 3 }); assert.deepEqual(parseDice('d20'), { n: 1, sides: 20, mod: 0 }); assert.equal(parseDice('abc'), null); assert.equal(parseDice('999d9999').n, 100); });

test('轉蛋機率接近設定值、十連保底', () => {
  const rng = new Rng(11); const N = 3000; const cards = pullMany(rng, N); const c4 = cards.filter(c => c.rarity === 4).length / N, c3 = cards.filter(c => c.rarity === 3).length / N;
  assert.ok(Math.abs(c4 - RATES[4]) < 0.012, `4★ ${c4}`); assert.ok(Math.abs(c3 - RATES[3]) < 0.02, `3★ ${c3}`);
  for (let i = 0; i < 200; i++) assert.ok(pullMany(new Rng(i), 10).some(c => c.rarity >= 3), '十連要保底 3★');
});

test('題目產生器：四個選項、答案在裡面且不重複', () => {
  const rng = new Rng(5);
  for (let i = 0; i < 200; i++) for (const q of [genSekaiQ(rng), genSongQ(rng), genCharaQ(rng), genTrivia(rng)]) { assert.equal(q.opts.length, 4); assert.equal(new Set(q.opts).size, 4, q.q); assert.ok(q.ans >= 0 && q.ans < 4); }
});

test('易經 64 卦、塔羅 78 張', () => { assert.equal(HEXAGRAMS.length, 64); assert.equal(hexByLines('111111').name, '乾為天'); assert.equal(hexByLines('000000').name, '坤為地'); assert.equal(TAROT.length, 78); assert.equal(new Set(TAROT.map(t => t.name)).size, 78); });

test('簽到金額與連續天數', () => { assert.equal(dailyAmount(1), 110); assert.equal(dailyAmount(100), 300); });

/* ---------- 流程測試 ---------- */
test('經濟流程：簽到 → 轉帳 → 存款 → 富豪榜', async () => {
  const bot = await makeBot();
  const r1 = await runCmd(bot, 'daily'); assert.match(textOf(r1.last), /簽到成功/);
  const r2 = await runCmd(bot, 'daily'); assert.match(textOf(r2.last), /簽過了/);
  const bal = bot.store.user(GUILD, USERS.alice.id).crystals; assert.ok(bal >= 110);
  const r3 = await runCmd(bot, 'pay', { options: { user: USERS.bob, amount: 50 } }); assert.match(textOf(r3.last), /轉了/);
  assert.equal(bot.store.user(GUILD, USERS.bob.id).crystals, 50);
  const r4 = await runCmd(bot, 'pay', { options: { user: USERS.bob, amount: 999999 } }); assert.match(textOf(r4.last), /只有/);
  await runCmd(bot, 'bank', { sub: 'deposit', options: { amount: 30 } }); assert.equal(bot.store.user(GUILD, USERS.alice.id).bank, 30);
  const r5 = await runCmd(bot, 'richlist'); assert.match(textOf(r5.last), /Alice|100000000000000001/);
  assert.deepEqual(bot.errors, []);
});

test('井字對機器人可以下到結束', async () => {
  const bot = await makeBot();
  const r = await runCmd(bot, 'tictactoe'); let msg = r.last; let guard = 0;
  while (buttonsOf(msg).some(b => !b.disabled) && guard++ < 10) { const b = buttonsOf(msg).find(x => !x.disabled); msg = (await press(bot, b.id, { message: msg })).last; }
  assert.match(textOf(msg), /獲勝|平手/); assert.deepEqual(bot.errors, []);
  // 別人不能亂按
  const r2 = await runCmd(bot, 'tictactoe', { options: { opponent: USERS.bob } });
  const nope = await press(bot, buttonsOf(r2.last)[0].id, { user: USERS.carol }); assert.match(textOf(nope.last), /還沒輪到你/);
});

test('21 點：押注會扣款或加錢', async () => {
  const bot = await makeBot(); bot.store.user(GUILD, USERS.alice.id).crystals = 100;
  const r = await runCmd(bot, 'blackjack', { options: { bet: 10 } }); let msg = r.last; let guard = 0;
  while (buttonsOf(msg).some(b => b.id.includes(':hit:')) && guard++ < 6) msg = (await press(bot, buttonsOf(msg).find(b => b.id.includes(':stand:')).id, { message: msg })).last;
  const c = bot.store.user(GUILD, USERS.alice.id).crystals; assert.ok([85, 90, 100, 110, 115].includes(c), `餘額 ${c}`); assert.deepEqual(bot.errors, []);
});

test('Wordle 透過表單猜到答案', async () => {
  const bot = await makeBot();
  const r = await runCmd(bot, 'wordle'); const sid = buttonsOf(r.last)[0].id.split(':')[2];
  const answer = bot.sessions.get('wordle', sid).answer;
  const m = await press(bot, buttonsOf(r.last)[0].id); assert.equal(m.modals.length, 1);
  const bad = await press(bot, m.modals[0].custom_id, { fields: { g: 'abc' } }); assert.match(textOf(bad.last), /五個/);
  const ok = await press(bot, m.modals[0].custom_id, { fields: { g: answer } }); assert.match(textOf(ok.last), /猜中/);
  assert.ok(bot.store.user(GUILD, USERS.alice.id).crystals > 0);
});

test('MBTI 十六題答完會得到型別並存檔', async () => {
  const bot = await makeBot();
  let msg = (await runCmd(bot, 'mbti', { sub: 'test' })).last;
  for (let i = 0; i < 16; i++) { const b = buttonsOf(msg)[0]; assert.ok(b, `第 ${i} 題沒有按鈕`); msg = (await press(bot, b.id, { message: msg })).last; }
  assert.match(textOf(msg), /你是 [EI][SN][TF][JP]/); assert.match(bot.store.user(GUILD, USERS.alice.id).mbti, /^[EI][SN][TF][JP]$/);
  assert.equal(buttonsOf(msg).length, 0);
});

test('投票：投票、改票、只有發起人能結束', async () => {
  const bot = await makeBot();
  const r = await runCmd(bot, 'poll', { options: { question: '晚餐？', options: '拉麵|咖哩' } }); const [b1, b2, end] = buttonsOf(r.last);
  await press(bot, b1.id, { user: USERS.bob }); let m = (await press(bot, b2.id, { user: USERS.bob })).last; assert.match(textOf(m), /1 人投票/);
  const denied = await press(bot, end.id, { user: USERS.bob }); assert.match(textOf(denied.last), /發起人/);
  m = (await press(bot, end.id, { user: USERS.alice })).last; assert.match(textOf(m), /已結束/); assert.equal(buttonsOf(m).length, 0);
});

test('結婚：求婚 → 對方接受 → 雙方紀錄 → 離婚', async () => {
  const bot = await makeBot();
  const r = await runCmd(bot, 'marry', { sub: 'propose', options: { user: USERS.bob } }); const [yes] = buttonsOf(r.last);
  const wrong = await press(bot, yes.id, { user: USERS.carol }); assert.match(textOf(wrong.last), /不是向你/);
  const ok = await press(bot, yes.id, { user: USERS.bob }); assert.match(textOf(ok.last), /結婚了/);
  assert.equal(bot.store.user(GUILD, USERS.alice.id).marriedTo, USERS.bob.id); assert.equal(bot.store.user(GUILD, USERS.bob.id).marriedTo, USERS.alice.id);
  await runCmd(bot, 'marry', { sub: 'divorce', user: USERS.bob }); assert.equal(bot.store.user(GUILD, USERS.alice.id).marriedTo, null);
});

test('搶答：答錯的人不能再答，答對的人得分', async () => {
  const bot = await makeBot();
  const r = await runCmd(bot, 'speedquiz', { options: { kind: 'trivia' } }); const sid = buttonsOf(r.last)[0].id.split(':')[2];
  const ans = bot.sessions.get('speedquiz', sid).q.ans; const wrong = (ans + 1) % 4;
  const w = await press(bot, buttonsOf(r.last)[wrong].id, { user: USERS.bob }); assert.match(textOf(w.last), /不對/);
  const again = await press(bot, buttonsOf(r.last)[ans].id, { user: USERS.bob }); assert.match(textOf(again.last), /答過/);
  const ok = await press(bot, buttonsOf(r.last)[ans].id, { user: USERS.carol }); assert.match(textOf(ok.last), /答對/);
  assert.equal(bot.store.user(GUILD, USERS.carol.id).quiz.right, 1);
});

test('提醒與倒數：tick 到期會送到頻道', async () => {
  const bot = await makeBot();
  await runCmd(bot, 'remind', { sub: 'set', options: { minutes: 1, text: '喝水' } });
  await runCmd(bot, 'countdown', { options: { seconds: 10, label: '開播' } });
  await bot.tick(Date.now()); assert.equal(bot.sent.length, 0);
  await bot.tick(Date.now() + 61e3); assert.equal(bot.sent.length, 2); assert.match(bot.sent[0].msg.content + bot.sent[1].msg.content, /喝水/);
});

test('抽獎：參加、重複參加、時間到自動開獎', async () => {
  const bot = await makeBot();
  const r = await runCmd(bot, 'raffle', { options: { prize: '一杯手搖', winners: 1, minutes: 1 } }); const [join] = buttonsOf(r.last);
  await press(bot, join.id, { user: USERS.bob }); const dup = await press(bot, join.id, { user: USERS.bob }); assert.match(textOf(dup.last), /已經參加/);
  await bot.tick(Date.now() + 61e3); assert.equal(bot.sent.length, 1); assert.match(bot.sent[0].msg.content, /Bob|100000000000000002/);
});

test('聊天經驗值與 AFK 被動事件', async () => {
  const bot = await makeBot();
  await sendMessage(bot, { content: 'hi' }); assert.ok(bot.store.user(GUILD, USERS.alice.id).xp >= 15); assert.equal(bot.store.user(GUILD, USERS.alice.id).messages, 1);
  await sendMessage(bot, { content: 'again' }); assert.ok(bot.store.user(GUILD, USERS.alice.id).xp <= 25, '一分鐘內不重複加');
  await runCmd(bot, 'afk', { user: USERS.bob, options: { reason: '吃飯' } });
  const r = await sendMessage(bot, { content: '@Bob 在嗎', mentions: [USERS.bob.id] }); assert.ok(r.replies.some(t => /吃飯/.test(t)));
  const back = await sendMessage(bot, { user: USERS.bob, content: '回來了' }); assert.ok(back.replies.some(t => /歡迎回來/.test(t))); assert.equal(bot.store.user(GUILD, USERS.bob.id).afk, null);
  await runCmd(bot, 'settings', { sub: 'xp', options: { enabled: false }, admin: true });
  const before = bot.store.user(GUILD, USERS.carol.id).xp; await sendMessage(bot, { user: USERS.carol, content: 'x' }); assert.equal(bot.store.user(GUILD, USERS.carol.id).xp, before);
});

test('自動反應與歡迎訊息', async () => {
  const bot = await makeBot();
  const denied = await runCmd(bot, 'autoreact', { sub: 'add', options: { keyword: '早安', emoji: '☀️' } }); assert.match(textOf(denied.last), /權限/);
  await runCmd(bot, 'autoreact', { sub: 'add', options: { keyword: '早安', emoji: '☀️' }, admin: true });
  const r = await sendMessage(bot, { content: '大家早安' }); assert.deepEqual(r.reacts, ['☀️']);
  await runCmd(bot, 'welcome', { sub: 'set', options: { channel: { id: CHANNEL }, text: '歡迎 {user} 來到 {server}' }, admin: true });
  await bot.emit('memberJoin', { guildId: GUILD, userId: USERS.carol.id, guildName: 'G' }); assert.equal(bot.sent.length, 1); assert.match(bot.sent[0].msg.content, /Carol|100000000000000003/);
});

test('冷卻與權限', async () => {
  const bot = await makeBot();
  await runCmd(bot, 'confess', { options: { text: '嗨' } }); const r = await runCmd(bot, 'confess', { options: { text: '嗨' } }); assert.match(textOf(r.last), /冷卻/);
  const dm = await runCmd(bot, 'daily', { guildId: 'dm' }); assert.match(textOf(dm.last), /伺服器/);
  const help = await runCmd(bot, 'help', { guildId: 'dm' }); assert.match(textOf(help.last), /100 個功能/);
  const unknown = await runCmd(bot, 'nope'); assert.match(textOf(unknown.last), /找不到/);
});

test('占卜每天固定、AI 未啟用時不出現解讀欄', async () => {
  const bot = await makeBot();
  const a = await runCmd(bot, 'tarot', { options: { spread: 'three', question: '工作' } }); const b = await runCmd(bot, 'tarot', { options: { spread: 'three', question: '工作' } });
  assert.equal(a.last.embeds[0].description, b.last.embeds[0].description); assert.ok(!a.last.embeds[0].fields);
  const redraw = await press(bot, buttonsOf(a.last)[0].id, { message: a.last }); assert.match(textOf(redraw.last), /重抽/);
  const h = await runCmd(bot, 'horoscope', { options: { sign: 'leo' } }); assert.match(textOf(h.last), /獅子座/);
  const s = await press(bot, selectsOf(h.last)[0].id, { values: ['pisces'], message: h.last }); assert.match(textOf(s.last), /雙魚座/);
  const none = await runCmd(bot, 'horoscope', { user: USERS.carol }); assert.match(textOf(none.last), /先用 \/生日 登記/);
  await runCmd(bot, 'birthday', { sub: 'set', options: { date: '1999/02/17' }, user: USERS.carol }); const auto = await runCmd(bot, 'horoscope', { user: USERS.carol }); assert.match(textOf(auto.last), /水瓶座/);
});

test('對機器人的棋局：機器人獲勝時顯示「機器人」，不是壞掉的 mention', () => {
  const t = tttMsg('sid', { board: ['O', 'O', 'O', 'X', 'X', '', '', '', ''], players: { X: 'u1', O: 'bot' }, turn: 'X' }, true);
  assert.match(t.content, /機器人 獲勝/); assert.doesNotMatch(t.content, /<@bot>/);
  const b = Array(42).fill(''); for (const c of [0, 1, 2, 3]) c4Drop(b, c, 'Y');
  const c4 = c4Msg('sid', { board: b, players: { R: 'u1', Y: 'bot' }, turn: 'R' }, true);
  assert.match(c4.content, /機器人 獲勝/); assert.doesNotMatch(c4.content, /<@bot>/);
  const live = tttMsg('sid', { board: Array(9).fill(''), players: { X: 'u1', O: 'u2' }, turn: 'X' }, false); assert.match(live.content, /<@u1> vs <@u2>/);
});

test('Sessions／Cooldowns 的持久化介面：drain 取出動到與刪掉的、load 跳過已過期', () => {
  const s = new Sessions();
  const id = s.create('f', { n: 1 }); s.get('f', id).n = 2;
  const id2 = s.create('f', { n: 9 }); s.del('f', id2);
  const d = s.drain();
  assert.deepEqual(Object.keys(d.put), [`f:${id}`]); assert.equal(d.put[`f:${id}`].data.n, 2); assert.deepEqual(d.del, [`f:${id2}`]);
  assert.deepEqual(s.drain(), { put: {}, del: [] }, '沒動到就沒東西');
  const s2 = new Sessions(); s2.load([[`f:${id}`, d.put[`f:${id}`]], ['f:old', { data: {}, exp: Date.now() - 1, ttl: 1 }]]);
  assert.equal(s2.get('f', id).n, 2); assert.equal(s2.get('f', 'old'), null); assert.deepEqual(s2.drain().del, ['f:old'], '過期的要從 storage 刪掉');
  const cd = new Cooldowns(); assert.equal(cd.hit('k', 60), 0); assert.ok(cd.hit('k', 60) > 0);
  const out = cd.drain(); assert.ok(out.k > Date.now()); assert.equal(cd.drain(), null, '沒變動回 null');
  const cd2 = new Cooldowns(); cd2.load(out); assert.ok(cd2.hit('k', 60) > 0, '載回來的冷卻仍生效');
});

test('排行榜的歐洲人排序（原 /luckrank）：至少 50 抽、依 4★ 率排', async () => {
  const bot = await makeBot();
  const a = bot.store.user(GUILD, USERS.alice.id); a.pulls = 100; a.pulls4 = 10;
  const b = bot.store.user(GUILD, USERS.bob.id); b.pulls = 200; b.pulls4 = 4;
  bot.store.user(GUILD, USERS.carol.id).pulls = 10;
  const r = await runCmd(bot, 'leaderboard', { options: { by: 'luck' } }); const t = textOf(r.last);
  assert.match(t, /🥇 <@100000000000000001>　10\.00%（10\/100）/); assert.match(t, /🥈 <@100000000000000002>　2\.00%/); assert.doesNotMatch(t, /100000000000000003/);
  const none = await runCmd(await makeBot(), 'leaderboard', { options: { by: 'luck' } }); assert.match(textOf(none.last), /還沒有人抽滿 50 抽/);
});

test('猜數字：狀態放在玩家紀錄裡，猜對得獎並清掉', async () => {
  const bot = await makeBot();
  const none = await runCmd(bot, 'guess', { sub: 'try', options: { number: 1 } }); assert.match(textOf(none.last), /先用/);
  await runCmd(bot, 'guess', { sub: 'start', options: { max: 10 } });
  const u = bot.store.user(GUILD, USERS.alice.id); assert.ok(u.guess && u.guess.n >= 1 && u.guess.n <= 10);
  const wrong = await runCmd(bot, 'guess', { sub: 'try', options: { number: u.guess.n === 10 ? 1 : 10 } }); assert.match(textOf(wrong.last), /再大|再小/);
  const right = await runCmd(bot, 'guess', { sub: 'try', options: { number: u.guess.n } }); assert.match(textOf(right.last), /答對/);
  assert.equal(u.guess, null); assert.ok(u.crystals > 0); assert.deepEqual(bot.errors, []);
});

/* ---------- AI 對話 ---------- */
test('/chat：沒設金鑰會說明怎麼開啟；伺服器關閉時也不聊', async () => {
  const bot = await makeBot();
  const r = await runCmd(bot, 'chat', { options: { text: '嗨' } }); assert.match(textOf(r.last), /ANTHROPIC_API_KEY/); assert.ok(r.last.ephemeral); assert.ok(!r.deferred);
  const bot2 = await makeBot({ claude: fakeClaude([aiText('哈囉')]) });
  await runCmd(bot2, 'settings', { sub: 'ai', options: { enabled: false }, admin: true });
  const off = await runCmd(bot2, 'chat', { options: { text: '嗨' } }); assert.match(textOf(off.last), /關閉了 AI 對話/);
  assert.deepEqual(bot2.errors, []);
});

test('/chat：先延遲再補結果、記得上一輪、系統提示認識這位使用者與人設', async () => {
  const claude = fakeClaude([aiText('嗨 Alice，今天還沒簽到喔！'), aiText('剛才你說你叫小愛。')]);
  const bot = await makeBot({ claude });
  const u = bot.store.user(GUILD, USERS.alice.id); u.crystals = 1234; u.mbti = 'INFP';
  await runCmd(bot, 'settings', { sub: 'ai', options: { style: 'tsundere', name: '阿世', persona: '最愛珍奶' }, admin: true });
  const r1 = await runCmd(bot, 'chat', { options: { text: '我叫小愛' } });
  assert.ok(r1.deferred, '要先 defer'); assert.equal(r1.edits.length, 1, '結果用 edit 補上');
  assert.match(r1.edits[0].content, /> 我叫小愛\n嗨 Alice/); assert.equal(buttonsOf(r1.edits[0]).length, 2);
  const req = claude.calls[0];
  assert.equal(req.model, 'claude-sonnet-5'); assert.equal(req.betas, undefined, 'Sonnet 5 不送 fallback'); assert.equal(req.fallbacks, undefined); assert.deepEqual(req.output_config, { effort: 'low' });
  assert.equal(req.system[0].cache_control.type, 'ephemeral', '穩定的前半段要能快取');
  const sys = req.system.map(b => b.text).join('\n');
  assert.match(sys, /稱呼：Alice/); assert.match(sys, /1,234/); assert.match(sys, /INFP/); assert.match(sys, /今天還沒簽到/);
  assert.match(sys, /「阿世」/); assert.match(sys, new RegExp(STYLES.tsundere[0])); assert.match(sys, /最愛珍奶/); assert.match(sys, /\/daily/);
  assert.ok(req.tools && req.tools[0].name === 'run_command' && req.tools[0].strict === true);
  assert.equal(req.messages.length, 1); assert.equal(req.messages[0].content, '我叫小愛');
  // 第二輪帶著歷史
  const r2 = await runCmd(bot, 'chat', { options: { text: '我叫什麼？' } });
  assert.match(r2.edits[0].content, /小愛/);
  assert.equal(claude.calls[1].messages.length, 3); assert.equal(claude.calls[1].messages[1].role, 'assistant');
  assert.equal(u.chat.log.length, 4);
  // 忘掉：記憶清空；別人不能按
  const [, forget] = buttonsOf(r2.edits[0]);
  const nope = await press(bot, forget.id, { user: USERS.bob, message: r2.edits[0] }); assert.match(textOf(nope.last), /別人的對話/);
  const ok = await press(bot, forget.id, { message: r2.edits[0] }); assert.equal(u.chat, null); assert.match(ok.followUps[0].content, /忘掉/);
  assert.deepEqual(bot.errors, []);
});

test('/chat：模型用 run_command 查歌，工具結果回給模型，卡片一起顯示；不准的指令回 is_error', async () => {
  const claude = fakeClaude([
    aiTool('run_command', { name: 'song', sub: '', options: '{"title":"Tell Your World"}' }),
    (params) => { const last = params.messages[params.messages.length - 1]; const tr = last.content[0]; assert.equal(tr.type, 'tool_result'); assert.equal(tr.tool_use_id, 'tu_1'); assert.match(tr.content, /Tell Your World/); assert.match(tr.content, /BPM/); return aiText('Tell Your World 的 MASTER 是 26 級喔。'); },
  ]);
  const bot = await makeBot({ claude });
  const r = await runCmd(bot, 'chat', { options: { text: 'Tell Your World 幾級？' } });
  assert.match(r.edits[0].content, /26 級/); assert.equal(r.edits[0].embeds.length, 1); assert.match(r.edits[0].embeds[0].title, /Tell Your World/);
  assert.equal(claude.calls.length, 2); assert.equal(claude.calls[1].messages[1].role, 'assistant');
  // 直接測工具：清單外、子指令限制、缺必填、選項名對應
  const ctx = r.ctx;
  await assert.rejects(runFeature(ctx, { name: 'pay', sub: '', options: '{}' }), /不能執行 pay/);
  await assert.rejects(runFeature(ctx, { name: 'marry', sub: 'divorce', options: '{}' }), /不能執行 marry divorce/);
  await assert.rejects(runFeature(ctx, { name: 'dream', sub: '', options: '{}' }), /缺少必要參數 text/);
  await assert.rejects(runFeature(ctx, { name: 'song', sub: '', options: 'nope' }), /JSON/);
  const h = await runFeature(ctx, { name: 'horoscope', sub: '', options: '{"sign":"獅子座"}' }); assert.match(h.text, /獅子座/); assert.equal(h.extra.embeds.length, 1);
  const bank = await runFeature(ctx, { name: 'bank', sub: '', options: '{}' }); assert.match(bank.text, /銀行/);
  // 模型呼叫不准的指令：is_error 回去，模型再回話
  const claude2 = fakeClaude([aiTool('run_command', { name: 'pay', sub: '', options: '{"amount":5}' }), (p) => { const tr = p.messages[p.messages.length - 1].content[0]; assert.equal(tr.is_error, true); assert.match(tr.content, /不能執行/); return aiText('轉帳要你自己用 /pay 喔。'); }]);
  const bot2 = await makeBot({ claude: claude2 });
  const r2 = await runCmd(bot2, 'chat', { options: { text: '幫我轉 5 給 Bob' } }); assert.match(r2.edits[0].content, /\/轉帳/, '模型回的英文指令提示也會換成中文名');
  assert.deepEqual(bot.errors, []); assert.deepEqual(bot2.errors, []);
});

test('/chat：額度、拒答、API 出錯都有人話的回應；工具跑太多輪會停', async () => {
  const bot = await makeBot({ claude: fakeClaude([aiText('第一句')]), aiEnv: { AI_CHAT_DAILY_PER_USER: '1' } });
  await runCmd(bot, 'chat', { options: { text: '1' } });
  const over = await runCmd(bot, 'chat', { options: { text: '2' } }); assert.match(textOf(over.last), /額度/);
  const refused = await runCmd(await makeBot({ claude: fakeClaude([aiRefusal()]) }), 'chat', { options: { text: 'x' } }); assert.match(refused.edits[0].content, /不太方便聊/); assert.equal(buttonsOf(refused.edits[0]).length, 0);
  const broken = await runCmd(await makeBot({ claude: fakeClaude([new Error('boom')]) }), 'chat', { options: { text: 'x' } }); assert.match(broken.edits[0].content, /出了點狀況/);
  const loopy = fakeClaude(() => aiTool('run_command', { name: 'coin', sub: '', options: '{}' }));
  const r = await runCmd(await makeBot({ claude: loopy }), 'chat', { options: { text: '一直擲' } }); assert.ok(loopy.calls.length <= 5, `工具輪數要有上限（${loopy.calls.length}）`); assert.ok(r.edits.length === 1);
});

test('接著聊（表單）另開一則；@機器人 或回覆它的訊息會回話並共用記憶（容器版）', async () => {
  const claude = fakeClaude([aiText('你好呀'), aiText('剛剛你打招呼了'), aiText('回覆也行')]);
  const bot = await makeBot({ claude });
  const r = await runCmd(bot, 'chat', { options: { text: '你好' } });
  const [more] = buttonsOf(r.edits[0]);
  const m = await press(bot, more.id, { message: r.edits[0] }); assert.equal(m.modals.length, 1);
  const say = await press(bot, m.modals[0].custom_id, { fields: { t: '剛剛我做了什麼？' }, message: r.edits[0] });
  assert.ok(say.deferred); assert.equal(say.replies.length, 1); assert.match(say.replies[0].content, /剛剛你打招呼了/);
  assert.equal(claude.calls[1].messages.length, 3);
  const quiet = await sendMessage(bot, { content: '大家好' }); assert.equal(quiet.replies.length, 0, '沒 @ 機器人不回');
  const hi = await sendMessage(bot, { content: `<@${USERS.robot.id}> 剛剛聊到哪`, text: '剛剛聊到哪', mentionsBot: true });
  assert.equal(hi.texts[0], '回覆也行'); assert.equal(hi.typed, 1); assert.equal(claude.calls[2].messages.length, 5, '@ 的對話跟 /chat 共用記憶'); assert.equal(claude.calls[2].messages[4].content, '剛剛聊到哪');
  assert.match(claude.calls[2].system[1].text, /@ 了你/);
  assert.deepEqual(bot.errors, []);
});

test('createAI：沒金鑰回 null；narrate 額度；chat 的每日額度獨立；換成 Opus 5 才加伺服器端 fallback', async () => {
  assert.equal(createAI({}, {}), null);
  const opusClient = fakeClaude([aiText('ok')]);
  const opus = createAI({ ANTHROPIC_API_KEY: 'k', AI_MODEL: 'claude-opus-5' }, { client: opusClient });
  assert.equal(opus.fallback, true); await opus.narrate('p');
  assert.equal(opusClient.calls[0].model, 'claude-opus-5'); assert.deepEqual(opusClient.calls[0].betas, ['server-side-fallback-2026-07-01']); assert.equal(opusClient.calls[0].fallbacks, 'default');
  assert.equal(createAI({ ANTHROPIC_API_KEY: 'k' }, { client: fakeClaude([aiText('ok')]) }).fallback, false);
  const store = (await makeBot()).store;
  const ai = createAI({ ANTHROPIC_API_KEY: 'k', AI_DAILY_PER_USER: '1', AI_CHAT_DAILY_PER_USER: '2' }, { store, client: fakeClaude([aiText('ok')]) });
  assert.equal(await ai.narrate('p', { userId: 'u' }), 'ok'); assert.equal(await ai.narrate('p', { userId: 'u' }), '', '解讀額度 1 次');
  assert.equal((await ai.chat({ system: 's', messages: [{ role: 'user', content: 'x' }], userId: 'u' })).text, 'ok');
  assert.equal((await ai.chat({ system: 's', messages: [{ role: 'user', content: 'x' }], userId: 'u' })).text, 'ok');
  assert.equal((await ai.chat({ system: 's', messages: [{ role: 'user', content: 'x' }], userId: 'u' })).quota, false, '對話額度 2 次');
  assert.deepEqual(ai.quota('chat', 'u'), { used: 2, cap: 2 });
});

/* ---------- 中文指令名與固定頻道 ---------- */
test('中文指令名：100 個都有對照、合法且唯一；註冊 JSON 用中文名並附英文 localization', async () => {
  const reg = await loadRegistry();
  for (const f of reg.features) assert.ok(ZH[f.name], `缺 ${f.name} 的中文名（core/i18n.js）`);
  const json = registrationJSON(reg);
  const names = json.map(c => c.name); assert.equal(new Set(names).size, names.length, '中文指令名不能重複');
  const check = (o, where) => { assert.ok(validName(o.name), `${where}: ${o.name}`); if (o.name_localizations) assert.ok(validName(o.name_localizations['en-US']), where); for (const s of o.options || []) check(s, `${where}.${s.name}`); };
  for (const c of json) check(c, c.name);
  const tarot = json.find(c => c.name === '塔羅'); assert.equal(tarot.name_localizations['en-US'], 'tarot'); assert.equal(tarot.options[0].name, '牌陣'); assert.equal(tarot.options[0].name_localizations['en-US'], 'spread');
  const bank = json.find(c => c.name === '銀行'); assert.equal(bank.options[0].name, '存款'); assert.equal(bank.options[0].name_localizations['en-US'], 'deposit'); assert.equal(bank.options[0].options[0].name, '金額');
  for (const c of json) { const subs = (c.options || []).filter(o => o.type === 1); assert.equal(new Set(subs.map(s => s.name)).size, subs.length, c.name); for (const s of subs) { const on = (s.options || []).map(o => o.name); assert.equal(new Set(on).size, on.length, `${c.name} ${s.name}`); } const on = (c.options || []).filter(o => o.type !== 1).map(o => o.name); assert.equal(new Set(on).size, on.length, c.name); }
  assert.equal(registrationJSON(reg, { lang: 'en' })[0].name, 'tarot', 'COMMAND_LANG=en 照英文註冊');
});

test('收到中文名的互動會換回英文 id（指令、子指令、參數）；英文名也照收', () => {
  const U = { id: '1', username: 'a' };
  const p = parseInteraction({ type: 2, id: '1', guild_id: 'g', channel_id: 'c', member: { user: U, permissions: '0' }, data: { name: '銀行', options: [{ type: 1, name: '存款', options: [{ type: 4, name: '金額', value: 30 }] }] } });
  assert.equal(p.input.name, 'bank'); assert.equal(p.input.sub, 'deposit'); assert.equal(p.input.options.amount, 30);
  const q = parseInteraction({ type: 2, id: '1', user: U, data: { name: '塔羅', options: [{ type: 3, name: '牌陣', value: 'three' }] } });
  assert.equal(q.input.name, 'tarot'); assert.equal(q.input.options.spread, 'three');
  assert.equal(toEnCommand('tarot'), 'tarot'); assert.equal(toEnSub('bank', 'deposit'), 'deposit'); assert.equal(toEnOpt('bank', 'deposit', 'amount'), 'amount'); assert.equal(toEnOpt('settings', 'ai', '風格'), 'style');
});

test('訊息裡的英文指令提示會換成中文名（網址、路徑、分數不動）', () => {
  assert.equal(localizeHints('先用 /guess start 開始一局。'), '先用 /猜數字 開始 開始一局。');
  assert.equal(localizeHints('管理員可以用 /settings ai enabled:true 打開。'), '管理員可以用 /設定 ai 開啟:true 打開。');
  assert.equal(localizeHints('看 https://x.workers.dev/setup、bot/README.md、1/2 或 /health'), '看 https://x.workers.dev/setup、bot/README.md、1/2 或 /health');
  assert.equal(localizeHints('**/tarot**　塔羅；/collection chara:角色名 看單一角色'), '**/塔羅**　塔羅；/圖鑑 角色:角色名 看單一角色');
});

test('固定頻道：只在指定頻道回應，管理員設定不受限，被動回話也安靜', async () => {
  const claude = fakeClaude([aiText('嗨')]);
  const bot = await makeBot({ claude });
  const other = '800000000000000002';
  const set = await runCmd(bot, 'settings', { sub: 'channel', options: { action: 'add', channel: { id: CHANNEL, name: 'bot' } }, admin: true }); assert.match(textOf(set.last), new RegExp(`<#${CHANNEL}>`));
  const ok = await runCmd(bot, 'daily'); assert.match(textOf(ok.last), /簽到成功/);
  const no = await runCmd(bot, 'daily', { channelId: other, user: USERS.bob }); assert.match(textOf(no.last), new RegExp(`只在 <#${CHANNEL}> 回應`)); assert.ok(no.last.ephemeral);
  const adm = await runCmd(bot, 'settings', { sub: 'show', channelId: other, admin: true }); assert.match(textOf(adm.last), /固定頻道/);
  const t = await runCmd(bot, 'tictactoe'); const b = buttonsOf(t.last)[0];
  const press2 = await press(bot, b.id, { channelId: other, message: t.last }); assert.match(textOf(press2.last), /只在/);
  const quiet = await sendMessage(bot, { channelId: other, content: '<@bot> 嗨', text: '嗨', mentionsBot: true }); assert.equal(quiet.replies.length, 0); assert.equal(claude.calls.length, 0, '不在固定頻道就不呼叫 Claude');
  await runCmd(bot, 'afk', { user: USERS.bob, options: { reason: '吃飯' } });
  const afk = await sendMessage(bot, { channelId: other, content: '@Bob', mentions: [USERS.bob.id] }); assert.equal(afk.replies.length, 0, '其他頻道不代答 AFK');
  assert.ok(bot.store.user(GUILD, USERS.alice.id).xp > 0, '經驗值照算');
  const hi = await sendMessage(bot, { content: '<@bot> 嗨', text: '嗨', mentionsBot: true }); assert.equal(hi.replies.length, 1);
  await runCmd(bot, 'settings', { sub: 'channel', options: { action: 'clear' }, admin: true });
  const again = await runCmd(bot, 'daily', { channelId: other, user: USERS.bob }); assert.match(textOf(again.last), /簽到成功/);
  assert.deepEqual(bot.errors, []);
});

/* ---------- 網站資料：即時榜線、前百、歷史榜線、卡片 ---------- */
test('live：HiSekai 直連失敗退到網站代理再退到 Haruki 備援；兩種回應形狀都能正規化', async () => {
  const calls = [];
  useFetch(async url => {
    calls.push(String(url));
    if (String(url).startsWith('https://api.hisekai.org')) return new Response('', { status: 500 });
    if (String(url).includes('/proxy/hisekai')) return new Response('', { status: 502 });
    if (String(url).includes('/haruki/event/live/border')) return new Response(JSON.stringify({ id: 180, name: 'Wishes in Bloom!', start_at: '2026-09-25T12:00:00Z', aggregate_at: '2026-09-28T11:59:59Z', source: 'haruki', player_border_rankings: [{ rank: 100, score: 2000000 }, { rank: 1000, score: 800000 }], world_link_border_rankings: [{ chapter: 1, character: 21, player_border_rankings: [{ rank: 100, score: 1500000 }] }] }), { status: 200 });
    return new Response('nf', { status: 404 });
  });
  const live = await fetchLive('border');
  assert.equal(live.event.id, 180); assert.equal(live.event.name, 'Wishes in Bloom!'); assert.equal(live.rows[1].score, 800000); assert.equal(live.wl[0].character, 21); assert.equal(live.source, 'haruki'); assert.equal(calls.length, 3, '三段式來源');
  assert.equal((await fetchLive('border')).event.id, 180); assert.equal(calls.length, 3, '一分鐘內走快取');
  const n = normalizeLive('top100', parseSafe('{"event":{"id":181,"name":"X","aggregate_at":"2026-10-01T00:00:00Z"},"player_top_100_rankings":[{"rank":1,"score":9,"name":"a","user_id":7090528553812679426,"last_1h_stats":{"speed":12345}}]}'));
  assert.equal(n.event.id, 181); assert.equal(n.rows[0].userId, '7090528553812679426', '19 位 userId 不失精'); assert.equal(n.rows[0].speed, 12345); assert.ok(n.event.end > 0);
  resetFetch();
});

test('trend：最新一筆與一小時前那一筆的差', () => {
  const h = { tiers: [100, 1000], samples: [[1000, 10, 5], [2800, 20, 8], [4700, 35, 9]], top1: [[4700, 99]] };
  const t = trend(h, 1); assert.equal(t.lines[0].score, 35); assert.equal(t.lines[0].delta, 25); assert.equal(t.lines[1].delta, 4); assert.equal(t.top1, 99);
  assert.equal(trend({ samples: [] }), null);
});

test('/event：日曆照舊；榜線／前百／歷史從網站來源抓，失敗有友善訊息', async () => {
  const bot = await makeBot();
  const now = await runCmd(bot, 'event', { sub: 'now' }); assert.match(textOf(now.last), /活動與卡池/); assert.match(textOf(now.last), /\/活動 榜線/, '提示換成中文名');
  const hist = { eventId: 180, tiers: [100, 1000], samples: [[1790340000, 1000000, 500000], [1790343600, 1100000, 520000]], top1: [[1790343600, 5000000]] };
  const db = { source: 'good果汁', events: [{ id: 179, name: 'Link', start: '2026/09/06', end: '2026/09/18', attr: 'WL全屬性' }], tiers: [1, 100, 1000], borders: [{ id: 179, name: 'Link the Beats!', chara: 'World Link', unit: 'VS', days: 12, type: 'World Link', t: [90000000, 9000000, 900000] }], wlTiers: [1, 100], wl: [{ id: '179.1', name: '未來', round: 'WL3', bonus: 6.7, t: [10000000, 1000000] }] };
  mockLive({
    'api.hisekai.org/tw/event/live/border': { event: { id: 180, name: 'Wishes in Bloom!', aggregate_at: '2026-09-28T11:59:59Z' }, player_border_rankings: [{ rank: 100, score: 1100000 }, { rank: 1000, score: 520000 }] },
    'api.hisekai.org/tw/event/live/top100': { event: { id: 180, name: 'Wishes in Bloom!' }, player_top_100_rankings: [{ rank: 1, score: 5000000, name: 'A*B', last_1h_stats: { speed: 300000 } }, { rank: 2, score: 4000000, name: 'bob' }] },
    '/data/history/index.json': [179, 180], '/data/history/180.json': hist,
    '/data/borders-db.js': '// 註解\nwindow.BORDERS_DB=' + JSON.stringify(db) + ';',
  });
  const b = await runCmd(bot, 'event', { sub: 'border' }); assert.ok(b.deferred, '要先 defer'); const bt = textOf(b.edits[0]);
  assert.match(bt, /第 180 期 Wishes in Bloom!/); assert.match(bt, /T100　\*\*1,100,000\*\*（\+100,000／時）/); assert.match(bt, /T1,000　\*\*520,000\*\*（\+20,000／時）/); assert.match(bt, /第 1 名 5,000,000/);
  const t = await runCmd(bot, 'event', { sub: 'top', options: { count: 5 } }); const tt = textOf(t.edits[0]);
  assert.match(tt, /🥇 A\\\*B　\*\*5,000,000\*\*　⏱ 300,000／時/); assert.match(tt, /🥈 bob　\*\*4,000,000\*\*/);
  const h = await runCmd(bot, 'event', { sub: 'history' }); const ht = textOf(h.edits[0]);
  assert.match(ht, /第 179 期 Link the Beats!/); assert.match(ht, /T1　\*\*90,000,000\*\*/); assert.match(ht, /WL全屬性/); assert.match(ht, /未來・WL3・加成 6\.7/); assert.match(ht, /T100　1,000,000/);
  const miss = await runCmd(bot, 'event', { sub: 'history', options: { event: 5 } }); assert.match(textOf(miss.edits[0]), /沒有第 5 期/);
  resetFetch();
  const fail = await runCmd(bot, 'event', { sub: 'border' }); assert.match(textOf(fail.edits[0]), /暫時抓不到榜線資料/);
  assert.deepEqual(bot.errors, []);
});

test('/card：自動完成、依 id 查、模糊查多張、技能敘述有數值；/gachastats 含天井（原 /pity）', async () => {
  const bot = await makeBot();
  const ac = await bot.runAutocomplete({ name: 'card', focused: '一歌', user: USERS.alice, guildId: GUILD, channelId: CHANNEL, io: {} }); assert.ok(ac.length >= 1 && ac.length <= 25); assert.match(ac[0].name, /一歌/); assert.match(ac[0].value, /^\d+$/);
  const one = await runCmd(bot, 'card', { options: { name: '4' } }); const e = one.last.embeds[0];
  assert.match(e.title, /★+ 星乃一歌「/); assert.ok(e.thumbnail && e.thumbnail.url); assert.ok(e.fields.some(f => f.name === '滿等綜合力' && /\d/.test(f.value)));
  const sk = e.fields.find(f => f.name.startsWith('技能・')); assert.ok(sk, '要有技能欄'); assert.match(sk.value, /Lv\.1：.*\d/); assert.match(sk.value, /Lv\.4：/);
  const many = await runCmd(bot, 'card', { options: { name: '一歌' } }); assert.match(textOf(many.last), /找到多張/);
  const none = await runCmd(bot, 'card', { options: { name: 'zzzzzz' } }); assert.match(textOf(none.last), /找不到/);
  assert.equal(searchCards('4')[0].id, 4); assert.ok(cardExtra(4) && cardExtra(4).skill); assert.match(skillText(cardExtra(4).skill, 4, '一歌'), /\d/);
  assert.equal(skillText(['{{9;v}}%{{9;c}}', {}], 1, '一歌'), '…%一歌（「…」的數值依編組或狀態而定）');
  const u = bot.store.user(GUILD, USERS.alice.id); u.pulls = 120; u.pulls4 = 2; u.sinceLast4 = 30;
  const gs = await runCmd(bot, 'gachastats'); assert.match(textOf(gs.last), /距上次 4★/); assert.match(textOf(gs.last), /還差 180 抽/);
  // AI 的 run_command 也能用這些
  const rf = await runFeature(one.ctx, { name: 'card', sub: '', options: '{"name":"4"}' }); assert.match(rf.text, /技能/); assert.equal(rf.extra.embeds.length, 1);
  assert.deepEqual(bot.errors, []);
});
