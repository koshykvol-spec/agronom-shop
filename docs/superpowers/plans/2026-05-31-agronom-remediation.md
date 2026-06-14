# План починки та виправлення сайту «Агроном»

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Усунути критичні, серйозні та технічні дефекти інтернет-магазину «Агроном», виявлені аудитом (SEO / Security / Design / UI / UX), і довести сайт до стану «готовий до продажів і видимий у пошуку».

**Architecture:** Статичний сайт (HTML + vanilla JS + JSON) без бекенду, окрім Cloudflare Worker для Telegram-замовлень. Виправлення робимо in-place у наявній архітектурі; SEO-видимість досягаємо пререндером каталогу на етапі білда (Python-скрипт, як наявні `generate_keywords.py`/`sync_images.py`), а не міграцією на фреймворк. Спільні елементи (footer) інжектимо одним скриптом за зразком `cart.js`.

**Tech Stack:** HTML5, CSS3, vanilla JavaScript (ES2017+), JSON-дані, Python 3 для офлайн-білд-скриптів, Node.js (лише для `--check` та юніт-перевірок чистої логіки), статичний хостинг із підтримкою `_headers` (Cloudflare Pages / Netlify).

**Контекст репозиторію:** проект НЕ під git, немає тест-фреймворку, немає білд-системи. Тому: (1) Task 0 ініціалізує git як страховку; (2) «тести» = `node --check` для синтаксису, маленькі Node-ассерти для чистих функцій, `grep`-перевірки наявності, ручні браузерні перевірки; (3) кроки `git commit` діють після Task 0.

**Легенда пріоритетів:** 🔴 critical · 🟠 high · 🟡 medium · 🟢 low.

---

## Фаза 0 — Блокери виручки (ВЖЕ ЗРОБЛЕНО ✅)

Виконано в попередній сесії, лишається перевірити в проді:

- [x] 🔴 **Guard на плейсхолдер Worker** — `isOrderWorkerConfigured()` + перевірка перед `fetch` у `submitOrder` (`app.js`). Поки стоїть `ВАШ-ЛОГІН`, Telegram-відправка не виконується; клієнт бачить дієве повідомлення (телефон + Viber), у консоль пишеться помилка конфігурації.
- [x] 🔴 **Екранування вводу для Telegram HTML** — `escapeTgHtml()` застосовано до назви товару, імені, телефону, адреси, коментаря; Viber-гілка розгортає сутності назад. Перевірено `node --check` + Node-ассертами.

> **Лишається (дія власника, не код):** розгорнути Cloudflare Worker і прописати реальний URL у `app.js:593` — без цього замовлення фізично не йдуть. Це **передумова** до запуску маркетингу/SEO (інакше трафік веде у зламану вирву).

---

## Фаза 1 — Довіра та закон (тиждень)

### Task 1: Спільний footer (контакти, реквізити, месенджери) 🟠

**Goal:** Додати єдиний `<footer>` на всі сторінки з адресою, графіком, телефоном/Viber/Telegram, реквізитами ФОП і посиланнями на інфо-сторінки — інжектиться одним скриптом за зразком `cart.js`.

**Files:**
- Create: `footer.js`
- Create: `site-config.js` (єдине джерело контактів/реквізитів)
- Modify: `index.html`, `category.html`, `protection_schemes.html` (підключити `<script src="site-config.js">` і `<script src="footer.js">` перед `</body>`; додати контейнер `<div id="site-footer"></div>`)
- Modify: `style.css` (стилі футера)

**Acceptance Criteria:**
- [ ] На `index.html`, `category.html`, `protection_schemes.html` рендериться однаковий футер.
- [ ] Футер містить: назву магазину, адресу (м. Володимир, вул./№ — поле власника), графік роботи, телефон `063 462 52 06` (клікабельний `tel:`), клікабельні Viber і Telegram, e-mail, реквізити ФОП, посилання на «Доставка і оплата», «Контакти», «Повернення/Оферта».
- [ ] Контакти задані в ОДНОМУ місці (`site-config.js`) і не дублюються.

**Verify:** `node --check footer.js && node --check site-config.js` → без помилок; відкрити три сторінки у браузері → футер однаковий і посилання працюють.

**Steps:**

- [ ] **Step 1: Створити `site-config.js` — єдине джерело правди**

```javascript
// site-config.js — єдине місце з контактами та реквізитами магазину.
// Підключати ПЕРШИМ (до footer.js, app.js).
window.SITE_CONFIG = {
    name: 'Агроном',
    phoneDisplay: '063 462 52 06',
    phoneIntl: '+380634625206',
    viberPhone: '380634625206',
    telegram: 'https://t.me/',          // ← вписати юзернейм/посилання
    email: '',                          // ← вписати e-mail
    address: 'м. Володимир, вул. ___, ___', // ← вписати реальну адресу
    hours: 'Пн–Сб 9:00–18:00, Нд — вихідний', // ← уточнити
    fop: 'ФОП Прізвище Ім\'я По-батькові, ЄДРПОУ/ІПН ___' // ← вписати реквізити
};
```

- [ ] **Step 2: Створити `footer.js` — інжект футера**

```javascript
// footer.js — спільний футер. Рендерить у <div id="site-footer">.
// Потребує window.SITE_CONFIG (site-config.js).
(function () {
    var c = window.SITE_CONFIG || {};
    var container = document.getElementById('site-footer');
    if (!container) return;

    var viberHref = 'viber://chat?number=' + (c.viberPhone || '');
    var html = ''
      + '<footer class="site-footer">'
      + '  <div class="footer-grid">'
      + '    <div class="footer-col">'
      + '      <div class="footer-brand">' + (c.name || 'Агроном') + '</div>'
      + '      <div class="footer-line">📍 ' + (c.address || '') + '</div>'
      + '      <div class="footer-line">🕒 ' + (c.hours || '') + '</div>'
      + '    </div>'
      + '    <div class="footer-col">'
      + '      <div class="footer-h">Контакти</div>'
      + '      <a class="footer-line" href="tel:' + (c.phoneIntl || '') + '">📞 ' + (c.phoneDisplay || '') + '</a>'
      + '      <a class="footer-line" href="' + viberHref + '">📲 Viber</a>'
      + '      <a class="footer-line" href="' + (c.telegram || '#') + '">✈️ Telegram</a>'
      + (c.email ? '      <a class="footer-line" href="mailto:' + c.email + '">✉️ ' + c.email + '</a>' : '')
      + '    </div>'
      + '    <div class="footer-col">'
      + '      <div class="footer-h">Інформація</div>'
      + '      <a class="footer-line" href="delivery.html">Доставка і оплата</a>'
      + '      <a class="footer-line" href="contacts.html">Контакти</a>'
      + '      <a class="footer-line" href="returns.html">Повернення та оферта</a>'
      + '    </div>'
      + '  </div>'
      + '  <div class="footer-legal">' + (c.fop || '') + ' · © ' + (c.name || 'Агроном') + '</div>'
      + '</footer>';
    container.innerHTML = html;
})();
```

