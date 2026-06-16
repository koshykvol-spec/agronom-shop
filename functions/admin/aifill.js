// /admin/aifill — масове заповнення Дозування та Діючих речовин для агрохімікатів.
// GET  — сторінка з формою + промптом + вибором поля
// GET  ?export=1&field=dosage|ai — JSON-список кандидатів
// POST ?field=dosage|ai&dryrun=1 — перевірка / заливка

import { allIngredients, replaceProductIngredients } from './_ingredients.js';

const json = (o, s = 200) => new Response(JSON.stringify(o, null, 2), {
  status: s, headers: { 'content-type': 'application/json; charset=utf-8' }
});

const AGRO_CAT = 'АГРОХІМІКАТИ'; // категорія (p.category)

// ── Парсер CSV/TSV (такий самий як в anno.js) ───────────────────────────────
function parseTable(text) {
  text = text.replace(/^\uFEFF/, '');
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
    else if (ch === '\r') { /* skip */ }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return { rows, delim };
}

function parseRecords(text, field) {
  const t = text.trim();
  if (t[0] === '[' || t[0] === '{') {
    let arr = JSON.parse(t);
    if (!Array.isArray(arr)) arr = [arr];
    return arr.map(r => ({
      id: String(r.sku ?? r.id ?? r.n ?? r.name ?? '').trim(),
      value: String(field === 'dosage'
        ? (r.dosage ?? r.дозування ?? r.d ?? '')
        : (r.active_ingredient ?? r.ai ?? r.діюча ?? r.ingredient ?? r.ingredients ?? '')
      ).trim()
    }));
  }
  const { rows, delim } = parseTable(text);
  if (!rows.length) return [];
  const h0 = (rows[0][0] || '').trim().toLowerCase();
  const isHeader = ['sku', 'артикул', 'код', 'id', 'назва', 'name'].includes(h0);
  return rows.slice(isHeader ? 1 : 0)
    .map(r => ({ id: (r[0] || '').trim(), value: r.slice(1).join(delim).trim() }));
}

// ── Експорт кандидатів ───────────────────────────────────────────────────────
async function exportCandidates(db, url) {
  const field = url.searchParams.get('field') || 'dosage';
  let limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
  const sub = (url.searchParams.get('sub') || '').trim();

  const cond = field === 'dosage'
    ? `(c.dosage IS NULL OR c.dosage = '')`
    : `(c.active_ingredient IS NULL OR c.active_ingredient = '')`;

  let extra = `AND p.category = '${AGRO_CAT}'`;
  const eb = [];
  if (sub) { extra += ' AND p.brand = ?'; eb.push(sub); }

  const rows = (await db.prepare(
    `SELECT p.sku, COALESCE(NULLIF(c.display_name,''), p.name) AS name,
            p.brand AS brand,
            COALESCE(c.active_ingredient,'') AS ai,
            COALESCE(c.dosage,'') AS dosage
       FROM products p LEFT JOIN product_content c ON c.pid = p.pid
      WHERE ${cond} ${extra}
      ORDER BY p.brand, p.name LIMIT ?`
  ).bind(...eb, limit).all()).results || [];

  const tot = (await db.prepare(
    `SELECT COUNT(*) n FROM products p LEFT JOIN product_content c ON c.pid = p.pid
      WHERE ${cond} ${extra}`
  ).bind(...eb).first());

  const items = rows.map(r => {
    const o = { sku: r.sku, name: r.name };
    if (r.brand) o.brand = r.brand;
    if (field === 'dosage' && r.ai) o.active_ingredient = r.ai;
    if (field === 'ai'    && r.dosage) o.dosage = r.dosage;
    return o;
  });

  const fname = field === 'dosage' ? 'dozuvannia.json' : 'diiuchi-rechovyny.json';
  return new Response(JSON.stringify(items, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${fname}"`,
      'x-total-remaining': String((tot && tot.n) | 0)
    }
  });
}

