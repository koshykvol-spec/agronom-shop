// /site-config — динамічний site-config.js: формує window.SITE_CONFIG з D1.
// Підключається як <script src="/site-config"> ПЕРШИМ (до footer.js/seo-jsonld.js).
// Керується в /admin/contacts. Якщо БД недоступна — віддаємо дефолти (сайт не ламається).

const FALLBACK = {
  name: 'Агроном',
  network: 'Мережа магазинів «Агроном» та «Агронова»',
  fop: 'ФОП Цаль-Цалько Г.В.',
  city: 'м. Володимир', locality: 'Володимир', region: 'Волинська область',
  phoneDisplay: '063 462 52 06', phoneIntl: '+380634625206', viberPhone: '380634625206',
  telegram: '', telegramChannel: '', email: '',
  googleClientId: '', tgLoginBotUsername: '',
  address: 'вул. Ковельська, 253П, м. Володимир',
  hours: 'Пн–Пт 9:00–18:00 · Сб 9:00–16:00 · Нд 10:00–16:00',
  stores: [
    { name: 'Агроном', street: 'вул. Ковельська, 253П', address: 'вул. Ковельська, 253П, м. Володимир',
      hours: 'Пн–Пт 9:00–18:00 · Сб 9:00–16:00 · Нд 10:00–16:00',
      map: 'https://www.google.com/maps/dir/?api=1&destination=50.863364,24.325344',
      geo: { lat: 50.863364, lng: 24.325344 },
      oh: [ { d: ['Monday','Tuesday','Wednesday','Thursday','Friday'], o: '09:00', c: '18:00' },
            { d: ['Saturday'], o: '09:00', c: '16:00' }, { d: ['Sunday'], o: '10:00', c: '16:00' } ] }
  ]
};

function emit(cfg, degraded) {
  return new Response('window.SITE_CONFIG = ' + JSON.stringify(cfg) + ';', {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=600, stale-while-revalidate=86400',
      ...(degraded ? { 'x-degraded': '1' } : {})
    }
  });
}

// Публічний білий список — ЛИШЕ ці ключі з site_settings можуть потрапити в публічну
// відповідь /site-config. Таблиця site_settings — спільна для публічних реквізитів І
// секретних API-ключів (Anthropic/Gemini/OpenRouter для AI-діагностики, Turnstile secret
// тощо) — раніше сюди віддавалось ВСЕ підряд без фільтрації, тобто секретні ключі були
// доступні будь-кому просто за адресою /site-config. Якщо додаєш нове публічне поле —
// впиши його ключ і сюди теж, інакше воно не потрапить у відповідь (це навмисно "safe by
// default": пропущений новий секретний ключ просто не покажеться, а не навпаки).
const PUBLIC_KEYS = new Set([
  'name', 'network', 'fop', 'city', 'locality', 'region',
  'phoneDisplay', 'phoneIntl', 'viberPhone',
  'telegram', 'telegramChannel', 'googleClientId', 'tgLoginBotUsername',
  'email', 'address', 'hours', 'np_placeholder',
  'turnstile_sitekey',   // публічний site key Turnstile-віджета (НЕ turnstile_secret!)
  'ukrposhta_on',        // просто перемикач фічі, не секрет
  'ga4_id', 'clarity_id' // ID аналітики — публічні за своєю природою, і так видно в HTML
]);

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
  return cached(context, renderConfig, { serveDegraded: true, errorBody: '/* site-config temporarily unavailable */', errorType: 'application/javascript; charset=utf-8' });
}

async function renderConfig(context) {
  const db = context.env.DB;
  try {
    const cfg = {};
    for (const r of (await db.prepare(`SELECT key,value FROM site_settings`).all()).results || []) {
      if (PUBLIC_KEYS.has(r.key)) cfg[r.key] = r.value;
    }
    const sRows = (await db.prepare(`SELECT name,street,address,hours,lat,lng,map,oh_json FROM stores ORDER BY sort,id`).all()).results || [];
    if (!Object.keys(cfg).length && !sRows.length) return emit(FALLBACK, true);
    cfg.stores = sRows.map(s => {
      let oh = [];
      try { oh = JSON.parse(s.oh_json || '[]'); } catch (e) {}
      const o = { name: s.name, street: s.street, address: s.address, hours: s.hours, map: s.map || '', oh };
      if (s.lat != null && s.lng != null) o.geo = { lat: s.lat, lng: s.lng };
      return o;
    });
    return emit(cfg);
  } catch (e) {
    return emit(FALLBACK, true);
  }
}