- [ ] **Step 3: Підключити на сторінках**

У `index.html`, `category.html`, `protection_schemes.html` перед `</body>` (і ПЕРЕД `app.js`):
```html
<div id="site-footer"></div>
<script src="site-config.js"></script>
<script src="footer.js"></script>
```
(на `protection_schemes.html` `site-config.js` + `footer.js` додати в кінці `<body>`).

- [ ] **Step 4: Стилі футера у `style.css`**

```css
.site-footer { background: var(--green); color: #fff; margin-top: 40px; padding: 28px 16px 18px; }
.footer-grid { max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px,1fr)); gap: 20px; }
.footer-brand { font-family: 'Playfair Display', serif; font-size: 1.3rem; font-weight: 900; margin-bottom: 8px; }
.footer-h { font-weight: 700; text-transform: uppercase; letter-spacing: .05em; font-size: .8rem; opacity: .85; margin-bottom: 8px; }
.footer-line { display: block; color: #fff; text-decoration: none; opacity: .92; padding: 3px 0; font-size: .9rem; }
.footer-line:hover { opacity: 1; text-decoration: underline; }
.footer-legal { max-width: 1200px; margin: 18px auto 0; padding-top: 14px; border-top: 1px solid rgba(255,255,255,.2); font-size: .78rem; opacity: .8; text-align: center; }
```

- [ ] **Step 5: Семантичні обгортки на `index.html`/`category.html`**

Обгорнути `<nav>...</nav>` у `<header>...</header>` і `<div class="container">...</div>` у `<main>...</main>` (закриваючий `</main>` — перед `<div id="site-footer">`). Це закриває зауваження аудиту про відсутність `<header>/<main>` і не змінює стилі (теги нейтральні).

- [ ] **Step 6: Перевірити та зафіксувати**

```bash
node --check footer.js && node --check site-config.js
grep -c "<main" index.html category.html
git add site-config.js footer.js style.css index.html category.html protection_schemes.html
git commit -m "feat: спільний footer + семантичні header/main"
```

---

### Task 2: Інфо-сторінки (Доставка/Оплата, Контакти, Повернення/Оферта) 🟠

**Goal:** Створити три статичні інформаційні сторінки, обов'язкові для укр. e-commerce (ЗУ «Про захист прав споживачів», «Про електронну комерцію»), у єдиному стилі сайту.

**Files:**
- Create: `delivery.html`, `contacts.html`, `returns.html`
- Reuse: `style.css`, `site-config.js`, `footer.js`

**Acceptance Criteria:**
- [ ] Кожна сторінка має валідну структуру (`<header>`, `<main>`, `<footer>`), коректний `<title>`, `<meta name="description">`, `<h1>`, спільний nav і footer.
- [ ] `delivery.html` описує способи доставки (Нова Пошта/самовивіз) і оплати (передоплата/при отриманні).
- [ ] `contacts.html` містить адресу, графік, телефон/месенджери, (за можливості) карту проїзду.
- [ ] `returns.html` містить умови повернення та публічну оферту.

**Verify:** відкрити кожну сторінку у браузері → коректне відображення; `grep -l "<h1" delivery.html contacts.html returns.html` → усі три файли.

**Steps:**

- [ ] **Step 1: Шаблон сторінки (на прикладі `delivery.html`)**

```html
<!DOCTYPE html>
<html lang="uk">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Доставка і оплата — Агроном, м. Володимир</title>
    <meta name="description" content="Умови доставки Новою Поштою та самовивозу, способи оплати в інтернет-магазині агротоварів Агроном (м. Володимир).">
    <link rel="canonical" href="https://ВАШ-ДОМЕН/delivery.html">
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Nunito:wght@400;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="style.css">
</head>
<body>
<header>
  <nav>
    <a href="index.html" class="logo">АГРОНОМ</a>
    <a href="tel:+380634625206" class="nav-phone">м. Володимир<br><strong>063 462 52 06</strong></a>
  </nav>
</header>
<main class="container article">
  <h1>Доставка і оплата</h1>
  <h2>Доставка</h2>
  <p>Нова Пошта (відділення / поштомат) за тарифами перевізника. Самовивіз: <span data-cfg="address"></span>.</p>
  <h2>Оплата</h2>
  <p>Передоплата на картку / накладений платіж при отриманні (уточнюється менеджером).</p>
  <!-- Точний текст умов вписує власник -->
</main>
<div id="site-footer"></div>
<script src="site-config.js"></script>
<script src="footer.js"></script>
</body>
</html>
```

- [ ] **Step 2: Створити `contacts.html` і `returns.html` за тим самим шаблоном**

Замінити `<title>`, `description`, `canonical`, `<h1>` і вміст `<main>`:
- `contacts.html` — `<h1>Контакти</h1>`, блок адреси/графіку/телефону/месенджерів (можна тягнути з `SITE_CONFIG`), за бажанням `<iframe>` Google Maps.
- `returns.html` — `<h1>Повернення та публічна оферта</h1>`, текст умов повернення + оферти (контент власника).

- [ ] **Step 3: Базові стилі статті у `style.css`**

```css
.article { padding-top: 20px; padding-bottom: 40px; }
.article h1 { font-family: 'Playfair Display', serif; color: var(--green); margin-bottom: 16px; }
.article h2 { color: var(--green); margin: 22px 0 8px; font-size: 1.15rem; }
.article p { line-height: 1.65; margin-bottom: 12px; color: var(--text); }
.nav-phone { text-align: right; font-size: .7rem; opacity: .9; color: inherit; text-decoration: none; line-height: 1.4; }
```

- [ ] **Step 4: Перевірити та зафіксувати**

```bash
grep -l "<h1" delivery.html contacts.html returns.html
git add delivery.html contacts.html returns.html style.css
git commit -m "feat: інфо-сторінки доставки/оплати, контактів, повернення та оферти"
```

---

### Task 3: Skeleton/спінер завантаження каталогу 🟠

**Goal:** Прибрати білий екран під час завантаження 1.5 МБ `products.json` — показувати skeleton-картки одразу, замінювати їх реальними після рендеру.

**Files:**
- Modify: `index.html`, `category.html` (skeleton-розмітка у `#grid`)
- Modify: `style.css` (анімація skeleton)
- Modify: `app.js` (прибрати skeleton перед першим `render()`)

