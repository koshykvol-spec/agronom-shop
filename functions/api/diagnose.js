// ============================================================================
// agro-diagnose — Deno Deploy version
// Фото-діагностика хвороб/шкідників/бур'янів через Gemini API
// Заміна Cloudflare Worker (agro-diagnose.ruslanchyk.workers.dev)
// ============================================================================

// ---- Конфіг ----------------------------------------------------------------

const PRODUCTS_URL = "https://agronom.pp.ua/products.json";
const GEMINI_MODEL = "gemini-2.5-flash"; // єдина підтверджена робоча модель (07.2026)
const MAX_REQUESTS_PER_DAY_PER_IP = 20;
const KV_TTL_MS = 24 * 60 * 60 * 1000; // 24 години для rate-limit ключів
const PRODUCTS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 хв кеш каталогу товарів

// CORS — дозволяємо запити з основного сайту (і локальної розробки за потреби)
const ALLOWED_ORIGINS = new Set([
  "https://agronom.pp.ua",
  "https://www.agronom.pp.ua",
]);

// ---- Deno KV ----------------------------------------------------------------

const kv = await Deno.openKv();

// ---- Ротація API-ключів ------------------------------------------------------

function collectKeys(prefix) {
  const keys = [];
  for (let i = 1; i <= 6; i++) {
    const v = Deno.env.get(`${prefix}_${i}`);
    if (v) keys.push(v);
  }
  return keys;
}

const GEMINI_KEYS = collectKeys("GEMINI_API_KEY");
const OPENROUTER_KEYS = collectKeys("OPENROUTER_API_KEY");

async function nextKey(poolName, keys) {
  if (keys.length === 0) return null;
  const counterKey = ["key_rotation", poolName];
  const res = await kv.get(counterKey);
  const idx = ((res.value ?? 0) + 1) % keys.length;
  await kv.set(counterKey, idx);
  return keys[idx];
}

// ---- CORS --------------------------------------------------------------------

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://agronom.pp.ua";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

// ---- Rate limiting (за IP, ліміт на добу) -------------------------------------

async function checkRateLimit(ip) {
  const key = ["rate_limit", ip];
  const res = await kv.get(key);
  const count = res.value ?? 0;
  if (count >= MAX_REQUESTS_PER_DAY_PER_IP) {
    return false;
  }
  await kv.set(key, count + 1, { expireIn: KV_TTL_MS });
  return true;
}

// ---- Кеш каталогу товарів ------------------------------------------------------

let productsCache = { data: null, fetchedAt: 0 };

async function getProducts() {
  const now = Date.now();
  if (productsCache.data && now - productsCache.fetchedAt < PRODUCTS_CACHE_TTL_MS) {
    return productsCache.data;
  }
  try {
    const resp = await fetch(PRODUCTS_URL);
    if (!resp.ok) throw new Error(`products.json fetch failed: ${resp.status}`);
    const data = await resp.json();
    productsCache = { data, fetchedAt: now };
    return data;
  } catch (e) {
    console.error("Failed to fetch products.json:", e);
    return productsCache.data ?? [];
  }
}

// Проста keyword-відповідність назви препарату/діючої речовини до товарів каталогу
function matchProducts(products, keywords, limit = 5) {
  if (!Array.isArray(products) || keywords.length === 0) return [];
  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  const scored = [];

  for (const p of products) {
    const name = (p.name ?? p.title ?? "").toLowerCase();
    if (!name) continue;
    let score = 0;
    for (const kw of lowerKeywords) {
      if (name.includes(kw)) score += 2;
      else {
        // Часткова відповідність по словах
        const words = kw.split(/\s+/);
        for (const w of words) {
          if (w.length > 3 && name.includes(w)) score += 1;
        }
      }
    }
    if (score > 0) scored.push({ product: p, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.product);
}

// ---- Виклик Gemini API -----------------------------------------------------------

const DIAGNOSIS_PROMPT = `Ти — досвідчений агроном. Проаналізуй фото рослини і визнач, що на ньому зображено:
хвороба, шкідник чи бур'ян. Дай відповідь СУВОРО у форматі JSON, без markdown-обгортки, за схемою:

{
  "type": "disease" | "pest" | "weed" | "healthy" | "unknown",
  "name_uk": "українська назва проблеми",
  "name_latin": "латинська назва збудника/виду (якщо відома)",
  "confidence": "high" | "medium" | "low",
  "description": "короткий опис ознак українською (2-3 речення)",
  "treatment_keywords": ["список", "ключових", "слів", "для", "пошуку", "препаратів"],
  "recommendation": "коротка агрономічна рекомендація українською"
}

Якщо на фото немає рослини або зображення нечітке — постав "type": "unknown" і поясни чому в "description".
Відповідай лише JSON, нічого зайвого.`;

async function callGemini(apiKey, base64Image, mimeType) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        parts: [
          { text: DIAGNOSIS_PROMPT },
          { inline_data: { mime_type: mimeType, data: base64Image } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 800,
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini API: empty response");
  return text;
}

// Резервний виклик через OpenRouter (якщо всі ключі Gemini вичерпані/впали)
async function callOpenRouter(apiKey, base64Image, mimeType) {
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const body = {
    model: "google/gemini-2.0-flash-exp:free",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: DIAGNOSIS_PROMPT },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
        ],
      },
    ],
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenRouter API error ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenRouter API: empty response");
  return text;
}

