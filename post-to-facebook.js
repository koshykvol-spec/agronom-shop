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

// Товар в наявності, з фото і готовою анотацією, якого ще не публікували
const candidate = products.find(p => {
  if (!p.inStock || posted.includes(p.sku) || !imgMap[p.n]) return false;
  const pid = skuToPid[p.sku];
  return pid && pidToAnnotation[pid];
});

if (!candidate) {
  console.log('Усі товари вже опубліковані — скидаю лог і починаю заново');
  posted = [];
  fs.writeFileSync('./posted-log.json', JSON.stringify(posted, null, 2));
  process.exit(0);
}

const pid = skuToPid[candidate.sku];
const annotation = pidToAnnotation[pid];
const caption = `${annotation}\n\n💰 Ціна: ${candidate.p} грн\n🛒 Купити: agronom.pp.ua`;

const photoPath = imgMap[candidate.n];
const photoUrl = `https://agronom.pp.ua/${photoPath.split('/').map(encodeURIComponent).join('/')}`;

const postRes = await fetch(`https://graph.facebook.com/v26.0/${PAGE_ID}/photos`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: photoUrl, caption, access_token: PAGE_TOKEN }),
});
const postResult = await postRes.json();

if (postResult.id) {
  posted.push(candidate.sku);
  fs.writeFileSync('./posted-log.json', JSON.stringify(posted, null, 2));
  console.log('Опубліковано:', candidate.n, '| фото:', photoUrl);
} else {
  console.error('Помилка публікації:', postResult);
  process.exit(1);
}
