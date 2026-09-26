/* 轉蛋收藏（8）：轉蛋、圖鑑、天井、統計、歐洲人排行、交換、願望單、卡池情報
   卡片資料來自 repo 根目錄 data/cards-index.js（與網站同一份）。 */

import { str, int, sub, user as userOpt } from '../core/opts.js';
import { embed, button, row, select, cid, COLORS, Style, mention, num, pct, clean, ts } from '../core/ui.js';
import { award, quest, checkAchievements, achievementLine, consume } from '../core/helpers.js';
import { CHARAS, charaById, findChara, GACHA_POOL, cardById, cardThumb, rarityStr, ATTR_EMOJI, gachasAround } from '../core/sekai.js';

export const RATES = { 4: 0.03, 3: 0.085 };   // 其餘 2★；十連保底至少一張 3★
export function pullOne(rng, lucky = false) {
  const r4 = lucky ? RATES[4] * 2 : RATES[4];
  const x = rng.next();
  const rarity = x < r4 ? 4 : x < r4 + RATES[3] ? 3 : 2;
  return rng.pick(GACHA_POOL[rarity]);
}
export function pullMany(rng, n, lucky = false) {
  const out = []; for (let i = 0; i < n; i++) out.push(pullOne(rng, lucky && i === 0));
  if (n >= 10 && !out.some(c => c.rarity >= 3)) out[n - 1] = rng.pick(GACHA_POOL[3]);
  return out;
}
function record(ctx, cards) {
  const u = ctx.u(); let got4 = 0, wishHit = false;
  for (const c of cards) {
    u.cards[c.id] = (u.cards[c.id] || 0) + 1; u.pulls++;
    if (c.rarity === 4) { u.pulls4++; got4++; u.sinceLast4 = 0; if (u.wish && c.chara === u.wish) wishHit = true; } else u.sinceLast4++;
  }
  ctx.store.touch();
  return { got4, wishHit };
}
const cardLine = c => `${rarityStr(c.rarity)} ${ATTR_EMOJI[c.attr]} ${charaById(c.chara).name}「${c.name}」`;

/* ---------- 轉蛋 ---------- */
const gacha = {
  name: 'gacha', description: '模擬轉蛋：單抽、十連、百連（4★ 3%、3★ 8.5%，十連保底 3★）', category: 'gacha',
  options: [str('mode', '抽幾次', { choices: [['單抽', '1'], ['十連', '10'], ['百連', '100']] })],
  async run(ctx) { await ctx.reply(doGacha(ctx, +(ctx.opt('mode') || '10'))); },
  buttons: { async again(ctx) { const [owner, n] = ctx.data; if (!ctx.isOwner(owner)) return ctx.reply({ content: '想抽請自己用 /gacha。', ephemeral: true }); await ctx.update(doGacha(ctx, +n)); } },
};
function doGacha(ctx, n) {
  const u = ctx.u();
  const lucky = consume(u, 'lucky_charm');
  const cards = pullMany(ctx.rng, n, lucky);
  const { got4, wishHit } = record(ctx, cards);
  quest(ctx, 'gacha');
  const fresh = checkAchievements(ctx);
  const best = cards.reduce((a, c) => c.rarity > a.rarity ? c : a, cards[0]);
  let desc;
  if (n <= 10) desc = cards.map(cardLine).join('\n');
  else { const cnt = { 2: 0, 3: 0, 4: 0 }; for (const c of cards) cnt[c.rarity]++; desc = `★★★★ ${cnt[4]} 張　★★★ ${cnt[3]} 張　★★ ${cnt[2]} 張\n\n${cards.filter(c => c.rarity === 4).map(cardLine).join('\n') || '（沒有 4★……）'}`; }
  return {
    embeds: [embed({ title: `🎰 ${n === 1 ? '單抽' : n === 10 ? '十連' : '百連'}${lucky ? '（幸運符生效）' : ''}`, color: got4 ? COLORS.gold : best.rarity === 3 ? COLORS.pink : COLORS.grey, description: desc + (got4 ? `\n\n🌈 恭喜抽到 ${got4} 張 4★！` : '') + (wishHit ? '\n💖 願望單的角色來了！' : '') + achievementLine(fresh), thumbnail: cardThumb(best), footer: `累計 ${num(u.pulls)} 抽・距上次 4★ ${u.sinceLast4} 抽` })],
    components: [row(button({ id: cid('gacha', 'again', ctx.user.id, n), label: '再抽', style: Style.primary, emoji: '🎰' }))],
  };
}

