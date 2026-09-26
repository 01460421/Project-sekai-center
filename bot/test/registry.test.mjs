import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistry } from './harness.js';
import { CATEGORIES } from '../src/core/registry.js';

test('恰好 100 個功能，名稱唯一、分類合法', async () => {
  const reg = await loadRegistry();
  assert.equal(reg.size, 100);
  const names = reg.features.map(f => f.name);
  assert.equal(new Set(names).size, 100);
  for (const f of reg.features) { assert.ok(CATEGORIES[f.category], f.name); assert.match(f.name, /^[a-z0-9_-]{1,32}$/); assert.ok(f.description.length <= 100); }
  const byCat = reg.byCategory();
  for (const k of Object.keys(CATEGORIES)) assert.ok(byCat[k].length > 0, `分類 ${k} 是空的`);
});

test('Discord 指令 JSON 合法（選項數、名稱、說明長度、choices）', async () => {
  const reg = await loadRegistry();
  const json = reg.commandJSON();
  assert.equal(json.length, 100);
  const check = (o, where) => {
    assert.match(o.name, /^[a-z0-9_-]{1,32}$/, where);
    assert.ok(o.description.length >= 1 && o.description.length <= 100, where);
    assert.ok((o.options || []).length <= 25, where);
    for (const c of o.choices || []) { assert.ok(String(c.name).length <= 100, where); assert.ok(String(c.value).length <= 100, where); }
    let seenOptional = false;
    for (const s of o.options || []) { if (s.type !== 1) { if (s.required) assert.ok(!seenOptional, `${where}: 必填參數不能排在選填之後`); else seenOptional = true; } check(s, `${where}.${s.name}`); }
  };
  for (const c of json) check(c, c.name);
  assert.ok(JSON.stringify(json).length < 200000);
});
