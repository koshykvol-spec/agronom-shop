# SEO-регресійні тести (agronom-shop)

Без залежностей: лише Node ≥ 18 і вбудований `node:test`. `npm install` не потрібен.

## Запуск

```bash
node tests/seo/run.mjs                                   # усе: офлайн + «живі» перевірки на локальному імітаторі Pages
SEO_BASE_URL=https://agronom.pp.ua node tests/seo/run.mjs   # «живі» перевірки проти продакшену
```

PowerShell: `$env:SEO_BASE_URL="https://agronom.pp.ua"; node tests/seo/run.mjs`

Один файл: `node --test tests/seo/product-page.test.mjs`

## Що перевіряється

| Файл | Що ловить |
|---|---|
| `product-page.test.mjs` | `/p/<slug>`: title/description/canonical/og, JSON-LD Product (наявність, акції, відгуки, категорія, бренд), BreadcrumbList, 404 для невідомого slug, 503/STALE при збої D1 |
| `middleware.test.mjs` | 308 з `*.pages.dev`, закриті службові файли (обхід усіх файлів `db/ docs/ sample/ …`), серверний canonical/title/description для `/category?cat=`, noscript-категорії на головній |
| `sitemaps.test.mjs` | структура індексу, повнота, екранування XML, порожня карта ≠ 200, запасна копія, узгодженість із robots.txt і canonical-ами |
| `katalog.test.mjs` | `/katalog`: живі посилання на всі `/p/`, не noindex, не кешує порожню карту |
| `static-pages.test.mjs` | сирий HTML: title/description/canonical/h1, noindex лише на службових, JSON-LD, збіг списків категорій у `index.html` / `sitemap-main` / `prerender.py`, битi посилання, посилання на `*.html` |
| `robots-headers.test.mjs` | robots.txt (правила Google з `*`/`$`), `_redirects`, `_headers`, відсутність випадкового noindex |
| `live.test.mjs` | ті самі інваріанти через реальні HTTP-запити (200/301/308/404, sitemap → вибірка товарів, категорії) |

Функції з `functions/` виконуються **справжні** (з підробленою D1 у `helpers/runtime.mjs`), тож тест ловить зміни логіки, а не копії.

## Знімок «до/після деплою»

```bash
SEO_BASE_URL=https://agronom.pp.ua node tests/seo/snapshot.mjs --update   # записати еталон tests/seo/baseline.json
SEO_BASE_URL=https://agronom.pp.ua node tests/seo/snapshot.mjs            # після змін: diff title/description/canonical/h1/robots/JSON-LD/статусів
```

Код виходу 1, якщо щось змінилось або `sitemap-products` скоротився більше ніж на 5%.

## Відомі прогалини (`knownGap`)

Це бажана поведінка, якої ще немає; у звіті — `TODO`, набір не падає. Коли прогалину закрито, тест підкаже замінити `knownGap` на `it`.

- `category.html`: `<h1>` порожній у сирому HTML (заповнюється JS).
- невідомий `?cat=` віддає 200 із самореферентним canonical.
- шапка `functions/katalog.js` каже `noindex,follow`, а код віддає `index,follow`.

## Нова перевірка

- інваріант шаблону → відповідний `*.test.mjs`;
- нова D1-таблиця/запит у функції → додати гілку в `productDB()` (`helpers/runtime.mjs`) або `fixtureDB()` (`helpers/local-server.mjs`); невідомі запити повертають порожньо.

Каталог `tests/` закритий у `functions/_middleware.js` (`PRIVATE_PATH`) — Pages публікує весь корінь репозиторію.
