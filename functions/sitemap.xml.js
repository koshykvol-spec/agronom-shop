// Cloudflare Pages Function — sitemap.xml як sitemap-INDEX.
// Розпилено на 2 під-карти, щоб GSC легше «перетравлював» (для .pp.ua TLD
// є хронічна проблема «не вдалося отримати» — менший index допомагає
// Google прочитати хоч індекс і черговий фетч під-карт).
// Раніше тут був повний urlset; тепер логіка живе в sitemap-main / sitemap-products.
export async function onRequest(context) {
  const origin = new URL(context.request.url).origin;
  const today = new Date().toISOString().slice(0, 10);
  const subs = [
    `${origin}/sitemap-main.xml`,
    `${origin}/sitemap-products.xml`,
  ];
  const body = subs.map(u =>
    `  <sitemap><loc>${u}</loc><lastmod>${today}</lastmod></sitemap>`
  ).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
