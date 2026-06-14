// /api/order — єдина точка входу замовлення:
//   1) перевіряє Turnstile (анти-спам), 2) зберігає в D1 із серверною валідацією суми,
//   3) пересилає в Telegram через воркер довіреним каналом (X-Order-Auth = secrets.order_internal_key).
const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json; charset=utf-8' } });

export async function onRequestPost(context) {
  const db = context.env.DB;
  let b = {};
  try { b = await context.request.json(); } catch (e) {}

  // ── Turnstile: секрет із D1; якщо заданий — токен обовʼязковий ──
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
  // Серверна валідація суми: ціни беремо з D1 за pid; клієнтським total/p НЕ довіряємо
  // (інакше підмінений total потрапив би в накладений платіж ТТН).
  const today = new Date().toISOString().slice(0, 10);
  const rawItems = Array.isArray(b.items) ? b.items.slice(0, 200) : [];
  const clientTotal = Number(b.total) || 0;
  let serverTotal = 0; const validated = [];
  for (const it of rawItems) {
    const pid = parseInt(it && it.pid, 10);
    const qty = Number(it && it.q) || 0;
    let price = Number(it && it.p) || 0;   // fallback лише для legacy-позицій без pid
    if (pid) {
      price = 0;                           // невідомий pid → 0 (не довіряємо клієнтській ціні)
      try {
        const row = await db.prepare(`SELECT p.price AS pr, c.sale_price AS sp, c.sale_until AS su FROM products p JOIN product_content c ON c.pid=p.pid WHERE p.pid=?`).bind(pid).first();
        if (row) {
          const sale = (row.sp != null && row.sp > 0 && row.sp < row.pr && (!row.su || row.su >= today)) ? row.sp : null;
          price = Number(sale != null ? sale : row.pr) || 0;
        }
      } catch (e) {}
    }
    serverTotal += price * qty;
    validated.push({ n: (it && it.n) || '', p: price, q: qty, pid: pid || null });
  }
  serverTotal = Math.round(serverTotal * 100) / 100;
  if (clientTotal && Math.abs(clientTotal - serverTotal) > 0.5) console.warn('[order] total mismatch: client', clientTotal, 'server', serverTotal);
  const total = serverTotal;                 // у БД і в ТТН — серверна сума
  const items = JSON.stringify(validated);
  // Структуровані дані НП (для авто-ТТН)
  const np = (b.np && typeof b.np === 'object') ? b.np : {};
  const s = (v, n) => (v == null ? '' : String(v)).slice(0, n || 150);
  const npService = s(np.service, 10), npCityRef = s(np.city_ref), npCityName = s(np.city_name),
        npWhRef = s(np.wh_ref), npWhName = s(np.wh_name, 250),
        npStreet = s(np.street), npHouse = s(np.house, 30), npFlat = s(np.flat, 30);

  let no = '';
  try {
    const res = await db.prepare(
      `INSERT INTO orders(created_at,name,phone,address,delivery,comment,items,total,status,
                          np_service,np_city_ref,np_city_name,np_wh_ref,np_wh_name,np_street,np_house,np_flat)
       VALUES(?,?,?,?,?,?,?,?,'new',?,?,?,?,?,?,?,?)`
    ).bind(new Date().toISOString(), name, phone, address, delivery, comment, items, total,
           npService, npCityRef, npCityName, npWhRef, npWhName, npStreet, npHouse, npFlat).run();
    const id = res.meta && res.meta.last_row_id;
    if (id) no = String(1000 + id);   // людиніший номер (1001, 1002, …)
  } catch (e) { console.error('[order] D1 insert failed:', e && e.message, '| body:', JSON.stringify({ name, phone, total })); }

  // ── Переслати в Telegram через воркер (довірений канал) ──
  let tg = false;
  try {
    const message = (b.message || '').toString().slice(0, 5000);
    if (message) {
      let internalKey = '';
      try { const r = await db.prepare(`SELECT value FROM secrets WHERE key='order_internal_key'`).first(); if (r && r.value) internalKey = String(r.value); } catch (e) {}
      const workerUrl = context.env.ORDER_WORKER_URL || 'https://agro-order.ruslanchyk.workers.dev';
      const msg = no ? message.replace('🛒 <b>НОВЕ ЗАМОВЛЕННЯ</b>', '🛒 <b>НОВЕ ЗАМОВЛЕННЯ №' + no + '</b>') : message;
      const wr = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Order-Auth': internalKey },
        body: JSON.stringify({ message: msg })
      });
      const wd = await wr.json().catch(() => ({}));
      tg = !!(wr.ok && wd.ok);
    }
  } catch (e) { /* Telegram не критичний — замовлення вже в D1 (/admin/orders) */ }

  return J({ ok: true, no, tg });
}
