/* 豆森 AI 顧問（/api/mysekai/design）的純函式：整理輸入、組提示詞、把模型回的 JSON 洗成擺設清單。
   跟 Gemini／Claude 的呼叫分開寫，測試（worker/test/mysekai.mjs）才不用真的打模型。

   前端（mystudio.html 的內部設計分頁）送：
     { prompt: '想要的風格與需求', site: { key, name, kind: home|room|any, w, d, h },
       cat: [[家具id, 名稱, 寬, 深, 高, 分類名]…]（已依場地過濾、最多 1500 筆）,
       current: [[家具id, x, y, rot, z]…]（選填：要在現有擺設上調整時帶）, lang }
   模型要回純 JSON：{ title, concept, items: [{ fid, x, y, rot, note }], tips: [] }
   這裡只保留目錄裡有的家具、座標夾進場地；高度（堆疊）由前端的 place() 算，模型只管平面位置與順序。 */

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v, lo, hi, d) => { const n = Math.round(+v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n) : '');

export const DESIGN_MAX_CAT = 1500;
export const DESIGN_MAX_ITEMS = 160;

export function cleanDesignBody(body) {
  if (!isObj(body)) return { error: 'bad_request', message: '格式錯誤' };
  const prompt = str(body.prompt, 1200).trim();
  if (prompt.length < 2) return { error: 'bad_request', message: '請描述想要的風格或需求' };
  const s = isObj(body.site) ? body.site : {};
  const site = { key: str(s.key, 24) || 'custom', name: str(s.name, 40) || '自訂場地', kind: ['home', 'room', 'any'].includes(s.kind) ? s.kind : 'any',
    w: int(s.w, 4, 150, 36), d: int(s.d, 4, 150, 36), h: int(s.h, 1, 30, 15) };
  const cat = [];
  if (Array.isArray(body.cat)) for (const r of body.cat.slice(0, DESIGN_MAX_CAT)) {
    if (!Array.isArray(r)) continue;
    const id = int(r[0], 1, 99999999, 0); if (!id) continue;
    cat.push([id, str(r[1], 40) || ('#' + id), int(r[2], 1, 50, 1), int(r[3], 1, 50, 1), int(r[4], 1, 30, 1), str(r[5], 16)]);
  }
  if (cat.length < 5) return { error: 'bad_request', message: '家具目錄太短' };
  const current = [];
  if (Array.isArray(body.current)) for (const r of body.current.slice(0, DESIGN_MAX_ITEMS)) {
    if (!Array.isArray(r)) continue;
    const fid = int(r[0], 1, 99999999, 0); if (!fid) continue;
    current.push([fid, int(r[1], 0, 149, 0), int(r[2], 0, 149, 0), int(r[3], 0, 3, 0), int(r[4], 0, 29, 0)]);
  }
  return { prompt, site, cat, current, lang: str(body.lang, 8) || 'zh' };
}

const KIND_NOTE = { home: '這是「我的家」的戶外庭院（family: home）：可以用道路、瓷磚、柵欄、樹木與大型建築；整體要像一個有動線的院子。',
  room: '這是室內房間（family: room）：牆面在 y=0（後牆）與 x=0（左牆），大件家具靠牆擺，中間留走道；不能用家前限定的瓷磚、道路與柵欄。',
  any: '這是戶外採集地：空間很大，重點是主題區塊與路徑，不要把家具平均撒滿。' };

