/* 斜線指令參數的簡寫（輸出 Discord API 原生 option 物件）。
   類型碼：1 子指令、3 字串、4 整數、5 布林、6 使用者、7 頻道、10 小數 */

const base = (type, name, description, extra = {}) => {
  const o = { type, name, description: String(description).slice(0, 100) };
  if (extra.required) o.required = true;
  if (extra.choices) o.choices = extra.choices.map(c => Array.isArray(c) ? { name: c[0], value: c[1] } : (typeof c === 'string' ? { name: c, value: c } : c));
  if (extra.autocomplete) o.autocomplete = true;
  if (extra.min != null) o.min_value = extra.min;
  if (extra.max != null) o.max_value = extra.max;
  if (extra.minLen != null) o.min_length = extra.minLen;
  if (extra.maxLen != null) o.max_length = extra.maxLen;
  return o;
};

export const str = (name, description, extra) => base(3, name, description, extra);
export const int = (name, description, extra) => base(4, name, description, extra);
export const bool = (name, description, extra) => base(5, name, description, extra);
export const user = (name, description, extra) => base(6, name, description, extra);
export const channel = (name, description, extra) => base(7, name, description, extra);
export const number = (name, description, extra) => base(10, name, description, extra);
export const sub = (name, description, options = []) => ({ type: 1, name, description: String(description).slice(0, 100), options });
