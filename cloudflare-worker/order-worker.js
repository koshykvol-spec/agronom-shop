// ============================================================
// Cloudflare Worker — приймає замовлення з сайту «Агроном»
// і пересилає його у Telegram. Токен бота лишається на сервері
// (у секретах Worker), а не у фронтенді.
//
// Секрети (Cloudflare → Worker → Settings → Variables and Secrets,
//   тип "Secret / Encrypt"):
//     BOT_TOKEN  — токен бота від @BotFather
//     CHAT_ID    — куди слати: один id, або кілька через кому: 949692506,1846333153
//                  (особистий чат — додатнє число, група/канал — від'ємне -100…)
//   Опційно (звичайна змінна, не секрет):
//     ALLOWED_ORIGIN — точний домен сайту, напр. https://agronom.com.ua
//                      (якщо не задано — дозволені всі: '*')
//
// Фронтенд (app.js) робить:  fetch(ORDER_WORKER_URL, {method:'POST',
//   headers:{'Content-Type':'application/json'}, body: JSON.stringify({message})})
// і очікує у відповідь JSON { ok: true }.
// ============================================================

export default {
  async fetch(request, env) {
    // CORS: за замовчуванням лише наш домен (браузер уже не звертається до воркера напряму —
    // усе йде через /api/order сервер-сайд). env.ALLOWED_ORIGIN може перевизначити.
    const origin = env.ALLOWED_ORIGIN || 'https://agronom.pp.ua';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    // Preflight (браузер шле OPTIONS перед POST із JSON)
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed' }, 405, cors);
    }
    if (!env.BOT_TOKEN || !env.CHAT_ID) {
      return json({ ok: false, error: 'Worker не налаштовано: відсутні BOT_TOKEN / CHAT_ID' }, 500, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'Некоректний JSON' }, 400, cors);
    }

    let message = (body && typeof body.message === 'string') ? body.message.trim() : '';
    if (!message) {
      return json({ ok: false, error: 'Порожнє повідомлення' }, 400, cors);
    }
    // Ліміт Telegram — 4096 символів; лишаємо запас
    if (message.length > 3900) message = message.slice(0, 3900) + '…';

    // Внутрішній виклик від /api/order (Pages Function) — довірений канал.
    // Якщо X-Order-Auth збігається з secrets.order_internal_key, Turnstile не потрібен
    // (його вже перевірив /api/order). Прямий публічний виклик такого ключа не має.
    let internal = false;
    if (env.DB) {
      const ik = request.headers.get('X-Order-Auth') || '';
      if (ik) {
        try {
          const r = await env.DB.prepare("SELECT value FROM secrets WHERE key='order_internal_key'").first();
          if (r && r.value && ik === String(r.value)) internal = true;
        } catch (e) {}
      }
    }

    // Turnstile (анти-спам): секрет беремо з D1 (адмінка → 🔑 Ключі → secrets.turnstile_secret),
    // фолбек — змінна оточення TURNSTILE_SECRET. Якщо секрет задано — токен обовʼязковий.
    // Без секрету пропускаємо (працює до налаштування Turnstile).
    let tsSecret = '';
    if (env.DB) {
      try {
        const r = await env.DB.prepare("SELECT value FROM secrets WHERE key='turnstile_secret'").first();
        if (r && r.value) tsSecret = String(r.value);
      } catch (e) { /* нема біндингу/таблиці — падаємо на env */ }
    }
    if (!tsSecret) tsSecret = env.TURNSTILE_SECRET || '';
    if (!internal && tsSecret) {
      const token = (body && typeof body.turnstileToken === 'string') ? body.turnstileToken : '';
      if (!token) return json({ ok: false, error: 'Підтвердіть, що ви не робот' }, 403, cors);
      try {
        const form = new URLSearchParams();
        form.append('secret', tsSecret);
        form.append('response', token);
        const ip = request.headers.get('CF-Connecting-IP');
        if (ip) form.append('remoteip', ip);
        const vr = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
        const vd = await vr.json().catch(() => ({ success: false }));
        if (!vd.success) return json({ ok: false, error: 'Перевірка Turnstile не пройдена' }, 403, cors);
      } catch (e) {
        return json({ ok: false, error: 'Помилка перевірки Turnstile' }, 502, cors);
      }
    }

    // CHAT_ID може містити кілька отримувачів через кому/пробіл — шлемо кожному
    const recipients = String(env.CHAT_ID).split(/[\s,]+/).filter(Boolean);
    let delivered = 0;
    let lastErr = '';
    for (const chatId of recipients) {
      try {
        const tgResp = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        });
        const tgData = await tgResp.json().catch(() => ({}));
        if (tgResp.ok && tgData.ok) delivered++;
        else lastErr = tgData.description || ('HTTP ' + tgResp.status);
      } catch (e) {
        lastErr = 'Мережева помилка при зверненні до Telegram';
      }
    }
    // Успіх, якщо доставлено хоча б одному отримувачу
    if (delivered > 0) return json({ ok: true, delivered }, 200, cors);
    return json({ ok: false, error: lastErr || 'Не вдалося доставити замовлення' }, 502, cors);
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}