/* ---------- 圖鑑 ---------- */
const collection = {
  name: 'collection', description: '我的圖鑑：擁有的卡片統計，可依角色查看', category: 'gacha',
  options: [str('chara', '角色名（可留空看總覽）', { maxLen: 10 }), userOpt('user', '看誰的')],
  async run(ctx) {
    const t = ctx.opt('user') || ctx.user; const u = ctx.u(t.id);
    const owned = Object.keys(u.cards).map(id => cardById(+id)).filter(Boolean);
    const ch = ctx.opt('chara') ? findChara(ctx.opt('chara')) : null;
    if (ctx.opt('chara') && !ch) return ctx.reply({ content: '找不到這個角色。', ephemeral: true });
    if (ch) {
      const list = owned.filter(c => c.chara === ch.id).sort((a, b) => b.rarity - a.rarity);
      const total = [2, 3, 4].reduce((s, r) => s + GACHA_POOL[r].filter(c => c.chara === ch.id).length, 0);
      return ctx.reply({ embeds: [embed({ title: `${ch.name} 的卡片 ${list.length}/${total}`, color: ch.color, thumbnail: ch.sd, description: list.slice(0, 30).map(c => `${cardLine(c)} ×${u.cards[c.id]}`).join('\n') || '還沒有這個角色的卡。' })] });
    }
    const byR = { 2: 0, 3: 0, 4: 0 }; for (const c of owned) byR[c.rarity]++;
    const byChara = CHARAS.map(c => ({ c, n: owned.filter(x => x.chara === c.id).length })).sort((a, b) => b.n - a.n).slice(0, 5);
    await ctx.reply({ embeds: [embed({ title: `🗂️ ${clean(t.name)} 的圖鑑`, color: COLORS.brand, description: `不同卡片 **${owned.length}** 種（總卡池 ${GACHA_POOL[2].length + GACHA_POOL[3].length + GACHA_POOL[4].length}）\n★★★★ ${byR[4]}　★★★ ${byR[3]}　★★ ${byR[2]}`, fields: [{ name: '最多的角色', value: byChara.map(x => `${x.c.name} ${x.n} 張`).join('\n') || '—' }], footer: '用 /collection chara:角色名 看單一角色' })] });
  },
};

/* ---------- 天井 ---------- */
const pity = {
  name: 'pity', description: '天井進度：距離上次 4★ 幾抽、離 300 抽交換還有多遠', category: 'gacha',
  async run(ctx) {
    const u = ctx.u(); const toSpark = 300 - (u.pulls % 300);
    await ctx.reply({ embeds: [embed({ title: '🌈 天井進度', color: COLORS.purple, description: `距上次 4★：**${u.sinceLast4}** 抽\n本輪 300 抽交換還差：**${toSpark}** 抽（${'█'.repeat(Math.floor((300 - toSpark) / 30))}${'░'.repeat(10 - Math.floor((300 - toSpark) / 30))}）\n累計 ${num(u.pulls)} 抽・${u.pulls4} 張 4★`, footer: '這只是模擬，真的抽卡請量力而為' })] });
  },
};

