// /api/search-config — синоніми та налаштування розумного пошуку з D1 (керуються в /admin/search).
export async function onRequestGet(context) {
  const db = context.env.DB;
  const syn = {}, cfg = {};
  try {
    const s = (await db.prepare(`SELECT term, target FROM search_synonyms`).all()).results || [];
    for (const r of s) if (r.term) syn[r.term] = r.target;
    const c = (await db.prepare(`SELECT key, value FROM search_config`).all()).results || [];
    for (const r of c) cfg[r.key] = r.value;
  } catch (e) { /* таблиць ще немає — повертаємо порожнє */ }
  return new Response(JSON.stringify({ syn, cfg }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' }
  });
}
