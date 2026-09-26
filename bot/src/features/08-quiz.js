/* 問答與音樂（10）：綜合問答、猜歌、猜角色、搶答、問答排行、歌曲查詢、隨機選曲、歌單、歌曲對決、活動（日曆／榜線／前百／歷史） */

import { str, int, sub } from '../core/opts.js';
import { embed, button, row, cid, COLORS, Style, mention, num, clean, ts, bar, LETTER_EMOJI } from '../core/ui.js';
import { award, quest, checkAchievements, achievementLine } from '../core/helpers.js';
import { CHARAS, charaById, UNITS, SONGS, songById, songLevel, songNotes, fmtLen, searchSongs, DIFF_NAMES, eventsAround, gachasAround } from '../core/sekai.js';
import { fetchLive, fetchHistoryIndex, fetchHistory, trend, fetchBordersDb } from '../core/live.js';
import { TRIVIA } from '../content/trivia.js';
import { Rng } from '../core/rng.js';

/* ---------- 題目產生器 ---------- */
function shuffleQ(rng, q, opts, ans) { const idx = rng.shuffle([0, 1, 2, 3]); return { q, opts: idx.map(i => opts[i]), ans: idx.indexOf(ans) }; }
export function genSekaiQ(rng) {
  const kind = rng.int(0, 5);
  if (kind === 0) { const c = rng.pick(CHARAS); const others = rng.sample(UNITS.filter(u => u !== c.unit), 3); return shuffleQ(rng, `${c.name} 屬於哪個團體？`, [c.unit.name, ...others.map(u => u.name)], 0); }
  if (kind === 1) { const c = rng.pick(CHARAS); const others = rng.sample(CHARAS.filter(x => x.birthday !== c.birthday), 3); return shuffleQ(rng, `誰的生日是 ${c.birthday.replace('-', '/')}？`, [c.name, ...others.map(x => x.name)], 0); }
  if (kind === 2) { const u = rng.pick(UNITS.slice(0, 5)); const members = CHARAS.filter(c => c.unit === u); const out = rng.pick(CHARAS.filter(c => c.unit !== u && c.unit !== UNITS[5])); return shuffleQ(rng, `誰不是 ${u.name} 的成員？`, [out.name, ...rng.sample(members, 3).map(c => c.name)], 0); }
  if (kind === 3) { const s = rng.pick(SONGS.filter(x => songLevel(x, 'M'))); const lv = songLevel(s, 'M'); const opts = [lv]; while (opts.length < 4) { const v = lv + rng.int(-4, 4); if (v >= 20 && v <= 37 && !opts.includes(v)) opts.push(v); } return shuffleQ(rng, `「${s.title}」的 MASTER 難度是幾級？`, opts.map(String), 0); }
  if (kind === 4) { const s = rng.pick(SONGS.filter(x => x.bpm)); const opts = [s.bpm]; while (opts.length < 4) { const v = s.bpm + rng.int(-40, 40); if (v > 60 && !opts.includes(v)) opts.push(v); } return shuffleQ(rng, `「${s.title}」的 BPM 是多少？`, opts.map(String), 0); }
  const s = rng.pick(SONGS.filter(x => songNotes(x, 'M'))); const n = songNotes(s, 'M'); const opts = [n]; while (opts.length < 4) { const v = n + rng.int(-300, 300); if (v > 100 && !opts.includes(v)) opts.push(v); } return shuffleQ(rng, `「${s.title}」MASTER 的物量（note 數）是？`, opts.map(String), 0);
}
export function genTrivia(rng) { const [q, opts, ans, cat] = rng.pick(TRIVIA); return { q: `【${cat}】${q}`, opts, ans }; }

