// Cloudflare Worker — AI діагностика фото для сайту «Агроном»
// Секрети (Cloudflare → Worker → Settings → Variables and Secrets):
//   GEMINI_API_KEY — ключ від aistudio.google.com/apikey
// Змінні:
//   ALLOWED_ORIGIN — домен сайту (за замовчуванням https://agronom.pp.ua)
//   RATE_LIMIT_MAX — макс. запитів на IP за вікно (за замовчуванням 8)
//   RATE_LIMIT_WINDOW_SEC — тривалість вікна в секундах (за замовчуванням 3600 = 1 год)
//
// Worker читає base64 фото з JSON body, передає в Gemini API,
// повертає діагноз + список препаратів.
// Захист: CORS обмежений ALLOWED_ORIGIN + rate-limit по IP через D1 (таблиця rate_limits).

export default {
  async fetch(request, env, ctx) {
    const origin = env.ALLOWED_ORIGIN || 'https://agronom.pp.ua';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    const J = (o, s) => new Response(JSON.stringify(o), {
      status: s || 200,
      headers: { 'content-type': 'application/json; charset=utf-8', ...cors }
    });

    // Debug: перевірка DB
    if (new URL(request.url).pathname === '/debug-db') {
      try {
        const r = await env.DB.prepare(`SELECT COUNT(*) n FROM diagnose_log`).first();
        return J({db:'ok', count: r.n});
      } catch(e) {
        return J({db:'error', msg: e.message});
      }
    }

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method === 'GET') return J({ ok: true, msg: 'diagnose worker alive' });
    if (request.method !== 'POST') return J({ ok: false, error: 'Method not allowed' }, 405);

    // ---- Rate limiting по IP (захист від зловживання Gemini API) ----
    if (env.DB) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const max = parseInt(env.RATE_LIMIT_MAX || '8', 10);
      const windowSec = parseInt(env.RATE_LIMIT_WINDOW_SEC || '3600', 10);
      const now = Math.floor(Date.now() / 1000);
      const key = `diagnose:${ip}`;
      try {
        const row = await env.DB.prepare(
          `SELECT cnt, exp FROM rate_limits WHERE k = ?`
        ).bind(key).first();

        if (!row || row.exp <= now) {
          // нове вікно
          await env.DB.prepare(
            `INSERT INTO rate_limits (k, cnt, exp) VALUES (?, 1, ?)
             ON CONFLICT(k) DO UPDATE SET cnt = 1, exp = excluded.exp`
          ).bind(key, now + windowSec).run();
        } else if (row.cnt >= max) {
          return J({ ok: false, error: 'Забагато запитів. Спробуйте пізніше.' }, 429);
        } else {
          await env.DB.prepare(
            `UPDATE rate_limits SET cnt = cnt + 1 WHERE k = ?`
          ).bind(key).run();
        }
      } catch (e) {
        // якщо rate-limit таблиця недоступна — не блокуємо користувача,
        // але це резервний захист; основний — сама наявність цієї перевірки
      }
    }

    const apiKey = env.GEMINI_API_KEY || '';
    if (!apiKey) return J({ ok: false, error: 'GEMINI_API_KEY not set' }, 503);

    let body;
    try { body = await request.json(); }
    catch(e) { return J({ ok: false, error: 'Invalid JSON: ' + e.message }, 400); }

    const { image_b64, image_type, known_names } = body;
    if (!image_b64) return J({ ok: false, error: 'No image_b64' }, 400);

    const sys = 'You are an agronomist for a Ukrainian garden shop. '
      + 'Identify plant diseases, pests, or weeds from photos. '
      + 'Respond ONLY in valid JSON without markdown. Use Ukrainian language in all text fields.\n\n'
      + (known_names ? 'KNOWN DISEASE/PEST/WEED NAMES IN OUR REFERENCE DATABASE (prefer matching exactly to one of these if applicable):\n' + known_names + '\n\n' : '');

    const prompt = 'Identify what is shown in this photo. Return JSON only:\n'
      + '{"type":"disease|pest|weed|unknown","name":"Ukrainian name - use EXACT name from the KNOWN NAMES list above if it matches, otherwise your own precise Ukrainian name",'
      + '"confidence":"high|medium|low","description":"2-3 sentences in Ukrainian",'
      + '"advice":"treatment advice in Ukrainian",'
      + '"products":[]}\n\n'
      + 'IMPORTANT: leave products as empty array - we will look up products ourselves based on the disease/pest/weed name you provide. '
      + 'Focus on giving the most ACCURATE name matching our known names list.';

    const geminiBody = JSON.stringify({
      system_instruction: { parts: [{ text: sys }] },
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: image_type || 'image/jpeg', data: image_b64 } },
          { text: prompt }
        ]
      }],
      generationConfig: {
        maxOutputTokens: 600,
        responseMimeType: 'application/json',
      },
    });

    // Повторні спроби при тимчасовому перевантаженні моделі (503/429),
    // з невеликою затримкою між спробами (з точними назвами резервних
    // моделей Google міняється надто часто, щоб на них покладатись)
    const model = 'gemini-3.5-flash';
    const maxAttempts = 3;
    const delaysMs = [800, 2000];
    let aiRes = null;
    let lastErrText = '';
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: geminiBody
        });
        if (res.ok) { aiRes = res; break; }
        lastErrText = await res.text();
        if (res.status !== 503 && res.status !== 429) {
          return J({ ok: false, error: 'Gemini API ' + res.status + ': ' + lastErrText.slice(0, 300) }, 502);
        }
      } catch(e) {
        lastErrText = e.message;
      }
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, delaysMs[attempt]));
      }
    }

    if (!aiRes) {
      return J({ ok: false, error: 'Gemini API перевантажена, спробуйте ще раз через хвилину: ' + lastErrText.slice(0, 200) }, 502);
    }

    const aiData = await aiRes.json();
    const raw = ((aiData.candidates || [])[0]?.content?.parts || []).map(p => p.text || '').join('').trim();

    let diag;
    try {
      const clean = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
      diag = JSON.parse(clean);
    } catch(e) {
      return J({ ok: false, error: 'JSON parse: ' + e.message, raw: raw.slice(0, 200) }, 502);
    }

    const result = {
      ok: true,
      type: diag.type || 'unknown',
      name: diag.name || '',
      confidence: diag.confidence || 'medium',
      description: diag.description || '',
      advice: diag.advice || '',
      products: Array.isArray(diag.products) ? diag.products : [],
    };

    // Логування для статистики (адмінка) — await, бо без ctx.waitUntil Worker
    // може завершитись до виконання запиту
    if (env.DB) {
      try {
        await env.DB.prepare(
          `INSERT INTO diagnose_log(type, name, confidence, products_found) VALUES(?,?,?,?)`
        ).bind(result.type, result.name, result.confidence, result.products.length).run();
      } catch(logErr) {
        // не блокуємо відповідь користувачу через помилку логування
      }
    }

    // Сповіщення в Telegram (тимчасово для моніторингу)
    if (env.BOT_TOKEN && env.CHAT_ID && result.type !== 'unknown') {
      const typeLabel = result.type === 'disease' ? '🍂 Хвороба' : result.type === 'pest' ? '🐛 Шкідник' : '🌿 Бур’ян';
      const confLabel = result.confidence === 'high' ? 'висока' : result.confidence === 'medium' ? 'середня' : 'низька';
      const prodsText = result.products.length ? result.products.slice(0,3).join(', ') : 'не знайдено';
      const msg = `🔬 AI-діагностика на agronom.pp.ua

${typeLabel}: *${result.name}*
Впевненість: ${confLabel}
Препарати: ${prodsText}`;
      const recipients = String(env.CHAT_ID).split(/[\s,]+/).filter(Boolean);
      for (const chatId of recipients) {
        fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' })
        }).catch(() => {});
      }
    }

    return J(result);
  }
};
