// /admin/merge — ручне злиття двох товарів (розрулювання колізій імпорту).
// Типовий випадок: у 1С змінився SKU → старий товар (з описом/фото/slug) «зник»,
// створився новий голий дубль із поточними цінами. Зливаємо: лишаємо обогащений
// запис (його опис/фото/URL), забираємо 1С-дані (sku/назва/ціна/наявність) з другого,
// переносимо фото+відгуки, видаляємо дубль. orders не чіпаємо (там знімок товарів).
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

const DETAIL = `SELECT p.pid,p.sku,p.name,p.price,p.category,p.brand,p.in_stock,
   COALESCE(length(c.annotation),0) annlen, COALESCE(c.display_name,'') dn, COALESCE(c.slug,'') slug,
   COALESCE(c.group_id,'') gid,
   (SELECT COUNT(*) FROM product_images WHERE pid=p.pid) nimg,
   (SELECT COUNT(*) FROM reviews WHERE pid=p.pid) nrev
 FROM products p LEFT JOIN product_content c ON c.pid=p.pid WHERE p.pid=?`;

// Кандидати-колізії: однакова назва, але РІЗНІ SKU (типова ознака зміни sku в 1С).
// (однакові sku-дублі — це для /admin/dedup). Обогаченіший запис іде першим (на «лишити»).
async function candidates(db){
  const rows=(await db.prepare(
    `SELECT p.pid,p.sku,p.name,(c.annotation<>'') hasA,COALESCE(c.image_ok,0) img,
            (c.display_name IS NOT NULL) dn,(c.slug IS NOT NULL AND c.slug<>'') hasSlug
       FROM products p LEFT JOIN product_content c ON c.pid=p.pid`).all()).results||[];
  const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
  const g=new Map();
  for(const r of rows){const k=norm(r.name); if(!k)continue; (g.get(k)||g.set(k,[]).get(k)).push(r);}
  const score=r=>(r.hasA?2:0)+(r.img?2:0)+(r.dn?1:0)+(r.hasSlug?1:0);
  const out=[];
  for(const arr of g.values()){
    if(arr.length<2) continue;
    if(new Set(arr.map(r=>r.sku)).size<2) continue;   // однакові sku → не сюди
    arr.sort((a,b)=>score(b)-score(a));
    out.push(arr);
  }
  return out;
}

async function resolve(db, q){
  q = String(q==null?'':q).trim();
  if(!q) return [];
  if(/^\d+$/.test(q)){
    const r = await db.prepare(`SELECT pid,sku,name FROM products WHERE pid=?`).bind(parseInt(q,10)).first();
    return r ? [r] : [];
  }
  return (await db.prepare(`SELECT pid,sku,name FROM products WHERE sku=? ORDER BY pid`).bind(q).all()).results || [];
}

const PAGE = (body)=>`<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex,nofollow">
<title>Злиття товарів</title><style>
body{font-family:system-ui;max-width:900px;margin:1.2rem auto;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2{color:#2d6a2d} .btn{background:#2d6a2d;color:#fff;border:0;padding:10px 16px;border-radius:8px;cursor:pointer;font-weight:700;text-decoration:none;display:inline-block}
.btn.danger{background:#c0392b}.btn.sec{background:#777} .muted{color:#888;font-size:.86rem}
input[type=text]{padding:9px;border:2px solid #c8e0c8;border-radius:8px;font-size:1rem}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:12px 0}
.card{background:#fff;border:1px solid #e0e8e0;border-radius:10px;padding:12px;font-size:.9rem}
.card h3{margin:0 0 8px;color:#2d6a2d} .row{padding:3px 0;border-bottom:1px solid #f2f2f2}
.tag{display:inline-block;background:#eef5ee;border-radius:5px;padding:1px 6px;font-size:.8rem;margin:1px}
code{background:#eef5ee;padding:1px 5px;border-radius:4px} fieldset{border:1px solid #ddd;border-radius:8px;margin:10px 0}
label.opt{display:block;padding:4px 0;cursor:pointer}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body><div><a href="/admin">← до адмінки</a> · <a href="/admin/dedup">авто-дублі за назвою</a></div>${body}</body></html>`;

function detailCard(title, p){
  const enr = [];
  if(p.annlen>0) enr.push(`<span class=tag>📝 опис ${p.annlen}</span>`);
  if(p.nimg>0) enr.push(`<span class=tag>🖼 фото ${p.nimg}</span>`);
  if(p.dn) enr.push(`<span class=tag>фасадна назва</span>`);
  if(p.slug) enr.push(`<span class=tag>🔗 ${esc(p.slug)}</span>`);
  if(p.nrev>0) enr.push(`<span class=tag>⭐ відгуки ${p.nrev}</span>`);
  if(p.gid) enr.push(`<span class=tag>фасовка ${esc(p.gid)}</span>`);
  return `<div class=card><h3>${title} · #${p.pid}</h3>
    <div class=row>SKU: <code>${esc(p.sku)}</code></div>
    <div class=row>Назва: ${esc(p.name)}</div>
    <div class=row>Ціна: <b>${p.price}</b> · ${p.in_stock?'в наявності':'<span style="color:#c0392b">немає</span>'}</div>
    <div class=row>Категорія: ${esc(p.category||'—')} · бренд: ${esc(p.brand||'—')}</div>
    <div style="margin-top:6px">${enr.join(' ')||'<span class=muted>без обогащення</span>'}</div></div>`;
}

