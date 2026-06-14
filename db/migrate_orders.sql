CREATE TABLE IF NOT EXISTS orders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT,
  name       TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  address    TEXT NOT NULL DEFAULT '',
  delivery   TEXT NOT NULL DEFAULT '',
  comment    TEXT NOT NULL DEFAULT '',
  items      TEXT NOT NULL DEFAULT '[]',
  total      REAL NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'new'
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, id);
INSERT OR IGNORE INTO site_settings(key,value) VALUES ('clarity_id',''),('ga4_id','');
