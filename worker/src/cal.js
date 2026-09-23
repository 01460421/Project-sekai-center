/* 行事曆訂閱源：GET /cal/sekai.ics（手機用 webcal://games.project-sekai-center.com/cal/sekai.ics 訂閱）。
   從台服 master 的 events.json／gachas.json／supportEvents.json 產 iCalendar：近 60 天到未來的活動、卡池與應援活動，
   上游抓取與回應都在邊緣快取一小時，行事曆程式每 6 小時來拿一次也不會打到 GitHub。 */
const TDB = 'https://raw.githubusercontent.com/Sekai-World/sekai-master-db-tc-diff/main';
const SITE = 'https://project-sekai-center.com/app.html';
const esc = t => String(t || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
const utc = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/* RFC 5545：一行不超過 75 octets，續行開頭一個空白；照 UTF-8 位元組數折，中文一字 3 bytes 也不會切壞 */
const bytesOf = ch => { const c = ch.codePointAt(0); return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; };
const fold = line => { const out = []; let cur = '', n = 0; for (const ch of line) { const b = bytesOf(ch); if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ' '; n = 1; } cur += ch; n += b; } out.push(cur); return out.join('\r\n'); };

export function buildIcs(events, gachas, now, supports, extra) {
  const since = now - 60 * 86400000, until = now + 400 * 86400000;
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SEKAI 中心//cal//TW', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    fold('X-WR-CALNAME:SEKAI 中心：活動與卡池'), 'X-WR-TIMEZONE:Asia/Taipei', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H'];
  const add = (uid, title, a, b, desc, url) => {
    L.push('BEGIN:VEVENT', 'UID:' + uid + '@project-sekai-center.com', 'DTSTAMP:' + utc(now), 'DTSTART:' + utc(a), 'DTEND:' + utc(b), fold('SUMMARY:' + esc(title)));
    if (desc) L.push(fold('DESCRIPTION:' + esc(desc)));
    if (url) L.push('URL:' + url);
    L.push('END:VEVENT');
  };
  (events || []).filter(e => e && e.startAt && e.aggregateAt && e.aggregateAt > since && e.startAt < until)
    .forEach(e => add('event-' + e.id, '活動：' + e.name, e.startAt, e.aggregateAt, '第 ' + e.id + ' 期' + (e.eventType ? ' · ' + e.eventType : ''), SITE + '?page=event'));
  (gachas || []).filter(g => g && g.startAt && g.endAt && g.endAt > since && g.startAt < until)
    .forEach(g => add('gacha-' + g.id, '卡池：' + g.name, g.startAt, g.endAt, g.gachaType || '', SITE + '?page=gacha'));
  (supports || []).filter(x => x && x.startAt && x.aggregateAt && x.aggregateAt > since && x.startAt < until)
    .forEach(x => add('sup-' + x.id, '第 ' + x.id + ' 回應援活動', x.startAt, x.aggregateAt, '結算後領獎到 ' + new Date(x.closeAt || x.aggregateAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }), SITE + '?page=calc&ctab=support'));
  const ex = extra || {};
  (ex.logins || []).filter(x => x && x.startAt && x.endAt && x.endAt > since && x.startAt < until)
    .forEach(x => add('login-' + x.id, '登入活動：' + (x.name || ''), x.startAt, x.endAt, '', SITE + '?page=calendar'));
  // 角色生日：characterProfiles 的「8月11日」，涵蓋範圍內每一年各一筆
  const names = {}; (ex.chars || []).forEach(c => { names[c.id] = (c.firstName || '') + (c.givenName || ''); });
  (ex.profiles || []).forEach(pf => {
    const m = /(\d+)月(\d+)日/.exec(pf.birthday || ''); if (!m) return;
    for (let y = new Date(since).getFullYear(); y <= new Date(until).getFullYear(); y++) {
      const st = Date.UTC(y, +m[1] - 1, +m[2]) - 8 * 3600000;   // 台北 0 點
      if (st < since || st > until) continue;
      add('bday-' + pf.characterId + '-' + y, (names[pf.characterId] || ('#' + pf.characterId)) + ' 的生日', st, st + 86400000, '', SITE + '?page=calendar');
    }
  });
  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}

async function getJson(name) {
  const r = await fetch(TDB + '/' + name, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!r.ok) throw new Error(name + ' HTTP ' + r.status);
  return r.json();
}

export async function handleCal(req, env, url) {
  if (url.pathname !== '/cal/sekai.ics') return new Response('not found', { status: 404 });
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
  const cache = (typeof caches !== 'undefined' && caches.default) || null;
  const key = new Request('https://cal.local/cal/sekai.ics', { method: 'GET' });
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  let body;
  try {
    const opt = n => getJson(n).catch(() => []);
    const [ev, ga, su, lg, pf, ch] = await Promise.all([getJson('events.json'), getJson('gachas.json'), opt('supportEvents.json'), opt('limitedLoginBonuses.json'), opt('characterProfiles.json'), opt('gameCharacters.json')]);
    body = buildIcs(ev, ga, Date.now(), su, { logins: lg, profiles: pf, chars: ch });
  }
  catch (e) { return new Response('upstream error: ' + (e && e.message), { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } }); }
  const res = new Response(body, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*', 'content-disposition': 'inline; filename="sekai.ics"' } });
  if (cache) { try { await cache.put(key, res.clone()); } catch (e) {} }
  return res;
}
