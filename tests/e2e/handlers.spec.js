// Все функции, которые вызываются из разметки (onclick="…" и т.п.), должны быть доступны в window:
// константы модуля в обработчиках не видны — частая причина «кнопка не работает».
const { test, expect } = require('playwright/test');
const fs = require('fs');
const path = require('path');
const { openApp, ROOT } = require('../helpers');

const SKIP = new Set(['if', 'return', 'this', 'event', 'Math', 'Number', 'String', 'JSON', 'parseFloat', 'parseInt', 'confirm', 'alert',
  'document', 'window', 'setTimeout', 'clearTimeout', 'encodeURIComponent', 'Array', 'Object', 'Boolean', 'isNaN', 'location', 'navigator',
  'requestAnimationFrame', 'localStorage', 'Date', 'console', 'new', 'typeof', 'void', 'function', 'true', 'false', 'null', 'undefined']);

function handlerNames() {
  const s = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const names = new Set();
  const re = /\son(?:click|change|input|submit|keydown|keyup|pointerdown|load|error)="([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) {
    const code = m[1].replace(/\$\{[^}]*\}/g, '0').replace(/'[^']*'/g, "''");
    for (const c of code.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) if (!SKIP.has(c[2])) names.add(c[2]);
  }
  return [...names];
}

test('обработчики из разметки доступны в window', async ({ page }) => {
  const names = handlerNames();
  expect(names.length).toBeGreaterThan(50);
  const errors = await openApp(page);
  const missing = await page.evaluate(n => n.filter(x => !(x in window)), names);
  expect(missing).toEqual([]);
  expect(errors).toEqual([]);
});
