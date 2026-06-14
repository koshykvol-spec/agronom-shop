// /admin/contacts — реквізити магазину (site_settings) + точки мережі (stores).
// Живить динамічний /site-config → footer, контакти, JSON-LD.
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

const PAGE = (body) => `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>Контакти</title><style>
body{font-family:system-ui;max-width:880px;margin:1.2rem auto;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2{color:#2d6a2d}
.btn{background:#2d6a2d;color:#fff;border:0;padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:700}
.btn.del{background:#c0392b}
.muted{color:#888;font-size:.85rem}
input,textarea{padding:6px 8px;border:1px solid #ccc;border-radius:6px;font:inherit}
.box{background:#fff;border:1px solid #e3e3e3;border-radius:10px;padding:12px 14px;margin:10px 0}
.fl{margin:7px 0;display:flex;flex-direction:column;gap:3px} .fl label{font-size:.8rem;color:#555}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body><div><a href="/admin">← до адмінки</a></div>${body}</body></html>`;

const SETTING_LABELS = {
  name:'Назва', network:'Мережа (для футера/копірайту)', fop:'ФОП / реквізити',
  city:'Місто (м. …)', locality:'Населений пункт (для JSON-LD)', region:'Область',
  phoneDisplay:'Телефон (показ)', phoneIntl:'Телефон (+380…)', viberPhone:'Viber (380…)',
  telegram:'Telegram (URL, порожньо = ховати)', email:'E-mail (порожньо = ховати)',
  address:'Основна адреса', hours:'Основні години',
  np_placeholder:'Плейсхолдер «місто/відділення НП» у формі замовлення'
};
const SETTING_ORDER = ['name','network','fop','city','locality','region','phoneDisplay','phoneIntl','viberPhone','telegram','email','address','hours','np_placeholder'];

export async function onRequestGet(context){
  const db = context.env.DB;
  const url = new URL(context.request.url);
  if (url.searchParams.get('delstore')){
    await db.prepare(`DELETE FROM stores WHERE id=?`).bind(url.searchParams.get('delstore')).run();
    return Response.redirect(new URL('/admin/contacts?saved=store', context.request.url).toString(), 303);
  }
  const cfg = {};
  for (const r of (await db.prepare(`SELECT key,value FROM site_settings`).all()).results || []) cfg[r.key]=r.value;
  const stores = (await db.prepare(`SELECT * FROM stores ORDER BY sort,id`).all()).results || [];
  const saved = url.searchParams.get('saved');

  const settingsForm = `<form class="box" method="POST" action="/admin/contacts">
    <input type="hidden" name="action" value="save-settings">
    <h3 style="margin-top:0">🏷 Реквізити</h3>
    <div class="grid2">${SETTING_ORDER.map(k=>`<div class="fl"><label>${esc(SETTING_LABELS[k]||k)}</label><input name="s_${k}" value="${esc(cfg[k]||'')}"></div>`).join('')}</div>
    <button class="btn" type="submit" style="margin-top:8px">💾 Зберегти реквізити</button>
  </form>`;

  const storeForms = stores.map(s=>`<form class="box" method="POST" action="/admin/contacts">
    <input type="hidden" name="action" value="save-store"><input type="hidden" name="id" value="${s.id}">
    <div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">🏪 ${esc(s.name)}</h3>
      <a class="muted" href="/admin/contacts?delstore=${s.id}" onclick="return confirm('Видалити точку?')" style="color:#c0392b">✕ видалити</a></div>
    <div class="grid2">
      <div class="fl"><label>Назва</label><input name="name" value="${esc(s.name)}"></div>
      <div class="fl"><label>Порядок</label><input name="sort" type="number" value="${esc(s.sort)}"></div>
      <div class="fl"><label>Вулиця (street)</label><input name="street" value="${esc(s.street)}"></div>
      <div class="fl"><label>Повна адреса</label><input name="address" value="${esc(s.address)}"></div>
      <div class="fl"><label>Години (текст)</label><input name="hours" value="${esc(s.hours)}"></div>
      <div class="fl"><label>Маршрут (Google Maps URL)</label><input name="map" value="${esc(s.map)}"></div>
      <div class="fl"><label>Широта (lat)</label><input name="lat" value="${esc(s.lat)}"></div>
      <div class="fl"><label>Довгота (lng)</label><input name="lng" value="${esc(s.lng)}"></div>
    </div>
    <div class="fl"><label>Години для JSON-LD (oh_json)</label><textarea name="oh_json" rows="3" style="font-family:monospace;font-size:.8rem">${esc(s.oh_json)}</textarea></div>
    <button class="btn" type="submit">💾 Зберегти точку</button>
  </form>`).join('');

  return new Response(PAGE(`<h2>📞 Контакти та магазини</h2>
    ${saved ? '<div class="box" style="border-color:#2d6a2d;color:#2d6a2d">✅ Збережено. Кеш — до 2 хв.</div>' : ''}
    ${settingsForm}
    <h3 style="margin-top:22px">Точки мережі (${stores.length})</h3>
    ${storeForms}
    <form class="box" method="POST" action="/admin/contacts">
      <input type="hidden" name="action" value="save-store">
      <h3 style="margin-top:0">➕ Нова точка</h3>
      <div class="grid2">
        <div class="fl"><label>Назва</label><input name="name" required></div>
        <div class="fl"><label>Повна адреса</label><input name="address"></div>
        <div class="fl"><label>Години</label><input name="hours"></div>
        <div class="fl"><label>Маршрут URL</label><input name="map"></div>
      </div>
      <button class="btn" type="submit">➕ Додати точку</button>
    </form>`), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function onRequestPost(context){
  const db = context.env.DB;
  const f = await context.request.formData();
  const action = f.get('action');
  if (action === 'save-settings'){
    for (const k of SETTING_ORDER){
      await db.prepare(`INSERT OR REPLACE INTO site_settings(key,value) VALUES(?,?)`).bind(k, (f.get('s_'+k)||'').trim()).run();
    }
  } else if (action === 'save-store'){
    const id = (f.get('id')||'').trim();
    const lat = parseFloat(f.get('lat')); const lng = parseFloat(f.get('lng'));
    let oh = (f.get('oh_json')||'[]').trim(); try { JSON.parse(oh); } catch(e){ oh='[]'; }
    if (id){
      await db.prepare(`UPDATE stores SET name=?,sort=?,street=?,address=?,hours=?,map=?,lat=?,lng=?,oh_json=? WHERE id=?`)
        .bind((f.get('name')||'').trim(), parseInt(f.get('sort')||'0',10)||0, (f.get('street')||'').trim(), (f.get('address')||'').trim(),
              (f.get('hours')||'').trim(), (f.get('map')||'').trim(), isNaN(lat)?null:lat, isNaN(lng)?null:lng, oh, id).run();
    } else {
      await db.prepare(`INSERT INTO stores(sort,name,street,address,hours,map,lat,lng,oh_json) VALUES(?,?,?,?,?,?,?,?,?)`)
        .bind(parseInt(f.get('sort')||'99',10)||99, (f.get('name')||'').trim(), (f.get('street')||'').trim(), (f.get('address')||'').trim(),
              (f.get('hours')||'').trim(), (f.get('map')||'').trim(), isNaN(lat)?null:lat, isNaN(lng)?null:lng, oh).run();
    }
  }
  return Response.redirect(new URL('/admin/contacts?saved=1', context.request.url).toString(), 303);
}
