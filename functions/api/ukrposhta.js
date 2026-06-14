// /api/ukrposhta — проксі до адресного класифікатора Укрпошти (Bearer-токен у secrets.ukrposhta_token).
// type=city: пошук міста → {items:[{name, ref=CITY_ID}]}; type=po: відділення міста → {items:[{name, ref=POSTCODE}]}.
// Без токена → {error:'no_key'} (форма деградує до ручного вводу адреси).
function json(o){ return new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' } }); }
const BASE = 'https://www.ukrposhta.ua/address-classifier-ws';

export async function onRequestGet(context) {
  let token = '';
  try { const r = await context.env.DB.prepare(`SELECT value FROM secrets WHERE key='ukrposhta_token'`).first(); if (r && r.value) token = String(r.value); } catch (e) {}
  if (!token) return json({ error: 'no_key', items: [] });

  const url = new URL(context.request.url);
  const type = url.searchParams.get('type');
  const q = (url.searchParams.get('q') || '').slice(0, 80);
  const ref = (url.searchParams.get('ref') || '').replace(/[^0-9]/g, '').slice(0, 12);

  // дешевий відсів + rate-limit (як /api/np)
  if (type === 'city' && q.length < 2) return json({ items: [] });
  try {
    const ip = context.request.headers.get('CF-Connecting-IP') || 'x';
    const minute = Math.floor(Date.now() / 60000);
    const rk = `up:${ip}:${minute}`;
    const row = await context.env.DB.prepare(`SELECT cnt FROM rate_limits WHERE k=?`).bind(rk).first();
    if (row && row.cnt >= 60) return json({ error: 'rate', items: [] });
    await context.env.DB.prepare(`INSERT INTO rate_limits(k,cnt,exp) VALUES(?,1,?) ON CONFLICT(k) DO UPDATE SET cnt=cnt+1`).bind(rk, (minute + 2) * 60000).run();
  } catch (e) {}

  let apiUrl;
  if (type === 'city') {
    apiUrl = `${BASE}/get_city_by_region_id_and_district_id_and_city_ua?city_ua=${encodeURIComponent(q)}`;
  } else if (type === 'po') {
    if (!ref) return json({ items: [] });
    apiUrl = `${BASE}/get_postoffices_by_city_id?city_id=${ref}`;
  } else {
    return json({ error: 'bad_type', items: [] });
  }

  try {
    const r = await fetch(apiUrl, { headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' } });
    if (!r.ok) return json({ error: 'upstream_' + r.status, items: [] });
    const d = await r.json();
    const entries = (d && d.Entries && d.Entries.Entry) ? (Array.isArray(d.Entries.Entry) ? d.Entries.Entry : [d.Entries.Entry]) : [];
    let items = [];
    if (type === 'city') {
      items = entries.map(e => {
        const region = e.REGION_UA ? ' (' + e.REGION_UA.replace(/\s*обл.*/i, '') + ' обл.)' : '';
        return { name: (e.CITY_UA || '') + region, ref: String(e.CITY_ID || '') };
      }).filter(x => x.name && x.ref).slice(0, 20);
    } else {
      items = entries.map(e => {
        const code = e.POSTCODE || e.POSTINDEX || '';
        const desc = e.PO_LONG || e.PO_SHORT || e.POSTOFFICE_UA || '';
        const addr = e.ADDRESS || e.STREET_UA_VPZ || '';
        return { name: (code ? code + ' — ' : '') + desc + (addr ? ', ' + addr : ''), ref: String(code) };
      }).filter(x => x.name && x.ref).slice(0, 40);
    }
    return json({ items });
  } catch (e) {
    return json({ error: 'fetch', items: [] });
  }
}
