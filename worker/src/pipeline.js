/* 資料管線健康檢查：每小時看一次 GitHub Actions 的執行紀錄，排程工作失敗或太久沒成功就通知管理員。

   為什麼需要：榜線模型從 9/28 起靜靜壞了五週、卡面指紋停在 #1271 幾個月，都是翻程式才發現。
   GitHub 自己只會在「工作失敗」時寄信給觸發者；「排程根本沒跑」（repo 60 天沒動排程會被停掉、
   排程漂移）與「成功但沒產出」它不會說。這裡補的就是「多久沒成功」這一項。

   通知走既有的 events 表（站內通知 + Resend 寄信 + 瀏覽器推播），每位管理員一筆；
   狀態存 ops_state，同一個失敗只通知一次、恢復時再通知一次、太久沒成功每天最多一次。
   /ops/status 把最近一次檢查結果公開（給網站的「系統狀態」頁），不含任何個資。

   GitHub API 沒 token 時每個 IP 每小時 60 次；Workers 的出口 IP 是共用的，有設 GITHUB_TOKEN
   （只要 public repo 的讀取權）會穩很多。拿不到就沿用上一次的結果，不會誤報。 */

import { addEvent } from './db.js';
import { stateGet, stateSet, dayKey } from './telemetry.js';

export const REPO = '01460421/Project-sekai-center';
const UA = 'project-sekai-center/1.0 (+https://project-sekai-center.com) pipeline-check';

/* 排程工作：多久沒成功算異常（小時）。沒列在這裡的工作只看「最新一次有沒有失敗」。 */
export const SCHEDULED = {
  'billing-refresh.yml': { label: '儲值商品與每日資料更新', every: '每日', maxAgeH: 36 },
  'ep-songs-refresh.yml': { label: 'EP 曲庫與圖鑑索引更新', every: '每日', maxAgeH: 36 },
  'bot-deploy.yml': { label: '機器人部署', every: '每日', maxAgeH: 36 },
  'border-snapshot.yml': { label: '榜線快照', every: '每 30 分鐘', maxAgeH: 3 },
  'canary.yml': { label: '正式站探針', every: '每小時', maxAgeH: 3 },
};
const LABELS = { 'ci.yml': 'CI 測試', 'og-refresh.yml': '分享預覽圖', 'worker-deploy.yml': 'Worker 部署', 'worker-push-setup.yml': 'Worker 推播設定', 'd1-migrate.yml': 'D1 遷移', 'live-games.yml': '逐局紀錄（手動）' };
const BAD = new Set(['failure', 'timed_out', 'startup_failure']);

