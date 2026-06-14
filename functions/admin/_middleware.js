// Basic Auth для всіх /admin/* (логін: admin, пароль: env.ADMIN_PASSWORD).
// + CSRF-захист дій, що змінюють стан, + заборона кешування адмін-відповідей.

// GET-параметри, що ВИКОНУЮТЬ дію (а не просто показують сторінку).
// Будь-який POST також вважається дією. Нові мутуючі GET-параметри додавати сюди.
const MUTATING_GET_PARAMS = ['toggle','bulk','imgdel','imgprimary','ttn','done','reopen','del','ok'];

export async function onRequest(context) {
  const { request, env, next } = context;
  if (!env.ADMIN_PASSWORD) {
    return new Response('Адмінку не налаштовано: відсутній секрет ADMIN_PASSWORD.', { status: 500 });
  }
  const auth = request.headers.get('Authorization') || '';
  let ok = false;
  if (auth.startsWith('Basic ')) {
    let dec = '';
    try { dec = atob(auth.slice(6)); } catch (e) {}
    const i = dec.indexOf(':');
    const user = dec.slice(0, i), pw = dec.slice(i + 1);
    if (user === 'admin' && pw === env.ADMIN_PASSWORD) ok = true;
  }
  if (!ok) {
    return new Response('Потрібна авторизація', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Agronom Admin", charset="UTF-8"' }
    });
  }

  // CSRF: дія (POST або GET з мутуючим параметром) мусить надходити з самого сайту.
  // Sec-Fetch-Site шлють усі сучасні браузери і його НЕ можна підробити зі сторінки атакувальника:
  //   same-origin / none (пряма навігація) → дозволяємо; cross-site / same-site → блок.
  // Фолбек для старих браузерів — звірка host у Origin/Referer.
  const url = new URL(request.url);
  const method = request.method;
  const isMutating = (method !== 'GET' && method !== 'HEAD') ||
    (method === 'GET' && MUTATING_GET_PARAMS.some(k => url.searchParams.has(k)));
  if (isMutating) {
    const sfs = request.headers.get('Sec-Fetch-Site');
    let allowed;
    if (sfs) {
      allowed = (sfs === 'same-origin' || sfs === 'none');
    } else {
      const src = request.headers.get('Origin') || request.headers.get('Referer') || '';
      try { allowed = !!src && new URL(src).host === url.host; } catch (e) { allowed = false; }
    }
    if (!allowed) {
      return new Response('Заборонено: підозра на CSRF (крос-сайтовий запит до адмінки).', { status: 403 });
    }
  }

  // Адмін-відповіді не кешувати ніде (браузер/проксі) — захист від випадкового збереження.
  const res = await next();
  const h = new Headers(res.headers);
  h.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  h.set('Pragma', 'no-cache');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
