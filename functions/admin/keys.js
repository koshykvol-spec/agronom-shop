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

export async function onRequestGet(context){
  const db = context.env.DB;
  const saved = new URL(context.request.url).searchParams.get('saved');
  const ss = {};
  for (const r of (await db.prepare(`SELECT key,value FROM site_settings WHERE key IN ('ga4_id','clarity_id','turnstile_sitekey','anthropic_api_key','gemini_api_key')`).all()).results || []) ss[r.key]=r.value;
  // Turnstile secret — у таблиці secrets (server-only, у /site-config НЕ потрапляє). Значення не показуємо.
  let tsSecretSet = false, tsSecretTail = '';
  try { const r = await db.prepare(`SELECT value FROM secrets WHERE key='turnstile_secret'`).first(); if (r && r.value){ tsSecretSet = true; tsSecretTail = String(r.value).slice(-4); } } catch(e){}
  // LiqPay — обидва ключі у secrets (server-only). public теж не світимо у /site-config.
  let lqPub = '', lqPrivSet = false, lqPrivTail = '';
  try { const r = await db.prepare(`SELECT value FROM secrets WHERE key='liqpay_public'`).first(); if (r && r.value) lqPub = String(r.value); } catch(e){}
  try { const r = await db.prepare(`SELECT value FROM secrets WHERE key='liqpay_private'`).first(); if (r && r.value){ lqPrivSet = true; lqPrivTail = String(r.value).slice(-4); } } catch(e){}
  // Укрпошта — Bearer-токен у secrets (server-only) для автодоповнення відділень.
  let upSet = false, upTail = '';
  try { const r = await db.prepare(`SELECT value FROM secrets WHERE key='ukrposhta_token'`).first(); if (r && r.value){ upSet = true; upTail = String(r.value).slice(-4); } } catch(e){}

  const body = `<h2>🔑 Ключі та інтеграції</h2>
    ${saved ? '<div class="box ok">✅ Збережено. Для аналітики зміни діють одразу; для НП — функції підхоплять ключ без передеплою.</div>' : ''}
    <form class="box" method="POST" action="/admin/keys">
      <h3 style="margin-top:0">📊 Аналітика <span class="tag">публічні ID</span></h3>
      <div class="muted">Вмикається одразу, щойно вставите ID. Ці ID не секретні.</div>
      <div class="fl"><label>Google Analytics 4 — ID (G-XXXXXXX)</label><input name="ga4_id" value="${esc(ss.ga4_id||'')}" placeholder="G-..."></div>
      <hr style="border:0;border-top:1px solid #e8e8e8;margin:14px 0">

      <h3>🤖 AI інтеграції <span class="tag">API ключі</span></h3>

      <div class="fl"><label>Anthropic API Key ${ss.anthropic_api_key?'<span class="ok">— задано ✓</span>':'<span class="warn">— ще не задано</span>'}</label>
        <input name="anthropic_api_key" type="password" autocomplete="off" value="${ss.anthropic_api_key?'••••••••••••'+String(ss.anthropic_api_key).slice(-6):''}" placeholder="sk-ant-api03-...">
        <div class="muted" style="margin-top:3px">Ключ для розпізнавання фото хвороб/шкідників/бур'янів. Отримати на <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a></div>
      </div>

      <div class="fl"><label>Google Gemini API Key ${ss.gemini_api_key?'<span class="ok">— задано ✓</span>':'<span class="warn">— ще не задано</span>'}</label>
        <input name="gemini_api_key" type="password" autocomplete="off" value="${ss.gemini_api_key?'••••••••••••'+String(ss.gemini_api_key).slice(-6):''}" placeholder="AIzaSy...">
        <div class="muted" style="margin-top:3px">Ключ для генерації відгуків через Google Gemini. Безкоштовний тір: 60 запитів/хв. Отримати на <a href="https://ai.google.dev" target="_blank">ai.google.dev</a></div>
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
    <div class="box muted">🚚 <b>Ключ Нової Пошти</b> та відправник — на сторінці <a href="/admin/np-sender">Нова Пошта</a>.<br>🛡 <b>Secret</b> зберігається в захищеній таблиці БД (у браузер не віддається), воркер замовлень читає його звідти. Поки Sitekey+Secret не задано — форма працює без перевірки.</div>

    <div class="box muted">
      <b>Телеграм замовлень</b> (BOT_TOKEN / CHAT_ID) налаштовано в окремому Worker'і прийому замовлень — туди ключі вводяться в його змінних. Якщо треба, перенесемо і їх сюди.<br>
      <b>Пароль адмінки</b> та <b>токен деплою</b> свідомо лишаються в Cloudflare (env / .cf-secrets) — це «вхідні двері», їх не варто тримати в БД.
    </div>`;
  return new Response(PAGE(body), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function onRequestPost(context){
  const db = context.env.DB;
  const f = await context.request.formData();
  // публічні ID → site_settings (порожнє = очистити; для них це безпечно)
  for (const k of ['ga4_id','clarity_id']){
    await db.prepare(`INSERT OR REPLACE INTO site_settings(key,value) VALUES(?,?)`).bind(k, (f.get(k)||'').trim()).run();
  }
  // Anthropic API key — зберігаємо лише якщо не маска (не починається з ••)
  const anthropicKey = (f.get('anthropic_api_key')||'').trim();
  if (anthropicKey && !anthropicKey.startsWith('••')) {
    await db.prepare(`INSERT OR REPLACE INTO site_settings(key,value) VALUES(?,?)`).bind('anthropic_api_key', anthropicKey).run();
  }
  // Gemini API key — зберігаємо лише якщо не маска
  const geminiKey = (f.get('gemini_api_key')||'').trim();
  if (geminiKey && !geminiKey.startsWith('••')) {
    await db.prepare(`INSERT OR REPLACE INTO site_settings(key,value) VALUES(?,?)`).bind('gemini_api_key', geminiKey).run();
  }
  // turnstile_sitekey: захист від випадкового затирання застарілою формою — порожнє НЕ чистить.
  if (f.get('turnstile_sitekey_del')) {
    await db.prepare(`DELETE FROM site_settings WHERE key='turnstile_sitekey'`).run();
  } else {
    const sk = (f.get('turnstile_sitekey')||'').trim();
    if (sk) await db.prepare(`INSERT OR REPLACE INTO site_settings(key,value) VALUES('turnstile_sitekey',?)`).bind(sk).run();
  }
  // Turnstile secret → таблиця secrets (server-only). Видалення/заміна; порожнє — лишаємо як було.
  if (f.get('turnstile_secret_del')) {
    await db.prepare(`DELETE FROM secrets WHERE key='turnstile_secret'`).run();
  } else if (f.has('turnstile_secret')) {
    const ts = (f.get('turnstile_secret')||'').toString().trim();
    if (ts) await db.prepare(`INSERT OR REPLACE INTO secrets(key,value) VALUES('turnstile_secret',?)`).bind(ts).run();
  }
  // LiqPay public → secrets (порожнє НЕ чистить — захист від затирання). private — видалення/заміна.
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
  // Укрпошта Bearer → secrets. Видалення/заміна; порожнє — лишаємо.
  if (f.get('ukrposhta_token_del')) {
    await db.prepare(`DELETE FROM secrets WHERE key='ukrposhta_token'`).run();
  } else if (f.has('ukrposhta_token')) {
    const ut = (f.get('ukrposhta_token')||'').toString().trim();
    if (ut) await db.prepare(`INSERT OR REPLACE INTO secrets(key,value) VALUES('ukrposhta_token',?)`).bind(ut).run();
  }
  // Публічні прапорці (булеві, БЕЗ ключів) → site_settings → /site-config → app.js.
  try {
    const pub = await db.prepare(`SELECT value FROM secrets WHERE key='liqpay_public'`).first();
    const priv = await db.prepare(`SELECT value FROM secrets WHERE key='liqpay_private'`).first();
    await db.prepare(`INSERT OR REPLACE INTO site_settings(key,value) VALUES('liqpay_on',?)`).bind((pub && pub.value && priv && priv.value) ? '1' : '').run();
    const up = await db.prepare(`SELECT value FROM secrets WHERE key='ukrposhta_token'`).first();
    await db.prepare(`INSERT OR REPLACE INTO site_settings(key,value) VALUES('ukrposhta_on',?)`).bind((up && up.value) ? '1' : '').run();
  } catch(e){}
  return Response.redirect(new URL('/admin/keys?saved=1', context.request.url).toString(), 303);
}
