// /admin/reviews-bulk — масова заливка відгуків (той самий підхід, що й /admin/anno):
// Крок 1: експорт товарів без відгуків у JSON.
// Крок 2: готовий промпт для LLM (ChatGPT/Claude/Gemini) — копіюєш вручну.
// Крок 3: вставляєш відповідь LLM (JSON-масив).
// Крок 4: перевірка (dry-run) → заливка в таблицю reviews (на модерації, approved=0).
// Жодних серверних викликів AI API — тому немає лімітів часу чи вичерпаних ключів.

const json = (o, s = 200) => new Response(JSON.stringify(o, null, 2), { status: s, headers: { 'content-type': 'application/json; charset=utf-8' } });

const FARMER_NAMES = [
  // Початковий список
  "Олена К.", "Іван Прокопчук", "Марія Дмитрівна", "Петро Коваль", "Наталія Василівна", 
  "Василь Шатковський", "Тетяна", "Андрій Бойко", "Сергій Миколайович", "Оксана В.", 
  "Микола Захарчук", "Ганна", "Дмитро Кравчук", "Світлана П.", "Віктор Олександрович", 
  "Юрій М.", "Людмила", "Олександр Т.", "Валентина Г.", "Михайло", "Надія К.",
  "Роман Пасічник", "Ольга В.", "Володимир С.", "Ніна Степанівна", "Павло Г.",
  "Галина Петрівна", "Степан Семенович", "Ярослав Ковальчук", "Катерина М.", "Iрина В.",
  "Анатолій Григорович", "Олег Бондар", "Марта С.", "Богдан Шевченко", "Оксана Іванівна",
  "Віталій П.", "Лариса Дмитрівна", "Євгенія К.", "Тарас Мельник", "Святослав",
  "Яна Олександрівна", "Валерій Іванович", "Алла Г.", "Зінаїда Василівна", "Iгор Т.",
  "Любов Миколаївна", "Григорій Степанович", "Софія К.", "Вадим Лисенко", "Дарина",
  "Віра Олексіївна", "Максим Ткаченко", "Юлія С.", "Ростислав М.", "Олена Іванівна",
  "Антон Поліщук", "Iнна В.", "Євген Павлович", "Наталя Скрипник", "Тамара",
  "Леонід Петрович", "Христина Б.", "Артем Ганжа", "Світлана Дмитрівна", "Денис К.",
  "Олеся В.", "Ярослава М.", "Роман Васильович", "Марія Федорівна", "Василь К.",
  "Вікторія П.", "Назар Шевчук", "Уляна Т.", "Олексій Сергійович", "Марина Коваль",
  // Розширення
  "Костянтин Мельниченко", "Руслан Гончар", "Лідія Петрівна", "Раїса Ткачук", "Клавдія В.",
  "Мирослава Демченко", "Богдана С.", "Соломія Іщенко", "Устина Панченко", "Зоряна М.",
  "Даниїл Романюк", "Владислав Г.", "Кирило Савчук", "Едуард Петрович", "Руслана В.",
  "Лілія Гриценко", "Федір Пилипенко", "Гнат Сидоренко", "Прокіп Марченко", "Северин Т.",
  "Матвій Кушнір", "Тимофій Тимощук", "Захар Пасько", "Остап Гнатюк", "Яків Заяць",
  "Панас Головко", "Данило Дяченко", "Всеволод С.", "Мирон Стельмах", "Марко Кобзар",
  "Тимур Литвиненко", "Ілля Гаврилюк", "Стефанія В.", "Злата Швець", "Аліна Довгань",
  "Діана Куценко", "Жанна Максименко", "Раїса Білоус", "Одарка Петрівна", "Стефан Юрченко",
  "Нестор Крамар", "Йосип Барабаш", "Гаврило Дудник", "Кузьма Козак", "Марʼяна Кушнірук",
  "Богдан Гринько", "Ілона Смаль", "Тарас Тесля", "Настя К.", "Іванна Богданівна",
  "Орест М.", "Яремій Т.", "Мар'ян С.", "Зореслава В.", "Любомир Захарович",
  "Веселина П.", "Юстина Г.", "Славко Р.", "Ганнуся Д.", "Северина М.",
  "Юхим Т.", "Пилип С.", "Домінік В.", "Ярина К.", "Богуслав П.",
  "Мілена Р.", "Северин Богданович", "Устим Г.", "Розалія М.", "Кароліна Т.",
  "Владлен С.", "Ілларіон П.", "Соломія Дмитрівна", "Юліан К.", "Оріана В.",
  "Северіан Т.", "Радослав М.", "Ярополк С.", "Всеслав Г.", "Пантелеймон Р."
];

