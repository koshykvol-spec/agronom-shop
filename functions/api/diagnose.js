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

// ТИМЧАСОВА ДІАГНОСТИЧНА ВЕРСІЯ: нічого не робить, крім підтвердження POST.
// Якщо це теж дасть 502 — проблема не в D1 і не в Gemini/OpenRouter, а десь ще
// (напр. в самій платформі чи в тому, як Pages обробляє POST-тіло).
export async function onRequestPost(context) {
  try {
    const { request } = context;
    let body = null;
    try { body = await request.json(); } catch(e) { body = {parse_error: String(e)}; }
    return J({ok:true, debug:'POST received, no DB/AI touched', bodyKeys: body ? Object.keys(body) : null});
  } catch(e) {
    return J({ok:false, error:'Worker error: '+String(e.message||e)}, 500);
  }
}
