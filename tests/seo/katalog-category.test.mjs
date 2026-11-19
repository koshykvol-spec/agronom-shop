// Регресія серверних списків розділів /katalog/<key>[?page=N] (functions/katalog/[cat].js).
// Це хаби для краулу товарів: у /category?cat=<key> сітку малює app.js, тож у сирому HTML там немає <a href="/p/…>.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadFn, installCaches, makeDB, ctx, read, ORIGIN } from './helpers/runtime.mjs';
import { titles, h1s, metaContent, linkHrefs, htmlLang, anchorHrefs, jsonLd } from './helpers/html.mjs';

let onRequest, store, queries;
beforeEach(async () => {
  store = installCaches();
  queries = [];
  ({ onRequest } = await loadFn('functions/katalog/[cat].js'));
});

const CAT = { key: 'domestic', db_name: 'НАСІННЯ ВІТЧИЗНЯНЕ', nav_label: 'НАСІННЯ ВІТЧИЗНЯНЕ', h1: 'Вітчизняне насіння', seo_desc: 'desc' };
// n товарів: перші 10 «немає в наявності» (мають піти в кінець), решта в наявності
const mkProducts = n => Array.from({ length: n }, (_, i) => ({ pid: i + 1, slug: `tovar-${i + 1}`, name: `Товар ${i + 1}`, price: 10 + i, ins: i < 10 ? 0 : 1 }));

function dbWith(products, cat = CAT) {
  return {
    DB: makeDB((sql, binds) => {
      queries.push(sql);
      if (sql.includes('FROM categories WHERE key = ?')) return binds[0] === cat.key ? [cat] : [];
      if (sql.includes('SELECT COUNT(*) AS n FROM products p JOIN product_content c')) return [{ n: products.length }];
      if (sql.includes('ORDER BY p.in_stock DESC, p.pid LIMIT ? OFFSET ?')) {
        const [, limit, offset] = binds;
        return [...products].sort((a, b) => (b.ins - a.ins) || (a.pid - b.pid)).slice(offset, offset + limit);
      }
      return [];
    }),
  };
}
const down = () => ({ DB: makeDB(() => { throw new Error('D1_ERROR'); }) });
const get = async (path, env) => {
  const key = decodeURIComponent(path.split('?')[0].split('/')[2] || '');
  const c = ctx(`${ORIGIN}${path}`, { env, params: { cat: key } });
  const res = await onRequest(c); await c.settled();
  return { res, html: await res.text() };
};

describe('/katalog/<key> — перша сторінка', () => {
  it('200, lang=uk, один title/h1/description, canonical без ?page=, index,follow', async () => {
    const { res, html } = await get('/katalog/domestic', dbWith(mkProducts(130)));
    assert.equal(res.status, 200);
    assert.equal(htmlLang(html), 'uk');
    assert.equal(titles(html).length, 1);
    assert.equal(h1s(html).length, 1);
    assert.equal(metaContent(html, 'description').length, 1);
    assert.deepEqual(linkHrefs(html, 'canonical'), [`${ORIGIN}/katalog/domestic`]);
    const robots = metaContent(html, 'robots').join(',').toLowerCase();
    assert.ok(!robots.includes('noindex') && robots.includes('follow'), robots);
  });

  it('рівно 60 живих посилань <a href="/p/slug"> на сторінці, товари в наявності йдуть першими', async () => {
    const { html } = await get('/katalog/domestic', dbWith(mkProducts(130)));
    const p = anchorHrefs(html).filter(h => h.startsWith('/p/'));
    assert.equal(p.length, 60);
    assert.equal(p[0], '/p/tovar-11');          // перші 10 товарів без наявності пішли в кінець
    assert.ok(!p.includes('/p/tovar-1'));
  });

  it('title/description унікальні для розділу, без «undefined», з кількістю товарів', async () => {
    const { html } = await get('/katalog/domestic', dbWith(mkProducts(130)));
    assert.match(titles(html)[0], /Вітчизняне насіння/);
    assert.match(metaContent(html, 'description')[0], /130 позицій/);
    assert.ok(!/undefined|null|NaN/.test(html));
  });

  it('є посилання на інтерактивну /category?cat=<key> і назад на /katalog', async () => {
    const { html } = await get('/katalog/domestic', dbWith(mkProducts(5)));
    const a = anchorHrefs(html);
    assert.ok(a.includes('/category?cat=domestic') && a.includes('/katalog'));
  });

  it('BreadcrumbList у JSON-LD валідний, останній елемент = canonical', async () => {
    const { html } = await get('/katalog/domestic', dbWith(mkProducts(5)));
    const bl = jsonLd(html).find(j => j['@type'] === 'BreadcrumbList');
    assert.ok(bl);
    assert.equal(bl.itemListElement.at(-1).item, `${ORIGIN}/katalog/domestic`);
  });

  it('назви й slug екрануються', async () => {
    const env = dbWith([{ pid: 1, slug: 'a&b "x"', name: 'Альфа <b>&</b> "Омега"', price: 5, ins: 1 }]);
    const { html } = await get('/katalog/domestic', env);
    assert.ok(html.includes('Альфа &lt;b&gt;&amp;&lt;/b&gt; &quot;Омега&quot;'));
    assert.ok(!html.includes('<b>&</b>'));
    assert.ok(anchorHrefs(html).includes('/p/a%26b%20%22x%22'));
  });

  it('усі посилання внутрішні й без .html', async () => {
    const { html } = await get('/katalog/domestic', dbWith(mkProducts(130)));
    for (const h of anchorHrefs(html)) assert.ok(h.startsWith('/') && !/\.html(\?|$)/.test(h), h);
  });
});

