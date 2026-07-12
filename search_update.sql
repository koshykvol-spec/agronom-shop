-- Оновлення пошукової конфігурації "Агроном"
-- Застосування: wrangler d1 execute <DB_NAME> --remote --file=search_update.sql
-- (заміни <DB_NAME> на реальну назву бази з wrangler.toml)

-- ============================================================
-- 1) ФОЛДИНГ СИМВОЛІВ (search_config, ключ 'fold')
--    Таблиця key/value — немає ALTER TABLE, оновлюємо значення напряму.
--    Було:  ё>е,є>е,і>и,ї>и,ы>и,ґ>г
--    Додано: э>е (рос. "э" не фолдилось), ъ> (твердий знак прибирається)
-- ============================================================
INSERT OR REPLACE INTO search_config(key,value) VALUES
 ('fold','ё>е,є>е,і>и,ї>и,ы>и,ґ>г,э>е,ъ>');

-- ============================================================
-- 2) СИНОНІМИ ПОШУКУ (search_synonyms)
-- ============================================================

-- Бренд "Клуб 4 лапи" (С4Р)
INSERT INTO search_synonyms(term,target) VALUES('лапи','с4р');
INSERT INTO search_synonyms(term,target) VALUES('paws','с4р');

-- Гібриди насіння F1 (173 товари) — кирилична плутанина Ф1 vs F1
INSERT INTO search_synonyms(term,target) VALUES('ф1','f1');

-- Бренд Vitomax / Вітомакс — той самий бренд двома скриптами
INSERT INTO search_synonyms(term,target) VALUES('vitomax','вітомакс');

-- Рос. -> укр. терміни для категорії "ДЛЯ ТВАРИН"
INSERT INTO search_synonyms(term,target) VALUES('животное','тварини');
INSERT INTO search_synonyms(term,target) VALUES('животные','тварини');
INSERT INTO search_synonyms(term,target) VALUES('кот','коти');
INSERT INTO search_synonyms(term,target) VALUES('кошка','коти');
INSERT INTO search_synonyms(term,target) VALUES('кошки','коти');
INSERT INTO search_synonyms(term,target) VALUES('щенок','цуценя');
INSERT INTO search_synonyms(term,target) VALUES('щенки','цуценята');
INSERT INTO search_synonyms(term,target) VALUES('котенок','кошеня');
INSERT INTO search_synonyms(term,target) VALUES('котята','кошенята');

-- Бренди латиницею -> кириличний пошук (нормалізація і/и фолдиться автоматично,
-- тому досить одного варіанту написання терміну)
INSERT INTO search_synonyms(term,target) VALUES('интертул','intertool');
INSERT INTO search_synonyms(term,target) VALUES('мастертул','mastertool');
INSERT INTO search_synonyms(term,target) VALUES('сидера','seedera');

-- Рос. -> укр. терміни: комахи та полив
INSERT INTO search_synonyms(term,target) VALUES('таракан','тарган');
INSERT INTO search_synonyms(term,target) VALUES('тараканы','тарган');
INSERT INTO search_synonyms(term,target) VALUES('капельница','крапельниця');
INSERT INTO search_synonyms(term,target) VALUES('капельницы','крапельниця');

-- Прибрати "порожні" синоніми-заглушки (term = target, нічого не роблять)
DELETE FROM search_synonyms WHERE term = target;
