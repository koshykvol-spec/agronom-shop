// POST /api/search-log — приймає {q, cnt} з фронтенду (navigator.sendBeacon) і пише в D1.
// ТИМЧАСОВА ДІАГНОСТИЧНА ВЕРСІЯ: console.log на кожній контрольній точці,
// щоб знайти, де саме запис зупиняється. Прибрати логи після діагностики.

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    console.log('search-log: hit, env.DB =', !!env.DB);
    if (!env.DB) { console.log('search-log: STOP no env.DB'); return new Response(null, { status: 204 }); }

    const raw = await request.text();
    console.log('search-log: raw body =', raw, 'len =', raw ? raw.length : 0);
    if (!raw || raw.length > 2000) { console.log('search-log: STOP bad raw'); return new Response(null, { status: 204 }); }

    let data;
    try { data = JSON.parse(raw); }
    catch (pe) { console.log('search-log: STOP json parse error', pe.message); return new Response(null, { status: 204 }); }
    console.log('search-log: parsed data =', JSON.stringify(data));

    let q = String(data.q || '').trim().toLowerCase().slice(0, 100);
    const cnt = Math.max(0, Math.min(9999, parseInt(data.cnt, 10) || 0));
    console.log('search-log: q =', q, 'cnt =', cnt);
    if (!q) { console.log('search-log: STOP empty q'); return new Response(null, { status: 204 }); }

    const result = await env.DB.prepare(
      `INSERT INTO search_log (q, cnt, ts) VALUES (?, ?, ?)`
    ).bind(q, cnt, Math.floor(Date.now() / 1000)).run();
    console.log('search-log: INSERT result =', JSON.stringify(result));

    return new Response(null, { status: 204 });
  } catch (e) {
    console.error('search-log: EXCEPTION', e && e.message, e && e.stack);
    return new Response(null, { status: 204 });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': 'https://agronom.pp.ua',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
