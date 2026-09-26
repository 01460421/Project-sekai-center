/* 占卜算命（12）：塔羅、星座、生肖、易經、御神籤、生命靈數、盧恩、今日宜忌、解夢、生日全解析、幸運餅乾、占星骰 */

import { str, int } from '../core/opts.js';
import { embed, button, row, select, cid, COLORS, Style, stars, todayTW } from '../core/ui.js';
import { dailyRng, fill, SIGNS, findSign, signOf, ZODIAC, ZODIAC_EMOJI, zodiacOf, currentZodiac, digitSum, reduceNum, parseBirthday, validMD } from '../core/oracle.js';
import { Rng } from '../core/rng.js';
import { quest } from '../core/helpers.js';
import { TAROT, SPREADS } from '../content/tarot.js';
import { HEXAGRAMS, hexByLines, drawLines, TRIGRAM_NAME } from '../content/iching.js';
import { RUNES } from '../content/runes.js';
import { HORO_POOLS, ZODIAC_TRAITS, ZODIAC_COMPAT, ZODIAC_CLASH, SIGN_TRAITS, SIGN_MATCH, OMIKUJI, OMIKUJI_LINES, ALMANAC, COOKIES, LIFE_PATH, BIRTH_FLOWER, BIRTH_STONE, FLOWER_WORD, ASTRO_PLANETS, ASTRO_HOUSES, DREAMS, DREAM_GENERIC } from '../content/fortune.js';

const signChoices = SIGNS.map(s => [`${s.emoji} ${s.name}`, s.key]);
const userBirthday = ctx => parseBirthday(ctx.u().birthday);

/* ---------- 塔羅 ---------- */
function drawTarot(rng, n) {
  return rng.sample(TAROT, n).map(c => ({ ...c, reversed: rng.chance(0.3) }));
}
function tarotEmbed(cards, spread, question, who, seedNote) {
  const sp = SPREADS[spread];
  return embed({
    title: `🔮 塔羅・${sp.name}${question ? `：${question}` : ''}`, color: COLORS.mystic,
    description: cards.map((c, i) => `**${sp.positions[i]}** — ${c.name}${c.reversed ? '（逆位）' : '（正位）'}\n${c.reversed ? c.rev : c.up}`).join('\n\n'),
    footer: `${who} 的牌 · ${seedNote}`,
  });
}
const tarot = {
  name: 'tarot', description: '塔羅占卜：單張、三張、二選一、戀愛、五張十字牌陣', category: 'divination',
  options: [str('spread', '牌陣', { choices: Object.entries(SPREADS).map(([k, v]) => [v.name, k]) }), str('question', '想問的事（可留空）', { maxLen: 80 })],
  async run(ctx) {
    const spread = SPREADS[ctx.opt('spread')] ? ctx.opt('spread') : 'one';
    const q = (ctx.opt('question') || '').trim();
    const rng = dailyRng(ctx.user.id, 'tarot', spread + q);
    const cards = drawTarot(rng, SPREADS[spread].positions.length);
    quest(ctx, 'fortune');
    const e = tarotEmbed(cards, spread, q, ctx.user.name, '同一天同一個問題會抽到同一組牌');
    const ai = await ctx.ai(`塔羅牌陣「${SPREADS[spread].name}」${q ? `，問題：${q}` : ''}。抽到：${cards.map((c, i) => `${SPREADS[spread].positions[i]}＝${c.name}${c.reversed ? '逆位' : '正位'}（${c.reversed ? c.rev : c.up}）`).join('；')}`);
    if (ai) e.fields = [{ name: '✨ 解讀', value: ai.slice(0, 1024) }];
    await ctx.reply({ embeds: [e], components: [row(button({ id: cid('tarot', 'redraw', spread, ctx.user.id), label: '再抽一次（不記入今日）', style: Style.secondary, emoji: '🃏' }))] });
  },
  buttons: {
    async redraw(ctx) {
      const [spread, owner] = ctx.data;
      if (!ctx.isOwner(owner)) return ctx.reply({ content: '想抽自己的牌請用 /tarot。', ephemeral: true });
      const cards = drawTarot(new Rng(), SPREADS[spread].positions.length);
      await ctx.update({ embeds: [tarotEmbed(cards, spread, '', ctx.user.name, '重抽・純隨機')], components: ctx.message ? ctx.message.components : [] });
    },
  },
};

