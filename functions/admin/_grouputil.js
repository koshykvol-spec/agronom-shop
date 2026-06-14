// Спільні утиліти групування фасовок (імпортуються в index.js, group-assign.js).
// Файл із "_" — Cloudflare Pages НЕ робить його роутом, лише модулем.
const TR = {'а':'a','б':'b','в':'v','г':'g','ґ':'g','д':'d','е':'e','є':'ie','ж':'zh','з':'z','и':'y','і':'i','ї':'i','й':'j','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ь':'','ю':'iu','я':'ia',"'":'','’':''};
export function slugify(n){ let s=(n||'').toLowerCase(),o=''; for(const ch of s)o+=(TR[ch]!==undefined?TR[ch]:ch); return o.replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||'grp'; }

// Розмір/фасовка в назві (250 г, 10 л, 5 мл…)
export const SIZE_SRC = '\\d+[.,]?\\d*\\s?(?:кг|мг|мл|см|мм|капс|ампул|саше|таб|пак|шт|л|г|м)(?![а-яіїєґА-ЯІЇЄҐa-zA-Z])';
export function variantOf(name){ const m=String(name||'').match(new RegExp(SIZE_SRC,'i')); return m?m[0].replace(/\s+/g,' ').trim():''; }
export function baseOf(name){ return String(name||'').replace(new RegExp(SIZE_SRC,'gi'),' ').replace(/[(){}\[\]]/g,' ').replace(/[,.;:·\/]+/g,' ').replace(/\s+/g,' ').trim().toLowerCase(); }
// Людська мітка групи: назва без розміру (для випадайки)
export function baseLabel(name){ return String(name||'').replace(new RegExp(SIZE_SRC,'gi'),'').replace(/\s+/g,' ').trim(); }

function escA(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// Наявні групи: gid + людська мітка + кількість фасовок (відсортовано за міткою)
export async function existingGroups(db){
  const rows=(await db.prepare(`SELECT c.group_id gid, COUNT(*) n, MIN(p.name) nm
     FROM product_content c JOIN products p ON p.pid=c.pid
     WHERE c.group_id IS NOT NULL AND c.group_id<>'' GROUP BY c.group_id`).all()).results||[];
  return rows.map(r=>({ gid:r.gid, n:r.n, label:baseLabel(r.nm)||r.gid }))
             .sort((a,b)=>a.label.localeCompare(b.label,'uk'));
}

// Комбобокс вибору групи з ПОШУКОМ: текстове поле фільтрує список; клік обирає;
// фактичний gid — у прихованому полі name. «без групи» + «нова» завжди видимі.
export function groupComboHTML(name, groups, current){
  const cur = current || '';
  let curLabel = '';
  if(cur === '__new__') curLabel = '➕ нова група';
  else if(cur){ const g = groups.find(x=>x.gid===cur); curLabel = g ? `${g.label} (${g.n})` : cur; }
  const opts = [
    `<div class="gcombo-opt" data-v="">— без групи</div>`,
    `<div class="gcombo-opt" data-v="__new__">➕ нова група (за назвою товару)</div>`
  ];
  if(cur && !groups.some(x=>x.gid===cur)) opts.push(`<div class="gcombo-opt" data-v="${escA(cur)}" data-s="${escA(String(cur).toLowerCase())}">${escA(cur)} (поточна)</div>`);
  for(const g of groups) opts.push(`<div class="gcombo-opt" data-v="${escA(g.gid)}" data-s="${escA(g.label.toLowerCase())}">${escA(g.label)} (${g.n})</div>`);
  return `<div class="gcombo">
    <input type="hidden" name="${name}" value="${escA(cur)}">
    <input type="text" class="gcombo-in" autocomplete="off" placeholder="Група: почни вводити назву…" value="${escA(curLabel)}" onfocus="gcFilter(this)" oninput="gcFilter(this)">
    <div class="gcombo-list">${opts.join('')}</div>
  </div>`;
}

// CSS+JS комбобокса — вставити ОДИН раз на сторінку (де є groupComboHTML).
export const GROUP_COMBO_ASSETS = `<style>
.gcombo{position:relative;display:inline-block;min-width:230px;vertical-align:top}
.gcombo-in{width:100%;padding:7px 9px;border:1px solid #c8e0c8;border-radius:8px;box-sizing:border-box;font:inherit}
.gcombo-list{position:absolute;z-index:60;left:0;right:0;top:100%;background:#fff;border:1px solid #cfe3cf;border-radius:8px;max-height:260px;overflow:auto;box-shadow:0 6px 18px rgba(0,0,0,.14);display:none}
.gcombo-list.open{display:block}
.gcombo-opt{padding:7px 10px;cursor:pointer;font-size:.9rem;border-bottom:1px solid #f4f4f4}
.gcombo-opt:hover{background:#eef5ee}
</style><script>
function gcFilter(inp){
  var box=inp.closest('.gcombo'), list=box.querySelector('.gcombo-list'); list.classList.add('open');
  var q=inp.value.trim().toLowerCase();
  list.querySelectorAll('.gcombo-opt').forEach(function(o){
    var v=o.getAttribute('data-v'), s=(o.getAttribute('data-s')||o.textContent).toLowerCase();
    o.style.display=(!q||v===''||v==='__new__'||s.indexOf(q)>=0)?'':'none';
  });
}
document.addEventListener('click',function(e){
  var opt=e.target.closest?e.target.closest('.gcombo-opt'):null;
  if(opt){var box=opt.closest('.gcombo'),v=opt.getAttribute('data-v');
    box.querySelector('input[type=hidden]').value=v;
    box.querySelector('.gcombo-in').value=(v===''?'':(v==='__new__'?'➕ нова група':opt.textContent.trim()));
    box.querySelector('.gcombo-list').classList.remove('open');return;}
  document.querySelectorAll('.gcombo-list.open').forEach(function(l){if(!l.closest('.gcombo').contains(e.target))l.classList.remove('open');});
});
</script>`;
