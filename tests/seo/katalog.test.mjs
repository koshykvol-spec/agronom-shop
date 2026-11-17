// Регресія HTML-карти каталогу /katalog (functions/katalog.js): вона ж — вхід для краулу всіх товарних /p/ сторінок.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { knownGap } from './helpers/known-gap.mjs';
import { loadFn, installCaches, makeDB, ctx, read, ORIGIN } from './helpers/runtime.mjs';
import { titles, h1s, metaContent, linkHrefs, htmlLang, anchorHrefs } from './helpers/html.mjs';

let onRequest, store;
beforeEach(async () => {
  store = installCaches();
  ({ onRequest } = await loadFn('functions/katalog.js'));
});

const ROWS = [
  { slug: 'a-1', name: 'Альфа & Омега', cat: 'АГРОХІМІКАТИ' },
  { slug: 'b-2', name: 'Бета "Плюс"', cat: 'АГРОХІМІКАТИ' },
  { slug: 'c-3', name: 'Гамма', cat: 'ГРУНТ' },
];
const dbWith = rows => ({ DB: makeDB(sql => (sql.includes('FROM products p JOIN product_content c') ? rows : [])) });
const get = async env => { const c = ctx(`${ORIGIN}/katalog`, { env }); const res = await onRequest(c); await c.settled(); return { res, html: await res.text() }; };

describe('/katalog', () => {
  it('200, lang=uk, один title/h1/description, canonical = https://…/katalog', async () => {
    const { res, html } = await get(dbWith(ROWS));
    assert.equal(res.status, 200);
    assert.equal(htmlLang(html), 'uk');
    assert.equal(titles(html).length, 1);
    assert.equal(h1s(html).length, 1);
    assert.equal(metaContent(html, 'description').length, 1);
    assert.deepEqual(linkHrefs(html, 'canonical'), [`${ORIGIN}/katalog`]);
  });

  it('є в sitemap, тож не може бути noindex (суперечність сигналів)', async () => {
    const { html } = await get(dbWith(ROWS));
    const robots = metaContent(html, 'robots').join(',').toLowerCase();
    assert.ok(!robots.includes('noindex'), 'meta robots=' + robots);
    assert.match(robots, /follow/, 'краул посилань на /p/ має бути дозволений');
  });

  it('кожен товар — окреме живе посилання <a href="/p/slug"> (краулер не залежить від JS)', async () => {
    const { html } = await get(dbWith(ROWS));
    assert.deepEqual(anchorHrefs(html).filter(h => h.startsWith('/p/')), ['/p/a-1', '/p/b-2', '/p/c-3']);
  });

  it('назви екрануються; товари згруповані за категоріями', async () => {
    const { html } = await get(dbWith(ROWS));
    assert.ok(html.includes('Альфа &amp; Омега') && html.includes('Бета &quot;Плюс&quot;'));
    assert.equal((html.match(/<h2>/g) || []).length, 2);
  });

  it('збій D1 → не кешується порожня карта (деградована відповідь no-store)', async () => {
    const { res } = await get({ DB: makeDB(() => { throw new Error('D1_ERROR'); }) });
    assert.match(res.headers.get('cache-control'), /no-store/);
    assert.ok(![...store.keys()].some(k => k.endsWith('/katalog')), 'порожній каталог потрапив у кеш');
  });

  it('після збою віддається запасна копія попередньої вдалої відповіді', async () => {
    const ok = await get(dbWith(ROWS));
    store.delete(`${ORIGIN}/katalog`);
    const { res, html } = await get({ DB: makeDB(() => { throw new Error('D1_ERROR'); }) });
    assert.equal(res.headers.get('x-cache'), 'STALE');
    assert.equal(html, ok.html);
  });

  it('у сторінці каталогу всі посилання внутрішні й без .html', async () => {
    const { html } = await get(dbWith(ROWS));
    for (const h of anchorHrefs(html)) assert.ok(h.startsWith('/') && !/\.html(\?|$)/.test(h), h);
  });

  knownGap('вихідний код: коментар-заголовок не суперечить фактичному meta robots', 'шапка functions/katalog.js каже "noindex,follow", а код віддає "index,follow"', () => {
    const src = read('functions/katalog.js');
    const header = /noindex,follow/.test(src.split('\n').slice(0, 5).join('\n'));
    const actual = /<meta name="robots" content="([^"]+)"/.exec(src)[1];
    assert.equal(header, /noindex/.test(actual), 'коментар і код розходяться');
  });
});
