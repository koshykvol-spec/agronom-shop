#!/usr/bin/env python3
"""Генерує мініатюри каталогу (макс 400px, webp q80) у теку thumb/<шлях>.

Лише для фото >400px (менші й так дрібні — їх віддасть відкат у
functions/thumb/[[path]].js на оригінал). Похідні дані: thumb/ у .gitignore,
відтворюються цим скриптом з оригіналів. Після генерації — ./upload-thumbs.sh.
"""
from PIL import Image
import glob, os, re

MAX = 400
folders = [d for d in os.listdir('.') if d.startswith('IMG') and os.path.isdir(d)]
if os.path.isdir('up'):
    folders.append('up')

made = skipped = err = 0
for d in folders:
    for f in glob.glob(os.path.join(d, '*.webp')):
        try:
            im = Image.open(f)
            w, h = im.size
            if max(w, h) <= MAX:
                skipped += 1
                continue
            # чисте імʼя під ключ R2/D1: колапс '..'→'.' (wrangler не заливає '..', WAF 403)
            out = os.path.join('thumb', re.sub(r'\.\.+', '.', f))
            os.makedirs(os.path.dirname(out), exist_ok=True)
            scale = MAX / max(w, h)
            im2 = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
            if im2.mode == 'RGBA':
                bg = Image.new('RGB', im2.size, (255, 255, 255))
                bg.paste(im2, mask=im2.split()[-1])
                im2 = bg
            elif im2.mode != 'RGB':
                im2 = im2.convert('RGB')
            im2.save(out, 'WEBP', quality=80, method=6)
            made += 1
        except Exception as e:
            err += 1
            if err <= 5:
                print('ERR', f, e)

print(f'створено: {made} | пропущено (≤{MAX}px): {skipped} | помилок: {err}')
