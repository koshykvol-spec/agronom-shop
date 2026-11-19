// Регресія robots.txt, _redirects, _headers та відсутності випадкового noindex у публічних шаблонах.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { read, ROOT, ORIGIN } from './helpers/runtime.mjs';
import { parseRobots, isAllowed } from './helpers/robots.mjs';

const robots = parseRobots(read('robots.txt'));

describe('robots.txt', () => {
  it('немає загальної заборони для всіх ботів (Disallow: / у групі *)', () => {
    const star = robots.groups.find(g => g.agents.includes('*'));
    assert.ok(star, 'немає групи User-agent: *');
    assert.ok(!star.rules.some(r => r.type === 'disallow' && r.pattern === '/'), 'Disallow: / для * — сайт зникне з пошуку');
    assert.equal(isAllowed(robots, '/', 'Googlebot'), true);
  });

  it('є Sitemap на https-домені', () => {
    assert.deepEqual(robots.sitemaps, [`${ORIGIN}/sitemap.xml`]);
  });

  it('Googlebot і Bingbot можуть сканувати сторінки, каталог і товари', () => {
    for (const ua of ['Googlebot', 'Bingbot']) {
      for (const p of ['/', '/p/ridomil-gold-mc-25g', '/category?cat=chemicals', '/category?cat=soil', '/katalog', '/protection_schemes', '/delivery', '/contacts', '/returns', '/sitemap.xml', '/sitemap-products.xml']) {
        assert.equal(isAllowed(robots, p, ua), true, `${ua} заборонено ${p}`);
      }
    }
  });

  it('ресурси для рендеру (CSS/JS/шрифти/фото/дані каталогу) не заблоковані — Google має бачити сторінку як користувач', () => {
    for (const p of ['/style.css', '/app.js', '/cart.js', '/footer.js', '/seo-jsonld.js', '/fonts.css', '/fonts/nunito-IMeaBXso.woff2', '/recipes.css',
      '/IMG/a.webp', '/IMG_N1/a.webp', '/up/a.webp', '/thumb/a.webp', '/products.json', '/site-config', '/android-chrome-512x512.png', '/favicon.ico']) {
      assert.equal(isAllowed(robots, p, 'Googlebot'), true, `${p} заборонено`);
    }
  });

  it('службові розділи закриті: /admin, /check_photos.html, пошукові ?q=', () => {
    for (const p of ['/admin', '/admin/', '/admin/import', '/check_photos.html', '/?q=томат', '/category?q=томат']) {
      assert.equal(isAllowed(robots, p, 'Googlebot'), false, `${p} має бути заборонений`);
    }
  });

  it('?cat= не потрапляє під правило ?q= (категорії лишаються відкритими)', () => {
    assert.equal(isAllowed(robots, '/category?cat=chemicals', 'Googlebot'), true);
  });

  it('SemrushBot і AhrefsBot заборонені повністю (джерело піків D1)', () => {
    for (const ua of ['SemrushBot', 'AhrefsBot']) assert.equal(isAllowed(robots, '/p/x', ua), false, ua);
  });

  it('технічні JSON та /api/* віддаються з X-Robots-Tag: noindex (але не заблоковані в robots.txt — Googlebot читає їх для рендеру)', async () => {
    const { loadFn, installCaches, makeDB, ctx } = await import('./helpers/runtime.mjs');
    installCaches();
    const { onRequest } = await loadFn('functions/_middleware.js');
    const env = { DB: makeDB(() => []) };
    for (const p of ['/products.json', '/img-map.json', '/recipes.json', '/protection_schemes.json', '/api/products', '/api/categories', '/api']) {
      const res = await onRequest(ctx(`${ORIGIN}${p}`, { env, next: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) }));
      assert.equal(res.headers.get('x-robots-tag'), 'noindex', p);
      assert.equal(await res.text(), '{}', 'тіло відповіді не змінилось: ' + p);
      assert.equal(isAllowed(robots, p, 'Googlebot'), true, `${p} не має бути в Disallow`);
    }
  });

  it('noindex-заголовок НЕ додається до HTML, sitemap, фото та інших сторінок', async () => {
    const { loadFn, installCaches, makeDB, ctx } = await import('./helpers/runtime.mjs');
    installCaches();
    const { onRequest } = await loadFn('functions/_middleware.js');
    const env = { DB: makeDB(() => []) };
    for (const p of ['/p/some-slug', '/katalog', '/sitemap.xml', '/sitemap-products.xml', '/robots.txt', '/style.css', '/app.js', '/IMG/a.webp', '/delivery', '/site.webmanifest', '/apijson', '/feed/google.xml']) {
      const res = await onRequest(ctx(`${ORIGIN}${p}`, { env }));
      assert.equal(res.headers.get('x-robots-tag'), null, p);
    }
  });

  it('статус і тіло відповіді JSON зберігаються (404/503 не маскуються)', async () => {
    const { loadFn, installCaches, makeDB, ctx } = await import('./helpers/runtime.mjs');
    installCaches();
    const { onRequest } = await loadFn('functions/_middleware.js');
    const env = { DB: makeDB(() => []) };
    for (const status of [404, 503]) {
      const res = await onRequest(ctx(`${ORIGIN}/products.json`, { env, next: async () => new Response('err', { status }) }));
      assert.equal(res.status, status);
      assert.equal(res.headers.get('x-robots-tag'), 'noindex');
    }
  });
});

