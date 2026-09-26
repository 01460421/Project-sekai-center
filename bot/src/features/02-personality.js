/* 性格測驗（10）：MBTI、五大人格、戀愛類型、靈魂動物、色彩心理、左右腦、九型人格、心理測驗、壓力指數、血型 */

import { str, sub, user as userOpt } from '../core/opts.js';
import { embed, button, row, select, cid, COLORS, Style, bar } from '../core/ui.js';
import { makeQuizFlow, dailyRng, scoreOf } from '../core/oracle.js';
import { checkAchievements, achievementLine } from '../core/helpers.js';
import { MBTI_Q, MBTI_TYPES, MBTI_MATCH, BIGFIVE_Q, BIGFIVE_TRAITS, LIKERT, ENNEA_Q, ENNEA_TYPES, LOVE_Q, LOVE_TYPES, ANIMAL_Q, ANIMALS, COLORS_PSY, BRAIN_Q, STRESS_Q, STRESS_SCALE, BLOOD, PSY_TESTS } from '../content/personality.js';

/* 通用：把 makeQuizFlow 包成功能（start / ans 按鈕） */
function quizFeature({ name, description, flow, onDone }) {
  return {
    name, description, category: 'personality',
    async run(ctx) { const { msg } = flow.start(ctx); await ctx.reply(msg); },
    buttons: {
      async ans(ctx) {
        const r = flow.answer(ctx);
        if (r.denied) return ctx.reply({ content: '這是別人的測驗，想測請用 /' + name, ephemeral: true });
        if (!r.done) return ctx.update(r.msg);
        const out = await onDone(ctx, r.res, r.scores);
        await ctx.update(out);
      },
    },
  };
}

/* ---------- MBTI ---------- */
const mbtiFlow = makeQuizFlow({
  feature: 'mbti', title: '🧠 MBTI 性格測驗', questions: MBTI_Q, color: COLORS.blue,
  result(s) {
    const t = (s.E || 0) >= (s.I || 0) ? 'E' : 'I';
    const n = (s.N || 0) > (s.S || 0) ? 'N' : 'S';
    const f = (s.F || 0) > (s.T || 0) ? 'F' : 'T';
    const p = (s.P || 0) > (s.J || 0) ? 'P' : 'J';
    return t + n + f + p;
  },
});
function mbtiEmbed(type, scores) {
  const [nick, desc, weak] = MBTI_TYPES[type];
  const axis = (a, b) => `${a} ${bar(scores[a] || 0, 8, 8)} ${scores[a] || 0}　${b} ${scores[b] || 0}`;
  return embed({
    title: `🧠 你是 ${type}・${nick}`, color: COLORS.blue, description: desc,
    fields: [
      { name: '傾向', value: scores ? [axis('E', 'I'), axis('S', 'N'), axis('T', 'F'), axis('J', 'P')].join('\n') : '（查詢模式）' },
      { name: '要注意的', value: weak, inline: true }, { name: '速配類型', value: MBTI_MATCH[type].join('、'), inline: true },
    ],
  });
}
const mbti = {
  name: 'mbti', description: 'MBTI 十六型人格測驗（16 題），或查詢某型與配對', category: 'personality',
  options: [sub('test', '開始測驗'), sub('type', '查詢某一型', [str('type', '例如 INFP', { required: true, maxLen: 4 })]), sub('match', '兩型配對', [str('a', '第一型', { required: true, maxLen: 4 }), str('b', '第二型', { required: true, maxLen: 4 })])],
  async run(ctx) {
    if (ctx.sub === 'type') {
      const t = String(ctx.opt('type') || '').toUpperCase();
      if (!MBTI_TYPES[t]) return ctx.reply({ content: '沒有這一型，MBTI 是四個字母，例如 ENFP。', ephemeral: true });
      return ctx.reply({ embeds: [mbtiEmbed(t, null)] });
    }
    if (ctx.sub === 'match') {
      const a = String(ctx.opt('a') || '').toUpperCase(), b = String(ctx.opt('b') || '').toUpperCase();
      if (!MBTI_TYPES[a] || !MBTI_TYPES[b]) return ctx.reply({ content: '請輸入兩個正確的 MBTI 類型。', ephemeral: true });
      const same = [0, 1, 2, 3].filter(i => a[i] === b[i]).length;
      const best = MBTI_MATCH[a].includes(b) || MBTI_MATCH[b].includes(a);
      const score = best ? 90 + scoreOf(a, b) % 10 : 40 + same * 12 + scoreOf(a, b) % 10;
      return ctx.reply({ embeds: [embed({ title: `${a} × ${b} 契合度 ${score}%`, color: COLORS.pink, description: `${bar(score, 100, 20)}\n${best ? '教科書級的互補組合，彼此的不同正好補上對方的缺口。' : same >= 3 ? '非常相似，很容易理解彼此，但也容易一起卡在同一個盲點。' : same === 2 ? '一半相同一半不同，磨合期過了會很穩。' : '差異很大，需要多溝通，但也最能互相學習。'}` })] });
    }
    const { msg } = mbtiFlow.start(ctx); await ctx.reply(msg);
  },
  buttons: {
    async ans(ctx) {
      const r = mbtiFlow.answer(ctx);
      if (r.denied) return ctx.reply({ content: '這是別人的測驗，想測請用 /mbti test', ephemeral: true });
      if (!r.done) return ctx.update(r.msg);
      const u = ctx.u(); u.mbti = r.res;
      const fresh = checkAchievements(ctx);
      const e = mbtiEmbed(r.res, r.scores);
      if (fresh.length) e.description += achievementLine(fresh);
      const ai = await ctx.ai(`MBTI 測驗結果 ${r.res}（${MBTI_TYPES[r.res][0]}），各軸分數 ${JSON.stringify(r.scores)}。`);
      if (ai) e.fields.push({ name: '✨ 解讀', value: ai.slice(0, 1024) });
      await ctx.update({ embeds: [e], components: [] });
    },
  },
};

