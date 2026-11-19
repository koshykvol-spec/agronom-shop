// Регресія sitemap-ів: структура індексу, повнота, екранування XML, відмовостійкість (порожня карта ≠ 200),
// узгодженість із robots.txt та canonical-ами сторінок.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadFn, installCaches, makeDB, ctx, read, ORIGIN } from './helpers/runtime.mjs';
import { linkHrefs } from './helpers/html.mjs';
import { parseRobots, isAllowed } from './helpers/robots.mjs';

let fns;
let cacheStore;
beforeEach(async () => {
  cacheStore = installCaches();
  fns = {
    index: (await loadFn('functions/sitemap.xml.js')).onRequest,
    v2: (await loadFn('functions/sitemap-v2.xml.js')).onRequest,
    main: (await loadFn('functions/sitemap-main.xml.js')).onRequest,
    products: (await loadFn('functions/sitemap-products.xml.js')).onRequest,
  };
});

const locs = xml => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => m[1]);
const unescapeXml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const assertWellFormed = (xml, root) => {
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'немає XML-декларації');
  assert.match(xml, new RegExp(`<${root} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`));
  assert.ok(xml.trimEnd().endsWith(`</${root}>`));
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)/.test(xml), 'неекранований & у XML');
};
const catsDB = keys => makeDB(sql => (sql.includes('FROM categories ORDER BY sort') ? keys.map(key => ({ key })) : []));
const slugsDB = slugs => makeDB(sql => (sql.includes('FROM product_content WHERE visible=1 AND slug IS NOT NULL') ? slugs.map(slug => ({ slug })) : []));
const call = (fn, path, env = {}, method = 'GET') => { const c = ctx(ORIGIN + path, { env, method }); return fn(c).then(async res => { await c.settled(); return res; }); };

describe('sitemap.xml (індекс)', () => {
  it('sitemapindex зі sitemap-main.xml і sitemap-products.xml, абсолютні https-URL, lastmod YYYY-MM-DD', async () => {
    const res = await call(fns.index, '/sitemap.xml');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/xml/);
    const xml = await res.text();
    assertWellFormed(xml, 'sitemapindex');
    assert.deepEqual(locs(xml), [`${ORIGIN}/sitemap-main.xml`, `${ORIGIN}/sitemap-products.xml`]);
    for (const m of xml.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)) assert.match(m[1], /^\d{4}-\d{2}-\d{2}$/);
  });

  it('/sitemap-v2.xml віддає те саме, що /sitemap.xml', async () => {
    const a = await (await call(fns.index, '/sitemap.xml')).text();
    const b = await (await call(fns.v2, '/sitemap-v2.xml')).text();
    assert.equal(b, a);
  });

  it('robots.txt вказує на цей sitemap', () => {
    assert.ok(parseRobots(read('robots.txt')).sitemaps.includes(`${ORIGIN}/sitemap.xml`));
  });
});

