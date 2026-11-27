// POST /admin/geminiclean — прибирає сторонній водяний знак з фото через Google Gemini (Nano Banana 2).
// Тіло: сирий JPEG/PNG/WebP (до ~4 МБ). Відповідь: { ok, mime, image: <base64> }. Фото НЕ зберігається — його вставляє в редактор браузер.
// Потрібно: секрет GEMINI_API_KEY (Cloudflare Pages → Settings → Variables and Secrets).
// Необов'язково: GEMINI_IMAGE_MODEL (за замовчуванням gemini-3.1-flash-image).
const json = (d, st = 200) => new Response(JSON.stringify(d), { status: st, headers: { "Content-Type": "application/json; charset=utf-8" } });
const TYPES = ["image/jpeg", "image/png", "image/webp"];

export const PROMPT =
  "Remove ONLY the semi-transparent watermark text or logo that a third-party website has overlaid on this product photo " +
  "(for example a website address, a shop name or a faint repeated caption). " +
  "Do NOT change anything else: keep the product, the packaging and ALL printed text and logos that are part of the packaging exactly as they are, " +
  "keep the colors, lighting, composition, framing and aspect ratio identical. " +
  "Reconstruct the background under the watermark naturally. Return the full image.";

function b64(bytes) { let s = ""; const C = 0x8000; for (let i = 0; i < bytes.length; i += C) s += String.fromCharCode.apply(null, bytes.subarray(i, i + C)); return btoa(s); }

export async function onRequestPost({ env, request }) {
  if (!env.GEMINI_API_KEY) return json({ ok: false, error: "Не налаштовано ключ GEMINI_API_KEY (Cloudflare Pages → Settings → Variables and Secrets)." }, 501);
  const type = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!TYPES.includes(type)) return json({ ok: false, error: "Підтримуються лише jpg/png/webp" }, 400);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.byteLength) return json({ ok: false, error: "Порожній файл" }, 400);
  if (bytes.byteLength > 4 * 1024 * 1024) return json({ ok: false, error: "Файл завеликий (>4МБ)" }, 400);

  const model = env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 55000);
  let r, data;
  try {
    r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
      method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: type, data: b64(bytes) } }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    });
    data = await r.json().catch(() => null);
  } catch (e) {
    return json({ ok: false, error: e && e.name === "AbortError" ? "Gemini не відповів за 55 с" : "Не вдалося звернутися до Gemini" }, 504);
  } finally { clearTimeout(timer); }

  if (!r.ok) return json({ ok: false, error: "Gemini: " + ((data && data.error && data.error.message) || ("HTTP " + r.status)) }, 502);
  const cand = data && data.candidates && data.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  const img = parts.find(p => (p.inlineData || p.inline_data));
  if (!img) {
    const why = (data && data.promptFeedback && data.promptFeedback.blockReason) || (cand && cand.finishReason) || "";
    return json({ ok: false, error: "Gemini не повернув зображення" + (why ? " (" + why + ")" : "") }, 502);
  }
  const d = img.inlineData || img.inline_data;
  return json({ ok: true, mime: d.mimeType || d.mime_type || "image/png", image: d.data });
}
