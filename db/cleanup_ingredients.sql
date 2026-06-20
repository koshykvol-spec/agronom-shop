-- Видалити сміттєві записи (JSON-фрагменти) з довідника
DELETE FROM active_ingredients
WHERE name LIKE '%"%' OR name LIKE '%:%' OR name LIKE '{%' OR name LIKE '[%';
