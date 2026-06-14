// Sitemap для PDP (~2200 URL, основна вага).
export async function onRequest(context) {
  const origin = new URL(context.request.url).origin;
  const db = context.env.DB;

  let prods = [];
  try {
    const r = await db.prepare(
      `SELECT slug FROM product_content WHERE visible=1 AND slug IS NOT NULL`
    ).all();
    prods = (r.results || []).map(x => x.slug);
  } catch (e) { /* пуста карта — краще, ніж 500 */ }

  const urls = prods.map(s => `${origin}/p/${s}`);
  const body = urls.map(u => `  <url><loc>${u.replace(/&/g, '&amp;')}</loc></url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;

  return new Response(xml, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' }
  });
}
