// POST /api/auth/google — приймає id_token від Google Identity Services (кнопка "Увійти через Google"),
// перевіряє його автентичність через офіційний tokeninfo-ендпоінт Google (простіше й надійніше, ніж
// самостійно перевіряти підпис RS256 проти JWKS, що ротується) і звіряє aud з нашим Client ID.
import { createSessionCookie } from '../../_lib/session.js';

const J = (o, s, headers) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json; charset=utf-8', ...(headers || {}) } });

export async function onRequestPost(context) {
  const db = context.env.DB;
  let body = {};
  try { body = await context.request.json(); } catch (e) { return J({ ok: false, error: 'bad json' }, 400); }
  const idToken = (body.credential || '').toString();
  if (!idToken) return J({ ok: false, error: 'missing credential' }, 400);

  let info;
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken));
    if (!r.ok) return J({ ok: false, error: 'invalid google token' }, 401);
    info = await r.json();
  } catch (e) { return J({ ok: false, error: 'google verify failed' }, 502); }

  if (!info || !info.sub) return J({ ok: false, error: 'invalid token payload' }, 401);
  if (info.aud !== context.env.GOOGLE_CLIENT_ID) return J({ ok: false, error: 'client id mismatch' }, 401);
  if (info.iss !== 'https://accounts.google.com' && info.iss !== 'accounts.google.com') return J({ ok: false, error: 'invalid issuer' }, 401);

  const googleSub = info.sub;
  const name = (info.name || info.email || 'Клієнт').toString().slice(0, 150);
  const avatar = (info.picture || '').toString().slice(0, 500);
  const email = (info.email || '').toString().slice(0, 200);

  let customerId;
  try {
    const existing = await db.prepare(`SELECT id FROM customers WHERE google_sub=?`).bind(googleSub).first();
    if (existing) {
      customerId = existing.id;
      await db.prepare(`UPDATE customers SET name=?, avatar_url=?, email=?, last_login=datetime('now') WHERE id=?`).bind(name, avatar, email, customerId).run();
    } else {
      const res = await db.prepare(`INSERT INTO customers(google_sub,name,avatar_url,email,created_at,last_login) VALUES(?,?,?,?,datetime('now'),datetime('now'))`).bind(googleSub, name, avatar, email).run();
      customerId = res.meta && res.meta.last_row_id;
    }
  } catch (e) { return J({ ok: false, error: 'db error' }, 500); }

  const cookie = await createSessionCookie(context.env, customerId);
  return J({ ok: true, name, avatar }, 200, { 'Set-Cookie': cookie });
}
