// /admin/newproducts — НОВІ товари одним проходом: анотація + ключові слова + SEO description.
// Об'єднує три окремі інструменти (/admin/anno, /admin/keywords, /admin/metadesc) для типового випадку
// «після імпорту 1С з'явились нові товари без текстів».
//   GET                      — сторінка (лічильники, кнопка «Підготувати для LLM», вставка відповіді, перевірка/заливка)
//   GET  ?export=1&limit=N&cat=… — JSON нових товарів (вхід для LLM); заголовок x-total-remaining
//   POST ?dryrun=1           — перевірка відповіді LLM (JSON-масив) без запису
//   POST                     — заливка
// «Новий» = видимий товар, у якого порожня хоча б одна з трьох: annotation, keywords, meta_desc.
// Заливка ЗАПОВНЮЄ ЛИШЕ ПОРОЖНІ поля: наявні тексти не перезаписуються (гарантовано самим SQL, а не лише перевіркою).
// Для перезапису існуючих текстів лишаються окремі інструменти (/admin/anno, /admin/keywords, /admin/metadesc).
// Чіпає ЛИШЕ product_content.annotation / keywords / meta_desc; ціни/наявність/фото — ні.

const json = (o, s = 200) => new Response(JSON.stringify(o, null, 2), { status: s, headers: { 'content-type': 'application/json; charset=utf-8' } });
const escA = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const MAX_ANNO = 20000;
const MAX_KW = 1000;
const MAX_MD = 500;
const FIELDS = ['annotation', 'keywords', 'meta_desc'];
const EMPTY = f => `COALESCE(c.${f},'')=''`;
const NEW_COND = `(${EMPTY('annotation')} OR ${EMPTY('keywords')} OR ${EMPTY('meta_desc')})`;

// Один промпт на всі три поля. Правила взято з промптів /admin/anno, /admin/keywords, /admin/metadesc.
const PROMPT = `Ти — копірайтер і SEO-спеціаліст інтернет-магазину агротоварів «Агроном» (м. Володимир, Україна).
Для кожного НОВОГО товару зі списку в кінці підготуй тексти.

ФОРМАТ ВІДПОВІДІ — лише валідний JSON-масив, без пояснень і без обгортки з markdown навколо нього (markdown дозволений всередині поля annotation).
Елемент: {"sku":"…точно як у вході…","annotation":"…","keywords":"…","meta_desc":"…"}
Заповнюй ЛИШЕ ті поля, що перелічені в "need" цього товару; решту полів не додавай. Якщо в товара є поле "annotation" (уже готовий опис) — не переписуй його, а використай для keywords і meta_desc.

annotation (опис):
- Українська. Markdown, емодзі, списки дозволені.
- 600–800 символів (7–14 речень). Перші ~150 символів — суть + назва товару.
- Що це, для чого, ключова користь; природно вплети назву й категорію, без «води» й порожніх обіцянок.

keywords (ключові слова):
- 8–15 слів або коротких фраз через кому, без повторів.
- Назва (і скорочення/синоніми), тип (гербіцид / фунгіцид / інсектицид / добриво / насіння…), культура, проблема (хвороба / шкідник / бур'ян), діюча речовина якщо є, бренд.

meta_desc (SEO description):
- 130–160 символів (суворо, Google обрізає довше). Лише звичайний текст — без HTML, markdown, лапок на початку/кінці.
- Коротко суть + користь + заклик («Купити в магазині Агроном»). Бери з annotation (наданого або щойно написаного тобою).

ФАКТИ (для всіх полів): спирайся ЛИШЕ на назву та надані поля (name, category, brand, active_ingredient, dosage). НЕ вигадуй дозувань, концентрацій, діючих речовин, норм витрати, термінів — для агрохімії хибна цифра шкідлива. Немає точних даних — пиши користь без чисел.
sku не змінюй і не вигадуй. Один товар = один об'єкт у масиві.

СПИСОК ТОВАРІВ (JSON):`;

