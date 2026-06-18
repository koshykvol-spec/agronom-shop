// /admin — навігація каталогом (категорії + пагінація) + пошук + форма редагування обогащення.
import { existingGroups, groupComboHTML, GROUP_COMBO_ASSETS } from './_grouputil.js';
import { allIngredients, productIngredientIds, ingredientPickerHTML, INGREDIENT_PICKER_ASSETS } from './_ingredients.js';
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
const PAGE_SIZES = [30, 60, 120, 240];
const DEFAULT_PAGE_SIZE = 60;

const PAGE = (title, body) => `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title><style>
body{font-family:system-ui,sans-serif;max-width:960px;margin:0 auto;padding:16px;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h1{color:#2d6a2d;font-size:1.25rem;margin:.2rem 0} h2{font-size:1rem;color:#444} .nav{margin-bottom:12px}
input,textarea,select{width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font:inherit;box-sizing:border-box}
label{display:block;margin:10px 0 4px;font-size:.85rem;color:#555;font-weight:600}
.btn{background:#2d6a2d;color:#fff;border:none;padding:9px 15px;border-radius:8px;cursor:pointer;font-weight:700;text-decoration:none;display:inline-block}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden}
td,th{padding:7px 10px;border-bottom:1px solid #eee;text-align:left;font-size:.88rem}
.row{background:#fff;padding:16px;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.06)}
.muted{color:#999;font-size:.8rem} .ok{color:#2d6a2d} .no{color:#c0392b}
.cats{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
.cat{background:#fff;border:1.5px solid #c8e0c8;color:#2d6a2d;padding:6px 12px;border-radius:18px;text-decoration:none;font-size:.85rem;font-weight:600}
.cat.active{background:#2d6a2d;color:#fff} .cat b{opacity:.6;font-weight:400}
.pager{display:flex;gap:10px;align-items:center;margin:14px 0}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body>${body}${GROUP_COMBO_ASSETS}${INGREDIENT_PICKER_ASSETS}</body></html>`;

// Грід плиток-розділів адмінки (замість текстового списку)
function navGrid() {
  const groups = [
    { h: '📨 Операційне', items: [
      ['/admin/orders', '🛒', 'Замовлення'], ['/admin/reviews', '⭐', 'Відгуки'] ] },
    { h: '⚙️ Налаштування', items: [
      ['/admin/categories', '📂', 'Категорії'], ['/admin/pages', '📄', 'Сторінки'],
      ['/admin/contacts', '📍', 'Контакти'], ['/admin/recipes', '🧪', 'Чипи'],
      ['/admin/seasonal', '🌱', 'Сезонний'], ['/admin/schemes', '🛡', 'Схеми'],
      ['/admin/search', '🔍', 'Пошук'], ['/admin/checkout', '🚚', 'Доставка й оплата'],
      ['/admin/keys', '🔑', 'Ключі'], ['/admin/np-sender', '📦', 'Відправник НП'] ] },
    { h: '🛠 Каталог', items: [
      ['/admin/import', '⬆️', 'Імпорт 1С'], ['/admin/anno', '✍️', 'Анотації (масово)'],
      ['/admin/dedup', '🔀', 'Дублі SKU'], ['/admin/merge', '🔗', 'Злити товари (колізії)'],
      ['/admin/groups', '📦', 'Групування фасовок'], ['/admin/ingredients', '🧪', 'Діючі речовини'],
      ['/admin/aifill', '🤖', 'AI: дозування / діючі'], ['/admin/keywords', '🔑', 'Ключові слова (масово)'] ] },
  ];
  return '<div class="adm-sections">' + groups.map(g =>
    `<div class="adm-sec"><div class="adm-sec-h">${g.h}</div><div class="adm-tiles">` +
    g.items.map(([href, ico, label]) => `<a class="adm-tile" href="${href}"><span class="adm-tile-ico">${ico}</span><span>${label}</span></a>`).join('') +
    '</div></div>').join('') + '</div>';
}

function fparams(o) {
  const u = new URLSearchParams();
  if (o.cat) u.set('cat', o.cat);
  if (o.q) u.set('q', o.q);
  if (o.noa) u.set('noa', '1');
  if (o.noimg) u.set('noimg', '1');
  if (o.nodosage) u.set('nodosage', '1');
  if (o.noai) u.set('noai', '1');
  if (o.nokw) u.set('nokw', '1');
  if (o.dup) u.set('dup', '1');
  if (o.badsku) u.set('badsku', '1');
  if (o.ps && o.ps !== DEFAULT_PAGE_SIZE) u.set('ps', o.ps);
  if (o.page && o.page > 1) u.set('page', o.page);
  return u.toString();
}
const listUrl = o => { const f = fparams(o); return '/admin' + (f ? '?' + f : ''); };