/* ---------- 五大人格（Likert） ---------- */
const bigfive = {
  name: 'bigfive', description: '五大人格測驗（15 題）：開放、盡責、外向、親和、神經質', category: 'personality',
  async run(ctx) {
    const sid = ctx.bot.sessions.create('bigfive', { owner: ctx.user.id, i: 0, s: { O: 0, C: 0, E: 0, A: 0, N: 0 } }, 20 * 60e3);
    await ctx.reply(bigfiveQ(sid, 0));
  },
  buttons: {
    async a(ctx) {
      const [sid, iS, vS] = ctx.data;
      const s = ctx.bot.sessions.get('bigfive', sid);
      if (!s) return ctx.update({ content: '測驗已過期，請重新開始。', embeds: [], components: [] });
      if (!ctx.isOwner(s.owner)) return ctx.reply({ content: '這是別人的測驗。', ephemeral: true });
      if (+iS !== s.i) return ctx.update(bigfiveQ(sid, s.i));
      const [, trait, dir] = BIGFIVE_Q[s.i];
      const v = +vS - 2;                                   // -2..2
      s.s[trait] += dir * v;
      s.i++;
      if (s.i < BIGFIVE_Q.length) return ctx.update(bigfiveQ(sid, s.i));
      ctx.bot.sessions.del('bigfive', sid);
      const lines = Object.entries(BIGFIVE_TRAITS).map(([k, [name, desc]]) => { const pct = Math.round(((s.s[k] + 6) / 12) * 100); return `**${name}** ${bar(pct, 100, 12)} ${pct}%\n${desc}`; });
      const top = Object.entries(s.s).sort((a, b) => b[1] - a[1])[0][0];
      await ctx.update({ embeds: [embed({ title: '🧬 你的五大人格側寫', color: COLORS.green, description: lines.join('\n\n'), footer: `最突出的是「${BIGFIVE_TRAITS[top][0]}」` })], components: [] });
    },
  },
};
function bigfiveQ(sid, i) {
  return {
    embeds: [embed({ title: `🧬 五大人格（${i + 1}/${BIGFIVE_Q.length}）`, color: COLORS.green, description: `**${BIGFIVE_Q[i][0]}**`, footer: '只有發起人能作答' })],
    components: [row(...LIKERT.map((l, k) => button({ id: cid('bigfive', 'a', sid, i, k), label: l, style: k === 2 ? Style.secondary : Style.primary })))],
  };
}

