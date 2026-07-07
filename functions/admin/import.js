// /admin/import — імпорт вигрузки 1С: вибір локального файлу → перевірка формату (dry-run) → імпорт у D1.
// Обогащення (product_content/product_images) НЕ чіпається.
// Товари, які зникли з вигрузки (є в базі, нема у файлі), автоматично отримують in_stock=0 —
// вони не видаляються і не втрачають фото/SEO, просто ховаються з наявності до повернення у 1С.
const TR = {'а':'a','б':'b','в':'v','г':'g','ґ':'g','д':'d','е':'e','є':'ie','ж':'zh','з':'z','и':'y','і':'i','ї':'i','й':'j','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ь':'','ю':'iu','я':'ia',"'":'','’':''};
function slugify(n){let s=(n||'').toLowerCase();let o='';for(const ch of s)o+=(TR[ch]!==undefined?TR[ch]:ch);o=o.replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');return o.slice(0,80)||'tovar';}
function fixNum(s){return String(s==null?'':s).replace(/[\s ]/g,'');}
// Символи у шляху фото, що ламають роздачу з R2 / блокуються WAF (виявлено при міграції):
// ".." (path-traversal), "%" (псує URL ключа), зворотний слеш, керуючі символи.
function imgPathIssues(path){
  const p = String(path==null?'':path);
  if(!p || /^https?:\/\//i.test(p)) return [];
  const out=[];
  if(/\.\./.test(p)) out.push('".."');
  if(/%/.test(p)) out.push('"%"');
  if(/\\/.test(p)) out.push('зворотний слеш');
  if(/[\x00-\x1f\x7f]/.test(p)) out.push('керуючі символи');
  return out;
}
function sanitizeImgPath(path){
  let p = String(path==null?'':path).trim();
  if(!p || /^https?:\/\//i.test(p)) return p;
  p = p.replace(/\\/g,'/').replace(/^\/+/,'');
  p = p.replace(/[\x00-\x1f\x7f]/g,'');
  p = p.replace(/\.\.+/g,'.').replace(/%/g,'');
  return p.replace(/\s+/g,' ').trim();
}
function parseTolerant(txt){
  txt = txt.replace(/^﻿/, '');
  txt = txt.replace(/("p"\s*:\s*)([0-9][0-9\s ]*\.?[0-9]*)/g, (m, a, b) => a + fixNum(b));
  txt = txt.replace(/,\s*]/g, ']');
  return JSON.parse(txt);
}
const json = (o, s = 200) => new Response(JSON.stringify(o, null, 2), { status: s, headers: { 'content-type': 'application/json; charset=utf-8' } });

export async function onRequestGet() {
  return new Response(`<!DOCTYPE html><html lang=uk><head><meta charset=UTF-8>
<meta name=viewport content="width=device-width, initial-scale=1.0"><meta name=robots content=noindex>
<title>Імпорт 1С</title><style>
body{font-family:system-ui;max-width:760px;margin:1.5rem auto;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2{color:#2d6a2d} .btn{background:#2d6a2d;color:#fff;border:0;padding:10px 16px;border-radius:8px;cursor:pointer;font-weight:700}
.btn:disabled{background:#aaa;cursor:not-allowed} .file{padding:10px;border:2px dashed #c8e0c8;border-radius:10px;background:#fff;width:100%;box-sizing:border-box}
pre{background:#fff;padding:12px;border-radius:8px;white-space:pre-wrap;border:1px solid #eee;max-height:320px;overflow:auto}
.muted{color:#888;font-size:.85rem}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body>
<div><a href="/admin">← до адмінки</a></div>
<h2>Імпорт вигрузки 1С</h2>
<p class=muted>1) Оберіть файл <code>products.json</code> з 1С. 2) «Перевірити формат». 3) Якщо помилок немає — «Імпортувати». Оновлюються ціни/наявність/назви; нові товари додаються; описи й фото зберігаються. Товари, яких немає у новому файлі, автоматично позначаються «немає в наявності» (не видаляються).</p>
<label class=btn style="background:#555;cursor:pointer;display:inline-block">📂 Виберіть файл<input type=file id=f accept=".json,application/json" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0"></label>
<span id=fn class=muted style="margin-left:8px">Файл не вибрано</span>
<p><button class=btn id=chk onclick="verify()" disabled>① Перевірити формат</button>
   <button class=btn id=imp onclick="run()" disabled>② Імпортувати</button>
   <span id=s></span></p>
<div id=o style="background:#fff;padding:12px;border-radius:8px;border:1px solid #eee">Файл не обрано.</div>
<script>
let TEXT='', FNAME='';
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
$('f').onchange=async e=>{const file=e.target.files[0]; if(!file){return;} FNAME=file.name; $('fn').textContent=file.name;
  TEXT=await file.text(); $('o').textContent='✅ Прочитано: '+file.name+' ('+TEXT.length+' символів). Натисніть «Перевірити формат».';
  $('chk').disabled=false; $('imp').disabled=true;};
async function post(dry){
  const u='/admin/import?'+(dry?'dryrun=1&':'')+'file='+encodeURIComponent(FNAME);
  const r=await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:TEXT});
  return{ok:r.ok,data:await r.json().catch(()=>({error:'не JSON (HTTP '+r.status+')'}))};}
function sect(title,obj,fmt){
  if(!obj||!obj.total) return '';
  const rows=(obj.sample||[]).map(fmt).join('');
  const more=obj.total>(obj.sample||[]).length?'<div class=muted>…ще '+(obj.total-obj.sample.length)+'</div>':'';
  return '<details'+(obj.total<=15?' open':'')+' style="margin:6px 0;border:1px solid #eee;border-radius:8px;background:#fff;padding:6px 10px">'
    +'<summary style="cursor:pointer;font-weight:700">'+title+': '+obj.total+'</summary>'
    +'<div style="margin:6px 0 4px;font-size:.86rem;line-height:1.5">'+rows+more+'</div></details>';
}
function renderReport(d,dry){
  if(!d||!d.ok) return '<div style="color:#c0392b">❌ '+esc(d&&d.error||'помилка')+'</div>';
  const r=d.report||{}, cr=(d.willCreate!=null?d.willCreate:d.created), up=(d.willUpdate!=null?d.willUpdate:d.updated);
  let h='<div style="background:#eef5ee;padding:10px;border-radius:8px;margin-bottom:8px">'
    +'<b>'+(dry?'🔎 Попередній перегляд':'✅ Імпорт виконано')+'</b> — з файлу '
    +(r.source&&r.source.records||d.total)+' записів'+(r.source&&r.source.file?' <span class=muted>('+esc(r.source.file)+')</span>':'')+'<br>'
    +'➕ '+(dry?'буде створено':'створено')+': <b>'+cr+'</b> &nbsp; 🔄 '+(dry?'буде оновлено':'оновлено')+': <b>'+up+'</b> &nbsp; '
    +'⛔ пропущено: <b>'+d.invalid+'</b> &nbsp; 🖼 шляхів фото виправлено: <b>'+(d.imgWarnings||0)+'</b></div>';
  h+=sect('➕ Додані (sku · назва → категорія)',r.created,x=>'<div>'+esc(x.sku)+' · '+esc(x.n)+' <span class=muted>→ '+esc(x.c||'—')+'</span></div>');
  h+=sect('📉 Стали недоступні (остаток 0, а в базі був ≠0)',r.stockZeroed,x=>'<div>'+esc(x.sku)+' · '+esc(x.n)+'</div>');
  h+=sect('📈 Знову в наявності (0→в наявності)',r.stockRestored,x=>'<div>'+esc(x.sku)+' · '+esc(x.n)+'</div>');
  h+=sect('💸 Зміна ціни (стара → нова)',r.priceChanges,x=>'<div>'+esc(x.sku)+' · '+esc(x.n)+': <b>'+x.old+' → '+x.neu+'</b></div>');
  h+=sect('🔀 Зміна категорії/бренду',r.moved,x=>'<div>'+esc(x.sku)+' · '+esc(x.n)+': '+esc(x.oldC||'—')+'→'+esc(x.newC||'—')+(x.oldB!==x.newB?' / бренд '+esc(x.oldB||'—')+'→'+esc(x.newB||'—'):'')+'</div>');
  h+=sect('🗑 Зникли з вигрузки (є в базі, нема у файлі) — деактивовано: '+(r.disappearedZeroed||0),r.disappeared,x=>'<div>'+esc(x.sku)+' · '+esc(x.n)+(x.inStock?' <span style="color:#c0392b">(було в наявності — знято з наявності)</span>':' <span class=muted>(вже було відсутнє)</span>')+'</div>');
  h+=sect('⚠️ Дублі sku в базі (один sku = різні товари — виправити в 1С)',r.dupSkus,x=>'<div><b>'+esc(x.sku)+'</b>: '+esc((x.names||[]).join('  |  '))+'</div>');
  if(d.imgWarnings) h+=sect('🖼 Виправлені шляхи фото',{total:d.imgWarnings,sample:d.sampleImgWarnings},x=>'<div>'+esc(x.sku)+': '+esc(x.problem)+'<br><span class=muted>'+esc(x.img)+' → '+esc(x.fixedTo)+'</span></div>');
  if(d.invalid) h+=sect('⛔ Пропущені (помилки формату)',{total:d.invalid,sample:d.sampleInvalid},x=>'<div>'+esc(x.sku||'?')+' · '+esc(x.n||'')+' — '+esc(x.reason)+'</div>');
  return h;
}
async function verify(){if(!TEXT){alert('Оберіть файл');return;} $('s').textContent='перевірка…';
  const {ok,data}=await post(true); $('s').textContent='';
  $('o').innerHTML=renderReport(data,true);
  $('imp').disabled=!(ok && data.ok && data.invalid===0 && (data.willCreate+data.willUpdate)>0);}
async function run(){$('s').textContent='імпорт…'; $('imp').disabled=true;
  const {ok,data}=await post(false); $('s').textContent=ok&&data.ok?'✅ Готово':'❌ Помилка';
  $('o').innerHTML=renderReport(data,false);}
</script></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  const _u = new URL(context.request.url);
  const dry = _u.searchParams.get('dryrun') === '1';
  const srcFile = (_u.searchParams.get('file') || '').slice(0, 120);

  let arr;
  try { arr = parseTolerant(await context.request.text()); }
  catch (e) { return json({ ok: false, error: 'JSON не розпарсився: ' + e.message }, 400); }
  if (!Array.isArray(arr)) return json({ ok: false, error: 'Очікується масив товарів (масив об’єктів)' }, 400);

  // 1) валідація формату
  const invalid = [], valid = [], imgWarn = [];
  arr.forEach((r, i) => {
    const sku = fixNum(r && r.sku).trim();
    const n = ((r && r.n) || '').trim();
    const p = parseFloat(fixNum(r && r.p));
    const probs = [];
    if (!sku) probs.push('немає sku');
    if (!n) probs.push('немає назви (n)');
    if (isNaN(p)) probs.push('ціна (p) не число');
    if (probs.length) { invalid.push({ i: i, sku: sku, n: n.slice(0, 40), reason: probs.join(', ') }); return; }
    // шлях до фото: перевіряємо заборонені символи й чистимо (R2/WAF-безпечно)
    const rawImg = (r && r.img) || '';
    const issues = imgPathIssues(rawImg);
    const img = issues.length ? sanitizeImgPath(rawImg) : rawImg;
    if (issues.length) imgWarn.push({ i: i, sku: sku, img: String(rawImg).slice(0, 60), problem: issues.join(', '), fixedTo: img.slice(0, 60) });
    valid.push({ sku, n, p, c: r.c || null, b: r.b || null, img, inStock: r.inStock, updated_at: r.updated_at || null });
  });

  // 2) план (матч з D1) + порівняння для звіту
  const ex = await db.prepare(`SELECT pid,sku,name,price,category,brand,in_stock FROM products`).all();
  const exRows = ex.results || [];
  const bySkuName = new Map(), bySku = new Map(), pidInfo = new Map(); let maxPid = 0;
  for (const r of exRows) {
    bySkuName.set(r.sku + '|' + r.name, r.pid);
    (bySku.get(r.sku) || bySku.set(r.sku, []).get(r.sku)).push(r.pid);
    pidInfo.set(r.pid, r);
    if (r.pid > maxPid) maxPid = r.pid;
  }
  const slugs = new Set(((await db.prepare(`SELECT slug FROM product_content`).all()).results || []).map(x => x.slug));
  // Бренд/місто для дефолтного meta_title нового товару — з site_settings (керується в /admin/contacts)
  let _sName = 'Агроном', _sCity = 'м. Володимир';
  try {
    for (const s of (await db.prepare(`SELECT key,value FROM site_settings WHERE key IN ('name','city')`).all()).results || []) {
      if (s.key === 'name' && s.value) _sName = s.value;
      if (s.key === 'city' && s.value) _sCity = s.value;
    }
  } catch (e) {}

  const Up = db.prepare(`UPDATE products SET name=?,price=?,category=?,brand=?,in_stock=?,updated_at=? WHERE pid=?`);
  const ZeroMissing = db.prepare(`UPDATE products SET in_stock=0,updated_at=? WHERE pid=?`);
  const InP = db.prepare(`INSERT INTO products(pid,sku,name,price,category,brand,in_stock,updated_at) VALUES(?,?,?,?,?,?,?,?)`);
  const InC = db.prepare(`INSERT INTO product_content(pid,slug,meta_title,visible) VALUES(?,?,?,1)`);
  const InI = db.prepare(`INSERT INTO product_images(pid,path,sort) VALUES(?,?,0)`);

  const stmts = []; let created = 0, updated = 0;
  const rep = { createdList: [], stockZeroed: [], stockRestored: [], priceChanges: [], moved: [], disappeared: [] };
  const importSkus = new Set();
  for (const r of valid) {
    importSkus.add(r.sku);
    const inStock = r.inStock === false ? 0 : 1;
    let pid = bySkuName.get(r.sku + '|' + r.n);
    if (pid == null) { const a = bySku.get(r.sku); if (a && a.length === 1) pid = a[0]; }
    if (pid != null) {
      const o = pidInfo.get(pid) || {};
      if ((o.in_stock | 0) !== 0 && inStock === 0) rep.stockZeroed.push({ sku: r.sku, n: r.n });
      if ((o.in_stock | 0) === 0 && inStock === 1) rep.stockRestored.push({ sku: r.sku, n: r.n });
      if (o.price != null && Math.abs(Number(o.price) - Number(r.p)) > 0.009) rep.priceChanges.push({ sku: r.sku, n: r.n, old: Number(o.price), neu: Number(r.p) });
      if ((o.category || '') !== (r.c || '') || (o.brand || '') !== (r.b || '')) rep.moved.push({ sku: r.sku, n: r.n, oldC: o.category || '', newC: r.c || '', oldB: o.brand || '', newB: r.b || '' });
      stmts.push(Up.bind(r.n, r.p, r.c, r.b, inStock, r.updated_at, pid)); updated++;
    } else {
      pid = ++maxPid;
      let base = slugify(r.n), slug = base, k = 2;
      while (slugs.has(slug)) slug = base + '-' + (k++);
      slugs.add(slug);
      stmts.push(InP.bind(pid, r.sku, r.n, r.p, r.c, r.b, inStock, r.updated_at));
      stmts.push(InC.bind(pid, slug, r.n + ' — ' + _sName + ', ' + _sCity));
      if (r.img) stmts.push(InI.bind(pid, r.img));
      rep.createdList.push({ sku: r.sku, n: r.n, c: r.c || '' });
      created++;
    }
  }

  // товари, що Є в базі, але ВІДСУТНІ у файлі (за sku) — вважаємо їх відсутніми в наявності.
  // Дані (описи/фото/SEO) НЕ чіпаємо і НЕ видаляємо — лише гасимо in_stock,
  // щоб товар зник з фронту, але автоматично «ожив», щойно знову з'явиться в 1С.
  const nowIso = new Date().toISOString();
  let disappearedZeroed = 0;
  for (const r of exRows) {
    if (!importSkus.has(r.sku)) {
      rep.disappeared.push({ sku: r.sku, n: r.name, inStock: r.in_stock | 0 });
      if ((r.in_stock | 0) !== 0) {
        stmts.push(ZeroMissing.bind(nowIso, r.pid));
        disappearedZeroed++;
      }
    }
  }

  // дублі sku в базі (один sku = різні товари) — їх не можна синхронізувати лише по sku
  const dupSkus = [];
  for (const [sku, pids] of bySku) if (pids.length > 1) dupSkus.push({ sku, names: pids.map(pid => (pidInfo.get(pid) || {}).name) });

  const cap = (a, n) => ({ total: a.length, sample: a.slice(0, n) });
  const report = {
    source: { file: srcFile || null, records: arr.length },
    created: cap(rep.createdList, 300),
    stockZeroed: cap(rep.stockZeroed, 300),
    stockRestored: cap(rep.stockRestored, 200),
    priceChanges: cap(rep.priceChanges, 200),
    moved: cap(rep.moved, 200),
    disappeared: cap(rep.disappeared, 300),
    disappearedZeroed,
    dupSkus: cap(dupSkus, 50),
  };

  if (dry) {
    return json({ ok: true, dryrun: true, total: arr.length, valid: valid.length, invalid: invalid.length, willCreate: created, willUpdate: updated, sampleInvalid: invalid.slice(0, 10), imgWarnings: imgWarn.length, sampleImgWarnings: imgWarn.slice(0, 10), report });
  }
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  return json({ ok: true, total: arr.length, created, updated, invalid: invalid.length, sampleInvalid: invalid.slice(0, 10), imgWarnings: imgWarn.length, sampleImgWarnings: imgWarn.slice(0, 10), report });
}
