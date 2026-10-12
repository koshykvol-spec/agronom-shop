// HTML-карта каталогу: усі товари живими <a href="/p/…> для краулу Googlebot.
// PDP — JS-рендер, тому без цієї сторінки товари «сироти» (видимі лише через sitemap).
// noindex,follow — сама карта не в індексі, але передає краул на товарні сторінки.
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// Кеш через Cache API + захист від збоїв D1.
// Pages Function виконується ПЕРЕД CDN-кешем, тому самого Cache-Control недостатньо.
//  - успішна відповідь кешується (TTL із заголовка) і ще раз як "запасна копія" на 7 днів;
//  - якщо D1 недоступна (виняток, 5xx або мітка x-degraded) — віддаємо запасну копію
//    (X-Cache: STALE, без кешування), а якщо її немає — чесний 503 + Retry-After;
//  - помилки та деградовані відповіді в кеш не потрапляють.
// opts: skipCache (не читати/не писати кеш), serveDegraded (за відсутності запасної копії
// віддати деградовану відповідь як є), errorBody/errorType (тіло 503).
async function cached(context, render, opts = {}) {
  const { request } = context;
  if (request.method !== 'GET') return render(context);
  const url = new URL(request.url);
  const cache = caches.default;
  const key = new Request(url.origin + url.pathname);
  const staleKey = new Request(url.origin + '/__stale' + url.pathname);
  const useCache = !opts.skipCache;

  if (useCache) {
    const hit = await cache.match(key);
    if (hit) {
      const r = new Response(hit.body, hit);
      r.headers.set('X-Cache', 'HIT');
      return r;
    }
  }

  let res = null;
  try { res = await render(context); } catch (e) { res = null; }
  const failed = !res || res.status >= 500 || res.headers.has('x-degraded');

  if (!failed) {
    const store = useCache && res.status === 200;
    if (store) {
      context.waitUntil(cache.put(key, res.clone()));
      const copy = res.clone();
      const h = new Headers(copy.headers);
      h.set('cache-control', 'public, max-age=604800'); // запасна копія живе 7 днів
      context.waitUntil(cache.put(staleKey, new Response(copy.body, { status: 200, headers: h })));
    }
    res.headers.set('X-Cache', store ? 'MISS' : 'BYPASS');
    return res;
  }

  if (useCache) {
    const stale = await cache.match(staleKey);
    if (stale) {
      const r = new Response(stale.body, stale);
      r.headers.set('cache-control', 'no-store');
      r.headers.set('X-Cache', 'STALE');
      return r;
    }
  }
  if (res && res.status < 500 && opts.serveDegraded) {
    res.headers.delete('x-degraded');
    res.headers.set('cache-control', 'no-store');
    res.headers.set('X-Cache', 'BYPASS');
    return res;
  }
  return new Response(opts.errorBody || 'Сервіс тимчасово недоступний. Спробуйте за кілька хвилин.', {
    status: 503,
    headers: {
      'content-type': opts.errorType || 'text/plain; charset=utf-8',
      'retry-after': '300',
      'cache-control': 'no-store',
      'X-Cache': 'ERROR'
    }
  });
}

export async function onRequest(context) {
  return cached(context, renderKatalog, { serveDegraded: true, errorBody: `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Тимчасово недоступно — Агроном</title></head><body style="font-family:sans-serif;max-width:560px;margin:60px auto;padding:0 20px"><h1>Сторінка тимчасово недоступна</h1><p>Ми вже працюємо над цим. Спробуйте оновити сторінку за кілька хвилин або <a href="/katalog">відкрийте каталог</a>.</p></body></html>`, errorType: 'text/html; charset=utf-8' });
}

async function renderKatalog(context) {
  const db = context.env.DB;
  let rows = [];
  let degraded = false;
  try {
    const r = await db.prepare(
      `SELECT c.slug AS slug, COALESCE(NULLIF(c.display_name,''), p.name) AS name, p.category AS cat
         FROM products p JOIN product_content c ON c.pid=p.pid
        WHERE c.visible=1 AND c.slug IS NOT NULL
        ORDER BY p.category, name`
    ).all();
    rows = r.results || [];
  } catch (e) { degraded = true; /* порожня карта краще за 500, але її не кешуємо */ }

  // Групуємо за категорією
  const byCat = new Map();
  for (const x of rows) {
    const c = x.cat || 'Інше';
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(x);
  }

  let body = '';
  for (const [cat, items] of byCat) {
    body += `<h2>${esc(cat)} <span style="color:#888;font-weight:400;font-size:.8rem">(${items.length})</span></h2>\n<ul>`;
    body += items.map(i => `<li><a href="/p/${esc(i.slug)}">${esc(i.name)}</a></li>`).join('');
    body += `</ul>\n`;
  }

  const html = `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,follow">
<title>Повний каталог товарів — Агроном, м. Володимир</title>
<meta name="description" content="Повний перелік усіх товарів магазину Агроном: агрохімікати, насіння, добрива, полив.">
<link rel="canonical" href="https://agronom.pp.ua/katalog">
<link rel="stylesheet" href="/style.css">
</head><body>
<header><nav>
  <a href="/index.html" class="logo">АГРОНОМ</a>
  <a href="/protection_schemes.html" class="nav-link">🌿 Порадник</a>
</nav></header>
<main class="container">
  <h1 class="page-h1">Повний каталог товарів</h1>
  <p style="color:#555;margin-bottom:18px;">Усі ${rows.length} товарів магазину. Оберіть категорію або товар нижче.</p>
  ${body}
  <p style="margin-top:24px;"><a href="/index.html" style="color:var(--green);font-weight:700;">← На головну</a></p>
</main>
<div id="site-footer"></div>
<script src="/site-config"></script>
<script src="/footer.js"></script>
</body></html>`;

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600', ...(degraded ? { 'x-degraded': '1' } : {}) }
  });
}
