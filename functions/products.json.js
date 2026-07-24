// Замінює статичний products.json на "живий" — дані завжди актуальні з D1,
// синхронізація після /admin/import (1С) більше не потрібна.
// Файл має лежати саме тут: functions/products.json.js → маршрут /products.json

export async function onRequestGet(context) {
  const { env } = context;
  try {
    const rows = (await env.DB.prepare(
      `SELECT
         p.pid, p.name, p.price, p.category, p.brand, p.in_stock,
         COALESCE(NULLIF(pc.display_name,''), p.name) AS display_name,
         pc.slug, pc.annotation, pc.keywords,
         (SELECT pi.path FROM product_images pi WHERE pi.pid = p.pid ORDER BY pi.sort LIMIT 1) AS img
       FROM products p
       LEFT JOIN product_content pc ON pc.pid = p.pid
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

    return new Response(JSON.stringify(out), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=300', // 5 хв — знижує навантаження на D1 при частих візитах
        'access-control-allow-origin': '*',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'products.json build error: ' + String(e.message || e) }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
}
