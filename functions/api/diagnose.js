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
    let fd;
    try { fd = await request.formData(); }
    catch(e) { return J({ok:false, error:'formData: '+e.message}, 400); }

    const file = fd.get('photo');
    if (!file || typeof file === 'string') return J({ok:false, error:'no file'}, 400);

    const allowed = ['image/jpeg','image/png','image/webp','image/gif'];
    if (!allowed.includes(file.type)) return J({ok:false, error:'unsupported format'}, 400);

    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > 8*1024*1024) return J({ok:false, error:'file too large'}, 400);

    const row = await env.DB.prepare(
      `SELECT value FROM site_settings WHERE key='anthropic_api_key' LIMIT 1`
    ).first().catch(()=>null);
    const apiKey = row && row.value ? row.value.trim() : '';
    if (!apiKey) return J({ok:false, error:'API key not configured'}, 503);

    const uint8 = new Uint8Array(bytes);
    let bin = '';
    for (let i = 0; i < uint8.length; i += 8192) {
      bin += String.fromCharCode(...uint8.subarray(i, i + 8192));
    }
    const b64 = btoa(bin);

    const prods = (await env.DB.prepare(
      `SELECT COALESCE(NULLIF(c.display_name,''),p.name) name,
              COALESCE(c.slug,'') slug, p.price,
              COALESCE(c.active_ingredient,'') ai,
              COALESCE(c.annotation,'') ann
       FROM products p LEFT JOIN product_content c ON c.pid=p.pid
       WHERE COALESCE(c.visible,1)=1 AND p.in_stock=1
       ORDER BY p.name LIMIT 200`
    ).all().catch(()=>({results:[]}))).results || [];

    const prodList = prods.slice(0,150).map(p =>
      p.name + (p.ai ? ' ('+p.ai+')' : '')
    ).join('\n');

    const sys = 'You are an agronomist for a Ukrainian garden shop. '
      + 'Identify plant diseases, pests, or weeds from photos. '
      + 'Respond ONLY in valid JSON without markdown. Use Ukrainian language in all text fields.\n\n'
      + 'CATALOG:\n' + prodList;

    const prompt = 'Identify what is shown in this photo. Return JSON only:\n'
      + '{"type":"disease|pest|weed|unknown","name":"Ukrainian name",'
      + '"confidence":"high|medium|low","description":"2-3 sentences in Ukrainian",'
      + '"advice":"Treatment advice in Ukrainian",'
      + '"products":["exact name from catalog or empty array"]}';

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: sys,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: file.type, data: b64 } },
          { type: 'text', text: prompt }
        ]}]
      })
    });

    if (!aiRes.ok) {
      const err = await aiRes.text();
      return J({ok:false, error:'Claude API '+aiRes.status+': '+err.slice(0,200)}, 502);
    }

    const aiData = await aiRes.json();
    const raw = (aiData.content||[]).map(b=>b.text||'').join('').trim();

    let diag;
    try {
      const clean = raw.replace(/^```[\w]*\n?/,'').replace(/\n?```$/,'').trim();
      diag = JSON.parse(clean);
    } catch(e) {
      return J({ok:false, error:'JSON parse failed: '+e.message, raw:raw.slice(0,200)}, 502);
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
