// /feed/google.xml — Google Merchant (Shopping) RSS-фід з D1. Кожна фасовка = окремий offer.
function xesc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }

export async function onRequest(context) {
  const db = context.env.DB;
  const origin = new URL(context.request.url).origin;
  const today = new Date().toISOString().slice(0, 10);

  let shopName = 'Агроном';
  try { const s = await db.prepare(`SELECT value FROM site_settings WHERE key='name'`).first(); if (s && s.value) shopName = s.value; } catch (e) {}

  let rows = [];
  try {
    rows = (await db.prepare(
      `SELECT p.pid,p.sku,COALESCE(NULLIF(c.display_name,''),p.name) AS name,p.price,p.category,p.brand,p.in_stock,
              c.slug,c.annotation,c.meta_desc,c.sale_price,c.sale_until,
              (SELECT path FROM product_images i WHERE i.pid=p.pid ORDER BY sort LIMIT 1) AS img
         FROM products p JOIN product_content c ON c.pid=p.pid
        WHERE c.visible=1 AND c.slug IS NOT NULL AND c.slug<>''
        ORDER BY p.category, name`
    ).all()).results || [];
  } catch (e) {}

  const items = [];
  for (const r of rows) {
    if (!r.img) continue;                       // Merchant вимагає зображення — пропускаємо без фото
    if (r.price == null || r.price <= 0) continue;
    const sale = (r.sale_price != null && r.sale_price > 0 && r.sale_price < r.price && (!r.sale_until || r.sale_until >= today)) ? r.sale_price : null;
    const price = (sale != null ? sale : r.price).toFixed(2);
    const imgAbs = encodeURI(String(r.img).startsWith('http') ? r.img : origin + '/' + String(r.img).replace(/^\//, ''));
    const desc = (r.meta_desc || r.annotation || r.name).slice(0, 4000);
    items.push(
      '<item>' +
      '<g:id>' + xesc(r.pid) + '</g:id>' +
      '<title>' + xesc(r.name) + '</title>' +
      '<description>' + xesc(desc) + '</description>' +
      '<link>' + xesc(origin + '/p/' + r.slug) + '</link>' +
      '<g:image_link>' + xesc(imgAbs) + '</g:image_link>' +
      '<g:availability>' + (r.in_stock !== 0 ? 'in_stock' : 'out_of_stock') + '</g:availability>' +
      '<g:price>' + price + ' UAH</g:price>' +
      (r.brand ? '<g:brand>' + xesc(r.brand) + '</g:brand>' : '') +
      '<g:condition>new</g:condition>' +
      '<g:identifier_exists>no</g:identifier_exists>' +
      (r.category ? '<g:product_type>' + xesc(r.category) + '</g:product_type>' : '') +
      '</item>'
    );
  }

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0"><channel>' +
    '<title>' + xesc(shopName) + '</title>' +
    '<link>' + origin + '</link>' +
    '<description>' + xesc(shopName + ' — товарний фід') + '</description>' +
    items.join('') +
    '</channel></rss>\n';

  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