describe('sitemap-main.xml (статичні сторінки + категорії)', () => {
  it('містить головну, каталог, порадник, доставку, контакти, повернення та всі категорії з D1', async () => {
    const res = await call(fns.main, '/sitemap-main.xml', { DB: catsDB(['chemicals', 'soil', 'new-cat']) });
    const xml = await res.text();
    assertWellFormed(xml, 'urlset');
    assert.deepEqual(locs(xml), [
      `${ORIGIN}/`, `${ORIGIN}/katalog`, `${ORIGIN}/protection_schemes`, `${ORIGIN}/delivery`, `${ORIGIN}/contacts`, `${ORIGIN}/returns`,
      `${ORIGIN}/category?cat=chemicals`, `${ORIGIN}/category?cat=soil`, `${ORIGIN}/category?cat=new-cat`,
      `${ORIGIN}/katalog/chemicals`, `${ORIGIN}/katalog/soil`, `${ORIGIN}/katalog/new-cat`,
    ].map(u => u.replace(/&/g, '&amp;')));
  });

  it('D1 недоступна → запасний список із 11 категорій, карта не порожня', async () => {
    const env = { DB: makeDB(() => { throw new Error('D1_ERROR'); }) };
    const xml = await (await call(fns.main, '/sitemap-main.xml', env)).text();
    assert.equal(locs(xml).filter(u => u.includes('/category?cat=')).length, 11);
    assert.equal(locs(xml).filter(u => u.includes('/katalog/')).length, 11);
  });

  it('усі URL — на основному домені, без дублів, без службових сторінок', async () => {
    const xml = await (await call(fns.main, '/sitemap-main.xml', { DB: catsDB(['chemicals', 'soil']) })).text();
    const urls = locs(xml);
    assert.equal(new Set(urls).size, urls.length, 'дублі URL');
    for (const u of urls) {
      assert.ok(u.startsWith(ORIGIN), u);
      assert.ok(!/account|admin|check_photos|\.html|\/api\//.test(u), 'службовий/.html URL у sitemap: ' + u);
    }
  });

  it('кожна статична сторінка з sitemap має canonical, що точно дорівнює її URL у sitemap', () => {
    const files = { '': 'index.html', protection_schemes: 'protection_schemes.html', delivery: 'delivery.html', contacts: 'contacts.html', returns: 'returns.html' };
    for (const [slug, file] of Object.entries(files)) {
      const canon = linkHrefs(read(file), 'canonical');
      assert.deepEqual(canon, [`${ORIGIN}/${slug}`], file);
    }
  });
});

describe('sitemap-products.xml', () => {
  it('кожен видимий slug → /p/<slug>, рівно по одному <url>', async () => {
    const res = await call(fns.products, '/sitemap-products.xml', { DB: slugsDB(['a-1', 'b-2', 'c-3']) });
    assert.equal(res.status, 200);
    const xml = await res.text();
    assertWellFormed(xml, 'urlset');
    assert.deepEqual(locs(xml), [`${ORIGIN}/p/a-1`, `${ORIGIN}/p/b-2`, `${ORIGIN}/p/c-3`]);
  });

  it('спецсимволи в slug екрануються (& < >)', async () => {
    const xml = await (await call(fns.products, '/sitemap-products.xml', { DB: slugsDB(['a&b', 'x<y']) })).text();
    assertWellFormed(xml, 'urlset');
    assert.deepEqual(locs(xml).map(unescapeXml), [`${ORIGIN}/p/a&b`, `${ORIGIN}/p/x<y`]);
  });

  it('порожня вибірка вважається збоєм: 503, а не «0 сторінок» зі статусом 200, і не кешується', async () => {
    const res = await call(fns.products, '/sitemap-products.xml', { DB: slugsDB([]) });
    assert.equal(res.status, 503);
    assert.ok(res.headers.get('retry-after'));
    assert.ok(![...cacheStore.keys()].some(k => !k.includes('__stale') && k.includes('sitemap-products')), 'порожня карта потрапила в кеш');
  });

  it('збій D1: запасна копія (X-Cache: STALE), а без неї — 503', async () => {
    const ok = await call(fns.products, '/sitemap-products.xml', { DB: slugsDB(['a-1']) });
    const okXml = await ok.text();
    cacheStore.delete(`${ORIGIN}/sitemap-products.xml`);
    const bad = { DB: makeDB(() => { throw new Error('D1_ERROR'); }) };
    const stale = await call(fns.products, '/sitemap-products.xml', bad);
    assert.equal(stale.status, 200);
    assert.equal(stale.headers.get('x-cache'), 'STALE');
    assert.equal(await stale.text(), okXml);

    installCaches();
    const none = await call(fns.products, '/sitemap-products.xml', bad);
    assert.equal(none.status, 503);
  });

  it('відповідь кешується на edge (Cache-Control з max-age)', async () => {
    const res = await call(fns.products, '/sitemap-products.xml', { DB: slugsDB(['a-1']) });
    assert.match(res.headers.get('cache-control'), /max-age=\d+/);
  });

  it('HEAD-запит обробляється так само, як GET (краулери перевіряють HEAD-ом)', async () => {
    const res = await call(fns.products, '/sitemap-products.xml', { DB: slugsDB(['a-1']) }, 'HEAD');
    assert.equal(res.status, 200);
  });

  it('ліміт протоколу: не більше 50 000 URL у файлі', async () => {
    const slugs = Array.from({ length: 2400 }, (_, i) => `s-${i}`);
    const xml = await (await call(fns.products, '/sitemap-products.xml', { DB: slugsDB(slugs) })).text();
    assert.ok(locs(xml).length <= 50000);
    assert.ok(Buffer.byteLength(xml) < 50 * 1024 * 1024);
  });
});

describe('sitemap ↔ robots.txt', () => {
  const robots = parseRobots(read('robots.txt'));
  it('жоден URL із sitemap не заборонений у robots.txt для Googlebot', async () => {
    const main = await (await call(fns.main, '/sitemap-main.xml', { DB: catsDB(['chemicals', 'soil']) })).text();
    const prod = await (await call(fns.products, '/sitemap-products.xml', { DB: slugsDB(['ridomil-gold-mc-25g']) })).text();
    for (const u of [...locs(main), ...locs(prod)].map(unescapeXml)) {
      const p = u.replace(ORIGIN, '');
      assert.ok(isAllowed(robots, p, 'Googlebot'), `${p} є в sitemap, але заборонений robots.txt`);
    }
  });
});
