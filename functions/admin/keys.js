// /admin/keys — ключі та інтеграції. Публічні ID (GA4/Clarity) у site_settings;
// секрети (NP) — у таблиці secrets, яку /site-config НІКОЛИ не віддає клієнту.
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

const PAGE = (body) => `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>Ключі</title><style>
body{font-family:system-ui;max-width:780px;margin:1.2rem auto;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2{color:#2d6a2d} h3{margin:16px 0 6px}
.btn{background:#2d6a2d;color:#fff;border:0;padding:9px 16px;border-radius:8px;cursor:pointer;font-weight:700}
.muted{color:#888;font-size:.85rem}
.box{background:#fff;border:1px solid #e3e3e3;border-radius:10px;padding:14px 16px;margin:10px 0}
.fl{margin:8px 0;display:flex;flex-direction:column;gap:3px} .fl label{font-size:.82rem;color:#555}
input{padding:8px 10px;border:1px solid #ccc;border-radius:6px;font:inherit}
.ok{color:#2d6a2d;font-weight:700} .warn{color:#b8860b}
.tag{font-size:.72rem;background:#eef;color:#556;padding:1px 7px;border-radius:6px}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body><div><a href="/admin">← до адмінки</a></div>${body}</body></html>`;

// Масив підписів для ключів за акаунтами
const ACCOUNT_LABELS = [
  'ruslanchyk@vvpc.com.ua',
  'ruslanchyk.ne@vvpc.com.ua',
  'ruslanchyk@gmail.com',
  'koshyk.vol@gmail.com',
  'galyusik.ne@vvpc.com.ua',
  'galyusik.ne@gmail.com'
];

