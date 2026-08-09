-- Трекінг товарів, опублікованих ботом у Telegram-каналі — щоб не повторювати
-- один і той самий товар занадто часто (fallback: якщо всі "свіжі" вже
-- використані, воркер ігнорує обмеження і бере повністю випадковий).
CREATE TABLE IF NOT EXISTS tg_posts (
  pid       INTEGER PRIMARY KEY REFERENCES products(pid) ON DELETE CASCADE,
  posted_at TEXT NOT NULL
);
