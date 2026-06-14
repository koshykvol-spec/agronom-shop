# Налаштування прийому замовлень (Telegram) + хостинг — безкоштовно

Це інструкція, як підняти сайт «Агроном» на **Cloudflare Pages** (хостинг) і
**Cloudflare Worker** (прийом замовлень у Telegram). Усе — на безкоштовному тарифі.

Файл воркера: [`order-worker.js`](./order-worker.js).

---

## Частина A. Телеграм-бот

1. У Telegram відкрийте **@BotFather** → `/newbot` → дайте назву й username.
   BotFather видасть **токен** виду `123456789:AAE...` — це `BOT_TOKEN`.
2. Дізнайтесь **CHAT_ID** (куди слати замовлення):
   - напишіть будь-що своєму новому боту (натисніть Start, відправте «привіт»);
   - відкрийте в браузері `https://api.telegram.org/bot<ВАШ_ТОКЕН>/getUpdates`;
   - знайдіть `"chat":{"id":XXXXXXXX, ...}` — число `id` це `CHAT_ID`.
   - *(Альтернатива: напишіть боту **@userinfobot** — він покаже ваш id.)*
   - Щоб слати в групу: додайте бота в групу і візьміть id групи (від'ємне число) з `getUpdates`.

---

## Частина B. Cloudflare Worker (прийом замовлень)

1. Зайдіть на **dash.cloudflare.com** (безкоштовна реєстрація) →
   **Workers & Pages** → **Create** → **Create Worker**.
2. Дайте ім'я, напр. `agro-order` → **Deploy** (поки що шаблон-заглушка).
3. Натисніть **Edit code** → видаліть увесь вміст → вставте код з
   [`order-worker.js`](./order-worker.js) → **Deploy**.
4. **Додайте секрети:** Worker → **Settings** → **Variables and Secrets** → **Add**:
   - `BOT_TOKEN` = токен від BotFather → тип **Secret (Encrypt)**;
   - `CHAT_ID` = ваш chat id → тип **Secret (Encrypt)**;
   - *(опційно)* `ALLOWED_ORIGIN` = адреса сайту, напр. `https://ваш-домен`
     (звичайна Variable). Якщо не задати — приймаються запити з будь-якого джерела.
   - Після додавання секретів натисніть **Deploy** ще раз.
5. Скопіюйте **URL воркера** — він виду
   `https://agro-order.<ваш-логін>.workers.dev`.

### Підключення воркера до сайту
6. У `app.js` знайдіть константу `ORDER_WORKER_URL` і вставте свій URL:
   ```js
   const ORDER_WORKER_URL = "https://agro-order.ВАШ-ЛОГІН.workers.dev";
   ```
   → замініть на реальний, напр. `https://agro-order.ivan.workers.dev`.
7. У файлі `_headers` CSP вже дозволяє `https://*.workers.dev`, тож якщо ваш
   воркер на домені `*.workers.dev` — нічого більше міняти не треба. Якщо ви
   повісили воркер на власний домен — додайте його в `connect-src` у `_headers`.

### Перевірка
8. Відкрийте сайт, додайте товар, оформіть замовлення → повідомлення має
   прийти у Telegram. Якщо ні — Worker → вкладка **Logs** (Real-time) покаже причину.

---

## Частина C. Хостинг сайту на Cloudflare Pages

**Варіант 1 — пряме завантаження (найпростіше):**
1. **Workers & Pages** → **Create** → **Pages** → **Upload assets**.
2. Перетягніть **усі файли проєкту** (саме вміст папки, не саму папку) → **Deploy**.
3. Отримаєте адресу виду `https://agronom.pages.dev`.

**Варіант 2 — через Git (зручно для оновлень):**
1. Залийте репозиторій на GitHub.
2. Pages → **Connect to Git** → оберіть репозиторій.
3. Build command: *(порожньо)*; Build output directory: `/` (корінь). → **Save and Deploy**.
4. Кожен `git push` автоматично оновлюватиме сайт.

**Власний домен (опційно):** Pages → **Custom domains** → **Set up a domain** →
введіть свій домен і додайте записи DNS (Cloudflare підкаже). Домен купується
окремо (~8–15 $/рік), сам хостинг безкоштовний.

> **`_headers`** працює на Pages автоматично — CSP та security-заголовки
> застосуються (на локальному `python -m http.server` вони НЕ діють — це нормально).

---

## Частина D. Після кожної зміни каталогу

1. Оновіть `products.json` / фото.
2. Перегенеруйте noscript-каталог:
   ```bash
   python3 prerender.py       # оновити noscript-каталог в index.html
   ```
   (sitemap.xml генерується динамічно з D1 — `functions/sitemap.xml.js`, регенерувати не треба.)
3. Підніміть `SITE_VERSION` у `app.js` та `protection_schemes.html` (скидання кешу).
4. Перезалийте на Pages (або `git push`, якщо через Git).

---

## Альтернатива через CLI (wrangler) — необов'язково

```bash
npm i -g wrangler
wrangler login
# у папці cloudflare-worker:
wrangler deploy order-worker.js --name agro-order
wrangler secret put BOT_TOKEN     # вставте токен
wrangler secret put CHAT_ID       # вставте chat id
```
