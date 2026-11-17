// Регресія SEO статичних сторінок репозиторію (сирий HTML, до виконання JS — те, що бачить краулер першим).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { knownGap } from './helpers/known-gap.mjs';
import { read, exists, ORIGIN } from './helpers/runtime.mjs';
import { titles, h1s, metaContent, linkHrefs, htmlLang, jsonLd, anchorHrefs, findTags } from './helpers/html.mjs';

// файл → очікуваний canonical
const INDEXABLE = {
  'index.html': `${ORIGIN}/`,
  'category.html': `${ORIGIN}/category`,        // для ?cat=… canonical уточнює middleware (див. middleware.test.mjs)
  'protection_schemes.html': `${ORIGIN}/protection_schemes`,
  'delivery.html': `${ORIGIN}/delivery`,
  'contacts.html': `${ORIGIN}/contacts`,
  'returns.html': `${ORIGIN}/returns`,
};
const NOINDEX = ['account.html', 'check_photos.html'];
const html = Object.fromEntries([...Object.keys(INDEXABLE), ...NOINDEX].map(f => [f, read(f)]));

describe('індексовані сторінки: базові теги', () => {
  for (const [file, canonical] of Object.entries(INDEXABLE)) {
    describe(file, () => {
      const h = html[file];
      it('lang="uk", viewport, charset', () => {
        assert.equal(htmlLang(h), 'uk');
        assert.equal(metaContent(h, 'viewport').length, 1);
        assert.ok(findTags(h, 'meta').some(t => /utf-?8/i.test(t.attrs.charset || '')));
      });
      it('рівно один непорожній <title> (10–90 символів)', () => {
        const t = titles(h);
        assert.equal(t.length, 1);
        if (file !== 'category.html') assert.ok(t[0].length >= 10 && t[0].length <= 90, `довжина ${t[0].length}: ${t[0]}`);
        else assert.ok(t[0].length > 0);              // у category.html title добудовується з ?cat= на сервері/клієнті
      });
      it('рівно один meta description (50–320 символів)', () => {
        const d = metaContent(h, 'description');
        assert.equal(d.length, 1);
        assert.ok(d[0].length >= 50 && d[0].length <= 320, `довжина ${d[0].length}`);
      });
      it(`рівно один canonical = ${canonical}`, () => {
        assert.deepEqual(linkHrefs(h, 'canonical'), [canonical]);
      });
      it('немає noindex (ні meta, ні X-Robots у розмітці)', () => {
        assert.ok(!/noindex/i.test(metaContent(h, 'robots').join(',')));
      });
      it('рівно один тег <h1>', () => {
        assert.equal(h1s(h).length, 1);
      });
      it('og:image — абсолютний URL на наш домен, файл існує в репозиторії', () => {
        const img = metaContent(h, 'og:image', 'property')[0];
        if (!img) return;                               // не на всіх службових сторінках є
        assert.ok(img.startsWith(ORIGIN + '/'), img);
        assert.ok(exists(img.slice(ORIGIN.length + 1)), `${img} відсутній у репозиторії`);
      });
    });
  }

  it('title і description унікальні серед усіх індексованих статичних сторінок', () => {
    const t = Object.keys(INDEXABLE).map(f => titles(html[f])[0]);
    const d = Object.keys(INDEXABLE).map(f => metaContent(html[f], 'description')[0]);
    assert.equal(new Set(t).size, t.length, 'дублі title: ' + t.join(' | '));
    assert.equal(new Set(d).size, d.length, 'дублі description');
  });

  it('canonical-и унікальні', () => {
    const c = Object.keys(INDEXABLE).map(f => linkHrefs(html[f], 'canonical')[0]);
    assert.equal(new Set(c).size, c.length);
  });

  it('головна: h1 непорожній і містить ключову тему магазину', () => {
    const [h1] = h1s(html['index.html']);
    assert.ok(h1.length >= 10 && /агротовар|агрохім|насіння/i.test(h1), h1);
  });

  knownGap('category.html: h1 наповнений уже в сирому HTML (а не лише JS-ом)', 'h1 порожній до виконання JS: <h1 id="page-h1"></h1>; middleware міг би підставляти seo.h1', () => {
    const [h1] = h1s(html['category.html']);
    assert.ok(h1 && h1.length > 0, 'порожній <h1>');
  });
});

describe('службові сторінки закриті від індексу', () => {
  for (const f of NOINDEX) {
    it(`${f}: meta robots містить noindex`, () => {
      assert.match(metaContent(html[f], 'robots').join(',').toLowerCase(), /noindex/);
    });
  }
  it('account.html і check_photos.html не мають canonical, що вказував би на індексовану сторінку', () => {
    for (const f of NOINDEX) assert.deepEqual(linkHrefs(html[f], 'canonical'), [], f);
  });
});

