// /api/page?slug=delivery — тіло інфо-сторінки з D1 (керується в /admin/pages).
export async function onRequestGet(context) {
  const db = context.env.DB;
  const slug = (new URL(context.request.url).searchParams.get('slug') || '').trim();
  if (!slug) return new Response(JSON.stringify({ error: 'no slug' }), { status: 400, headers: { 'content-type': 'application/json; charset=utf-8' } });
  let row = null;
  try {
    row = await db.prepare(`SELECT slug,title,meta_desc,body_html,updated_at FROM pages WHERE slug=?`).bind(slug).first();
  } catch (e) {}
  if (!row) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'content-type': 'application/json; charset=utf-8' } });
  return new Response(JSON.stringify(row), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=600, stale-while-revalidate=86400'
    }
  });
}
