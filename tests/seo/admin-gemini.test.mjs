// POST /admin/geminiclean (Nano Banana 2) і кнопка «✨ Gemini» в редакторі фото. Gemini підроблений (fetch).
// Справжній SQLite зі схемою db/schema.sql (node:sqlite, Node ≥ 22.5; інакше пропуск) + підроблений R2.
import { describe, it, beforeEach, afterEach } from 'node:test';
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

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
let g, index;
beforeEach(async () => { installCaches(); g = await loadFn('functions/admin/geminiclean.js'); index = await loadFn('functions/admin/index.js'); });
const req = (body, type = 'image/jpeg') => new Request(`${ORIGIN}/admin/geminiclean`, { method: 'POST', headers: type ? { 'Content-Type': type } : {}, body });
const jpeg = () => new Uint8Array(1000).fill(7);

describe('POST /admin/geminiclean', () => {
  it('без ключа → 501 з підказкою', async () => {
    const r = await g.onRequestPost({ env: {}, request: req(jpeg()) }); assert.equal(r.status, 501); assert.match((await r.json()).error, /GEMINI_API_KEY/);
  });
  it('відмови: не зображення, порожнє, завелике — Gemini не викликається', async () => {
    let called = 0; globalThis.fetch = async () => { called++; return new Response('{}'); };
    const env = { GEMINI_API_KEY: 'k' };
    assert.equal((await g.onRequestPost({ env, request: req(jpeg(), 'text/plain') })).status, 400);
    assert.equal((await g.onRequestPost({ env, request: req(new Uint8Array(0)) })).status, 400);
    assert.equal((await g.onRequestPost({ env, request: req(new Uint8Array(4 * 1024 * 1024 + 1)) })).status, 400);
    assert.equal(called, 0);
  });
  it('успіх: правильний запит (модель, ключ, промпт, фото) і base64 результату', async () => {
    let seen;
    globalThis.fetch = async (url, init) => { seen = { url: String(url), init, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }, { inlineData: { mimeType: 'image/png', data: 'QUJD' } }] } }] }), { status: 200 }); };
    const r = await g.onRequestPost({ env: { GEMINI_API_KEY: 'sekret' }, request: req(jpeg()) }); const j = await r.json();
    assert.deepEqual([r.status, j.ok, j.mime, j.image], [200, true, 'image/png', 'QUJD']);
    assert.match(seen.url, /\/v1beta\/models\/gemini-3\.1-flash-image:generateContent$/); assert.equal(seen.init.headers['x-goog-api-key'], 'sekret');
    const parts = seen.body.contents[0].parts; assert.equal(parts[0].text, g.PROMPT); assert.equal(parts[1].inline_data.mime_type, 'image/jpeg'); assert.ok(parts[1].inline_data.data.length > 100);
    assert.deepEqual(seen.body.generationConfig.responseModalities, ['IMAGE']);
  });
  it('GEMINI_IMAGE_MODEL; відповідь без картинки і помилка API → 502 з поясненням', async () => {
    let url; globalThis.fetch = async u => { url = String(u); return new Response(JSON.stringify({ candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'no' }] } }] })); };
    let r = await g.onRequestPost({ env: { GEMINI_API_KEY: 'k', GEMINI_IMAGE_MODEL: 'gemini-x' }, request: req(jpeg()) });
    assert.match(url, /models\/gemini-x:/); assert.equal(r.status, 502); assert.match((await r.json()).error, /SAFETY/);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 });
    r = await g.onRequestPost({ env: { GEMINI_API_KEY: 'k' }, request: req(jpeg()) }); assert.equal(r.status, 502); assert.match((await r.json()).error, /quota/);
  });
});

describe('редактор фото: кнопка «✨ Gemini»', { skip }, () => {
  it('є кнопка, виклик ендпоїнта, попередження; інлайн-скрипти валідні', async () => {
    const { env } = makeEnv(); const h = await (await index.onRequestGet({ request: new Request(`${ORIGIN}/admin?pid=1`), env })).text();
    for (const k of ['✨ Gemini', "'/admin/geminiclean'", 'async function aiClean', 'ПЕРЕВІРТЕ текст на упаковці']) assert.ok(h.includes(k), k);
    for (const m of h.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]));
  });
});
