// /feed/prom.xml — YML-фід (Prom.ua / Rozetka) з D1. Кожна фасовка = окремий offer.
function xesc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }

export async function onRequest(context) {
  const db = context.env.DB;
  const origin = new URL(context.request.url).origin;
  const today = new Date().toISOString().slice(0, 10);

  const cfg = {};
  try { for (const s of (await db.prepare(`SELECT key,value FROM site_settings WHERE key IN ('name','phoneIntl')`).all()).results || []) cfg[s.key] = s.value; } catch (e) {}
  const shopName = cfg.name || 'Агроном';

  // Категорії → числові id (за sort з таблиці categories)
  const catId = {}; const catList = [];
  try {
    let i = 1;
    for (const c of (await db.prepare(`SELECT db_name,nav_label FROM categories ORDER BY sort`).all()).results || []) {
      catId[c.db_name] = i; catList.push({ id: i, name: c.nav_label || c.db_name }); i++;
    }
  } catch (e) {}

  let rows = [];
  try {
    rows = (await db.prepare(
      `SELECT p.pid,COALESCE(NULLIF(c.display_name,''),p.name) AS name,p.price,p.category,p.brand,p.in_stock,
              c.slug,c.annotation,c.meta_desc,c.sale_price,c.sale_until,
              (SELECT path FROM product_images i WHERE i.pid=p.pid ORDER BY sort LIMIT 1) AS img
         FROM products p JOIN product_content c ON c.pid=p.pid
        WHERE c.visible=1 AND c.slug IS NOT NULL AND c.slug<>''
        ORDER BY p.category, name`
    ).all()).results || [];
  } catch (e) {}

  const offers = [];
  for (const r of rows) {
    if (r.price == null || r.price <= 0) continue;
    const sale = (r.sale_price != null && r.sale_price > 0 && r.sale_price < r.price && (!r.sale_until || r.sale_until >= today)) ? r.sale_price : null;
    const price = (sale != null ? sale : r.price);
    const imgAbs = r.img ? encodeURI(String(r.img).startsWith('http') ? r.img : origin + '/' + String(r.img).replace(/^\//, '')) : '';
    const desc = (r.meta_desc || r.annotation || r.name);
    offers.push(
      '<offer id="' + xesc(r.pid) + '" available="' + (r.in_stock !== 0 ? 'true' : 'false') + '">' +
      '<url>' + xesc(origin + '/p/' + r.slug) + '</url>' +
      '<price>' + price + '</price><currencyId>UAH</currencyId>' +
      '<categoryId>' + (catId[r.category] || 0) + '</categoryId>' +
      (imgAbs ? '<picture>' + xesc(imgAbs) + '</picture>' : '') +
      '<name>' + xesc(r.name) + '</name>' +
      (r.brand ? '<vendor>' + xesc(r.brand) + '</vendor>' : '') +
      '<description>' + xesc(desc) + '</description>' +
      '</offer>'
    );
  }

  const cats = catList.map(c => '<category id="' + c.id + '">' + xesc(c.name) + '</category>').join('');
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<yml_catalog date="' + today + '"><shop>' +
    '<name>' + xesc(shopName) + '</name><company>' + xesc(shopName) + '</company><url>' + origin + '</url>' +
    '<currencies><currency id="UAH" rate="1"/></currencies>' +
    '<categories>' + cats + '</categories>' +
    '<offers>' + offers.join('') + '</offers>' +
    '</shop></yml_catalog>\n';

  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