describe('/katalog/<key>?page=N — пагінація', () => {
  it('сторінка 2: canonical з ?page=2, rel=prev/next, інші товари, окремий title', async () => {
    const env = dbWith(mkProducts(130));
    const p1 = (await get('/katalog/domestic', env)).html;
    const { res, html } = await get('/katalog/domestic?page=2', env);
    assert.equal(res.status, 200);
    assert.deepEqual(linkHrefs(html, 'canonical'), [`${ORIGIN}/katalog/domestic?page=2`]);
    assert.notEqual(titles(html)[0], titles(p1)[0]);
    const a = anchorHrefs(html);
    assert.ok(a.includes('/katalog/domestic') && a.includes('/katalog/domestic?page=3'));
    const prods = a.filter(h => h.startsWith('/p/'));
    assert.equal(prods.length, 60);
    const first = new Set(anchorHrefs(p1).filter(h => h.startsWith('/p/')));
    assert.ok(prods.every(h => !first.has(h)), 'товари сторінок 1 і 2 перетинаються');
  });

  it('остання сторінка містить залишок; усі 130 товарів досяжні посиланнями рівно по одному разу', async () => {
    const env = dbWith(mkProducts(130));
    const seen = [];
    for (const path of ['/katalog/domestic', '/katalog/domestic?page=2', '/katalog/domestic?page=3']) {
      seen.push(...anchorHrefs((await get(path, env)).html).filter(h => h.startsWith('/p/')));
    }
    assert.equal(seen.length, 130);
    assert.equal(new Set(seen).size, 130);
  });

  it('?page за межами, нечислове, 0, від\'ємне, надто велике → 404', async () => {
    const env = dbWith(mkProducts(130));
    for (const q of ['4', '999', 'abc', '0', '-1', '1.5', '1e3', '99999']) {
      const { res } = await get(`/katalog/domestic?page=${q}`, env);
      assert.equal(res.status, 404, q);
    }
  });

  it('?page=1 → 301 на чисту адресу (одна канонічна адреса першої сторінки)', async () => {
    const { res } = await get('/katalog/domestic?page=1', dbWith(mkProducts(130)));
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), `${ORIGIN}/katalog/domestic`);
  });

  it('кеш розрізняє сторінки: сторінка 2 не віддається з кешу сторінки 1', async () => {
    const env = dbWith(mkProducts(130));
    const a = await get('/katalog/domestic', env);
    const b = await get('/katalog/domestic?page=2', env);
    assert.notEqual(a.html, b.html);
    const again = await get('/katalog/domestic?page=2', env);
    assert.equal(again.res.headers.get('x-cache'), 'HIT');
    assert.equal(again.html, b.html);
  });
});

