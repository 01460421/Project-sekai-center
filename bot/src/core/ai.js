/* 選用的 AI 層（Claude API）。兩種用法：
     narrate(prompt)  占卜／測驗結果多一段個人化解讀（結果本身仍由決定性引擎產生）
     chat({...})      /chat 與 @機器人 的自然語言對話：有系統提示（人設＋使用者資料）、多輪歷史、
                      可呼叫工具（例如替使用者查歌、看餘額、抽塔羅），由這裡跑完整個 tool loop
   沒設 ANTHROPIC_API_KEY 就整個關閉（createAI 回 null），機器人其他功能完全不受影響。

   環境變數：
     ANTHROPIC_API_KEY        必要
     AI_MODEL                 預設 claude-sonnet-5-5（對話型工作量，跟 Sonnet 5 同價、更聰明；要更強可換 claude-opus-5-5）
     AI_DAILY_PER_USER        每人每日「解讀」次數上限，預設 10（台灣時間 00:00 重置）
     AI_CHAT_DAILY_PER_USER   每人每日「對話」次數上限，預設 40
     AI_DAILY_TOTAL           整個機器人每天的 AI 次數總上限（解讀＋對話合計），預設 1500，0 = 不限
   每次呼叫最多等 25 秒、重試 1 次（Discord 的互動 token 有 15 分鐘，但讓人等太久不如直接說忙線）；
   出錯或忙線不扣當日額度。
   Sonnet 5.5、Opus 5／5.5、Fable、Mythos 會自動加上伺服器端 fallback（`fallbacks: "default"`：安全分類器拒答時依類別換備援模型續答）；
   其他模型（例如舊的 Sonnet 5）不送這個參數，拒答就當一般結果處理（回一句「這個話題不方便聊」）。
   思考用預設的 adaptive（Sonnet 5.5 不接受 disabled），深淺由 effort 控制；思考也算進 max_tokens，所以上限留寬一點。 */

import { todayTW } from './ui.js';

const NARRATE_SYSTEM = `你是一位溫暖、有洞察力的占卜師與心理測驗解說員，用繁體中文（台灣用語）寫作。
使用者會給你一段由系統抽出的占卜或測驗結果，請根據那個結果寫一段 120～200 字的個人化解讀：
- 只根據給定的牌面／結果延伸，不要另外抽牌或改結果
- 語氣像朋友聊天，具體、正向但誠實，不要空泛的勵志語
- 結尾給一個今天就能做的小行動
- 不要用標題、不要用條列、不要用 markdown 粗體`;

const FALLBACK_BETAS = ['server-side-fallback-2026-07-01'];
/* 伺服器端 fallback 的 "default" 形式：Sonnet 5.5、Opus 5／5.5、Fable、Mythos 可用；其他模型送了會 400 */
export const supportsFallback = model => /^claude-(opus-5|sonnet-5-5|fable|mythos)/.test(model);

