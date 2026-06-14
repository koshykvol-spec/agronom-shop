-- Аналоги за діючою речовиною. Колонка enrichment (1С НЕ оновлює).
-- ALTER не ідемпотентний — виконати ОДИН раз (повторний дасть "duplicate column", це ок).
ALTER TABLE product_content ADD COLUMN active_ingredient TEXT NOT NULL DEFAULT '';
-- Сід безпечних (grounded) речовин: db/seed_active_ingredients.sql
