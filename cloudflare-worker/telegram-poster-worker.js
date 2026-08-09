// 3 рази на день (розклад у wrangler-telegram.toml) бере випадковий видимий товар
// у наявності з фото, і постить його карткою (фото + підпис) у Telegram-канал.
// Уникає повторів того самого товару протягом 14 днів (поки є з чого вибирати).
//
// Потрібні секрети (wrangler secret put --config wrangler-telegram.toml):
//   TG_BOT_TOKEN — токен бота від @BotFather
//   TG_CHAT_ID   — username каналу з @ (напр. @agronom_novynky) або числовий chat_id

const SITE_ORIGIN = 'https://agronom.pp.ua';
const STORE_NAME = 'Агроном';
const STORE_CITY = 'м. Володимир';

function toAbsImage(pth) {
  if (!pth) return null;
  if (pth.startsWith('http')) return pth;
  const clean = pth.replace(/^\/+/, '');
  const encoded = clean.split('/').map(seg => encodeURIComponent(seg)).join('/');
  return SITE_ORIGIN + '/' + encoded;
}

async function pickRandomProduct(db) {
  const base = `
    FROM products p JOIN product_content c ON c.pid = p.pid
    WHERE c.visible = 1 AND p.in_stock = 1 AND c.image_ok = 1`;

  // Спершу пробуємо уникнути товарів, опублікованих за останні 14 днів.
  let row = await db.prepare(
    `SELECT p.pid, p.name, p.price, c.slug, c.annotation, c.display_name, c.sale_price, c.sale_until
       ${base}
       AND p.pid NOT IN (SELECT pid FROM tg_posts WHERE posted_at > datetime('now','-14 days'))
     ORDER BY RANDOM() LIMIT 1`
  ).first();

  // Якщо всі "свіжі" вже використані (або таблиці tg_posts ще нема) — без обмеження.
  if (!row) {
    row = await db.prepare(
      `SELECT p.pid, p.name, p.price, c.slug, c.annotation, c.display_name, c.sale_price, c.sale_until
         ${base}
       ORDER BY RANDOM() LIMIT 1`
    ).first();
  }
  return row;
}

async function getFirstImage(db, pid) {
  const row = await db.prepare(
    `SELECT path FROM product_images WHERE pid=? ORDER BY sort, id LIMIT 1`
  ).bind(pid).first();
  return row ? row.path : null;
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildCaption(p) {
  const name = (p.display_name && String(p.display_name).trim()) ? p.display_name : p.name;
  const today = new Date().toISOString().slice(0, 10);
  const onSale = p.sale_price != null && p.sale_price > 0 && p.sale_price < (p.price || Infinity)
    && (!p.sale_until || p.sale_until >= today);
  const priceLine = onSale
    ? `<s>${Number(p.price).toFixed(0)} грн</s>  <b>${Number(p.sale_price).toFixed(0)} грн</b> 🏷️ Акція`
    : `<b>${Number(p.price).toFixed(0)} грн</b>`;
  const url = SITE_ORIGIN + '/p/' + p.slug;
  const annot = p.annotation ? escHtml(p.annotation).slice(0, 250) : '';

  return `🌱 <b>${escHtml(name)}</b>\n\n${priceLine}\n${annot ? annot + '\n\n' : '\n'}📍 ${STORE_NAME}, ${STORE_CITY}\n🔗 <a href="${url}">Детальніше і замовлення</a>`;
}

async function postRandomProduct(env) {
  const db = env.DB;
  const p = await pickRandomProduct(db);
  if (!p) return { ok: false, error: 'Немає підходящих товарів (visible=1, in_stock=1, image_ok=1)' };

  const imgPath = await getFirstImage(db, p.pid);
  const photoUrl = toAbsImage(imgPath);
  if (!photoUrl) return { ok: false, error: 'У товару pid=' + p.pid + ' немає фото' };

  const caption = buildCaption(p);
  const tgRes = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TG_CHAT_ID,
      photo: photoUrl,
      caption,
      parse_mode: 'HTML'
    })
  });
  const tgData = await tgRes.json();
  if (!tgRes.ok || !tgData.ok) {
    return { ok: false, error: 'Telegram API: ' + JSON.stringify(tgData) };
  }

  // Best-effort трекінг — навіть якщо запис не вдався, пост уже пішов, тому не кидаємо помилку.
  try {
    await db.prepare(
      `INSERT INTO tg_posts (pid, posted_at) VALUES (?, datetime('now'))
       ON CONFLICT(pid) DO UPDATE SET posted_at = excluded.posted_at`
    ).bind(p.pid).run();
  } catch (e) { /* не критично */ }

  return { ok: true, pid: p.pid, name: p.display_name || p.name, message_id: tgData.result.message_id };
}

export default {
  async fetch(request, env) {
    try {
      const result = await postRandomProduct(env);
      return new Response(JSON.stringify(result), { status: result.ok ? 200 : 500, headers: { 'content-type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(postRandomProduct(env).catch(e => console.error('telegram post failed:', e)));
  }
};
