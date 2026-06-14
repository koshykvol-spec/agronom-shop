#!/usr/bin/env python3
"""
Скрипт для генерування keywords до products.json на основі категорії та назви товару.
Запуск: python3 generate_keywords.py
"""

import json
import sys
from pathlib import Path

# ==========================================
# СЛОВНИКИ ДЛЯ ГЕНЕРУВАННЯ KEYWORDS
# ==========================================

CULTURE_KEYWORDS = {
    'томат': ['томат', 'помідор', 'томати'],
    'огірок': ['огірок', 'огірки'],
    'перець': ['перець', 'болгарський перець'],
    'баклажан': ['баклажан'],
    'яблуня': ['яблуня', 'яблуко'],
    'черешня': ['черешня'],
    'вишня': ['вишня'],
    'капуста': ['капуста', 'капустина'],
    'морква': ['морква'],
    'буряк': ['буряк', 'свекла'],
    'цибуля': ['цибуля', 'цибулина'],
    'часник': ['часник'],
    'кріп': ['кріп'],
    'петрушка': ['петрушка'],
    'базилік': ['базилік'],
    'щавель': ['щавель'],
    'редис': ['редис'],
    'редька': ['редька'],
    'картопля': ['картопля'],
    'гарбуз': ['гарбуз'],
    'кабачок': ['кабачок'],
    'кукурудза': ['кукурудза'],
}

PROBLEM_KEYWORDS = {
    'фітофтороз': ['фітофтороз'],
    'мілдью': ['мілдью', 'лікувати мілдью'],
    'парша': ['парша'],
    'хвороби': ['хвороба', 'від хвороб', 'лікування'],
    'шкідники': ['шкідник', 'комаха', 'від комах', 'проти шкідників', 'обробка'],
    'гербіцид': ['бур\'ян', 'гербіцид', 'від бур\'янів'],
    'слимак': ['слимак'],
    'крот': ['крот', 'від кротів'],
    'жук': ['жук', 'колорадський'],
    'попелиця': ['попелиця'],
    'паутинник': ['паутинник'],
    'гниль': ['гниль'],
    'плісень': ['плісень'],
    'грибок': ['грибок'],
}

CATEGORY_KEYWORDS = {
    'АГРОХІМІКАТИ': ['хімікат', 'ззр', 'препарат', 'обробка'],
    'НАСІННЯ ІМПОРТНЕ': ['насіння', 'імпортне', 'виробництво'],
    'НАСІННЯ ВІТЧИЗНЯНЕ': ['насіння', 'вітчизняне'],
    'НАСІННЯ ВАГОВЕ': ['насіння', 'ваговий', 'вага'],
    'МАТЕРІАЛИ': ['матеріал', 'обв\'язка', 'шпагат'],
    'КРАПЕЛЬНЕ ЗРОШУВАННЯ': ['крапельне', 'зрошування', 'поливання', 'краплинник'],
    'ГРУНТ': ['грунт', 'земля', 'субстрат', 'торф'],
    'ГОРЩИКИ': ['горщик', 'контейнер', 'касета'],
    'ПРОТИ КОМАХ': ['інсектицид', 'комаха', 'шкідник'],
    'ДЛЯ ТВАРИН': ['тварина', 'худоба', 'птиця'],
    'РОЗСАДА': ['розсада', 'саджанець'],
}

# ==========================================
# ФУНКЦІЇ
# ==========================================

def extract_keywords_from_name(product_name: str) -> list:
    """Витягує ключові слова з назви товару"""
    keywords = []
    name_lower = product_name.lower()
    
    # Культури
    for culture, words in CULTURE_KEYWORDS.items():
        for word in words:
            if word in name_lower:
                keywords.append(culture)
                break
    
    # Проблеми
    for problem, words in PROBLEM_KEYWORDS.items():
        for word in words:
            if word in name_lower:
                keywords.append(problem)
                break
    
    return list(set(keywords))  # Видаляємо дублі

def extract_keywords_from_category(category: str) -> list:
    """Витягує ключові слова з категорії"""
    return CATEGORY_KEYWORDS.get(category, [])

def generate_keywords_for_product(product: dict) -> str:
    """Генерує keyword-string для одного товару"""
    keywords = set()
    
    # Додаємо з назви
    name_kw = extract_keywords_from_name(product['n'])
    keywords.update(name_kw)
    
    # Додаємо з категорії
    cat_kw = extract_keywords_from_category(product.get('c', ''))
    keywords.update(cat_kw)
    
    # Додаємо саму назву (для більш точного пошуку)
    keywords.add(product['n'].lower())
    
    # Додаємо бренд
    if product.get('b'):
        keywords.add(product['b'].lower())
    
    # Для інсектицидів/фунгіцидів додаємо специфічні теги
    brand = product.get('b', '').lower()
    if 'інсектицид' in brand or 'інсектицид' in product['n'].lower():
        keywords.add('обробка')
        keywords.add('від комах')
        keywords.add('від шкідників')
    
    if 'фунгіцид' in brand or 'фунгіцид' in product['n'].lower():
        keywords.add('від хвороб')
        keywords.add('обробка')
    
    # Учасні модні слова
    if 'f1' in product['n'].lower() or 'гібрид' in product['n'].lower():
        keywords.add('гібрид')
        keywords.add('f1')
    
    if 'ранньостигл' in product['n'].lower():
        keywords.add('ранньостиглий')
    
    if 'біо' in product['n'].lower():
        keywords.add('біо')
        keywords.add('органічний')
    
    # Видаляємо porожні та занадто короткі слова
    keywords = {k for k in keywords if k and len(k) > 2}
    
    return ' '.join(sorted(keywords))

def main():
    input_file = Path('products.json')
    output_file = Path('products_with_keywords.json')
    
    if not input_file.exists():
        print(f"❌ Файл {input_file} не знайдено!")
        sys.exit(1)
    
    print(f"📖 Читаю {input_file}...")
    with open(input_file, 'r', encoding='utf-8') as f:
        products = json.load(f)
    
    print(f"🔄 Генерую keywords для {len(products)} товарів...")
    
    for i, product in enumerate(products):
        product['keywords'] = generate_keywords_for_product(product)
        
        # Прогрес кожні 500 товарів
        if (i + 1) % 500 == 0:
            print(f"   ✓ Оброблено {i + 1}/{len(products)}")
    
    print(f"💾 Зберігаю у {output_file}...")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(products, f, ensure_ascii=False, indent=0)
    
    print(f"✅ Готово! Файл збережено як {output_file}")
    print(f"\n📊 Приклади:")
    for product in products[:5]:
        print(f"  • {product['n'][:50]}")
        print(f"    keywords: {product['keywords'][:60]}...")
        print()

if __name__ == '__main__':
    main()
