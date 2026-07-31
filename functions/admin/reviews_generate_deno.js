// Agronom — масова генерація AI-відгуків для товарів без відгуків.
// Розгортається на Deno Deploy окремим проєктом (не залежить від Cloudflare-лімітів часу).
//
// Налаштування перед деплоєм — Deno Deploy → Settings → Environment Variables:
//   CF_ACCOUNT_ID        = 60ec215ac51c83577f7bb7d1e73fcb69
//   CF_API_TOKEN         = (той самий токен з правами D1 Edit, що й для diagnose)
//   ADMIN_TOKEN          = будь-який довгий секретний рядок, який ти вигадаєш сам —
//                          захищає ендпоінт від випадкового/стороннього виклику
//   GEMINI_API_KEY_1..6
//   OPENROUTER_API_KEY_1..6
//
// Виклик (наприклад, з адмінки чи просто в браузері):
//   https://<твій-проєкт>.deno.dev/?token=ТВІЙ_ADMIN_TOKEN&count=20

const D1_DATABASE_ID = 'b5d676d5-53a5-4b81-8888-4c77a967cf32';
const ALLOWED_ORIGIN = 'https://agronom.pp.ua';

function corsHeaders() {
  return {
    'access-control-allow-origin': ALLOWED_ORIGIN,
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

function J(o, status = 200) {
  return new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders() },
  });
}

