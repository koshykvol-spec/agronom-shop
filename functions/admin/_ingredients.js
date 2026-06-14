// Довідник діючих речовин (active_ingredients) + звʼязка M:N (product_ingredients).
// Реляційний source of truth. product_content.active_ingredient лишаємо як ПОХІДНИЙ
// нормалізований текст (rebuild при збереженні) — для сумісності/довідки.
// Файл із "_" — не роут, лише модуль.
function escA(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

export async function allIngredients(db){
  return (await db.prepare(`SELECT id, name FROM active_ingredients ORDER BY name COLLATE NOCASE`).all()).results || [];
}
export async function productIngredientIds(db, pid){
  return ((await db.prepare(`SELECT ingredient_id id FROM product_ingredients WHERE pid=?`).bind(pid).all()).results || []).map(r => r.id);
}

// Нормалізований текст «a + b» з набору назв (сорт, унікальні, lowercase)
function normText(names){
  return names.map(s => String(s||'').trim().toLowerCase()).filter(Boolean)
    .filter((v,i,a) => a.indexOf(v)===i).sort((a,b) => a.localeCompare(b,'uk')).join(' + ');
}

// Замінити звʼязки товару (ids — масив ingredient_id) + перебудувати похідний текст.
export async function replaceProductIngredients(db, pid, ids){
  ids = [...new Set((ids||[]).map(x => parseInt(x,10)).filter(Number.isFinite))];
  const stmts = [ db.prepare(`DELETE FROM product_ingredients WHERE pid=?`).bind(pid) ];
  for (const id of ids) stmts.push(db.prepare(`INSERT OR IGNORE INTO product_ingredients(pid,ingredient_id) VALUES(?,?)`).bind(pid, id));
  await db.batch(stmts);
  let text = '';
  if (ids.length){
    const ph = ids.map(() => '?').join(',');
    const names = ((await db.prepare(`SELECT name FROM active_ingredients WHERE id IN (${ph})`).bind(...ids).all()).results || []).map(r => r.name);
    text = normText(names);
  }
  await db.prepare(`UPDATE product_content SET active_ingredient=? WHERE pid=?`).bind(text, pid).run();
  return text;
}

// Перебудувати похідний текст товару з поточної звʼязки (після delete/rename у довіднику).
export async function rebuildText(db, pid){
  const ids = await productIngredientIds(db, pid);
  let text = '';
  if (ids.length){
    const ph = ids.map(() => '?').join(',');
    const names = ((await db.prepare(`SELECT name FROM active_ingredients WHERE id IN (${ph})`).bind(...ids).all()).results || []).map(r => r.name);
    text = normText(names);
  }
  await db.prepare(`UPDATE product_content SET active_ingredient=? WHERE pid=?`).bind(text, pid).run();
}

// Мульти-пікер: чипи обраних + поле-пошук + список довідника. Прихований <input name> = "1,5".
export function ingredientPickerHTML(name, all, selectedIds){
  const sel = new Set((selectedIds||[]).map(Number));
  const byId = new Map(all.map(i => [i.id, i.name]));
  const chips = [...sel].filter(id => byId.has(id)).map(id =>
    `<span class="ip-chip" data-id="${id}">${escA(byId.get(id))} <b class="ip-x">×</b></span>`).join('');
  const opts = all.map(i => `<div class="ip-opt" data-id="${i.id}" data-s="${escA(i.name.toLowerCase())}">${escA(i.name)}</div>`).join('');
  return `<div class="ipick">
    <input type="hidden" name="${name}" value="${[...sel].join(',')}">
    <div class="ip-chips">${chips}</div>
    <input type="text" class="ip-in" autocomplete="off" placeholder="почни вводити діючу речовину…" oninput="ipFilter(this)" onfocus="ipFilter(this)">
    <div class="ip-list">${opts}</div>
  </div>`;
}

// CSS+JS пікера — вставити ОДИН раз на сторінку.
export const INGREDIENT_PICKER_ASSETS = `<style>
.ipick{position:relative;border:1px solid #c8e0c8;border-radius:8px;padding:5px;background:#fff}
.ip-chips{display:flex;flex-wrap:wrap;gap:5px}
.ip-chip{background:#eef5ee;border:1px solid #cfe3cf;border-radius:14px;padding:3px 9px;font-size:.85rem;display:inline-flex;align-items:center;gap:5px}
.ip-x{cursor:pointer;color:#c0392b;font-weight:700}
.ip-in{border:none;outline:none;width:100%;padding:5px;font:inherit;box-sizing:border-box}
.ip-list{position:absolute;z-index:60;left:0;right:0;top:100%;background:#fff;border:1px solid #cfe3cf;border-radius:8px;max-height:220px;overflow:auto;box-shadow:0 6px 18px rgba(0,0,0,.14);display:none}
.ip-list.open{display:block}
.ip-opt{padding:6px 10px;cursor:pointer;font-size:.9rem;border-bottom:1px solid #f4f4f4}
.ip-opt:hover{background:#eef5ee}
</style><script>
function ipSelIds(box){ return [].map.call(box.querySelectorAll('.ip-chip'), function(c){return c.getAttribute('data-id');}); }
function ipSync(box){ box.querySelector('input[type=hidden]').value = ipSelIds(box).join(','); }
function ipFilter(inp){
  var box=inp.closest('.ipick'), list=box.querySelector('.ip-list'); list.classList.add('open');
  var sel=ipSelIds(box), q=inp.value.trim().toLowerCase();
  list.querySelectorAll('.ip-opt').forEach(function(o){
    var id=o.getAttribute('data-id'), s=(o.getAttribute('data-s')||o.textContent).toLowerCase();
    o.style.display=(sel.indexOf(id)<0 && (!q || s.indexOf(q)>=0)) ? '' : 'none';
  });
}
document.addEventListener('click', function(e){
  var t=e.target;
  if(t.classList && t.classList.contains('ip-x')){ var box=t.closest('.ipick'); t.closest('.ip-chip').remove(); ipSync(box); return; }
  var opt=t.closest ? t.closest('.ip-opt') : null;
  if(opt){
    var box2=opt.closest('.ipick'), id=opt.getAttribute('data-id'), nm=opt.textContent.trim();
    if(!box2.querySelector('.ip-chip[data-id="'+id+'"]')){
      var chip=document.createElement('span'); chip.className='ip-chip'; chip.setAttribute('data-id', id);
      chip.textContent=nm+' ';
      var x=document.createElement('b'); x.className='ip-x'; x.textContent='×'; chip.appendChild(x);
      box2.querySelector('.ip-chips').appendChild(chip); ipSync(box2);
    }
    var inp=box2.querySelector('.ip-in'); inp.value=''; ipFilter(inp); inp.focus(); return;
  }
  document.querySelectorAll('.ip-list.open').forEach(function(l){ if(!l.closest('.ipick').contains(e.target)) l.classList.remove('open'); });
});
</script>`;
