// Cloudflare Pages Function — серверна сторінка товару /p/<slug> з D1.
// Binding D1: env.DB

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function isWeight(p) {
  const n = (p.name || '').toLowerCase();
  return p.category === 'НАСІННЯ ВАГОВЕ' || n.includes(', кг') || n.includes(' ваговий') || n.endsWith(',кг');
}

export async function onRequest(context) {
  const { params, env, request } = context;
  const slug = params.slug;
  const origin = new URL(request.url).origin;

  const p = await env.DB.prepare(
    `SELECT p.pid,p.sku,p.name,p.price,p.category,p.brand,p.in_stock,
            c.slug,c.annotation,c.keywords,c.meta_title,c.meta_desc,c.sale_price,c.sale_until,c.display_name,c.group_id,c.variant_label,c.image_ok,c.active_ingredient,c.dosage,c.divisible,c.divisor
       FROM products p JOIN product_content c ON c.pid=p.pid
      WHERE c.slug=? AND c.visible=1`
  ).bind(slug).first();

  if (!p) return new Response('Товар не знайдено', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });

  // Фасадна назва (показується на сайті); якщо порожня — робоча назва з 1С
  const displayName = (p.display_name && String(p.display_name).trim()) ? String(p.display_name).trim() : p.name;

  // Бренд/місто для SEO-суфікса — з site_settings (керується в /admin/contacts); fallback нижче
  let s_name = 'Агроном', s_city = 'м. Володимир', s_tskey = '', s_addr = '', s_phone = '063 462 52 06', s_viber = '';
  let seoReturnDays = 14, seoShipCost = 0;   // для структурованих даних offers (керується в /admin/checkout)
  try {
    const ss = (await env.DB.prepare(`SELECT key,value FROM site_settings WHERE key IN ('name','city','turnstile_sitekey','address','phoneDisplay','viberPhone','seo_return_days','seo_ship_cost')`).all()).results || [];
    for (const r of ss) {
      if (r.key === 'name' && r.value) s_name = r.value;
      if (r.key === 'city' && r.value) s_city = r.value;
      if (r.key === 'turnstile_sitekey' && r.value) s_tskey = r.value;
      if (r.key === 'address' && r.value) s_addr = r.value;
      if (r.key === 'phoneDisplay' && r.value) s_phone = r.value;
      if (r.key === 'viberPhone' && r.value) s_viber = String(r.value).replace(/[^\d]/g, '');
      if (r.key === 'seo_return_days' && r.value) { const d = parseInt(r.value, 10); if (d > 0) seoReturnDays = d; }
      if (r.key === 'seo_ship_cost' && r.value !== undefined && r.value !== '') { const c = parseFloat(String(r.value).replace(',', '.')); if (!isNaN(c) && c >= 0) seoShipCost = c; }
    }
  } catch (e) {}

  // Калькулятор робочого розчину: парсимо «X од на Y л» з тексту дозування (сервер-сайд, без regex в інлайн-JS).
  let doseCalc = null;
  if (p.dosage) {
    const dm = String(p.dosage).replace(/,/g, '.').match(/(\d+(?:\.\d+)?)\s*(мл|г|кг|л)\s*(?:на|\/|за|–|—|-|x|×)?\s*(\d+(?:\.\d+)?)\s*л/i);
    if (dm && parseFloat(dm[3]) > 0) doseCalc = { amount: parseFloat(dm[1]), unit: dm[2], per: parseFloat(dm[3]) };
  }

  // Селектор фасовок (інші варіанти тієї ж групи)
  let variantSelector = '';
  if (p.group_id) {
    const sibs = (await env.DB.prepare(
      `SELECT c.slug, c.variant_label, pr.price, pr.in_stock
         FROM products pr JOIN product_content c ON c.pid=pr.pid
        WHERE c.group_id=? AND c.visible=1 ORDER BY pr.price`
    ).bind(p.group_id).all()).results || [];
    if (sibs.length > 1) {
      variantSelector = '<div style="margin:10px 0 6px"><div style="font-size:.85rem;color:#777;margin-bottom:6px">Фасовка <span style="color:#aaa">(ціна за варіант):</span></div><div style="display:flex;flex-wrap:wrap;gap:8px">'
        + sibs.map(s => {
            const cur = s.slug === p.slug, oos = s.in_stock === 0;
            const st = `display:inline-flex;flex-direction:column;align-items:center;line-height:1.25;padding:7px 13px;border-radius:8px;border:2px solid ${cur ? 'var(--green)' : '#ccc'};text-decoration:none;${cur ? 'background:var(--green);color:#fff;' : 'color:var(--text);'}${oos ? 'opacity:.5;' : ''}`;
            const lbl = `<b style="font-size:.92rem">${esc(s.variant_label || '—')}${oos ? ' ✕' : ''}</b>`;
            const pr = `<span style="font-size:.78rem;${cur ? 'color:#dfeede;' : 'color:var(--green);'}font-weight:700">${oos ? 'немає' : (Number(s.price).toFixed(2) + ' грн')}</span>`;
            return cur ? `<span style="${st}">${lbl}${pr}</span>` : `<a href="/p/${esc(s.slug)}" style="${st}">${lbl}${pr}</a>`;
          }).join('')
        + '</div></div>';
    }
  }

  const imgsAll = (await env.DB.prepare(
    `SELECT path FROM product_images WHERE pid=? ORDER BY sort, id`
  ).bind(p.pid).all()).results || [];
  let imgList = imgsAll.map(r => r.path).filter(Boolean);
  // якщо в цієї фасовки фото немає або файл відсутній — беремо фото сусіда по групі з робочим файлом
  if ((imgList.length === 0 || p.image_ok !== 1) && p.group_id) {
    const sib = await env.DB.prepare(
      `SELECT i.path FROM product_images i JOIN product_content c ON c.pid=i.pid
        WHERE c.group_id=? AND c.image_ok=1 AND i.path<>'' ORDER BY i.sort, i.id LIMIT 1`
    ).bind(p.group_id).first();
    if (sib && sib.path) imgList = [sib.path];
  }
  const img = imgList[0] || '';
  // ВАЖЛИВО: og:image/JSON-LD image мусять бути URL-КОДОВАНІ (пробіли/кирилиця),
  // інакше скрапери (Telegram/Facebook/Viber) не витягнуть фото → прев'ю без картинки.
  const toAbs = pth => pth.startsWith('http') ? pth : origin + '/' + encodeURI(pth.replace(/^\//, ''));
  const imgAbs = img ? toAbs(img) : (origin + '/android-chrome-512x512.png');

  const weight = isWeight(p);
  const inStock = p.in_stock !== 0;
  const price = (typeof p.price === 'number') ? p.price.toFixed(2) : '';
  // Акція: активна, якщо є акційна ціна < звичайної і дата ще не минула
  const today = new Date().toISOString().slice(0, 10);
  const onSale = p.sale_price != null && p.sale_price > 0 && p.sale_price < (p.price || Infinity) && (!p.sale_until || p.sale_until >= today);
  const effPrice = onSale ? p.sale_price : p.price;
  const fmtD = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? m[3] + '.' + m[2] + '.' + m[1] : ''; };
  const priceHtml = onSale
    ? `<span style="color:#999;text-decoration:line-through;font-size:1rem;font-weight:400;">${Number(p.price).toFixed(2)} грн</span> <span style="color:#c0392b;">${Number(p.sale_price).toFixed(2)} грн</span>${weight ? ' <small>/кг</small>' : ''} <span style="background:#ff7a00;color:#fff;border-radius:8px;padding:2px 9px;font-size:.72rem;font-weight:800;vertical-align:middle;white-space:nowrap;">🏷️ Акція${p.sale_until ? (' до ' + fmtD(p.sale_until)) : ''}</span>`
    : `${price} грн${weight ? ' <small>/кг</small>' : ''}`;
  const title = p.meta_title || (displayName + ' — ' + s_name + ', ' + s_city);
  const desc = (p.meta_desc || p.annotation || (displayName + '. Купити в інтернет-магазині ' + s_name + ', ' + s_city + '.')).slice(0, 300);
  const canonical = origin + '/p/' + p.slug;
  // urlkey категорії — з D1 (таблиця categories, керується в /admin/categories)
  let catKey = '';
  try {
    const ck = await env.DB.prepare(`SELECT key FROM categories WHERE db_name=? LIMIT 1`).bind(p.category).first();
    if (ck && ck.key) catKey = ck.key;
  } catch (e) {}
  const catUrl = catKey ? ('/category.html?cat=' + catKey) : '/index.html';

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'Product',
    name: displayName, sku: p.sku, category: p.category,
    brand: p.brand ? { '@type': 'Brand', name: p.brand } : undefined,
    image: imgList.length ? imgList.map(toAbs) : undefined,
    description: (p.annotation || '').slice(0, 500) || undefined,
    offers: {
      '@type': 'Offer', price: effPrice, priceCurrency: 'UAH', url: canonical,
      priceValidUntil: (onSale && p.sale_until) ? p.sale_until : undefined,
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      // Рекомендовані Google поля (Merchant listings): політика повернення + доставка
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'UA',
        returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays: seoReturnDays,
        returnMethod: 'https://schema.org/ReturnByMail',
        returnFees: 'https://schema.org/ReturnShippingFees'
      },
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingRate: { '@type': 'MonetaryAmount', value: seoShipCost, currency: 'UAH' },
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'UA' },
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
          transitTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 3, unitCode: 'DAY' }
        }
      }
    }
  };

  // ── Відгуки (схвалені) + супутні товари ──
  let reviews = [];
  try { reviews = (await env.DB.prepare(`SELECT name,rating,text,created_at FROM reviews WHERE pid=? AND approved=1 ORDER BY id DESC LIMIT 30`).bind(p.pid).all()).results || []; } catch(e){}
  const revCount = reviews.length;
  const revAvg = revCount ? (reviews.reduce((a,r)=>a+(r.rating||0),0)/revCount) : 0;
  if (revCount){
    jsonld.aggregateRating = { '@type':'AggregateRating', ratingValue: Math.round(revAvg*10)/10, reviewCount: revCount };
    jsonld.review = reviews.slice(0,5).map(r=>({ '@type':'Review', author:{ '@type':'Person', name:r.name||'Покупець' }, reviewRating:{ '@type':'Rating', ratingValue:r.rating, bestRating:5 }, reviewBody:(r.text||'').slice(0,500) }));
  }
  let related = [];
  try {
    related = (await env.DB.prepare(
      `SELECT pr.pid AS pid, COALESCE(NULLIF(c.display_name,''),pr.name) AS name, c.slug, pr.price, pr.in_stock,
              (SELECT path FROM product_images i WHERE i.pid=pr.pid ORDER BY sort LIMIT 1) AS img
         FROM products pr JOIN product_content c ON c.pid=pr.pid
        WHERE pr.category=? AND c.visible=1 AND pr.pid<>? AND (?='' OR c.group_id IS NULL OR c.group_id<>?)
        ORDER BY pr.in_stock DESC, pr.pid LIMIT 8`
    ).bind(p.category, p.pid, p.group_id||'', p.group_id||'').all()).results || [];
  } catch(e){}

  // Аналоги — товари з ТІЄЮ САМОЮ діючою речовиною (інша марка/ціна); сортуємо від дешевших
  let analogs = [];
  const aing = (p.active_ingredient || '').trim();
  if (aing) {
    try {
      analogs = (await env.DB.prepare(
        `SELECT pr.pid AS pid, COALESCE(NULLIF(c.display_name,''),pr.name) AS name, c.slug, pr.price, pr.in_stock,
                (SELECT path FROM product_images i WHERE i.pid=pr.pid ORDER BY sort LIMIT 1) AS img
           FROM products pr JOIN product_content c ON c.pid=pr.pid
          WHERE c.active_ingredient=? AND c.visible=1 AND pr.pid<>? AND (?='' OR c.group_id IS NULL OR c.group_id<>?)
          ORDER BY pr.price LIMIT 12`
      ).bind(aing, p.pid, p.group_id||'', p.group_id||'').all()).results || [];
    } catch(e){}
  }

  // Галерея: головне фото + мініатюри. Шляхи абсолютні (сторінка живе на /p/<slug>).
  const toSrc = pth => pth.startsWith('http') ? pth : '/' + pth.replace(/^\//, '');
  const mainSrc = img ? toSrc(img) : '';
  const thumbs = imgList.length > 1
    ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        ${imgList.map((pth, i) => `<img src="${esc(toSrc(pth))}" alt="${esc(displayName)} — фото ${i + 1}" loading="lazy" onclick="var m=document.getElementById('pmain');m.src=this.src;m.style.display='';m.nextElementSibling.style.display='none';this.parentElement.querySelectorAll('img').forEach(function(t){t.style.borderColor='#ddd'});this.style.borderColor='var(--green)'" style="width:68px;height:68px;object-fit:contain;background:#f6f6f6;border:2px solid ${i === 0 ? 'var(--green)' : '#ddd'};border-radius:8px;cursor:pointer">`).join('')}
      </div>`
    : '';
  const imgHtml = mainSrc
    ? `<img id="pmain" src="${esc(mainSrc)}" alt="${esc(displayName)}" style="width:100%;max-height:min(360px,45vh);object-fit:contain;border-radius:12px;background:#f6f6f6;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
       <div style="display:none;aspect-ratio:4/3;background:#eef5ee;align-items:center;justify-content:center;font-size:3rem;border-radius:12px;">🧪</div>
       ${thumbs}`
    : `<div style="aspect-ratio:4/3;background:#eef5ee;display:flex;align-items:center;justify-content:center;font-size:3rem;border-radius:12px;">🧪</div>`;

  const divisible = p.divisible && Number(p.divisible) === 1;
  const divisor = divisible && p.divisor ? Number(p.divisor) : null;

  const divStep = divisor || 1;
  const divBlock = divisible && divisor ? `
    <div style="display:flex;align-items:center;gap:8px;margin:8px 0 14px;flex-wrap:wrap;">
      <span style="color:#555;font-size:.95rem;">Кількість (кратно ${divStep}):</span>
      <div style="display:flex;align-items:center;border:2px solid var(--green);border-radius:8px;overflow:hidden;">
        <button type="button" onclick="pqtyChange(-1)" style="width:36px;height:38px;background:#f0f7f0;border:none;font-size:1.3rem;cursor:pointer;font-weight:bold;color:var(--green)">&#8722;</button>
        <input id="pqty" type="number" value="${divStep}" step="${divStep}" min="${divStep}" style="width:70px;padding:6px 4px;border:none;border-left:1px solid #cde8cd;border-right:1px solid #cde8cd;font-weight:bold;text-align:center;font-size:1rem;">
        <button type="button" onclick="pqtyChange(1)" style="width:36px;height:38px;background:#f0f7f0;border:none;font-size:1.3rem;cursor:pointer;font-weight:bold;color:var(--green)">+</button>
      </div>
    </div>` : '';

  const addBlock = !inStock
    ? `<div class="oos-badge" style="max-width:320px;">Немає в наявності</div>`
    : (weight
      ? `<div style="display:flex;align-items:center;gap:8px;margin:8px 0 14px;">
           <span>Кількість:</span>
           <input id="pqty" type="number" value="1" step="0.5" min="0.5" style="width:90px;padding:8px;border:2px solid var(--green);border-radius:8px;font-weight:bold;text-align:center;"> кг
         </div>
         <button class="btn" id="addbtn" onclick="addToCart()" style="max-width:320px;">🛒 Додати в кошик</button>`
      : `${divBlock}<button class="btn" id="addbtn" onclick="addToCart()" style="max-width:320px;">🛒 Додати в кошик</button>`);

  const stars = n => { var f = Math.round(n); return '★★★★★'.slice(0, f) + '☆☆☆☆☆'.slice(0, 5 - f); };
  const rq = new URL(request.url).searchParams.get('r');
  const thanks = (rq === 'thanks');
  const robot = (rq === 'robot');
  const reviewsHtml = `<section style="margin-top:34px;max-width:760px">
    <h2 style="font-size:1.2rem">Відгуки${revCount ? ` <span style="color:#f5a623">${stars(revAvg)}</span> ${revAvg.toFixed(1)} · ${revCount}` : ''}</h2>
    ${thanks ? '<div style="background:#eef6ee;border:1px solid #cfe3c0;border-radius:8px;padding:10px;margin:10px 0;color:var(--green)">✅ Дякуємо! Відгук зʼявиться після перевірки.</div>' : ''}
    ${robot ? '<div style="background:#fdecea;border:1px solid #f5b7b1;border-radius:8px;padding:10px;margin:10px 0;color:#922">⚠️ Не вдалося підтвердити, що ви не робот. Спробуйте ще раз.</div>' : ''}
    ${revCount ? reviews.map(r => `<div style="border-top:1px solid #eee;padding:10px 0"><div style="font-weight:700">${esc(r.name || 'Покупець')} <span style="color:#f5a623">${stars(r.rating)}</span> <span style="color:#aaa;font-size:.8rem">${esc(r.created_at || '')}</span></div><div style="color:#444;margin-top:3px;white-space:pre-wrap">${esc(r.text)}</div></div>`).join('') : ''}
    <a href="#leave-review" style="display:flex;align-items:center;gap:10px;margin:14px 0 4px;background:linear-gradient(135deg,#fff8e6,#fffdf7);border:1px solid #f0d98a;border-radius:10px;padding:12px 14px;text-decoration:none;color:#7a5b00">
      <span style="font-size:1.6rem">⭐</span>
      <span><b>${revCount ? 'Купували цей товар?' : 'Будьте першим!'}</b> Поділіться враженням — це 20 секунд і допоможе іншим садівникам. <b style="color:var(--green)">✍️ Написати відгук →</b></span>
    </a>
    <form id="leave-review" method="POST" action="/api/review" style="margin-top:8px;background:#fafcf8;border:1px solid #e3e9e0;border-radius:10px;padding:14px;scroll-margin-top:80px">
      <input type="hidden" name="pid" value="${p.pid}"><input type="hidden" name="slug" value="${esc(p.slug)}">
      <div style="font-weight:700;margin-bottom:8px">Залишити відгук</div>
      <input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <input name="name" placeholder="Ваше імʼя" maxlength="80" style="padding:8px;border:1px solid #ccc;border-radius:6px">
        <label>Оцінка: <select name="rating" style="padding:8px;border:1px solid #ccc;border-radius:6px"><option value="5">★★★★★</option><option value="4">★★★★☆</option><option value="3">★★★☆☆</option><option value="2">★★☆☆☆</option><option value="1">★☆☆☆☆</option></select></label>
      </div>
      <textarea name="text" required placeholder="Ваш відгук про товар" maxlength="2000" rows="3" style="width:100%;margin-top:8px;padding:8px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box"></textarea>
      ${s_tskey ? `<div class="cf-turnstile" data-sitekey="${esc(s_tskey)}" style="margin-top:8px"></div>` : ''}
      <button type="submit" style="margin-top:8px;background:var(--green);color:#fff;border:0;padding:9px 16px;border-radius:8px;font-weight:700;cursor:pointer">Надіслати відгук</button>
    </form>${s_tskey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}
  </section>`;
  // Картка супутнього/аналога: посилання (фото+назва+ціна) + пряма кнопка «У кошик».
  // Дані для додавання — у data-атрибутах (безпечно, без інтерполяції у JS-рядок).
  const relCard = (r, fallbackIco) => {
    const ri = r.img ? encodeURI('/' + String(r.img).replace(/^\//, '')) : '';
    const oos = r.in_stock === 0;
    const addBtn = oos
      ? `<div style="margin-top:7px;font-size:.78rem;color:#999;text-align:center">Немає в наявності</div>`
      : `<button type="button" class="rel-add" data-n="${esc(r.name)}" data-p="${Number(r.price) || 0}" data-pid="${r.pid != null ? r.pid : ''}" onclick="addRel(this)" style="width:100%;margin-top:7px;background:var(--green);color:#fff;border:0;padding:7px;border-radius:7px;font-weight:700;font-size:.82rem;cursor:pointer">🛒 У кошик</button>`;
    return `<div class="rel-card" data-n="${esc(r.name)}" style="position:relative;border:1px solid #eee;border-radius:10px;padding:10px">
      <span class="rel-badge" style="display:none;position:absolute;top:6px;left:6px;background:#ff7a00;color:#fff;border:2px solid #fff;border-radius:12px;padding:2px 9px;font-size:.85rem;font-weight:800;line-height:1.2;box-shadow:0 2px 6px rgba(0,0,0,.3);z-index:2;pointer-events:none"></span>
      <a href="/p/${esc(r.slug)}" style="text-decoration:none;color:#222;display:block">
        <div style="aspect-ratio:1;background:#f6f6f6;border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:1.6rem">${ri ? `<img src="${esc(ri)}" alt="${esc(r.name)}" loading="lazy" style="width:100%;height:100%;object-fit:contain">` : fallbackIco}</div>
        <div style="font-size:.85rem;margin-top:6px;line-height:1.25">${esc(r.name)}</div>
        <div style="font-weight:700;color:var(--green);margin-top:3px">${r.price != null ? Number(r.price).toFixed(2) + ' грн' : ''}</div>
      </a>${addBtn}</div>`;
  };
  const analogsHtml = analogs.length ? `<section style="margin-top:34px"><h2 style="font-size:1.2rem">Аналоги <span style="font-weight:400;color:#777;font-size:.9rem">(${aing.indexOf(' + ') >= 0 ? 'діючі речовини' : 'діюча речовина'}: ${esc(aing)})</span></h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:10px">
    ${analogs.map(r => relCard(r, '🧪')).join('')}
    </div></section>` : '';
  const relatedHtml = related.length ? `<section style="margin-top:34px"><h2 style="font-size:1.2rem">Схожі товари</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:10px">
    ${related.map(r => relCard(r, '🛒')).join('')}
    </div></section>` : '';

  // Хлібні крихти для Google (rich result): Каталог › Категорія › Товар
  const bcItems = [{ '@type': 'ListItem', position: 1, name: 'Каталог', item: origin + '/' }];
  if (p.category) bcItems.push({ '@type': 'ListItem', position: 2, name: p.category, item: origin + catUrl });
  bcItems.push({ '@type': 'ListItem', position: bcItems.length + 1, name: displayName, item: canonical });
  const breadcrumbLd = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: bcItems };

  // Кнопка «Поділитися»: Web Share API (мобільний) + фолбек-меню (Telegram/Viber/FB/копія)
  const shTg = 'https://t.me/share/url?url=' + encodeURIComponent(canonical) + '&text=' + encodeURIComponent(displayName);
  const shVb = 'viber://forward?text=' + encodeURIComponent(displayName + ' — ' + canonical);
  const shFb = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(canonical);
  const shareBlock = `<div style="position:relative;display:inline-block;margin:0 0 12px">
    <button type="button" id="share-btn" onclick="shareProduct(event)" aria-haspopup="true" style="display:inline-flex;align-items:center;gap:6px;background:#fff;border:1.5px solid #cfe3cf;color:var(--green);font-weight:700;font-size:.85rem;padding:6px 14px;border-radius:18px;cursor:pointer">↗ Поділитися</button>
    <div id="share-menu" style="display:none;position:absolute;z-index:30;left:0;top:112%;background:#fff;border:1px solid #cfe3cf;border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,.14);padding:6px;min-width:200px">
      <a href="${shTg}" target="_blank" rel="noopener" style="display:block;padding:8px 10px;color:#0088cc;text-decoration:none;border-radius:6px">✈️ Telegram</a>
      <a href="${shVb}" style="display:block;padding:8px 10px;color:#7360f2;text-decoration:none;border-radius:6px">📲 Viber</a>
      <a href="${shFb}" target="_blank" rel="noopener" style="display:block;padding:8px 10px;color:#1877f2;text-decoration:none;border-radius:6px">f&nbsp; Facebook</a>
      <a href="#" id="share-copy" onclick="shareCopy(event)" style="display:block;padding:8px 10px;color:#444;text-decoration:none;border-radius:6px">🔗 Копіювати посилання</a>
    </div>
  </div>`;

  const html = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="product">
<meta property="og:title" content="${esc(displayName)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(imgAbs)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(displayName)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(imgAbs)}">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#2d6a2d">
<link rel="stylesheet" href="/fonts.css">
<link rel="stylesheet" href="/style.css">
<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>
<script type="application/ld+json">${JSON.stringify(breadcrumbLd).replace(/</g, '\\u003c')}</script>
</head>
<body>
<a href="#main" class="skip-link">Перейти до вмісту</a>
<header><nav>
  <a href="/index.html" class="logo">АГРОНОМ</a>
  <a href="/protection_schemes.html" class="nav-link">🌿 Порадник</a>
  <div class="nav-right">
    <a href="tel:+380634625206" data-site-phone class="nav-phone">м. Володимир<br><strong>063 462 52 06</strong></a>
    <a href="tel:+380634625206" data-site-call class="nav-call" aria-label="Подзвонити в магазин">☎ Подзвонити</a>
  </div>
</nav></header>
<main id="main" class="container" style="max-width:900px;">
  <div class="breadcrumb" style="font-size:.85rem;color:#777;margin:12px 0;">
    <a href="/index.html" style="color:var(--green);">Каталог</a> ›
    <a href="${esc(catUrl)}" style="color:var(--green);">${esc(p.category || '')}</a> › <span>${esc(displayName)}</span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;align-items:start;">
    <div>${imgHtml}</div>
    <div>
      <h1 style="font-size:1.4rem;color:#1a2e1a;line-height:1.3;margin:0 0 6px;">${esc(displayName)}</h1>
      ${p.brand ? `<div style="text-transform:uppercase;color:#999;font-size:.78rem;letter-spacing:.05em;margin-bottom:10px;">${esc(p.brand)}</div>` : ''}
      ${shareBlock}
      <div class="price" style="font-size:1.6rem;margin:8px 0;">${priceHtml}</div>
      ${variantSelector}
      <div style="margin:8px 0 14px;">
        ${inStock ? '<span style="background:#d4edda;color:#155724;padding:3px 10px;border-radius:10px;font-size:.8rem;font-weight:600;">✅ в наявності</span>'
                  : '<span style="background:#f8d7da;color:#721c24;padding:3px 10px;border-radius:10px;font-size:.8rem;font-weight:600;">❌ немає</span>'}
      </div>
      ${addBlock}
      <div id="after-add" style="display:none; margin-top:12px; gap:10px; flex-wrap:wrap;">
        <a href="/index.html#order" class="btn" style="display:inline-block; text-decoration:none; text-align:center; max-width:240px;">✅ Оформити замовлення</a>
        <a id="tocart" href="/index.html#cart" style="display:inline-block; padding:11px 0; color:var(--green); font-weight:700; text-decoration:none;">🛒 Перейти в кошик →</a>
      </div>
      <div style="background:#f1f7ee;border:1px solid #dbe8d2;border-radius:10px;padding:12px 14px;margin-top:16px;font-size:.88rem;line-height:1.75;color:#2c3e2c;">
        <div>🚚 <b>Доставка:</b> Нова Пошта, Укрпошта</div>
        ${s_addr ? `<div>🏪 <b>Самовивіз:</b> ${esc(s_addr)}</div>` : ''}
        <div>💳 <b>Оплата:</b> готівка або на картку</div>
        <div>📞 <b>Консультація:</b> <a href="tel:+380634625206" data-site-call style="color:var(--green);font-weight:700;text-decoration:none;">${esc(s_phone)}</a>${s_viber ? ` · <a href="viber://chat?number=%2B${esc(s_viber)}" style="color:#7360f2;font-weight:700;text-decoration:none;">📲 Viber</a>` : ''} — питайте перед замовленням</div>
      </div>
    </div>
  </div>
  ${aing ? `<div style="margin-top:18px;color:#333"><b>${aing.indexOf(' + ') >= 0 ? 'Діючі речовини' : 'Діюча речовина'}:</b> ${esc(aing)}</div>` : ''}
  ${p.annotation ? `<div style="margin-top:14px;line-height:1.65;color:#444;border-left:3px solid var(--gl);padding-left:14px;max-width:760px;">${esc(p.annotation)}</div>` : ''}
  ${p.dosage ? `<div style="background:#fff9e6;border:1px solid #f0e0b0;border-radius:10px;padding:12px 14px;margin-top:14px;max-width:760px;font-size:.92rem;line-height:1.6;color:#5a4a1a;">
    <div>💧 <b>Дозування:</b> ${esc(p.dosage)}</div>
    <div id="dose-calc" style="display:none;margin-top:8px;">🧮 На <input id="dose-vol" type="number" min="0" step="1" value="10" inputmode="decimal" style="width:66px;padding:5px 7px;border:1.5px solid #d4b96a;border-radius:6px;text-align:center;font-weight:700;font-size:.95rem;"> л води потрібно <b style="color:var(--green);"><span id="dose-out">—</span> <span id="dose-unit"></span></b></div>
  </div>` : ''}
  <div style="margin-top:28px;"><a href="${esc(catUrl)}" style="color:var(--green);">← Усі товари категорії «${esc(p.category || '')}»</a></div>
  ${analogsHtml}
  ${reviewsHtml}
  ${relatedHtml}
</main>
<nav class="bottom-nav" aria-label="Швидка навігація">
  <a href="/index.html" class="bn-item"><span class="bn-ico">📦</span><span class="bn-lbl">Каталог</span></a>
  <a href="/index.html" class="bn-item"><span class="bn-ico">🔍</span><span class="bn-lbl">Пошук</span></a>
  <a href="/index.html#cart" class="bn-item"><span class="bn-ico">🛒</span><span class="bn-lbl">Кошик</span></a>
  <a href="/contacts.html" class="bn-item"><span class="bn-ico">☎️</span><span class="bn-lbl">Контакти</span></a>
</nav>
<div id="site-footer"></div>
<script>
// Поділитися: на мобільному — рідне меню (navigator.share), інакше — фолбек-меню
function shareProduct(e){ e.preventDefault();
  if(navigator.share){ navigator.share({title:document.title, url:location.href}).catch(function(){}); return; }
  var m=document.getElementById('share-menu'); if(m) m.style.display=(m.style.display==='block')?'none':'block';
}
function shareCopy(e){ e.preventDefault();
  try{ navigator.clipboard.writeText(location.href); }catch(_){ try{var t=document.createElement('textarea');t.value=location.href;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();}catch(__){} }
  var el=document.getElementById('share-copy'); if(el){ var o=el.textContent; el.textContent='✓ Скопійовано'; setTimeout(function(){el.textContent=o;},1500); }
}
document.addEventListener('click', function(e){ var m=document.getElementById('share-menu'); if(m && m.style.display==='block' && !e.target.closest('#share-btn') && !e.target.closest('#share-menu')) m.style.display='none'; });
window.__P = ${JSON.stringify({ n: displayName, p: Number(effPrice) || 0, w: !!weight, pid: Number(p.pid) || null, div: divisible ? divisor : null }).replace(/</g, '\\u003c')};
var DC = ${JSON.stringify(doseCalc).replace(/</g, '\\u003c')};
(function(){
  if(!DC) return; var box=document.getElementById('dose-calc'); if(!box) return;
  var u=document.getElementById('dose-unit'), inp=document.getElementById('dose-vol'), out=document.getElementById('dose-out');
  if(u) u.textContent=DC.unit;
  function calc(){ var v=parseFloat(String(inp.value).replace(',','.'))||0; out.textContent=Math.round(DC.amount*v/DC.per*100)/100; }
  if(inp&&out){ inp.addEventListener('input', calc); calc(); box.style.display='block'; }
})();
function pqtyChange(dir){
  var step=window.__P.div||1;
  var i=document.getElementById('pqty'); if(!i) return;
  var v=Math.round((parseFloat(i.value)||step)*1000)/1000;
  v=Math.round((v+dir*step)*1000)/1000;
  if(v<step) v=step;
  i.value=v;
}
function addToCart(){
  var KEY='agronom_cart', cart; try{cart=JSON.parse(localStorage.getItem(KEY))||[]}catch(e){cart=[]}
  var name=window.__P.n, price=window.__P.p, q=1;
  if(window.__P.w){ var i=document.getElementById('pqty'); q=parseFloat(i&&i.value)||1; if(q<=0)q=1; name=name+' (кг)'; }
  else if(window.__P.div){ var i=document.getElementById('pqty'); q=parseFloat(i&&i.value)||window.__P.div; if(q<=0)q=window.__P.div; }
  var it=cart.find(function(x){return x.n===name});
  if(it){ it.q = (window.__P.w||window.__P.div) ? Math.round((it.q+q)*1000)/1000 : it.q+q; } else { cart.push({n:name,p:price,q:q,pid:window.__P.pid}); }
  localStorage.setItem(KEY, JSON.stringify(cart));
  var b=document.getElementById('addbtn'); if(b){ b.textContent='✓ Додано!'; b.style.background='#1a3a1a'; }
  var aa=document.getElementById('after-add'); if(aa) aa.style.display='flex';
}
// Додати супутній/аналог у кошик напряму (дані з data-атрибутів кнопки)
function addRel(btn){
  var KEY='agronom_cart', cart; try{cart=JSON.parse(localStorage.getItem(KEY))||[]}catch(e){cart=[]}
  var name=btn.getAttribute('data-n'), price=parseFloat(btn.getAttribute('data-p'))||0;
  var pidRaw=btn.getAttribute('data-pid'), pid=pidRaw?parseInt(pidRaw,10):null;
  var it=cart.find(function(x){return x.n===name});
  if(it){ it.q+=1; } else { cart.push({n:name,p:price,q:1,pid:pid}); }
  localStorage.setItem(KEY, JSON.stringify(cart));
  btn.textContent='✓ Додано'; btn.style.background='#1a3a1a';
  var aa=document.getElementById('after-add'); if(aa) aa.style.display='flex';
  markRelInCart();
}
// Бейдж «вже в кошику» на картках аналогів/супутніх (як у каталозі)
function markRelInCart(){
  var cart; try{cart=JSON.parse(localStorage.getItem('agronom_cart'))||[]}catch(e){cart=[]}
  document.querySelectorAll('.rel-card').forEach(function(card){
    var n=card.getAttribute('data-n');
    var it=cart.find(function(x){return x.n===n});
    var badge=card.querySelector('.rel-badge');
    if(it){
      if(badge){ var q=it.q; badge.textContent='🛒 '+(q%1===0?q:q.toFixed(2))+' у кошику'; badge.style.display='block'; }
      card.style.boxShadow='0 0 0 2px #ff7a00';
    } else {
      if(badge) badge.style.display='none';
      card.style.boxShadow='none';
    }
  });
}
markRelInCart();
</script>
<script src="/site-config"></script>
<script src="/footer.js"></script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' }
  });
}
