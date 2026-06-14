// Кореневий middleware: освіжає noscript-список категорій на головній з D1 «на льоту»,
// щоб нова категорія зʼявлялась без передеплою (prerender.py лишається статичним baseline).
// Для всіх інших шляхів — миттєвий прохід (нульові накладні). Будь-яка помилка → оригінал.
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// Свіжий noscript-блок категорій з D1, кешований у Cache API на 1 год (D1 не б'ється на кожен запит).
async function freshNoscript(env) {
  const cache = caches.default;
  const key = new Request('https://agronom.internal/noscript-cats');
  const hit = await cache.match(key);
  if (hit) return await hit.text();

  const cats = (await env.DB.prepare(`SELECT key, nav_label FROM categories ORDER BY sort`).all()).results || [];
  if (!cats.length) return null;
  const items = cats.map(c =>
    `<li><a href="category.html?cat=${encodeURIComponent(c.key)}">${esc(c.nav_label)}</a></li>`
  ).join('') + '<li><a href="/katalog">Повний каталог товарів</a></li>';
  const block = `<!--PRERENDER-START-->\n<noscript><ul class="seo-catalog">${items}</ul></noscript>\n<!--PRERENDER-END-->`;

  await cache.put(key, new Response(block, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' }
  }));
  return block;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const path = new URL(request.url).pathname;
  // Тільки головна; решта (статика, /api, /admin, /p, фото) — без накладних
  if (path !== '/' && path !== '/index.html') return next();

  const res = await next();
  try {
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return res;

    let block = null;
    try { block = await freshNoscript(env); } catch (e) { block = null; }
    if (!block) return res;                       // D1 недоступний → статичний noscript (prerender)

    const html = await res.text();
    if (html.indexOf('<!--PRERENDER-START-->') === -1) return new Response(html, res);
    const out = html.replace(/<!--PRERENDER-START-->[\s\S]*?<!--PRERENDER-END-->/, block);
    return new Response(out, { status: res.status, headers: new Headers(res.headers) });
  } catch (e) {
    return res;                                   // будь-яка помилка → оригінал, сайт не ламається
  }
}
