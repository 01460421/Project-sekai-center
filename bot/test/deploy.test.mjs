import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// 機器人讀的 repo 根目錄 data/ 檔案，三個地方都要列到，少一個就會像 #61 那樣 Docker 建置失敗或資料更新不觸發重佈：
//   bot/Dockerfile 的 COPY、根目錄 .dockerignore 的白名單、bot-deploy.yml 的 push paths
const ROOT = new URL('../../', import.meta.url).pathname;
const read = p => readFileSync(join(ROOT, p), 'utf8');

function importedDataFiles() {
  const out = new Set();
  const walk = dir => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) for (const m of readFileSync(p, 'utf8').matchAll(/from\s+'(?:\.\.\/)+data\/([a-z0-9-]+\.js)'/g)) out.add(`data/${m[1]}`); } };
  walk(join(ROOT, 'bot/src'));
  return [...out].sort();
}

test('bot/src 匯入的 data/ 檔案都有進 Dockerfile、.dockerignore 白名單與 bot-deploy 觸發路徑', () => {
  const files = importedDataFiles();
  assert.ok(files.length >= 5, `應該至少有五個資料檔，現在：${files.join(', ')}`);
  const dockerfile = read('bot/Dockerfile');
  const dockerignore = read('.dockerignore').split('\n').map(s => s.trim());
  const workflow = read('.github/workflows/bot-deploy.yml');
  for (const f of files) {
    assert.ok(dockerfile.includes(`${f} `) || dockerfile.includes(`${f}\n`), `bot/Dockerfile 的 COPY 少了 ${f}`);
    assert.ok(dockerignore.includes(`!${f}`), `.dockerignore 少了 !${f}（Docker 建置上下文會找不到檔案）`);
    assert.ok(workflow.includes(`'${f}'`), `.github/workflows/bot-deploy.yml 的 paths 少了 '${f}'`);
  }
});