describe('/katalog/<key> — відсутні розділи та збої', () => {
  it('невідомий розділ → 404 без кешування', async () => {
    const { res } = await get('/katalog/nope', dbWith(mkProducts(5)));
    assert.equal(res.status, 404);
    assert.ok(![...store.keys()].some(k => k.includes('/katalog/nope')));
  });

  it('некоректний ключ → 404, D1 не чіпається', async () => {
    const env = dbWith(mkProducts(5));
    for (const k of ['a b', 'x'.repeat(41), '%3Cscript%3E', '..']) {
      const c = ctx(`${ORIGIN}/katalog/x`, { env, params: { cat: decodeURIComponent(k) } });
      assert.equal((await onRequest(c)).status, 404, k);
    }
    assert.equal(queries.length, 0);
  });

  it('розділ без видимих товарів → 404 (не порожня сторінка зі статусом 200)', async () => {
    const { res } = await get('/katalog/domestic', dbWith([]));
    assert.equal(res.status, 404);
  });

  it('збій D1 без запасної копії → 503 + Retry-After, нічого не кешується', async () => {
    const { res } = await get('/katalog/domestic', down());
    assert.equal(res.status, 503);
    assert.ok(res.headers.get('retry-after'));
    assert.match(res.headers.get('cache-control'), /no-store/);
    assert.equal(store.size, 0);
  });

  it('збій D1 після вдалої відповіді → запасна копія X-Cache: STALE', async () => {
    const ok = await get('/katalog/domestic', dbWith(mkProducts(30)));
    store.delete(`${ORIGIN}/katalog/domestic`);
    const { res, html } = await get('/katalog/domestic', down());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-cache'), 'STALE');
    assert.equal(html, ok.html);
  });
});

describe('/katalog/<key> — вихідний код (запобіжники для D1)', () => {
  const src = read('functions/katalog/[cat].js');
  it('вибірка впорядкована за (in_stock DESC, pid) — збігається з idx_products_cat_stock_pid, без TEMP B-TREE', () => {
    assert.match(src, /ORDER BY p\.in_stock DESC, p\.pid\s+LIMIT \? OFFSET \?/);
    assert.ok(!/ORDER BY[^`]*(LIKE|CASE|lower\()/i.test(src), 'сортування за виразом не використовує індекс');
  });
  it('верхня межа ?page= обмежена (захист від ботів)', () => {
    assert.match(src, /MAX_PAGE\s*=\s*\d+/);
  });
  it('коментар-шапка не суперечить фактичному meta robots', () => {
    assert.match(src, /<meta name="robots" content="index,follow">/);
  });
});

describe('/katalog — блок «Розділи каталогу»', () => {
  it('є посилання на /katalog/<key> для кожної категорії з товарами; збій запиту категорій не ламає сторінку', async () => {
    const { onRequest: katalog } = await loadFn('functions/katalog.js');
    const rows = [{ slug: 'a-1', name: 'A', cat: 'АГРОХІМІКАТИ' }, { slug: 'b-2', name: 'B', cat: 'ГРУНТ' }];
    const mk = failCats => ({ DB: makeDB(sql => {
      if (sql.includes('FROM categories ORDER BY sort')) { if (failCats) throw new Error('D1_ERROR'); return [{ key: 'chemicals', db_name: 'АГРОХІМІКАТИ', nav_label: 'АГРОХІМІКАТИ' }, { key: 'soil', db_name: 'ГРУНТ', nav_label: 'ГРУНТ' }, { key: 'empty', db_name: 'ПОРОЖНЯ', nav_label: 'ПОРОЖНЯ' }]; }
      return sql.includes('FROM products p JOIN product_content c') ? rows : [];
    }) });
    let c = ctx(`${ORIGIN}/katalog`, { env: mk(false) });
    let html = await (await katalog(c)).text();
    const a = anchorHrefs(html);
    assert.ok(a.includes('/katalog/chemicals') && a.includes('/katalog/soil') && !a.includes('/katalog/empty'));
    installCaches();
    c = ctx(`${ORIGIN}/katalog`, { env: mk(true) });
    const res = await katalog(c);
    html = await res.text();
    assert.equal(res.status, 200);
    assert.deepEqual(anchorHrefs(html).filter(h => h.startsWith('/p/')), ['/p/a-1', '/p/b-2']);
  });
});
