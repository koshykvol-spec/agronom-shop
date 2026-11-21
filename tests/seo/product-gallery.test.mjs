// Збільшення фото на сторінці товару (лайтбокс по кліку на головне фото): розмітка, стилі, синтаксис скрипта.
// Поведінку (відкриття/закриття/стрілки/Esc) перевіряє браузерний прогін; тут — що код присутній і не ламає сторінку.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadFn, installCaches, productDB, ctx, ORIGIN } from './helpers/runtime.mjs';

const BASE = {
  pid: 1, sku: 'RG-025', name: 'Ридомил Голд МЦ 68 WG, 25 г', price: 85, category: 'АГРОХІМІКАТИ',
  brand: 'Syngenta', in_stock: 1, slug: 'ridomil-gold-mc-25g', annotation: 'Опис.',
  keywords: '', meta_title: null, meta_desc: null, sale_price: null, sale_until: null, display_name: null,
  group_id: null, variant_label: null, image_ok: 1, active_ingredient: '', dosage: '', divisible: 0, divisor: null, visible: 1,
};
const CATS = [{ db_name: 'АГРОХІМІКАТИ', key: 'chemicals' }];
let onRequest, cacheStore;
beforeEach(async () => { cacheStore = installCaches(); ({ onRequest } = await loadFn('functions/p/[slug].js')); });

async function render(images) {
  cacheStore.clear();
  const env = { DB: productDB({ products: [BASE], categories: CATS, images: { 1: images } }) };
  const c = ctx(`${ORIGIN}/p/${BASE.slug}`, { env, params: { slug: BASE.slug } });
  const res = await onRequest(c); await c.settled();
  return res.text();
}
const scripts = html => [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);

describe('/p/<slug>: збільшення фото', () => {
  it('є головне фото #pmain, стилі лайтбокса та його скрипт; усі інлайн-скрипти синтаксично валідні', async () => {
    const html = await render(['IMG/a.webp', 'IMG/b.webp']);
    assert.match(html, /<img id="pmain"/);
    assert.match(html, /#pmain \{ cursor:zoom-in; \}/);
    assert.match(html, /\.lb \{ position:fixed;/);
    assert.match(html, /Збільшене фото/);
    for (const s of scripts(html)) assert.doesNotThrow(() => new Function(s));
  });

  it('скрипт лайтбокса: Esc, стрілки, закриття по фону, повернення фокуса; без зовнішніх ресурсів', async () => {
    const html = await render(['IMG/a.webp', 'IMG/b.webp']);
    const s = scripts(html).find(x => x.includes('lb-img'));
    assert.ok(s, 'скрипт лайтбокса не знайдено');
    for (const k of ["'Escape'", "'ArrowLeft'", "'ArrowRight'", 'e.target===lb', 'opener.focus', "touchend"]) assert.ok(s.includes(k), k);
    assert.ok(!/https?:\/\//.test(s), 'лайтбокс не має ходити на зовнішні адреси (CSP)');
  });

  it('мініатюри і setThumb лишились; без фото сторінка не ламається (скрипт безпечно виходить)', async () => {
    const withThumbs = await render(['IMG/a.webp', 'IMG/b.webp']);
    assert.match(withThumbs, /class="p-thumbs"/); assert.match(withThumbs, /function setThumb/);
    const none = await render([]);
    assert.ok(!/<img id="pmain"/.test(none));
    assert.ok(none.includes("var main=document.getElementById('pmain'); if(!main) return;"));
  });
});
