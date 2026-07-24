// Agronom — визначення хвороби/шкідника/бур'яну по фото
// Розгортається на Deno Deploy (deno.com/deploy), а не на Cloudflare.
//
// Налаштування перед деплоєм:
// 1. У Deno Deploy Dashboard → Settings → Environment Variables додай секрети:
//      GEMINI_API_KEY_1 .. GEMINI_API_KEY_6      (скільки є реальних ключів)
//      OPENROUTER_API_KEY_1 .. OPENROUTER_API_KEY_6
// 2. На agronom.pp.ua заміни DIAGNOSE_URL у protection_schemes.html на
//    повний URL цього проєкту, напр.: https://agro-diagnose.deno.dev

const ALLOWED_ORIGIN = 'https://agronom.pp.ua';
const PRODUCTS_URL = 'https://agronom.pp.ua/products.json';

function corsHeaders() {
  return {
    'access-control-allow-origin': ALLOWED_ORIGIN,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

function J(o, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders() },
  });
}

// Збирає ключі з env-змінних PREFIX_1..PREFIX_6, починаючи з випадкового —
// рівномірний розподіл навантаження без потреби зберігати лічильник.
function getKeys(prefix) {
  const keys = [];
  for (let i = 1; i <= 6; i++) {
    const v = Deno.env.get(`${prefix}_${i}`);
    if (v && v.trim()) keys.push(v.trim());
  }
  if (keys.length === 0) return [];
  const start = Math.floor(Math.random() * keys.length);
  return [...keys.slice(start), ...keys.slice(0, start)];
}

async function callGemini(apiKey, sys, prompt, image_b64, image_type) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents: [{ role: 'user', parts: [
          { text: prompt },
          { inline_data: { mime_type: image_type || 'image/jpeg', data: image_b64 } }
        ]}],
        generationConfig: { temperature: 0.4 }
      })
    }
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return { error: 'Gemini ' + res.status + ': ' + errText.slice(0, 300) };
  }
  const data = await res.json();
  const text = ((data.candidates || [])[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
  if (!text) return { error: 'Gemini: порожня відповідь' };
  return { text };
}

async function callOpenRouter(apiKey, sys, prompt, image_b64, image_type) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
      'HTTP-Referer': ALLOWED_ORIGIN,
      'X-Title': 'Agronom Diagnose',
    },
    body: JSON.stringify({
      model: 'google/gemma-4-31b-it:free',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${image_type || 'image/jpeg'};base64,${image_b64}` } }
        ]}
      ]
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return { error: 'OpenRouter ' + res.status + ': ' + errText.slice(0, 300) };
  }
  const data = await res.json();
  const text = (data.choices || [])[0]?.message?.content || '';
  if (!text) return { error: 'OpenRouter: порожня відповідь' };
  return { text };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  if (req.method === 'GET') {
    return J({ ok: true, msg: 'diagnose worker is alive (Deno Deploy)' });
  }

  if (req.method !== 'POST') {
    return J({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    let body;
    try { body = await req.json(); }
    catch (e) { return J({ ok: false, error: 'Invalid JSON body: ' + e.message }, 400); }

    const { image_b64, image_type } = body;
    if (!image_b64) return J({ ok: false, error: 'No image_b64 provided' }, 400);

    // Каталог товарів — публічний статичний файл, D1 не потрібен
    let prods = [];
    try {
      const pr = await fetch(PRODUCTS_URL);
      if (pr.ok) {
        const all = await pr.json();
        prods = all.filter(p => p.inStock).slice(0, 100);
      }
    } catch (e) { /* якщо каталог не завантажився — просто працюємо без нього */ }

    const prodList = prods.map(p => p.n).join('\n');

    const sys = 'You are an agronomist for a Ukrainian garden shop. '
      + 'Identify plant diseases, pests, or weeds from photos. '
      + 'Respond ONLY in valid JSON without markdown. Use Ukrainian language.\n\nCATALOG:\n' + prodList;

    const prompt = 'Identify what is in this photo. Return JSON only:\n'
      + '{"type":"disease|pest|weed|unknown","name":"Ukrainian name",'
      + '"confidence":"high|medium|low","description":"2-3 sentences in Ukrainian",'
      + '"advice":"treatment advice in Ukrainian",'
      + '"products":["exact name from catalog"]}';

    let rawText = '', geminiErr = '', orErr = '';

    const geminiKeys = getKeys('GEMINI_API_KEY');
    for (const key of geminiKeys) {
      const r = await callGemini(key, sys, prompt, image_b64, image_type);
      if (r.text) { rawText = r.text; break; }
      geminiErr = r.error;
    }

    if (!rawText) {
      const orKeys = getKeys('OPENROUTER_API_KEY');
      for (const key of orKeys) {
        const r = await callOpenRouter(key, sys, prompt, image_b64, image_type);
        if (r.text) { rawText = r.text; break; }
        orErr = r.error;
      }
    }

    if (!rawText) return J({ ok: false, error: 'Усі провайдери недоступні. Gemini: ' + (geminiErr || 'н/д') + ' | OpenRouter: ' + (orErr || 'н/д') }, 502);

    let diag;
    try {
      const clean = rawText.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
      diag = JSON.parse(clean);
    } catch (e) {
      return J({ ok: false, error: 'JSON parse: ' + e.message, raw: rawText.slice(0, 200) }, 502);
    }

    const matched = [];
    if (Array.isArray(diag.products)) {
      for (const pname of diag.products) {
        if (!pname || typeof pname !== 'string') continue;
        const nl = pname.toLowerCase().split(',')[0].trim();
        if (!nl) continue;
        const found = prods.find(p => p.n && p.n.toLowerCase().startsWith(nl));
        if (found && found.slug) matched.push({ n: found.n, slug: found.slug, p: found.p });
      }
    }

    return J({
      ok: true,
      type: diag.type || 'unknown',
      name: diag.name || '',
      confidence: diag.confidence || 'medium',
      description: diag.description || '',
      advice: diag.advice || '',
      products: matched,
    });

  } catch (e) {
    return J({ ok: false, error: 'Worker error: ' + String(e.message || e) }, 500);
  }
});
