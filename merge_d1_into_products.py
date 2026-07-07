#!/usr/bin/env python3
"""
Оновлює поля img, annot, keywords в products.json значеннями з D1,
співставляючи товари за полем slug. Решта полів (n, p, c, b, inStock)
залишаються без змін.

Використання:
    python merge_d1_into_products.py

Очікує в тій самій папці:
    - products.json      (поточний файл сайту)
    - d1_export.json     (результат wrangler d1 execute --json, обгорнутий
                          у стандартний формат: [{"results":[...]}])

Результат: products_merged.json (перевірте і перейменуйте на products.json)
"""

import json
import sys
from pathlib import Path

PRODUCTS_FILE = Path("products.json")
D1_EXPORT_FILE = Path("d1_export.json")
OUTPUT_FILE = Path("products_merged.json")


def load_json(path: Path):
    if not path.exists():
        print(f"❌ Не знайдено файл: {path}")
        sys.exit(1)

    raw = path.read_bytes()

    # Визначаємо кодування за BOM (PowerShell '>' зазвичай пише UTF-16 LE)
    if raw.startswith(b"\xff\xfe"):
        text = raw.decode("utf-16-le")
    elif raw.startswith(b"\xfe\xff"):
        text = raw.decode("utf-16-be")
    elif raw.startswith(b"\xef\xbb\xbf"):
        text = raw.decode("utf-8-sig")
    else:
        text = raw.decode("utf-8")

    # Прибираємо BOM-символ, навіть якщо він потрапив усередину тексту
    # (типово для PowerShell '>' поверх виводу wrangler, який сам додає BOM)
    text = text.lstrip("\ufeff")

    return json.loads(text)


def main():
    products = load_json(PRODUCTS_FILE)
    d1_raw = load_json(D1_EXPORT_FILE)

    # wrangler --json повертає список об'єктів виду [{"results": [...]}]
    if isinstance(d1_raw, list) and d1_raw and "results" in d1_raw[0]:
        d1_rows = d1_raw[0]["results"]
    elif isinstance(d1_raw, dict) and "results" in d1_raw:
        d1_rows = d1_raw["results"]
    else:
        d1_rows = d1_raw  # вже плаский список рядків

    # Індекс по slug для швидкого пошуку
    d1_by_slug = {}
    for row in d1_rows:
        slug = row.get("slug")
        if not slug:
            continue
        d1_by_slug[slug] = row

    updated = 0
    not_found = []

    for item in products:
        slug = item.get("slug")
        if not slug:
            continue
        d1_row = d1_by_slug.get(slug)
        if not d1_row:
            not_found.append(slug)
            continue

        changed = False

        # annot <- annotation
        new_annot = d1_row.get("annotation")
        if new_annot and new_annot != item.get("annot"):
            item["annot"] = new_annot
            changed = True

        # keywords <- keywords
        new_keywords = d1_row.get("keywords")
        if new_keywords and new_keywords != item.get("keywords"):
            item["keywords"] = new_keywords
            changed = True

        # img <- перше зображення зі списку images (розділені "|")
        images_raw = d1_row.get("images")
        if images_raw:
            first_image = images_raw.split("|")[0].strip()
            if first_image and first_image != item.get("img"):
                item["img"] = first_image
                changed = True

        if changed:
            updated += 1

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(products, f, ensure_ascii=False, indent=1)

    print(f"✅ Оновлено товарів: {updated}")
    print(f"⚠️  Не знайдено в D1 (за slug): {len(not_found)}")
    if not_found:
        print("   Приклади:", not_found[:10])
    print(f"📄 Результат збережено у {OUTPUT_FILE}")
    print("   Перевірте файл і, якщо все гаразд, перейменуйте його на products.json")


if __name__ == "__main__":
    main()