export function createAI(env = process.env, { store, client: injected } = {}) {
  const apiKey = (env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey && !injected) return null;
  const model = (env.AI_MODEL || 'claude-sonnet-5-5').trim();
  const fallback = supportsFallback(model) ? { betas: FALLBACK_BETAS, fallbacks: 'default' } : {};
  const caps = {
    narrate: Math.max(0, parseInt(env.AI_DAILY_PER_USER || '10', 10) || 0),
    chat: Math.max(0, parseInt(env.AI_CHAT_DAILY_PER_USER || '40', 10) || 0),
    total: Math.max(0, parseInt(env.AI_DAILY_TOTAL ?? '1500', 10) || 0),
  };
  let clientPromise = injected ? Promise.resolve(injected) : null, sdk = null;
  /* 429（限流）、529（過載）、逾時：算「忙線」，請使用者等一下再試 */
  const isBusy = e => !!e && ((sdk && (e instanceof sdk.RateLimitError || e instanceof sdk.APIConnectionTimeoutError)) || e.status === 429 || e.status === 529 || (e.error && e.error.type === 'overloaded_error'));

  async function client() {
    if (!clientPromise) clientPromise = import('@anthropic-ai/sdk').then(m => { sdk = m.default; return new m.default({ apiKey, timeout: 25_000, maxRetries: 1 }); });
    return clientPromise;
  }

  /* 每人每日額度：kind = narrate | chat。回傳 true 表示可用（並已記一次）；'user' 是這個人今天用完了，'total' 是整個機器人今天的總量用完了 */
  function take(kind, userId) {
    if (!store) return true;
    const usage = store.global('ai-usage', () => ({}));
    const today = todayTW();
    const key = `${today}:${userId}${kind === 'chat' ? ':chat' : ''}`, tkey = `${today}:*total`;
    const cap = caps[kind];
    if (cap && (usage[key] || 0) >= cap) return 'user';
    if (caps.total && (usage[tkey] || 0) >= caps.total) return 'total';
    usage[key] = (usage[key] || 0) + 1; usage[tkey] = (usage[tkey] || 0) + 1;
    for (const k of Object.keys(usage)) if (!k.startsWith(today)) delete usage[k];
    store.touch();
    return true;
  }
  /* 出錯或忙線：把剛剛扣的那一次還回去 */
  function refund(kind, userId) {
    if (!store) return;
    const usage = store.global('ai-usage', () => ({}));
    const today = todayTW();
    for (const k of [`${today}:${userId}${kind === 'chat' ? ':chat' : ''}`, `${today}:*total`]) if (usage[k] > 0) usage[k]--;
    store.touch();
  }
  function used(kind, userId) {
    if (!store) return 0;
    const usage = store.global('ai-usage', () => ({}));
    return usage[`${todayTW()}:${userId}${kind === 'chat' ? ':chat' : ''}`] || 0;
  }

  const textOf = res => res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();

  return {
    model, caps, enabled: true, used, fallback: !!fallback.fallbacks,
    quota(kind, userId) { return { used: used(kind, userId), cap: caps[kind] }; },

    /* 回傳解讀文字；額度用完或出錯回空字串（呼叫端直接略過即可） */
    async narrate(prompt, { userId = '', maxTokens = 2000 } = {}) {
      if (take('narrate', userId) !== true) return '';
      try {
        const c = await client();
        const res = await c.beta.messages.create({
          model, max_tokens: maxTokens, ...fallback,
          output_config: { effort: 'low' },
          system: NARRATE_SYSTEM,
          messages: [{ role: 'user', content: prompt }],
        });
        if (res.stop_reason === 'refusal') return '';
        return textOf(res) + (res.stop_reason === 'max_tokens' ? '…' : '');
      } catch (e) {
        refund('narrate', userId);
        console.error('[ai] 解讀失敗:', e && e.message ? e.message : e);
        return '';
      }
    },

    /* 對話。system 可以是字串或 [{type:'text', text, cache_control?}]，messages 是 [{role, content}]。
       tools 是 Claude API 的工具定義陣列，runTool(name, input) 回字串（或 { text, extra }），丟例外就回 is_error。
       回傳 { text, quota:false } 額度用完、{ text:'', refused:true } 拒答、{ text, toolExtras:[...] } 正常。
       出錯回 { text:'', error }。 */
    async chat({ system, messages, tools = [], runTool, userId = '', maxTokens = 4000, maxRounds = 4, effort = 'low' }) {
      const ok = take('chat', userId);
      if (ok !== true) return { text: '', quota: false, total: ok === 'total' };
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      const extras = [];
      try {
        const c = await client();
        for (let round = 0; round <= maxRounds; round++) {
          /* 頂層 cache_control：自動快取到最後一個可快取區塊，工具迴圈的每一輪不必重付整段歷史的全價 */
          const req = { model, max_tokens: maxTokens, ...fallback, cache_control: { type: 'ephemeral' }, output_config: { effort }, system, messages: history };
          if (tools.length) req.tools = tools;
          const res = await c.beta.messages.create(req);
          if (res.stop_reason === 'refusal') return { text: '', refused: true };
          const calls = res.content.filter(b => b.type === 'tool_use');
          if (res.stop_reason !== 'tool_use' || !calls.length || !runTool || round === maxRounds) return { text: textOf(res) + (res.stop_reason === 'max_tokens' ? '…' : ''), toolExtras: extras, stop: res.stop_reason };
          history.push({ role: 'assistant', content: res.content });
          const results = [];
          for (const call of calls) {
            try {
              const out = await runTool(call.name, call.input);
              const text = typeof out === 'string' ? out : (out && out.text) || '';
              if (out && out.extra) extras.push(out.extra);
              results.push({ type: 'tool_result', tool_use_id: call.id, content: text || '（沒有輸出）' });
            } catch (e) {
              results.push({ type: 'tool_result', tool_use_id: call.id, content: String((e && e.message) || e).slice(0, 500), is_error: true });
            }
          }
          history.push({ role: 'user', content: results });   // 同一輪的工具結果全部放在同一則 user 訊息
        }
        return { text: '', toolExtras: extras };
      } catch (e) {
        refund('chat', userId);
        console.error('[ai] 對話失敗:', e && e.message ? e.message : e);
        return { text: '', error: String((e && e.message) || e), busy: isBusy(e) };
      }
    },
  };
}
