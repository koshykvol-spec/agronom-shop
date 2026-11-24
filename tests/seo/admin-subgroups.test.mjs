// Підгрупи в адмінці: у категорії під головними чипами — рядок «Усі + products.brand» (Гербіциди, Фунгіциди…) і фільтр ?cat=…&sub=…
// Справжній SQLite зі схемою db/schema.sql (node:sqlite, Node ≥ 22.5; інакше пропуск).
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadFn, installCaches, ROOT, ORIGIN } from './helpers/runtime.mjs';
import fs from 'node:fs';
import path from 'node:path';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* немає node:sqlite */ }
const skip = DatabaseSync ? false : 'node:sqlite недоступний (потрібна Node ≥ 22.5)';

function d1(db) {
  const mk = (sql, binds = []) => ({
    _sql: sql, _binds: binds,
    bind: (...b) => mk(sql, b),
    all: async () => ({ results: db.prepare(sql).all(...binds).map(r => ({ ...r })), success: true }),
    first: async () => { const r = db.prepare(sql).get(...binds); return r ? { ...r } : null; },
    run: async () => { db.prepare(sql).run(...binds); return { success: true }; },
  });
  return { prepare: sql => mk(sql), batch: async st => { for (const s of st) db.prepare(s._sql).run(...s._binds); return []; } };
}
const ROWS = [
  ['Фастак', 'АГРОХІМІКАТИ', 'Інсектициди'], ['Актара', 'АГРОХІМІКАТИ', 'Інсектициди'], ['Конфідор', 'АГРОХІМІКАТИ', 'Інсектициди'],
  ['Раундап', 'АГРОХІМІКАТИ', 'Гербіциди'], ['Террадок', 'АГРОХІМІКАТИ', 'Гербіциди'],
  ['Скор', 'АГРОХІМІКАТИ', 'Фунгіциди'], ['Безпідгрупи', 'АГРОХІМІКАТИ', null],
  ['Горщик 1', 'ГОРЩИКИ', null], ['Горщик 2', 'ГОРЩИКИ', ''],
];
function makeDb() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8'));
  raw.exec(fs.readFileSync(path.join(ROOT, 'migration_stats_cache.sql'), 'utf8'));   // кеш лічильників списку
  ROWS.forEach(([n, c, b], i) => {
    raw.prepare('INSERT INTO products(pid,sku,name,price,category,brand,in_stock) VALUES(?,?,?,?,?,?,1)').run(i + 1, 'S' + i, n, 10, c, b);
    raw.prepare('INSERT INTO product_content(pid,slug,visible) VALUES(?,?,1)').run(i + 1, 's' + i);
  });
  return d1(raw);
}
let mod;
beforeEach(async () => { installCaches(); mod = await loadFn('functions/admin/index.js'); });
const get = async qs => {
  const res = await mod.onRequestGet({ request: new Request(`${ORIGIN}/admin${qs}`), env: { DB: makeDb() } });
  return { res, html: await res.text() };
};
const names = html => ROWS.map(r => r[0]).filter(n => html.includes('>' + n + '</a>'));

describe('/admin: підгрупи категорії', { skip }, () => {
  it('у категорії є рядок підгруп із лічильниками; «Усі» = вся категорія', async () => {
    const { res, html } = await get('?cat=' + encodeURIComponent('АГРОХІМІКАТИ'));
    assert.equal(res.status, 200);
    assert.match(html, /class="cats subcats"/);
    assert.match(html, /Інсектициди <b>3<\/b>/); assert.match(html, /Гербіциди <b>2<\/b>/); assert.match(html, /Фунгіциди <b>1<\/b>/);
    assert.match(html, /Без підгрупи <b>1<\/b>/); assert.match(html, /Усі <b>7<\/b>/);
    assert.equal(names(html).length, 7);
  });
  it('фільтр ?sub= показує лише підгрупу; пейджер/ps/назад зберігають sub', async () => {
    const { html } = await get('?cat=' + encodeURIComponent('АГРОХІМІКАТИ') + '&sub=' + encodeURIComponent('Гербіциди'));
    assert.deepEqual(names(html), ['Раундап', 'Террадок']);
    assert.match(html, /class="cat active"[^>]*>Гербіциди/);
    assert.match(html, /sub=%D0%93%D0%B5%D1%80%D0%B1%D1%96%D1%86%D0%B8%D0%B4%D0%B8/);   // у посиланнях редагування/розміру сторінки
  });
  it('«Без підгрупи» (__none) — товари з порожнім brand', async () => {
    const { html } = await get('?cat=' + encodeURIComponent('АГРОХІМІКАТИ') + '&sub=__none');
    assert.deepEqual(names(html), ['Безпідгрупи']);
  });
  it('категорія без підгруп (усі brand порожні) — рядка підгруп немає; без cat і з пошуком — теж', async () => {
    assert.doesNotMatch((await get('?cat=' + encodeURIComponent('ГОРЩИКИ'))).html, /subcats"/);
    assert.doesNotMatch((await get('')).html, /subcats"/);
    assert.doesNotMatch((await get('?noa=1&cat=' + encodeURIComponent('АГРОХІМІКАТИ'))).html, /subcats"/);
  });
  it('sub без cat ігнорується', async () => {
    const { html } = await get('?sub=' + encodeURIComponent('Гербіциди'));
    assert.doesNotMatch(html, /subcats"/);
  });
});
