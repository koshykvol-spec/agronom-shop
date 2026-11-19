// Регресія /admin/newproducts (functions/admin/newproducts.js): нові товари → анотація + ключові слова + SEO description одним проходом.
// SQL-логіка перевіряється на СПРАВЖНЬОМУ SQLite зі схемою db/schema.sql (вбудований node:sqlite, Node ≥ 22.5).
// Якщо node:sqlite недоступний — ці тести пропускаються (решта працює на будь-якій Node ≥ 18).
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadFn, installCaches, makeDB, ctx, read, ROOT, ORIGIN } from './helpers/runtime.mjs';
import fs from 'node:fs';
import path from 'node:path';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* немає node:sqlite */ }
const skipSql = DatabaseSync ? false : 'node:sqlite недоступний (потрібна Node ≥ 22.5)';

// Обгортка над SQLite з D1-інтерфейсом (prepare/bind/all/first/run + batch)
function d1(db) {
  const mk = (sql, binds = []) => ({
    _sql: sql, _binds: binds,
    bind: (...b) => mk(sql, b),
    all: async () => ({ results: db.prepare(sql).all(...binds).map(r => ({ ...r })), success: true }),
    first: async () => { const r = db.prepare(sql).get(...binds); return r ? { ...r } : null; },
    run: async () => { db.prepare(sql).run(...binds); return { success: true }; },
  });
  return {
    prepare: sql => mk(sql),
    batch: async stmts => {
      db.exec('BEGIN');
      try { for (const s of stmts) db.prepare(s._sql).run(...s._binds); db.exec('COMMIT'); }
      catch (e) { db.exec('ROLLBACK'); throw e; }
      return [];
    },
  };
}

// pid: sku, name, category, visible, [annotation, keywords, meta_desc] | null (немає рядка в product_content)
const SEED = [
  [1, 'A-1', 'Насіння огірок Тест', 'НАСІННЯ ВІТЧИЗНЯНЕ', 1, ['', '', '']],
  [2, 'A-2', 'Насіння томат Готовий', 'НАСІННЯ ВІТЧИЗНЯНЕ', 1, ['Є опис', 'є кл слова', 'Є meta']],
  [3, 'A-3', 'Насіння перець Частковий', 'НАСІННЯ ВІТЧИЗНЯНЕ', 1, ['Опис перцю вже є', '', '']],
  [4, 'A-4', 'Прихований товар', 'НАСІННЯ ВІТЧИЗНЯНЕ', 0, ['', '', '']],
  [5, 'B-5', 'Ґрунт Тест', 'ГРУНТ', 1, ['', '', '']],
  [6, 'C-6', 'Без картки контенту', 'ГРУНТ', null, null],
  [7, 'D-7', 'Дубль', 'ГРУНТ', 1, ['Є', 'є', 'є']],
  [8, 'D-8', 'Дубль', 'ГРУНТ', 1, ['Є', 'є', 'є']],
];