**Acceptance Criteria:**
- [ ] При відкритті сторінки до завершення `fetch` у `#grid` видно ≥8 анімованих сірих карток.
- [ ] Після завантаження товарів skeleton зникає, показуються реальні картки.
- [ ] Якщо `loadProducts()` впав — skeleton прибирається, показується порожній/помилковий стан.

**Verify:** у DevTools → Network → Throttling «Slow 3G» → перезавантажити → видно skeleton кілька секунд, потім товари.

**Steps:**

- [ ] **Step 1: Skeleton-розмітка у `#grid`** (`index.html` і `category.html`)

```html
<div id="grid" class="grid">
  <!-- skeleton: прибирається першим render() -->
  <div class="card skeleton"></div><div class="card skeleton"></div>
  <div class="card skeleton"></div><div class="card skeleton"></div>
  <div class="card skeleton"></div><div class="card skeleton"></div>
  <div class="card skeleton"></div><div class="card skeleton"></div>
</div>
```

- [ ] **Step 2: Стилі skeleton у `style.css`**

```css
.card.skeleton { min-height: 230px; background: linear-gradient(90deg,#f0f0f0 25%,#e6e6e6 37%,#f0f0f0 63%); background-size: 400% 100%; animation: sk 1.3s ease infinite; border: 1px solid #f0f0f0; }
@keyframes sk { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
```

- [ ] **Step 3: У `app.js` `render()` вже робить `grid.innerHTML = ...`** — отже skeleton зникає автоматично при першому успішному рендері. Додати прибирання skeleton у `catch` `loadProducts()`, щоб при помилці не лишалися сірі картки:

У `loadProducts()` `catch`-блоці (після `console.error`) додати:
```javascript
        const grid = document.getElementById('grid');
        if (grid) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#888;">Не вдалося завантажити товари. Оновіть сторінку.</div>';
```

- [ ] **Step 4: Перевірити та зафіксувати**

```bash
node --check app.js
git add index.html category.html style.css app.js
git commit -m "feat: skeleton-завантаження каталогу замість порожнього екрана"
```

---

## Фаза 2 — SEO-видимість і конверсія (місяць)

### Task 4: `robots.txt` + `sitemap.xml` (Python-генератор) 🟠

**Goal:** Дати краулеру карту сайту і правила обходу; згенерувати sitemap із головної, 11 категорій, інфо-сторінок і схем.

**Files:**
- Create: `robots.txt`
- Create: `gen_sitemap.py`
- Generated: `sitemap.xml`

**Acceptance Criteria:**
- [ ] `robots.txt` дозволяє обхід, забороняє `check_photos.html`, вказує `Sitemap:`.
- [ ] `sitemap.xml` валідний XML і містить URL головної, усіх категорій (`category.html?cat=...`), інфо-сторінок, `protection_schemes.html`.
- [ ] `python3 gen_sitemap.py` перегенеровує `sitemap.xml`.

**Verify:** `python3 gen_sitemap.py && python3 -c "import xml.dom.minidom,sys; xml.dom.minidom.parse('sitemap.xml'); print('valid xml')"`

**Steps:**

- [ ] **Step 1: `robots.txt`**

```
User-agent: *
Allow: /
Disallow: /check_photos.html

Sitemap: https://ВАШ-ДОМЕН/sitemap.xml
```

- [ ] **Step 2: `gen_sitemap.py`**

```python
#!/usr/bin/env python3
"""Генерує sitemap.xml. Запуск: python3 gen_sitemap.py"""
BASE = "https://ВАШ-ДОМЕН"  # ← вписати домен
CATS = ["chemicals","import","domestic","weight","materials","drops","soil","pots","insects","animals","sprouts"]
STATIC = ["index.html","protection_schemes.html","delivery.html","contacts.html","returns.html"]

urls = [f"{BASE}/{p}" for p in STATIC]
urls += [f"{BASE}/category.html?cat={c}" for c in CATS]

body = "\n".join(f'  <url><loc>{u}</loc></url>' for u in urls)
xml = '<?xml version="1.0" encoding="UTF-8"?>\n' \
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' \
      f'{body}\n</urlset>\n'
with open("sitemap.xml","w",encoding="utf-8") as f:
    f.write(xml)
print(f"✅ sitemap.xml: {len(urls)} URL")

if __name__ == "__main__":
    pass  # виклик нижче, щоб import не плодив побічних ефектів
```
> Виклик: запустити `python3 gen_sitemap.py` (тіло у модулі виконається; за потреби загорнути в `main()` як у наявних скриптах).

- [ ] **Step 3: Згенерувати і зафіксувати**

```bash
python3 gen_sitemap.py
python3 -c "import xml.dom.minidom; xml.dom.minidom.parse('sitemap.xml'); print('valid')"
git add robots.txt gen_sitemap.py sitemap.xml
git commit -m "feat: robots.txt і генератор sitemap.xml"
```

---

### Task 5: Мета-теги, `<h1>`, унікальні описи, canonical, og:image, noindex 🟠

**Goal:** Закрити on-page SEO-прогалини: `<h1>` на головній і категоріях, унікальний `description` на категорію, `canonical` і `og:image` усюди, мета на `protection_schemes.html`, `noindex` на `check_photos.html`.

**Files:**
- Modify: `index.html`, `category.html`, `protection_schemes.html`, `check_photos.html`
- Create: `assets/og-image.jpg` (1200×630, банер магазину — підготовка власника)

**Acceptance Criteria:**
- [ ] `index.html` і `category.html` мають видимий `<h1>` (на категорії — динамічний за назвою категорії).
- [ ] `category.html` оновлює `page-desc` під категорію (поле `desc` у `PAGE_CAT_CONFIG`).
- [ ] На всіх сторінках є `<link rel="canonical">` і `<meta property="og:image">`.
- [ ] `protection_schemes.html` має `description` + OG; `check_photos.html` має `<meta name="robots" content="noindex,nofollow">`.

**Verify:** `grep -c "rel=\"canonical\"" index.html category.html protection_schemes.html` → по 1; `grep -c "og:image" *.html`; `grep "noindex" check_photos.html`.

**Steps:**

- [ ] **Step 1: `<h1>` на `index.html`** — після відкриття `.container` додати:
```html
<h1 class="page-h1">Інтернет-магазин агротоварів у м. Володимир</h1>
```
Стиль (`style.css`): `.page-h1{font-family:'Playfair Display',serif;font-size:1.5rem;color:var(--green);margin:6px 0 14px;}`

