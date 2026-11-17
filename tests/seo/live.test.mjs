// «Живі» HTTP-перевірки SEO: ті самі інваріанти, але через справжні запити.
//   SEO_BASE_URL=https://agronom.pp.ua node tests/seo/run.mjs     — продакшн / превʼю-деплой
//   SEO_BASE_URL=local                                              — локальний імітатор Pages (за замовчуванням у run.mjs)
// Необов'язково: SEO_SAMPLE=8 (скільки товарних сторінок вибірково), SEO_MIN_PRODUCTS=100, SEO_PAGESDEV_URL=https://agronom1.pages.dev
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLocalServer } from './helpers/local-server.mjs';
import { fingerprint, jsonLd, h1s, titles, metaContent, linkHrefs } from './helpers/html.mjs';
import { parseRobots, isAllowed } from './helpers/robots.mjs';

const WANT = process.env.SEO_BASE_URL;
const CANON = (process.env.SEO_CANONICAL_ORIGIN || 'https://agronom.pp.ua').replace(/\/$/, '');
const SAMPLE = Number(process.env.SEO_SAMPLE || 5);
const MIN_PRODUCTS = Number(process.env.SEO_MIN_PRODUCTS || (WANT === 'local' ? 5 : 100));

let BASE, server;
before(async () => {
  if (!WANT) return;
  if (WANT === 'local') { server = await startLocalServer(); BASE = server.url; } else BASE = WANT.replace(/\/$/, '');
});
after(async () => { if (server) await server.close(); });

const get = (p, opts = {}) => fetch(BASE + p, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }, ...opts });
const locs = xml => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => m[1].replace(/&amp;/g, '&'));
const toPath = u => u.replace(/^https?:\/\/[^/]+/, '');
const pick = (arr, n) => (arr.length <= n ? arr : Array.from({ length: n }, (_, i) => arr[Math.floor((i * (arr.length - 1)) / Math.max(n - 1, 1))]));
const noNoindexHeader = res => assert.ok(!/noindex/i.test(res.headers.get('x-robots-tag') || ''), 'X-Robots-Tag: ' + res.headers.get('x-robots-tag'));

const opts = { skip: WANT ? false : 'задайте SEO_BASE_URL (або local), щоб увімкнути живі перевірки' };

describe('live: ключові сторінки', opts, () => {
  it('/ → 200, canonical, один h1, WebSite JSON-LD, без noindex', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    noNoindexHeader(res);
    const html = await res.text();
    const fp = fingerprint(html);
    assert.equal(fp.canonical, `${CANON}/`);
    assert.equal(fp.h1Count, 1);
    assert.ok(fp.title && fp.description);
    assert.ok(fp.jsonLdTypes.includes('WebSite'));
    assert.ok(!/noindex/i.test(fp.robots));
  });

  it('/index.html → 301 на /', async () => {
    const res = await get('/index.html');
    assert.equal(res.status, 301);
    // Cloudflare віддає Location відносним ('/'), локальний імітатор — абсолютним; обидва варіанти еквівалентні
    assert.equal(new URL(res.headers.get('location'), CANON).href, `${CANON}/`);
  });

  for (const [p, canon] of [['/protection_schemes', '/protection_schemes'], ['/delivery', '/delivery'], ['/contacts', '/contacts'], ['/returns', '/returns'], ['/katalog', '/katalog']]) {
    it(`${p} → 200, canonical ${canon}, один h1`, async () => {
      const res = await get(p);
      assert.equal(res.status, 200);
      noNoindexHeader(res);
      const fp = fingerprint(await res.text());
      assert.equal(fp.canonical, CANON + canon);
      assert.equal(fp.h1Count, 1);
      assert.ok(fp.title && fp.description);
    });
  }

  it('/account.html і /check_photos.html: noindex', async () => {
    for (const p of ['/account', '/check_photos']) {
      const res = await get(p);
      if (res.status === 404) continue;
      assert.equal(res.status, 200, p);
      const html = await res.text();
      assert.match(metaContent(html, 'robots').join(',').toLowerCase() + (res.headers.get('x-robots-tag') || ''), /noindex/, p);
    }
  });
});