// ── GET: сторінка ────────────────────────────────────────────────────────────
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const db = context.env.DB;
  if (url.searchParams.get('export') === '1') return exportCandidates(db, url);

  const escA = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Підрозділи агрохімікатів
  const subRows = (await db.prepare(
    `SELECT COALESCE(p.brand,'') brand, COUNT(*) n
       FROM products p JOIN product_content c ON c.pid=p.pid
      WHERE p.category=? AND p.brand IS NOT NULL AND p.brand<>''
      GROUP BY p.brand ORDER BY p.brand`
  ).bind(AGRO_CAT).all()).results || [];
  const subOpts = subRows.map(r => `<option value="${escA(r.brand)}">${escA(r.brand)} (${r.n})</option>`).join('');

  const promptDosage = `Ти — агроном-консультант магазину агротоварів «Агроном» (Україна).
Напиши поле «Дозування» для кожного агрохімікату зі списку.

ФОРМАТ ВІДПОВІДІ — лише валідний JSON-масив, без markdown і пояснень.
Кожен елемент: {"sku":"…точно як у вході…","dosage":"…текст дозування…"}

ПРАВИЛА:
- Мова: українська. Лише звичайний текст — БЕЗ HTML, markdown, емодзі.
- Довжина: 1–3 речення / рядки. Формат «X мл/г на Y л води» або «X л/га, Y л води/га».
- Якщо препарат системний або комплексний — вкажи для яких культур і шкідників/хвороб типові норми.
- НЕ вигадуй: якщо точних даних нема — напиши «уточнюйте у консультанта».
- sku не змінюй. Один товар = один об'єкт.

СПИСОК ТОВАРІВ (JSON) — встав нижче:`;

  const promptAI = `Ти — агроном-консультант магазину агротоварів «Агроном» (Україна).
Визнач діючі речовини для кожного агрохімікату зі списку.

ФОРМАТ ВІДПОВІДІ — лише валідний JSON-масив, без markdown і пояснень.
Кожен елемент: {"sku":"…точно як у вході…","active_ingredient":"…діюча речовина…"}

ПРАВИЛА:
- Мова: українська. Лише назва діючої речовини (або кілька через « + »).
- Формат: «гліфосат» або «імідаклоприд + лямбда-цигалотрин» (все малими літерами).
- НЕ вигадуй: якщо невідомо — залиш порожнім рядком "".
- sku не змінюй. Один товар = один об'єкт.

СПИСОК ТОВАРІВ (JSON) — встав нижче:`;

  return new Response(`<!DOCTYPE html><html lang=uk><head><meta charset=UTF-8>
<meta name=viewport content="width=device-width,initial-scale=1.0"><meta name=robots content=noindex>
<title>Масове заповнення — AI Fill</title><style>
body{font-family:system-ui;max-width:860px;margin:1.5rem auto;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2{color:#2d6a2d}
.btn{background:#2d6a2d;color:#fff;border:0;padding:9px 16px;border-radius:8px;cursor:pointer;font-weight:700;font-size:.9rem}
.btn:disabled{background:#aaa;cursor:not-allowed}
.btn-gray{background:#555}
textarea{width:100%;box-sizing:border-box;min-height:140px;border:2px solid #c8e0c8;border-radius:10px;padding:10px;font-family:ui-monospace,monospace;font-size:.83rem}
pre{background:#fff;padding:12px;border-radius:8px;white-space:pre-wrap;border:1px solid #eee}
.muted{color:#888;font-size:.85rem} code{background:#eef5ee;padding:1px 5px;border-radius:4px}
.box{background:#fff;border:1px solid #e0e8e0;border-radius:10px;padding:12px 16px;margin:12px 0}
.tabs{display:flex;gap:6px;margin-bottom:16px}
.tab-btn{padding:9px 20px;border-radius:10px;border:2px solid #c8e0c8;background:#fff;color:#2d6a2d;font-weight:700;cursor:pointer;font-size:.95rem}
.tab-btn.active{background:#2d6a2d;color:#fff;border-color:#2d6a2d}
.tab-panel{display:none} .tab-panel.active{display:block}
select{padding:5px 8px;border:1px solid #c8e0c8;border-radius:6px}
input[type=number]{padding:5px;border:1px solid #c8e0c8;border-radius:6px}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body>
<div><a href="/admin">← до адмінки</a></div>
<h2>🧪 Масове заповнення: Дозування і Діючі речовини</h2>
<p class=muted>Тільки категорія <b>АГРОХІМІКАТИ</b>. Матч по SKU (точно), відкат — точна назва.</p>

<div class=tabs>
  <button class="tab-btn active" onclick="switchTab('dosage')">💧 Дозування</button>
  <button class="tab-btn" onclick="switchTab('ai')">🧬 Діючі речовини</button>
</div>

<!-- ── Панель Дозування ── -->
<div id="panel-dosage" class="tab-panel active">
  <div class=box>
    <b>Крок 1 · Експорт товарів без дозування</b><br>
    <span class=muted>Завантажить JSON-список агрохімікатів, де дозування відсутнє — готово для LLM.</span><br>
    <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
      <label class=muted>підрозділ: <select id="d-sub"><option value="">всі</option>${subOpts}</select></label>
      <label class=muted>за раз: <input type=number id="d-n" value=50 min=1 max=500 style="width:70px"></label>
      <button class="btn btn-gray" onclick="doExport('dosage')">⬇️ Експорт</button>
      <span id="d-exs" class=muted></span>
    </div>
  </div>

  <details class=box>
    <summary style="cursor:pointer;font-weight:700">Крок 2 · 📋 Промпт для LLM</summary>
    <button class="btn btn-gray" style="margin:8px 0" onclick="copyPrompt('dosage')">📋 Копіювати</button>
    <span id="d-cps" class=muted></span>
    <textarea id="prompt-dosage" readonly style="min-height:200px;margin-top:6px;background:#fafafa">${promptDosage}</textarea>
  </details>

  <p style="margin:10px 0 4px"><b>Крок 3 · Вставте відповідь LLM</b> <span class=muted>(або файл)</span></p>
  <label class="btn btn-gray" style="cursor:pointer;display:inline-block">📂 Файл<input type=file id="d-file" accept=".csv,.tsv,.json,.txt" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0"></label>
  <span id="d-fn" class=muted style="margin-left:8px">або вставте нижче ↓</span>
  <textarea id="d-ta" style="margin-top:6px" placeholder='[{"sku":"00-123","dosage":"5 мл на 10 л води"}]'></textarea>

  <div style="margin:6px 0">
    <b>Якщо дозування вже є:</b>
    <select id="d-policy"><option value=empty>не чіпати наявні</option><option value=all>перезаписати всі</option></select>
  </div>

  <p><b>Крок 4 ·</b>
    <button class=btn onclick="verify('dosage')">Перевірити</button>
    <button class=btn id="d-imp" disabled onclick="run('dosage')">Залити</button>
    <span id="d-s"></span>
  </p>
  <div id="d-out" class=box>Вставте дані або оберіть файл.</div>
</div>

<!-- ── Панель Діючі речовини ── -->
<div id="panel-ai" class="tab-panel">
  <div class=box>
    <b>Крок 1 · Експорт товарів без діючої речовини</b><br>
    <span class=muted>Завантажить JSON агрохімікатів без заповненого поля «Діюча речовина».</span><br>
    <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
      <label class=muted>підрозділ: <select id="ai-sub"><option value="">всі</option>${subOpts}</select></label>
      <label class=muted>за раз: <input type=number id="ai-n" value=50 min=1 max=500 style="width:70px"></label>
      <button class="btn btn-gray" onclick="doExport('ai')">⬇️ Експорт</button>
      <span id="ai-exs" class=muted></span>
    </div>
  </div>

  <details class=box>
    <summary style="cursor:pointer;font-weight:700">Крок 2 · 📋 Промпт для LLM</summary>
    <button class="btn btn-gray" style="margin:8px 0" onclick="copyPrompt('ai')">📋 Копіювати</button>
    <span id="ai-cps" class=muted></span>
    <textarea id="prompt-ai" readonly style="min-height:200px;margin-top:6px;background:#fafafa">${promptAI}</textarea>
  </details>

  <p style="margin:10px 0 4px"><b>Крок 3 · Вставте відповідь LLM</b> <span class=muted>(або файл)</span></p>
  <label class="btn btn-gray" style="cursor:pointer;display:inline-block">📂 Файл<input type=file id="ai-file" accept=".csv,.tsv,.json,.txt" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0"></label>
  <span id="ai-fn" class=muted style="margin-left:8px">або вставте нижче ↓</span>
  <textarea id="ai-ta" style="margin-top:6px" placeholder='[{"sku":"00-123","active_ingredient":"гліфосат"}]'></textarea>
  <p class=muted>⚠️ Діючі речовини вносяться як <b>текст</b> безпосередньо в поле; довідник не оновлюється. Для повного зв'язку — використайте форму товару.</p>

  <div style="margin:6px 0">
    <b>Якщо діюча речовина вже є:</b>
    <select id="ai-policy"><option value=empty>не чіпати наявні</option><option value=all>перезаписати всі</option></select>
  </div>

  <p><b>Крок 4 ·</b>
    <button class=btn onclick="verify('ai')">Перевірити</button>
    <button class=btn id="ai-imp" disabled onclick="run('ai')">Залити</button>
    <span id="ai-s"></span>
  </p>
  <div id="ai-out" class=box>Вставте дані або оберіть файл.</div>
</div>

<script>
const $ = id => document.getElementById(id);

function switchTab(t) {
  ['dosage','ai'].forEach(function(n) {
    $('panel-'+n).classList.toggle('active', n===t);
    document.querySelectorAll('.tab-btn').forEach(function(b,i) { b.classList.toggle('active', ['dosage','ai'][i]===t); });
  });
}

['d-file','ai-file'].forEach(function(id) {
  var pfx = id === 'd-file' ? 'd' : 'ai';
  $(id).onchange = async function(e) {
    var file = e.target.files[0]; if(!file) return;
    $(pfx+'-fn').textContent = file.name;
    $(pfx+'-ta').value = await file.text();
    $(pfx+'-imp').disabled = true;
  };
});
$('d-ta').oninput  = function(){ $('d-imp').disabled=true; };
$('ai-ta').oninput = function(){ $('ai-imp').disabled=true; };

async function doExport(field) {
  var pfx = field==='dosage' ? 'd' : 'ai';
  var n   = Math.max(1,Math.min(500,parseInt($(pfx+'-n').value||'50',10)));
  var sub = $(pfx+'-sub') ? $(pfx+'-sub').value : '';
  $(pfx+'-exs').textContent = 'готую…';
  var r = await fetch('/admin/aifill?export=1&field='+field+'&limit='+n+(sub?'&sub='+encodeURIComponent(sub):''));
  if(!r.ok){ $(pfx+'-exs').textContent='помилка '+r.status; return; }
  var remaining = r.headers.get('x-total-remaining')||'?';
  var txt = await r.text(); var cnt=0;
  try{ cnt=JSON.parse(txt).length; }catch(e){}
  if(!cnt){ $(pfx+'-exs').textContent='🎉 більше нема кандидатів (усього: '+remaining+')'; return; }
  var blob=new Blob([txt],{type:'application/json'});
  var a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=(field==='dosage'?'dozuvannia':'diiuchi-rechovyny')+'.json';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  $(pfx+'-exs').textContent='⬇️ завантажено '+cnt+' (усього без поля: '+remaining+').';
}

function copyPrompt(field) {
  var pfx = field==='dosage' ? 'd' : 'ai';
  var t = $('prompt-'+field); t.focus(); t.select();
  function done(){ $(pfx+'-cps').textContent='скопійовано ✓'; }
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(t.value).then(done,function(){ try{document.execCommand('copy');done();}catch(e){} });
  } else { try{document.execCommand('copy');done();}catch(e){} }
}

const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function renderResult(d, dry) {
  if(!d||!d.ok) return '<div style="color:#c0392b">❌ '+esc(d&&d.error||'помилка')+'</div>';
  var h = '<div style="background:#eef5ee;padding:10px;border-radius:8px;margin-bottom:8px">'
    +'<b>'+(dry?'🔎 Перевірка':'✅ Залито')+'</b> — записів: '+d.total+'<br>'
    +'✅ '+(dry?'буде оновлено':'оновлено')+': <b>'+d.willUpdate+'</b> &nbsp; '
    +'🔒 лишено: <b>'+d.skipped+'</b> &nbsp; '
    +'❓ не знайдено: <b>'+d.unmatched+'</b></div>';

  if(d.matched&&d.matched.total){
    var rows=(d.matched.sample||[]).map(function(x){
      return '<div style="margin-bottom:5px;border-bottom:1px solid #f2f2f2;padding-bottom:4px">'
        +'<b>'+esc(x.sku)+'</b> · '+esc(x.n)
        +(x.had?'<div class=muted>було: '+esc(x.curPrev)+'</div>':'')
        +'<div>стане: '+esc(x.preview)+'</div></div>';
    }).join('');
    var more=d.matched.total>(d.matched.sample||[]).length?'<div class=muted>…ще '+(d.matched.total-d.matched.sample.length)+'</div>':'';
    h+='<details'+(d.matched.total<=10?' open':'')+' style="border:1px solid #eee;border-radius:8px;background:#fff;padding:6px 10px;margin:6px 0">'
      +'<summary style="cursor:pointer;font-weight:700">✅ Оновлення: '+d.matched.total+'</summary>'
      +'<div style="margin:6px 0;font-size:.86rem">'+rows+more+'</div></details>';
  }
  if(d.unmatchedList&&d.unmatchedList.total){
    h+='<details style="border:1px solid #eee;border-radius:8px;background:#fff;padding:6px 10px;margin:6px 0">'
      +'<summary style="cursor:pointer;font-weight:700">❓ Не знайдено: '+d.unmatchedList.total+'</summary>'
      +'<div style="font-size:.86rem">'+(d.unmatchedList.sample||[]).map(function(x){return '<div>'+esc(x)+'</div>';}).join('')+'</div></details>';
  }
  return h;
}

async function verify(field) {
  var pfx=field==='dosage'?'d':'ai';
  var body=$(pfx+'-ta').value;
  if(!body.trim()){alert('Вставте дані або оберіть файл');return;}
  $(pfx+'-s').textContent='перевірка…';
  var policy=$(pfx+'-policy').value;
  var r=await fetch('/admin/aifill?field='+field+'&dryrun=1&policy='+policy,{method:'POST',headers:{'content-type':'text/plain'},body:body});
  var d=await r.json().catch(function(){return{ok:false,error:'не JSON ('+r.status+')'};});
  $(pfx+'-s').textContent='';
  $(pfx+'-out').innerHTML=renderResult(d,true);
  $(pfx+'-imp').disabled=!(r.ok&&d.ok&&d.willUpdate>0);
}

async function run(field) {
  var pfx=field==='dosage'?'d':'ai';
  $(pfx+'-s').textContent='заливка…'; $(pfx+'-imp').disabled=true;
  var policy=$(pfx+'-policy').value;
  var body=$(pfx+'-ta').value;
  var r=await fetch('/admin/aifill?field='+field+'&policy='+policy,{method:'POST',headers:{'content-type':'text/plain'},body:body});
  var d=await r.json().catch(function(){return{ok:false,error:'не JSON ('+r.status+')'};});
  $(pfx+'-s').textContent=r.ok&&d.ok?'✅ Готово':'❌ Помилка';
  $(pfx+'-out').innerHTML=renderResult(d,false);
}
</script></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

// ── POST: заливка ────────────────────────────────────────────────────────────
export async function onRequestPost(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const field = url.searchParams.get('field') || 'dosage'; // 'dosage' | 'ai'
  const dry = url.searchParams.get('dryrun') === '1';
  const policy = url.searchParams.get('policy') || 'empty'; // 'empty' | 'all'
  const MAXLEN = 1000;

  let recs;
  try { recs = parseRecords(await context.request.text(), field); }
  catch (e) { return json({ ok: false, error: 'Не вдалося розпарсити: ' + e.message }, 400); }
  if (!Array.isArray(recs) || !recs.length) return json({ ok: false, error: 'Порожньо або невідомий формат' }, 400);

  // Індекс товарів (тільки АГРОХІМІКАТИ)
  const ex = (await db.prepare(
    `SELECT p.pid, p.sku, p.name, COALESCE(c.display_name,'') dn,
            COALESCE(c.dosage,'') dosage,
            COALESCE(c.active_ingredient,'') ai
       FROM products p LEFT JOIN product_content c ON c.pid = p.pid
      WHERE p.category = ?`
  ).bind(AGRO_CAT).all()).results || [];

  const bySku = new Map(), byName = new Map(), info = new Map();
  const nkey = s => String(s || '').trim().toLowerCase();
  for (const r of ex) {
    info.set(r.pid, r);
    if (r.sku) (bySku.get(r.sku.trim()) || bySku.set(r.sku.trim(), []).get(r.sku.trim())).push(r.pid);
    for (const nm of [r.name, r.dn]) { const k = nkey(nm); if (k) (byName.get(k) || byName.set(k, []).get(k)).push(r.pid); }
  }

  const stmts = [], matched = [], unmatchedList = [];
  let willUpdate = 0, skipped = 0, unmatched = 0;
  const seenPid = new Set();

  for (const rec of recs) {
    const id = (rec.id || '').trim();
    const val = String(rec.value == null ? '' : rec.value).trim().slice(0, MAXLEN);
    if (!id) { unmatched++; unmatchedList.push('(порожній id)'); continue; }
    if (!val) continue;

    let pids = bySku.get(id);
    if (!pids) pids = byName.get(nkey(id));
    if (!pids || !pids.length) { unmatched++; if (unmatchedList.length < 100) unmatchedList.push(id); continue; }
    if (pids.length > 1) continue; // неоднозначно — пропускаємо

    const pid = pids[0];
    if (seenPid.has(pid)) continue;
    seenPid.add(pid);

    const cur = info.get(pid) || {};
    const curVal = field === 'dosage' ? cur.dosage : cur.ai;
    const had = curVal != null && curVal !== '';

    if (had && policy === 'empty') {
      skipped++;
      continue;
    }

    willUpdate++;
    if (matched.length < 60) matched.push({
      sku: cur.sku || '—', n: cur.name || cur.dn || '',
      had, curPrev: had ? curVal.slice(0, 60) : '',
      preview: val.slice(0, 80) + (val.length > 80 ? '…' : '')
    });

    if (!dry) {
      const col = field === 'dosage' ? 'dosage' : 'active_ingredient';
      stmts.push(db.prepare(`UPDATE product_content SET ${col}=? WHERE pid=?`).bind(val, pid));
    }
  }

  const cap = (a, n) => ({ total: a.length, sample: a.slice(0, n) });
  const payload = {
    ok: true, dryrun: dry,
    total: recs.length, willUpdate, skipped, unmatched,
    matched: cap(matched, 40),
    unmatchedList: cap(unmatchedList, 30),
  };
  if (dry) return json(payload);
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  return json(payload);
}
