// Свои (настоящие) чертежи владельца: tests/fixtures/private/ (исключено из git) или папка FRESA_PRIVATE_DIR.
// Без файлов тест пропускается (в CI их нет). Отчёт — test-results/private/report.md, тоже не публикуется.
// С эталоном (<имя>.expected.json или expected.json в папке) действует жёсткое правило матрицы: ни одного неверного значения «по размеру».
const { test, expect } = require('playwright/test');
const fs = require('fs'), path = require('path');
const { openApp, FIX } = require('../helpers');
const { kindOf, run, analyse } = require('../drawing-check');

const DIR = process.env.FRESA_PRIVATE_DIR || path.join(FIX, 'private');
const walk = d => !fs.existsSync(d) ? [] : fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const FILES = walk(DIR).filter(f => /\.(dxf|pdf|png|jpe?g)$/i.test(f)).sort();
const OUT = 'test-results/private';
const v = q => q && q.value != null ? `${q.value}${q.conflict ? ' ⚠спорно' : q.source === 'dimension' ? '' : ' ≈изм.'}` : '—';

test.describe.configure({ mode: 'serial' });
test.beforeAll(() => { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'report.md'), `# Свои чертежи — результат распознавания\n\nПапка: ${DIR}\n\n`); });
if (!FILES.length) test('свои чертежи: папка пуста — нечего проверять', () => test.skip(true, `нет файлов в ${DIR}`));
for (const file of FILES) test(`свой чертёж: ${path.relative(DIR, file)}`, async ({ page }) => {
  test.setTimeout(240000);
  await openApp(page);
  const kind = kindOf(file), r = await run(page, file);
  const exp = [file.replace(/\.[^.\\/]+$/, '') + '.expected.json', path.join(path.dirname(file), 'expected.json')].find(f => fs.existsSync(f));
  const E = exp ? JSON.parse(fs.readFileSync(exp, 'utf8')) : null;
  const filled = E && E.plate && E.plate.w != null && (E.holes || []).every(h => h.x != null && h.y != null && h.d != null);
  const A = filled ? analyse(E, r, kind) : null;
  const L = [`## ${path.relative(DIR, file)} (${kind}, ${r.ms} мс)`, '',
    `Деталь: ${r.outline ? v(r.outline.w) + ' × ' + v(r.outline.h) : 'контур не найден'}${r.thickness ? ' · толщина ' + r.thickness.value : ''}`,
    `Отверстий найдено: ${r.holes.length}${r.holes.length ? ' — ' + r.holes.map(h => `(${v(h.x)}; ${v(h.y)}) Ø${v(h.d)}`).join(', ') : ''}`,
    `Карманов/пазов: ${r.features.length}${r.features.length ? ' — ' + r.features.map(f => `${f.kind === 'slot' ? 'паз' : 'карман'} центр (${v(f.cx)}; ${v(f.cy)}) ${f.kind === 'slot' ? 'L' + v(f.l) + ' W' + v(f.w) : v(f.w) + '×' + v(f.h)}`).join('; ') : ''}`,
    `Противоречия: ${r.conflicts.length ? r.conflicts.join('; ') : 'нет'}`, `Не привязаны надписи: ${r.unassigned.length ? r.unassigned.map(t => '«' + t + '»').join(', ') : 'нет'}`,
    `Прочитанный текст: ${r.texts.map(t => '«' + t + '»').join(' ')}`,
    E ? (filled ? `Эталон: отверстий совпало ${E.holes.length - A.missing}/${E.holes.length}, лишних ${A.extra}, «по размеру» ${A.byDim}/${A.values}, неверных «по размеру»: ${A.wrongDim.length ? A.wrongDim.join('; ') : 'нет'}` : 'Эталон не заполнен — сравнение не выполнялось') : 'Эталона нет — проверьте значения по чертежу глазами', ''];
  fs.appendFileSync(path.join(OUT, 'report.md'), L.join('\n') + '\n');
  if (A) expect(A.wrongDim, 'значения «по размеру» не должны быть неверными').toEqual([]);
});
