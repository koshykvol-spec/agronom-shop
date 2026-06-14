// /admin/seasonal — культури сезонного помічника «Що зараз робити?».
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

const PAGE = (body) => `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>Сезонний помічник</title><style>
body{font-family:system-ui;max-width:960px;margin:1.2rem auto;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2{color:#2d6a2d}
.btn{background:#2d6a2d;color:#fff;border:0;padding:7px 12px;border-radius:8px;cursor:pointer;font-weight:700}
.muted{color:#888;font-size:.85rem}
input{padding:6px 8px;border:1px solid #ccc;border-radius:6px;font:inherit}
.rrow{display:flex;gap:6px;align-items:center;background:#fff;border:1px solid #eee;border-radius:8px;padding:6px 8px;margin:5px 0;flex-wrap:wrap}
.rrow .del{color:#c0392b;text-decoration:none;font-weight:700;padding:0 4px}
.box{background:#fff;border:1px solid #e3e3e3;border-radius:10px;padding:12px 14px;margin:10px 0}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body><div><a href="/admin">← до адмінки</a></div>${body}</body></html>`;

export async function onRequestGet(context){
  const db = context.env.DB;
  const url = new URL(context.request.url);
  if (url.searchParams.get('del')){
    await db.prepare(`DELETE FROM seasonal_cultures WHERE id=?`).bind(url.searchParams.get('del')).run();
    return Response.redirect(new URL('/admin/seasonal', context.request.url).toString(), 303);
  }
  const rows = (await db.prepare(`SELECT * FROM seasonal_cultures ORDER BY sort,id`).all()).results || [];
  const list = rows.map(r=>`<div class="rrow">
    <form method="POST" action="/admin/seasonal" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;flex:1">
      <input type="hidden" name="action" value="save"><input type="hidden" name="id" value="${esc(r.id)}">
      <input name="sort" type="number" value="${esc(r.sort)}" style="width:50px" title="порядок">
      <input name="grp" value="${esc(r.grp)}" style="width:95px" title="група (garden/vegetable/greenhouse)">
      <input name="grp_label" value="${esc(r.grp_label)}" style="width:130px" title="назва групи">
      <input name="label" value="${esc(r.label)}" style="width:130px" title="назва культури (з емодзі)">
      <input name="scheme_category" value="${esc(r.scheme_category)}" style="width:130px" title="категорія схеми">
      <input name="scheme_id" value="${esc(r.scheme_id)}" style="width:160px" title="id схеми">
      <button class="btn" type="submit">💾</button>
    </form>
    <a class="del" href="/admin/seasonal?del=${encodeURIComponent(r.id)}" onclick="return confirm('Видалити культуру?')">✕</a>
  </div>`).join('');

  return new Response(PAGE(`<h2>🌱 Сезонний помічник — культури (${rows.length})</h2>
    <div class="muted">Кожна культура належить групі (garden / vegetable / greenhouse) і вказує на схему захисту (scheme_category + scheme_id з датасету схем). Порядок — за «sort».</div>
    <div style="margin-top:8px">${list}</div>
    <h3 style="margin-top:20px">➕ Нова культура</h3>
    <form class="box" method="POST" action="/admin/seasonal" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
      <input type="hidden" name="action" value="add">
      <label class="muted">id<br><input name="id" placeholder="apricot" required></label>
      <label class="muted">група<br><input name="grp" placeholder="garden"></label>
      <label class="muted">назва групи<br><input name="grp_label" placeholder="🍎 Мій сад"></label>
      <label class="muted">культура<br><input name="label" placeholder="🍑 Абрикос"></label>
      <label class="muted">scheme_category<br><input name="scheme_category" placeholder="stone_fruits"></label>
      <label class="muted">scheme_id<br><input name="scheme_id" placeholder="apricot_protection"></label>
      <label class="muted">sort<br><input name="sort" type="number" value="50" style="width:60px"></label>
      <button class="btn" type="submit">➕ Додати</button>
    </form>`), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function onRequestPost(context){
  const db = context.env.DB;
  const f = await context.request.formData();
  const action = f.get('action');
  const g = k => (f.get(k)||'').trim();
  if (action === 'save'){
    const id = g('id');
    if (id) await db.prepare(`UPDATE seasonal_cultures SET sort=?,grp=?,grp_label=?,label=?,scheme_category=?,scheme_id=? WHERE id=?`)
      .bind(parseInt(g('sort')||'0',10)||0, g('grp'), g('grp_label'), g('label'), g('scheme_category'), g('scheme_id'), id).run();
  } else if (action === 'add'){
    const id = g('id').toLowerCase().replace(/[^a-z0-9_]/g,'');
    if (id) await db.prepare(`INSERT OR REPLACE INTO seasonal_cultures(id,grp,grp_label,label,scheme_category,scheme_id,sort) VALUES(?,?,?,?,?,?,?)`)
      .bind(id, g('grp')||'garden', g('grp_label'), g('label'), g('scheme_category'), g('scheme_id'), parseInt(g('sort')||'50',10)||50).run();
  }
  return Response.redirect(new URL('/admin/seasonal', context.request.url).toString(), 303);
}
