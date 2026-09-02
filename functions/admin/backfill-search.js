// /admin/backfill-search — ОДНОРАЗОВИЙ ендпоінт: заповнює name_lower/sku_lower
// для товарів, доданих ДО впровадження пошукової оптимізації.
// Після успішного запуску (побачив "done":true) файл можна видалити з проєкту —
// нові товари вже отримують ці поля автоматично через /admin/save та import1c-commit.
//
// Використання: відкрити в браузері (авторизований в адмінці) /admin/backfill-search
// Обробляє батчами по 200, щоб не впертися в ліміт часу виконання Worker'а.

export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const BATCH = 200;

  const rows = (await db.prepare(
    `SELECT pid, name, sku FROM products
      WHERE name_lower IS NULL OR sku_lower IS NULL
      LIMIT ? OFFSET 0`  // завжди з offset=0: щойно оброблені рядки більше не потраплять у вибірку
  ).bind(BATCH).all()).results || [];

  if (rows.length === 0) {
    return new Response(JSON.stringify({ done: true, message: 'Усі товари вже мають name_lower/sku_lower. Можна видаляти цей файл.' }, null, 2),
      { headers: { 'content-type': 'application/json; charset=utf-8' } });
  }

  const stmts = rows.map(r =>
    db.prepare(`UPDATE products SET name_lower=?, sku_lower=? WHERE pid=?`)
      .bind((r.name || '').toLowerCase(), (r.sku || '').toLowerCase(), r.pid)
  );
  await db.batch(stmts);

  return new Response(JSON.stringify({
    done: false,
    processedThisBatch: rows.length,
    message: 'Оброблено ' + rows.length + ' товарів. Оновіть цю сторінку (F5) або перейдіть за /admin/backfill-search ще раз, щоб обробити наступну партію.'
  }, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8' } });
}
