// Замінює статичний products.json на "живий" — дані завжди актуальні з D1,
// синхронізація після /admin/import (1С) більше не потрібна.
// Файл має лежати саме тут: functions/products.json.js → маршрут /products.json
//
// ВИПРАВЛЕННЯ (03.09.2026, боротьба з перевищенням D1 rows read):
// 1. Раніше на кожен товар виконувався окремий корельований підзапит за фото
//    (SELECT ... WHERE pi.pid = p.pid ORDER BY sort LIMIT 1) — тепер це один
//    прохід через ROW_NUMBER() замість N підзапитів.
// 2. cache-control сам по собі НЕ кешував відповідь на едж (cf-cache-status
//    завжди був DYNAMIC) — тепер кеш явно керується через Cache API,
//    тому реальні повторні запити протягом 5 хв більше не йдуть у D1 взагалі.

export async function onRequestGet(context) {
  const { env, request } = context;

  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).toString(), request);

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const rows = (await env.DB.prepare(
      `WITH first_img AS (
         SELECT pid, path,
                ROW_NUMBER() OVER (PARTITION BY pid ORDER BY sort) AS rn
         FROM product_images
       )
       SELECT
         p.pid, p.name, p.price, p.category, p.brand, p.in_stock,
         COALESCE(NULLIF(pc.display_name,''), p.name) AS display_name,
         pc.slug, pc.annotation, pc.keywords,
         fi.path AS img
       FROM products p
       LEFT JOIN product_content pc ON pc.pid = p.pid
       LEFT JOIN first_img fi ON fi.pid = p.pid AND fi.rn = 1
       WHERE COALESCE(pc.visible, 1) = 1
       ORDER BY p.pid`
    ).all()).results || [];

    const out = rows.map(r => ({
      n: r.display_name || r.name,
      p: r.price,
      c: r.category || '',
      b: r.brand || '',
      img: r.img || '',
      inStock: !!r.in_stock,
      annot: r.annotation || '',
      keywords: r.keywords || '',
      slug: r.slug || '',
    }));

    const response = new Response(JSON.stringify(out), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=300', // 5 хв — тепер це реально виконується через Cache API нижче
        'access-control-allow-origin': '*',
      },
    });

    // Явно кладемо в едж-кеш — це те, чого не робив cache-control сам по собі.
    context.waitUntil(cache.put(cacheKey, response.clone()));

    return response;
  } catch (e) {
    return new Response(JSON.stringify({ error: 'products.json build error: ' + String(e.message || e) }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
}
