// /admin/anno — масова заливка анотацій (описів) товарів.
// Вхід: CSV/TSV (sku/назва ; опис — для копірайтера з Excel, з багаторядковими полями)
// АБО JSON [{"sku":"...","annotation":"..."}]. Авто-визначення формату.
// Матч по sku (точно), відкат на точну назву (name або display_name). Dry-run → залити.
// Чіпає ЛИШЕ product_content.annotation; ціни/наявність/фото — не торкаємось.

const json = (o, s = 200) => new Response(JSON.stringify(o, null, 2), { status: s, headers: { 'content-type': 'application/json; charset=utf-8' } });

// --- Розбір CSV/TSV (RFC4180: лапки, коми/таби/переноси всередині поля) ---
function parseTable(text) {
  text = text.replace(/^﻿/, '');
  // авто-роздільник за першим (не порожнім) рядком
  const head = (text.split(/\r?\n/).find(l => l.trim()) || '');
  const tab = (head.match(/\t/g) || []).length;
  const sem = (head.match(/;/g) || []).length;
  const com = (head.match(/,/g) || []).length;
  const delim = tab >= sem && tab >= com && tab > 0 ? '\t' : (sem > com ? ';' : ',');
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\r') { /* ignore */ }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return { rows, delim };
}

// Текст → масив {id, annotation}. Підтримує JSON-масив і CSV/TSV.
function parseRecords(text) {
  const t = text.trim();
  if (t[0] === '[' || t[0] === '{') {
    let arr = JSON.parse(t);
    if (!Array.isArray(arr)) arr = [arr];
    return arr.map(function(r) {
      var id = String(r.sku || r.id || r.n || r.name || '').trim();
      var val = r.annotation || r.anno || r.a || r.text || r['опис'] || r.description || '';
      return { id: id, annotation: String(val).trim() };
    });
  }
  const { rows, delim } = parseTable(text);
  if (!rows.length) return [];
  // визначаємо рядок-заголовок
  const h0 = (rows[0][0] || '').trim().toLowerCase();
  const h1 = (rows[0][1] || '').trim().toLowerCase();
  const isHeader = ['sku', 'артикул', 'код', 'id', 'назва', 'name'].includes(h0)
    || ['annotation', 'анотація', 'опис', 'description', 'текст'].includes(h1);
  // id = 1-й стовпець; опис = усе після першого роздільника (склеюємо зайві колонки —
  // витривало до неквотованих ком усередині опису).
  return rows.slice(isHeader ? 1 : 0)
    .map(r => ({ id: (r[0] || '').trim(), annotation: r.slice(1).join(delim) }));
}

