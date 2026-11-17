#!/usr/bin/env node
// Знімок SEO-«відбитків» сторінок та порівняння з еталоном (baseline.json) — для відстеження змін до/після деплою.
//   SEO_BASE_URL=https://agronom.pp.ua node tests/seo/snapshot.mjs --update   → записати еталон (запускати на стабільній версії)
//   SEO_BASE_URL=https://agronom.pp.ua node tests/seo/snapshot.mjs            → порівняти; код виходу 1, якщо щось змінилось
//   SEO_BASE_URL=local node tests/seo/snapshot.mjs                            → те саме на локальному імітаторі
// Опції: --sample=N (товарів у вибірці, 12 за замовчуванням), --file=шлях/до/baseline.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint } from './helpers/html.mjs';
import { startLocalServer } from './helpers/local-server.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const here = path.dirname(fileURLToPath(import.meta.url));
const file = args.file || path.join(here, 'baseline.json');
const SAMPLE = Number(args.sample || 12);
const want = process.env.SEO_BASE_URL;
if (!want) { console.error('Задайте SEO_BASE_URL (https://agronom.pp.ua або local)'); process.exit(2); }

const server = want === 'local' ? await startLocalServer() : null;
const BASE = (server ? server.url : want).replace(/\/$/, '');
const toPath = u => u.replace(/^https?:\/\/[^/]+/, '');
const locs = xml => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => m[1].replace(/&amp;/g, '&'));
const pick = (arr, n) => (arr.length <= n ? arr : Array.from({ length: n }, (_, i) => arr[Math.floor((i * (arr.length - 1)) / Math.max(n - 1, 1))]));
const fetchPage = async p => {
  const res = await fetch(BASE + p, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } });
  const body = await res.text();
  return { status: res.status, location: res.headers.get('location'), xRobots: res.headers.get('x-robots-tag'), ...(res.status === 200 && /html/.test(res.headers.get('content-type') || '') ? fingerprint(body) : {}) };
};

const main = locs(await (await fetch(BASE + '/sitemap-main.xml')).text());
const products = locs(await (await fetch(BASE + '/sitemap-products.xml')).text());
const urls = ['/', '/index.html', ...main.map(toPath), ...pick(products.map(toPath), SAMPLE), '/p/__nonexistent__'];
const unique = [...new Set(urls)];

const current = { generatedAt: new Date().toISOString(), counts: { main: main.length, products: products.length }, pages: {} };
for (const p of unique) current.pages[p] = await fetchPage(p);
if (server) await server.close();

if (args.update) {
  fs.writeFileSync(file, JSON.stringify(current, null, 2) + '\n');
  console.log(`Еталон записано: ${file} (${unique.length} URL; у sitemap товарів: ${products.length})`);
  process.exit(0);
}
if (!fs.existsSync(file)) { console.error(`Немає еталона ${file}. Спочатку запустіть з --update.`); process.exit(2); }

const base = JSON.parse(fs.readFileSync(file, 'utf8'));
const diffs = [];
for (const [p, now] of Object.entries(current.pages)) {
  const was = base.pages[p];
  if (!was) { diffs.push(`＋ новий URL у вибірці: ${p}`); continue; }
  for (const k of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (JSON.stringify(was[k]) !== JSON.stringify(now[k])) diffs.push(`≠ ${p} · ${k}: ${JSON.stringify(was[k])} → ${JSON.stringify(now[k])}`);
  }
}
for (const p of Object.keys(base.pages)) if (!(p in current.pages)) diffs.push(`－ URL зник із вибірки: ${p} (змінилась вибірка товарів у sitemap?)`);
const dropped = base.counts.products - current.counts.products;
if (current.counts.products < base.counts.products * 0.95) diffs.push(`▼ sitemap-products скоротився: ${base.counts.products} → ${current.counts.products} (−${dropped})`);

if (!diffs.length) { console.log(`SEO без змін відносно еталона (${unique.length} URL).`); process.exit(0); }
console.log(`Знайдено змін: ${diffs.length}\n` + diffs.join('\n'));
process.exit(1);