// ── Експорт ──────────────────────────────────────────────────────────────────
async function exportNew(db, url) {
  let limit = parseInt(url.searchParams.get('limit') || '30', 10);
  if (!(limit > 0)) limit = 30;
  limit = Math.min(limit, 100);
  const cat = (url.searchParams.get('cat') || '').trim();
  const eb = []; let extra = '';
  if (cat) { extra = ' AND p.category=?'; eb.push(cat); }

  // COUNT(*) OVER () рахується до LIMIT → загальна кількість нових одним запитом
  const rows = (await db.prepare(
    `SELECT p.sku AS sku, COALESCE(NULLIF(c.display_name,''), p.name) AS name, p.category AS category, p.brand AS brand,
            COALESCE(c.active_ingredient,'') AS ai, COALESCE(c.dosage,'') AS dosage,
            COALESCE(c.annotation,'') AS anno, COALESCE(c.keywords,'') AS kw, COALESCE(c.meta_desc,'') AS md,
            COUNT(*) OVER () AS total
       FROM products p LEFT JOIN product_content c ON c.pid=p.pid
      WHERE COALESCE(c.visible,1)=1 AND ${NEW_COND}${extra}
      ORDER BY p.pid DESC LIMIT ?`).bind(...eb, limit).all()).results || [];

  const items = rows.map(r => {
    const need = [];
    if (!r.anno) need.push('annotation');
    if (!r.kw) need.push('keywords');
    if (!r.md) need.push('meta_desc');
    const o = { sku: r.sku, name: r.name, need };
    if (r.category) o.category = r.category;
    if (r.brand) o.brand = r.brand;
    if (r.ai) o.active_ingredient = r.ai;
    if (r.dosage) o.dosage = r.dosage;
    if (r.anno) o.annotation = r.anno.slice(0, 1200);   // уже є опис → LLM бере його для keywords/meta_desc
    return o;
  });
  return new Response(JSON.stringify(items, null, 1), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-total-remaining': String(rows.length ? Number(rows[0].total) | 0 : 0)
    }
  });
}

