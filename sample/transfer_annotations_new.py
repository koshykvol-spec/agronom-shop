#!/usr/bin/env python3
# -*- coding: utf-8 -*-
#Як тепер працювати:
#Покладіть products.json (з 1С) та products04ОК.json (ваш архів з описами) в папку inputs.
#Запустіть скрипт.
#У папці outputs з'явиться файл to_generate.txt.
#Відкрийте його, скопіюйте текст (там будуть тільки ті товари, яких ще немає в архіві) і надішліть мені сюди в чат.
#Коли я згенерую описи, просто додайте їх у свій файл products04ОК.json.
#Це дозволить вам тримати базу описів в одному місці та не витрачати час на ручне редагування кожного разу.
import json
import os
import re

def load_fix_json(filepath):
    """Завантажує JSON, виправляє ціни та прибирає зайві коми в кінці списку."""
    with open(filepath, 'r', encoding='utf-8-sig') as f:
        content = f.read().strip()
    
    # Виправлення цін з пробілом "p": 150 00 -> 15000
    content = re.sub(r'"p":\s*(\d+)\s+(\d+\.?\d*)', r'"p": \1\2', content)
    
    # ВИПРАВЛЕННЯ КОМИ: прибираємо кому перед закриваючою дужкою ], якщо вона там є
    content = re.sub(r',\s*\]', ']', content)
    
    try:
        return json.loads(content)
    except json.JSONDecodeError as e:
        # Якщо все одно помилка, спробуємо ще грубіше очищення для to_generate.txt
        if "to_generate" in filepath:
             content = "[" + content.strip().rstrip(',') + "]"
             return json.loads(content)
        print(f"❌ Критична помилка у файлі {filepath}: {e}")
        raise

def clean_key(text):
    """Створює ключ, якому байдуже на пробіли, коми, крапки та ікси."""
    if not text: return ""
    s = text.lower().replace('\xa0', ' ')
    s = s.replace('*', 'х').replace('x', 'х').replace(',', '.').replace(' ', '')
    # Залишаємо тільки літери та цифри
    return re.sub(r'[^a-zа-яіїєґ0-9]', '', s)

def save_clean_json(data, filepath):
    """Зберігає ідеальний JSON без зайвих ком у кінці."""
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write('[\n')
        for i, item in enumerate(data):
            if 'annot' not in item: item['annot'] = ''
            line = json.dumps(item, ensure_ascii=False, separators=(',', ':'))
            f.write(line + (',\n' if i < len(data) - 1 else '\n'))
        f.write(']')

def run_transfer():
    inp, out = "inputs", "outputs"
    os.makedirs(out, exist_ok=True)
    
    new_p_path = os.path.join(inp, "products.json")
    old_p_path = os.path.join(inp, "products04ОК.json")
    
    print("📂 Завантаження та лікування файлів...")
    new_products = load_fix_json(new_p_path)
    old_products = load_fix_json(old_p_path)

    # Словник з очищеними ключами
    archive = {clean_key(p['n']): p['annot'] for p in old_products if p.get('annot')}
    
    found = 0
    missing = []

    for p in new_products:
        k = clean_key(p['n'])
        if k in archive:
            p['annot'] = archive[k]
            found += 1
        else:
            p['annot'] = ""
            missing.append(p)
        p['img'] = "" # Чистимо картинки за замовчуванням

    save_clean_json(new_products, os.path.join(out, "products.json"))
    
    if missing:
        save_clean_json(missing, os.path.join(out, "to_generate.txt"))
    
    print(f"\n📊 ФІНІШ:")
    print(f"✅ Знайдено анотацій: {found}")
    print(f"❓ Не знайдено: {len(missing)}")

if __name__ == "__main__":
    run_transfer()
