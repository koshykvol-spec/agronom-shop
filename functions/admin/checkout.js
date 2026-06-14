// /admin/checkout — оператор вмикає/вимикає способи доставки й оплати.
// Прапорці у site_settings (del_np/del_ukr/del_self/pay_cod/pay_card) → /site-config → app.js.
// Дефолт: показувати (порожнє/відсутнє != '0'); ховає лише явне '0'.
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

const PAGE = (body) => `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>Доставка й оплата</title><style>
body{font-family:system-ui;max-width:680px;margin:1.2rem auto;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2{color:#2d6a2d} h3{margin:18px 0 8px}
.btn{background:#2d6a2d;color:#fff;border:0;padding:10px 18px;border-radius:8px;cursor:pointer;font-weight:700}
.muted{color:#888;font-size:.85rem}
.box{background:#fff;border:1px solid #e3e3e3;border-radius:10px;padding:16px;margin:10px 0}
.row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #f0f0f0}
.row:last-child{border-bottom:0}
.row input[type=checkbox]{width:20px;height:20px}
.row .t{flex:1}.row .t b{font-size:1rem}.row .t span{display:block;color:#888;font-size:.82rem}
.warn{color:#b8860b}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body><div><a href="/admin">← до адмінки</a></div>${body}</body></html>`;

export async function onRequestGet(context){
  const db = context.env.DB;
  const saved = new URL(context.request.url).searchParams.get('saved');
  const ss = {};
  for (const r of (await db.prepare(`SELECT key,value FROM site_settings WHERE key IN ('del_np','del_ukr','del_self','pay_cod','pay_card','liqpay_on','seo_return_days','seo_ship_cost')`).all()).results || []) ss[r.key]=r.value;
  const on = k => ss[k] !== '0';   // дефолт — увімкнено
  const lqKeys = ss.liqpay_on === '1';   // чи задані ключі LiqPay
  const retDays = ss.seo_return_days || '14';
  const shipCost = (ss.seo_ship_cost != null && ss.seo_ship_cost !== '') ? ss.seo_ship_cost : '0';

  const cb = (name, checked, disabled) => `<input type="checkbox" name="${name}" value="1"${checked?' checked':''}${disabled?' disabled':''}>`;

  const body = `<h2>🚚 Доставка й 💳 оплата</h2>
    ${saved ? '<div class="box" style="border-color:#2d6a2d;color:#2d6a2d">✅ Збережено. Зміни видно у формі замовлення одразу.</div>' : ''}
    <form method="POST" action="/admin/checkout">
      <div class="box">
        <h3 style="margin-top:0">Способи доставки</h3>
        <label class="row">${cb('del_np', on('del_np'))}<span class="t"><b>🚚 Нова Пошта</b><span>Відділення / поштомат / курʼєр + автодоповнення</span></span></label>
        <label class="row">${cb('del_ukr', on('del_ukr'))}<span class="t"><b>📮 Укрпошта</b><span>Доставка Укрпоштою (адреса вручну)</span></span></label>
        <label class="row">${cb('del_self', on('del_self'))}<span class="t"><b>🏪 Самовивіз</b><span>Забрати в магазині</span></span></label>
        <div class="muted" style="margin-top:8px">Лишіть увімкненим хоча б один спосіб.</div>
      </div>
      <div class="box">
        <h3 style="margin-top:0">Способи оплати</h3>
        <label class="row">${cb('pay_cod', on('pay_cod'))}<span class="t"><b>💵 При отриманні</b><span>Накладений платіж / готівка при самовивозі</span></span></label>
        <label class="row">${cb('pay_card', on('pay_card') && lqKeys, !lqKeys)}<span class="t"><b>💳 Карткою онлайн (LiqPay)</b><span>${lqKeys ? 'Передоплата карткою' : '<span class="warn">недоступно — спершу додайте ключі в <a href="/admin/keys">🔑 Ключі → LiqPay</a></span>'}</span></span></label>
        <div class="muted" style="margin-top:8px">Лишіть увімкненим хоча б один спосіб.</div>
      </div>
      <div class="box">
        <h3 style="margin-top:0">🔎 SEO — дані для Google (структуровані дані товару)</h3>
        <label class="row"><span class="t"><b>↩️ Днів на повернення</b><span>За законом України — 14. Google показує бейдж «X днів на повернення».</span></span>
          <input type="number" name="seo_return_days" value="${esc(retDays)}" min="1" max="365" style="width:90px"></label>
        <label class="row"><span class="t"><b>📦 Вартість доставки, грн</b><span>0 = за тарифом перевізника / безкоштовний самовивіз. Лише для картки товару в Google.</span></span>
          <input type="number" name="seo_ship_cost" value="${esc(shipCost)}" min="0" step="1" style="width:90px"></label>
      </div>
      <button class="btn" type="submit">💾 Зберегти</button>
    </form>`;
  return new Response(PAGE(body), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function onRequestPost(context){
  const db = context.env.DB;
  const f = await context.request.formData();
  // Чекбокс присутній у formData лише коли відмічений → '1', інакше '0'.
  const set = async (k) => { await db.prepare(`INSERT OR REPLACE INTO site_settings(key,value) VALUES(?,?)`).bind(k, f.get(k) ? '1' : '0').run(); };
  for (const k of ['del_np','del_ukr','del_self','pay_cod','pay_card']) await set(k);
  // SEO-поля (текстові, не чекбокси): дні повернення + вартість доставки для структурованих даних
  for (const k of ['seo_return_days','seo_ship_cost']) await db.prepare(`INSERT OR REPLACE INTO site_settings(key,value) VALUES(?,?)`).bind(k, (f.get(k) || '').trim()).run();
  return Response.redirect(new URL('/admin/checkout?saved=1', context.request.url).toString(), 303);
}
