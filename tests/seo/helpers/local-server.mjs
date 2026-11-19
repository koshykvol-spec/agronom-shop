// Локальний імітатор Cloudflare Pages: статика з кореня репозиторію + справжні Functions + _redirects,
// з підробленою D1 (фікстури нижче). Потрібен, щоб гнати «живі» HTTP-перевірки (live.test.mjs) офлайн, у CI і до деплою.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadFn, installCaches, makeDB, ROOT, ORIGIN } from './runtime.mjs';

const CATS = [
  ['chemicals', 'АГРОХІМІКАТИ'], ['import', 'НАСІННЯ ІМПОРТНЕ'], ['domestic', 'НАСІННЯ ВІТЧИЗНЯНЕ'], ['weight', 'НАСІННЯ ВАГОВЕ'],
  ['materials', 'МАТЕРІАЛИ'], ['drops', 'КРАПЕЛЬНЕ ЗРОШУВАННЯ'], ['soil', 'ГРУНТ'], ['pots', 'ГОРЩИКИ'], ['insects', 'ПРОТИ КОМАХ'],
  ['animals', 'ДЛЯ ТВАРИН'], ['sprouts', 'РОЗСАДА'],
].map(([key, db_name], i) => ({ key, db_name, nav_label: db_name, sort: i, seo_title: `${db_name} — купити у Володимирі | Агроном`, seo_desc: `Каталог: ${db_name.toLowerCase()}.`, h1: db_name }));

const PRODUCTS = Array.from({ length: 12 }, (_, i) => ({
  pid: i + 1, sku: `SKU-${i + 1}`, name: `Тестовий товар ${i + 1}`, price: 50 + i, category: CATS[i % CATS.length].db_name,
  brand: i % 3 ? 'Syngenta' : '', in_stock: i % 4 ? 1 : 0, slug: `testovyi-tovar-${i + 1}`,
  annotation: `**Тестовий товар ${i + 1}** — опис для перевірки SEO.\n- перша властивість\n- друга властивість`,
  meta_title: null, meta_desc: null, sale_price: null, sale_until: null, display_name: null, group_id: null, variant_label: null,
  image_ok: 1, active_ingredient: '', dosage: '', divisible: 0, divisor: null, visible: 1,
}));

export function fixtureDB() {
  return makeDB((sql, binds) => {
    if (sql.includes('FROM products p JOIN product_content c ON c.pid=p.pid WHERE c.slug=?')) return PRODUCTS.filter(p => p.slug === binds[0]);
    if (sql.includes('FROM site_settings')) return [];
    if (sql.includes('FROM product_images WHERE pid=?')) return [{ path: `IMG/foto-${binds[0]}.webp` }];
    if (sql.includes('FROM categories WHERE db_name=?')) return CATS.filter(c => c.db_name === binds[0]).slice(0, 1);
    if (sql.includes('FROM categories WHERE key = ?')) return CATS.filter(c => c.key === binds[0]);
    if (sql.includes('FROM categories ORDER BY sort')) return CATS;
    if (sql.includes('SELECT slug FROM product_content')) return PRODUCTS.map(p => ({ slug: p.slug }));
    if (sql.includes('SELECT COUNT(*) AS n FROM products p JOIN product_content c')) return [{ n: PRODUCTS.filter(p => p.category === binds[0] && p.visible !== 0).length }];
    if (sql.includes('ORDER BY p.in_stock DESC, p.pid LIMIT ? OFFSET ?')) {
      return PRODUCTS.filter(p => p.category === binds[0] && p.visible !== 0).sort((a, b) => (b.in_stock - a.in_stock) || (a.pid - b.pid))
        .slice(binds[2], binds[2] + binds[1]).map(p => ({ slug: p.slug, name: p.name, price: p.price, ins: p.in_stock }));
    }
    if (sql.includes('COALESCE(NULLIF(c.display_name') && sql.includes('AS cat')) return PRODUCTS.map(p => ({ slug: p.slug, name: p.name, cat: p.category }));
    return [];
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };

const FUNCTION_ROUTES = [
  [/^\/p\/([^/]+)$/, 'functions/p/[slug].js', m => ({ slug: decodeURIComponent(m[1]) })],
  [/^\/katalog$/, 'functions/katalog.js'],
  [/^\/katalog\/([^/]+)$/, 'functions/katalog/[cat].js', m => ({ cat: decodeURIComponent(m[1]) })],
  [/^\/sitemap\.xml$/, 'functions/sitemap.xml.js'],
  [/^\/sitemap-v2\.xml$/, 'functions/sitemap-v2.xml.js'],
  [/^\/sitemap-main\.xml$/, 'functions/sitemap-main.xml.js'],
  [/^\/sitemap-products\.xml$/, 'functions/sitemap-products.xml.js'],
];

function staticResponse(pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  const candidates = rel === '' ? ['index.html'] : [rel, rel + '.html'];
  for (const c of candidates) {
    const abs = path.join(ROOT, c);
    if (abs.startsWith(ROOT) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      // як у Cloudflare Pages: /x.html → 308 на /x
      if (c.endsWith('.html') && rel.endsWith('.html') && rel !== 'index.html') return new Response(null, { status: 308, headers: { location: '/' + rel.replace(/\.html$/, '') } });
      return new Response(fs.readFileSync(abs), { status: 200, headers: { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream' } });
    }
  }
  return new Response('Not Found', { status: 404 });
}

/** Старт сервера. Повертає { url, close }. Усередині запити виглядають як https://agronom.pp.ua/… (канонічний хост). */
export async function startLocalServer({ port = 0 } = {}) {
  installCaches();
  const middleware = (await loadFn('functions/_middleware.js')).onRequest;
  const env = { DB: fixtureDB() };
  const redirects = fs.readFileSync(path.join(ROOT, '_redirects'), 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => l.split(/\s+/));

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, ORIGIN);
      const waits = [];
      const redirect = redirects.find(([from]) => from === url.pathname);
      let response;
      if (redirect) response = new Response(null, { status: Number(redirect[2] || 301), headers: { location: redirect[1] } });
      else {
        const next = async () => {
          for (const [re, file, mk] of FUNCTION_ROUTES) {
            const m = re.exec(url.pathname);
            if (m) {
              const mod = await loadFn(file);
              return mod.onRequest({ request: new Request(url, { method: req.method, headers: req.headers }), env, params: mk ? mk(m) : {}, waitUntil: p => waits.push(p), next: async () => new Response('', { status: 404 }), data: {} });
            }
          }
          return staticResponse(url.pathname);
        };
        response = await middleware({ request: new Request(url, { method: req.method, headers: req.headers }), env, waitUntil: p => waits.push(p), next, data: {} });
      }
      await Promise.all(waits.map(w => Promise.resolve(w).catch(() => {})));
      const headers = {};
      response.headers.forEach((v, k) => { headers[k] = v; });
      res.writeHead(response.status, headers);
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(e && e.stack || e));
    }
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  const { port: p } = server.address();
  return { url: `http://127.0.0.1:${p}`, close: () => new Promise(r => server.close(r)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const s = await startLocalServer({ port: Number(process.env.PORT) || 8788 });
  console.log('Локальний імітатор Pages:', s.url);
}