/* ---------- 戀愛類型 ---------- */
const loveFlow = makeQuizFlow({
  feature: 'lovestyle', title: '💘 戀愛類型測驗', questions: LOVE_Q, color: COLORS.pink,
  result(s) {
    const arr = Object.entries(s).sort((a, b) => b[1] - a[1]);
    if (arr.length >= 3 && arr[0][1] - arr[2][1] <= 1) return 'balanced';
    return arr[0][0];
  },
});
const lovestyle = quizFeature({
  name: 'lovestyle', description: '戀愛類型測驗（8 題）：烈焰、大地、深海、微風還是全能型？', flow: loveFlow,
  onDone: (ctx, res) => { const [n, d, c] = LOVE_TYPES[res]; return { embeds: [embed({ title: `💘 你是「${n}」`, color: c, description: d, footer: ctx.user.name })], components: [] }; },
});

/* ---------- 靈魂動物 ---------- */
const animalFlow = makeQuizFlow({ feature: 'animal', title: '🐾 靈魂動物測驗', questions: ANIMAL_Q, color: COLORS.orange, result: s => Object.entries(s).sort((a, b) => b[1] - a[1])[0][0] });
const animal = quizFeature({
  name: 'animal', description: '靈魂動物測驗（8 題）：找出最像你的動物', flow: animalFlow,
  onDone: (ctx, res) => { const [n, e, d] = ANIMALS[res]; return { embeds: [embed({ title: `${e} 你的靈魂動物是「${n}」`, color: COLORS.orange, description: d, footer: ctx.user.name })], components: [] }; },
});

/* ---------- 色彩心理 ---------- */
const color = {
  name: 'color', description: '色彩心理測驗：憑直覺選一個顏色，看看現在的你', category: 'personality',
  async run(ctx) {
    await ctx.reply({ embeds: [embed({ title: '🎨 色彩心理', color: COLORS.brand, description: '不要想太多，選一個此刻最吸引你的顏色。' })], components: [select({ id: cid('color', 'pick', ctx.user.id), placeholder: '選一個顏色', options: Object.keys(COLORS_PSY).map(k => ({ label: k, value: k })) })] });
  },
  selects: {
    async pick(ctx) {
      if (!ctx.isOwner(ctx.data[0])) return ctx.reply({ content: '想測請自己用 /color。', ephemeral: true });
      const k = ctx.values[0]; const [trait, msg, c] = COLORS_PSY[k];
      await ctx.update({ embeds: [embed({ title: `🎨 你選了「${k}」`, color: c, description: `**關鍵字**：${trait}\n\n${msg}`, footer: ctx.user.name })], components: [] });
    },
  },
};

/* ---------- 左右腦 ---------- */
const brain = {
  name: 'brain', description: '左右腦測驗（10 題）：你是邏輯派還是直覺派？', category: 'personality',
  async run(ctx) {
    const sid = ctx.bot.sessions.create('brain', { owner: ctx.user.id, i: 0, L: 0, R: 0 }, 20 * 60e3);
    await ctx.reply(brainQ(sid, 0));
  },
  buttons: {
    async a(ctx) {
      const [sid, iS, yes] = ctx.data;
      const s = ctx.bot.sessions.get('brain', sid);
      if (!s) return ctx.update({ content: '測驗已過期。', embeds: [], components: [] });
      if (!ctx.isOwner(s.owner)) return ctx.reply({ content: '這是別人的測驗。', ephemeral: true });
      if (+iS !== s.i) return ctx.update(brainQ(sid, s.i));
      if (yes === '1') s[BRAIN_Q[s.i][1]]++;
      s.i++;
      if (s.i < BRAIN_Q.length) return ctx.update(brainQ(sid, s.i));
      ctx.bot.sessions.del('brain', sid);
      const total = s.L + s.R || 1, lp = Math.round((s.L / total) * 100);
      const verdict = lp >= 65 ? '左腦型：邏輯、分析、按部就班是你的強項。' : lp <= 35 ? '右腦型：直覺、創意、整體感是你的強項。' : '雙腦平衡：你能在邏輯與直覺間自由切換。';
      await ctx.update({ embeds: [embed({ title: '🧠 左右腦測驗結果', color: COLORS.purple, description: `左腦 ${bar(lp, 100, 16)} 右腦\n左 ${lp}%　右 ${100 - lp}%\n\n${verdict}`, footer: ctx.user.name })], components: [] });
    },
  },
};
function brainQ(sid, i) {
  return { embeds: [embed({ title: `🧠 左右腦測驗（${i + 1}/${BRAIN_Q.length}）`, color: COLORS.purple, description: `**${BRAIN_Q[i][0]}**` })], components: [row(button({ id: cid('brain', 'a', sid, i, 1), label: '符合', style: Style.success }), button({ id: cid('brain', 'a', sid, i, 0), label: '不符合', style: Style.danger }))] };
}

