// /api/seasonal — культури сезонного помічника з D1 (керуються в /admin/seasonal).
// Формат: [{id:grp, label:grp_label, cultures:[{id,label,schemeCategory,schemeId}]}]
export async function onRequestGet(context) {
  const db = context.env.DB;
  let rows = [];
  try {
    rows = (await db.prepare(
      `SELECT id,grp,grp_label,label,scheme_category,scheme_id FROM seasonal_cultures ORDER BY sort, id`
    ).all()).results || [];
  } catch (e) {
    return new Response('[]', { headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
  const groups = [];
  const byGrp = {};
  for (const r of rows) {
    if (!byGrp[r.grp]) { byGrp[r.grp] = { id: r.grp, label: r.grp_label, cultures: [] }; groups.push(byGrp[r.grp]); }
    byGrp[r.grp].cultures.push({ id: r.id, label: r.label, schemeCategory: r.scheme_category, schemeId: r.scheme_id });
  }
  return new Response(JSON.stringify(groups), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' }
  });
}
