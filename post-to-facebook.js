import fs from 'fs';
import fetch from 'node-fetch';

const PAGE_ID = process.env.FB_PAGE_ID;
const PAGE_TOKEN = process.env.FB_PAGE_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const products = JSON.parse(fs.readFileSync('./sample/products.json', 'utf-8'));
const imgMap = JSON.parse(fs.readFileSync('./img-map.json', 'utf-8'));
let posted = JSON.parse(fs.readFileSync('./posted-log.json', 'utf-8'));

// Товар з фото, якого ще не публікували
const candidate = products.find(p => !posted.includes(p.id) && imgMap[p.id]);
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
      content: `Напиши короткий рекламний пост для Facebook (2-4 речення, з emoji, без вигаданих характеристик і дозувань) про товар: "${candidate.name}". Опис: ${candidate.description || ''}. Додай заклик перейти на сайт agronom.pp.ua.`
    }],
  }),
});
const captionData = await captionRes.json();
const caption = captionData.content.find(c => c.type === 'text').text;

const photoPath = imgMap[candidate.id];
const photoUrl = `https://agronom.pp.ua/${photoPath}`;

const postRes = await fetch(`https://graph.facebook.com/v26.0/${PAGE_ID}/photos`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: photoUrl, caption, access_token: PAGE_TOKEN }),
});
const postResult = await postRes.json();

if (postResult.id) {
  posted.push(candidate.id);
  fs.writeFileSync('./posted-log.json', JSON.stringify(posted, null, 2));
  console.log('Опубліковано:', candidate.name);
} else {
  console.error('Помилка публікації:', postResult);
  process.exit(1);
}
