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
    `<li><a href="/category?cat=${encodeURIComponent(c.key)}">${esc(c.nav_label)}</a></li>`
  ).join('') + '<li><a href="/katalog">Повний каталог товарів</a></li>';
  const block = `<!--PRERENDER-START-->\n<noscript><ul class="seo-catalog">${items}</ul></noscript>\n<!--PRERENDER-END-->`;

  await cache.put(key, new Response(block, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' }
  }));
  return block;
}

// SEO для category.html/?cat=X на сервері: без цього <link rel="canonical"> лишається
// статичним "category.html" (без ?cat=), Googlebot бачить сирий HTML ДО клієнтського JS
// і трактує усі 11 категорій як дублі/редирект одна одної → GSC "Сторінка з переспрямуванням".
// Кешуємо конфіг категорії в Cache API на 1 год, ключ окремий на кожен cat.
async function freshCategorySeo(env, catKey) {
  const cache = caches.default;
  const key = new Request('https://agronom.internal/cat-seo/' + encodeURIComponent(catKey));
  const hit = await cache.match(key);
  if (hit) return await hit.json();

  const row = await env.DB.prepare(
    `SELECT seo_title, h1, seo_desc FROM categories WHERE key = ?`
  ).bind(catKey).first();
  if (!row) return null;

  await cache.put(key, new Response(JSON.stringify(row), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' }
  }));
  return row;
}

function applyCategorySeo(html, catKey, seo) {
  const canonUrl = `https://agronom.pp.ua/category?cat=${encodeURIComponent(catKey)}`;
  let out = html.replace(
    /<link rel="canonical" href="[^"]*">/,
    `<link rel="canonical" href="${canonUrl}">`
  );
  if (seo?.seo_title) {
    out = out.replace(/<title id="page-title">[^<]*<\/title>/, `<title id="page-title">${esc(seo.seo_title)}</title>`);
    out = out.replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(seo.seo_title)}$2`);
  }
  if (seo?.seo_desc) {
    out = out.replace(/(<meta name="description" id="page-desc" content=")[^"]*(")/, `$1${esc(seo.seo_desc)}$2`);
  }
  return out;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const isHome = path === '/' || path === '/index.html';
  const isCategory = path === '/category' || path === '/category.html';
  // Решта (статика, /api, /admin, /p, фото) — без накладних
  if (!isHome && !isCategory) return next();

  const res = await next();
  try {
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return res;
    let html = await res.text();

    if (isHome) {
      let block = null;
      try { block = await freshNoscript(env); } catch (e) { block = null; }
      if (block && html.indexOf('<!--PRERENDER-START-->') !== -1) {
        html = html.replace(/<!--PRERENDER-START-->[\s\S]*?<!--PRERENDER-END-->/, block);
      }
      return new Response(html, { status: res.status, headers: new Headers(res.headers) });
    }

    // isCategory
    const catKey = url.searchParams.get('cat') || '';
    if (!catKey) return new Response(html, res);   // /category без ?cat= — canonical лишається як є
    let seo = null;
    try { seo = await freshCategorySeo(env, catKey); } catch (e) { seo = null; }
    const out = applyCategorySeo(html, catKey, seo);   // canonical правиться навіть якщо D1 недоступний
    return new Response(out, { status: res.status, headers: new Headers(res.headers) });
  } catch (e) {
    return res;                                   // будь-яка помилка → оригінал, сайт не ламається
  }
}