- [ ] **Step 2: Динамічний `<h1>` і `desc` на `category.html`** — додати `<h1 id="page-h1" class="page-h1"></h1>` у `.container`; розширити `PAGE_CAT_CONFIG` полем `desc` і `h1`, у IIFE додати:
```javascript
document.getElementById('page-desc')?.setAttribute('content', cfg.desc || 'Агроном — агротовари, м. Володимир.');
document.addEventListener('DOMContentLoaded', function(){ var h=document.getElementById('page-h1'); if(h) h.textContent = cfg.h1 || cfg.title || 'Каталог'; });
```
(Для кожного ключа `PAGE_CAT_CONFIG` додати `desc:` і `h1:`, напр. `chemicals: { title:'Агрохімікати — Агроном', h1:'Агрохімікати та ЗЗР', desc:'Агрохімікати, добрива та засоби захисту рослин у Володимирі...', placeholder:... }`.)

- [ ] **Step 3: Canonical + og:image у `<head>` усіх сторінок**
```html
<link rel="canonical" href="https://ВАШ-ДОМЕН/index.html">
<meta property="og:image" content="https://ВАШ-ДОМЕН/assets/og-image.jpg">
```
(на `category.html` canonical можна лишити на `category.html`; для точності — оновлювати в IIFE з урахуванням `?cat=`.)

- [ ] **Step 4: Мета на `protection_schemes.html`** — у `<head>` після `<title>`:
```html
<meta name="description" content="Схеми захисту рослин: 54 готові схеми для саду, городу й теплиці — препарати за культурою та стадією. Агроном, м. Володимир.">
<link rel="canonical" href="https://ВАШ-ДОМЕН/protection_schemes.html">
<meta property="og:title" content="Схеми захисту рослин — Агроном">
<meta property="og:image" content="https://ВАШ-ДОМЕН/assets/og-image.jpg">
```

- [ ] **Step 5: `noindex` на `check_photos.html`** — у `<head>`:
```html
<meta name="robots" content="noindex,nofollow">
```

- [ ] **Step 6: Перевірити та зафіксувати**

```bash
grep -c "rel=\"canonical\"" index.html category.html protection_schemes.html
grep "noindex" check_photos.html
node --check app.js
git add index.html category.html protection_schemes.html check_photos.html style.css
git commit -m "feat: h1, унікальні описи категорій, canonical, og:image, noindex"
```

---

### Task 6: Favicon + manifest + theme-color 🟢

**Goal:** Додати брендинг у вкладках і видачі + базові PWA-можливості.

**Files:**
- Create: `favicon.ico`, `assets/icon-192.png`, `assets/icon-512.png`, `apple-touch-icon.png` (графіка — підготовка власника)
- Create: `manifest.json`
- Modify: `<head>` усіх сторінок

**Acceptance Criteria:**
- [ ] У всіх сторінках є `<link rel="icon">`, `<link rel="apple-touch-icon">`, `<meta name="theme-color" content="#2d6a2d">`, `<link rel="manifest">`.
- [ ] `manifest.json` валідний JSON із назвою, іконками, кольорами.

**Verify:** `python3 -c "import json; json.load(open('manifest.json')); print('ok')"`; `grep -c "rel=\"icon\"" index.html`.

**Steps:**

- [ ] **Step 1: `manifest.json`**
```json
{
  "name": "Агроном — агротовари",
  "short_name": "Агроном",
  "start_url": "/index.html",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#2d6a2d",
  "icons": [
    { "src": "assets/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "assets/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 2: Підключення у `<head>` усіх сторінок**
```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#2d6a2d">
<link rel="manifest" href="/manifest.json">
```

- [ ] **Step 3: Перевірити та зафіксувати**
```bash
python3 -c "import json; json.load(open('manifest.json')); print('ok')"
git add manifest.json favicon.ico apple-touch-icon.png assets/ index.html category.html protection_schemes.html
git commit -m "feat: favicon, apple-touch-icon, manifest, theme-color"
```

---

### Task 7: Structured data JSON-LD (LocalBusiness + Product) 🟠

**Goal:** Додати Schema.org: `LocalBusiness` на всіх сторінках (локальна видача/Maps) і `Product`+`Offer` у картках товарів (rich snippets з ціною/наявністю).

**Files:**
- Create: `seo-jsonld.js` (інжект LocalBusiness)
- Modify: `index.html`, `category.html`, `protection_schemes.html` (підключити `seo-jsonld.js`)
- Modify: `app.js` (додати `Product` JSON-LD у `render()` для видимих карток)

**Acceptance Criteria:**
- [ ] На кожній сторінці є `<script type="application/ld+json">` з `LocalBusiness` (name, telephone, address, geo, openingHours).
- [ ] Картки товарів додають `Product`/`Offer` (name, price, priceCurrency UAH, availability).
- [ ] Розмітка проходить Google Rich Results Test без помилок.

**Verify:** `grep -c "application/ld+json" index.html`; вставити URL у https://search.google.com/test/rich-results.

**Steps:**

- [ ] **Step 1: `seo-jsonld.js` — LocalBusiness**
```javascript
(function () {
    var c = window.SITE_CONFIG || {};
    var data = {
        "@context": "https://schema.org", "@type": "LocalBusiness",
        "name": c.name || "Агроном",
        "telephone": c.phoneIntl || "+380634625206",
        "address": { "@type": "PostalAddress", "addressLocality": "Володимир", "addressCountry": "UA", "streetAddress": c.address || "" },
        "url": location.origin,
        "openingHours": "Mo-Sa 09:00-18:00"
    };
    var s = document.createElement('script');
    s.type = 'application/ld+json';
    s.textContent = JSON.stringify(data);
    document.head.appendChild(s);
})();
```
Підключити після `site-config.js`: `<script src="seo-jsonld.js"></script>`.

- [ ] **Step 2: `Product` JSON-LD у `render()`** (`app.js`) — наприкінці `render()`, після `grid.innerHTML = cards.join('')`:
```javascript
    // Product structured data для видимих карток (для rich snippets)
    var ldOld = document.getElementById('products-ldjson');
    if (ldOld) ldOld.remove();
    var ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.id = 'products-ldjson';
    ld.textContent = JSON.stringify(slice.map(function (p) {
        return {
            "@context": "https://schema.org", "@type": "Product",
            "name": p.n,
            "image": p.img || undefined,
            "offers": {
                "@type": "Offer", "price": p.p, "priceCurrency": "UAH",
                "availability": p.inStock !== false
                    ? "https://schema.org/InStock" : "https://schema.org/OutOfStock"
            }
        };
    }));
    document.head.appendChild(ld);
