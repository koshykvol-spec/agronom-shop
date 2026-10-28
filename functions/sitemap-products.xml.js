// Sitemap для PDP (~2200 URL, основна вага).
// Раніше помилка D1 ковталась і віддавалась ПОРОЖНЯ карта зі статусом 200 —
// Google міг прочитати її як "0 сторінок". Тепер збій = запасна копія або 503,
// а порожня вибірка вважається збоєм і ніколи не потрапляє в кеш.
import { cached, escapeXml, urlset, xmlResponse } from './_sitemap-lib.js';

async function renderProducts(context) {
  const origin = new URL(context.request.url).origin;
  const db = context.env.DB;

  const r = await db.prepare(
    `SELECT slug FROM product_content WHERE visible=1 AND slug IS NOT NULL`
  ).all();

  const entries = (r.results || [])
    .map(x => x.slug)
    .filter(Boolean)
    .map(s => `  <url><loc>${escapeXml(origin + '/p/' + s)}</loc></url>`);

  if (entries.length === 0) throw new Error('empty product sitemap');
  return xmlResponse(urlset(entries));
}

export async function onRequest(context) {
  return cached(context, renderProducts);
}
