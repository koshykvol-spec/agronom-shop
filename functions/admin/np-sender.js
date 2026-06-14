// /admin/np-sender — налаштування відправника НП (для авто-ТТН) + дефолти накладної.
// Тягне контрагента/контакт із кабінету НП ключем (secrets.np_api_key); зберігає refs у secrets,
// дефолти ТТН — у site_settings. Сторінка під Basic Auth (_middleware).
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

async function npCall(key, modelName, calledMethod, props){
  try {
    const r = await fetch('https://api.novaposhta.ua/v2.0/json/', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ apiKey:key, modelName, calledMethod, methodProperties: props||{} })
    });
    const d = await r.json();
    return (d && d.data) || [];
  } catch(e){ return []; }
}

const PAGE = (body) => `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>Відправник НП</title><style>
body{font-family:system-ui;max-width:760px;margin:1.2rem auto;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2{color:#2d6a2d} h3{margin:16px 0 6px}
.btn{background:#2d6a2d;color:#fff;border:0;padding:9px 16px;border-radius:8px;cursor:pointer;font-weight:700}
.muted{color:#888;font-size:.85rem}
.box{background:#fff;border:1px solid #e3e3e3;border-radius:10px;padding:14px 16px;margin:10px 0}
.fl{margin:8px 0;display:flex;flex-direction:column;gap:3px}.fl label{font-size:.82rem;color:#555}
input,select{padding:8px 10px;border:1px solid #ccc;border-radius:6px;font:inherit}
.ok{color:#2d6a2d;font-weight:700}.warn{color:#b8860b}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body><div><a href="/admin">← до адмінки</a> · <a href="/admin/keys">🔑 Ключі</a></div>${body}</body></html>`;