/* ---------- 星座運勢 ---------- */
function horoscopeEmbed(sign, now = Date.now()) {
  const rng = new Rng(`horo|${sign.key}|${todayTW(now)}`);
  const cat = ['overall', 'love', 'career', 'wealth', 'health'];
  const names = { overall: '整體', love: '愛情', career: '事業', wealth: '財運', health: '健康' };
  const lines = cat.map(k => `${names[k]} ${stars(rng.int(2, 5))}　${rng.pick(HORO_POOLS[k])}`);
  return embed({
    title: `${sign.emoji} ${sign.name} 今日運勢 ${todayTW(now)}`, color: COLORS.purple,
    description: lines.join('\n'),
    fields: [
      { name: '幸運色', value: rng.pick(HORO_POOLS.color), inline: true }, { name: '幸運數字', value: String(rng.int(1, 99)), inline: true }, { name: '幸運方位', value: rng.pick(HORO_POOLS.direction), inline: true },
      { name: '幸運物', value: rng.pick(HORO_POOLS.item), inline: true }, { name: '速配星座', value: SIGN_MATCH[sign.key].map(k => SIGNS.find(s => s.key === k).name).join('、'), inline: true }, { name: '今日建議', value: rng.pick(HORO_POOLS.advice), inline: true },
    ],
    footer: `${sign.element}象・守護星 ${sign.ruler}・${SIGN_TRAITS[sign.key]}`,
  });
}
const horoscope = {
  name: 'horoscope', description: '星座今日運勢（愛情／事業／財運／健康，含幸運色與數字）', category: 'divination',
  options: [str('sign', '星座（沒填就用你登記的生日）', { choices: signChoices })],
  async run(ctx) {
    let sign = ctx.opt('sign') ? SIGNS.find(s => s.key === ctx.opt('sign')) : null;
    if (!sign) { const b = userBirthday(ctx); if (b) sign = signOf(b.m, b.d); }
    if (!sign) return ctx.reply({ content: '請選一個星座，或先用 /birthday 登記生日。', ephemeral: true });
    quest(ctx, 'fortune');
    await ctx.reply({ embeds: [horoscopeEmbed(sign)], components: [select({ id: cid('horoscope', 'pick'), placeholder: '看其他星座', options: SIGNS.map(s => ({ label: s.name, value: s.key, emoji: s.emoji })) })] });
  },
  selects: { async pick(ctx) { const sign = SIGNS.find(s => s.key === ctx.values[0]); await ctx.update({ embeds: [horoscopeEmbed(sign)], components: ctx.message ? ctx.message.components : [] }); } },
};

