// Мінімальний розбір HTML без залежностей — лише те, що потрібно для SEO-перевірок.
// Працює над «сирим» HTML (тим, що бачить Googlebot ДО виконання JS).

export function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** HTML без <script>/<style>/коментарів — щоб рядки в JS не рахувалися тегами. */
export function stripNonMarkup(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '');
}

function parseAttrs(tag) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  const inner = tag.replace(/^<[a-zA-Z0-9]+/, '').replace(/\/?>$/, '');
  let m;
  while ((m = re.exec(inner))) {
    const v = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[m[1].toLowerCase()] = decodeEntities(v);
  }
  return attrs;
}

/** Усі теги name (void/відкриваючі) як {attrs, raw}. */
export function findTags(html, name) {
  const re = new RegExp(`<${name}\\b[^>]*>`, 'gi');
  return (stripNonMarkup(html).match(re) || []).map(raw => ({ raw, attrs: parseAttrs(raw) }));
}

export function metaContent(html, key, by = 'name') {
  const hits = findTags(html, 'meta').filter(t => (t.attrs[by] || '').toLowerCase() === key.toLowerCase());
  return hits.map(t => t.attrs.content ?? '');
}

export function linkHrefs(html, rel) {
  return findTags(html, 'link')
    .filter(t => (t.attrs.rel || '').toLowerCase().split(/\s+/).includes(rel))
    .map(t => t.attrs.href ?? '');
}

export function titles(html) {
  const out = [];
  const re = /<title\b[^>]*>([\s\S]*?)<\/title>/gi;
  let m;
  const src = stripNonMarkup(html);
  while ((m = re.exec(src))) out.push(decodeEntities(m[1]).trim());
  return out;
}

export function h1s(html) {
  const out = [];
  const re = /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi;
  let m;
  const src = stripNonMarkup(html);
  while ((m = re.exec(src))) out.push(decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim());
  return out;
}

export function htmlLang(html) {
  const m = /<html\b[^>]*>/i.exec(html);
  return m ? (parseAttrs(m[0]).lang || '') : '';
}

/** JSON-LD блоки → розібрані об'єкти. Невалідний JSON кидає помилку з номером блоку. */
export function jsonLd(html) {
  const out = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m, i = 0;
  while ((m = re.exec(html))) {
    i++;
    try { out.push(JSON.parse(m[1])); }
    catch (e) { throw new Error(`JSON-LD блок #${i} — невалідний JSON: ${e.message}`); }
  }
  return out;
}

/** Рекурсивно шукає шляхи до null/undefined/порожніх рядків у структурі (GSC трактує їх як недійсні значення). */
export function findEmptyValues(obj, path = '$') {
  const bad = [];
  if (obj === null || obj === undefined) { bad.push(path); return bad; }
  if (typeof obj === 'string' && obj.trim() === '') { bad.push(path); return bad; }
  if (Array.isArray(obj)) obj.forEach((v, i) => bad.push(...findEmptyValues(v, `${path}[${i}]`)));
  else if (typeof obj === 'object') for (const [k, v] of Object.entries(obj)) bad.push(...findEmptyValues(v, `${path}.${k}`));
  return bad;
}

/** Внутрішні посилання <a href> (без якорів, tel:, mailto:, javascript:). */
export function anchorHrefs(html) {
  return findTags(html, 'a').map(t => t.attrs.href).filter(h => h && !/^(#|tel:|mailto:|javascript:|viber:|https?:\/\/(?!agronom\.pp\.ua))/i.test(h));
}

/** «Відбиток» сторінки для порівняння з baseline. */
export function fingerprint(html) {
  let ld = [];
  try { ld = jsonLd(html).map(o => o['@type'] || (o['@graph'] ? '@graph' : '?')).sort(); } catch { ld = ['INVALID_JSON_LD']; }
  const robots = metaContent(html, 'robots')[0] || '';
  return {
    title: titles(html)[0] ?? null,
    description: metaContent(html, 'description')[0] ?? null,
    canonical: linkHrefs(html, 'canonical')[0] ?? null,
    robots,
    h1: h1s(html)[0] ?? null,
    h1Count: h1s(html).length,
    ogTitle: metaContent(html, 'og:title', 'property')[0] ?? null,
    ogImage: metaContent(html, 'og:image', 'property')[0] ?? null,
    jsonLdTypes: ld,
  };
}
