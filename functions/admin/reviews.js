// /admin/reviews — модерація відгуків + AI-генерація + масове видалення.
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function stars(n){ var f=Math.round(n)||0; return '★★★★★'.slice(0,f)+'☆☆☆☆☆'.slice(0,5-f); }

const PAGE = (title, body) => `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>
body{font-family:system-ui;max-width:860px;margin:1.2rem auto;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2,h3{color:#2d6a2d}
.muted{color:#888;font-size:.85rem}
.rev{background:#fff;border:1px solid #e3e3e3;border-radius:10px;padding:10px 12px;margin:8px 0}
.rev.pend{border-color:#f0c040;background:#fffdf3}
.rev.ai{border-color:#a5d6a7;background:#f5faf5}
.btn{border:0;border-radius:7px;padding:6px 12px;font-weight:700;cursor:pointer;text-decoration:none;display:inline-block;color:#fff}
.ok{background:#2d6a2d}.del{background:#c0392b}.gen{background:#7a4e00}.bulk{background:#555}
.st{color:#f5a623}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0;padding:10px 12px;background:#fff;border:1px solid #e3e3e3;border-radius:10px}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body><div><a href="/admin">← до адмінки</a></div>${body}</body></html>`;

// ── AI-генерація відгуків через aifill ──────────────────────────────────────
async function generateReviewsWithAI(env, product) {
  const context = product.annotation ? `Опис товару: ${product.annotation.slice(0, 300)}` : '';
  const prompt = `Ти — український фермер із Волинської області. Напиши 3 короткі відгуки українською мовою на агротовар "${product.name}" (категорія: ${product.category}${product.brand ? ', бренд: ' + product.brand : ''}).

${context}

Вимоги:
- Кожен відгук 50-130 символів
- Різні тони: 1 емоційний/вдячний, 1 практичний/технічний, 1 короткий лаконічний
- Реалістичні деталі: врожай, терміни, конкретні проблеми (хвощ, бур'яни, осот)
- БЕЗ пафосу ("найкращий у світі", "чудо-засіб")
- БЕЗ зайвих вигуків ("!!!", "...")
- Імена авторів: типові українські, різні (Олена, Іван, Марія, Петро, Наталія, Василь, Тетяна, Андрій)
- Рейтинги: 4 або 5 (переважно 5, один може бути 4 з поясненням "трохи дорогий" або "працює, але повільно")

Поверни СТРОГО JSON-масив без пояснень:
[{"author": "Ім'я", "rating": 5, "text": "текст відгуку"}, ...]`;

  // Виклик через aifill.js (внутрішній fetch)
  try {
    const aifillRes = await fetch('http://localhost/admin/aifill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'generate_reviews', payload: { prompt } })
    });
    if (aifillRes.ok) {
      const data = await aifillRes.json();
      if (data.reviews) return data.reviews;
    }
  } catch (e) {
    // aifill недоступний — fallback на прямий виклик
  }

  // Fallback: прямий виклик Claude API через ключ із site_settings
  const keyRow = await env.DB.prepare(`SELECT value FROM site_settings WHERE key='anthropic_api_key'`).first();
  const apiKey = keyRow ? keyRow.value : '';
  if (!apiKey) throw new Error('Anthropic API key не задано. Додайте у /admin/keys');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 600,
      temperature: 0.8,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) throw new Error(`Claude API: ${response.status}`);

  const data = await response.json();
  const content = data.content?.[0]?.text || '';
  const jsonMatch = content.match(/\[[\s\S]*?\]/);
  if (!jsonMatch) return [];

  try {
    const reviews = JSON.parse(jsonMatch[0]);
    return reviews.filter(r => r.author && r.rating >= 1 && r.rating <= 5 && r.text && r.text.length >= 20 && r.text.length <= 150);
  } catch (e) { return []; }
}

