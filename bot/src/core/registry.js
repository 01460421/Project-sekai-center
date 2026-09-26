/* 功能註冊表：每個功能是一個物件（見 features/README 段落），這裡負責驗證、彙整成 Discord 指令 JSON、
   以及提供分類清單給 /help。 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CATEGORIES = {
  divination: { name: '占卜算命', emoji: '🔮' },
  personality: { name: '性格測驗', emoji: '🧠' },
  social: { name: '社交互動', emoji: '💞' },
  games: { name: '小遊戲', emoji: '🎮' },
  fun: { name: '趣味', emoji: '🎉' },
  economy: { name: '經濟', emoji: '💎' },
  gacha: { name: '轉蛋收藏', emoji: '🎰' },
  quiz: { name: '問答與音樂', emoji: '🎵' },
  community: { name: '等級與社群', emoji: '🏆' },
  server: { name: '伺服器', emoji: '⚙️' },
};

const NAME_RE = /^[a-z0-9_-]{1,32}$/;

function validateOption(o, where) {
  if (!o || typeof o !== 'object') throw new Error(`${where}: 參數不是物件`);
  if (!NAME_RE.test(o.name)) throw new Error(`${where}: 參數名稱不合法 ${o.name}`);
  if (!o.description || o.description.length > 100) throw new Error(`${where}.${o.name}: 說明長度需 1~100`);
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(o.type)) throw new Error(`${where}.${o.name}: 型別碼錯誤`);
  if (o.choices && o.choices.length > 25) throw new Error(`${where}.${o.name}: 選項最多 25 個`);
  if (o.options) for (const s of o.options) validateOption(s, `${where}.${o.name}`);
}

export function validateFeature(f) {
  if (!f || typeof f !== 'object') throw new Error('功能不是物件');
  if (!NAME_RE.test(f.name)) throw new Error(`功能名稱不合法：${f.name}`);
  if (!f.description || f.description.length > 100) throw new Error(`${f.name}: 說明長度需 1~100`);
  if (!CATEGORIES[f.category]) throw new Error(`${f.name}: 未知分類 ${f.category}`);
  if (typeof f.run !== 'function') throw new Error(`${f.name}: 缺 run()`);
  for (const o of f.options || []) validateOption(o, f.name);
  const subs = (f.options || []).filter(o => o.type === 1);
  if (subs.length && subs.length !== (f.options || []).length) throw new Error(`${f.name}: 子指令不能與一般參數混用`);
  for (const k of ['buttons', 'selects', 'modals']) if (f[k] && typeof f[k] !== 'object') throw new Error(`${f.name}: ${k} 要是物件`);
  return true;
}

export class Registry {
  constructor() { this.features = []; this.byName = new Map(); }
  add(f) {
    validateFeature(f);
    if (this.byName.has(f.name)) throw new Error(`功能名稱重複：${f.name}`);
    this.features.push(f);
    this.byName.set(f.name, f);
    return f;
  }
  get(name) { return this.byName.get(name); }
  get size() { return this.features.length; }
  byCategory() {
    const out = {};
    for (const key of Object.keys(CATEGORIES)) out[key] = [];
    for (const f of this.features) out[f.category].push(f);
    return out;
  }
  /* Discord 註冊用 JSON */
  commandJSON() {
    return this.features.map(f => {
      const c = { name: f.name, description: f.description, type: 1, options: f.options || [] };
      if (f.guildOnly !== false) c.dm_permission = false;
      if (f.admin) c.default_member_permissions = String(0x20);   // MANAGE_GUILD
      if (f.nsfw) c.nsfw = true;
      return c;
    });
  }
  /* 讀 features/ 目錄下所有檔案（依檔名排序），每個檔案 default export 是功能陣列 */
  static async loadDir(dir) {
    const reg = new Registry();
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();
    for (const file of files) {
      const mod = await import(pathToFileURL(path.join(dir, file)).href);
      const list = mod.default;
      if (!Array.isArray(list)) throw new Error(`${file}: default export 要是功能陣列`);
      for (const f of list) { f.file = file; reg.add(f); }
    }
    return reg;
  }
  static defaultDir() { return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'features'); }
}
