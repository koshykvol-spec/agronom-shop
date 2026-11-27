// POST /admin/geminiclean — «тонкий» проксі до Google Gemini (Nano Banana 2) для прибирання водяного знака.
// Браузер сам будує тіло запиту generateContent (фото в base64 + текст), сервер лише додає секретний ключ і
// пересилає тіло/відповідь як є, без розбору JSON (Cloudflare має малий ліміт CPU, а відповідь із картинкою — кілька МБ).
// Потрібно: секрет GEMINI_API_KEY (Cloudflare Pages → Settings → Variables and Secrets).
// Необов'язково: GEMINI_IMAGE_MODEL (за замовчуванням gemini-3.1-flash-image).
const json = (d, st = 200) => new Response(JSON.stringify(d), { status: st, headers: { "Content-Type": "application/json; charset=utf-8" } });
const MAX = 8 * 1024 * 1024;

export async function onRequestPost({ env, request }) {
  if (!env.GEMINI_API_KEY) return json({ ok: false, error: { message: "Не налаштовано ключ GEMINI_API_KEY (Cloudflare Pages → Settings → Variables and Secrets) або не зроблено новий деплой після його додавання." } }, 501);
  const len = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (!len) return json({ ok: false, error: { message: "Порожній запит" } }, 400);
  if (len > MAX) return json({ ok: false, error: { message: "Запит завеликий (>8МБ)" } }, 413);

  const model = env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
      method: "POST", signal: AbortSignal.timeout(100000),
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: request.body,
    });
    return new Response(r.body, { status: r.status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (e) {
    return json({ ok: false, error: { message: e && (e.name === "TimeoutError" || e.name === "AbortError") ? "Gemini не відповів за 100 с" : "Не вдалося звернутися до Gemini" } }, 504);
  }
}
