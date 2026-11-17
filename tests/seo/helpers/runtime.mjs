// Запуск справжніх Cloudflare Pages Functions у Node без залежностей:
//  - вихідні файли functions/**/*.js копіюються у тимчасову теку як .mjs (відносні імпорти переписуються),
//    тому працює на будь-якій Node ≥ 18 незалежно від "type" у package.json;
//  - caches.default підміняється Map-кешем;
//  - env.DB — підроблена D1 (prepare().bind().first()/all()) з маршрутизацією за текстом SQL.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const ORIGIN = 'https://agronom.pp.ua';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agronom-seo-fn-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

// Функції пишуть службові JSON-логи ({"t":"miss",…}) через console.log — у виводі тестів це шум.
const _log = console.log;
console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('{"t":')) return; _log(...a); };

const loaded = new Map();

function transpile(relFile) {
  const out = path.join(TMP, relFile.replace(/\.js$/, '.mjs'));
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const src = fs.readFileSync(path.join(ROOT, relFile), 'utf8');
  const rewritten = src.replace(/(from\s+['"])(\.{1,2}\/[^'"]+?)\.js(['"])/g, (_, a, spec, c) => {
    const dep = path.posix.normalize(path.posix.join(path.posix.dirname(relFile.replace(/\\/g, '/')), spec + '.js'));
    transpile(dep);
    return `${a}${spec}.mjs${c}`;
  });
  fs.writeFileSync(out, rewritten);
  return out;
}

/** loadFn('functions/p/[slug].js') → namespace модуля. */
export async function loadFn(relFile) {
  if (!loaded.has(relFile)) loaded.set(relFile, import(pathToFileURL(transpile(relFile)).href));
  return loaded.get(relFile);
}

/** Свіжий Map-кеш на кожен тест (module-level стан функцій від цього не залежить). */
export function installCaches() {
  const store = new Map();
  const keyOf = r => (typeof r === 'string' ? r : r.url);
  globalThis.caches = {
    default: {
      async match(req) { const v = store.get(keyOf(req)); return v ? v.clone() : undefined; },
      async put(req, res) { store.set(keyOf(req), res.clone()); },
      async delete(req) { return store.delete(keyOf(req)); },
    },
  };
  return store;
}

const norm = sql => String(sql).replace(/\s+/g, ' ').trim();

/**
 * Підроблена D1. route(sql, binds, mode) повертає масив рядків (або undefined → порожньо).
 * Якщо route кидає виняток — він пробрасується як помилка D1.
 */
export function makeDB(route) {
  const run = (sql, binds, mode) => {
    const rows = route(norm(sql), binds, mode);
    return rows === undefined ? [] : (Array.isArray(rows) ? rows : [rows]);
  };
  const stmt = (sql, binds = []) => ({
    bind: (...b) => stmt(sql, b),
    first: async () => run(sql, binds, 'first')[0] ?? null,
    all: async () => ({ results: run(sql, binds, 'all'), success: true }),
    run: async () => ({ results: run(sql, binds, 'run'), success: true }),
  });
  return { prepare: sql => stmt(sql) };
}

/** D1 для сторінки товару. Невідомі запити (схожі, аналоги…) повертають порожньо — як і має бути без даних. */
export function productDB({ products = [], settings = [], images = {}, reviews = {}, categories = [], fail = false } = {}) {
  return makeDB((sql, binds) => {
    if (fail) throw new Error('D1_ERROR: simulated outage');
    if (sql.includes('FROM products p JOIN product_content c ON c.pid=p.pid WHERE c.slug=?')) {
      return products.filter(p => p.slug === binds[0] && p.visible !== 0);
    }
    if (sql.includes('FROM site_settings')) return settings;
    if (sql.includes('FROM product_images WHERE pid=?')) return (images[binds[0]] || []).map(path => ({ path }));
    if (sql.includes('FROM categories WHERE db_name=?')) return categories.filter(c => c.db_name === binds[0]).slice(0, 1);
    if (sql.includes('FROM reviews WHERE pid=?')) return reviews[binds[0]] || [];
    return [];
  });
}

/** Контекст виклику Pages Function. */
export function ctx(url, { env = {}, params = {}, method = 'GET', headers = {}, next } = {}) {
  const pending = [];
  const context = {
    request: new Request(url, { method, headers }),
    env,
    params,
    waitUntil: p => { pending.push(Promise.resolve(p).catch(() => {})); },
    next: next || (async () => new Response('next()', { status: 200, headers: { 'content-type': 'text/plain' } })),
    data: {},
  };
  context.settled = () => Promise.all(pending);
  return context;
}

export const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
export const exists = rel => fs.existsSync(path.join(ROOT, rel));
