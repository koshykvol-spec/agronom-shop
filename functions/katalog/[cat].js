// /katalog/<key>[?page=N] — серверний (без JS) список товарів ОДНІЄЇ категорії з пагінацією.
// Навіщо: /category?cat=<key> малює сітку скриптом, тож у сирому HTML немає жодного <a href="/p/…>.
// Ця сторінка дає Googlebot-у короткі хаби з живими посиланнями на товари (по PAGE_SIZE на сторінку)
// замість єдиного списку на 2 500+ посилань. Для людей лишається інтерактивна /category?cat=<key>
// (на неї є посилання зі сторінки).
// D1: кожна сторінка = 3 дешеві запити (категорія за PK, лічильник, вибірка), усе кешується в Cache API.
// Вибірка йде по idx_products_cat_stock_pid (category, in_stock DESC, pid) — без SCAN і TEMP B-TREE.
const PAGE_SIZE = 60;
const MAX_PAGE = 200; // верхня межа для сміттєвих ?page= (захист кешу й D1 від ботів)
const KEY_RE = /^[a-z0-9_-]{1,40}$/i;

function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// Кеш через Cache API + захист від збоїв D1 (той самий підхід, що в katalog.js / api/products.js),
// але ключ кешу включає номер сторінки (у katalog.js ключ — лише pathname).
async function cached(context, page, render) {
  const { request } = context;
  if (request.method !== 'GET') return render(context);
  const url = new URL(request.url);
  const suffix = page > 1 ? '?page=' + page : '';
  const cache = caches.default;
  const key = new Request(url.origin + url.pathname + suffix);
  const staleKey = new Request(url.origin + '/__stale' + url.pathname + suffix);

  const hit = await cache.match(key);
  if (hit) {
    const r = new Response(hit.body, hit);
    r.headers.set('X-Cache', 'HIT');
    return r;
  }

  let res = null;
  try { res = await render(context); } catch (e) { res = null; }
  const failed = !res || res.status >= 500;

  if (!failed) {
    const store = res.status === 200;
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

  const stale = await cache.match(staleKey);
  if (stale) {
    const r = new Response(stale.body, stale);
    r.headers.set('cache-control', 'no-store');
    r.headers.set('X-Cache', 'STALE');
    return r;
  }
  return new Response(`<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Тимчасово недоступно — Агроном</title></head><body style="font-family:sans-serif;max-width:560px;margin:60px auto;padding:0 20px"><h1>Сторінка тимчасово недоступна</h1><p>Спробуйте оновити сторінку за кілька хвилин або <a href="/katalog">відкрийте каталог</a>.</p></body></html>`, {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '300', 'cache-control': 'no-store', 'X-Cache': 'ERROR' }
  });
}

const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' } });

export async function onRequest(context) {
  const key = String((context.params && context.params.cat) || '');
  if (!KEY_RE.test(key)) return notFound();

  const url = new URL(context.request.url);
  let page = 1;
  const raw = url.searchParams.get('page');
  if (raw !== null) {
    if (!/^\d{1,3}$/.test(raw)) return notFound();
    page = parseInt(raw, 10);
    if (page < 1 || page > MAX_PAGE) return notFound();
    if (page === 1) return Response.redirect(`${url.origin}/katalog/${key}`, 301); // одна канонічна адреса першої сторінки
  }
  return cached(context, page, ctx => renderCategory(ctx, key, page));
}

function pageUrl(key, n) { return n > 1 ? `/katalog/${key}?page=${n}` : `/katalog/${key}`; }

// Список номерів сторінок для навігації: усі, якщо їх мало; інакше перша, остання і вікно навколо поточної.
function pageWindow(page, pages) {
  if (pages <= 25) return Array.from({ length: pages }, (_, i) => i + 1);
  const s = new Set([1, pages]);
  for (let i = page - 3; i <= page + 3; i++) if (i >= 1 && i <= pages) s.add(i);
  return [...s].sort((a, b) => a - b);
}

