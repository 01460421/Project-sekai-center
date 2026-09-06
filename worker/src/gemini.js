/* Gemini 供應商。

   這支的唯一職責是「把 Gemini 講成 Anthropic 的話」。
   前端(js/app.js 的泡泡渲染、工具迴圈、wlsScanOne 讀 tool_use)與
   worker/src/chats.js 的存檔全部都講 Anthropic 的 content block,
   所以轉譯一定要做在供應商邊界,不能滲進 UI —— 否則每加一家就要改一次前端。

   對外契約與 chatClaude 完全一致:
     chatGemini(env, { messages, tools, system, profile })
       -> { content, stop_reason, model, tokens_in, tokens_out, cache_write, cache_read }
   content 是 Anthropic 形狀的 block 陣列。

   模型 id 不寫死:Google 的命名換得比 Anthropic 勤,寫死等於埋一顆定時炸彈。
   用 env.AI_GEMINI_MODEL 指定,沒設才退回 DEFAULT_MODEL。
   金鑰沒設就直接拋,由 /api/chat 那邊決定要不要跳過這一路。 */

const DEFAULT_MODEL = 'gemini-2.5-pro';
const MAX_TOKENS = 8000;
const API = 'https://generativelanguage.googleapis.com/v1beta';

const n = (x) => +x || 0;

export const geminiModel = (env) => (env && env.AI_GEMINI_MODEL) || DEFAULT_MODEL;
export const hasGemini = (env) => !!(env && env.GEMINI_API_KEY);

/* ---------- 工具定義:Anthropic -> Gemini ---------- */

/* Gemini 的 functionDeclarations.parameters 只吃 OpenAPI 的子集,
   丟進 JSON Schema 的關鍵字會被整包退掉(400 INVALID_ARGUMENT),
   而且錯誤訊息不會告訴你是哪一個欄位。這裡把已知會被拒的鍵遞迴拿掉。 */
const DROP_KEYS = new Set([
  '$schema', '$id', '$ref', '$comment', 'additionalProperties',
  'default', 'examples', 'const', 'patternProperties', 'definitions', '$defs',
  'minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum',
  'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'pattern', 'format',
]);

function cleanSchema(s) {
  if (Array.isArray(s)) return s.map(cleanSchema);
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const k of Object.keys(s)) {
    if (DROP_KEYS.has(k)) continue;
    out[k] = cleanSchema(s[k]);
  }
  // Gemini 要求 object 一定要有 properties,空的 object 會被退
  if (out.type === 'object' && !out.properties) out.properties = {};
  return out;
}

function toGeminiTools(tools) {
  if (!tools || !tools.length) return null;
  return [{
    functionDeclarations: tools.map((t) => {
      const d = { name: t.name, parameters: cleanSchema(t.input_schema || { type: 'object', properties: {} }) };
      if (t.description) d.description = String(t.description).slice(0, 4000);
      return d;
    }),
  }];
}

/* ---------- 訊息:Anthropic -> Gemini ---------- */

/* Gemini 的 functionResponse 是用「函式名稱」對回去的,不是用 tool_use_id。
   Anthropic 的 tool_result 只帶 id,所以要先掃一遍把 id -> name 記起來,
   否則多工具同輪的回傳會全部對錯家。 */
function toolNameMap(messages) {
  const m = new Map();
  for (const msg of messages || []) {
    if (!Array.isArray(msg.content)) continue;
    for (const b of msg.content) {
      if (b && b.type === 'tool_use' && b.id) m.set(b.id, b.name);
    }
  }
  return m;
}

function blockToPart(b, names) {
  if (typeof b === 'string') return { text: b };
  if (!b || typeof b !== 'object') return null;
  if (b.type === 'text') return { text: String(b.text || '') };
  if (b.type === 'image') {
    const src = b.source || {};
    if (src.type === 'base64' && src.data) {
      return { inlineData: { mimeType: src.media_type || 'image/jpeg', data: src.data } };
    }
    return null;
  }
  if (b.type === 'tool_use') {
    return { functionCall: { name: b.name, args: b.input || {} } };
  }
  if (b.type === 'tool_result') {
    const name = names.get(b.tool_use_id) || b.name || 'tool';
    let payload = b.content;
    if (Array.isArray(payload)) {
      payload = payload.map((c) => (c && c.type === 'text' ? c.text : typeof c === 'string' ? c : '')).join('\n');
    }
    if (typeof payload !== 'string') { try { payload = JSON.stringify(payload); } catch (e) { payload = String(payload); } }
    // functionResponse.response 必須是物件
    return { functionResponse: { name, response: b.is_error ? { error: payload } : { result: payload } } };
  }
  // thinking / redacted_thinking 之類的區塊沒有對應物,丟掉即可
  return null;
}

