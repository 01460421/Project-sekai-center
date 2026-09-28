/* 功能模組共用的小工具：發錢、任務進度、成就檢查、等級換算、按鈕擁有者檢查 */

import { ACHIEVEMENTS, QUESTS } from '../content/words.js';
import { todayTW, weekTW } from './ui.js';

export const levelFor = xp => Math.floor(Math.sqrt(Math.max(0, xp) / 50)) + 1;
export const xpForLevel = l => 50 * (l - 1) * (l - 1);

/* 給水晶（可負），回傳新餘額 */
export function award(ctx, amount, uid = ctx.user.id) {
  const u = ctx.u(uid);
  u.crystals = Math.max(0, Math.floor(u.crystals + amount));
  ctx.store.touch();
  return u.crystals;
}

/* 每日任務進度：questId 見 content/words.js QUESTS */
export function quest(ctx, questId, uid = ctx.user.id) {
  const u = ctx.u(uid);
  const today = todayTW();
  if (u.quests.date !== today) u.quests = { date: today, done: {}, claimed: false };
  if (questId === 'chat') u.quests.done.chat = (u.quests.done.chat || 0) + 1;
  else u.quests.done[questId] = true;
  ctx.store.touch();
}
export const questDone = (u, q) => q.id === 'chat' ? (u.quests.done.chat || 0) >= 20 : !!u.quests.done[q.id];
export { QUESTS };

/* 遊戲結束記一筆；回傳新解鎖的成就 */
export function gameResult(ctx, won, uid = ctx.user.id) {
  const u = ctx.u(uid);
  u.games.played++;
  if (won) u.games.won++;
  const wk = weekTW();
  if (u.weekly.week !== wk) u.weekly = { week: wk, msgs: 0, games: 0 };
  u.weekly.games++;
  quest(ctx, 'game', uid);
  return checkAchievements(ctx, uid);
}

/* 檢查並解鎖成就，回傳新解鎖清單 */
export function checkAchievements(ctx, uid = ctx.user.id) {
  const u = ctx.u(uid);
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (u.achievements.includes(a.id)) continue;
    let ok = false;
    try { ok = a.check(u); } catch {}
    if (ok) { u.achievements.push(a.id); fresh.push(a); }
  }
  if (fresh.length) ctx.store.touch();
  return fresh;
}
export const achievementLine = list => list.length ? `\n🏅 解鎖成就：${list.map(a => `${a.emoji} ${a.name}`).join('、')}` : '';

/* 按鈕擁有者檢查：不是本人就回一句悄悄話並回 false */
export async function ownerOnly(ctx, ownerId, text = '這不是你的按鈕喔。') {
  if (ctx.isOwner(ownerId)) return true;
  await ctx.reply({ content: text, ephemeral: true });
  return false;
}

/* 過期的 session 統一回覆 */
export async function expired(ctx, what = '這局遊戲') {
  await ctx.update({ content: `${what}已經過期了，請重新開始。`, embeds: [], components: [] });
  return null;
}

export const displayName = ctx => ctx.user.name || ctx.user.id;
export const has = (u, item) => (u.items[item] || 0) > 0;
export function consume(u, item) { if (!has(u, item)) return false; u.items[item]--; if (u.items[item] <= 0) delete u.items[item]; return true; }
