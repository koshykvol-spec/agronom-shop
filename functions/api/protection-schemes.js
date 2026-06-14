// /api/protection-schemes — датасет схем захисту з D1 (app_data, key=protection_schemes).
// Керується в /admin/schemes. Якщо в БД порожньо — 404, споживачі падають на статичний protection_schemes.json.
export async function onRequestGet(context) {
  const db = context.env.DB;
  let row = null;
  try {
    row = await db.prepare(`SELECT json FROM app_data WHERE key='protection_schemes'`).first();
  } catch (e) {}
  if (!row || !row.json) return new Response('{"error":"empty"}', { status: 404, headers: { 'content-type': 'application/json; charset=utf-8' } });
  return new Response(row.json, {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=600' }
  });
}
