-- Друга хвиля винесення в D1: scheme_url, сезонні культури, app_data, NP-плейсхолдер.
-- ALTER recipes ADD COLUMN ... виконується ОКРЕМО (tolerant) перед цим файлом.

-- ── scheme_url для чипів-схем (сід зі SCHEME_LINKS/SYNGENTA_LINKS) ──
UPDATE recipes SET scheme_url='pomaceous_fruits?scheme=apple_protection',  scheme_url_syngenta='pomaceous_fruits?scheme=apple_syngenta'  WHERE id='apple';
UPDATE recipes SET scheme_url='stone_fruits?scheme=cherry_sweet_protection', scheme_url_syngenta='stone_fruits?scheme=cherry_syngenta'   WHERE id='cherry';
UPDATE recipes SET scheme_url='vegetables?scheme=tomato_greenhouse',       scheme_url_syngenta='vegetables?scheme=tomato_syngenta'      WHERE id='tomato';
UPDATE recipes SET scheme_url='vegetables?scheme=cucumber_protection',     scheme_url_syngenta='vegetables?scheme=cucumber_syngenta'    WHERE id='cucumber';
UPDATE recipes SET scheme_url='vegetables?scheme=pepper_syngenta',         scheme_url_syngenta='vegetables?scheme=pepper_syngenta'      WHERE id='pepper';
UPDATE recipes SET scheme_url='vegetables?scheme=cabbage_protection',      scheme_url_syngenta='vegetables?scheme=cabbage_syngenta'     WHERE id='cabbage';
UPDATE recipes SET scheme_url='vegetables?scheme=carrot_protection',       scheme_url_syngenta='vegetables?scheme=carrot_syngenta'      WHERE id='carrot';
UPDATE recipes SET scheme_url='grain_crops?scheme=wheat_spring'   WHERE id='grain_wheat';
UPDATE recipes SET scheme_url='grain_crops?scheme=corn_protection' WHERE id='grain_corn';
UPDATE recipes SET scheme_url='grapes?scheme=grapes_full_protection', scheme_url_syngenta='grapes?scheme=grapes_syngenta' WHERE id='grapes';

-- ── Сезонний помічник: культури ────────────────────────────────
CREATE TABLE IF NOT EXISTS seasonal_cultures (
  id              TEXT PRIMARY KEY,
  grp             TEXT NOT NULL,            -- garden | vegetable | greenhouse
  grp_label       TEXT NOT NULL,            -- '🍎 Мій сад'
  label           TEXT NOT NULL,            -- '🍎 Яблуня'
  scheme_category TEXT NOT NULL,
  scheme_id       TEXT NOT NULL,
  sort            INTEGER NOT NULL DEFAULT 0
);
INSERT OR REPLACE INTO seasonal_cultures (id,grp,grp_label,label,scheme_category,scheme_id,sort) VALUES
 ('apple','garden','🍎 Мій сад','🍎 Яблуня','pomaceous_fruits','apple_protection',1),
 ('pear','garden','🍎 Мій сад','🍐 Груша','pomaceous_fruits','pear_protection',2),
 ('cherry','garden','🍎 Мій сад','🍒 Черешня','stone_fruits','cherry_sweet_protection',3),
 ('cherry_sour','garden','🍎 Мій сад','🍒 Вишня','stone_fruits','cherry_sour_protection',4),
 ('plum','garden','🍎 Мій сад','🫐 Слива','stone_fruits','plum_protection',5),
 ('grapes','garden','🍎 Мій сад','🍇 Виноград','grapes','grapes_full_protection',6),
 ('strawberry','garden','🍎 Мій сад','🍓 Суниця','berries','strawberry_full',7),
 ('raspberry','garden','🍎 Мій сад','🫐 Малина','berries','raspberry_protection',8),
 ('currant','garden','🍎 Мій сад','🍇 Смородина','berries','currant_protection',9),
 ('tomato_open','vegetable','🥕 Мій город','🍅 Томати','vegetables','tomato_open',10),
 ('cabbage','vegetable','🥕 Мій город','🥬 Капуста','vegetables','cabbage_protection',11),
 ('carrot','vegetable','🥕 Мій город','🥕 Морква','vegetables','carrot_protection',12),
 ('onion','vegetable','🥕 Мій город','🧅 Цибуля','vegetables','onion_protection',13),
 ('beet','vegetable','🥕 Мій город','🫚 Буряк','vegetables','beet_protection',14),
 ('grain_wheat','vegetable','🥕 Мій город','🌾 Пшениця','grain_crops','wheat_spring',15),
 ('grain_corn','vegetable','🥕 Мій город','🌽 Кукурудза','grain_crops','corn_protection',16),
 ('tomato_gh','greenhouse','🌿 Моя теплиця','🍅 Томати','vegetables','tomato_greenhouse',17),
 ('cucumber','greenhouse','🌿 Моя теплиця','🥒 Огірки','vegetables','cucumber_protection',18),
 ('pepper','greenhouse','🌿 Моя теплиця','🌶️ Перець','vegetables','pepper_syngenta',19);

-- ── Великі JSON-блоби (схеми захисту тощо). Сід — окремим файлом. ──
CREATE TABLE IF NOT EXISTS app_data (
  key        TEXT PRIMARY KEY,
  json       TEXT NOT NULL,
  updated_at TEXT
);

-- ── NP-плейсхолдер у форму замовлення ──────────────────────────
INSERT OR REPLACE INTO site_settings (key,value) VALUES ('np_placeholder','Ковель, відділення №3');
