// /api/categories — категорії каталогу з D1 (керуються в /admin/categories).
// Споживають: app.js (нав/мапи/іконки/схеми) і category.html (SEO заголовки).
export async function onRequestGet(context) {
  const db = context.env.DB;
  let rows = [];
  try {
    rows = (await db.prepare(
      `SELECT key,db_name,nav_label,icon,sort,has_sub,sub_all_label,show_schemes,seo_title,h1,seo_desc,placeholder
       FROM categories ORDER BY sort, nav_label`
    ).all()).results || [];
  } catch (e) {
    return new Response(JSON.stringify({ cats: [] }), { headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
  return new Response(JSON.stringify({ cats: rows }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300'
    }
  });
}
