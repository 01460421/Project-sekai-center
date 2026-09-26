/* 訊息組件：全部用 Discord API 原生 JSON（discord.js 直接吃），功能模組不必 import discord.js，
   測試也不需要安裝它。custom_id 格式：功能名:動作:資料…（以 : 分隔，上限 100 字）。 */

export const COLORS = {
  brand: 0x33ccbb, gold: 0xffcc11, pink: 0xff66bb, blue: 0x4455dd, green: 0x88dd44,
  red: 0xee1166, orange: 0xff9900, purple: 0x884499, grey: 0x99aab5, dark: 0x2b2d31, mystic: 0x6a4c93,
};

export const Style = { primary: 1, secondary: 2, success: 3, danger: 4, link: 5 };

export function cid(feature, action, ...parts) {
  const id = [feature, action, ...parts.map(p => String(p))].join(':');
  if (id.length > 100) throw new Error(`custom_id 太長（${id.length}）：${id}`);
  return id;
}

export function parseCid(id) {
  const [feature, action, ...rest] = String(id).split(':');
  return { feature, action, data: rest };
}

export function button({ id, label, style = Style.secondary, emoji, disabled = false, url }) {
  const b = { type: 2, style: url ? Style.link : style, disabled };
  if (label != null) b.label = String(label).slice(0, 80);
  if (url) b.url = url; else b.custom_id = id;
  if (emoji) b.emoji = typeof emoji === 'string' ? { name: emoji } : emoji;
  return b;
}

export function row(...components) {
  const list = components.flat().filter(Boolean);
  if (list.length > 5) throw new Error('一列最多 5 個按鈕');
  return { type: 1, components: list };
}

/* 把一串按鈕自動切成每列 perRow 個（最多 5 列） */
export function grid(buttons, perRow = 5) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += perRow) rows.push(row(...buttons.slice(i, i + perRow)));
  if (rows.length > 5) throw new Error('最多 5 列');
  return rows;
}

export function select({ id, placeholder, options, min = 1, max = 1 }) {
  return row({
    type: 3, custom_id: id, placeholder, min_values: min, max_values: max,
    options: options.slice(0, 25).map(o => {
      const x = { label: String(o.label).slice(0, 100), value: String(o.value).slice(0, 100) };
      if (o.description) x.description = String(o.description).slice(0, 100);
      if (o.emoji) x.emoji = typeof o.emoji === 'string' ? { name: o.emoji } : o.emoji;
      if (o.default) x.default = true;
      return x;
    }),
  });
}

export function modal({ id, title, fields }) {
  return {
    custom_id: id, title: String(title).slice(0, 45),
    components: fields.slice(0, 5).map(f => ({
      type: 1,
      components: [{
        type: 4, custom_id: f.id, label: String(f.label).slice(0, 45), style: f.long ? 2 : 1,
        placeholder: f.placeholder ? String(f.placeholder).slice(0, 100) : undefined,
        required: f.required !== false, max_length: f.max || 200, min_length: f.min || undefined, value: f.value,
      }],
    })),
  };
}

export function embed({ title, description, color = COLORS.brand, fields, footer, thumbnail, image, author, url }) {
  const e = { color };
  if (title) e.title = String(title).slice(0, 256);
  if (description) e.description = String(description).slice(0, 4096);
  if (fields && fields.length) e.fields = fields.slice(0, 25).map(f => ({ name: String(f.name).slice(0, 256) || '​', value: String(f.value).slice(0, 1024) || '​', inline: !!f.inline }));
  if (footer) e.footer = { text: String(footer).slice(0, 2048) };
  if (thumbnail) e.thumbnail = { url: thumbnail };
  if (image) e.image = { url: image };
  if (author) e.author = typeof author === 'string' ? { name: author } : author;
  if (url) e.url = url;
  return e;
}

/* 常用文字工具 */
export const stars = (n, max = 5, on = '★', off = '☆') => on.repeat(n) + off.repeat(Math.max(0, max - n));
export const bar = (v, max, len = 10, on = '█', off = '░') => { const k = max > 0 ? Math.round(Math.min(1, Math.max(0, v / max)) * len) : 0; return on.repeat(k) + off.repeat(len - k); };
export const num = n => Number(n || 0).toLocaleString('zh-TW');
export const pct = (a, b, d = 1) => (b > 0 ? ((a / b) * 100).toFixed(d) : '0.0') + '%';
export const clean = s => String(s == null ? '' : s).replace(/[`*_~|>@]/g, m => '\\' + m).slice(0, 200);
export const mention = id => `<@${id}>`;
export const ts = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;
export const NUM_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
export const LETTER_EMOJI = ['🇦', '🇧', '🇨', '🇩', '🇪'];

/* 台灣時間的日期字串（占卜、簽到都以此為「一天」） */
export function todayTW(now = Date.now()) {
  return new Date(now + 8 * 3600e3).toISOString().slice(0, 10);
}
export function weekTW(now = Date.now()) {
  const d = new Date(now + 8 * 3600e3);
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.floor((d - start) / 86400e3 / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
export const pad2 = n => String(n).padStart(2, '0');
