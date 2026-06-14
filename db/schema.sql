-- Схема БД для Cloudflare D1 (SQLite). Магазин «Агроном».
-- products        — канон з 1С (перезаписується імпортом по pid)
-- product_content — обогащення (аннотація/слаг/keywords), імпорт 1С НЕ чіпає
-- product_images  — фото (ключ R2 або шлях), імпорт 1С НЕ чіпає
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
  pid        INTEGER PRIMARY KEY,          -- стабільний сурогатний ключ (live назавжди)
  sku        TEXT NOT NULL,                -- код 1С (може повторюватись для фасовок)
  name       TEXT NOT NULL,
  price      REAL,
  category   TEXT,
  brand      TEXT,
  in_stock   INTEGER NOT NULL DEFAULT 1,   -- 1/0
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category);

CREATE TABLE IF NOT EXISTS product_content (
  pid        INTEGER PRIMARY KEY REFERENCES products(pid) ON DELETE CASCADE,
  slug       TEXT UNIQUE,                  -- /p/<slug> (стабільний URL)
  annotation TEXT NOT NULL DEFAULT '',
  keywords   TEXT NOT NULL DEFAULT '',
  meta_title TEXT NOT NULL DEFAULT '',
  meta_desc  TEXT NOT NULL DEFAULT '',
  visible    INTEGER NOT NULL DEFAULT 1,    -- 0 = не показувати в каталозі/на /p/ + sitemap
  sort       INTEGER NOT NULL DEFAULT 0,
  sale_price REAL,                          -- акційна ціна (NULL = без акції)
  sale_until TEXT,                          -- дата кінця акції YYYY-MM-DD (NULL = безстроково)
  image_ok   INTEGER,                       -- 1 = файл фото реально існує, 0 = відсутній (фільтр «Без фото»); перераховується в admin/save
  display_name TEXT,                         -- фасадна назва (показується на сайті); NULL/'' = беремо робочу products.name; 1С НЕ оновлює
  group_id     TEXT,                         -- спільний ключ фасовок одного товару (NULL = одиночний); 1С НЕ оновлює
  variant_label TEXT,                        -- мітка фасовки для селектора («250 г»); 1С НЕ оновлює
  active_ingredient TEXT NOT NULL DEFAULT '', -- ПОХІДНИЙ нормалізований текст «a + b» діючих речовин (для «Аналогів» і пошуку); джерело істини — product_ingredients; rebuild у admin/_ingredients.js; 1С НЕ оновлює
  dosage       TEXT DEFAULT '',               -- дозування (показ на /p/; формат «X на Y л» → авто-калькулятор розчину); 1С НЕ оновлює
  divisible    INTEGER NOT NULL DEFAULT 0,    -- 1 = товар подільний (можна купити частину упаковки); 1С НЕ оновлює
  divisor      REAL                           -- кратність поділу (напр. 0.5, 100); NULL якщо divisible=0
);

