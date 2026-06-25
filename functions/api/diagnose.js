export async function onRequestGet() {
  return new Response(JSON.stringify({ok:true,msg:'alive'}), {
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
    // Step 1: formData
    let fd;
    try { fd = await request.formData(); }
    catch(e) { return J({ok:false, step:'formData', error: e.message}); }

    // Step 2: file
    const file = fd.get('photo');
    if (!file || typeof file === 'string') return J({ok:false, step:'no_file'});

    // Step 3: DB
    let apiKey = '';
    try {
      const row = await env.DB.prepare(
        `SELECT value FROM site_settings WHERE key='anthropic_api_key' LIMIT 1`
      ).first();
      apiKey = row && row.value ? row.value.trim() : '';
    } catch(e) { return J({ok:false, step:'db_error', error: e.message}); }

    // Step 4: test external fetch (httpbin замість anthropic)
    let testFetch = 'not_tested';
    try {
      const tr = await fetch('https://httpbin.org/get', {method:'GET'});
      testFetch = 'ok_' + tr.status;
    } catch(e) {
      testFetch = 'error_' + e.message;
    }

    return J({
      ok: true,
      step: 'all_checks_passed',
      file_name: file.name || 'unknown',
      file_type: file.type,
      file_size: file.size,
      api_key_set: apiKey.length > 0,
      api_key_prefix: apiKey.slice(0, 15),
      external_fetch: testFetch,
    });

  } catch(e) {
    return J({ok:false, step:'global', error: String(e.message || e)}, 500);
  }
}