// ── Нормалізація полів відповіді LLM ─────────────────────────────────────────
function cleanMeta(s) {
  let t = String(s == null ? '' : s)
    .replace(/<[^>]*>/g, ' ')            // HTML
    .replace(/\*\*|__|`/g, '')           // markdown-виділення
    .replace(/^[\s#>\-*]+/, '')          // маркери на початку
    .replace(/\s+/g, ' ').trim();
  if (t.length > 1 && /^["«“'].*["»”']$/.test(t)) t = t.slice(1, -1).trim();   // обгортка лапками
  return t.slice(0, MAX_MD);
}
function cleanKeywords(v) {
  const t = Array.isArray(v) ? v.map(x => String(x == null ? '' : x).trim()).filter(Boolean).join(', ') : String(v == null ? '' : v);
  return t.replace(/\s+/g, ' ').trim().slice(0, MAX_KW);
}
function cleanAnno(v) { return String(v == null ? '' : v).trim().slice(0, MAX_ANNO); }

// Відповідь LLM → масив { id, annotation, keywords, meta_desc }. Лише JSON; терпимий до ```-обгортки і тексту навколо.
function parseRecords(text) {
  let raw = String(text || '').replace(/^﻿/, '').trim();
  raw = raw.replace(/^```[\w]*[\r\n]+/m, '').replace(/[\r\n]+```\s*$/m, '').trim();
  if (raw[0] !== '[' && raw[0] !== '{') {
    const a = raw.indexOf('['), b = raw.lastIndexOf(']');
    if (a !== -1 && b > a) raw = raw.slice(a, b + 1);
  }
  let arr = JSON.parse(raw);
  if (!Array.isArray(arr)) arr = [arr];
  return arr.filter(r => r && typeof r === 'object').map(r => ({
    id: String(r.sku ?? r.id ?? r.name ?? '').trim(),
    annotation: cleanAnno(r.annotation ?? r.anno),
    keywords: cleanKeywords(r.keywords ?? r.keyword ?? r.kw),
    meta_desc: cleanMeta(r.meta_desc ?? r.meta_description ?? r.seo_description ?? r.seo_desc),
  }));
}

// М'які попередження (не блокують заливку)
function warnings(f) {
  const w = [];
  if (f.annotation != null) { if (f.annotation.length < 300) w.push('анотація коротка (' + f.annotation.length + ')'); else if (f.annotation.length > 2000) w.push('анотація дуже довга (' + f.annotation.length + ')'); }
  if (f.meta_desc != null && (f.meta_desc.length < 100 || f.meta_desc.length > 170)) w.push('meta_desc ' + f.meta_desc.length + ' симв. (норма 130–160)');
  if (f.keywords != null && f.keywords.split(/[,\s]+/).filter(Boolean).length < 5) w.push('мало ключових слів');
  return w;
}

// ── POST: перевірка / заливка ────────────────────────────────────────────────
export async function onRequestPost(context) {
  const db = context.env.DB;
  const dry = new URL(context.request.url).searchParams.get('dryrun') === '1';

  let recs;
  try { recs = parseRecords(await context.request.text()); }
  catch (e) { return json({ ok: false, error: 'Не вдалося розпарсити JSON: ' + e.message }, 400); }
  if (!recs.length) return json({ ok: false, error: 'Порожньо' }, 400);

  const ex = (await db.prepare(
    `SELECT p.pid, p.sku, p.name, COALESCE(c.display_name,'') dn,
            COALESCE(c.annotation,'') anno, COALESCE(c.keywords,'') kw, COALESCE(c.meta_desc,'') md
       FROM products p LEFT JOIN product_content c ON c.pid=p.pid`).all()).results || [];
  const bySku = new Map(), byName = new Map(), info = new Map();
  const nkey = s => String(s || '').trim().toLowerCase();
  const push = (m, k, pid) => { const a = m.get(k); if (a) a.push(pid); else m.set(k, [pid]); };
  for (const r of ex) {
    info.set(r.pid, r);
    if (r.sku) push(bySku, r.sku.trim(), r.pid);
    for (const nm of [r.name, r.dn]) { const k = nkey(nm); if (k) push(byName, k, r.pid); }
  }

  // Захист «лише порожні» — у самому SQL: навіть якщо між перевіркою і заливкою хтось вписав текст, він не буде затертий.
  const Up = db.prepare(
    `INSERT INTO product_content(pid, annotation, keywords, meta_desc) VALUES(?,?,?,?)
     ON CONFLICT(pid) DO UPDATE SET
       annotation = CASE WHEN COALESCE(product_content.annotation,'')='' THEN excluded.annotation ELSE product_content.annotation END,
       keywords   = CASE WHEN COALESCE(product_content.keywords,'')=''   THEN excluded.keywords   ELSE product_content.keywords   END,
       meta_desc  = CASE WHEN COALESCE(product_content.meta_desc,'')=''  THEN excluded.meta_desc  ELSE product_content.meta_desc  END`);

  const stmts = [], matched = [], unmatchedList = [], ambiguous = [];
  const filled = { annotation: 0, keywords: 0, meta_desc: 0 };
  const kept = { annotation: 0, keywords: 0, meta_desc: 0 };
  let willUpdate = 0, nothingNew = 0, unmatched = 0, empty = 0;
  const seen = new Set();

  for (const rec of recs) {
    if (!rec.annotation && !rec.keywords && !rec.meta_desc) { empty++; continue; }
    const id = rec.id;
    if (!id) { unmatched++; unmatchedList.push('(порожній sku)'); continue; }
    let pids = bySku.get(id);
    if (!pids) pids = byName.get(nkey(id));
    if (!pids || !pids.length) { unmatched++; if (unmatchedList.length < 200) unmatchedList.push(id); continue; }
    if (pids.length > 1) { ambiguous.push({ id, names: pids.map(p => (info.get(p) || {}).name) }); continue; }
    const pid = pids[0];
    if (seen.has(pid)) continue;
    seen.add(pid);
    const cur = info.get(pid) || {};
    const curOf = { annotation: cur.anno, keywords: cur.kw, meta_desc: cur.md };

    const fill = {}, keep = [];
    for (const f of FIELDS) {
      if (!rec[f]) continue;
      if (curOf[f]) { keep.push(f); kept[f]++; } else { fill[f] = rec[f]; filled[f]++; }
    }
    if (!Object.keys(fill).length) { nothingNew++; continue; }
    willUpdate++;
    if (matched.length < 80) matched.push({
      sku: cur.sku || '—', n: cur.name || cur.dn || '',
      fills: Object.keys(fill), kept: keep,
      preview: {
        annotation: fill.annotation ? fill.annotation.replace(/\s+/g, ' ').slice(0, 110) + (fill.annotation.length > 110 ? '…' : '') : '',
        keywords: fill.keywords || '',
        meta_desc: fill.meta_desc || '',
      },
      len: { annotation: (fill.annotation || '').length, meta_desc: (fill.meta_desc || '').length },
      warn: warnings(fill),
    });
    if (!dry) stmts.push(Up.bind(pid, fill.annotation || '', fill.keywords || '', fill.meta_desc || ''));
  }

  const cap = (a, n) => ({ total: a.length, sample: a.slice(0, n) });
  const payload = {
    ok: true, dryrun: dry, total: recs.length,
    willUpdate, filled, kept, nothingNew, unmatched, empty,
    matched: cap(matched, 50),
    unmatchedList: cap(unmatchedList, 30),
    ambiguous: cap(ambiguous, 30),
  };
  if (dry) return json(payload);
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  return json(payload);
}

// ── GET: сторінка / експорт ──────────────────────────────────────────────────
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const db = context.env.DB;
  if (url.searchParams.get('export') === '1') return exportNew(db, url);

  // Лічильники одним запитом: нові товари загалом і по розділах
  let stats = null, statsErr = '';
  try {
    const rows = (await db.prepare(
      `SELECT p.category AS cat, COUNT(*) AS n,
              SUM(CASE WHEN ${NEW_COND} THEN 1 ELSE 0 END) AS nnew,
              SUM(CASE WHEN ${EMPTY('annotation')} THEN 1 ELSE 0 END) AS noa,
              SUM(CASE WHEN ${EMPTY('keywords')} THEN 1 ELSE 0 END) AS nokw,
              SUM(CASE WHEN ${EMPTY('meta_desc')} THEN 1 ELSE 0 END) AS nomd
         FROM products p LEFT JOIN product_content c ON c.pid=p.pid
        WHERE COALESCE(c.visible,1)=1
        GROUP BY p.category`).all()).results || [];
    stats = { nnew: 0, noa: 0, nokw: 0, nomd: 0, cats: [] };
    for (const r of rows) {
      stats.nnew += r.nnew | 0; stats.noa += r.noa | 0; stats.nokw += r.nokw | 0; stats.nomd += r.nomd | 0;
      if ((r.nnew | 0) > 0 && r.cat) stats.cats.push({ cat: r.cat, n: r.nnew | 0 });
    }
    stats.cats.sort((a, b) => a.cat.localeCompare(b.cat, 'uk'));
  } catch (e) { statsErr = String(e && e.message || e); }

  const catOpts = stats ? stats.cats.map(c => `<option value="${escA(c.cat)}">${escA(c.cat)} (${c.n})</option>`).join('') : '';
  const summary = stats
    ? (stats.nnew
        ? `Нових товарів: <b>${stats.nnew}</b> <span class=muted>(без опису: ${stats.noa} · без ключових слів: ${stats.nokw} · без SEO description: ${stats.nomd})</span>`
        : '🎉 Нових товарів немає: усі мають опис, ключові слова й SEO description.')
    : `<span style="color:#c0392b">Не вдалося порахувати: ${escA(statsErr)}</span>`;

  return new Response(`<!DOCTYPE html><html lang=uk><head><meta charset=UTF-8>
<meta name=viewport content="width=device-width, initial-scale=1.0"><meta name=robots content=noindex>
<title>Нові товари</title><style>
body{font-family:system-ui;max-width:820px;margin:1.5rem auto;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2{color:#2d6a2d} .btn{background:#2d6a2d;color:#fff;border:0;padding:10px 16px;border-radius:8px;cursor:pointer;font-weight:700}
.btn:disabled{background:#aaa;cursor:not-allowed} textarea{width:100%;box-sizing:border-box;min-height:160px;border:2px solid #c8e0c8;border-radius:10px;padding:10px;font-family:ui-monospace,monospace;font-size:.85rem}
.muted{color:#888;font-size:.85rem} .box{background:#fff;border:1px solid #e0e8e0;border-radius:10px;padding:12px;margin:12px 0}
.num{width:72px;padding:5px;border:1px solid #c8e0c8;border-radius:6px} select{padding:5px;border:1px solid #c8e0c8;border-radius:6px}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body>
<div><a href="/admin">← до адмінки</a></div>
<h2>🆕 Нові товари: анотація + ключові слова + SEO description</h2>
<p>${summary}</p>
<p class=muted>Усі три тексти за один прохід. Заповнюються <b>лише порожні</b> поля: вже наявні тексти не перезаписуються
(для перезапису є «Анотації / Ключові слова / SEO description (масово)»). Чіпає лише ці три поля.</p>

<div class=box>
  <b>Крок 1 · Підготувати завдання для LLM</b><br>
  <label class=muted style="display:inline-block;margin:8px 8px 0 0">за раз: <input type=number id=n value=30 min=1 max=100 class=num></label>
  <label class=muted style="display:inline-block;margin:8px 8px 0 0">розділ: <select id=cat><option value="">усі</option>${catOpts}</select></label><br>
  <button class=btn id=prep onclick="prepare()" style="margin-top:8px">📋 Скопіювати промпт + нові товари</button>
  <span id=ps class=muted></span>
  <div id=taskbox style="display:none;margin-top:8px">
    <div class=muted>Не скопіювалось автоматично? Виділіть усе в полі нижче й скопіюйте. Вставте в Claude / ChatGPT / Gemini.</div>
    <textarea id=task readonly style="min-height:120px;background:#fafafa"></textarea>
  </div>
  <details style="margin-top:8px"><summary class=muted style="cursor:pointer">Показати промпт</summary>
    <textarea id=prompt readonly style="min-height:300px;margin-top:6px;background:#fafafa">${escA(PROMPT)}</textarea></details>
</div>

<p style="margin:12px 0 4px"><b>Крок 2 · Вставте відповідь LLM</b> <span class=muted>(JSON-масив; обгортку \`\`\` можна лишати)</span></p>
<p><textarea id=ta placeholder='[{"sku":"00-12345","annotation":"…","keywords":"…","meta_desc":"…"}]'></textarea></p>
<p><b>Крок 3 ·</b> <button class=btn id=chk onclick="verify()">Перевірити</button>
   <button class=btn id=imp onclick="run()" disabled>Залити</button> <span id=s></span></p>
<div id=o class=box>Вставте відповідь LLM і натисніть «Перевірити».</div>

<script>
var $=function(id){return document.getElementById(id);};
var esc=function(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');};
var NL=String.fromCharCode(10);
$('ta').oninput=function(){$('imp').disabled=true;};
async function prepare(){
  var n=Math.max(1,Math.min(100,parseInt($('n').value||'30',10)));
  var cat=$('cat').value;
  $('ps').textContent='готую…';
  var r=await fetch('/admin/newproducts?export=1&limit='+n+(cat?'&cat='+encodeURIComponent(cat):''));
  if(!r.ok){$('ps').textContent='помилка '+r.status;return;}
  var remaining=r.headers.get('x-total-remaining')||'0';
  var txt=await r.text(), items=[];
  try{items=JSON.parse(txt);}catch(e){}
  if(!items.length){$('ps').textContent='🎉 нових товарів немає';return;}
  var task=$('prompt').value.replace(/\\s+$/,'')+NL+NL+txt;
  $('task').value=task; $('taskbox').style.display='none';
  var done=function(){$('ps').textContent='✅ скопійовано: '+items.length+' товарів (усього нових: '+remaining+'). Вставте в LLM → відповідь у Крок 2.';};
  var fail=function(){$('taskbox').style.display='block';$('task').select();$('ps').textContent='⚠️ скопіюйте вручну з поля нижче ('+items.length+' товарів, усього нових: '+remaining+')';};
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(task).then(done,fail);}else{fail();}
}
async function post(dry){
  var r=await fetch('/admin/newproducts'+(dry?'?dryrun=1':''),{method:'POST',headers:{'content-type':'text/plain'},body:$('ta').value});
  return {ok:r.ok,data:await r.json().catch(function(){return {ok:false,error:'не JSON (HTTP '+r.status+')'};})};
}
var LBL={annotation:'опис',keywords:'ключові слова',meta_desc:'SEO description'};
function sect(title,obj,fmt){
  if(!obj||!obj.total) return '';
  var rows=(obj.sample||[]).map(fmt).join('');
  var more=obj.total>(obj.sample||[]).length?'<div class=muted>…ще '+(obj.total-obj.sample.length)+'</div>':'';
  return '<details'+(obj.total<=12?' open':'')+' style="margin:6px 0;border:1px solid #eee;border-radius:8px;background:#fff;padding:6px 10px"><summary style="cursor:pointer;font-weight:700">'+title+': '+obj.total+'</summary><div style="margin:6px 0 4px;font-size:.86rem;line-height:1.5">'+rows+more+'</div></details>';
}
function render(d,dry){
  if(!d||!d.ok) return '<div style="color:#c0392b">❌ '+esc(d&&d.error||'помилка')+'</div>';
  var h='<div style="background:#eef5ee;padding:10px;border-radius:8px;margin-bottom:8px"><b>'+(dry?'🔎 Перевірка':'✅ Залито')+'</b> — записів у відповіді: '+d.total+'<br>'
    +'✅ '+(dry?'буде оновлено':'оновлено')+' товарів: <b>'+d.willUpdate+'</b> <span class=muted>(опис: '+d.filled.annotation+' · ключові слова: '+d.filled.keywords+' · SEO description: '+d.filled.meta_desc+')</span><br>'
    +((d.kept.annotation+d.kept.keywords+d.kept.meta_desc)?'🔒 вже були заповнені й лишились як є: опис '+d.kept.annotation+' · ключові слова '+d.kept.keywords+' · SEO description '+d.kept.meta_desc+'<br>':'')
    +(d.nothingNew?'⏭ нічого нового (усе вже заповнено): <b>'+d.nothingNew+'</b> &nbsp; ':'')
    +'❓ не знайдено: <b>'+d.unmatched+'</b> &nbsp; ⛔ порожні записи: <b>'+d.empty+'</b></div>';
  h+=sect('✅ Що буде записано',d.matched,function(x){
    var warn=(x.warn&&x.warn.length)?' <span style="color:#b8860b">⚠️ '+esc(x.warn.join('; '))+'</span>':'';
    var kept=(x.kept&&x.kept.length)?' <span class=muted>🔒 лишено: '+x.kept.map(function(f){return LBL[f];}).join(', ')+'</span>':'';
    var l='<div style="margin-bottom:8px;border-bottom:1px solid #f2f2f2;padding-bottom:6px"><b>'+esc(x.sku)+'</b> · '+esc(x.n)+' — заповниться: '+x.fills.map(function(f){return LBL[f];}).join(', ')+kept+warn;
    if(x.preview.annotation) l+='<div>📝 ('+x.len.annotation+') '+esc(x.preview.annotation)+'</div>';
    if(x.preview.keywords) l+='<div>🔑 '+esc(x.preview.keywords)+'</div>';
    if(x.preview.meta_desc) l+='<div>🔍 ('+x.len.meta_desc+') '+esc(x.preview.meta_desc)+'</div>';
    return l+'</div>';
  });
  h+=sect('❓ Не знайдено (sku з відповіді нема в базі)',d.unmatchedList,function(x){return '<div>'+esc(x)+'</div>';});
  h+=sect('⚠️ Неоднозначні (sku збігається з кількома товарами)',d.ambiguous,function(x){return '<div><b>'+esc(x.id)+'</b>: '+esc((x.names||[]).join('  |  '))+'</div>';});
  return h;
}
async function verify(){
  if(!$('ta').value.trim()){alert('Вставте відповідь LLM');return;}
  $('s').textContent='перевірка…'; var res=await post(true); $('s').textContent='';
  $('o').innerHTML=render(res.data,true);
  $('imp').disabled=!(res.ok&&res.data.ok&&res.data.willUpdate>0);
}
async function run(){
  $('s').textContent='заливка…'; $('imp').disabled=true;
  var res=await post(false); $('s').textContent=res.ok&&res.data.ok?'✅ Готово':'❌ Помилка';
  $('o').innerHTML=render(res.data,false);
}
</script></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