/* ---------- 統計 ---------- */
const gachastats = {
  name: 'gachastats', description: '抽卡統計：4★ 率、期望值比較、最愛角色', category: 'gacha',
  options: [userOpt('user', '看誰的')],
  async run(ctx) {
    const t = ctx.opt('user') || ctx.user; const u = ctx.u(t.id);
    if (!u.pulls) return ctx.reply({ content: `${clean(t.name)} 還沒抽過，用 /gacha 開始。` });
    const rate = u.pulls4 / u.pulls;
    const luck = rate >= 0.05 ? '🇪🇺 歐洲人' : rate >= 0.03 ? '😐 平均' : rate >= 0.015 ? '🌑 有點非' : '🇦🇫 非洲酋長';
    const owned = Object.entries(u.cards).map(([id, n]) => ({ c: cardById(+id), n })).filter(x => x.c);
    const fav = CHARAS.map(c => ({ c, n: owned.filter(x => x.c.chara === c.id).reduce((s, x) => s + x.n, 0) })).sort((a, b) => b.n - a.n)[0];
    await ctx.reply({ embeds: [embed({ title: `📈 ${clean(t.name)} 的抽卡統計`, color: COLORS.gold, fields: [
      { name: '總抽數', value: num(u.pulls), inline: true }, { name: '4★', value: `${u.pulls4} 張（${pct(u.pulls4, u.pulls)}）`, inline: true }, { name: '運氣', value: luck, inline: true },
      { name: '理論期望', value: `${(u.pulls * RATES[4]).toFixed(1)} 張 4★`, inline: true }, { name: '相對期望', value: `${u.pulls4 - u.pulls * RATES[4] >= 0 ? '+' : ''}${(u.pulls4 - u.pulls * RATES[4]).toFixed(1)} 張`, inline: true }, { name: '換算', value: `約 ${num(u.pulls * 300)} 水晶`, inline: true },
      { name: '最常抽到', value: fav && fav.n ? `${fav.c.name}（${fav.n} 張）` : '—', inline: true },
    ] })] });
  },
};

/* ---------- 歐洲人排行 ---------- */
const luckrank = {
  name: 'luckrank', description: '歐洲人排行：本伺服器 4★ 率最高的人（至少 50 抽）', category: 'gacha',
  async run(ctx) {
    const rows = ctx.store.users(ctx.guildId).filter(x => x.rec.pulls >= 50).map(x => ({ uid: x.uid, r: x.rec.pulls4 / x.rec.pulls, n: x.rec.pulls, k: x.rec.pulls4 })).sort((a, b) => b.r - a.r);
    await ctx.reply({ embeds: [embed({ title: '🇪🇺 歐洲人排行', color: COLORS.gold, description: rows.length ? rows.slice(0, 10).map((r, i) => `${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} ${mention(r.uid)}　${(r.r * 100).toFixed(2)}%（${r.k}/${num(r.n)}）`).join('\n') + (rows.length > 3 ? `\n\n🇦🇫 最非：${mention(rows[rows.length - 1].uid)}（${(rows[rows.length - 1].r * 100).toFixed(2)}%）` : '') : '還沒有人抽滿 50 抽。' })] });
  },
};

/* ---------- 交換 ---------- */
const trade = {
  name: 'trade', description: '把你的重複卡送給別人（對方要按接受）', category: 'gacha',
  options: [userOpt('user', '對象', { required: true }), int('card', '卡片 id（見 /collection）', { required: true, min: 1 })],
  async run(ctx) {
    const t = ctx.opt('user'); const id = ctx.opt('card'); const u = ctx.u(); const c = cardById(id);
    if (!t || t.id === ctx.user.id) return ctx.reply({ content: '請選一個別人。', ephemeral: true });
    if (!c || !u.cards[id]) return ctx.reply({ content: '你沒有這張卡。', ephemeral: true });
    await ctx.reply({ content: `🔁 ${mention(ctx.user.id)} 想把 ${cardLine(c)} 送給 ${mention(t.id)}。`, components: [row(button({ id: cid('trade', 'ok', ctx.user.id, t.id, id), label: '接受', style: Style.success }), button({ id: cid('trade', 'no', ctx.user.id, t.id, id), label: '拒絕', style: Style.danger }))] });
  },
  buttons: {
    async ok(ctx) {
      const [from, to, idS] = ctx.data; if (!ctx.isOwner(to)) return ctx.reply({ content: '這不是給你的。', ephemeral: true });
      const a = ctx.u(from), b = ctx.u(to); const id = +idS;
      if (!a.cards[id]) return ctx.update({ content: '對方已經沒有這張卡了。', components: [] });
      a.cards[id]--; if (!a.cards[id]) delete a.cards[id]; b.cards[id] = (b.cards[id] || 0) + 1; ctx.store.touch();
      const fresh = checkAchievements(ctx, to);
      await ctx.update({ content: `✅ ${mention(to)} 收下了 ${mention(from)} 的 ${cardLine(cardById(id))}。${achievementLine(fresh)}`, components: [] });
    },
    async no(ctx) { const [from, to] = ctx.data; if (!ctx.isOwner(to)) return ctx.reply({ content: '這不是給你的。', ephemeral: true }); await ctx.update({ content: `${mention(to)} 婉拒了 ${mention(from)} 的卡片。`, components: [] }); },
  },
};

