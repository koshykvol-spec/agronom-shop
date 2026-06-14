// /site-config — динамічний site-config.js: формує window.SITE_CONFIG з D1.
// Підключається як <script src="/site-config"> ПЕРШИМ (до footer.js/seo-jsonld.js).
// Керується в /admin/contacts. Якщо БД недоступна — віддаємо дефолти (сайт не ламається).

const FALLBACK = {
  name: 'Агроном',
  network: 'Мережа магазинів «Агроном» та «Агронова»',
  fop: 'ФОП Цаль-Цалько Г.В.',
  city: 'м. Володимир', locality: 'Володимир', region: 'Волинська область',
  phoneDisplay: '063 462 52 06', phoneIntl: '+380634625206', viberPhone: '380634625206',
  telegram: '', email: '',
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

function emit(cfg) {
  return new Response('window.SITE_CONFIG = ' + JSON.stringify(cfg) + ';', {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=600, stale-while-revalidate=86400'
    }
  });
}

export async function onRequestGet(context) {
  const db = context.env.DB;
  try {
    const cfg = {};
    for (const r of (await db.prepare(`SELECT key,value FROM site_settings`).all()).results || []) cfg[r.key] = r.value;
    const sRows = (await db.prepare(`SELECT name,street,address,hours,lat,lng,map,oh_json FROM stores ORDER BY sort,id`).all()).results || [];
    if (!Object.keys(cfg).length && !sRows.length) return emit(FALLBACK);
    cfg.stores = sRows.map(s => {
      let oh = [];
      try { oh = JSON.parse(s.oh_json || '[]'); } catch (e) {}
      const o = { name: s.name, street: s.street, address: s.address, hours: s.hours, map: s.map || '', oh };
      if (s.lat != null && s.lng != null) o.geo = { lat: s.lat, lng: s.lng };
      return o;
    });
    return emit(cfg);
  } catch (e) {
    return emit(FALLBACK);
  }
}
