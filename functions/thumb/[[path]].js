// Роздача мініатюр каталогу з R2.
// URL /thumb/IMG_A/foo.webp → ключ мініатюри "thumb/IMG_A/foo.webp".
// Якщо мініатюри ще нема — ВІДКАТ на оригінал "IMG_A/foo.webp", тож відсутні
// мініатюри не ламають каталог (показуємо повне фото до появи thumb).
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response('Method Not Allowed', { status: 405 });

  // прибираємо провідний "/thumb/" → отримуємо оригінальний ключ R2
  const orig = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+thumb\/+/, ''));
  if (!orig) return new Response('Not found', { status: 404 });

  try {
    // ETag для умовного запиту — БЕЗ лапок і без W/ (інакше R2 кидає TypeError)
    let reqEtag = request.headers.get('if-none-match');
    if (reqEtag) reqEtag = reqEtag.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1');

    const cond = reqEtag ? { onlyIf: { etagMatches: reqEtag } } : undefined;

    // 1) пробуємо мініатюру
    let obj = await env.IMAGES.get('thumb/' + orig, cond);
    // якщо мініатюри нема — 2) відкат на оригінал
    if (!obj) obj = await env.IMAGES.get(orig, cond);
    if (!obj) return new Response('Not found', { status: 404 });

    const h = new Headers();
    obj.writeHttpMetadata(h);
    h.set('etag', obj.httpEtag);
    h.set('cache-control', 'public, max-age=31536000, immutable');
    h.set('x-img-source', 'r2-thumb');
    if (!h.get('content-type')) h.set('content-type', 'image/webp');

    if (obj.body == null) return new Response(null, { status: 304, headers: h });
    return new Response(obj.body, { headers: h });
  } catch (e) {
    return new Response('image error', { status: 500 });
  }
}
