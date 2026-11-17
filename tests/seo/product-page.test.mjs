// Регресія SEO сторінки товару /p/<slug> (functions/p/[slug].js) — найважливіший шаблон сайту (~2200 URL).
// Справжній код функції виконується з підробленою D1; перевіряється саме HTML, який бачить Googlebot.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadFn, installCaches, productDB, ctx, ORIGIN } from './helpers/runtime.mjs';
import { titles, h1s, metaContent, linkHrefs, jsonLd, htmlLang, findEmptyValues } from './helpers/html.mjs';

const BASE = {
  pid: 1, sku: 'RG-025', name: 'Ридомил Голд МЦ 68 WG, 25 г', price: 85, category: 'АГРОХІМІКАТИ',
  brand: 'Syngenta', in_stock: 1, slug: 'ridomil-gold-mc-25g',
  annotation: '**Ридомил Голд МЦ** — контактно-системний фунгіцид.\n\n- проти фітофторозу\n- проти пероноспорозу',
  keywords: '', meta_title: null, meta_desc: null, sale_price: null, sale_until: null, display_name: null,
  group_id: null, variant_label: null, image_ok: 1, active_ingredient: '', dosage: '', divisible: 0, divisor: null, visible: 1,
};
const CATS = [{ db_name: 'АГРОХІМІКАТИ', key: 'chemicals' }, { db_name: 'НАСІННЯ ВАГОВЕ', key: 'weight' }];

let onRequest;
let cacheStore;

beforeEach(async () => {
  cacheStore = installCaches();
  ({ onRequest } = await loadFn('functions/p/[slug].js'));
});

async function render(over = {}, db = {}, query = '') {
  cacheStore.clear();                       // кожен render() — «холодний» кеш, щоб тести не бачили чужу відповідь
  const p = { ...BASE, ...over };
  const env = { DB: productDB({ products: [p], categories: CATS, ...db }) };
  const c = ctx(`${ORIGIN}/p/${p.slug}${query}`, { env, params: { slug: p.slug } });
  const res = await onRequest(c);
  await c.settled();
  const html = await res.text();
  return { res, html, p };
}
const ld = html => jsonLd(html);
const product = html => ld(html).find(o => o['@type'] === 'Product');
const crumbs = html => ld(html).find(o => o['@type'] === 'BreadcrumbList');

