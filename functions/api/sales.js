// /api/sales — список товарів з активною акцією (slug → акційна ціна). Маленький JSON для каталогу.
export async function onRequestGet(context) {
  const today = new Date().toISOString().slice(0, 10);
  let rows = [];
  try {
    const r = await context.env.DB.prepare(
      `SELECT c.slug, c.sale_price, c.sale_until, p.price
         FROM product_content c JOIN products p ON p.pid=c.pid
        WHERE c.sale_price IS NOT NULL AND c.sale_price > 0 AND c.sale_price < p.price
          AND (c.sale_until IS NULL OR c.sale_until >= ?)`).bind(today).all();
    rows = r.results || [];
  } catch (e) {}
  return new Response(JSON.stringify(rows), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=120' }
  });
}
