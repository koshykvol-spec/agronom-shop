// ==========================================
// ЗАВАНТАЖЕННЯ ТОВАРІВ З JSON (замість хардкоду)
// ==========================================

const SITE_VERSION = '20260529'; // оновлювати при зміні товарів

// Прапорець діагностичних логів (Task 18). Інформаційні console.log/warn — лише при DEBUG.
const DEBUG = false;

// Екранування значень перед вставкою в innerHTML (Task 15). Експортуємо в глобал
// для seasonal-helper.js (protection_schemes.html має власний локальний escapeHtml).
function escapeHTML(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
// Назва категорії в реченнєвому регістрі: «НАСІННЯ ІМПОРТНЕ» → «Насіння імпортне».
// Якщо вже у змішаному регістрі (адмін задав красиво) — лишаємо як є. (UI-only, дані в D1 не чіпаємо.)
function catLabel(s){ s=String(s==null?'':s); return (s===s.toUpperCase() && s!==s.toLowerCase()) ? (s.charAt(0).toUpperCase()+s.slice(1).toLowerCase()) : s; }
window.escapeHTML = escapeHTML;

// URL мініатюри каталогу: /thumb/<path>. Функція functions/thumb/[[path]].js
// віддає зменшену копію з R2, а якщо її ще нема — відкат на оригінал (нуль ризику).
// Лише для карток каталогу; на сторінці товару показуємо повне фото.
function thumbUrl(img){
    if(!img) return img;
    if(/^https?:/i.test(img) || img.indexOf('/thumb/') === 0) return img; // зовнішнє / вже thumb
    return '/thumb/' + img.replace(/^\/+/, '');
}

let products = [];
let renderedProducts = []; // для модального вікна товару

async function loadProducts() {
    // Основне джерело — D1 через /api/products (актуальні ціни, наявність, акції; без 1.5 МБ)
    try {
        const apiResp = await fetch('/api/products?v=' + SITE_VERSION);
        if (apiResp.ok) {
            products = await apiResp.json();
            if (DEBUG) console.log('✅ Каталог з D1:', products.length);
            return;
        }
        throw new Error('api ' + apiResp.status);
    } catch (eApi) {
        if (DEBUG) console.warn('API недоступне, фолбек на products.json:', eApi.message);
    }
    // Фолбек: статичний products.json + img-map
    try {
        let imgs = {};
        const cachedMap = sessionStorage.getItem('agronom_img_map_v3');
        if (cachedMap) imgs = JSON.parse(cachedMap);
        const prodResp = await fetch('products.json?v=' + SITE_VERSION);
        if (!prodResp.ok) throw new Error('products.json: HTTP ' + prodResp.status);
        const prod = await prodResp.json();
        if (!cachedMap) {
            const imgResp = await fetch('img-map.json?v=' + SITE_VERSION);
            if (imgResp.ok) {
                imgs = await imgResp.json();
                try { sessionStorage.setItem('agronom_img_map_v3', JSON.stringify(imgs)); } catch(e) {}
            }
        }
        products = prod.map(p => ({ ...p, img: imgs[p.n] || p.img || '' }));
    } catch (e) {
        console.error('❌ Помилка завантаження товарів:', e);
        const grid = document.getElementById('grid');
        if (grid) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#888;">Не вдалося завантажити товари. Оновіть сторінку.</div>';
    }
}

// ==========================================
// ЛОГІКА РОБОТИ САЙТУ (ФІЛЬТРИ, КОШИК, VIBER)
// ==========================================

let cart = JSON.parse(localStorage.getItem('agronom_cart')) || [];
let visibleCount = 20; // (історичне; пагінація нижче замінила нескінченний скрол)

// ── Пагінація каталогу (налаштовуваний розмір сторінки) ──
const PAGE_SIZE_OPTIONS = [24, 48, 96, 200];
function getPageSize() {
    const v = parseInt(localStorage.getItem('agronom_pagesize'), 10);
    return PAGE_SIZE_OPTIONS.includes(v) ? v : 48;
}
let pageSize = getPageSize();
let currentPage = 1;
let currentSubCat = 'Всі'; // Для підкатегорій (Гербіциди і т.д.)

const currentPath = window.location.pathname.split("/").pop();

// ==========================================
// НАВІГАЦІЯ — єдине місце, де перелічені всі категорії
// ==========================================

let NAV_ITEMS = [
    { href: 'index.html',                  label: 'Всі товари',           cat: null                },
    { href: 'category.html?cat=chemicals', label: 'АГРОХІМІКАТИ',         cat: 'chemicals'         },
    { href: 'category.html?cat=import',    label: 'НАСІННЯ ІМПОРТНЕ',     cat: 'import'            },
    { href: 'category.html?cat=domestic',  label: 'НАСІННЯ ВІТЧИЗНЯНЕ',   cat: 'domestic'          },
    { href: 'category.html?cat=weight',    label: 'НАСІННЯ ВАГОВЕ',       cat: 'weight'            },
    { href: 'category.html?cat=materials', label: 'МАТЕРІАЛИ',            cat: 'materials'         },
    { href: 'category.html?cat=drops',     label: 'КРАПЕЛЬНЕ ЗРОШУВАННЯ', cat: 'drops'             },
    { href: 'category.html?cat=soil',      label: 'ГРУНТ',                cat: 'soil'              },
    { href: 'category.html?cat=pots',      label: 'ГОРЩИКИ',              cat: 'pots'              },
    { href: 'category.html?cat=insects',   label: 'ПРОТИ КОМАХ',          cat: 'insects'           },
    { href: 'category.html?cat=animals',   label: 'ДЛЯ ТВАРИН',          cat: 'animals'           },
    { href: 'category.html?cat=sprouts',  label: 'РОЗСАДА',              cat: 'sprouts'           },
];

// Малює горизонтальну навігацію з активним станом поточної категорії
function renderMainNav() {
    const container = document.getElementById('main-nav');
    if (!container) return;

    const currentCatKey = new URLSearchParams(location.search).get('cat');
    const isIndex = (currentPath === 'index.html' || currentPath === '');

    container.innerHTML = NAV_ITEMS.map(function (item) {
        var active = (item.cat === null && isIndex) || (item.cat === currentCatKey);
        return '<a href="' + item.href + '" class="cat-btn' + (active ? ' active' : '') + '">' + escapeHTML(catLabel(item.label)) + '</a>';
    }).join('');
}

// ==========================================
// 1. Визначення категорії: спочатку ?cat=, потім назва файлу (зворотна сумісність)
// ==========================================

let CAT_PARAM_MAP = {
    chemicals: 'АГРОХІМІКАТИ',
    import:    'НАСІННЯ ІМПОРТНЕ',
    domestic:  'НАСІННЯ ВІТЧИЗНЯНЕ',
    insects:   'ПРОТИ КОМАХ',
    weight:    'НАСІННЯ ВАГОВЕ',
    materials: 'МАТЕРІАЛИ',
    drops:     'КРАПЕЛЬНЕ ЗРОШУВАННЯ',
    animals:   'ДЛЯ ТВАРИН',
    soil:      'ГРУНТ',
    pots:      'ГОРЩИКИ',
    sprouts:   'РОЗСАДА',
};

function getInitialCategory() {
    // Пріоритет: параметр ?cat= (category.html)
    const catKey = new URLSearchParams(location.search).get('cat');
    if (catKey && CAT_PARAM_MAP[catKey]) return CAT_PARAM_MAP[catKey];

    // Зворотна сумісність: старі URL типу chemicals.html → db_name з CAT_PARAM_MAP (джерело — D1)
    if (currentPath.endsWith('.html') && currentPath !== 'index.html' && currentPath !== 'category.html') {
        const fk = currentPath.replace(/\.html$/, '');
        if (CAT_PARAM_MAP[fk]) return CAT_PARAM_MAP[fk];
    }

    return "Всі"; // index.html
}

let currentCat = getInitialCategory();

// ── Категорії з D1 (override хардкоду). Керуються в /admin/categories. ──
// Дефолти нижче — fallback, якщо /api/categories недоступний (сайт не ламається).
let CAT_ICONS = {
    'АГРОХІМІКАТИ':'🧪','ПРОТИ КОМАХ':'🐛','НАСІННЯ ІМПОРТНЕ':'🌱','НАСІННЯ ВІТЧИЗНЯНЕ':'🌾',
    'НАСІННЯ ВАГОВЕ':'⚖️','МАТЕРІАЛИ':'📦','КРАПЕЛЬНЕ ЗРОШУВАННЯ':'💧','ГРУНТ':'🪴',
    'ГОРЩИКИ':'🏺','ДЛЯ ТВАРИН':'🐾','РОЗСАДА':'🌿'
};
let SUB_ALL_MAP = {
    'АГРОХІМІКАТИ':'Всі ЗЗР','НАСІННЯ ВІТЧИЗНЯНЕ':'Все насіння','НАСІННЯ ІМПОРТНЕ':'Всі виробники',
    'НАСІННЯ ВАГОВЕ':'Всі культури','МАТЕРІАЛИ':'Всі матеріали','КРАПЕЛЬНЕ ЗРОШУВАННЯ':'Весь полив',
    'ГРУНТ':'Весь ґрунт','ГОРЩИКИ':'Всі товари','ПРОТИ КОМАХ':'Весь захист',
    'ДЛЯ ТВАРИН':'Всі товари для тварин','РОЗСАДА':'Вся розсада'
};
let CATS_WITH_SUB = [
    "АГРОХІМІКАТИ","НАСІННЯ ВІТЧИЗНЯНЕ","НАСІННЯ ІМПОРТНЕ","НАСІННЯ ВАГОВЕ","МАТЕРІАЛИ",
    "КРАПЕЛЬНЕ ЗРОШУВАННЯ","ГРУНТ","ГОРЩИКИ","ПРОТИ КОМАХ","ДЛЯ ТВАРИН","РОЗСАДА"
];
let HIDE_SCHEMES = ['drops','soil','pots','animals','materials'];
let CAT_SEO = {};

async function loadCategories(){
    try {
        const r = await fetch('/api/categories?v=' + SITE_VERSION);
        if (!r.ok) return;
        const d = await r.json();
        if (!d.cats || !d.cats.length) return;
        const cats = d.cats.slice().sort(function(a,b){ return (a.sort||0)-(b.sort||0); });
        NAV_ITEMS = [{ href:'index.html', label:'Всі товари', cat:null }].concat(cats.map(function(c){
            return { href:'category.html?cat=' + c.key, label:c.nav_label, cat:c.key };
        }));
        const pm = {}, ic = {}, sm = {}, ws = [], hs = [], seo = {};
        cats.forEach(function(c){
            pm[c.key] = c.db_name;
            ic[c.db_name] = c.icon || '🛒';
            sm[c.db_name] = c.sub_all_label || 'Всі';
            if (c.has_sub) ws.push(c.db_name);
            if (!c.show_schemes) hs.push(c.key);
            seo[c.key] = { title:c.seo_title, h1:c.h1, desc:c.seo_desc, placeholder:c.placeholder };
        });
        CAT_PARAM_MAP = pm; CAT_ICONS = ic; SUB_ALL_MAP = sm; CATS_WITH_SUB = ws; HIDE_SCHEMES = hs; CAT_SEO = seo;
    } catch (e) { if (DEBUG) console.warn('categories не завантажились:', e.message); }
}

// Заголовки/опис/placeholder сторінки категорії з D1 (перекриває inline-fallback у category.html)
function applyCategoryPageSeo(){
    const catKey = new URLSearchParams(location.search).get('cat');
    if (!catKey) return;
    const cfg = CAT_SEO[catKey];
    if (!cfg) return;
    if (cfg.title){ document.title = cfg.title; const og = document.querySelector('meta[property="og:title"]'); if (og) og.setAttribute('content', cfg.title); }
    if (cfg.desc){ const pd = document.getElementById('page-desc'); if (pd) pd.setAttribute('content', cfg.desc); }
    const h = document.getElementById('page-h1'); if (h && (cfg.h1 || cfg.title)) h.textContent = cfg.h1 || cfg.title;
    const s = document.getElementById('search'); if (s && cfg.placeholder) s.placeholder = cfg.placeholder;
}

// ==========================================
// СОРТУВАННЯ (Task 9)
// ==========================================
let currentSort = 'default';
function setSort(v){ currentSort = v; currentPage = 1; applyFilters(); }

function sortProducts(arr){
    var a = arr.slice();
    if (currentSort === 'price-asc')  a.sort(function(x,y){ return x.p - y.p; });
    else if (currentSort === 'price-desc') a.sort(function(x,y){ return y.p - x.p; });
    else if (currentSort === 'name') a.sort(function(x,y){ return String(x.n).localeCompare(String(y.n), 'uk'); });
    return a;
}

// ==========================================
// ПОШУК: токенізація + debounce (Task 10)
// ==========================================
function matchTokens(text, query){
    var q = String(query == null ? '' : query).toLowerCase().trim();
    if (!q) return true;
    var tokens = q.split(/\s+/);
    return tokens.every(function(t){ return text.indexOf(t) !== -1; });
}

// ===== Розумний пошук: нормалізація + синоніми + морфологія + fuzzy + ранжування =====
// Налаштування (фолдинг, синоніми, fuzzy) — з D1 через /api/search-config, керуються в /admin/search.
var FOLD = parseFold('ё>е,є>е,і>и,ї>и,ы>и,ґ>г');   // дефолт; перезаписується конфігом з БД
var FUZZY_DIST = 1, FUZZY_MINLEN = 4;
var SEARCH_SYN = {};                                // завантажується з БД у loadSearchConfig()
function parseFold(s){
    return String(s == null ? '' : s).split(',').map(function(p){ var a = p.split('>'); return [a[0], a[1] || '']; }).filter(function(x){ return x[0]; });
}
function normS(s){
    s = String(s == null ? '' : s).toLowerCase().replace(/[’'`ʼ]/g, '');
    for (var i = 0; i < FOLD.length; i++) s = s.split(FOLD[i][0]).join(FOLD[i][1]);
    return s.replace(/[^a-z0-9а-я]+/g, ' ').replace(/\s+/g, ' ').trim();
}
async function loadSearchConfig(){
    try {
        var r = await fetch('/api/search-config?v=' + SITE_VERSION);
        if (!r.ok) return;
        var d = await r.json();
        if (d.cfg) {
            if (d.cfg.fold) FOLD = parseFold(d.cfg.fold);
            if (d.cfg.fuzzy_dist != null) FUZZY_DIST = parseInt(d.cfg.fuzzy_dist, 10) || 0;
            if (d.cfg.fuzzy_minlen != null) FUZZY_MINLEN = parseInt(d.cfg.fuzzy_minlen, 10) || 4;
        }
        var syn = {};
        if (d.syn) for (var k in d.syn) { var nk = normS(k); if (nk) syn[nk] = normS(d.syn[k]); }
        SEARCH_SYN = syn;
    } catch (e) { if (DEBUG) console.warn('search-config не завантажився:', e.message); }
}
// чи редакційна відстань ≤1 (підстановка/вставка/видалення одного символу)
function editLe1(a, b){
    if (a === b) return true;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    if (la > lb){ var t = a; a = b; b = t; var tl = la; la = lb; lb = tl; }
    var i = 0, j = 0, diff = 0;
    while (i < la && j < lb){
        if (a[i] === b[j]){ i++; j++; }
        else { if (++diff > 1) return false; if (la === lb){ i++; j++; } else { j++; } }
    }
    return true;
}
function ensureIdx(p){
    if (p._sn === undefined){
        p._sn = normS(p.n);
        p._snw = p._sn.split(' ').filter(Boolean);
        p._sk = normS(p.keywords || '');
    }
}
function tokenScore(tok, p){
    var forms = SEARCH_SYN[tok] ? [tok, SEARCH_SYN[tok]] : [tok];
    var best = 0;
    for (var fi = 0; fi < forms.length; fi++){
        var f = forms[fi];
        for (var wi = 0; wi < p._snw.length; wi++){
            var w = p._snw[wi];
            if (w === f){ best = Math.max(best, 5); }
            else if ((w.indexOf(f) === 0 || f.indexOf(w) === 0) && Math.min(w.length, f.length) >= 3){ best = Math.max(best, 4); }
        }
        if (best < 3 && p._sn.indexOf(f) >= 0) best = Math.max(best, 3);
        if (best < 2 && p._sk.indexOf(f) >= 0) best = Math.max(best, 1.5);
        if (best < 2 && FUZZY_DIST > 0 && f.length >= FUZZY_MINLEN){
            for (var k = 0; k < p._snw.length; k++){ if (editLe1(p._snw[k], f)){ best = Math.max(best, 2); break; } }
        }
        if (best >= 5) break;
    }
    return best;
}
function smartScore(p, qtokens){
    ensureIdx(p);
    var sum = 0;
    for (var i = 0; i < qtokens.length; i++){ var s = tokenScore(qtokens[i], p); if (s === 0) return 0; sum += s; }
    return sum;
}
function debounce(fn, ms){ var t; return function(){ clearTimeout(t); t = setTimeout(fn, ms); }; }
const debouncedFilter = debounce(function(){ currentPage = 1; applyFilters(); }, 250);

// ==========================================
// ДЕФОЛТИ ВАГИ ЗА ТИПОМ ТОВАРУ (Task 11)
// ==========================================
function weightDefaults(p){
    // дрібнофасоване (містить грами у назві) — менший крок
    var small = /\d+\s?г(?![а-яіїєґ])/i.test(p.n);
    return small ? { val: 0.05, step: 0.05, min: 0.05 } : { val: 1, step: 0.5, min: 0.5 };
}

// Скидає пагінацію при зміні фільтра наявності (узгоджено з setSort/setSubCat)
function setInstock(){ currentPage = 1; applyFilters(); }

// Чи товар продається на вагу (кг)
function isWeightProduct(p){
    var n = (p.n || '').toLowerCase();
    return p.c === "НАСІННЯ ВАГОВЕ" || n.includes(", кг") || n.includes(", 1 кг") || n.includes(" ваговий") || n.endsWith(",кг");
}

// Скільки одиниць цього товару вже в кошику (штучний "n" або ваговий "n (кг)")
function cartQtyFor(p){
    var w = p.n + ' (кг)';
    return cart.filter(function(i){ return i.n === p.n || i.n === w; })
               .reduce(function(s, i){ return s + (parseFloat(i.q) || 0); }, 0);
}

// Позначка "в кошику: N" на картках каталогу — оновлюється наживо при зміні кошика
function updateCartBadges(){
    document.querySelectorAll('#grid .card').forEach(function(card, i){
        var p = renderedProducts[i];
        var wrap = card.querySelector('.card-img-wrap');
        if (!p || !wrap) return;
        var qty = cartQtyFor(p);
        var badge = wrap.querySelector('.cart-qty-badge');
        if (qty > 0){
            var n = Number.isInteger(qty) ? qty : Math.round(qty * 100) / 100;
            var txt = '🛒 ' + n + (isWeightProduct(p) ? ' кг' : ' шт.');
            if (badge) { badge.textContent = txt; }
            else {
                badge = document.createElement('span');
                badge.className = 'cart-qty-badge';
                badge.textContent = txt;
                wrap.appendChild(badge);
            }
            card.classList.add('in-cart');
        } else if (badge){
            badge.remove();
            card.classList.remove('in-cart');
        }
    });
}

// ==========================================
// ДОСТУПНІ МОДАЛКИ: Esc + блокування скролу (Task 14)
// ==========================================
let _modalKeyHandler = null;
// Активний контейнер модалки (видимий) — для focus-trap
function _activeModal(){
    const ids = ['order-modal','cart-modal','product-modal'];
    for (const id of ids){ const m = document.getElementById(id); if (m && getComputedStyle(m).display !== 'none') return m; }
    return null;
}
function lockModal(closeFn){
    // Прибираємо попередній хендлер, якщо lockModal викликають повторно
    // (напр. removeItem → openCart), щоб не плодити keydown-слухачі.
    if (_modalKeyHandler) document.removeEventListener('keydown', _modalKeyHandler);
    document.body.style.overflow = 'hidden';
    _modalKeyHandler = function(e){
        if (e.key === 'Escape') { closeFn(); return; }
        // focus-trap: Tab циклиться в межах модалки (не йде на фон) — a11y
        if (e.key === 'Tab'){
            const m = _activeModal(); if (!m) return;
            const f = m.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])');
            if (!f.length) return;
            const first = f[0], last = f[f.length-1];
            if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
        }
    };
    document.addEventListener('keydown', _modalKeyHandler);
}
function unlockModal(){
    document.body.style.overflow = '';
    if (_modalKeyHandler) document.removeEventListener('keydown', _modalKeyHandler);
    _modalKeyHandler = null;
}

// ==========================================
// РЕЦЕПТИ: СХЕМИ ЗАХИСТУ + ПОШУКОВІ ФІЛЬТРИ
// Оптимізовано: без дублів, сворачиваемий пошук
// ==========================================

let recipes = [];
let searchFiltersExpanded = (localStorage.getItem('searchFiltersExpanded') !== 'false');

async function loadRecipes() {
    // Спершу з D1 (/api/recipes, керується в /admin/recipes); fallback — статичний recipes.json.
    try {
        const resp = await fetch('/api/recipes?v=' + SITE_VERSION);
        if (!resp.ok) throw new Error('api/recipes ' + resp.status);
        recipes = await resp.json();
        renderRecipes();
        return;
    } catch(e) {
        if (DEBUG) console.warn('/api/recipes недоступний, fallback recipes.json:', e.message);
    }
    try {
        const resp2 = await fetch('recipes.json?v=' + SITE_VERSION);
        if (!resp2.ok) throw new Error('recipes.json: HTTP ' + resp2.status);
        recipes = await resp2.json();
        renderRecipes();
    } catch(e2) {
        if (DEBUG) console.warn('⚠️ recipes.json не знайдено:', e2.message);
    }
}

// Схеми захисту — об'єднані культури (без дублів apple_insects + apple_disease і т.д.)
const SCHEME_LINKS = {
    'apple':       'pomaceous_fruits?scheme=apple_protection',
    'cherry':      'stone_fruits?scheme=cherry_sweet_protection',
    'tomato':      'vegetables?scheme=tomato_greenhouse',
    'cucumber':    'vegetables?scheme=cucumber_protection',
    'pepper':      'vegetables?scheme=pepper_syngenta',
    'cabbage':     'vegetables?scheme=cabbage_protection',
    'carrot':      'vegetables?scheme=carrot_protection',
    'grain_wheat': 'grain_crops?scheme=wheat_spring',
    'grain_corn':  'grain_crops?scheme=corn_protection',
    'grapes':      'grapes?scheme=grapes_full_protection',
};

// Схеми Syngenta — альтернативна кнопка поруч із загальною
const SYNGENTA_LINKS = {
    'apple':       'pomaceous_fruits?scheme=apple_syngenta',
    'cherry':      'stone_fruits?scheme=cherry_syngenta',
    'tomato':      'vegetables?scheme=tomato_syngenta',
    'cucumber':    'vegetables?scheme=cucumber_syngenta',
    'pepper':      'vegetables?scheme=pepper_syngenta',
    'cabbage':     'vegetables?scheme=cabbage_syngenta',
    'carrot':      'vegetables?scheme=carrot_syngenta',
    'grapes':      'grapes?scheme=grapes_syngenta',
};

function renderRecipes() {
    const container = document.getElementById('recipes-container');
    if (!container) return;

    function toHref(target) {
        return 'protection_schemes.html?category=' + target.replace('?scheme=', '&scheme=');
    }
    // Цільовий URL схеми — з D1 (r.scheme_url), fallback на хардкод-мапу
    function schemeTarget(r){ return r.scheme_url || SCHEME_LINKS[r.id] || ''; }
    function synTarget(r){ return r.scheme_url_syngenta || SYNGENTA_LINKS[r.id] || ''; }
    function schemeBtn(r) {
        return '<a class="recipe-btn scheme" href="' + toHref(schemeTarget(r)) + '">' + r.title + '</a>';
    }
    function synBtn(r) {
        return '<a class="recipe-btn syngenta" href="' + toHref(synTarget(r)) + '">'
             + r.title + ' <span class="syn-badge">Syngenta</span></a>';
    }
    function searchBtn(r) {
        var kw = (r.keywords && r.keywords[0]) ? r.keywords[0] : r.title;
        kw = kw.replace(/'/g, "\\'");
        return '<button class="recipe-btn search" onclick="quickSearch(\'' + kw + '\')">' + r.title + '</button>';
    }

    // Категорії, де схеми захисту НЕ показуємо (нерелевантно)
    var catKey = new URLSearchParams(location.search).get('cat') || '';
    var hideSchemes = HIDE_SCHEMES.indexOf(catKey) !== -1;

    // Розділяємо за полем type (scheme / search)
    var schemeItems = hideSchemes ? [] : recipes.filter(function(r) { return r.type === 'scheme' && schemeTarget(r); });
    var searchItems = recipes.filter(function(r) { return r.type === 'search'; });

    // Fallback для старого формату recipes.json (без поля type)
    if (!schemeItems.length && !searchItems.length && !hideSchemes) {
        schemeItems = recipes.filter(function(r) { return SCHEME_LINKS[r.id]; });
        searchItems = recipes.filter(function(r) { return !SCHEME_LINKS[r.id] && !SYNGENTA_LINKS[r.id]; });
    }

    var expanded = searchFiltersExpanded;
    var html = '<div class="recipes-block">';

    // 1️⃣ СХЕМИ ЗАХИСТУ
    if (schemeItems.length) {
        html += '<div class="recipes-section schemes">';
        html += '<div class="recipes-section-title">📋 Схеми захисту та вирощування</div>';
        html += '<div class="recipes-grid">';
        schemeItems.forEach(function(r) {
            html += schemeBtn(r);
            if (synTarget(r)) html += synBtn(r);
        });
        html += '</div></div>';
    }

    // 2️⃣ ПОШУКОВІ ФІЛЬТРИ (сворачиваемі)
    if (searchItems.length) {
        html += '<div class="recipes-section search">';
        html += '<div class="search-filters-toggle">';
        html += '<input type="checkbox" id="toggle-search-filters"'
             + (expanded ? ' checked' : '')
             + ' onchange="toggleSearchFilters()">';
        html += '<label for="toggle-search-filters">🔍 Пошук товарів (' + searchItems.length + ')</label>';
        html += '</div>';
        html += '<div id="search-filters-container"' + (expanded ? '' : ' class="collapsed"') + '>';
        html += '<div class="recipes-grid search-grid">';
        searchItems.forEach(function(r) { html += searchBtn(r); });
        html += '</div></div></div>';
    }

    html += '</div>';
    container.innerHTML = html;
}

function toggleSearchFilters() {
    var checkbox = document.getElementById('toggle-search-filters');
    var container = document.getElementById('search-filters-container');
    if (!checkbox || !container) return;
    searchFiltersExpanded = checkbox.checked;
    if (searchFiltersExpanded) {
        container.classList.remove('collapsed');
    } else {
        container.classList.add('collapsed');
    }
    localStorage.setItem('searchFiltersExpanded', searchFiltersExpanded);
}

function quickSearch(query) {
    currentPage = 1; // нова вибірка — на першу сторінку
    const searchEl = document.getElementById('search');
    if (searchEl) {
        searchEl.value = query;
        applyFilters();
        setTimeout(function() {
            var grid = document.getElementById('grid');
            if (grid) grid.scrollIntoView({ behavior: 'smooth' });
        }, 100);
    }
}


// 2. Основна функція фільтрації (Пошук + Категорія + Підкатегорія)
function applyFilters() {
    const searchEl = document.getElementById('search');
    const qtokens = normS(searchEl ? searchEl.value : '').split(' ').filter(Boolean);

    const instockOnly = !!document.getElementById('instock-only')?.checked;

    // Категорія/підкатегорія/наявність — звичайні фільтри
    const base = products.filter(p => {
        const matchMainCat = (currentCat === 'Всі' || p.c === currentCat);
        const matchSubCat  = (currentSubCat === 'Всі' || p.b === currentSubCat);
        const stockOk = instockOnly ? (p.inStock !== false) : true;
        return matchMainCat && matchSubCat && stockOk;
    });

    let filtered;
    if (qtokens.length) {
        // Розумний пошук: скоринг + сортування за релевантністю
        filtered = [];
        for (let i = 0; i < base.length; i++) {
            const sc = smartScore(base[i], qtokens);
            if (sc > 0) { base[i]._score = sc; filtered.push(base[i]); }
        }
        filtered.sort((a, b) => b._score - a._score || String(a.n).localeCompare(String(b.n), 'uk'));
    } else {
        filtered = sortProducts(base);
    }

    render(filtered);

    // Категорії з підкатегоріями (з D1; CATS_WITH_SUB)
    if (CATS_WITH_SUB.includes(currentCat)) {
        renderSubCategories();
    } else {
        const subContainer = document.getElementById('sub-cat-container');
        if (subContainer) subContainer.style.display = 'none';
    }
}

// 3. Створення кнопок підкатегорій (Гербіциди, Фунгіциди і т.д.)
function renderSubCategories() {
    const subContainer = document.getElementById('sub-cat-container');
    if (!subContainer) return;

    // Збираємо унікальні значення поля "b" саме для поточної сторінки
    const subCats = [...new Set(products
        .filter(p => p.c === currentCat && p.b)
        .map(p => p.b))];

    if (subCats.length === 0) {
        subContainer.style.display = 'none';
        return;
    }

    subContainer.style.display = 'flex';

    // Текст першої кнопки "Всі" — з D1 (SUB_ALL_MAP)
    const allText = SUB_ALL_MAP[currentCat] || 'Всі';

    let html = `<button class="cat-btn ${currentSubCat === 'Всі' ? 'active' : ''}"
                onclick="setSubCat('Всі')">${escapeHTML(allText)}</button>`;

    // Виводимо кнопки (сортуємо за алфавітом, з урахуванням української локалі)
    subCats.sort((a, b) => a.localeCompare(b, 'uk')).forEach(sc => {
        html += `<button class="cat-btn ${currentSubCat === sc ? 'active' : ''}"
                 onclick="setSubCat('${escapeHTML(sc)}')">${escapeHTML(sc)}</button>`;
    });

    subContainer.innerHTML = html;
}

// 4. Функція зміни підкатегорії
function setSubCat(sc) {
    currentSubCat = sc;
    currentPage = 1;
    applyFilters();
}

// 5. Виведення карток товарів
function render(arr) {
    const grid = document.getElementById('grid');
    if (!grid) return;

    // Порожній стан
    if (arr.length === 0) {
        grid.innerHTML = `<div style="
            grid-column: 1/-1; text-align:center; padding: 40px 20px;
            color: #888; font-size: 1rem; line-height: 1.6;
        ">
            <div style="font-size:2.5rem; margin-bottom:12px;">🔍</div>
            <div style="font-weight:600; margin-bottom:6px;">Нічого не знайдено</div>
            <div style="font-size:0.9rem;">Спробуйте змінити запит або <a href="#" onclick="clearSearch(event)" style="color:var(--green);">очистити пошук</a></div>
        </div>`;
        const pagerEl = document.getElementById('catalog-pager');
        if (pagerEl) pagerEl.innerHTML = '';
        return;
    }

    // постранична вибірка
    const pages = Math.max(1, Math.ceil(arr.length / pageSize));
    if (currentPage > pages) currentPage = pages;
    if (currentPage < 1) currentPage = 1;
    const startIdx = (currentPage - 1) * pageSize;
    const slice = arr.slice(startIdx, startIdx + pageSize);
    renderedProducts = slice; // зберігаємо для модального вікна

    // Іконки-плейсхолдери за категорією — з D1 (CAT_ICONS)
    const catIcons = CAT_ICONS;

    // Збираємо HTML у масив — один innerHTML замість += у циклі
    const cards = slice.map((p, idx) => {
        // safeName екранує лапки для onclick-сигнатур (НЕ ламаємо addToCart/addWeightToCart)
        const safeName = p.n.replace(/&/g, "&amp;").replace(/'/g, "\\'").replace(/"/g, "&quot;");
        const isWeight = isWeightProduct(p);

        const icon = escapeHTML(catIcons[p.c] || '🛒');
        const isOOS = p.inStock === false;
        const wd = weightDefaults(p);
        // акція з D1 (/api/products повертає p.sale лише коли активна)
        const sale = (typeof p.sale === 'number' && p.sale > 0 && p.sale < p.p) ? p.sale : null;
        const effPrice = sale != null ? sale : p.p;
        const isGroup = !!(p.priceFrom && p.group);   // картка-група фасовок

        // якщо є slug — картка-фото веде на сторінку товару /p/<slug>; інакше модалка
        const href = p.slug ? ('/p/' + p.slug) : '';
        const wrapOpen  = href ? `<a class="card-img-wrap" href="${href}">` : `<div class="card-img-wrap" onclick="openProductModal(${idx})">`;
        const wrapClose = href ? `</a>` : `</div>`;
        // Перші 6 карток сторінки — над згином: eager + пріоритет (швидший LCP);
        // решта — lazy. src — мініатюра з /thumb (з відкатом на оригінал).
        const eager = idx < 6;
        const imgBlock = p.img
            ? `${wrapOpen}
                   <img src="${thumbUrl(p.img)}" alt="${escapeHTML(p.n)}" class="card-img" loading="${eager ? 'eager' : 'lazy'}"${idx === 0 ? ' fetchpriority="high"' : ''} decoding="async"
                        onerror="this.parentElement.innerHTML='<div class=\\'card-img-placeholder\\'>${icon}</div>'">
               ${wrapClose}`
            : `${wrapOpen}
                   <div class="card-img-placeholder">${icon}</div>
               ${wrapClose}`;

        // Блок дій: група фасовок → кнопка вибору; out-of-stock — бейдж; інакше — додати в кошик
        const actionBlock = isGroup
            ? `<a class="btn" href="${href || ('/p/' + p.slug)}" style="text-decoration:none;display:block;text-align:center">Вибрати розмір →</a>`
            : isOOS
            ? `<div class="oos-badge">Немає в наявності</div>`
            : (isWeight ? `
                    <div style="margin: 10px 0; display: flex; align-items: center; justify-content: center; gap: 4px;">
                        <button onclick="(function(){var i=document.getElementById('qty-${idx}');var v=Math.round((parseFloat(i.value||0)-${wd.step})*100)/100;i.value=v<${wd.min}?${wd.min}:v;})()"
                                style="width:30px;height:36px;border:2px solid var(--green);background:var(--gp);border-radius:6px;font-size:1.1rem;font-weight:bold;cursor:pointer;color:var(--green);line-height:1;padding:0;">&#8722;</button>
                        <input type="number" id="qty-${idx}"
                               value="${wd.val}"
                               step="${wd.step}"
                               min="${wd.min}"
                               style="width: 68px; padding: 8px 4px; border-radius: 6px; border: 2px solid var(--green); text-align: center; font-weight: bold;">
                        <button onclick="(function(){var i=document.getElementById('qty-${idx}');i.value=Math.round((parseFloat(i.value||0)+${wd.step})*100)/100;})()"
                                style="width:30px;height:36px;border:2px solid var(--green);background:var(--gp);border-radius:6px;font-size:1.1rem;font-weight:bold;cursor:pointer;color:var(--green);line-height:1;padding:0;">+</button>
                        <span style="font-weight: bold; color: #555;">кг</span>
                    </div>
                    <div class="qty-quick">${[0.5,1,5,10].map(function(v){ return '<button type="button" onclick="document.getElementById(\'qty-'+idx+'\').value='+v+'">'+v+' кг</button>'; }).join('')}</div>
                    <button class="btn" onclick="addWeightToCart('${safeName}', ${effPrice}, ${idx}, 'кг')">🛒 Додати в кошик</button>
                ` : `
                    <button class="btn" onclick="addToCart('${safeName}', ${effPrice}, this, ${p.pid != null ? p.pid : 'null'})">🛒 Додати в кошик</button>
                `);

        return `
            <div class="card${isOOS ? ' card--oos' : ''}">
                ${imgBlock}
                ${href ? `<a href="${href}" style="text-decoration:none;color:inherit;"><h3>${escapeHTML(p.n)}</h3></a>` : `<h3>${escapeHTML(p.n)}</h3>`}
                <div class="price">${isGroup
                    ? `від ${p.p.toFixed(2)} грн <span style="background:var(--green);color:#fff;border-radius:6px;padding:1px 6px;font-size:.62rem;font-weight:800;vertical-align:middle;">📦 ${p.vcount} фасов.</span>`
                    : sale != null
                    ? `<span style="text-decoration:line-through;color:#767676;font-size:.8rem;font-weight:400;">${p.p.toFixed(2)}</span> <span style="color:#c0392b;">${sale.toFixed(2)} грн</span> <span style="background:#ff7a00;color:#fff;border-radius:6px;padding:1px 6px;font-size:.62rem;font-weight:800;vertical-align:middle;">АКЦІЯ</span>`
                    : `${p.p.toFixed(2)} грн`} ${isWeight ? '<small>/кг</small>' : ''}</div>

                ${actionBlock}
            </div>
        `;
    });

    grid.innerHTML = cards.join('');
    updateCartBadges();

    // Product JSON-LD для видимих карток — rich snippets
    var ldOld = document.getElementById('products-ldjson');
    if (ldOld) ldOld.remove();
    var ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.id = 'products-ldjson';
    var cfg = window.SITE_CONFIG || {};
    var returnDays = (cfg.seo_return_days && parseInt(cfg.seo_return_days,10) > 0) ? parseInt(cfg.seo_return_days,10) : 14;
    var shipCost   = (cfg.seo_ship_cost !== undefined && cfg.seo_ship_cost !== '') ? parseFloat(String(cfg.seo_ship_cost).replace(',','.')) : 0;
    if (isNaN(shipCost) || shipCost < 0) shipCost = 0;
    var origin = location.origin;
    var canon  = origin + location.pathname + location.search;
    ld.textContent = JSON.stringify(slice.map(function (p) {
        var effPrice = (typeof p.sale === 'number' && p.sale > 0 && p.sale < p.p) ? p.sale : p.p;
        var imgAbs = p.img ? (p.img.startsWith('http') ? p.img : origin + '/' + encodeURI(p.img.replace(/^\//, ''))) : undefined;
        var desc = p.annot || p.n;
        return {
            "@context": "https://schema.org", "@type": "Product",
            "name": p.n,
            "mpn": p.slug || undefined,
            "description": desc,
            "image": imgAbs || undefined,
            "brand": p.b ? {"@type": "Brand", "name": p.b} : undefined,
            "offers": {
                "@type": "Offer",
                "price": effPrice,
                "priceCurrency": "UAH",
                "url": p.slug ? (origin + '/p/' + p.slug) : canon,
                "availability": p.inStock !== false ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
                "hasMerchantReturnPolicy": {
                    "@type": "MerchantReturnPolicy",
                    "applicableCountry": "UA",
                    "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
                    "merchantReturnDays": returnDays,
                    "returnMethod": "https://schema.org/ReturnByMail",
                    "returnFees": "https://schema.org/ReturnShippingFees",
                    "returnShippingFeesAmount": {"@type": "MonetaryAmount", "value": 0, "currency": "UAH"}
                },
                "shippingDetails": {
                    "@type": "OfferShippingDetails",
                    "shippingRate": {"@type": "MonetaryAmount", "value": shipCost, "currency": "UAH"},
                    "shippingDestination": {"@type": "DefinedRegion", "addressCountry": "UA"},
                    "deliveryTime": {
                        "@type": "ShippingDeliveryTime",
                        "handlingTime": {"@type": "QuantitativeValue", "minValue": 0, "maxValue": 1, "unitCode": "DAY"},
                        "transitTime": {"@type": "QuantitativeValue", "minValue": 1, "maxValue": 3, "unitCode": "DAY"}
                    }
                }
            }
        };
    })).replace(/</g, '\\u003c');
    document.head.appendChild(ld);

    renderCatalogPager(arr.length);
}

function clearSearch(e) {
    e.preventDefault();
    const searchEl = document.getElementById('search');
    if (searchEl) { searchEl.value = ''; applyFilters(); }
}

// 6. Пагінація каталогу (налаштовуваний розмір сторінки)
function setPageSize(v) {
    v = parseInt(v, 10);
    if (!PAGE_SIZE_OPTIONS.includes(v)) v = 48;
    pageSize = v;
    currentPage = 1;
    localStorage.setItem('agronom_pagesize', String(v));
    applyFilters();
}

function gotoPage(p) {
    currentPage = p;
    applyFilters();
    const g = document.getElementById('grid');
    if (g) {
        const top = g.getBoundingClientRect().top + window.pageYOffset - 70;
        window.scrollTo({ top: top < 0 ? 0 : top, behavior: 'smooth' });
    }
}

function renderCatalogPager(total) {
    const host = document.getElementById('catalog-pager');
    if (!host) return;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    if (pages <= 1) { host.innerHTML = ''; return; }

    // вікно номерів сторінок з еліпсисами: 1 … 4 5 [6] 7 8 … 48
    const around = 2, win = [];
    let last = 0;
    for (let i = 1; i <= pages; i++) {
        if (i === 1 || i === pages || (i >= currentPage - around && i <= currentPage + around)) {
            if (last && i - last > 1) win.push('…');
            win.push(i); last = i;
        }
    }
    const btn = (label, page, o) => o && o.disabled
        ? `<button class="pg-btn" disabled>${label}</button>`
        : `<button class="pg-btn${o && o.active ? ' active' : ''}" onclick="gotoPage(${page})">${label}</button>`;
    const nums = win.map(x => x === '…'
        ? '<span class="pg-ellip">…</span>'
        : btn(x, x, { active: x === currentPage })).join('');
    host.innerHTML =
        '<div class="pg-row">' +
        btn('‹ Назад', currentPage - 1, { disabled: currentPage <= 1 }) +
        nums +
        btn('Далі ›', currentPage + 1, { disabled: currentPage >= pages }) +
        '</div>' +
        `<div class="pg-info">Сторінка ${currentPage} з ${pages} · ${total} товарів</div>`;
}

// Виставляє селектор розміру сторінки у збережене значення
function initPagination() {
    const sel = document.getElementById('page-size');
    if (sel) sel.value = String(pageSize);
}

// 7. Робота з кошиком (Локальне сховище)
function saveCart() {
    localStorage.setItem('agronom_cart', JSON.stringify(cart));
    updateCartUI();
}

function addToCart(name, price, btn, pid) {
    const item = cart.find(i => i.n === name);
    if(item) {
        item.q++;
    } else {
        cart.push({n: name, p: price, q: 1, pid: pid != null ? pid : null});
    }
    saveCart();

    if (btn) {
        const oldText = btn.innerText;
        btn.innerText = "✓ ДОДАНО";
        btn.style.background = "#1a2e1a";
        setTimeout(() => { btn.innerText = oldText; btn.style.background = "var(--green)"; }, 800);
    }
}

function addWeightToCart(name, price, idx, unit) {
    const qtyInput = document.getElementById(`qty-${idx}`);
    const quantity = parseFloat(qtyInput.value);

    if (isNaN(quantity) || quantity <= 0) {
        alert("Вкажіть коректну кількість");
        return;
    }

    const fullName = `${name} (${unit})`;
    const srcP = (typeof renderedProducts !== 'undefined' && renderedProducts[idx]) ? renderedProducts[idx] : null;

    const item = cart.find(i => i.n === fullName);
    if (item) {
        item.q = parseFloat((item.q + quantity).toFixed(3));
    } else {
        cart.push({ n: fullName, p: price, q: quantity, pid: srcP ? srcP.pid : null });
    }

    saveCart();

    const card = qtyInput.closest('.card');
    const btn = card ? card.querySelector('button.btn') : null;
    if (btn) {
        const oldText = btn.innerText;
        btn.innerText = "✓ ДОДАНО";
        btn.style.background = "#1a2e1a";
        setTimeout(() => {
            btn.innerText = oldText;
            btn.style.background = "var(--green)";
        }, 800);
    }
}

// ── Нижня панель навігації (мобільний) ──
function bnTop(e){ if(e) e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function bnSearch(e){ if(e) e.preventDefault(); var s = document.getElementById('search'); if (s) { window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(function(){ s.focus(); }, 350); } }
function bnCart(e){ if(e) e.preventDefault(); if (typeof openCart === 'function') openCart(); }

function updateCartUI() {
    const itemCount = cart.length; // кількість різних позицій
    const totalUnits = cart.reduce((s, i) => s + parseFloat(i.q || 0), 0); // загальна кількість одиниць
    const totalSum   = cart.reduce((sum, item) => sum + (item.p * item.q), 0);

    const countEl  = document.getElementById('cart-count');
    const floatBtn = document.getElementById('cart-float');

    // Плаваюча кнопка: завжди показуємо якщо є товари
    if (floatBtn) {
        floatBtn.style.display = itemCount > 0 ? 'flex' : 'none';
        const unitsLabel = Number.isInteger(totalUnits) ? totalUnits : totalUnits.toFixed(2);
        floatBtn.innerHTML = `🛒 Кошик (${unitsLabel} од.) — ${totalSum.toFixed(2)} грн`;
    }
    if (countEl) countEl.innerText = itemCount;
    const bnCount = document.getElementById('bn-cart-count');
    if (bnCount) { bnCount.textContent = itemCount; bnCount.classList.toggle('show', itemCount > 0); }

    updateCartBadges(); // позначки кількості на картках каталогу
}

function openCart() {
    const modal = document.getElementById('cart-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    lockModal(closeCart);
    let total = 0;

    const qbtn = 'width:28px;height:28px;border:1.5px solid var(--green);background:var(--gp);border-radius:6px;font-size:1rem;font-weight:bold;cursor:pointer;color:var(--green);line-height:1;padding:0;';
    document.getElementById('cart-list').innerHTML = cart.map((i, idx) => {
        total += i.p * i.q;
        const isW = /\(кг\)/.test(i.n);
        const step = isW ? 0.5 : (i.div && i.div > 0 ? i.div : 1);
        const min  = isW ? 0.5 : (i.div && i.div > 0 ? i.div : 1);
        const qDisplay = Number.isInteger(i.q) ? i.q : (Math.round(i.q * 1000) / 1000);
        return `
            <div class="cart-item" style="display:flex; justify-content:space-between; align-items:center; gap:8px; border-bottom:1px solid #eee; padding:10px 0;">
                <div style="flex:1; min-width:0;">
                    <div style="font-size:.92rem; line-height:1.25;">${escapeHTML(i.n)}</div>
                    <small style="color:#555;">${i.p} грн × ${qDisplay}${isW ? ' кг' : ''} = <b>${(i.p * i.q).toFixed(2)} грн</b></small>
                </div>
                <div style="display:flex; align-items:center; gap:4px;">
                    <button onclick="changeQty(${idx},-${step})" aria-label="Зменшити" style="${qbtn}">&#8722;</button>
                    <span style="min-width:38px; text-align:center; font-weight:700;">${qDisplay}</span>
                    <button onclick="changeQty(${idx},${step})" aria-label="Збільшити" style="${qbtn}">+</button>
                </div>
                <button onclick="removeItem(${idx})" aria-label="Видалити" style="background:none; border:none; color:#c0392b; cursor:pointer; font-size:1.2rem;">✕</button>
            </div>
        `;
    }).join('');
    document.getElementById('cart-total').innerText = total.toFixed(2);
}

// Зміна кількості прямо в кошику (вагові — крок 0.5 кг, штучні — 1). Нижче мінімуму → видалення.
function changeQty(idx, delta) {
    if (!cart[idx]) return;
    const isW = /\(кг\)/.test(cart[idx].n);
    const min = isW ? 0.5 : (cart[idx].div && cart[idx].div > 0 ? cart[idx].div : 1);
    const q = Math.round((cart[idx].q + delta) * 1000) / 1000;
    if (q < min) { removeItem(idx); return; }
    cart[idx].q = q;
    saveCart();
    openCart();
}

function removeItem(idx) {
    cart.splice(idx, 1);
    saveCart();
    if(cart.length === 0) closeCart(); else openCart();
}

function closeCart() {
    document.getElementById('cart-modal').style.display = 'none';
    unlockModal();
}

function clearCart() {
    if (confirm("Ви впевнені, що хочете очистити весь кошик?")) {
        cart = [];

        if (typeof saveCart === 'function') {
            saveCart();
        } else {
            localStorage.setItem('agronom_cart', JSON.stringify([]));
        }

        updateCartUI();

        const cartCountEl = document.getElementById('cart-count');
        if (cartCountEl) cartCountEl.innerText = '0';

        const cartTotalEl = document.getElementById('cart-total');
        if (cartTotalEl) cartTotalEl.innerText = '0';

        const cartListEl = document.getElementById('cart-list');
        if (cartListEl) cartListEl.innerHTML = '<p style="text-align:center; padding: 20px;">Кошик порожній</p>';

        alert("Кошик очищено!");
    }
}

// ==========================================
// 8. ВІДПРАВКА ЗАМОВЛЕННЯ (через Cloudflare Worker)
// ==========================================

const ORDER_WORKER_URL = "https://agro-order.ruslanchyk.workers.dev";

// Чи налаштовано Worker (а не лишився плейсхолдер "ВАШ-ЛОГІН").
// Захист від ситуації, коли нефункціональний URL непомітно потрапляє у прод.
function isOrderWorkerConfigured() {
    return typeof ORDER_WORKER_URL === 'string'
        && ORDER_WORKER_URL.indexOf('ВАШ-ЛОГІН') === -1
        && /^https:\/\//.test(ORDER_WORKER_URL);
}

// Екранування динамічних значень для Telegram parse_mode=HTML.
// Щоб <, >, & у введенні клієнта чи назві товару не ламали розбір повідомлення
// (Telegram повертає 400 "can't parse entities" → замовлення мовчки не доходить).
function escapeTgHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function sendToTelegram() {
    if (cart.length === 0) return alert("Кошик порожній!");
    openOrderModal();
}

function openOrderModal() {
    const old = document.getElementById('order-modal');
    if (old) old.remove();

    // Ховаємо кошик, щоб не накладати модалки (lockModal тримає один хендлер Esc/scroll-lock)
    const cartModal = document.getElementById('cart-modal');
    if (cartModal) cartModal.style.display = 'none';

    // Доступні способи доставки/оплати — керуються в /admin/checkout (дефолт: усі ввімкнені)
    const _cfg = window.SITE_CONFIG || {};
    const delOn = { np: _cfg.del_np !== '0', ukr: _cfg.del_ukr !== '0', self: _cfg.del_self !== '0' };
    if (!delOn.np && !delOn.ukr && !delOn.self) delOn.np = true;   // запобіжник: хоч один
    const firstDel = delOn.np ? 'np' : (delOn.ukr ? 'ukr' : 'self');
    const payCodOn = _cfg.pay_cod !== '0';
    const payCardOn = _cfg.liqpay_on === '1' && _cfg.pay_card !== '0';
    const delBtn = (id, type, label) => delOn[type]
        ? `<button type="button" id="delivery-${id}" onclick="selectDelivery('${type}')" style="flex:1 1 30%; min-width:96px; padding:9px; border:2px solid ${type === firstDel ? 'var(--green)' : '#ccc'}; border-radius:8px; background:${type === firstDel ? 'var(--green)' : '#fff'}; color:${type === firstDel ? '#fff' : '#555'}; font-weight:bold; font-size:.88rem; cursor:pointer;">${label}</button>`
        : '';

    const modal = document.createElement('div');
    modal.id = 'order-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Оформлення замовлення');
    modal.style.cssText = `
        position:fixed; inset:0; background:rgba(0,0,0,0.6);
        display:flex; align-items:flex-start; justify-content:center;
        z-index:9999; padding:16px; box-sizing:border-box;
        overflow-y:auto;
    `;

    modal.innerHTML = `
        <div style="
            background:#fff; border-radius:16px; padding:28px 24px;
            width:100%; max-width:440px; box-shadow:0 8px 32px rgba(0,0,0,0.25);
            font-family:sans-serif; position:relative; box-sizing:border-box;
            margin:auto;
        ">
            <button onclick="closeOrderModal()" aria-label="Закрити" style="
                position:absolute; top:14px; right:16px;
                background:none; border:none; font-size:1.5rem;
                cursor:pointer; color:#888; line-height:1;
            ">✕</button>

            <h2 style="margin:0 0 16px; font-size:1.2rem; color:#1a2e1a;">
                📋 Оформлення замовлення
            </h2>

            <div style="background:#f6faf4; border:1px solid #e0ead8; border-radius:10px; padding:10px 12px; margin-bottom:18px;">
                <div style="font-size:.78rem; color:#557; font-weight:700; text-transform:uppercase; letter-spacing:.04em; margin-bottom:6px;">Ваше замовлення</div>
                <div id="ord-summary-body"></div>
            </div>

            <label style="display:block; margin-bottom:14px;">
                <span style="font-size:.85rem; color:#555; display:block; margin-bottom:4px;">
                    Прізвище та Ім'я *
                </span>
                <input id="ord-name" type="text" placeholder="Іваненко Іван"
                    style="width:100%; padding:10px 12px; border:1.5px solid #ccc;
                    border-radius:8px; font-size:1rem; box-sizing:border-box;">
            </label>

            <label style="display:block; margin-bottom:14px;">
                <span style="font-size:.85rem; color:#555; display:block; margin-bottom:4px;">
                    Номер телефону *
                </span>
                <input id="ord-phone" type="tel" placeholder="+380XXXXXXXXX"
                    style="width:100%; padding:10px 12px; border:1.5px solid #ccc;
                    border-radius:8px; font-size:1rem; box-sizing:border-box;">
            </label>

            <label style="display:block; margin-bottom:10px;">
                <span style="font-size:.85rem; color:#555; display:block; margin-bottom:6px;">
                    Спосіб отримання *
                </span>
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    ${delBtn('np','np','🚚 Нова Пошта')}
                    ${delBtn('ukr','ukr','📮 Укрпошта')}
                    ${delBtn('self','self','🏪 Самовивіз')}
                </div>
            </label>

            <div id="ord-address-block" style="margin-bottom:14px;" data-delivery="${firstDel}" data-npservice="wh">
                <span id="ord-addr-label" style="font-size:.85rem; color:#555; display:block; margin-bottom:4px;">
                    Місто та відділення Нової Пошти *
                </span>
                <div id="np-service-toggle" style="display:flex; gap:8px; margin-bottom:8px;">
                    <button type="button" id="np-svc-wh" onclick="selectNpService('wh')" style="flex:1; padding:7px; border:2px solid var(--green); border-radius:8px; background:#eef6ee; color:var(--green); font-weight:700; font-size:.82rem; cursor:pointer;">🏤 До відділення</button>
                    <button type="button" id="np-svc-door" onclick="selectNpService('door')" style="flex:1; padding:7px; border:2px solid #ccc; border-radius:8px; background:#fff; color:#555; font-weight:700; font-size:.82rem; cursor:pointer;">🚪 Курʼєром</button>
                </div>
                <input id="ord-np-city" type="text" list="np-city-list" autocomplete="off" placeholder="Місто (почніть вводити)"
                    style="width:100%; padding:10px 12px; border:1.5px solid #ccc; border-radius:8px; font-size:1rem; box-sizing:border-box; margin-bottom:8px;">
                <datalist id="np-city-list"></datalist>
                <input id="ord-address" type="text" list="np-wh-list" autocomplete="off" placeholder="${(window.SITE_CONFIG && window.SITE_CONFIG.np_placeholder) || 'Відділення №…'}"
                    style="width:100%; padding:10px 12px; border:1.5px solid #ccc; border-radius:8px; font-size:1rem; box-sizing:border-box;">
                <datalist id="np-wh-list"></datalist>
                <div id="np-door-fields" style="display:none; margin-top:8px;">
                    <input id="ord-np-street" type="text" autocomplete="off" placeholder="Вулиця"
                        style="width:100%; padding:10px 12px; border:1.5px solid #ccc; border-radius:8px; font-size:1rem; box-sizing:border-box; margin-bottom:8px;">
                    <div style="display:flex; gap:8px;">
                        <input id="ord-np-house" type="text" placeholder="Будинок" style="flex:1; padding:10px 12px; border:1.5px solid #ccc; border-radius:8px; font-size:1rem; box-sizing:border-box;">
                        <input id="ord-np-flat" type="text" placeholder="Квартира" style="flex:1; padding:10px 12px; border:1.5px solid #ccc; border-radius:8px; font-size:1rem; box-sizing:border-box;">
                    </div>
                </div>
                <span style="font-size:.78rem; color:#888; margin-top:4px; display:block;">
                    💳 Доставка за тарифами перевізника
                </span>
            </div>

            ${(payCodOn && payCardOn) ? `
            <label style="display:block; margin-bottom:14px;">
                <span style="font-size:.85rem; color:#555; display:block; margin-bottom:6px;">Оплата *</span>
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    <button type="button" id="pay-cod" onclick="selectPay('cod')" style="flex:1 1 45%; min-width:120px; padding:10px; border:2px solid var(--green); border-radius:8px; background:var(--green); color:#fff; font-weight:bold; font-size:.86rem; cursor:pointer;">💵 При отриманні</button>
                    <button type="button" id="pay-card" onclick="selectPay('card')" style="flex:1 1 45%; min-width:120px; padding:10px; border:2px solid #ccc; border-radius:8px; background:#fff; color:#555; font-weight:bold; font-size:.86rem; cursor:pointer;">💳 Карткою онлайн</button>
                </div>
                <span id="pay-hint" style="font-size:.78rem; color:#888; margin-top:4px; display:block;">Накладений платіж / готівка при самовивозі</span>
            </label>` : (payCardOn ? `<div style="font-size:.85rem;color:#557;margin-bottom:14px;">💳 Оплата: карткою онлайн (LiqPay)</div>` : '')}

            <label style="display:block; margin-bottom:20px;">
                <span style="font-size:.85rem; color:#555; display:block; margin-bottom:4px;">
                    Коментар (необов'язково)
                </span>
                <textarea id="ord-comment" rows="2" placeholder="Уточнення, побажання..."
                    style="width:100%; padding:10px 12px; border:1.5px solid #ccc;
                    border-radius:8px; font-size:1rem; resize:none; box-sizing:border-box;"></textarea>
            </label>

            <div id="ord-error" style="
                display:none; background:#ffe5e5; color:#c0392b;
                border-radius:8px; padding:10px 14px; margin-bottom:14px; font-size:.9rem;
            "></div>

            <div id="ord-turnstile" style="margin-bottom:12px"></div>

            <div style="display:flex; gap:10px;">
                <button id="ord-submit-btn" onclick="submitOrder('telegram')" style="
                    flex:1; padding:13px; background:var(--green); color:#fff;
                    border:none; border-radius:10px; font-size:1rem;
                    font-weight:bold; cursor:pointer; transition:background .2s;
                ">
                    ✅ Оформити замовлення
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) closeOrderModal(); });
    lockModal(closeOrderModal);
    document.getElementById('ord-name').focus();
    wireNpAutocomplete();
    renderTurnstile();
    renderOrderSummary();
    selectDelivery(firstDel);                       // синхронізувати адресні поля з дефолтною доставкою
    _payMethod = payCodOn ? 'cod' : 'card';         // дефолт оплати = перший доступний спосіб
}

// Рендер «Ваше замовлення» у формі checkout з кнопками −/+ (оновлює лише summary,
// щоб не стерти введені ПІБ/телефон/адресу). Той самий cart, що й кошик.
function renderOrderSummary() {
    const box = document.getElementById('ord-summary-body');
    if (!box) return;
    const qbtn = 'width:26px;height:26px;border:1.5px solid var(--green);background:#e8f5e8;border-radius:6px;font-size:1rem;font-weight:bold;cursor:pointer;color:#2d6a2d;line-height:1;padding:0;';
    const rows = cart.map((i, idx) => {
        const isW = /\(\s*кг\s*\)/i.test(i.n);
        const step = isW ? 0.5 : (i.div && i.div > 0 ? i.div : 1);
        const qDisplay = Number.isInteger(i.q) ? i.q : (Math.round(i.q * 1000) / 1000);
        return `<div style="display:flex; align-items:center; gap:6px; font-size:.86rem; padding:4px 0; border-bottom:1px solid #ebf2e6;">
            <span style="flex:1; min-width:0; line-height:1.25;">${escapeHTML(i.n)}</span>
            <button type="button" onclick="changeQtyOrder(${idx},-${step})" aria-label="Зменшити" style="${qbtn}">&#8722;</button>
            <span style="min-width:34px; text-align:center; font-weight:700;">${qDisplay}</span>
            <button type="button" onclick="changeQtyOrder(${idx},${step})" aria-label="Збільшити" style="${qbtn}">+</button>
            <span style="white-space:nowrap; font-weight:700; min-width:62px; text-align:right;">${(i.p * i.q).toFixed(2)} грн</span>
        </div>`;
    }).join('');
    const total = cart.reduce((s, i) => s + i.p * i.q, 0);
    box.innerHTML = `<div style="max-height:180px; overflow-y:auto;">${rows}</div>
        <div style="display:flex; justify-content:space-between; margin-top:6px; padding-top:6px; font-weight:800;"><span>Разом</span><span>${total.toFixed(2)} грн</span></div>`;
}
// Зміна кількості у формі оформлення (вага — крок 0.5; штуки — 1). Нижче мінімуму → видалення.
function changeQtyOrder(idx, delta) {
    if (!cart[idx]) return;
    const isW = /\(\s*кг\s*\)/i.test(cart[idx].n);
    const min = isW ? 0.5 : (cart[idx].div && cart[idx].div > 0 ? cart[idx].div : 1);
    const q = Math.round((cart[idx].q + delta) * 1000) / 1000;
    if (q < min) {
        cart.splice(idx, 1);
        if (!cart.length) { closeOrderModal(); updateCartUI(); return; }   // порожньо → закрити форму
    } else {
        cart[idx].q = q;
    }
    saveCart();
    renderOrderSummary();   // оновлюємо ЛИШЕ summary — введені поля лишаються
}

// Turnstile (анти-спам) у формі замовлення — вмикається, коли заданий SITE_CONFIG.turnstile_sitekey
var _tsWidget = null;
function renderTurnstile(){
    var key = window.SITE_CONFIG && window.SITE_CONFIG.turnstile_sitekey;
    var box = document.getElementById('ord-turnstile');
    if (!key || !box) return;
    _tsWidget = null;
    function doRender(){ try { if (window.turnstile) _tsWidget = window.turnstile.render(box, { sitekey: key }); } catch (e) {} }
    if (window.turnstile) { doRender(); return; }
    if (!document.getElementById('cf-turnstile-js')) {
        var s = document.createElement('script');
        s.id = 'cf-turnstile-js';
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true; s.defer = true; s.onload = doRender;
        document.head.appendChild(s);
    } else {
        var t = setInterval(function () { if (window.turnstile) { clearInterval(t); doRender(); } }, 200);
        setTimeout(function () { clearInterval(t); }, 6000);
    }
}

// Автодоповнення доставки (НП і Укрпошта). Провайдер визначається поточною доставкою.
var _npRefMap = {};      // назва міста → CityRef (НП) / CITY_ID (Укрпошта)
var _npWhRefMap = {};    // опис відділення → WarehouseRef (НП) / POSTCODE (Укрпошта)
var _npReady = false, _ukrReady = false;
async function wireNpAutocomplete() {
    var cityEl = document.getElementById('ord-np-city');
    var addrEl = document.getElementById('ord-address');
    if (!cityEl || !addrEl) return;
    // probe НП
    try { var p1 = await (await fetch('/api/np?type=city&q=' + encodeURIComponent('киї'))).json(); _npReady = !(!p1 || p1.error || !p1.items); } catch (e) { _npReady = false; }
    // probe Укрпошти (лише якщо прапорець on)
    _ukrReady = false;
    if (window.SITE_CONFIG && window.SITE_CONFIG.ukrposhta_on) {
        try { var p2 = await (await fetch('/api/ukrposhta?type=city&q=' + encodeURIComponent('киї'))).json(); _ukrReady = !(!p2 || p2.error || !p2.items); } catch (e) { _ukrReady = false; }
    }
    if (_npReady) cityEl.dataset.npReady = '1';
    if (_ukrReady) cityEl.dataset.ukrReady = '1';
    // Поточний провайдер за вибраною доставкою (null = вільний ввід)
    function provider() {
        var ab = document.getElementById('ord-address-block');
        var del = ab && ab.dataset ? ab.dataset.delivery : 'np';
        if (del === 'ukr') return _ukrReady ? 'ukr' : null;
        if (del === 'np') return _npReady ? 'np' : null;
        return null;
    }
    var fillCities = debounce(async function () {
        var prov = provider(); if (!prov) return;
        var q = cityEl.value.trim(); if (q.length < 2) return;
        var url = prov === 'ukr' ? '/api/ukrposhta?type=city&q=' + encodeURIComponent(q) : '/api/np?type=city&q=' + encodeURIComponent(q);
        try {
            var d = await (await fetch(url)).json();
            var dl = document.getElementById('np-city-list'); if (!dl) return; dl.innerHTML = ''; _npRefMap = {};
            (d.items || []).forEach(function (it) { var o = document.createElement('option'); o.value = it.name; dl.appendChild(o); _npRefMap[it.name] = it.ref; });
        } catch (e) {}
    }, 250);
    var fillWh = debounce(async function () {
        var prov = provider(); if (!prov) return;
        var city = cityEl.value.trim(); if (!city) return; var q = addrEl.value.trim();
        var url = prov === 'ukr'
            ? '/api/ukrposhta?type=po&ref=' + encodeURIComponent(_npRefMap[city] || '')
            : '/api/np?type=wh&ref=' + encodeURIComponent(_npRefMap[city] || '') + '&city=' + encodeURIComponent(city) + '&q=' + encodeURIComponent(q);
        try {
            var d = await (await fetch(url)).json();
            var dl = document.getElementById('np-wh-list'); if (!dl) return; dl.innerHTML = ''; _npWhRefMap = {};
            (d.items || []).forEach(function (it) { var o = document.createElement('option'); o.value = it.name; dl.appendChild(o); _npWhRefMap[it.name] = it.ref || ''; });
        } catch (e) {}
    }, 250);
    cityEl.addEventListener('input', fillCities);
    addrEl.addEventListener('focus', fillWh);
    addrEl.addEventListener('input', fillWh);
}

function closeOrderModal() {
    const m = document.getElementById('order-modal');
    if (m) m.remove();
    unlockModal();
}

// Спосіб оплати: cod (при отриманні, дефолт) | card (LiqPay онлайн)
var _payMethod = 'cod';
// Конкретний спосіб оплати залежно від доставки (для підказки й Telegram)
function payLabel(method, delType) {
    if (method === 'card') return 'Карткою онлайн (передоплата)';
    if (delType === 'np')  return 'Накладений платіж Нової Пошти';
    if (delType === 'ukr') return 'Накладений платіж Укрпошти';
    return 'Готівка при отриманні в магазині';   // самовивіз
}
function currentDelType() {
    const ab = document.getElementById('ord-address-block');
    return (ab && ab.dataset.delivery) || 'np';
}
function selectPay(type) {
    _payMethod = type;
    const cod = document.getElementById('pay-cod'), card = document.getElementById('pay-card'), hint = document.getElementById('pay-hint');
    const on = 'border:2px solid var(--green); background:var(--green); color:#fff;';
    const off = 'border:2px solid #ccc; background:#fff; color:#555;';
    if (cod) cod.style.cssText = 'flex:1 1 45%; min-width:120px; padding:10px; border-radius:8px; font-weight:bold; font-size:.86rem; cursor:pointer;' + (type === 'cod' ? on : off);
    if (card) card.style.cssText = 'flex:1 1 45%; min-width:120px; padding:10px; border-radius:8px; font-weight:bold; font-size:.86rem; cursor:pointer;' + (type === 'card' ? on : off);
    if (hint) hint.textContent = type === 'card'
        ? '💳 Передоплата карткою на сторінці LiqPay (Visa/Mastercard, Apple/Google Pay)'
        : '💵 ' + payLabel('cod', currentDelType());
    const btn = document.getElementById('ord-submit-btn');
    if (btn) btn.textContent = type === 'card' ? '💳 Перейти до оплати' : '✅ Оформити замовлення';
}

function selectDelivery(type) {
    const btns = { np: document.getElementById('delivery-np'), ukr: document.getElementById('delivery-ukr'), self: document.getElementById('delivery-self') };
    const addrBlock = document.getElementById('ord-address-block');
    const label  = document.getElementById('ord-addr-label');
    const cityEl = document.getElementById('ord-np-city');
    const addrEl = document.getElementById('ord-address');

    Object.keys(btns).forEach(function (k) {
        const b = btns[k]; if (!b) return;
        const on = (k === type);
        b.style.background  = on ? 'var(--green)' : '#fff';
        b.style.color       = on ? '#fff' : '#555';
        b.style.borderColor = on ? 'var(--green)' : '#ccc';
    });
    if (addrBlock) addrBlock.dataset.delivery = type;

    // Підказка оплати «При отриманні» залежить від доставки (накладений НП/Укрпошти/готівка)
    var payHint = document.getElementById('pay-hint');
    if (payHint && _payMethod === 'cod') payHint.textContent = '💵 ' + payLabel('cod', type);

    const svcToggle = document.getElementById('np-service-toggle');
    const doorFields = document.getElementById('np-door-fields');

    if (type === 'self') {
        if (addrBlock) addrBlock.style.display = 'none';
        if (svcToggle) svcToggle.style.display = 'none';
        return;
    }
    if (addrBlock) addrBlock.style.display = 'block';

    if (type === 'np') {
        if (svcToggle) svcToggle.style.display = 'flex';
        if (cityEl) cityEl.style.display = 'block';
        selectNpService(addrBlock ? (addrBlock.dataset.npservice || 'wh') : 'wh');
    } else { // ukr
        if (svcToggle) svcToggle.style.display = 'none';
        if (doorFields) doorFields.style.display = 'none';
        if (_ukrReady) {
            // Автодоповнення Укрпошти (місто → відділення/індекс) — переюзає datalist'и НП
            if (cityEl) { cityEl.style.display = 'block'; cityEl.setAttribute('list', 'np-city-list'); cityEl.placeholder = 'Місто (почніть вводити)'; }
            if (label) label.textContent = 'Місто та відділення Укрпошти *';
            if (addrEl) { addrEl.style.display = ''; addrEl.setAttribute('list', 'np-wh-list'); addrEl.placeholder = 'Відділення / індекс'; }
        } else {
            // Ручний ввід (нема токена Укрпошти)
            if (cityEl) cityEl.style.display = 'none';
            if (label) label.textContent = 'Індекс, місто, вулиця, будинок *';
            if (addrEl) { addrEl.style.display = ''; addrEl.removeAttribute('list'); addrEl.placeholder = 'напр. 45000, м. Луцьк, вул. Київська 12, кв. 3'; }
        }
    }
}

// НП: відділення / курʼєр (всередині Нової Пошти)
function selectNpService(mode) {
    const block = document.getElementById('ord-address-block');
    if (block) block.dataset.npservice = mode;
    const whBtn = document.getElementById('np-svc-wh'), doorBtn = document.getElementById('np-svc-door');
    const addrEl = document.getElementById('ord-address'), doorFields = document.getElementById('np-door-fields');
    const label = document.getElementById('ord-addr-label');
    function hl(b, on){ if (!b) return; b.style.background = on ? '#eef6ee' : '#fff'; b.style.color = on ? 'var(--green)' : '#555'; b.style.borderColor = on ? 'var(--green)' : '#ccc'; }
    hl(whBtn, mode === 'wh'); hl(doorBtn, mode === 'door');
    if (mode === 'door') {
        if (addrEl) addrEl.style.display = 'none';
        if (doorFields) doorFields.style.display = 'block';
        if (label) label.textContent = 'Місто та адреса (курʼєр) *';
    } else {
        if (addrEl) { addrEl.style.display = ''; addrEl.setAttribute('list', 'np-wh-list'); }
        if (doorFields) doorFields.style.display = 'none';
        if (label) label.textContent = 'Місто та відділення Нової Пошти *';
    }
}

async function submitOrder(platform = 'telegram') {
    const name    = document.getElementById('ord-name').value.trim();
    const phone   = document.getElementById('ord-phone').value.trim();
    const comment = document.getElementById('ord-comment').value.trim() || 'немає';

    const addrBlock  = document.getElementById('ord-address-block');
    const delType    = (addrBlock && addrBlock.dataset.delivery) || 'np';   // np | ukr | self
    const npService  = (addrBlock && addrBlock.dataset.npservice) || 'wh';  // wh | door (для np)
    const deliveryLabel = delType === 'np' ? 'Нова Пошта' : (delType === 'ukr' ? 'Укрпошта' : 'Самовивіз');

    // місто читаємо і для НП, і для Укрпошти з автодоповненням
    const npCity    = ((delType === 'np') || (delType === 'ukr' && _ukrReady)) ? (document.getElementById('ord-np-city')?.value.trim() || '') : '';
    const npCityRef = _npRefMap[npCity] || '';
    const whName    = document.getElementById('ord-address')?.value.trim() || '';   // np-wh: відділення; ukr: вся адреса
    const whRef     = _npWhRefMap[whName] || '';
    const street    = document.getElementById('ord-np-street')?.value.trim() || '';
    const house     = document.getElementById('ord-np-house')?.value.trim() || '';
    const flat      = document.getElementById('ord-np-flat')?.value.trim() || '';

    // Структуровані дані НП (для авто-ТТН) + людський рядок адреси
    let address, np = null;
    if (delType === 'self') {
        address = '🏪 Самовивіз';
    } else if (delType === 'ukr') {
        address = 'Укрпошта: ' + (npCity ? npCity + ', ' : '') + whName;
    } else if (npService === 'door') {
        address = 'Нова Пошта (курʼєр): ' + npCity + ', вул. ' + street + ', буд. ' + house + (flat ? ', кв. ' + flat : '');
        np = { service: 'door', city_ref: npCityRef, city_name: npCity, street: street, house: house, flat: flat };
    } else { // np-wh
        address = 'Нова Пошта: ' + npCity + ', ' + whName;
        np = { service: 'wh', city_ref: npCityRef, city_name: npCity, wh_ref: whRef, wh_name: whName };
    }

    const errEl = document.getElementById('ord-error');
    errEl.style.display = 'none';

    if (!name)  return showOrderError("Введіть ваше Прізвище та Ім'я");
    if (!phone) return showOrderError('Введіть номер телефону');

    // Валідація формату телефону (UA/RU/міжнародний)
    const phoneClean = phone.replace(/[\s\-\(\)]/g, '');
    if (!/^(\+?380|0)\d{9}$/.test(phoneClean)) {
        return showOrderError('Номер телефону у форматі +380XXXXXXXXX або 0XXXXXXXXX');
    }

    if (delType === 'ukr' && !whName) return showOrderError('Введіть адресу доставки (індекс, місто, вулиця, будинок)');
    if (delType === 'np' && !npCity) return showOrderError('Введіть місто доставки');
    if (delType === 'np' && npService === 'wh' && !whName) return showOrderError('Оберіть відділення Нової Пошти');
    if (delType === 'np' && npService === 'door' && (!street || !house)) return showOrderError('Введіть вулицю і будинок для курʼєра');

    // Turnstile (анти-спам): якщо ввімкнено — токен обовʼязковий
    var tsKey = window.SITE_CONFIG && window.SITE_CONFIG.turnstile_sitekey;
    var tsToken = '';
    if (tsKey) {
        try { tsToken = (window.turnstile && _tsWidget != null) ? window.turnstile.getResponse(_tsWidget) : ''; } catch (e) {}
        if (!tsToken) return showOrderError('Підтвердіть, що ви не робот (відмітьте перевірку нижче).');
    }

    let totalSum    = 0;
    let totalWeight = 0;
    let itemsText   = '';

    cart.forEach(item => {
        const price = parseFloat(item.p) || 0;
        const count = parseFloat(item.q) || 0;
        const sum   = price * count;
        totalSum   += sum;

        const isWeight = /\bкг\b/i.test(item.n) || /\(\s*кг\s*\)/i.test(item.n);
        const safeItemName = escapeTgHtml(item.n);
        if (isWeight) {
            totalWeight += count;
            itemsText += `• ${safeItemName} — ${count} кг (${sum.toFixed(2)} грн)\n`;
        } else {
            itemsText += `• ${safeItemName} — ${count} шт. (${sum.toFixed(2)} грн)\n`;
        }
    });

    let message = `🛒 <b>НОВЕ ЗАМОВЛЕННЯ</b>\n`;
    message += `──────────────────\n`;
    message += itemsText;
    message += `──────────────────\n`;
    if (totalWeight > 0) {
        message += `⚖️ Загальна вага: <b>${totalWeight.toFixed(2)} кг</b>\n`;
    }
    message += `💰 До оплати: <b>${totalSum.toFixed(2)} грн</b>\n`;
    message += `💳 Оплата: <b>${payLabel(_payMethod, delType)}</b>\n\n`;
    message += `👤 Клієнт: ${escapeTgHtml(name)}\n`;
    message += `📞 Телефон: ${escapeTgHtml(phone)}\n`;
    message += `📍 Адреса: ${escapeTgHtml(address)}\n`;
    message += `💬 Коментар: ${escapeTgHtml(comment)}`;

    if (platform === 'viber') {
        // Viber отримує звичайний текст: прибираємо теги <b> і повертаємо
        // екрановані для Telegram сутності назад у звичайні символи (&lt; → <).
        const plainMessage = message
            .replace(/<\/?b>/g, '')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&');
        const VIBER_PHONE  = (window.SITE_CONFIG && window.SITE_CONFIG.viberPhone) || "380634625206";
        const viberUrl     = `viber://chat?number=${VIBER_PHONE}&draft=${encodeURIComponent(plainMessage)}`;
        const viberWebUrl  = `https://viber.me/${VIBER_PHONE}`;

        const openViber = () => {
            window.location.href = viberUrl;
            setTimeout(() => {
                if (document.hasFocus()) window.open(viberWebUrl, '_blank');
            }, 1200);
            closeOrderModal();
            finalizeOrder();
        };

        const showViberCopyFallback = () => {
            // Clipboard недоступний — показуємо текст для ручного копіювання
            closeOrderModal();
            const fb = document.createElement('div');
            fb.id = 'viber-fallback';
            fb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px;box-sizing:border-box;';
            fb.innerHTML = `<div style="background:#fff;border-radius:16px;padding:24px;width:100%;max-width:440px;box-sizing:border-box;">
                <h3 style="margin:0 0 12px;font-size:1rem;color:#1a2e1a;">📋 Скопіюйте текст і надішліть у Viber</h3>
                <textarea readonly rows="10" style="width:100%;padding:10px;border:1.5px solid #ccc;border-radius:8px;font-size:0.8rem;resize:none;box-sizing:border-box;">${plainMessage}</textarea>
                <div style="display:flex;gap:10px;margin-top:12px;">
                    <button onclick="navigator.clipboard&&navigator.clipboard.writeText(this.parentElement.previousElementSibling.value).then(()=>{this.textContent='✓ Скопійовано!'})" 
                        style="flex:1;padding:11px;background:var(--green);color:#fff;border:none;border-radius:8px;font-weight:bold;cursor:pointer;">📋 Копіювати</button>
                    <button onclick="window.location.href='${viberUrl}'" 
                        style="flex:1;padding:11px;background:#7360f2;color:#fff;border:none;border-radius:8px;font-weight:bold;cursor:pointer;">📲 Відкрити Viber</button>
                    <button onclick="document.getElementById('viber-fallback').remove()" 
                        style="padding:11px 14px;background:#eee;border:none;border-radius:8px;cursor:pointer;">✕</button>
                </div>
            </div>`;
            document.body.appendChild(fb);
            finalizeOrder();
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(plainMessage)
                .then(() => {
                    openViber();
                    showOrderSuccess('📲 Текст скопійовано — вставте у Viber і надішліть!');
                })
                .catch(showViberCopyFallback);
        } else {
            showViberCopyFallback();
        }
        return;
    }

    // Telegram (через Cloudflare Worker — токен захищено на сервері)
    if (!isOrderWorkerConfigured()) {
        console.error('[CONFIG] ORDER_WORKER_URL не налаштовано (лишився плейсхолдер "ВАШ-ЛОГІН"). ' +
                      'Telegram-замовлення вимкнено — пропишіть реальний URL Cloudflare Worker (константа ORDER_WORKER_URL у app.js) і синхронно оновіть connect-src у _headers.');
        return showOrderError(
            'Онлайн-оформлення тимчасово недоступне. Зателефонуйте ' +
            ((window.SITE_CONFIG && window.SITE_CONFIG.phoneDisplay) || '063 462 52 06') +
            ' або напишіть нам у Viber/Telegram — ми приймемо ваше замовлення.'
        );
    }

    const btn = document.getElementById('ord-submit-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Надсилання...';

    const orderBody = {
        name, phone, address, delivery: deliveryLabel, np: np,
        comment: comment === 'немає' ? '' : comment,
        items: cart, total: totalSum,
        message: message, turnstileToken: tsToken
    };

    // ── Онлайн-оплата карткою (LiqPay): init на сервері → POST-форма на сторінку оплати ──
    if (_payMethod === 'card') {
        try {
            const ir = await fetch('/api/liqpay-init', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orderBody)
            });
            const id = await ir.json().catch(() => ({}));
            if (ir.ok && id.ok && id.data && id.signature) {
                finalizeOrder();   // кошик очищаємо — замовлення вже в D1 (очікує оплати)
                const f = document.createElement('form');
                f.method = 'POST'; f.action = id.action; f.style.display = 'none';
                f.innerHTML = '<input type="hidden" name="data"><input type="hidden" name="signature">';
                f.querySelector('[name=data]').value = id.data;
                f.querySelector('[name=signature]').value = id.signature;
                document.body.appendChild(f);
                f.submit();   // редірект на LiqPay
                return;
            }
            btn.disabled = false; btn.textContent = '💳 Перейти до оплати';
            return showOrderError(id.error || 'Не вдалося перейти до оплати. Спробуйте ще раз.');
        } catch (err) {
            btn.disabled = false; btn.textContent = '💳 Перейти до оплати';
            return showOrderError('Не вдалося перейти до оплати. Перевірте інтернет.');
        }
    }

    try {
        // Накладений платіж/готівка: /api/order перевіряє Turnstile, зберігає в D1
        // (серверна валідація суми) і пересилає в Telegram через воркер.
        const resp = await fetch('/api/order', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orderBody)
        });
        const data = await resp.json().catch(() => ({}));

        if (resp.ok && data.ok) {
            const orderNo = data.no || '';
            closeOrderModal();
            finalizeOrder();
            showOrderSuccess(orderNo
                ? ('✅ Замовлення №' + orderNo + ' прийнято! Ми звʼяжемося з вами найближчим часом.')
                : '✅ Замовлення прийнято! Ми звʼяжемося з вами найближчим часом.', REVIEW_NUDGE);
        } else {
            // 403 від Turnstile тощо — показуємо повідомлення сервера
            btn.disabled = false;
            btn.textContent = '✅ Оформити замовлення';
            showOrderError(data.error || 'Не вдалося надіслати замовлення. Спробуйте ще раз.');
        }
    } catch (err) {
        console.error('Order send error:', err);
        btn.disabled = false;
        btn.textContent = '✅ Оформити замовлення';
        showOrderError('Не вдалося надіслати замовлення. Перевірте інтернет та спробуйте ще раз.');
    }
}

// ============================================================
// ШВИДКЕ ЗАМОВЛЕННЯ «передзвоніть мені» — мінімум полів (імʼя + телефон).
// Для аудиторії, що боїться повної форми/НП-пошуку: продавець передзвонить.
// ============================================================
var _qsWidget = null;
function openQuickOrder() {
    if (!cart.length) return alert('Кошик порожній!');
    const cartModal = document.getElementById('cart-modal');
    if (cartModal) cartModal.style.display = 'none';
    const old = document.getElementById('quick-modal'); if (old) old.remove();

    const total = cart.reduce((s, i) => s + i.p * i.q, 0);
    const modal = document.createElement('div');
    modal.id = 'quick-modal';
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', 'Швидке замовлення');
    modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:9999; padding:16px; box-sizing:border-box;';
    modal.innerHTML = `
        <div style="background:#fff; border-radius:16px; padding:24px; width:100%; max-width:400px; box-shadow:0 8px 32px rgba(0,0,0,0.25); position:relative; box-sizing:border-box;">
            <button onclick="closeQuickOrder()" aria-label="Закрити" style="position:absolute; top:12px; right:14px; background:none; border:none; font-size:1.5rem; cursor:pointer; color:#888;">✕</button>
            <h2 style="margin:0 0 6px; font-size:1.2rem; color:#1a2e1a;">📞 Замовлення дзвінком</h2>
            <p style="margin:0 0 16px; font-size:.88rem; color:#666;">Залиште імʼя та номер — ми передзвонимо й оформимо замовлення за вас. Доставку й оплату узгодимо в розмові.</p>
            <div style="background:#f6faf4; border:1px solid #e0ead8; border-radius:10px; padding:8px 12px; margin-bottom:16px; font-size:.86rem;">
                🛒 Товарів: <b>${cart.length}</b> · Сума: <b>${total.toFixed(2)} грн</b>
            </div>
            <input id="qs-name" type="text" placeholder="Ваше імʼя *" style="width:100%; padding:11px 12px; border:1.5px solid #ccc; border-radius:8px; font-size:1rem; box-sizing:border-box; margin-bottom:10px;">
            <input id="qs-phone" type="tel" placeholder="Телефон * +380XXXXXXXXX" style="width:100%; padding:11px 12px; border:1.5px solid #ccc; border-radius:8px; font-size:1rem; box-sizing:border-box; margin-bottom:12px;">
            <div id="qs-error" style="display:none; background:#ffe5e5; color:#c0392b; border-radius:8px; padding:9px 12px; margin-bottom:12px; font-size:.88rem;"></div>
            <div id="qs-turnstile" style="margin-bottom:12px;"></div>
            <button id="qs-submit-btn" onclick="quickSubmit()" style="width:100%; padding:13px; background:#2d6a2d; color:#fff; border:none; border-radius:10px; font-size:1rem; font-weight:bold; cursor:pointer;">📞 Передзвоніть мені</button>
        </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) closeQuickOrder(); });
    lockModal(closeQuickOrder);
    document.getElementById('qs-name').focus();
    // Turnstile у quick-форму (той самий sitekey)
    var key = window.SITE_CONFIG && window.SITE_CONFIG.turnstile_sitekey;
    renderQuickTurnstile();
}
function closeQuickOrder() {
    const m = document.getElementById('quick-modal'); if (m) m.remove();
    unlockModal();
}
// Turnstile у quick-формі — САМА завантажує api.js (інакше віджет не зʼявиться,
// якщо повну форму ще не відкривали, і submit застрягне на «підтвердіть, що не робот»).
function renderQuickTurnstile(){
    var key = window.SITE_CONFIG && window.SITE_CONFIG.turnstile_sitekey;
    var box = document.getElementById('qs-turnstile');
    if (!key || !box) return;
    _qsWidget = null;
    function doRender(){ try { if (window.turnstile) _qsWidget = window.turnstile.render(box, { sitekey: key }); } catch (e) {} }
    if (window.turnstile) { doRender(); return; }
    if (!document.getElementById('cf-turnstile-js')) {
        var s = document.createElement('script');
        s.id = 'cf-turnstile-js';
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true; s.defer = true; s.onload = doRender;
        document.head.appendChild(s);
    } else {
        var t = setInterval(function () { if (window.turnstile) { clearInterval(t); doRender(); } }, 200);
        setTimeout(function () { clearInterval(t); }, 6000);
    }
}
function showQuickError(msg) {
    const el = document.getElementById('qs-error'); if (!el) return;
    el.textContent = msg; el.style.display = 'block';
}
async function quickSubmit() {
    const name  = (document.getElementById('qs-name').value || '').trim();
    const phone = (document.getElementById('qs-phone').value || '').trim();
    if (!name)  return showQuickError("Введіть ваше імʼя");
    const phoneClean = phone.replace(/[\s\-\(\)]/g, '');
    if (!/^(\+?380|0)\d{9}$/.test(phoneClean)) return showQuickError('Телефон у форматі +380XXXXXXXXX або 0XXXXXXXXX');

    var tsKey = window.SITE_CONFIG && window.SITE_CONFIG.turnstile_sitekey;
    var tsToken = '';
    if (tsKey) {
        try { tsToken = (window.turnstile && _qsWidget != null) ? window.turnstile.getResponse(_qsWidget) : ''; } catch (e) {}
        if (!tsToken) return showQuickError('Підтвердіть, що ви не робот.');
    }

    let totalSum = 0, itemsText = '';
    cart.forEach(item => {
        const sum = (parseFloat(item.p) || 0) * (parseFloat(item.q) || 0);
        totalSum += sum;
        const isW = /\(\s*кг\s*\)/i.test(item.n);
        itemsText += `• ${escapeTgHtml(item.n)} — ${parseFloat(item.q) || 0} ${isW ? 'кг' : 'шт.'} (${sum.toFixed(2)} грн)\n`;
    });
    let message = `⚡ <b>ШВИДКЕ ЗАМОВЛЕННЯ — ПЕРЕДЗВОНІТЬ</b>\n──────────────────\n${itemsText}──────────────────\n💰 Сума: <b>${totalSum.toFixed(2)} грн</b>\n\n👤 Клієнт: ${escapeTgHtml(name)}\n📞 Телефон: ${escapeTgHtml(phone)}\n📍 Доставка/оплата: узгодити в розмові`;

    const btn = document.getElementById('qs-submit-btn');
    btn.disabled = true; btn.textContent = '⏳ Надсилання...';
    try {
        const resp = await fetch('/api/order', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone, address: '⚡ Швидке замовлення — передзвоніть', delivery: 'Дзвінок менеджера', comment: '', items: cart, total: totalSum, message, turnstileToken: tsToken })
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data.ok) {
            closeQuickOrder(); finalizeOrder();
            showOrderSuccess(data.no ? ('✅ Заявку №' + data.no + ' прийнято! Ми передзвонимо найближчим часом.') : '✅ Заявку прийнято! Ми передзвонимо найближчим часом.', REVIEW_NUDGE);
        } else {
            btn.disabled = false; btn.textContent = '📞 Передзвоніть мені';
            showQuickError(data.error || 'Не вдалося надіслати. Спробуйте ще раз.');
        }
    } catch (err) {
        btn.disabled = false; btn.textContent = '📞 Передзвоніть мені';
        showQuickError('Не вдалося надіслати. Перевірте інтернет.');
    }
}

function showOrderError(msg) {
    const el = document.getElementById('ord-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
}

function showOrderSuccess(msg = '✅ Замовлення успішно надіслано!', note = '') {
    const toast = document.createElement('div');
    // note (напр. прохання про відгук) — тонким підписом; тоді показуємо довше
    toast.innerHTML = '<div>' + escapeHTML(msg) + '</div>'
        + (note ? '<div style="font-weight:400;font-size:.84rem;margin-top:7px;opacity:.95;line-height:1.45">' + escapeHTML(note) + '</div>' : '');
    toast.style.cssText = `
        position:fixed; bottom:30px; left:50%; transform:translateX(-50%);
        background:var(--green); color:#fff; padding:14px 24px; max-width:340px; text-align:center;
        border-radius:12px; font-size:1rem; font-weight:bold;
        box-shadow:0 4px 16px rgba(0,0,0,0.2); z-index:99999;
        animation: fadeInUp .3s ease;
    `;
    if (note) {                                   // довший + клік закриває
        toast.style.cursor = 'pointer';
        toast.title = 'Натисніть, щоб закрити';
        toast.onclick = () => toast.remove();
    }
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), note ? 9000 : 4000);
}
const REVIEW_NUDGE = '🙏 Коли отримаєте й спробуєте товар — будемо вдячні за відгук на його сторінці. Це допомагає іншим садівникам.';

function finalizeOrder() {
    cart = [];
    saveCart();
    updateCartUI();
    closeCart();
}

// ==========================================
// ЗАПУСК ПРИ ЗАВАНТАЖЕННІ СТОРІНКИ
// ==========================================
// ==========================================
// АВТОДОПОВНЕННЯ ПОШУКУ (випадаючі підказки під полем)
// Клієнтське: бере товари з памʼяті, ранжує наявним smartScore.
// ==========================================
var _ssActive = -1;            // активний пункт для клавіатури (-1 = жоден)
function fmtPriceShort(v){ return (typeof v === 'number') ? ((Number.isInteger(v) ? v : v.toFixed(2)) + ' грн') : ''; }

function computeSuggestions(qstr, limit){
    var qtokens = normS(qstr).split(' ').filter(Boolean);
    if (!qtokens.length) return [];
    var scored = [];
    for (var i = 0; i < products.length; i++){
        var p = products[i];
        if (currentCat !== 'Всі' && p.c !== currentCat) continue;   // у контексті поточної категорії (як грід)
        var sc = smartScore(p, qtokens);
        if (sc > 0) scored.push([sc, p]);
    }
    scored.sort(function(a, b){ return b[0] - a[0] || String(a[1].n).localeCompare(String(b[1].n), 'uk'); });
    return scored.slice(0, limit).map(function(x){ return x[1]; });
}

function openSuggest(){
    var dd = document.getElementById('search-suggest'), inp = document.getElementById('search');
    if (dd) dd.style.display = 'block';
    if (inp) inp.setAttribute('aria-expanded', 'true');
}
function closeSuggest(){
    var dd = document.getElementById('search-suggest'), inp = document.getElementById('search');
    if (dd){ dd.style.display = 'none'; dd.innerHTML = ''; }
    if (inp){ inp.setAttribute('aria-expanded', 'false'); inp.removeAttribute('aria-activedescendant'); }
    _ssActive = -1;
}

function renderSuggest(qstr){
    var dd = document.getElementById('search-suggest'); if (!dd) return;
    var q = (qstr || '').trim();
    if (q.length < 2){ closeSuggest(); return; }          // підказки від 2 символів
    var list = computeSuggestions(q, 7);
    var rows = list.map(function(p, idx){
        var thumb = p.img
            ? '<img src="' + escapeHTML(p.img) + '" alt="" loading="lazy">'
            : '<span class="ss-ic">' + (CAT_ICONS[p.c] || '🛒') + '</span>';
        var price = (p.priceFrom ? 'від ' : '') + fmtPriceShort(p.p);
        var href = p.slug ? ('/p/' + p.slug) : '#';
        return '<a class="ss-item" role="option" id="ss-opt-' + idx + '" href="' + escapeHTML(href) + '">'
            + '<span class="ss-thumb">' + thumb + '</span>'
            + '<span class="ss-name">' + escapeHTML(p.n) + '</span>'
            + '<span class="ss-price">' + price + '</span></a>';
    }).join('');
    var allBtn = '<button type="button" class="ss-all">🔍 Усі результати для «' + escapeHTML(q) + '»</button>';
    dd.innerHTML = (list.length ? rows : '<div class="ss-empty">Точних збігів немає</div>') + allBtn;
    openSuggest();
    _ssActive = -1;
}

function suggestShowAll(){
    var inp = document.getElementById('search');
    var q = inp ? inp.value : '';
    closeSuggest();
    quickSearch(q);   // ставить запит у поле, фільтрує грід, скролить до результатів
}

function ssMove(dir){
    var dd = document.getElementById('search-suggest');
    if (!dd || dd.style.display === 'none') return;
    var items = dd.querySelectorAll('.ss-item, .ss-all');
    if (!items.length) return;
    _ssActive += dir;
    if (_ssActive < 0) _ssActive = items.length - 1;
    if (_ssActive >= items.length) _ssActive = 0;
    var inp = document.getElementById('search');
    for (var i = 0; i < items.length; i++) items[i].classList.remove('ss-active');
    var el = items[_ssActive];
    if (el){ el.classList.add('ss-active'); if (el.id && inp) inp.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); }
}

function ssEnter(){
    var dd = document.getElementById('search-suggest');
    if (!dd || dd.style.display === 'none') return false;
    var items = dd.querySelectorAll('.ss-item, .ss-all');
    if (_ssActive >= 0 && items[_ssActive]){
        var el = items[_ssActive];
        if (el.classList.contains('ss-all')) suggestShowAll();
        else window.location.href = el.getAttribute('href');
        return true;
    }
    suggestShowAll();   // нічого не підсвічено — показати всі
    return true;
}

var _debouncedSuggest = debounce(function(){ var inp = document.getElementById('search'); if (inp) renderSuggest(inp.value); }, 130);

function initSearchSuggest(){
    var inp = document.getElementById('search');
    if (!inp || document.getElementById('search-suggest')) return;
    var wrap = document.createElement('div');
    wrap.className = 'search-suggest-wrap';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    var dd = document.createElement('div');
    dd.id = 'search-suggest';
    dd.setAttribute('role', 'listbox');
    wrap.appendChild(dd);

    inp.setAttribute('role', 'combobox');
    inp.setAttribute('aria-autocomplete', 'list');
    inp.setAttribute('aria-controls', 'search-suggest');
    inp.setAttribute('aria-expanded', 'false');
    inp.setAttribute('autocomplete', 'off');

    inp.addEventListener('input', _debouncedSuggest);
    inp.addEventListener('keydown', function(e){
        if (e.key === 'ArrowDown'){ e.preventDefault(); ssMove(1); }
        else if (e.key === 'ArrowUp'){ e.preventDefault(); ssMove(-1); }
        else if (e.key === 'Enter'){ if (ssEnter()) e.preventDefault(); }
        else if (e.key === 'Escape'){ closeSuggest(); }
    });
    inp.addEventListener('focus', function(){ if (inp.value.trim().length >= 2) renderSuggest(inp.value); });
    // mousedown (до blur): кнопка «усі результати» — не втрачати фокус поля
    dd.addEventListener('mousedown', function(e){
        var all = e.target.closest && e.target.closest('.ss-all');
        if (all){ e.preventDefault(); suggestShowAll(); }
    });
    inp.addEventListener('blur', function(){ setTimeout(closeSuggest, 160); });   // дати клікнути по пункту
    document.addEventListener('click', function(e){ if (!wrap.contains(e.target)) closeSuggest(); });
    injectSuggestStyles();
}

function injectSuggestStyles(){
    if (document.getElementById('ss-styles')) return;
    var st = document.createElement('style'); st.id = 'ss-styles';
    st.textContent =
    '.search-suggest-wrap{position:relative;}'
    + '#search-suggest{display:none;position:absolute;top:100%;left:0;right:0;z-index:60;background:#fff;border:1px solid #d8e0d8;border-top:0;border-radius:0 0 12px 12px;box-shadow:0 8px 24px rgba(0,0,0,.14);max-height:62vh;overflow:auto;}'
    + '#search-suggest .ss-item{display:flex;align-items:center;gap:10px;padding:8px 12px;text-decoration:none;color:#222;border-bottom:1px solid #f1f1f1;}'
    + '#search-suggest .ss-item:hover,#search-suggest .ss-item.ss-active{background:#eef6ee;}'
    + '#search-suggest .ss-thumb{flex:0 0 40px;width:40px;height:40px;border-radius:6px;background:#f4f4f4;display:flex;align-items:center;justify-content:center;overflow:hidden;}'
    + '#search-suggest .ss-thumb img{width:100%;height:100%;object-fit:cover;}'
    + '#search-suggest .ss-ic{font-size:1.25rem;}'
    + '#search-suggest .ss-name{flex:1;font-size:.9rem;line-height:1.25;}'
    + '#search-suggest .ss-price{flex:0 0 auto;font-weight:700;color:var(--green);font-size:.85rem;white-space:nowrap;}'
    + '#search-suggest .ss-all{display:block;width:100%;text-align:left;padding:10px 12px;background:#f7faf7;border:0;border-top:1px solid #e0e8e0;color:var(--green);font-weight:700;cursor:pointer;font:inherit;}'
    + '#search-suggest .ss-all:hover,#search-suggest .ss-all.ss-active{background:#e3efe3;}'
    + '#search-suggest .ss-empty{padding:10px 12px;color:#888;font-size:.88rem;}';
    document.head.appendChild(st);
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadCategories();     // категорії з D1 (нав/мапи/іконки/SEO); fallback — хардкод
    renderMainNav();            // навігація з активним станом
    currentCat = getInitialCategory();   // переуточнити (раптом db_name змінили в адмінці)
    applyCategoryPageSeo();     // SEO-заголовки сторінки категорії з D1 (перекриває inline)
    await Promise.all([loadProducts(), loadSearchConfig()]);  // товари + налаштування пошуку (синоніми/фолдинг/fuzzy) з D1
    await loadRecipes();
    updateCartUI();
    initPagination();           // виставити селектор розміру сторінки
    initSearchSuggest();        // автодоповнення пошуку (підказки під полем)
    applyFilters();
    // Пошук через URL ?q=... (для SearchAction Google + поширюваних посилань на результати)
    try {
        var _q = new URLSearchParams(location.search).get('q');
        var _se = document.getElementById('search');
        if (_q && _se) { _se.value = _q; currentPage = 1; applyFilters(); }
    } catch (e) {}
    // Стилі card-img тепер у style.css (блокуючий, до рендеру) → нуль CLS
    // Висота шапки → CSS-перемінна для sticky-пошуку під нею
    var navEl = document.querySelector('nav');
    if (navEl) document.documentElement.style.setProperty('--nav-h', navEl.offsetHeight + 'px');
    // Прихід із PDP: #cart → кошик; #order → одразу форма оформлення (−1 крок)
    if (location.hash === '#cart' && cart.length) openCart();
    else if (location.hash === '#order' && cart.length) openOrderModal();
    // Повернення зі сторінки оплати LiqPay (?paid=N) — подяка
    var paidNo = new URLSearchParams(location.search).get('paid');
    if (paidNo) {
        setTimeout(function(){ showOrderSuccess('✅ Дякуємо! Оплату замовлення №' + paidNo + ' отримано. Ми вже готуємо відправлення.', REVIEW_NUDGE); }, 600);
        try { history.replaceState(null, '', location.pathname); } catch(e){}
    }
});

// (Нескінченний скрол прибрано на користь постраничної пагінації — div#catalog-pager.)

// Стилі card-img перенесено у style.css (блокуючий) — резервують місце під
// фото ДО рендеру, тож картки не стрибають (CLS≈0). Інжект через JS прибрано.

// ==========================================
// МОДАЛЬНЕ ВІКНО ТОВАРУ (фото + анотація)
// ==========================================

function openProductModal(idx) {
    const p = renderedProducts[idx];
    if (!p) return;

    const old = document.getElementById('product-modal');
    if (old) old.remove();

    const isWeight = isWeightProduct(p);
    const _inCart = cartQtyFor(p);
    const inCartHtml = _inCart > 0
        ? '<div style="margin:-6px 0 14px;"><span id="modal-incart-badge" style="background:#ff7a00;color:#fff;border:2px solid #fff;border-radius:12px;padding:3px 10px;font-size:.8rem;font-weight:800;box-shadow:0 1px 4px rgba(0,0,0,.25);">🛒 ' + (Number.isInteger(_inCart) ? _inCart : Math.round(_inCart * 100) / 100) + ' у кошику</span></div>'
        : '<span id="modal-incart-badge" style="display:none;"></span>';

    const modal = document.createElement('div');
    modal.id = 'product-modal';
    modal.style.cssText = `
        position:fixed; inset:0; background:rgba(0,0,0,0.75);
        display:flex; align-items:center; justify-content:center;
        z-index:10000; padding:16px; box-sizing:border-box;
    `;

    const wd = weightDefaults(p);

    const imgHtml = p.img
        ? `<img src="${p.img}" alt="${escapeHTML(p.n)}"
               style="width:100%; max-height:min(280px, 38vh); object-fit:contain;
                      border-radius:10px; margin-bottom:16px; display:block;">`
        : '';

    const annotHtml = p.annot
        ? `<p style="font-size:.95rem; color:#444; line-height:1.6; margin:0 0 16px;">${escapeHTML(p.annot)}</p>`
        : '';

    const qtyHtml = isWeight ? `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
            <span style="font-size:.9rem; color:#555; white-space:nowrap;">Кількість:</span>
            <input id="modal-qty" type="number" value="${wd.val}" step="${wd.step}" min="${wd.min}"
                style="width:90px; padding:8px 10px; border:2px solid var(--green);
                       border-radius:8px; font-size:1rem; font-weight:bold; text-align:center;">
            <span style="font-size:.9rem; color:#555;">кг</span>
        </div>
    ` : `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
            <span style="font-size:.9rem; color:#555; white-space:nowrap;">Кількість:</span>
            <input id="modal-qty" type="number" value="1" step="1" min="1"
                style="width:90px; padding:8px 10px; border:2px solid var(--green);
                       border-radius:8px; font-size:1rem; font-weight:bold; text-align:center;">
            <span style="font-size:.9rem; color:#555;">шт.</span>
        </div>
    `;

    modal.innerHTML = `
        <div style="
            background:#fff; border-radius:16px; padding:24px;
            width:100%; max-width:480px; max-height:90vh;
            overflow-y:auto; box-shadow:0 8px 32px rgba(0,0,0,0.3);
            position:relative; box-sizing:border-box;
        ">
            <button onclick="closeProductModal()" style="
                position:absolute; top:12px; right:14px;
                background:none; border:none; font-size:1.6rem;
                cursor:pointer; color:#888; line-height:1;
            ">✕</button>

            <h3 style="margin:0 0 4px; padding-right:28px; font-size:1rem;
                       color:#1a2e1a; line-height:1.4;">${escapeHTML(p.n)}</h3>

            <div style="font-size:1.2rem; font-weight:bold; color:var(--green); margin-bottom:14px;">
                ${p.p.toFixed(2)} грн${isWeight ? ' / кг' : ''}
            </div>

            ${inCartHtml}
            ${imgHtml}
            ${annotHtml}
            ${qtyHtml}

            <div style="display:flex; gap:10px; position:sticky; bottom:0; background:#fff; padding-top:12px; box-shadow:0 -8px 10px -8px rgba(0,0,0,0.15);">
                ${p.inStock === false
                    ? `<button id="modal-add-btn" disabled style="flex:1; padding:13px; background:#ccc; color:#888; border:none; border-radius:10px; font-size:1rem; font-weight:bold; cursor:not-allowed;">❌ Немає в наявності</button>`
                    : `<button id="modal-add-btn" onclick="addToCartFromModal(${idx})" style="flex:1; padding:13px; background:var(--green); color:#fff; border:none; border-radius:10px; font-size:1rem; font-weight:bold; cursor:pointer;">🛒 Додати в кошик</button>`}

                <button onclick="closeProductModal()" style="
                    padding:13px 18px; background:#f0f0f0; color:#555;
                    border:none; border-radius:10px; font-size:1rem;
                    font-weight:bold; cursor:pointer;
                ">Закрити</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) closeProductModal(); });
    lockModal(closeProductModal);
}

function addToCartFromModal(idx) {
    const p = renderedProducts[idx];
    if (!p || p.inStock === false) return;

    const qtyInput = document.getElementById('modal-qty');
    const quantity = parseFloat(qtyInput.value);

    if (isNaN(quantity) || quantity <= 0) {
        alert('Вкажіть коректну кількість');
        return;
    }

    const item = cart.find(i => i.n === p.n);
    if (item) {
        item.q = parseFloat((item.q + quantity).toFixed(3));
    } else {
        cart.push({ n: p.n, p: p.p, q: quantity, pid: p.pid != null ? p.pid : null });
    }
    saveCart();

    // оновити бейдж "у кошику" в модалці
    const _b = document.getElementById('modal-incart-badge');
    if (_b) {
        const q = cartQtyFor(p);
        _b.textContent = '🛒 ' + (Number.isInteger(q) ? q : Math.round(q * 100) / 100) + ' у кошику';
        _b.style.display = q > 0 ? '' : 'none';
        _b.style.cssText = 'background:#ff7a00;color:#fff;border:2px solid #fff;border-radius:12px;padding:3px 10px;font-size:.8rem;font-weight:800;box-shadow:0 1px 4px rgba(0,0,0,.25);';
    }

    const btn = document.getElementById('modal-add-btn');
    if (btn) {
        btn.textContent = '✓ Додано!';
        btn.style.background = '#1a2e1a';
        setTimeout(() => {
            btn.textContent = '🛒 Додати в кошик';
            btn.style.background = 'var(--green)';
        }, 1000);
    }
}

function closeProductModal() {
    const m = document.getElementById('product-modal');
    if (m) m.remove();
    unlockModal();
}
