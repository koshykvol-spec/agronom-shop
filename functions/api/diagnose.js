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

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    // Parse JSON body (not formData - send as JSON with base64 image)
    let body;
    try { body = await request.json(); }
    catch(e) { return J({ok:false, error:'Invalid JSON body: '+e.message}, 400); }

    const { image_b64, image_type } = body;
    if (!image_b64) return J({ok:false, error:'No image_b64 provided'}, 400);

    // Get API key
    const row = await env.DB.prepare(
      `SELECT value FROM site_settings WHERE key='anthropic_api_key' LIMIT 1`
    ).first().catch(()=>null);
    const apiKey = row && row.value ? row.value.trim() : '';
    if (!apiKey) return J({ok:false, error:'API key not configured'}, 503);

    // Load products
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

    // Call Anthropic
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
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

    if (!aiRes.ok) {
      const err = await aiRes.text();
      return J({ok:false, error:'Claude '+aiRes.status+': '+err.slice(0,300)}, 502);
    }

    const aiData = await aiRes.json();
    const raw = (aiData.content||[]).map(b=>b.text||'').join('').trim();

    let diag;
    try {
      const clean = raw.replace(/^```[\w]*\n?/,'').replace(/\n?```$/,'').trim();
      diag = JSON.parse(clean);
    } catch(e) {
      return J({ok:false, error:'JSON parse: '+e.message, raw:raw.slice(0,200)}, 502);
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