function parseAiJson(rawText) {
  // Видаляємо можливі markdown-огорожі ```json ... ```
  const cleaned = rawText.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Спроба витягти перший { ... } блок
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
    throw new Error("Не вдалося розпарсити відповідь AI як JSON");
  }
}

// ---- Telegram-сповіщення (опційно) -----------------------------------------------

async function notifyTelegram(diagnosis, ip) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return;

  const text =
    `🔍 Нова діагностика (Deno)\n` +
    `Тип: ${diagnosis.type}\n` +
    `Назва: ${diagnosis.name_uk}\n` +
    `Впевненість: ${diagnosis.confidence}\n` +
    `IP: ${ip}`;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (e) {
    console.error("Telegram notify failed:", e);
  }
}

// ---- Логування у Deno KV --------------------------------------------------------

async function logDiagnosis(ip, diagnosis) {
  const key = ["logs", Date.now(), crypto.randomUUID()];
  await kv.set(key, {
    ip,
    type: diagnosis.type,
    name_uk: diagnosis.name_uk,
    confidence: diagnosis.confidence,
    timestamp: new Date().toISOString(),
  });
}

// ---- Основний обробник -----------------------------------------------------------

async function handleDiagnose(req, origin) {
  const ip = req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  const allowed = await checkRateLimit(ip);
  if (!allowed) {
    return jsonResponse(
      { error: "Перевищено ліміт запитів на сьогодні. Спробуйте завтра." },
      429,
      origin,
    );
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Некоректний JSON у запиті" }, 400, origin);
  }

  const { image, mimeType } = payload;
  if (!image || typeof image !== "string") {
    return jsonResponse({ error: "Поле 'image' (base64) є обов'язковим" }, 400, origin);
  }

  const cleanBase64 = image.includes(",") ? image.split(",")[1] : image;
  const finalMimeType = mimeType || "image/jpeg";

  // Пробуємо ключі Gemini по черзі, потім OpenRouter як резерв
  let rawText = null;
  let lastError = null;

  for (let attempt = 0; attempt < GEMINI_KEYS.length; attempt++) {
    const key = await nextKey("gemini", GEMINI_KEYS);
    if (!key) break;
    try {
      rawText = await callGemini(key, cleanBase64, finalMimeType);
      break;
    } catch (e) {
      lastError = e;
      console.error("Gemini attempt failed:", e.message);
    }
  }

  if (!rawText) {
    for (let attempt = 0; attempt < OPENROUTER_KEYS.length; attempt++) {
      const key = await nextKey("openrouter", OPENROUTER_KEYS);
      if (!key) break;
      try {
        rawText = await callOpenRouter(key, cleanBase64, finalMimeType);
        break;
      } catch (e) {
        lastError = e;
        console.error("OpenRouter attempt failed:", e.message);
      }
    }
  }

  if (!rawText) {
    return jsonResponse(
      { error: "Сервіс діагностики тимчасово недоступний. Спробуйте пізніше.", detail: lastError?.message },
      502,
      origin,
    );
  }

  let diagnosis;
  try {
    diagnosis = parseAiJson(rawText);
  } catch (e) {
    return jsonResponse({ error: "Не вдалося обробити відповідь AI", detail: e.message }, 502, origin);
  }

  // Продукти-рекомендації з каталогу
  const products = await getProducts();
  const keywords = Array.isArray(diagnosis.treatment_keywords) ? diagnosis.treatment_keywords : [];
  const matchedProducts = matchProducts(products, keywords);

  // Асинхронно логуємо і сповіщаємо, не блокуючи відповідь користувачу
  logDiagnosis(ip, diagnosis).catch((e) => console.error("logDiagnosis failed:", e));
  notifyTelegram(diagnosis, ip).catch((e) => console.error("notifyTelegram failed:", e));

  return jsonResponse(
    {
      ...diagnosis,
      recommended_products: matchedProducts.map((p) => ({
        name: p.name ?? p.title,
        url: p.url ?? p.slug ?? null,
        price: p.price ?? null,
      })),
    },
    200,
    origin,
  );
}

function jsonResponse(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
    },
  });
}

// ---- Точка входу Deno Deploy -------------------------------------------------------

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (url.pathname === "/diagnose" && req.method === "POST") {
    return handleDiagnose(req, origin);
  }

  if (url.pathname === "/health") {
    return jsonResponse({ status: "ok", model: GEMINI_MODEL }, 200, origin);
  }

  return jsonResponse({ error: "Not found" }, 404, origin);
});
