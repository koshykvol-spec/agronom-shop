// /api/review — приймає відгук з форми на сторінці товару. Зберігає approved=0 (на модерацію).
export async function onRequestPost(context) {
  const db = context.env.DB;
  const f = await context.request.formData();
  const slug = (f.get('slug') || '').toString().trim();
  const back = slug ? ('/p/' + slug) : '/';
  const url = new URL(back + '?r=thanks', context.request.url).toString();

  // honeypot: ботів, що заповнили приховане поле, тихо ігноруємо
  if ((f.get('website') || '').toString().trim()) return Response.redirect(url, 303);

  // Turnstile (анти-спам): якщо секрет заданий — токен обовʼязковий
  let tsSecret = '';
  try { const r = await db.prepare(`SELECT value FROM secrets WHERE key='turnstile_secret'`).first(); if (r && r.value) tsSecret = String(r.value); } catch (e) {}
  if (tsSecret) {
    const robotUrl = new URL(back + '?r=robot', context.request.url).toString();
    const token = (f.get('cf-turnstile-response') || '').toString();
    if (!token) return Response.redirect(robotUrl, 303);
    try {
      const form = new URLSearchParams();
      form.append('secret', tsSecret); form.append('response', token);
      const ip = context.request.headers.get('CF-Connecting-IP'); if (ip) form.append('remoteip', ip);
      const vr = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
      const vd = await vr.json().catch(() => ({ success: false }));
      if (!vd.success) return Response.redirect(robotUrl, 303);
    } catch (e) { return Response.redirect(robotUrl, 303); }
  }

  const pid = parseInt(f.get('pid'), 10);
  const name = (f.get('name') || '').toString().trim().slice(0, 80) || 'Покупець';
  let rating = parseInt(f.get('rating'), 10); if (!(rating >= 1 && rating <= 5)) rating = 5;
  const text = (f.get('text') || '').toString().trim().slice(0, 2000);

  if (pid && text) {
    try {
      await db.prepare(`INSERT INTO reviews(pid,name,rating,text,approved,created_at) VALUES(?,?,?,?,0,?)`)
        .bind(pid, name, rating, text, new Date().toISOString().slice(0, 10)).run();
    } catch (e) {}
  }
  return Response.redirect(url, 303);
}
