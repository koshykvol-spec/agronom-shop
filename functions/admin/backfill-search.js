// /admin/backfill-search — ПЕРЕРАХУНОК name_lower/sku_lower через normS (з фолдингом і→и тощо),
// той самий normS, що й у пошуку /admin. Попередня версія писала звичайний .toLowerCase() без
// фолдингу — через це LIKE-передфільтр не знаходив товари з літерою "і" в назві (баг "Гліфат").
// Обробляє ВСІ товари незалежно від того, чи вже є значення (force-перерахунок), батчами по 200.
//
// Використання: відкрити в браузері (авторизований в адмінці) /admin/backfill-search?offset=0
// і продовжувати збільшувати offset (посилання "далі" внизу відповіді), поки не "done":true.
// Після успішного завершення файл можна видалити з проєкту.

function normS(s) {
  s = String(s == null ? '' : s).toLowerCase().replace(/[''`ʼ]/g, '');
  const FOLD = [['ё','е'],['є','е'],['і','и'],['ї','и'],['ы','и'],['ґ','г']];
  for (const [a,b] of FOLD) s = s.split(a).join(b);
  return s.replace(/[^a-z0-9а-я]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const BATCH = 200;

  const rows = (await db.prepare(
    `SELECT pid, name, sku FROM products ORDER BY pid LIMIT ? OFFSET ?`
  ).bind(BATCH, offset).all()).results || [];

  if (rows.length === 0) {
    return new Response(JSON.stringify({ done: true, message: 'Перераховано всі товари. Можна видаляти цей файл.' }, null, 2),
      { headers: { 'content-type': 'application/json; charset=utf-8' } });
  }

  const stmts = rows.map(r =>
    db.prepare(`UPDATE products SET name_lower=?, sku_lower=? WHERE pid=?`)
      .bind(normS(r.name), normS(r.sku), r.pid)
  );
  await db.batch(stmts);

  const nextOffset = offset + rows.length;
  return new Response(JSON.stringify({
    done: false,
    processedThisBatch: rows.length,
    nextOffset,
    message: 'Оброблено партію (offset ' + offset + '). Перейдіть за /admin/backfill-search?offset=' + nextOffset + ' для наступної.'
  }, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8' } });
}
