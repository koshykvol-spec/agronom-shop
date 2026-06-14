import json
import os
import re

PRODUCTS_FILE = 'products.json'
IMG_MAP_FILE = 'img-map.json'
FOLDER_A = 'IMG_U7'

# Словник для транслітерації (спрощений для максимального збігу)
TRANSLIT_DICT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'ґ': 'g', 'д': 'd', 'е': 'e', 'є': 'e', 
    'ж': 'zh', 'з': 'z', 'и': 'y', 'і': 'i', 'ї': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 
    'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 
    'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ь': '', 'ю': 'yu', 'я': 'ya',
    'x': 'h', 'c': 'k' # Додаткові заміни для гнучкості
}

def transliterate(text):
    """Перетворює кирилицю на латиницю"""
    text = text.lower()
    result = ''
    for char in text:
        result += TRANSLIT_DICT.get(char, char)
    return result

def get_keywords(text):
    """Витягує слова з тексту: оригінальні + транслітеровані.
    Числові формули виду 5-5-5 або 5-10-15 зберігаються як єдиний токен."""
    # Спочатку витягуємо числові формули (наприклад, 5-5-5, 5-10-15)
    words = re.findall(r'[0-9]+(?:-[0-9]+)+|[a-zа-яіїєґ0-9]+', text.lower())
    all_keywords = set(words)
    # Додаємо транслітеровані варіанти кожного слова
    for w in words:
        all_keywords.add(transliterate(w))
    return all_keywords

def main():
    if not os.path.exists(PRODUCTS_FILE):
        print(f"❌ Файл {PRODUCTS_FILE} не знайдено!")
        return

    with open(PRODUCTS_FILE, 'r', encoding='utf-8-sig') as f:
        products = json.load(f)

    if os.path.exists(IMG_MAP_FILE):
        with open(IMG_MAP_FILE, 'r', encoding='utf-8') as f:
            img_map = json.load(f)
    else:
        img_map = {}

    if not os.path.exists(FOLDER_A):
        os.makedirs(FOLDER_A)
        print(f"📁 Папка {FOLDER_A} створена. Покладіть туди фото.")
        return

    new_photos = [f for f in os.listdir(FOLDER_A) if f.lower().endswith(('.webp', '.jpg', '.png', '.jpeg'))]
    
    if not new_photos:
        print(f"ℹ️ У папці {FOLDER_A} немає нових фото.")
        return

    print(f"🔍 Знайдено {len(new_photos)} фото. Починаю пошук збігів...")

    added = 0
    for photo_name in new_photos:
        photo_stem = os.path.splitext(photo_name)[0]
        photo_words = get_keywords(photo_stem)
        
        best_match = None
        max_overlap = 0

        for p in products:
            product_name = p['n']
            product_words = get_keywords(product_name)
            
            overlap = len(photo_words.intersection(product_words))
            
            if overlap > max_overlap:
                max_overlap = overlap
                best_match = product_name

        if best_match and max_overlap >= 1:
            # Зберігаємо шлях у img-map.json
            img_map[best_match] = f"{FOLDER_A}/{photo_name}"
            print(f"✅ Знайдено: {photo_name}  -->  {best_match}")
            added += 1
        else:
            print(f"❓ Не вдалося знайти товар для: {photo_name}")

    with open(IMG_MAP_FILE, 'w', encoding='utf-8') as f:
        json.dump(img_map, f, ensure_ascii=False, indent=2)

    print(f"\n🚀 Готово! Оновлено записів у карті: {added}")

if __name__ == "__main__":
    main()
