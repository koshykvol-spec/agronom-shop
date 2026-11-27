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
const req = body => new Request(`${ORIGIN}/admin/geminiclean`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': String(new TextEncoder().encode(body).length) }, body });

describe('endpoint Gemini (тонкий проксі)', () => {
  it('без ключа → 501 з підказкою (JSON)', async () => {
    const r = await g.onRequestPost({ env: {}, request: req('{}') }); assert.equal(r.status, 501); assert.match((await r.json()).error.message, /GEMINI_API_KEY/);
  });
  it('порожній і завеликий запит відхиляються, Gemini не викликається', async () => {
    let called = 0; globalThis.fetch = async () => { called++; return new Response('{}'); };
    const env = { GEMINI_API_KEY: 'k' };
    assert.equal((await g.onRequestPost({ env, request: new Request('https://k.test/x', { method: 'POST', headers: { 'Content-Length': '0' } }) })).status, 400);
    assert.equal((await g.onRequestPost({ env, request: new Request('https://k.test/x', { method: 'POST', headers: { 'Content-Length': String(8 * 1024 * 1024 + 1) }, body: '{}' }) })).status, 413);
    assert.equal(called, 0);
  });
  it('пересилає тіло як є з ключем у заголовку і віддає відповідь Gemini без змін (статус теж)', async () => {
    let seen, bodyText;
    globalThis.fetch = async (url, init) => { seen = { url: String(url), init }; bodyText = await new Response(init.body).text(); return new Response('{"candidates":[{"x":1}]}', { status: 200 }); };
    const payload = JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] });
    const r = await g.onRequestPost({ env: { GEMINI_API_KEY: 'sekret' }, request: req(payload) });
    assert.equal(r.status, 200); assert.equal(await r.text(), '{"candidates":[{"x":1}]}'); assert.equal(bodyText, payload);
    assert.match(seen.url, /\/v1beta\/models\/gemini-3\.1-flash-image:generateContent$/); assert.equal(seen.init.headers['x-goog-api-key'], 'sekret');
    globalThis.fetch = async () => new Response('{"error":{"message":"quota"}}', { status: 429 });
    const r2 = await g.onRequestPost({ env: { GEMINI_API_KEY: 'k' }, request: req(payload) }); assert.equal(r2.status, 429); assert.match((await r2.json()).error.message, /quota/);
  });
  it('GEMINI_IMAGE_MODEL змінює модель; мережева помилка → 504 з JSON', async () => {
    let url; globalThis.fetch = async u => { url = String(u); return new Response('{}'); };
    await g.onRequestPost({ env: { GEMINI_API_KEY: 'k', GEMINI_IMAGE_MODEL: 'gemini-x' }, request: req('{}') }); assert.match(url, /models\/gemini-x:/);
    globalThis.fetch = async () => { throw new Error('net'); };
    const r = await g.onRequestPost({ env: { GEMINI_API_KEY: 'k' }, request: req('{}') }); assert.equal(r.status, 504); assert.match((await r.json()).error.message, /Gemini/);
  });
});

describe('редактор фото: кнопка «✨ Gemini»', { skip }, () => {
  it('є кнопка, виклик ендпоїнта, попередження; інлайн-скрипти валідні', async () => {
    const { env } = makeEnv(); const h = await (await index.onRequestGet({ request: new Request(`${ORIGIN}/admin?pid=1`), env })).text();
    for (const k of ['✨ Gemini', "'/admin/geminiclean'", 'async function aiClean', 'inline_data', 'ПЕРЕВІРТЕ текст на упаковці']) assert.ok(h.includes(k), k);
    for (const m of h.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]));
  });
});
