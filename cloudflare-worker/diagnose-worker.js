// Cloudflare Worker — AI діагностика фото для сайту «Агроном»
// Секрети (Cloudflare → Worker → Settings → Variables and Secrets):
//   ANTHROPIC_API_KEY — ключ від console.anthropic.com
// Змінні:
//   ALLOWED_ORIGIN — домен сайту (за замовчуванням https://agronom.pp.ua)
//
// Worker читає base64 фото з JSON body, передає в Claude API,
// повертає діагноз + список препаратів.

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || 'https://agronom.pp.ua';
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    const J = (o, s) => new Response(JSON.stringify(o), {
      status: s || 200,
      headers: { 'content-type': 'application/json; charset=utf-8', ...cors }
    });

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method === 'GET') return J({ ok: true, msg: 'diagnose worker alive' });
    if (request.method !== 'POST') return J({ ok: false, error: 'Method not allowed' }, 405);

    const apiKey = env.ANTHROPIC_API_KEY || '';
    if (!apiKey) return J({ ok: false, error: 'ANTHROPIC_API_KEY not set' }, 503);

    let body;
    try { body = await request.json(); }
    catch(e) { return J({ ok: false, error: 'Invalid JSON: ' + e.message }, 400); }

    const { image_b64, image_type, prod_list } = body;
    if (!image_b64) return J({ ok: false, error: 'No image_b64' }, 400);

    const sys = 'You are an agronomist for a Ukrainian garden shop. '
      + 'Identify plant diseases, pests, or weeds from photos. '
      + 'Respond ONLY in valid JSON without markdown. Use Ukrainian language in all text fields.\n\n'
      + 'CATALOG (one product per line):\n' + (prod_list || '');

    const prompt = 'Identify what is shown in this photo. Return JSON only:\n'
      + '{"type":"disease|pest|weed|unknown","name":"Ukrainian name",'
      + '"confidence":"high|medium|low","description":"2-3 sentences in Ukrainian",'
      + '"advice":"treatment advice in Ukrainian",'
      + '"products":["copy exact product name from catalog - pick 3-5 most relevant"]}\n\n'
      + 'IMPORTANT: products array must contain exact names copied from the CATALOG above. '
      + 'If disease - suggest fungicides. If pest - suggest insecticides. If weed - suggest herbicides.';

    let aiRes;
    try {
      aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          system: sys,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: image_type || 'image/jpeg', data: image_b64 } },
            { type: 'text', text: prompt }
          ]}]
        })
      });
    } catch(e) {
      return J({ ok: false, error: 'Fetch to Anthropic failed: ' + e.message }, 502);
    }

    if (!aiRes.ok) {
      const err = await aiRes.text();
      return J({ ok: false, error: 'Claude API ' + aiRes.status + ': ' + err.slice(0, 300) }, 502);
    }

    const aiData = await aiRes.json();
    const raw = (aiData.content || []).map(b => b.text || '').join('').trim();

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

    // Логування для статистики (адмінка)
    if (env.DB) {
      env.DB.prepare(
        `INSERT INTO diagnose_log(type, name, confidence, products_found) VALUES(?,?,?,?)`
      ).bind(result.type, result.name, result.confidence, result.products.length).run().catch(() => {});
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
