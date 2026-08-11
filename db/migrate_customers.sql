-- Клієнтські акаунти для входу через Telegram Login Widget та Google Sign-In.
-- Один клієнт може мати telegram_id, google_sub або обидва (якщо колись увійде обома способами
-- з однаковим email — об'єднання акаунтів тут НЕ робимо, це свідомо поза першою версією).
CREATE TABLE IF NOT EXISTS customers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER UNIQUE,
  google_sub  TEXT UNIQUE,
  name        TEXT,
  avatar_url  TEXT,
  email       TEXT,
  phone       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_login  TEXT
);
CREATE INDEX IF NOT EXISTS idx_customers_telegram ON customers(telegram_id);
CREATE INDEX IF NOT EXISTS idx_customers_google   ON customers(google_sub);

-- customer_id заповнюється лише для замовлень, зроблених УЖЕ ПІСЛЯ впровадження акаунтів
-- (поки людина була залогінена) — старі замовлення заднім числом не прив'язуються.
ALTER TABLE orders ADD COLUMN customer_id INTEGER REFERENCES customers(id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
