// /api/products — каталог із D1 (slim). Фасовки з одним group_id колапсуються в одну картку «від X грн».
// Кеш через Cache API + захист від збоїв D1.
// Pages Function виконується ПЕРЕД CDN-кешем, тому самого Cache-Control недостатньо.
//  - успішна відповідь кешується (TTL із заголовка) і ще раз як "запасна копія" на 7 днів;
//  - якщо D1 недоступна (виняток, 5xx або мітка x-degraded) — віддаємо запасну копію
//    (X-Cache: STALE, без кешування), а якщо її немає — чесний 503 + Retry-After;
//  - помилки та деградовані відповіді в кеш не потрапляють.
// opts: skipCache (не читати/не писати кеш), serveDegraded (за відсутності запасної копії
// віддати деградовану відповідь як є), errorBody/errorType (тіло 503).
async function cached(context, render, opts = {}) {
  const { request } = context;
  if (request.method !== 'GET') return render(context);
  const url = new URL(request.url);
  const cache = caches.default;
  const key = new Request(url.origin + url.pathname);
  const staleKey = new Request(url.origin + '/__stale' + url.pathname);
  const useCache = !opts.skipCache;

  if (useCache) {
    const hit = await cache.match(key);
    if (hit) {
      const r = new Response(hit.body, hit);
      r.headers.set('X-Cache', 'HIT');
      return r;
    }
  }

  let res = null;
  try { res = await render(context); } catch (e) { res = null; }
  const failed = !res || res.status >= 500 || res.headers.has('x-degraded');

  if (!failed) {
    const store = useCache && res.status === 200;
    if (store) {
      context.waitUntil(cache.put(key, res.clone()));
      const copy = res.clone();
      const h = new Headers(copy.headers);
      h.set('cache-control', 'public, max-age=604800'); // запасна копія живе 7 днів
      context.waitUntil(cache.put(staleKey, new Response(copy.body, { status: 200, headers: h })));
    }
    res.headers.set('X-Cache', store ? 'MISS' : 'BYPASS');
    return res;
  }

  if (useCache) {
    const stale = await cache.match(staleKey);
    if (stale) {
      const r = new Response(stale.body, stale);
      r.headers.set('cache-control', 'no-store');
      r.headers.set('X-Cache', 'STALE');
      return r;
    }
  }
  if (res && res.status < 500 && opts.serveDegraded) {
    res.headers.delete('x-degraded');
    res.headers.set('cache-control', 'no-store');
    res.headers.set('X-Cache', 'BYPASS');
    return res;
  }
  return new Response(opts.errorBody || 'Сервіс тимчасово недоступний. Спробуйте за кілька хвилин.', {
    status: 503,
    headers: {
      'content-type': opts.errorType || 'text/plain; charset=utf-8',
      'retry-after': '300',
      'cache-control': 'no-store',
      'X-Cache': 'ERROR'
    }
  });
}

export async function onRequestGet(context) {
  return cached(context, renderProducts, { errorBody: '[]', errorType: 'application/json; charset=utf-8' });
}

async function renderProducts(context) {
  const today = new Date().toISOString().slice(0, 10);
  let out = [];
  try {
    const r = await context.env.DB.prepare(
      `SELECT p.pid AS pid, COALESCE(NULLIF(c.display_name,''), p.name) AS n, p.name AS wn,
              p.price AS pr, p.category AS cat, p.brand AS br, p.in_stock AS ins,
              c.slug AS slug, c.keywords AS kw, c.sale_price AS sp, c.sale_until AS su,
              c.group_id AS gid, c.variant_label AS vl, c.image_ok AS iok, c.active_ingredient AS ai,
              (SELECT path FROM product_images i WHERE i.pid=p.pid ORDER BY sort LIMIT 1) AS img
         FROM products p JOIN product_content c ON c.pid=p.pid
        WHERE c.visible=1
        ORDER BY COALESCE(NULLIF(c.display_name,''), p.name)`).all();

    const rows = (r.results || []).map(x => {
      const sale = (x.sp != null && x.sp > 0 && x.sp < x.pr && (!x.su || x.su >= today)) ? x.sp : undefined;
      const kw = (x.kw || '') + ((x.wn && x.wn !== x.n) ? ' ' + x.wn : '') + (x.ai ? ' ' + x.ai : '');
      const o = { pid: x.pid, n: x.n, p: x.pr, c: x.cat, b: x.br, img: x.img || '', inStock: x.ins !== 0, keywords: kw, slug: x.slug,
                  _gid: x.gid || null, _vl: x.vl || '', _eff: (sale != null ? sale : x.pr), _iok: x.iok };
      if (sale != null) { o.sale = sale; if (x.su) o.saleUntil = x.su; }
      return o;
    });

    // колапс фасовок: товари з одним group_id → одна картка (головна = найдешевша)
    const byGid = new Map(); const singles = [];
    for (const o of rows) {
      if (o._gid) { if (!byGid.has(o._gid)) byGid.set(o._gid, []); byGid.get(o._gid).push(o); }
      else singles.push(o);
    }
    const groups = [];
    for (const vs of byGid.values()) {
      vs.sort((a, b) => a._eff - b._eff);
      const prim = vs[0];
      let n = prim.n;
      if (prim._vl && n.indexOf(prim._vl) >= 0) n = n.replace(prim._vl, '').replace(/[\s,;·]+$/, '').replace(/\s+/g, ' ').trim();
      // фото групи: фасовки з РОБОЧИМ файлом (image_ok=1), інакше будь-яка з шляхом
      const imgVar = vs.find(v => v._iok === 1 && v.img) || vs.find(v => v.img);
      groups.push({
        pid: prim.pid, n: n, p: prim._eff, priceFrom: true, vcount: vs.length, group: prim._gid,
        c: prim.c, b: prim.b, img: (imgVar ? imgVar.img : ''),
        inStock: vs.some(v => v.inStock),
        keywords: ((prim.keywords || '') + ' ' + vs.map(v => v.n).join(' ')).trim(),
        slug: prim.slug
      });
    }
    for (const o of singles) { delete o._gid; delete o._vl; delete o._eff; }
    out = singles.concat(groups);
    out.sort((a, b) => String(a.n).localeCompare(String(b.n), 'uk'));
  } catch (e) { return new Response('[]', { status: 500, headers: { 'content-type': 'application/json' } }); }

 return new Response(JSON.stringify(out), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300, s-maxage=1800' }
  });
}
