// POST /admin/reorder — зберегти новий порядок фото товару (drag-and-drop).
// body: pid=<n>&order=<id,id,id...>  (перший id = головне фото)
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  const f = await request.formData();
  const pid = parseInt(f.get('pid'), 10);
  const order = String(f.get('order') || '').split(',').map(x => parseInt(x, 10)).filter(Boolean);
  if (!pid || !order.length) return new Response('bad request', { status: 400 });

  // лише рядки, що належать цьому товару
  const rows = (await db.prepare(`SELECT id FROM product_images WHERE pid=?`).bind(pid).all()).results || [];
  const valid = new Set(rows.map(r => r.id));

  const stmts = [];
  let i = 0;
  for (const id of order) {
    if (valid.has(id)) { stmts.push(db.prepare(`UPDATE product_images SET sort=? WHERE id=? AND pid=?`).bind(i, id, pid)); i++; }
  }
  if (stmts.length) await db.batch(stmts);

  // головне могло змінитись → перерахунок image_ok за наявністю файлу
  const prim = await db.prepare(`SELECT path FROM product_images WHERE pid=? ORDER BY sort, id LIMIT 1`).bind(pid).first();
  let ok = 0;
  if (prim && prim.path) { try { ok = (await env.IMAGES.head(prim.path)) ? 1 : 0; } catch (e) { ok = 1; } }
  await db.prepare(`UPDATE product_content SET image_ok=? WHERE pid=?`).bind(ok, pid).run();

  return new Response('ok', { headers: { 'content-type': 'text/plain' } });
}
