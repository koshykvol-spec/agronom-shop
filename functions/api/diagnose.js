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

// ПРОБА №3: викликаємо ЛИШЕ Gemini (без D1, без OpenRouter, без парсингу),
// і повертаємо все як є — включно з сирим текстом помилки від Gemini, якщо є.
export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    let body;
    try { body = await request.json(); }
    catch(e) { return J({ok:false, error:'Invalid JSON body: '+e.message}, 400); }

    const { image_b64, image_type } = body;
    if (!image_b64) return J({ok:false, error:'No image_b64 provided'}, 400);

    // Дістаємо перший ключ Gemini напряму, без ротації — щоб виключити зайву логіку
    const row = await env.DB.prepare(
      `SELECT key, value FROM site_settings WHERE key LIKE 'gemini_api_key%' ORDER BY key LIMIT 1`
    ).first().catch(e => null);

    if (!row || !row.value) {
      return J({ok:false, error:'Ключ Gemini не знайдено в site_settings', row}, 500);
    }

    const apiKey = row.value.trim();
    const keyPreview = apiKey.slice(0,4) + '...' + apiKey.slice(-4) + ' (len=' + apiKey.length + ')';

    let res;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [
              { text: 'Describe this image in one sentence.' },
              { inline_data: { mime_type: image_type || 'image/jpeg', data: image_b64 } }
            ]}]
          })
        }
      );
    } catch (fetchErr) {
      return J({ok:false, stage:'fetch threw', error: String(fetchErr && fetchErr.message || fetchErr), keyUsed: keyPreview}, 500);
    }

    const text = await res.text().catch(e => '(could not read body: '+e+')');

    return J({
      ok: res.ok,
      stage: 'got response',
      geminiStatus: res.status,
      geminiBodyPreview: text.slice(0, 500),
      keyUsed: keyPreview,
    }, 200); // навмисно завжди 200, щоб побачити деталі навіть при помилці Gemini

  } catch(e) {
    return J({ok:false, stage:'outer catch', error:'Worker error: '+String(e.message||e), stack: String(e.stack||'').slice(0,500)}, 500);
  }
}
