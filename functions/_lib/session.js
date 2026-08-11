// Спільна логіка клієнтських сесій: підписаний cookie (HMAC-SHA256), без серверного
// сховища сесій (stateless — не потрібна ще одна таблиця чи KV). Формат payload:
// "<customerId>.<expiresAtUnixSeconds>" + "." + hex(HMAC-SHA256(payload, SESSION_SECRET)).
// SESSION_SECRET — Cloudflare Pages secret (wrangler pages secret put SESSION_SECRET),
// НЕ в D1 і НЕ в git.

const COOKIE_NAME = 'agronom_session';
const MAX_AGE_SEC = 60 * 60 * 24 * 180; // 180 днів

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function createSessionCookie(env, customerId) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const payload = `${customerId}.${exp}`;
  const sig = await hmac(env.SESSION_SECRET, payload);
  const value = `${payload}.${sig}`;
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${MAX_AGE_SEC}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const parts = header.split(';').map(s => s.trim());
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx === -1) continue;
    if (p.slice(0, idx) === name) return p.slice(idx + 1);
  }
  return null;
}

// Повертає customerId (число) якщо сесія валідна й не протермінована, інакше null.
export async function getCustomerIdFromRequest(env, request) {
  const raw = readCookie(request, COOKIE_NAME);
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const [idStr, expStr, sig] = parts;
  const payload = `${idStr}.${expStr}`;
  const expected = await hmac(env.SESSION_SECRET, payload);
  if (expected !== sig) return null;              // підпис не збігається — підробка/старий секрет
  const exp = parseInt(expStr, 10);
  if (!exp || exp < Math.floor(Date.now() / 1000)) return null;  // протерміновано
  const id = parseInt(idStr, 10);
  return id || null;
}
