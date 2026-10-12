// /feed/google.xml — Google Merchant (Shopping) RSS-фід з D1. Кожна фасовка = окремий offer.
function xesc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }

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
  return cached(context, renderGoogleFeed);
}

async function renderGoogleFeed(context) {
  const db = context.env.DB;
  let degraded = false;
  const origin = new URL(context.request.url).origin;
  const today = new Date().toISOString().slice(0, 10);

  let shopName = 'Агроном';
  try { const s = await db.prepare(`SELECT value FROM site_settings WHERE key='name'`).first(); if (s && s.value) shopName = s.value; } catch (e) {}

  let rows = [];
  try {
    rows = (await db.prepare(
      `SELECT p.pid,p.sku,COALESCE(NULLIF(c.display_name,''),p.name) AS name,p.price,p.category,p.brand,p.in_stock,
              c.slug,c.annotation,c.meta_desc,c.sale_price,c.sale_until,
              (SELECT path FROM product_images i WHERE i.pid=p.pid ORDER BY sort LIMIT 1) AS img
         FROM products p JOIN product_content c ON c.pid=p.pid
        WHERE c.visible=1 AND c.slug IS NOT NULL AND c.slug<>''
        ORDER BY p.category, name`
    ).all()).results || [];
  } catch (e) { degraded = true; }

  const items = [];
  for (const r of rows) {
    if (!r.img) continue;                       // Merchant вимагає зображення — пропускаємо без фото
    if (r.price == null || r.price <= 0) continue;
    const sale = (r.sale_price != null && r.sale_price > 0 && r.sale_price < r.price && (!r.sale_until || r.sale_until >= today)) ? r.sale_price : null;
    const price = (sale != null ? sale : r.price).toFixed(2);
    const imgAbs = encodeURI(String(r.img).startsWith('http') ? r.img : origin + '/' + String(r.img).replace(/^\//, ''));
    const desc = (r.meta_desc || r.annotation || r.name).slice(0, 4000);
    items.push(
      '<item>' +
      '<g:id>' + xesc(r.pid) + '</g:id>' +
      '<title>' + xesc(r.name) + '</title>' +
      '<description>' + xesc(desc) + '</description>' +
      '<link>' + xesc(origin + '/p/' + r.slug) + '</link>' +
      '<g:image_link>' + xesc(imgAbs) + '</g:image_link>' +
      '<g:availability>' + (r.in_stock !== 0 ? 'in_stock' : 'out_of_stock') + '</g:availability>' +
      '<g:price>' + price + ' UAH</g:price>' +
      (r.brand ? '<g:brand>' + xesc(r.brand) + '</g:brand>' : '') +
      '<g:condition>new</g:condition>' +
      '<g:identifier_exists>no</g:identifier_exists>' +
      (r.category ? '<g:product_type>' + xesc(r.category) + '</g:product_type>' : '') +
      '</item>'
    );
  }

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0"><channel>' +
    '<title>' + xesc(shopName) + '</title>' +
    '<link>' + origin + '</link>' +
    '<description>' + xesc(shopName + ' — товарний фід') + '</description>' +
    items.join('') +
    '</channel></rss>\n';

  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600', ...(degraded ? { 'x-degraded': '1' } : {}) } });
}