/* ---------- 九型人格 ---------- */
const enneagram = {
  name: 'enneagram', description: '九型人格測驗（18 題）', category: 'personality',
  async run(ctx) {
    const sid = ctx.bot.sessions.create('enneagram', { owner: ctx.user.id, i: 0, s: {} }, 20 * 60e3);
    await ctx.reply(enneaQ(sid, 0));
  },
  buttons: {
    async a(ctx) {
      const [sid, iS, vS] = ctx.data;
      const s = ctx.bot.sessions.get('enneagram', sid);
      if (!s) return ctx.update({ content: '測驗已過期。', embeds: [], components: [] });
      if (!ctx.isOwner(s.owner)) return ctx.reply({ content: '這是別人的測驗。', ephemeral: true });
      if (+iS !== s.i) return ctx.update(enneaQ(sid, s.i));
      const t = ENNEA_Q[s.i][1]; s.s[t] = (s.s[t] || 0) + (+vS);
      s.i++;
      if (s.i < ENNEA_Q.length) return ctx.update(enneaQ(sid, s.i));
      ctx.bot.sessions.del('enneagram', sid);
      const sorted = Object.entries(s.s).sort((a, b) => b[1] - a[1]);
      const main = +sorted[0][0], wing = sorted[1] ? +sorted[1][0] : null;
      const u = ctx.u(); u.enneagram = main;
      const [name, desc] = ENNEA_TYPES[main];
      await ctx.update({ embeds: [embed({ title: `🔯 你是第 ${main} 型・${name}${wing ? `（側翼 ${wing}）` : ''}`, color: COLORS.mystic, description: desc, fields: [{ name: '各型分數', value: Object.keys(ENNEA_TYPES).map(k => `${k}型 ${bar(s.s[k] || 0, 6, 6)}`).join('\n') }], footer: ctx.user.name })], components: [] });
    },
  },
};
function enneaQ(sid, i) {
  return { embeds: [embed({ title: `🔯 九型人格（${i + 1}/${ENNEA_Q.length}）`, color: COLORS.mystic, description: `**${ENNEA_Q[i][0]}**` })], components: [row(button({ id: cid('enneagram', 'a', sid, i, 0), label: '不像我', style: Style.secondary }), button({ id: cid('enneagram', 'a', sid, i, 1), label: '有一點', style: Style.primary }), button({ id: cid('enneagram', 'a', sid, i, 3), label: '很像我', style: Style.success }))] };
}

/* ---------- 心理測驗（情境題） ---------- */
const psytest = {
  name: 'psytest', description: '心理測驗：一題定生死的情境小測驗，每次隨機一題', category: 'personality',
  async run(ctx) {
    const i = ctx.rng.int(0, PSY_TESTS.length - 1);
    await ctx.reply(psyMsg(i, ctx.user.id));
  },
  buttons: {
    async a(ctx) {
      const [iS, kS, owner] = ctx.data;
      if (!ctx.isOwner(owner)) return ctx.reply({ content: '想測請自己用 /psytest。', ephemeral: true });
      const t = PSY_TESTS[+iS];
      await ctx.update({ embeds: [embed({ title: `🪞 ${t.t}`, color: COLORS.pink, description: `你選了「${t.a[+kS]}」\n\n${t.r[+kS]}`, footer: ctx.user.name })], components: [row(button({ id: cid('psytest', 'next', owner), label: '再測一題', style: Style.primary }))] });
    },
    async next(ctx) {
      if (!ctx.isOwner(ctx.data[0])) return ctx.reply({ content: '想測請自己用 /psytest。', ephemeral: true });
      await ctx.update(psyMsg(ctx.rng.int(0, PSY_TESTS.length - 1), ctx.user.id));
    },
  },
};
function psyMsg(i, owner) {
  const t = PSY_TESTS[i];
  return { embeds: [embed({ title: `🪞 心理測驗：${t.t}`, color: COLORS.pink, description: `**${t.q}**\n\n${t.a.map((a, k) => `${'ABCD'[k]}. ${a}`).join('\n')}` })], components: [row(...t.a.map((_, k) => button({ id: cid('psytest', 'a', i, k, owner), label: 'ABCD'[k], style: Style.primary })))] };
}