// image_ok = чи існує файл головного (з найменшим sort) фото товару
async function recomputeImageOk(env, db, pid) {
  const prim = await db.prepare(`SELECT path FROM product_images WHERE pid=? ORDER BY sort, id LIMIT 1`).bind(pid).first();
  let ok = 0;
  if (prim && prim.path) {
    try { ok = (await env.IMAGES.head(prim.path)) ? 1 : 0; } catch (e) { ok = 1; }
  }
  await db.prepare(`UPDATE product_content SET image_ok=? WHERE pid=?`).bind(ok, pid).run();
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const db = env.DB;
  const pid = url.searchParams.get('pid');
  const cat = url.searchParams.get('cat') || '';
  const q = (url.searchParams.get('q') || '').trim();
  const noa = url.searchParams.get('noa') === '1';
  const noimg = url.searchParams.get('noimg') === '1';
  const nodosage = url.searchParams.get('nodosage') === '1';
  const noai = url.searchParams.get('noai') === '1';
  const nokw = url.searchParams.get('nokw') === '1';
  const dup = url.searchParams.get('dup') === '1';
  const badsku = url.searchParams.get('badsku') === '1';
  let ps = parseInt(url.searchParams.get('ps') || '', 10);
  if (!PAGE_SIZES.includes(ps)) ps = DEFAULT_PAGE_SIZE;
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const fp = fparams({ cat, q, noa, noimg, nodosage, noai, nokw, dup, badsku, ps, page });

  // ── швидкі дії зі списку (перемикання показу в каталозі / масове приховування) ──
  const toggle = url.searchParams.get('toggle');
  if (toggle) {
    await db.prepare(`UPDATE product_content SET visible = CASE WHEN visible=1 THEN 0 ELSE 1 END WHERE pid=?`).bind(toggle).run();
    return Response.redirect(new URL(listUrl({ cat, q, noa, noimg, nodosage, noai, nokw, dup, badsku, ps, page }), request.url).toString(), 303);
  }
  if (url.searchParams.get('bulk') === 'hide-nophoto') {
    await db.prepare(`UPDATE product_content SET visible=0 WHERE image_ok=0`).run();
    return Response.redirect(new URL(listUrl({ noimg: true, ps }), request.url).toString(), 303);
  }
  if (url.searchParams.get('bulk') === 'show-nophoto') {
    await db.prepare(`UPDATE product_content SET visible=1 WHERE image_ok=0`).run();
    return Response.redirect(new URL(listUrl({ noimg: true, ps }), request.url).toString(), 303);
  }
  // ── керування фото товару (видалити / зробити головним) ──
  const imgdel = url.searchParams.get('imgdel');
  if (imgdel) {
    const row = await db.prepare(`SELECT id, pid, path FROM product_images WHERE id=?`).bind(imgdel).first();
    if (row) {
      const other = await db.prepare(`SELECT COUNT(*) n FROM product_images WHERE path=? AND id<>?`).bind(row.path, row.id).first();
      if ((other && other.n | 0) === 0 && env.IMAGES) { try { await env.IMAGES.delete(row.path); } catch (e) {} try { await env.IMAGES.delete('thumb/' + row.path); } catch (e) {} }
      await db.prepare(`DELETE FROM product_images WHERE id=?`).bind(row.id).run();
      await recomputeImageOk(env, db, row.pid);
      return Response.redirect(new URL('/admin?pid=' + row.pid + (fp ? '&' + fp : ''), request.url).toString(), 303);
    }
  }
  const imgprimary = url.searchParams.get('imgprimary');
  if (imgprimary) {
    const row = await db.prepare(`SELECT id, pid FROM product_images WHERE id=?`).bind(imgprimary).first();
    if (row) {
      const mn = await db.prepare(`SELECT COALESCE(MIN(sort), 0) m FROM product_images WHERE pid=?`).bind(row.pid).first();
      await db.prepare(`UPDATE product_images SET sort=? WHERE id=?`).bind(((mn && mn.m) | 0) - 1, row.id).run();
      await recomputeImageOk(env, db, row.pid);
      return Response.redirect(new URL('/admin?pid=' + row.pid + (fp ? '&' + fp : ''), request.url).toString(), 303);
    }
  }

  // ── форма редагування ──
  if (pid) {
    const p = await db.prepare(
      `SELECT p.pid,p.sku,p.name,p.price,p.category,p.brand,p.in_stock,
              c.slug,c.annotation,c.keywords,c.meta_title,c.meta_desc,c.visible,c.sale_price,c.sale_until,c.display_name,c.group_id,c.variant_label,c.active_ingredient,c.dosage,c.divisible,c.divisor
         FROM products p JOIN product_content c ON c.pid=p.pid WHERE p.pid=?`).bind(pid).first();
    if (!p) return new Response('Не знайдено', { status: 404 });
    const dupCount = (((await db.prepare(`SELECT COUNT(*) n FROM products WHERE sku=? AND pid<>?`).bind(p.sku, p.pid).first()) || {}).n) | 0;
    const imgs = (await db.prepare(`SELECT id, path, sort FROM product_images WHERE pid=? ORDER BY sort, id`).bind(pid).all()).results || [];
    const grpList = await existingGroups(db);   // для випадайки «Група фасовок»
    const ingAll = await allIngredients(db);            // довідник діючих речовин
    const ingSel = await productIngredientIds(db, pid); // обрані для цього товару
    const hid = ['cat', 'q', 'noa', 'noimg', 'nodosage', 'noai', 'nokw', 'dup', 'badsku', 'ps', 'page'].map(k => `<input type="hidden" name="${k}" value="${esc(url.searchParams.get(k) || '')}">`).join('');
    const gallery = `<div class="row" style="margin-top:12px">
      <b>📷 Фото товару (${imgs.length})</b>${imgs.length > 1 ? ' <span class="muted">🖐 перетягуйте для зміни порядку (перше = головне)</span> <span id="ph-status" style="font-size:.78rem"></span>' : ''}
      <div id="photo-grid" data-pid="${pid}" style="display:flex;flex-wrap:wrap;gap:10px;margin:10px 0">
        ${imgs.length ? imgs.map((im, i) => `<div class="ph-card" draggable="true" data-id="${im.id}" style="border:2px solid ${i === 0 ? '#2d6a2d' : '#ddd'};border-radius:8px;padding:6px;width:130px;text-align:center;box-sizing:border-box;cursor:grab;background:#fff">
            <img src="/${esc(im.path)}" loading="lazy" draggable="false" style="width:100%;height:90px;object-fit:contain;background:#f6f6f6;border-radius:4px;pointer-events:none" onerror="this.style.opacity=.25;this.alt='нема файлу'">
            <div class="ph-badge" style="font-size:.72rem;color:#2d6a2d;font-weight:700;margin:4px 0;min-height:1em">${i === 0 ? '★ головне' : '&nbsp;'}</div>
            <a class="ph-makeprimary" href="/admin?imgprimary=${im.id}${fp ? '&' + fp : ''}" style="display:${i === 0 ? 'none' : 'block'};font-size:.76rem;margin-bottom:3px">★ зробити головним</a>
            <a href="/admin?imgdel=${im.id}${fp ? '&' + fp : ''}" onclick="return confirm('Видалити це фото?')" style="display:block;font-size:.76rem;color:#c0392b">🗑 видалити</a>
          </div>`).join('') : '<div class="muted">Фото ще немає</div>'}
      </div>
      <form method="POST" action="/admin/upload" enctype="multipart/form-data" onsubmit="return shrinkUpload(this,event)" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="hidden" name="pid" value="${pid}">${hid}
        <label class="btn" style="background:#555;margin:0;cursor:pointer">📂 Виберіть фото<input type="file" name="photo" accept="image/*" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" onchange="var s=this.closest('form').querySelector('.fname');if(s)s.textContent=this.files&&this.files[0]?this.files[0].name:'Файл не вибрано'"></label>
        <span class="fname muted" style="flex:1;min-width:120px">Файл не вибрано</span>
        <button class="btn" type="submit">⬆️ Завантажити фото</button>
      </form>
      <div class="muted" style="margin-top:6px">Перше (★ головне) показується в каталозі. Фото автоматично стискається (макс 800px, webp) + створюється мініатюра для каталогу (400px). Формати: webp/jpg/png.</div>
      <script>
      // Автостиснення фото в браузері перед завантаженням (макс 800px, webp q82) — без сторонніх сервісів
      async function shrinkUpload(form, ev){
        var inp = form.querySelector('input[name=photo]');
        var file = inp.files && inp.files[0];
        if(!file || !/^image\\//.test(file.type)) return true;   // нема фото / не зображення → звичайний сабміт
        ev.preventDefault();
        var btn = form.querySelector('button[type=submit]'); btn.disabled=true; btn.textContent='⏳ Стиснення…';
        try {
          var bmp = await createImageBitmap(file);
          var MAX=800, scale=Math.min(1, MAX/Math.max(bmp.width,bmp.height));
          var w=Math.round(bmp.width*scale), h=Math.round(bmp.height*scale);
          var cv=document.createElement('canvas'); cv.width=w; cv.height=h;
          cv.getContext('2d').drawImage(bmp,0,0,w,h);
          var blob = await new Promise(function(res){ cv.toBlob(res,'image/webp',0.82); });
          if(!blob || blob.size>file.size) throw 0;             // не вийшло менше → залив оригінал
          var fd = new FormData(form);
          fd.set('photo', blob, (file.name.replace(/\\.[^.]+$/,'')||'photo')+'.webp');
          // Мініатюра для каталогу (макс 400px) — лише якщо оригінал більший; сервер кладе її в thumb/up/...
          var TMAX=400;
          if(Math.max(bmp.width,bmp.height)>TMAX){
            var ts=TMAX/Math.max(bmp.width,bmp.height), tw=Math.round(bmp.width*ts), th=Math.round(bmp.height*ts);
            var tcv=document.createElement('canvas'); tcv.width=tw; tcv.height=th;
            tcv.getContext('2d').drawImage(bmp,0,0,tw,th);
            var tblob = await new Promise(function(res){ tcv.toBlob(res,'image/webp',0.8); });
            if(tblob) fd.set('thumb', tblob, 'thumb.webp');
          }
          var r = await fetch(form.action, {method:'POST', body:fd, redirect:'follow'});
          location.href = r.url || location.href;
        } catch(e){ btn.disabled=false; form.onsubmit=null; form.submit(); }  // fallback — звичайний сабміт оригіналу
        return false;
      }
      </script>
    </div>
    <script>(function(){
      var grid=document.getElementById('photo-grid'); if(!grid) return;
      var st=document.getElementById('ph-status'), dragEl=null;
      function cards(){return [].slice.call(grid.querySelectorAll('.ph-card'));}
      function refresh(){cards().forEach(function(c,i){
        c.style.borderColor=i===0?'#2d6a2d':'#ddd';
        var b=c.querySelector('.ph-badge'); if(b) b.innerHTML=i===0?'★ головне':'&nbsp;';
        var mp=c.querySelector('.ph-makeprimary'); if(mp) mp.style.display=i===0?'none':'block';
      });}
      function save(){
        var ids=cards().map(function(c){return c.getAttribute('data-id');});
        if(st){st.textContent='збереження…';st.style.color='#999';}
        fetch('/admin/reorder',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
          body:'pid='+encodeURIComponent(grid.getAttribute('data-pid'))+'&order='+encodeURIComponent(ids.join(','))})
        .then(function(r){if(st){st.textContent=r.ok?'✓ збережено':'помилка';st.style.color=r.ok?'#2d6a2d':'#c0392b';}})
        .catch(function(){if(st){st.textContent='помилка мережі';st.style.color='#c0392b';}});
      }
      cards().forEach(function(c){
        c.addEventListener('dragstart',function(e){dragEl=c;c.style.opacity='0.4';e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain','x');}catch(_){}});
        c.addEventListener('dragend',function(){c.style.opacity='';refresh();save();});
        c.addEventListener('dragover',function(e){e.preventDefault();if(!dragEl||dragEl===c)return;
          var r=c.getBoundingClientRect(); var before=(e.clientX-r.left)<r.width/2;
          grid.insertBefore(dragEl, before? c : c.nextSibling);});
      });
    })();</script>`;
    const body = `<div class="nav"><a href="${esc(listUrl({ cat, q, noa, noimg, nodosage, noai, nokw, dup, badsku, ps, page }))}">← до списку</a></div>
    <h1>${esc(p.name)}</h1>
    <div class="muted">SKU ${esc(p.sku)} · ${esc(p.category||'')} · ${p.price} грн · ${p.in_stock?'<span class="ok">в наявності</span>':'<span class="no">немає</span>'} · <a href="/p/${esc(p.slug)}" target="_blank">/p/${esc(p.slug)} ↗</a></div>
    <form class="box" method="POST" action="/admin/save" style="margin-top:12px;display:flex;flex-direction:column;gap:10px;">
      <input type="hidden" name="pid" value="${p.pid}">${hid}
      <div style="background:#fff8e1;border:1px solid #f0d98a;border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:.82rem;color:#7a5d00">⚠️ Поля з 1С (назва, ціна, категорія, бренд, наявність) <b>перезапишуться при наступному імпорті 1С</b>. Для постійної знижки користуйтесь блоком «Акція».</div>
      ${dupCount > 0 ? `<div style="background:#fde8e8;border:1px solid #e57373;border-radius:8px;padding:8px 10px;margin-bottom:8px;font-size:.82rem;color:#922">⚠️ Цей SKU мають ще <b>${dupCount}</b> товар(и) — це дубль. Дайте унікальний SKU, щоб розвести їх.</div>` : ''}
      <label>SKU (артикул — ключ синхронізації з 1С)</label><input name="sku" value="${esc(p.sku)}">
      <div class="muted" style="margin:-2px 0 8px;font-size:.78rem">Якщо зміните SKU тут, але не в 1С — наступний імпорт створить дубль. Міняйте переважно щоб розвести дублі SKU.</div>
      <label>Робоча назва (з 1С — оновлюється імпортом)</label><input name="name" value="${esc(p.name)}">
      <label>🏷️ Фасадна назва (показується на сайті; з 1С НЕ оновлюється; порожньо = робоча)</label><input name="display_name" value="${esc(p.display_name || '')}" placeholder="${esc(p.name)}">
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:230px"><label>📦 Група фасовок (почни вводити — пошук; ID не треба)</label>${groupComboHTML('group_id', grpList, p.group_id)}</div>
        <div style="flex:1;min-width:120px"><label>Розмір/фасовка (variant_label)</label><input name="variant_label" value="${esc(p.variant_label || '')}" placeholder="напр. 250 г"></div>
      </div>
      <label>🧪 Діючі речовини — обери з довідника (кілька; для блоку «Аналоги» й пошуку). <a href="/admin/ingredients" target="_blank">керувати довідником →</a></label>${ingredientPickerHTML('ingredient_ids', ingAll, ingSel)}
      <label>💧 Дозування — показується на сторінці товару; якщо у форматі «X на Y л» — авто-калькулятор розчину</label><input name="dosage" value="${esc(p.dosage || '')}" placeholder="напр. 20 мл на 10 л води   або   5 г на 10 л">
      <div style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:8px;padding:10px;margin:14px 0">
        <label style="margin:0;display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" name="divisible" value="1" id="divisible_cb" ${p.divisible ? 'checked' : ''} style="width:auto;margin:0">
          <b>✂️ Подільність товару</b> <span class="muted" style="font-weight:400">(можна продати частину упаковки)</span>
        </label>
        <div id="divisor_wrap" style="margin-top:10px;${p.divisible ? '' : 'display:none'}">
          <label style="margin:0 0 4px">Кратність поділу <span class="muted">(напр. 0.5 або 100 — мінімальна частина, якою ділиться товар)</span></label>
          <input name="divisor" type="number" step="any" min="0" value="${p.divisor != null ? p.divisor : ''}" placeholder="напр. 0.5">
        </div>
      </div>
      <script>
      (function(){
        var cb = document.getElementById('divisible_cb');
        var wrap = document.getElementById('divisor_wrap');
        if(cb && wrap) cb.addEventListener('change', function(){ wrap.style.display = this.checked ? '' : 'none'; });
      })();
      </script>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:120px"><label>Ціна, грн</label><input name="price" type="number" step="0.01" value="${p.price!=null?p.price:''}"></div>
        <div style="flex:1;min-width:120px"><label>Бренд</label><input name="brand" value="${esc(p.brand||'')}"></div>
        <div style="flex:1;min-width:140px"><label>Категорія</label><input name="category" value="${esc(p.category||'')}"></div>
      </div>
      <div><label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" name="in_stock" value="1" ${p.in_stock?'checked':''} style="width:auto"> В наявності</label></div>
      <div style="background:#fff3cd;border:1px solid #f9a825;border-radius:8px;padding:10px;margin:14px 0">
        <b style="color:#e65100">🏷️ Акція</b>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">
          <div style="flex:1;min-width:140px"><label>Акційна ціна, грн (порожньо = без акції)</label><input name="sale_price" type="number" step="0.01" value="${p.sale_price!=null?p.sale_price:''}"></div>
          <div style="flex:1;min-width:140px"><label>Діє до (дата)</label><input name="sale_until" type="date" value="${esc(p.sale_until||'')}"></div>
        </div>
      </div>
      <div><label>Анотація</label><textarea name="annotation" rows="5">${esc(p.annotation)}</textarea></div>
      <div><label>Ключові слова (пошук)</label><input name="keywords" value="${esc(p.keywords)}"></div>
      <div><label>SEO title</label><input name="meta_title" value="${esc(p.meta_title)}"></div>
      <div><label>SEO description</label><input name="meta_desc" value="${esc(p.meta_desc)}"></div>
      <label><input type="checkbox" name="visible" value="1" ${p.visible?'checked':''} style="width:auto"> Показувати на сайті</label>
      <div style="margin-top:14px"><button class="btn">💾 Зберегти</button></div>
    </form>
    ${gallery}`;
    return new Response(PAGE('Редагування: ' + p.name, body), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  // ── категорії ──
  const catRows = await db.prepare(`SELECT category c, COUNT(*) n FROM products GROUP BY category ORDER BY n DESC`).all();
  const totalC = await db.prepare(`SELECT COUNT(*) n,
                                     SUM(CASE WHEN c.annotation='' THEN 1 ELSE 0 END) noa,
                                     SUM(CASE WHEN c.image_ok=0 THEN 1 ELSE 0 END) noimg,
                                     SUM(CASE WHEN (c.dosage IS NULL OR c.dosage='') AND p.category='АГРОХІМІКАТИ' THEN 1 ELSE 0 END) nodosage,
                                     SUM(CASE WHEN (c.active_ingredient IS NULL OR c.active_ingredient='') AND p.category='АГРОХІМІКАТИ' THEN 1 ELSE 0 END) noai,
                                     SUM(CASE WHEN c.keywords IS NULL OR c.keywords='' THEN 1 ELSE 0 END) nokw
                                     FROM products p JOIN product_content c ON c.pid=p.pid`).first();
  // дублі sku + некоректні sku (коректні починаються з 00- або РТ-)
  const dupRows = (await db.prepare(`SELECT sku, COUNT(*) c FROM products GROUP BY sku HAVING COUNT(*)>1`).all()).results || [];
  const dupSet = new Set(dupRows.map(r => r.sku));
  const dupTotal = dupRows.reduce((s, r) => s + (r.c | 0), 0);
  const badTotal = (((await db.prepare(`SELECT COUNT(*) n FROM products WHERE sku NOT LIKE '00-%' AND sku NOT LIKE 'РТ-%' AND sku NOT LIKE 'AN-%'`).first()) || {}).n) | 0;
  const catNav = '<div class="cats">' +
    `<a class="cat${!cat&&!q&&!noa&&!noimg&&!dup&&!badsku?' active':''}" href="/admin">Усі <b>${totalC.n}</b></a>` +
    `<a class="cat${noa?' active':''}" href="/admin?noa=1">Без опису <b>${totalC.noa}</b></a>` +
    `<a class="cat${noimg?' active':''}" href="/admin?noimg=1">📷 Без фото <b>${totalC.noimg}</b></a>` +
    `<a class="cat${nodosage?' active':''}" href="/admin?nodosage=1">💧 Без дозування <b>${totalC.nodosage}</b></a>` +
    `<a class="cat${noai?' active':''}" href="/admin?noai=1">🧬 Без діючої речовини <b>${totalC.noai}</b></a>` +
    `<a class="cat${nokw?' active':''}" href="/admin?nokw=1">🔑 Без ключових слів <b>${totalC.nokw}</b></a>` +
    `<a class="cat${dup?' active':''}" href="/admin?dup=1" style="${dup?'':'border-color:#e57373;color:#c0392b'}">⚠️ Дублі SKU <b>${dupTotal}</b></a>` +
    `<a class="cat${badsku?' active':''}" href="/admin?badsku=1" style="${badsku?'':'border-color:#e57373;color:#c0392b'}">SKU ≠ 00-/РТ-/AN- <b>${badTotal}</b></a>` +
    (catRows.results||[]).map(r => `<a class="cat${cat===r.c?' active':''}" href="/admin?cat=${encodeURIComponent(r.c||'')}">${esc(r.c||'—')} <b>${r.n}</b></a>`).join('') +
    '</div>';

  // ── вибірка ──
  let where = '0', binds = [];
  if (q) {
    where = '1'; // витягуємо всі, фільтруємо smartScore нижче
  }
  else if (noa) { where = "c.annotation=''"; }
  else if (noimg) { where = "c.image_ok=0"; }
  else if (nodosage) { where = "(c.dosage IS NULL OR c.dosage='') AND p.category='АГРОХІМІКАТИ'"; }
  else if (noai) { where = "(c.active_ingredient IS NULL OR c.active_ingredient='') AND p.category='АГРОХІМІКАТИ'"; }
  else if (nokw) { where = "(c.keywords IS NULL OR c.keywords='')"; }
  else if (dup) { where = "p.sku IN (SELECT sku FROM products GROUP BY sku HAVING COUNT(*)>1)"; }
  else if (badsku) { where = "p.sku NOT LIKE '00-%' AND p.sku NOT LIKE 'РТ-%' AND p.sku NOT LIKE 'AN-%'"; }
  else if (cat) { where = 'p.category=?'; binds = [cat]; }

  // ── smart-пошук (аналог app.js: normS + fuzzy + ранжування) ──
  function normS(s) {
    s = String(s == null ? '' : s).toLowerCase().replace(/[''`ʼ]/g, '');
    const FOLD = [['ё','е'],['є','е'],['і','и'],['ї','и'],['ы','и'],['ґ','г']];
    for (const [a,b] of FOLD) s = s.split(a).join(b);
    return s.replace(/[^a-z0-9а-я]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function editLe1(a, b) {
    if (a === b) return true;
    let la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    if (la > lb) { [a, b] = [b, a]; [la, lb] = [lb, la]; }
    let i = 0, j = 0, diff = 0;
    while (i < la && j < lb) {
      if (a[i] === b[j]) { i++; j++; }
      else { if (++diff > 1) return false; if (la === lb) { i++; j++; } else j++; }
    }
    return true;
  }
  function smartScore(name, sku, qtokens) {
    const sn = normS(name), snw = sn.split(' ').filter(Boolean), ss = normS(sku);
    let sum = 0;
    for (const tok of qtokens) {
      let best = 0;
      for (const w of snw) {
        if (w === tok) { best = Math.max(best, 5); break; }
        if ((w.startsWith(tok) || tok.startsWith(w)) && Math.min(w.length, tok.length) >= 3) best = Math.max(best, 4);
      }
      if (best < 3 && sn.includes(tok)) best = Math.max(best, 3);
      if (best < 3 && ss.includes(tok)) best = Math.max(best, 3);
      if (best < 2 && tok.length >= 4) {
        for (const w of snw) { if (editLe1(w, tok)) { best = Math.max(best, 2); break; } }
      }
      if (best === 0) return 0;
      sum += best;
    }
    return sum;
  }

  let rows = [], total = 0;
  if (where !== '0') {
    if (q) {
      const qtokens = normS(q).split(' ').filter(Boolean);
      const allRows = (await db.prepare(
        `SELECT p.pid, p.sku AS sku, COALESCE(NULLIF(c.display_name,''), p.name) AS name, p.category,(c.annotation!='') hasA,c.visible,c.image_ok
           FROM products p JOIN product_content c ON c.pid=p.pid
          ORDER BY COALESCE(NULLIF(c.display_name,''), p.name)`).all()).results || [];
      const scored = allRows
        .map(r => ({ r, sc: smartScore(r.name || '', r.sku || '', qtokens) }))
        .filter(x => x.sc > 0)
        .sort((a, b) => b.sc - a.sc);
      total = scored.length;
      rows = scored.slice((page - 1) * ps, page * ps).map(x => x.r);
    } else {
      total = (await db.prepare(`SELECT COUNT(*) n FROM products p JOIN product_content c ON c.pid=p.pid WHERE ${where}`).bind(...binds).first()).n;
      rows = (await db.prepare(
        `SELECT p.pid, p.sku AS sku, COALESCE(NULLIF(c.display_name,''), p.name) AS name, p.category,(c.annotation!='') hasA,c.visible,c.image_ok
           FROM products p JOIN product_content c ON c.pid=p.pid
          WHERE ${where} ORDER BY COALESCE(NULLIF(c.display_name,''), p.name) LIMIT ? OFFSET ?`).bind(...binds, ps, (page - 1) * ps).all()).results || [];
    }
  }

  const editQ = fp ? '&' + fp : '';
  const list = rows.map(x => {
    const tUrl = '/admin?toggle=' + x.pid + (fp ? '&' + fp : '');
    return `<tr><td style="width:24px;text-align:center"><input type="checkbox" name="pid" value="${x.pid}"></td>
     <td><a href="/admin?pid=${x.pid}${editQ}">${esc(x.name)}</a></td>
     <td class="muted" style="font-size:.8rem;white-space:nowrap">${esc(x.sku || '')}${dupSet.has(x.sku) ? ' <span title="дубль SKU" style="color:#c0392b">⚠️</span>' : ''}</td>
     <td class="muted">${esc(x.category||'')}</td>
     <td>${x.image_ok ? '<span class="ok">📷 є</span>' : '<span class="no">🚫 нема</span>'}</td>
     <td><a href="${esc(tUrl)}" title="Перемкнути показ у каталозі">${x.visible ? '👁 у каталозі' : '🙈 сховано'}</a></td></tr>`;
  }).join('');
  const pages = Math.ceil(total / ps);
  const pager = pages > 1 ? `<div class="pager">
     ${page>1?`<a class="btn" href="${esc(listUrl({cat,q,noa,noimg,nodosage,noai,nokw,dup,badsku,ps,page:page-1}))}">← Назад</a>`:''}
     <span class="muted">Стор. ${page} / ${pages} (${total})</span>
     ${page<pages?`<a class="btn" href="${esc(listUrl({cat,q,noa,noimg,nodosage,noai,nokw,dup,badsku,ps,page:page+1}))}">Далі →</a>`:''}
   </div>` : (total ? `<div class="muted" style="margin:10px 0">Знайдено: ${total}</div>` : '');

  const psBar = (where !== '0' && total) ? `<div class="muted" style="margin:8px 0">На сторінці: ` +
     PAGE_SIZES.map(n => n === ps
       ? `<b style="color:#2d6a2d">${n}</b>`
       : `<a href="${esc(listUrl({ cat, q, noa, noimg, nodosage, noai, nokw, dup, badsku, ps: n, page: 1 }))}">${n}</a>`).join(' · ') +
     `</div>` : '';

  const bulkBar = (noimg && total) ? `<div style="margin:10px 0;display:flex;gap:8px;flex-wrap:wrap">
      <a class="btn" style="background:#c0392b" href="/admin?bulk=hide-nophoto" onclick="return confirm('Сховати з каталогу ВСІ ${total} товарів без фото?')">🙈 Сховати всі без фото з каталогу</a>
      <a class="btn" style="background:#777" href="/admin?bulk=show-nophoto" onclick="return confirm('Знову показати в каталозі ВСІ товари без фото?')">👁 Показати всі</a>
    </div>` : '';

  const heading = q ? `Пошук: «${esc(q)}»` : noa ? 'Товари без опису' : noimg ? 'Товари без фото (файл відсутній)' : nodosage ? 'Агрохімікати без дозування' : noai ? 'Агрохімікати без діючої речовини' : nokw ? 'Товари без ключових слів' : dup ? 'Товари з дубльованим SKU (один SKU — різні товари)' : badsku ? 'Товари з некоректним SKU (не починається з 00-, РТ- або AN-)' : cat ? esc(cat) : 'Оберіть категорію або скористайтесь пошуком';

  // Панель групування фасовок: познач кілька товарів → обери групу → «Згрупувати» (B)
  const grpListB = rows.length ? await existingGroups(db) : [];
  const backUrl = listUrl({ cat, q, noa, noimg, nodosage, noai, nokw, dup, badsku, ps, page });
  const grpBar = rows.length ? `<div style="margin:10px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:#eef5ee;padding:8px 10px;border-radius:8px">
      📦 Познач фасовки галочками → у групу: ${groupComboHTML('gid', grpListB, '__new__')}
      <button class="btn" type="submit" style="padding:7px 12px">Згрупувати обрані</button>
      <span class="muted">«нова» = ключ із назви; розмір (250 г…) підставиться авто</span>
    </div>` : '';
  const body = `<h1>🛠 Адмінка «Агроном»</h1>
    <form method="GET" action="/admin" style="margin:10px 0;display:flex;gap:8px;">
      <input name="q" value="${esc(q)}" placeholder="Пошук за назвою…"><button class="btn">Знайти</button>
    </form>
    ${catNav}
    <h2>${heading}</h2>
    ${bulkBar}
    ${psBar}
    ${rows.length ? `<form method="POST" action="/admin/group-assign">
        <input type="hidden" name="back" value="${esc(backUrl)}">
        ${grpBar}
        <table><tr><th style="width:24px"></th><th>Назва</th><th>SKU</th><th>Категорія</th><th>Фото</th><th>Каталог</th></tr>${list}</table>
        ${pager}
      </form>`
                  : (where !== '0' ? '<p>Нічого не знайдено.</p>' : '<p class="muted">Натисніть категорію вгорі або скористайтесь пошуком.</p>')}
    ${navGrid()}`;
  return new Response(PAGE('Адмінка Агроном', body), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
