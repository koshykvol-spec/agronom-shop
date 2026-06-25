// updated: 2026-06-24
// /api/diagnose — діагностика фото: хвороба/шкідник/бур'ян → препарати з каталогу
// POST multipart/form-data: поле "photo" (image/jpeg|png|webp|gif)
// Відповідь: { ok, type, name, description, products: [{n,slug,p}], advice }

const ALLOWED_TYPES = ['image/jpeg','image/png','image/webp','image/gif'];
const MAX_SIZE = 8 * 1024 * 1024; // 8MB

const json = (o, s=200) => new Response(JSON.stringify(o), {
  status: s, headers: {'content-type':'application/json;charset=utf-8',
    'access-control-allow-origin':'*'}
});

export async function onRequestOptions() {
  return new Response(null, { headers: {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  }});
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    return await _handlePost(request, env);
  } catch(e) {
    return new Response(JSON.stringify({ok:false,error:'Worker exception: '+String(e.message||e),stack:String(e.stack||'').slice(0,300)}),
      {status:500,headers:{'content-type':'application/json','access-control-allow-origin':'*'}});
  }
}

async function _handlePost(request, env) {

  // Читаємо API ключ з D1
  const apiKeyRow = await env.DB.prepare(
    `SELECT value FROM site_settings WHERE key='anthropic_api_key' LIMIT 1`
  ).first().catch(() => null);
  const ANTHROPIC_KEY = (apiKeyRow && apiKeyRow.value) || env.ANTHROPIC_API_KEY || '';
  if (!ANTHROPIC_KEY) return json({ok:false, error:'API ключ не налаштовано. Зверніться до адміністратора.'}, 503);

  // Парсимо форму
  let formData;
  try { formData = await request.formData(); }
  catch(e) { return json({ok:false, error:'Невірний формат запиту'}, 400); }

  const file = formData.get('photo');
  if (!file || typeof file === 'string') return json({ok:false, error:'Фото не передано'}, 400);
  if (!ALLOWED_TYPES.includes(file.type)) return json({ok:false, error:'Непідтримуваний формат. Використовуйте JPEG, PNG або WebP.'}, 400);

  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_SIZE) return json({ok:false, error:'Фото завелике (макс. 8 МБ)'}, 400);

  // Base64 — chunk-based щоб уникнути stack overflow на великих файлах
  const uint8 = new Uint8Array(bytes);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
  }
  const b64 = btoa(binary);
  const mediaType = file.type;

  // Завантажуємо каталог товарів для контексту
  const products = (await env.DB.prepare(
    `SELECT p.sku, COALESCE(NULLIF(c.display_name,''),p.name) name, COALESCE(c.slug,'') slug,
            COALESCE(c.active_ingredient,'') ai, p.price, p.category, p.brand,
            COALESCE(c.annotation,'') ann
       FROM products p LEFT JOIN product_content c ON c.pid=p.pid
      WHERE COALESCE(c.visible,1)=1 AND p.in_stock=1
        AND (p.category LIKE '%АГРОХІМІК%' OR p.category LIKE '%ГЕРБІЦИД%' OR p.category LIKE '%ФУНГІЦИД%' OR p.category LIKE '%ІНСЕКТИЦИД%')
      ORDER BY p.name LIMIT 300`
  ).all()).results || [];

  const prodList = products.map(p =>
    `${p.name}${p.ai ? ' ('+p.ai+')' : ''}${p.ann ? ' — '+p.ann.slice(0,80) : ''}`
  ).join('\n');

  const systemPrompt = `Ти — агроном-консультант інтернет-магазину «Агроном» (м. Володимир, Україна).
Твоя задача — діагностувати по фото хворобу рослини, шкідника або бур'ян і підібрати препарати з наданого каталогу.

КАТАЛОГ ДОСТУПНИХ ПРЕПАРАТІВ:
${prodList}

ПРАВИЛА:
- Відповідай ЛИШЕ валідним JSON без markdown і пояснень поза JSON
- Якщо на фото рослина з ознаками хвороби → type: "disease"
- Якщо на фото шкідник або пошкодження від шкідника → type: "pest"  
- Якщо на фото бур'ян → type: "weed"
- Якщо не можеш визначити → type: "unknown"
- products — масив назв з каталогу (точно як у каталозі), до 5 найбільш підходящих
- confidence: "high" / "medium" / "low"
- Мова: українська`;

  const userPrompt = `Проаналізуй фото і визнач що на ньому зображено.
Поверни JSON у форматі:
{
  "type": "disease"|"pest"|"weed"|"unknown",
  "name": "Назва хвороби/шкідника/бур'яну",
  "confidence": "high"|"medium"|"low",
  "description": "Короткий опис (2-3 речення) що це і чим небезпечно",
  "advice": "Практична порада по застосуванню препаратів (1-2 речення)",
  "products": ["Назва препарату 1 з каталогу", "Назва препарату 2 з каталогу"]
}`;

  // Виклик Claude API
  let aiResp;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
            { type: 'text', text: userPrompt }
          ]
        }]
      })
    });
    if (!resp.ok) {
      const err = await resp.text();
      return json({ok:false, error:'Помилка AI: '+resp.status}, 502);
    }
    aiResp = await resp.json();
  } catch(e) {
    return json({ok:false, error:'Не вдалося зв\'язатися з AI: '+e.message}, 502);
  }

  // Парсимо відповідь
  const raw = (aiResp.content||[]).map(b=>b.text||'').join('').trim();
  let diagnosis;
  try {
    const clean = raw.replace(/^```[\w]*\n?/,'').replace(/\n?```$/,'').trim();
    diagnosis = JSON.parse(clean);
  } catch(e) {
    return json({ok:false, error:'AI повернув невалідну відповідь', raw: raw.slice(0,200)}, 502);
  }

  // Зіставляємо products з каталогом
  const matchedProducts = [];
  if (Array.isArray(diagnosis.products)) {
    for (const pname of diagnosis.products) {
      const plow = pname.toLowerCase();
      const matched = products.filter(p =>
        p.name.toLowerCase().startsWith(plow.split(',')[0].trim())
      );
      if (matched.length) {
        // Беремо перший знайдений
        const m = matched[0];
        matchedProducts.push({ n: m.name, slug: m.slug, p: m.price, ai: m.ai });
      }
    }
  }

  return json({
    ok: true,
    type: diagnosis.type || 'unknown',
    name: diagnosis.name || '',
    confidence: diagnosis.confidence || 'medium',
    description: diagnosis.description || '',
    advice: diagnosis.advice || '',
    products: matchedProducts,
  });
}

