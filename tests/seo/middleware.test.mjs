// Регресія functions/_middleware.js: редірект технічного домену, закриті службові файли,
// серверний canonical/title/description для /category?cat=…, свіжий noscript-список категорій на головній.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadFn, installCaches, makeDB, ctx, read, exists, ROOT, ORIGIN } from './helpers/runtime.mjs';
import { titles, h1s, metaContent, linkHrefs, anchorHrefs } from './helpers/html.mjs';

let onRequest;
beforeEach(async () => {
  installCaches();
  ({ onRequest } = await loadFn('functions/_middleware.js'));
});

const htmlNext = body => async () => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const NO_DB = { DB: makeDB(() => []) };

describe('middleware: технічний домен Pages', () => {
  it('agronom1.pages.dev → 308 на agronom.pp.ua зі збереженням шляху та query', async () => {
    const res = await onRequest(ctx('https://agronom1.pages.dev/p/some-slug?x=1', { env: NO_DB }));
    assert.equal(res.status, 308);
    assert.equal(res.headers.get('location'), `${ORIGIN}/p/some-slug?x=1`);
  });

  it('превʼю-деплої <hash>.agronom1.pages.dev не редіректяться', async () => {
    let called = false;
    const res = await onRequest(ctx('https://abc123.agronom1.pages.dev/', { env: NO_DB, next: async () => { called = true; return new Response('x'); } }));
    assert.notEqual(res.status, 308);
    assert.ok(called);
  });
});