function quizMsg(sid, q, title, owner) {
  return { embeds: [embed({ title, color: COLORS.blue, description: `**${q.q}**\n\n${q.opts.map((o, i) => `${LETTER_EMOJI[i]} ${o}`).join('\n')}`, footer: owner ? '只有發起人能作答' : '所有人都可以搶答，最先答對的得分' })], components: [row(...q.opts.map((_, i) => button({ id: cid(sid.f, 'a', sid.id, i), label: 'ABCD'[i], style: Style.primary })))] };
}
async function quizAnswer(ctx, feature, reward = 15) {
  const [sid, kS] = ctx.data; const s = ctx.bot.sessions.get(feature, sid);
  if (!s) return ctx.update({ content: '這題已過期。', embeds: [], components: [] });
  if (s.owner && !ctx.isOwner(s.owner)) return ctx.reply({ content: `這是別人的題目，想玩請用 /${feature}。`, ephemeral: true });
  if (!s.owner && s.tried.has(ctx.user.id)) return ctx.reply({ content: '你已經答過這題了。', ephemeral: true });
  const right = +kS === s.q.ans; const u = ctx.u();
  if (right) { u.quiz.right++; u.quiz.pts += reward; award(ctx, ctx.settings.quizReward || reward); quest(ctx, 'quiz'); ctx.bot.sessions.del(feature, sid); }
  else { u.quiz.wrong++; if (s.owner) ctx.bot.sessions.del(feature, sid); else s.tried.add(ctx.user.id); }
  const fresh = checkAchievements(ctx);
  if (!right && !s.owner) return ctx.reply({ content: `❌ 不對喔。`, ephemeral: true });
  const e = embed({ title: right ? '✅ 答對了！' : '❌ 答錯了', color: right ? COLORS.green : COLORS.red, description: `**${s.q.q}**\n正解：${LETTER_EMOJI[s.q.ans]} ${s.q.opts[s.q.ans]}\n${right ? `${mention(ctx.user.id)} +${ctx.settings.quizReward || reward} ${ctx.currency}` : `你選了 ${LETTER_EMOJI[+kS]}`}${achievementLine(fresh)}` });
  await ctx.update({ embeds: [e], components: [row(button({ id: cid(feature, 'next', s.owner || '-', s.kind || '-'), label: '下一題', style: Style.secondary }))] });
}

/* ---------- 綜合問答 ---------- */
const quiz = {
  name: 'quiz', description: '綜合問答：世界計畫題或常識題，答對得水晶', category: 'quiz',
  options: [str('kind', '題型', { choices: [['世界計畫', 'sekai'], ['常識', 'trivia'], ['混合', 'mix']] })],
  async run(ctx) { await ctx.reply(startQuiz(ctx, ctx.opt('kind') || 'mix', ctx.user.id)); },
  buttons: { a: ctx => quizAnswer(ctx, 'quiz'), async next(ctx) { const [owner, kind] = ctx.data; if (owner !== '-' && !ctx.isOwner(owner)) return ctx.reply({ content: '想玩請用 /quiz。', ephemeral: true }); await ctx.update(startQuiz(ctx, kind === '-' ? 'mix' : kind, ctx.user.id)); } },
};
function startQuiz(ctx, kind, owner) {
  const k = kind === 'mix' ? ctx.rng.pick(['sekai', 'trivia']) : kind;
  const q = k === 'sekai' ? genSekaiQ(ctx.rng) : genTrivia(ctx.rng);
  const id = ctx.bot.sessions.create('quiz', { q, owner, kind, tried: new Set() }, 10 * 60e3);
  return quizMsg({ f: 'quiz', id }, q, k === 'sekai' ? '🎵 世界計畫問答' : '📚 常識問答', owner);
}

/* ---------- 猜歌 ---------- */
export function genSongQ(rng) {
  const s = rng.pick(SONGS.filter(x => x.bpm && songLevel(x, 'M')));
  const others = rng.sample(SONGS.filter(x => x.id !== s.id), 3);
  const hints = [`BPM ${s.bpm}`, `長度 ${fmtLen(s.length)}`, `MASTER Lv.${songLevel(s, 'M')}`, songNotes(s, 'M') ? `MASTER ${songNotes(s, 'M')} notes` : null, `活動加成率 ${s.rate}`].filter(Boolean);
  return shuffleQ(rng, `這首歌是？提示：${rng.sample(hints, 3).join('、')}`, [s.title, ...others.map(x => x.title)], 0);
}
const songquiz = {
  name: 'songquiz', description: '猜歌：從 BPM、長度、難度等提示猜出是哪一首', category: 'quiz',
  async run(ctx) { await ctx.reply(startSongQ(ctx)); },
  buttons: { a: ctx => quizAnswer(ctx, 'songquiz', 20), async next(ctx) { if (!ctx.isOwner(ctx.data[0])) return ctx.reply({ content: '想玩請用 /songquiz。', ephemeral: true }); await ctx.update(startSongQ(ctx)); } },
};
function startSongQ(ctx) { const q = genSongQ(ctx.rng); const id = ctx.bot.sessions.create('songquiz', { q, owner: ctx.user.id, tried: new Set() }, 10 * 60e3); return quizMsg({ f: 'songquiz', id }, q, '🎧 猜歌', ctx.user.id); }

