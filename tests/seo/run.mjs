#!/usr/bin/env node
// Запуск усього SEO-набору однією командою (працює на Windows/Linux, Node ≥ 18, без залежностей):
//   node tests/seo/run.mjs                                   — офлайн-тести + «живі» перевірки на локальному імітаторі Pages
//   SEO_BASE_URL=https://agronom.pp.ua node tests/seo/run.mjs  — те саме, але «живі» перевірки проти продакшену
//   PowerShell: $env:SEO_BASE_URL="https://agronom.pp.ua"; node tests/seo/run.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.mjs')).sort().map(f => path.join(dir, f));
const env = { ...process.env, SEO_BASE_URL: process.env.SEO_BASE_URL || 'local' };
const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], { stdio: 'inherit', env });
process.exit(r.status ?? 1);
