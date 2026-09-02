-- migration_stats_cache.sql
-- Кеш дашборд-статистики /admin, щоб не рахувати 3 важких запити на кожне відкриття списку.
CREATE TABLE IF NOT EXISTS admin_stats_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total INTEGER,
  noa INTEGER,
  noimg INTEGER,
  nodosage INTEGER,
  noai INTEGER,
  nokw INTEGER,
  noseo INTEGER,
  norev INTEGER,
  cat_json TEXT,
  updated_at INTEGER
);
