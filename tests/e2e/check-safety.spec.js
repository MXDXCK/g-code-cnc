// Проверка программы: безопасность G-кода сверления (G90/G91, G54–G59, G43, G81/G80, G0, корректоры, F, S, конец).
// Каждый «испорченный» вариант эталонной программы должен дать ожидаемое замечание; эталоны Fresa — без замечаний.
const { test, expect } = require('playwright/test');
const fs = require('fs'), path = require('path');
const { openApp, readFixture, ROOT } = require('../helpers');

const BASE = () => readFixture('nc', 'drill_plate_g81.nc');   // программа мастера «По чертежу» (пластина 4 отв., T21 центровка, T22 сверло)
const CASES = [
  ['нет G43 у T21', c => c.replace('G43 H21 Z20.', 'Z20.'), 'err', 'нет G43'],
  ['H не того инструмента', c => c.replace('G43 H22', 'G43 H21'), 'warn', 'не совпадает с инструментом'],
  ['нет M03', c => c.replace('S800 M03', 'S800'), 'err', 'остановленном шпинделе'],
  ['нет S', c => c.replace('S800 M03', 'M03').replace('S1500 M03', 'M03'), 'err', 'без оборотов S'],
  ['нет F у второго инструмента', c => c.replace(' R2. F100', ' R2.'), 'warn', 'подача F не задана после смены'],
  ['нет F вовсе', c => c.replace(' R2. F100', ' R2.').replace(' R2. F150', ' R2.'), 'err', 'без F'],
  ['цикл отменён без G80', c => c.replace(/G80\nG0 Z20\.\nM09\nM05\nG91 G28 Z0\.\nG28/, 'G0 Z20.\nM09\nM05\nG91 G28 Z0.\nG28'), 'warn', 'а не G80'],
  ['смена инструмента в цикле', c => c.replace('G80\nG0 Z20.\nM09\nM05\nG91 G28 Z0.\nG90\nT22', 'M09\nM05\nT22'), 'err', 'активном цикле'],
  ['G91 в конце', c => c.replace('G28 Y0.\nG90\nM30', 'G28 Y0.\nM30'), 'warn', 'G91'],
  ['нет G54', c => c.split('G0 G90 G54').join('G0 G90'), 'warn', 'G54–G59'],
  ['G55 вместо G54 наладки', c => c.split('G54').join('G55'), 'warn', 'в наладке проекта — G54'],
  ['нет M30', c => c.replace('M30\n', ''), 'warn', 'M30'],
  ['нет G90 в начале', c => c.replace('G80 G90 G94', 'G80 G94').replace(/G0 G90 G54/g, 'G0 G54'), 'warn', 'Нет G90'],
  ['G0 в металл', c => c.replace('G0 G90 G54 X15. Y15.\nS800', 'G0 G90 G54 X15. Y15.\nG0 Z-5.\nS800'), 'err', 'G0 врезается'],
  ['плоскость R ниже верха', c => c.replace('Z-12. R2.', 'Z-12. R-3.'), 'err', 'G0 врезается'],
];

test('эталонная программа сверления: ошибок и предупреждений нет', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(c => __fcam.checkProgram(c), BASE());
  expect(r.filter(x => x.sev === 'err' || x.sev === 'warn')).toEqual([]);
  expect(r.filter(x => x.sev === 'nv').length).toBeGreaterThan(0);        // «не проверено» всегда показывается
});

test('испорченные варианты ловятся с правильной категорией', async ({ page }) => {
  await openApp(page);
  for (const [name, mut, sev, text] of CASES) {
    const code = mut(BASE());
    expect(code, name + ': мутация не применилась').not.toBe(BASE());
    const r = await page.evaluate(c => __fcam.checkProgram(c).map(x => x.sev + ': ' + x.msg), code);
    expect(r.some(x => x.startsWith(sev + ':') && x.includes(text)), `${name} → ожидалось «${sev}: …${text}…», получено:\n${r.join('\n')}`).toBe(true);
  }
});

test('нет ложных тревог: все эталоны G-кода Fresa и примеры программ', async ({ page }) => {
  await openApp(page);
  for (const dir of ['tests/golden', 'tests/fixtures/nc']) for (const f of fs.readdirSync(path.join(ROOT, dir)).filter(f => f.endsWith('.nc'))) {
    const c = fs.readFileSync(path.join(ROOT, dir, f), 'utf8');
    const r = await page.evaluate(c => __fcam.checkProgram(c).filter(x => x.sev === 'err' || x.sev === 'warn').map(x => x.sev + ': ' + x.msg), c);
    expect(r, f).toEqual([]);
  }
});
