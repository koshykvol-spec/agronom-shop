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
    // Step 1: parse formData
    let fd;
    try { fd = await request.formData(); }
    catch(e) { return J({ok:false, step:'formData', error: e.message}, 400); }

    // Step 2: get file
    const file = fd.get('photo');
    if (!file || typeof file === 'string') return J({ok:false, step:'file', error:'no file'}, 400);

    // Step 3: read DB key
    let apiKey = '';
    try {
      const row = await env.DB.prepare(
        `SELECT value FROM site_settings WHERE key='anthropic_api_key' LIMIT 1`
      ).first();
      apiKey = row && row.value ? row.value : '';
    } catch(e) { return J({ok:false, step:'db', error: e.message}, 500); }

    if (!apiKey) return J({ok:false, step:'apikey', error:'not configured'}, 503);

    // Step 4: read bytes
    let bytes;
    try { bytes = await file.arrayBuffer(); }
    catch(e) { return J({ok:false, step:'arrayBuffer', error: e.message}, 500); }

    // Step 5: base64
    let b64;
    try {
      const uint8 = new Uint8Array(bytes);
      let bin = '';
      for (let i = 0; i < uint8.length; i += 8192) {
        bin += String.fromCharCode(...uint8.subarray(i, i + 8192));
      }
      b64 = btoa(bin);
    } catch(e) { return J({ok:false, step:'base64', error: e.message}, 500); }

    // Step 6: call Claude
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
          max_tokens: 1024,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: file.type, data: b64 } },
            { type: 'text', text: 'What is in this image? Reply in JSON: {"type":"disease|pest|weed|unknown","name":"name in Ukrainian","description":"short description in Ukrainian","products":[]}' }
          ]}]
        })
      });
    } catch(e) { return J({ok:false, step:'fetch_claude', error: e.message}, 502); }

    if (!aiRes.ok) {
      const err = await aiRes.text();
      return J({ok:false, step:'claude_status', error: aiRes.status + ': ' + err.slice(0,300)}, 502);
    }

    const aiData = await aiRes.json();
    const raw = (aiData.content || []).map(b => b.text || '').join('').trim();

    let diagnosis;
    try {
      const clean = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
      diagnosis = JSON.parse(clean);
    } catch(e) {
      return J({ok:false, step:'parse_json', error: e.message, raw: raw.slice(0,300)}, 502);
    }

    return J({
      ok: true,
      type: diagnosis.type || 'unknown',
      name: diagnosis.name || '',
      confidence: 'medium',
      description: diagnosis.description || '',
      advice: '',
      products: [],
    });

  } catch(e) {
    return J({ok:false, step:'global', error: String(e.message || e)}, 500);
  }
}
