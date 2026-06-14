// Sitemap для статичних сторінок і категорій (мала, 16-20 URL).
const FALLBACK_CATS = ['chemicals','import','domestic','weight','materials','drops','soil','pots','insects','animals','sprouts'];
const STATIC = ['index.html','katalog','protection_schemes.html','delivery.html','contacts.html','returns.html'];

export async function onRequest(context) {
  const origin = new URL(context.request.url).origin;
  const db = context.env.DB;

  let cats = FALLBACK_CATS;
  try {
    const cr = await db.prepare(`SELECT key FROM categories ORDER BY sort`).all();
    const keys = (cr.results || []).map(x => x.key).filter(Boolean);
    if (keys.length) cats = keys;
  } catch (e) { /* fallback */ }

  const urls = STATIC.map(s => `${origin}/${s}`)
    .concat(cats.map(c => `${origin}/category.html?cat=${c}`));

  const body = urls.map(u => `  <url><loc>${u.replace(/&/g, '&amp;')}</loc></url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;

  return new Response(xml, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' }
  });
}
