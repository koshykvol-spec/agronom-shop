// /admin/dedup — об'єднання товарів-дублів за НАЗВОЮ.
// У парі лишаємо обогащений запис, забираємо «добрий» SKU (00-/РТ-) у голого близнюка,
// голий близнюк видаляється. GET = прев'ю (dry-run), POST = застосувати.
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function normName(s){return String(s||'').replace(/ /g,' ').replace(/\s+/g,' ').trim().toLowerCase();}
function goodSku(s){s=String(s||'');return s.startsWith('00-')||s.startsWith('РТ-')||s.startsWith('AN-');}
const enr = r => !!(r.hasA || r.imgok || r.hasDN);

async function buildPlan(db){
  const rows=(await db.prepare(
    `SELECT p.pid,p.sku,p.name,(c.annotation<>'') hasA,COALESCE(c.image_ok,0) imgok,(c.display_name IS NOT NULL) hasDN
       FROM products p JOIN product_content c ON c.pid=p.pid`).all()).results||[];
  const groups=new Map();
  for(const r of rows){const k=normName(r.name); if(!groups.has(k))groups.set(k,[]); groups.get(k).push(r);}
  const merge=[], manual=[];
  for(const g of groups.values()){
    if(g.length<2) continue;
    const enriched=g.filter(enr), good=g.filter(r=>goodSku(r.sku));
    if(enriched.length>1){ manual.push({reason:'кілька обогащених записів', g}); continue; }
    const keep=enriched[0] || good[0] || g.slice().sort((a,b)=>a.pid-b.pid)[0];
    const others=g.filter(r=>r.pid!==keep.pid);
    let newSku=keep.sku;
    if(!goodSku(keep.sku)){
      if(good.length===1) newSku=good[0].sku;
      else if(good.length>1){ manual.push({reason:'кілька добрих SKU', g}); continue; }
    }
    merge.push({name:keep.name, keep, others, newSku, skuChange:newSku!==keep.sku});
  }
  return {merge, manual};
}

const PAGE=(body)=>`<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex,nofollow">
<title>Об'єднати дублі</title><style>
body{font-family:system-ui;max-width:960px;margin:1.2rem auto;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2{color:#2d6a2d} .btn{background:#2d6a2d;color:#fff;border:0;padding:10px 16px;border-radius:8px;cursor:pointer;font-weight:700;text-decoration:none;display:inline-block}
.btn.danger{background:#c0392b} .muted{color:#888;font-size:.85rem}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;font-size:.86rem}
td,th{padding:6px 9px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}
.keep{color:#2d6a2d;font-weight:600}.del{color:#c0392b}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body><div><a href="/admin">← до адмінки</a></div>${body}</body></html>`;

export async function onRequestGet(context){
  const db=context.env.DB;
  const {merge, manual}=await buildPlan(db);
  const willResku=merge.filter(m=>m.skuChange).length;
  const willDelete=merge.reduce((s,m)=>s+m.others.length,0);
  const rowsHtml=merge.slice(0,500).map(m=>`<tr>
    <td>${esc(m.name)}</td>
    <td class="keep">#${m.keep.pid} <code>${esc(m.keep.sku)}</code> ${enr(m.keep)?'🏷️':''}${m.skuChange?` → <b>${esc(m.newSku)}</b>`:''}</td>
    <td class="del">${m.others.map(o=>`#${o.pid} <code>${esc(o.sku)}</code>${enr(o)?'🏷️':''}`).join('<br>')}</td>
  </tr>`).join('');
  const manualHtml=manual.length?`<h3>⚠️ Не чіпаю — перевір вручну (${manual.length})</h3>
    <table><tr><th>Причина</th><th>Записи</th></tr>${manual.slice(0,200).map(m=>`<tr><td>${esc(m.reason)}</td><td>${m.g.map(r=>`#${r.pid} <code>${esc(r.sku)}</code> «${esc(r.name)}»${enr(r)?' 🏷️':''}`).join('<br>')}</td></tr>`).join('')}</table>`:'';
  const body=`<h2>Об'єднати дублі за назвою</h2>
    <div style="background:#eef5ee;padding:10px;border-radius:8px;margin:8px 0">
      Пар до об'єднання: <b>${merge.length}</b> · буде видалено голих близнюків: <b>${willDelete}</b> · виправлено SKU: <b>${willResku}</b>.<br>
      <span class="muted">Правило: лишаємо обогащений запис (🏷️ = є опис/фото/фасадна), забираємо в нього «добрий» SKU (00-/РТ-), голий близнюк — видаляємо. <b>Зроблено бекап БД.</b></span>
    </div>
    ${merge.length?`<form method="POST" action="/admin/dedup" onsubmit="return confirm('Об\\'єднати ${merge.length} пар? Буде видалено ${willDelete} записів. Бекап зроблено.')">
      <button class="btn danger" type="submit">✅ Застосувати об'єднання (${merge.length})</button>
    </form>`:'<p>Дублів за назвою не знайдено.</p>'}
    <h3>Що буде зроблено (${merge.length})</h3>
    <table><tr><th>Назва</th><th class="keep">Лишити (→ новий SKU)</th><th class="del">Видалити</th></tr>${rowsHtml}</table>
    ${merge.length>500?`<p class="muted">…показано перші 500 із ${merge.length}</p>`:''}
    ${manualHtml}`;
  return new Response(PAGE(body),{headers:{'content-type':'text/html; charset=utf-8'}});
}

export async function onRequestPost(context){
  const db=context.env.DB;
  const {merge}=await buildPlan(db);
  const stmts=[]; let deleted=0, resku=0;
  for(const m of merge){
    for(const o of m.others){
      stmts.push(db.prepare(`DELETE FROM product_images WHERE pid=?`).bind(o.pid));
      stmts.push(db.prepare(`DELETE FROM product_content WHERE pid=?`).bind(o.pid));
      stmts.push(db.prepare(`DELETE FROM products WHERE pid=?`).bind(o.pid));
      deleted++;
    }
    if(m.skuChange){ stmts.push(db.prepare(`UPDATE products SET sku=? WHERE pid=?`).bind(m.newSku, m.keep.pid)); resku++; }
  }
  for(let i=0;i<stmts.length;i+=50) await db.batch(stmts.slice(i,i+50));
  const body=`<h2>✅ Об'єднання виконано</h2>
    <div style="background:#eef5ee;padding:10px;border-radius:8px">
      Об'єднано пар: <b>${merge.length}</b><br>Видалено голих близнюків: <b>${deleted}</b><br>Виправлено SKU: <b>${resku}</b>
    </div>
    <p style="margin-top:12px"><a class="btn" href="/admin/dedup">↻ Перевірити ще раз</a> <a class="btn" href="/admin" style="background:#777">До адмінки</a></p>
    <p class="muted">Якщо щось не так — відновлення з бекапу db/backups/.</p>`;
  return new Response(PAGE(body),{headers:{'content-type':'text/html; charset=utf-8'}});
}