```

- [ ] **Step 3: Перевірити та зафіксувати**
```bash
node --check app.js && node --check seo-jsonld.js
git add seo-jsonld.js app.js index.html category.html protection_schemes.html
git commit -m "feat: JSON-LD LocalBusiness і Product для rich snippets"
```

---

### Task 8: Пререндер каталогу (build-скрипт) + noscript-фолбек 🔴

**Goal:** Зробити товарний контент видимим без виконання JS: на етапі білда вставляти у `index.html`/`category.html` готовий HTML-список товарів (або `<noscript>`-фолбек із посиланнями), щоб Googlebot та інші боти бачили каталог.

**Files:**
- Create: `prerender.py`
- Generated: оновлені `index.html`, `category-*.html` (або вставлений блок у `#grid`/`<noscript>`)

**Acceptance Criteria:**
- [ ] У вихідному HTML (до JS) присутні назви/ціни товарів (мінімум — у `<noscript>`).
- [ ] JS-рендер не конфліктує з пререндером (перший `render()` перезаписує блок).
- [ ] `python3 prerender.py` ідемпотентний (повторний запуск не дублює блок).

**Verify:** `python3 prerender.py && grep -c "noscript" index.html` (>0) і перевірити, що у `#grid`/`<noscript>` є назви товарів: `grep -o "грн" index.html | head`.

**Steps:**

- [ ] **Step 1: `prerender.py` — вставка noscript-каталогу**

```python
#!/usr/bin/env python3
"""Вставляє у index.html SEO-видимий список товарів у <noscript>.
Маркери <!--PRERENDER-START--> ... <!--PRERENDER-END--> роблять запуск ідемпотентним."""
import json, re

with open("products.json", encoding="utf-8") as f:
    products = [p for p in json.load(f) if p.get("inStock") is not False]

items = "".join(
    f'<li><a href="category.html?cat=">{p["n"]} — {p["p"]} грн</a></li>'
    for p in products[:2339]
)
block = ("<!--PRERENDER-START-->\n<noscript><ul class=\"seo-catalog\">"
         f"{items}</ul></noscript>\n<!--PRERENDER-END-->")

with open("index.html", encoding="utf-8") as f:
    html = f.read()

pat = re.compile(r"<!--PRERENDER-START-->.*?<!--PRERENDER-END-->", re.S)
if pat.search(html):
    html = pat.sub(block, html)
else:
    html = html.replace('<div id="grid" class="grid">',
                        block + '\n<div id="grid" class="grid">', 1)

with open("index.html", "w", encoding="utf-8") as f:
    f.write(html)
print(f"✅ Пререндер: {len(products)} товарів у noscript")
```
> Це мінімально-достатній фолбек. Повноцінний SSG (рендер реальних `.card` у `#grid` з прибиранням першим `render()`) — опційне розширення цього ж скрипта.

- [ ] **Step 2: Стиль `seo-catalog`** (`style.css`) — невидимий візуально, але в DOM:
```css
.seo-catalog { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
```

- [ ] **Step 3: Інтегрувати у білд-процес** — додати запуск у README/Makefile поряд із `generate_keywords.py`/`sync_images.py`; запускати перед деплоєм після кожної зміни `products.json`.

- [ ] **Step 4: Перевірити та зафіксувати**
```bash
python3 prerender.py
grep -c "noscript" index.html
git add prerender.py index.html style.css
git commit -m "feat: пререндер каталогу (noscript-фолбек) для індексації"
```

---

### Task 9: Сортування, фільтри (ціна/наявність), стан out-of-stock 🟠

**Goal:** Додати сортування за ціною/назвою і фільтр наявності; показувати out-of-stock приглушено з бейджем замість повного приховування.

**Files:**
- Modify: `index.html`, `category.html` (панель сортування/фільтра)
- Modify: `app.js` (`applyFilters`, `render`)
- Modify: `style.css`, `protection_schemes.html` (узгодити стан наявності)

**Acceptance Criteria:**
- [ ] Є селект сортування: «За популярністю / Дешевші спочатку / Дорожчі спочатку / За назвою».
- [ ] Є перемикач «Показувати тільки в наявності» (за замовчуванням показувати все, out-of-stock — приглушено з бейджем «Немає в наявності»).
- [ ] Сортування і фільтр працюють разом із пошуком і категорією.

**Verify:** у браузері: вибір «Дешевші спочатку» сортує сітку за зростанням ціни; вимкнення фільтра наявності показує сірі картки з бейджем.

**Steps:**

- [ ] **Step 1: Панель керування** (над `#grid` у `index.html`/`category.html`)
```html
<div class="catalog-controls">
  <label>Сортування:
    <select id="sort-select" onchange="setSort(this.value)">
      <option value="default">За популярністю</option>
      <option value="price-asc">Спочатку дешевші</option>
      <option value="price-desc">Спочатку дорожчі</option>
      <option value="name">За назвою</option>
    </select>
  </label>
  <label><input type="checkbox" id="instock-only" onchange="applyFilters()"> Тільки в наявності</label>
</div>
```

- [ ] **Step 2: Логіка сортування/фільтра** (`app.js`)
```javascript
let currentSort = 'default';
function setSort(v){ currentSort = v; visibleCount = 20; applyFilters(); }

function sortProducts(arr){
    var a = arr.slice();
    if (currentSort === 'price-asc')  a.sort((x,y)=> x.p - y.p);
    else if (currentSort === 'price-desc') a.sort((x,y)=> y.p - x.p);
    else if (currentSort === 'name') a.sort((x,y)=> x.n.localeCompare(y.n,'uk'));
    return a;
}
```
У `applyFilters()`: змінити фільтр `inStock`, щоб залежав від перемикача, і застосувати сортування:
```javascript
    const instockOnly = !!document.getElementById('instock-only')?.checked;
    const filtered = products.filter(p => {
        const matchMainCat = (currentCat === 'Всі' || p.c === currentCat);
        const matchSubCat  = (currentSubCat === 'Всі' || p.b === currentSubCat);
        const searchText = (p.n + ' ' + (p.keywords || '')).toLowerCase();
        const matchSearch = searchText.includes(query);
        const stockOk = instockOnly ? (p.inStock !== false) : true;
        return matchMainCat && matchSubCat && matchSearch && stockOk;
    });
    render(sortProducts(filtered));
```

- [ ] **Step 3: Бейдж out-of-stock у `render()`** — у `slice.map`, перед кнопкою «Додати», для `p.inStock === false`: вивести замість кнопки бейдж `<div class="oos-badge">Немає в наявності</div>` і додати клас `card--oos` до картки. Стиль: `.card--oos{opacity:.55} .oos-badge{background:#f8d7da;color:#721c24;border-radius:8px;padding:8px;font-weight:700;font-size:.8rem;}`

