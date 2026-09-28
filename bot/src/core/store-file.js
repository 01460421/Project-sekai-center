/* 單一 JSON 檔的持久化（Node 版介接層用）：延遲寫回、原子換檔。
   上百個伺服器、數萬使用者都還撐得住；要再大再換 SQLite，介面不必動。 */

import fs from 'node:fs';
import path from 'node:path';
import { MemoryStore } from './store.js';

export class FileStore extends MemoryStore {
  constructor(file, { debounceMs = 5000 } = {}) {
    super();
    this.file = file;
    this.debounceMs = debounceMs;
    this._timer = null;
    this.load();
  }
  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const d = JSON.parse(raw);
      this.data = { users: d.users || {}, guilds: d.guilds || {}, global: d.global || {} };
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('[store] 讀取失敗，改用空資料:', e.message);
    }
  }
  /* 有改動就排一次延遲寫入；連續操作只會寫一次 */
  touch() {
    this.dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.save().catch(e => console.error('[store] 寫入失敗:', e.message)); }, this.debounceMs);
    if (this._timer.unref) this._timer.unref();
  }
  user(gid, uid) { const u = super.user(gid, uid); this.touch(); return u; }
  guild(gid) { const g = super.guild(gid); this.touch(); return g; }
  global(k, init) { const v = super.global(k, init); this.touch(); return v; }
  async save() {
    if (!this.dirty) return;
    this.dirty = false;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(this.data));
    await fs.promises.rename(tmp, this.file);
  }
  async close() { if (this._timer) { clearTimeout(this._timer); this._timer = null; } await this.save(); }
}
