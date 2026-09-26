/* 選用的 AI 解讀層：占卜／測驗的結果本身由決定性引擎產生，這裡只是「多加一段個人化解讀」。
   沒設 ANTHROPIC_API_KEY 就整個關閉（narrate 回空字串），機器人其他功能完全不受影響。

   金鑰與模型都從環境變數來：
     ANTHROPIC_API_KEY   必要
     AI_MODEL            預設 claude-opus-5
     AI_DAILY_PER_USER   每人每日次數上限，預設 10（台灣時間 00:00 重置）
   啟用時會加上伺服器端 fallback（安全分類器拒答時自動換備援模型續答）。 */

import { todayTW } from './ui.js';

const SYSTEM = `你是一位溫暖、有洞察力的占卜師與心理測驗解說員，用繁體中文（台灣用語）寫作。
使用者會給你一段由系統抽出的占卜或測驗結果，請根據那個結果寫一段 120～200 字的個人化解讀：
- 只根據給定的牌面／結果延伸，不要另外抽牌或改結果
- 語氣像朋友聊天，具體、正向但誠實，不要空泛的勵志語
- 結尾給一個今天就能做的小行動
- 不要用標題、不要用條列、不要用 markdown 粗體`;

export function createAI(env = process.env, { store } = {}) {
  const apiKey = (env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) return null;
  const model = (env.AI_MODEL || 'claude-opus-5').trim();
  const cap = Math.max(0, parseInt(env.AI_DAILY_PER_USER || '10', 10) || 0);
  let clientPromise = null;

  async function client() {
    if (!clientPromise) {
      clientPromise = import('@anthropic-ai/sdk').then(m => new m.default({ apiKey }));
    }
    return clientPromise;
  }

  return {
    model,
    enabled: true,
    /* 回傳解讀文字；額度用完或出錯回空字串（呼叫端直接略過即可） */
    async narrate(prompt, { userId = '', maxTokens = 600 } = {}) {
      if (store && cap) {
        const usage = store.global('ai-usage', () => ({}));
        const key = `${todayTW()}:${userId}`;
        if ((usage[key] || 0) >= cap) return '';
        usage[key] = (usage[key] || 0) + 1;
        for (const k of Object.keys(usage)) if (!k.startsWith(todayTW())) delete usage[k];
        store.touch();
      }
      try {
        const c = await client();
        const res = await c.beta.messages.create({
          model,
          max_tokens: maxTokens,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low' },
          system: SYSTEM,
          messages: [{ role: 'user', content: prompt }],
        });
        if (res.stop_reason === 'refusal') return '';
        return res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      } catch (e) {
        console.error('[ai] 解讀失敗:', e && e.message ? e.message : e);
        return '';
      }
    },
  };
}