function toGeminiContents(messages) {
  const names = toolNameMap(messages);
  const out = [];
  for (const m of messages || []) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content || '') }];
    const parts = blocks.map((b) => blockToPart(b, names)).filter(Boolean);
    if (!parts.length) continue;
    // 連續同角色要合併,Gemini 對交替順序比 Anthropic 嚴格
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else out.push({ role, parts });
  }
  return out;
}

/* ---------- 回應:Gemini -> Anthropic ---------- */

function fromGemini(d) {
  const cand = (d && d.candidates && d.candidates[0]) || null;
  const parts = (cand && cand.content && cand.content.parts) || [];
  const content = [];
  let sawTool = false;
  for (const p of parts) {
    if (!p) continue;
    if (typeof p.text === 'string' && p.text !== '') content.push({ type: 'text', text: p.text });
    else if (p.functionCall) {
      sawTool = true;
      content.push({
        // 前端用 id 把 tool_result 配回去,Gemini 不發 id,這裡自己補一個
        type: 'tool_use',
        id: 'gem_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)),
        name: p.functionCall.name,
        input: p.functionCall.args || {},
      });
    }
  }
  const fr = (cand && cand.finishReason) || '';
  const stop = sawTool ? 'tool_use'
    : fr === 'MAX_TOKENS' ? 'max_tokens'
    : fr === 'STOP' ? 'end_turn'
    : fr ? String(fr).toLowerCase() : 'end_turn';
  return { content, stop_reason: stop };
}

/* ---------- 主呼叫 ---------- */

export async function chatGemini(env, { messages, tools, system, profile }) {
  if (!hasGemini(env)) throw new Error('Gemini API：站方尚未設定 GEMINI_API_KEY');
  const model = geminiModel(env);
  const body = {
    contents: toGeminiContents(messages),
    generationConfig: { maxOutputTokens: MAX_TOKENS },
  };
  if (system) body.systemInstruction = { parts: [{ text: String(system) }] };
  const gt = toGeminiTools(tools);
  if (gt) body.tools = gt;
  /* vision 這個 profile 在 Claude 那邊是「換小模型、關思考」。Gemini 沒有等價的
     thinking 開關可關(2.5 系列的 thinkingBudget 各模型支援度不一),所以只降
     溫度求穩定,不去動模型 —— 認錯模型名稱會 404,比慢一點糟得多。 */
  if (profile === 'vision') body.generationConfig.temperature = 0;

  const r = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const raw = await r.text();
  let d = null; try { d = JSON.parse(raw); } catch (e) {}
  if (!r.ok) {
    const err = (d && d.error) || {};
    const msg = err.message || raw.slice(0, 300);
    const st = err.status || '';
    /* 跟 Claude 那邊一樣:把「該去做什麼」寫進訊息,不要只丟原文。
       404 在 Gemini 幾乎都是模型 id 不對,而那正是最容易踩的一顆。 */
    const hint = r.status === 404
      ? `（找不到模型「${model}」，請用 /admin/diag/gemini 看這把金鑰可用的模型，再設 AI_GEMINI_MODEL）`
      : r.status === 429 ? '（超過速率上限或當期額度，稍後再試）'
      : r.status === 403 ? '（金鑰權限不足或該地區未開放，請檢查 Google AI Studio 的金鑰設定）'
      : r.status === 400 && /API key/i.test(msg) ? '（API 金鑰無效）'
      : '';
    throw new Error('Gemini API ' + r.status + (st ? ' ' + st : '') + '：' + msg + hint);
  }
  const { content, stop_reason } = fromGemini(d);
  const u = (d && d.usageMetadata) || {};
  return {
    content, stop_reason,
    model: (d && d.modelVersion) || model,
    tokens_in: n(u.promptTokenCount), tokens_out: n(u.candidatesTokenCount),
    // Gemini 的隱式快取不另外收寫入費,所以 cache_write 恆為 0
    cache_write: 0, cache_read: n(u.cachedContentTokenCount),
  };
}

/* 診斷用:列出這把金鑰真的看得到的模型。
   /admin/diag/gemini 會用到 —— 第一次接上時最常見的錯就是模型 id 不對。 */
export async function listGeminiModels(env) {
  if (!hasGemini(env)) throw new Error('尚未設定 GEMINI_API_KEY');
  const r = await fetch(`${API}/models`, {
    headers: { 'x-goog-api-key': env.GEMINI_API_KEY },
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await r.text();
  let d = null; try { d = JSON.parse(raw); } catch (e) {}
  if (!r.ok) throw new Error('Gemini ListModels ' + r.status + '：' + (((d || {}).error || {}).message || raw.slice(0, 300)));
  return ((d && d.models) || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''));
}
