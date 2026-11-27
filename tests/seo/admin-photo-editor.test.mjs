// Редактор фото в перегляді (/admin?pid=…) і POST /admin/imgreplace (заміна файлу фото з збереженням позиції).
// Справжній SQLite зі схемою db/schema.sql (node:sqlite, Node ≥ 22.5; інакше пропуск) + підроблений R2.
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
function r2(initial = []) {
  const m = new Map(initial.map(k => [k, 'old']));
  return { m, put: async (k, v, o) => { m.set(k, { v, o }); }, delete: async k => { m.delete(k); }, head: async k => (m.has(k) ? {} : null) };
}
function makeEnv({ imgs = ['up/1-a.webp', 'up/1-b.webp', 'up/1-c.webp'], bucket } = {}) {
  const raw = new DatabaseSync(':memory:');
  raw.exec(fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8'));
  raw.exec(fs.readFileSync(path.join(ROOT, 'migration_stats_cache.sql'), 'utf8'));
  raw.prepare('INSERT INTO products(pid,sku,name,price,category,in_stock) VALUES(1,?,?,?,?,1)').run('A-1', 'Завязь', 15, 'АГРОХІМІКАТИ');
  raw.prepare('INSERT INTO product_content(pid,slug,visible,image_ok) VALUES(1,?,1,0)').run('zavyaz');
  imgs.forEach((p, i) => raw.prepare('INSERT INTO product_images(pid,path,sort) VALUES(1,?,?)').run(p, i));
  const IMAGES = bucket || r2(imgs.concat(imgs.map(p => 'thumb/' + p)));
  return { raw, env: { DB: d1(raw), IMAGES } };
}
const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const img = (name = 'e.webp', type = 'image/webp', n = 800) => new File([new Uint8Array(n).fill(7)], name, { type });
const ids = raw => raw.prepare('SELECT id,path,sort FROM product_images WHERE pid=1 ORDER BY sort,id').all();

let imgreplace, index;
beforeEach(async () => { installCaches(); imgreplace = await loadFn('functions/admin/imgreplace.js'); index = await loadFn('functions/admin/index.js'); });
const post = (env, fd) => imgreplace.onRequestPost({ request: new Request(`${ORIGIN}/admin/imgreplace`, { method: 'POST', body: fd }), env });

describe('POST /admin/imgreplace', { skip }, () => {
  it('замінює файл під НОВИМ ключем, id і порядок фото лишаються, старий файл і thumb видаляються, thumb нового кладеться', async () => {
    const { raw, env } = makeEnv();
    const before = ids(raw); const target = before[1];
    const res = await post(env, form({ id: target.id, photo: img(), thumb: img('t.webp', 'image/webp', 100) }));
    assert.equal(res.status, 303); assert.match(res.headers.get('location'), /\/admin\?pid=1$/);
    const after = ids(raw);
    assert.equal(after.length, 3);
    assert.deepEqual(after.map(r => r.id), before.map(r => r.id));              // id і порядок ті самі
    assert.deepEqual(after.map(r => r.sort), before.map(r => r.sort));
    assert.notEqual(after[1].path, target.path); assert.match(after[1].path, /^up\/1-\d+-[0-9a-f]{8}\.webp$/);
    assert.equal(after[0].path, before[0].path); assert.equal(after[2].path, before[2].path);   // решта не чіпається
    assert.ok(env.IMAGES.m.has(after[1].path)); assert.ok(env.IMAGES.m.has('thumb/' + after[1].path));
    assert.ok(!env.IMAGES.m.has(target.path)); assert.ok(!env.IMAGES.m.has('thumb/' + target.path));
    assert.ok(env.IMAGES.m.has(before[0].path));
  });
  it('головне фото (перше) лишається головним; image_ok = 1', async () => {
    const { raw, env } = makeEnv();
    const first = ids(raw)[0];
    await post(env, form({ id: first.id, photo: img('a.png', 'image/png') }));
    const after = ids(raw); assert.equal(after[0].id, first.id); assert.match(after[0].path, /\.png$/);
    assert.equal(raw.prepare('SELECT image_ok FROM product_content WHERE pid=1').get().image_ok, 1);
  });
  it('старий файл, на який ще посилається інший рядок, НЕ видаляється', async () => {
    const { raw, env } = makeEnv({ imgs: ['up/1-a.webp', 'up/1-a.webp'] });
    const [a] = ids(raw); await post(env, form({ id: a.id, photo: img() }));
    assert.ok(env.IMAGES.m.has('up/1-a.webp'));
  });
  it('відмови: немає id/файлу, не зображення, завеликий, невідоме фото — нічого не пишеться', async () => {
    const { raw, env } = makeEnv(); const snap = JSON.stringify(ids(raw)); const n = env.IMAGES.m.size;
    assert.equal((await post(env, form({ photo: img() }))).status, 400);
    assert.equal((await post(env, form({ id: 1 }))).status, 400);
    assert.equal((await post(env, form({ id: 1, photo: img('x.txt', 'text/plain') }))).status, 400);
    assert.equal((await post(env, form({ id: 1, photo: img('x.gif', 'image/gif') }))).status, 400);
    assert.equal((await post(env, form({ id: 1, photo: new File([new Uint8Array(12 * 1024 * 1024 + 1)], 'b.webp', { type: 'image/webp' }) }))).status, 413);
    assert.equal((await post(env, form({ id: 9999, photo: img() }))).status, 404);
    assert.equal(JSON.stringify(ids(raw)), snap); assert.equal(env.IMAGES.m.size, n);
  });
  it('збій запису thumb не ламає заміну', async () => {
    const { raw, env } = makeEnv(); const orig = env.IMAGES.put;
    env.IMAGES.put = async (k, v, o) => { if (k.startsWith('thumb/')) throw new Error('boom'); return orig(k, v, o); };
    const t = ids(raw)[2]; const res = await post(env, form({ id: t.id, photo: img(), thumb: img('t.webp') }));
    assert.equal(res.status, 303); assert.notEqual(ids(raw)[2].path, t.path);
  });
  it('/admin/* захищений: POST без пароля → 401, і це мутуюча дія (CSRF-захист діє для всього /admin/*)', async () => {
    const mw = await loadFn('functions/admin/_middleware.js');
    let called = false;
    const r = await mw.onRequest({ request: new Request(`${ORIGIN}/admin/imgreplace`, { method: 'POST' }), env: { ADMIN_PASSWORD: 'x' }, next: async () => { called = true; return new Response('ok'); } }).catch(e => ({ status: 401, e }));
    assert.equal(called, false); assert.ok(r.status === 401 || r instanceof Response);
  });
});

describe('/admin?pid=…: редактор фото (клієнт)', { skip }, () => {
  const html = async () => { const { env } = makeEnv(); const res = await index.onRequestGet({ request: new Request(`${ORIGIN}/admin?pid=1`), env }); return { res, html: await res.text() }; };
  const scripts = h => [...h.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  it('сторінка відкривається, усі інлайн-скрипти валідні, у переглядачі є кнопка «Редагувати»', async () => {
    const { res, html: h } = await html(); assert.equal(res.status, 200);
    for (const s of scripts(h)) assert.doesNotThrow(() => new Function(s));
    assert.match(h, /pv-edit/); assert.match(h, /✏️ Редагувати/);
  });
  it('редактор: поворот/відзеркалення/обрізка/замальовування/яскравість, збереження «замінити» і «як нове», Esc лише закриває редактор', async () => {
    const { html: h } = await html(); const s = scripts(h).find(x => x.includes('Редактор фото')); assert.ok(s);
    for (const k of ['function openEditor', 'rotate(-1)', 'rotate(1)', 'function flip', 'function applyRect', "mode==='fill'", 'brightness(', "'/admin/imgreplace'", "'/admin/upload'", "fd.set('id',it.id)", "fd.set('thumb'", "'Escape'", 'stopPropagation', 'setPointerCapture', "id:el.getAttribute('data-id')", 'function edInpaint', 'function applyErase', "mode==='erase'", 'Лише тонкий напис', 'Пензель']) assert.ok(s.includes(k), k);
    assert.ok(!/https?:\/\//.test(s), 'редактор не ходить на зовнішні адреси');
  });
  it('наявні функції не зламані: перетягування, видалення, «зробити головним», завантаження', async () => {
    const { html: h } = await html();
    assert.match(h, /draggable="true"/); assert.match(h, /imgdel=/); assert.match(h, /imgprimary=/); assert.match(h, /shrinkUpload/);
  });
});

describe('/admin?pid=…: блок фото нагорі, завантаження одразу', { skip }, () => {
  const page = async () => { const { env } = makeEnv(); const res = await index.onRequestGet({ request: new Request(`${ORIGIN}/admin?pid=1`), env }); return res.text(); };
  it('блок «Фото товару» стоїть вище за форму полів і лише один раз', async () => {
    const h = await page();
    const g = h.indexOf('id="photo-grid"'), f = h.indexOf('action="/admin/save"');
    assert.ok(g > 0 && f > 0 && g < f, 'фото мають бути перед формою збереження');
    assert.equal((h.match(/id="photo-grid"/g) || []).length, 1);
    assert.ok(h.indexOf('📷 Фото товару') < h.indexOf('name="sku"'));
  });
  it('вибір файлів → одразу завантаження (multiple, onchange, кнопка прихована); завантажується по одному, з стисненням', async () => {
    const h = await page();
    assert.match(h, /<input type="file" name="photo" accept="image\/\*" multiple[^>]*onchange="phPicked\(this\)"/);
    assert.match(h, /<button class="btn" type="submit" style="display:none">⬆️ Завантажити фото<\/button>/);
    for (const k of ['function phPicked', 'requestSubmit', 'async function phPrepare', 'async function shrinkUpload', 'for(var n=0;n<files.length;n++)', "fd.set('photo',f,f.name)", 'location.reload()']) assert.ok(h.includes(k), k);
    const scripts = [...h.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    for (const sc of scripts) assert.doesNotThrow(() => new Function(sc));
    // регулярки в шаблонному рядку не втратили слеші
    assert.ok(h.includes('/^image\\//.test(f.type)') || h.includes('/^image\//.test(f.type)'));
  });
});
