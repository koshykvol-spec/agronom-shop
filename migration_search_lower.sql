-- migration_search_lower.sql
-- Додає name_lower/sku_lower для SQL-передфільтру в smart-пошуку /admin
ALTER TABLE products ADD COLUMN name_lower TEXT;
ALTER TABLE products ADD COLUMN sku_lower TEXT;
CREATE INDEX IF NOT EXISTS idx_products_name_lower ON products(name_lower);
CREATE INDEX IF NOT EXISTS idx_products_sku_lower ON products(sku_lower);
