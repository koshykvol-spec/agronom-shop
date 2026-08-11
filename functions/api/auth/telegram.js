// POST /api/auth/telegram — приймає дані від Telegram Login Widget (callback data-onauth),
// перевіряє автентичність за алгоритмом Telegram (HMAC-SHA256 з SHA256(bot_token) як ключем —
// https://core.telegram.org/widgets/login#checking-authorization), і за успіху ставить
// клієнтську сесію (cookie) через createSessionCookie().
import { createSessionCookie } from '../../_lib/session.js';

async function sha256Bytes(str) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)));
}
async function hmacHex(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const J = (o, s, headers) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json; charset=utf-8', ...(headers || {}) } });

export async function onRequestPost(context) {
  const db = context.env.DB;
  let data = {};
  try { data = await context.request.json(); } catch (e) { return J({ ok: false, error: 'bad json' }, 400); }

  const { hash, ...rest } = data;
  if (!hash || !rest.id) return J({ ok: false, error: 'missing fields' }, 400);

  // auth_date не старіший за добу — захист від повторного використання старих даних.
  const authDate = parseInt(rest.auth_date, 10) || 0;
  if (!authDate || (Math.floor(Date.now() / 1000) - authDate) > 86400) {
    return J({ ok: false, error: 'auth data expired, try logging in again' }, 401);
  }

  const checkString = Object.keys(rest).sort().map(k => `${k}=${rest[k]}`).join('\n');
  const secretKey = await sha256Bytes(context.env.TG_LOGIN_BOT_TOKEN || '');
  const expectedHash = await hmacHex(secretKey, checkString);
  if (expectedHash !== hash) return J({ ok: false, error: 'invalid signature' }, 401);

  const telegramId = parseInt(rest.id, 10);
  const name = [rest.first_name, rest.last_name].filter(Boolean).join(' ').slice(0, 150) || rest.username || 'Клієнт';
  const avatar = (rest.photo_url || '').toString().slice(0, 500);

  let customerId;
  try {
    const existing = await db.prepare(`SELECT id FROM customers WHERE telegram_id=?`).bind(telegramId).first();
    if (existing) {
      customerId = existing.id;
      await db.prepare(`UPDATE customers SET name=?, avatar_url=?, last_login=datetime('now') WHERE id=?`).bind(name, avatar, customerId).run();
    } else {
      const res = await db.prepare(`INSERT INTO customers(telegram_id,name,avatar_url,created_at,last_login) VALUES(?,?,?,datetime('now'),datetime('now'))`).bind(telegramId, name, avatar).run();
      customerId = res.meta && res.meta.last_row_id;
    }
  } catch (e) { return J({ ok: false, error: 'db error' }, 500); }

  const cookie = await createSessionCookie(context.env, customerId);
  return J({ ok: true, name, avatar }, 200, { 'Set-Cookie': cookie });
}
