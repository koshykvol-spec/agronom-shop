// /admin/diagnose-stats — статистика Порадника по фото (AI-діагностика)

export async function onRequestGet(context) {
  const db = context.env.DB;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Загальні цифри
  const totals = await db.prepare(`
    SELECT COUNT(*) total,
           SUM(CASE WHEN type='disease' THEN 1 ELSE 0 END) diseases,
           SUM(CASE WHEN type='pest' THEN 1 ELSE 0 END) pests,
           SUM(CASE WHEN type='weed' THEN 1 ELSE 0 END) weeds,
           SUM(CASE WHEN type='unknown' THEN 1 ELSE 0 END) unknown,
           SUM(CASE WHEN products_found > 0 THEN 1 ELSE 0 END) with_products,
           SUM(CASE WHEN created_at >= datetime('now','-1 day') THEN 1 ELSE 0 END) last24h,
           SUM(CASE WHEN created_at >= datetime('now','-7 day') THEN 1 ELSE 0 END) last7d,
           SUM(CASE WHEN created_at >= datetime('now','-30 day') THEN 1 ELSE 0 END) last30d
    FROM diagnose_log
  `).first() || {};

  // Топ-10 найчастіших діагнозів
  const topNames = (await db.prepare(`
    SELECT name, type, COUNT(*) cnt
      FROM diagnose_log
     WHERE name != '' AND created_at >= datetime('now','-30 day')
     GROUP BY name, type
     ORDER BY cnt DESC LIMIT 15
  `).all()).results || [];

  // Останні 20 запитів
  const recent = (await db.prepare(`
    SELECT type, name, confidence, products_found, created_at
      FROM diagnose_log
     ORDER BY id DESC LIMIT 20
  `).all()).results || [];

  // Графік по днях (останні 14 днів)
  const byDay = (await db.prepare(`
    SELECT date(created_at) d, COUNT(*) cnt
      FROM diagnose_log
     WHERE created_at >= datetime('now','-14 day')
     GROUP BY date(created_at)
     ORDER BY d
  `).all()).results || [];

  const typeIcon = t => t === 'disease' ? '🍂' : t === 'pest' ? '🐛' : t === 'weed' ? '🌿' : '❓';
  const typeLabel = t => t === 'disease' ? 'Хвороба' : t === 'pest' ? 'Шкідник' : t === 'weed' ? 'Бур\u2019ян' : 'Не визначено';
  const confColor = c => c === 'high' ? '#2d6a2d' : c === 'medium' ? '#b8860b' : '#888';

  const maxDayCnt = Math.max(1, ...byDay.map(r => r.cnt));
  const dayChart = byDay.map(r => {
    const h = Math.round((r.cnt / maxDayCnt) * 60);
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex:1">
      <div style="font-size:.7rem;color:#666">${r.cnt}</div>
      <div style="width:100%;max-width:24px;height:${h}px;background:#2d6a2d;border-radius:3px 3px 0 0;"></div>
      <div style="font-size:.65rem;color:#999;writing-mode:vertical-rl;">${esc(r.d.slice(5))}</div>
    </div>`;
  }).join('');

  return new Response(`<!DOCTYPE html><html lang=uk><head><meta charset=UTF-8>
<meta name=viewport content="width=device-width, initial-scale=1.0"><meta name=robots content=noindex>
<title>Статистика Порадника по фото</title><style>
body{font-family:system-ui;max-width:920px;margin:1.5rem auto;padding:1rem;color:#222;background:#f7f8f7}
a{color:#2d6a2d} h2{color:#2d6a2d}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:14px 0}
.card{background:#fff;border:1px solid #e0e8e0;border-radius:10px;padding:14px;text-align:center}
.card b{display:block;font-size:1.6rem;color:#2d6a2d}
.card span{font-size:.8rem;color:#777}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;margin-top:10px}
th,td{padding:8px 10px;text-align:left;border-bottom:1px solid #eee;font-size:.88rem}
th{background:#f0f5f0;color:#555;font-weight:700}
.muted{color:#888;font-size:.85rem}
.chart{display:flex;align-items:flex-end;gap:4px;height:100px;background:#fff;border:1px solid #e0e8e0;border-radius:10px;padding:14px;margin:14px 0}
</style><link rel="stylesheet" href="/admin-ui.css"></head><body>
<div><a href="/admin">← до адмінки</a></div>
<h2>🔬 Статистика Порадника по фото</h2>
<p class="muted">Дані про використання AI-діагностики хвороб/шкідників/бур'янів на сторінці /protection_schemes.html</p>

<div class="cards">
  <div class="card"><b>${totals.total||0}</b><span>Всього запитів</span></div>
  <div class="card"><b>${totals.last24h||0}</b><span>За 24 год</span></div>
  <div class="card"><b>${totals.last7d||0}</b><span>За 7 днів</span></div>
  <div class="card"><b>${totals.last30d||0}</b><span>За 30 днів</span></div>
</div>

<div class="cards">
  <div class="card"><b>🍂 ${totals.diseases||0}</b><span>Хвороби</span></div>
  <div class="card"><b>🐛 ${totals.pests||0}</b><span>Шкідники</span></div>
  <div class="card"><b>🌿 ${totals.weeds||0}</b><span>Бур'яни</span></div>
  <div class="card"><b>❓ ${totals.unknown||0}</b><span>Не визначено</span></div>
</div>

<p class="muted">📦 З підібраними препаратами: <b>${totals.with_products||0}</b> із ${totals.total||0}
  (${totals.total ? Math.round((totals.with_products||0)/totals.total*100) : 0}%)</p>

<h3 style="margin-top:24px">📈 Активність за 14 днів</h3>
${byDay.length ? `<div class="chart">${dayChart}</div>` : '<p class="muted">Поки немає даних</p>'}

<h3 style="margin-top:24px">🔝 Топ-15 запитів за 30 днів</h3>
${topNames.length ? `<table><tr><th>Тип</th><th>Назва</th><th>Кількість</th></tr>
  ${topNames.map(r => `<tr><td>${typeIcon(r.type)} ${typeLabel(r.type)}</td><td>${esc(r.name)}</td><td><b>${r.cnt}</b></td></tr>`).join('')}
  </table>` : '<p class="muted">Поки немає даних</p>'}

<h3 style="margin-top:24px">🕐 Останні 20 запитів</h3>
${recent.length ? `<table><tr><th>Час</th><th>Тип</th><th>Назва</th><th>Впевненість</th><th>Препаратів</th></tr>
  ${recent.map(r => `<tr>
    <td class="muted">${esc(r.created_at)}</td>
    <td>${typeIcon(r.type)} ${typeLabel(r.type)}</td>
    <td>${esc(r.name)}</td>
    <td style="color:${confColor(r.confidence)}">${esc(r.confidence)}</td>
    <td>${r.products_found}</td>
  </tr>`).join('')}
  </table>` : '<p class="muted">Поки немає запитів</p>'}

</body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