async function renderCategory(context, key, page) {
  const db = context.env.DB;
  // Збій D1 тут має ВИЙТИ винятком: cached() віддасть запасну копію або чесний 503 (порожню сторінку не кешуємо).
  const cat = await db.prepare(
    `SELECT key, db_name, nav_label, h1, seo_desc FROM categories WHERE key = ?`
  ).bind(key).first();
  if (!cat) return notFound();

  const cnt = await db.prepare(
    `SELECT COUNT(*) AS n FROM products p JOIN product_content c ON c.pid=p.pid WHERE p.category=? AND c.visible=1 AND c.slug IS NOT NULL`
  ).bind(cat.db_name).first();
  const total = (cnt && Number(cnt.n)) || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total === 0 || page > pages) return notFound();

  const r = await db.prepare(
    `SELECT c.slug AS slug, COALESCE(NULLIF(c.display_name,''), p.name) AS name, p.price AS price, p.in_stock AS ins
       FROM products p JOIN product_content c ON c.pid=p.pid
      WHERE p.category=? AND c.visible=1 AND c.slug IS NOT NULL
      ORDER BY p.in_stock DESC, p.pid
      LIMIT ? OFFSET ?`
  ).bind(cat.db_name, PAGE_SIZE, (page - 1) * PAGE_SIZE).all();
  const rows = r.results || [];
  if (!rows.length) return notFound();

  const base = (cat.h1 || cat.nav_label || cat.db_name || key).trim();
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = from + rows.length - 1;
  const canonical = `https://agronom.pp.ua${pageUrl(key, page)}`;
  const title = `${base}: усі товари списком${page > 1 ? ` — сторінка ${page}` : ''} — Агроном, м. Володимир`;
  const desc = `Повний список товарів розділу «${base}»: ${total} позицій із цінами та наявністю. Магазин Агроном, м. Володимир.${page > 1 ? ` Сторінка ${page} з ${pages}.` : ''}`;

  const items = rows.map(x => {
    const price = x.price != null && isFinite(Number(x.price)) ? ` — ${Number(x.price).toFixed(2)} грн` : '';
    const stock = x.ins === 0 ? ' · немає в наявності' : ' · в наявності';
    return `<li><a href="/p/${esc(encodeURIComponent(x.slug))}">${esc(x.name)}</a><span style="color:#666">${price}${stock}</span></li>`;
  }).join('\n');

  const nums = pageWindow(page, pages);
  let nav = '';
  if (pages > 1) {
    const parts = [];
    if (page > 1) parts.push(`<a href="${pageUrl(key, page - 1)}" rel="prev">← Назад</a>`);
    let prevN = 0;
    for (const n of nums) {
      if (n - prevN > 1) parts.push('<span>…</span>');
      parts.push(n === page ? `<strong aria-current="page">${n}</strong>` : `<a href="${pageUrl(key, n)}">${n}</a>`);
      prevN = n;
    }
    if (page < pages) parts.push(`<a href="${pageUrl(key, page + 1)}" rel="next">Далі →</a>`);
    nav = `<nav aria-label="Сторінки списку" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:20px 0;">${parts.join(' ')}</nav>`;
  }

  const ld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Каталог', item: 'https://agronom.pp.ua/katalog' },
      { '@type': 'ListItem', position: 2, name: base, item: canonical }
    ]
  }).replace(/</g, '\\u003c');

  const html = `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="index,follow">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="stylesheet" href="/style.css">
<script type="application/ld+json">${ld}</script>
</head><body>
<header><nav>
  <a href="/" class="logo">АГРОНОМ</a>
  <a href="/protection_schemes" class="nav-link">🌿 Порадник</a>
</nav></header>
<main class="container">
  <nav class="breadcrumb" aria-label="Навігаційний ланцюжок" style="font-size:.85rem;color:#777;margin:10px 0 4px;"><a href="/katalog" style="color:var(--green);text-decoration:none;">Каталог</a> › ${esc(base)}</nav>
  <h1 class="page-h1">${esc(base)}: усі товари списком</h1>
  <p style="color:#555;margin-bottom:12px;">У розділі ${total} ${total === 1 ? 'товар' : 'товарів'}. Показано ${from}–${to}${pages > 1 ? ` (сторінка ${page} з ${pages})` : ''}.</p>
  <p style="margin-bottom:18px;"><a href="/category?cat=${encodeURIComponent(key)}" style="color:var(--green);font-weight:700;">Відкрити цей розділ з пошуком, фільтрами й сортуванням →</a></p>
  <ul>
${items}
  </ul>
  ${nav}
  <p style="margin-top:24px;"><a href="/katalog" style="color:var(--green);font-weight:700;">← Увесь каталог</a></p>
</main>
<div id="site-footer"></div>
<script src="/site-config"></script>
<script src="/footer.js"></script>
</body></html>`;

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' }
  });
}
