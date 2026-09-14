import fs from 'fs';
import fetch from 'node-fetch';

const PAGE_ID = process.env.FB_PAGE_ID;
const PAGE_TOKEN = process.env.FB_PAGE_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

function readJsonStripBom(path) {
  const raw = fs.readFileSync(path, 'utf-8');
  return JSON.parse(raw.replace(/^\uFEFF/, ''));
}

const products = readJsonStripBom('./sample/products.json');
const imgMap = readJsonStripBom('./img-map.json');
let posted = readJsonStripBom('./posted-log.json');

// Товар в наявності, з фото (img-map.json індексується за назвою товару — полем n), якого ще не публікували
const candidate = products.find(
  p => p.inStock && !posted.includes(p.sku) && imgMap[p.n]
);

if (!candidate) {
  console.log('Усі товари вже опубліковані — скидаю лог і починаю заново');
  posted = [];
  fs.writeFileSync('./posted-log.json', JSON.stringify(posted, null, 2));
  process.exit(0);
}

const captionRes = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': ANTHROPIC_KEY,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `Напиши короткий рекламний пост для Facebook (2-4 речення, з emoji, без вигаданих характеристик і дозувань) про товар: "${candidate.n}". Категорія: ${candidate.c || ''}. Бренд: ${candidate.b || ''}. Ціна: ${candidate.p} грн. Додай заклик перейти на сайт agronom.pp.ua.`
    }],
  }),
});
if (!captionRes.ok) {
  const errText = await captionRes.text();
  console.error('Anthropic API помилка:', captionRes.status, errText);
  process.exit(1);
}
const captionData = await captionRes.json();
const textBlock = captionData.content && captionData.content.find(c => c.type === 'text');
if (!textBlock) {
  console.error('Неочікувана відповідь Anthropic API:', JSON.stringify(captionData));
  process.exit(1);
}
const caption = textBlock.text;

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
