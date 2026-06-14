CREATE TABLE IF NOT EXISTS search_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR REPLACE INTO search_config(key,value) VALUES
 ('fold','ё>е,є>е,і>и,ї>и,ы>и,ґ>г'),
 ('fuzzy_dist','1'),
 ('fuzzy_minlen','4');