export async function onRequestGet(context){
  const db = context.env.DB;
  const saved = new URL(context.request.url).searchParams.get('saved');
  const ss = {};
  
  // Формуємо список усіх ключів для запиту в БД (по 6 штук для кожної нейромережі)
  const keysToFetch = ['ga4_id','clarity_id','turnstile_sitekey','anthropic_api_key','gemini_api_key'];
  for (let i = 1; i <= 6; i++) {
    keysToFetch.push(`anthropic_api_key_${i}`);
    keysToFetch.push(`gemini_api_key_${i}`);
  }
  
  const placeholders = keysToFetch.map(() => '?').join(',');
  for (const r of (await db.prepare(`SELECT key,value FROM site_settings WHERE key IN (${placeholders})`).bind(...keysToFetch).all()).results || []) {
    ss[r.key] = r.value;
  }

  // Фолбек для зворотної сумісності зі старим єдиним ключем
  if (!ss.anthropic_api_key_1 && ss.anthropic_api_key) ss.anthropic_api_key_1 = ss.anthropic_api_key;
  if (!ss.gemini_api_key_1 && ss.gemini_api_key) ss.gemini_api_key_1 = ss.gemini_api_key;

  // Лічильники активних ключів
  let antCount = 0, gemCount = 0;
  for (let i = 1; i <= 6; i++) {
    if (ss[`anthropic_api_key_${i}`]) antCount++;
    if (ss[`gemini_api_key_${i}`]) gemCount++;
  }

  // Turnstile secret
  let tsSecretSet = false, tsSecretTail = '';
  try { const r = await db.prepare(`SELECT value FROM secrets WHERE key='turnstile_secret'`).first(); if (r && r.value){ tsSecretSet = true; tsSecretTail = String(r.value).slice(-4); } } catch(e){}

  // LiqPay
  let lqPub = '', lqPrivSet = false, lqPrivTail = '';
  try { const r = await db.prepare(`SELECT value FROM secrets WHERE key='liqpay_public'`).first(); if (r && r.value) lqPub = String(r.value); } catch(e){}
  try { const r = await db.prepare(`SELECT value FROM secrets WHERE key='liqpay_private'`).first(); if (r && r.value){ lqPrivSet = true; lqPrivTail = String(r.value).slice(-4); } } catch(e){}

  // Укрпошта
  let upSet = false, upTail = '';
  try { const r = await db.prepare(`SELECT value FROM secrets WHERE key='ukrposhta_token'`).first(); if (r && r.value){ upSet = true; upTail = String(r.value).slice(-4); } } catch(e){}

  // Генерація HTML-полів для Claude (6 полів)
  let anthropicFieldsHtml = '';
  for (let i = 1; i <= 6; i++) {
    const val = ss[`anthropic_api_key_${i}`];
    const label = ACCOUNT_LABELS[i - 1];
    anthropicFieldsHtml += `
      <div class="fl" style="margin-top:6px">
        <label>Ключ <b>${label}</b> ${val ? '<span class="ok">— задано ✓</span>' : '<span class="warn">— порожньо</span>'}</label>
        <input name="anthropic_api_key_${i}" type="password" autocomplete="off" value="${val ? '••••••••••••' + String(val).slice(-6) : ''}" placeholder="sk-ant-api03-...">
      </div>`;
  }

  // Генерація HTML-полів для Gemini (6 полів)
  let geminiFieldsHtml = '';
  for (let i = 1; i <= 6; i++) {
    const val = ss[`gemini_api_key_${i}`];
    const label = ACCOUNT_LABELS[i - 1];
    geminiFieldsHtml += `
      <div class="fl" style="margin-top:6px">
        <label>Ключ <b>${label}</b> ${val ? '<span class="ok">— задано ✓</span>' : '<span class="warn">— порожньо</span>'}</label>
        <input name="gemini_api_key_${i}" type="password" autocomplete="off" value="${val ? '••••••••••••' + String(val).slice(-6) : ''}" placeholder="AIzaSy...">
      </div>`;
  }

  const body = `<h2>🔑 Ключі та інтеграції</h2>
    ${saved ? '<div class="box ok">✅ Збережено. Нові ключі підхопляться автоматично.</div>' : ''}
    <form class="box" method="POST" action="/admin/keys">
      <h3 style="margin-top:0">📊 Аналітика <span class="tag">публічні ID</span></h3>
      <div class="muted">Вмикається одразу, щойно вставите ID. Ці ID не секретні.</div>
      <div class="fl"><label>Google Analytics 4 — ID (G-XXXXXXX)</label><input name="ga4_id" value="${esc(ss.ga4_id||'')}" placeholder="G-..."></div>
      <hr style="border:0;border-top:1px solid #e8e8e8;margin:14px 0">

      <h3>🤖 AI інтеграції <span class="tag">API ключі (Пули для ротації)</span></h3>
      <div class="muted">Задайте по декілька ключів з різних акаунтів для автоматичної ротації та обходу лімітів (503 / 429).</div>

      <div style="background:#f9fbf9;border:1px solid #e1eee1;padding:12px;border-radius:8px;margin:10px 0;">
        <b style="color:#2d6a2d">Anthropic (Claude) API Keys</b> 
        ${antCount > 0 ? `<span class="ok">— задано ${antCount} з 6 ✓</span>` : '<span class="warn">— ще не задано</span>'}
        <div class="muted" style="margin-bottom:8px">Отримати на <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a></div>
        ${anthropicFieldsHtml}
      </div>

      <div style="background:#f9fbf9;border:1px solid #e1eee1;padding:12px;border-radius:8px;margin:10px 0;">
        <b style="color:#2d6a2d">Google Gemini API Keys</b> 
        ${gemCount > 0 ? `<span class="ok">— задано ${gemCount} з 6 ✓</span>` : '<span class="warn">— ще не задано</span>'}
        <div class="muted" style="margin-bottom:8px">Отримати на <a href="https://ai.google.dev" target="_blank">ai.google.dev</a></div>
        ${geminiFieldsHtml}
      </div>

      <div class="fl"><label>Microsoft Clarity — ID</label><input name="clarity_id" value="${esc(ss.clarity_id||'')}" placeholder="напр. abcdef1234"></div>

      <h3>🛡 Turnstile <span class="tag">анти-спам</span></h3>
      <div class="muted">Захист форми замовлення від ботів. Cloudflare → Turnstile → Add site → отримаєш <b>Sitekey</b> і <b>Secret</b> — обидва встав сюди.</div>
      <div class="fl"><label>Sitekey (публічний) ${ss.turnstile_sitekey?'<span class="ok">— задано ✓</span>':'<span class="warn">— ще не задано</span>'}</label><input name="turnstile_sitekey" value="${esc(ss.turnstile_sitekey||'')}" placeholder="0x4AAAA..."></div>
      ${ss.turnstile_sitekey?'<label class="muted" style="display:flex;gap:6px;align-items:center;margin-top:2px"><input type="checkbox" name="turnstile_sitekey_del" style="width:auto"> видалити sitekey (прибрати віджет із форми)</label>':''}
      <div class="fl"><label>Secret key (секретний) ${tsSecretSet?`<span class="ok">— задано ✓ (…${esc(tsSecretTail)})</span>`:'<span class="warn">— ще не задано</span>'}</label>
        <input name="turnstile_secret" autocomplete="off" placeholder="${tsSecretSet?'новий secret — порожньо щоб не міняти':'0x4AAAA... (Secret key з Cloudflare)'}"></div>
      ${tsSecretSet?'<label class="muted" style="display:flex;gap:6px;align-items:center;margin-top:2px"><input type="checkbox" name="turnstile_secret_del" style="width:auto"> видалити secret (вимкнути перевірку на сервері)</label>':''}

      <h3>💳 LiqPay <span class="tag">онлайн-оплата</span></h3>
      <div class="muted">Оплата карткою (опція поряд із НП-післяоплатою). Ключі — Приват24 для бізнесу → LiqPay → Налаштування → API. У server_url вкажіть <code>https://agronom.pp.ua/api/liqpay-callback</code>.</div>
      <div class="fl"><label>Public key ${lqPub?'<span class="ok">— задано ✓</span>':'<span class="warn">— ще не задано</span>'}</label><input name="liqpay_public" value="${esc(lqPub)}" placeholder="i00000000000"></div>
      <div class="fl"><label>Private key (секретний) ${lqPrivSet?`<span class="ok">— задано ✓ (…${esc(lqPrivTail)})</span>`:'<span class="warn">— ще не задано</span>'}</label>
        <input name="liqpay_private" autocomplete="off" placeholder="${lqPrivSet?'новий private — порожньо щоб не міняти':'sandbox_… або робочий private key'}"></div>
      ${lqPrivSet?'<label class="muted" style="display:flex;gap:6px;align-items:center;margin-top:2px"><input type="checkbox" name="liqpay_private_del" style="width:auto"> видалити private (вимкнути онлайн-оплату)</label>':''}

      <h3>📮 Укрпошта <span class="tag">автодоповнення</span></h3>
      <div class="muted">Bearer-токен (UUID) з кабінету Укрпошти (заявка через cabinet.ukrposhta.ua / support). Дає автодоповнення відділень у формі замовлення. Без токена — адреса вводиться вручну.</div>
      <div class="fl"><label>Bearer-токен ${upSet?`<span class="ok">— задано ✓ (…${esc(upTail)})</span>`:'<span class="warn">— ще не задано</span>'}</label>
        <input name="ukrposhta_token" autocomplete="off" placeholder="${upSet?'новий токен — порожньо щоб не міняти':'a1b2c3d4-… (Bearer UUID)'}"></div>
      ${upSet?'<label class="muted" style="display:flex;gap:6px;align-items:center;margin-top:2px"><input type="checkbox" name="ukrposhta_token_del" style="width:auto"> видалити токен (вимкнути автодоповнення)</label>':''}

      <div style="margin-top:14px"><button class="btn" type="submit">💾 Зберегти</button></div>
    </form>
    <div class="box muted">🚚 <b>Ключ Нової Пошти</b> та відправник — на сторінці <a href="/admin/np-sender">Нова Пошта</a>.</div>`;

  return new Response(PAGE(body), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function onRequestPost(context){
  const db = context.env.DB;
  const f = await context.request.formData();

  // Публічні ID
  for (const k of ['ga4_id','clarity_id']){
    await db.prepare(`INSERT OR REPLACE INTO site_settings(key,value) VALUES(?,?)`).bind(k, (f.get(k)||'').trim()).run();
  }

  // Обробка 6 ключів Anthropic API
  let firstAntKey = '';
  for (let i = 1; i <= 6; i++) {
    const keyName = `anthropic_api_key_${i}`;
    const val = (f.get(keyName) || '').trim();
    if (val && !val.startsWith('••')) {
      await db.prepare(`INSERT OR REPLACE INTO site_settings(key,value) VALUES(?,?)`).bind(keyName, val).run();
      if (!firstAntKey) firstAntKey = val;
    } else if (val === '') {
      await db.prepare(`DELETE FROM site_settings WHERE key=?`).bind(keyName).run();
    }
  }
  // Забезпечуємо сумісність зі старим кодом (записуємо перший валідний ключ в anthropic_api_key)
  if (firstAntKey) {
    await db.prepare(`INSERT OR REPLACE INTO site_settings(key,value) VALUES('anthropic_api_key',?)`).bind(firstAntKey).run();
  }

  // Обробка 6 ключів Gemini API
  let firstGemKey = '';
  for (let i = 1; i <= 6; i++) {
    const keyName = `gemini_api_key_${i}`;
    const val = (f.get(keyName) || '').trim();
    if (val && !val.startsWith('••')) {
      await db.prepare(`INSERT OR REPLACE INTO site_settings(key,value) VALUES(?,?)`).bind(keyName, val).run();
      if (!firstGemKey) firstGemKey = val;
    } else if (val === '') {
      await db.prepare(`DELETE FROM site_settings WHERE key=?`).bind(keyName).run();
    }
  }
  // Забезпечуємо сумісність зі старим кодом (записуємо перший валідний ключ в gemini_api_key)
  if (firstGemKey) {
    await db.prepare(`INSERT OR REPLACE INTO site_settings(key,value) VALUES('gemini_api_key',?)`).bind(firstGemKey).run();
  }

  // Turnstile sitekey
  if (f.get('turnstile_sitekey_del')) {
    await db.prepare(`DELETE FROM site_settings WHERE key='turnstile_sitekey'`).run();
  } else {
    const sk = (f.get('turnstile_sitekey')||'').trim();
    if (sk) await db.prepare(`INSERT OR REPLACE INTO site_settings(key,value) VALUES('turnstile_sitekey',?)`).bind(sk).run();
  }

  // Turnstile secret
  if (f.get('turnstile_secret_del')) {
    await db.prepare(`DELETE FROM secrets WHERE key='turnstile_secret'`).run();
  } else if (f.has('turnstile_secret')) {
    const ts = (f.get('turnstile_secret')||'').toString().trim();
    if (ts) await db.prepare(`INSERT OR REPLACE INTO secrets(key,value) VALUES('turnstile_secret',?)`).bind(ts).run();
  }

  // LiqPay
  if (f.has('liqpay_public')) {
    const lp = (f.get('liqpay_public')||'').toString().trim();
    if (lp) await db.prepare(`INSERT OR REPLACE INTO secrets(key,value) VALUES('liqpay_public',?)`).bind(lp).run();
  }
  if (f.get('liqpay_private_del')) {
    await db.prepare(`DELETE FROM secrets WHERE key='liqpay_private'`).run();
  } else if (f.has('liqpay_private')) {
    const lpriv = (f.get('liqpay_private')||'').toString().trim();
    if (lpriv) await db.prepare(`INSERT OR REPLACE INTO secrets(key,value) VALUES('liqpay_private',?)`).bind(lpriv).run();
  }

  // Укрпошта Bearer
  if (f.get('ukrposhta_token_del')) {
    await db.prepare(`DELETE FROM secrets WHERE key='ukrposhta_token'`).run();
  } else if (f.has('ukrposhta_token')) {
    const ut = (f.get('ukrposhta_token')||'').toString().trim();
    if (ut) await db.prepare(`INSERT OR REPLACE INTO secrets(key,value) VALUES('ukrposhta_token',?)`).bind(ut).run();
  }

  // Оновлення прапорців у site_settings
  try {
    const pub = await db.prepare(`SELECT value FROM secrets WHERE key='liqpay_public'`).first();
    const priv = await db.prepare(`SELECT value FROM secrets WHERE key='liqpay_private'`).first();
    await db.prepare(`INSERT OR REPLACE INTO site_settings(key,value) VALUES('liqpay_on',?)`).bind((pub && pub.value && priv && priv.value) ? '1' : '').run();
    const up = await db.prepare(`SELECT value FROM secrets WHERE key='ukrposhta_token'`).first();
    await db.prepare(`INSERT OR REPLACE INTO site_settings(key,value) VALUES('ukrposhta_on',?)`).bind((up && up.value) ? '1' : '').run();
  } catch(e){}

  return Response.redirect(new URL('/admin/keys?saved=1', context.request.url).toString(), 303);
}