describe('structured data у статичних сторінках', () => {
  it('усі JSON-LD блоки валідні, мають @context і @type', () => {
    for (const f of Object.keys(INDEXABLE)) {
      for (const o of jsonLd(html[f])) {
        assert.equal(o['@context'], 'https://schema.org', f);
        assert.ok(o['@type'], f);
      }
    }
  });

  it('головна: WebSite з url = canonical і name', () => {
    const ws = jsonLd(html['index.html']).find(o => o['@type'] === 'WebSite');
    assert.ok(ws, 'немає WebSite JSON-LD');
    assert.equal(ws.url, `${ORIGIN}/`);
    assert.ok(ws.name);
  });

  it('JSON-LD не посилається на чужі/технічні домени (*.pages.dev, localhost)', () => {
    for (const f of Object.keys(INDEXABLE)) {
      const raw = JSON.stringify(jsonLd(html[f]));
      assert.ok(!/pages\.dev|localhost|127\.0\.0\.1/.test(raw), f);
    }
  });

  it('жодна індексована сторінка не містить посилань на технічний домен pages.dev', () => {
    for (const f of Object.keys(INDEXABLE)) assert.ok(!/agronom1\.pages\.dev/.test(html[f]), f);
  });
});

describe('головна: noscript-список категорій (посилання для краулера без JS)', () => {
  const h = html['index.html'];
  const block = h.slice(h.indexOf('<!--PRERENDER-START-->'), h.indexOf('<!--PRERENDER-END-->'));
  const keys = [...block.matchAll(/href="\/category\?cat=([^"]+)"/g)].map(m => m[1]);

  it('рівно одна пара маркерів, блок усередині <noscript>', () => {
    assert.equal((h.match(/<!--PRERENDER-START-->/g) || []).length, 1);
    assert.equal((h.match(/<!--PRERENDER-END-->/g) || []).length, 1);
    assert.ok(h.indexOf('<!--PRERENDER-START-->') < h.indexOf('<!--PRERENDER-END-->'));
    assert.match(block, /<noscript>[\s\S]*<\/noscript>/);
  });

  it('перелічено 11 категорій без дублів', () => {
    assert.equal(keys.length, 11);
    assert.equal(new Set(keys).size, 11);
  });

  it('набір категорій збігається з sitemap-main.xml та prerender.py (три джерела не розходяться)', () => {
    const sm = /FALLBACK_CATS\s*=\s*\[([^\]]*)\]/.exec(read('functions/sitemap-main.xml.js'))[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
    const pr = [...read('prerender.py').matchAll(/"[^"]+":\s*"([a-z]+)"/g)].map(m => m[1]);
    assert.deepEqual([...keys].sort(), [...sm].sort(), 'index.html ≠ sitemap-main');
    assert.deepEqual([...new Set(pr)].sort(), [...keys].sort(), 'index.html ≠ prerender.py');
  });

  it('є посилання на /katalog (вхід до всіх товарних сторінок)', () => {
    assert.ok(anchorHrefs(h).includes('/katalog'));
  });
});

describe('внутрішні посилання', () => {
  const ROUTES = new Set(['/', '/category', '/katalog', '/protection_schemes', '/delivery', '/contacts', '/returns', '/account', '/sitemap.xml']);
  const pages = Object.keys(INDEXABLE);

  it('усі внутрішні <a href> ведуть на існуючий маршрут або файл', () => {
    const bad = [];
    for (const f of pages) {
      for (const raw of anchorHrefs(html[f])) {
        const href = raw.replace(/^https:\/\/agronom\.pp\.ua/, '');
        const pathOnly = '/' + href.split(/[?#]/)[0].replace(/^\//, '');
        if (href.startsWith('/p/') || ROUTES.has(pathOnly)) continue;
        if (exists(pathOnly.slice(1))) continue;
        bad.push(`${f} → ${raw}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  it('посилання на *.html лише на account.html (noindex); решта — чисті URL без редіректу 308', () => {
    const bad = [];
    for (const f of pages) for (const h of anchorHrefs(html[f])) if (/\.html(\?|#|$)/.test(h) && !/(^|\/)account\.html$/.test(h)) bad.push(`${f} → ${h}`);
    assert.deepEqual(bad, []);
  });

  it('кожен /category?cat=<key> у сторінках — серед 11 відомих ключів', () => {
    const known = new Set(['chemicals', 'import', 'domestic', 'weight', 'materials', 'drops', 'soil', 'pots', 'insects', 'animals', 'sprouts']);
    for (const f of pages) for (const m of html[f].matchAll(/\/category\?cat=([a-z0-9_-]+)/g)) assert.ok(known.has(m[1]), `${f}: невідома категорія ${m[1]}`);
  });
});