CREATE TABLE IF NOT EXISTS product_images (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  pid  INTEGER NOT NULL REFERENCES products(pid) ON DELETE CASCADE,
  path TEXT NOT NULL,                      -- ключ у R2 або шлях /IMG_*/...
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_images_pid ON product_images(pid);

-- Діючі речовини: довідник (керується /admin/ingredients) + звʼязка M:N (керується у формі товару /admin).
-- product_content.active_ingredient — ПОХІДНИЙ текст із цієї звʼязки (rebuild у admin/_ingredients.js).
CREATE TABLE IF NOT EXISTS active_ingredients (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS product_ingredients (
  pid           INTEGER NOT NULL REFERENCES products(pid) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES active_ingredients(id) ON DELETE CASCADE,
  PRIMARY KEY (pid, ingredient_id)
);
CREATE INDEX IF NOT EXISTS idx_pi_ing ON product_ingredients(ingredient_id);

-- Розумний пошук (керується в /admin/search, віддається через /api/search-config)
CREATE TABLE IF NOT EXISTS search_synonyms (   -- term (ввід) → target (на що шукати), напр. помидор→томат
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL,
  target TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_syn_term ON search_synonyms(term);
CREATE TABLE IF NOT EXISTS search_config (     -- key/value: fold (фолдинг символів), fuzzy_dist, fuzzy_minlen
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Конфіг/контент, винесений з коду (див. db/migrate_config.sql, керування в /admin/*)
-- categories — категорії каталогу (нав/іконки/SEO/підкатегорії/схеми). /api/categories, /admin/categories
CREATE TABLE IF NOT EXISTS categories (
  key TEXT PRIMARY KEY,            -- urlkey (?cat=)
  db_name TEXT NOT NULL,           -- = products.category (робоча, з 1С)
  nav_label TEXT NOT NULL,         -- підпис у меню (фасадна)
  icon TEXT NOT NULL DEFAULT '🛒',
  sort INTEGER NOT NULL DEFAULT 0,
  has_sub INTEGER NOT NULL DEFAULT 1,
  sub_all_label TEXT NOT NULL DEFAULT 'Всі',
  show_schemes INTEGER NOT NULL DEFAULT 0,
  seo_title TEXT NOT NULL DEFAULT '', h1 TEXT NOT NULL DEFAULT '',
  seo_desc TEXT NOT NULL DEFAULT '', placeholder TEXT NOT NULL DEFAULT ''
);
-- pages — міні-CMS інфо-сторінок (доставка, повернення/оферта…). /api/page, /admin/pages
CREATE TABLE IF NOT EXISTS pages (
  slug TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
  meta_desc TEXT NOT NULL DEFAULT '', body_html TEXT NOT NULL DEFAULT '', updated_at TEXT
);
-- site_settings + stores — контакти/реквізити/магазини. /site-config, /admin/contacts
CREATE TABLE IF NOT EXISTS site_settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '' );
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY, sort INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '', street TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
  hours TEXT NOT NULL DEFAULT '', lat REAL, lng REAL, map TEXT NOT NULL DEFAULT '', oh_json TEXT NOT NULL DEFAULT '[]'
);
-- recipes — чипи «Що вас цікавить?» (швидкий пошук + схеми). /api/recipes, /admin/recipes
-- scheme_url(_syngenta) — цільові URL схем захисту (були SCHEME_LINKS/SYNGENTA_LINKS у app.js)
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, keywords TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'search', sort INTEGER NOT NULL DEFAULT 0, visible INTEGER NOT NULL DEFAULT 1,
  scheme_url TEXT NOT NULL DEFAULT '', scheme_url_syngenta TEXT NOT NULL DEFAULT ''
);
-- seasonal_cultures — культури «Що зараз робити?» (були GROUPS у seasonal-helper.js). /api/seasonal, /admin/seasonal
CREATE TABLE IF NOT EXISTS seasonal_cultures (
  id TEXT PRIMARY KEY, grp TEXT NOT NULL, grp_label TEXT NOT NULL, label TEXT NOT NULL,
  scheme_category TEXT NOT NULL, scheme_id TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0
);
-- app_data — великі JSON-блоби (key=protection_schemes — датасет схем, був protection_schemes.json).
-- /api/protection-schemes, /admin/schemes. Споживачі падають на статичний файл, якщо порожньо.
CREATE TABLE IF NOT EXISTS app_data ( key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT );

-- reviews — відгуки на товари (модерація в /admin/reviews; показ approved=1 на /p/ + JSON-LD aggregateRating)
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT, pid INTEGER NOT NULL, name TEXT NOT NULL DEFAULT '',
  rating INTEGER NOT NULL DEFAULT 5, text TEXT NOT NULL DEFAULT '', approved INTEGER NOT NULL DEFAULT 0, created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_reviews_pid ON reviews(pid, approved);

-- orders — замовлення з сайту (/api/order зберігає, /admin/orders переглядає; № = 1000+id)
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT,
  name TEXT, phone TEXT, address TEXT, delivery TEXT, comment TEXT,
  items TEXT NOT NULL DEFAULT '[]', total REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'new'
);
-- Аналітика: site_settings.ga4_id / clarity_id (інжект у footer.js). НП-ключ — env NP_API_KEY (не в БД).

-- secrets — СЕРВЕРНІ секрети. /site-config НІКОЛИ не читає цю таблицю. Керується в /admin/keys, /admin/np-sender.
--   np_api_key — ключ API Нової Пошти; turnstile_secret — секрет Turnstile (читає воркер через D1-біндинг);
--   order_internal_key — спільний ключ між /api/order і воркером (X-Order-Auth): дозволяє /api/order
--     пересилати замовлення в Telegram без Turnstile-токена (його /api/order уже перевірив).
-- orders.payment_method ('liqpay'), payment_status ('pending'/'paid'/'failed') — онлайн-оплата LiqPay
-- secrets: liqpay_public, liqpay_private; site_settings.liqpay_on='1' — публічний прапорець доступності оплати
CREATE TABLE IF NOT EXISTS secrets ( key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '' );

--   ukrposhta_token — Bearer Укрпошти (автодоповнення відділень); site_settings.ukrposhta_on='1' — прапорець
-- rate_limits — лічильники анти-абузу (per-IP вікно для /api/np). k='np:<ip>:<хвилина>', exp — час протухання (ms).
CREATE TABLE IF NOT EXISTS rate_limits ( k TEXT PRIMARY KEY, cnt INTEGER NOT NULL DEFAULT 0, exp INTEGER NOT NULL );