export async function onRequestGet(context){
  const db = context.env.DB;
  const saved = new URL(context.request.url).searchParams.get('saved');

  let key = '', npSet = false, npTail = '';
  try { const r = await db.prepare(`SELECT value FROM secrets WHERE key='np_api_key'`).first(); if (r && r.value){ key = r.value; npSet = true; npTail = String(r.value).slice(-4); } } catch(e){}
  if (!key) key = context.env.NP_API_KEY || '';

  const keyBox = `<form class="box" method="POST" action="/admin/np-sender">
    <h3 style="margin-top:0">🔑 Ключ API Нової Пошти</h3>
    <div class="muted">Кабінет НП → Налаштування → Безпека → Ключі API. Зберігається захищено, у браузер не віддається.</div>
    <div class="fl"><label>Статус: ${npSet ? '<span class="ok">✓ встановлено (…'+esc(npTail)+')</span>' : '<span class="warn">не задано</span>'}</label>
      <input name="np_api_key" autocomplete="off" placeholder="${npSet?'новий ключ — порожньо лишити':'вставте ключ API Нової Пошти'}"></div>
    ${npSet ? '<label class="muted"><input type="checkbox" name="np_clear" value="1"> видалити ключ</label><br>' : ''}
    <button class="btn" type="submit" style="margin-top:8px">💾 Зберегти ключ</button>
  </form>`;

  if (!key) return new Response(PAGE('<h2>🚚 Нова Пошта</h2>' + keyBox + '<div class="muted">Введіть ключ вище й збережіть — тоді налаштуємо відправника та увімкнемо автодоповнення/ТТН.</div>'), { headers:{'content-type':'text/html; charset=utf-8'} });

  // тягнемо контрагента-відправника + контактну особу
  const cps = await npCall(key, 'Counterparty', 'getCounterparties', { CounterpartyProperty:'Sender', Page:'1' });
  const cp = cps[0] || {};
  let contacts = [];
  if (cp.Ref) contacts = await npCall(key, 'Counterparty', 'getCounterpartyContactPersons', { Ref: cp.Ref, Page:'1' });
  const ct = contacts[0] || {};

  // збережені значення
  const sec = {}; for (const r of (await db.prepare(`SELECT key,value FROM secrets WHERE key LIKE 'np_sender_%'`).all()).results || []) sec[r.key]=r.value;
  const ss = {}; for (const r of (await db.prepare(`SELECT key,value FROM site_settings WHERE key LIKE 'ttn_%'`).all()).results || []) ss[r.key]=r.value;

  const cpRef = sec.np_sender_counterparty || cp.Ref || '';
  const cpName = cp.Description || sec.np_sender_name || '';
  const ctRef = sec.np_sender_contact || ct.Ref || '';
  const ctName = ct.Description || sec.np_sender_contact_name || '';
  const phone = sec.np_sender_phone || ct.Phones || '';

  const body = `<h2>🚚 Нова Пошта</h2>
    ${saved ? '<div class="box ok">✅ Збережено. Тепер у /admin/orders зʼявиться кнопка «Створити ТТН».</div>' : ''}
    ${keyBox}
    <div class="box"><b>Контрагент-відправник (з кабінету НП):</b><br>
      🏢 ${cpName ? esc(cpName) : '<span class="warn">не знайдено — створіть відправника в кабінеті НП</span>'}<br>
      👤 контакт: ${ctName ? esc(ctName) : '—'} · 📞 ${phone ? esc(phone) : '—'}
    </div>
    <form method="POST" action="/admin/np-sender">
      <input type="hidden" name="np_sender_counterparty" value="${esc(cpRef)}">
      <input type="hidden" name="np_sender_name" value="${esc(cpName)}">
      <input type="hidden" name="np_sender_contact" value="${esc(ctRef)}">
      <input type="hidden" name="np_sender_contact_name" value="${esc(ctName)}">
      <div class="fl"><label>Телефон відправника (з кодом, напр. 380XXXXXXXXX)</label><input name="np_sender_phone" value="${esc(phone)}"></div>

      <h3>📦 Відділення відправлення (звідки шлеш)</h3>
      <div class="grid2">
        <div class="fl"><label>Місто</label><input id="snd-city" list="snd-city-list" autocomplete="off" value="${esc(sec.np_sender_city_name||'')}" placeholder="почніть вводити"><datalist id="snd-city-list"></datalist></div>
        <div class="fl"><label>Відділення</label><input id="snd-wh" list="snd-wh-list" autocomplete="off" value="${esc(sec.np_sender_wh_name||'')}" placeholder="оберіть"><datalist id="snd-wh-list"></datalist></div>
      </div>
      <input type="hidden" name="np_sender_city_ref" id="snd-city-ref" value="${esc(sec.np_sender_city_ref||'')}">
      <input type="hidden" name="np_sender_city_name" id="snd-city-name" value="${esc(sec.np_sender_city_name||'')}">
      <input type="hidden" name="np_sender_wh_ref" id="snd-wh-ref" value="${esc(sec.np_sender_wh_ref||'')}">
      <input type="hidden" name="np_sender_wh_name" id="snd-wh-name" value="${esc(sec.np_sender_wh_name||'')}">

      <h3>🧾 Дефолти накладної</h3>
      <div class="grid2">
        <div class="fl"><label>Платник доставки</label><select name="ttn_payer"><option value="Recipient"${ss.ttn_payer!=='Sender'?' selected':''}>Одержувач (клієнт)</option><option value="Sender"${ss.ttn_payer==='Sender'?' selected':''}>Відправник (магазин)</option></select></div>
        <div class="fl"><label>Оплата</label><select name="ttn_payment"><option value="Cash"${ss.ttn_payment!=='NonCash'?' selected':''}>Готівка</option><option value="NonCash"${ss.ttn_payment==='NonCash'?' selected':''}>Безготівка</option></select></div>
        <div class="fl"><label>Тип вантажу</label><select name="ttn_cargo_type"><option value="Parcel"${ss.ttn_cargo_type!=='Cargo'?' selected':''}>Посилка</option><option value="Cargo"${ss.ttn_cargo_type==='Cargo'?' selected':''}>Вантаж</option></select></div>
        <div class="fl"><label>Вага за замовч., кг (якщо не вагове)</label><input name="ttn_weight" type="number" step="0.1" value="${esc(ss.ttn_weight||'0.5')}"></div>
        <div class="fl"><label>Накладений платіж (за замовч.)</label><select name="ttn_cod"><option value="1"${ss.ttn_cod!=='0'?' selected':''}>Так — одержувач платить за товар при отриманні</option><option value="0"${ss.ttn_cod==='0'?' selected':''}>Ні (передоплата)</option></select></div>
      </div>
      <div class="fl"><label>Опис вантажу</label><input name="ttn_cargo_desc" value="${esc(ss.ttn_cargo_desc||'Агротовари')}"></div>

      <div style="margin-top:14px"><button class="btn" type="submit">💾 Зберегти відправника</button></div>
    </form>
    <div class="muted" style="margin-top:8px">⚠️ «За рахунок відправника» = доставка лише до відділення (курʼєр за твій рахунок не створюється).</div>

    <datalist id="np-city-list"></datalist>
    <script>
    (function(){
      var cityMap={}, whMap={};
      function deb(fn,ms){var t;return function(){clearTimeout(t);t=setTimeout(fn,ms);};}
      var city=document.getElementById('snd-city'), wh=document.getElementById('snd-wh');
      var fillCity=deb(function(){var q=city.value.trim();if(q.length<2)return;
        fetch('/api/np?type=city&q='+encodeURIComponent(q)).then(function(r){return r.json();}).then(function(d){
          var dl=document.getElementById('snd-city-list');dl.innerHTML='';cityMap={};
          (d.items||[]).forEach(function(it){var o=document.createElement('option');o.value=it.name;dl.appendChild(o);cityMap[it.name]=it.ref;});
        });},250);
      var fillWh=deb(function(){var c=city.value.trim();if(!c)return;
        fetch('/api/np?type=wh&ref='+encodeURIComponent(cityMap[c]||document.getElementById('snd-city-ref').value||'')+'&city='+encodeURIComponent(c)+'&q='+encodeURIComponent(wh.value.trim())).then(function(r){return r.json();}).then(function(d){
          var dl=document.getElementById('snd-wh-list');dl.innerHTML='';whMap={};
          (d.items||[]).forEach(function(it){var o=document.createElement('option');o.value=it.name;dl.appendChild(o);whMap[it.name]=it.ref;});
        });},250);
      city.addEventListener('input',function(){fillCity();
        document.getElementById('snd-city-name').value=city.value;
        if(cityMap[city.value])document.getElementById('snd-city-ref').value=cityMap[city.value];});
      wh.addEventListener('focus',fillWh); wh.addEventListener('input',function(){fillWh();
        document.getElementById('snd-wh-name').value=wh.value;
        if(whMap[wh.value])document.getElementById('snd-wh-ref').value=whMap[wh.value];});
    })();
    </script>`;
  return new Response(PAGE(body), { headers:{'content-type':'text/html; charset=utf-8'} });
}