describe('_redirects', () => {
  const lines = read('_redirects').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const rules = lines.map(l => { const [from, to, code] = l.split(/\s+/); return { from, to, code: Number(code) }; });

  it('/index.html → / (301) — єдина версія головної', () => {
    const r = rules.find(x => x.from === '/index.html');
    assert.ok(r, 'немає правила для /index.html');
    assert.equal(r.code, 301);
    assert.equal(r.to, `${ORIGIN}/`);
  });

  it('усі правила: постійні коди (301/308), призначення на основному домені, без петель', () => {
    for (const r of rules) {
      assert.ok([301, 308].includes(r.code), `${r.from}: код ${r.code}`);
      assert.ok(/^https:\/\/agronom\.pp\.ua\//.test(r.to) || r.to.startsWith('/'), `${r.from} → ${r.to}`);
      assert.notEqual(r.to.replace(ORIGIN, ''), r.from, 'петля редіректу ' + r.from);
      assert.ok(!r.to.includes('pages.dev'), r.to);
    }
  });
});

describe('_headers', () => {
  const headers = read('_headers');
  const active = headers.split(/\r?\n/).filter(l => !l.trim().startsWith('#')).join('\n');

  it('немає глобального X-Robots-Tag: noindex', () => {
    assert.ok(!/x-robots-tag:[^\n]*noindex/i.test(active), 'X-Robots-Tag: noindex у _headers прибере сайт з індексу');
  });

  it('базові заголовки безпеки на місці (HSTS, nosniff, X-Frame-Options)', () => {
    assert.match(active, /Strict-Transport-Security:\s*max-age=\d+/);
    assert.match(active, /X-Content-Type-Options:\s*nosniff/);
    assert.match(active, /X-Frame-Options:\s*DENY/);
  });

  it('CSP дозволяє Google Fonts та аналітику, які реально підключені (інакше шрифти/метрики зламаються тихо)', () => {
    const csp = /Content-Security-Policy:([^\n]+)/.exec(active)[1];
    assert.match(csp, /fonts\.googleapis\.com/);
    assert.match(csp, /fonts\.gstatic\.com/);
    assert.match(csp, /googletagmanager\.com/);
  });
});

describe('публічні шаблони не віддають noindex випадково', () => {
  const PUBLIC_TEMPLATES = ['functions/p/[slug].js', 'functions/_middleware.js', 'functions/katalog.js', 'functions/katalog/[cat].js', 'functions/sitemap.xml.js', 'functions/sitemap-main.xml.js', 'functions/sitemap-products.xml.js'];
  for (const f of PUBLIC_TEMPLATES) {
    it(`${f}: немає <meta robots noindex> / X-Robots-Tag: noindex у коді відповіді`, () => {
      const src = read(f);
      assert.ok(!/<meta name="robots" content="[^"]*noindex/i.test(src), 'meta robots noindex');
      const code = src.replace(/(^|[^:])\/\/.*$/gm, '$1');            // без рядкових коментарів
      const hits = (code.match(/x-robots-tag['"]?\s*[:,]\s*['"]?[^'"\n]*noindex/gi) || []).length;
      // єдиний дозволений виняток: middleware ставить заголовок технічним JSON/API (див. NOINDEX_PATH)
      const allowed = f === 'functions/_middleware.js' ? 1 : 0;
      assert.equal(hits, allowed, `X-Robots-Tag noindex: знайдено ${hits}, дозволено ${allowed}`);
    });
  }

  it('жоден публічний HTML у корені не має meta robots noindex, окрім account.html та check_photos.html', () => {
    const allowedNoindex = new Set(['account.html', 'check_photos.html']);
    const offenders = fs.readdirSync(ROOT).filter(f => f.endsWith('.html') && !allowedNoindex.has(f))
      .filter(f => /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
    assert.deepEqual(offenders, []);
  });
});