export async function fetchRuns(env) {
  const h = { 'user-agent': UA, accept: 'application/vnd.github+json' };
  if (env.GITHUB_TOKEN) h.authorization = 'Bearer ' + env.GITHUB_TOKEN;
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/runs?per_page=100`, { headers: h, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('GitHub API HTTP ' + r.status);
  const j = await r.json();
  return Array.isArray(j.workflow_runs) ? j.workflow_runs : [];
}

/* 把 runs 整理成每個 workflow 一列。純函式，測試直接餵假資料。 */
export function summarize(runs, nowMs) {
  const now = nowMs == null ? Date.now() : nowMs;
  const by = {};
  for (const r of runs) {
    const file = String(r.path || '').split('/').pop();
    if (!file) continue;
    const w = by[file] || (by[file] = { file, name: r.name || file, latest: null, lastDone: null, lastOk: null });
    const t = Date.parse(r.updated_at || r.created_at || 0) || 0;
    const item = { id: r.id, status: r.status, conclusion: r.conclusion || null, t, url: r.html_url, event: r.event, title: r.display_title };
    if (!w.latest || t > w.latest.t) w.latest = item;
    if (r.status === 'completed' && (!w.lastDone || t > w.lastDone.t)) w.lastDone = item;
    if (r.status === 'completed' && r.conclusion === 'success' && (!w.lastOk || t > w.lastOk.t)) w.lastOk = item;
  }
  const out = [];
  const files = new Set([...Object.keys(SCHEDULED), ...Object.keys(by)]);
  for (const file of files) {
    const w = by[file] || { file, name: file, latest: null, lastDone: null, lastOk: null };
    const spec = SCHEDULED[file];
    const okAgeH = w.lastOk ? (now - w.lastOk.t) / 3600e3 : null;
    let state = 'ok';
    if (w.lastDone && BAD.has(w.lastDone.conclusion)) state = 'fail';
    if (spec && (okAgeH == null || okAgeH > spec.maxAgeH)) state = state === 'fail' ? 'fail' : 'stale';
    out.push({
      file, label: (spec && spec.label) || LABELS[file] || w.name, scheduled: !!spec, every: spec ? spec.every : '',
      maxAgeH: spec ? spec.maxAgeH : null, state,
      running: !!(w.latest && w.latest.status !== 'completed'),
      lastOkAt: w.lastOk ? w.lastOk.t : null, lastDoneAt: w.lastDone ? w.lastDone.t : null,
      lastConclusion: w.lastDone ? w.lastDone.conclusion : null, lastUrl: (w.lastDone || w.latest || {}).url || null,
      lastRunId: w.lastDone ? w.lastDone.id : null, lastTitle: (w.lastDone || w.latest || {}).title || '',
    });
  }
  // 排程的排前面，再依狀態（壞的在前）、名稱
  const rank = { fail: 0, stale: 1, ok: 2 };
  out.sort((a, b) => (b.scheduled - a.scheduled) || (rank[a.state] - rank[b.state]) || a.label.localeCompare(b.label));
  return out;
}

const hours = ms => ms == null ? '—' : (ms / 3600e3 >= 48 ? Math.round(ms / 86400e3) + ' 天' : Math.round(ms / 3600e3 * 10) / 10 + ' 小時');

/* 跟上次的狀態比，決定要發哪些通知。純函式：回 [{key, title, body}]，呼叫端負責存 key 避免重發。 */
export function diffAlerts(items, prev, nowMs, today) {
  const now = nowMs == null ? Date.now() : nowMs;
  const alerts = [];
  for (const it of items) {
    const was = prev[it.file] || 'ok';
    if (it.state === 'fail' && it.lastRunId) {
      alerts.push({ key: 'fail:' + it.file + ':' + it.lastRunId, title: `資料管線失敗：${it.label}`,
        body: `${it.label}（${it.file}）最新一次執行結果是 ${it.lastConclusion}。\n${it.lastTitle ? '工作：' + it.lastTitle + '\n' : ''}${it.lastUrl || ''}\n上次成功：${it.lastOkAt ? hours(now - it.lastOkAt) + '前' : '沒有紀錄'}` });
    } else if (it.state === 'stale') {
      alerts.push({ key: 'stale:' + it.file + ':' + today, title: `資料管線太久沒成功：${it.label}`,
        body: `${it.label}（${it.file}，${it.every}）已經 ${it.lastOkAt ? hours(now - it.lastOkAt) : '找不到成功紀錄'} 沒有成功執行（門檻 ${it.maxAgeH} 小時）。\n可能是排程被 GitHub 停掉（repo 60 天沒活動）、排程漂移，或每次都失敗。\n${it.lastUrl || ''}` });
    } else if (it.state === 'ok' && was !== 'ok') {
      alerts.push({ key: 'ok:' + it.file + ':' + (it.lastRunId || today), title: `資料管線恢復：${it.label}`,
        body: `${it.label}（${it.file}）又成功了。\n${it.lastUrl || ''}` });
    }
  }
  return alerts;
}

/* 每小時由 cron 呼叫 */
export async function checkPipeline(env, opts) {
  const db = env.DB;
  const now = Date.now();
  let runs;
  try { runs = await fetchRuns(env); }
  catch (e) {
    await stateSet(db, 'pipeline:error', String((e && e.message) || e).slice(0, 200));
    return { ok: false, error: (e && e.message) || String(e) };
  }
  const items = summarize(runs, now);
  const prevRow = await stateGet(db, 'pipeline:states');
  let prev = {};
  try { prev = prevRow ? JSON.parse(prevRow.val) : {}; } catch (e) { prev = {}; }
  const alerts = diffAlerts(items, prev, now, dayKey(now));
  const admins = (opts && opts.admins) || await listAdmins(db);
  let sent = 0;
  for (const a of alerts) {
    if (await stateGet(db, 'alert:' + a.key)) continue;   // 已通知過
    await stateSet(db, 'alert:' + a.key, '1');
    for (const u of admins) {
      await addEvent(db, { watch_id: 'pipeline', user_id: u.id, title: a.title, body: a.body });
      sent++;
    }
  }
  const states = {}; items.forEach(it => { states[it.file] = it.state; });
  await stateSet(db, 'pipeline:states', JSON.stringify(states));
  await stateSet(db, 'pipeline:summary', JSON.stringify({ checkedAt: now, items }));
  await stateSet(db, 'pipeline:error', '');
  return { ok: true, items, alerts, sent };
}

async function listAdmins(db) {
  const r = await db.prepare("SELECT id FROM users WHERE is_admin = 1 AND status = 'approved'").all();
  return (r && r.results) || [];
}

/* 公開的狀態：最近一次檢查結果，給「系統狀態」頁。 */
export async function pipelineStatus(env) {
  const db = env.DB;
  const s = await stateGet(db, 'pipeline:summary');
  const err = await stateGet(db, 'pipeline:error');
  let data = null;
  try { data = s ? JSON.parse(s.val) : null; } catch (e) { data = null; }
  return { checkedAt: data ? data.checkedAt : null, items: data ? data.items : [], error: err && err.val ? err.val : '' };
}
