// Раз на день (розклад у wrangler-scheme.toml) бере випадкову схему захисту
// рослин і випадкову стадію обробки з неї, постить текстовим повідомленням
// (без фото — тут воно не потрібне) у той самий Telegram-канал, що й товари.
// Дані читає напряму з живого protection_schemes.json на сайті — без D1,
// без дублювання даних.
//
// Потрібні секрети (wrangler secret put --config wrangler-scheme.toml):
//   TG_BOT_TOKEN — той самий токен бота, що й для товарів
//   TG_CHAT_ID   — той самий канал (@agronom_novynky)

const SITE_ORIGIN = 'https://agronom.pp.ua';

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function pickRandomStage() {
  const res = await fetch(SITE_ORIGIN + '/protection_schemes.json');
  if (!res.ok) throw new Error('protection_schemes.json fetch failed: ' + res.status);
  const data = (await res.json()).protection_schemes || {};

  const catKeys = Object.keys(data);
  if (!catKeys.length) return null;
  const catKey = catKeys[Math.floor(Math.random() * catKeys.length)];
  const cat = data[catKey];

  const schemes = cat.schemes || [];
  if (!schemes.length) return null;
  const scheme = schemes[Math.floor(Math.random() * schemes.length)];

  const treatments = scheme.treatments || [];
  if (!treatments.length) return null;
  const stage = treatments[Math.floor(Math.random() * treatments.length)];

  return { catKey, cat, scheme, stage };
}

function buildCaption({ catKey, cat, scheme, stage }) {
  const url = SITE_ORIGIN + '/protection_schemes.html?category=' + encodeURIComponent(catKey) + '&scheme=' + encodeURIComponent(scheme.id);
  const cultures = (cat.cultures || []).join(', ');
  const products = (stage.products || []).join(', ');

  return `${cat.icon || '🌿'} <b>${escHtml(scheme.name)}</b>\n`
    + (cultures ? `Культури: ${escHtml(cultures)}\n` : '')
    + `Період: ${escHtml(scheme.timing)}\n\n`
    + `📌 <b>${escHtml(stage.stage)}</b>\n`
    + `🗓 ${escHtml(stage.date)}\n`
    + `⚠️ ${escHtml(stage.problem)}\n`
    + (products ? `💊 ${escHtml(products)}\n` : '')
    + `\n🔗 <a href="${url}">Повна схема захисту</a>`;
}

async function postRandomScheme(env) {
  const picked = await pickRandomStage();
  if (!picked) return { ok: false, error: 'Не вдалося вибрати схему/стадію з protection_schemes.json' };

  const caption = buildCaption(picked);
  const tgRes = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TG_CHAT_ID,
      text: caption,
      parse_mode: 'HTML',
      disable_web_page_preview: false
    })
  });
  const tgData = await tgRes.json();
  if (!tgRes.ok || !tgData.ok) {
    return { ok: false, error: 'Telegram API: ' + JSON.stringify(tgData) };
  }
  return { ok: true, scheme: picked.scheme.name, stage: picked.stage.stage, message_id: tgData.result.message_id };
}

export default {
  async fetch(request, env) {
    try {
      const result = await postRandomScheme(env);
      return new Response(JSON.stringify(result), { status: result.ok ? 200 : 500, headers: { 'content-type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(postRandomScheme(env).catch(e => console.error('scheme post failed:', e)));
  }
};
