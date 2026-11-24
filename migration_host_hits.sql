-- Діагностичний журнал запитів до хостів, відмінних від agronom.pp.ua (functions/_middleware.js).
-- Виконати в D1 Console для agronom-db ДО деплою. Після з'ясування причини: DROP TABLE host_hits;
CREATE TABLE IF NOT EXISTS host_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  host TEXT,
  path TEXT,
  ua TEXT,
  ip TEXT,
  asn INTEGER,
  country TEXT
);

-- Перегляд (час UTC):
--   SELECT ts, host, path, ua, ip, asn FROM host_hits ORDER BY id DESC LIMIT 100;
--   SELECT host, ua, asn, COUNT(*) n, MIN(ts) first, MAX(ts) last FROM host_hits GROUP BY host, ua, asn ORDER BY n DESC;