// Експорт товарів-кандидатів на (пере)опис у JSON — вхід для LLM.
// ?export=1&limit=N&mode=empty|short|weak&maxlen=250
//   empty — без опису; short — короткі «стуби» (1..maxlen); weak — порожні + короткі.
async function exportEmptyJson(db, url) {
  let limit = parseInt(url.searchParams.get('limit') || '50', 10);
  if (!(limit > 0)) limit = 50;
  limit = Math.min(limit, 500);
  let maxlen = parseInt(url.searchParams.get('maxlen') || '250', 10);
  if (!(maxlen > 0)) maxlen = 250;
  maxlen = Math.min(maxlen, 5000);
  const mode = url.searchParams.get('mode') || 'empty';
  const aln = `length(COALESCE(c.annotation,''))`;
  // maxlen — розпарсене ціле (без інʼєкції)
  const cond = mode === 'short' ? `${aln} > 0 AND ${aln} < ${maxlen}`
             : mode === 'weak'  ? `${aln} < ${maxlen}`
             : `(c.annotation IS NULL OR c.annotation='')`;
  // Фільтри каталогу: розділ (category) + підрозділ (brand) — як на фронті
  const cat = (url.searchParams.get('cat') || '').trim();
  const sub = (url.searchParams.get('sub') || '').trim();
  let extra = ''; const eb = [];
  if (cat) { extra += ' AND p.category=?'; eb.push(cat); }
  if (sub) { extra += ' AND p.brand=?'; eb.push(sub); }
  const where = `(${cond}) AND COALESCE(c.visible,1)=1${extra}`;
  const rows = (await db.prepare(
    `SELECT p.sku, COALESCE(NULLIF(c.display_name,''), p.name) AS name, p.category AS category, p.brand AS brand,
            COALESCE(c.active_ingredient,'') AS ai, COALESCE(c.dosage,'') AS dosage
       FROM products p LEFT JOIN product_content c ON c.pid=p.pid
      WHERE ${where} ORDER BY p.category, p.name LIMIT ?`).bind(...eb, limit).all()).results || [];
  const tot = await db.prepare(
    `SELECT COUNT(*) n FROM products p LEFT JOIN product_content c ON c.pid=p.pid WHERE ${where}`).bind(...eb).first();
  const items = rows.map(r => {
    const o = { sku: r.sku, name: r.name };
    if (r.category) o.category = r.category;
    if (r.brand) o.brand = r.brand;
    if (r.ai) o.active_ingredient = r.ai;
    if (r.dosage) o.dosage = r.dosage;
    return o;
  });
  return new Response(JSON.stringify(items, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="tovary-bez-opysu.json"',
      'x-total-remaining': String((tot && tot.n) | 0)
    }
  });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const db = context.env.DB;
  if (url.searchParams.get('export') === '1') return exportEmptyJson(db, url);
  // Розділи (category) + підрозділи (brand) для фільтрів експорту — дзеркалить каталог
  const escA = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const csRows = (await db.prepare(`SELECT p.category cat, COALESCE(p.brand,'') brand, COUNT(*) n
     FROM products p JOIN product_content c ON c.pid=p.pid WHERE p.category IS NOT NULL AND p.category<>''
     GROUP BY p.category, p.brand`).all()).results || [];
  const catMap = {}, subMap = {};
  for (const r of csRows) {
    catMap[r.cat] = (catMap[r.cat] || 0) + r.n;
    if (r.brand) (subMap[r.cat] = subMap[r.cat] || []).push([r.brand, r.n]);
  }
  const catOpts = Object.keys(catMap).sort((a, b) => a.localeCompare(b, 'uk'))
    .map(c => `<option value="${escA(c)}">${escA(c)} (${catMap[c]})</option>`).join('');
  const subMapJson = JSON.stringify(subMap).replace(/</g, '\\u003c');
  return new Response(`<!DOCTYPE html><html lang=uk><head><meta charset=UTF-8>
<meta name=viewport content="width=device-width, initial-scale=1.0"><meta name=robots content=noindex>
<title>Заливка анотацій</title><style>
body{font-family:system-ui;max-width:820px;margin:1.5rem auto;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2{color:#2d6a2d} .btn{background:#2d6a2d;color:#fff;border:0;padding:10px 16px;border-radius:8px;cursor:pointer;font-weight:700}
.btn:disabled{background:#aaa;cursor:not-allowed} textarea{width:100%;box-sizing:border-box;min-height:160px;border:2px solid #c8e0c8;border-radius:10px;padding:10px;font-family:ui-monospace,monospace;font-size:.85rem}
pre{background:#fff;padding:12px;border-radius:8px;white-space:pre-wrap;border:1px solid #eee}
.muted{color:#888;font-size:.85rem} code{background:#eef5ee;padding:1px 5px;border-radius:4px}
label.ck{display:inline-flex;align-items:center;gap:6px;font-size:.9rem;margin:6px 0}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body>
<div><a href="/admin">← до адмінки</a></div>
<h2>✍️ Масова заливка анотацій</h2>
<p class=muted>Заповнює описи товарів пакетом. Матч по <b>SKU</b> (точно), якщо не знайдено — по точній назві.
Чіпає лише опис; ціни/наявність/фото не змінюються.</p>
<p class=muted>Формат — на вибір (визначається автоматично):</p>
<ul class=muted style="margin-top:0">
  <li><b>CSV/TSV</b> з Excel/Таблиць: 1-й стовпець — SKU (або назва), 2-й — опис. Багаторядкові описи — в лапках. Роздільник <code>,</code> <code>;</code> або таб.</li>
  <li><b>JSON</b>: <code>[{"sku":"00-123","annotation":"текст…"}]</code></li>
</ul>
<div style="background:#fff;border:1px solid #e0e8e0;border-radius:10px;padding:12px;margin:12px 0">
  <b>Крок 1 · Експорт товарів на (пере)опис</b><br>
  <span class=muted>Віддає JSON-список товарів — готовий вхід для LLM. Наступний експорт дає наступну порцію (оновлені зникають). «Короткі стуби» — це слабкі описи коротші за N символів.</span><br>
  <label class=muted style="display:inline-block;margin:8px 8px 0 0">які:
    <select id=exmode style="padding:5px;border:1px solid #c8e0c8;border-radius:6px">
      <option value=empty>без опису</option>
      <option value=short>короткі «стуби» (&lt; N)</option>
      <option value=weak>порожні + короткі</option>
    </select></label>
  <label class=muted style="display:inline-block;margin:8px 8px 0 0">N&nbsp;симв: <input type=number id=exmax value=250 min=20 max=5000 style="width:78px;padding:5px;border:1px solid #c8e0c8;border-radius:6px"></label>
  <label class=muted style="display:inline-block;margin:8px 8px 0 0">за раз: <input type=number id=exn value=50 min=1 max=500 style="width:72px;padding:5px;border:1px solid #c8e0c8;border-radius:6px"></label>
  <br><label class=muted style="display:inline-block;margin:8px 8px 0 0">📂 розділ:
    <select id=excat onchange="exSubFill()" style="padding:5px;border:1px solid #c8e0c8;border-radius:6px"><option value="">усі розділи</option>${catOpts}</select></label>
  <label class=muted style="display:inline-block;margin:8px 8px 0 0">підрозділ:
    <select id=exsub style="padding:5px;border:1px solid #c8e0c8;border-radius:6px"><option value="">усі</option></select></label>
  <br><button class=btn onclick="exportEmpty()" style="background:#555;margin-top:8px">⬇️ Експорт</button>
  <div id=exs class=muted style="margin-top:6px"></div>
</div>
<details style="margin:10px 0;border:1px solid #e0e8e0;border-radius:10px;background:#fff;padding:8px 12px">
  <summary style="cursor:pointer;font-weight:700">Крок 2 · 📋 Промпт для LLM (розгорнути / скопіювати)</summary>
  <p class=muted style="margin:8px 0 4px">Встав цей промпт у ChatGPT / Claude / Gemini, а в кінець — вміст файлу з Кроку 1. Відповідь LLM (JSON) встав у поле Кроку 3.</p>
  <button class=btn onclick="copyPrompt()" style="background:#555;padding:6px 12px">📋 Копіювати промпт</button> <span id=cps class=muted></span>
  <textarea id=prompt readonly style="min-height:240px;margin-top:8px;background:#fafafa">Ти — копірайтер інтернет-магазину агротоварів «Агроном» (м. Володимир, Україна).
Напиши товарні описи (анотації) для списку товарів у кінці.

ФОРМАТ ВІДПОВІДІ — лише валідний JSON-масив, без markdown і пояснень.
Кожен елемент: {"sku":"…точно як у вході…","annotation":"…твій опис…"}

ПРАВИЛА:
- Мова: українська. Лише звичайний текст — БЕЗ HTML, markdown, емодзі, списків.
- Довжина: 300–500 символів (2–4 речення). Перші ~150 символів — суть + назва товару (йдуть у meta-опис Google).
- Зміст: що це, для чого, ключова користь; природно вплети назву й категорію (SEO), без «води» й порожніх обіцянок.
- ФАКТИ: спирайся ЛИШЕ на назву та надані поля. НЕ вигадуй дозувань, концентрацій, діючих речовин, норм витрати — для агрохімії хибна цифра шкідлива. Нема точних даних — пиши користь без чисел.
- sku не змінюй і не вигадуй. Один товар = один об'єкт у масиві. За раз обробляй до 30–50 товарів.

СПИСОК ТОВАРІВ (JSON) — встав нижче вміст файлу tovary-bez-opysu.json:
</textarea>
</details>
<p style="margin:12px 0 4px"><b>Крок 3 · Встав відповідь LLM</b> <span class=muted>(або обери файл)</span></p>
<label class=btn style="background:#555;cursor:pointer;display:inline-block">📂 Файл (.csv/.tsv/.json/.txt)<input type=file id=f accept=".csv,.tsv,.json,.txt,text/csv" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0"></label>
<span id=fn class=muted style="margin-left:8px">або вставте нижче ↓</span>
<p><textarea id=ta placeholder="00-12345,Опис товару одним рядком&#10;00-22222,&quot;Опис, що містить кому&#10;і перенос рядка&quot;"></textarea></p>
<div style="margin:6px 0"><b>Якщо опис уже є в базі:</b>
  <select id=cpolicy style="padding:5px;border:1px solid #c8e0c8;border-radius:6px">
    <option value=weak>перезаписати лише слабкі (короткі &lt; N) — добрі лишити</option>
    <option value=all>перезаписати всі наявні</option>
    <option value=empty>не чіпати наявні (залити лише порожні)</option>
  </select>
  <span class=muted>N&nbsp;симв: <input type=number id=cmax value=200 min=20 max=5000 style="width:64px;padding:4px;border:1px solid #c8e0c8;border-radius:6px"></span>
  <div class=muted>У перегляді (Крок 4) кожен наявний опис видно «було→стане»; галочкою «🔒 лишити» можна вберегти конкретний.</div>
</div>
<p><b>Крок 4 ·</b> <button class=btn id=chk onclick="verify()">Перевірити</button>
   <button class=btn id=imp onclick="run()" disabled>Залити</button>
   <span id=s></span></p>
<div id=o style="background:#fff;padding:12px;border-radius:8px;border:1px solid #eee">Вставте дані або оберіть файл.</div>
<script>
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
$('f').onchange=async e=>{const file=e.target.files[0]; if(!file)return; $('fn').textContent=file.name;
  $('ta').value=await file.text(); $('imp').disabled=true;};
$('ta').oninput=()=>{$('imp').disabled=true;};
function body(){return $('ta').value;}
function collectKeep(){
  // sku конфліктних рядків, де відмічено «🔒 лишити наявний»
  return Array.from(document.querySelectorAll('.keepck:checked')).map(function(c){return c.getAttribute('data-sku');}).filter(Boolean);
}
async function post(dry){
  var pol=$('cpolicy')?$('cpolicy').value:'all';
  var cm=$('cmax')?($('cmax').value||'200'):'200';
  var ex=dry?'':collectKeep().join(',');   // ручні винятки беремо з прев'ю при заливці
  const u='/admin/anno?'+(dry?'dryrun=1&':'')+'policy='+pol+'&cmax='+encodeURIComponent(cm)+(ex?'&exclude='+encodeURIComponent(ex):'');
  const r=await fetch(u,{method:'POST',headers:{'content-type':'text/plain'},body:body()});
  return {ok:r.ok, data:await r.json().catch(()=>({ok:false,error:'не JSON (HTTP '+r.status+')'}))};
}
function sect(title,obj,fmt){
  if(!obj||!obj.total) return '';
  const rows=(obj.sample||[]).map(fmt).join('');
  const more=obj.total>(obj.sample||[]).length?'<div class=muted>…ще '+(obj.total-obj.sample.length)+'</div>':'';
  return '<details'+(obj.total<=12?' open':'')+' style="margin:6px 0;border:1px solid #eee;border-radius:8px;background:#fff;padding:6px 10px">'
    +'<summary style="cursor:pointer;font-weight:700">'+title+': '+obj.total+'</summary>'
    +'<div style="margin:6px 0 4px;font-size:.86rem;line-height:1.5">'+rows+more+'</div></details>';
}
function render(d,dry){
  if(!d||!d.ok) return '<div style="color:#c0392b">❌ '+esc(d&&d.error||'помилка')+'</div>';
  let h='<div style="background:#eef5ee;padding:10px;border-radius:8px;margin-bottom:8px">'
    +'<b>'+(dry?'🔎 Перевірка':'✅ Залито')+'</b> — записів у файлі: '+d.total+'<br>'
    +'✅ '+(dry?'буде оновлено':'оновлено')+': <b>'+d.willUpdate+'</b>'
    +(d.overwrite?' <span class=muted>(з них перезапис наявних: '+d.overwrite+')</span>':'')+' &nbsp; '
    +(d.skipped?'🔒 лишено наявних: <b>'+d.skipped+'</b> &nbsp; ':'')
    +'❓ не знайдено: <b>'+d.unmatched+'</b> &nbsp; ⛔ без опису в рядку: <b>'+d.empty+'</b></div>'
    +(dry&&d.overwrite?'<div class=muted style="margin-bottom:6px">Конфлікти нижче можна вберегти індивідуально галочкою «🔒 лишити».</div>':'');
  h+=sect('✅ Оновлення (поточний опис → новий)',d.matched,function(x){
    var badge = !x.had ? '<span style="color:#2d6a2d">новий</span>'
      : (x.weak ? '<span style="color:#c0392b">🔁 перезапис слабкого ('+x.curLen+' симв)</span>'
                : '<span style="color:#b8860b">перезапис ДОБРОГО ('+x.curLen+' симв)</span>');
    var keep = (dry && x.had) ? ' <label style="margin-left:6px"><input type=checkbox class=keepck data-sku="'+esc(x.sku)+'"> 🔒 лишити наявний</label>' : '';
    var was = x.had ? '<div class=muted style="opacity:.75">було: '+esc(x.curPrev)+'…</div>' : '';
    return '<div style="margin-bottom:7px;border-bottom:1px solid #f2f2f2;padding-bottom:5px"><b>'+esc(x.sku)+'</b> · '+esc(x.n)+' — '+badge+keep+was
      +'<div>стане ('+x.newLen+'): '+esc(x.preview)+'</div></div>';
  });
  h+=sect('❓ Не знайдено (id у файлі → нема такого sku/назви)',d.unmatchedList,x=>'<div>'+esc(x)+'</div>');
  h+=sect('⚠️ Неоднозначні (id збігається з кількома товарами)',d.ambiguous,x=>'<div><b>'+esc(x.id)+'</b>: '+esc((x.names||[]).join('  |  '))+'</div>');
  h+=sect('🔒 Лишено наявні (не перезаписано)',d.skippedList,x=>'<div><b>'+esc(x.sku)+'</b> · '+esc(x.n)+' <span class=muted>('+(x.why||'')+', '+(x.curLen||0)+' симв)</span></div>');
  return h;
}
async function verify(){ if(!body().trim()){alert('Вставте дані або оберіть файл');return;}
  $('s').textContent='перевірка…'; const {ok,data}=await post(true); $('s').textContent='';
  $('o').innerHTML=render(data,true); $('imp').disabled=!(ok&&data.ok&&(data.willUpdate>0||data.overwrite>0));}
async function run(){ $('s').textContent='заливка…'; $('imp').disabled=true;
  const {ok,data}=await post(false); $('s').textContent=ok&&data.ok?'✅ Готово':'❌ Помилка';
  $('o').innerHTML=render(data,false);}
var EX_SUBS = ${subMapJson};   // розділ → [[підрозділ, к-сть], …]
function exSubFill(){
  var c=$('excat').value, sel=$('exsub'); sel.innerHTML='<option value="">усі</option>';
  (EX_SUBS[c]||[]).slice().sort(function(a,b){return a[0].localeCompare(b[0],'uk');}).forEach(function(b){
    var o=document.createElement('option'); o.value=b[0]; o.textContent=b[0]+' ('+b[1]+')'; sel.appendChild(o);
  });
}
async function exportEmpty(){
  var n=Math.max(1,Math.min(500,parseInt($('exn').value||'50',10)));
  var mode=$('exmode')?$('exmode').value:'empty';
  var mx=Math.max(20,Math.min(5000,parseInt($('exmax').value||'250',10)));
  var cat=$('excat')?$('excat').value:'', sub=$('exsub')?$('exsub').value:'';
  $('exs').textContent='готую…';
  var r=await fetch('/admin/anno?export=1&limit='+n+'&mode='+mode+'&maxlen='+mx
    +(cat?'&cat='+encodeURIComponent(cat):'')+(sub?'&sub='+encodeURIComponent(sub):''));
  if(!r.ok){$('exs').textContent='помилка '+r.status;return;}
  var remaining=r.headers.get('x-total-remaining')||'?';
  var txt=await r.text(); var cnt=0; try{cnt=JSON.parse(txt).length;}catch(e){}
  if(!cnt){$('exs').textContent='🎉 більше нема кандидатів (усього за фільтром: '+remaining+')';return;}
  var blob=new Blob([txt],{type:'application/json'});
  var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='tovary-bez-opysu.json';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  $('exs').textContent='⬇️ завантажено '+cnt+' товарів (усього без опису: '+remaining+'). Згенеруй у LLM → встав у Крок 3 → «Перевірити».';
}
function copyPrompt(){
  var t=$('prompt'); t.focus(); t.select();
  function done(){$('cps').textContent='скопійовано ✓';}
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t.value).then(done,function(){try{document.execCommand('copy');done();}catch(e){}});}
  else {try{document.execCommand('copy');done();}catch(e){}}
}
</script></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  const u = new URL(context.request.url);
  const dry = u.searchParams.get('dryrun') === '1';
  // політика конфлікту «опис уже є»: all=перезаписати всі, empty=лишити наявні, weak=перезаписати лише короткі (<cmax)
  const policy = u.searchParams.get('policy') || 'all';
  let cmax = parseInt(u.searchParams.get('cmax') || '200', 10);
  if (!(cmax > 0)) cmax = 200;
  // ручні винятки — sku, які лишити як є (галочки в прев'ю)
  const exclude = new Set((u.searchParams.get('exclude') || '').split(',').map(s => s.trim()).filter(Boolean));
  const MAXLEN = 20000;

  let recs;
  try {
    let raw = await context.request.text();
    // strip markdown code fences від LLM
    raw = raw.replace(/^```[\w]*[\r\n]+/m, '').replace(/[\r\n]+```\s*$/m, '').trim();
    recs = parseRecords(raw);
  }
  catch (e) { return json({ ok: false, error: 'Не вдалося розпарсити: ' + e.message }, 400); }
  if (!Array.isArray(recs) || !recs.length) return json({ ok: false, error: 'Порожньо або невідомий формат' }, 400);

  // індекси товарів: sku → [pid], назва/display_name → [pid]; стан опису
  const ex = (await db.prepare(
    `SELECT p.pid, p.sku, p.name, COALESCE(c.display_name,'') dn,
            CASE WHEN c.pid IS NULL THEN NULL ELSE COALESCE(c.annotation,'') END anno
       FROM products p LEFT JOIN product_content c ON c.pid=p.pid`).all()).results || [];
  const bySku = new Map(), byName = new Map(), info = new Map();
  const nkey = function(s) { return String(s || '').trim().toLowerCase(); };
  for (const r of ex) {
    info.set(r.pid, r);
    if (r.sku) (bySku.get(r.sku.trim()) || bySku.set(r.sku.trim(), []).get(r.sku.trim())).push(r.pid);
    for (const nm of [r.name, r.dn]) { const k = nkey(nm); if (k) (byName.get(k) || byName.set(k, []).get(k)).push(r.pid); }
  }

  // UPSERT: якщо картки контенту нема (рідко) — створює рядок зі slug=NULL; інакше оновлює лише опис
  const Up = db.prepare(`INSERT INTO product_content(pid, annotation) VALUES(?, ?)
                         ON CONFLICT(pid) DO UPDATE SET annotation=excluded.annotation`);
  const stmts = [], matched = [], unmatchedList = [], ambiguous = [], skippedList = [];
  let willUpdate = 0, overwrite = 0, skipped = 0, unmatched = 0, empty = 0;
  const seenPid = new Set();

  for (const rec of recs) {
    const id = (rec.id || '').trim();
    const ann = String(rec.annotation == null ? '' : rec.annotation).trim().slice(0, MAXLEN);
    if (!ann) { empty++; continue; }
    if (!id) { unmatched++; unmatchedList.push('(порожній id)'); continue; }

    // матч: sku точно → інакше точна назва
    let pids = bySku.get(id);
    if (!pids) pids = byName.get(nkey(id));
    if (!pids || !pids.length) { unmatched++; if (unmatchedList.length < 200) unmatchedList.push(id); continue; }
    if (pids.length > 1) { ambiguous.push({ id, names: pids.map(p => (info.get(p) || {}).name) }); continue; }

    const pid = pids[0];
    if (seenPid.has(pid)) continue;   // дубль у файлі — беремо першу згадку
    seenPid.add(pid);
    const cur = info.get(pid) || {};
    const had = cur.anno != null && cur.anno !== '';
    const curLen = (cur.anno || '').length;

    // конфлікт «опис уже є»: bulk-політика + ручний виняток (exclude) по sku
    if (had) {
      const manualKeep = exclude.has(String(cur.sku || ''));
      const policyKeep = policy === 'empty' ? true
                       : policy === 'weak'  ? (curLen >= cmax)   // добрі (довгі) лишаємо, слабкі перезаписуємо
                       : false;                                  // 'all' → перезаписуємо
      if (manualKeep || policyKeep) {
        skipped++;
        if (skippedList.length < 100) skippedList.push({ sku: cur.sku, n: cur.name, curLen, why: manualKeep ? 'вручну' : (policy === 'empty' ? 'політика' : 'добрий') });
        continue;
      }
      overwrite++;
    }
    willUpdate++;
    if (matched.length < 80) matched.push({
      sku: cur.sku || '—', n: cur.name || (cur.dn || ''), had,
      curLen, weak: had && curLen < cmax,                 // короткий наявний → варто перезаписати
      curPrev: had ? (cur.anno || '').replace(/\s+/g, ' ').slice(0, 70) : '',
      preview: ann.replace(/\s+/g, ' ').slice(0, 90) + (ann.length > 90 ? '…' : ''),
      newLen: ann.length
    });
    if (!dry) stmts.push(Up.bind(pid, ann));
  }

  const cap = (a, n) => ({ total: a.length, sample: a.slice(0, n) });
  const payload = {
    ok: true, dryrun: dry, total: recs.length,
    willUpdate, overwrite, skipped, unmatched, empty,
    matched: cap(matched, 50),
    unmatchedList: cap(unmatchedList, 30),
    ambiguous: cap(ambiguous, 30),
    skippedList: cap(skippedList, 30),
  };
  if (dry) return json(payload);

  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  return json(payload);
}
