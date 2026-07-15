// /admin/reviews — модерація відгуків (схвалити / видалити).
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function stars(n){ var f=Math.round(n)||0; return '★★★★★'.slice(0,f)+'☆☆☆☆☆'.slice(0,5-f); }

const PAGE = (body) => `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>Відгуки</title><style>
body{font-family:system-ui;max-width:860px;margin:1.2rem auto;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2,h3{color:#2d6a2d}
.muted{color:#888;font-size:.85rem}
.rev{background:#fff;border:1px solid #e3e3e3;border-radius:10px;padding:10px 12px;margin:8px 0}
.rev.pend{border-color:#f0c040;background:#fffdf3}
.btn{border:0;border-radius:7px;padding:6px 12px;font-weight:700;cursor:pointer;text-decoration:none;display:inline-block;color:#fff}
.ok{background:#2d6a2d}.del{background:#c0392b}
.st{color:#f5a623}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body><div><a href="/admin">← до адмінки</a></div>${body}</body></html>`;

export async function onRequestGet(context){
  const db = context.env.DB;
  const url = new URL(context.request.url);
  if (url.searchParams.get('ok')){ await db.prepare(`UPDATE reviews SET approved=1 WHERE id=?`).bind(url.searchParams.get('ok')).run(); return Response.redirect(new URL('/admin/reviews', context.request.url).toString(), 303); }
  if (url.searchParams.get('del')){ await db.prepare(`DELETE FROM reviews WHERE id=?`).bind(url.searchParams.get('del')).run(); return Response.redirect(new URL('/admin/reviews', context.request.url).toString(), 303); }

  const rows = (await db.prepare(
    `SELECT r.id,r.pid,r.name,r.rating,r.text,r.img,r.approved,r.created_at, COALESCE(NULLIF(c.display_name,''),p.name) AS pname, c.slug
       FROM reviews r LEFT JOIN products p ON p.pid=r.pid LEFT JOIN product_content c ON c.pid=r.pid
      ORDER BY r.approved, r.id DESC`
  ).all()).results || [];
  const pend = rows.filter(r=>!r.approved), appr = rows.filter(r=>r.approved);

  const card = r => `<div class="rev${r.approved?'':' pend'}">
    <div><b>${esc(r.name)}</b> <span class="st">${stars(r.rating)}</span> <span class="muted">${esc(r.created_at||'')}</span>
      — товар: ${r.slug?`<a href="/p/${esc(r.slug)}" target="_blank">${esc(r.pname||('#'+r.pid))}</a>`:esc(r.pname||('#'+r.pid))}</div>
    <div style="margin:6px 0;white-space:pre-wrap">${esc(r.text)}</div>
    ${r.img ? `<a href="/thumb/${esc(r.img)}" target="_blank"><img src="/thumb/${esc(r.img)}" style="max-width:120px;max-height:120px;border-radius:6px;display:block;margin:6px 0;border:1px solid #eee"></a>` : ''}
    ${r.approved?'':`<a class="btn ok" href="/admin/reviews?ok=${r.id}">✓ Схвалити</a> `}
    <a class="btn del" href="/admin/reviews?del=${r.id}" onclick="return confirm('Видалити відгук?')">🗑 Видалити</a>
  </div>`;

  return new Response(PAGE(`<h2>💬 Відгуки</h2>
    <h3>На модерації (${pend.length})</h3>${pend.length?pend.map(card).join(''):'<p class="muted">Немає нових.</p>'}
    <h3 style="margin-top:18px">Схвалені (${appr.length})</h3>${appr.length?appr.map(card).join(''):'<p class="muted">Поки порожньо.</p>'}`),
    { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
