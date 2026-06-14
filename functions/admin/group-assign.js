// POST /admin/group-assign — призначити товари до групи фасовок.
// Використовується: списком товарів (мультивибір, B) і кнопкою «+ додати» в /admin/groups (C).
// Параметри: gid (наявний group_id | '__new__' | порожньо=нова), pid[] (обрані), q (пошук ungrouped для C), back (куди вернутись).
import { slugify, baseOf, variantOf } from './_grouputil.js';

export async function onRequestPost(context){
  const db = context.env.DB;
  const f = await context.request.formData();
  let gid = (f.get('gid') || '').trim();
  const pidset = new Set(f.getAll('pid').map(x => parseInt(x, 10)).filter(Number.isFinite));
  const q = (f.get('q') || '').trim();
  const back = f.get('back') || context.request.headers.get('Referer') || '/admin/groups';
  const redirect = () => Response.redirect(new URL(back, context.request.url).toString(), 303);

  // C: пошук ungrouped-товару за SKU/назвою → додаємо до набору
  if (q) {
    let row = await db.prepare(`SELECT p.pid FROM products p JOIN product_content c ON c.pid=p.pid
       WHERE (p.sku=? OR p.name=?) AND (c.group_id IS NULL OR c.group_id='')`).bind(q, q).first();
    if (!row) row = await db.prepare(`SELECT p.pid FROM products p JOIN product_content c ON c.pid=p.pid
       WHERE p.name LIKE ? AND (c.group_id IS NULL OR c.group_id='') ORDER BY length(p.name) LIMIT 1`).bind('%' + q + '%').first();
    if (row) pidset.add(row.pid);
  }

  const pids = [...pidset];
  if (!pids.length) return redirect();

  // назви/бренд/наявний variant для всіх обраних
  const ph = pids.map(() => '?').join(',');
  const info = (await db.prepare(`SELECT p.pid, p.name, p.brand, c.variant_label vl
     FROM products p JOIN product_content c ON c.pid=p.pid WHERE p.pid IN (${ph})`).bind(...pids).all()).results || [];
  const byId = new Map(info.map(r => [r.pid, r]));

  // нова група → слаг із базової назви першого товару + бренд
  if (gid === '__new__' || !gid) {
    const f0 = byId.get(pids[0]) || {};
    gid = slugify(baseOf(f0.name || '') + ' ' + (f0.brand || ''));
  }

  const stmts = [];
  for (const pid of pids) {
    const r = byId.get(pid) || {};
    const vl = (r.vl && String(r.vl).trim()) || variantOf(r.name || '') || null;  // не затираємо вже заданий розмір
    stmts.push(db.prepare(`UPDATE product_content SET group_id=?, variant_label=? WHERE pid=?`).bind(gid, vl, pid));
  }
  for (let i = 0; i < stmts.length; i += 60) await db.batch(stmts.slice(i, i + 60));
  return redirect();
}
