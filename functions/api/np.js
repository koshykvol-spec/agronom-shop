// /api/np — проксі до API Нової Пошти (ключ у env.NP_API_KEY). Автодоповнення міст і відділень.
// Без ключа повертає {error:'no_key'} → форма деградує до вільного вводу адреси.
function json(o){ return new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' } }); }

export async function onRequestGet(context) {
  // Ключ: спершу з D1 secrets (керується в /admin/keys), потім — env (для сумісності)
  let key = '';
  try { const r = await context.env.DB.prepare(`SELECT value FROM secrets WHERE key='np_api_key'`).first(); if (r && r.value) key = r.value; } catch (e) {}
  if (!key) key = context.env.NP_API_KEY || '';
  if (!key) return json({ error: 'no_key', items: [] });
  const url = new URL(context.request.url);
  const type = url.searchParams.get('type');
  const q = (url.searchParams.get('q') || '').slice(0, 80);
  const ref = url.searchParams.get('ref') || '';
  const city = (url.searchParams.get('city') || '').slice(0, 80);

  // дешевий відсів сміття: пошук міста по 1 символу не має сенсу (економить квоту НП)
  if (type === 'city' && q.length < 2) return json({ items: [] });

  // rate-limit per IP (анти-абуз відкритого проксі): не більше 60 запитів/хв з одного IP.
  // Лічильник у D1 (таблиця rate_limits, ключ np:<ip>:<хвилина>). Над лімітом — лише читання, без запису.
  try {
    const ip = context.request.headers.get('CF-Connecting-IP') || 'x';
    const minute = Math.floor(Date.now() / 60000);
    const rk = `np:${ip}:${minute}`;
    const row = await context.env.DB.prepare(`SELECT cnt FROM rate_limits WHERE k=?`).bind(rk).first();
    if (row && row.cnt >= 60) return json({ error: 'rate', items: [] });
    await context.env.DB.prepare(`INSERT INTO rate_limits(k,cnt,exp) VALUES(?,1,?) ON CONFLICT(k) DO UPDATE SET cnt=cnt+1`).bind(rk, (minute + 2) * 60000).run();
    if (Math.random() < 0.02) { try { await context.env.DB.prepare(`DELETE FROM rate_limits WHERE exp < ?`).bind(Date.now()).run(); } catch (e) {} }
  } catch (e) { /* проблеми з лічильником не мають блокувати автодоповнення */ }

  let body;
  if (type === 'city') {
    body = { apiKey: key, modelName: 'Address', calledMethod: 'searchSettlements', methodProperties: { CityName: q, Limit: '10' } };
  } else if (type === 'wh') {
    // ref із searchSettlements — це DeliveryCity, тобто CityRef для getWarehouses
    const mp = ref ? { CityRef: ref } : { CityName: city };
    mp.FindByString = q; mp.Limit = '25';
    body = { apiKey: key, modelName: 'AddressGeneral', calledMethod: 'getWarehouses', methodProperties: mp };
  } else {
    return json({ error: 'bad_type', items: [] });
  }

  try {
    const r = await fetch('https://api.novaposhta.ua/v2.0/json/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    let items = [];
    if (type === 'city') {
      const addrs = (d.data && d.data[0] && d.data[0].Addresses) || [];
      items = addrs.map(a => ({ ref: a.DeliveryCity || a.Ref || '', name: a.Present || a.MainDescription || '' })).filter(x => x.name);
    } else {
      items = (d.data || []).map(w => ({ name: w.Description || '', ref: w.Ref || '' })).filter(x => x.name);
    }
    return json({ items });
  } catch (e) {
    return json({ error: 'fetch', items: [] });
  }
}
