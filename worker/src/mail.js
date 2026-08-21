/**
 * Email 通知（Resend）
 *
 * 為什麼是 Resend 不是 MailChannels：
 *   MailChannels 給 Workers 的免費中繼在 2024 年中就終止了,現在要從 Worker 寄信
 *   只剩「走某家的 HTTP API」這條路（Workers 沒有 SMTP 客戶端）。Resend 的
 *   POST /emails 一支 fetch 就完事,免費額度 3000 封/月、100 封/日,對這站夠用。
 *
 * 為什麼寄信要排隊,不在偵測當下直接寄：
 *   偵測跑在 cron 裡,一輪可能同時觸發好幾個 watch。事件先寫進 events 表,再由
 *   flushMail 慢慢寄,掃描才不會被寄信拖到逾時；寄失敗的理由也留在 mail_error
 *   欄位裡查得到,而不是消失在 log。
 *
 * MAIL_FROM 的網域（project-sekai-center.com）必須先在 Resend 後台建成 domain,
 * 並把它產生的 DKIM / SPF（TXT）與回信用的 MX 記錄設進 DNS、後台顯示 verified,
 * 否則每一封都會被擋下來回 403 validation_error —— 那是 DNS 沒設好,不是程式壞了。
 */

import { pendingEvents, markMailed } from './db.js';

const API = 'https://api.resend.com/emails';

/* 一輪最多 20 封。Resend 免費方案一天只有 100 封,cron 又是分鐘級的,
   一次寄太多既容易讓 Worker 逼近 CPU / 子請求上限,也會在尖峰把當日額度一口氣燒光。 */
const BATCH = 20;

/* 網域沒驗證前這個 from 寄不出去,詳見檔頭說明。 */
const DEFAULT_FROM = 'SEKAI 資源中心 <noreply@project-sekai-center.com>';
const DEFAULT_SITE = 'https://project-sekai-center.com';

const siteBase = (env) => String((env && env.SITE_BASE) || DEFAULT_SITE).replace(/\/+$/, '');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* 標題會直接進 Subject 標頭,換行與控制字元一律清掉（標頭注入的老問題）。 */
const clean = (s) => String(s == null ? '' : s)
  .replace(/[\u0000-\u001f\u007f]+/g, ' ')
  .replace(/\s{2,}/g, ' ')
  .trim();

/* 自己加 8 小時而不是用 Intl 的 timeZone：台灣沒有日光節約,offset 是死的,
   這樣就不必賭 runtime 有沒有帶完整的 ICU 時區資料。 */
