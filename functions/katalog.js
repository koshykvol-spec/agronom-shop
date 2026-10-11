// HTML-карта каталогу: усі товари живими <a href="/p/…> для краулу Googlebot.
// PDP — JS-рендер, тому без цієї сторінки товари «сироти» (видимі лише через sitemap).
// noindex,follow — сама карта не в індексі, але передає краул на товарні сторінки.
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// Кеш через Cache API. Pages Function виконується ПЕРЕД CDN-кешем, тому самого
// заголовка Cache-Control недостатньо: без цього кожен запит іде в D1.
// Помилкові/деградовані відповіді (x-degraded) і не-200 в кеш не потрапляють.
async function cached(context, render) {
  const { request } = context;
  if (request.method !== 'GET') return render(context);
  const url = new URL(request.url);
  const cache = caches.default;
  const cacheKey = new Request(url.origin + url.pathname);
  const hit = await cache.match(cacheKey);
  if (hit) {
    const r = new Response(hit.body, hit);
    r.headers.set('X-Cache', 'HIT');
    return r;
  }
  const res = await render(context);
  const ok = res.status === 200 && !res.headers.has('x-degraded');
  if (ok) context.waitUntil(cache.put(cacheKey, res.clone()));
  res.headers.delete('x-degraded');
  res.headers.set('X-Cache', ok ? 'MISS' : 'BYPASS');
  return res;
}

export async function onRequest(context) {
  return cached(context, renderKatalog);
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
