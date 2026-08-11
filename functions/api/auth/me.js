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
    return J({ ok: true, customer: { id: row.id, name: row.name, avatar: row.avatar_url, email: row.email, phone: row.phone } });
  } catch (e) { return J({ ok: true, customer: null }); }
}