- [ ] **Step 4: Перевірити та зафіксувати**
```bash
node --check app.js
git add index.html category.html app.js style.css
git commit -m "feat: сортування за ціною, фільтр наявності, бейдж out-of-stock"
```

---

### Task 10: Покращення пошуку (debounce + токенізація) 🟡

**Goal:** Зробити пошук швидким (debounce) і релевантним (пошук за окремими словами, а не цілим підрядком), щоб запити типу «від колорадського жука» знаходили товар.

**Files:**
- Modify: `app.js` (`applyFilters` + новий `debounce`)
- Modify: `index.html`, `category.html` (`oninput` → debounced)

**Acceptance Criteria:**
- [ ] Введення тексту не ре-фільтрує частіше ніж раз на ~250 мс.
- [ ] Запит з кількох слів знаходить товар, що містить усі слова в `n`+`keywords` (AND-логіка по токенах).
- [ ] «колорад», «колорадський жук» повертають релевантні інсектициди.

**Verify:** Node-ассерт токен-матчу (нижче) → PASS; у браузері пошук «колорадський жук» дає ≥1 результат.

**Steps:**

- [ ] **Step 1: Чиста функція матчу + debounce** (`app.js`)
```javascript
function matchTokens(text, query){
    var q = query.toLowerCase().trim();
    if (!q) return true;
    var tokens = q.split(/\s+/);
    return tokens.every(function(t){ return text.indexOf(t) !== -1; });
}
function debounce(fn, ms){ var t; return function(){ clearTimeout(t); t=setTimeout(fn, ms); }; }
const debouncedFilter = debounce(applyFilters, 250);
```
У `applyFilters()` замінити `searchText.includes(query)` на `matchTokens(searchText, query)`.

- [ ] **Step 2: Node-перевірка логіки**
```bash
node -e '
function matchTokens(text,q){q=q.toLowerCase().trim();if(!q)return true;return q.split(/\s+/).every(t=>text.indexOf(t)!==-1);}
var t="антиколорад, інсектицид від колорадського жука 10мл";
console.log("колорадський жук →", matchTokens(t,"колорадський жук"));
console.log("від попелиці →", matchTokens(t,"від попелиці"));
' # очікувано: true, false
```

- [ ] **Step 3: `oninput` → debounced** у `index.html`/`category.html`: `oninput="debouncedFilter()"`.

- [ ] **Step 4: Зафіксувати**
```bash
node --check app.js
git add app.js index.html category.html
git commit -m "feat: debounce і токенізований пошук (багатослівні запити)"
```

---

### Task 11: Дефолт/крок ваги за типом товара + швидкі кнопки кг 🟡

**Goal:** Прибрати нереалістичний дефолт 0.05 кг для польових культур: стартувати з 1 кг (крок 0.5–1 кг) для важких позицій, додати швидкі кнопки «0.5 / 1 / 5 / 10 кг».

**Files:**
- Modify: `app.js` (`render` вагова картка, `openProductModal`)

**Acceptance Criteria:**
- [ ] Для вагових товарів дефолт ≥ 1 кг (крок 0.5 кг), для дрібнофасованих лишається дрібний крок.
- [ ] Є кнопки швидкого вибору кількості.

**Verify:** у браузері відкрити ваговий товар → дефолт 1 кг, кнопки «0.5/1/5/10» проставляють значення.

**Steps:**

- [ ] **Step 1: Винести дефолти у хелпер** (`app.js`)
```javascript
function weightDefaults(p){
    // дрібнофасоване (містить грами або «насіння вагове» дрібне) — менший крок
    var small = /\b\d+\s?г\b/i.test(p.n);
    return small ? { val: 0.05, step: 0.05, min: 0.05 } : { val: 1, step: 0.5, min: 0.5 };
}
```
Застосувати `weightDefaults(p)` у генерації вагового блоку `render()` (замінити жорсткі `value="0.05" step="0.05" min="0.05"`) і в модалці.

- [ ] **Step 2: Швидкі кнопки** у ваговому блоці:
```javascript
'<div class="qty-quick">' +
  [0.5,1,5,10].map(function(v){ return '<button type="button" onclick="document.getElementById(\'qty-'+idx+'\').value='+v+'">'+v+' кг</button>'; }).join('') +
'</div>'
```
Стиль: `.qty-quick{display:flex;gap:4px;justify-content:center;margin:6px 0}.qty-quick button{border:1px solid #c8e0c8;background:#f0f8f0;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:.75rem}`

- [ ] **Step 3: Зафіксувати**
```bash
node --check app.js
git add app.js style.css
git commit -m "feat: розумний дефолт ваги і швидкі кнопки кг"
```

---

## Фаза 3 — Технічний борг, безпека, доступність

### Task 12: Security headers / CSP (`_headers`) 🟡

**Goal:** Додати security-заголовки на рівні хостингу (Cloudflare Pages/Netlify).

**Files:**
- Create: `_headers`

**Acceptance Criteria:**
- [ ] `_headers` задає CSP (allowlist: self, fonts.googleapis.com, fonts.gstatic.com, upload.wikimedia.org, домен Worker), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`.

**Verify:** після деплою — `curl -I https://ВАШ-ДОМЕН` показує заголовки; або перевірити на securityheaders.com.

**Steps:**

- [ ] **Step 1: `_headers`**
```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: default-src 'self'; img-src 'self' data: https://upload.wikimedia.org; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self' https://agro-order.ВАШ-ЛОГІН.workers.dev
```
> Після Task 16 (відмова від inline) можна прибрати `'unsafe-inline'` для `script-src`. До того лишити (інакше зламає інлайн-onclick).

- [ ] **Step 2: Зафіксувати**
```bash
git add _headers
git commit -m "feat: security headers і CSP через _headers"
```

---

### Task 13: Дизайн-система — єдина палітра, дедуп CSS 🟡

**Goal:** Звести зелені до одного токена `var(--green)`, прибрати дублікати правил у `style.css`, протягнути `:root` у `protection_schemes.html`.

**Files:**
- Modify: `style.css`, `app.js`, `seasonal-helper.js`, `protection_schemes.html`

**Acceptance Criteria:**
- [ ] У `style.css` немає повторних визначень `.card h3`, `.price`, `.btn`.
- [ ] Хардкоди `#27ae60` і `#2e7d32` для зеленого замінені на `var(--green)` (де семантично доречно).
- [ ] `protection_schemes.html` використовує `:root`-змінні.

**Verify:** `grep -n "#27ae60\|#2e7d32" app.js style.css | wc -l` помітно зменшується; `grep -c "\.card h3" style.css` → 1.

**Steps:**

