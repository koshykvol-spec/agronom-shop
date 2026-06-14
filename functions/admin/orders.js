// /admin/orders — замовлення з сайту (D1): перегляд, статуси, авто-ТТН Нової Пошти.
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

async function npCall(key, modelName, calledMethod, props){
  try {
    const r = await fetch('https://api.novaposhta.ua/v2.0/json/', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ apiKey:key, modelName, calledMethod, methodProperties: props||{} })
    });
    return await r.json();
  } catch(e){ return { success:false, errors:['fetch: '+e.message], data:[] }; }
}
function normPhone(p){ var d=String(p==null?'':p).replace(/\D/g,''); if(d.length===10&&d[0]==='0') d='38'+d; else if(d.length===9) d='380'+d; return d; }

async function getKey(db, env){
  try { const r=await db.prepare(`SELECT value FROM secrets WHERE key='np_api_key'`).first(); if(r&&r.value) return r.value; }catch(e){}
  return env.NP_API_KEY || '';
}

// Створення ТТН (відділення-відділення). Повертає 'ok:<ЕН>' або текст помилки.
async function createTtn(db, env, id, payerOverride, codOverride){
  const o = await db.prepare(`SELECT * FROM orders WHERE id=?`).bind(id).first();
  if (!o) return 'Замовлення не знайдено';
  if (o.ttn) return 'ok:' + o.ttn;
  if (o.np_service !== 'wh') return 'Авто-ТТН поки лише для доставки у відділення (це — курʼєр/інше). Створіть у кабінеті НП.';
  if (!o.np_city_ref || !o.np_wh_ref) return 'У замовленні немає кодів НП (місто/відділення).';

  const key = await getKey(db, env);
  if (!key) return 'Немає ключа НП (/admin/np-sender).';
  const sec = {}; for (const r of (await db.prepare(`SELECT key,value FROM secrets WHERE key LIKE 'np_sender_%'`).all()).results||[]) sec[r.key]=r.value;
  if (!sec.np_sender_counterparty || !sec.np_sender_wh_ref || !sec.np_sender_city_ref) return 'Не налаштовано відправника (/admin/np-sender).';
  const ss = {}; for (const r of (await db.prepare(`SELECT key,value FROM site_settings WHERE key LIKE 'ttn_%'`).all()).results||[]) ss[r.key]=r.value;

  let payer = payerOverride || ss.ttn_payer || 'Recipient';
  if (payer !== 'Sender' && payer !== 'Recipient') payer = 'Recipient';
  // правило: за рахунок відправника → лише відділення (тут уже WarehouseWarehouse — ок)

  const rPhone = normPhone(o.phone);
  const parts = String(o.name||'').trim().split(/\s+/).filter(Boolean);
  const lastName = parts[0] || 'Клієнт';
  const firstName = parts.slice(1).join(' ') || parts[0] || 'Клієнт';
  const middleName = parts[2] || '';

  // 1) одержувач — приватна особа
  const cpRes = await npCall(key, 'Counterparty', 'save', {
    FirstName:firstName, MiddleName:middleName, LastName:lastName, Phone:rPhone, Email:'',
    CounterpartyType:'PrivatePerson', CounterpartyProperty:'Recipient'
  });
  if (!cpRes.success || !cpRes.data || !cpRes.data[0]) return 'НП (одержувач): ' + ((cpRes.errors||[]).join('; ') || 'помилка');
  const recRef = cpRes.data[0].Ref;
  let recContact = '';
  try { recContact = cpRes.data[0].ContactPerson.data[0].Ref; } catch(e){}

  // 2) накладна
  const d = new Date(); const pad = n => (n<10?'0':'')+n;
  const dt = pad(d.getUTCDate()) + '.' + pad(d.getUTCMonth()+1) + '.' + d.getUTCFullYear();
  const cost = Math.max(1, Math.round(Number(o.total)||1));
  const props = {
    PayerType: payer, PaymentMethod: ss.ttn_payment||'Cash', DateTime: dt,
    CargoType: ss.ttn_cargo_type||'Parcel', Weight: ss.ttn_weight||'0.5',
    ServiceType: 'WarehouseWarehouse', SeatsAmount: '1', Description: ss.ttn_cargo_desc||'Агротовари', Cost: String(cost),
    CitySender: sec.np_sender_city_ref, Sender: sec.np_sender_counterparty, SenderAddress: sec.np_sender_wh_ref,
    ContactSender: sec.np_sender_contact, SendersPhone: normPhone(sec.np_sender_phone),
    CityRecipient: o.np_city_ref, Recipient: recRef, RecipientAddress: o.np_wh_ref,
    ContactRecipient: recContact, RecipientsPhone: rPhone
  };
  // накладений платіж: одержувач платить за товар при отриманні, гроші повертаються відправнику
  const cod = (codOverride != null) ? codOverride : (ss.ttn_cod !== '0');
  if (cod) props.BackwardDeliveryData = [{ PayerType: 'Recipient', CargoType: 'Money', RedeliveryString: String(cost) }];
  const idRes = await npCall(key, 'InternetDocument', 'save', props);
  if (!idRes.success || !idRes.data || !idRes.data[0] || !idRes.data[0].IntDocNumber)
    return 'НП (накладна): ' + ((idRes.errors||[]).concat(idRes.warnings||[]).join('; ') || 'помилка');
  const en = idRes.data[0].IntDocNumber, ref = idRes.data[0].Ref || '';
  await db.prepare(`UPDATE orders SET ttn=?, ttn_ref=? WHERE id=?`).bind(en, ref, id).run();
  return 'ok:' + en;
}

