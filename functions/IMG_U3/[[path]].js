// Роздача фото з R2 (binding env.IMAGES). Ключ R2 = шлях URL без провідного "/".
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response('Method Not Allowed', { status: 405 });
  const key = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''));
  try {
    // ETag для умовного запиту має бути БЕЗ лапок і без W/ (інакше R2 кидає TypeError)
    let reqEtag = request.headers.get('if-none-match');
    if (reqEtag) reqEtag = reqEtag.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
    const obj = await env.IMAGES.get(key, reqEtag ? { onlyIf: { etagMatches: reqEtag } } : undefined);
    if (!obj) return new Response('Not found', { status: 404 });
    const h = new Headers();
    obj.writeHttpMetadata(h);
    h.set('etag', obj.httpEtag);
    h.set('cache-control', 'public, max-age=31536000, immutable');
    h.set('x-img-source', 'r2');
    if (!h.get('content-type')) h.set('content-type', 'image/webp');
    if (obj.body == null) return new Response(null, { status: 304, headers: h });
    return new Response(obj.body, { headers: h });
  } catch (e) {
    return new Response('image error', { status: 500 });
  }
}