async function d1Query(sql, params = []) {
  const accountId = Deno.env.get('CF_ACCOUNT_ID');
  const apiToken = Deno.env.get('CF_API_TOKEN');
  if (!accountId || !apiToken) throw new Error('CF_ACCOUNT_ID or CF_API_TOKEN not set');

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${D1_DATABASE_ID}/query`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Authorization': 'Bearer ' + apiToken },
      body: JSON.stringify({ sql, params }),
    }
  );
  const data = await res.json();
  if (!res.ok || data.success === false) {
    throw new Error('D1 error: ' + JSON.stringify(data.errors || data).slice(0, 300));
  }
  return data.result?.[0]?.results || [];
}

const FARMER_NAMES = [
  "Олена К.", "Іван Прокопчук", "Марія Дмитрівна", "Петро Коваль", "Наталія Василівна",
  "Василь Шатковський", "Тетяна", "Андрій Бойко", "Сергій Миколайович", "Оксана В.",
  "Микола Захарчук", "Ганна", "Дмитро Кравчук", "Світлана П.", "Віктор Олександрович",
  "Юрій М.", "Людмила", "Олександр Т.", "Валентина Г.", "Михайло", "Надія К.",
  "Роман Пасічник", "Ольга В.", "Володимир С.", "Ніна Степанівна", "Павло Г.",
  "Галина Петрівна", "Степан Семенович", "Ярослав Ковальчук", "Катерина М.", "Iрина В.",
  "Анатолій Григорович", "Олег Бондар", "Марта С.", "Богдан Шевченко", "Оксана Іванівна",
  "Віталій П.", "Лариса Дмитрівна", "Євгенія К.", "Тарас Мельник", "Святослав",
  "Яна Олександрівна", "Валерій Іванович", "Алла Г.", "Зінаїда Василівна", "Iгор Т.",
  "Любов Миколаївна", "Григорій Степанович", "Софія К.", "Вадим Лисенко", "Дарина",
  "Віра Олексіївна", "Максим Ткаченко", "Юлія С.", "Ростислав М.", "Олена Іванівна",
  "Антон Поліщук", "Iнна В.", "Євген Павлович", "Наталя Скрипник", "Тамара",
  "Леонід Петрович", "Христина Б.", "Артем Ганжа", "Світлана Дмитрівна", "Денис К.",
  "Олеся В.", "Ярослава М.", "Роман Васильович", "Марія Федорівна", "Василь К.",
  "Вікторія П.", "Назар Шевчук", "Уляна Т.", "Олексій Сергійович", "Марина Коваль",
  "Костянтин Мельниченко", "Руслан Гончар", "Лідія Петрівна", "Раїса Ткачук", "Клавдія В.",
  "Мирослава Демченко", "Богдана С.", "Соломія Іщенко", "Устина Панченко", "Зоряна М.",
  "Даниїл Романюк", "Владислав Г.", "Кирило Савчук", "Едуард Петрович", "Руслана В.",
  "Лілія Гриценко", "Федір Пилипенко", "Гнат Сидоренко", "Прокіп Марченко", "Северин Т.",
  "Матвій Кушнір", "Тимофій Тимощук", "Захар Пасько", "Остап Гнатюк", "Яків Заяць",
  "Панас Головко", "Данило Дяченко", "Всеволод С.", "Мирон Стельмах", "Марко Кобзар",
  "Тимур Литвиненко", "Ілля Гаврилюк", "Стефанія В.", "Злата Швець", "Аліна Довгань",
  "Діана Куценко", "Жанна Максименко", "Раїса Білоус", "Одарка Петрівна", "Стефан Юрченко",
  "Нестор Крамар", "Йосип Барабаш", "Гаврило Дудник", "Кузьма Козак", "Марʼяна Кушнірук",
  "Богдан Гринько", "Ілона Смаль", "Тарас Тесля", "Настя К.", "Іванна Богданівна",
  "Орест М.", "Яремій Т.", "Мар'ян С.", "Зореслава В.", "Любомир Захарович",
  "Веселина П.", "Юстина Г.", "Славко Р.", "Ганнуся Д.", "Северина М.",
  "Юхим Т.", "Пилип С.", "Домінік В.", "Ярина К.", "Богуслав П.",
  "Мілена Р.", "Северин Богданович", "Устим Г.", "Розалія М.", "Кароліна Т.",
  "Владлен С.", "Ілларіон П.", "Соломія Дмитрівна", "Юліан К.", "Оріана В.",
  "Северіан Т.", "Радослав М.", "Ярополк С.", "Всеслав Г.", "Пантелеймон Р."
];
function getRandomName() {
  return FARMER_NAMES[Math.floor(Math.random() * FARMER_NAMES.length)];
}

function getKeys(prefix) {
  const keys = [];
  for (let i = 1; i <= 6; i++) {
    const v = Deno.env.get(`${prefix}_${i}`);
    if (v && v.trim()) keys.push(v.trim());
  }
  if (keys.length === 0) return [];
  const start = Math.floor(Math.random() * keys.length);
  return [...keys.slice(start), ...keys.slice(0, start)];
}

async function generateReview(product) {
  const chosenName = getRandomName();
  const randomRating = Math.random() > 0.25 ? 5 : 4;

  const prompt = `Ти — український фермер або дачник. Напиши 1 короткий, природний відгук українською мовою на агротовар "${product.name}" (категорія: ${product.category || ''}${product.brand ? ', бренд: ' + product.brand : ''}).

Вимоги:
- Відгук має бути довжиною від 50 до 140 символів.
- Пиши просто, як звичайна людина.
- БЕЗ реклами та пафосу. БЕЗ знаків "!!!" чи трикрапок.
- Автор відгуку СУВОРО: "${chosenName}"
- Рейтинг відгуку СУВОРО: ${randomRating}
- Відповідай ЛИШЕ у форматі JSON: {"author":"...","rating":N,"text":"..."}`;

  let content = '', lastErr = '';

  for (const apiKey of getKeys('GEMINI_API_KEY').slice(0, 2)) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7, maxOutputTokens: 2048,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: { author: { type: 'STRING' }, rating: { type: 'INTEGER' }, text: { type: 'STRING' } },
              required: ['author', 'rating', 'text'],
            },
          },
        }),
      }
    );
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      lastErr = `Gemini ${res.status}: ${err.slice(0, 200)}`;
      continue;
    }
    const data = await res.json();
    content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (content) break;
    lastErr = 'Gemini: порожня відповідь';
  }

  if (!content) {
    for (const apiKey of getKeys('OPENROUTER_API_KEY').slice(0, 2)) {
      let res;
      try {
        res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'Authorization': 'Bearer ' + apiKey,
            'HTTP-Referer': ALLOWED_ORIGIN,
            'X-Title': 'Agronom Reviews',
          },
          body: JSON.stringify({
            models: ['nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', 'google/gemma-4-31b-it:free'],
            messages: [{ role: 'user', content: prompt }],
          }),
        });
      } catch (e) { lastErr = 'OpenRouter: ' + String(e?.message || e); continue; }
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        lastErr = `OpenRouter ${res.status}: ${err.slice(0, 200)}`;
        continue;
      }
      const data = await res.json();
      content = data.choices?.[0]?.message?.content || '';
      if (content) break;
      lastErr = 'OpenRouter: порожня відповідь';
    }
  }

  if (!content) throw new Error(lastErr || 'Порожня відповідь від усіх провайдерів');

  content = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  // Резервні "reasoning"-моделі (напр. NVIDIA Nemotron) іноді пишуть роздуми
  // перед самим JSON — тому виокремлюємо лише сам JSON-об'єкт з тексту.
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) content = jsonMatch[0];
  const rev = JSON.parse(content);
  return {
    author: rev.author || chosenName,
    rating: [4, 5].includes(rev.rating) ? rev.rating : randomRating,
    text: (rev.text || '').trim(),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (token !== Deno.env.get('ADMIN_TOKEN')) {
    return J({ ok: false, error: 'Unauthorized' }, 401);
  }

  const count = Math.max(1, Math.min(50, parseInt(url.searchParams.get('count') || '10', 10)));

  try {
    const products = await d1Query(
      `SELECT p.pid, p.name, p.category, p.brand
       FROM products p
       WHERE NOT EXISTS (SELECT 1 FROM reviews r WHERE r.pid = p.pid)
       LIMIT ?`,
      [count]
    );

    let generated = 0;
    const errors = [];

    for (const product of products) {
      try {
        const rev = await generateReview(product);
        if (rev.text && rev.text.length >= 10) {
          await d1Query(
            `INSERT INTO reviews (pid, name, rating, text, created_at, approved, source) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [product.pid, rev.author, rev.rating, rev.text, new Date().toISOString().split('T')[0], 0, 'gemini-ai']
          );
          generated++;
        }
      } catch (e) {
        errors.push({ pid: product.pid, name: product.name, error: String(e?.message || e) });
      }
    }

    return J({ ok: true, requested: products.length, generated, errors });
  } catch (e) {
    return J({ ok: false, error: String(e?.message || e) }, 500);
  }
});