/* ---------- 生肖運勢 ---------- */
const zodiac = {
  name: 'zodiac', description: '生肖今日運勢與本命年、相合相沖', category: 'divination',
  options: [int('year', '出生年（西元）', { min: 1900, max: 2100 }), str('animal', '或直接選生肖', { choices: ZODIAC.map((z, i) => [`${ZODIAC_EMOJI[i]} ${z}`, String(i)]) })],
  async run(ctx) {
    let idx = ctx.opt('animal') != null ? +ctx.opt('animal') : null;
    if (idx == null && ctx.opt('year')) idx = zodiacOf(ctx.opt('year'));
    if (idx == null) { const b = userBirthday(ctx); if (b && b.y) idx = zodiacOf(b.y); }
    if (idx == null) return ctx.reply({ content: '請給出生年或選生肖，或先用 /birthday 登記含年份的生日。', ephemeral: true });
    const z = ZODIAC[idx];
    const rng = new Rng(`zodiac|${z}|${todayTW()}`);
    const nowZ = currentZodiac();
    quest(ctx, 'fortune');
    const e = embed({
      title: `${ZODIAC_EMOJI[idx]} 屬${z} 今日運勢 ${todayTW()}`, color: COLORS.orange,
      description: `整體 ${stars(rng.int(2, 5))}　${rng.pick(HORO_POOLS.overall)}\n財運 ${stars(rng.int(2, 5))}　${rng.pick(HORO_POOLS.wealth)}\n感情 ${stars(rng.int(2, 5))}　${rng.pick(HORO_POOLS.love)}`,
      fields: [
        { name: '性格', value: ZODIAC_TRAITS[z], inline: false },
        { name: '相合', value: ZODIAC_COMPAT[z].join('、'), inline: true }, { name: '相沖', value: ZODIAC_CLASH[z], inline: true },
        { name: '今年', value: nowZ === idx ? '⚠️ 本命年，多穿紅色、諸事謹慎' : `今年是${ZODIAC[nowZ]}年，${ZODIAC_COMPAT[z].includes(ZODIAC[nowZ]) ? '與你相合，順風順水' : ZODIAC_CLASH[z] === ZODIAC[nowZ] ? '與你相沖，凡事多留一手' : '平穩，按部就班'}`, inline: false },
        { name: '幸運色', value: rng.pick(HORO_POOLS.color), inline: true }, { name: '幸運數字', value: String(rng.int(1, 49)), inline: true }, { name: '建議', value: rng.pick(HORO_POOLS.advice), inline: true },
      ],
    });
    await ctx.reply({ embeds: [e] });
  },
};

/* ---------- 易經 ---------- */
function castIching(rng) {
  const values = [];
  for (let i = 0; i < 6; i++) values.push([0, 1, 2].reduce((s) => s + (rng.chance(0.5) ? 3 : 2), 0));   // 6 老陰 7 少陽 8 少陰 9 老陽
  const primary = values.map(v => (v % 2 ? '1' : '0')).join('');
  const changing = values.map((v, i) => (v === 6 || v === 9) ? i : -1).filter(i => i >= 0);
  const changed = values.map(v => v === 6 ? '1' : v === 9 ? '0' : (v % 2 ? '1' : '0')).join('');
  return { values, primary, changing, changed };
}
const iching = {
  name: 'iching', description: '易經卜卦：三枚銅錢起六爻，看本卦與變卦', category: 'divination',
  options: [str('question', '想問的事', { maxLen: 80 })],
  async run(ctx) {
    const q = (ctx.opt('question') || '').trim();
    const rng = dailyRng(ctx.user.id, 'iching', q);
    const cast = castIching(rng);
    const h = hexByLines(cast.primary), h2 = cast.changing.length ? hexByLines(cast.changed) : null;
    quest(ctx, 'fortune');
    const e = embed({
      title: `☯ 易經・第 ${h.num} 卦 ${h.name}${q ? `：${q}` : ''}`, color: COLORS.dark,
      description: `\`\`\`\n${drawLines(cast.primary, cast.changing)}\n\`\`\`${TRIGRAM_NAME[h.upper]}上${TRIGRAM_NAME[h.lower]}下\n\n**卦義**：${h.meaning}\n**建議**：${h.advice}`,
      fields: h2 ? [{ name: `變卦・第 ${h2.num} 卦 ${h2.name}（動爻：${cast.changing.map(i => ['初', '二', '三', '四', '五', '上'][i]).join('、')}）`, value: `${h2.meaning}\n→ ${h2.advice}` }] : [{ name: '無動爻', value: '事情的走向與本卦一致，照卦義行事即可。' }],
      footer: `${ctx.user.name} 起卦・同一天同一個問題卦象相同`,
    });
    const ai = await ctx.ai(`易經卜卦${q ? `，問題：${q}` : ''}。本卦 ${h.name}（${h.meaning}）${h2 ? `，變卦 ${h2.name}（${h2.meaning}）` : '，無動爻'}。`);
    if (ai) e.fields.push({ name: '✨ 解讀', value: ai.slice(0, 1024) });
    await ctx.reply({ embeds: [e] });
  },
};

