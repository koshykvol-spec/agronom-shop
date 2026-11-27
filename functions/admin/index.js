// /admin — навігація каталогом (категорії + пагінація) + пошук + форма редагування обогащення.
import { existingGroups, groupComboHTML, GROUP_COMBO_ASSETS } from './_grouputil.js';
import { allIngredients, productIngredientIds, ingredientPickerHTML, INGREDIENT_PICKER_ASSETS } from './_ingredients.js';
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
const PAGE_SIZES = [30, 60, 120, 240];
const DEFAULT_PAGE_SIZE = 60;

// ── кеш дашборд-статистики (5 хв) — прибирає 3 важких запити на кожне відкриття /admin ──
const STATS_TTL_MS = 5 * 60 * 1000;
async function getStats(db) {
  const cached = await db.prepare(`SELECT * FROM admin_stats_cache WHERE id=1`).first();
  const fresh = cached && (Date.now() - cached.updated_at) < STATS_TTL_MS;
  if (fresh) {
    return {
      totalC: { n: cached.total, noa: cached.noa, noimg: cached.noimg, nodosage: cached.nodosage,
                noai: cached.noai, nokw: cached.nokw, noseo: cached.noseo },
      noRevTotal: cached.norev,
      catRows: { results: JSON.parse(cached.cat_json) }
    };
  }
  const catRows = await db.prepare(`SELECT category c, COUNT(*) n FROM products GROUP BY category ORDER BY n DESC`).all();
  const totalC = await db.prepare(`SELECT COUNT(*) n,
                                     SUM(CASE WHEN COALESCE(c.annotation,'')='' THEN 1 ELSE 0 END) noa,
                                     SUM(CASE WHEN COALESCE(c.image_ok, 0)=0 THEN 1 ELSE 0 END) noimg,
                                     SUM(CASE WHEN (c.dosage IS NULL OR c.dosage='') AND p.category='АГРОХІМІКАТИ' THEN 1 ELSE 0 END) nodosage,
                                     SUM(CASE WHEN (c.active_ingredient IS NULL OR c.active_ingredient='') AND p.category='АГРОХІМІКАТИ' THEN 1 ELSE 0 END) noai,
                                     SUM(CASE WHEN c.keywords IS NULL OR c.keywords='' THEN 1 ELSE 0 END) nokw,
                                     SUM(CASE WHEN COALESCE(c.meta_title,'')='' OR COALESCE(c.meta_desc,'')='' THEN 1 ELSE 0 END) noseo
                                     FROM products p JOIN product_content c ON c.pid=p.pid`).first();
  const noRevTotal = (((await db.prepare(`SELECT COUNT(*) n FROM products p WHERE NOT EXISTS (SELECT 1 FROM reviews r WHERE r.pid=p.pid)`).first()) || {}).n) | 0;

  await db.prepare(`INSERT INTO admin_stats_cache (id, total, noa, noimg, nodosage, noai, nokw, noseo, norev, cat_json, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET total=excluded.total, noa=excluded.noa, noimg=excluded.noimg,
       nodosage=excluded.nodosage, noai=excluded.noai, nokw=excluded.nokw, noseo=excluded.noseo,
       norev=excluded.norev, cat_json=excluded.cat_json, updated_at=excluded.updated_at`)
    .bind(totalC.n, totalC.noa, totalC.noimg, totalC.nodosage, totalC.noai, totalC.nokw, totalC.noseo, noRevTotal, JSON.stringify(catRows.results || []), Date.now())
    .run();

  return { totalC, noRevTotal, catRows };
}

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
.cat.active{background:#2d6a2d;color:#fff} .subcats{margin:-2px 0 10px;padding-left:10px;border-left:3px solid #c8e0c8} .subcats .cat{font-size:.8rem;padding:4px 10px} .cat b{opacity:.6;font-weight:400}
.pager{display:flex;gap:10px;align-items:center;margin:14px 0}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body>${body}${GROUP_COMBO_ASSETS}${INGREDIENT_PICKER_ASSETS}</body></html>`;

// Грід плиток-розділів адмінки (замість текстового списку)
function navGrid() {
  const groups = [
    { h: '📨 Операційне', items: [
      ['/admin/orders', '🛒', 'Замовлення'], ['/admin/reviews', '⭐', 'Відгуки'],
      ['/admin/diagnose-stats', '🔬', 'Порадник по фото (статистика)'] ] },
    { h: '⚙️ Налаштування', items: [
      ['/admin/categories', '📂', 'Категорії'], ['/admin/pages', '📄', 'Сторінки'],
      ['/admin/contacts', '📍', 'Контакти'], ['/admin/recipes', '🧪', 'Чипи'],
      ['/admin/seasonal', '🌱', 'Сезонний'], ['/admin/schemes', '🛡', 'Схеми'],
      ['/admin/search', '🔍', 'Пошук'], ['/admin/checkout', '🚚', 'Доставка й оплата'],
      ['/admin/keys', '🔑', 'Ключі'], ['/admin/np-sender', '📦', 'Відправник НП'] ] },
    { h: '🛠 Каталог', items: [
      ['/admin/import', '⬆️', 'Імпорт 1С'], ['/admin/newproducts', '🆕', 'Нові товари (опис + ключові + SEO)'],
      ['/admin/anno', '✍️', 'Анотації (масово)'],
      ['/admin/reviews-bulk', '💬', 'Відгуки (масово)'],
      ['/admin/dedup', '🔀', 'Дублі SKU'], ['/admin/merge', '🔗', 'Злити товари (колізії)'],
      ['/admin/groups', '📦', 'Групування фасовок'], ['/admin/ingredients', '🧪', 'Діючі речовини'],
      ['/admin/aifill', '🤖', 'AI: дозування / діючі'], ['/admin/keywords', '🔑', 'Ключові слова (масово)'],
      ['/admin/metadesc', '🔍', 'SEO description (масово)'] ] },
  ];
  return '<div class="adm-sections">' + groups.map(g =>
    `<div class="adm-sec"><div class="adm-sec-h">${g.h}</div><div class="adm-tiles">` +
    g.items.map(([href, ico, label]) => `<a class="adm-tile" href="${href}"><span class="adm-tile-ico">${ico}</span><span>${label}</span></a>`).join('') +
    '</div></div>').join('') + '</div>';
}

function fparams(o) {
  const u = new URLSearchParams();
  if (o.cat) u.set('cat', o.cat);
  if (o.cat && o.sub) u.set('sub', o.sub);
  if (o.q) u.set('q', o.q);
  if (o.noa) u.set('noa', '1');
  if (o.noimg) u.set('noimg', '1');
  if (o.nodosage) u.set('nodosage', '1');
  if (o.noai) u.set('noai', '1');
  if (o.nokw) u.set('nokw', '1');
  if (o.noseo) u.set('noseo', '1');
  if (o.norev) u.set('norev', '1');
  if (o.ps && o.ps !== DEFAULT_PAGE_SIZE) u.set('ps', o.ps);
  if (o.page && o.page > 1) u.set('page', o.page);
  return u.toString();
}
const NONE_SUB = '__none';
const listUrl = o => { const f = fparams(o); return '/admin' + (f ? '?' + f : ''); };

// image_ok = чи існує файл головного (з найменшим sort) фото товару
async function recomputeImageOk(env, db, pid) {
  const prim = await db.prepare(`SELECT path FROM product_images WHERE pid=? ORDER BY sort, id LIMIT 1`).bind(pid).first();
  let ok = 0;
  if (prim && prim.path) {
    try { ok = (await env.IMAGES.head(prim.path)) ? 1 : 0; } catch (e) { ok = 0; }
  }
  await db.prepare(`UPDATE product_content SET image_ok=? WHERE pid=?`).bind(ok, pid).run();
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const db = env.DB;
  const pid = url.searchParams.get('pid');
  const cat = url.searchParams.get('cat') || '';
  const sub = cat ? (url.searchParams.get('sub') || '') : '';   // підгрупа всередині категорії (products.brand: Гербіциди, Фунгіциди…); NONE_SUB = без підгрупи
  const q = (url.searchParams.get('q') || '').trim();
  const noa = url.searchParams.get('noa') === '1';
  const noimg = url.searchParams.get('noimg') === '1';
  const nodosage = url.searchParams.get('nodosage') === '1';
  const noai = url.searchParams.get('noai') === '1';
  const nokw = url.searchParams.get('nokw') === '1';
  const noseo = url.searchParams.get('noseo') === '1';
  const norev = url.searchParams.get('norev') === '1';
  let ps = parseInt(url.searchParams.get('ps') || '', 10);
  if (!PAGE_SIZES.includes(ps)) ps = DEFAULT_PAGE_SIZE;
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const fp = fparams({ cat, sub, q, noa, noimg, nodosage, noai, nokw, noseo, norev, ps, page });

  // ── швидкі дії зі списку (перемикання показу в каталозі / масове приховування) ──
  const toggle = url.searchParams.get('toggle');
  if (toggle) {
    await db.prepare(`UPDATE product_content SET visible = CASE WHEN visible=1 THEN 0 ELSE 1 END WHERE pid=?`).bind(toggle).run();
    return Response.redirect(new URL(listUrl({ cat, sub, q, noa, noimg, nodosage, noai, nokw, noseo, norev, ps, page }), request.url).toString(), 303);
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
    const hid = ['cat', 'q', 'noa', 'noimg', 'nodosage', 'noai', 'nokw', 'noseo', 'norev', 'ps', 'page'].map(k => `<input type="hidden" name="${k}" value="${esc(url.searchParams.get(k) || '')}">`).join('');
    const gallery = `<div class="row" style="margin-top:12px">
      <b>📷 Фото товару (${imgs.length})</b>${imgs.length > 1 ? ' <span class="muted">🖐 перетягуйте для зміни порядку (перше = головне) · 🔍 клік по фото — переглянути</span> <span id="ph-status" style="font-size:.78rem"></span>' : ''}
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
        <label class="btn" style="background:#555;margin:0;cursor:pointer">📂 Виберіть фото<input type="file" name="photo" accept="image/*" multiple style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" onchange="phPicked(this)"></label>
        <span class="fname muted" style="flex:1;min-width:120px">Оберіть одне чи кілька фото — завантажаться одразу</span>
        <button class="btn" type="submit" style="display:none">⬆️ Завантажити фото</button>
      </form>
      <div class="muted" style="margin-top:6px">Перше (★ головне) показується в каталозі. Фото автоматично стискається (макс 800px, webp) + створюється мініатюра для каталогу (400px). Формати: webp/jpg/png.</div>
      <script>
      // Автостиснення фото в браузері перед завантаженням (макс 800px, webp q82) — без сторонніх сервісів
      function phPicked(inp){
        var form=inp.form||inp.closest('form');
        if(!inp.files||!inp.files.length) return;
        var s=form.querySelector('.fname'); if(s) s.textContent='⏳ Завантаження: '+inp.files.length+' фото…';
        if(form.requestSubmit) form.requestSubmit(); else form.querySelector('button[type=submit]').click();   // сабміт одразу після вибору
      }
      // стискаємо одне фото в браузері (макс 800px, webp q82) + мініатюра 400px; помилка → повертаємо null (залити оригінал)
      async function phPrepare(file){
        try{
          var bmp = await createImageBitmap(file);
          var MAX=800, scale=Math.min(1, MAX/Math.max(bmp.width,bmp.height));
          var w=Math.round(bmp.width*scale), h=Math.round(bmp.height*scale);
          var cv=document.createElement('canvas'); cv.width=w; cv.height=h;
          cv.getContext('2d').drawImage(bmp,0,0,w,h);
          var blob = await new Promise(function(res){ cv.toBlob(res,'image/webp',0.82); });
          if(!blob || blob.size>file.size) return null;           // не вийшло менше → залити оригінал
          var out={photo:blob, name:(file.name.replace(/\\.[^.]+$/,'')||'photo')+'.webp', thumb:null};
          var TMAX=400;
          if(Math.max(bmp.width,bmp.height)>TMAX){
            var ts=TMAX/Math.max(bmp.width,bmp.height), tw=Math.round(bmp.width*ts), th=Math.round(bmp.height*ts);
            var tcv=document.createElement('canvas'); tcv.width=tw; tcv.height=th;
            tcv.getContext('2d').drawImage(bmp,0,0,tw,th);
            out.thumb = await new Promise(function(res){ tcv.toBlob(res,'image/webp',0.8); });
          }
          return out;
        }catch(e){ return null; }
      }
      async function shrinkUpload(form, ev){
        var inp = form.querySelector('input[name=photo]');
        var files = inp.files ? [].slice.call(inp.files).filter(function(f){return /^image\\//.test(f.type);}) : [];
        if(!files.length) return true;                            // нема фото / не зображення → звичайний сабміт
        ev.preventDefault();
        var st=form.querySelector('.fname'), fails=0;
        for(var n=0;n<files.length;n++){
          if(st) st.textContent='⏳ Завантаження '+(n+1)+' / '+files.length+'…';
          var f=files[n], prep=await phPrepare(f);
          var fd=new FormData(form); fd.delete('photo'); fd.delete('thumb');
          if(prep){ fd.set('photo',prep.photo,prep.name); if(prep.thumb) fd.set('thumb',prep.thumb,'thumb.webp'); }
          else fd.set('photo',f,f.name);                          // оригінал як є
          try{ var r=await fetch(form.action,{method:'POST',body:fd,redirect:'follow'}); if(!r.ok) fails++; }catch(e){ fails++; }
        }
        if(fails && st){ st.textContent='⚠️ Не вдалося завантажити: '+fails+' з '+files.length; setTimeout(function(){location.reload();},1800); }
        else location.reload();
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
        c.title='Клік — переглянути, перетягніть — змінити порядок';
      });

      // ── Перегляд фото (збільшення по кліку) ──
      var pv=null, list=[], idx=0, prevOv='';
      function btn(cls,txt,label,pos){
        var b=document.createElement('button'); b.type='button'; b.className=cls; b.textContent=txt; b.setAttribute('aria-label',label);
        b.style.cssText='position:absolute;border:0;background:rgba(255,255,255,.18);color:#fff;font-size:1.7rem;width:46px;height:46px;border-radius:50%;cursor:pointer;line-height:1;padding:0;'+pos;
        return b;
      }
      function build(){
        pv=document.createElement('div'); pv.hidden=true;
        pv.setAttribute('role','dialog'); pv.setAttribute('aria-modal','true'); pv.setAttribute('aria-label','Перегляд фото');
        pv.style.cssText='position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.9);display:none;align-items:center;justify-content:center;touch-action:pinch-zoom';
        var im=document.createElement('img'); im.className='pv-img'; im.alt='';
        im.style.cssText='max-width:94vw;max-height:84vh;object-fit:contain;border-radius:6px;background:#fff';
        var bar=document.createElement('div'); bar.style.cssText='position:absolute;bottom:14px;left:0;right:0;display:flex;gap:16px;justify-content:center;align-items:center;color:#fff;font-size:.88rem';
        bar.innerHTML='<span class="pv-count"></span><span class="pv-main"></span><a class="pv-open" target="_blank" rel="noopener" style="color:#fff;text-decoration:underline">Відкрити оригінал ↗</a><button type="button" class="pv-edit" style="border:0;border-radius:8px;padding:7px 14px;cursor:pointer;background:#ff9800;color:#fff;font-size:.88rem">✏️ Редагувати</button>';
        var x=btn('pv-close','×','Закрити','top:14px;right:14px'), pr=btn('pv-prev','‹','Попереднє фото','left:14px;top:50%;transform:translateY(-50%)'), nx=btn('pv-next','›','Наступне фото','right:14px;top:50%;transform:translateY(-50%)');
        pv.appendChild(x); pv.appendChild(pr); pv.appendChild(im); pv.appendChild(nx); pv.appendChild(bar);
        document.body.appendChild(pv);
        x.addEventListener('click',close);
        bar.querySelector('.pv-edit').addEventListener('click',function(e){e.stopPropagation(); openEditor(list[idx]);});
        pr.addEventListener('click',function(e){e.stopPropagation();go(-1);});
        nx.addEventListener('click',function(e){e.stopPropagation();go(1);});
        pv.addEventListener('click',function(e){if(e.target===pv) close();});
        var x0=null;
        pv.addEventListener('touchstart',function(e){x0=e.touches.length===1?e.touches[0].clientX:null;},{passive:true});
        pv.addEventListener('touchend',function(e){if(x0===null) return; var dx=e.changedTouches[0].clientX-x0; x0=null; if(Math.abs(dx)>50&&list.length>1) go(dx<0?1:-1);},{passive:true});
        document.addEventListener('keydown',function(e){
          if(!pv||pv.hidden) return;
          if(e.key==='Escape') close();
          else if(e.key==='ArrowLeft'&&list.length>1) go(-1);
          else if(e.key==='ArrowRight'&&list.length>1) go(1);
        });
      }
      function show(){
        var it=list[idx];
        pv.querySelector('.pv-img').src=it.url;
        pv.querySelector('.pv-count').textContent=list.length>1?(idx+1)+' / '+list.length:'';
        pv.querySelector('.pv-main').textContent=it.primary?'★ головне фото':'';
        pv.querySelector('.pv-open').href=it.url;
        pv.querySelector('.pv-prev').style.display=pv.querySelector('.pv-next').style.display=list.length>1?'':'none';
      }
      function go(d){idx=(idx+d+list.length)%list.length; show();}
      function close(){pv.hidden=true; pv.style.display='none'; document.body.style.overflow=prevOv;}
      cards().forEach(function(c){
        c.addEventListener('click',function(e){
          if(e.target.closest('a')) return;
          var all=cards();   // порядок беремо з DOM: після перетягування він міг змінитись
          list=all.map(function(el,i){return {id:el.getAttribute('data-id'), url:el.querySelector('img').getAttribute('src'), primary:i===0};});
          idx=Math.max(0,all.indexOf(c));
          if(!pv) build();
          show(); pv.hidden=false; pv.style.display='flex';
          prevOv=document.body.style.overflow; document.body.style.overflow='hidden';
          pv.querySelector('.pv-close').focus();
        });
      });

      // ── Редактор фото: поворот, відзеркалення, обрізка, замальовування, яскравість/контраст ──
      // Заповнення ділянки за сусідніми фрагментами фото (для «Ластика»)
// Заповнення виділеної ділянки за сусідніми фрагментами фото (exemplar-based, спрощений Criminisi).
      // inpaint(rgba: Uint8ClampedArray, w, h, mask: Uint8Array(1 = стерти)) → змінює rgba на місці, повертає кількість заповнених пікселів.
      function edInpaint(rgba, w, h, mask) {
        var r = 4, S = 2 * r + 1, n = w * h, R0 = 40;
        var m = new Uint8Array(mask), conf = new Float32Array(n), i, x, y;
        var left = 0;
        for (i = 0; i < n; i++) { if (m[i]) left++; else conf[i] = 1; }
        var total = left;
        // інтегральна маска → швидка перевірка «у фрагменті немає невідомих пікселів»
        var W1 = w + 1, ii = new Int32Array(W1 * (h + 1));
        function buildII() {
          for (y = 0; y < h; y++) { var row = 0; for (x = 0; x < w; x++) { row += m[y * w + x]; ii[(y + 1) * W1 + x + 1] = ii[y * W1 + x + 1] + row; } }
        }
        function maskSum(x0, y0, x1, y1) { return ii[(y1 + 1) * W1 + x1 + 1] - ii[y0 * W1 + x1 + 1] - ii[(y1 + 1) * W1 + x0] + ii[y0 * W1 + x0]; }
        buildII();
        // для ефективності перебудовуємо інтегральну маску не щоразу, а раз на кілька заповнень
        var sinceII = 0;
        var front = [];
        function isFront(p) {
          if (!m[p]) return false; var px = p % w, py = (p / w) | 0;
          return (px > 0 && !m[p - 1]) || (px < w - 1 && !m[p + 1]) || (py > 0 && !m[p - w]) || (py < h - 1 && !m[p + w]);
        }
        for (i = 0; i < n; i++) if (isFront(i)) front.push(i);
        var guard = 0;
        while (left > 0 && guard++ < total + 50) {
          // пріоритет: середня «достовірність» у фрагменті (заповнюємо від країв всередину)
          var best = -1, bp = -1;
          for (var f = 0; f < front.length; f++) {
            var p = front[f]; if (!m[p]) continue;
            var px = p % w, py = (p / w) | 0, s = 0, c = 0;
            for (var dy = -r; dy <= r; dy++) { var yy = py + dy; if (yy < 0 || yy >= h) continue; for (var dx = -r; dx <= r; dx++) { var xx = px + dx; if (xx < 0 || xx >= w) continue; s += conf[yy * w + xx]; c++; } }
            var pr = s / (S * S);
            if (pr > best) { best = pr; bp = p; }
          }
          if (bp < 0) break;
          var tx = bp % w, ty = (bp / w) | 0;
          if (sinceII >= 40) { buildII(); sinceII = 0; }
          // пошук найкращого фрагмента у вікні навколо; розширюємо вікно, якщо джерел немає
          var bestD = 1e18, bsx = -1, bsy = -1, R = R0;
          for (var tries = 0; tries < 4 && bsx < 0; tries++, R *= 2) {
            var x0 = Math.max(r, tx - R), x1 = Math.min(w - 1 - r, tx + R), y0 = Math.max(r, ty - R), y1 = Math.min(h - 1 - r, ty + R);
            for (var sy = y0; sy <= y1; sy++) for (var sx = x0; sx <= x1; sx++) {
              if (maskSum(sx - r, sy - r, sx + r, sy + r) - 0 > 0) continue;   // джерело — лише повністю відомі фрагменти (інтегральна маска трохи застаріла, але лише в бік «обережніше»)
              var d = 0, k = 0;
              for (dy = -r; dy <= r && d < bestD; dy++) {
                var ty2 = ty + dy; if (ty2 < 0 || ty2 >= h) continue;
                for (dx = -r; dx <= r; dx++) {
                  var tx2 = tx + dx; if (tx2 < 0 || tx2 >= w) continue;
                  var q = ty2 * w + tx2; if (m[q]) continue;
                  var a = q * 4, b = ((sy + dy) * w + sx + dx) * 4;
                  var e0 = rgba[a] - rgba[b], e1 = rgba[a + 1] - rgba[b + 1], e2 = rgba[a + 2] - rgba[b + 2];
                  d += e0 * e0 + e1 * e1 + e2 * e2;
                }
              }
              if (d < bestD) { bestD = d; bsx = sx; bsy = sy; }
            }
          }
          if (bsx < 0) { // зовсім немає джерел — беремо середній колір відомих сусідів
            var qa = bp * 4; rgba[qa] = rgba[qa + 1] = rgba[qa + 2] = 128; m[bp] = 0; conf[bp] = 0.1; left--; continue;
          }
          var cval = best;
          for (dy = -r; dy <= r; dy++) {
            var yy2 = ty + dy; if (yy2 < 0 || yy2 >= h) continue;
            for (dx = -r; dx <= r; dx++) {
              var xx2 = tx + dx; if (xx2 < 0 || xx2 >= w) continue;
              var q2 = yy2 * w + xx2; if (!m[q2]) continue;
              var a2 = q2 * 4, b2 = ((bsy + dy) * w + bsx + dx) * 4;
              rgba[a2] = rgba[b2]; rgba[a2 + 1] = rgba[b2 + 1]; rgba[a2 + 2] = rgba[b2 + 2];
              m[q2] = 0; conf[q2] = cval; left--;
              // нові пікселі фронту
              if (xx2 > 0 && m[q2 - 1]) front.push(q2 - 1); if (xx2 < w - 1 && m[q2 + 1]) front.push(q2 + 1);
              if (yy2 > 0 && m[q2 - w]) front.push(q2 - w); if (yy2 < h - 1 && m[q2 + w]) front.push(q2 + w);
            }
          }
          sinceII++;
          if (front.length > 4 * n) front = front.filter(function (p) { return m[p]; });
          else if (guard % 50 === 0) front = front.filter(function (p) { return m[p]; });
        }
        return total - left;
      }

      var ed=null;
      function edBtn(txt,title,fn,extra){
        var b=document.createElement('button'); b.type='button'; b.textContent=txt; b.title=title||'';
        b.style.cssText='border:0;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:.9rem;background:#fff;color:#222;'+(extra||'');
        b.addEventListener('click',fn); return b;
      }
      function edClose(){ if(ed){ ed.remove(); ed=null; } }
      function openEditor(it){
        edClose();
        var pid=grid.getAttribute('data-pid');
        var src=new Image();
        src.onload=function(){ start(src); };
        src.onerror=function(){ alert('Не вдалося завантажити фото для редагування'); };
        src.src=it.url;
        function cnv(w,h){var c=document.createElement('canvas'); c.width=w; c.height=h; return c;}
        function start(img){
          var CAP=2000, k=Math.min(1,CAP/Math.max(img.naturalWidth,img.naturalHeight));
          var work=cnv(Math.round(img.naturalWidth*k),Math.round(img.naturalHeight*k));
          work.getContext('2d').drawImage(img,0,0,work.width,work.height);
          var hist=[], mode='crop', rect=null, bright=100, contr=100, s=1, brush=24, thin=true, mk=cnv(1,1), lastp=null;
          ed=document.createElement('div');
          ed.style.cssText='position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.94);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:10px;box-sizing:border-box';
          ed.setAttribute('role','dialog'); ed.setAttribute('aria-modal','true'); ed.setAttribute('aria-label','Редагування фото');
          var dc=document.createElement('canvas'); dc.style.cssText='touch-action:none;cursor:crosshair;background:#fff;border-radius:4px;max-width:96vw';
          var tools=document.createElement('div'); tools.style.cssText='display:flex;flex-wrap:wrap;gap:6px;justify-content:center';
          var sl=document.createElement('div'); sl.style.cssText='display:flex;flex-wrap:wrap;gap:14px;justify-content:center;color:#fff;font-size:.82rem;align-items:center';
          var acts=document.createElement('div'); acts.style.cssText='display:flex;flex-wrap:wrap;gap:8px;justify-content:center';
          var msg=document.createElement('div'); msg.style.cssText='color:#ddd;font-size:.8rem;min-height:1.1em;text-align:center'; 
          function say(t){msg.textContent=t||'';}
          function push(){ var c=cnv(work.width,work.height); c.getContext('2d').drawImage(work,0,0); hist.push(c); if(hist.length>12) hist.shift(); }
          function layout(){
            var maxW=Math.min(window.innerWidth*0.94,1100), maxH=window.innerHeight-250;
            s=Math.min(1,maxW/work.width,maxH/work.height);
            dc.width=Math.max(1,Math.round(work.width*s)); dc.height=Math.max(1,Math.round(work.height*s));
            mk.width=dc.width; mk.height=dc.height;   // шар зафарбованого (скидається при зміні картинки)
            draw();
          }
          function draw(){
            var g=dc.getContext('2d'); g.clearRect(0,0,dc.width,dc.height); g.drawImage(work,0,0,dc.width,dc.height);
            dc.style.filter='brightness('+bright+'%) contrast('+contr+'%)';
            if(mode==='erase'){ g.save(); g.globalAlpha=0.5; g.drawImage(mk,0,0); g.restore(); }
            if(rect){
              g.save(); g.fillStyle='rgba(0,0,0,.45)';
              if(mode==='crop'){
                g.fillRect(0,0,dc.width,rect.y); g.fillRect(0,rect.y+rect.h,dc.width,dc.height-rect.y-rect.h);
                g.fillRect(0,rect.y,rect.x,rect.h); g.fillRect(rect.x+rect.w,rect.y,dc.width-rect.x-rect.w,rect.h);
              }
              g.strokeStyle=mode==='crop'?'#4caf50':'#ff9800'; g.lineWidth=2; g.setLineDash([6,4]); g.strokeRect(rect.x+1,rect.y+1,rect.w-2,rect.h-2);
              g.restore();
            }
          }
          function setWork(c){ work=c; rect=null; layout(); }
          function rotate(dir){
            push(); var c=cnv(work.height,work.width), g=c.getContext('2d');
            g.translate(c.width/2,c.height/2); g.rotate(dir*Math.PI/2); g.drawImage(work,-work.width/2,-work.height/2); setWork(c);
          }
          function flip(){ push(); var c=cnv(work.width,work.height), g=c.getContext('2d'); g.translate(c.width,0); g.scale(-1,1); g.drawImage(work,0,0); setWork(c); }
          function undo(){ if(!hist.length){ say('Немає що скасовувати'); return; } setWork(hist.pop()); say(''); }
          function reset(){ push(); var c=cnv(Math.round(img.naturalWidth*k),Math.round(img.naturalHeight*k)); c.getContext('2d').drawImage(img,0,0,c.width,c.height); bright=100; contr=100; bs.value=100; cs.value=100; setWork(c); say('Скинуто до оригіналу'); }
          function applyRect(){
            if(mode==='erase'){ applyErase(); return; }
            if(!rect||rect.w<4||rect.h<4){ say('Спочатку виділіть ділянку мишею/пальцем'); return; }
            var rx=Math.round(rect.x/s), ry=Math.round(rect.y/s), rw=Math.round(rect.w/s), rh=Math.round(rect.h/s);
            rx=Math.max(0,rx); ry=Math.max(0,ry); rw=Math.min(rw,work.width-rx); rh=Math.min(rh,work.height-ry);
            push();
            if(mode==='crop'){
              var c=cnv(rw,rh); c.getContext('2d').drawImage(work,rx,ry,rw,rh,0,0,rw,rh); setWork(c);
            } else {
              // замальовування: колір = середній по смузі 6px навколо ділянки (для написів на однотонному тлі)
              var g=work.getContext('2d'), P=6, x0=Math.max(0,rx-P), y0=Math.max(0,ry-P), x1=Math.min(work.width,rx+rw+P), y1=Math.min(work.height,ry+rh+P);
              var d=g.getImageData(x0,y0,x1-x0,y1-y0), w=d.width, sr=0,sg=0,sb=0,n=0;
              for(var y=0;y<d.height;y++) for(var x=0;x<w;x++){
                var ax=x0+x, ay=y0+y; if(ax>=rx&&ax<rx+rw&&ay>=ry&&ay<ry+rh) continue;
                var i=(y*w+x)*4; sr+=d.data[i]; sg+=d.data[i+1]; sb+=d.data[i+2]; n++;
              }
              if(n){ g.fillStyle='rgb('+Math.round(sr/n)+','+Math.round(sg/n)+','+Math.round(sb/n)+')'; g.fillRect(rx,ry,rw,rh); }
              rect=null; layout();
            }
            say('');
          }
          // виділення ділянки
          var drag=null;
          function setBusy(on){ [].forEach.call(acts.querySelectorAll('button'),function(b){b.disabled=on;}); }
    function applyErase() {
      var W = work.width, H = work.height, n = W * H, i, x, y;
      var mc = cnv(W, H), mg = mc.getContext('2d'); mg.drawImage(mk, 0, 0, W, H);
      var md = mg.getImageData(0, 0, W, H).data, m = new Uint8Array(n), cnt = 0;
      for (i = 0; i < n; i++) if (md[i * 4 + 3] > 64) { m[i] = 1; cnt++; }
      if (!cnt) { say('Зафарбуйте напис пензлем, потім натисніть «Застосувати»'); return; }
      var id = work.getContext('2d').getImageData(0, 0, W, H), d = id.data;
      var fin = m;
      if (thin) {
        // лише тонкі штрихи (текст) всередині зафарбованого: піксель помітно відрізняється від середнього в околі 11x11
        var gr = new Float32Array(n);
        for (i = 0; i < n; i++) gr[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
        var t = new Uint8Array(n), c2 = 0;
        for (y = 5; y < H - 5; y++) for (x = 5; x < W - 5; x++) {
          var p = y * W + x; if (!m[p]) continue;
          var sm = 0; for (var dy = -5; dy <= 5; dy++) for (var dx = -5; dx <= 5; dx++) sm += gr[p + dy * W + dx];
          var df = gr[p] - sm / 121; if (df > 2.2 || df < -2.2) { t[p] = 1; c2++; }
        }
        if (c2 > 20) {
          fin = new Uint8Array(n); cnt = 0;
          for (y = 2; y < H - 2; y++) for (x = 2; x < W - 2; x++) {
            var q = y * W + x; if (!m[q]) continue;
            var hit = 0; for (dy = -2; dy <= 2 && !hit; dy++) for (dx = -2; dx <= 2; dx++) if (t[q + dy * W + dx]) { hit = 1; break; }
            if (hit) { fin[q] = 1; cnt++; }
          }
        } else say('Тонких штрихів не знайдено — стираю все зафарбоване');
      }
      if (cnt > 70000) { say('Ділянка завелика (' + cnt + ' px) — зафарбуйте менше за раз'); return; }
      say('⏳ Стираю…'); setBusy(true);
      setTimeout(function () {
        try {
          push(); edInpaint(d, W, H, fin);
          var c = cnv(W, H); c.getContext('2d').putImageData(id, 0, 0); setWork(c);
          say('Готово. Можна зафарбувати ще або скасувати крок');
        } catch (e) { hist.pop(); say('Помилка: ' + (e && e.message || e)); }
        setBusy(false);
      }, 30);
    }
          function stroke(a,b){
            var g=mk.getContext('2d'); g.strokeStyle='#ff1744'; g.fillStyle='#ff1744'; g.lineWidth=brush; g.lineCap='round'; g.lineJoin='round';
            g.beginPath(); g.moveTo(a.x,a.y); g.lineTo(b.x,b.y); g.stroke(); draw();
          }
          function pt(e){ var r=dc.getBoundingClientRect(); return {x:Math.max(0,Math.min(dc.width,(e.clientX-r.left)*dc.width/r.width)), y:Math.max(0,Math.min(dc.height,(e.clientY-r.top)*dc.height/r.height))}; }
          dc.addEventListener('pointerdown',function(e){ if(mode==='erase'){ lastp=pt(e); stroke(lastp,lastp); try{dc.setPointerCapture(e.pointerId);}catch(_){} e.preventDefault(); return; } drag=pt(e); rect={x:drag.x,y:drag.y,w:0,h:0}; try{dc.setPointerCapture(e.pointerId);}catch(_){} e.preventDefault(); });
          dc.addEventListener('pointermove',function(e){ if(mode==='erase'){ if(lastp){ var np=pt(e); stroke(lastp,np); lastp=np; } return; } if(!drag) return; var p=pt(e); rect={x:Math.min(drag.x,p.x),y:Math.min(drag.y,p.y),w:Math.abs(p.x-drag.x),h:Math.abs(p.y-drag.y)}; draw(); });
          dc.addEventListener('pointerup',function(){ lastp=null; drag=null; if(rect&&(rect.w<4||rect.h<4)){ rect=null; draw(); } });
          // панель
          var bCrop=edBtn('✂️ Обрізка','Виділіть ділянку, що залишиться',function(){mode='crop';mark();draw();}), bErase=edBtn('🪄 Ластик','Зафарбуйте напис пензлем — він зникне, а фон добудується з сусідніх ділянок',function(){mode='erase';rect=null;mark();draw();say('Зафарбуйте напис пензлем, потім натисніть «Застосувати»');}), bFill=edBtn('🩹 Замалювати','Виділіть напис на однотонному тлі — заливається кольором навколо',function(){mode='fill';mark();draw();});
          function mark(){ bCrop.style.background=mode==='crop'?'#4caf50':'#fff'; bCrop.style.color=mode==='crop'?'#fff':'#222'; bFill.style.background=mode==='fill'?'#ff9800':'#fff'; bFill.style.color=mode==='fill'?'#fff':'#222'; bErase.style.background=mode==='erase'?'#9c27b0':'#fff'; bErase.style.color=mode==='erase'?'#fff':'#222'; dc.style.cursor=mode==='erase'?'cell':'crosshair'; }
          tools.appendChild(edBtn('⟲','Повернути вліво',function(){rotate(-1);})); tools.appendChild(edBtn('⟳','Повернути вправо',function(){rotate(1);}));
          tools.appendChild(edBtn('⇋','Відзеркалити',flip)); tools.appendChild(bCrop); tools.appendChild(bFill); tools.appendChild(bErase);
          tools.appendChild(edBtn('✔ Застосувати','Обрізати / замалювати виділене / стерти зафарбоване',applyRect,'background:#2d6a2d;color:#fff'));
          tools.appendChild(edBtn('↶ Скасувати крок','',undo)); tools.appendChild(edBtn('⟲⟲ До оригіналу','',reset));
          function slider(label,val,cb){ var l=document.createElement('label'); l.style.cssText='display:flex;gap:6px;align-items:center'; l.appendChild(document.createTextNode(label)); var r=document.createElement('input'); r.type='range'; r.min=50; r.max=150; r.value=val; r.style.cssText='width:140px;padding:0'; r.addEventListener('input',function(){cb(+r.value);}); l.appendChild(r); sl.appendChild(l); return r; }
          var bs=slider('Яскравість',100,function(v){bright=v;draw();}), cs=slider('Контраст',100,function(v){contr=v;draw();});
          (function(){
            var l=document.createElement('label'); l.style.cssText='display:flex;gap:6px;align-items:center';
            l.appendChild(document.createTextNode('Пензель'));
            var r=document.createElement('input'); r.type='range'; r.min=6; r.max=80; r.value=brush; r.style.cssText='width:120px;padding:0';
            r.addEventListener('input',function(){brush=+r.value;}); l.appendChild(r); sl.appendChild(l);
            var l2=document.createElement('label'); l2.style.cssText='display:flex;gap:6px;align-items:center;cursor:pointer';
            var cb=document.createElement('input'); cb.type='checkbox'; cb.checked=true; cb.style.cssText='width:auto;margin:0';
            cb.addEventListener('change',function(){thin=cb.checked;});
            l2.appendChild(cb); l2.appendChild(document.createTextNode('Лише тонкий напис')); l2.title='Стирати тільки тонкі штрихи тексту всередині зафарбованого, а не все'; sl.appendChild(l2);
          })();
          // збереження
          function out(maxSide){
            var f=Math.min(1,maxSide/Math.max(work.width,work.height)), c=cnv(Math.max(1,Math.round(work.width*f)),Math.max(1,Math.round(work.height*f))), g=c.getContext('2d');
            g.drawImage(work,0,0,c.width,c.height);
            if(bright!==100||contr!==100){
              var d=g.getImageData(0,0,c.width,c.height), b=bright/100, ct=contr/100, a=d.data;
              for(var i=0;i<a.length;i+=4) for(var j=0;j<3;j++){ var v=a[i+j]*b; v=(v-128)*ct+128; a[i+j]=v<0?0:v>255?255:v; }
              g.putImageData(d,0,0);
            }
            return c;
          }
          function blobOf(c,q){ return new Promise(function(res){ c.toBlob(res,'image/webp',q); }); }
          async function save(replace){
            say('⏳ Збереження…'); [].forEach.call(acts.querySelectorAll('button'),function(b){b.disabled=true;});
            try{
              var main=await blobOf(out(1200),0.88), th=await blobOf(out(400),0.8);
              if(!main) throw new Error('браузер не зміг зберегти зображення');
              var fd=new FormData(); fd.set('photo',main,'edited.webp'); if(th) fd.set('thumb',th,'thumb.webp');
              if(replace) fd.set('id',it.id); else fd.set('pid',pid);
              var r=await fetch(replace?'/admin/imgreplace':'/admin/upload',{method:'POST',body:fd,redirect:'follow'});
              if(!r.ok) throw new Error('сервер відповів '+r.status);
              location.href='/admin?pid='+pid;
            }catch(e){ say('Помилка: '+(e&&e.message||e)); [].forEach.call(acts.querySelectorAll('button'),function(b){b.disabled=false;}); }
          }
          acts.appendChild(edBtn('💾 Замінити це фото','Файл буде замінено, місце в списку збережеться',function(){save(true);},'background:#2d6a2d;color:#fff'));
          acts.appendChild(edBtn('➕ Зберегти як нове','Додати як окреме фото, оригінал лишається',function(){save(false);},'background:#1565c0;color:#fff'));
          acts.appendChild(edBtn('Скасувати','',edClose,'background:#777;color:#fff'));
          ed.appendChild(tools); ed.appendChild(dc); ed.appendChild(sl); ed.appendChild(acts); ed.appendChild(msg);
          document.body.appendChild(ed); mark(); layout();
          say('«Обрізка»/«Замалювати» — виділіть ділянку; «Ластик» — зафарбуйте напис пензлем');
        }
      }
      document.addEventListener('keydown',function(e){ if(ed&&e.key==='Escape'){ e.stopPropagation(); edClose(); } },true);
    })();</script>`;
    const body = `<div class="nav"><a href="${esc(listUrl({ cat, sub, q, noa, noimg, nodosage, noai, nokw, noseo, norev, ps, page }))}">← до списку</a></div>
    <h1>${esc(p.name)}</h1>
    <div class="muted">SKU ${esc(p.sku)} · ${esc(p.category||'')} · ${p.price} грн · ${p.in_stock?'<span class="ok">в наявності</span>':'<span class="no">немає</span>'} · <a href="/p/${esc(p.slug)}" target="_blank">/p/${esc(p.slug)} ↗</a></div>
    ${gallery}
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
      <div>
        <label>Анотація <span style="font-size:.78rem;color:#888;font-weight:400">(Markdown)</span></label>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px">
          <button type="button" onclick="mdWrap('annotation','**','**')" title="Жирний" style="padding:3px 9px;border:1px solid #ccc;border-radius:5px;background:#fff;cursor:pointer;font-weight:700">Б</button>
          <button type="button" onclick="mdWrap('annotation','*','*')" title="Курсив" style="padding:3px 9px;border:1px solid #ccc;border-radius:5px;background:#fff;cursor:pointer;font-style:italic">К</button>
          <button type="button" onclick="mdLine('annotation','- ')" title="Список" style="padding:3px 9px;border:1px solid #ccc;border-radius:5px;background:#fff;cursor:pointer">≡</button>
          <button type="button" onclick="mdLine('annotation','1. ')" title="Нумерований список" style="padding:3px 9px;border:1px solid #ccc;border-radius:5px;background:#fff;cursor:pointer">1.</button>
          <button type="button" onclick="mdLine('annotation','### ')" title="Заголовок" style="padding:3px 9px;border:1px solid #ccc;border-radius:5px;background:#fff;cursor:pointer;font-weight:700">H</button>
          <button type="button" onclick="mdPreview('annotation','anno-preview')" style="padding:3px 9px;border:1px solid #ccc;border-radius:5px;background:#f0f7f0;cursor:pointer">👁 Перегляд</button>
        </div>
        <textarea id="annotation" name="annotation" rows="8">${esc(p.annotation)}</textarea>
        <div id="anno-preview" style="display:none;border:1px solid #cde8cd;border-radius:8px;padding:12px;margin-top:6px;background:#fafcf8;font-size:.93rem;line-height:1.7;color:#222"></div>
      </div>
      <script>
      function mdWrap(id,pre,post){
        var t=document.getElementById(id); if(!t)return;
        var s=t.selectionStart,e=t.selectionEnd,v=t.value;
        var sel=v.slice(s,e)||'текст';
        t.value=v.slice(0,s)+pre+sel+post+v.slice(e);
        t.selectionStart=s+pre.length; t.selectionEnd=s+pre.length+sel.length;
        t.focus();
      }
      function mdLine(id,prefix){
        var t=document.getElementById(id); if(!t)return;
        var s=t.selectionStart,v=t.value;
        var lineStart=v.lastIndexOf('\\n',s-1)+1;
        var line=v.slice(lineStart);
        var lineEnd=line.indexOf('\\n'); if(lineEnd<0)lineEnd=line.length;
        // toggle: якщо вже є prefix — прибрати
        var cur=v.slice(lineStart,lineStart+prefix.length);
        if(cur===prefix){
          t.value=v.slice(0,lineStart)+v.slice(lineStart+prefix.length);
          t.selectionStart=t.selectionEnd=Math.max(s-prefix.length,lineStart);
        } else {
          t.value=v.slice(0,lineStart)+prefix+v.slice(lineStart);
          t.selectionStart=t.selectionEnd=s+prefix.length;
        }
        t.focus();
      }
      function mdEsc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
      function mdInl(t){return mdEsc(t).replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>').replace(/\\*(.+?)\\*/g,'<em>$1</em>');}
      function mdToHtml(t){
        return t.split(/\\n\\n+/).map(function(block){
          var b=block.trim(); if(!b)return '';
          if(/^### /.test(b)) return '<h3>'+mdEsc(b.slice(4))+'</h3>';
          if(/^## /.test(b))  return '<h2>'+mdEsc(b.slice(3))+'</h2>';
          if(/^# /.test(b))   return '<h1>'+mdEsc(b.slice(2))+'</h1>';
          if(/^- /m.test(b))  return '<ul>'+b.split('\\n').filter(Boolean).map(function(l){return '<li>'+mdInl(l.replace(/^-\\s*/,''))+'</li>';}).join('')+'</ul>';
          if(/^\\d+\\. /m.test(b)) return '<ol>'+b.split('\\n').filter(Boolean).map(function(l){return '<li>'+mdInl(l.replace(/^\\d+\\.\\s*/,''))+'</li>';}).join('')+'</ol>';
          return '<p>'+b.split('\\n').map(mdInl).join('<br>')+'</p>';
        }).join('');
      }
      function mdPreview(id,previewId){
        var t=document.getElementById(id), p=document.getElementById(previewId); if(!t||!p)return;
        if(p.style.display==='none'){
          p.innerHTML=mdToHtml(t.value)||'<span style="color:#aaa">Порожньо</span>';
          p.style.display='block';
        } else { p.style.display='none'; }
      }
      </script>
      <div><label>Ключові слова (пошук)</label><input name="keywords" value="${esc(p.keywords)}"></div>
      <div><label>SEO title</label><input name="meta_title" value="${esc(p.meta_title)}"></div>
      <div><label>SEO description</label><input name="meta_desc" value="${esc(p.meta_desc)}"></div>
      <label><input type="checkbox" name="visible" value="1" ${p.visible?'checked':''} style="width:auto"> Показувати на сайті</label>
      <div style="margin-top:14px"><button class="btn">💾 Зберегти</button></div>
    </form>`;
    return new Response(PAGE('Редагування: ' + p.name, body), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  // ── категорії (тепер із кешу, а не наживо на кожен запит) ──
  const { catRows, totalC, noRevTotal } = await getStats(db);
  // Підгрупи вибраної категорії (рядок під головними чипами): «Усі» + products.brand у межах категорії
  let subNav = '';
  if (cat && !q && !noa && !noimg && !nodosage && !noai && !nokw && !noseo && !norev) {
    const subRows = (await db.prepare(`SELECT COALESCE(brand,'') b, COUNT(*) n FROM products WHERE category=? GROUP BY COALESCE(brand,'') ORDER BY n DESC, b`).bind(cat).all()).results || [];
    if (subRows.length > 1 || (subRows.length === 1 && subRows[0].b)) {
      const tot = subRows.reduce((a, r) => a + r.n, 0);
      subNav = '<div class="cats subcats">' +
        `<a class="cat${!sub ? ' active' : ''}" href="${esc(listUrl({ cat, ps }))}">Усі <b>${tot}</b></a>` +
        subRows.map(r => { const v = r.b || NONE_SUB; return `<a class="cat${sub === v ? ' active' : ''}" href="${esc(listUrl({ cat, sub: v, ps }))}">${esc(r.b || 'Без підгрупи')} <b>${r.n}</b></a>`; }).join('') +
        '</div>';
    }
  }
  const catNav = '<div class="cats">' +
    `<a class="cat${!cat&&!q&&!noa&&!noimg&&!noseo&&!norev?' active':''}" href="/admin">Усі <b>${totalC.n}</b></a>` +
    `<a class="cat${noa?' active':''}" href="/admin?noa=1">Без опису <b>${totalC.noa}</b></a>` +
    `<a class="cat${noimg?' active':''}" href="/admin?noimg=1">📷 Без фото <b>${totalC.noimg}</b></a>` +
    `<a class="cat${nodosage?' active':''}" href="/admin?nodosage=1">💧 Без дозування <b>${totalC.nodosage}</b></a>` +
    `<a class="cat${noai?' active':''}" href="/admin?noai=1">🧬 Без діючої речовини <b>${totalC.noai}</b></a>` +
    `<a class="cat${nokw?' active':''}" href="/admin?nokw=1">🔑 Без ключових слів <b>${totalC.nokw}</b></a>` +
    `<a class="cat${noseo?' active':''}" href="/admin?noseo=1">🔎 Без SEO <b>${totalC.noseo}</b></a>` +
    `<a class="cat${norev?' active':''}" href="/admin?norev=1">💬 Без відгуків <b>${noRevTotal}</b></a>` +
    (catRows.results||[]).map(r => `<a class="cat${cat===r.c?' active':''}" href="/admin?cat=${encodeURIComponent(r.c||'')}">${esc(r.c||'—')} <b>${r.n}</b></a>`).join('') +
    '</div>' + subNav;

  // ── вибірка ──
  let where = '0', binds = [];
  if (q) {
    where = '1'; // передфільтр робиться через FTS5 + prefix-LIKE(sku) нижче, smartScore ранжує кандидатів
  }
  else if (noa) { where = "COALESCE(c.annotation,'')=''"; }
  else if (noimg) { where = "COALESCE(c.image_ok,0)=0"; }
  else if (nodosage) { where = "(c.dosage IS NULL OR c.dosage='') AND p.category='АГРОХІМІКАТИ'"; }
  else if (noai) { where = "(c.active_ingredient IS NULL OR c.active_ingredient='') AND p.category='АГРОХІМІКАТИ'"; }
  else if (nokw) { where = "(c.keywords IS NULL OR c.keywords='')"; }
  else if (noseo) { where = "(COALESCE(c.meta_title,'')='' OR COALESCE(c.meta_desc,'')='')"; }
  else if (norev) { where = "NOT EXISTS (SELECT 1 FROM reviews r WHERE r.pid=p.pid)"; }
  else if (cat) {
    where = 'p.category=?'; binds = [cat];
    if (sub === NONE_SUB) where += " AND COALESCE(p.brand,'')=''";
    else if (sub) { where += ' AND p.brand=?'; binds.push(sub); }
  }

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

      // ── індексований пошук кандидатів (FTS5 по назві + prefix-LIKE по SKU) ──
      // На відміну від LIKE '%tok%' (завжди повне сканування таблиці незалежно
      // від індексів через leading wildcard), обидва шляхи нижче дійсно
      // використовують індекс — FTS5 інвертований для назви, B-tree range scan
      // для SKU (LIKE 'tok%' без початкового wildcard).
      let candidatePids = [];
      if (qtokens.length) {
        const ftsQuery = qtokens.map(t => t.replace(/"/g, '') + '*').join(' ');
        let ftsPids = [];
        try {
          ftsPids = (await db.prepare(`SELECT rowid AS pid FROM products_fts WHERE products_fts MATCH ?`).bind(ftsQuery).all()).results.map(r => r.pid);
        } catch (e) { ftsPids = []; } // FTS5-запит з порожнім/невалідним рядком — просто нема кандидатів з цього шляху

        const skuConds = qtokens.map(() => `sku_lower LIKE ?`).join(' OR ');
        const skuBinds = qtokens.map(t => t + '%');
        const skuPids = (await db.prepare(`SELECT pid FROM products WHERE ${skuConds} LIMIT 500`).bind(...skuBinds).all()).results.map(r => r.pid);

        candidatePids = Array.from(new Set([...ftsPids, ...skuPids])).slice(0, 500);
      }

      let candidates = [];
      if (candidatePids.length) {
        const placeholders = candidatePids.map(() => '?').join(',');
        candidates = (await db.prepare(
          `SELECT p.pid, p.sku AS sku, COALESCE(NULLIF(c.display_name,''), p.name) AS name, p.category,(COALESCE(c.annotation,'')!='') hasA,c.visible,c.image_ok
             FROM products p JOIN product_content c ON c.pid=p.pid
            WHERE p.pid IN (${placeholders})`
        ).bind(...candidatePids).all()).results || [];
      }

      const scored = candidates
        .map(r => ({ r, sc: smartScore(r.name || '', r.sku || '', qtokens) }))
        .filter(x => x.sc > 0)
        .sort((a, b) => b.sc - a.sc);
      total = scored.length;
      rows = scored.slice((page - 1) * ps, page * ps).map(x => x.r);
    } else {
      total = (await db.prepare(`SELECT COUNT(*) n FROM products p JOIN product_content c ON c.pid=p.pid WHERE ${where}`).bind(...binds).first()).n;
      rows = (await db.prepare(
        `SELECT p.pid, p.sku AS sku, COALESCE(NULLIF(c.display_name,''), p.name) AS name, p.category,(COALESCE(c.annotation,'')!='') hasA,c.visible,c.image_ok
           FROM products p JOIN product_content c ON c.pid=p.pid
          WHERE ${where} ORDER BY COALESCE(NULLIF(c.display_name,''), p.name) LIMIT ? OFFSET ?`).bind(...binds, ps, (page - 1) * ps).all()).results || [];
    }
  }

  const editQ = fp ? '&' + fp : '';
  const list = rows.map(x => {
    const tUrl = '/admin?toggle=' + x.pid + (fp ? '&' + fp : '');
    return `<tr><td style="width:24px;text-align:center"><input type="checkbox" name="pid" value="${x.pid}"></td>
     <td><a href="/admin?pid=${x.pid}${editQ}">${esc(x.name)}</a></td>
     <td class="muted" style="font-size:.8rem;white-space:nowrap">${esc(x.sku || '')}</td>
     <td class="muted">${esc(x.category||'')}</td>
     <td>${x.image_ok ? '<span class="ok">📷 є</span>' : '<span class="no">🚫 нема</span>'}</td>
     <td><a href="${esc(tUrl)}" title="Перемкнути показ у каталозі">${x.visible ? '👁 у каталозі' : '🙈 сховано'}</a></td></tr>`;
  }).join('');
  const pages = Math.ceil(total / ps);
  const pager = pages > 1 ? `<div class="pager">
     ${page>1?`<a class="btn" href="${esc(listUrl({cat,sub,q,noa,noimg,nodosage,noai,nokw,noseo,norev,ps,page:page-1}))}">← Назад</a>`:''}
     <span class="muted">Стор. ${page} / ${pages} (${total})</span>
     ${page<pages?`<a class="btn" href="${esc(listUrl({cat,sub,q,noa,noimg,nodosage,noai,nokw,noseo,norev,ps,page:page+1}))}">Далі →</a>`:''}
   </div>` : (total ? `<div class="muted" style="margin:10px 0">Знайдено: ${total}</div>` : '');

  const psBar = (where !== '0' && total) ? `<div class="muted" style="margin:8px 0">На сторінці: ` +
     PAGE_SIZES.map(n => n === ps
       ? `<b style="color:#2d6a2d">${n}</b>`
       : `<a href="${esc(listUrl({ cat, sub, q, noa, noimg, nodosage, noai, nokw, noseo, norev, ps: n, page: 1 }))}">${n}</a>`).join(' · ') +
     `</div>` : '';

  const bulkBar = (noimg && total) ? `<div style="margin:10px 0;display:flex;gap:8px;flex-wrap:wrap">
      <a class="btn" style="background:#c0392b" href="/admin?bulk=hide-nophoto" onclick="return confirm('Сховати з каталогу ВСІ ${total} товарів без фото?')">🙈 Сховати всі без фото з каталогу</a>
      <a class="btn" style="background:#777" href="/admin?bulk=show-nophoto" onclick="return confirm('Знову показати в каталозі ВСІ товари без фото?')">👁 Показати всі</a>
    </div>` : '';

  const heading = q ? `Пошук: «${esc(q)}»` : noa ? 'Товари без опису' : noimg ? 'Товари без фото (файл відсутній)' : nodosage ? 'Агрохімікати без дозування' : noai ? 'Агрохімікати без діючої речовини' : nokw ? 'Товари без ключових слів' : noseo ? 'Товари без SEO (нема meta title або description)' : norev ? 'Товари без жодного відгуку' : cat ? esc(cat) : 'Оберіть категорію або скористайтесь пошуком';

  // Панель групування фасовок: познач кілька товарів → обери групу → «Згрупувати» (B)
  const grpListB = rows.length ? await existingGroups(db) : [];
  const backUrl = listUrl({ cat, sub, q, noa, noimg, nodosage, noai, nokw, noseo, norev, ps, page });
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
