-- Серверні секрети (НЕ віддаються клієнту; /site-config їх НЕ читає).
-- Читають лише функції (напр. /api/np бере np_api_key). Адмінка — /admin/keys.
CREATE TABLE IF NOT EXISTS secrets ( key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '' );