// Експорт товарів без відгуків у JSON (вхід для LLM). ?export=1&limit=N
async function exportNoReviewsJson(db, url) {
  let limit = parseInt(url.searchParams.get('limit') || '30', 10);
  if (!(limit > 0)) limit = 30;
  limit = Math.min(limit, 200);

  const rows = (await db.prepare(
    `SELECT p.pid, COALESCE(NULLIF(c.display_name,''), p.name) AS name, p.category AS category, p.brand AS brand
       FROM products p LEFT JOIN product_content c ON c.pid = p.pid
      WHERE NOT EXISTS (SELECT 1 FROM reviews r WHERE r.pid = p.pid)
        AND COALESCE(c.visible,1) = 1
      ORDER BY p.pid LIMIT ?`
  ).bind(limit).all()).results || [];

  const tot = await db.prepare(
    `SELECT COUNT(*) n FROM products p LEFT JOIN product_content c ON c.pid = p.pid
      WHERE NOT EXISTS (SELECT 1 FROM reviews r WHERE r.pid = p.pid) AND COALESCE(c.visible,1) = 1`
  ).first();

  const items = rows.map(r => {
    const o = { pid: r.pid, name: r.name };
    if (r.category) o.category = r.category;
    if (r.brand) o.brand = r.brand;
    return o;
  });

  return new Response(JSON.stringify(items, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="tovary-bez-vidgukiv.json"',
      'x-total-remaining': String((tot && tot.n) | 0),
    },
  });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const db = context.env.DB;
  if (url.searchParams.get('export') === '1') return exportNoReviewsJson(db, url);

  const shuffled = FARMER_NAMES.slice().sort(() => Math.random() - 0.5);
  const namesForPrompt = shuffled.slice(0, 40).join(', ');

  return new Response(`<!DOCTYPE html><html lang=uk><head><meta charset=UTF-8>
<meta name=viewport content="width=device-width, initial-scale=1.0"><meta name=robots content=noindex>
<title>Заливка відгуків</title><style>
body{font-family:system-ui;max-width:820px;margin:1.5rem auto;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2{color:#2d6a2d} .btn{background:#2d6a2d;color:#fff;border:0;padding:10px 16px;border-radius:8px;cursor:pointer;font-weight:700}
.btn:disabled{background:#aaa;cursor:not-allowed} textarea{width:100%;box-sizing:border-box;min-height:160px;border:2px solid #c8e0c8;border-radius:10px;padding:10px;font-family:ui-monospace,monospace;font-size:.85rem}
pre{background:#fff;padding:12px;border-radius:8px;white-space:pre-wrap;border:1px solid #eee}
.muted{color:#888;font-size:.85rem} code{background:#eef5ee;padding:1px 5px;border-radius:4px}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body>
<div><a href="/admin/reviews">← до відгуків</a></div>
<h2>💬 Масова заливка відгуків</h2>
<p class=muted>Той самий підхід, що й для анотацій: експорт → промпт для LLM → вставка відповіді → заливка.
Жодних викликів AI з сервера — жодних лімітів часу чи вичерпаних ключів.</p>

<div style="background:#fff;border:1px solid #e0e8e0;border-radius:10px;padding:12px;margin:12px 0">
  <b>Крок 1 · Експорт товарів без відгуків</b><br>
  <label class=muted style="display:inline-block;margin:8px 8px 0 0">за раз: <input type=number id=exn value=30 min=1 max=200 style="width:72px;padding:5px;border:1px solid #c8e0c8;border-radius:6px"></label>
  <br><button class=btn onclick="exportEmpty()" style="background:#555;margin-top:8px">⬇️ Експорт</button>
  <div id=exs class=muted style="margin-top:6px"></div>
</div>

<details style="margin:10px 0;border:1px solid #e0e8e0;border-radius:10px;background:#fff;padding:8px 12px">
  <summary style="cursor:pointer;font-weight:700">Крок 2 · 📋 Промпт для LLM (розгорнути / скопіювати)</summary>
  <p class=muted style="margin:8px 0 4px">Встав цей промпт у ChatGPT / Claude / Gemini, а в кінець — вміст файлу з Кроку 1. Відповідь LLM (JSON) встав у поле Кроку 3.</p>
  <button class=btn onclick="copyPrompt()" style="background:#555;padding:6px 12px">📋 Копіювати промпт</button> <span id=cps class=muted></span>
  <textarea id=prompt readonly style="min-height:280px;margin-top:8px;background:#fafafa">Ти пишеш відгуки клієнтів для інтернет-магазину агротоварів «Агроном» (м. Володимир, Україна) для списку товарів у кінці.

ФОРМАТ ВІДПОВІДІ — лише валідний JSON-масив, без markdown і пояснень.
Кожен елемент: {"pid":123,"author":"ім'я з переліку нижче","rating":4 або 5,"text":"текст відгуку"}

ПРАВИЛА:
- Мова: ВИКЛЮЧНО українська, граматично правильна (правильні відмінки та рід). КАТЕГОРИЧНО ЗАБОРОНЕНО жодного російського слова чи суржику (напр. "ярко-зелений" — неправильно, треба "яскраво-зелений"), жодних вигаданих чи безглуздих словосполучень.
- Довжина відгуку: 50–140 символів. Пиши просто, як звичайна людина — без реклами, пафосу, "!!!", трикрапок.
- Якщо не маєш конкретної інформації про товар — пиши загальні, але осмислені враження (якість, зручність, чи купуватимеш знову), а не вигадуй дивні деталі чи характеристики.
- Автор — обери ІМ'Я З ЦЬОГО СПИСКУ (кожне ім'я можна використати не більше 2 разів на всю відповідь): ${namesForPrompt}
- Рейтинг: приблизно 3/4 відгуків — 5 зірок, решта — 4 зірки.
- pid НЕ змінюй і не вигадуй — бери точно як у вхідних даних. Один товар = один об'єкт у масиві.

СПИСОК ТОВАРІВ (JSON) — встав нижче вміст файлу tovary-bez-vidgukiv.json:
</textarea>
</details>

<p style="margin:12px 0 4px"><b>Крок 3 · Встав відповідь LLM</b> <span class=muted>(або обери файл)</span></p>
<label class=btn style="background:#555;cursor:pointer;display:inline-block">📂 Файл (.json/.txt)<input type=file id=f accept=".json,.txt,text/plain" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0"></label>
<span id=fn class=muted style="margin-left:8px">або вставте нижче ↓</span>
<p><textarea id=ta placeholder='[{"pid":123,"author":"Іван Прокопчук","rating":5,"text":"Гарний товар, буду й далі купувати."}]'></textarea></p>

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
async function post(dry){
  const u='/admin/reviews-bulk?'+(dry?'dryrun=1':'');
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
    +'✅ '+(dry?'буде додано':'додано')+': <b>'+d.willAdd+'</b> &nbsp; '
    +'❓ не знайдено: <b>'+d.unmatched+'</b> &nbsp; ⛔ вже має відгук / пропущено: <b>'+d.skipped+'</b></div>';
  h+=sect('✅ Нові відгуки',d.matched,function(x){
    return '<div style="margin-bottom:7px;border-bottom:1px solid #f2f2f2;padding-bottom:5px"><b>'+esc(x.pid)+'</b> · '+esc(x.n)+' — '+esc(x.author)+' '+'★'.repeat(x.rating)+'<div>'+esc(x.text)+'</div></div>';
  });
  h+=sect('❓ Не знайдено (pid у файлі → нема такого товару)',d.unmatchedList,x=>'<div>'+esc(x)+'</div>');
  return h;
}
async function verify(){ if(!body().trim()){alert('Вставте дані або оберіть файл');return;}
  $('s').textContent='перевірка…'; const {ok,data}=await post(true); $('s').textContent='';
  $('o').innerHTML=render(data,true); $('imp').disabled=!(ok&&data.ok&&data.willAdd>0);}
async function run(){ $('s').textContent='заливка…'; $('imp').disabled=true;
  const {ok,data}=await post(false); $('s').textContent=ok&&data.ok?'✅ Готово':'❌ Помилка';
  $('o').innerHTML=render(data,false);}
async function exportEmpty(){
  var n=Math.max(1,Math.min(200,parseInt($('exn').value||'30',10)));
  $('exs').textContent='готую…';
  var r=await fetch('/admin/reviews-bulk?export=1&limit='+n);
  if(!r.ok){$('exs').textContent='помилка '+r.status;return;}
  var remaining=r.headers.get('x-total-remaining')||'?';
  var txt=await r.text(); var cnt=0; try{cnt=JSON.parse(txt).length;}catch(e){}
  if(!cnt){$('exs').textContent='🎉 більше нема товарів без відгуків (усього за фільтром: '+remaining+')';return;}
  var blob=new Blob([txt],{type:'application/json'});
  var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='tovary-bez-vidgukiv.json';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  $('exs').textContent='⬇️ завантажено '+cnt+' товарів (усього без відгуків: '+remaining+'). Згенеруй у LLM → встав у Крок 3 → «Перевірити».';
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

  let recs;
  try {
    let raw = await context.request.text();
    raw = raw.replace(/^```[\w]*[\r\n]+/m, '').replace(/[\r\n]+```\s*$/m, '').trim();
    recs = JSON.parse(raw);
    if (!Array.isArray(recs)) recs = [recs];
  } catch (e) { return json({ ok: false, error: 'Не вдалося розпарсити JSON: ' + e.message }, 400); }
  if (!recs.length) return json({ ok: false, error: 'Порожньо' }, 400);

  // Перевіряємо, які pid реально існують і вже мають/не мають відгук
  const validRows = (await db.prepare(
    `SELECT p.pid, COALESCE(NULLIF(c.display_name,''), p.name) AS name,
            EXISTS(SELECT 1 FROM reviews r WHERE r.pid = p.pid) AS hasReview
       FROM products p LEFT JOIN product_content c ON c.pid = p.pid`
  ).all()).results || [];
  const byPid = new Map(validRows.map(r => [r.pid, r]));

  const Ins = db.prepare(`INSERT INTO reviews (pid, name, rating, text, created_at, approved, source) VALUES (?, ?, ?, ?, ?, 0, 'llm-manual')`);
  const stmts = [], matched = [], unmatchedList = [];
  let willAdd = 0, unmatched = 0, skipped = 0;
  const seenPid = new Set();

  for (const rec of recs) {
    const pid = parseInt(rec.pid, 10);
    const author = String(rec.author || '').trim().slice(0, 60);
    const rating = [4, 5].includes(Number(rec.rating)) ? Number(rec.rating) : 5;
    const text = String(rec.text || '').trim().slice(0, 500);

    if (!pid || !text || text.length < 10) { skipped++; continue; }
    const info = byPid.get(pid);
    if (!info) { unmatched++; if (unmatchedList.length < 100) unmatchedList.push(String(rec.pid)); continue; }
    if (info.hasReview || seenPid.has(pid)) { skipped++; continue; }
    seenPid.add(pid);

    willAdd++;
    if (matched.length < 60) matched.push({ pid, n: info.name, author: author || 'Покупець', rating, text });
    if (!dry) stmts.push(Ins.bind(pid, author || 'Покупець', rating, text, new Date().toISOString().split('T')[0]));
  }

  const cap = (a, n) => ({ total: a.length, sample: a.slice(0, n) });
  const payload = { ok: true, dryrun: dry, total: recs.length, willAdd, unmatched, skipped, matched: cap(matched, 50), unmatchedList: cap(unmatchedList, 30) };
  if (dry) return json(payload);

  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  return json(payload);
}
