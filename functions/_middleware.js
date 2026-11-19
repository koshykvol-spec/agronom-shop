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
  if (hit) { const j = await hit.json(); return j && j.__missing ? null : j; }

  const row = await env.DB.prepare(
    `SELECT seo_title, h1, seo_desc, nav_label FROM categories WHERE key = ?`
  ).bind(catKey).first();
  // Немає рядка → категорії не існує. Це відрізняється від збою D1 (тоді prepare/first кидає виняток).
  // Негативний результат кешуємо коротко, щоб боти з випадковими ?cat= не били по D1 щоразу.
  if (!row) {
    await cache.put(key, new Response(JSON.stringify({ __missing: true }), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' }
    }));
    return null;
  }

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
  // <h1> у статичному category.html порожній і заповнюється лише JS — для краулера без рендеру підставляємо на сервері.
  const h1 = (seo?.h1 || seo?.nav_label || '').trim();
  if (h1) {
    out = out.replace(/(<h1 id="page-h1"[^>]*>)\s*(<\/h1>)/, `$1${esc(h1)}$2`);
  }
  return out;
}

// Pages публікує весь корінь репозиторію як статику. Службові файли (дампи БД, міграції, скрипти, логи, документація)
// не мають бути публічними: віддаємо 404 до того, як запит дійде до статичних ресурсів.
const PRIVATE_PATH = /^\/(db|docs|sample|tests|cloudflare-worker|__pycache__|\.github|\.git|node_modules)(\/|$)|\.(sql|py|pyc|sh|log|csv|md|toml|bak|env|yml|yaml)$|^\/(deploy\.sh|post-to-facebook\.js|posted-log\.json|package(-lock)?\.json|h|\.gitignore|\.cf-secrets.*)$/i;
function isPrivatePath(pathname) {
  let p = pathname;
  try { p = decodeURIComponent(pathname); } catch (e) {}
  return PRIVATE_PATH.test(pathname) || PRIVATE_PATH.test(p) || /^\/ЧИТАЙ МЕНЕ/i.test(p);
}

// Шляхи з X-Robots-Tag: noindex — усі *.json (products.json, img-map.json, recipes.json, protection_schemes.json) і /api/*.
const NOINDEX_PATH = /\.json$|^\/api(\/|$)/i;

// ДІАГНОСТИКА: максимум записів у host_hits на один ізолят (щоб хвиля ботів не розкачала D1 на запис).
let hostHitBudget = 150;

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  // ДІАГНОСТИКА: хто ходить на хости, відмінні від основного (технічний *.pages.dev, превʼю-адреси).
  // Журнал у D1 (таблиця host_hits, див. migration_host_hits.sql); логи Pages у Observability не збираються.
  // Видалити цей блок і таблицю, коли причину піків встановлено.
  if (url.hostname !== 'agronom.pp.ua' && url.hostname !== 'localhost' && env.DB && hostHitBudget > 0) {
    hostHitBudget--;
    try {
      context.waitUntil(env.DB.prepare('INSERT INTO host_hits (host, path, ua, ip, asn, country) VALUES (?,?,?,?,?,?)')
        .bind(url.hostname, url.pathname.slice(0, 200), (request.headers.get('user-agent') || '').slice(0, 200),
          request.headers.get('cf-connecting-ip'), (request.cf && request.cf.asn) || null, (request.cf && request.cf.country) || null)
        .run().catch(() => {}));
    } catch (e) {}
  }
  // Технічний домен Pages не має віддавати контент: краулери ходять по ньому повз кеш/правила зони
  // і б'ють по D1 (дублі /p/<slug>). Превʼю-деплої (<hash>.agronom1.pages.dev) не чіпаємо — лише точний хост.
  // 308 зберігає метод і тіло запиту.
  if (url.hostname === 'agronom1.pages.dev') {
    // ДІАГНОСТИКА джерела піків D1: хто ходить на технічний домен. Видалити, коли причину встановлено.
    console.log(JSON.stringify({ t: 'pagesdev', path: url.pathname, ua: (request.headers.get('user-agent') || '').slice(0, 120), ip: request.headers.get('cf-connecting-ip'), asn: request.cf && request.cf.asn, country: request.cf && request.cf.country }));
    return Response.redirect('https://agronom.pp.ua' + url.pathname + url.search, 308);
  }
  const path = url.pathname;
  if (isPrivatePath(path)) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
  const isHome = path === '/' || path === '/index.html';
  const isCategory = path === '/category' || path === '/category.html';
  // Технічні дані (JSON каталогу, /api/*) не мають потрапляти в індекс: Googlebot їх читає для рендеру,
  // тому не Disallow у robots.txt, а саме X-Robots-Tag: noindex у відповіді.
  if (NOINDEX_PATH.test(path)) {
    const r = await next();
    const h = new Headers(r.headers);
    h.set('X-Robots-Tag', 'noindex');
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
  }
  // Решта (статика, /admin, /p, фото) — без накладних
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
    let seo = null, dbOk = true;
    try { seo = await freshCategorySeo(env, catKey); } catch (e) { seo = null; dbOk = false; }
    // Невідомий ?cat= (D1 відповіла, а рядка немає) → справжній 404, а не 200 із самореферентним canonical (soft-404/дублі).
    // При збої D1 категорію НЕ вважаємо неіснуючою: віддаємо 200, як раніше.
    if (dbOk && !seo) {
      const h = new Headers(res.headers);
      h.set('Cache-Control', 'public, max-age=300');
      h.delete('ETag');
      return new Response(html, { status: 404, headers: h });
    }
    let out = applyCategorySeo(html, catKey, seo);   // canonical правиться навіть якщо D1 недоступний
    // Сітку товарів малює app.js, тож у сирому HTML немає посилань на /p/. Додаємо видиме для всіх посилання
    // на серверний список розділу (functions/katalog/[cat].js) — краулер без JS отримує вхід до товарів.
    // Лише для підтвердженої категорії (seo != null), щоб не плодити посилання на довільні ?cat=.
    if (seo) {
      out = out.replace(
        '<div id="catalog-pager" class="catalog-pager"></div>',
        m => m + `\n    <p class="seo-list-link" style="margin:18px 0;font-size:.9rem;"><a href="/katalog/${encodeURIComponent(catKey)}" style="color:var(--green);font-weight:700;">Усі товари розділу списком →</a></p>`
      );
    }
    return new Response(out, { status: res.status, headers: new Headers(res.headers) });
  } catch (e) {
    return res;                                   // будь-яка помилка → оригінал, сайт не ламається
  }
}
