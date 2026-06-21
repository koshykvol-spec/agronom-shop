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

    <details style="margin:12px 0;border:1px solid #d4e8d4;border-radius:10px;background:#fafcf8;padding:10px 14px">
      <summary style="cursor:pointer;font-weight:700;color:#2d6a2d">📥 Масове додавання речовин</summary>
      <p class="muted" style="margin:8px 0 4px">Одна речовина на рядок (або через кому). Дублікати ігноруються.</p>

      <div style="background:#eef5ee;border:1px solid #c8e0c8;border-radius:8px;padding:10px;margin-bottom:10px">
        <b>⚡ Синхронізувати з товарів</b>
        <p class="muted" style="margin:4px 0 8px">Витягує всі унікальні значення поля «Діюча речовина» з карток товарів і додає їх до довідника. Запускай після масового заповнення через /admin/aifill.</p>
        <button class="btn" onclick="syncFromProducts()">🔄 Синхронізувати</button>
        <span id="sync-s" class="muted" style="margin-left:8px"></span>
        <div id="sync-out" style="margin-top:8px;font-size:.88rem"></div>
      </div>

      <textarea id="bulk-ta" style="min-height:100px;width:100%;box-sizing:border-box;border:1.5px solid #c8e0c8;border-radius:8px;padding:8px;font:inherit;font-size:.9rem" placeholder="імідаклоприд&#10;лямбда-цигалотрин&#10;гліфосат, малатіон, хлорпірифос"></textarea>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
        <button class="btn" onclick="bulkAdd()">➕ Додати всі</button>
        <span id="bulk-s" class="muted"></span>
      </div>
      <div id="bulk-out" style="margin-top:8px;font-size:.88rem"></div>
    </details>

    <script>
    async function syncFromProducts(){
      document.getElementById('sync-s').textContent='синхронізую…';
      var r=await fetch('/admin/ingredients',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'op=sync'});
      var d=await r.json().catch(function(){return{ok:false,error:'помилка'};});
      document.getElementById('sync-s').textContent='';
      if(!d.ok){document.getElementById('sync-out').innerHTML='<span style="color:#c0392b">❌ '+d.error+'</span>';return;}
      document.getElementById('sync-out').innerHTML='✅ Додано нових: <b>'+d.added+'</b>, вже існували: <b>'+d.skipped+'</b>'+(d.examples?'<br><span class="muted">Приклади нових: '+d.examples+'</span>':'');
      if(d.added>0) setTimeout(function(){location.reload();},1200);
    }
    async function bulkAdd(){
      var raw=document.getElementById('bulk-ta').value.trim();
      if(!raw){alert('Введіть назви речовин');return;}
      document.getElementById('bulk-s').textContent='додаю…';
      var r=await fetch('/admin/ingredients',{method:'POST',headers:{'content-type':'text/plain'},body:raw});
      var d=await r.json().catch(function(){return{ok:false,error:'помилка'};});
      document.getElementById('bulk-s').textContent='';
      if(!d.ok){document.getElementById('bulk-out').innerHTML='<span style="color:#c0392b">❌ '+d.error+'</span>';return;}
      document.getElementById('bulk-out').innerHTML='✅ Додано: <b>'+d.added+'</b>, вже існували: <b>'+d.skipped+'</b>';
      if(d.added>0) setTimeout(function(){location.reload();},800);
    }
    </script>

    ${rows.length ? `<table><tr><th>Назва</th><th>Вжито</th><th></th></tr>${list}</table>` : '<p>Поки порожньо.</p>'}`;
  return new Response(PAGE(body), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function onRequestPost(context){
  const db = context.env.DB;
  const ct = (context.request.headers.get('content-type') || '').toLowerCase();

  // Масовий імпорт — plain text (одна речовина на рядок або через кому)
  if (ct.includes('text/plain')) {
    const raw = await context.request.text();
    const names = raw
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(s => s && !s.includes('"') && !s.includes(':') && !s.startsWith('{') && !s.startsWith('[') && s.length <= 120);
    if (!names.length) return new Response(JSON.stringify({ ok: false, error: 'Порожньо' }), { headers: { 'content-type': 'application/json' } });
    let added = 0, skipped = 0;
    for (const name of names) {
      const existing = await db.prepare(`SELECT id FROM active_ingredients WHERE name=? COLLATE NOCASE`).bind(name).first();
      if (existing) { skipped++; continue; }
      await db.prepare(`INSERT INTO active_ingredients(name) VALUES(?)`).bind(name).run();
      added++;
    }
    return new Response(JSON.stringify({ ok: true, added, skipped }), { headers: { 'content-type': 'application/json' } });
  }

  // Звичайний form POST (add / rename)
  const f = await context.request.formData();
  const op = f.get('op');
  const name = (f.get('name') || '').trim();

  if (op === 'sync') {
    // Витягуємо всі унікальні active_ingredient з product_content
    // Поле може містити кілька речовин через " + " або ", " — розбиваємо
    const src = (await db.prepare(
      `SELECT DISTINCT active_ingredient FROM product_content
       WHERE active_ingredient IS NOT NULL AND active_ingredient != ''`
    ).all()).results || [];
    const existing = new Set(
      ((await db.prepare(`SELECT name FROM active_ingredients`).all()).results || [])
        .map(r => r.name.trim().toLowerCase())
    );
    let added = 0, skipped = 0;
    const examples = [];
    for (const row of src) {
      // розбиваємо "речовина1 + речовина2, речовина3"
      const parts = row.active_ingredient.split(/\s*[+,;]\s*/).map(s => s.trim()).filter(Boolean);
      for (const name of parts) {
        if (!name || name.includes('"') || name.includes(':') || name.length > 120) continue;
        if (existing.has(name.toLowerCase())) { skipped++; continue; }
        await db.prepare(`INSERT INTO active_ingredients(name) VALUES(?)`).bind(name).run();
        existing.add(name.toLowerCase());
        if (examples.length < 5) examples.push(name);
        added++;
      }
    }
    return new Response(JSON.stringify({ ok: true, added, skipped, examples: examples.join(', ') }),
      { headers: { 'content-type': 'application/json' } });
  }

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
