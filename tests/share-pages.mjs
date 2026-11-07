// 守門：給連結預覽爬蟲看的 share/<page>.html（tools/build-og.mjs 產）要跟 js/app.js 的 PAGES 表一致。
// 少一頁，爬蟲打 /X（或 /?page=X）就落回首頁那組預覽；多一頁是表拿掉後沒重產；og:image 指到不存在的圖，Discord／LINE 的卡片就沒圖。
// 另外 vercel.json 把爬蟲改寫到 share/ 的那條路由也在這裡順手驗：JSON 要能 parse、builds 要有 share/**、路由要在 "/" 之前。
// CI 沒有 Vercel 的路由引擎，真的 UA 判斷要在 preview 部署上用 curl -A 驗。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
const bad = [];
const src = readFileSync('js/app.js', 'utf8');
const block = src.slice(src.indexOf('  PAGES = {'));
const body = block.slice(0, block.indexOf('\n  };'));
const pages = [...body.matchAll(/^\s{4}(\w+):\s*\['([^']*)',\s*'([^']*)'/gm)].map(m => ({ k: m[1], t: m[2], d: m[3] }));
if (!pages.length) { console.error('PAGES 表解析不到任何頁面'); process.exit(1); }

const files = existsSync('share') ? readdirSync('share').filter(f => f.endsWith('.html')) : [];
const keys = new Set(pages.map(p => p.k));
for (const f of files) if (!keys.has(f.slice(0, -5))) bad.push(`share/${f}：PAGES 表裡沒有這一頁（表拿掉後要重跑 tools/build-og.mjs）`);
const attr = (html, re) => { const m = re.exec(html); return m ? m[1] : ''; };
for (const p of pages) {
  const f = `share/${p.k}.html`;
  if (!existsSync(f)) { bad.push(`${f}：沒有這個檔（新頁要跑 tools/build-og.mjs --share-only）`); continue; }
  const html = readFileSync(f, 'utf8');
  const title = attr(html, /<title>([^<]*)<\/title>/);
  if (!title) bad.push(`${f}：沒有 <title>`);
  else if (!title.startsWith(p.t)) bad.push(`${f}：<title>「${title}」跟 PAGES 表的「${p.t}」對不上`);
  const url = attr(html, /<meta property="og:url" content="([^"]*)"/);
  const want = 'https://project-sekai-center.com/' + (p.k === 'home' ? '' : p.k);   // 路徑形式（/songs）；?page= 只是舊連結相容
  if (url !== want) bad.push(`${f}：og:url 是「${url}」，應為 ${want}`);
  const canon = attr(html, /<link rel="canonical" href="([^"]*)"/);
  if (canon !== url) bad.push(`${f}：canonical「${canon}」跟 og:url 不同`);
  const desc = attr(html, /<meta property="og:description" content="([^"]*)"/);
  if (!desc) bad.push(`${f}：沒有 og:description`);
  for (const key of ['og:image', 'twitter:image']) {
    const img = attr(html, new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`));
    const m = /^https:\/\/project-sekai-center\.com\/og\/([\w-]+\.jpg)$/.exec(img);
    if (!m) { bad.push(`${f}：${key}「${img}」不是本站 og/ 的絕對網址`); continue; }
    if (!existsSync('og/' + m[1])) bad.push(`${f}：${key} 指到不存在的 og/${m[1]}`);
  }
}

// vercel.json：share/ 要有 build、改寫路由要在 "/" 與 "/app.html" 之前
let vc;
try { vc = JSON.parse(readFileSync('vercel.json', 'utf8')); } catch (e) { bad.push('vercel.json 不是合法 JSON：' + e.message); }
if (vc) {
  if (!(vc.builds || []).some(b => b.src === 'share/**')) bad.push('vercel.json：builds 少了 share/**');
  const routes = vc.routes || [];
  const shares = routes.map((r, i) => r.dest === '/share/$pg.html' ? i : -1).filter(i => i >= 0);
  const share = shares[0];
  if (shares.length < 2) bad.push('vercel.json：改寫到 /share/$pg.html 的路由要有兩條（?page=X 與路徑形式 /X）');
  if (!routes.some(r => r.status === 308 && /\/\(\[A-Za-z0-9_\]\+\)\//.test(r.src || ''))) bad.push('vercel.json：少了 /songs/ → /songs 的尾斜線 308（相對路徑的資產會從 /songs/ 底下找）');
  const first = routes.findIndex(r => r.src === '/' || r.src === '/app.html' || r.src === '/app');
  if (share === undefined) bad.push('vercel.json：少了改寫到 /share/$pg.html 的路由');
  for (const si of shares) {
    const r = routes[si];
    const isPath = !(r.has || []).some(h => h.type === 'query');
    if (r.check !== true) bad.push('vercel.json：share 路由要 check:true，檔案不存在時才會落回原路由');
    if (isPath ? !/\(\?<pg>/.test(r.src || '') : !(r.has || []).some(h => h.type === 'query' && h.key === 'page' && /\(\?<pg>/.test(h.value || ''))) bad.push('vercel.json：share 路由要把頁名抓進命名群組 pg（query page 或 src 路徑）');
    const ua = (r.has || []).find(h => h.type === 'header' && h.key === 'user-agent');
    if (!ua) bad.push('vercel.json：share 路由的 has 要有 user-agent 條件（不然一般瀏覽器也會拿到 share 頁）');
    else if (/googlebot/i.test(ua.value)) bad.push('vercel.json：share 路由不該放 Googlebot');
    if (first >= 0 && si > first) bad.push('vercel.json：share 路由要放在 "/"、"/app"、"/app.html" 之前');
    if (!(r.missing || []).some(m => m.type === 'query' && m.key === 's')) bad.push('vercel.json：share 路由要有 missing query s（share 頁的 meta refresh 帶 s=1 回主站，沒有這條會無限迴圈）');
    if (!/no-store/.test((r.headers || {})['cache-control'] || '')) bad.push('vercel.json：share 路由（依 UA 改寫）要 no-store，免得 CDN 把爬蟲那份快取給真人');
  }
}

if (bad.length) {
  console.error(`share/ 預覽頁有 ${bad.length} 個問題：`);
  bad.forEach(x => console.error('  ' + x));
  process.exit(1);
}
console.log(`share/ 預覽頁檢查通過（${pages.length} 頁）`);