/* ---------- 御神籤 ---------- */
const omikuji = {
  name: 'omikuji', description: '抽御神籤：大吉到大凶，附願望、戀愛、學業、工作等籤文', category: 'divination',
  async run(ctx) {
    const rng = dailyRng(ctx.user.id, 'omikuji');
    const g = rng.weighted(OMIKUJI.map(o => [o, o.w]));
    quest(ctx, 'fortune');
    const bad = g.grade.includes('凶');
    const fields = Object.entries(OMIKUJI_LINES).map(([k, v]) => ({ name: k, value: bad ? v[rng.int(3, 5)] : v[rng.int(0, 3)], inline: true }));
    const e = embed({ title: `⛩️ 御神籤・${g.grade}`, color: g.color, description: `「${g.poem}」`, fields, footer: `${ctx.user.name} 今日的籤・第 ${rng.int(1, 100)} 番` });
    await ctx.reply({ embeds: [e], components: [row(button({ id: cid('omikuji', 'tie', ctx.user.id), label: bad ? '把籤綁在樹上（化解）' : '把籤帶回家', style: Style.secondary, emoji: '🎋' }))] });
  },
  buttons: {
    async tie(ctx) {
      if (!ctx.isOwner(ctx.data[0])) return ctx.reply({ content: '這是別人的籤。', ephemeral: true });
      await ctx.update({ embeds: ctx.message ? ctx.message.embeds : [], components: [], content: '🎋 已處理好這支籤。明天再來抽一支吧。' });
    },
  },
};

/* ---------- 生命靈數 ---------- */
function lifePath(y, m, d) { return reduceNum(digitSum(`${y}${m}${d}`)); }
const numerology = {
  name: 'numerology', description: '生命靈數：由生日算出主命數、生日數、流年數', category: 'divination',
  options: [str('birthday', '生日 yyyy/mm/dd（沒填就用登記的）', { maxLen: 12 })],
  async run(ctx) {
    const b = parseBirthday(ctx.opt('birthday')) || userBirthday(ctx);
    if (!b || !b.y || !validMD(b.m, b.d)) return ctx.reply({ content: '請輸入含年份的生日，例如 2000/08/31。', ephemeral: true });
    const lp = lifePath(b.y, b.m, b.d), bd = reduceNum(b.d, false), year = new Date(Date.now() + 8 * 3600e3).getUTCFullYear();
    const py = reduceNum(digitSum(`${b.m}${b.d}${year}`), false);
    const [lpName, lpDesc] = LIFE_PATH[lp];
    quest(ctx, 'fortune');
    await ctx.reply({ embeds: [embed({
      title: `🔢 生命靈數 ${lp}・${lpName}`, color: COLORS.blue,
      description: lpDesc,
      fields: [
        { name: `生日數 ${bd}`, value: LIFE_PATH[bd] ? `${LIFE_PATH[bd][0]}的特質在日常中特別明顯` : '', inline: true },
        { name: `${year} 流年數 ${py}`, value: ['', '開創之年，適合起頭', '合作之年，關係是重點', '表達之年，展現自己', '耕耘之年，打基礎', '變動之年，擁抱改變', '責任之年，照顧家人與自己', '沉澱之年，向內探索', '收穫之年，把握機會', '完成之年，清理與放下'][py], inline: true },
      ],
      footer: `${b.y}/${b.m}/${b.d}・數字相加至個位（11、22、33 為大師數保留）`,
    })] });
  },
};