/* ---------- 願望單 ---------- */
const wishlist = {
  name: 'wishlist', description: '願望單與推し：設定最想抽到的角色，抽到 4★ 時會特別提示', category: 'gacha',
  options: [str('chara', '角色名（支援自動完成；輸入「清除」取消）', { autocomplete: true, maxLen: 10 }), str('oshi', '同時設為個人檔案的推し', { choices: [['是', '1'], ['否', '0']] })],
  async autocomplete(ctx, focused) {
    const t = String(focused || '').toLowerCase();
    return [{ name: '（清除願望單）', value: '清除' }, ...CHARAS.filter(c => !t || c.name.toLowerCase().includes(t) || c.short.toLowerCase().includes(t)).map(c => ({ name: `${c.name}（${c.unit.key}）`, value: c.name }))].slice(0, 25);
  },
  async run(ctx) {
    const u = ctx.u(); const q = (ctx.opt('chara') || '').trim();
    if (!q) return ctx.reply({ content: `目前願望：${u.wish ? charaById(u.wish).name : '未設定'}；推し：${u.oshi ? charaById(u.oshi).name : '未設定'}\n用 /wishlist chara:角色名 設定。`, ephemeral: true });
    if (q === '清除') { u.wish = null; return ctx.reply({ content: '已清除願望單。', ephemeral: true }); }
    const c = findChara(q); if (!c) return ctx.reply({ content: '找不到這個角色。', ephemeral: true });
    u.wish = c.id; if (ctx.opt('oshi') !== '0' && (ctx.opt('oshi') === '1' || !u.oshi)) u.oshi = c.id;
    await ctx.reply({ embeds: [embed({ title: `💖 願望單：${c.name}`, color: c.color, thumbnail: c.sd, description: `抽到 ${c.name} 的 4★ 時會特別提示。${u.oshi === c.id ? '也設為你的推し了。' : ''}` })], ephemeral: true });
  },
};

/* ---------- 卡池情報 ---------- */
const gachalist = {
  name: 'gachalist', description: '台服卡池情報：進行中與兩週內的卡池', category: 'gacha',
  async run(ctx) {
    const now = Date.now(); const list = gachasAround(now, 14).slice(0, 12);
    await ctx.reply({ embeds: [embed({ title: '🎫 卡池情報（台服）', color: COLORS.pink, description: list.length ? list.map(g => `${g.start <= now && g.end >= now ? '🟢' : g.start > now ? '🕒' : '⚪'} **${g.n}**（${g.t}）\n${ts(g.start, 'd')} → ${ts(g.end, 'd')}${g.ch ? `・${g.ch}` : ''}${g.note ? `\n-# ${g.note}` : ''}`).join('\n') : '資料範圍內沒有卡池。', footer: '資料來源：SEKAI 資源中心 data/sekai-data.js' })] });
  },
};

export default [gacha, collection, pity, gachastats, luckrank, trade, wishlist, gachalist];
