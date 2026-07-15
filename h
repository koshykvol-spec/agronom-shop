warning: in the working copy of 'functions/admin/search.js', LF will be replaced by CRLF the next time Git touches it
[1mdiff --git a/functions/admin/search.js b/functions/admin/search.js[m
[1mindex f07d98a..e983f91 100644[m
[1m--- a/functions/admin/search.js[m
[1m+++ b/functions/admin/search.js[m
[36m@@ -23,11 +23,35 @@[m [mexport async function onRequestGet(context){[m
   const cfg = {};[m
   for (const r of (await db.prepare(`SELECT key,value FROM search_config`).all()).results || []) cfg[r.key] = r.value;[m
 [m
[32m+[m[32m  // Звіт по логах пошуку (останні 30 днів)[m
[32m+[m[32m  let topQueries = [], topZero = [];[m
[32m+[m[32m  try {[m
[32m+[m[32m    const since = Math.floor(Date.now() / 1000) - 30 * 86400;[m
[32m+[m[32m    topQueries = (await db.prepare([m
[32m+[m[32m      `SELECT q, COUNT(*) n, AVG(cnt) avg_cnt FROM search_log WHERE ts > ? GROUP BY q ORDER BY n DESC LIMIT 30`[m
[32m+[m[32m    ).bind(since).all()).results || [];[m
[32m+[m[32m    topZero = (await db.prepare([m
[32m+[m[32m      `SELECT q, COUNT(*) n FROM search_log WHERE ts > ? AND cnt = 0 GROUP BY q ORDER BY n DESC LIMIT 30`[m
[32m+[m[32m    ).bind(since).all()).results || [];[m
[32m+[m[32m  } catch (e) { /* таблиці ще може не бути до міграції */ }[m
[32m+[m
[32m+[m[32m  const topQueriesRows = topQueries.map(r => `<tr><td>${esc(r.q)}</td><td>${r.n}</td><td>${Math.round(r.avg_cnt)}</td></tr>`).join('');[m
[32m+[m[32m  const topZeroRows = topZero.map(r => `<tr><td>${esc(r.q)}</td><td>${r.n}</td><td><a class="btn s" style="padding:3px 8px;font-size:.8rem" href="/admin/search?prefill=${encodeURIComponent(r.q)}#add-syn">+ синонім</a></td></tr>`).join('');[m
[32m+[m
   const rows = syns.map(s => `<tr><td>${esc(s.term)}</td><td>→ ${esc(s.target)}</td><td><a href="/admin/search?delsyn=${s.id}" onclick="return confirm('Видалити?')" style="color:#c0392b">✕</a></td></tr>`).join('');[m
 [m
[32m+[m[32m  const prefill = esc(url.searchParams.get('prefill') || '');[m
[32m+[m
   const body = `<h2>🔎 Налаштування розумного пошуку</h2>[m
     <div class="muted">Зміни застосуються для нових відвідувачів одразу, для кешу — до 5 хв. Нормалізація/синоніми/fuzzy працюють на боці браузера (дані звідси).</div>[m
 [m
[32m+[m[32m    <h3>📊 Топ пошукових запитів (30 днів)</h3>[m
[32m+[m[32m    <table><tr><th>Запит</th><th>Кількість</th><th>Сер. результатів</th></tr>${topQueriesRows || '<tr><td colspan=3 class="muted">Поки немає даних</td></tr>'}</table>[m
[32m+[m
[32m+[m[32m    <h3>🚫 Запити без результатів (30 днів)</h3>[m
[32m+[m[32m    <div class="muted">Найкращі кандидати на нові синоніми — люди шукали, нічого не знайшли.</div>[m
[32m+[m[32m    <table><tr><th>Запит</th><th>Разів</th><th></th></tr>${topZeroRows || '<tr><td colspan=3 class="muted">Поки немає даних</td></tr>'}</table>[m
[32m+[m
     <h3>Налаштування</h3>[m
     <form class="box" method="POST" action="/admin/search">[m
       <input type="hidden" name="action" value="save-cfg">[m
[36m@@ -40,10 +64,10 @@[m [mexport async function onRequestGet(context){[m
       <button class="btn" type="submit">💾 Зберегти налаштування</button>[m
     </form>[m
 [m
[31m-    <h3>Синоніми (${syns.length}) — ввід → на що шукати</h3>[m
[32m+[m[32m    <h3 id="add-syn">Синоніми (${syns.length}) — ввід → на що шукати</h3>[m
     <form class="box" method="POST" action="/admin/search" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">[m
       <input type="hidden" name="action" value="add-syn">[m
[31m-      <input name="term" placeholder="напр. помидор" required>[m
[32m+[m[32m      <input name="term" placeholder="напр. помидор" value="${prefill}" required>[m
       <span>→</span>[m
       <input name="target" placeholder="напр. томат" required>[m
       <button class="btn" type="submit">＋ Додати</button>[m
