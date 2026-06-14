#!/usr/bin/env python3
"""Вставляє у index.html SEO-видимий список товарів у <noscript>.
Маркери <!--PRERENDER-START--> ... <!--PRERENDER-END--> роблять запуск ідемпотентним."""
import json, re, html, os, subprocess
from urllib.parse import quote

DB_NAME = "agronom-db"
# Запасна мапа db_name→key — якщо D1 недоступний (запуск без токена/мережі).
FALLBACK_CAT_KEY = {
    "АГРОХІМІКАТИ": "chemicals", "НАСІННЯ ІМПОРТНЕ": "import",
    "НАСІННЯ ВІТЧИЗНЯНЕ": "domestic", "ПРОТИ КОМАХ": "insects",
    "НАСІННЯ ВАГОВЕ": "weight", "МАТЕРІАЛИ": "materials",
    "КРАПЕЛЬНЕ ЗРОШУВАННЯ": "drops", "ДЛЯ ТВАРИН": "animals",
    "ГРУНТ": "soil", "ГОРЩИКИ": "pots", "РОЗСАДА": "sprouts",
}


def fetch_cat_key():
    """Мапа назва категорії (поле "c") → ключ ?cat= з D1 (categories). Помилка → FALLBACK."""
    if not os.environ.get("CLOUDFLARE_API_TOKEN"):
        return FALLBACK_CAT_KEY
    wrangler = os.environ.get("WRANGLER", "wrangler")
    try:
        out = subprocess.run(
            [wrangler, "d1", "execute", DB_NAME, "--remote", "--json",
             "--command", "SELECT db_name, key FROM categories"],
            capture_output=True, text=True, timeout=60,
        )
        if out.returncode != 0:
            return FALLBACK_CAT_KEY
        rows = json.loads(out.stdout)[0]["results"]
        m = {r["db_name"]: r["key"] for r in rows if r.get("db_name") and r.get("key")}
        return m or FALLBACK_CAT_KEY
    except Exception:
        return FALLBACK_CAT_KEY


CAT_KEY = fetch_cat_key()

with open("products.json", encoding="utf-8") as f:
    products = [p for p in json.load(f) if p.get("inStock") is not False]

def li(p):
    slug = p.get("slug")
    if slug:
        href = "p/" + slug                       # сторінка товару (SEO)
    else:
        key = CAT_KEY.get(p.get("c", ""), "")
        href = "category.html?cat=" + quote(key) if key else "index.html"
    name = html.escape(str(p["n"]))
    price = html.escape(str(p["p"]))
    return f'<li><a href="{href}">{name} — {price} грн</a></li>'

# Лінки на КАТЕГОРІЇ, а не 2253 товарні <li>: усі товари вже покриває sitemap.xml
# (functions/sitemap.xml.js, з D1). Так головна легша на ~310КБ. CAT_KEY: назва → ?cat=key.
cat_items = sorted(set(CAT_KEY.items()))
items = "".join(
    f'<li><a href="category.html?cat={quote(k)}">{html.escape(n)}</a></li>' for n, k in cat_items
)
# + посилання на HTML-карту каталогу — щоб Googlebot знайшов усі товарні /p/ сторінки
items += '<li><a href="/katalog">Повний каталог товарів</a></li>'
block = ("<!--PRERENDER-START-->\n<noscript><ul class=\"seo-catalog\">"
         f"{items}</ul></noscript>\n<!--PRERENDER-END-->")

with open("index.html", encoding="utf-8") as f:
    doc = f.read()

pat = re.compile(r"<!--PRERENDER-START-->.*?<!--PRERENDER-END-->", re.S)
if pat.search(doc):
    doc = pat.sub(block, doc)
else:
    doc = doc.replace('<div id="grid" class="grid">',
                      block + '\n<div id="grid" class="grid">', 1)

with open("index.html", "w", encoding="utf-8") as f:
    f.write(doc)
print(f"Пререндер: {len(cat_items)} категорій-лінків у noscript (товари — у sitemap.xml), {len(products)} у наявності")
