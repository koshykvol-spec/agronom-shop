export async function onRequestGet() {
  return new Response(JSON.stringify({ok:true,msg:'diagnose worker is alive'}), {
    headers: {'content-type':'application/json','access-control-allow-origin':'*'}
  });
}

const J = (o, s) => new Response(JSON.stringify(o), {
  status: s || 200,
  headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }
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
    // Get API key from DB
    const row = await env.DB.prepare(
      `SELECT value FROM site_settings WHERE key='anthropic_api_key' LIMIT 1`
    ).first();
    const apiKey = row && row.value ? row.value : '';
    if (!apiKey) return J({ ok: false, error: 'API key not configured' }, 503);

    // Parse form
    let fd;
    try { fd = await request.formData(); }
    catch(e) { return J({ ok: false, error: 'Invalid request format' }, 400); }

    const file = fd.get('photo');
    if (!file || typeof file === 'string') return J({ ok: false, error: 'No photo provided' }, 400);

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) return J({ ok: false, error: 'Unsupported format' }, 400);

    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > 8 * 1024 * 1024) return J({ ok: false, error: 'File too large (max 8MB)' }, 400);

    // Base64
    const uint8 = new Uint8Array(bytes);
    let bin = '';
    for (let i = 0; i < uint8.length; i += 8192) {
      bin += String.fromCharCode(...uint8.subarray(i, i + 8192));
    }
    const b64 = btoa(bin);

    // Load products from DB
    const prods = (await env.DB.prepare(
      `SELECT COALESCE(NULLIF(c.display_name,''), p.name) name,
              COALESCE(c.slug,'') slug, p.price,
              COALESCE(c.active_ingredient,'') ai,
              COALESCE(c.annotation,'') ann
       FROM products p LEFT JOIN product_content c ON c.pid=p.pid
       WHERE COALESCE(c.visible,1)=1 AND p.in_stock=1
       ORDER BY p.name LIMIT 300`
    ).all()).results || [];

    const prodList = prods.map(p =>
      p.name + (p.ai ? ' (' + p.ai + ')' : '') + (p.ann ? ' - ' + p.ann.slice(0, 60) : '')
    ).join('\n');

    const systemPrompt = 'You are an agronomist assistant for the "Agronom" garden shop in Ukraine. '
      + 'Identify plant diseases, pests, or weeds from photos. Respond ONLY in valid JSON, no markdown. '
      + 'Always respond in Ukrainian language.\n\nAVAILABLE PRODUCTS:\n' + prodList;

    const userPrompt = 'Analyze this photo. Return JSON:\n'
      + '{"type":"disease|pest|weed|unknown","name":"Ukrainian name","confidence":"high|medium|low",'
      + '"description":"2-3 sentences in Ukrainian","advice":"Treatment advice in Ukrainian",'
      + '"products":["exact product name from catalog"]}';

    // Call Claude API
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: file.type, data: b64 } },
          { type: 'text', text: userPrompt }
        ]}]
      })
    });

    if (!aiRes.ok) {
      const err = await aiRes.text();
      return J({ ok: false, error: 'AI error ' + aiRes.status + ': ' + err.slice(0, 200) }, 502);
    }

    const aiData = await aiRes.json();
    const raw = (aiData.content || []).map(b => b.text || '').join('').trim();

    let diagnosis;
    try {
      const clean = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
      diagnosis = JSON.parse(clean);
    } catch(e) {
      return J({ ok: false, error: 'AI returned invalid JSON', raw: raw.slice(0, 300) }, 502);
    }

    // Match products
    const matched = [];
    if (Array.isArray(diagnosis.products)) {
      for (const pname of diagnosis.products) {
        const nl = pname.toLowerCase().split(',')[0].trim();
        const found = prods.filter(p => p.name.toLowerCase().startsWith(nl));
        if (found.length && found[0].slug) {
          matched.push({ n: found[0].name, slug: found[0].slug, p: found[0].price });
        }
      }
    }

    return J({
      ok: true,
      type: diagnosis.type || 'unknown',
      name: diagnosis.name || '',
      confidence: diagnosis.confidence || 'medium',
      description: diagnosis.description || '',
      advice: diagnosis.advice || '',
      products: matched,
    });

  } catch(e) {
    return J({ ok: false, error: 'Worker error: ' + String(e.message || e) }, 500);
  }
}
