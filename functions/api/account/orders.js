// GET /api/account/orders — список замовлень поточного клієнта (тільки ті, що були зроблені
// вже після впровадження акаунтів, поки людина була залогінена — старі заднім числом не підтягуються).
import { getCustomerIdFromRequest } from '../../_lib/session.js';

const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json; charset=utf-8' } });

export async function onRequestGet(context) {
  const db = context.env.DB;
  const customerId = await getCustomerIdFromRequest(context.env, context.request);
  if (!customerId) return J({ ok: false, error: 'not logged in' }, 401);

  try {
    const rows = (await db.prepare(
      `SELECT id, created_at, items, total, status FROM orders WHERE customer_id=? ORDER BY id DESC LIMIT 100`
    ).bind(customerId).all()).results || [];
    const orders = rows.map(r => {
      let items = [];
      try { items = JSON.parse(r.items || '[]'); } catch (e) {}
      return { no: String(1000 + r.id), created_at: r.created_at, items, total: r.total, status: r.status };
    });
    return J({ ok: true, orders });
  } catch (e) { return J({ ok: false, error: 'db error' }, 500); }
}
