/* SEKAI 開場動畫（動畫專場）
   app.js 只在要播的時候才 import 這支（約 12 KB），平常開站不會多載任何東西。

   流程（自動播放版約 6 秒）：
     1. 流星匯聚：夜空裡六道團色流星沿弧線飛向中央
     2. 綻放：匯聚點閃光、衝擊波，上千顆角色代表色的光粒子旋轉噴出
     3. 成形：粒子各自延遲、彈簧般飛回，排出「SEKAI 資源中心」（文字在離屏 canvas 畫好再取樣）
     4. 光澤：一道光帶掃過字面，下面浮出今天的一句話（生日、進行中的活動與剩餘時間）
     5. 展開：粒子炸開，畫面中央開出一個圓洞把網站露出來
   專場模式（手動播放）：成形後不結束，點一下畫面粒子炸開、重組成下一個字；拖曳會把粒子撥開；
   每次播放的配色、旋轉方向、流星路徑都隨機。

   效能：粒子是預先畫好的光暈小圖（每色一張）用 drawImage 疊加；數量依螢幕面積 500～1600 顆，
   前 40 幀平均超過 26 ms 就自動減半。canvas 解析度最高 2 倍。分頁切到背景時 rAF 停止，回來時不跳幀。
   無障礙：role=dialog、Esc 與「略過」鍵可關；是否自動播放（減少動態效果、自動化瀏覽器、深連結）由 app.js 判斷。 */

const UNIT = ['#4455dd', '#88dd44', '#ee1166', '#ff9900', '#884499', '#33ccbb'];
const FONT = '"M PLUS Rounded 1c","Noto Sans TC","PingFang TC","Hiragino Sans","Microsoft JhengHei",system-ui,sans-serif';
const T_A = 1.25, T_B = 2.15, T_C = 3.75, T_D = 5.15, T_E = 6.15;   // 各段結束時間（秒）

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const rnd = (a, b) => a + Math.random() * (b - a);

function sprite(col, size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'), r = size / 2, g = x.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.22, col); g.addColorStop(.55, col + '55'); g.addColorStop(1, col + '00');
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  return c;
}

/* 把字畫在離屏 canvas，取有墨水的像素當粒子的目標點；另外畫一張發光的彩色字（art），粒子到位後疊上去，小字也看得清楚 */
function shape(words, w, h, n, dpr, pal, glow) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  const big = String(words[0] || ''), small = String(words[1] || '');
  let fs = [...big].length === 1 ? Math.min(w * .55, h * .42, 360) : Math.min(w * .24, h * (small ? .2 : .3), 190);   // ♪♥★ 這種單一符號放大
  x.font = '900 ' + fs + 'px ' + FONT;
  const tw = x.measureText(big).width;
  if (tw > w * .86) { fs *= w * .86 / tw; x.font = '900 ' + fs + 'px ' + FONT; }
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff';
  const cy = h / 2 - (small ? fs * .3 : 0);
  x.fillText(big, w / 2, cy);
  let bottom = cy + fs * .5;
  if (small) {
    let fs2 = fs * .36; x.font = '800 ' + fs2 + 'px ' + FONT;
    const tw2 = x.measureText(small).width; if (tw2 > w * .8) { fs2 *= w * .8 / tw2; x.font = '800 ' + fs2 + 'px ' + FONT; }
    x.fillText(small, w / 2, cy + fs * .62);
    bottom = cy + fs * .62 + fs2 * .6;
  }
  // 發光彩色字：同樣的排版，用團色漸層＋光暈，解析度跟主畫布一樣
  const art = document.createElement('canvas'); art.width = Math.round(w * dpr); art.height = Math.round(h * dpr);
  const a = art.getContext('2d'); a.scale(dpr, dpr); a.textAlign = 'center'; a.textBaseline = 'middle';
  a.font = '900 ' + fs + 'px ' + FONT;
  const tw0 = Math.min(w * .86, a.measureText(big).width + 40), gr = a.createLinearGradient(w / 2 - tw0 / 2, 0, w / 2 + tw0 / 2, 0);
  (pal && pal.length ? pal : UNIT).slice(0, 6).forEach((c, i, arr) => gr.addColorStop(arr.length > 1 ? i / (arr.length - 1) : 0, c));
  a.shadowColor = glow || '#6fb6ff'; a.shadowBlur = Math.max(10, fs * .16);
  a.font = '900 ' + fs + 'px ' + FONT; a.fillStyle = gr; a.fillText(big, w / 2, cy);
  a.shadowBlur = 0; a.globalAlpha = .28; a.fillStyle = '#ffffff'; a.fillText(big, w / 2, cy);   // 淡淡的白色內芯，亮一點但保留團色
  if (small) { a.globalAlpha = 1; a.shadowBlur = Math.max(8, fs * .1); a.font = x.font; a.fillStyle = '#f4f7ff'; a.fillText(small, w / 2, cy + fs * .62); }
  const d = x.getImageData(0, 0, w, h).data, pts = [];
  const step = Math.max(2, Math.round(Math.sqrt((w * h * .02) / n)));
  for (let y = 0; y < h; y += step) for (let i = 0; i < w; i += step) if (d[(y * w + i) * 4 + 3] > 140) pts.push(i, y);
  const m = pts.length / 2, out = new Float32Array(n * 2);
  const idx = new Uint32Array(m); for (let i = 0; i < m; i++) idx[i] = i;
  for (let i = 0; i < Math.min(n, m); i++) { const j = i + Math.floor(Math.random() * (m - i)), t = idx[i]; idx[i] = idx[j]; idx[j] = t; }   // 前 n 個不重複，字形填得比較均勻
  for (let k = 0; k < n; k++) {
    if (!m) { out[k * 2] = w / 2; out[k * 2 + 1] = h / 2; continue; }
    const j = k < m ? idx[k] : Math.floor(Math.random() * m);
    out[k * 2] = pts[j * 2] + rnd(-step * .35, step * .35); out[k * 2 + 1] = pts[j * 2 + 1] + rnd(-step * .35, step * .35);
  }
  return { pts: out, bottom: Math.min(h - 40, bottom + 26), art, fs };
}