export async function onRequestPost(context){
  const db = context.env.DB;
  const f = await context.request.formData();
  // Ключ НП (порожньо = не чіпати; чекбокс = видалити). Окрема форма ключа.
  if (f.has('np_clear') && f.get('np_clear')) {
    await db.prepare(`DELETE FROM secrets WHERE key='np_api_key'`).run();
  } else if (f.has('np_api_key')) {
    const np = (f.get('np_api_key')||'').toString().trim();
    if (np) await db.prepare(`INSERT OR REPLACE INTO secrets(key,value) VALUES('np_api_key',?)`).bind(np).run();
  }
  // Поля відправника/ТТН — лише ті, що реально прийшли (щоб форма ключа не затирала, і навпаки)
  const secKeys = ['np_sender_counterparty','np_sender_name','np_sender_contact','np_sender_contact_name','np_sender_phone','np_sender_city_ref','np_sender_city_name','np_sender_wh_ref','np_sender_wh_name'];
  for (const k of secKeys) if (f.has(k)) await db.prepare(`INSERT OR REPLACE INTO secrets(key,value) VALUES(?,?)`).bind(k, (f.get(k)||'').toString().trim()).run();
  const ssKeys = ['ttn_payer','ttn_payment','ttn_cargo_type','ttn_cargo_desc','ttn_weight','ttn_cod'];
  for (const k of ssKeys) if (f.has(k)) await db.prepare(`INSERT OR REPLACE INTO site_settings(key,value) VALUES(?,?)`).bind(k, (f.get(k)||'').toString().trim()).run();
  return Response.redirect(new URL('/admin/np-sender?saved=1', context.request.url).toString(), 303);
}