function makeDb({ seed = SEED } = {}) {
  const raw = new DatabaseSync(':memory:');
  raw.exec(fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8'));
  for (const [pid, sku, name, category, visible, texts] of seed) {
    raw.prepare('INSERT INTO products(pid,sku,name,price,category,in_stock) VALUES(?,?,?,?,?,1)').run(pid, sku, name, 10, category);
    if (texts) raw.prepare('INSERT INTO product_content(pid,slug,annotation,keywords,meta_desc,visible) VALUES(?,?,?,?,?,?)')
      .run(pid, `slug-${pid}`, texts[0], texts[1], texts[2], visible);
  }
  return { raw, db: d1(raw) };
}
const content = (raw, pid) => ({ ...raw.prepare('SELECT annotation,keywords,meta_desc,slug FROM product_content WHERE pid=?').get(pid) });

let mod;
beforeEach(async () => { installCaches(); mod = await loadFn('functions/admin/newproducts.js'); });

const get = async (db, qs = '') => {
  const res = await mod.onRequestGet({ request: new Request(`${ORIGIN}/admin/newproducts${qs}`), env: { DB: db } });
  return { res, text: await res.text() };
};
const post = async (db, body, dry = false) => {
  const res = await mod.onRequestPost({ request: new Request(`${ORIGIN}/admin/newproducts${dry ? '?dryrun=1' : ''}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), env: { DB: db } });
  return { res, data: await res.json() };
};
const LONG_ANNO = '🌱 Огірок Тест — ранній сорт для відкритого ґрунту. ' + 'Рясно плодоносить, добре зав’язується. '.repeat(15);

describe('/admin/newproducts — експорт нових товарів', { skip: skipSql }, () => {
  it('віддає лише видимі товари з порожнім annotation/keywords/meta_desc, найновіші першими, з need і загальною кількістю', async () => {
    const { db } = makeDb();
    const { res, text } = await get(db, '?export=1&limit=50');
    const items = JSON.parse(text);
    assert.deepEqual(items.map(i => i.sku), ['C-6', 'B-5', 'A-3', 'A-1']);   // pid DESC; A-2 (готовий), A-4 (прихований), D-7/D-8 (готові) відсутні
    assert.equal(res.headers.get('x-total-remaining'), '4');
    assert.deepEqual(items.find(i => i.sku === 'A-1').need, ['annotation', 'keywords', 'meta_desc']);
    const a3 = items.find(i => i.sku === 'A-3');
    assert.deepEqual(a3.need, ['keywords', 'meta_desc']);
    assert.equal(a3.annotation, 'Опис перцю вже є', 'наявний опис передається, щоб LLM склав з нього keywords/meta_desc');
    assert.ok(!('annotation' in items.find(i => i.sku === 'A-1')));
  });

  it('limit обмежує вибірку, але x-total-remaining лишається загальним; cat фільтрує по розділу', async () => {
    const { db } = makeDb();
    const lim = await get(db, '?export=1&limit=2');
    assert.equal(JSON.parse(lim.text).length, 2);
    assert.equal(lim.res.headers.get('x-total-remaining'), '4');
    const cat = await get(db, '?export=1&cat=' + encodeURIComponent('ГРУНТ'));
    assert.deepEqual(JSON.parse(cat.text).map(i => i.sku), ['C-6', 'B-5']);
    assert.equal(cat.res.headers.get('x-total-remaining'), '2');
  });

  it('нових нема → порожній масив і 0', async () => {
    const { db } = makeDb({ seed: [SEED[1]] });
    const { res, text } = await get(db, '?export=1');
    assert.deepEqual(JSON.parse(text), []);
    assert.equal(res.headers.get('x-total-remaining'), '0');
  });
});

describe('/admin/newproducts — заливка (лише порожні поля)', { skip: skipSql }, () => {
  const RECS = () => [
    { sku: 'A-1', annotation: LONG_ANNO, keywords: 'огірок, насіння, тест', meta_desc: 'Огірок Тест — ранній сорт. Купити в магазині Агроном.' },
    { sku: 'A-3', annotation: 'СПРОБА ПЕРЕЗАПИСУ', keywords: 'перець, насіння, солодкий', meta_desc: 'Перець Частковий. Купити в Агроном.' },
    { sku: 'A-2', annotation: 'ПЕРЕЗАПИС ГОТОВОГО', keywords: 'ПЕРЕЗАПИС', meta_desc: 'ПЕРЕЗАПИС' },
    { sku: 'C-6', annotation: 'Опис для товару без картки', keywords: 'ґрунт', meta_desc: 'Ґрунт. Купити в Агроном.' },
  ];

  it('перевірка (dryrun) нічого не пише і рахує, що буде заповнено і що лишиться', async () => {
    const { raw, db } = makeDb();
    const { data } = await post(db, RECS(), true);
    assert.equal(data.ok, true);
    assert.equal(data.dryrun, true);
    assert.equal(data.willUpdate, 3);                 // A-1, A-3, C-6; A-2 нічого нового
    assert.equal(data.nothingNew, 1);
    assert.deepEqual(data.filled, { annotation: 2, keywords: 3, meta_desc: 3 });   // A-1, C-6 опис; A-3 опис не чіпаємо
    assert.deepEqual(data.kept, { annotation: 2, keywords: 1, meta_desc: 1 });     // A-3 мав опис; A-2 має всі три (їх спроба перезапису відхилена)
    assert.deepEqual(content(raw, 1), { annotation: '', keywords: '', meta_desc: '', slug: 'slug-1' });
  });

  it('заливка заповнює порожнє і НЕ перезаписує наявне (A-2 цілком, опис A-3)', async () => {
    const { raw, db } = makeDb();
    const { data } = await post(db, RECS());
    assert.equal(data.willUpdate, 3);
    assert.equal(content(raw, 1).annotation, LONG_ANNO.trim());
    assert.equal(content(raw, 1).keywords, 'огірок, насіння, тест');
    assert.equal(content(raw, 3).annotation, 'Опис перцю вже є');                        // наявний опис збережено
    assert.equal(content(raw, 3).keywords, 'перець, насіння, солодкий');                  // порожнє — заповнено
    assert.deepEqual(content(raw, 2), { annotation: 'Є опис', keywords: 'є кл слова', meta_desc: 'Є meta', slug: 'slug-2' });
  });

  it('товар без рядка в product_content отримує картку з текстами (slug лишається NULL — як в інших масових інструментах)', async () => {
    const { raw, db } = makeDb();
    await post(db, RECS());
    const c = content(raw, 6);
    assert.equal(c.annotation, 'Опис для товару без картки');
    assert.equal(c.keywords, 'ґрунт');
    assert.equal(c.slug, null);
  });

  it('захист у самому SQL: текст, що з’явився між перевіркою і заливкою, не затирається', async () => {
    const { raw, db } = makeDb();
    await post(db, RECS(), true);
    raw.prepare("UPDATE product_content SET annotation='Вписано вручну' WHERE pid=1").run();   // хтось відредагував у проміжку
    await post(db, RECS());
    assert.equal(content(raw, 1).annotation, 'Вписано вручну');
    assert.equal(content(raw, 1).keywords, 'огірок, насіння, тест');
  });

  it('після заливки товар більше не «новий» і зникає з експорту', async () => {
    const { db } = makeDb();
    await post(db, RECS());
    const items = JSON.parse((await get(db, '?export=1')).text);
    assert.deepEqual(items.map(i => i.sku), ['B-5']);
  });

  it('невідомий sku, порожній запис, дубль у відповіді, неоднозначна назва', async () => {
    const { db } = makeDb();
    const { data } = await post(db, [
      { sku: 'NOPE', annotation: 'x', keywords: 'y', meta_desc: 'z' },
      { sku: 'A-1' },                                                                  // порожній запис
      { sku: 'A-1', annotation: 'перший', keywords: 'k1', meta_desc: 'm1' },
      { sku: 'A-1', annotation: 'другий (дубль)', keywords: 'k2', meta_desc: 'm2' },
      { sku: 'Дубль', annotation: 'x', keywords: 'y', meta_desc: 'z' },                // два товари з такою назвою
    ], true);
    assert.equal(data.unmatched, 1);
    assert.deepEqual(data.unmatchedList.sample, ['NOPE']);
    assert.equal(data.empty, 1);
    assert.equal(data.willUpdate, 1);
    assert.equal(data.ambiguous.total, 1);
  });

  it('матч за точною назвою, якщо sku не знайдено', async () => {
    const { raw, db } = makeDb();
    const { data } = await post(db, [{ sku: 'насіння огірок тест', annotation: 'Опис за назвою', keywords: 'огірок', meta_desc: 'Огірок. Купити в Агроном.' }]);
    assert.equal(data.willUpdate, 1);
    assert.equal(content(raw, 1).annotation, 'Опис за назвою');
  });

  it('терпимий до ```json-обгортки, тексту навколо, масиву в keywords; meta_desc очищається від markdown/HTML/лапок', async () => {
    const { raw, db } = makeDb();
    const answer = 'Ось результат:\n```json\n' + JSON.stringify([
      { sku: 'A-1', annotation: 'Опис **жирний**', keywords: ['огірок', 'насіння', ' тест '], meta_desc: '"**Огірок** <b>Тест</b> — ранній сорт.   Купити в Агроном."' },
    ]) + '\n```\nГотово!';
    const { data } = await post(db, answer);
    assert.equal(data.ok, true);
    assert.equal(content(raw, 1).annotation, 'Опис **жирний**');          // markdown в описі дозволений
    assert.equal(content(raw, 1).keywords, 'огірок, насіння, тест');
    assert.equal(content(raw, 1).meta_desc, 'Огірок Тест — ранній сорт. Купити в Агроном.');
  });

  it('попередження про довжину не блокують заливку', async () => {
    const { db } = makeDb();
    const { data } = await post(db, [{ sku: 'A-1', annotation: 'коротко', keywords: 'один', meta_desc: 'дуже коротко' }], true);
    assert.equal(data.willUpdate, 1);
    const w = data.matched.sample[0].warn.join(' | ');
    assert.match(w, /анотація коротка/);
    assert.match(w, /meta_desc/);
    assert.match(w, /мало ключових слів/);
  });

  it('невалідний JSON і порожній масив → 400 з поясненням, нічого не пишеться', async () => {
    const { raw, db } = makeDb();
    const bad = await post(db, 'це не JSON');
    assert.equal(bad.res.status, 400);
    assert.match(bad.data.error, /JSON/);
    const none = await post(db, '[]');
    assert.equal(none.res.status, 400);
    assert.equal(content(raw, 1).annotation, '');
  });
});

describe('/admin/newproducts — сторінка', () => {
  it('(SQLite) показує кількість нових товарів, розділи й промпт з правилами фактів', { skip: skipSql }, async () => {
    const { db } = makeDb();
    const { res, text } = await get(db);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(text, /Нових товарів: <b>4<\/b>/);
    assert.match(text, /без опису: 3 · без ключових слів: 4 · без SEO description: 4/);
    assert.ok(text.includes('ГРУНТ (2)') && text.includes('НАСІННЯ ВІТЧИЗНЯНЕ (2)'));
    assert.ok(/<meta name=robots content=noindex>/.test(text), 'адмін-сторінка не індексується');
    assert.ok(text.includes('НЕ вигадуй дозувань'));
    for (const f of ['annotation', 'keywords', 'meta_desc']) assert.ok(text.includes(f));
  });

  it('(SQLite) нових нема → 🎉 і кнопка все одно працює без помилок', { skip: skipSql }, async () => {
    const { db } = makeDb({ seed: [SEED[1]] });
    const { text } = await get(db);
    assert.match(text, /Нових товарів немає/);
  });

  it('збій D1 при підрахунку не ламає сторінку (показує причину)', async () => {
    const { res, text } = await get(makeDB(() => { throw new Error('D1_ERROR boom'); }));
    assert.equal(res.status, 200);
    assert.match(text, /Не вдалося порахувати: D1_ERROR boom/);
  });

  it('клієнтський скрипт синтаксично валідний (екранування в шаблонному рядку не зламано)', async () => {
    const { text } = await get(makeDB(() => { throw new Error('x'); }));
    const m = /<script>([\s\S]*?)<\/script>/.exec(text);
    assert.ok(m, 'немає <script>');
    assert.doesNotThrow(() => new Function(m[1]), 'SyntaxError у клієнтському скрипті');
    assert.ok(!/\\\\s|\\\\n/.test(m[1]), 'подвійне екранування просочилось у клієнтський код');
  });

  it('промпт: заповнюй лише need, не вигадуй чисел, формат JSON зі sku', async () => {
    const { text } = await get(makeDB(() => { throw new Error('x'); }));
    assert.ok(text.includes('ЛИШЕ ті поля, що перелічені в &quot;need&quot;') || text.includes('ЛИШЕ ті поля, що перелічені в "need"'));
    assert.ok(text.includes('130–160'));
    assert.ok(text.includes('600–800'));
  });
});

describe('/admin/newproducts — інтеграція в адмінку', () => {
  it('плитка «Нові товари» є на головній адмінки в розділі «Каталог»', () => {
    const src = read('functions/admin/index.js');
    const sec = src.slice(src.indexOf("h: '🛠 Каталог'"));
    assert.ok(sec.includes("'/admin/newproducts'"));
  });

  it('/admin/* захищений Basic Auth (новий маршрут не відкритий без пароля)', async () => {
    const { onRequest } = await loadFn('functions/admin/_middleware.js');
    const env = { ADMIN_PASSWORD: 'secret' };
    const denied = await onRequest(ctx(`${ORIGIN}/admin/newproducts`, { env }));
    assert.equal(denied.status, 401);
    const ok = await onRequest(ctx(`${ORIGIN}/admin/newproducts`, { env, headers: { authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64') } }));
    assert.equal(ok.status, 200);
  });

  it('POST без Sec-Fetch-Site/Origin з того ж сайту блокується CSRF-захистом (заливка — мутуюча дія)', async () => {
    const { onRequest } = await loadFn('functions/admin/_middleware.js');
    const env = { ADMIN_PASSWORD: 'secret' };
    const h = { authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64'), 'sec-fetch-site': 'cross-site' };
    const res = await onRequest(ctx(`${ORIGIN}/admin/newproducts`, { env, method: 'POST', headers: h }));
    assert.equal(res.status, 403);
  });
});
