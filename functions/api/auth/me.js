// GET /api/auth/me — повертає {ok:true, customer:{...}} якщо є валідна сесія, інакше {ok:true, customer:null}.
import { getCustomerIdFromRequest } from '../../_lib/session.js';

const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json; charset=utf-8' } });

export async function onRequestGet(context) {
  const db = context.env.DB;
  const customerId = await getCustomerIdFromRequest(context.env, context.request);
  if (!customerId) return J({ ok: true, customer: null });

  try {
    const row = await db.prepare(`SELECT id, name, avatar_url, email, phone FROM customers WHERE id=?`).bind(customerId).first();
    if (!row) return J({ ok: true, customer: null });
    // Останнє замовлення цього клієнта — щоб форму замовлення можна було підставити
    // реальними ПІБ/телефоном, якими він уже колись оформлявся (не завжди збігається
    // з іменем із Telegram/Google, тому окремо, а не з customers.name).
    let lastOrder = null;
    try {
      lastOrder = await db.prepare(`SELECT name, phone FROM orders WHERE customer_id=? ORDER BY id DESC LIMIT 1`).bind(customerId).first();
    } catch (e) {}
    return J({
      ok: true,
      customer: {
        id: row.id, name: row.name, avatar: row.avatar_url, email: row.email, phone: row.phone,
        lastOrderName: lastOrder ? lastOrder.name : null,
        lastOrderPhone: lastOrder ? lastOrder.phone : null
      }
    });
  } catch (e) { return J({ ok: true, customer: null }); }
}
