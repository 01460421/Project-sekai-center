/* 占卜／測驗共用引擎。
   核心想法：結果由「使用者 + 台灣日期 + 主題（+ 問題）」決定，同一個人同一天問同一件事會得到同一個答案，
   像真的占卜一樣不會按一下就變；換一天、換問題就不同。 */

import { Rng, hashStr } from './rng.js';
import { todayTW } from './ui.js';

export function dailyRng(userId, topic, extra = '', now = Date.now()) {
  return new Rng(`${userId}|${todayTW(now)}|${topic}|${String(extra).trim().toLowerCase()}`);
}

/* 純粹由字串決定的 0..99 分數（配對、評分用） */
export function scoreOf(...parts) { return hashStr(parts.join('|')) % 101; }

/* 模板填空：'{a}的{b}' + pools {a:[...], b:[...]} */
export function fill(rng, tpl, pools) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (pools[k] ? rng.pick(pools[k]) : `{${k}}`));
}

/* ---------- 星座 ---------- */
export const SIGNS = [
  { key: 'aries', name: '牡羊座', emoji: '♈', from: [3, 21], to: [4, 19], element: '火', ruler: '火星' },
  { key: 'taurus', name: '金牛座', emoji: '♉', from: [4, 20], to: [5, 20], element: '土', ruler: '金星' },
  { key: 'gemini', name: '雙子座', emoji: '♊', from: [5, 21], to: [6, 21], element: '風', ruler: '水星' },
  { key: 'cancer', name: '巨蟹座', emoji: '♋', from: [6, 22], to: [7, 22], element: '水', ruler: '月亮' },
  { key: 'leo', name: '獅子座', emoji: '♌', from: [7, 23], to: [8, 22], element: '火', ruler: '太陽' },
  { key: 'virgo', name: '處女座', emoji: '♍', from: [8, 23], to: [9, 22], element: '土', ruler: '水星' },
  { key: 'libra', name: '天秤座', emoji: '♎', from: [9, 23], to: [10, 23], element: '風', ruler: '金星' },
  { key: 'scorpio', name: '天蠍座', emoji: '♏', from: [10, 24], to: [11, 22], element: '水', ruler: '冥王星' },
  { key: 'sagittarius', name: '射手座', emoji: '♐', from: [11, 23], to: [12, 21], element: '火', ruler: '木星' },
  { key: 'capricorn', name: '摩羯座', emoji: '♑', from: [12, 22], to: [1, 19], element: '土', ruler: '土星' },
  { key: 'aquarius', name: '水瓶座', emoji: '♒', from: [1, 20], to: [2, 18], element: '風', ruler: '天王星' },
  { key: 'pisces', name: '雙魚座', emoji: '♓', from: [2, 19], to: [3, 20], element: '水', ruler: '海王星' },
];

export function signOf(month, day) {
  for (const s of SIGNS) {
    const [fm, fd] = s.from, [tm, td] = s.to;
    if (fm <= tm) { if ((month === fm && day >= fd) || (month === tm && day <= td) || (month > fm && month < tm)) return s; }
    else if ((month === fm && day >= fd) || (month === tm && day <= td)) return s;   // 摩羯跨年
  }
  return null;
}

export function findSign(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  const m = /^(\d{1,2})[\/\-月.](\d{1,2})/.exec(t);
  if (m) return signOf(+m[1], +m[2]);
  return SIGNS.find(s => s.key === t || s.name === t || s.name.slice(0, 2) === t.slice(0, 2) || t.includes(s.name.slice(0, 2))) || null;
}

/* ---------- 生肖 ---------- */
export const ZODIAC = ['鼠', '牛', '虎', '兔', '龍', '蛇', '馬', '羊', '猴', '雞', '狗', '豬'];
export const ZODIAC_EMOJI = ['🐭', '🐮', '🐯', '🐰', '🐲', '🐍', '🐴', '🐑', '🐵', '🐔', '🐶', '🐷'];
export const zodiacOf = year => ((year - 4) % 12 + 12) % 12;
export const currentZodiac = (now = Date.now()) => zodiacOf(new Date(now + 8 * 3600e3).getUTCFullYear());

/* ---------- 生命靈數 ---------- */
export function digitSum(n) { let s = String(n).replace(/\D/g, '').split('').reduce((a, c) => a + +c, 0); return s; }
export function reduceNum(n, keepMaster = true) {
  let x = Number(n);
  while (x > 9) { if (keepMaster && (x === 11 || x === 22 || x === 33)) break; x = digitSum(x); }
  return x;
}

/* 解析生日字串 → { y, m, d }（y 可能為 0） */
export function parseBirthday(text) {
  const t = String(text || '').trim();
  let m = /^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/.exec(t);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = /^(\d{1,2})[\/\-.月](\d{1,2})/.exec(t);
  if (m) return { y: 0, m: +m[1], d: +m[2] };
  return null;
}
export const validMD = (m, d) => m >= 1 && m <= 12 && d >= 1 && d <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

/* ---------- 星等與吉凶文字 ---------- */
export const luckWord = n => ['大凶', '凶', '小凶', '平', '小吉', '吉', '大吉'][Math.max(0, Math.min(6, n))];
export const starsOf = (rng, min = 1, max = 5) => rng.int(min, max);

/* ---------- 問卷型測驗流程 ----------
   quiz = { key, title, questions:[{ q, a:[{t, s:{axis:val}}] }], result(scores) → {title, desc, color?} }
   進度用 custom_id 帶：feature:ans:sid:qIndex:choice。狀態放 sessions。 */
export function makeQuizFlow({ feature, title, questions, result, color, intro }) {
  const total = questions.length;
  return {
    total, title, questions, result, color, intro,
    start(ctx) {
      const sid = ctx.bot.sessions.create(feature, { owner: ctx.user.id, scores: {}, i: 0, answers: [] }, 20 * 60e3);
      return { sid, msg: this.render(ctx, sid, 0) };
    },
    render(ctx, sid, i) {
      const q = questions[i];
      return {
        embeds: [{ color: color || 0x6a4c93, title: `${title}（${i + 1}/${total}）`, description: `**${q.q}**\n\n` + q.a.map((a, k) => `${'🇦🇧🇨🇩🇪'.slice(k * 2, k * 2 + 2)} ${a.t}`).join('\n'), footer: { text: (intro || '') + '只有發起人能作答' } }],
        components: [{ type: 1, components: q.a.map((a, k) => ({ type: 2, style: 1, label: 'ABCDE'[k], custom_id: `${feature}:ans:${sid}:${i}:${k}` })) }],
      };
    },
    /* 回傳 { done:false, msg } 或 { done:true, msg, scores, res } */
    answer(ctx) {
      const [sid, iS, kS] = ctx.data;
      const s = ctx.bot.sessions.get(feature, sid);
      if (!s) return { expired: true, msg: { content: '這份測驗已經過期，請重新開始。', embeds: [], components: [] } };
      if (!ctx.isOwner(s.owner)) return { denied: true };
      const i = +iS, k = +kS;
      if (i !== s.i) return { stale: true, msg: this.render(ctx, sid, s.i) };
      const a = questions[i].a[k];
      for (const [axis, v] of Object.entries(a.s || {})) s.scores[axis] = (s.scores[axis] || 0) + v;
      s.answers.push(k);
      s.i++;
      if (s.i < total) return { done: false, msg: this.render(ctx, sid, s.i) };
      ctx.bot.sessions.del(feature, sid);
      const res = result(s.scores, s.answers, ctx);
      return { done: true, scores: s.scores, res };
    },
  };
}
