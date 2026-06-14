// /api/recipes — чипи «Що вас цікавить?» з D1 (керуються в /admin/recipes).
// Формат сумісний зі старим recipes.json: [{id,title,keywords:[...],type}].
export async function onRequestGet(context) {
  const db = context.env.DB;
  let rows = [];
  try {
    rows = (await db.prepare(
      `SELECT id,title,keywords,type,scheme_url,scheme_url_syngenta FROM recipes WHERE visible=1 ORDER BY sort, id`
    ).all()).results || [];
  } catch (e) {
    return new Response('[]', { headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
  const out = rows.map(r => ({
    id: r.id,
    title: r.title,
    type: r.type,
    keywords: String(r.keywords || '').split(',').map(s => s.trim()).filter(Boolean),
    scheme_url: r.scheme_url || '',
    scheme_url_syngenta: r.scheme_url_syngenta || ''
  }));
  return new Response(JSON.stringify(out), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300'
    }
  });
}
