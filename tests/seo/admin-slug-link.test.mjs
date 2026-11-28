// /admin?slug=<slug> веде до картки товару (/admin?pid=…). Справжній SQLite, схема db/schema.sql.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadFn, installCaches, ROOT, ORIGIN } from './helpers/runtime.mjs';
import fs from 'node:fs';
import path from 'node:path';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* немає node:sqlite */ }
const skip = DatabaseSync ? false : 'node:sqlite недоступний (потрібна Node ≥ 22.5)';

function env() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8'));
  raw.exec(fs.readFileSync(path.join(ROOT, 'migration_stats_cache.sql'), 'utf8'));
  raw.prepare('INSERT INTO products(pid,sku,name,price,category,in_stock) VALUES(7,?,?,?,?,1)').run('S7', 'Насіння', 10, 'НАСІННЯ');
  raw.prepare('INSERT INTO product_content(pid,slug,visible) VALUES(7,?,1)').run('nasinnia-seedera');
  const mk = (sql, binds = []) => ({ bind: (...b) => mk(sql, b), run: async () => { raw.prepare(sql).run(...binds); return { success: true }; }, first: async () => { const r = raw.prepare(sql).get(...binds); return r ? { ...r } : null; }, all: async () => ({ results: raw.prepare(sql).all(...binds).map(r => ({ ...r })) }) });
  return { DB: { prepare: sql => mk(sql) } };
}
let mod;
beforeEach(async () => { installCaches(); mod = await loadFn('functions/admin/index.js'); });

describe('/admin?slug=', { skip }, () => {
  it('відомий slug → 302 на /admin?pid=…', async () => {
    const r = await mod.onRequestGet({ request: new Request(`${ORIGIN}/admin?slug=nasinnia-seedera`), env: env() });
    assert.equal(r.status, 302); assert.equal(new URL(r.headers.get('Location')).pathname + new URL(r.headers.get('Location')).search, '/admin?pid=7');
  });
  it('невідомий slug → звичайний список (не 302)', async () => {
    const r = await mod.onRequestGet({ request: new Request(`${ORIGIN}/admin?slug=nema`), env: env() });
    assert.notEqual(r.status, 302);
  });
});
