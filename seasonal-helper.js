// ==========================================
// СЕЗОННИЙ ПОМІЧНИК v3 — "Мій сад / Город / Теплиця"
// Підключати після app.js: <script src="seasonal-helper.js"></script>
// Рендерить блок у <div id="seasonal-helper-container">
// ==========================================

(function () {
    'use strict';
    const DEBUG = false;

    // ── Групи та культури ─────────────────────────────────────────
    // GROUPS/ALL_CULTURES — дефолт (fallback); перезаписуються з D1 у loadCultures().
    let GROUPS = [
        {
            id: 'garden',
            label: '🍎 Мій сад',
            cultures: [
                { id: 'apple',       label: '🍎 Яблуня',    schemeCategory: 'pomaceous_fruits', schemeId: 'apple_protection'        },
                { id: 'pear',        label: '🍐 Груша',      schemeCategory: 'pomaceous_fruits', schemeId: 'pear_protection'         },
                { id: 'cherry',      label: '🍒 Черешня',    schemeCategory: 'stone_fruits',     schemeId: 'cherry_sweet_protection' },
                { id: 'cherry_sour', label: '🍒 Вишня',      schemeCategory: 'stone_fruits',     schemeId: 'cherry_sour_protection'  },
                { id: 'plum',        label: '🫐 Слива',      schemeCategory: 'stone_fruits',     schemeId: 'plum_protection'         },
                { id: 'grapes',      label: '🍇 Виноград',   schemeCategory: 'grapes',           schemeId: 'grapes_full_protection'  },
                { id: 'strawberry',  label: '🍓 Суниця',     schemeCategory: 'berries',          schemeId: 'strawberry_full'         },
                { id: 'raspberry',   label: '🫐 Малина',     schemeCategory: 'berries',          schemeId: 'raspberry_protection'    },
                { id: 'currant',     label: '🍇 Смородина',  schemeCategory: 'berries',          schemeId: 'currant_protection'      },
            ]
        },
        {
            id: 'vegetable',
            label: '🥕 Мій город',
            cultures: [
                { id: 'tomato_open', label: '🍅 Томати',     schemeCategory: 'vegetables', schemeId: 'tomato_open'          },
                { id: 'cabbage',     label: '🥬 Капуста',    schemeCategory: 'vegetables', schemeId: 'cabbage_protection'   },
                { id: 'carrot',      label: '🥕 Морква',     schemeCategory: 'vegetables', schemeId: 'carrot_protection'    },
                { id: 'onion',       label: '🧅 Цибуля',     schemeCategory: 'vegetables', schemeId: 'onion_protection'     },
                { id: 'beet',        label: '🫚 Буряк',      schemeCategory: 'vegetables', schemeId: 'beet_protection'      },
                { id: 'grain_wheat', label: '🌾 Пшениця',   schemeCategory: 'grain_crops', schemeId: 'wheat_spring'         },
                { id: 'grain_corn',  label: '🌽 Кукурудза', schemeCategory: 'grain_crops', schemeId: 'corn_protection'      },
            ]
        },
        {
            id: 'greenhouse',
            label: '🌿 Моя теплиця',
            cultures: [
                { id: 'tomato_gh',   label: '🍅 Томати',     schemeCategory: 'vegetables', schemeId: 'tomato_greenhouse'    },
                { id: 'cucumber',    label: '🥒 Огірки',     schemeCategory: 'vegetables', schemeId: 'cucumber_protection'  },
                { id: 'pepper',      label: '🌶️ Перець',     schemeCategory: 'vegetables', schemeId: 'pepper_syngenta'      },
            ]
        },
    ];

    // Плоский список усіх культур (для пошуку по id)
    let ALL_CULTURES = GROUPS.reduce(function(acc, g) { return acc.concat(g.cultures); }, []);

    // ── Місячна прив'язка стадій ──────────────────────────────────
    const MONTH_TO_STAGE = {
        apple_protection:        { 2:0, 3:1, 4:3, 5:4, 6:5, 7:6, 8:6, 9:7 },
        pear_protection:         { 2:0, 3:1, 4:3, 5:4, 6:5, 7:6, 8:6, 9:7 },
        cherry_sweet_protection: { 2:0, 3:1, 4:2, 5:3, 6:4, 7:5, 8:5, 9:6 },
        cherry_sour_protection:  { 2:0, 3:1, 4:2, 5:3, 6:4, 7:5, 8:5, 9:6 },
        plum_protection:         { 2:0, 3:1, 4:2, 5:3, 6:4, 7:5, 8:5, 9:6 },
        grapes_full_protection:  { 3:0, 4:1, 5:2, 6:3, 7:4, 8:5, 9:6 },
        strawberry_full:         { 3:0, 4:1, 5:2 },
        raspberry_protection:    { 3:0, 4:1, 5:2, 6:2 },
        currant_protection:      { 3:0, 4:1, 5:2, 6:2 },
        tomato_open:             { 3:0, 4:1, 5:2, 6:2, 7:2 },
        tomato_greenhouse:       { 2:0, 3:1, 4:2, 5:3, 6:3, 7:3 },
        cucumber_protection:     { 3:0, 4:1, 5:2, 6:2, 7:2 },
        pepper_syngenta:         { 2:0, 3:1, 4:2, 5:3, 6:4, 7:6 },
        cabbage_protection:      { 3:0, 4:1, 5:2, 6:2 },
        carrot_protection:       { 3:0, 4:1, 5:1, 6:1 },
        onion_protection:        { 3:0, 4:1, 5:1, 6:1 },
        beet_protection:         { 3:0, 4:1, 5:1, 6:1, 7:2 },
        wheat_spring:            { 2:0, 3:1, 4:2, 5:3 },
        corn_protection:         { 3:0, 4:1, 5:2, 6:3, 7:4 },
    };

    const MONTH_NAMES = ['Січень','Лютий','Березень','Квітень','Травень','Червень',
                         'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];

    // ── localStorage ─────────────────────────────────────────────
    const KEY_GARDEN = 'my_garden_v1';   // масив id культур
    const KEY_SETUP  = 'my_garden_setup';
    const CART_KEY   = 'agronom_cart';

    // ── Стан ─────────────────────────────────────────────────────
    let myGarden        = [];
    let setupDone       = false;
    let activeCultureId = null;
    let activeGroupId   = null; // яка група відкрита в онбордингу
    let schemesData     = null;
    let expanded        = false; // новий користувач: false → компактний CTA; true → повний онбординг

    function loadState() {
        try {
            myGarden  = JSON.parse(localStorage.getItem(KEY_GARDEN)) || [];
            setupDone = localStorage.getItem(KEY_SETUP) === 'done' && myGarden.length > 0;
            if (setupDone && !activeCultureId) activeCultureId = myGarden[0];
        } catch(e) { myGarden = []; setupDone = false; }

        // Початкова активна група онбордингу
        if (!activeGroupId) activeGroupId = GROUPS[0].id;
    }

    function saveGarden() {
        localStorage.setItem(KEY_GARDEN, JSON.stringify(myGarden));
        localStorage.setItem(KEY_SETUP, myGarden.length > 0 ? 'done' : '');
    }

    // ── Культури з D1 (керуються в /admin/seasonal); fallback — GROUPS вище ──
    async function loadCultures() {
        try {
            const v = (typeof SITE_VERSION !== 'undefined') ? SITE_VERSION : Date.now();
            const r = await fetch('/api/seasonal?v=' + v);
            if (!r.ok) return;
            const data = await r.json();
            if (Array.isArray(data) && data.length) {
                GROUPS = data;
                ALL_CULTURES = GROUPS.reduce(function(acc, g) { return acc.concat(g.cultures || []); }, []);
            }
        } catch(e) { if(DEBUG) console.warn('seasonal-helper cultures:', e); }
    }

    // ── Схеми: з D1 (/api/protection-schemes); fallback — статичний protection_schemes.json ──
    async function loadSchemes() {
        if (schemesData) return;
        const v = (typeof SITE_VERSION !== 'undefined') ? SITE_VERSION : Date.now();
        try {
            const r = await fetch('/api/protection-schemes?v=' + v);
            if (r.ok) { schemesData = await r.json(); return; }
        } catch(e) {}
        try {
            const r2 = await fetch('protection_schemes.json?v=' + v);
            if (r2.ok) schemesData = await r2.json();
        } catch(e) { if(DEBUG) console.warn('seasonal-helper:', e); }
    }

    function getCurrentStage(culture) {
        if (!schemesData) return null;
        const month    = new Date().getMonth();
        const stageMap = MONTH_TO_STAGE[culture.schemeId];
        if (!stageMap) return null;
        const idx = stageMap[month];
        if (idx === undefined) return null;
        const cat = schemesData.protection_schemes[culture.schemeCategory];
        if (!cat) return null;
        const scheme = (cat.schemes || []).find(function(s) { return s.id === culture.schemeId; });
        return scheme && scheme.treatments ? (scheme.treatments[idx] || null) : null;
    }

    function findProduct(name) {
        if (typeof products === 'undefined' || !products.length) return null;
        const kw = name.toLowerCase();
        return products.find(function(p) {
            return p.n.toLowerCase().includes(kw) &&
                   (p.c || '').toLowerCase().includes('агрохімік') &&
                   p.inStock !== false;
        }) || null;
    }

    function addToCart(name, price) {
        let arr;
        try { arr = JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch(e) { arr = []; }
        const item = arr.find(function(i) { return i.n === name; });
        if (item) { item.q++; } else { arr.push({ n: name, p: price, q: 1 }); }
        localStorage.setItem(CART_KEY, JSON.stringify(arr));
        if (typeof cart !== 'undefined') {
            const g = cart.find(function(i) { return i.n === name; });
            if (g) { g.q++; } else { cart.push({ n: name, p: price, q: 1 }); }
        }
        if (typeof updateCartUI === 'function') updateCartUI();
        try {
            const total = arr.reduce(function(s, i) { return s + (i.q || 0); }, 0);
            const ce = document.getElementById('cart-count');
            const fe = document.getElementById('cart-float');
            if (ce) ce.textContent = total;
            if (fe) fe.style.display = total > 0 ? 'flex' : 'none';
        } catch(e) {}
    }

    // ══════════════════════════════════════════════════════════════
    // CSS
    // ══════════════════════════════════════════════════════════════
    const CSS = `
    #seasonal-helper-container { margin-bottom: 20px; }

    /* ── Компактний CTA (новий користувач, progressive disclosure) ── */
    .sh-cta {
        display: flex; align-items: center; gap: 11px; width: 100%;
        background: linear-gradient(135deg, var(--gp) 0%, #f0faf0 100%);
        border: 1.5px solid #c5e0c5; border-radius: 12px;
        padding: 12px 16px; cursor: pointer; text-align: left;
        font-family: 'Nunito', sans-serif; color: #1a3a1a;
        transition: border-color .15s, box-shadow .15s;
    }
    .sh-cta:hover { border-color: var(--green-l); box-shadow: 0 2px 10px rgba(45,106,45,.12); }
    .sh-cta-emoji { font-size: 1.45rem; line-height: 1; }
    .sh-cta-text { flex: 1; font-size: .92rem; line-height: 1.35; }
    .sh-cta-text b { color: var(--green); }
    .sh-cta-arrow { font-size: 1.25rem; color: var(--green); font-weight: 800; }

    /* ── Онбординг ── */
    .sh-onboard {
        background: linear-gradient(135deg, var(--gp) 0%, #f0faf0 100%);
        border: 1.5px solid #c5e0c5;
        border-radius: 14px;
        padding: 18px 16px 16px;
    }
    .sh-onboard-title {
        font-family: 'Nunito', sans-serif;
        font-size: 1rem;
        font-weight: 700;
        color: #1a3a1a;
        margin-bottom: 3px;
    }
    .sh-onboard-sub {
        font-size: 0.8rem;
        color: #5a7a5a;
        margin-bottom: 14px;
    }

    /* Групи-таби в онбордингу */
    .sh-group-tabs {
        display: flex;
        gap: 7px;
        margin-bottom: 12px;
        flex-wrap: wrap;
    }
    .sh-group-tab {
        background: white;
        border: 1.5px solid #c8e0c8;
        color: var(--green);
        padding: 7px 15px;
        border-radius: 20px;
        cursor: pointer;
        font-family: 'Nunito', sans-serif;
        font-weight: 700;
        font-size: 0.85rem;
        transition: all 0.15s;
        white-space: nowrap;
        position: relative;
    }
    .sh-group-tab:hover { background: #d8efd8; border-color: var(--green-l); }
    .sh-group-tab.active { background: var(--green); color: white; border-color: var(--green); }
    .sh-group-tab .sh-count-badge {
        display: none;
        position: absolute;
        top: -6px; right: -6px;
        background: #e74c3c;
        color: white;
        border-radius: 50%;
        width: 18px; height: 18px;
        font-size: 0.65rem;
        font-weight: 700;
        align-items: center;
        justify-content: center;
        line-height: 1;
    }
    .sh-group-tab .sh-count-badge.visible { display: flex; }

    /* Сітка культур */
    .sh-culture-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
        gap: 7px;
        margin-bottom: 14px;
        min-height: 52px;
    }
    .sh-culture-check {
        background: white;
        border: 2px solid #c8e0c8;
        color: var(--green);
        padding: 9px 8px;
        border-radius: 10px;
        cursor: pointer;
        font-family: 'Nunito', sans-serif;
        font-weight: 600;
        font-size: 0.85rem;
        text-align: center;
        transition: all 0.15s;
        user-select: none;
        line-height: 1.3;
    }
    .sh-culture-check:hover { border-color: var(--green-l); background: #f0f8f0; }
    .sh-culture-check.selected { background: var(--green); color: white; border-color: var(--green); }
    .sh-culture-check.selected::after { content: ' ✓'; }

    /* Підсумок вибраного + кнопка */
    .sh-summary {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
    }
    .sh-summary-text {
        flex: 1;
        font-size: 0.8rem;
        color: #5a7a5a;
        min-width: 120px;
    }
    .sh-onboard-confirm {
        background: var(--green);
        color: white;
        border: none;
        padding: 12px 20px;
        border-radius: 10px;
        font-family: 'Nunito', sans-serif;
        font-weight: 700;
        font-size: 0.92rem;
        cursor: pointer;
        transition: background 0.18s;
        white-space: nowrap;
    }
    .sh-onboard-confirm:hover { background: var(--green-d); }
    .sh-onboard-confirm:disabled { background: #aaa; cursor: not-allowed; }

    /* ── Головний блок ── */
    .sh-main {
        background: linear-gradient(135deg, var(--gp) 0%, #f0faf0 100%);
        border: 1.5px solid #c5e0c5;
        border-radius: 14px;
        padding: 14px 16px 14px;
    }
    .sh-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 11px;
    }
    .sh-header-title {
        font-family: 'Nunito', sans-serif;
        font-size: 0.82rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: var(--green);
    }
    .sh-edit-link {
        font-size: 0.75rem;
        color: #5a9a5a;
        cursor: pointer;
        text-decoration: underline;
        background: none;
        border: none;
        font-family: 'Nunito', sans-serif;
        padding: 0;
    }
    .sh-edit-link:hover { color: var(--green); }

    /* Таби культур у головному блоці */
    .sh-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 12px;
    }
    .sh-tab {
        background: white;
        border: 1.5px solid #c8e0c8;
        color: var(--green);
        padding: 5px 13px;
        border-radius: 18px;
        cursor: pointer;
        font-family: 'Nunito', sans-serif;
        font-weight: 600;
        font-size: 0.82rem;
        transition: all 0.15s;
        white-space: nowrap;
    }
    .sh-tab:hover { background: #d8efd8; border-color: var(--green-l); }
    .sh-tab.active { background: var(--green); color: white; border-color: var(--green); }

    /* Роздільник груп у табах */
    .sh-tab-sep {
        width: 1px;
        background: #c8e0c8;
        margin: 3px 2px;
        border-radius: 1px;
        align-self: stretch;
    }

    /* Картка стадії */
    .sh-result {
        background: white;
        border-radius: 10px;
        padding: 14px 15px;
        border: 1.5px solid #b8d8b8;
        animation: sh-fadein 0.22s ease;
    }
    @keyframes sh-fadein {
        from { opacity: 0; transform: translateY(5px); }
        to   { opacity: 1; transform: translateY(0); }
    }
    .sh-stage-name {
        font-size: 0.97rem;
        font-weight: 700;
        color: #1a3a1a;
        margin-bottom: 4px;
        line-height: 1.3;
    }
    .sh-date-badge {
        display: inline-block;
        background: var(--gp);
        color: var(--green);
        border-radius: 8px;
        font-size: 0.73rem;
        font-weight: 600;
        padding: 2px 10px;
        margin-bottom: 10px;
    }
    .sh-problem {
        font-size: 0.83rem;
        color: #c0392b;
        background: #fff5f5;
        border-left: 3px solid #e74c3c;
        padding: 6px 10px;
        border-radius: 0 6px 6px 0;
        margin-bottom: 11px;
        line-height: 1.4;
    }
    .sh-warning {
        font-size: 0.83rem;
        color: #e07b00;
        background: #fff9f0;
        border-left: 3px solid #e07b00;
        padding: 7px 11px;
        border-radius: 0 6px 6px 0;
        margin-bottom: 11px;
        font-weight: 600;
    }
    .sh-products-label {
        font-size: 0.75rem;
        font-weight: 700;
        color: #666;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-bottom: 7px;
    }
    .sh-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 12px;
    }
    .sh-chip {
        background: #f0f8f0;
        border: 1.5px solid #b0d4b0;
        color: #1a3a1a;
        padding: 5px 11px;
        border-radius: 8px;
        font-size: 0.81rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
        font-family: 'Nunito', sans-serif;
    }
    .sh-chip:hover   { background: var(--green); color: white; border-color: var(--green); }
    .sh-chip.added   { background: #1a3a1a; color: white; border-color: #1a3a1a; }
    .sh-chip.unavail { opacity: 0.45; cursor: default; }
    .sh-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }
    .sh-btn-add {
        flex: 1;
        min-width: 150px;
        background: var(--green);
        color: white;
        border: none;
        padding: 10px 13px;
        border-radius: 9px;
        font-family: 'Nunito', sans-serif;
        font-weight: 700;
        font-size: 0.87rem;
        cursor: pointer;
        transition: background 0.18s;
        text-align: center;
    }
    .sh-btn-add:hover { background: var(--green-d); }
    .sh-btn-add.done  { background: #1a3a1a; }
    .sh-btn-scheme {
        background: white;
        color: var(--green);
        border: 1.5px solid var(--green);
        padding: 10px 13px;
        border-radius: 9px;
        font-family: 'Nunito', sans-serif;
        font-weight: 700;
        font-size: 0.87rem;
        cursor: pointer;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        transition: background 0.15s;
        white-space: nowrap;
    }
    .sh-btn-scheme:hover { background: var(--gp); }
    .sh-offseason {
        color: #888;
        font-size: 0.87rem;
        font-style: italic;
        padding: 3px 0;
    }

    @media (max-width: 480px) {
        .sh-culture-grid { grid-template-columns: repeat(2, 1fr); }
        .sh-main { padding: 12px 12px 12px; }
        .sh-tab  { font-size: 0.78rem; padding: 5px 10px; }
        .sh-btn-add, .sh-btn-scheme { font-size: 0.82rem; padding: 10px 11px; }
        .sh-group-tab { font-size: 0.8rem; padding: 6px 12px; }
    }
    `;

    // ══════════════════════════════════════════════════════════════
    // РЕНДЕР — ОНБОРДИНГ
    // ══════════════════════════════════════════════════════════════
    function renderOnboarding() {
        const group = GROUPS.find(function(g) { return g.id === activeGroupId; }) || GROUPS[0];

        // Таби груп з лічильниками
        const groupTabsHtml = GROUPS.map(function(g) {
            const isActive = g.id === activeGroupId ? ' active' : '';
            const count = g.cultures.filter(function(c) { return myGarden.includes(c.id); }).length;
            const badge = count > 0
                ? '<span class="sh-count-badge visible">' + count + '</span>'
                : '<span class="sh-count-badge"></span>';
            return '<button class="sh-group-tab' + isActive + '" onclick="shSetOnboardGroup(\'' + g.id + '\')">'
                 + g.label + badge + '</button>';
        }).join('');

        // Культури поточної групи
        const culturesHtml = group.cultures.map(function(c) {
            const sel = myGarden.includes(c.id) ? ' selected' : '';
            return '<button class="sh-culture-check' + sel + '" onclick="shToggleCulture(\'' + c.id + '\')" data-id="' + c.id + '">'
                 + c.label + '</button>';
        }).join('');

        const total = myGarden.length;
        const summaryText = total === 0
            ? 'Нічого не обрано'
            : 'Обрано: ' + total + ' ' + (total === 1 ? 'культура' : total < 5 ? 'культури' : 'культур');

        return '<div class="sh-onboard">'
             + '<div class="sh-onboard-title">🌱 Що росте у вашому господарстві?</div>'
             + '<div class="sh-onboard-sub">Оберіть культури — сайт покаже лише актуальне для вас</div>'
             + '<div class="sh-group-tabs">' + groupTabsHtml + '</div>'
             + '<div class="sh-culture-grid" id="sh-culture-grid">' + culturesHtml + '</div>'
             + '<div class="sh-summary">'
             + '<span class="sh-summary-text" id="sh-summary-text">' + summaryText + '</span>'
             + '<button class="sh-onboard-confirm" id="sh-confirm-btn"'
             + (total === 0 ? ' disabled' : '')
             + ' onclick="shConfirmGarden()">Зберегти →</button>'
             + '</div>'
             + '</div>';
    }

    // ══════════════════════════════════════════════════════════════
    // РЕНДЕР — ГОЛОВНИЙ БЛОК
    // ══════════════════════════════════════════════════════════════
    function renderMain() {
        const month = new Date().getMonth();

        // Мої культури, згруповані по групах для візуального роздільника
        if (!activeCultureId || !myGarden.includes(activeCultureId)) {
            activeCultureId = myGarden[0] || null;
        }

        // Таби з роздільниками між групами
        let tabsHtml = '';
        let prevGroupId = null;
        myGarden.forEach(function(cid) {
            const culture = ALL_CULTURES.find(function(c) { return c.id === cid; });
            if (!culture) return;
            const group = GROUPS.find(function(g) {
                return g.cultures.some(function(c) { return c.id === cid; });
            });
            const gid = group ? group.id : null;
            if (prevGroupId && gid !== prevGroupId) {
                tabsHtml += '<span class="sh-tab-sep"></span>';
            }
            prevGroupId = gid;
            const active = cid === activeCultureId ? ' active' : '';
            tabsHtml += '<button class="sh-tab' + active + '" onclick="shSetTab(\'' + cid + '\')">'
                      + culture.label + '</button>';
        });

        const culture  = ALL_CULTURES.find(function(c) { return c.id === activeCultureId; });
        const stageHtml = culture ? renderStageCard(culture, month) : '';

        return '<div class="sh-main">'
             + '<div class="sh-header">'
             + '<span class="sh-header-title">🌿 Моє господарство · ' + MONTH_NAMES[month] + '</span>'
             + '<button class="sh-edit-link" onclick="shEditGarden()">✏️ Змінити</button>'
             + '</div>'
             + '<div class="sh-tabs">' + tabsHtml + '</div>'
             + stageHtml
             + '</div>';
    }

    function renderStageCard(culture, month) {
        const stage = getCurrentStage(culture);
        if (!stage) {
            return '<div class="sh-result"><div class="sh-offseason">'
                 + '😴 Для ' + culture.label + ' у ' + MONTH_NAMES[month]
                 + ' активних обробок немає. Відпочиваємо!'
                 + '</div></div>';
        }

        const esc = window.escapeHTML || function(x) { return x; };
        const isWarning = stage.stage && stage.stage.toLowerCase().includes('не обробляти');
        if (isWarning) {
            return '<div class="sh-result">'
                 + '<div class="sh-stage-name">' + esc(stage.stage) + '</div>'
                 + '<div class="sh-date-badge">📅 ' + (stage.date || MONTH_NAMES[month]) + '</div>'
                 + '<div class="sh-warning">⛔ ' + esc(stage.problem) + '</div>'
                 + '<a class="sh-btn-scheme" href="protection_schemes.html?category='
                 + culture.schemeCategory + '&scheme=' + culture.schemeId + '">📋 Повна схема</a>'
                 + '</div>';
        }

        const topNames = (stage.products || []).slice(0, 4);
        const found    = topNames.map(function(n) { return { name: n, product: findProduct(n) }; });

        const chipsHtml = found.map(function(item, idx) {
            if (!item.product) {
                return '<span class="sh-chip unavail">' + item.name + '</span>';
            }
            const price    = item.product.p || 0;
            const safeName = item.product.n.replace(/'/g, "\\'");
            return '<button class="sh-chip" id="sh-chip-' + idx + '" '
                 + 'onclick="shAddChip(' + idx + ',\'' + safeName + '\',' + price + ')">'
                 + item.name + '</button>';
        }).join('');

        const href = 'protection_schemes.html?category=' + culture.schemeCategory
                   + '&scheme=' + culture.schemeId;

        return '<div class="sh-result">'
             + '<div class="sh-stage-name">' + esc(stage.stage) + '</div>'
             + '<div class="sh-date-badge">📅 ' + (stage.date || MONTH_NAMES[month]) + '</div>'
             + '<div class="sh-problem">🚨 ' + esc(stage.problem) + '</div>'
             + '<div class="sh-products-label">Рекомендовані препарати:</div>'
             + '<div class="sh-chips" id="sh-chips">' + chipsHtml + '</div>'
             + '<div class="sh-actions">'
             + '<button class="sh-btn-add" id="sh-addall-btn" onclick="shAddAll()">🛒 Додати всі в кошик</button>'
             + '<a class="sh-btn-scheme" href="' + href + '">📋 Повна схема</a>'
             + '</div></div>';
    }

    // ══════════════════════════════════════════════════════════════
    // ГОЛОВНИЙ РЕНДЕР
    // ══════════════════════════════════════════════════════════════
    // Компактний CTA для нового користувача — щоб перший екран вів до покупки,
    // а помічник підсилював, а не конкурував із пошуком/каталогом.
    function renderCta() {
        return '<button class="sh-cta" onclick="shExpand()" aria-label="Підібрати захист для культури">'
             + '<span class="sh-cta-emoji">🌱</span>'
             + '<span class="sh-cta-text"><b>Не знаєте, що обрати?</b><br>Підібрати захист для вашої культури</span>'
             + '<span class="sh-cta-arrow">→</span>'
             + '</button>';
    }

    function render() {
        const container = document.getElementById('seasonal-helper-container');
        if (!container) return;
        // setupDone → персональний блок (повернений); інакше: компактний CTA → за кліком повний онбординг
        container.innerHTML = setupDone ? renderMain() : (expanded ? renderOnboarding() : renderCta());
    }

    // ══════════════════════════════════════════════════════════════
    // ХЕНДЛЕРИ
    // ══════════════════════════════════════════════════════════════

    // Розгорнути повний онбординг із компактного CTA
    window.shExpand = function() {
        expanded = true;
        render();
        const c = document.getElementById('seasonal-helper-container');
        if (c && c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    // Перемикання групи в онбордингу — оновлює лише сітку культур
    window.shSetOnboardGroup = function(gid) {
        activeGroupId = gid;

        // Оновити таби груп
        document.querySelectorAll('.sh-group-tab').forEach(function(btn) {
            btn.classList.toggle('active', btn.textContent.trim().startsWith(
                (GROUPS.find(function(g) { return g.id === gid; }) || {}).label || '___'
            ));
        });
        // Повний перерендер онбордингу (тільки grid і таби)
        render();
    };

    // Тогл культури
    window.shToggleCulture = function(id) {
        const idx = myGarden.indexOf(id);
        if (idx === -1) { myGarden.push(id); } else { myGarden.splice(idx, 1); }

        // Оновити кнопку
        const btn = document.querySelector('.sh-culture-check[data-id="' + id + '"]');
        if (btn) btn.classList.toggle('selected', myGarden.includes(id));

        // Оновити лічильник на таб-групі
        GROUPS.forEach(function(g, gi) {
            const count = g.cultures.filter(function(c) { return myGarden.includes(c.id); }).length;
            const badge = document.querySelectorAll('.sh-group-tab')[gi]
                                  && document.querySelectorAll('.sh-group-tab')[gi].querySelector('.sh-count-badge');
            if (badge) {
                badge.textContent = count > 0 ? count : '';
                badge.classList.toggle('visible', count > 0);
            }
        });

        // Оновити текст підсумку і кнопку
        const total = myGarden.length;
        const summaryEl  = document.getElementById('sh-summary-text');
        const confirmBtn = document.getElementById('sh-confirm-btn');
        if (summaryEl) summaryEl.textContent = total === 0 ? 'Нічого не обрано'
            : 'Обрано: ' + total + ' ' + (total === 1 ? 'культура' : total < 5 ? 'культури' : 'культур');
        if (confirmBtn) confirmBtn.disabled = total === 0;
    };

    window.shConfirmGarden = async function() {
        if (myGarden.length === 0) return;
        setupDone = true;
        activeCultureId = myGarden[0];
        saveGarden();
        if (!schemesData) await loadSchemes();   // ліниве завантаження схем — лише коли треба показати стадії
        render();
    };

    window.shEditGarden = function() {
        setupDone = false;
        render();
    };

    window.shSetTab = function(id) {
        activeCultureId = id;
        render();
    };

    window.shAddChip = function(idx, name, price) {
        addToCart(name, price);
        const chip = document.getElementById('sh-chip-' + idx);
        if (chip) { chip.classList.add('added'); chip.textContent = '✓ ' + chip.textContent.replace(/^✓ /, ''); }
    };

    window.shAddAll = function() {
        const btn   = document.getElementById('sh-addall-btn');
        const chips = document.querySelectorAll('#sh-chips .sh-chip:not(.unavail)');
        let added = 0;
        chips.forEach(function(chip) {
            const m = (chip.getAttribute('onclick') || '').match(/shAddChip\(\d+,'(.+?)',(\d+(?:\.\d+)?)\)/);
            if (m) {
                addToCart(m[1], parseFloat(m[2]));
                chip.classList.add('added');
                chip.textContent = '✓ ' + chip.textContent.replace(/^✓ /, '');
                added++;
            }
        });
        if (btn && added > 0) {
            btn.textContent = '✓ Додано ' + added + ' препарати';
            btn.classList.add('done');
        }
    };

    // ══════════════════════════════════════════════════════════════
    // ІНІТ
    // ══════════════════════════════════════════════════════════════
    function injectStyles() {
        if (document.getElementById('sh-styles')) return;
        const s = document.createElement('style');
        s.id = 'sh-styles';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    async function init() {
        injectStyles();
        if (!document.getElementById('seasonal-helper-container')) return;
        await loadCultures();     // культури з D1 (fallback — хардкод GROUPS)
        loadState();
        // Схеми (12.7 КіБ) — лише поверненому (показуємо стадії). Новому (compact CTA)
        // вантажимо ліниво при shConfirmGarden — не тримаємо в критичному шляху першого візиту.
        if (setupDone) await loadSchemes();
        render();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { init(); });
    } else {
        init();
    }

})();
