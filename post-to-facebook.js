import fs from 'fs';
import fetch from 'node-fetch';

const PAGE_ID = process.env.FB_PAGE_ID;
const PAGE_TOKEN = process.env.FB_PAGE_TOKEN;

function readJsonStripBom(path) {
  const raw = fs.readFileSync(path, 'utf-8');
  return JSON.parse(raw.replace(/^\uFEFF/, ''));
}

const products = readJsonStripBom('./sample/products.json');
const imgMap = readJsonStripBom('./img-map.json');
let posted = readJsonStripBom('./posted-log.json');

// sku -> pid (pid_map.json ключі мають формат "sku|нормалізована_назва")
const pidMapRaw = readJsonStripBom('./db/pid_map.json');
const skuToPid = {};
for (const key of Object.keys(pidMapRaw)) {
  const sku = key.split('|')[0];
  skuToPid[sku] = pidMapRaw[key].pid;
}

// pid -> готова анотація
const annotRaw = readJsonStripBom('./db/backups/annotations-20260603-205210.json');
const pidToAnnotation = {};
for (const r of annotRaw[0].results) {
  pidToAnnotation[r.pid] = r.annotation;
}

// sku -> slug сторінки товару на сайті (генерується скриптом make-slug-map.mjs з бази D1)
const skuToSlug = readJsonStripBom('./db/slug_map.json');

// Перевірка, що анотація справді про цей товар: хоча б половина «сортових» слів
// з назви (після назви культури, до першої цифри чи дужки) має зустрічатися в тексті.
// Порівнюємо за початком слова (5 літер), щоб не залежати від відмінка.
function annotationMatchesName(name, annotation) {
  const head = String(name).split(/[\d(]/)[0];
  const words = head.toLowerCase().split(/[^a-zа-яіїєґ'’-]+/i).filter(Boolean);
  const variety = words.slice(1).filter(w => w.length >= 4);
  if (!variety.length) return true; // нема чого порівнювати
  const text = String(annotation).toLowerCase();
  const hits = variety.filter(w => text.includes(w.slice(0, 5))).length;
  return hits * 2 >= variety.length;
}

let skippedNoSlug = 0;
let skippedMismatch = 0;

// Товар в наявності, з фото, сторінкою на сайті і готовою анотацією, що збігається з назвою,
// якого ще не публікували
const candidate = products.find(p => {
  if (!p.inStock || posted.includes(p.sku) || !imgMap[p.n]) return false;
  if (!skuToSlug[p.sku]) { skippedNoSlug++; return false; }
  const pid = skuToPid[p.sku];
  if (!(pid && pidToAnnotation[pid])) return false;
  if (!annotationMatchesName(p.n, pidToAnnotation[pid])) {
    skippedMismatch++;
    console.warn('Пропущено (анотація не збігається з назвою):', p.sku, '|', p.n);
    return false;
  }
  return true;
});

if (skippedNoSlug || skippedMismatch) {
  console.log(`Пропущено: без сторінки на сайті — ${skippedNoSlug}, анотація не про цей товар — ${skippedMismatch}`);
}

if (!candidate) {
  console.log('Усі товари вже опубліковані — скидаю лог і починаю заново');
  posted = [];
  fs.writeFileSync('./posted-log.json', JSON.stringify(posted, null, 2));
  process.exit(0);
}

const pid = skuToPid[candidate.sku];
const annotation = pidToAnnotation[pid];
const productUrl = `https://agronom.pp.ua/p/${skuToSlug[candidate.sku]}`;
const caption = `${annotation}\n\n💰 Ціна: ${candidate.p} грн\n🛒 Купити: ${productUrl}`;

const photoPath = imgMap[candidate.n];
const photoUrl = `https://agronom.pp.ua/${photoPath.split('/').map(encodeURIComponent).join('/')}`;

// Пробний запуск: DRY_RUN=1 лише показує допис, нічого не публікує і не змінює лог
if (process.env.DRY_RUN) {
  console.log('--- DRY RUN: нічого не опубліковано ---');
  console.log(caption);
  console.log('Фото:', photoUrl);
  process.exit(0);
}

const postRes = await fetch(`https://graph.facebook.com/v26.0/${PAGE_ID}/photos`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: photoUrl, caption, access_token: PAGE_TOKEN }),
});
const postResult = await postRes.json();

if (postResult.id) {
  posted.push(candidate.sku);
  fs.writeFileSync('./posted-log.json', JSON.stringify(posted, null, 2));
  console.log('Опубліковано:', candidate.n, '| фото:', photoUrl, '| посилання:', productUrl);
} else {
  console.error('Помилка публікації:', postResult);
  process.exit(1);
}
