// Перегляд фото у формі редагування товару (/admin?pid=…): клік по фото відкриває збільшення.
// Рендер — на справжньому SQLite зі схемою db/schema.sql (node:sqlite, Node ≥ 22.5; інакше тести пропускаються).
// Поведінку (клік, стрілки, Esc) перевіряє браузерний прогін; тут — що код присутній, валідний і не ламає сторінку.
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
function makeDb(imgs) {
  const raw = new DatabaseSync(':memory:');
  raw.exec(fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8'));
  raw.prepare('INSERT INTO products(pid,sku,name,price,category,in_stock) VALUES(1,?,?,?,?,1)').run('A-1', 'Завязь, стимулятор', 15, 'АГРОХІМІКАТИ');
  raw.prepare('INSERT INTO product_content(pid,slug,annotation,keywords,meta_desc,visible) VALUES(1,?,?,?,?,1)').run('zavyaz', '', '', '');
  imgs.forEach((p, i) => raw.prepare('INSERT INTO product_images(pid,path,sort) VALUES(1,?,?)').run(p, i));
  return d1(raw);
}

let mod;
beforeEach(async () => { installCaches(); mod = await loadFn('functions/admin/index.js'); });
const page = async imgs => {
  const res = await mod.onRequestGet({ request: new Request(`${ORIGIN}/admin?pid=1`), env: { DB: makeDb(imgs) } });
  return { res, html: await res.text() };
};
const scripts = html => [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);

describe('/admin?pid=…: перегляд фото', { skip }, () => {
  it('сторінка відкривається, усі інлайн-скрипти синтаксично валідні, картки фото на місці', async () => {
    const { res, html } = await page(['up/1-a.webp', 'up/1-b.webp', 'up/1-c.webp']);
    assert.equal(res.status, 200);
    assert.equal((html.match(/class="ph-card"/g) || []).length, 3);
    for (const s of scripts(html)) assert.doesNotThrow(() => new Function(s));
  });

  it('скрипт перегляду: клік по картці (не по посиланнях), порядок з DOM, Esc/стрілки/свайп/фон, оригінал', async () => {
    const { html } = await page(['up/1-a.webp', 'up/1-b.webp']);
    const s = scripts(html).find(x => x.includes('Перегляд фото'));
    assert.ok(s, 'скрипт перегляду не знайдено');
    for (const k of ["e.target.closest('a')", 'var all=cards()', "'Escape'", "'ArrowLeft'", "'ArrowRight'", 'e.target===pv', 'touchend', 'Відкрити оригінал', 'prevOv']) assert.ok(s.includes(k), k);
    assert.ok(!/https?:\/\//.test(s), 'перегляд не ходить на зовнішні адреси');
  });

  it('перетягування, «зробити головним» і видалення лишились; підказка згадує перегляд', async () => {
    const { html } = await page(['up/1-a.webp', 'up/1-b.webp']);
    assert.match(html, /draggable="true"/); assert.match(html, /imgprimary=/); assert.match(html, /imgdel=/);
    assert.match(html, /клік по фото — переглянути/);
    assert.ok(html.includes("fetch('/admin/reorder'"));
  });

  it('без фото сторінка не ламається, скрипт безпечно нічого не робить', async () => {
    const { res, html } = await page([]);
    assert.equal(res.status, 200);
    assert.match(html, /Фото ще немає/);
    for (const s of scripts(html)) assert.doesNotThrow(() => new Function(s));
  });
});