/* ---------- 猜角色 ---------- */
export function genCharaQ(rng) {
  const c = rng.pick(CHARAS);
  const others = rng.sample(CHARAS.filter(x => x.id !== c.id), 3);
  const kind = rng.int(0, 1);
  const q = kind === 0 ? `哪位角色的生日是 ${c.birthday.replace('-', '/')}、所屬 ${c.unit.name}？` : `暱稱／簡稱是「${c.short}」的角色是？`;
  return shuffleQ(rng, q, [c.name, ...others.map(x => x.name)], 0);
}
const charaquiz = {
  name: 'charaquiz', description: '猜角色：從生日、團體、暱稱猜出是誰', category: 'quiz',
  async run(ctx) { await ctx.reply(startCharaQ(ctx)); },
  buttons: { a: ctx => quizAnswer(ctx, 'charaquiz'), async next(ctx) { if (!ctx.isOwner(ctx.data[0])) return ctx.reply({ content: '想玩請用 /charaquiz。', ephemeral: true }); await ctx.update(startCharaQ(ctx)); } },
};
function startCharaQ(ctx) { const q = genCharaQ(ctx.rng); const id = ctx.bot.sessions.create('charaquiz', { q, owner: ctx.user.id, tried: new Set() }, 10 * 60e3); return quizMsg({ f: 'charaquiz', id }, q, '👤 猜角色', ctx.user.id); }

/* ---------- 搶答 ---------- */
function startSpeed(ctx, kind) {
  const k = kind === 'mix' ? ctx.rng.pick(['sekai', 'trivia', 'song']) : kind;
  const q = k === 'sekai' ? genSekaiQ(ctx.rng) : k === 'song' ? genSongQ(ctx.rng) : genTrivia(ctx.rng);
  const id = ctx.bot.sessions.create('speedquiz', { q, owner: null, kind, tried: new Set() }, 5 * 60e3);
  return quizMsg({ f: 'speedquiz', id }, q, '⚡ 搶答！', null);
}
const speedquiz = {
  name: 'speedquiz', description: '搶答：全頻道一起搶，最先答對的人得分', category: 'quiz',
  options: [str('kind', '題型', { choices: [['世界計畫', 'sekai'], ['常識', 'trivia'], ['猜歌', 'song'], ['混合', 'mix']] })],
  async run(ctx) { await ctx.reply(startSpeed(ctx, ctx.opt('kind') || 'mix')); },
  buttons: { a: ctx => quizAnswer(ctx, 'speedquiz', 25), async next(ctx) { await ctx.update(startSpeed(ctx, ctx.data[1] === '-' ? 'mix' : ctx.data[1])); } },
};

/* ---------- 問答排行 ---------- */
const quizrank = {
  name: 'quizrank', description: '問答排行榜（本伺服器）', category: 'quiz',
  async run(ctx) {
    const rows = ctx.store.users(ctx.guildId).filter(x => x.rec.quiz.right > 0).map(x => ({ uid: x.uid, ...x.rec.quiz })).sort((a, b) => b.pts - a.pts).slice(0, 10);
    await ctx.reply({ embeds: [embed({ title: '🏅 問答排行', color: COLORS.blue, description: rows.length ? rows.map((r, i) => `${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} ${mention(r.uid)}　${num(r.pts)} 分（${r.right} 對 ${r.wrong} 錯，正確率 ${Math.round(r.right / (r.right + r.wrong) * 100)}%）`).join('\n') : '還沒有人答題。' })] });
  },
};

/* ---------- 歌曲查詢 ---------- */
function songEmbed(s) {
  const diffs = Object.keys(DIFF_NAMES).filter(d => s.d[d]).map(d => `${DIFF_NAMES[d]} **${s.d[d][0]}**（${s.d[d][1]} notes）`);
  return embed({ title: `🎵 ${s.title}`, color: COLORS.brand, fields: [{ name: 'BPM', value: s.bpm ? (s.bpmRange && s.bpmRange[0] !== s.bpmRange[1] ? `${s.bpm}（${s.bpmRange[0]}–${s.bpmRange[1]}）` : String(s.bpm)) : '—', inline: true }, { name: '長度', value: fmtLen(s.length), inline: true }, { name: '活動加成率', value: String(s.rate), inline: true }, { name: '難度', value: diffs.join('\n') }], footer: `id ${s.id}・資料同 SEKAI 資源中心曲庫` });
}
const song = {
  name: 'song', description: '歌曲查詢：難度、物量、BPM、長度', category: 'quiz',
  options: [str('title', '歌名（支援自動完成）', { required: true, autocomplete: true, maxLen: 60 })],
  async autocomplete(ctx, focused) { return searchSongs(focused, 25).map(s => ({ name: s.title, value: String(s.id) })); },
  async run(ctx) {
    const list = searchSongs(ctx.opt('title'), 5);
    if (!list.length) return ctx.reply({ content: '找不到這首歌。', ephemeral: true });
    if (list.length > 1 && !/^\d+$/.test(String(ctx.opt('title')))) return ctx.reply({ content: `找到多首，請更精確：\n${list.map(s => `・${s.title}`).join('\n')}`, ephemeral: true });
    await ctx.reply({ embeds: [songEmbed(list[0])] });
  },
};

