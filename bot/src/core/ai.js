/* 選用的 AI 層（Claude API）。兩種用法：
     narrate(prompt)  占卜／測驗結果多一段個人化解讀（結果本身仍由決定性引擎產生）
     chat({...})      /chat 與 @機器人 的自然語言對話：有系統提示（人設＋使用者資料）、多輪歷史、
                      可呼叫工具（例如替使用者查歌、看餘額、抽塔羅），由這裡跑完整個 tool loop
   沒設 ANTHROPIC_API_KEY 就整個關閉（createAI 回 null），機器人其他功能完全不受影響。

   環境變數：
     ANTHROPIC_API_KEY        必要
     AI_MODEL                 預設 claude-sonnet-5（對話型工作量，便宜、夠聰明）
     AI_DAILY_PER_USER        每人每日「解讀」次數上限，預設 10（台灣時間 00:00 重置）
     AI_CHAT_DAILY_PER_USER   每人每日「對話」次數上限，預設 40
   模型換成 claude-opus-5 或 Fable 系列時，會自動加上伺服器端 fallback（安全分類器拒答時換備援模型續答）；
   Sonnet 5 不送這個參數，拒答就當一般結果處理（回一句「這個話題不方便聊」）。 */

import { todayTW } from './ui.js';

const NARRATE_SYSTEM = `你是一位溫暖、有洞察力的占卜師與心理測驗解說員，用繁體中文（台灣用語）寫作。
使用者會給你一段由系統抽出的占卜或測驗結果，請根據那個結果寫一段 120～200 字的個人化解讀：
- 只根據給定的牌面／結果延伸，不要另外抽牌或改結果
- 語氣像朋友聊天，具體、正向但誠實，不要空泛的勵志語
- 結尾給一個今天就能做的小行動
- 不要用標題、不要用條列、不要用 markdown 粗體`;

const FALLBACK_BETAS = ['server-side-fallback-2026-07-01'];
/* 伺服器端 fallback 目前只保證 Opus 5／Fable／Mythos 系列可用；其他模型送了可能 400 */
export const supportsFallback = model => /^claude-(opus-5|fable|mythos)/.test(model);

export function createAI(env = process.env, { store, client: injected } = {}) {
  const apiKey = (env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey && !injected) return null;
  const model = (env.AI_MODEL || 'claude-sonnet-5').trim();
  const fallback = supportsFallback(model) ? { betas: FALLBACK_BETAS, fallbacks: 'default' } : {};
  const caps = {
    narrate: Math.max(0, parseInt(env.AI_DAILY_PER_USER || '10', 10) || 0),
    chat: Math.max(0, parseInt(env.AI_CHAT_DAILY_PER_USER || '40', 10) || 0),
  };
  let clientPromise = injected ? Promise.resolve(injected) : null;

  async function client() {
    if (!clientPromise) clientPromise = import('@anthropic-ai/sdk').then(m => new m.default({ apiKey }));
    return clientPromise;
  }

  /* 每人每日額度：kind = narrate | chat。回傳 true 表示可用（並已記一次）。 */
  function take(kind, userId) {
    const cap = caps[kind];
    if (!store || !cap) return true;
    const usage = store.global('ai-usage', () => ({}));
    const today = todayTW();
    const key = `${today}:${userId}${kind === 'chat' ? ':chat' : ''}`;
    if ((usage[key] || 0) >= cap) return false;
    usage[key] = (usage[key] || 0) + 1;
    for (const k of Object.keys(usage)) if (!k.startsWith(today)) delete usage[k];
    store.touch();
    return true;
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
    async narrate(prompt, { userId = '', maxTokens = 600 } = {}) {
      if (!take('narrate', userId)) return '';
      try {
        const c = await client();
        const res = await c.beta.messages.create({
          model, max_tokens: maxTokens, ...fallback,
          output_config: { effort: 'low' },
          system: NARRATE_SYSTEM,
          messages: [{ role: 'user', content: prompt }],
        });
        if (res.stop_reason === 'refusal') return '';
        return textOf(res);
      } catch (e) {
        console.error('[ai] 解讀失敗:', e && e.message ? e.message : e);
        return '';
      }
    },

    /* 對話。system 可以是字串或 [{type:'text', text, cache_control?}]，messages 是 [{role, content}]。
       tools 是 Claude API 的工具定義陣列，runTool(name, input) 回字串（或 { text, extra }），丟例外就回 is_error。
       回傳 { text, quota:false } 額度用完、{ text:'', refused:true } 拒答、{ text, toolExtras:[...] } 正常。
       出錯回 { text:'', error }。 */
    async chat({ system, messages, tools = [], runTool, userId = '', maxTokens = 1024, maxRounds = 4, effort = 'low' }) {
      if (!take('chat', userId)) return { text: '', quota: false };
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      const extras = [];
      try {
        const c = await client();
        for (let round = 0; round <= maxRounds; round++) {
          const req = { model, max_tokens: maxTokens, ...fallback, output_config: { effort }, system, messages: history };
          if (tools.length) req.tools = tools;
          const res = await c.beta.messages.create(req);
          if (res.stop_reason === 'refusal') return { text: '', refused: true };
          const calls = res.content.filter(b => b.type === 'tool_use');
          if (res.stop_reason !== 'tool_use' || !calls.length || !runTool || round === maxRounds) return { text: textOf(res), toolExtras: extras, stop: res.stop_reason };
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
        console.error('[ai] 對話失敗:', e && e.message ? e.message : e);
        return { text: '', error: String((e && e.message) || e) };
      }
    },
  };
}
