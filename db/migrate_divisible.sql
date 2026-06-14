-- Міграція: подільність товару
-- Запустити один раз через Cloudflare D1 console або wrangler:
--   wrangler d1 execute <DB_NAME> --file=db/migrate_divisible.sql
ALTER TABLE product_content ADD COLUMN divisible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_content ADD COLUMN divisor REAL;