/* ---------- 隨機選曲 ---------- */
const randomsong = {
  name: 'randomsong', description: '隨機選一首歌（可指定難度與等級範圍）', category: 'quiz',
  options: [str('diff', '難度', { choices: Object.entries(DIFF_NAMES).map(([k, v]) => [v, k]) }), int('min', '最低等級', { min: 1, max: 40 }), int('max', '最高等級', { min: 1, max: 40 })],
  async run(ctx) {
    const d = ctx.opt('diff') || 'M', lo = ctx.opt('min') || 1, hi = ctx.opt('max') || 40;
    const pool = SONGS.filter(s => { const lv = songLevel(s, d); return lv && lv >= lo && lv <= hi; });
    if (!pool.length) return ctx.reply({ content: '這個範圍沒有歌。', ephemeral: true });
    const s = ctx.rng.pick(pool);
    await ctx.reply({ content: `🎲 ${DIFF_NAMES[d]} Lv.${songLevel(s, d)}（${pool.length} 首裡挑的）`, embeds: [songEmbed(s)], components: [row(button({ id: cid('randomsong', 'again', d, lo, hi), label: '再抽', style: Style.secondary }))] });
  },
  buttons: { async again(ctx) { const [d, lo, hi] = ctx.data; const pool = SONGS.filter(s => { const lv = songLevel(s, d); return lv && lv >= +lo && lv <= +hi; }); const s = ctx.rng.pick(pool); await ctx.update({ content: `🎲 ${DIFF_NAMES[d]} Lv.${songLevel(s, d)}（${pool.length} 首裡挑的）`, embeds: [songEmbed(s)], components: ctx.message ? ctx.message.components : [] }); } },
};

/* ---------- 歌單 ---------- */
const setlist = {
  name: 'setlist', description: '隨機歌單：協力前抽 N 首歌', category: 'quiz',
  options: [int('count', '幾首（1～10）', { min: 1, max: 10 }), str('diff', '難度', { choices: Object.entries(DIFF_NAMES).map(([k, v]) => [v, k]) }), int('min', '最低等級', { min: 1, max: 40 }), int('max', '最高等級', { min: 1, max: 40 })],
  async run(ctx) {
    const n = ctx.opt('count') || 5, d = ctx.opt('diff') || 'M', lo = ctx.opt('min') || 1, hi = ctx.opt('max') || 40;
    const pool = SONGS.filter(s => { const lv = songLevel(s, d); return lv && lv >= lo && lv <= hi; });
    if (!pool.length) return ctx.reply({ content: '這個範圍沒有歌。', ephemeral: true });
    const list = ctx.rng.sample(pool, n);
    const total = list.reduce((s, x) => s + x.length, 0);
    await ctx.reply({ embeds: [embed({ title: `📝 隨機歌單（${DIFF_NAMES[d]} ${lo}–${hi}）`, color: COLORS.brand, description: list.map((s, i) => `${i + 1}. **${s.title}**　Lv.${songLevel(s, d)}・${fmtLen(s.length)}`).join('\n'), footer: `總長約 ${fmtLen(total)}` })] });
  },
};

