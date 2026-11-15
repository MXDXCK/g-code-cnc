// Заготовка эталона для своего чертежа: node tests/private-add.js <файл чертежа>
// Создаёт рядом <имя>.expected.json с пустыми полями — их заполняет человек по чертежу. Файл чертежа не копируется и не публикуется.
const fs = require('fs'), path = require('path');
const f = process.argv[2];
if (!f || !fs.existsSync(f)) { console.error('Укажите файл чертежа: node tests/private-add.js путь/к/чертежу.jpg'); process.exit(1); }
const out = f.replace(/\.[^.\\/]+$/, '') + '.expected.json';
if (fs.existsSync(out)) { console.error('Эталон уже есть: ' + out); process.exit(1); }
fs.writeFileSync(out, JSON.stringify({
  schema: 'fresa.drawing-expected/1',
  name: path.basename(f),
  note: 'Заполните по чертежу. Координаты отверстий — от левого нижнего угла детали, мм. Неизвестное оставьте null. Удалите лишние строки отверстий.',
  units: 'mm', origin: 'левый нижний угол детали',
  plate: { w: null, h: null },
  holes: [{ x: null, y: null, d: null }],
  unknownX: [],
  conflict: false,
}, null, 2) + '\n');
console.log('Создан эталон: ' + out + '\nЗаполните размеры и запустите: npm run test:private');
