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
      ? `<div class="rc-oos">Немає в наявності</div>`
      : `<button type="button" class="rc-add" data-n="${esc(r.name)}" data-p="${Number(r.price) || 0}" data-pid="${r.pid != null ? r.pid : ''}" onclick="addRel(this)">🛒 У кошик</button>`;
    return `<div class="rel-card" data-n="${esc(r.name)}">
      <span class="rel-badge"></span>
      <a href="/p/${esc(r.slug)}">
        <div class="rc-img">${ri ? `<img src="${esc(ri)}" alt="${esc(r.name)}" loading="lazy">` : fallbackIco}</div>
        <div class="rc-name">${esc(r.name)}</div>
        <div class="rc-price">${r.price != null ? Number(r.price).toFixed(2) + ' грн' : ''}</div>
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
<style>
/* ── Сторінка товару ───────────────────────────────── */
.p-layout   { display:grid; grid-template-columns:1fr; gap:28px; align-items:start; margin-top:16px; }
@media(min-width:600px){ .p-layout { grid-template-columns:minmax(260px,2fr) 3fr; } }

.p-gallery img { width:100%; max-height:360px; object-fit:contain; border-radius:14px; background:#f6f6f6; display:block; }
.p-gallery .no-img { aspect-ratio:4/3; background:#eef5ee; display:flex; align-items:center; justify-content:center; font-size:3rem; border-radius:14px; }
.p-thumbs  { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
.p-thumbs img { width:64px; height:64px; object-fit:contain; background:#f6f6f6; border:2px solid #ddd; border-radius:8px; cursor:pointer; transition:border-color .15s; }
.p-thumbs img.active { border-color:var(--green); }

.p-info    { display:flex; flex-direction:column; gap:0; }
.p-brand   { text-transform:uppercase; color:#aaa; font-size:.75rem; letter-spacing:.08em; margin-bottom:4px; }
.p-title   { font-size:1.45rem; font-weight:800; color:var(--text); line-height:1.25; margin:0 0 10px; }
.p-price   { font-size:1.7rem; font-weight:800; color:var(--green); margin:0 0 6px; line-height:1.2; }
.p-price .old { font-size:1rem; font-weight:400; color:#aaa; text-decoration:line-through; margin-right:6px; }
.p-price .sale-val { color:#c0392b; }
.sale-badge { display:inline-block; background:#ff7a00; color:#fff; border-radius:8px; padding:2px 10px; font-size:.7rem; font-weight:800; vertical-align:middle; white-space:nowrap; margin-left:6px; }
.p-stock   { display:inline-flex; align-items:center; gap:5px; font-size:.82rem; font-weight:700; padding:4px 12px; border-radius:20px; margin-bottom:12px; }
.p-stock.in  { background:#d4edda; color:#155724; }
.p-stock.out { background:#f8d7da; color:#721c24; }

.p-add-row { display:flex; flex-direction:column; gap:8px; margin-bottom:14px; }
.p-qty     { display:flex; align-items:center; gap:0; border:2px solid var(--green); border-radius:10px; overflow:hidden; width:fit-content; }
.p-qty button { width:38px; height:40px; background:#f0f7f0; border:none; font-size:1.25rem; cursor:pointer; color:var(--green); font-weight:700; }
.p-qty input  { width:72px; height:40px; border:none; border-left:1px solid #cde8cd; border-right:1px solid #cde8cd; text-align:center; font-weight:700; font-size:1rem; font-family:inherit; }
.p-qty-label  { font-size:.88rem; color:#555; }

.p-cta     { display:flex; flex-direction:column; gap:10px; }
.p-cta .btn { width:100%; max-width:320px; font-size:1rem; padding:13px 0; text-align:center; border-radius:10px; }
.p-after   { display:none; flex-wrap:wrap; gap:10px; align-items:center; margin-top:4px; }
.p-after .btn { max-width:220px; font-size:.9rem; padding:10px 0; text-decoration:none; text-align:center; }
.p-after .go  { color:var(--green); font-weight:700; text-decoration:none; font-size:.9rem; }

.p-delivery { background:#f1f7ee; border:1px solid #d4e8d4; border-radius:12px; padding:13px 15px; margin-top:16px; font-size:.86rem; line-height:1.85; color:#2c3e2c; }
.p-delivery b { color:#1a3e1a; }
.p-delivery a { color:var(--green); font-weight:700; text-decoration:none; }

/* ── Поділитися ── */
.share-wrap { position:relative; display:inline-block; margin-bottom:12px; }
.share-btn  { display:inline-flex; align-items:center; gap:5px; background:#fff; border:1.5px solid #cfe3cf; color:var(--green); font-weight:700; font-size:.82rem; padding:5px 13px; border-radius:18px; cursor:pointer; }
.share-menu { display:none; position:absolute; z-index:30; left:0; top:110%; background:#fff; border:1px solid #d4e8d4; border-radius:10px; box-shadow:0 6px 20px rgba(0,0,0,.13); padding:5px; min-width:200px; }
.share-menu a { display:block; padding:8px 10px; text-decoration:none; border-radius:6px; font-size:.88rem; }

/* ── Секції опису ── */
.p-section  { margin-top:28px; max-width:760px; }
.p-section h2 { font-size:1.05rem; font-weight:800; color:var(--text); border-bottom:2px solid #e6f0e6; padding-bottom:6px; margin:0 0 12px; }

.p-desc     { font-size:.96rem; line-height:1.75; color:#333; white-space:pre-line; }
.p-ai       { display:inline-flex; align-items:center; gap:8px; background:#eef5ee; border:1px solid #cde8cd; border-radius:8px; padding:7px 13px; font-size:.88rem; color:#1a3e1a; }
.p-ai strong { color:var(--green); }

.p-dosage   { background:#fff9e6; border:1px solid #f0e0b0; border-radius:12px; padding:14px 16px; font-size:.92rem; line-height:1.65; color:#5a4a1a; }
.p-dosage .dose-text { margin-bottom:8px; }
.p-dose-calc { display:none; align-items:center; gap:8px; flex-wrap:wrap; margin-top:8px; font-size:.9rem; }
.p-dose-calc input { width:64px; padding:5px 6px; border:1.5px solid #d4b96a; border-radius:6px; text-align:center; font-weight:700; font-size:.92rem; font-family:inherit; }
.p-dose-calc .result { font-weight:700; color:var(--green); font-size:1.05rem; }

/* ── Варіанти фасовок ── */
.p-variants      { display:flex; flex-wrap:wrap; gap:8px; margin:4px 0 14px; }
.p-variants a,
.p-variants span { display:inline-flex; flex-direction:column; align-items:center; padding:7px 14px; border-radius:9px; border:2px solid #ccc; text-decoration:none; line-height:1.25; }
.p-variants span { border-color:var(--green); background:var(--green); color:#fff; }
.p-variants a    { color:var(--text); }
.p-variants a:hover { border-color:var(--green); }
.p-variants .v-price { font-size:.75rem; font-weight:700; color:var(--green); margin-top:2px; }
.p-variants span .v-price { color:#dfeede; }
.p-variants .oos { opacity:.5; }

/* ── Картки аналогів/супутніх ── */
.rel-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(148px,1fr)); gap:12px; margin-top:12px; }
.rel-card { position:relative; border:1px solid #eee; border-radius:10px; padding:10px; transition:box-shadow .15s; }
.rel-card:hover { box-shadow:0 2px 12px rgba(0,0,0,.1); }
.rel-card a   { text-decoration:none; color:var(--text); display:block; }
.rel-card .rc-img { aspect-ratio:1; background:#f6f6f6; border-radius:8px; overflow:hidden; display:flex; align-items:center; justify-content:center; font-size:1.6rem; }
.rel-card .rc-img img { width:100%; height:100%; object-fit:contain; }
.rel-card .rc-name  { font-size:.82rem; margin-top:6px; line-height:1.3; }
.rel-card .rc-price { font-weight:700; color:var(--green); font-size:.88rem; margin-top:3px; }
.rel-card .rc-add   { width:100%; margin-top:8px; background:var(--green); color:#fff; border:0; padding:7px; border-radius:7px; font-weight:700; font-size:.8rem; cursor:pointer; }
.rel-card .rc-oos   { text-align:center; font-size:.77rem; color:#aaa; margin-top:7px; }
.rel-badge { display:none; position:absolute; top:6px; left:6px; background:#ff7a00; color:#fff; border:2px solid #fff; border-radius:12px; padding:2px 8px; font-size:.78rem; font-weight:800; box-shadow:0 2px 6px rgba(0,0,0,.25); z-index:2; pointer-events:none; }

/* ── Відгуки ── */
.p-review-card { border-top:1px solid #eee; padding:12px 0; }
.p-review-card .rc-author { font-weight:700; font-size:.92rem; }
.p-review-card .rc-stars  { color:#f5a623; margin:0 4px; }
.p-review-card .rc-date   { color:#aaa; font-size:.78rem; }
.p-review-card .rc-text   { margin-top:6px; font-size:.9rem; line-height:1.6; color:#444; white-space:pre-wrap; }
.p-review-cta  { display:flex; align-items:center; gap:12px; background:linear-gradient(135deg,#fff8e6,#fffdf7); border:1px solid #f0d98a; border-radius:10px; padding:12px 14px; text-decoration:none; color:#7a5b00; margin:14px 0 6px; }
.p-review-cta .ico { font-size:1.5rem; flex-shrink:0; }
.p-review-form { background:#fafcf8; border:1px solid #e3e9e0; border-radius:12px; padding:16px; scroll-margin-top:80px; }
.p-review-form .rf-title { font-weight:700; margin-bottom:10px; }
.p-review-form .rf-row   { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:10px; }
.p-review-form input[type=text],
.p-review-form select     { padding:9px 11px; border:1.5px solid #ccc; border-radius:8px; font-family:inherit; font-size:.9rem; }
.p-review-form textarea   { width:100%; padding:9px 11px; border:1.5px solid #ccc; border-radius:8px; font-family:inherit; font-size:.9rem; box-sizing:border-box; resize:vertical; }
.p-review-form .rf-submit { margin-top:10px; background:var(--green); color:#fff; border:0; padding:10px 20px; border-radius:8px; font-weight:700; font-size:.95rem; cursor:pointer; }
</style>
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

<main id="main" class="container" style="max-width:920px;">

  <!-- Хлібні крихти -->
  <nav class="breadcrumb" aria-label="Навігація" style="font-size:.83rem;color:#999;margin:12px 0 0;">
    <a href="/index.html" style="color:var(--green);">Каталог</a> ›
    <a href="${esc(catUrl)}" style="color:var(--green);">${esc(p.category || '')}</a> ›
    <span>${esc(displayName)}</span>
  </nav>

  <!-- Основний грід: фото | інфо -->
  <div class="p-layout">

    <!-- Галерея -->
    <div class="p-gallery">
      ${mainSrc
        ? `<img id="pmain" src="${esc(mainSrc)}" alt="${esc(displayName)}" onerror="this.style.display='none';document.getElementById('pmain-fb').style.display='flex';">
           <div id="pmain-fb" class="no-img" style="display:none;">🧪</div>
           ${imgList.length > 1 ? `<div class="p-thumbs">${imgList.map((pth, i) => `<img src="${esc(toSrc(pth))}" alt="${esc(displayName)} — фото ${i+1}" loading="lazy" class="${i===0?'active':''}" onclick="setThumb(this,'${esc(toSrc(pth))}')">`).join('')}</div>` : ''}`
        : `<div class="no-img">🧪</div>`}
    </div>

    <!-- Права колонка -->
    <div class="p-info">
      ${p.brand ? `<div class="p-brand">${esc(p.brand)}</div>` : ''}
      <h1 class="p-title">${esc(displayName)}</h1>

      <!-- Ціна -->
      <div class="p-price">
        ${onSale
          ? `<span class="old">${Number(p.price).toFixed(2)} грн</span><span class="sale-val">${Number(p.sale_price).toFixed(2)} грн</span>${weight ? ' <small>/кг</small>' : ''}<span class="sale-badge">🏷️ Акція${p.sale_until ? ' до ' + fmtD(p.sale_until) : ''}</span>`
          : `${price} грн${weight ? ' <small>/кг</small>' : ''}`}
      </div>

      <!-- Фасовки -->
      ${variantSelector ? `<div class="p-variants">${variantSelector}</div>` : ''}

      <!-- Наявність -->
      <div class="p-stock ${inStock ? 'in' : 'out'}">
        ${inStock ? '✅ В наявності' : '❌ Немає в наявності'}
      </div>

      <!-- Кнопка «Додати» / лічильник кількості -->
      <div class="p-add-row">
        ${!inStock ? ''
          : weight
            ? `<div class="p-qty-label">Кількість (кг):</div>
               <div class="p-qty">
                 <button type="button" onclick="pqtyChange(-1)">&#8722;</button>
                 <input id="pqty" type="number" value="1" step="0.5" min="0.5" inputmode="decimal">
                 <button type="button" onclick="pqtyChange(1)">+</button>
               </div>`
            : (divisible && divisor
                ? `<div class="p-qty-label">Кількість (кратно ${divisor}):</div>
                   <div class="p-qty">
                     <button type="button" onclick="pqtyChange(-1)">&#8722;</button>
                     <input id="pqty" type="number" value="${divisor}" step="${divisor}" min="${divisor}">
                     <button type="button" onclick="pqtyChange(1)">+</button>
                   </div>`
                : '')}
        <div class="p-cta">
          ${inStock
            ? `<button class="btn" id="addbtn" onclick="addToCart()">🛒 Додати в кошик</button>`
            : `<div class="oos-badge">Немає в наявності</div>`}
          <div class="p-after" id="after-add">
            <a href="/index.html#order" class="btn" style="text-decoration:none;">✅ Оформити замовлення</a>
            <a href="/index.html#cart" class="go">🛒 До кошика →</a>
          </div>
        </div>
      </div>

      <!-- Поділитися -->
      <div class="share-wrap">
        <button type="button" class="share-btn" id="share-btn" onclick="shareProduct(event)" aria-haspopup="true">↗ Поділитися</button>
        <div class="share-menu" id="share-menu">
          <a href="${shTg}" target="_blank" rel="noopener" style="color:#0088cc;">✈️ Telegram</a>
          <a href="${shVb}" style="color:#7360f2;">📲 Viber</a>
          <a href="${shFb}" target="_blank" rel="noopener" style="color:#1877f2;">f&nbsp; Facebook</a>
          <a href="#" id="share-copy" onclick="shareCopy(event)" style="color:#444;">🔗 Копіювати посилання</a>
        </div>
      </div>

      <!-- Доставка / контакти -->
      <div class="p-delivery">
        <div>🚚 <b>Доставка:</b> Нова Пошта, Укрпошта</div>
        ${s_addr ? `<div>🏪 <b>Самовивіз:</b> ${esc(s_addr)}</div>` : ''}
        <div>💳 <b>Оплата:</b> готівка або на картку</div>
        <div>📞 <b>Консультація:</b>
          <a href="tel:+380634625206" data-site-call>${esc(s_phone)}</a>${s_viber ? ` · <a href="viber://chat?number=%2B${esc(s_viber)}" style="color:#7360f2;">📲 Viber</a>` : ''} — питайте перед замовленням</div>
      </div>
    </div>
  </div><!-- /p-layout -->

  <!-- Діюча речовина -->
  ${aing ? `<div class="p-section">
    <h2>🔬 Склад</h2>
    <div class="p-ai">
      <span>${aing.indexOf(' + ') >= 0 ? 'Діючі речовини' : 'Діюча речовина'}:</span>
      <strong>${esc(aing)}</strong>
    </div>
  </div>` : ''}

  <!-- Анотація / опис -->
  ${p.annotation ? `<div class="p-section">
    <h2>📋 Опис</h2>
    <div class="p-desc">${esc(p.annotation)}</div>
  </div>` : ''}

  <!-- Дозування + калькулятор -->
  ${p.dosage ? `<div class="p-section">
    <h2>💧 Дозування</h2>
    <div class="p-dosage">
      <div class="dose-text">${esc(p.dosage)}</div>
      <div class="p-dose-calc" id="dose-calc">
        🧮 На <input id="dose-vol" type="number" min="0" step="1" value="10" inputmode="decimal"> л води —
        <span class="result"><span id="dose-out">—</span> <span id="dose-unit"></span></span>
      </div>
    </div>
  </div>` : ''}

  <!-- Посилання назад -->
  <div style="margin-top:28px;">
    <a href="${esc(catUrl)}" style="color:var(--green);font-size:.9rem;">← Усі товари категорії «${esc(p.category || '')}»</a>
  </div>

  <!-- Аналоги -->
  ${analogs.length ? `<div class="p-section" style="max-width:none;">
    <h2>🔄 Аналоги <span style="font-weight:400;color:#888;font-size:.88rem;">(${aing.indexOf(' + ') >= 0 ? 'діючі речовини' : 'діюча речовина'}: ${esc(aing)})</span></h2>
    <div class="rel-grid">${analogs.map(r => relCard(r, '🧪')).join('')}</div>
  </div>` : ''}

  <!-- Відгуки -->
  <div class="p-section" style="max-width:760px;">
    <h2>⭐ Відгуки${revCount ? ` <span style="color:#f5a623;">${'★'.repeat(Math.round(revAvg))}${'☆'.repeat(5-Math.round(revAvg))}</span> ${revAvg.toFixed(1)} · ${revCount}` : ''}</h2>

    ${thanks ? '<div style="background:#eef6ee;border:1px solid #cfe3c0;border-radius:8px;padding:10px;margin-bottom:10px;color:var(--green);">✅ Дякуємо! Відгук з\'явиться після перевірки.</div>' : ''}
    ${robot  ? '<div style="background:#fdecea;border:1px solid #f5b7b1;border-radius:8px;padding:10px;margin-bottom:10px;color:#922;">⚠️ Не вдалося підтвердити, що ви не робот. Спробуйте ще раз.</div>' : ''}

    ${revCount ? reviews.map(r => `<div class="p-review-card">
      <div>
        <span class="rc-author">${esc(r.name || 'Покупець')}</span>
        <span class="rc-stars">${'★'.repeat(r.rating || 5)}${'☆'.repeat(5-(r.rating||5))}</span>
        <span class="rc-date">${esc(r.created_at || '')}</span>
      </div>
      <div class="rc-text">${esc(r.text)}</div>
    </div>`).join('') : ''}

    <a href="#leave-review" class="p-review-cta">
      <span class="ico">⭐</span>
      <span><b>${revCount ? 'Купували цей товар?' : 'Будьте першим!'}</b> Поділіться враженням — це 20 секунд і допоможе іншим.
      <b style="color:var(--green);">✍️ Написати відгук →</b></span>
    </a>

    <form id="leave-review" class="p-review-form" method="POST" action="/api/review">
      <input type="hidden" name="pid" value="${p.pid}">
      <input type="hidden" name="slug" value="${esc(p.slug)}">
      <input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px;" aria-hidden="true">
      <div class="rf-title">Залишити відгук</div>
      <div class="rf-row">
        <input type="text" name="name" placeholder="Ваше ім'я" maxlength="80">
        <label style="display:flex;align-items:center;gap:6px;font-size:.9rem;">Оцінка:
          <select name="rating">
            <option value="5">★★★★★</option>
            <option value="4">★★★★☆</option>
            <option value="3">★★★☆☆</option>
            <option value="2">★★☆☆☆</option>
            <option value="1">★☆☆☆☆</option>
          </select>
        </label>
      </div>
      <textarea name="text" required placeholder="Ваш відгук про товар" maxlength="2000" rows="4"></textarea>
      ${s_tskey ? `<div class="cf-turnstile" data-sitekey="${esc(s_tskey)}" style="margin-top:10px;"></div>` : ''}
      <button type="submit" class="rf-submit">Надіслати відгук</button>
    </form>
    ${s_tskey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}
  </div>

  <!-- Схожі товари -->
  ${related.length ? `<div class="p-section" style="max-width:none;">
    <h2>🛒 Схожі товари</h2>
    <div class="rel-grid">${related.map(r => relCard(r, '🛒')).join('')}</div>
  </div>` : ''}

</main>

<nav class="bottom-nav" aria-label="Швидка навігація">
  <a href="/index.html" class="bn-item"><span class="bn-ico">📦</span><span class="bn-lbl">Каталог</span></a>
  <a href="/index.html" class="bn-item"><span class="bn-ico">🔍</span><span class="bn-lbl">Пошук</span></a>
  <a href="/index.html#cart" class="bn-item"><span class="bn-ico">🛒</span><span class="bn-lbl">Кошик</span></a>
  <a href="/contacts.html" class="bn-item"><span class="bn-ico">☎️</span><span class="bn-lbl">Контакти</span></a>
</nav>
<div id="site-footer"></div>

<script>
// ── Мініатюри галереї ──
function setThumb(el, src){
  var m=document.getElementById('pmain'); if(m){ m.src=src; m.style.display=''; }
  var fb=document.getElementById('pmain-fb'); if(fb) fb.style.display='none';
  document.querySelectorAll('.p-thumbs img').forEach(function(t){ t.classList.remove('active'); });
  el.classList.add('active');
}

// ── Поділитися ──
function shareProduct(e){ e.preventDefault();
  if(navigator.share){ navigator.share({title:document.title, url:location.href}).catch(function(){}); return; }
  var m=document.getElementById('share-menu'); if(m) m.style.display=(m.style.display==='block')?'none':'block';
}
function shareCopy(e){ e.preventDefault();
  try{ navigator.clipboard.writeText(location.href); }catch(_){
    try{ var t=document.createElement('textarea'); t.value=location.href; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }catch(__){} }
  var el=document.getElementById('share-copy'); if(el){ var o=el.textContent; el.textContent='✓ Скопійовано'; setTimeout(function(){el.textContent=o;},1500); }
}
document.addEventListener('click', function(e){
  var m=document.getElementById('share-menu');
  if(m && m.style.display==='block' && !e.target.closest('#share-btn') && !e.target.closest('#share-menu')) m.style.display='none';
});

// ── Дані товару ──
window.__P = ${JSON.stringify({ n: displayName, p: Number(effPrice) || 0, w: !!weight, pid: Number(p.pid) || null, div: divisible ? divisor : null }).replace(/</g, '\\u003c')};
var DC = ${JSON.stringify(doseCalc).replace(/</g, '\\u003c')};

// ── Калькулятор дозування ──
(function(){
  if(!DC) return;
  var box=document.getElementById('dose-calc'); if(!box) return;
  var inp=document.getElementById('dose-vol'), out=document.getElementById('dose-out'), u=document.getElementById('dose-unit');
  if(u) u.textContent=DC.unit;
  function calc(){ var v=parseFloat(String(inp.value).replace(',','.'))||0; out.textContent=v?Math.round(DC.amount*v/DC.per*100)/100:'—'; }
  if(inp&&out){ inp.addEventListener('input',calc); calc(); box.style.display='flex'; }
})();

// ── Лічильник кількості ──
function pqtyChange(dir){
  var step=window.__P.div||( window.__P.w ? 0.5 : 1 );
  var i=document.getElementById('pqty'); if(!i) return;
  var v=Math.round((parseFloat(i.value)||step)*1000)/1000;
  v=Math.round((v+dir*step)*1000)/1000;
  if(v<step) v=step;
  i.value=v;
}

// ── Додати в кошик ──
function addToCart(){
  var KEY='agronom_cart', cart; try{cart=JSON.parse(localStorage.getItem(KEY))||[]}catch(e){cart=[]}
  var name=window.__P.n, price=window.__P.p, q=1;
  if(window.__P.w){
    var i=document.getElementById('pqty'); q=parseFloat(i&&i.value)||1; if(q<=0)q=1; name=name+' (кг)';
  } else if(window.__P.div){
    var i=document.getElementById('pqty'); q=parseFloat(i&&i.value)||window.__P.div; if(q<=0)q=window.__P.div;
  }
  var it=cart.find(function(x){return x.n===name;});
  if(it){ it.q=(window.__P.w||window.__P.div)?Math.round((it.q+q)*1000)/1000:it.q+1; }
  else   { cart.push({n:name,p:price,q:q,pid:window.__P.pid,div:window.__P.div||null}); }
  localStorage.setItem(KEY,JSON.stringify(cart));
  var b=document.getElementById('addbtn'); if(b){ b.textContent='✓ Додано!'; b.style.background='#1a3a1a'; }
  var aa=document.getElementById('after-add'); if(aa) aa.style.display='flex';
}

// ── Картки аналогів/супутніх ──
function addRel(btn){
  var KEY='agronom_cart', cart; try{cart=JSON.parse(localStorage.getItem(KEY))||[]}catch(e){cart=[]}
  var name=btn.getAttribute('data-n'), price=parseFloat(btn.getAttribute('data-p'))||0;
  var pid=btn.getAttribute('data-pid'); pid=pid?parseInt(pid,10):null;
  var it=cart.find(function(x){return x.n===name;});
  if(it){ it.q+=1; } else { cart.push({n:name,p:price,q:1,pid:pid}); }
  localStorage.setItem(KEY,JSON.stringify(cart));
  btn.textContent='✓ Додано'; btn.style.background='#1a3a1a';
  var aa=document.getElementById('after-add'); if(aa) aa.style.display='flex';
  markRelInCart();
}
function markRelInCart(){
  var cart; try{cart=JSON.parse(localStorage.getItem('agronom_cart'))||[]}catch(e){cart=[]}
  document.querySelectorAll('.rel-card').forEach(function(card){
    var n=card.getAttribute('data-n');
    var it=cart.find(function(x){return x.n===n;});
    var badge=card.querySelector('.rel-badge');
    if(it){
      if(badge){ badge.textContent='🛒 '+(it.q%1===0?it.q:it.q.toFixed(2))+' у кошику'; badge.style.display='block'; }
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