/* ---------- 壓力指數 ---------- */
const stress = {
  name: 'stress', description: '壓力指數測驗（10 題），看看最近的你有多緊繃', category: 'personality',
  async run(ctx) {
    const sid = ctx.bot.sessions.create('stress', { owner: ctx.user.id, i: 0, sum: 0 }, 20 * 60e3);
    await ctx.reply(stressQ(sid, 0));
  },
  buttons: {
    async a(ctx) {
      const [sid, iS, vS] = ctx.data;
      const s = ctx.bot.sessions.get('stress', sid);
      if (!s) return ctx.update({ content: '測驗已過期。', embeds: [], components: [] });
      if (!ctx.isOwner(s.owner)) return ctx.reply({ content: '這是別人的測驗。', ephemeral: true });
      if (+iS !== s.i) return ctx.update(stressQ(sid, s.i));
      s.sum += +vS; s.i++;
      if (s.i < STRESS_Q.length) return ctx.update(stressQ(sid, s.i));
      ctx.bot.sessions.del('stress', sid);
      const pct = Math.round((s.sum / 30) * 100);
      const level = pct < 25 ? ['低', '狀態不錯，保持現在的節奏。', COLORS.green] : pct < 50 ? ['中', '有些累積的壓力，安排一件讓自己放鬆的事。', COLORS.gold] : pct < 75 ? ['偏高', '身心已經在抗議了，請認真休息，找人聊聊。', COLORS.orange] : ['很高', '你撐得很辛苦。請優先照顧自己，必要時尋求專業協助（台灣可撥 1925 安心專線）。', COLORS.red];
      await ctx.update({ embeds: [embed({ title: `🌡️ 壓力指數 ${pct}%（${level[0]}）`, color: level[2], description: `${bar(pct, 100, 20)}\n\n${level[1]}`, footer: '這不是醫療診斷，只是一個提醒' })], components: [] });
    },
  },
};
function stressQ(sid, i) {
  return { embeds: [embed({ title: `🌡️ 壓力指數（${i + 1}/${STRESS_Q.length}）`, color: COLORS.orange, description: `**${STRESS_Q[i]}**` })], components: [row(...STRESS_SCALE.map((l, k) => button({ id: cid('stress', 'a', sid, i, k), label: l, style: k >= 2 ? Style.danger : Style.secondary })))] };
}

/* ---------- 血型 ---------- */
const bloodtype = {
  name: 'bloodtype', description: '血型性格與血型配對', category: 'personality',
  options: [str('type', '你的血型', { required: true, choices: ['A', 'B', 'O', 'AB'] }), str('with', '想配對的血型', { choices: ['A', 'B', 'O', 'AB'] })],
  async run(ctx) {
    const t = ctx.opt('type') || 'A', w = ctx.opt('with');
    const u = ctx.u(); u.bloodType = t;
    const [good, bad, match] = BLOOD[t];
    const fields = [{ name: '優點', value: good, inline: true }, { name: '注意', value: bad, inline: true }];
    if (w) { const line = match.split('；').find(x => x.startsWith(`${t} 與 ${w}`)) || ''; fields.push({ name: `${t} × ${w}`, value: `${line.split('：')[1] || '各有各的好'}　契合度 ${50 + scoreOf('blood', t, w) % 50}%` }); }
    else fields.push({ name: '配對', value: match.replace(/；/g, '\n') });
    await ctx.reply({ embeds: [embed({ title: `🩸 ${t} 型的你`, color: COLORS.red, fields })] });
  },
};

export default [mbti, bigfive, lovestyle, animal, color, brain, enneagram, psytest, stress, bloodtype];
