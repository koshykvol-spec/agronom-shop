CREATE TABLE IF NOT EXISTS diagnose_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,
  name TEXT,
  confidence TEXT,
  products_found INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_diagnose_log_date ON diagnose_log(created_at);