export async function onRequestGet(context){
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const qa = url.searchParams.get('a')||'', qb = url.searchParams.get('b')||'';

  // форма пошуку (порожньо або один із параметрів)
  const form = `<form method="GET" action="/admin/merge" style="margin:10px 0">
    <p class=muted>Введи два товари (SKU або #pid). Перший — той, чиї <b>опис/фото/URL</b> цінніші (зазвичай старий обогащений), другий — дубль зі свіжими 1С-даними.</p>
    <input type=text name=a value="${esc(qa)}" placeholder="SKU або pid (лишити обогачення)" style="width:46%">
    <input type=text name=b value="${esc(qb)}" placeholder="SKU або pid (дубль)" style="width:46%">
    <p><button class=btn type=submit>Показати →</button></p></form>`;

  if(!qa || !qb){
    const cand = await candidates(db);
    const badge = r => `${r.hasA?'📝':''}${r.img?'🖼':''}${r.hasSlug?'🔗':''}`;
    const list = cand.slice(0,80).map(g=>{
      const a=g[0], b=g[1];
      return `<tr>
        <td>${esc(a.name)}</td>
        <td>${g.map(r=>`#${r.pid} <code>${esc(r.sku)}</code>${badge(r)?' '+badge(r):''}`).join('<br>')}</td>
        <td><a class="btn" style="padding:5px 10px" href="/admin/merge?a=${a.pid}&b=${b.pid}">розрулити →</a></td></tr>`;
    }).join('');
    const candHtml = cand.length
      ? `<h3>⚠️ Можливі колізії: однакова назва, різні SKU (${cand.length})</h3>
         <p class=muted>Типова ознака зміни SKU в 1С. Обогаченіший запис (📝 опис · 🖼 фото · 🔗 URL) — перший, його варто лишити.</p>
         <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;font-size:.86rem">
         <tr><th style="text-align:left;padding:7px 9px">Назва</th><th style="text-align:left;padding:7px 9px">Записи</th><th style="padding:7px 9px"></th></tr>
         ${list}</table>${cand.length>80?`<p class=muted>…показано перші 80</p>`:''}`
      : `<p class=muted style="background:#eef5ee;padding:10px;border-radius:8px">✅ Колізій «однакова назва / різні SKU» не знайдено.</p>`;
    return new Response(PAGE(`<h2>🔀 Злиття товарів (колізії)</h2>${form}${candHtml}`),{headers:{'content-type':'text/html; charset=utf-8'}});
  }

  const ra = await resolve(db, qa), rb = await resolve(db, qb);
  const pick = (list, which)=> list.length>1
    ? `<div style="background:#fff7e6;padding:8px;border-radius:8px;margin:6px 0"><b>${which}</b>: SKU дає кілька товарів — уточни pid:<br>${list.map(r=>`#${r.pid} «${esc(r.name)}»`).join('<br>')}</div>` : '';
  if(ra.length!==1 || rb.length!==1){
    const none = (l,q)=> l.length===0?`<p style="color:#c0392b">Не знайдено: «${esc(q)}»</p>`:'';
    return new Response(PAGE(`<h2>🔀 Злиття товарів</h2>${form}${none(ra,qa)}${none(rb,qb)}${pick(ra,'A')}${pick(rb,'B')}`),{headers:{'content-type':'text/html; charset=utf-8'}});
  }
  if(ra[0].pid===rb[0].pid)
    return new Response(PAGE(`<h2>🔀 Злиття товарів</h2>${form}<p style="color:#c0392b">Це той самий товар (#${ra[0].pid}).</p>`),{headers:{'content-type':'text/html; charset=utf-8'}});

  const A = await db.prepare(DETAIL).bind(ra[0].pid).first();
  const B = await db.prepare(DETAIL).bind(rb[0].pid).first();
  const enrScore = p => (p.annlen>0?2:0)+(p.nimg>0?2:0)+(p.dn?1:0)+(p.slug?1:0)+(p.nrev>0?1:0);
  const keepDefA = enrScore(A) >= enrScore(B);   // лишаємо обогаченіший
  const warnBoth = A.annlen>0 && B.annlen>0 ? `<p style="color:#c0392b">⚠️ Обидва мають опис — опис НЕзбереженого запису буде втрачено. Обери «лишити» правильно.</p>`:'';

  const body = `<h2>🔀 Злиття товарів</h2>${form}
    <div class=cols>${detailCard('A', A)}${detailCard('B', B)}</div>
    ${warnBoth}
    <form method="POST" action="/admin/merge" onsubmit="return confirm('Обʼєднати? Дубль буде видалено (фото й відгуки переносяться).')">
      <input type=hidden name=pa value="${A.pid}"><input type=hidden name=pb value="${B.pid}">
      <fieldset><legend>Лишити запис (його опис / фото / URL-slug):</legend>
        <label class=opt><input type=radio name=keep value="${A.pid}" ${keepDefA?'checked':''}> A · #${A.pid} <code>${esc(A.sku)}</code></label>
        <label class=opt><input type=radio name=keep value="${B.pid}" ${keepDefA?'':'checked'}> B · #${B.pid} <code>${esc(B.sku)}</code></label>
      </fieldset>
      <fieldset><legend>1С-дані (SKU, назва, ціна, категорія, наявність) взяти з:</legend>
        <label class=opt><input type=radio name=src value="${A.pid}"> A · <code>${esc(A.sku)}</code> «${esc(A.name)}»</label>
        <label class=opt><input type=radio name=src value="${B.pid}" checked> B · <code>${esc(B.sku)}</code> «${esc(B.name)}»</label>
      </fieldset>
      <button class="btn danger" type=submit>✅ Обʼєднати</button>
      <a class="btn sec" href="/admin/merge">Скинути</a>
    </form>
    <p class=muted style="margin-top:10px">Переносяться: фото (дописуються в кінець), відгуки. Видаляється: дубль (products+content). Історія замовлень не зачіпається.</p>`;
  return new Response(PAGE(body),{headers:{'content-type':'text/html; charset=utf-8'}});
}

export async function onRequestPost(context){
  const db = context.env.DB;
  const f = await context.request.formData();
  const pa = parseInt(f.get('pa'),10), pb = parseInt(f.get('pb'),10);
  const keep = parseInt(f.get('keep'),10), src = parseInt(f.get('src'),10);
  if(![pa,pb,keep,src].every(Number.isFinite))
    return new Response(PAGE('<p style="color:#c0392b">Невірні параметри.</p>'),{status:400,headers:{'content-type':'text/html; charset=utf-8'}});
  if(keep!==pa && keep!==pb) return new Response(PAGE('<p style="color:#c0392b">«Лишити» має бути A або B.</p>'),{status:400,headers:{'content-type':'text/html; charset=utf-8'}});
  const del = keep===pa ? pb : pa;

  // 1С-дані беремо з обраного джерела
  const srcRow = await db.prepare(`SELECT sku,name,price,category,brand,in_stock,updated_at FROM products WHERE pid=?`).bind(src).first();
  if(!srcRow) return new Response(PAGE('<p style="color:#c0392b">Джерело даних не знайдено.</p>'),{status:400,headers:{'content-type':'text/html; charset=utf-8'}});

  // зсув sort, щоб фото дубля лягли в кінець галереї того, що лишаємо
  const mx = await db.prepare(`SELECT COALESCE(MAX(sort),-1) m FROM product_images WHERE pid=?`).bind(keep).first();
  const off = ((mx && mx.m)|0) + 1;

  const stmts = [
    // переносимо фото й відгуки дубля на keep (ДО видалення — інакше CASCADE їх знищить)
    db.prepare(`UPDATE product_images SET pid=?, sort=sort+? WHERE pid=?`).bind(keep, off, del),
    db.prepare(`UPDATE reviews SET pid=? WHERE pid=?`).bind(keep, del),
    // оновлюємо 1С-поля keep із джерела
    db.prepare(`UPDATE products SET sku=?, name=?, price=?, category=?, brand=?, in_stock=?, updated_at=? WHERE pid=?`)
      .bind(srcRow.sku, srcRow.name, srcRow.price, srcRow.category, srcRow.brand, srcRow.in_stock, srcRow.updated_at, keep),
    // видаляємо дубль (CASCADE прибере його product_content; images/reviews уже перенесені)
    db.prepare(`DELETE FROM products WHERE pid=?`).bind(del),
  ];
  await db.batch(stmts);

  // перерахунок image_ok для keep (чи реально існує головне фото в R2)
  try {
    const im = await db.prepare(`SELECT path FROM product_images WHERE pid=? ORDER BY sort LIMIT 1`).bind(keep).first();
    let ok = 0;
    if(im && im.path && context.env.IMAGES){ try { ok = (await context.env.IMAGES.head(im.path)) ? 1 : 0; } catch(e){} }
    await db.prepare(`UPDATE product_content SET image_ok=? WHERE pid=?`).bind(ok, keep).run();
  } catch(e){}

  const body = `<h2>✅ Обʼєднано</h2>
    <div style="background:#eef5ee;padding:10px;border-radius:8px">
      Лишено: <b>#${keep}</b> <code>${esc(srcRow.sku)}</code> «${esc(srcRow.name)}»<br>
      Видалено дубль: <b>#${del}</b><br>
      Перенесено фото й відгуки, оновлено 1С-дані.
    </div>
    <p style="margin-top:12px"><a class="btn" href="/admin/merge">↻ Ще одне злиття</a> <a class="btn sec" href="/admin?pid=${keep}">Відкрити товар</a> <a class="btn sec" href="/admin">До адмінки</a></p>`;
  return new Response(PAGE(body),{headers:{'content-type':'text/html; charset=utf-8'}});
}
