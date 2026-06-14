// /admin/ingredients — довідник діючих речовин (CRUD). Звʼязка product_ingredients — M:N.
import { rebuildText } from './_ingredients.js';
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

const PAGE = (body)=>`<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex,nofollow">
<title>Діючі речовини</title><style>
body{font-family:system-ui;max-width:720px;margin:1.2rem auto;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2{color:#2d6a2d} .btn{background:#2d6a2d;color:#fff;border:0;padding:8px 13px;border-radius:8px;cursor:pointer;font-weight:700;text-decoration:none;display:inline-block}
.btn.gray{background:#777} .muted{color:#888;font-size:.85rem}
input{padding:7px 9px;border:1px solid #c8e0c8;border-radius:8px;font:inherit}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;margin-top:10px}
td,th{padding:7px 10px;border-bottom:1px solid #eee;text-align:left;font-size:.9rem;vertical-align:middle}
form.inline{display:inline-flex;gap:6px;align-items:center;margin:0}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body><div><a href="/admin">← до адмінки</a></div>${body}</body></html>`;

export async function onRequestGet(context){
  const db = context.env.DB;
  const url = new URL(context.request.url);

  // видалити (звʼязка cascade) + перебудувати похідний текст у зачеплених товарів
  const del = url.searchParams.get('del');
  if (del){
    const id = parseInt(del, 10);
    const affected = ((await db.prepare(`SELECT pid FROM product_ingredients WHERE ingredient_id=?`).bind(id).all()).results || []).map(r => r.pid);
    await db.prepare(`DELETE FROM active_ingredients WHERE id=?`).bind(id).run();   // ON DELETE CASCADE прибере звʼязки
    for (const pid of affected) await rebuildText(db, pid);
    return Response.redirect(new URL('/admin/ingredients', context.request.url).toString(), 303);
  }

  const rows = (await db.prepare(
    `SELECT a.id, a.name, (SELECT COUNT(*) FROM product_ingredients pi WHERE pi.ingredient_id=a.id) cnt
       FROM active_ingredients a ORDER BY a.name COLLATE NOCASE`).all()).results || [];

  const list = rows.map(r => `<tr>
    <td><form class="inline" method="POST" action="/admin/ingredients">
      <input type="hidden" name="op" value="rename"><input type="hidden" name="id" value="${r.id}">
      <input name="name" value="${esc(r.name)}" style="min-width:200px">
      <button class="btn gray" type="submit" style="padding:5px 10px">перейменувати</button>
    </form></td>
    <td class="muted">${r.cnt} товар(ів)</td>
    <td><a href="/admin/ingredients?del=${r.id}" onclick="return confirm('Видалити «${esc(r.name)}»? Звʼязки з ${r.cnt} товар(ами) теж зникнуть.')" style="color:#c0392b">🗑</a></td>
  </tr>`).join('');

  const body = `<h2>🧪 Довідник діючих речовин (${rows.length})</h2>
    <p class="muted">Керований список. У формі товару діючі речовини обираються звідси (кілька), а не вписуються текстом. Видалення прибирає речовину й усі її звʼязки з товарами.</p>
    <form method="POST" action="/admin/ingredients" style="margin:10px 0;display:flex;gap:8px">
      <input type="hidden" name="op" value="add">
      <input name="name" placeholder="нова діюча речовина (напр. гліфосат)" style="flex:1" required>
      <button class="btn" type="submit">➕ Додати</button>
    </form>
    ${rows.length ? `<table><tr><th>Назва</th><th>Вжито</th><th></th></tr>${list}</table>` : '<p>Поки порожньо.</p>'}`;
  return new Response(PAGE(body), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function onRequestPost(context){
  const db = context.env.DB;
  const f = await context.request.formData();
  const op = f.get('op');
  const name = (f.get('name') || '').trim();

  if (op === 'add' && name){
    await db.prepare(`INSERT OR IGNORE INTO active_ingredients(name) VALUES(?)`).bind(name).run();
  } else if (op === 'rename'){
    const id = parseInt(f.get('id'), 10);
    if (id && name){
      await db.prepare(`UPDATE active_ingredients SET name=? WHERE id=?`).bind(name, id).run();
      // звʼязка id-based не ламається; оновлюємо похідний текст зачеплених товарів
      const affected = ((await db.prepare(`SELECT pid FROM product_ingredients WHERE ingredient_id=?`).bind(id).all()).results || []).map(r => r.pid);
      for (const pid of affected) await rebuildText(db, pid);
    }
  }
  return Response.redirect(new URL('/admin/ingredients', context.request.url).toString(), 303);
}
