// Сводка матрицы распознавания (после npx playwright test tests/e2e/drawing-set.spec.js): node tests/matrix-report.js
const fs = require('fs'), path = require('path');
const dir = path.join(process.cwd(), 'test-results', 'drawing-matrix');
const rows = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).sort((a, b) => (a.set + a.file).localeCompare(b.set + b.file));
console.log('| Чертёж | Файл | Отверстия | Лишние | «По размеру» | Макс. ошибка «измерено», мм | Габарит | Размеров в масштабе | Конфликты | Неверных «по размеру» |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.set} | ${r.file} | ${r.holes} | ${r.extra} | ${r.byDim} | ${r.measMax ?? '—'} | ${r.outline ? 'да' : 'нет'} | ${r.scaleN} | ${r.conflicts} | ${r.wrongDim.length} |`);
