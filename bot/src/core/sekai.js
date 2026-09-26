/* 世界計畫資料：直接讀 repo 根目錄 data/ 的靜態檔（跟網站同一份，網站更新機器人就跟著更新）。 */

import { CARDS, CHARAS as RAW_CHARAS } from '../../../data/cards-index.js';
import { EP_SONGS, DIFF_NAMES } from '../../../data/ep-songs.js';
import { SONG_BPM } from '../../../data/song-bpm.js';
import { GACHAS } from '../../../data/sekai-data.js';

export const ASSET = 'https://storage.sekai.best/sekai-jp-assets';

export const UNITS = [
  { key: 'L/n', name: 'Leo/need', color: 0x4455dd, emoji: '🎸' },
  { key: 'MMJ', name: 'MORE MORE JUMP!', color: 0x88dd44, emoji: '💚' },
  { key: 'VBS', name: 'Vivid BAD SQUAD', color: 0xee1166, emoji: '🔥' },
  { key: 'WxS', name: 'Wonderlands×Showtime', color: 0xff9900, emoji: '🎪' },
  { key: 'N25', name: '25時、Nightcord見。', color: 0x884499, emoji: '🌙' },
  { key: 'VS', name: 'VIRTUAL SINGER', color: 0x33ccbb, emoji: '🎤' },
];

const EXTRA = {
  1: ['一歌', '08-11', 0x33aaee], 2: ['咲希', '05-09', 0xffdd44], 3: ['穗波', '10-27', 0xee6666], 4: ['志步', '12-06', 0xbbdd22],
  5: ['實乃理', '04-14', 0xffccaa], 6: ['遙', '10-05', 0x99ccff], 7: ['愛莉', '03-19', 0xffaacc], 8: ['雫', '02-06', 0x99eedd],
  9: ['心羽', '08-20', 0xff6699], 10: ['杏', '07-26', 0x00bbdd], 11: ['彰人', '11-12', 0xff7722], 12: ['冬彌', '05-25', 0x0077dd],
  13: ['司', '05-17', 0xffbb00], 14: ['笑夢', '04-30', 0xff66bb], 15: ['寧寧', '07-20', 0x33dd99], 16: ['類', '09-17', 0xbb88ee],
  17: ['奏', '02-10', 0xbb6688], 18: ['真冬', '01-27', 0x8888cc], 19: ['繪名', '04-02', 0xccaa88], 20: ['瑞希', '08-27', 0xddaacc],
  21: ['未來', '08-31', 0x33ccbb], 22: ['鈴', '12-27', 0xffcc11], 23: ['連', '12-27', 0xffee11], 24: ['流歌', '01-30', 0xffbbcc],
  25: ['MEIKO', '11-05', 0xdd4444], 26: ['KAITO', '02-17', 0x3366cc],
};

export const CHARAS = RAW_CHARAS.map(([id, name, u]) => ({
  id, name, unit: UNITS[u], short: EXTRA[id][0], birthday: EXTRA[id][1], color: EXTRA[id][2],
  sd: `${ASSET}/character/character_sd_l/chr_sp_${id}.webp`,
  portrait: `${ASSET}/character/character_select/chr_tl_${id}.webp`,
}));
export const charaById = id => CHARAS[id - 1];
export function findChara(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  if (/^\d+$/.test(t)) return charaById(+t) || null;
  return CHARAS.find(c => c.name.toLowerCase() === t || c.short.toLowerCase() === t)
    || CHARAS.find(c => c.name.includes(t) || t.includes(c.short.toLowerCase())) || null;
}

/* 卡片：[id, 角色, 稀有度(1-4,9=生日), 屬性, 取得類別, 支援團, 卡池可得, 卡名, 素材名] */
export const ATTR_NAMES = { 0: 'Cool', 1: 'Happy', 2: 'Mysterious', 3: 'Cute', 4: 'Pure' };
export const ATTR_EMOJI = { 0: '💙', 1: '🧡', 2: '💜', 3: '💗', 4: '💚' };
export const ALL_CARDS = CARDS.map(c => ({ id: c[0], chara: c[1], rarity: c[2], attr: c[3], supply: c[4], gacha: !!c[6], name: c[7], asset: c[8] }));
export const GACHA_POOL = { 2: [], 3: [], 4: [] };
for (const c of ALL_CARDS) if (c.gacha && GACHA_POOL[c.rarity]) GACHA_POOL[c.rarity].push(c);
export const cardById = id => ALL_CARDS.find(c => c.id === id);
export const cardThumb = c => `${ASSET}/thumbnail/chara/${c.asset}_${c.rarity >= 3 ? 'after_training' : 'normal'}.webp`;
export const cardArt = c => `${ASSET}/character/member/${c.asset}/card_normal.png`;
export const rarityStr = r => r === 9 ? '🎂 生日' : '★'.repeat(r);

/* 歌曲 */
export { DIFF_NAMES };
export const SONGS = EP_SONGS.map(s => ({
  id: s.id, title: s.t, time: s.time, rate: s.rate, d: s.d,
  bpm: SONG_BPM[s.id] ? SONG_BPM[s.id][0] : 0, bpmRange: SONG_BPM[s.id] ? [SONG_BPM[s.id][1], SONG_BPM[s.id][2]] : null,
  length: SONG_BPM[s.id] ? SONG_BPM[s.id][3] : Math.round(s.time),
}));
export const songById = id => SONGS.find(s => s.id === id);
export const songLevel = (s, diff = 'M') => (s.d[diff] ? s.d[diff][0] : null);
export const songNotes = (s, diff = 'M') => (s.d[diff] ? s.d[diff][1] : null);
export const fmtLen = sec => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/* 模糊搜尋：回傳最多 n 首 */
export function searchSongs(q, n = 10) {
  const t = String(q || '').trim().toLowerCase();
  if (!t) return SONGS.slice(0, n);
  if (/^\d+$/.test(t)) { const s = songById(+t); return s ? [s] : []; }
  const starts = [], includes = [];
  for (const s of SONGS) {
    const lt = s.title.toLowerCase();
    if (lt === t) return [s];
    if (lt.startsWith(t)) starts.push(s); else if (lt.includes(t)) includes.push(s);
  }
  return starts.concat(includes).slice(0, n);
}
export const songTitleAscii = s => /^[ -~]+$/.test(s.title);

/* 卡池／活動：GACHAS = [{s,e,id,n,t,note,ch,u,eid,et,ech}]（日期 yyyy/mm/dd，台灣時間） */
export const GACHA_LIST = GACHAS.map(g => ({ ...g, start: Date.parse(g.s.replace(/\//g, '-') + 'T15:00:00+08:00'), end: Date.parse(g.e.replace(/\//g, '-') + 'T14:59:00+08:00') }));
export function gachasAround(now = Date.now(), daysAhead = 14) {
  const until = now + daysAhead * 86400e3;
  return GACHA_LIST.filter(g => g.end >= now - 86400e3 && g.start <= until).sort((a, b) => a.start - b.start);
}
export function eventsAround(now = Date.now(), daysAhead = 21) {
  const seen = new Set(); const out = [];
  for (const g of gachasAround(now, daysAhead)) if (g.eid && !seen.has(g.eid)) { seen.add(g.eid); out.push(g); }
  return out;
}
