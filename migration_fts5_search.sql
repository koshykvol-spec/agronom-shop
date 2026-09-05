-- migration_fts5_search.sql
-- Індексований повнотекстовий пошук замість LIKE '%...%' (яке завжди сканує
-- всю таблицю через leading wildcard, незалежно від наявних B-tree індексів).
-- FTS5 — інвертований індекс: MATCH з префіксним токеном ('слово*') шукає
-- напряму, без сканування рядків, які точно не підходять.

CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(name_lower);

-- Одноразове заповнення з уже коректних name_lower (заповнені попереднім backfill).
INSERT INTO products_fts(rowid, name_lower)
SELECT pid, name_lower FROM products WHERE name_lower IS NOT NULL;
