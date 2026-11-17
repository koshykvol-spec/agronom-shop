// Розбір robots.txt за правилами Google: найдовше співпадіння виграє, при рівності Allow сильніший за Disallow;
// '*' — будь-яка послідовність, '$' — кінець шляху.

export function parseRobots(text) {
  const groups = [];
  let cur = null, lastWasAgent = false;
  const sitemaps = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      if (cur) cur.rules.push({ type: key, pattern: val });
    } else if (key === 'sitemap') {
      sitemaps.push(val);
    } else lastWasAgent = false;
  }
  return { groups, sitemaps };
}

function patternToRegex(p) {
  const anchored = p.endsWith('$');
  const body = (anchored ? p.slice(0, -1) : p).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

function groupFor(robots, ua) {
  const u = ua.toLowerCase();
  let best = null, bestLen = -1;
  for (const g of robots.groups) {
    for (const a of g.agents) {
      if (a === '*' ? bestLen < 0 : u.includes(a)) {
        const len = a === '*' ? 0 : a.length;
        if (len > bestLen) { best = g; bestLen = len; }
      }
    }
  }
  return best;
}

/** path — шлях із query (напр. '/category?cat=soil'). */
export function isAllowed(robots, path, ua = '*') {
  const g = groupFor(robots, ua);
  if (!g) return true;
  let verdict = true, bestLen = -1;
  for (const r of g.rules) {
    if (r.pattern === '') continue;           // порожній Disallow = нічого не забороняє
    if (patternToRegex(r.pattern).test(path)) {
      const len = r.pattern.replace(/\*/g, '').length;
      if (len > bestLen || (len === bestLen && r.type === 'allow')) {
        bestLen = len; verdict = r.type === 'allow';
      }
    }
  }
  return verdict;
}
