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

async function getOneKey(db, prefix) {
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
  return keys[0] || null;
}

// ПРОБА №5: повний D1 + повний промпт + виклик ЛИШЕ OpenRouter (Gemini пропускаємо).
export async function onRequestPost(context) {
  const { request, env } = context;
  const checkpoints = [];
  try {
    checkpoints.push('start');
    let body;
    try { body = await request.json(); }
    catch(e) { return J({ok:false, error:'Invalid JSON body: '+e.message, checkpoints}, 400); }
    checkpoints.push('body parsed, len=' + (body.image_b64 ? body.image_b64.length : 0));

    const { image_b64, image_type } = body;
    if (!image_b64) return J({ok:false, error:'No image_b64 provided', checkpoints}, 400);

    const prods = (await env.DB.prepare(
      `SELECT COALESCE(NULLIF(c.display_name,''),p.name) name,
              COALESCE(c.slug,'') slug, p.price,
              COALESCE(c.active_ingredient,'') ai
       FROM products p LEFT JOIN product_content c ON c.pid=p.pid
       WHERE COALESCE(c.visible,1)=1 AND p.in_stock=1
       ORDER BY p.name LIMIT 150`
    ).all().catch(()=>({results:[]}))).results || [];
    checkpoints.push('D1 done, products=' + prods.length);

    const prodList = prods.map(p => p.name + (p.ai ? ' ('+p.ai+')' : '')).join('\n');

    const sys = 'You are an agronomist for a Ukrainian garden shop. '
      + 'Identify plant diseases, pests, or weeds from photos. '
      + 'Respond ONLY in valid JSON without markdown. Use Ukrainian language.\n\nCATALOG:\n' + prodList;
    checkpoints.push('sys built, len=' + sys.length);

    const prompt = 'Identify what is in this photo. Return JSON only:\n'
      + '{"type":"disease|pest|weed|unknown","name":"Ukrainian name",'
      + '"confidence":"high|medium|low","description":"2-3 sentences in Ukrainian",'
      + '"advice":"treatment advice in Ukrainian",'
      + '"products":["exact name from catalog"]}';
    checkpoints.push('prompt built');

    const orKey = await getOneKey(env.DB, 'openrouter_api_key');
    checkpoints.push('OR key fetched: ' + (orKey ? 'yes, len=' + orKey.length : 'NO KEY FOUND'));
    if (!orKey) return J({ok:false, error:'no openrouter key in site_settings', checkpoints}, 500);

    const reqBodyObj = {
      model: 'google/gemini-2.0-flash-exp:free',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${image_type||'image/jpeg'};base64,${image_b64}` } }
        ]}
      ]
    };
    const reqBodyStr = JSON.stringify(reqBodyObj);
    checkpoints.push('reqBodyStr stringified, len=' + reqBodyStr.length);

    let res;
    try {
      res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Authorization': 'Bearer ' + orKey,
          'HTTP-Referer': 'https://agronom.pp.ua',
          'X-Title': 'Agronom Diagnose',
        },
        body: reqBodyStr
      });
    } catch (fetchErr) {
      return J({ok:false, stage:'fetch threw', error: String(fetchErr && fetchErr.message || fetchErr), checkpoints}, 500);
    }
    checkpoints.push('fetch returned, status=' + res.status);

    const text = await res.text().catch(e => '(could not read: '+e+')');
    checkpoints.push('body read, len=' + text.length);

    return J({
      ok: res.ok,
      openrouterStatus: res.status,
      openrouterBodyPreview: text.slice(0, 500),
      checkpoints,
    }, 200);

  } catch(e) {
    return J({ok:false, stage:'outer catch', error:'Worker error: '+String(e.message||e), checkpoints}, 500);
  }
}
