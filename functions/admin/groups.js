// /admin/groups — напівавтоматичне групування фасовок одного товару.
// Авто-підказка груп (база назви + бренд + категорія) → підтвердження (group_id + variant_label).
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
const TR={'а':'a','б':'b','в':'v','г':'g','ґ':'g','д':'d','е':'e','є':'ie','ж':'zh','з':'z','и':'y','і':'i','ї':'i','й':'j','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ь':'','ю':'iu','я':'ia',"'":'','’':''};
function slugify(n){var s=(n||'').toLowerCase(),o='';for(var ch of s)o+=(TR[ch]!==undefined?TR[ch]:ch);o=o.replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');return o.slice(0,60)||'grp';}
const SIZE_SRC='\\d+[.,]?\\d*\\s?(?:кг|мг|мл|см|мм|капс|ампул|саше|таб|пак|шт|л|г|м)(?![а-яіїєґА-ЯІЇЄҐa-zA-Z])';
function variantOf(name){var m=String(name||'').match(new RegExp(SIZE_SRC,'i'));return m?m[0].replace(/\s+/g,' ').trim():'';}
function baseOf(name){return String(name||'').replace(new RegExp(SIZE_SRC,'gi'),' ').replace(/[(){}\[\]]/g,' ').replace(/[,.;:·\/]+/g,' ').replace(/\s+/g,' ').trim().toLowerCase();}

async function buildState(db){
  const rows=(await db.prepare(`SELECT p.pid,p.name,p.brand,p.category,p.price,p.sku,c.group_id,c.variant_label
                                 FROM products p JOIN product_content c ON c.pid=p.pid`).all()).results||[];
  const conf=new Map(), sugg=new Map();
  for(const r of rows){
    if(r.group_id){ if(!conf.has(r.group_id))conf.set(r.group_id,[]); conf.get(r.group_id).push(r); continue; }
    const base=baseOf(r.name);
    if(base.length<3) continue;
    const key=base+'|'+(r.brand||'')+'|'+(r.category||'');
    if(!sugg.has(key)) sugg.set(key,{base:base,brand:r.brand,cat:r.category,items:[]});
    sugg.get(key).items.push(r);
  }
  const suggested=[];
  for(const g of sugg.values()) if(g.items.length>=2){ g.gid=slugify(g.base+' '+(g.brand||'')); suggested.push(g); }
  suggested.sort((a,b)=>b.items.length-a.items.length);
  const confirmed=[...conf.entries()].map(function(e){return {gid:e[0],items:e[1]};}).sort((a,b)=>b.items.length-a.items.length);
  return {suggested,confirmed};
}

const PAGE=`<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>Групування фасовок</title><style>
body{font-family:system-ui;max-width:980px;margin:1.2rem auto;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2{color:#2d6a2d} .btn{background:#2d6a2d;color:#fff;border:0;padding:9px 15px;border-radius:8px;cursor:pointer;font-weight:700;text-decoration:none;display:inline-block}
.btn.gray{background:#777}.muted{color:#888;font-size:.85rem}
.grp{background:#fff;border:1px solid #e3e3e3;border-radius:10px;padding:10px 12px;margin:8px 0}
.grp-h{font-weight:700;color:#1a2e1a}
.row{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:.9rem;flex-wrap:wrap}
.row input[type=text]{width:120px;padding:4px 6px;border:1px solid #ccc;border-radius:6px}
.pager{display:flex;gap:10px;align-items:center;margin:14px 0}
code{background:#f0f0f0;padding:1px 5px;border-radius:4px;font-size:.85em}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body>__BODY__</body></html>`;

export async function onRequestGet(context){
  const db=context.env.DB;
  const url=new URL(context.request.url);
  // розгрупування — GET ?ungroup=<gid>
  if(url.searchParams.get('ungroup')){
    await db.prepare(`UPDATE product_content SET group_id=NULL, variant_label=NULL WHERE group_id=?`).bind(url.searchParams.get('ungroup')).run();
    return Response.redirect(new URL('/admin/groups', context.request.url).toString(), 303);
  }
  const page=Math.max(1,parseInt(url.searchParams.get('page')||'1',10)||1);
  const PER=20;
  const {suggested,confirmed}=await buildState(db);
  const pages=Math.max(1,Math.ceil(suggested.length/PER));
  const slice=suggested.slice((page-1)*PER, page*PER);

  const groupsHtml=slice.map(function(g){
    const rows=g.items.map(function(it){
      const vl=it.variant_label || variantOf(it.name) || '';
      return '<div class="row">'
        +'<input type="checkbox" name="pid" value="'+it.pid+'" checked>'
        +'<span style="flex:1;min-width:180px"><a href="/admin?pid='+it.pid+'" target="_blank">'+esc(it.name)+'</a></span>'
        +'<span class="muted">'+(it.price!=null?it.price+' грн':'')+' · '+esc(it.sku||'')+'</span>'
        +'розмір: <input type="text" name="vl_'+it.pid+'" value="'+esc(vl)+'">'
        +'<input type="hidden" name="gid_'+it.pid+'" value="'+esc(g.gid)+'">'
        +'</div>';
    }).join('');
    return '<div class="grp"><div class="grp-h">'+esc(g.items[0].name.replace(new RegExp(SIZE_SRC,'gi'),'').replace(/\s+/g,' ').trim())
      +' <span class="muted">· '+esc(g.brand||'—')+' · '+esc(g.cat||'')+' · '+g.items.length+' фасовок · <code>'+esc(g.gid)+'</code></span></div>'
      +rows+'</div>';
  }).join('');

  const pager=pages>1?'<div class="pager">'
    +(page>1?'<a class="btn" href="/admin/groups?page='+(page-1)+'">← Назад</a>':'')
    +'<span class="muted">Стор. '+page+' / '+pages+'</span>'
    +(page<pages?'<a class="btn" href="/admin/groups?page='+(page+1)+'">Далі →</a>':'')+'</div>':'';

  const confHtml=confirmed.length?('<h2>Підтверджені групи ('+confirmed.length+')</h2>'
    +confirmed.slice(0,200).map(function(c){
      return '<div class="grp"><div class="grp-h"><code>'+esc(c.gid)+'</code> · '+c.items.length+' фасовок '
        +'<a href="/admin/groups?ungroup='+encodeURIComponent(c.gid)+'" onclick="return confirm(\'Розгрупувати?\')" style="color:#c0392b;font-size:.85rem">✕ розгрупувати</a></div>'
        +c.items.map(function(it){return '<div class="row muted">'+esc(it.variant_label||'')+' — '+esc(it.name)+' ('+esc(it.sku||'')+')</div>';}).join('')
        +'<form method="POST" action="/admin/group-assign" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">'
        +'<input type="hidden" name="gid" value="'+esc(c.gid)+'"><input type="hidden" name="back" value="/admin/groups">'
        +'<input type="text" name="q" placeholder="назва або SKU товару (без групи)" style="flex:1;min-width:200px;padding:4px 6px;border:1px solid #ccc;border-radius:6px">'
        +'<button class="btn" type="submit" style="padding:5px 12px">➕ додати у групу</button></form>'
        +'</div>';
    }).join('')):'';

  const body='<div><a href="/admin">← до адмінки</a></div>'
    +'<h2>Групування фасовок (напівавтомат)</h2>'
    +'<div class="muted" style="margin-bottom:8px">Система запропонувала групи за базовою назвою + брендом + категорією. Зніми галочку з зайвого, виправ «розмір» за потреби — і <b>Підтвердити</b>. Запропоновано груп: <b>'+suggested.length+'</b>.</div>'
    +(slice.length?('<form method="POST" action="/admin/groups?page='+page+'">'+groupsHtml
       +'<div style="margin:12px 0"><button class="btn" type="submit">✅ Підтвердити позначені на сторінці</button></div></form>'+pager)
       :'<p>Нових пропозицій немає 🎉</p>')
    +confHtml;
  return new Response(PAGE.replace('__BODY__',body),{headers:{'content-type':'text/html; charset=utf-8'}});
}

export async function onRequestPost(context){
  const db=context.env.DB;
  const f=await context.request.formData();
  const page=new URL(context.request.url).searchParams.get('page')||'1';
  const pids=f.getAll('pid');
  const stmts=[]; let n=0;
  for(const pid of pids){
    const gid=(f.get('gid_'+pid)||'').trim();
    const vl=(f.get('vl_'+pid)||'').trim()||null;
    if(!gid) continue;
    stmts.push(db.prepare(`UPDATE product_content SET group_id=?, variant_label=? WHERE pid=?`).bind(gid,vl,parseInt(pid,10)));
    n++;
  }
  for(let i=0;i<stmts.length;i+=60) await db.batch(stmts.slice(i,i+60));
  return Response.redirect(new URL('/admin/groups?page='+encodeURIComponent(page), context.request.url).toString(), 303);
}