// ── GET ─────────────────────────────────────────────────────────────────────
export async function onRequestGet(context){
  const db = context.env.DB;
  const url = new URL(context.request.url);

  // ── генерація AI-відгуків ──
  const gen = url.searchParams.get('gen');
  if (gen === '1') {
    const batchSize = 15;
    const noRevProducts = (await db.prepare(
      `SELECT p.pid, p.name, p.category, p.brand, c.annotation
       FROM products p
       JOIN product_content c ON c.pid = p.pid
       WHERE NOT EXISTS (SELECT 1 FROM reviews r WHERE r.pid = p.pid)
       LIMIT ?`
    ).bind(batchSize).all()).results || [];

    let totalGenerated = 0;
    for (const product of noRevProducts) {
      try {
        const reviews = await generateReviewsWithAI(context.env, product);
        for (const rev of reviews) {
          await db.prepare(
            `INSERT INTO reviews (pid, name, rating, text, created_at, approved, source)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            product.pid, rev.author, rev.rating, rev.text,
            new Date().toISOString().split('T')[0], 0, 'claude-ai'
          ).run();
        }
        totalGenerated += reviews.length;
      } catch (e) {
        console.error('Gen review failed for', product.pid, e);
      }
    }

    const msg = `Згенеровано ${totalGenerated} відгуків для ${noRevProducts.length} товарів (на модерації)`;
    return Response.redirect(new URL(`/admin/reviews?msg=${encodeURIComponent(msg)}`, context.request.url).toString(), 303);
  }

  // ── масове видалення AI-відгуків ──
  const delai = url.searchParams.get('delai');
  if (delai === '1') {
    const result = await db.prepare(
      `DELETE FROM reviews WHERE source = 'claude-ai' AND approved = 0`
    ).run();
    const deleted = result.meta?.changes || 0;
    const msg = `Видалено ${deleted} AI-відгуків (що були на модерації)`;
    return Response.redirect(new URL(`/admin/reviews?msg=${encodeURIComponent(msg)}`, context.request.url).toString(), 303);
  }

  // ── схвалити / видалити один ──
  if (url.searchParams.get('ok')){
    await db.prepare(`UPDATE reviews SET approved=1 WHERE id=?`).bind(url.searchParams.get('ok')).run();
    return Response.redirect(new URL('/admin/reviews', context.request.url).toString(), 303);
  }
  if (url.searchParams.get('del')){
    await db.prepare(`DELETE FROM reviews WHERE id=?`).bind(url.searchParams.get('del')).run();
    return Response.redirect(new URL('/admin/reviews', context.request.url).toString(), 303);
  }

  // ── рендер сторінки ──
  const msg = url.searchParams.get('msg');
  const msgHtml = msg ? `<div style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:8px;padding:10px;margin:10px 0;color:#2d6a2d;font-weight:600">✓ ${esc(msg)}</div>` : '';

  // Підрахунок товарів без відгуків
  const noRevTotal = (((await db.prepare(
    `SELECT COUNT(*) n FROM products p WHERE NOT EXISTS (SELECT 1 FROM reviews r WHERE r.pid = p.pid)`
  ).first()) || {}).n) | 0;

  // Підрахунок AI-відгуків на модерації
  const aiPending = (((await db.prepare(
    `SELECT COUNT(*) n FROM reviews WHERE source = 'claude-ai' AND approved = 0`
  ).first()) || {}).n) | 0;

  const rows = (await db.prepare(
    `SELECT r.id,r.pid,r.name,r.rating,r.text,r.img,r.approved,r.created_at,r.source,
            COALESCE(NULLIF(c.display_name,''),p.name) AS pname, c.slug
       FROM reviews r LEFT JOIN products p ON p.pid=r.pid LEFT JOIN product_content c ON c.pid=r.pid
      ORDER BY r.approved, r.id DESC`
  ).all()).results || [];

  const pend = rows.filter(r=>!r.approved);
  const appr = rows.filter(r=>r.approved);

  const card = r => `<div class="rev${r.approved?'':r.source==='claude-ai'?' ai pend':' pend'}">
    <div><b>${esc(r.name)}</b> <span class="st">${stars(r.rating)}</span> <span class="muted">${esc(r.created_at||'')}</span>
      ${r.source==='claude-ai'?'<span style="font-size:.75rem;background:#a5d6a7;color:#1a3e1a;padding:1px 6px;border-radius:4px;margin-left:4px">🤖 AI</span>':''}
      — товар: ${r.slug?`<a href="/p/${esc(r.slug)}" target="_blank">${esc(r.pname||('#'+r.pid))}</a>`:esc(r.pname||('#'+r.pid))}</div>
    <div style="margin:6px 0;white-space:pre-wrap">${esc(r.text)}</div>
    ${r.img ? `<a href="/thumb/${esc(r.img)}" target="_blank"><img src="/thumb/${esc(r.img)}" style="max-width:120px;max-height:120px;border-radius:6px;display:block;margin:6px 0;border:1px solid #eee"></a>` : ''}
    ${r.approved?'':`<a class="btn ok" href="/admin/reviews?ok=${r.id}">✓ Схвалити</a> `}
    <a class="btn del" href="/admin/reviews?del=${r.id}" onclick="return confirm('Видалити відгук?')">🗑 Видалити</a>
  </div>`;

  // Панель дій
  const actionBar = `<div class="bar">
    <span class="muted">Товарів без відгуків: <b>${noRevTotal}</b></span>
    ${noRevTotal > 0 ? `<a class="btn gen" href="/admin/reviews?gen=1" onclick="return confirm('Згенерувати по 3 відгуки Claude для ${Math.min(noRevTotal, 15)} товарів? Відгуки будуть на модерації.')">🤖 Згенерувати відгуки Claude</a>` : ''}
    ${aiPending > 0 ? `<span class="muted">🤖 На модерації: <b>${aiPending}</b></span><a class="btn del" href="/admin/reviews?delai=1" onclick="return confirm('Видалити ВСІ ${aiPending} AI-відгуки, що на модерації?')">🗑 Скасувати AI-відгуки</a>` : ''}
  </div>`;

  return new Response(PAGE('Відгуки',
    `${msgHtml}${actionBar}
    <h2>💬 Відгуки</h2>
    <h3>На модерації (${pend.length})</h3>${pend.length?pend.map(card).join(''):'<p class="muted">Немає нових.</p>'}
    <h3 style="margin-top:18px">Схвалені (${appr.length})</h3>${appr.length?appr.map(card).join(''):'<p class="muted">Поки порожньо.</p>'}`
  ), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
