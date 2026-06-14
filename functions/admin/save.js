// POST /admin/save — зберегти обогащення товару у D1.
import { slugify, baseOf } from './_grouputil.js';
import { replaceProductIngredients } from './_ingredients.js';
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  const f = await request.formData();
  const pid = parseInt(f.get('pid'), 10);
  if (!pid) return new Response('bad pid', { status: 400 });

  // Група фасовок: '__new__' з випадайки → новий слаг із назви+бренду; інакше — обране значення
  let gid = (f.get('group_id') || '').trim();
  if (gid === '__new__') gid = slugify(baseOf(f.get('name') || '') + ' ' + (f.get('brand') || ''));

  const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? null : n; };
  // Діюча речовина: кілька — через + / , / ; → канонічний відсортований набір (порядок не впливає на групування аналогів)
  const normIngredients = s => String(s == null ? '' : s).split(/[+,;]/).map(x => x.trim().toLowerCase()).filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a.localeCompare(b, 'uk')).join(' + ');

  // Поля з 1С (перезапишуться при наступному імпорті — очікувано). SKU редагований (порожнє = лишити старий).
  await db.prepare(`UPDATE products SET sku=COALESCE(NULLIF(?,''), sku), name=?, price=?, category=?, brand=?, in_stock=? WHERE pid=?`)
    .bind((f.get('sku') || '').trim(), f.get('name') || '', num(f.get('price')), f.get('category') || null, f.get('brand') || null, f.get('in_stock') === '1' ? 1 : 0, pid).run();

  // Обогащення + акція + фасадна назва + група фасовок (порожні = NULL)
  await db.prepare(
    `UPDATE product_content SET annotation=?, keywords=?, meta_title=?, meta_desc=?, visible=?, sale_price=?, sale_until=?, display_name=?, group_id=?, variant_label=?, active_ingredient=?, dosage=?, divisible=?, divisor=? WHERE pid=?`
  ).bind(
    f.get('annotation') || '', f.get('keywords') || '',
    f.get('meta_title') || '', f.get('meta_desc') || '',
    f.get('visible') === '1' ? 1 : 0,
    num(f.get('sale_price')), (f.get('sale_until') || '').trim() || null,
    (f.get('display_name') || '').trim() || null,
    gid || null, (f.get('variant_label') || '').trim() || null,
    '', (f.get('dosage') || '').trim(),        // active_ingredient перезапишеться нижче з junction
    f.get('divisible') === '1' ? 1 : 0,
    num(f.get('divisor')),
    pid
  ).run();

  // Діючі речовини — реляційно: replaceProductIngredients пише звʼязку product_ingredients
  // + перебудовує похідний текст active_ingredient (для «Аналогів» і пошуку).
  await replaceProductIngredients(db, pid, (f.get('ingredient_ids') || '').split(','));

  // Фото керуються окремо (/admin/upload, ?imgdel, ?imgprimary) — тут не чіпаємо.

  const u = new URLSearchParams({ pid: String(pid) });
  for (const k of ['cat', 'q', 'noa', 'noimg', 'dup', 'badsku', 'ps', 'page']) { const v = f.get(k); if (v) u.set(k, v); }
  return Response.redirect(new URL('/admin?' + u.toString(), request.url).toString(), 303);
}