- [ ] **Step 1: Об'єднати дублікати** у `style.css` (рядки ~47–58 і ~86–89): лишити одне правило `.card h3`, одне `.price`, одне `.btn`; видалити «приклеєний» до `.btn:active` рядок.
- [ ] **Step 2: Замінити хардкоди** `#27ae60`→`var(--green)` у `app.js`, `seasonal-helper.js` (де це акцент/кнопка), прибрати fallback `var(--green,#27ae60)`.
- [ ] **Step 3: `:root` у `protection_schemes.html`** — на початку `<style>` додати `:root{--green:#2d6a2d;--gl:#4a9c4a}` і замінити повтори `#2d6a2d` на `var(--green)`.
- [ ] **Step 4: Зафіксувати**
```bash
node --check app.js && node --check seasonal-helper.js
git add style.css app.js seasonal-helper.js protection_schemes.html
git commit -m "refactor: єдина палітра і дедуп CSS-правил"
```

---

### Task 14: Доступність — модалки (Esc/focus-trap/lock) + aria/label 🟡

**Goal:** Зробити модалки і керування доступними з клавіатури та для скрінрідерів.

**Files:**
- Modify: `app.js` (модалки товару/замовлення), `cart.js`, `index.html`, `category.html`

**Acceptance Criteria:**
- [ ] Модалки (cart, product, order) закриваються по `Esc`, блокують скрол `body`, повертають фокус.
- [ ] Іконкові кнопки (✕, +/−, 🛒, 🗑️) мають `aria-label`; поле пошуку має `<label>`/`aria-label`; `alt` у модалці товару = назва товару.

**Verify:** клавіатурою: відкрити модалку → `Esc` закриває; за відкритої модалки `body` не скролиться; перевірити `aria-label` через DevTools/axe.

**Steps:**

- [ ] **Step 1: Спільні хелпери модалки** (`app.js`)
```javascript
let _modalKeyHandler = null;
function lockModal(closeFn){
    document.body.style.overflow = 'hidden';
    _modalKeyHandler = function(e){ if (e.key === 'Escape') closeFn(); };
    document.addEventListener('keydown', _modalKeyHandler);
}
function unlockModal(){
    document.body.style.overflow = '';
    if (_modalKeyHandler) document.removeEventListener('keydown', _modalKeyHandler);
    _modalKeyHandler = null;
}
```
Викликати `lockModal(closeProductModal)`/`lockModal(closeOrderModal)` при відкритті, `unlockModal()` у відповідних `close*`. Для `cart.js`/`openCart` — аналогічно.

- [ ] **Step 2: aria-label і label** — додати `aria-label` до кнопок ✕ (`Закрити`), +/− (`Збільшити/Зменшити кількість`), `#cart-float` (`Відкрити кошик`), 🗑️ (`Очистити кошик`); у `index.html`/`category.html` додати `<label for="search" class="sr-only">Пошук товарів</label>` (клас `.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}`); у модалці товару `app.js` змінити `alt=""` на `alt="${p.n}"`.
- [ ] **Step 3: Зафіксувати**
```bash
node --check app.js && node --check cart.js
git add app.js cart.js index.html category.html style.css
git commit -m "fix(a11y): Esc/focus/lock у модалках, aria-label, label пошуку"
```

---

### Task 15: XSS-hardening — escapeHTML для innerHTML, відмова від inline onclick 🟢

**Goal:** Захистити рендер від поломки/інжекту через дані товарів: екранувати значення у всіх `innerHTML`; передавати індекс замість склейки рядків у onclick.

**Files:**
- Modify: `app.js`, `protection_schemes.html`, `seasonal-helper.js`

**Acceptance Criteria:**
- [ ] Введено спільний `escapeHTML()`; застосовано до `p.n`, `p.annot`, `p.b`, `treatment.problem`, `treatment.stage`, `stage.problem` у рендері карток/модалок/схем.
- [ ] Картки/чипи передають індекс у обробник, а назву/ціну беруть з масиву (як уже зроблено для `openProductModal(idx)`).

**Verify:** `node --check` усіх файлів; товар з назвою, що містить `<b>`/лапки, рендериться як текст і кнопка «Додати» працює.

**Steps:**

- [ ] **Step 1: `escapeHTML()`** (`app.js`, експортувати в глобал для інших файлів)
```javascript
function escapeHTML(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
window.escapeHTML = escapeHTML;
```
- [ ] **Step 2: Застосувати** у `render()` (`<h3>${escapeHTML(p.n)}</h3>`), `openProductModal` (`annot`, `p.n`), `protection_schemes.html` (`renderTreatment`, `openProductCard`), `seasonal-helper.js` (`renderStageCard`: `stage.stage`, `stage.problem`).
- [ ] **Step 3: Перевести onclick на індекс** — у `render()` кнопки `addToCart`/`addWeightToCart` передавати `idx`, у обробнику діставати `renderedProducts[idx]` (узгодити сигнатури).
- [ ] **Step 4: Зафіксувати**
```bash
node --check app.js && node --check seasonal-helper.js
git add app.js protection_schemes.html seasonal-helper.js
git commit -m "fix(security): escapeHTML у innerHTML і передача індексу замість склейки"
```

---

### Task 16: Локальний хостинг шрифтів і лого Telegram 🟢

**Goal:** Прибрати залежність від Google Fonts і Wikimedia (приватність + надійність кнопки замовлення).

**Files:**
- Create: `assets/fonts/` (woff2 Playfair+Nunito), `assets/telegram.svg`
- Modify: `style.css` (`@font-face`), усі `<head>` (прибрати Google Fonts link), `cart.js` (локальний SVG)

**Acceptance Criteria:**
- [ ] Шрифти і лого Telegram вантажаться з власного домену; зовнішніх запитів до googleapis/wikimedia немає.

**Verify:** DevTools → Network → немає запитів до `fonts.googleapis.com`/`upload.wikimedia.org`.

**Steps:**

- [ ] **Step 1:** завантажити woff2 шрифтів у `assets/fonts/`, додати `@font-face` у `style.css`, прибрати `<link ...fonts.googleapis...>` з усіх сторінок.
- [ ] **Step 2:** зберегти лого Telegram у `assets/telegram.svg`, у `cart.js` замінити `src="https://upload.wikimedia.org/..."` на `src="assets/telegram.svg"`.
- [ ] **Step 3: Зафіксувати**
```bash
node --check cart.js
git add assets/ style.css cart.js index.html category.html protection_schemes.html
git commit -m "feat: локальні шрифти і лого Telegram (приватність/надійність)"
```

---

### Task 17: Уніфікація кошика + пагінація 🟡

**Goal:** Звести поведінку/стиль `#cart-float` до одного джерела і замінити «Показати ще» на нескінченний скрол із append (без перебудови всієї сітки).

