-- Структуровані дані доставки НП у замовленні (для авто-ТТН) + сам номер ТТН.
-- ALTER не ідемпотентний — виконати ОДИН раз ("duplicate column" при повторі = ок).
ALTER TABLE orders ADD COLUMN np_service   TEXT NOT NULL DEFAULT '';  -- wh | door
ALTER TABLE orders ADD COLUMN np_city_ref  TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN np_city_name TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN np_wh_ref    TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN np_wh_name   TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN np_street    TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN np_house     TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN np_flat      TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN ttn          TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN ttn_ref      TEXT NOT NULL DEFAULT '';