/* ---------- 盧恩 ---------- */
const runes = {
  name: 'runes', description: '盧恩符文占卜：抽一枚或三枚古弗薩克符文', category: 'divination',
  options: [int('count', '抽幾枚（1 或 3）', { min: 1, max: 3 }), str('question', '想問的事', { maxLen: 80 })],
  async run(ctx) {
    const n = ctx.opt('count') === 3 ? 3 : 1, q = (ctx.opt('question') || '').trim();
    const rng = dailyRng(ctx.user.id, 'runes', n + q);
    const picks = rng.sample(RUNES, n).map(r => ({ ...r, reversed: r.rev ? rng.chance(0.35) : false }));
    const pos = n === 3 ? ['過去／根源', '現在／挑戰', '未來／結果'] : ['指引'];
    quest(ctx, 'fortune');
    await ctx.reply({ embeds: [embed({
      title: `ᚱ 盧恩占卜${q ? `：${q}` : ''}`, color: COLORS.grey,
      description: picks.map((r, i) => `**${pos[i]}**　${r.sym} ${r.name}（${r.meaning}）${r.reversed ? ' 逆位' : ''}\n${r.reversed ? r.rev : r.up}`).join('\n\n'),
      footer: `${ctx.user.name}・同一天同一個問題結果相同`,
    })] });
  },
};

/* ---------- 今日宜忌 ---------- */
const almanac = {
  name: 'almanac', description: '今日宜忌：像老黃曆一樣，但是給現代人看的', category: 'divination',
  async run(ctx) {
    const day = new Rng(`almanac|${todayTW()}`), me = dailyRng(ctx.user.id, 'almanac');
    const good = day.sample(ALMANAC.good, 4), bad = day.sample(ALMANAC.bad, 4);
    quest(ctx, 'fortune');
    await ctx.reply({ embeds: [embed({
      title: `📜 ${todayTW()} 今日宜忌`, color: COLORS.gold,
      fields: [
        { name: '宜', value: good.map(x => `・${x}`).join('\n'), inline: true }, { name: '忌', value: bad.map(x => `・${x}`).join('\n'), inline: true },
        { name: `${ctx.user.name} 的專屬`, value: `幸運指數 ${stars(me.int(1, 5))}\n幸運色 ${me.pick(HORO_POOLS.color)}・幸運方位 ${me.pick(HORO_POOLS.direction)}\n開運小動作：${me.pick(ALMANAC.luckyAct)}`, inline: false },
      ],
    })] });
  },
};

/* ---------- 解夢 ---------- */
const dream = {
  name: 'dream', description: '解夢：輸入夢境關鍵字或描述，找出象徵意義', category: 'divination',
  options: [str('text', '夢到了什麼？', { required: true, maxLen: 200 })],
  async run(ctx) {
    const text = ctx.opt('text') || '';
    const hits = Object.keys(DREAMS).filter(k => text.includes(k)).slice(0, 5);
    const rng = dailyRng(ctx.user.id, 'dream', text);
    quest(ctx, 'fortune');
    const e = embed({
      title: '🌙 解夢', color: COLORS.mystic,
      description: `「${text.slice(0, 150)}」\n\n` + (hits.length ? hits.map(k => `**${k}**：${DREAMS[k]}`).join('\n') : rng.pick(DREAM_GENERIC)),
      footer: hits.length ? `對應到 ${hits.length} 個象徵` : '沒有對應到字典裡的關鍵字，試試「飛、水、考試、掉牙、被追…」',
    });
    const ai = await ctx.ai(`解夢。夢境描述：「${text}」。字典對應：${hits.map(k => `${k}＝${DREAMS[k]}`).join('；') || '無'}`);
    if (ai) e.fields = [{ name: '✨ 解讀', value: ai.slice(0, 1024) }];
    await ctx.reply({ embeds: [e] });
  },
};

