#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Додає поле slug у клієнтський products.json (для лінків каталог → /p/<slug>).
Бере slug із db/pid_map.json за нормалізованим іменем. Запуск: python3 db/add_slugs.py"""
import json, re, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def norm_name(n):
    s = (n or '').lower().replace('\xa0', ' ')
    s = re.sub(r'[*xх]', 'х', s)
    s = re.sub(r'[\s,.\-_/()]+', '', s)
    return s

pid_map = json.load(open(os.path.join(ROOT, 'db', 'pid_map.json'), encoding='utf-8'))
by_norm = {}
for k, v in pid_map.items():
    nn = k.split('|', 1)[1] if '|' in k else k
    by_norm.setdefault(nn, v.get('slug', ''))

prods = json.load(open(os.path.join(ROOT, 'products.json'), encoding='utf-8-sig'))
hit = 0
for p in prods:
    slug = by_norm.get(norm_name(p.get('n')), '')
    if slug:
        p['slug'] = slug
        hit += 1
    else:
        p.pop('slug', None)

with open(os.path.join(ROOT, 'products.json'), 'w', encoding='utf-8') as f:
    json.dump(prods, f, ensure_ascii=False, indent=0)

print(f"✅ slug додано: {hit} / {len(prods)} (без slug: {len(prods)-hit})")
