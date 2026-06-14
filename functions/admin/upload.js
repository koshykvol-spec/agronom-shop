// POST /admin/upload — завантажити фото в R2 і додати рядок product_images.
const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' };

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  const f = await request.formData();
  const pid = parseInt(f.get('pid'), 10);

  // куди повертатись (зберігаємо фільтри списку)
  const u = new URLSearchParams({ pid: String(pid || '') });
  for (const k of ['cat', 'q', 'noa', 'noimg', 'dup', 'badsku', 'ps', 'page']) { const v = f.get(k); if (v) u.set(k, v); }
  const back = new URL('/admin?' + u.toString(), request.url).toString();

  if (!pid) return new Response('bad pid', { status: 400 });
  const file = f.get('photo');
  if (!file || typeof file === 'string' || !file.size) return Response.redirect(back, 303);

  const type = (file.type || '').toLowerCase();
  if (!type.startsWith('image/')) return new Response('Лише зображення', { status: 400 });
  if (file.size > 12 * 1024 * 1024) return new Response('Файл завеликий (макс 12 МБ)', { status: 413 });

  let ext = EXT[type];
  if (!ext) { const m = /\.([a-z0-9]{2,5})$/i.exec(file.name || ''); ext = m ? m[1].toLowerCase() : 'webp'; }

  const key = 'up/' + pid + '-' + Date.now() + '-' + crypto.randomUUID().slice(0, 8) + '.' + ext;
  const buf = await file.arrayBuffer();
  await env.IMAGES.put(key, buf, { httpMetadata: { contentType: type } });

  // Мініатюра каталогу (клієнт згенерував ≤400px webp) → thumb/<той самий ключ>.
  // Роздає functions/thumb/[[path]].js; якщо нема — відкат на оригінал. Збій тут не критичний.
  const thumb = f.get('thumb');
  if (thumb && typeof thumb !== 'string' && thumb.size) {
    try { await env.IMAGES.put('thumb/' + key, await thumb.arrayBuffer(), { httpMetadata: { contentType: 'image/webp' } }); } catch (e) {}
  }

  const mx = await db.prepare(`SELECT COALESCE(MAX(sort), -1) m FROM product_images WHERE pid=?`).bind(pid).first();
  await db.prepare(`INSERT INTO product_images(pid, path, sort) VALUES(?,?,?)`).bind(pid, key, ((mx && mx.m) | 0) + 1).run();
  // фото є фізично в R2 → ознака «є фото»
  await db.prepare(`UPDATE product_content SET image_ok=1 WHERE pid=?`).bind(pid).run();

  return Response.redirect(back, 303);
}