describe('middleware: службові файли не віддаються публічно', () => {
  const PRIVATE = [
    '/db/schema.sql', '/db/backups/agronom-db-20260601-1148.sql', '/docs/ux-refactor-plan.md', '/sample/products.json',
    '/cloudflare-worker/order-worker.js', '/cloudflare-worker/wrangler.toml', '/.github/workflows/fb-daily-post.yml',
    '/.git/config', '/node_modules/x/index.js', '/__pycache__/gen_sitemap.cpython-312.pyc',
    '/deploy.sh', '/prerender.py', '/sync_images.py', '/search_update.sql', '/thumb-upload.log', '/db/missing_photos.csv',
    '/post-to-facebook.js', '/posted-log.json', '/package.json', '/h', '/.gitignore', '/.cf-secrets',
    '/' + encodeURIComponent('ЧИТАЙ МЕНЕ.txt'), '/%2564b/schema.sql',
    '/tests/seo/helpers/runtime.mjs', '/tests/seo/product-page.test.mjs',
  ];
  for (const p of PRIVATE) {
    it(`404 для ${p}`, async () => {
      let called = false;
      const res = await onRequest(ctx(ORIGIN + p, { env: NO_DB, next: async () => { called = true; return new Response('LEAK', { status: 200 }); } }));
      assert.equal(res.status, 404);
      assert.equal(called, false, 'запит дійшов до статики');
    });
  }

  const PUBLIC = ['/', '/style.css', '/app.js', '/cart.js', '/footer.js', '/seo-jsonld.js', '/md-render.js', '/seasonal-helper.js',
    '/fonts.css', '/fonts/nunito-IMeaBXso.woff2', '/recipes.css', '/protection_schemes.css', '/protection_schemes.json',
    '/img-map.json', '/recipes.json', '/robots.txt', '/sitemap.xml', '/products.json', '/favicon.ico', '/site.webmanifest',
    '/android-chrome-512x512.png', '/protection_schemes', '/delivery', '/contacts', '/returns', '/katalog', '/category?cat=soil', '/p/slug', '/IMG/a.webp'];
  for (const p of PUBLIC) {
    it(`проходить (не блокується) ${p}`, async () => {
      const res = await onRequest(ctx(ORIGIN + p, { env: NO_DB }));
      assert.notEqual(res.status, 404, `${p} закрито правилом приватних шляхів`);
    });
  }

  it('кожен локальний ресурс, підключений зі сторінок сайту (css/js/img), не потрапляє під блокування', async () => {
    const pages = ['index.html', 'category.html', 'protection_schemes.html', 'delivery.html', 'contacts.html', 'returns.html', 'account.html'];
    const refs = new Set();
    for (const f of pages) {
      const html = read(f);
      for (const m of html.matchAll(/\b(?:src|href)="([^"#?]+)(?:\?[^"]*)?"/g)) {
        const u = m[1];
        if (/^(https?:|\/\/|tel:|mailto:|data:|viber:)/i.test(u) || u.includes("'") || u.includes('+')) continue;
        if (/\.(css|js|png|ico|webmanifest|woff2?|json|svg|webp|jpg)$/i.test(u)) refs.add('/' + u.replace(/^\//, ''));
      }
    }
    assert.ok(refs.size > 5);
    for (const u of refs) {
      const res = await onRequest(ctx(ORIGIN + u, { env: NO_DB }));
      assert.notEqual(res.status, 404, `${u} заблоковано middleware, хоча потрібне сторінці`);
    }
  });

  it('КОЖЕН файл у приватних теках (db, docs, sample, cloudflare-worker, tests, .github) віддає 404 — перевіряється обходом файлової системи', async () => {
    const files = [];
    const walk = dir => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.posix.join(dir, e.name);
        if (e.isDirectory()) walk(rel); else files.push(rel);
      }
    };
    for (const d of ['db', 'docs', 'sample', 'cloudflare-worker', 'tests', '.github']) if (exists(d)) walk(d);
    assert.ok(files.length > 20, 'обхід знайшов підозріло мало файлів: ' + files.length);
    const leaked = [];
    for (const f of files) {
      const res = await onRequest(ctx(`${ORIGIN}/${f.split('/').map(encodeURIComponent).join('/')}`, { env: NO_DB, next: async () => new Response('LEAK', { status: 200 }) }));
      if (res.status !== 404) leaked.push(f);
    }
    assert.deepEqual(leaked, [], 'публічно доступні службові файли');
  });

  it('усі файли, які реально лежать у корені репозиторію й мають бути приватними, закриті', async () => {
    for (const f of ['deploy.sh', 'prerender.py', 'gen-thumbs.py', 'generate_keywords.py', 'sync_images.py', 'upload-thumbs.sh',
      'migration_fts5_search.sql', 'search_update.sql', 'fix_picked_query_indexes.sql', 'thumb-upload.log', 'posted-log.json']) {
      assert.ok(exists(f), `тест застарів: файл ${f} зник`);
      const res = await onRequest(ctx(`${ORIGIN}/${f}`, { env: NO_DB }));
      assert.equal(res.status, 404, f);
    }
  });
});

describe('middleware: /category — серверні canonical/title/description', () => {
  const CATEGORY_HTML = read('category.html');
  // dbWith(row): категорія ІСНУЄ в D1 (row = її SEO-поля, null → порожні поля). dbMissing: D1 відповідає, але такого cat немає. dbDown: збій D1.
  const dbWith = row => ({ DB: makeDB(sql => (sql.includes('FROM categories WHERE key = ?') ? [row || {}] : [])) });
  const dbMissing = () => ({ DB: makeDB(() => []) });
  const dbDown = () => ({ DB: makeDB(() => { throw new Error('D1_ERROR'); }) });
  const run = async (url, env) => {
    const res = await onRequest(ctx(url, { env, next: htmlNext(CATEGORY_HTML) }));
    return { res, html: await res.text() };
  };

  it('/category?cat=chemicals: canonical містить ?cat=, а не статичний /category', async () => {
    const { html } = await run(`${ORIGIN}/category?cat=chemicals`, dbWith(null));
    assert.deepEqual(linkHrefs(html, 'canonical'), [`${ORIGIN}/category?cat=chemicals`]);
  });

  it('title, og:title і description підставляються з D1', async () => {
    const { html } = await run(`${ORIGIN}/category?cat=chemicals`, dbWith({ seo_title: 'Агрохімікати у Володимирі', seo_desc: 'Фунгіциди, гербіциди, інсектициди.', h1: 'Агрохімікати' }));
    assert.equal(titles(html).length, 1);
    assert.equal(titles(html)[0], 'Агрохімікати у Володимирі');
    assert.equal(metaContent(html, 'og:title', 'property')[0], 'Агрохімікати у Володимирі');
    assert.equal(metaContent(html, 'description')[0], 'Фунгіциди, гербіциди, інсектициди.');
  });

  it('D1 недоступна: canonical усе одно правильний, сторінка не ламається', async () => {
    const env = { DB: makeDB(() => { throw new Error('D1_ERROR'); }) };
    const { res, html } = await run(`${ORIGIN}/category?cat=soil`, env);
    assert.equal(res.status, 200);
    assert.deepEqual(linkHrefs(html, 'canonical'), [`${ORIGIN}/category?cat=soil`]);
  });

  it('різні категорії → різні canonical (інакше GSC бачить дублі)', async () => {
    const seen = new Set();
    for (const cat of ['chemicals', 'import', 'domestic', 'weight', 'materials', 'drops', 'soil', 'pots', 'insects', 'animals', 'sprouts']) {
      const { html } = await run(`${ORIGIN}/category?cat=${cat}`, dbWith(null));
      seen.add(linkHrefs(html, 'canonical')[0]);
    }
    assert.equal(seen.size, 11);
  });

  it('/category.html?cat=… обробляється так само', async () => {
    const { html } = await run(`${ORIGIN}/category.html?cat=pots`, dbWith(null));
    assert.deepEqual(linkHrefs(html, 'canonical'), [`${ORIGIN}/category?cat=pots`]);
  });

  it('спецсимволи в cat кодуються в canonical', async () => {
    const { html } = await run(`${ORIGIN}/category?cat=${encodeURIComponent('a&b "c"')}`, dbWith(null));
    const c = linkHrefs(html, 'canonical')[0];
    assert.equal(c, `${ORIGIN}/category?cat=${encodeURIComponent('a&b "c"')}`);
    assert.doesNotThrow(() => new URL(c));
  });

  it('/category без ?cat= лишає статичний canonical /category', async () => {
    const { html } = await run(`${ORIGIN}/category`, dbWith(null));
    assert.deepEqual(linkHrefs(html, 'canonical'), [`${ORIGIN}/category`]);
  });

  it('XSS: спецсимволи в title/desc з D1 екрануються', async () => {
    const { html } = await run(`${ORIGIN}/category?cat=x`, dbWith({ seo_title: 'A "q" <b>', seo_desc: 'D "q" <i>', h1: 'h' }));
    assert.ok(!html.includes('<b>') || !/<title[^>]*>[^<]*<b>/.test(html));
    assert.equal(titles(html)[0], 'A "q" <b>');
    assert.equal(metaContent(html, 'description')[0], 'D "q" <i>');
  });

  it('не-HTML відповідь не чіпається', async () => {
    const res = await onRequest(ctx(`${ORIGIN}/category?cat=x`, { env: NO_DB, next: async () => new Response('{"a":1}', { headers: { 'content-type': 'application/json' } }) }));
    assert.equal(await res.text(), '{"a":1}');
  });

  it('невідомий ?cat= → справжній 404 (не 200 із самореферентним canonical), з коротким кешем', async () => {
    const { res } = await run(`${ORIGIN}/category?cat=zzz-not-exist`, dbMissing());
    assert.equal(res.status, 404);
    assert.match(res.headers.get('cache-control') || '', /max-age=\d+/);
  });

  it('збій D1 НЕ перетворює існуючі категорії на 404 (лише відсутній рядок = 404)', async () => {
    const { res, html } = await run(`${ORIGIN}/category?cat=chemicals`, dbDown());
    assert.equal(res.status, 200);
    assert.deepEqual(linkHrefs(html, 'canonical'), [`${ORIGIN}/category?cat=chemicals`]);
  });

  it('відсутня категорія кешується коротко: повторні запити не б’ють по D1', async () => {
    let queries = 0;
    const env = { DB: makeDB(sql => { if (sql.includes('FROM categories WHERE key = ?')) queries++; return []; }) };
    for (let i = 0; i < 3; i++) assert.equal((await run(`${ORIGIN}/category?cat=bot-probe`, env)).res.status, 404);
    assert.equal(queries, 1);
  });

  it('?cat= порожній (/category?cat=) і без параметра не дає 404', async () => {
    for (const u of ['/category', '/category?cat=']) {
      const { res } = await run(ORIGIN + u, dbMissing());
      assert.equal(res.status, 200, u);
    }
  });

  it('<h1> наповнюється на сервері: h1 з D1, запасний варіант — nav_label; рівно один, з екрануванням', async () => {
    const a = await run(`${ORIGIN}/category?cat=chemicals`, dbWith({ h1: 'Агрохімікати у Володимирі', nav_label: 'АГРОХІМІКАТИ' }));
    assert.deepEqual(h1s(a.html), ['Агрохімікати у Володимирі']);
    const b = await run(`${ORIGIN}/category?cat=soil`, dbWith({ h1: '', nav_label: 'ГРУНТ' }));   // окремий ключ: категорія кешується на 1 год
    assert.deepEqual(h1s(b.html), ['ГРУНТ']);
    const c = await run(`${ORIGIN}/category?cat=x`, dbWith({ h1: 'A & <b>"q"' }));
    assert.deepEqual(h1s(c.html), ['A & <b>"q"']);
    assert.ok(!c.html.includes('<b>"q"</b>'));
  });

  it('якщо ні h1, ні nav_label немає — h1 лишається порожнім (без «undefined»), сторінка не ламається', async () => {
    const { res, html } = await run(`${ORIGIN}/category?cat=chemicals`, dbWith(null));
    assert.equal(res.status, 200);
    assert.ok(!/undefined|null/.test(h1s(html)[0] ?? ''));
  });
});

describe('middleware: головна — noscript-список категорій', () => {
  const HOME = read('index.html');
  const rows = [{ key: 'chemicals', nav_label: 'АГРОХІМІКАТИ' }, { key: 'soil', nav_label: 'ГРУНТ & ко' }];

  it('блок PRERENDER замінюється свіжими категоріями з D1 + посилання на /katalog; маркер лишається один', async () => {
    const env = { DB: makeDB(sql => (sql.includes('FROM categories ORDER BY sort') ? rows : [])) };
    const res = await onRequest(ctx(`${ORIGIN}/`, { env, next: htmlNext(HOME) }));
    const html = await res.text();
    const hrefs = anchorHrefs(html.slice(html.indexOf('<!--PRERENDER-START-->'), html.indexOf('<!--PRERENDER-END-->')));
    assert.deepEqual(hrefs, ['/category?cat=chemicals', '/category?cat=soil', '/katalog']);
    assert.equal((html.match(/<!--PRERENDER-START-->/g) || []).length, 1);
    assert.ok(html.includes('ГРУНТ &amp; ко'), 'назва категорії не екранована');
  });

  it('D1 недоступна → головна лишається як у репозиторії (статичний baseline)', async () => {
    const env = { DB: makeDB(() => { throw new Error('D1_ERROR'); }) };
    const res = await onRequest(ctx(`${ORIGIN}/`, { env, next: htmlNext(HOME) }));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), HOME);
  });
});
