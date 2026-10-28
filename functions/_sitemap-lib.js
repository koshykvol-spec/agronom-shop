// Спільні хелпери для sitemap-ів (файл з "_" — не є маршрутом Pages).
// Кеш через Cache API + захист від збоїв D1:
//  - успішна відповідь кешується (TTL із заголовка) і ще раз як "запасна копія" на 7 днів;
//  - якщо D1 недоступна (виняток або 5xx) — віддаємо запасну копію (X-Cache: STALE),
//    а якщо її немає — чесний 503 + Retry-After; помилки в кеш не потрапляють.
// Завдяки цьому Google ніколи не отримає порожню карту як "успішну" відповідь.

export function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function xmlResponse(xml) {
  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}

export function urlset(entries) {
  const body = entries.join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export async function cached(context, render) {
  const { request } = context;
  // GET і HEAD проходять через кеш (ключі кешу завжди будуються як GET)
  if (request.method !== 'GET' && request.method !== 'HEAD') return render(context);
  const url = new URL(request.url);
  const cache = caches.default;
  const key = new Request(url.origin + url.pathname);
  const staleKey = new Request(url.origin + '/__stale' + url.pathname);

  const hit = await cache.match(key);
  if (hit) {
    const r = new Response(hit.body, hit);
    r.headers.set('X-Cache', 'HIT');
    return r;
  }

  let res = null;
  try { res = await render(context); } catch (e) { res = null; }

  if (res && res.status < 500) {
    context.waitUntil(cache.put(key, res.clone()));
    const copy = res.clone();
    const h = new Headers(copy.headers);
    h.set('cache-control', 'public, max-age=604800'); // запасна копія живе 7 днів
    context.waitUntil(cache.put(staleKey, new Response(copy.body, { status: 200, headers: h })));
    res.headers.set('X-Cache', 'MISS');
    return res;
  }

  const stale = await cache.match(staleKey);
  if (stale) {
    const r = new Response(stale.body, stale);
    r.headers.set('cache-control', 'no-store');
    r.headers.set('X-Cache', 'STALE');
    return r;
  }
  return new Response('Сервіс тимчасово недоступний. Спробуйте за кілька хвилин.', {
    status: 503,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'retry-after': '300',
      'cache-control': 'no-store',
      'X-Cache': 'ERROR',
    },
  });
}
