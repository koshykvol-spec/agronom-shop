// /api/liqpay-init — онлайн-оплата карткою (LiqPay), опція поряд із НП-післяоплатою.
// Turnstile + серверна валідація суми (як /api/order) → зберігає order (payment_status='pending')
// → повертає {data, signature} для POST-форми на LiqPay checkout. Telegram шлеться у callback ПІСЛЯ оплати.
const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json; charset=utf-8' } });

// base64(UTF-8) — btoa ламається на кирилиці, тому через TextEncoder
function b64(str) {
  let bin = ''; new Uint8Array(new TextEncoder().encode(str)).forEach(x => bin += String.fromCharCode(x));
  return btoa(bin);
}
// LiqPay signature = base64( sha1(private + data + private) ), sha1 у raw-байтах
async function liqpaySign(privateKey, data) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(privateKey + data + privateKey));
  let bin = ''; new Uint8Array(buf).forEach(x => bin += String.fromCharCode(x));
  return btoa(bin);
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  let b = {};
  try { b = await context.request.json(); } catch (e) {}

  // Ключі LiqPay (server-only)
  let pub = '', priv = '';
  try { const r = await db.prepare(`SELECT value FROM secrets WHERE key='liqpay_public'`).first(); if (r && r.value) pub = String(r.value); } catch (e) {}
  try { const r = await db.prepare(`SELECT value FROM secrets WHERE key='liqpay_private'`).first(); if (r && r.value) priv = String(r.value); } catch (e) {}
  if (!pub || !priv) return J({ ok: false, error: 'Онлайн-оплата тимчасово недоступна' }, 503);

  // Turnstile (анти-спам)
  let tsSecret = '';
  try { const r = await db.prepare(`SELECT value FROM secrets WHERE key='turnstile_secret'`).first(); if (r && r.value) tsSecret = String(r.value); } catch (e) {}
  if (tsSecret) {
    const token = (b.turnstileToken || '').toString();
    if (!token) return J({ ok: false, error: 'Підтвердіть, що ви не робот' }, 403);
    try {
      const form = new URLSearchParams();
      form.append('secret', tsSecret); form.append('response', token);
      const ip = context.request.headers.get('CF-Connecting-IP'); if (ip) form.append('remoteip', ip);
      const vr = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
      const vd = await vr.json().catch(() => ({ success: false }));
      if (!vd.success) return J({ ok: false, error: 'Перевірка Turnstile не пройдена' }, 403);
    } catch (e) { return J({ ok: false, error: 'Помилка перевірки Turnstile' }, 502); }
  }

  const name = (b.name || '').toString().slice(0, 120);
  const phone = (b.phone || '').toString().slice(0, 40);
  const address = (b.address || '').toString().slice(0, 300);
  const delivery = (b.delivery || '').toString().slice(0, 40);
  const comment = (b.comment || '').toString().slice(0, 1000);

  // Серверна валідація суми (ціни з D1 за pid; клієнтському total НЕ довіряємо)
  const today = new Date().toISOString().slice(0, 10);
  const rawItems = Array.isArray(b.items) ? b.items.slice(0, 200) : [];
  let serverTotal = 0; const validated = [];
  for (const it of rawItems) {
    const pid = parseInt(it && it.pid, 10);
    const qty = Number(it && it.q) || 0;
    let price = Number(it && it.p) || 0;
    if (pid) {
      price = 0;
      try {
        const row = await db.prepare(`SELECT p.price AS pr, c.sale_price AS sp, c.sale_until AS su FROM products p JOIN product_content c ON c.pid=p.pid WHERE p.pid=?`).bind(pid).first();
        if (row) { const sale = (row.sp != null && row.sp > 0 && row.sp < row.pr && (!row.su || row.su >= today)) ? row.sp : null; price = Number(sale != null ? sale : row.pr) || 0; }
      } catch (e) {}
    }
    serverTotal += price * qty;
    validated.push({ n: (it && it.n) || '', p: price, q: qty, pid: pid || null });
  }
  serverTotal = Math.round(serverTotal * 100) / 100;
  if (serverTotal <= 0) return J({ ok: false, error: 'Кошик порожній або сума нульова' }, 400);
  const items = JSON.stringify(validated);

  const np = (b.np && typeof b.np === 'object') ? b.np : {};
  const s = (v, n) => (v == null ? '' : String(v)).slice(0, n || 150);
  const npService = s(np.service, 10), npCityRef = s(np.city_ref), npCityName = s(np.city_name),
        npWhRef = s(np.wh_ref), npWhName = s(np.wh_name, 250),
        npStreet = s(np.street), npHouse = s(np.house, 30), npFlat = s(np.flat, 30);

  // Зберегти замовлення зі статусом «очікує оплати»
  let no = '', dbid = 0;
  try {
    const res = await db.prepare(
      `INSERT INTO orders(created_at,name,phone,address,delivery,comment,items,total,status,payment_method,payment_status,
                          np_service,np_city_ref,np_city_name,np_wh_ref,np_wh_name,np_street,np_house,np_flat)
       VALUES(?,?,?,?,?,?,?,?,'new','liqpay','pending',?,?,?,?,?,?,?,?)`
    ).bind(new Date().toISOString(), name, phone, address, delivery, comment, items, serverTotal,
           npService, npCityRef, npCityName, npWhRef, npWhName, npStreet, npHouse, npFlat).run();
    dbid = (res.meta && res.meta.last_row_id) || 0;
    if (dbid) no = String(1000 + dbid);
  } catch (e) { console.error('[liqpay-init] insert failed:', e && e.message); }
  if (!dbid) return J({ ok: false, error: 'Не вдалося створити замовлення' }, 500);

  const origin = new URL(context.request.url).origin;
  const params = {
    public_key: pub, version: 3, action: 'pay',
    amount: serverTotal, currency: 'UAH',
    description: 'Замовлення №' + no + ' — Агроном',
    order_id: 'agro-' + dbid,
    result_url: origin + '/?paid=' + no,
    server_url: origin + '/api/liqpay-callback'
  };
  const data = b64(JSON.stringify(params));
  const signature = await liqpaySign(priv, data);

  return J({ ok: true, no, data, signature, action: 'https://www.liqpay.ua/api/3/checkout' });
}
