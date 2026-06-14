// /admin/recipes — чипи «Що вас цікавить?» (швидкий пошук + схеми захисту).
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

const PAGE = (body) => `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>Чипи</title><style>
body{font-family:system-ui;max-width:900px;margin:1.2rem auto;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2{color:#2d6a2d}
.btn{background:#2d6a2d;color:#fff;border:0;padding:7px 12px;border-radius:8px;cursor:pointer;font-weight:700}
.muted{color:#888;font-size:.85rem}
input,select{padding:6px 8px;border:1px solid #ccc;border-radius:6px;font:inherit}
.rrow{display:flex;gap:7px;align-items:center;background:#fff;border:1px solid #eee;border-radius:8px;padding:6px 8px;margin:5px 0;flex-wrap:wrap}
.rrow .del{color:#c0392b;text-decoration:none;font-weight:700;padding:0 4px}
.box{background:#fff;border:1px solid #e3e3e3;border-radius:10px;padding:12px 14px;margin:10px 0}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body><div><a href="/admin">← до адмінки</a></div>${body}</body></html>`;

export async function onRequestGet(context){
  const db = context.env.DB;
  const url = new URL(context.request.url);
  if (url.searchParams.get('del')){
    await db.prepare(`DELETE FROM recipes WHERE id=?`).bind(url.searchParams.get('del')).run();
    return Response.redirect(new URL('/admin/recipes', context.request.url).toString(), 303);
  }
  const rows = (await db.prepare(`SELECT * FROM recipes ORDER BY sort,id`).all()).results || [];
  const list = rows.map(r=>`<div class="rrow">
    <form method="POST" action="/admin/recipes" style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;flex:1">
      <input type="hidden" name="action" value="save"><input type="hidden" name="id" value="${esc(r.id)}">
      <input name="sort" type="number" value="${esc(r.sort)}" style="width:55px" title="порядок">
      <input name="title" value="${esc(r.title)}" style="width:200px" title="підпис">
      <input name="keywords" value="${esc(r.keywords)}" style="width:230px" title="через кому; перше = запит">
      <select name="type"><option value="search"${r.type==='search'?' selected':''}>пошук</option><option value="scheme"${r.type==='scheme'?' selected':''}>схема</option></select>
      <input name="scheme_url" value="${esc(r.scheme_url||'')}" style="width:170px" placeholder="схема: cat?scheme=id" title="URL схеми (для типу «схема»)">
      <input name="scheme_url_syngenta" value="${esc(r.scheme_url_syngenta||'')}" style="width:150px" placeholder="Syngenta-схема" title="URL Syngenta-схеми (необовʼязково)">
      <label class="muted" title="видимий"><input type="checkbox" name="visible" ${r.visible?'checked':''}> вид.</label>
      <button class="btn" type="submit">💾</button>
    </form>
    <a class="del" href="/admin/recipes?del=${encodeURIComponent(r.id)}" onclick="return confirm('Видалити чип?')">✕</a>
  </div>`).join('');

  return new Response(PAGE(`<h2>🎯 Чипи «Що вас цікавить?» (${rows.length})</h2>
    <div class="muted">«пошук» — натиск шукає за першим словом з keywords. «схема» — лінк на схему захисту (працює лише для відомих id у коді). Зніміть «вид.», щоб приховати.</div>
    <div style="margin-top:8px">${list}</div>
    <h3 style="margin-top:20px">➕ Новий чип (пошук)</h3>
    <form class="box" method="POST" action="/admin/recipes" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
      <input type="hidden" name="action" value="add">
      <label class="muted">id<br><input name="id" placeholder="cucumbers" required></label>
      <label class="muted">Підпис<br><input name="title" placeholder="🥒 Огірки" required></label>
      <label class="muted">keywords<br><input name="keywords" placeholder="огірок,огурец"></label>
      <label class="muted">Порядок<br><input name="sort" type="number" value="50" style="width:60px"></label>
      <button class="btn" type="submit">➕ Додати</button>
    </form>`), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function onRequestPost(context){
  const db = context.env.DB;
  const f = await context.request.formData();
  const action = f.get('action');
  if (action === 'save'){
    const id = (f.get('id')||'').trim();
    if (id) await db.prepare(`UPDATE recipes SET sort=?,title=?,keywords=?,type=?,visible=?,scheme_url=?,scheme_url_syngenta=? WHERE id=?`)
      .bind(parseInt(f.get('sort')||'0',10)||0, (f.get('title')||'').trim(), (f.get('keywords')||'').trim(),
            (f.get('type')||'search').trim(), f.get('visible')?1:0,
            (f.get('scheme_url')||'').trim(), (f.get('scheme_url_syngenta')||'').trim(), id).run();
  } else if (action === 'add'){
    const id = (f.get('id')||'').trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
    if (id) await db.prepare(`INSERT OR REPLACE INTO recipes(id,title,keywords,type,sort,visible) VALUES(?,?,?,?,?,1)`)
      .bind(id, (f.get('title')||'').trim(), (f.get('keywords')||'').trim(), 'search', parseInt(f.get('sort')||'50',10)||50).run();
  }
  return Response.redirect(new URL('/admin/recipes', context.request.url).toString(), 303);
}
