/* 豆森 AI 顧問（worker/src/mysekai.js）的回歸測試：輸入清洗、提示詞、模型輸出的解析。不打模型。用法：node worker/test/mysekai.mjs */
import { cleanDesignBody, buildDesignMessages, parseDesign } from '../src/mysekai.js';

let fail = 0;
const ok = (cond, name, extra) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).slice(0, 300))); if (!cond) fail++; };

const cat = [[6, '[閃耀流星]床', 4, 6, 3, '一般'], [8, '[閃耀流星]桌子', 2, 2, 2, '一般'], [9, '[閃耀流星]椅子', 2, 2, 2, '一般'], [596, '彩色方塊/紅色1x1', 1, 1, 1, '方塊'], [617, '彩色方塊/紅色2x2', 2, 2, 2, '方塊'], [983, '[「世界」舞台]小舞台', 10, 10, 1, '地墊']];
const site = { key: '2:3', name: '1F Lv3', kind: 'room', w: 16, d: 12, h: 10 };

/* 1. 輸入清洗 */
let c = cleanDesignBody({ prompt: '北歐風臥室', site, cat });
ok(!c.error && c.site.w === 16 && c.cat.length === 6 && c.current.length === 0, 'cleanDesignBody：正常輸入', c);
ok(cleanDesignBody({ prompt: 'x', site, cat }).error === 'bad_request', '需求太短 → bad_request');
ok(cleanDesignBody({ prompt: '北歐風', site, cat: cat.slice(0, 2) }).error === 'bad_request', '目錄太短 → bad_request');
c = cleanDesignBody({ prompt: '北歐風', site: { w: 999, d: -5, h: 'x', kind: 'weird' }, cat, current: [[6, 1, 1, 0, 0], ['bad']] });
ok(c.site.w === 150 && c.site.d === 4 && c.site.h === 15 && c.site.kind === 'any' && c.current.length === 1, '場地數值夾範圍、kind 不認得退 any、current 壞列略過', c.site);
ok(cleanDesignBody({ prompt: 'ok 北歐', site, cat: [[6, 'a\u0000b', 1, 1, 1, '']].concat(cat) }).cat[0][1] === 'ab', '名稱去控制字元');

/* 2. 提示詞 */
const m = buildDesignMessages(cleanDesignBody({ prompt: '北歐風臥室，床靠牆', site, cat, current: [[6, 0, 0, 0, 0]] }));
ok(m.messages.length === 1 && m.messages[0].role === 'user' && /16（x，寬）×12（y，深）/.test(m.system), '提示詞寫了場地格數', m.system.slice(0, 120));
ok(/6\|\[閃耀流星\]床\|4x6x3/.test(m.messages[0].content[0].text) && /6,0,0,0,0/.test(m.messages[0].content[0].text), '目錄與目前擺設都在使用者訊息裡');
ok(/room/.test(m.system) && /不能用家前限定/.test(m.system), '房間規則');
ok(buildDesignMessages(cleanDesignBody({ prompt: '北歐風', site, cat, lang: 'en' })).system.includes('in English'), '英文版提示');

/* 3. 解析模型輸出 */
const reply = '好的，以下是設計：\n```json\n{"title":"北歐暖室","concept":"淺木色與白。","items":[{"fid":6,"x":0,"y":0,"rot":0,"note":"床靠後牆"},{"fid":8,"x":14,"y":10,"rot":1},{"fid":9,"x":99,"y":-3,"rot":5},{"fid":12345,"x":1,"y":1},{"fid":983,"x":0,"y":0}],"tips":["先做床","再做桌椅","x","y","z"]}\n```';
const p = parseDesign(reply, cat, site);
ok(!p.error && p.title === '北歐暖室' && p.items.length === 4 && p.dropped.length === 1 && p.dropped[0] === 12345, '圍欄內的 JSON 解析、丟掉目錄外的（10×10 舞台放得進 16×12 所以保留）', p);
ok(p.items[1].x === 14 && p.items[1].y === 10 && p.items[1].rot === 1, '座標與旋轉保留', p.items[1]);
ok(p.items[2].x === 14 && p.items[2].y === 0 && p.items[2].rot === 3, '超界夾回場地（椅子 x 99 → 14、y −3 → 0）、rot 5 夾到 3', p.items[2]);
ok(parseDesign('{"items":[{"fid":983,"x":0,"y":0}]}', cat, { key: 'x', name: 'x', kind: 'room', w: 8, d: 8, h: 10 }).error === 'empty', '10×10 舞台放不進 8×8 → 丟掉');
ok(p.tips.length === 4, 'tips 最多 4 條');
ok(parseDesign('沒有東西', cat, site).error === 'no_json', '沒 JSON → no_json');
ok(parseDesign('{"items":[{"fid":1}]}', cat, site).error === 'empty', '全部目錄外 → empty');
ok(!parseDesign('{"title":"t","items":[{"fid":6,"x":0,"y":0,},]}', cat, site).error, '尾逗號也救得回來');

console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
process.exit(fail ? 1 : 0);
