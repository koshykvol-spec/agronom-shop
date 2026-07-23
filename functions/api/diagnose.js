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

// ПРОБА №2: чіпаємо D1 тим самим запитом, що й у бойовій версії,
// але НЕ звертаємось до Gemini/OpenRouter. Якщо це дасть 502 — винен D1-запит.
// Якщо дасть 200 — винен виклик Gemini/OpenRouter.
export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    let body;
    try { body = await request.json(); }
    catch(e) { return J({ok:false, error:'Invalid JSON body: '+e.message}, 400); }

    const { image_b64 } = body;
    if (!image_b64) return J({ok:false, error:'No image_b64 provided'}, 400);

    const prods = (await env.DB.prepare(
      `SELECT COALESCE(NULLIF(c.display_name,''),p.name) name,
              COALESCE(c.slug,'') slug, p.price,
              COALESCE(c.active_ingredient,'') ai
       FROM products p LEFT JOIN product_content c ON c.pid=p.pid
       WHERE COALESCE(c.visible,1)=1 AND p.in_stock=1
       ORDER BY p.name LIMIT 150`
    ).all().catch(()=>({results:[]}))).results || [];

    return J({ok:true, debug:'D1 query succeeded, no AI call made', productsFound: prods.length, image_b64_length: image_b64.length});

  } catch(e) {
    return J({ok:false, error:'Worker error: '+String(e.message||e)}, 500);
  }
}
