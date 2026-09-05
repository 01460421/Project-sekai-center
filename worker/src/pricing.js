/* 官方定價(USD／百萬 token),2026-09 查自 docs.claude.com/en/docs/about-claude/pricing。
   欄位:[輸入, 輸出, 快取寫入(5 分鐘), 快取讀取]。
   要調整不必改程式:設 env.AI_PRICES 為 JSON 物件,例如
   AI_PRICES = '{"claude-opus-5":[5,25,6.25,0.5]}',同名鍵覆蓋這裡的預設。
   模型 id 用前綴比對,帶日期尾碼的版本(claude-haiku-4-5-20251001)也對得到。 */
const DEFAULT_PRICES = {
  'claude-fable-5-1': [10, 50, 12.5, 0.25],
  'claude-fable-5':   [10, 50, 12.5, 1],
  'claude-opus-5':    [5, 25, 6.25, 0.5],
  'claude-sonnet-5':  [2, 10, 2.5, 0.2],
  'claude-haiku-4-5': [1, 5, 1.25, 0.1],
  'claude-opus-4':    [5, 25, 6.25, 0.5],
  'claude-sonnet-4':  [3, 15, 3.75, 0.3],
};

function table(env) {
  let extra = {};
  try { const j = JSON.parse(String((env && env.AI_PRICES) || '')); if (j && typeof j === 'object') extra = j; } catch (e) {}
  return Object.assign({}, DEFAULT_PRICES, extra);
}

export function priceOf(model, env) {
  const T = table(env);
  const m = String(model || (env && env.AI_MODEL) || '');
  if (T[m]) return T[m];
  // 前綴比對:先長後短,免得 claude-opus-4 搶走 claude-opus-4-5
  const keys = Object.keys(T).sort((a, b) => b.length - a.length);
  const k = keys.find(k => m.startsWith(k));
  return k ? T[k] : (T[String((env && env.AI_MODEL) || '')] || T['claude-opus-5']);
}

/* 一筆或一組彙總列 → 美元。列的欄位:tokens_in / tokens_out / cache_read / cache_write。 */
export function costUsd(row, env) {
  const p = priceOf(row.model, env);
  const n = x => +x || 0;
  return (n(row.tokens_in) * p[0] + n(row.tokens_out) * p[1] + n(row.cache_write) * p[2] + n(row.cache_read) * p[3]) / 1e6;
}

/* 把 GROUP BY model 的彙總列合成一份摘要。 */
export function summarize(rows, env) {
  const s = { calls: 0, tokens_in: 0, tokens_out: 0, cache_read: 0, cache_write: 0, cost_usd: 0, by_model: [] };
  for (const r of rows || []) {
    const c = costUsd(r, env);
    s.calls += +r.calls || 0;
    s.tokens_in += +r.tokens_in || 0; s.tokens_out += +r.tokens_out || 0;
    s.cache_read += +r.cache_read || 0; s.cache_write += +r.cache_write || 0;
    s.cost_usd += c;
    s.by_model.push({ model: r.model || '', calls: +r.calls || 0, cost_usd: round(c) });
  }
  s.cost_usd = round(s.cost_usd);
  s.by_model.sort((a, b) => b.cost_usd - a.cost_usd);
  return s;
}
const round = x => Math.round(x * 10000) / 10000;