describe('/p/<slug>: базові SEO-теги', () => {
  it('200, text/html, lang=uk, без noindex', async () => {
    const { res, html } = await render();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.equal(htmlLang(html), 'uk');
    assert.deepEqual(metaContent(html, 'robots'), [], 'на товарній сторінці не має бути meta robots');
    assert.ok(!/noindex/i.test(html.slice(0, html.indexOf('</head>'))), 'noindex у <head>');
  });

  it('рівно один <title>, один <h1>, один canonical, один description', async () => {
    const { html, p } = await render();
    assert.equal(titles(html).length, 1);
    assert.equal(h1s(html).length, 1);
    assert.equal(h1s(html)[0], p.name);
    assert.equal(linkHrefs(html, 'canonical').length, 1);
    assert.equal(metaContent(html, 'description').length, 1);
  });

  it('title: за замовчуванням «назва — магазин, місто»; meta_title має пріоритет', async () => {
    const a = await render();
    assert.equal(titles(a.html)[0], 'Ридомил Голд МЦ 68 WG, 25 г — Агроном, м. Володимир');
    const b = await render({ meta_title: 'Ридомил Голд купити у Володимирі' });
    assert.equal(titles(b.html)[0], 'Ридомил Голд купити у Володимирі');
  });

  it('display_name замінює назву в h1/og:title/JSON-LD name', async () => {
    const { html } = await render({ display_name: 'Ридомил Голд МЦ' });
    assert.equal(h1s(html)[0], 'Ридомил Голд МЦ');
    assert.equal(metaContent(html, 'og:title', 'property')[0], 'Ридомил Голд МЦ');
    assert.equal(product(html).name, 'Ридомил Голд МЦ');
  });

  it('description: без markdown, не довший за 300 символів, не порожній', async () => {
    const long = '**Жирний** текст. '.repeat(60);
    const { html } = await render({ annotation: long });
    const d = metaContent(html, 'description')[0];
    assert.ok(d.length > 0 && d.length <= 300, `довжина ${d.length}`);
    assert.ok(!/[*#]/.test(d), 'markdown-розмітка в description: ' + d.slice(0, 60));
  });

  it('description: meta_desc має пріоритет; без анотації — запасний текст із назвою магазину', async () => {
    const a = await render({ meta_desc: 'Власний опис для видачі.' });
    assert.equal(metaContent(a.html, 'description')[0], 'Власний опис для видачі.');
    const b = await render({ annotation: '', meta_desc: '' });
    const d = metaContent(b.html, 'description')[0];
    assert.ok(d.includes('Ридомил Голд') && d.includes('Агроном'), d);
  });

  it('canonical = https://<домен>/p/<slug> і збігається з og:url та JSON-LD offers.url', async () => {
    const { html, p } = await render();
    const want = `${ORIGIN}/p/${p.slug}`;
    assert.equal(linkHrefs(html, 'canonical')[0], want);
    assert.equal(metaContent(html, 'og:url', 'property')[0], want);
    assert.equal(product(html).offers.url, want);
  });

  it('canonical не містить query (?r=thanks / ?utm=…)', async () => {
    for (const q of ['?r=thanks', '?r=robot', '?utm_source=fb&x=1']) {
      const { html, p } = await render({}, {}, q);
      assert.equal(linkHrefs(html, 'canonical')[0], `${ORIGIN}/p/${p.slug}`, q);
    }
  });

  it('og/twitter: type=product, title, description, абсолютний image', async () => {
    const { html } = await render({}, { images: { 1: ['IMG/ridomil.webp'] } });
    assert.equal(metaContent(html, 'og:type', 'property')[0], 'product');
    assert.ok(metaContent(html, 'og:title', 'property')[0]);
    assert.ok(metaContent(html, 'og:description', 'property')[0]);
    assert.equal(metaContent(html, 'og:image', 'property')[0], `${ORIGIN}/IMG/ridomil.webp`);
    assert.equal(metaContent(html, 'twitter:card')[0], 'summary_large_image');
    assert.equal(metaContent(html, 'twitter:image')[0], `${ORIGIN}/IMG/ridomil.webp`);
  });

  it('без фото: og:image — абсолютний запасний логотип, а не порожній рядок', async () => {
    const { html } = await render();
    assert.equal(metaContent(html, 'og:image', 'property')[0], `${ORIGIN}/android-chrome-512x512.png`);
  });

  it('спецсимволи в назві (лапки, <, &) не ламають атрибути', async () => {
    const { html } = await render({ name: 'Засіб "Тест" <b> & Ко', display_name: null });
    assert.equal(titles(html).length, 1);
    assert.equal(metaContent(html, 'og:title', 'property')[0], 'Засіб "Тест" <b> & Ко');
    assert.equal(metaContent(html, 'description').length, 1);
  });
});

describe('/p/<slug>: JSON-LD Product', () => {
  it('усі JSON-LD блоки — валідний JSON з @context schema.org', async () => {
    const { html } = await render();
    const blocks = ld(html);
    assert.ok(blocks.length >= 2);
    for (const b of blocks) assert.equal(b['@context'], 'https://schema.org');
  });

  it('обов’язкові поля Product та Offer', async () => {
    const { html, p } = await render({}, { images: { 1: ['IMG/a.webp'] } });
    const pr = product(html);
    assert.equal(pr.name, p.name);
    assert.equal(pr.sku, 'RG-025');
    assert.equal(pr.mpn, 'RG-025');
    assert.equal(pr.brand['@type'], 'Brand');
    assert.equal(pr.brand.name, 'Syngenta');
    assert.ok(pr.description && pr.description.length <= 500);
    assert.equal(typeof pr.offers.price, 'number');
    assert.equal(pr.offers.price, 85);
    assert.equal(pr.offers.priceCurrency, 'UAH');
    assert.equal(pr.offers.availability, 'https://schema.org/InStock');
    assert.deepEqual(pr.image, [`${ORIGIN}/IMG/a.webp`]);
  });

  it('category — ієрархічний формат «Рівень1 > Рівень2» (інакше GSC: недійсне значення)', async () => {
    const { html } = await render();
    assert.equal(product(html).category, 'Агротовари > Агрохімікати');
    const w = await render({ category: 'НАСІННЯ ВАГОВЕ', slug: 'w1', pid: 2 });
    assert.equal(product(w.html).category, 'Агротовари > Насіння > Вагове');
  });

  it('порожня/NULL category не потрапляє в JSON-LD як null', async () => {
    for (const category of [null, '', '   ']) {
      const { html } = await render({ category });
      assert.ok(!('category' in product(html)), JSON.stringify(category));
    }
  });

  it('у JSON-LD немає null / undefined / порожніх рядків', async () => {
    const { html } = await render({ brand: '', sku: null }, { images: { 1: ['IMG/a.webp'] } });
    for (const o of ld(html)) assert.deepEqual(findEmptyValues(o), [], JSON.stringify(o).slice(0, 200));
  });

  it('без бренду: немає brand, є identifier_exists=no; mpn = slug, коли sku порожній', async () => {
    const { html, p } = await render({ brand: '', sku: '' });
    const pr = product(html);
    assert.ok(!('brand' in pr));
    assert.deepEqual(pr.additionalProperty, [{ '@type': 'PropertyValue', name: 'identifier_exists', value: 'no' }]);
    assert.equal(pr.mpn, p.slug);
    assert.ok(!('sku' in pr));
  });

  it('з брендом identifier_exists не додається', async () => {
    const { html } = await render();
    assert.ok(!('additionalProperty' in product(html)));
  });

  it('товар у наявності: є політика повернення та доставка', async () => {
    const { html } = await render();
    const o = product(html).offers;
    assert.equal(o.hasMerchantReturnPolicy['@type'], 'MerchantReturnPolicy');
    assert.equal(o.hasMerchantReturnPolicy.merchantReturnDays, 14);
    assert.equal(o.shippingDetails['@type'], 'OfferShippingDetails');
    assert.equal(o.shippingDetails.shippingRate.currency, 'UAH');
  });

  it('немає в наявності: OutOfStock і БЕЗ повернення/доставки (інакше помилка GSC)', async () => {
    const { html } = await render({ in_stock: 0 });
    const o = product(html).offers;
    assert.equal(o.availability, 'https://schema.org/OutOfStock');
    assert.ok(!('hasMerchantReturnPolicy' in o));
    assert.ok(!('shippingDetails' in o));
  });

  it('акція: у Offer ціна зі знижкою + priceValidUntil; прострочена акція ігнорується', async () => {
    const future = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    const past = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const a = await render({ sale_price: 70, sale_until: future });
    assert.equal(product(a.html).offers.price, 70);
    assert.equal(product(a.html).offers.priceValidUntil, future);
    const b = await render({ sale_price: 70, sale_until: past });
    assert.equal(product(b.html).offers.price, 85);
    assert.ok(!('priceValidUntil' in product(b.html).offers));
    const c = await render({ sale_price: 90, sale_until: future });   // «знижка» вища за ціну
    assert.equal(product(c.html).offers.price, 85);
  });

  it('URL фото: абсолютні, пробіли/кома/кирилиця закодовані, URL валідний', async () => {
    const path = 'IMG/Краспедія Соларіс 0,1г (GL Seeds).webp';
    const { html } = await render({}, { images: { 1: [path] } });
    const [u] = product(html).image;
    assert.ok(u.startsWith(ORIGIN + '/IMG/'), u);
    assert.ok(!/[\s,А-Яа-яІіЇїЄє]/.test(u), 'незакодовані символи: ' + u);
    assert.doesNotThrow(() => new URL(u));
    assert.ok(u.includes('%20') && u.includes('%2C'));
  });

  it('відгуки: у structured data лише оцінки 1–5; aggregateRating коректний', async () => {
    const mk = (rating, text = 'Добре') => ({ name: 'Іван', rating, text, img: null, created_at: '2026-01-01' });
    const { html } = await render({}, { reviews: { 1: [mk(5), mk(0), mk(4), mk(null)] } });
    const pr = product(html);
    assert.equal(pr.aggregateRating.reviewCount, 2);
    assert.equal(pr.aggregateRating.ratingValue, 4.5);
    assert.equal(pr.review.length, 2);
    for (const r of pr.review) assert.ok(r.reviewRating.ratingValue >= 1 && r.reviewRating.ratingValue <= 5);
  });

  it('без відгуків: немає aggregateRating і review', async () => {
    const { html } = await render();
    const pr = product(html);
    assert.ok(!('aggregateRating' in pr) && !('review' in pr));
  });

  it('</script> у даних не виходить із JSON-LD блоку (XSS/ламання розмітки)', async () => {
    const evil = 'Тест </script><script>alert(1)</script>';
    const { html } = await render({ name: evil });
    assert.ok(!html.includes('<script>alert(1)'), 'ін’єкція скрипта');
    assert.equal(product(html).name, evil);
  });
});

describe('/p/<slug>: BreadcrumbList', () => {
  it('позиції послідовні, URL абсолютні, останній елемент = canonical', async () => {
    const { html, p } = await render();
    const items = crumbs(html).itemListElement;
    assert.deepEqual(items.map(i => i.position), items.map((_, i) => i + 1));
    for (const i of items) assert.ok(i.item.startsWith(ORIGIN), i.item);
    assert.equal(items.at(-1).item, `${ORIGIN}/p/${p.slug}`);
    assert.equal(items[1].item, `${ORIGIN}/category?cat=chemicals`);
  });

  it('невідома категорія в D1: крихта веде на головну, а не на /category?cat=', async () => {
    const { html } = await render({}, { categories: [] });
    assert.equal(crumbs(html).itemListElement[1].item, `${ORIGIN}/`);
  });
});

describe('/p/<slug>: статуси та відмовостійкість', () => {
  it('невідомий slug → справжній 404 (не soft-404 із 200), не кешується', async () => {
    const env = { DB: productDB({ products: [BASE] }) };
    for (let i = 0; i < 2; i++) {
      const c = ctx(`${ORIGIN}/p/nonexistent`, { env, params: { slug: 'nonexistent' } });
      const res = await onRequest(c);
      assert.equal(res.status, 404);
      await c.settled();
    }
    assert.ok(![...cacheStore.keys()].some(k => k.includes('nonexistent')), '404 потрапив у кеш');
  });

  it('прихований товар (visible=0) → 404', async () => {
    const env = { DB: productDB({ products: [{ ...BASE, visible: 0 }] }) };
    const res = await onRequest(ctx(`${ORIGIN}/p/${BASE.slug}`, { env, params: { slug: BASE.slug } }));
    assert.equal(res.status, 404);
  });

  it('збій D1 без запасної копії → 503 + Retry-After + no-store (а не порожня сторінка зі 200)', async () => {
    const env = { DB: productDB({ fail: true }) };
    const res = await onRequest(ctx(`${ORIGIN}/p/${BASE.slug}`, { env, params: { slug: BASE.slug } }));
    assert.equal(res.status, 503);
    assert.ok(res.headers.get('retry-after'));
    assert.match(res.headers.get('cache-control'), /no-store/);
  });

  it('збій D1 при наявності запасної копії → віддається копія (X-Cache: STALE), не 5xx', async () => {
    const ok = await render();
    assert.equal(ok.res.status, 200);
    cacheStore.delete(`${ORIGIN}/p/${BASE.slug}`);               // свіжий кеш «протух», запасна копія лишилась
    const env = { DB: productDB({ fail: true }) };
    const res = await onRequest(ctx(`${ORIGIN}/p/${BASE.slug}`, { env, params: { slug: BASE.slug } }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-cache'), 'STALE');
    assert.equal(linkHrefs(await res.text(), 'canonical')[0], `${ORIGIN}/p/${BASE.slug}`);
  });

  it('повторний запит віддається з кешу, не б’є по D1', async () => {
    const ok = await render();
    assert.equal(ok.res.headers.get('x-cache'), 'MISS');
    let hits = 0;
    const env = { DB: { prepare: () => { hits++; throw new Error('D1 не мав викликатись'); } } };
    const res = await onRequest(ctx(`${ORIGIN}/p/${BASE.slug}`, { env, params: { slug: BASE.slug } }));
    assert.equal(res.headers.get('x-cache'), 'HIT');
    assert.equal(hits, 0);
  });
});
