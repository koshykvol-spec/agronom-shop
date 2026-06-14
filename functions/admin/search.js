// /admin/search — керування розумним пошуком: синоніми (RU→UA) + налаштування (фолдинг, fuzzy).
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

const PAGE = (body) => `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>Налаштування пошуку</title><style>
body{font-family:system-ui;max-width:820px;margin:1.2rem auto;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2{color:#2d6a2d} h3{margin:18px 0 6px}
.btn{background:#2d6a2d;color:#fff;border:0;padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:700;text-decoration:none;display:inline-block}
.muted{color:#888;font-size:.85rem}
input{padding:7px 9px;border:1px solid #ccc;border-radius:6px;font:inherit}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;font-size:.9rem}
td,th{padding:6px 9px;border-bottom:1px solid #eee;text-align:left}
.box{background:#fff;border:1px solid #e3e3e3;border-radius:10px;padding:12px 14px;margin:8px 0}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body><div><a href="/admin">← до адмінки</a></div>${body}</body></html>`;

export async function onRequestGet(context){
  const db = context.env.DB;
  const url = new URL(context.request.url);
  if (url.searchParams.get('delsyn')){
    await db.prepare(`DELETE FROM search_synonyms WHERE id=?`).bind(url.searchParams.get('delsyn')).run();
    return Response.redirect(new URL('/admin/search', context.request.url).toString(), 303);
  }
  const syns = (await db.prepare(`SELECT id, term, target FROM search_synonyms ORDER BY term`).all()).results || [];
  const cfg = {};
  for (const r of (await db.prepare(`SELECT key,value FROM search_config`).all()).results || []) cfg[r.key] = r.value;

  const rows = syns.map(s => `<tr><td>${esc(s.term)}</td><td>→ ${esc(s.target)}</td><td><a href="/admin/search?delsyn=${s.id}" onclick="return confirm('Видалити?')" style="color:#c0392b">✕</a></td></tr>`).join('');

  const body = `<h2>🔎 Налаштування розумного пошуку</h2>
    <div class="muted">Зміни застосуються для нових відвідувачів одразу, для кешу — до 5 хв. Нормалізація/синоніми/fuzzy працюють на боці браузера (дані звідси).</div>

    <h3>Налаштування</h3>
    <form class="box" method="POST" action="/admin/search">
      <input type="hidden" name="action" value="save-cfg">
      <label class="muted">Фолдинг символів (пари <code>з&gt;на</code> через кому; зрівнює рос/укр літери):</label><br>
      <input name="fold" value="${esc(cfg.fold || '')}" style="width:100%;max-width:520px;margin:4px 0">
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin:6px 0">
        <label class="muted">Fuzzy-відстань (0 = вимк, 1 = одрук): <input name="fuzzy_dist" value="${esc(cfg.fuzzy_dist || '1')}" style="width:50px"></label>
        <label class="muted">Мін. довжина слова для fuzzy: <input name="fuzzy_minlen" value="${esc(cfg.fuzzy_minlen || '4')}" style="width:50px"></label>
      </div>
      <button class="btn" type="submit">💾 Зберегти налаштування</button>
    </form>

    <h3>Синоніми (${syns.length}) — ввід → на що шукати</h3>
    <form class="box" method="POST" action="/admin/search" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input type="hidden" name="action" value="add-syn">
      <input name="term" placeholder="напр. помидор" required>
      <span>→</span>
      <input name="target" placeholder="напр. томат" required>
      <button class="btn" type="submit">＋ Додати</button>
    </form>
    <table><tr><th>Ввід</th><th>Шукаємо</th><th></th></tr>${rows || '<tr><td colspan=3 class="muted">Поки порожньо</td></tr>'}</table>`;
  return new Response(PAGE(body), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function onRequestPost(context){
  const db = context.env.DB;
  const f = await context.request.formData();
  const action = f.get('action');
  if (action === 'add-syn'){
    const term = (f.get('term') || '').trim().toLowerCase(), target = (f.get('target') || '').trim().toLowerCase();
    if (term && target) await db.prepare(`INSERT INTO search_synonyms(term,target) VALUES(?,?)`).bind(term, target).run();
  } else if (action === 'save-cfg'){
    for (const k of ['fold', 'fuzzy_dist', 'fuzzy_minlen']){
      await db.prepare(`INSERT OR REPLACE INTO search_config(key,value) VALUES(?,?)`).bind(k, (f.get(k) || '').trim()).run();
    }
  }
  return Response.redirect(new URL('/admin/search', context.request.url).toString(), 303);
}