const PAGE = (body) => `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>Замовлення</title><style>
body{font-family:system-ui;max-width:920px;margin:1.2rem auto;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2{color:#2d6a2d}
.muted{color:#888;font-size:.85rem}
.ord{background:#fff;border:1px solid #e3e3e3;border-radius:10px;padding:11px 13px;margin:8px 0}
.ord.new{border-left:4px solid #f0a020}
.ord.done{border-left:4px solid #2d6a2d;opacity:.75}
.btn{border:0;border-radius:7px;padding:5px 11px;font-weight:700;cursor:pointer;text-decoration:none;display:inline-block;color:#fff;font-size:.85rem}
.ok{background:#2d6a2d}.del{background:#c0392b}.re{background:#888}.np{background:#c0392b}.np2{background:#8a6d3b}
table{width:100%;border-collapse:collapse;font-size:.85rem;margin:6px 0}
td{padding:2px 6px;border-bottom:1px solid #f0f0f0}
.tot{font-weight:700}
.tag{font-size:.72rem;padding:1px 7px;border-radius:6px;background:#eef}
.en{background:#eef6ee;border:1px solid #cfe3c0;border-radius:8px;padding:5px 9px;display:inline-block;font-weight:700}
.box{border-radius:8px;padding:9px 12px;margin:8px 0}.boxok{background:#eef6ee;border:1px solid #2d6a2d;color:#2d6a2d}.boxerr{background:#fdeeee;border:1px solid #c0392b;color:#c0392b}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body><div><a href="/admin">← до адмінки</a> · <a href="/admin/np-sender">🚚 Нова Пошта</a></div>${body}</body></html>`;