describe('live: robots.txt і sitemap', opts, () => {
  let robots, mainLocs = [], productLocs = [];
  before(async () => {
    if (!BASE) return;
    robots = parseRobots(await (await get('/robots.txt')).text());
  });

  it('robots.txt: 200, text/plain, Sitemap вказує на канонічний домен', async () => {
    const res = await get('/robots.txt');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/plain/);
    assert.ok(robots.sitemaps.includes(`${CANON}/sitemap.xml`));
  });

  it('sitemap.xml → індекс із двома під-картами; обидві віддаються 200 application/xml', async () => {
    const idx = await get('/sitemap.xml');
    assert.equal(idx.status, 200);
    const subs = locs(await idx.text());
    assert.ok(subs.length >= 2);
    for (const s of subs) {
      const r = await get(toPath(s));
      assert.equal(r.status, 200, s);
      assert.match(r.headers.get('content-type') || '', /xml/);
      const xml = await r.text();
      if (s.includes('sitemap-main')) mainLocs = locs(xml);
      if (s.includes('sitemap-products')) productLocs = locs(xml);
    }
  });

  it(`sitemap-products: ≥ ${MIN_PRODUCTS} URL, без дублів, усі /p/<slug> на канонічному домені`, () => {
    assert.ok(productLocs.length >= MIN_PRODUCTS, `лише ${productLocs.length}`);
    assert.equal(new Set(productLocs).size, productLocs.length, 'дублі');
    for (const u of productLocs) assert.match(u, new RegExp(`^${CANON.replace(/[.]/g, '\\.')}/p/[^/?#]+$`));
  });

  it('жоден URL sitemap не заборонений у robots.txt', () => {
    for (const u of [...mainLocs, ...pick(productLocs, 50)]) assert.ok(isAllowed(robots, toPath(u), 'Googlebot'), u);
  });

  it('кожен URL sitemap-main віддає 200 і canonical, що дорівнює цьому URL', async () => {
    assert.ok(mainLocs.length >= 6);
    for (const u of mainLocs) {
      const res = await get(toPath(u));
      assert.equal(res.status, 200, `${u} → ${res.status}`);
      const canon = linkHrefs(await res.text(), 'canonical')[0];
      assert.equal(canon, u, `canonical ${canon} ≠ ${u}`);
    }
  });

  describe('вибірка товарних сторінок', () => {
    it(`${SAMPLE} URL із sitemap: 200, canonical = URL, один title/h1, валідний Product JSON-LD, без noindex`, async () => {
      assert.ok(productLocs.length > 0, 'sitemap-products порожній');
      for (const u of pick(productLocs, SAMPLE)) {
        const res = await get(toPath(u));
        assert.equal(res.status, 200, u);
        noNoindexHeader(res);
        const html = await res.text();
        assert.deepEqual(linkHrefs(html, 'canonical'), [u], u);
        assert.equal(titles(html).length, 1, u);
        assert.equal(h1s(html).length, 1, u);
        assert.ok(metaContent(html, 'description')[0], u);
        assert.match(metaContent(html, 'og:image', 'property')[0] || '', /^https?:\/\//, u);
        const p = jsonLd(html).find(o => o['@type'] === 'Product');
        assert.ok(p, `немає Product JSON-LD: ${u}`);
        assert.ok(p.name && p.offers && p.offers.priceCurrency === 'UAH', u);
        assert.ok(/schema\.org\/(InStock|OutOfStock)$/.test(p.offers.availability), u);
        assert.ok(Number(p.offers.price) > 0, `ціна ${p.offers.price}: ${u}`);
      }
    });
  });

  it('products.json віддається з X-Robots-Tag: noindex, а HTML-сторінки — ні', async () => {
    const j = await get('/products.json');
    assert.equal(j.headers.get('x-robots-tag'), 'noindex', 'products.json без noindex');
    const h = await get('/');
    assert.ok(!/noindex/i.test(h.headers.get('x-robots-tag') || ''));
  });

  it('невідомий slug → справжній 404', async () => {
    const res = await get('/p/this-slug-does-not-exist-' + Date.now());
    assert.equal(res.status, 404);
  });
});

describe('live: категорії, закриті шляхи, технічний домен', opts, () => {
  it('кожна категорія з sitemap-main: 200, унікальний canonical із ?cat=, непорожній title', async () => {
    const main = locs(await (await get('/sitemap-main.xml')).text()).filter(u => u.includes('/category?cat='));
    assert.ok(main.length >= 5, 'категорій у sitemap-main: ' + main.length);
    const seen = new Set();
    for (const u of main) {
      const res = await get(toPath(u));
      assert.equal(res.status, 200, u);
      const fp = fingerprint(await res.text());
      assert.equal(fp.canonical, u);
      assert.ok(fp.title && fp.title.length > 3, u);
      assert.ok(fp.h1 && fp.h1.length > 1, `порожній <h1> у сирому HTML: ${u}`);
      assert.equal(fp.h1Count, 1, u);
      seen.add(fp.canonical);
    }
    assert.equal(seen.size, main.length);
  });

  it('невідомий ?cat= → 404', async () => {
    const res = await get('/category?cat=zzz-not-exist-' + Date.now());
    assert.equal(res.status, 404);
  });

  for (const p of ['/db/schema.sql', '/deploy.sh', '/package.json', '/.git/config', '/prerender.py', '/docs/ux-refactor-plan.md', '/tests/seo/helpers/runtime.mjs']) {
    it(`${p} → 404`, async () => {
      const res = await get(p);
      assert.equal(res.status, 404, `${p} віддається публічно (${res.status})`);
    });
  }

  it('технічний домен *.pages.dev → 308 на основний (лише якщо задано SEO_PAGESDEV_URL)', { skip: process.env.SEO_PAGESDEV_URL ? false : 'SEO_PAGESDEV_URL не задано' }, async () => {
    const res = await fetch(process.env.SEO_PAGESDEV_URL.replace(/\/$/, '') + '/p/x?y=1', { redirect: 'manual' });
    assert.equal(res.status, 308);
    assert.equal(res.headers.get('location'), `${CANON}/p/x?y=1`);
  });
});