/* 提示詞：場地規格 + 目錄 + 需求。目錄一列一件，只給模型需要的欄位；分類名幫它挑「同一風格系列」（名稱前的 [xxx風] 就是系列）。 */
export function buildDesignMessages({ prompt, site, cat, current, lang }) {
  const system = [
    '你是 Project SEKAI「MySekai（豆森）」的室內與庭院設計顧問。玩家會描述想要的風格或用途，你要用「家具目錄」裡的家具排出一套可以直接照做的擺設。',
    '座標系：場地是 ' + site.w + '（x，寬）×' + site.d + '（y，深）格，高度上限 ' + site.h + ' 層。x 從 0 到 ' + (site.w - 1) + '，y 從 0 到 ' + (site.d - 1) + '，(0,0) 是左後角。每件家具佔 寬×深 格（rot=1 或 3 時寬深互換），左上角座標是 (x,y)，必須整件落在場地內。',
    KIND_NOTE[site.kind] || KIND_NOTE.any,
    '堆疊：清單順序就是擺放順序；後放的家具若與前面的家具腳印重疊，會自動疊到它上面（例如先放桌子，再在桌子範圍內放小物）。不要把大件疊在小件上。',
    '原則：同一風格盡量用同系列（名稱前的 [系列名]）；大件先排、小件後排；留出走道，不要讓家具互相卡死；數量依場地大小，房間 15～45 件、庭院 30～90 件；每件都要說得出為什麼放那裡。',
    '只能用目錄裡的家具 id，不要發明。回答只能是一段 JSON，不要任何說明文字、不要 Markdown 圍欄：',
    '{"title":"設計名稱","concept":"兩三句整體概念","items":[{"fid":123,"x":0,"y":0,"rot":0,"note":"為什麼放這裡（可省略）"}],"tips":["給玩家的施工或採集建議，最多 4 條"]}',
    lang === 'en' ? 'Write title/concept/notes/tips in English.' : lang === 'ja' ? 'title／concept／note／tips は日本語で。' : 'title、concept、note、tips 用繁體中文。',
  ].join('\n');
  const catText = cat.map(r => r[0] + '|' + r[1] + '|' + r[2] + 'x' + r[3] + 'x' + r[4] + (r[5] ? '|' + r[5] : '')).join('\n');
  const cur = current && current.length ? '\n\n目前已經擺的家具（id,x,y,rot,z），請在這個基礎上依需求調整，回傳「完整的新清單」（要保留的也要列出來）：\n' + current.map(r => r.join(',')).join('\n') : '';
  const user = '場地：' + site.name + '（' + site.w + '×' + site.d + '×' + site.h + '，' + site.kind + '）\n\n家具目錄（id|名稱|寬x深x高|分類）：\n' + catText + cur + '\n\n玩家的需求：\n' + prompt + '\n\n請回 JSON。';
  return { system, messages: [{ role: 'user', content: [{ type: 'text', text: user }] }], tools: [], profile: null, providers: null };
}

/* 把模型的回答洗成清單：找出第一段 JSON（容忍圍欄與前後廢話）、丟掉目錄外的 id、座標夾進場地。 */
export function parseDesign(text, cat, site) {
  const byId = new Map(cat.map(r => [r[0], r]));
  let raw = String(text || '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw); if (fence) raw = fence[1].trim();
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a < 0 || b <= a) return { error: 'no_json', message: '模型沒有回 JSON' };
  let o; try { o = JSON.parse(raw.slice(a, b + 1)); } catch (e) {
    try { o = JSON.parse(raw.slice(a, b + 1).replace(/,\s*([}\]])/g, '$1')); } catch (e2) { return { error: 'bad_json', message: '模型回的 JSON 解析失敗' }; }
  }
  if (!isObj(o)) return { error: 'bad_json', message: '模型回的不是物件' };
  const items = [], dropped = [];
  for (const it of (Array.isArray(o.items) ? o.items : []).slice(0, DESIGN_MAX_ITEMS)) {
    if (!isObj(it)) continue;
    const fid = int(it.fid != null ? it.fid : it.id, 1, 99999999, 0), r = byId.get(fid);
    if (!r) { dropped.push(fid); continue; }
    const rot = int(it.rot, 0, 3, 0), w = rot % 2 ? r[3] : r[2], d = rot % 2 ? r[2] : r[3];
    if (w > site.w || d > site.d || r[4] > site.h) { dropped.push(fid); continue; }
    items.push({ fid, x: int(it.x, 0, site.w - w, 0), y: int(it.y, 0, site.d - d, 0), rot, note: str(it.note, 80) });
  }
  if (!items.length) return { error: 'empty', message: '模型沒有排出任何可用的家具', dropped };
  return { title: str(o.title, 40) || '設計案', concept: str(o.concept, 600), items, tips: (Array.isArray(o.tips) ? o.tips : []).map(t => str(t, 160)).filter(Boolean).slice(0, 4), dropped };
}