/* ---------- 生日全解析 ---------- */
const birthchart = {
  name: 'birthchart', description: '生日全解析：星座、生肖、生命靈數、誕生花與誕生石一次看', category: 'divination',
  options: [str('birthday', '生日 yyyy/mm/dd 或 mm/dd', { maxLen: 12 })],
  async run(ctx) {
    const b = parseBirthday(ctx.opt('birthday')) || userBirthday(ctx);
    if (!b || !validMD(b.m, b.d)) return ctx.reply({ content: '請輸入生日，例如 2000/08/31 或 8/31；或先用 /birthday 登記。', ephemeral: true });
    const sign = signOf(b.m, b.d);
    const fields = [
      { name: `${sign.emoji} ${sign.name}`, value: SIGN_TRAITS[sign.key], inline: false },
      { name: '誕生花', value: `${BIRTH_FLOWER[b.m - 1]}（${FLOWER_WORD[b.m - 1]}）`, inline: true }, { name: '誕生石', value: BIRTH_STONE[b.m - 1], inline: true },
      { name: '生日數', value: `${reduceNum(b.d, false)}・${LIFE_PATH[reduceNum(b.d, false)][0]}`, inline: true },
    ];
    if (b.y) {
      const z = zodiacOf(b.y), lp = lifePath(b.y, b.m, b.d);
      fields.push({ name: `${ZODIAC_EMOJI[z]} 屬${ZODIAC[z]}`, value: ZODIAC_TRAITS[ZODIAC[z]], inline: false }, { name: `生命靈數 ${lp}`, value: LIFE_PATH[lp][0], inline: true });
    }
    quest(ctx, 'fortune');
    await ctx.reply({ embeds: [embed({ title: `🎂 ${b.y ? b.y + '/' : ''}${b.m}/${b.d} 生日全解析`, color: sign ? COLORS.pink : COLORS.brand, fields })] });
  },
};

/* ---------- 幸運餅乾 ---------- */
const fortunecookie = {
  name: 'fortunecookie', description: '掰開今天的幸運餅乾：一句籤語加六個幸運數字', category: 'divination',
  async run(ctx) {
    const rng = dailyRng(ctx.user.id, 'cookie');
    const nums = rng.sample(Array.from({ length: 49 }, (_, i) => i + 1), 6).sort((a, b) => a - b);
    quest(ctx, 'fortune');
    await ctx.reply({ embeds: [embed({ title: '🥠 幸運餅乾', color: COLORS.gold, description: `「${rng.pick(COOKIES)}」`, fields: [{ name: '幸運數字', value: nums.join('・') }], footer: `${ctx.user.name}・今天只有這一片` })] });
  },
};

/* ---------- 占星骰 ---------- */
const astrodice = {
  name: 'astrodice', description: '占星骰：擲出行星、星座、宮位三顆骰子，快速回答一個問題', category: 'divination',
  options: [str('question', '想問的事', { maxLen: 80 })],
  async run(ctx) {
    const q = (ctx.opt('question') || '').trim();
    const rng = dailyRng(ctx.user.id, 'astrodice', q);
    const p = rng.pick(ASTRO_PLANETS), s = rng.pick(SIGNS), h = rng.pick(ASTRO_HOUSES);
    quest(ctx, 'fortune');
    const desc = `🪐 **${p}**　${s.emoji} **${s.name}**　🏠 **${h}**\n\n` + fill(rng, '這件事的核心能量是{p}，它以{s}的方式展開（{t}），落在{h}的領域。{a}', {
      p: [p.split('（')[1].replace('）', '')], s: [s.name], t: [SIGN_TRAITS[s.key]], h: [h.split('：')[1]],
      a: ['答案偏向肯定，但要照自己的節奏走。', '現在還不是揭曉的時候，多觀察一週。', '答案在你已經知道的地方，只是還沒承認。', '會有轉折，做好兩手準備。', '把注意力放回自己身上，事情會自己動起來。'],
    });
    await ctx.reply({ embeds: [embed({ title: `🎲 占星骰${q ? `：${q}` : ''}`, color: COLORS.purple, description: desc, footer: ctx.user.name })] });
  },
};

export default [tarot, horoscope, zodiac, iching, omikuji, numerology, runes, almanac, dream, birthchart, fortunecookie, astrodice];
