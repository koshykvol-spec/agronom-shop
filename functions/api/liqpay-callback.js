// /api/liqpay-callback — server2server callback від LiqPay після оплати.
// ОБОВʼЯЗКОВО перевіряє підпис (інакше хтось підробив би «оплачено»), потім оновлює
// payment_status і шле в Telegram «✅ ОПЛАЧЕНО ОНЛАЙН». LiqPay очікує HTTP 200.
async function liqpaySign(privateKey, data) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(privateKey + data + privateKey));
  let bin = ''; new Uint8Array(buf).forEach(x => bin += String.fromCharCode(x));
  return btoa(bin);
}
function unb64utf8(b64str) {
  const bin = atob(b64str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

export async function onRequestPost(context) {
  const db = context.env.DB;
  let data = '', signature = '';
  try {
    const f = await context.request.formData();
    data = (f.get('data') || '').toString();
    signature = (f.get('signature') || '').toString();
  } catch (e) {}
  if (!data || !signature) return new Response('no data', { status: 400 });

  // Перевірка підпису власним private_key
  let priv = '';
  try { const r = await db.prepare(`SELECT value FROM secrets WHERE key='liqpay_private'`).first(); if (r && r.value) priv = String(r.value); } catch (e) {}
  if (!priv) return new Response('no key', { status: 503 });
  const expected = await liqpaySign(priv, data);
  if (expected !== signature) { console.warn('[liqpay-callback] bad signature'); return new Response('bad signature', { status: 403 }); }

  // Декодуємо payload
  let p = {};
  try { p = JSON.parse(unb64utf8(data)); } catch (e) { return new Response('bad data', { status: 400 }); }
  const orderId = String(p.order_id || '');
  const m = orderId.match(/^agro-(\d+)$/);
  if (!m) return new Response('ok', { status: 200 });   // не наш формат — ігноруємо
  const dbid = parseInt(m[1], 10);
  const status = String(p.status || '');
  const paid = (status === 'success' || status === 'sandbox' || status === 'wait_accept');

  // Оновити статус оплати
  try {
    await db.prepare(`UPDATE orders SET payment_status=? WHERE id=?`).bind(paid ? 'paid' : (status === 'failure' || status === 'error' ? 'failed' : status), dbid).run();
  } catch (e) { console.error('[liqpay-callback] update failed:', e && e.message); }

  // Telegram — лише при успішній оплаті (один раз)
  if (paid) {
    try {
      const o = await db.prepare(`SELECT name,phone,address,delivery,items,total,payment_status FROM orders WHERE id=?`).bind(dbid).first();
      if (o) {
        let itemsText = '';
        try { (JSON.parse(o.items || '[]')).forEach(it => { itemsText += `• ${esc(it.n)} — ${it.q} × ${Number(it.p).toFixed(2)} грн\n`; }); } catch (e) {}
        const no = String(1000 + dbid);
        let msg = `💳 <b>ЗАМОВЛЕННЯ №${no} — ОПЛАЧЕНО ОНЛАЙН ✅</b>\n──────────────────\n${itemsText}──────────────────\n`;
        msg += `💰 Оплачено: <b>${Number(o.total).toFixed(2)} грн</b>\n\n`;
        msg += `👤 Клієнт: ${esc(o.name)}\n📞 Телефон: ${esc(o.phone)}\n📍 Адреса: ${esc(o.address)}\n🚚 Доставка: ${esc(o.delivery)}`;
        let internalKey = '';
        try { const r = await db.prepare(`SELECT value FROM secrets WHERE key='order_internal_key'`).first(); if (r && r.value) internalKey = String(r.value); } catch (e) {}
        const workerUrl = context.env.ORDER_WORKER_URL || 'https://agro-order.ruslanchyk.workers.dev';
        await fetch(workerUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Order-Auth': internalKey }, body: JSON.stringify({ message: msg }) });
      }
    } catch (e) { /* Telegram не критичний — оплата вже зафіксована в D1 */ }
  }

  return new Response('ok', { status: 200 });
}
