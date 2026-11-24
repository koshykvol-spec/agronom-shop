// POST /admin/imgreplace — замінити файл існуючого фото (після редагування в браузері): id, photo [, thumb].
// Нове фото кладеться під НОВИЙ ключ (щоб не залежати від кешу CDN/браузера), рядок product_images
// зберігає позицію (sort) і id — головне лишається головним. Старий файл (+thumb/) видаляється з R2,
// якщо на нього більше ніхто не посилається.
const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png' };

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  const f = await request.formData();
  const id = parseInt(f.get('id'), 10);
  if (!id) return new Response('bad id', { status: 400 });
  const file = f.get('photo');
  if (!file || typeof file === 'string' || !file.size) return new Response('Немає файлу', { status: 400 });
  const type = (file.type || '').toLowerCase();
  if (!EXT[type]) return new Response('Лише webp/jpg/png', { status: 400 });
  if (file.size > 12 * 1024 * 1024) return new Response('Файл завеликий (макс 12 МБ)', { status: 413 });

  const row = await db.prepare(`SELECT id, pid, path FROM product_images WHERE id=?`).bind(id).first();
  if (!row) return new Response('Фото не знайдено', { status: 404 });

  const key = 'up/' + row.pid + '-' + Date.now() + '-' + crypto.randomUUID().slice(0, 8) + '.' + EXT[type];
  await env.IMAGES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: type } });
  const thumb = f.get('thumb');
  if (thumb && typeof thumb !== 'string' && thumb.size) {
    try { await env.IMAGES.put('thumb/' + key, await thumb.arrayBuffer(), { httpMetadata: { contentType: 'image/webp' } }); } catch (e) {}
  }

  await db.prepare(`UPDATE product_images SET path=? WHERE id=?`).bind(key, id).run();

  // старий файл — лише якщо він більше ніде не використовується
  if (row.path && row.path !== key) {
    const other = await db.prepare(`SELECT COUNT(*) n FROM product_images WHERE path=? AND id<>?`).bind(row.path, id).first();
    if (((other && other.n) | 0) === 0) {
      try { await env.IMAGES.delete(row.path); } catch (e) {}
      try { await env.IMAGES.delete('thumb/' + row.path); } catch (e) {}
    }
  }
  await db.prepare(`UPDATE product_content SET image_ok=1 WHERE pid=?`).bind(row.pid).run();

  return Response.redirect(new URL('/admin?pid=' + row.pid, request.url).toString(), 303);
}
