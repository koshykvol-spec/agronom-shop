// seo-jsonld.js — структуровані дані LocalBusiness/Store. Бере все з window.SITE_CONFIG.
(function () {
    var c = window.SITE_CONFIG || {};
    var origin = location.origin;

    function ohSpec(oh) {
        return (oh || []).map(function (h) {
            return { "@type": "OpeningHoursSpecification", "dayOfWeek": h.d, "opens": h.o, "closes": h.c };
        });
    }
    function storeLd(s) {
        var d = {
            "@context": "https://schema.org", "@type": "Store",
            "name": s.name,
            "telephone": c.phoneIntl || "+380634625206",
            "url": origin,
            "address": {
                "@type": "PostalAddress",
                "streetAddress": s.street || s.address || "",
                "addressLocality": c.locality || "Володимир",
                "addressRegion": c.region || "Волинська область",
                "addressCountry": "UA"
            }
        };
        if (s.geo) d.geo = { "@type": "GeoCoordinates", "latitude": s.geo.lat, "longitude": s.geo.lng };
        if (s.oh && s.oh.length) d.openingHoursSpecification = ohSpec(s.oh);
        return d;
    }

    var items = (c.stores && c.stores.length)
        ? c.stores.map(storeLd)
        : [{
            "@context": "https://schema.org", "@type": "LocalBusiness",
            "name": c.name || "Агроном", "telephone": c.phoneIntl || "+380634625206", "url": origin,
            "address": { "@type": "PostalAddress", "addressLocality": c.locality || "Володимир", "addressRegion": c.region || "Волинська область", "addressCountry": "UA", "streetAddress": c.address || "" }
        }];

    items.forEach(function (data) {
        var s = document.createElement('script');
        s.type = 'application/ld+json';
        s.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
        document.head.appendChild(s);
    });
})();
