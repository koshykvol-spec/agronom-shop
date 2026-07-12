-- Лог пошукових запитів (для аналізу, що реально шукають клієнти)
CREATE TABLE IF NOT EXISTS search_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  q TEXT NOT NULL,        -- нормалізований пошуковий запит
  cnt INTEGER NOT NULL,   -- скільки товарів знайдено
  ts INTEGER NOT NULL     -- unix timestamp
);
CREATE INDEX IF NOT EXISTS idx_search_log_q ON search_log(q);
CREATE INDEX IF NOT EXISTS idx_search_log_ts ON search_log(ts);