function fmtTaipei(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '';
  return new Date((n + 8 * 3600) * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * 把一筆 event 算成信件內容。
 * 第三個參數 env 只是為了拿 SITE_BASE 組連結,不給也能算（會退回正式站網址）,
 * 這樣測試或前端預覽時可以只丟 (ev, user) 進來。
 */
export function renderEvent(ev, user, env) {
  const base = siteBase(env);
  const home = `${base}/app.html`;
  const manage = `${base}/app.html?page=account`;

  const title = clean(ev && ev.title) || '偵測通知';
  const who = clean((user && user.name) || (ev && ev.user_name) || '');
  const when = fmtTaipei(ev && ev.created_at);
  const body = String((ev && ev.body) || '').trim();

  const subject = `[SEKAI 資源中心] ${title}`.slice(0, 120);

  const text = [
    who ? `${who} 你好,` : '',
    '',
    title,
    when ? `觸發時間 ${when}（台北時間）` : '',
    '',
    body,
    '',
    `打開資源中心 ${home}`,
    '',
    '--',
    '這是你在 Project SEKAI 資源中心訂閱的通知。',
    `要調整或取消訂閱,請到 ${manage}`,
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';

  const font = '-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  const para = body
    ? body.split(/\n{2,}/).map(p => `<p style="margin:0 0 12px;">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')
    : '';

  /* 深色模式的兩層保險：
     1. 每個容器都同時寫死 background-color 與 color。Gmail 那類會自行反轉配色的
        客戶端是整組一起翻,只寫其中一個才會出現「淺底淺字」的慘況。
     2. 另外附一段 prefers-color-scheme 的 @media（Apple Mail / iOS Mail 吃這套,
        而且宣告過 color-scheme 之後它們就不會再自作主張反轉）。這段純粹是加分,
        整段被客戶端丟掉時,上面的 inline style 本身就已經是可讀的配色。 */
  const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(title)}</title>
<style>
@media (prefers-color-scheme: dark) {
  .pg { background-color:#16130f !important; }
  .cd { background-color:#201c17 !important; border-color:#35302a !important; }
  .ink { color:#e8e2d6 !important; }
  .mut { color:#a09789 !important; }
  .rule { background-color:#35302a !important; }
  .btn { background-color:#d8cdb6 !important; color:#24201a !important; }
}
</style>
</head>
<body class="pg" style="margin:0;padding:0;background-color:#f2eee4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="pg" style="background-color:#f2eee4;">
<tr><td align="center" style="padding:24px 12px;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="cd" style="max-width:560px;background-color:#fffdf7;border:1px solid #e2d9c7;border-radius:4px;">
  <tr><td class="mut" style="padding:20px 24px 12px;font-family:${font};font-size:11px;letter-spacing:.16em;color:#8a8071;">PROJECT SEKAI 資源中心</td></tr>
  <tr><td style="padding:0 24px;"><div class="rule" style="height:1px;line-height:1px;font-size:0;background-color:#e8dfcd;">&nbsp;</div></td></tr>
  ${who ? `<tr><td class="mut" style="padding:18px 24px 0;font-family:${font};font-size:14px;line-height:1.6;color:#857a68;">${esc(who)} 你好,</td></tr>` : ''}
  <tr><td class="ink" style="padding:${who ? '8px' : '20px'} 24px 0;font-family:${font};font-size:19px;line-height:1.5;font-weight:700;color:#2b2721;">${esc(title)}</td></tr>
  ${when ? `<tr><td class="mut" style="padding:6px 24px 0;font-family:${font};font-size:12px;line-height:1.6;color:#857a68;">觸發時間 ${esc(when)}（台北時間）</td></tr>` : ''}
  ${para ? `<tr><td class="ink" style="padding:16px 24px 0;font-family:${font};font-size:15px;line-height:1.8;color:#3a342b;">${para}</td></tr>` : ''}
  <tr><td style="padding:20px 24px 24px;">
    <a class="btn" href="${esc(home)}" style="display:inline-block;padding:11px 20px;background-color:#433c30;color:#fdfaf2;text-decoration:none;border-radius:3px;font-family:${font};font-size:14px;line-height:1;">打開資源中心</a>
  </td></tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
  <tr><td class="mut" style="padding:16px 8px 0;font-family:${font};font-size:12px;line-height:1.8;color:#8a8071;">
    這是你在 Project SEKAI 資源中心訂閱的通知。<br>
    <a class="mut" href="${esc(manage)}" style="color:#8a8071;text-decoration:underline;">管理或取消訂閱</a>
  </td></tr>
</table>

</td></tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}

/**
 * 寄一封信。不丟例外,一律回結果物件,讓呼叫端自己決定要不要記錯誤：
 *   { ok:true, id }
 *   { ok:false, status, code, message, transient, quota, retryAfter }
 * transient=true 表示「這次不算數,晚點再寄」（429 / 5xx / 連線失敗）,
 * transient=false 是永久性錯誤（地址無效、網域沒驗證…）,重寄幾次都一樣。
 */
export async function sendMail(env, opts) {
  const o = opts || {};
  const to = (Array.isArray(o.to) ? o.to : [o.to]).map(x => String(x || '').trim()).filter(Boolean);
  if (!to.length) return { ok: false, status: 0, code: 'no_recipient', message: '沒有收件人', transient: false };
  if (!env || !env.RESEND_API_KEY) {
    return { ok: false, status: 0, code: 'no_api_key', message: '未設定 RESEND_API_KEY', transient: false };
  }

  const payload = {
    from: (env && env.MAIL_FROM) || DEFAULT_FROM,
    to,
    subject: clean(o.subject).slice(0, 200) || '（無標題）',
    html: o.html,
    text: o.text,
  };
  if (o.replyTo) payload.reply_to = o.replyTo;
  if (o.headers) payload.headers = o.headers;

  const headers = {
    authorization: `Bearer ${env.RESEND_API_KEY}`,
    'content-type': 'application/json',
  };
  /* 用事件 id 當冪等鍵：萬一寄成功了但後面 markMailed 失敗（或 Worker 被砍掉）,
     下一輪重送時 Resend 會直接回上次的結果,而不是真的再寄一封。鍵 24 小時後失效。 */
  if (o.idempotencyKey) headers['Idempotency-Key'] = String(o.idempotencyKey).slice(0, 256);

  let res, raw;
  try {
    res = await fetch(API, { method: 'POST', headers, body: JSON.stringify(payload) });
    raw = await res.text();
  } catch (e) {
    return { ok: false, status: 0, code: 'network_error', message: `連線失敗: ${(e && e.message) || e}`, transient: true };
  }

  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch (e) { /* 非 JSON 就退回用原始字串當訊息 */ }

  if (res.ok) return { ok: true, status: res.status, id: (data && data.id) || '' };

  /* Resend 的錯誤是扁的：{ statusCode, name, message },不是包在 error 底下。
     429 有三種 name：rate_limit_exceeded（每秒太快）、daily_quota_exceeded、
     monthly_quota_exceeded,後兩者是當天/當月真的沒額度了。 */
  const code = (data && (data.name || data.code)) || `http_${res.status}`;
  const detail = (data && data.message) || (raw || '').slice(0, 300) || res.statusText;
  return {
    ok: false,
    status: res.status,
    code,
    message: `Resend ${res.status} ${code}: ${detail}`,
    transient: res.status === 429 || res.status >= 500,
    quota: res.status === 429 && /quota/.test(code),
    retryAfter: Number(res.headers.get('retry-after') || res.headers.get('ratelimit-reset')) || 0,
  };
}

/**
 * 把 events 表裡還沒寄出的通知寄掉。給 cron 呼叫。
 * 回 { sent, failed, stopped }；stopped 是提早收工的原因（沒有就是 null）,
 * 方便在 log 上分辨「這輪寄完了」還是「撞到額度只好停手」。
 */
export async function flushMail(env) {
  const rows = await pendingEvents(env.DB, BATCH);
  let sent = 0, failed = 0, stopped = null;

  for (const ev of rows) {
    const to = String(ev.email || '').trim();
    /* 沒 email 的帳號永遠寄不出去,直接標掉,否則每一輪 cron 都會再撈到同一筆。 */
    if (!to) {
      await markMailed(env.DB, ev.id, '使用者沒有 email');
      failed++;
      continue;
    }

    const mail = renderEvent(ev, { name: ev.user_name, email: to }, env);
    /* 逐封 await,不用 Promise.all：Resend 每秒 10 次的上限一次併發 20 封就會撞到,
       而且序列化寄送才有辦法在額度用完的那一封當下就收手。 */
    const r = await sendMail(env, {
      to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      idempotencyKey: ev.id,
      /* 通知信該讓人一眼找得到退訂路徑,對投遞率也有幫助。
         這裡刻意不附 List-Unsubscribe-Post —— 站上沒有免登入的一鍵退訂端點,
         宣告了反而會讓 Gmail 去打一個必然失敗的 POST。 */
      headers: { 'List-Unsubscribe': `<${siteBase(env)}/app.html?page=account>` },
    });

    if (r.ok) {
      await markMailed(env.DB, ev.id, null);
      sent++;
      continue;
    }

    failed++;
    if (r.transient) {
      /* 429（額度或每秒上限）與 5xx：不標記,事件留在佇列裡等下一輪。
         這裡一定要 break —— 額度用完還硬送,只是把剩下的請求也一起撞掉。 */
      stopped = r.code;
      break;
    }
    /* 永久性錯誤（地址格式錯、網域未驗證…）：把理由寫進 mail_error 並標記,
       否則同一筆會卡在佇列最前面,把後面的通知全擋住。 */
    await markMailed(env.DB, ev.id, r.message);
  }

  return { sent, failed, stopped };
}