export function playIntro(o) {
  o = o || {};
  if (document.getElementById('sc-intro')) return null;
  const show = o.mode === 'show';
  const L = Object.assign({ skip: '略過 ✕', off: '不再自動播放', hint: '點一下畫面換下一個・拖曳攪動粒子', label: '開場動畫', close: '離開 ✕' }, o.labels || {});
  const root = document.createElement('div');
  root.id = 'sc-intro'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', L.label);
  root.innerHTML = '<style>' +
    '#sc-intro{position:fixed;inset:0;z-index:2147483100;touch-action:none;-webkit-user-select:none;user-select:none;animation:itIn .35s ease both}' +
    '#sc-intro canvas{position:absolute;inset:0;width:100%;height:100%;display:block}' +
    '#sc-intro .it-cap{position:absolute;left:16px;right:16px;top:var(--cap-y,62%);text-align:center;color:#eef2ff;pointer-events:none;opacity:0;transform:translateY(10px);transition:opacity .7s cubic-bezier(.22,.8,.26,1),transform .7s cubic-bezier(.22,.8,.26,1)}' +
    '#sc-intro .it-cap.on{opacity:1;transform:none}' +
    '#sc-intro .it-cap b{display:block;font:800 clamp(14px,3.8vw,19px)/1.5 ' + FONT + ';letter-spacing:.06em;text-shadow:0 0 18px var(--it-acc,#3f8cf3)}' +
    '#sc-intro .it-cap span{display:block;margin-top:5px;font:600 12.5px/1.6 ' + FONT + ';color:rgba(238,242,255,.66)}' +
    '#sc-intro .it-bar{position:absolute;top:calc(14px + env(safe-area-inset-top,0px));right:14px;display:flex;gap:8px;transition:opacity .3s}' +
    '#sc-intro .it-bar button{padding:8px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.09);color:#fff;font:700 12.5px/1.2 ' + FONT + ';cursor:pointer;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}' +
    '#sc-intro .it-bar button:hover{background:rgba(255,255,255,.18)}' +
    '#sc-intro .it-bar button:focus-visible{outline:2px solid #8fd8ff;outline-offset:2px}' +
    '#sc-intro .it-hint{position:absolute;left:0;right:0;bottom:calc(26px + env(safe-area-inset-bottom,0px));text-align:center;color:rgba(238,242,255,.5);font:600 12px/1.5 ' + FONT + ';pointer-events:none;opacity:0;transition:opacity .8s}' +
    '#sc-intro .it-hint.on{opacity:1}' +
    '#sc-intro.out .it-cap,#sc-intro.out .it-bar,#sc-intro.out .it-hint{opacity:0;transition:opacity .3s}' +
    '@keyframes itIn{from{opacity:0}}' +
    '</style><canvas></canvas><div class="it-cap"><b></b><span></span></div><div class="it-hint"></div><div class="it-bar"></div>';
  document.body.appendChild(root);
  const cv = root.querySelector('canvas'), cap = root.querySelector('.it-cap'), hint = root.querySelector('.it-hint'), bar = root.querySelector('.it-bar');
  const btn = (t, f) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.addEventListener('click', e => { e.stopPropagation(); f(); }); bar.appendChild(b); return b; };
  if (!show && o.onOff) btn(L.off, () => { try { o.onOff(); } catch (e) {} finish(); });
  const skipBtn = btn(show ? L.close : L.skip, () => finish());
  hint.textContent = L.hint;

  const g = cv.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  const resize = () => {
    DPR = Math.min(window.devicePixelRatio || 1, 2); W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    bgC = null;
  };
  let bgC = null;
  const bg = () => {   // 背景：深夜藍＋中央微光＋暗角，畫一次快取起來
    if (bgC) return bgC;
    bgC = document.createElement('canvas'); bgC.width = Math.max(1, Math.round(W / 2)); bgC.height = Math.max(1, Math.round(H / 2));
    const x = bgC.getContext('2d'), w = bgC.width, h = bgC.height;
    const r = x.createRadialGradient(w / 2, h * .46, 0, w / 2, h * .5, Math.hypot(w, h) * .6);
    r.addColorStop(0, '#1a2050'); r.addColorStop(.45, '#0c1030'); r.addColorStop(1, '#04060f');
    x.fillStyle = r; x.fillRect(0, 0, w, h);
    return bgC;
  };
  resize();

  // 配色：角色代表色（生日那天以壽星的顏色為主）／團色；每次播放隨機
  const chara = (o.colors && o.colors.length ? o.colors : UNIT).slice();
  const getCtx = () => { try { return (o.ctx && o.ctx()) || {}; } catch (e) { return {}; } };
  let acc = null, palette = Math.random() < .6 ? chara : UNIT;
  const sprites = new Map();
  const spr = col => { let s = sprites.get(col); if (!s) { s = sprite(col, 48); sprites.set(col, s); } return s; };
  const white = spr('#ffffff');

  // 粒子
  let N = clamp(Math.round(W * H / 250), 500, 1600);
  const px = new Float32Array(N), py = new Float32Array(N), vx = new Float32Array(N), vy = new Float32Array(N);
  const sz = new Float32Array(N), dl = new Float32Array(N), ph = new Float32Array(N), al = new Float32Array(N);
  const col = new Array(N);
  const recolor = pal => { for (let i = 0; i < N; i++) col[i] = spr(pal[i % pal.length]); };
  for (let i = 0; i < N; i++) { px[i] = W / 2; py[i] = H / 2; sz[i] = rnd(5, 11); dl[i] = Math.random() * .55; ph[i] = Math.random() * 6.283; al[i] = 1; }
  recolor(palette);
  let tgt = null, art = null, capBottom = H * .62, curPal = palette;
  const setShape = (words, pal) => {
    if (pal) curPal = pal;
    const s = shape(words, W, H, N, DPR, curPal, acc);
    tgt = s.pts; art = s.art; capBottom = s.bottom; root.style.setProperty('--cap-y', Math.round(capBottom) + 'px');
    const lo = clamp(s.fs * .045, 2.6, 7), hi = clamp(s.fs * .085, 4.5, 12);   // 粒子大小跟字的粗細走：手機上不會糊成一團
    for (let i = 0; i < N; i++) sz[i] = rnd(lo, hi);
  };

  // 字：第一個一定是站名；專場模式依序換到今天的主題字、音符、愛心、星星
  const words = [o.title || ['SEKAI', '資源中心'], ['♪', ''], ['♥', ''], ['★', '']];
  /* 今天的主題（生日的壽星代表色、活動名稱）：開場時資料可能還在載，炸開那一刻再讀一次 */
  let ctxDone = false;
  const applyCtx = () => {
    const c = getCtx();
    if (c.accent && !acc) { acc = c.accent; palette = [acc, acc, acc, '#ffffff'].concat(chara.slice(0, 6)); recolor(palette); setShape(words[wi], [acc, '#ffffff', acc]); }
    if (c.words && !ctxDone) { words.splice(1, 0, c.words); ctxDone = true; }
  };
  let wi = 0;
  setShape(words[0]);

  // 星空
  const stars = Array.from({ length: Math.round(clamp(W * H / 4500, 80, 260)) }, () => [Math.random(), Math.random(), rnd(.4, 1.6), Math.random() * 6.283, rnd(.6, 2.2)]);
  // 流星：六團色，從畫面外沿弧線飛向中央
  const rot = Math.random() * 6.283, spin = Math.random() < .5 ? -1 : 1;
  const comets = UNIT.map((c, k) => {
    const a = rot + k * Math.PI / 3, R = Math.hypot(W, H) * .62;
    const sx = W / 2 + Math.cos(a) * R, sy = H / 2 + Math.sin(a) * R;
    const ca = a + spin * rnd(.6, 1.1), cr = R * rnd(.45, .7);
    return { c, sx, sy, cx: W / 2 + Math.cos(ca) * cr, cy: H / 2 + Math.sin(ca) * cr, d: rnd(0, .18), tr: [] };
  });

  // 互動：拖曳撥開粒子；專場模式點一下炸開換下一個字
  const ptr = { x: -9999, y: -9999, on: false };
  const onMove = e => { const p = e.touches ? e.touches[0] : e; if (!p) return; ptr.x = p.clientX; ptr.y = p.clientY; ptr.on = true; };
  const onLeave = () => { ptr.on = false; ptr.x = ptr.y = -9999; };
  let t0 = performance.now(), last = t0, clock = 0, phase = 'A', holdAt = 0, burstAt = -1, ending = 0, done = false, frames = 0, slow = 0;
  const burst = (cx, cy, power) => {
    const S = clamp(Math.min(W, H) / 700, .55, 1.2);   // 小螢幕炸得收斂一點，粒子不會全飛出畫面
    for (let i = 0; i < N; i++) {
      const dx = px[i] - cx || rnd(-1, 1), dy = py[i] - cy || rnd(-1, 1), d = Math.hypot(dx, dy) || 1, f = power * S * rnd(.6, 1.4) * (1 + 60 / (d + 30));
      vx[i] += dx / d * f + spin * -dy / d * f * .35; vy[i] += dy / d * f + spin * dx / d * f * .35;
      dl[i] = Math.random() * .45;
    }
    burstAt = clock; flashAt = clock; flashX = cx; flashY = cy;
  };
  let flashAt = -9, flashX = W / 2, flashY = H / 2;
  const onTap = e => {
    if (!show || (phase !== 'D' && phase !== 'C') || ending) return;
    const p = e.changedTouches ? e.changedTouches[0] : e;
    wi = (wi + 1) % words.length;
    const pal = wi % 2 ? UNIT : palette;
    recolor(pal); setShape(words[wi], acc && !(wi % 2) ? [acc, '#ffffff', acc] : pal);
    burst(p ? p.clientX : W / 2, p ? p.clientY : H / 2, 7);
    phase = 'C'; holdAt = clock; cap.classList.remove('on');
  };
  root.addEventListener('pointermove', onMove); root.addEventListener('pointerdown', onMove);
  root.addEventListener('pointerleave', onLeave); root.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') onLeave(); });
  root.addEventListener('click', onTap);
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); } };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  function onResize() { resize(); setShape(words[wi]); }
  setTimeout(() => { try { skipBtn.focus({ preventScroll: true }); } catch (e) {} }, 400);

  let resolveDone; const closed = new Promise(r => { resolveDone = r; });
  function finish() {   // 進入「展開」：粒子炸開、中央開洞露出網站，之後移除
    if (ending || done) return;
    ending = Math.max(clock, 1e-3); phase = 'E'; root.classList.add('out');
    burst(W / 2, H / 2, 9);
  }
  function cleanup() {
    if (done) return; done = true;
    window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize);
    root.remove();
    try { o.onClose && o.onClose(); } catch (e) {}
    resolveDone();
  }

  const setCaption = () => {
    let c = {}; try { c = o.ctx ? o.ctx() : {}; } catch (e) {}
    cap.querySelector('b').textContent = c.line || '';
    cap.querySelector('span').textContent = c.sub || '';
    if (c.accent) root.style.setProperty('--it-acc', c.accent);
    cap.classList.add('on');
    if (show) hint.classList.add('on');
  };

  function frame(now) {
    if (done) return;
    let dt = (now - last) / 1000; last = now;
    if (dt > .1) dt = 1 / 60;   // 分頁切回來、卡頓：不要一次跳很多
    clock += dt; frames++;
    if (frames <= 40) { slow += dt; if (frames === 40 && slow / 40 > .026 && N > 500) N = Math.round(N / 2); }
    const t = clock, k = dt * 60;

    // 段落推進（專場模式在 D 停住，每 5.5 秒自動換下一個字）
    if (!ending) {
      if (t < T_A) phase = 'A';
      else if (phase === 'A') { phase = 'B'; applyCtx(); burst(W / 2, H / 2, 6.5); }
      else if (phase === 'B' && t >= T_B) { phase = 'C'; holdAt = t; }
      else if (phase === 'C' && t - holdAt >= T_C - T_B) { phase = 'D'; holdAt = t; setCaption(); }
      else if (phase === 'D') {
        if (!show && t >= T_D) finish();
        else if (show && t - holdAt > 5.5) onTap({ clientX: W / 2, clientY: H / 2 });
      }
    }

    // 背景（半透明蓋上去 → 流星與粒子留下拖尾）
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = phase === 'A' ? .5 : .34;
    if (frames < 3) g.globalAlpha = 1;
    g.drawImage(bg(), 0, 0, W, H);
    g.globalAlpha = 1;

    // 星星
    g.fillStyle = '#ffffff';
    for (const s of stars) {
      const a = .25 + .55 * (.5 + .5 * Math.sin(t * s[4] + s[3]));
      g.globalAlpha = a * (phase === 'E' ? Math.max(0, 1 - (t - ending) * 1.6) : 1);
      g.fillRect(s[0] * W, s[1] * H, s[2], s[2]);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'lighter';

    // 1. 流星
    if (t < T_A + .25) {
      for (const c of comets) {
        const p = clamp((t - c.d) / (T_A - c.d), 0, 1), e = p * p * (3 - 2 * p) * p;
        const u = 1 - e, x = u * u * c.sx + 2 * u * e * c.cx + e * e * W / 2, y = u * u * c.sy + 2 * u * e * c.cy + e * e * H / 2;
        if (p > 0 && p < 1) c.tr.push(x, y);
        if (c.tr.length > 44) c.tr.splice(0, 2);
        const n = c.tr.length / 2;
        for (let i = 0; i < n; i++) {
          const f = (i + 1) / n, s = 4 + f * 18;
          g.globalAlpha = f * .85 * (p >= 1 ? Math.max(0, 1 - (t - T_A) * 4) : 1);
          g.drawImage(spr(c.c), c.tr[i * 2] - s / 2, c.tr[i * 2 + 1] - s / 2, s, s);
        }
        if (p < 1) { g.globalAlpha = 1; g.drawImage(white, x - 10, y - 10, 20, 20); }
      }
      g.globalAlpha = 1;
    }

    // 閃光與衝擊波
    const fa = t - flashAt;
    if (fa >= 0 && fa < .9) {
      const r = easeOut(fa / .9) * Math.hypot(W, H) * .55;
      g.globalAlpha = Math.max(0, .9 - fa * 1.6);
      const gr = g.createRadialGradient(flashX, flashY, 0, flashX, flashY, 160);
      gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(.3, 'rgba(160,210,255,.4)'); gr.addColorStop(1, 'rgba(120,160,255,0)');
      g.fillStyle = gr; g.fillRect(flashX - 160, flashY - 160, 320, 320);
      g.globalAlpha = Math.max(0, 1 - fa / .9) * .7;
      g.strokeStyle = acc || '#9fd8ff'; g.lineWidth = 2.5;
      g.beginPath(); g.arc(flashX, flashY, r, 0, 6.283); g.stroke();
      g.globalAlpha = 1;
    }

    // 發光彩色字：粒子到位後浮上來（專場換字時跟著淡掉）
    if (art && (phase === 'D' || phase === 'E')) {
      const aa = phase === 'D' ? clamp((t - holdAt) / .7, 0, 1) : Math.max(0, 1 - (t - ending) * 3);
      if (aa > 0) { g.globalCompositeOperation = 'source-over'; g.globalAlpha = aa * .95; g.drawImage(art, 0, 0, W, H); g.globalAlpha = 1; g.globalCompositeOperation = 'lighter'; }
    }

    // 2～5. 粒子
    if (phase !== 'A') {
      const sweepX = phase === 'D' ? ((t - holdAt) / 1.3 % 1.6) * (W * 1.2) - W * .1 : -9999;
      const fade = phase === 'E' ? Math.max(0, 1 - (t - ending) * 1.25) : 1;
      const half = N > 900 && frames >= 40 && slow / 40 > .026;   // 裝置太慢：只畫一半
      for (let i = 0; i < N; i++) {
        let x = px[i], y = py[i];
        if (phase === 'B' || (phase === 'C' && t - burstAt < dl[i] + .05)) {
          // 噴出後的漩渦：沿切線轉、慢慢減速
          const dx = x - W / 2, dy = y - H / 2, d = Math.hypot(dx, dy) || 1;
          vx[i] += (spin * -dy / d) * .18 * k; vy[i] += (spin * dx / d) * .18 * k;
          vx[i] *= Math.pow(.955, k); vy[i] *= Math.pow(.955, k);
        } else if ((phase === 'C' || phase === 'D') && tgt) {
          // 彈簧飛回字形；到位後輕輕呼吸
          const wob = phase === 'D' ? 1 : 0;
          const tx = tgt[i * 2] + Math.sin(t * 2.1 + ph[i]) * .7 * wob, ty = tgt[i * 2 + 1] + Math.cos(t * 1.7 + ph[i]) * .7 * wob;
          const kk = (phase === 'C' ? clamp((t - holdAt - dl[i]) * 2.2, 0, 1) * .055 : .07) * k;
          vx[i] += (tx - x) * kk; vy[i] += (ty - y) * kk;
          vx[i] *= Math.pow(.8, k); vy[i] *= Math.pow(.8, k);
        } else if (phase === 'E') {
          vx[i] *= Math.pow(.985, k); vy[i] *= Math.pow(.985, k);
        }
        if (ptr.on && phase !== 'E') {
          const dx = x - ptr.x, dy = y - ptr.y, d2 = dx * dx + dy * dy;
          if (d2 < 9000) { const d = Math.sqrt(d2) || 1, f = (1 - d / 95) * 2.4 * k; vx[i] += dx / d * f; vy[i] += dy / d * f; }
        }
        x += vx[i] * k; y += vy[i] * k; px[i] = x; py[i] = y;
        if (half && (i & 1)) continue;
        let s = sz[i], a = (phase === 'D' ? .62 : .8) * fade;
        if (sweepX > -9000) { const b = Math.abs(x - sweepX); if (b < 46) { const q = 1 - b / 46; a = Math.min(1, a + q * .5); s *= 1 + q * .5; g.globalAlpha = q * .45 * fade; g.drawImage(white, x - s * .6, y - s * .6, s * 1.2, s * 1.2); } }
        g.globalAlpha = a;
        g.drawImage(col[i], x - s / 2, y - s / 2, s, s);
      }
      g.globalAlpha = 1;
    }

    // 5. 展開：中央開一個軟邊圓洞，把網站露出來
    if (phase === 'E') {
      const p = clamp((t - ending) / .95, 0, 1), R = easeInOut(p) * Math.hypot(W, H) * .62;
      if (R > 1) {
        g.globalCompositeOperation = 'destination-out';
        const gr = g.createRadialGradient(W / 2, H / 2, Math.max(0, R - 90), W / 2, H / 2, R);
        gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'source-over';
      }
      if (p >= 1) { cleanup(); return; }
    }
    requestAnimationFrame(frame);
  }
  // 第一幀先鋪滿背景，避免底下的頁面閃一下
  g.drawImage(bg(), 0, 0, W, H);
  requestAnimationFrame(frame);
  return { close: finish, closed };
}