/* ---------- 歌曲對決 ---------- */
function battleMsg(sid, s) {
  const a = s.votes.filter(v => v === 0).length, b = s.votes.length - a;
  return { embeds: [embed({ title: '⚔️ 歌曲對決', color: COLORS.red, description: `🅰️ **${s.a.title}**　${a} 票\n${bar(a, s.votes.length || 1, 15)}\n\n🅱️ **${s.b.title}**　${b} 票\n${bar(b, s.votes.length || 1, 15)}`, footer: `${s.votes.length} 人投票・你比較喜歡哪首？` })], components: [row(button({ id: cid('songbattle', 'v', sid, 0), label: 'A', emoji: '🅰️', style: Style.primary }), button({ id: cid('songbattle', 'v', sid, 1), label: 'B', emoji: '🅱️', style: Style.primary }), button({ id: cid('songbattle', 'next'), label: '下一組', style: Style.secondary }))] };
}
const songbattle = {
  name: 'songbattle', description: '歌曲對決：兩首歌，大家投票選出比較喜歡的', category: 'quiz',
  async run(ctx) { const [a, b] = ctx.rng.sample(SONGS, 2); const s = { a, b, votes: [], voters: new Set() }; await ctx.reply(battleMsg(ctx.bot.sessions.create('songbattle', s, 2 * 3600e3), s)); },
  buttons: {
    async v(ctx) { const [sid, k] = ctx.data; const s = ctx.bot.sessions.get('songbattle', sid); if (!s) return ctx.update({ content: '這組已過期。', embeds: [], components: [] }); if (s.voters.has(ctx.user.id)) return ctx.reply({ content: '你投過了。', ephemeral: true }); s.voters.add(ctx.user.id); s.votes.push(+k); await ctx.update(battleMsg(sid, s)); },
    async next(ctx) { const [a, b] = ctx.rng.sample(SONGS, 2); const s = { a, b, votes: [], voters: new Set() }; await ctx.update(battleMsg(ctx.bot.sessions.create('songbattle', s, 2 * 3600e3), s)); },
  },
};

/* ---------- 活動：日曆、即時榜線、前百、歷史榜線（跟網站排名頁同一套來源，見 core/live.js） ---------- */
const chapterName = c => { const ch = c.character ? charaById(c.character) : null; return `第 ${c.chapter} 章${ch ? `・${ch.name}` : ''}`; };
const medal = r => (r <= 3 ? ['🥇', '🥈', '🥉'][r - 1] : `${r}.`);
const deltaStr = d => (d == null ? '' : `（${d >= 0 ? '+' : ''}${num(d)}／時）`);
const LIVE_FAIL = '暫時抓不到榜線資料（HiSekai 與網站備援都沒回應），稍後再試。';

