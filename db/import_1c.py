#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Імпортер вигрузки 1С → SQL для Cloudflare D1.

Що робить:
  • парсить sample/products.json з 1С (чистить NBSP/пробіли в цінах і sku);
  • присвоює стабільний pid за ключем (sku, нормалізоване_імʼя) через db/pid_map.json
    (при повторних запусках pid зберігається → URL та обогащення не злітають);
  • бутстрапить обогащення з поточного products.json (annot, keywords) та img-map.json (фото)
    — матч по нормалізованому імені (одноразово, поки база D1 ще не наповнена);
  • генерує унікальний slug (транслітерація) для /p/<slug>;
  • пише db/schema.sql вже є; цей скрипт пише db/seed.sql і db/report.txt.

Запуск:  python3 db/import_1c.py
"""
import json, re, os, sys, html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_1C   = os.path.join(ROOT, "sample", "products.json")
ENRICH   = os.path.join(ROOT, "products.json")     # поточний сайт: має annot/keywords
IMGMAP   = os.path.join(ROOT, "img-map.json")       # назва → шлях фото
OUT_DIR  = os.path.join(ROOT, "db")
PID_MAP  = os.path.join(OUT_DIR, "pid_map.json")
SEED     = os.path.join(OUT_DIR, "seed.sql")
REPORT   = os.path.join(OUT_DIR, "report.txt")

TRANSLIT = {'а':'a','б':'b','в':'v','г':'g','ґ':'g','д':'d','е':'e','є':'ie','ж':'zh',
 'з':'z','и':'y','і':'i','ї':'i','й':'j','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p',
 'р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'shch',
 'ь':'','ю':'iu','я':'ia',"'":'','’':''}

def fix_num(s):
    """'10 100.00' / '10\xa0100.00' → 10100.0"""
    return re.sub(r'[ \xa0]', '', str(s))

def norm_name(n):
    s = (n or '').lower().replace('\xa0', ' ')
    s = re.sub(r'[*xх]', 'х', s)         # *, x, х однаково
    s = re.sub(r'[\s,.\-_/()]+', '', s)  # прибираємо роздільники
    return s

def slugify(n):
    s = (n or '').lower().replace('\xa0', ' ')
    out = ''.join(TRANSLIT.get(ch, ch) for ch in s)
    out = re.sub(r'[^a-z0-9]+', '-', out).strip('-')
    return out[:80] or 'tovar'

def load_1c(path):
    raw = open(path, encoding='utf-8-sig').read()
    recs, bad = [], []
    for ln in raw.splitlines():
        s = ln.strip().rstrip(',')
        if s in ('[', ']', ''):
            continue
        s = re.sub(r'("p":)\s*([0-9][0-9 \xa0]*\.?[0-9]*)',
                   lambda m: m.group(1) + fix_num(m.group(2)), s)
        try:
            recs.append(json.loads(s))
        except Exception as e:
            bad.append((str(e), s[:80]))
    return recs, bad

def load_json(path):
    if not os.path.exists(path):
        return None
    try:
        return json.load(open(path, encoding='utf-8-sig'))
    except Exception:
        return None

def sql_str(v):
    if v is None:
        return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"

def main():
    recs, bad = load_1c(SRC_1C)

    # джерела обогащення
    enrich = load_json(ENRICH) or []
    annot_by = {}; kw_by = {}
    for p in enrich:
        k = norm_name(p.get('n'))
        if p.get('annot'): annot_by[k] = p['annot']
        if p.get('keywords'): kw_by[k] = p['keywords']
    imgmap = load_json(IMGMAP) or {}
    img_by_norm = {norm_name(k): v for k, v in imgmap.items()}

    # стабільні pid
    pid_map = load_json(PID_MAP) or {}        # ключ "norm_sku|norm_name" → {pid, slug}
    next_pid = (max((e['pid'] for e in pid_map.values()), default=0) + 1)
    used_slugs = {e['slug'] for e in pid_map.values() if e.get('slug')}

    products, content, images = [], [], []
    rep = {'total': len(recs), 'bad': bad, 'dup_sku': {}, 'weird_sku': [],
           'new_pid': 0, 'reused_pid': 0, 'with_annot': 0, 'no_annot': 0, 'with_img': 0}

    seen_sku = {}
    for r in recs:
        seen_sku.setdefault(r.get('sku'), []).append(r)

    for r in recs:
        sku = fix_num(r.get('sku', '')).strip()
        name = (r.get('n') or '').strip()
        nn = norm_name(name)
        key = f"{sku}|{nn}"

        if re.search(r'[ \xa0]', str(r.get('sku', ''))):
            rep['weird_sku'].append(r.get('sku'))

        # pid: точний ключ → інакше за унікальним sku → інакше новий
        if key in pid_map:
            pid = pid_map[key]['pid']; slug = pid_map[key]['slug']; rep['reused_pid'] += 1
        else:
            pid = next_pid; next_pid += 1; rep['new_pid'] += 1
            slug = slugify(name)
            base = slug; i = 2
            while slug in used_slugs:
                slug = f"{base}-{i}"; i += 1
            used_slugs.add(slug)
            pid_map[key] = {'pid': pid, 'slug': slug}

        try:
            price = float(fix_num(r.get('p')))
        except Exception:
            price = None
        in_stock = 0 if r.get('inStock') is False else 1

        products.append((pid, sku, name, price, r.get('c'), r.get('b'), in_stock, r.get('updated_at')))

        annot = annot_by.get(nn, '')
        kw = kw_by.get(nn, '')
        if annot: rep['with_annot'] += 1
        else: rep['no_annot'] += 1
        meta_title = f"{name} — купити в Агроном, м. Володимир"
        content.append((pid, slug, annot, kw, meta_title, '', 1, 0))

        img = r.get('img') or img_by_norm.get(nn) or ''
        if img:
            images.append((pid, img, 0)); rep['with_img'] += 1

    rep['dup_sku'] = {k: len(v) for k, v in seen_sku.items() if len(v) > 1}

    # seed.sql
    with open(SEED, 'w', encoding='utf-8') as f:
        f.write("-- Згенеровано db/import_1c.py. Заповнює products / product_content / product_images.\n")
        f.write("-- Імпорт у D1:  wrangler d1 execute <DB> --file=db/schema.sql\n")
        f.write("--               wrangler d1 execute <DB> --file=db/seed.sql\n\n")
        for p in products:
            f.write("INSERT INTO products(pid,sku,name,price,category,brand,in_stock,updated_at) VALUES("
                    f"{p[0]},{sql_str(p[1])},{sql_str(p[2])},{('NULL' if p[3] is None else p[3])},"
                    f"{sql_str(p[4])},{sql_str(p[5])},{p[6]},{sql_str(p[7])});\n")
        for c in content:
            f.write("INSERT INTO product_content(pid,slug,annotation,keywords,meta_title,meta_desc,visible,sort) VALUES("
                    f"{c[0]},{sql_str(c[1])},{sql_str(c[2])},{sql_str(c[3])},{sql_str(c[4])},{sql_str(c[5])},{c[6]},{c[7]});\n")
        for im in images:
            f.write(f"INSERT INTO product_images(pid,path,sort) VALUES({im[0]},{sql_str(im[1])},{im[2]});\n")

    json.dump(pid_map, open(PID_MAP, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)

    # report
    with open(REPORT, 'w', encoding='utf-8') as f:
        f.write("=== ЗВІТ ІМПОРТУ 1С ===\n")
        f.write(f"Всього записів:        {rep['total']}\n")
        f.write(f"Зламаних рядків:       {len(rep['bad'])}\n")
        f.write(f"Нових pid:             {rep['new_pid']}\n")
        f.write(f"Перевикористано pid:   {rep['reused_pid']}\n")
        f.write(f"З аннотацією:          {rep['with_annot']}\n")
        f.write(f"Без аннотації:         {rep['no_annot']}  (потрібно дописати в админці)\n")
        f.write(f"З фото:                {rep['with_img']}\n")
        f.write(f"\nГруп дубльованих sku:  {len(rep['dup_sku'])}\n")
        for k, v in rep['dup_sku'].items():
            f.write(f"   {k!r} × {v}\n")
        f.write(f"\nsku з пробілом/NBSP:   {len(rep['weird_sku'])}: {rep['weird_sku']}\n")
        if rep['bad']:
            f.write("\nЗламані рядки:\n")
            for e, s in rep['bad']:
                f.write(f"   {e} :: {s}\n")

    print(f"✅ {rep['total']} товарів → {SEED}")
    print(f"   products: {len(products)}, content: {len(content)}, images: {len(images)}")
    print(f"   нових pid: {rep['new_pid']}, перевикор.: {rep['reused_pid']}, з annot: {rep['with_annot']}, без: {rep['no_annot']}")
    print(f"   звіт: {REPORT}, pid-карта: {PID_MAP}")

if __name__ == "__main__":
    main()