export async function onRequestGet(context){
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const P = k => url.searchParams.get(k);

  // Друк ТТН (PDF з НП, ключ лишається на сервері)
  if (P('ttnprint')){
    const o = await db.prepare(`SELECT ttn_ref FROM orders WHERE id=?`).bind(P('ttnprint')).first();
    const key = await getKey(db, context.env);
    if (o && o.ttn_ref && key){
      const pdfUrl = 'https://my.novaposhta.ua/orders/printDocument/orders[0]/' + o.ttn_ref + '/type/pdf/apiKey/' + key;
      try { const r = await fetch(pdfUrl); if (r.ok){ const buf = await r.arrayBuffer(); return new Response(buf, { headers:{'content-type':'application/pdf'} }); } } catch(e){}
    }
    return new Response('Друк недоступний — скористайтесь номером ЕН у кабінеті НП.', { status:404, headers:{'content-type':'text/plain; charset=utf-8'} });
  }

  if (P('ttn')){ const codP = P('cod'); const cod = codP==null ? null : (codP!=='0'); const res = await createTtn(db, context.env, P('ttn'), P('payer'), cod); return Response.redirect(new URL('/admin/orders?ttnmsg='+encodeURIComponent(res), context.request.url).toString(), 303); }
  if (P('done')){ await db.prepare(`UPDATE orders SET status='done' WHERE id=?`).bind(P('done')).run(); return Response.redirect(new URL('/admin/orders', context.request.url).toString(), 303); }
  if (P('reopen')){ await db.prepare(`UPDATE orders SET status='new' WHERE id=?`).bind(P('reopen')).run(); return Response.redirect(new URL('/admin/orders', context.request.url).toString(), 303); }
  if (P('del')){ await db.prepare(`DELETE FROM orders WHERE id=?`).bind(P('del')).run(); return Response.redirect(new URL('/admin/orders', context.request.url).toString(), 303); }

  const rows = (await db.prepare(`SELECT * FROM orders ORDER BY (status='done'), id DESC LIMIT 300`).all()).results || [];
  const newN = rows.filter(r=>r.status!=='done').length;

  // pid → slug (для прямих посилань у проханні про відгук)
  const allPids = [...new Set(rows.flatMap(r => { try { return JSON.parse(r.items||'[]').map(it=>it.pid).filter(x=>x!=null); } catch(e){ return []; } }))];
  const slugMap = {};
  if (allPids.length){
    const ph = allPids.map(()=>'?').join(',');
    for (const x of (await db.prepare(`SELECT pid, slug FROM product_content WHERE pid IN (${ph}) AND slug IS NOT NULL AND slug<>''`).bind(...allPids).all()).results || []) slugMap[x.pid] = x.slug;
  }
  const phoneIntl = p => { let d = String(p||'').replace(/\D/g,''); if (d.length===10 && d[0]==='0') d='38'+d; if (d.startsWith('80')) d='3'+d; return d; };

  // Статуси НП для замовлень з ТТН (один батч-запит getStatusDocuments)
  const statusMap = {};
  const withTtn = rows.filter(r => r.ttn);
  if (withTtn.length){
    const key = await getKey(db, context.env);
    if (key){
      const docs = withTtn.slice(0,100).map(r => ({ DocumentNumber: r.ttn, Phone: '' }));
      const sres = await npCall(key, 'TrackingDocument', 'getStatusDocuments', { Documents: docs });
      if (sres && sres.success && sres.data) for (const d of sres.data) statusMap[String(d.Number)] = { text: d.Status || '', code: String(d.StatusCode||'') };
    }
  }
  const statusBadge = ttn => {
    const s = statusMap[String(ttn)]; if (!s || !s.text) return '';
    let bg = '#3a6ea5';                                       // в дорозі
    if (['9','10','11'].indexOf(s.code) >= 0) bg = '#2d6a2d';                                  // одержано
    else if (['1','2','3'].indexOf(s.code) >= 0) bg = '#888';                                  // створено/не прийнято
    else if (['102','103','104','105','106','108','111'].indexOf(s.code) >= 0) bg = '#c0392b'; // повернення/відмова
    return `<span style="background:${bg};color:#fff;border-radius:8px;padding:2px 8px;font-size:.75rem;font-weight:700">${esc(s.text)}</span>`;
  };

  const msg = P('ttnmsg');
  const banner = msg ? (msg.indexOf('ok:')===0
    ? `<div class="box boxok">✅ ТТН створено: <b>${esc(msg.slice(3))}</b></div>`
    : `<div class="box boxerr">❌ ${esc(msg)}</div>`) : '';

  const card = r => {
    let items = []; try { items = JSON.parse(r.items||'[]'); } catch(e){}
    const itemsHtml = items.map(it=>`<tr><td>${esc(it.n)}</td><td style="text-align:right">${esc(it.q)}×${esc(it.p)}</td></tr>`).join('');
    const dt = (r.created_at||'').replace('T',' ').slice(0,16);
    // Прохання про відгук: повідомлення з прямими посиланнями на товари + Viber/SMS на номер
    const rvLinks = items.filter(it=>slugMap[it.pid]).slice(0,3).map(it=>'• '+it.n+': https://agronom.pp.ua/p/'+slugMap[it.pid]);
    const rvIntl = phoneIntl(r.phone);
    const rvMsg = 'Дякуємо за замовлення №'+(1000+r.id)+' в магазині «Агроном»! 🌿\n'
      + 'Будемо вдячні, якщо оціните товар — це хвилинка й допомагає іншим садівникам:\n'
      + (rvLinks.length ? rvLinks.join('\n') : 'https://agronom.pp.ua') + '\nГарного врожаю!';
    const reviewBlock = `<details style="margin-top:6px"><summary style="cursor:pointer;color:#7a5b00;font-weight:700;font-size:.9rem">⭐ Попросити відгук</summary>
      <div style="margin-top:6px"><textarea id="rv${r.id}" readonly rows="5" style="width:100%;box-sizing:border-box;font-size:.82rem;border:1px solid #e3e9e0;border-radius:6px;padding:6px">${esc(rvMsg)}</textarea>
      <div style="margin-top:5px;display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" class="btn re" onclick="rvCopy('rv${r.id}')">📋 Копіювати</button>
        ${rvIntl?`<a class="btn" style="background:#7360f2" href="viber://chat?number=%2B${rvIntl}">📲 Viber</a>`:''}
        ${rvIntl?`<a class="btn" style="background:#555" href="sms:+${rvIntl}?&body=${encodeURIComponent(rvMsg)}">✉️ SMS</a>`:''}
      </div></div></details>`;
    let ttnBlock = '';
    if (r.ttn){
      ttnBlock = `<div style="margin-top:6px"><span class="en">📦 ЕН: ${esc(r.ttn)}</span> ${statusBadge(r.ttn)} <a class="btn ok" href="/admin/orders?ttnprint=${r.id}" target="_blank">🖨 Друк</a> <a class="muted" href="https://novaposhta.ua/tracking/?cargo_number=${esc(r.ttn)}" target="_blank">відстежити</a></div>`;
    } else if (r.np_service === 'wh'){
      ttnBlock = `<div style="margin-top:6px"><a class="btn np" href="/admin/orders?ttn=${r.id}" onclick="return confirm('Створити ТТН? (платник і накладений — за замовчуванням)')">📦 Створити ТТН</a> <a class="btn np2" href="/admin/orders?ttn=${r.id}&payer=Sender" onclick="return confirm('Створити ТТН ЗА ВАШ рахунок (лише відділення)?')">за мій рахунок</a> <a class="btn re" href="/admin/orders?ttn=${r.id}&cod=0" onclick="return confirm('ТТН без накладеного (передоплата)?')">без накладеного</a></div>`;
    } else if (r.delivery === 'Нова Пошта'){
      ttnBlock = `<div class="muted" style="margin-top:6px">ТТН: курʼєрська — створіть у кабінеті НП</div>`;
    }
    return `<div class="ord ${r.status==='done'?'done':'new'}">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;align-items:center">
        <b>№${1000 + r.id}</b> <span class="muted">${esc(dt)}</span>
        <span class="tag">${esc(r.delivery)}</span>
        ${r.payment_method === 'liqpay'
          ? (r.payment_status === 'paid'
              ? '<span class="tag" style="background:#d4edda;color:#155724">💳 оплачено</span>'
              : '<span class="tag" style="background:#fff3cd;color:#856404">💳 очікує оплати</span>')
          : ''}
        <span class="tot">${Number(r.total).toFixed(2)} грн</span>
      </div>
      <div style="margin:3px 0">👤 ${esc(r.name)} · 📞 <a href="tel:${esc(r.phone)}">${esc(r.phone)}</a> · 📍 ${esc(r.address)}</div>
      ${r.comment?`<div class="muted">💬 ${esc(r.comment)}</div>`:''}
      <table>${itemsHtml}</table>
      ${ttnBlock}
      <div style="margin-top:6px">${r.status==='done'
        ? `<a class="btn re" href="/admin/orders?reopen=${r.id}">↩ В роботу</a> `
        : `<a class="btn ok" href="/admin/orders?done=${r.id}">✓ Опрацьовано</a> `}
      <a class="btn del" href="/admin/orders?del=${r.id}" onclick="return confirm('Видалити замовлення?')">🗑</a></div>
      ${reviewBlock}
    </div>`;
  };

  return new Response(PAGE(`<h2>🧾 Замовлення <span class="muted">(нових: ${newN})</span></h2>
    ${banner}
    <div class="muted">Замовлення дублюються в Telegram. «📦 Створити ТТН» — авто-накладна НП (відділення→відділення). Курʼєр — поки в кабінеті НП.</div>
    ${rows.length ? rows.map(card).join('') : '<p class="muted">Поки замовлень немає.</p>'}
    <script>function rvCopy(id){var t=document.getElementById(id);if(!t)return;t.focus();t.select();try{navigator.clipboard?navigator.clipboard.writeText(t.value):document.execCommand('copy');}catch(e){document.execCommand('copy');}}</script>`),
    { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