**Files:**
- Modify: `app.js`, `seasonal-helper.js`, `protection_schemes.html`, `style.css`

**Acceptance Criteria:**
- [ ] `#cart-float` має однаковий `display` і колір на всіх сторінках; лічильник означає одне і те саме скрізь.
- [ ] Прокрутка вниз довантажує наступні 20 карток через `IntersectionObserver` (append), а не повний ре-рендер.

**Verify:** перехід index↔protection_schemes — кнопка кошика не «стрибає»; скрол великої категорії додає картки без миготіння.

**Steps:**

- [ ] **Step 1:** єдина функція оновлення кошика (винести у `cart.js`), скрізь викликати її; узгодити `display:'flex'` і колір (прибрати інлайн зелений у `protection_schemes.html:701`).
- [ ] **Step 2:** додати sentinel-елемент після `#grid` і `IntersectionObserver`, який викликає `showMore()`; у `render()` додати режим append (рендерити лише нові картки `slice(prevCount, visibleCount)`).
- [ ] **Step 3: Зафіксувати**
```bash
node --check app.js && node --check cart.js && node --check seasonal-helper.js
git add app.js cart.js seasonal-helper.js protection_schemes.html style.css
git commit -m "refactor: єдиний кошик і нескінченний скрол замість Показати ще"
```

---

### Task 18: Полірування — console, confirm/alert, localeCompare, textarea 🟢

**Goal:** Косметика та гігієна: прибрати/заглушити `console.*`, замінити нативні `confirm/alert` на стилізовані тости/модалки, виправити сортування підкатегорій і whitespace у textarea.

**Files:**
- Modify: `app.js`, `seasonal-helper.js`, `protection_schemes.html`

**Acceptance Criteria:**
- [ ] Діагностичні `console.*` прибрані або під прапорцем DEBUG.
- [ ] `confirm`/`alert` (`app.js:491,565,585`) замінені на in-app UI (переюз `showOrderSuccess`/модалки).
- [ ] `subCats.sort()` → `sort((a,b)=>a.localeCompare(b,'uk'))`; у `#ord-comment` textarea прибрано внутрішні пробіли (порожнє значення за замовчуванням).

**Verify:** `grep -rn "console\.\(log\|warn\)" app.js seasonal-helper.js protection_schemes.html` → лише під DEBUG; `node --check app.js`.

**Steps:**

- [ ] **Step 1:** обгорнути логи: `const DEBUG=false;` + `if(DEBUG) console.log(...)` (або видалити інформаційні).
- [ ] **Step 2:** замінити `alert("Кошик очищено!")`/`confirm(...)` у `clearCart` на стилізовану підтверджувальну модалку; `alert("Вкажіть коректну кількість")` → `showOrderError`-подібний тост.
- [ ] **Step 3:** `app.js:345` `subCats.sort()` → `subCats.sort((a,b)=>a.localeCompare(b,'uk'))`; у розмітці `<textarea id="ord-comment" ...></textarea>` прибрати перенос/пробіли між тегами.
- [ ] **Step 4: Зафіксувати**
```bash
node --check app.js && node --check seasonal-helper.js
git add app.js seasonal-helper.js protection_schemes.html
git commit -m "chore: прибрати console, замінити confirm/alert, localeCompare, textarea"
```

---

### Task 19: Сезонний помічник — прибрати CLS (setTimeout) 🟢

**Goal:** Прибрати стрибок макета: ініціалізувати помічник без штучного `setTimeout(300)` і зарезервувати місце контейнера.

**Files:**
- Modify: `seasonal-helper.js`, `index.html`/`category.html`, `style.css`

**Acceptance Criteria:**
- [ ] Блок помічника не зсуває каталог при появі (зарезервована `min-height`).
- [ ] Ініціалізація без штучної 300мс затримки (рендер після `loadSchemes`, синхронно з `DOMContentLoaded`).

**Verify:** Lighthouse → CLS на головній зменшується; візуально каталог не «стрибає».

**Steps:**

- [ ] **Step 1:** у `#seasonal-helper-container` задати `min-height` плейсхолдера (`style.css`).
- [ ] **Step 2:** прибрати `setTimeout(init, 300)` у `seasonal-helper.js` — викликати `init()` напряму в `DOMContentLoaded` (схеми вже вантажаться `await loadSchemes()`).
- [ ] **Step 3: Зафіксувати**
```bash
node --check seasonal-helper.js
git add seasonal-helper.js index.html category.html style.css
git commit -m "fix(perf): прибрати CLS сезонного помічника"
```

---

## Task 0: Ініціалізація git і бекап (ВИКОНАТИ ПЕРШИМ) 🔴

**Goal:** Завести версіонування як страховку перед серією змін (репозиторій зараз не під git).

**Files:** Create: `.gitignore`

**Acceptance Criteria:**
- [ ] `git status` працює; перший коміт містить поточний стан.
- [ ] `.gitignore` виключає системне сміття (`.DS_Store`, тимчасові).

**Verify:** `git log --oneline -1` показує початковий коміт.

**Steps:**

- [ ] **Step 1:**
```bash
cd /mnt/d/ruslan/AGRO3
git init
printf "%s\n" ".DS_Store" "Thumbs.db" "*.log" "node_modules/" > .gitignore
git add -A
git commit -m "chore: початковий стан перед ремонтом (baseline)"
```

---

## Послідовність виконання (залежності)

```
Task 0 (git) → передумова для всіх комітів
Фаза 1: 1 (footer) → 2 (інфо-сторінки, залежить від footer/site-config) ; 3 (skeleton) — паралельно
Фаза 2: 4 (robots/sitemap) ; 5 (мета/h1) ; 6 (favicon) ; 7 (JSON-LD, залежить від 1/site-config) ; 8 (пререндер) ; 9 (сорт/фільтр) ; 10 (пошук) ; 11 (вага)
Фаза 3: 12 (CSP) ; 13 (палітра) ; 14 (a11y) ; 15 (escapeHTML) ; 16 (локальні шрифти) ; 17 (кошик/пагінація) ; 18 (поліш) ; 19 (CLS)
```
Критичний шлях для виручки/видимості: **Task 0 → Фаза 1 (1,2,3) → Task 8 (пререндер) → Task 4,5,7 (SEO)**. Решта — підвищення якості.

> **Найбільший за обсягом блок** — повноцінні окремі сторінки товарів зі Schema.org Product (згадані в аудиті як critical для long-tail). Тут реалізовано мінімум через пререндер (Task 8) + Product JSON-LD у картках (Task 7). Якщо потрібні реальні URL-сторінки на кожен товар — це окремий під-план (генерація `tovar/<slug>.html` build-скриптом), варто планувати окремо.
