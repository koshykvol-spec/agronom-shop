// /admin/categories — редагування категорій каталогу (нав, іконки, SEO, підкатегорії, схеми).
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

const PAGE = (body) => `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>Категорії</title><style>
body{font-family:system-ui;max-width:920px;margin:1.2rem auto;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2{color:#2d6a2d}
.btn{background:#2d6a2d;color:#fff;border:0;padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:700}
.muted{color:#888;font-size:.85rem}
input,textarea,select{padding:6px 8px;border:1px solid #ccc;border-radius:6px;font:inherit}
textarea{width:100%}
.box{background:#fff;border:1px solid #e3e3e3;border-radius:10px;padding:12px 14px;margin:10px 0}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin:6px 0}
.row label{display:flex;flex-direction:column;font-size:.8rem;color:#555;gap:3px}
.head{display:flex;align-items:center;gap:10px;justify-content:space-between}
.tag{font-size:.75rem;color:#888;background:#eef;padding:2px 7px;border-radius:6px}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body><div><a href="/admin">← до адмінки</a></div>${body}</body></html>`;

export async function onRequestGet(context){
  const db = context.env.DB;
  const cats = (await db.prepare(`SELECT * FROM categories ORDER BY sort,nav_label`).all()).results || [];
  const saved = new URL(context.request.url).searchParams.get('saved');
  const forms = cats.map(c => `
    <form class="box" method="POST" action="/admin/categories">
      <input type="hidden" name="key" value="${esc(c.key)}">
      <div class="head"><h3 style="margin:0">${esc(c.icon)} ${esc(c.nav_label)}</h3>
        <span class="tag">?cat=${esc(c.key)} · база: ${esc(c.db_name)}</span></div>
      <div class="row">
        <label>Підпис у меню<input name="nav_label" value="${esc(c.nav_label)}" style="width:220px"></label>
        <label>Іконка<input name="icon" value="${esc(c.icon)}" style="width:60px"></label>
        <label>Порядок<input name="sort" type="number" value="${esc(c.sort)}" style="width:70px"></label>
        <label>Назва в базі (=products.category)<input name="db_name" value="${esc(c.db_name)}" style="width:220px"></label>
      </div>
      <div class="row">
        <label>Текст кнопки «Всі»<input name="sub_all_label" value="${esc(c.sub_all_label)}" style="width:200px"></label>
        <label><input type="checkbox" name="has_sub" ${c.has_sub?'checked':''}> підкатегорії</label>
        <label><input type="checkbox" name="show_schemes" ${c.show_schemes?'checked':''}> показувати схеми захисту</label>
      </div>
      <div class="row">
        <label style="flex:1">SEO title<input name="seo_title" value="${esc(c.seo_title)}" style="width:100%"></label>
        <label style="flex:1">H1<input name="h1" value="${esc(c.h1)}" style="width:100%"></label>
      </div>
      <div class="row"><label style="flex:1">SEO опис<textarea name="seo_desc" rows="2">${esc(c.seo_desc)}</textarea></label></div>
      <div class="row"><label style="flex:1">Placeholder пошуку<input name="placeholder" value="${esc(c.placeholder)}" style="width:100%"></label></div>
      <button class="btn" type="submit">💾 Зберегти</button>
    </form>`).join('');

  return new Response(PAGE(`<h2>🗂 Категорії каталогу (${cats.length})</h2>
    ${saved ? '<div class="box" style="border-color:#2d6a2d;color:#2d6a2d">✅ Збережено: '+esc(saved)+'. Кеш — до 5 хв.</div>' : ''}
    <div class="muted">«Назва в базі» має точно збігатися зі значенням <code>products.category</code> з 1С — інакше категорія стане порожньою. Інше можна правити вільно.</div>
    ${forms}`), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function onRequestPost(context){
  const db = context.env.DB;
  const f = await context.request.formData();
  const key = (f.get('key')||'').trim();
  if (key) {
    await db.prepare(`UPDATE categories SET nav_label=?,icon=?,sort=?,db_name=?,sub_all_label=?,has_sub=?,show_schemes=?,seo_title=?,h1=?,seo_desc=?,placeholder=? WHERE key=?`)
      .bind(
        (f.get('nav_label')||'').trim(),
        (f.get('icon')||'🛒').trim(),
        parseInt(f.get('sort')||'0',10)||0,
        (f.get('db_name')||'').trim(),
        (f.get('sub_all_label')||'Всі').trim(),
        f.get('has_sub')?1:0,
        f.get('show_schemes')?1:0,
        (f.get('seo_title')||'').trim(),
        (f.get('h1')||'').trim(),
        (f.get('seo_desc')||'').trim(),
        (f.get('placeholder')||'').trim(),
        key
      ).run();
  }
  return Response.redirect(new URL('/admin/categories?saved='+encodeURIComponent(key), context.request.url).toString(), 303);
}
