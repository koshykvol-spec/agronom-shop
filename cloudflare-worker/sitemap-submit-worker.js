// Щодня (за розкладом у wrangler-sitemap.toml) підписує JWT приватним ключем
// сервісного акаунта agronom-sitemap-bot і сабмітить /sitemap-main.xml у
// Google Search Console через Sitemaps API — без ручних кліків у GSC.
//
// Потрібні секрети (wrangler secret put --config wrangler-sitemap.toml):
//   GSC_CLIENT_EMAIL  — email сервісного акаунта (з JSON-ключа, поле client_email)
//   GSC_PRIVATE_KEY   — приватний ключ (з JSON-ключа, поле private_key, разом з
//                        "-----BEGIN PRIVATE KEY-----" / "-----END PRIVATE KEY-----")
//
// Сайт і файл sitemap — константи нижче, міняти тут, якщо колись зміняться.
const SITE_URL = 'https://agronom.pp.ua/';
const SITEMAP_URL = 'https://agronom.pp.ua/sitemap-main.xml';

function base64url(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\\n/g, '')   // літеральні "\n" (два символи) — так виглядає perенос рядка, скопійований прямо з JSON-файлу
    .replace(/\s+/g, '');  // справжні пробіли/переноси рядків (якщо ключ вставили вже "розгорнутим")
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function getAccessToken(env) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: env.GSC_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/webmasters',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const enc = new TextEncoder();
  const unsigned = base64url(enc.encode(JSON.stringify(header))) + '.' + base64url(enc.encode(JSON.stringify(claims)));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(env.GSC_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned));
  const jwt = unsigned + '.' + base64url(sig);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error('OAuth token error: ' + JSON.stringify(data));
  return data.access_token;
}

async function submitSitemap(env) {
  const token = await getAccessToken(env);
  const url = 'https://www.googleapis.com/webmasters/v3/sites/'
    + encodeURIComponent(SITE_URL) + '/sitemaps/' + encodeURIComponent(SITEMAP_URL);
  const res = await fetch(url, {
    method: 'PUT',
    headers: { authorization: 'Bearer ' + token }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('sitemaps.submit ' + res.status + ': ' + text);
  }
  return { ok: true, status: res.status };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get('debug') === '1') {
      const raw = env.GSC_PRIVATE_KEY || '';
      const info = {
        length: raw.length,
        startsWithQuote: raw.startsWith('"'),
        endsWithQuote: raw.endsWith('"'),
        hasBegin: raw.includes('BEGIN PRIVATE KEY'),
        hasEnd: raw.includes('END PRIVATE KEY'),
        literalBackslashN: (raw.match(/\\n/g) || []).length,
        realNewlines: (raw.match(/\n/g) || []).length,
        first20: JSON.stringify(raw.slice(0, 20)),
        last20: JSON.stringify(raw.slice(-20)),
        clientEmailLength: (env.GSC_CLIENT_EMAIL || '').length,
        clientEmailPreview: (env.GSC_CLIENT_EMAIL || '').slice(0, 15) + '...'
      };
      return new Response(JSON.stringify(info, null, 2), { headers: { 'content-type': 'application/json' } });
    }
    try {
      const result = await submitSitemap(env);
      return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
  },
  // Автоматичний запуск за розкладом cron (wrangler-sitemap.toml).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(submitSitemap(env).catch(e => console.error('sitemap submit failed:', e)));
  }
};
