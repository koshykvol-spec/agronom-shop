export async function onRequestGet() {
  return new Response(JSON.stringify({ok:true,msg:'diagnose worker is alive'}), {
    headers: {'content-type':'application/json','access-control-allow-origin':'*'}
  });
}

export async function onRequestOptions() {
  return new Response(null, { headers: {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  }});
}

const J = (o, s) => new Response(JSON.stringify(o), {
  status: s || 200,
  headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }
});

// Універсальна функція: бере пул ключів (prefix = 'gemini_api_key' або 'openrouter_api_key'),
// зсуває лічильник ротації в site_settings і повертає ключі, починаючи з наступного за чергою.
async function getRotatedKeys(db, prefix) {
  const rows = (await db.prepare(
    `SELECT key, value FROM site_settings WHERE key LIKE '${prefix}%'`
  ).all().catch(() => ({ results: [] }))).results || [];

  const keys = [];
  for (let i = 1; i <= 6; i++) {
    const row = rows.find(r => r.key === `${prefix}_${i}`);
    if (row && row.value) keys.push(row.value.trim());
  }
  if (keys.length === 0) {
    const legacy = rows.find(r => r.key === prefix);
    if (legacy && legacy.value) keys.push(legacy.value.trim());
  }
  if (keys.length === 0) return [];

  const idxKey = `${prefix}_rotation_idx`;
  let idx = 0;
  try {
    const cur = await db.prepare(`SELECT value FROM site_settings WHERE key=?`).bind(idxKey).first();
    idx = cur && cur.value ? (parseInt(cur.value, 10) || 0) : 0;
  } catch (e) {}

  const nextIdx = (idx + 1) % keys.length;
  try {
    await db.prepare(`INSERT OR REPLACE INTO site_settings(key,value) VALUES(?,?)`)
      .bind(idxKey, String(nextIdx)).run();
  } catch (e) {}

  return [...keys.slice(idx), ...keys.slice(0, idx)];
}

// Пробує Gemini API по черзі ключів пулу. Повертає {text} або {error, retryable}.
async function tryGemini(apiKey, sys, prompt, image_b64, image_type) {
  let res;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(10000), // не даємо одному ключу "зависнути" й з'їсти весь ліміт часу воркера
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
  } catch (e) {
    return { error: 'Gemini: ' + String(e.message || e), retryable: true }; // timeout/мережева помилка — пробуємо наступний ключ
  }

  if (!res.ok) {
    const errText = await res.text();
    const retryable = [400, 401, 403, 429, 503].includes(res.status); // 400/401/403 часто = невалідний/вичерпаний ключ
    return { error: 'Gemini '+res.status+': '+errText.slice(0,300), retryable };
  }

  const data = await res.json();
  const text = ((data.candidates||[])[0]?.content?.parts||[]).map(p=>p.text||'').join('').trim();
  if (!text) return { error: 'Gemini: порожня відповідь', retryable: true };
  return { text };
}

// Пробує OpenRouter API по черзі ключів пулу.
async function tryOpenRouter(apiKey, sys, prompt, image_b64, image_type) {
  let res;
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'HTTP-Referer': 'https://agronom.pp.ua',
        'X-Title': 'Agronom Diagnose',
      },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${image_type||'image/jpeg'};base64,${image_b64}` } }
          ]}
        ]
      })
    });
  } catch (e) {
    return { error: 'OpenRouter: ' + String(e.message || e), retryable: true };
  }

  if (!res.ok) {
    const errText = await res.text();
    const retryable = [401, 402, 403, 429, 503].includes(res.status);
    return { error: 'OpenRouter '+res.status+': '+errText.slice(0,300), retryable };
  }

  const data = await res.json();
  const text = (data.choices||[])[0]?.message?.content || '';
  if (!text) return { error: 'OpenRouter: порожня відповідь', retryable: true };
  return { text };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    let body;
    try { body = await request.json(); }
    catch(e) { return J({ok:false, error:'Invalid JSON body: '+e.message}, 400); }

    const { image_b64, image_type } = body;
    if (!image_b64) return J({ok:false, error:'No image_b64 provided'}, 400);

    const prods = (await env.DB.prepare(
      `SELECT COALESCE(NULLIF(c.display_name,''),p.name) name,
              COALESCE(c.slug,'') slug, p.price,
              COALESCE(c.active_ingredient,'') ai
       FROM products p LEFT JOIN product_content c ON c.pid=p.pid
       WHERE COALESCE(c.visible,1)=1 AND p.in_stock=1
       ORDER BY p.name LIMIT 150`
    ).all().catch(()=>({results:[]}))).results || [];

    const prodList = prods.map(p => p.name + (p.ai ? ' ('+p.ai+')' : '')).join('\n');

    const sys = 'You are an agronomist for a Ukrainian garden shop. '
      + 'Identify plant diseases, pests, or weeds from photos. '
      + 'Respond ONLY in valid JSON without markdown. Use Ukrainian language.\n\nCATALOG:\n' + prodList;

    const prompt = 'Identify what is in this photo. Return JSON only:\n'
      + '{"type":"disease|pest|weed|unknown","name":"Ukrainian name",'
      + '"confidence":"high|medium|low","description":"2-3 sentences in Ukrainian",'
      + '"advice":"treatment advice in Ukrainian",'
      + '"products":["exact name from catalog"]}';

    let rawText = '', lastErr = '';

    // 1) Gemini — основний пул, пробуємо ключі по черзі (не більше 3, щоб не впертись у ліміт часу воркера)
    const geminiKeys = (await getRotatedKeys(env.DB, 'gemini_api_key')).slice(0, 3);
    for (const key of geminiKeys) {
      const r = await tryGemini(key, sys, prompt, image_b64, image_type);
      if (r.text) { rawText = r.text; break; }
      lastErr = r.error;
      if (!r.retryable) break; // не пов'язано з ключем — сенсу перебирати пул немає
    }

    // 2) OpenRouter — резерв, якщо весь пул Gemini не спрацював (теж не більше 3 ключів)
    if (!rawText) {
      const orKeys = (await getRotatedKeys(env.DB, 'openrouter_api_key')).slice(0, 3);
      for (const key of orKeys) {
        const r = await tryOpenRouter(key, sys, prompt, image_b64, image_type);
        if (r.text) { rawText = r.text; break; }
        lastErr = r.error;
        if (!r.retryable) break;
      }
    }

    if (!rawText) return J({ok:false, error:'Усі провайдери недоступні: '+lastErr}, 502);

    let diag;
    try {
      const clean = rawText.replace(/^```[\w]*\n?/,'').replace(/\n?```$/,'').trim();
      diag = JSON.parse(clean);
    } catch(e) {
      return J({ok:false, error:'JSON parse: '+e.message, raw:rawText.slice(0,200)}, 502);
    }

    const matched = [];
    if (Array.isArray(diag.products)) {
      for (const pname of diag.products) {
        const nl = pname.toLowerCase().split(',')[0].trim();
        if (!nl) continue;
        const found = prods.find(p => p.name.toLowerCase().startsWith(nl));
        if (found && found.slug) matched.push({n:found.name, slug:found.slug, p:found.price});
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

  } catch(e) {
    return J({ok:false, error:'Worker error: '+String(e.message||e)}, 500);
  }
}
