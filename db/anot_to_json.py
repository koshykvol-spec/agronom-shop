#!/usr/bin/env python3
"""Конвертер «сирого» файлу анотацій від LLM у JSON для /admin/anno.

Файл анот.txt має ДВІ частини (LLM згенерувала по-різному):
  1) **SKU** | Назва  +  абзац опису   (розділник «---»)
  2) Назва+опис одним абзацом          (розділник «____…», опис починається з повтору назви)

Матч проти D1 (потрібен дамп товарів — див. нижче):
  - по точному SKU (частина 1);
  - по нормалізованій назві (частина 2): зводимо до букв+цифр, прибираємо
    одиницю «(шт.)», варіанти бренду (SeedEra / Seed Era / ScedEra) — бо D1
    має різнобій у пробілах/дужках/брендах;
  - комбіновані фасовки «База Xг / Yг (бренд)» → розщеплюємо на дві фасовки,
    один опис на обидві (опис сорту спільний).

Не матчаться (звітуємо): парасолькові «(різні розміри)», помилки даних у D1
(Агроконтракт: кирилична «З» замість цифри «3»), відсутні товари.

Дамп D1:  wrangler d1 execute agronom-db --remote --json \
  --command "SELECT p.sku,p.name,COALESCE(c.display_name,'') dn
             FROM products p LEFT JOIN product_content c ON c.pid=p.pid" \
  | python3 -c "import sys,json;json.dump(json.load(sys.stdin)[0]['results'],open('/tmp/d1prod.json','w'),ensure_ascii=False)"

Запуск:  python3 db/anot_to_json.py анот.txt /tmp/d1prod.json вихід.json
"""
import re, json, sys

def parse(path):
    raw = open(path, encoding='utf-8').read()
    lines = raw.split('\n')
    # межа двох частин — перший рядок-розділник з підкреслень
    sep = next((i for i, l in enumerate(lines) if set(l.strip()) == {'_'} and len(l.strip()) >= 10), len(lines))
    j = sep - 1
    while j > 0 and lines[j].strip() != '':
        j -= 1
    part1, part2 = '\n'.join(lines[:j + 1]), '\n'.join(lines[j + 1:])

    recs = []
    # ── частина 1: **SKU** | Назва + опис ──
    pat = re.compile(r'^\s*\*\*(.+?)\*\*\s*\|\s*(.*?)\s*$', re.M)
    ms = list(pat.finditer(part1))
    for i, m in enumerate(ms):
        s, e = m.end(), (ms[i + 1].start() if i + 1 < len(ms) else len(part1))
        body = re.sub(r'^\s*-{3,}\s*$', '', part1[s:e], flags=re.M)
        recs.append({'sku': m.group(1).strip(), 'name': m.group(2).strip(),
                     'ann': re.sub(r'\n{3,}', '\n\n', body).strip()})

    # ── частина 2: Назва+опис одним абзацом (опис починається з повтору назви) ──
    def split_na(t):
        dash = t.find(' — ')
        if dash != -1:
            before = t[:dash]
            fw = before.split()[0].strip('.,;:')
            idx = before.rfind(fw)            # повтор назви → початок опису
            if idx > 0:
                return t[:idx].strip(), t[idx:].strip()
        if ')' in t:                          # фолбек: до бренд-дужки
            k = t.index(')') + 1
            return t[:k].strip(), t[k:].strip()
        return t[:60].strip(), t
    for ch in re.split(r'^_{10,}$', part2, flags=re.M):
        t = re.sub(r'\s+', ' ', ch.strip())
        if not t:
            continue
        nm, an = split_na(t)
        recs.append({'sku': '', 'name': nm, 'ann': an})
    return recs

def norm(s):
    s = (s or '').lower()
    s = re.sub(r'\(\s*шт\.?\s*\)', '', s)             # одиниця «(шт.)» — не чіпає «10 шт»
    s = re.sub(r'[^0-9a-zа-яіїєґ]', '', s)            # лише букви+цифри
    for b in ('seedera', 'scedera', 'seedеra'):
        s = s.replace(b, '')                          # варіанти бренду
    return s

def main(txt_path, d1_path, out_path):
    recs = parse(txt_path)
    d1 = json.load(open(d1_path, encoding='utf-8'))
    by_sku = {r['sku'].strip(): r for r in d1 if r.get('sku')}
    by_name = {}
    for r in d1:
        for nm in (r.get('name'), r.get('dn')):
            k = norm(nm)
            if k:
                by_name.setdefault(k, []).append(r['sku'])

    def one(name):
        k = norm(name)
        s = list(dict.fromkeys(by_name.get(k, [])))
        return s[0] if len(s) == 1 else None

    def resolve(sku, name):
        if sku and sku.strip() in by_sku:
            return [by_sku[sku.strip()]['sku']]
        s = one(name)
        if s:
            return [s]
        m = re.match(r'^(.*?)\s+([\d.,]+\s*[а-яіїєґA-Za-z]+)\s*/\s*([\d.,]+\s*[а-яіїєґA-Za-z]+)\s*(\([^)]*\))?\s*$', name)
        if m:
            base, w1, w2, br = m.group(1), m.group(2), m.group(3), (m.group(4) or '')
            return [one(f'{base} {w} {br}'.strip()) for w in (w1, w2) if one(f'{base} {w} {br}'.strip())]
        return []

    out, seen, unmatched = [], set(), []
    for r in recs:
        skus = resolve(r['sku'], r['name'])
        if not skus:
            unmatched.append(r['name'][:60])
            continue
        for sku in skus:
            if sku in seen:
                continue
            seen.add(sku)
            out.append({'sku': sku, 'annotation': r['ann']})
    json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'зматчено: {len(out)} | не знайдено: {len(unmatched)} → {out_path}')
    for n in unmatched:
        print('  не знайдено:', n)

if __name__ == '__main__':
    a = sys.argv[1:]
    main(a[0] if a else 'анот.txt', a[1] if len(a) > 1 else '/tmp/d1prod.json',
         a[2] if len(a) > 2 else 'анот.json')
