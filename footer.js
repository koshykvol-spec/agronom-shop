// footer.js — спільний футер. Рендерить у <div id="site-footer">.
// Потребує window.SITE_CONFIG (site-config.js).
(function () {
    var c = window.SITE_CONFIG || {};
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    // Телефон/місто у шапці сторінки (data-site-phone) — з конфігу (єдине джерело: site_settings).
    document.querySelectorAll('a[data-site-phone]').forEach(function (a) {
        if (c.phoneIntl) a.setAttribute('href', 'tel:' + c.phoneIntl);
        a.innerHTML = esc(c.city || '') + '<br><strong>' + esc(c.phoneDisplay || '') + '</strong>';
    });
    // Кнопка «Подзвонити» у шапці — той самий телефон з конфігу
    document.querySelectorAll('a[data-site-call]').forEach(function (a) {
        if (c.phoneIntl) a.setAttribute('href', 'tel:' + c.phoneIntl);
    });

    // ── Аналітика (Clarity + GA4) — вмикається, коли задано ID у /admin/contacts ──
    (function () {
        if (window.__analyticsLoaded) return; window.__analyticsLoaded = true;
        if (c.ga4_id) {
            var s = document.createElement('script'); s.async = true;
            s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(c.ga4_id);
            document.head.appendChild(s);
            window.dataLayer = window.dataLayer || [];
            window.gtag = function () { window.dataLayer.push(arguments); };
            window.gtag('js', new Date()); window.gtag('config', c.ga4_id);
        }
        if (c.clarity_id) {
            (function (w, d, t, i) {
                w.clarity = w.clarity || function () { (w.clarity.q = w.clarity.q || []).push(arguments); };
                var e = d.createElement(t); e.async = 1; e.src = 'https://www.clarity.ms/tag/' + i;
                var f = d.getElementsByTagName(t)[0]; f.parentNode.insertBefore(e, f);
            })(window, document, 'script', c.clarity_id);
        }
        if ((c.ga4_id || c.clarity_id) && !localStorage.getItem('agronom_cookie_ok')) {
            var bar = document.createElement('div');
            bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99998;background:#2d3a2d;color:#fff;padding:10px 14px;font-size:.85rem;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap';
            bar.innerHTML = 'Ми використовуємо файли cookie для аналітики та зручності. <a href="/returns.html" style="color:#cfe3c0">Докладніше</a> <button style="background:#8bbf6a;border:0;border-radius:6px;padding:5px 14px;font-weight:700;cursor:pointer">Зрозуміло</button>';
            bar.querySelector('button').addEventListener('click', function () { localStorage.setItem('agronom_cookie_ok', '1'); bar.remove(); });
            document.body.appendChild(bar);
        }
    })();

    var container = document.getElementById('site-footer');
    if (!container) return;

    var year = (new Date()).getFullYear();
    var viberHref = 'viber://chat?number=' + (c.viberPhone || '');
    var stores = (c.stores && c.stores.length) ? c.stores : [{ name: c.name, address: c.address, hours: c.hours }];

    // Колонки магазинів (адреса з посиланням на маршрут + графік)
    var storeCols = stores.map(function (s) {
        var addr = s.map
            ? '<a class="footer-line" href="' + esc(s.map) + '" target="_blank" rel="noopener">📍 ' + esc(s.address) + '</a>'
            : '<div class="footer-line">📍 ' + esc(s.address) + '</div>';
        return '<div class="footer-col">'
            + '<div class="footer-brand">' + esc(s.name || c.name || 'Агроном') + '</div>'
            + addr
            + '<div class="footer-line">🕒 ' + esc(s.hours || '') + '</div>'
            + '</div>';
    }).join('');

    var html = ''
      + '<footer class="site-footer">'
      + '  <div class="footer-grid">'
      +      storeCols
      + '    <div class="footer-col">'
      + '      <div class="footer-h">Контакти</div>'
      + '      <a class="footer-line" href="tel:' + esc(c.phoneIntl || '') + '">📞 ' + esc(c.phoneDisplay || '') + '</a>'
      + '      <a class="footer-line" href="' + esc(viberHref) + '">📲 Viber</a>'
      + (c.telegram ? '      <a class="footer-line" href="' + esc(c.telegram) + '" target="_blank" rel="noopener">✈️ Telegram</a>' : '')
      + (c.email ? '      <a class="footer-line" href="mailto:' + esc(c.email) + '">✉️ ' + esc(c.email) + '</a>' : '')
      + '    </div>'
      + '    <div class="footer-col">'
      + '      <div class="footer-h">Інформація</div>'
      + '      <a class="footer-line" href="/delivery.html">Доставка і оплата</a>'
      + '      <a class="footer-line" href="/contacts.html">Контакти</a>'
      + '      <a class="footer-line" href="/returns.html">Повернення та оферта</a>'
      + '    </div>'
      + '  </div>'
      + '  <div class="footer-legal">© ' + year + ' ' + esc(c.network || c.name || 'Агроном') + ' · ' + esc(c.fop || '') + ' · ' + esc(c.city || '') + (c.region ? ', ' + esc(c.region) : '') + '</div>'
      + '</footer>';
    container.innerHTML = html;
})();
