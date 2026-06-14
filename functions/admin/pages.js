// /admin/pages — міні-CMS для інфо-сторінок (доставка, повернення/оферта тощо).
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

const PAGE = (body) => `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>Сторінки</title><style>
body{font-family:system-ui;max-width:880px;margin:1.2rem auto;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2{color:#2d6a2d}
.btn{background:#2d6a2d;color:#fff;border:0;padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:700}
.muted{color:#888;font-size:.85rem}
input,textarea{padding:7px 9px;border:1px solid #ccc;border-radius:6px;font:inherit;width:100%}
textarea{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.85rem;line-height:1.45}
.box{background:#fff;border:1px solid #e3e3e3;border-radius:10px;padding:12px 14px;margin:10px 0}
.fl{margin:7px 0} .fl label{font-size:.8rem;color:#555;display:block;margin-bottom:3px}
.tag{font-size:.75rem;color:#888;background:#eef;padding:2px 7px;border-radius:6px}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body><div><a href="/admin">← до адмінки</a></div>${body}</body></html>`;

const KNOWN = { delivery: '/delivery.html', returns: '/returns.html' };

export async function onRequestGet(context){
  const db = context.env.DB;
  const pages = (await db.prepare(`SELECT slug,title,meta_desc,body_html,updated_at FROM pages ORDER BY slug`).all()).results || [];
  const saved = new URL(context.request.url).searchParams.get('saved');
  const forms = pages.map(p => `
    <form class="box" method="POST" action="/admin/pages">
      <input type="hidden" name="slug" value="${esc(p.slug)}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0">${esc(p.slug)}</h3>
        <span class="tag">${KNOWN[p.slug] ? '<a href="'+KNOWN[p.slug]+'" target="_blank">'+KNOWN[p.slug]+'</a>' : 'нова'} · ${esc(p.updated_at||'')}</span>
      </div>
      <div class="fl"><label>Title (вкладка/SEO)</label><input name="title" value="${esc(p.title)}"></div>
      <div class="fl"><label>Meta-опис</label><input name="meta_desc" value="${esc(p.meta_desc)}"></div>
      <div class="fl"><label>Тіло (HTML — можна &lt;h2&gt;, &lt;p&gt;, &lt;a&gt;, &lt;ul&gt;&lt;li&gt;)</label><textarea name="body_html" rows="12">${esc(p.body_html)}</textarea></div>
      <button class="btn" type="submit">💾 Зберегти</button>
    </form>`).join('');

  return new Response(PAGE(`<h2>📄 Інфо-сторінки (${pages.length})</h2>
    ${saved ? '<div class="box" style="border-color:#2d6a2d;color:#2d6a2d">✅ Збережено: '+esc(saved)+'. Кеш — до 2 хв.</div>' : ''}
    <div class="muted">Текст застосовується на сайті динамічно. Дозволені звичайні HTML-теги; скрипти вирізаються.</div>
    ${forms}
    <h3 style="margin-top:22px">➕ Нова сторінка</h3>
    <form class="box" method="POST" action="/admin/pages">
      <div class="fl"><label>slug (латиницею, напр. warranty)</label><input name="slug" placeholder="warranty" required></div>
      <div class="fl"><label>Title</label><input name="title"></div>
      <div class="fl"><label>Тіло (HTML)</label><textarea name="body_html" rows="5"></textarea></div>
      <button class="btn" type="submit">➕ Створити</button>
    </form>`), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function sanitize(html){
  // прибираємо <script>…</script> та inline-обробники on*=
  return String(html||'')
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '');
}

export async function onRequestPost(context){
  const db = context.env.DB;
  const f = await context.request.formData();
  const slug = (f.get('slug')||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'');
  if (slug) {
    await db.prepare(`INSERT INTO pages(slug,title,meta_desc,body_html,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(slug) DO UPDATE SET title=excluded.title,meta_desc=excluded.meta_desc,body_html=excluded.body_html,updated_at=excluded.updated_at`)
      .bind(slug, (f.get('title')||'').trim(), (f.get('meta_desc')||'').trim(), sanitize(f.get('body_html')||''), new Date().toISOString().slice(0,10)).run();
  }
  return Response.redirect(new URL('/admin/pages?saved='+encodeURIComponent(slug), context.request.url).toString(), 303);
}
