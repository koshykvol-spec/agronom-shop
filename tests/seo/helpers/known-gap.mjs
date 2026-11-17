// «Відома прогалина»: перевірка описує бажану поведінку, яка поки не реалізована.
// Не валить набір і не засмічує вивід стеком; у звіті помічається як TODO з причиною.
// Коли прогалину закрито — тест стає зеленим і виводить підказку прибрати knownGap.
import { it } from 'node:test';

export function knownGap(name, reason, fn) {
  it(name, async t => {
    try {
      await fn(t);
    } catch (e) {
      t.todo(`${reason} · ${String(e.message).split('\n')[0].slice(0, 140)}`);
      return;
    }
    t.diagnostic('✔ прогалину закрито — замініть knownGap(...) на звичайний it(...)');
  });
}
