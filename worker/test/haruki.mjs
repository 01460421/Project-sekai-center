/* Haruki 串接的回歸測試：遊戲原始排名 → HiSekai 形狀、當期判定、WL 章節、/haruki/* 路由（假 fetch）。
   用法：node worker/test/haruki.mjs   任何一項失敗就 exit 1。 */
import { toTop100, toBorder, pickCurrent, parseSafe, eventMeta, handleHaruki, toEventList } from '../src/haruki.js';

let fail = 0;
const ok = (cond, name) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) fail++; };

const D = 86400000, now = Date.UTC(2026, 8, 26, 4);
const events = [
  { id: 179, name: 'Link the Beats!', eventType: 'marathon', startAt: now - 20 * D, aggregateAt: now - 12 * D, closedAt: now - 11 * D },
  { id: 180, name: 'Wishes in Bloom!', eventType: 'world_bloom', startAt: now - 1 * D, aggregateAt: now + 2 * D, closedAt: now + 3 * D, rankingAnnounceAt: now + 2 * D + 600000 },
  { id: 181, name: 'Our Golden Days', eventType: 'marathon', startAt: now + 4 * D, aggregateAt: now + 12 * D, closedAt: now + 13 * D },
];
const wbs = [{ eventId: 180, gameCharacterId: 21, chapterNo: 1, chapterStartAt: now - D, aggregateAt: now + D, chapterEndAt: now + D + 600000 }];

ok(pickCurrent(events, now).id === 180, '進行中的一期優先');
ok(pickCurrent(events, now + 3.5 * D).id === 180, '兩期之間的空窗退回最近已開始的一期');
ok(pickCurrent(events, now - 30 * D) === null, '還沒有任何一期開始時回 null');

const big = '{"rankings":[{"rank":1,"score":123456789,"userId":7482960281734567890,"name":"甲","userCard":{"cardId":1201,"level":60,"masterRank":5,"specialTrainingStatus":"done"},"userProfile":{"word":"hi"}}]}';
const raw = parseSafe(big);
ok(raw.rankings[0].userId === '7482960281734567890', '19 位 userId 不失精度');

const top = toTop100({ ...raw, userWorldBloomChapterRankings: [{ gameCharacterId: 21, rankings: raw.rankings }] }, events[1], wbs);
ok(top.id === 180 && top.name === 'Wishes in Bloom!' && top.source === 'haruki', '活動欄位攤在最上層並標來源');
ok(top.start_at === new Date(now - D).toISOString() && top.ranking_announce_at, '期程轉成 ISO 字串');
const r0 = top.player_top_100_rankings[0];
ok(r0.rank === 1 && r0.score === 123456789 && r0.name === '甲', '名次、分數、名字');
ok(r0.user_id === '7482960281734567890' && r0.last_player_info.profile.id === '7482960281734567890', 'uid 同時放 user_id 與 last_player_info.profile.id（追蹤器讀後者）');
ok(r0.last_player_info.card.id === 1201, '隊長卡 id');
ok(top.world_link_top_100_rankings.length === 1 && top.world_link_top_100_rankings[0].chapter === 1 && top.world_link_top_100_rankings[0].character === 21, 'WL 章節對上 worldBlooms 的章節號與角色');

const brd = toBorder({ borderRankings: [{ rank: 100, score: 9000000, userId: 1, name: 'x' }, { rank: 1000, score: 3000000, userId: 2, name: 'y' }],
  userWorldBloomChapterRankingBorders: [{ gameCharacterId: 21, borderRankings: [{ rank: 100, score: 5000, userId: 3 }] }, { gameCharacterId: 99, borderRankings: [] }] }, events[1], wbs);
ok(brd.player_border_rankings.map(x => x.rank).join() === '100,1000', '榜線列');
ok(brd.world_link_border_rankings.length === 1, '對不上章節的角色被略過');
ok(brd.world_link_border_rankings[0].player_borders.length === 1 && brd.world_link_border_rankings[0].player_border_rankings.length === 1, 'WL 榜線同時給 player_borders 與 player_border_rankings');

const list = toEventList(events, now);
ok(list[0].id === 181 && list.length === 3 && list[2].id === 179, '活動清單新到舊，含 30 天內即將開始的');
ok(eventMeta(null) && Object.keys(eventMeta(null)).length === 0, '沒有活動時回空物件');

/* 路由：假 fetch 模擬 master 與 Haruki API */
const seen = [];
globalThis.fetch = async (u, init) => {
  const url = String(u); seen.push([url, init && init.headers]);
  const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } });
  if (url.endsWith('/events.json')) return J(events.map(e => ({ ...e, startAt: e.startAt, closedAt: e.closedAt })));
  if (url.endsWith('/worldBlooms.json')) return J(wbs);
  if (/\/event\/180\/ranking-top100$/.test(url)) return new Response(big, { status: 200 });
  if (/\/event\/180\/ranking-border$/.test(url)) return J({ borderRankings: [{ rank: 100, score: 1, userId: 1 }] });
  if (/\/event\/999\//.test(url)) return J({ message: 'nope' }, 500);
  return J({}, 404);
};
const realNow = Date.now; Date.now = () => now;
const env = { HARUKI_API_TOKEN: 'tok', HARUKI_OAUTH_CLIENT_ID: 'pjsk-center' };
const call = async p => handleHaruki(new Request('https://games.test' + p), env, new URL('https://games.test' + p));
let res = await call('/haruki/event/live/top100'); let body = await res.json();
ok(res.status === 200 && body.id === 180 && body.player_top_100_rankings.length === 1, '/haruki/event/live/top100 取當期');
ok(seen.some(([u, h]) => /ranking-top100$/.test(u) && h && h['x-haruki-sekai-token'] === 'tok'), '有設 HARUKI_API_TOKEN 就帶 X-Haruki-Sekai-Token');
res = await call('/haruki/event/180/border'); body = await res.json();
ok(res.status === 200 && body.player_border_rankings[0].rank === 100, '/haruki/event/{id}/border');
res = await call('/haruki/event/999/top100');
ok(res.status === 502, '指定不存在的期數回 502，呼叫端會退到下一個來源');
res = await call('/haruki/event/list'); body = await res.json();
ok(Array.isArray(body) && body[0].id === 181, '/haruki/event/list');
res = await call('/haruki/config'); body = await res.json();
ok(body.oauth.clientId === 'pjsk-center' && body.oauth.scopes.includes('game-data:read') && body.api.token === true, '/haruki/config 回 OAuth 設定');
res = await call('/haruki/user/1/profile');
ok(res.status === 404, '白名單以外的路徑回 404');
res = await handleHaruki(new Request('https://games.test/haruki/config', { method: 'POST' }), env, new URL('https://games.test/haruki/config'));
ok(res.status === 405, '只收 GET');
Date.now = realNow;

console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
process.exit(fail ? 1 : 0);