function calendarMsg() {
  const now = Date.now(); const evs = eventsAround(now, 21); const gs = gachasAround(now, 7).slice(0, 8);
  const fields = [];
  if (evs.length) fields.push({ name: '活動（依伴生卡池推算）', value: evs.map(g => `${g.start <= now && g.end >= now ? '🟢' : '🕒'} 第 ${g.eid} 期${g.et ? `・${g.et}` : ''}${g.ech ? `・${g.ech}` : ''}　${ts(g.start, 'd')}～${ts(g.end, 'd')}${g.start > now ? `（${ts(g.start)}）` : `（${ts(g.end)} 結束）`}`).join('\n') });
  if (gs.length) fields.push({ name: '一週內的卡池', value: gs.map(g => `${g.start <= now && g.end >= now ? '🟢' : '🕒'} ${g.n}　${ts(g.start, 'd')}～${ts(g.end, 'd')}`).join('\n') });
  return { embeds: [embed({ title: '📅 活動與卡池', color: COLORS.green, description: fields.length ? '想看榜線用 /event border、前百 /event top、歷史榜線 /event history。' : '資料範圍內沒有活動或卡池。', fields, footer: '時間依 Discord 時區顯示・資料來源 SEKAI 資源中心' })] };
}
async function borderMsg() {
  const live = await fetchLive('border');
  let tr = null;
  try { const idx = await fetchHistoryIndex(); if (live.event.id && Array.isArray(idx) && idx.includes(live.event.id)) tr = trend(await fetchHistory(live.event.id), 1); } catch {}
  const delta = new Map(((tr && tr.lines) || []).map(l => [l.tier, l.delta]));
  const main = live.rows.map(r => `T${num(r.rank)}　**${num(r.score)}**${deltaStr(delta.get(r.rank))}`).join('\n');
  const fields = live.wl.map(c => ({ name: chapterName(c), value: c.rows.map(r => `T${num(r.rank)}　${num(r.score)}`).join('\n') || '—', inline: true }));
  const head = `${live.event.end ? `結束 ${ts(live.event.end, 'f')}（${ts(live.event.end)}）` : ''}${tr && tr.top1 != null ? `　第 1 名 ${num(tr.top1)}` : ''}`;
  return { embeds: [embed({ title: `📈 榜線・第 ${live.event.id ?? '?'} 期 ${live.event.name}`, color: COLORS.blue, description: `${head}\n\n${main || '（目前沒有段位資料）'}${live.partial ? '\n-# 段位端點暫時只有前百換算的 T100' : ''}`, fields, footer: `來源 ${live.source}${tr && tr.prevAt ? '・括號為近一小時增量（網站榜線快照）' : ''}・網站排名頁同一套資料` })] };
}
async function topMsg(count) {
  const live = await fetchLive('top100'); const n = Math.max(5, Math.min(50, count || 10));
  const line = r => `${medal(r.rank)} ${clean(r.name) || '（無名）'}　**${num(r.score)}**${r.speed != null ? `　⏱ ${num(r.speed)}／時` : ''}`;
  const fields = live.wl.map(c => ({ name: chapterName(c), value: c.rows.slice(0, 3).map(line).join('\n') || '—', inline: true }));
  return { embeds: [embed({ title: `🏁 前百・第 ${live.event.id ?? '?'} 期 ${live.event.name}`, color: COLORS.gold, description: (live.event.end ? `結束 ${ts(live.event.end)}\n\n` : '') + (live.rows.slice(0, n).map(line).join('\n') || '（目前沒有資料）'), fields, footer: `來源 ${live.source}・⏱ 為近一小時時速・網站排名頁同一套資料` })] };
}
async function historyMsg(eventId) {
  const db = await fetchBordersDb(); const list = db.borders || [];
  const target = eventId ? list.find(b => b.id === eventId) : list[list.length - 1];
  if (!target) return { content: eventId ? `歷史榜線紀錄裡沒有第 ${eventId} 期（目前有第 ${list[0] ? list[0].id : '?'}～${list.length ? list[list.length - 1].id : '?'} 期）。` : '目前沒有歷史榜線資料。', ephemeral: true };
  const meta = (db.events || []).find(e => e.id === target.id) || {};
  const tiers = db.tiers || [];
  const pick = [1, 10, 50, 100, 500, 1000, 2000, 5000].map(t => { const i = tiers.indexOf(t); const v = i >= 0 ? target.t[i] : null; return v != null ? `T${num(t)}　**${num(v)}**` : null; }).filter(Boolean);
  const wl = (db.wl || []).filter(w => String(w.id).split('.')[0] === String(target.id));
  const wt = db.wlTiers || [];
  const fields = wl.map(w => ({ name: `${w.name}${w.round ? `・${w.round}` : ''}${w.bonus ? `・加成 ${w.bonus}` : ''}`, value: [1, 100, 1000, 5000].map(t => { const i = wt.indexOf(t); const v = i >= 0 ? w.t[i] : null; return v != null ? `T${num(t)}　${num(v)}` : null; }).filter(Boolean).join('\n') || '—', inline: true }));
  return { embeds: [embed({ title: `📚 歷史榜線・第 ${target.id} 期 ${target.name}`, color: COLORS.purple, description: `${meta.start || ''}～${meta.end || ''}・${target.days} 天・${target.type}${meta.attr ? `・${meta.attr}` : ''}・${target.chara}（${target.unit}）\n\n${pick.join('\n') || '（沒有段位資料）'}`, fields, footer: `${db.source || ''}・用 /event history event:期數 看其他期` })] };
}
const event = {
  name: 'event', description: '台服活動：日曆、即時榜線與前百（同網站排名頁）、歷史榜線', category: 'quiz',
  options: [sub('now', '進行中與即將開始的活動、卡池'), sub('border', '目前榜線：各段位分數與近一小時增量'), sub('top', '目前前百', [int('count', '顯示幾名（5～50，預設 10）', { min: 5, max: 50 })]), sub('history', '某一期的最終榜線（不填就是最近一期）', [int('event', '期數', { min: 1, max: 999 })])],
  async run(ctx) {
    if (!ctx.sub || ctx.sub === 'now') return ctx.reply(calendarMsg());
    await ctx.defer();   // 要打外部來源，先讓 Discord 等
    try {
      const msg = ctx.sub === 'border' ? await borderMsg() : ctx.sub === 'top' ? await topMsg(ctx.opt('count')) : await historyMsg(ctx.opt('event'));
      await ctx.edit(msg);
    } catch (e) {
      await ctx.edit({ content: `${LIVE_FAIL}\n-# ${String((e && e.message) || e).slice(0, 120)}`, embeds: [], components: [] });
    }
  },
};

export default [quiz, songquiz, charaquiz, speedquiz, quizrank, song, randomsong, setlist, songbattle, event];
