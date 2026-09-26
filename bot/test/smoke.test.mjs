/* 煙霧測試：每一個功能（含每個子指令）都跑一次，要有回應、不能出錯、訊息要符合 Discord 限制；
   接著把回應裡的每個按鈕都按一遍、每個選單都選一次，同樣不能出錯。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistry, makeBot, runCmd, press, sampleOptions, buttonsOf, selectsOf, USERS } from './harness.js';

const reg = await loadRegistry();

for (const f of reg.features) {
  const subs = (f.options || []).filter(o => o.type === 1);
  const variants = subs.length ? subs.map(s => ({ sub: s.name, options: sampleOptions(s.options) })) : [{ sub: '', options: sampleOptions(f.options) }];
  for (const v of variants) {
    test(`/${f.name}${v.sub ? ' ' + v.sub : ''}`, async () => {
      const bot = await makeBot();
      // 先讓 Alice 有點錢、有卡，避免「餘額不足」這種早退遮住真正的錯誤
      const u = bot.store.user('900000000000000001', USERS.alice.id); u.crystals = 1000; u.cards[4] = 2; u.items.rename_card = 1; u.items.xp_boost = 1; u.items['🌸'] = 1; u.titles.push('閃亮新星');
      const rec = await runCmd(bot, f.name, { sub: v.sub, options: v.options, admin: true });
      assert.deepEqual(bot.errors, [], `執行出錯：${bot.errors[0]}`);
      assert.ok(rec.replies.length + rec.modals.length > 0 || rec.deferred, '沒有任何回應');
      await bot.timers.flush();
      assert.deepEqual(bot.errors, [], `計時器出錯：${bot.errors[0]}`);
      // 按每一個按鈕（各以 Alice 與 Bob 的身分各按一次），選每一個選單的第一個選項
      for (const msg of [...rec.replies, ...rec.edits]) {
        for (const b of buttonsOf(msg)) {
          if (b.disabled) continue;
          for (const user of [USERS.alice, USERS.bob]) {
            const r = await press(bot, b.id, { user, message: msg, admin: true });
            if (r.modals.length) for (const m of r.modals) { const fields = {}; for (const row of m.components) for (const c of row.components) fields[c.custom_id] = c.custom_id === 'g' ? (m.title.includes('Wordle') ? 'crane' : 'E') : '自訂稱號'; await press(bot, m.custom_id, { user, fields, message: msg }); }
          }
        }
        for (const s of selectsOf(msg)) for (const user of [USERS.alice, USERS.bob]) await press(bot, s.id, { user, values: [s.options[Math.min(1, s.options.length - 1)]], message: msg });
      }
      assert.deepEqual(bot.errors, [], `按鈕／選單出錯：${bot.errors[0]}`);
    });
  }
}

test('autocomplete：歌曲搜尋', async () => {
  const bot = await makeBot();
  const list = await bot.runAutocomplete({ name: 'song', focused: 'tell', user: USERS.alice, guildId: '900000000000000001', channelId: 'c', io: {} });
  assert.ok(list.length >= 1 && list.length <= 25);
  assert.ok(list.some(x => /tell your world/i.test(x.name)));
});
