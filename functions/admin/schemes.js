// /admin/schemes — структурний редактор схем захисту (app_data.protection_schemes).
// 13 категорій → схеми → стадії (stage/date/problem/products/additives). CRUD+reorder на кожному рівні.
// Дані редагуються деревом у браузері, зберігається ВЕСЬ блоб через цей же POST (валідація JSON).
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// ── Клієнтський редактор (виконується в браузері; серіалізується через .toString()) ──
function schemesEditor(){
  var SRC = (window.__SCHEMES__ && window.__SCHEMES__.protection_schemes) ? window.__SCHEMES__.protection_schemes : {};
  function arr(x){ return Array.isArray(x) ? x.slice() : []; }
  // Внутрішня модель — масиви на всіх рівнях (зручний reorder)
  var cats = Object.keys(SRC).map(function(k){
    var v = SRC[k] || {};
    return {
      key: k, uk_name: v.uk_name||'', icon: v.icon||'', color: v.color||'#cccccc',
      cultures: arr(v.cultures),
      schemes: arr(v.schemes).map(function(s){
        return { id: s.id||'', name: s.name||'', timing: s.timing||'',
          treatments: arr(s.treatments).map(function(t){
            return { stage: t.stage||'', date: t.date||'', problem: t.problem||'',
              products: arr(t.products), additives: arr(t.additives) };
          }) };
      })
    };
  });

  var dirty = false, expanded = {};
  function setDirty(){ if(!dirty){ dirty = true; var b=document.getElementById('sch-save'); if(b) b.classList.add('dirty'); } }
  window.addEventListener('beforeunload', function(e){ if(dirty){ e.preventDefault(); e.returnValue=''; } });

  function E(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function newCat(){ return { key:'cat_'+Math.random().toString(36).slice(2,6), uk_name:'Нова категорія', icon:'🌿', color:'#8bc34a', cultures:[], schemes:[] }; }
  function newScheme(){ return { id:'scheme_'+Math.random().toString(36).slice(2,6), name:'Нова схема', timing:'', treatments:[] }; }
  function newTreatment(){ return { stage:'Нова стадія', date:'', problem:'', products:[], additives:[] }; }

  function locate(p){
    var m = p.match(/^c(\d+)(?:s(\d+))?(?:t(\d+))?$/); if(!m) return null;
    var n = cats[+m[1]]; if(!n) return null;
    if(m[2]!=null){ n=n.schemes[+m[2]]; if(!n) return null; }
    if(m[3]!=null){ n=n.treatments[+m[3]]; if(!n) return null; }
    return n;
  }
  function parentArr(p){
    var m = p.match(/^c(\d+)(?:s(\d+))?(?:t(\d+))?$/);
    if(m[3]!=null) return [cats[+m[1]].schemes[+m[2]].treatments, +m[3]];
    if(m[2]!=null) return [cats[+m[1]].schemes, +m[2]];
    return [cats, +m[1]];
  }

  function field(p,fname,label,val,w){
    return '<label class="fld"><span>'+label+'</span><input data-p="'+p+'" data-field="'+fname+'" value="'+E(val)+'"'+(w?' style="width:'+w+'px"':'')+'></label>';
  }
  function area(p,fname,label,val){
    return '<label class="fld grow"><span>'+label+'</span><textarea data-p="'+p+'" data-field="'+fname+'" rows="2">'+E(val)+'</textarea></label>';
  }
  function chips(p,fname,label,a,useProd){
    var items=a.map(function(v,i){ return '<span class="chip">'+E(v)+'<button type="button" data-act="delchip" data-p="'+p+'" data-field="'+fname+'" data-i="'+i+'">×</button></span>'; }).join('');
    return '<div class="chips"><span class="fl">'+label+' ('+a.length+')</span>'+items
      +'<input id="add_'+p+'_'+fname+'" class="chipin" '+(useProd?'list="prod-names"':'')+' placeholder="+ додати" data-addp="'+p+'" data-addf="'+fname+'">'
      +'<button type="button" class="op add" data-act="addchip" data-p="'+p+'" data-field="'+fname+'">＋</button></div>';
  }
  function head(type,p,title,idx,total){
    return '<div class="nh '+type+'" data-act="toggle" data-p="'+p+'"><span class="tw">'+(expanded[p]?'▾':'▸')+'</span>'
      +'<span class="nt">'+title+'</span><span class="ops">'
      +'<button type="button" class="op" data-act="up" data-p="'+p+'"'+(idx===0?' disabled':'')+' title="вгору">↑</button>'
      +'<button type="button" class="op" data-act="down" data-p="'+p+'"'+(idx===total-1?' disabled':'')+' title="вниз">↓</button>'
      +'<button type="button" class="op del" data-act="del" data-p="'+p+'" title="видалити">🗑</button></span></div>';
  }

  function treatmentHtml(t,ci,si,ti){
    var p='c'+ci+'s'+si+'t'+ti;
    var body = expanded[p] ? '<div class="nb">'
      + area(p,'stage','Стадія',t.stage)
      + '<div class="row">'+field(p,'date','Період',t.date,220)+'</div>'
      + area(p,'problem','Проблема/хвороби',t.problem)
      + chips(p,'products','Препарати',t.products,true)
      + chips(p,'additives','Додатки (бакова суміш)',t.additives,true)
      + '</div>' : '';
    return '<div class="node t'+(expanded[p]?' open':'')+'">'+head('t',p,'🔹 '+E(t.stage||'(стадія)'),ti,/*total*/cats[ci].schemes[si].treatments.length)+body+'</div>';
  }
  function schemeHtml(s,ci,si){
    var p='c'+ci+'s'+si;
    var body = expanded[p] ? '<div class="nb">'
      + '<div class="row">'+field(p,'id','ID (для лінків)',s.id,180)+field(p,'name','Назва',s.name,260)+field(p,'timing','Період',s.timing,200)+'</div>'
      + '<div class="sub">'+s.treatments.map(function(t,ti){return treatmentHtml(t,ci,si,ti);}).join('')
      + '<button type="button" class="addbtn" data-act="addtrt" data-p="'+p+'">＋ Стадія</button></div>'
      + '</div>' : '';
    return '<div class="node s'+(expanded[p]?' open':'')+'">'+head('s',p,'📋 '+E(s.name||'(схема)')+' <span class="cnt">'+s.treatments.length+' ст.</span>',si,cats[ci].schemes.length)+body+'</div>';
  }
  function catHtml(c,ci){
    var p='c'+ci;
    var body = expanded[p] ? '<div class="nb">'
      + '<div class="row">'+field(p,'uk_name','Назва',c.uk_name,300)+field(p,'icon','Іконка',c.icon,60)+field(p,'color','Колір',c.color,90)+field(p,'key','Ключ URL',c.key,150)+'</div>'
      + chips(p,'cultures','Культури',c.cultures,false)
      + '<div class="sub">'+c.schemes.map(function(s,si){return schemeHtml(s,ci,si);}).join('')
      + '<button type="button" class="addbtn" data-act="addsch" data-p="'+p+'">＋ Схема</button></div>'
      + '</div>' : '';
    return '<div class="node c'+(expanded[p]?' open':'')+'">'+head('c',p,(c.icon||'')+' '+E(c.uk_name||'(категорія)')+' <span class="cnt">'+c.schemes.length+' схем</span>',ci,cats.length)+body+'</div>';
  }

  function render(){
    var root=document.getElementById('sch-tree');
    root.innerHTML = cats.map(catHtml).join('') + '<button type="button" class="addbtn big" data-act="addcat">＋ Категорія</button>';
    var st=document.getElementById('sch-stat'); if(st) st.textContent = cats.length+' категорій · '+cats.reduce(function(a,c){return a+c.schemes.length;},0)+' схем';
  }

  function serialize(){
    var out={};
    cats.forEach(function(c){
      var key=(c.key||'').trim()||('cat_'+Math.random().toString(36).slice(2,6));
      out[key]={ uk_name:c.uk_name, icon:c.icon, color:c.color,
        cultures:c.cultures.filter(function(x){return String(x).trim();}),
        schemes:c.schemes.map(function(s){
          return { id:s.id, name:s.name, timing:s.timing,
            treatments:s.treatments.map(function(t){
              var o={ stage:t.stage, date:t.date, problem:t.problem, products:t.products.filter(function(x){return String(x).trim();}) };
              var ad=t.additives.filter(function(x){return String(x).trim();});
              if(ad.length) o.additives=ad;
              return o;
            }) };
        }) };
    });
    return { protection_schemes: out };
  }

  // ── Події ──
  var root=document.getElementById('sch-tree');
  root.addEventListener('input', function(e){
    var el=e.target, p=el.getAttribute('data-p'), f=el.getAttribute('data-field');
    if(!p||!f) return; var n=locate(p); if(!n) return; n[f]=el.value; setDirty();
    if(f==='uk_name'||f==='name'||f==='stage'){ // оновити заголовок без повного ререндеру
      var nh=el.closest('.node'); if(nh){ var t=nh.querySelector('.nt'); if(t){} }
    }
  });
  root.addEventListener('keydown', function(e){
    if(e.key==='Enter' && e.target.classList.contains('chipin')){ e.preventDefault(); addChip(e.target.getAttribute('data-addp'), e.target.getAttribute('data-addf')); }
  });
  function addChip(p,f){
    var inp=document.getElementById('add_'+p+'_'+f); if(!inp) return;
    var v=(inp.value||'').trim(); if(!v) return;
    var n=locate(p); if(!n) return; n[f]=n[f]||[]; n[f].push(v); setDirty();
    expanded[p]=true; render();
    var ni=document.getElementById('add_'+p+'_'+f); if(ni) ni.focus();
  }
  root.addEventListener('click', function(e){
    var b=e.target.closest('[data-act]'); if(!b) return;
    var act=b.getAttribute('data-act'), p=b.getAttribute('data-p');
    if(act==='toggle'){ expanded[p]=!expanded[p]; render(); return; }
    if(act==='up'||act==='down'){ var pa=parentArr(p), a=pa[0], i=pa[1], j=act==='up'?i-1:i+1; if(j>=0&&j<a.length){ var tmp=a[i];a[i]=a[j];a[j]=tmp; setDirty(); render(); } return; }
    if(act==='del'){ if(!confirm('Видалити разом із вмістом?')) return; var pa=parentArr(p); pa[0].splice(pa[1],1); setDirty(); render(); return; }
    if(act==='addcat'){ cats.push(newCat()); expanded['c'+(cats.length-1)]=true; setDirty(); render(); return; }
    if(act==='addsch'){ var n=locate(p); n.schemes.push(newScheme()); expanded[p+'s'+(n.schemes.length-1)]=true; setDirty(); render(); return; }
    if(act==='addtrt'){ var n2=locate(p); n2.treatments.push(newTreatment()); expanded[p+'t'+(n2.treatments.length-1)]=true; setDirty(); render(); return; }
    if(act==='delchip'){ var n3=locate(p), f3=b.getAttribute('data-field'); n3[f3].splice(+b.getAttribute('data-i'),1); setDirty(); render(); return; }
    if(act==='addchip'){ addChip(p, b.getAttribute('data-field')); return; }
  });

  // Збереження
  document.getElementById('sch-form').addEventListener('submit', function(e){
    var data=serialize();
    try{ JSON.parse(JSON.stringify(data)); }catch(err){ e.preventDefault(); alert('Помилка серіалізації: '+err.message); return; }
    document.getElementById('sch-json').value = JSON.stringify(data);
    dirty=false;
  });

  // Розширений режим (raw JSON)
  document.getElementById('raw-show').addEventListener('click', function(){
    document.getElementById('raw-ta').value = JSON.stringify(serialize(), null, 2);
    document.getElementById('raw-wrap').style.display='block';
  });
  document.getElementById('raw-apply').addEventListener('click', function(){
    try{ var o=JSON.parse(document.getElementById('raw-ta').value);
      if(!o||!o.protection_schemes) throw new Error('очікую ключ protection_schemes');
      window.__SCHEMES__=o; location.reload();   // найпростіше — перебудувати з нуля
    }catch(err){ alert('Невалідний JSON: '+err.message); }
  });

  // Автодоповнення препаратів з каталогу
  fetch('/api/products').then(function(r){return r.ok?r.json():[];}).then(function(list){
    var names={}; (list||[]).forEach(function(p){ if(p&&p.n) names[p.n]=1; });
    var dl=document.getElementById('prod-names'); if(!dl) return;
    Object.keys(names).slice(0,3000).forEach(function(nm){ var o=document.createElement('option'); o.value=nm; dl.appendChild(o); });
  }).catch(function(){});

  render();
}

const PAGE = (dataJs, note, count) => `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>Схеми захисту</title><style>
body{font-family:system-ui;max-width:1000px;margin:0 auto 3rem;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2{color:#2d6a2d;margin:.3rem 0}
.bar{position:sticky;top:0;z-index:20;background:#f7f8f7;padding:8px 0;border-bottom:1px solid #dde;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.btn{background:#2d6a2d;color:#fff;border:0;padding:9px 16px;border-radius:8px;cursor:pointer;font-weight:700}
.btn.dirty{box-shadow:0 0 0 3px #ffd54f}
.muted{color:#888;font-size:.85rem}
.node{border:1px solid #e0e4e0;border-radius:8px;margin:5px 0;background:#fff}
.node.c{border-left:4px solid #2d6a2d}.node.s{border-left:4px solid #6a9b3a;margin-left:4px}.node.t{border-left:4px solid #b0b0b0;margin-left:4px}
.nh{display:flex;align-items:center;gap:7px;padding:7px 9px;cursor:pointer;user-select:none}
.nh:hover{background:#f3f7f3}.nh .tw{color:#2d6a2d;font-size:.8rem;width:12px}
.nh.s{font-size:.93rem}.nh.t{font-size:.88rem;color:#444}
.nt{flex:1;font-weight:600} .cnt{color:#999;font-weight:400;font-size:.8rem}
.ops{display:flex;gap:3px} .op{border:1px solid #ccc;background:#fafafa;border-radius:5px;cursor:pointer;font-size:.8rem;padding:2px 6px;line-height:1}
.op.del{color:#c0392b;border-color:#e3b4ad} .op[disabled]{opacity:.3;cursor:default} .op.add{color:#2d6a2d;font-weight:700}
.nb{padding:6px 10px 10px 22px}
.row{display:flex;gap:8px;flex-wrap:wrap}
.fld{display:flex;flex-direction:column;gap:2px;font-size:.78rem;color:#666;margin:4px 0}.fld.grow{flex:1}
.fld input,.fld textarea{font:inherit;font-size:.9rem;color:#222;padding:5px 7px;border:1px solid #ccc;border-radius:6px}
.fld textarea{width:100%;resize:vertical}
.sub{margin-top:6px}
.chips{display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin:6px 0;padding:6px;background:#fafcf8;border-radius:6px}
.chips .fl{font-size:.78rem;color:#666;margin-right:4px}
.chip{background:#e8f3e1;border:1px solid #cfe3c0;border-radius:12px;padding:2px 6px 2px 9px;font-size:.83rem;display:inline-flex;align-items:center;gap:3px}
.chip button{border:0;background:transparent;color:#888;cursor:pointer;font-size:1rem;line-height:1;padding:0}
.chipin{border:1px dashed #bbb;border-radius:10px;padding:3px 8px;font:inherit;font-size:.83rem;min-width:120px}
.addbtn{margin:6px 0;background:#eef6ee;border:1px dashed #8bbf8b;color:#2d6a2d;border-radius:8px;padding:6px 12px;cursor:pointer;font-weight:600}
.addbtn.big{display:block;width:100%;margin-top:12px}
#raw-wrap{display:none;margin-top:10px}
#raw-ta{width:100%;min-height:40vh;font-family:ui-monospace,monospace;font-size:.78rem;padding:8px;border:1px solid #ccc;border-radius:8px;white-space:pre}
.okbox{background:#fff;border:1px solid #2d6a2d;color:#2d6a2d;border-radius:8px;padding:8px 12px;margin:8px 0}
.errbox{background:#fff;border:1px solid #c0392b;color:#c0392b;border-radius:8px;padding:8px 12px;margin:8px 0}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body>
<div><a href="/admin">← до адмінки</a></div>
<h2>🛡 Схеми захисту — редактор</h2>
${note}
<div class="bar">
  <form id="sch-form" method="POST" action="/admin/schemes" style="margin:0"><input type="hidden" name="json" id="sch-json"><button class="btn" id="sch-save" type="submit">💾 Зберегти все</button></form>
  <span class="muted" id="sch-stat"></span>
  <button class="op" id="raw-show" type="button" style="margin-left:auto">{ } Розширений (raw JSON)</button>
</div>
<div class="muted">Натисніть заголовок, щоб розгорнути. Стрілки — порядок, 🗑 — видалити. Препарати/додатки — автодоповнення з каталогу. Зміни застосуються на сайті за ~10 хв (кеш).</div>
<div id="raw-wrap"><textarea id="raw-ta" spellcheck="false"></textarea><div style="margin-top:6px"><button class="btn" id="raw-apply" type="button">Застосувати з тексту</button> <span class="muted">перебудує дерево</span></div></div>
<div id="sch-tree"></div>
<datalist id="prod-names"></datalist>
<script>window.__name=window.__name||function(f){return f;};window.__SCHEMES__=${dataJs};(${schemesEditor.toString()})();</script>
</body></html>`;

export async function onRequestGet(context){
  const db = context.env.DB;
  const status = new URL(context.request.url).searchParams.get('saved');
  let json = '{"protection_schemes":{}}', count = 0;
  try {
    const row = await db.prepare(`SELECT json FROM app_data WHERE key='protection_schemes'`).first();
    if (row && row.json){ json = row.json; try { count = Object.keys(JSON.parse(json).protection_schemes||{}).length; } catch(e){} }
  } catch(e){}
  const note = status === 'ok' ? '<div class="okbox">✅ Збережено.</div>'
             : status === 'bad' ? '<div class="errbox">❌ Невалідний JSON — не збережено.</div>'
             : status === 'nokey' ? '<div class="errbox">❌ Очікую ключ "protection_schemes".</div>' : '';
  const dataJs = json.replace(/</g, '\\u003c');   // безпечно для <script>
  return new Response(PAGE(dataJs, note, count), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function onRequestPost(context){
  const db = context.env.DB;
  const f = await context.request.formData();
  const raw = (f.get('json')||'').toString();
  let obj;
  try { obj = JSON.parse(raw); } catch(e){ return Response.redirect(new URL('/admin/schemes?saved=bad', context.request.url).toString(), 303); }
  if (!obj || typeof obj !== 'object' || !obj.protection_schemes){ return Response.redirect(new URL('/admin/schemes?saved=nokey', context.request.url).toString(), 303); }
  await db.prepare(`INSERT INTO app_data(key,json,updated_at) VALUES('protection_schemes',?,?)
    ON CONFLICT(key) DO UPDATE SET json=excluded.json,updated_at=excluded.updated_at`)
    .bind(JSON.stringify(obj), new Date().toISOString().slice(0,10)).run();
  return Response.redirect(new URL('/admin/schemes?saved=ok', context.request.url).toString(), 303);
}
