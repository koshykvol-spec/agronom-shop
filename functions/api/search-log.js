// POST /api/search-log — приймає {q, cnt} з фронтенду (navigator.sendBeacon) і пише в D1.
// Публічний ендпоінт (як і сам пошук), тому тримаємо навантаження мінімальним:
// без читань з БД, лише один INSERT, суворі ліміти на розмір і довжину.

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!env.DB) return new Response(null, { status: 204 });

    // Обмежуємо розмір тіла запиту (захист від зловживань)
    const raw = await request.text();
    if (!raw || raw.length > 2000) return new Response(null, { status: 204 });

    let data;
    try { data = JSON.parse(raw); } catch { return new Response(null, { status: 204 }); }

    let q = String(data.q || '').trim().toLowerCase().slice(0, 100);
    const cnt = Math.max(0, Math.min(9999, parseInt(data.cnt, 10) || 0));
    if (!q) return new Response(null, { status: 204 });

    await env.DB.prepare(
      `INSERT INTO search_log (q, cnt, ts) VALUES (?, ?, ?)`
    ).bind(q, cnt, Math.floor(Date.now() / 1000)).run();

    return new Response(null, { status: 204 });
  } catch (e) {
    // Логування пошуку не повинно ламати сам пошук — тихо ігноруємо помилки
    return new Response(null, { status: 204 });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': 'https://agronom.pp.ua',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
