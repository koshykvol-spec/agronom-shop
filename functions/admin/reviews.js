// /admin/reviews — модерація відгуків + AI-генерація (Google Gemini 3.5 Flash) + масове видалення.
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function stars(n){ var f=Math.round(n)||0; return '★★★★★'.slice(0,f)+'☆☆☆☆☆'.slice(0,5-f); }

const sleep = ms => new Promise(res => setTimeout(res, ms));

const FARMER_NAMES = [
  // Початковий список
  "Олена К.", "Іван Прокопчук", "Марія Дмитрівна", "Петро Коваль", "Наталія Василівна", 
  "Василь Шатковський", "Тетяна", "Андрій Бойко", "Сергій Миколайович", "Оксана В.", 
  "Микола Захарчук", "Ганна", "Дмитро Кравчук", "Світлана П.", "Віктор Олександрович", 
  "Юрій М.", "Людмила", "Олександр Т.", "Валентина Г.", "Михайло", "Надія К.",
  "Роман Пасічник", "Ольга В.", "Володимир С.", "Ніна Степанівна", "Павло Г.",
  "Галина Петрівна", "Степан Семенович", "Ярослав Ковальчук", "Катерина М.", "Iрина В.",
  "Анатолій Григорович", "Олег Бондар", "Марта С.", "Богдан Шевченко", "Оксана Іванівна",
  "Віталій П.", "Лариса Дмитрівна", "Євгенія К.", "Тарас Мельник", "Святослав",
  "Яна Олександрівна", "Валерій Іванович", "Алла Г.", "Зінаїда Василівна", "Iгор Т.",
  "Любов Миколаївна", "Григорій Степанович", "Софія К.", "Вадим Лисенко", "Дарина",
  "Віра Олексіївна", "Максим Ткаченко", "Юлія С.", "Ростислав М.", "Олена Іванівна",
  "Антон Поліщук", "Iнна В.", "Євген Павлович", "Наталя Скрипник", "Тамара",
  "Леонід Петрович", "Христина Б.", "Артем Ганжа", "Світлана Дмитрівна", "Денис К.",
  "Олеся В.", "Ярослава М.", "Роман Васильович", "Марія Федорівна", "Василь К.",
  "Вікторія П.", "Назар Шевчук", "Уляна Т.", "Олексій Сергійович", "Марина Коваль"
];
function getRandomName() {
  return FARMER_NAMES[Math.floor(Math.random() * FARMER_NAMES.length)];
}

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
textarea.edit-box{width:100%;max-width:100%;min-height:60px;padding:6px;border:1px solid #ccc;border-radius:6px;margin:6px 0;box-sizing:border-box;font-family:inherit}
.card-actions{display:flex;gap:6px;margin-top:6px}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body><div><a href="/admin">← до адмінки</a></div>${body}</body></html>`;

async function generateSingleReviewWithAI(env, product) {
  const context = product.annotation ? `Опис товару: ${product.annotation.slice(0, 150)}` : '';
  const chosenName = getRandomName();
  const randomRating = Math.random() > 0.25 ? 5 : 4; 

  const prompt = `Ти — український фермер або дачник. Напиши 1 короткий, природний відгук українською мовою на агротовар "${product.name}" (категорія: ${product.category}${product.brand ? ', бренд: ' + product.brand : ''}).

${context}

Вимоги:
- Відгук має бути довжиною від 50 до 140 символів.
- Пиши просто, як звичайна людина.
- БЕЗ реклами та пафосу. БЕЗ знаків "!!!" чи трикрапок.
- Автор відгуку СУВОРО: "${chosenName}"
- Рейтинг відгуку СУВОРО: ${randomRating}`;

  const keyRow = await env.DB.prepare(`SELECT value FROM site_settings WHERE key='gemini_api_key'`).first();
  const apiKey = keyRow ? keyRow.value : '';
  if (!apiKey) throw new Error('Брак ключа Gemini API у site_settings.');

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7, // Трохи знизили для більшої стабільності структури JSON
        maxOutputTokens: 2048, // Збільшили ліміт токенів, щоб текст не обривався
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            author: { type: "STRING" },
            rating: { type: "INTEGER" },
            text: { type: "STRING" }
          },
          required: ["author", "rating", "text"]
        }
      }
    })
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`Gemini API Error: ${response.status} ${err.slice(0, 100)}`);
  }

  const data = await response.json();
  let content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!content) throw new Error('Порожня відповідь від нейромережі');

  // Очищаємо контент від можливих блоків ```json ... ```
  content = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');

  try {
    const rev = JSON.parse(content);
    return {
      author: rev.author || chosenName,
      rating: Number(rev.rating) || randomRating,
      text: rev.text
    };
  } catch (e) {
    throw new Error('Помилка парсингу JSON відповіді: ' + e.message + ' | Raw text: ' + content.slice(0, 80));
  }
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  const formData = await context.request.formData();
  const action = formData.get('action');

  if (action === 'save_approve') {
    const id = formData.get('id');
    const text = formData.get('text');
    
    await db.prepare(
      `UPDATE reviews SET text = ?, approved = 1 WHERE id = ?`
    ).bind(text, id).run();

    return Response.redirect(new URL('/admin/reviews?msg=' + encodeURIComponent('Відгук відредаговано та схвалено'), context.request.url).toString(), 303);
  }

  return Response.redirect(new URL('/admin/reviews', context.request.url).toString(), 303);
}

export async function onRequestGet(context){
  const db = context.env.DB;
  const url = new URL(context.request.url);

  const gen = url.searchParams.get('gen');
  if (gen === '1') {
    let noRevProducts = [];
    let dbErrorMsg = '';

    try {
      const batchSize = 9; 
      // Використовуємо просту вибірку без c.annotation, щоб точно ніде не зрізало
      const rawRes = await db.prepare(
        `SELECT p.pid, p.name, p.category, p.brand
         FROM products p
         WHERE NOT EXISTS (SELECT 1 FROM reviews r WHERE r.pid = p.pid)
         LIMIT ?`
      ).bind(batchSize).all();

      noRevProducts = rawRes.results || [];
    } catch (dbErr) {
      dbErrorMsg = 'SQL Error: ' + dbErr.message;
    }

    if (dbErrorMsg) {
      return Response.redirect(new URL(`/admin/reviews?msg=${encodeURIComponent(dbErrorMsg)}`, context.request.url).toString(), 303);
    }

    let totalGenerated = 0;
    let apiErrorMsg = '';

    for (let i = 0; i < noRevProducts.length; i++) {
      const product = noRevProducts[i];
      if (i > 0) await sleep(2200); 

      try {
        const rev = await generateSingleReviewWithAI(context.env, product);
        if (rev && rev.text && rev.text.length >= 10) {
          await db.prepare(
            `INSERT INTO reviews (pid, name, rating, text, created_at, approved, source)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            product.pid, rev.author, rev.rating, rev.text,
            new Date().toISOString().split('T')[0], 0, 'gemini-ai'
          ).run();
          totalGenerated++;
        }
      } catch (e) {
        apiErrorMsg = e.message || String(e);
        // Якщо впало на першому ж запиті — перериваємо, щоб показати помилку
        if (totalGenerated === 0) break;
      }
    }

    let finalMsg = `Згенеровано по 1 відгуку для ${totalGenerated} різних товарів (на модерації)`;
    if (apiErrorMsg && totalGenerated === 0) {
      finalMsg = `Помилка генерації: ${apiErrorMsg}`;
    }

    return Response.redirect(new URL(`/admin/reviews?msg=${encodeURIComponent(finalMsg)}`, context.request.url).toString(), 303);
  }

  const delai = url.searchParams.get('delai');
  if (delai === '1') {
    const result = await db.prepare(
      `DELETE FROM reviews WHERE source = 'gemini-ai' AND approved = 0`
    ).run();
    const deleted = result.meta?.changes || 0;
    const msg = `Видалено ${deleted} AI-відгуків (що були на модерації)`;
    return Response.redirect(new URL(`/admin/reviews?msg=${encodeURIComponent(msg)}`, context.request.url).toString(), 303);
  }

  if (url.searchParams.get('ok')){
    await db.prepare(`UPDATE reviews SET approved=1 WHERE id=?`).bind(url.searchParams.get('ok')).run();
    return Response.redirect(new URL('/admin/reviews', context.request.url).toString(), 303);
  }
  if (url.searchParams.get('del')){
    await db.prepare(`DELETE FROM reviews WHERE id=?`).bind(url.searchParams.get('del')).run();
    return Response.redirect(new URL('/admin/reviews', context.request.url).toString(), 303);
  }

  const msg = url.searchParams.get('msg');
  const msgHtml = msg ? `<div style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:8px;padding:10px;margin:10px 0;color:#2d6a2d;font-weight:600">✓ ${esc(msg)}</div>` : '';

  const noRevTotal = (((await db.prepare(
    `SELECT COUNT(*) n FROM products p WHERE NOT EXISTS (SELECT 1 FROM reviews r WHERE r.pid = p.pid)`
  ).first()) || {}).n) | 0;

  const aiPending = (((await db.prepare(
    `SELECT COUNT(*) n FROM reviews WHERE source = 'gemini-ai' AND approved = 0`
  ).first()) || {}).n) | 0;

  const rows = (await db.prepare(
    `SELECT r.id,r.pid,r.name,r.rating,r.text,r.img,r.approved,r.created_at,r.source,
            COALESCE(NULLIF(c.display_name,''),p.name) AS pname, c.slug
       FROM reviews r LEFT JOIN products p ON p.pid=r.pid LEFT JOIN product_content c ON c.pid=r.pid
      ORDER BY r.approved, r.id DESC`
  ).all()).results || [];

  const pend = rows.filter(r=>!r.approved);
  const appr = rows.filter(r=>r.approved);

  const card = r => `<div class="rev${r.approved?'':r.source==='gemini-ai'?' ai pend':' pend'}">
    <div><b>${esc(r.name)}</b> <span class="st">${stars(r.rating)}</span> <span class="muted">${esc(r.created_at||'')}</span>
      ${r.source==='gemini-ai'?'<span style="font-size:.75rem;background:#4285f4;color:#fff;padding:1px 6px;border-radius:4px;margin-left:4px">🤖 AI</span>':''}
      — товар: ${r.slug?`<a href="/p/${esc(r.slug)}" target="_blank">${esc(r.pname||('#'+r.pid))}</a>`:esc(r.pname||('#'+r.pid))}</div>
    
    ${r.approved 
      ? `<div style="margin:6px 0;white-space:pre-wrap">${esc(r.text)}</div>`
      : `<form method="POST" action="/admin/reviews">
          <input type="hidden" name="action" value="save_approve">
          <input type="hidden" name="id" value="${r.id}">
          <textarea class="edit-box" name="text">${esc(r.text)}</textarea>
          <div class="card-actions">
            <button type="submit" class="btn ok">💾 Зберегти й схвалити</button>
            <a class="btn del" href="/admin/reviews?del=${r.id}" onclick="return confirm('Видалити відгук?')">🗑 Видалити</a>
          </div>
         </form>`
    }
    
    ${r.img ? `<a href="/thumb/${esc(r.img)}" target="_blank"><img src="/thumb/${esc(r.img)}" style="max-width:120px;max-height:120px;border-radius:6px;display:block;margin:6px 0;border:1px solid #eee"></a>` : ''}
    
    ${r.approved ? `<div class="card-actions"><a class="btn del" href="/admin/reviews?del=${r.id}" onclick="return confirm('Видалити відгук?')">🗑 Видалити</a></div>` : ''}
  </div>`;

  const actionBar = `<div class="bar">
    <span class="muted">Товарів без відгуків: <b>${noRevTotal}</b></span>
    ${noRevTotal > 0 ? `<a class="btn gen" href="/admin/reviews?gen=1" onclick="return confirm('Згенерувати по 1 відгуку Gemini для ${Math.min(noRevTotal, 9)} товарів? Відгуки будуть на модерації.')">🤖 Згенерувати відгуки Gemini (9 шт)</a>` : ''}
    ${aiPending > 0 ? `<span class="muted">🤖 На модерації: <b>${aiPending}</b></span><a class="btn del" href="/admin/reviews?delai=1" onclick="return confirm('Видалити ВСІ ${aiPending} AI-відгуки, що на модерації?')">🗑 Скасувати AI-відгуки</a>` : ''}
  </div>`;

  return new Response(PAGE('Відгуки',
    `${msgHtml}${actionBar}
    <h2>💬 Відгуки</h2>
    <h3>На модерації (${pend.length})</h3>${pend.length?pend.map(card).join(''):'<p class="muted">Немає нових.</p>'}
    <h3 style="margin-top:18px">Схвалені (${appr.length})</h3>${appr.length?appr.map(card).join(''):'<p class="muted">Поки порожньо.</p>'}`
  ), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
