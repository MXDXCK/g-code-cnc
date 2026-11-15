// «По чертежу» → карман / паз / круглый карман → существующие операции Fresa → G-код → проверка → настоящий 3D.
// Проверяется не наличие G1/G3, а геометрия: где ходит центр фрезы, какая глубина, где снят металл.
// Эталоны: №03 карман 60×30 R5 в центре (60,40), глубина «5»; №04 паз L40 W10 центр (50,25) + отв. Ø6 (15,25).
const { test, expect } = require('playwright/test');
const fs = require('fs');
const { openApp, fixture, readFixture, THREE } = require('../helpers');

const TOOLS = [
  { id: 'em10', num: 31, type: 'endmill', name: 'фреза 10', d: 10, fl: 3, s: 3000, f: 400 },
  { id: 'em8', num: 32, type: 'endmill', name: 'фреза 8', d: 8, fl: 3, s: 3500, f: 350 },
  { id: 'em12', num: 33, type: 'endmill', name: 'фреза 12', d: 12, fl: 3, s: 2500, f: 400 },
  { id: 'em40', num: 34, type: 'endmill', name: 'фреза 40', d: 40, fl: 4, s: 800, f: 300 },
  { id: 'tcent', num: 21, type: 'center', d: 10, fl: 2, s: 1500, f: 150 },
  { id: 'tdr10', num: 22, type: 'drill', d: 10, fl: 2, s: 800, f: 100 },
];
async function prepare(page, stock = { x: 120, y: 80, z: 10 }) {
  const errors = await openApp(page);
  await page.evaluate(({ stock, TOOLS }) => {
    const s = __fcam.st(); Object.assign(s.stock, { shape: 'rect', ...stock, rr: 0, rch: 0, origin: 'corner' }); s.ops = []; s.prog.fmt = 'plain'; s.tools.push(...TOOLS);
  }, { stock, TOOLS });
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await page.locator('#shBody').getByRole('button', { name: /По чертежу/ }).click();
  return errors;
}
const f = (page, n) => page.locator(`#plateForm [name="${n}"]`);
const submit = page => page.locator('#plateForm button[type=submit]');
async function millSetup(page, tool = 'em10', step = '2') {
  await f(page, 'mill').selectOption(tool); await f(page, 'mstep').fill(step); await f(page, 'safe').fill('20');
  await f(page, 'mplunge').check(); await f(page, 'setup').check();
}
async function genCode(page) {
  await expect(submit(page)).toBeEnabled();
  await submit(page).click();
  await expect(page.locator('#t-code')).toHaveClass(/\bon\b/);
  return page.evaluate(() => {
    const code = document.querySelector('#code').value, P = __fcam.parse(code);
    return { code, segs: P.segs.map(s => ({ t: s.tool, r: !!s.rapid, a: s.a, b: s.b })), errs: __fcam.checkProgram(code).filter(c => c.sev === 'err' || c.sev === 'warn').map(c => c.sev + ': ' + c.msg), ops: __fcam.st().ops.map(o => ({ type: o.type, ...['cx', 'cy', 'w', 'h', 'l', 'd', 'ang', 'depth', 'step', 'over'].reduce((a, k) => (o[k] != null ? (a[k] = o[k]) : 0, a), {}) })) };
  });
}
const cutBox = (segs, tnum) => {
  const S = segs.filter(s => s.t === tnum && !s.r && (s.a.z < 0 || s.b.z < 0)), P = S.flatMap(s => [s.a, s.b]).filter(p => p.z < 0);
  return { n: S.length, x0: Math.min(...P.map(p => p.x)), x1: Math.max(...P.map(p => p.x)), y0: Math.min(...P.map(p => p.y)), y1: Math.max(...P.map(p => p.y)), z: Math.min(...P.map(p => p.z)) };
};
async function sim(page) {
  await page.evaluate(() => __fcam.show('sim')); await page.evaluate(() => window.simFinish()); await page.waitForTimeout(500);
  return pts => page.evaluate(pts => { const h = __fcam.hm(); return pts.map(([x, y]) => +h.H[Math.round((y - h.y0) / h.dy) * (h.nx + 1) + Math.round((x - h.x0) / h.dx)].toFixed(3)); }, pts);
}

for (const file of ['drawing.dxf', 'drawing.pdf', 'drawing.png']) test(`карман №03 (${file}): распознан → подтверждён → «Карман прямоугольный» → траектория и 3D совпадают с чертежом`, async ({ page }) => {
  test.setTimeout(150000);
  const errors = await prepare(page);
  await page.locator('#plateFile').setInputFiles(fixture('drawings', '03-pocket', file));
  await expect(page.locator('#plateForm fieldset')).toHaveCount(1, { timeout: 140000 });
  if (file.endsWith('.dxf')) await f(page, 'zero').selectOption('part');
  // предложено по размерам чертежа; глубину не подставили — на чертеже только надпись
  await expect(f(page, 'fx0')).toHaveValue('60'); await expect(f(page, 'fy0')).toHaveValue('40');
  await expect(f(page, 'fa0')).toHaveValue('60'); await expect(f(page, 'fb0')).toHaveValue('30');
  await expect(f(page, 'fz0')).toHaveValue('');
  // надпись «Карман глубина 5» показывается, но глубина не подставляется; на фото OCR (eng) кириллицу не читает — K-21
  if (!file.endsWith('.png')) await expect(page.locator('#plateFSrc0')).toContainText('«Карман глубина 5» — глубину введи сам');
  if (file.endsWith('.png')) await f(page, 'fr0').fill('5');   // на фото радиус угла измерен приблизительно
  await expect(submit(page)).toBeDisabled();                    // ничего не обрабатывается без решения
  await f(page, 'fz0').fill('5'); await f(page, 'fk0').selectOption('mill');
  await millSetup(page, 'em10');
  const r = await genCode(page);
  expect(r.ops).toEqual([{ type: 'pocketRect', cx: 60, cy: 40, w: 60, h: 30, depth: 5, step: 2, over: 45 }]);
  expect(r.errs).toEqual([]);
  const B = cutBox(r.segs, 31);
  expect(B).toMatchObject({ x0: 35, x1: 85, y0: 30, y1: 50, z: -5 });   // центр фрезы: стенка − R5, дно −5
  expect(r.code).toMatch(/G0 G90 G54 X60\. Y40\.[\s\S]*G1 Z-2\. F133/);  // врезание в центре на подаче врезания (F/3)
  if (!THREE.real) return;
  const H = await sim(page);
  const [mid, wallIn, wallOut, corner, cornerTool, outside] = await H([[60, 40], [31, 40], [29, 40], [30.6, 25.6], [33.6, 28.6], [10, 10]]);
  expect([mid, wallIn, cornerTool]).toEqual([-5, -5, -5]);
  expect([wallOut, corner, outside]).toEqual([0, 0, 0]);       // за стенкой и в углу R5 металл не тронут
  expect(errors).toEqual([]);
});

test('паз №04 (DXF): паз → «Карман овальный», отверстие исключено; траектория и 3D', async ({ page }) => {
  const errors = await prepare(page, { x: 100, y: 50, z: 10 });
  await page.locator('#plateFile').setInputFiles(fixture('drawings', '04-slot', 'drawing.dxf'));
  await f(page, 'zero').selectOption('part');
  await expect(page.locator('#plateForm legend').nth(1)).toContainText('Паз 1');
  await expect(f(page, 'fx0')).toHaveValue('50'); await expect(f(page, 'fy0')).toHaveValue('25');
  await expect(f(page, 'fa0')).toHaveValue('40'); await expect(f(page, 'fb0')).toHaveValue('10');
  await f(page, 'skip0').check();
  await f(page, 'fz0').fill('4'); await f(page, 'fk0').selectOption('mill');
  await millSetup(page, 'em8', '1');
  const r = await genCode(page);
  expect(r.ops).toEqual([{ type: 'pocketOval', cx: 50, cy: 25, l: 40, w: 10, ang: 0, depth: 4, step: 1, over: 45 }]);
  expect(r.errs).toEqual([]);
  const B = cutBox(r.segs, 32);
  expect(B.z).toBe(-4);
  expect(B.x0).toBeCloseTo(34, 3); expect(B.x1).toBeCloseTo(66, 3); expect(B.y0).toBeCloseTo(24, 3); expect(B.y1).toBeCloseTo(26, 3);
  if (!THREE.real) return;
  const H = await sim(page);
  const [c, endIn, endOut, sideIn, sideOut, endCorner, hole] = await H([[50, 25], [31, 25], [29, 25], [50, 20.6], [50, 19.4], [31, 21], [15, 25]]);
  expect([c, endIn, sideIn]).toEqual([-4, -4, -4]);
  expect([endOut, sideOut, endCorner, hole]).toEqual([0, 0, 0, 0]);   // за торцом R5 и отверстие (исключено) — не тронуты
  expect(errors).toEqual([]);
});

test('окружность как круглый карман: «Карман круглый», отверстие не сверлится', async ({ page }) => {
  const errors = await prepare(page);
  await page.locator('#plateFile').setInputFiles(fixture('drawings', '01-plate-4-holes', 'plate.dxf'));
  for (let i = 1; i < 4; i++) await f(page, 'skip' + i).check();
  await f(page, 'z0').fill('3'); await f(page, 'cpk0').check();
  await millSetup(page, 'em8', '1');
  const r = await genCode(page);
  expect(r.ops.map(o => o.type)).toEqual(['pocketCircle']);
  expect(r.ops[0]).toMatchObject({ d: 10, depth: 3 });
  expect(r.errs).toEqual([]);
  const B = cutBox(r.segs, 32);
  expect(B.z).toBe(-3);
  expect(Math.max(B.x1 - B.x0, B.y1 - B.y0)).toBeCloseTo(2, 3);         // R кармана 5 − R фрезы 4 = 1 → путь Ø2
  expect(errors).toEqual([]);
});

// ---------- обработка должна быть ЗАПРЕЩЕНА ----------
async function pocketReady(page, opts = {}) {
  await page.locator('#plateFile').setInputFiles(fixture('drawings', '03-pocket', opts.file || 'drawing.dxf'));
  await f(page, 'zero').selectOption('part');
  await f(page, 'fz0').fill(opts.depth || '5'); await f(page, 'fk0').selectOption('mill');
  await millSetup(page, opts.tool || 'em10');
}
const blocked = async (page, re) => { await expect(page.locator('#plateValidation')).toContainText(re); await expect(submit(page)).toBeDisabled(); expect(await page.evaluate(() => __fcam.st().ops.length)).toBe(0); };

test('запрет: фреза Ø12 оставит в углах R6 > R5 по чертежу', async ({ page }) => {
  await prepare(page); await pocketReady(page, { tool: 'em12' });
  await blocked(page, 'оставит в углах R6');
});
test('запрет: фреза шире паза', async ({ page }) => {
  await prepare(page, { x: 100, y: 50, z: 10 });
  await page.locator('#plateFile').setInputFiles(fixture('drawings', '04-slot', 'drawing.dxf'));
  await f(page, 'zero').selectOption('part'); await f(page, 'skip0').check();
  await f(page, 'fz0').fill('4'); await f(page, 'fk0').selectOption('mill'); await millSetup(page, 'em40');
  await blocked(page, 'шире элемента');
});
test('запрет: глубина кармана ≥ толщины (сквозное окно)', async ({ page }) => {
  await prepare(page); await pocketReady(page, { depth: '10' });
  await blocked(page, 'сквозное окно');
});
test('запрет: карман выходит за заготовку', async ({ page }) => {
  await prepare(page, { x: 80, y: 50, z: 10 }); await pocketReady(page);
  await blocked(page, 'выходит за края заготовки');
});
test('запрет: без подтверждения врезания центром; правка размера снимает подтверждение', async ({ page }) => {
  await prepare(page); await pocketReady(page);
  await expect(submit(page)).toBeEnabled();
  await f(page, 'mplunge').uncheck();
  await blocked(page, 'резать центром');
  await f(page, 'mplunge').check(); await f(page, 'setup').check();
  await expect(submit(page)).toBeEnabled();
  await f(page, 'fa0').fill('61');
  await expect(f(page, 'fk0')).toHaveValue('');
  await blocked(page, 'выбери «Фрезеровать»');
});
test('запрет: противоречивый размер кармана не подставляется — поле пустое, пока человек не введёт', async ({ page }) => {
  await prepare(page);
  const dxf = readFixture('drawings', '03-pocket', 'drawing.dxf');
  // ширина кармана подписана 60, а в файле расстояние 60: меняем надпись на 64 — противоречие
  const bad = dxf.replace(/1\n<>\n70\n32\n10\n90\n20\n-10\n/, '1\n64\n70\n32\n10\n90\n20\n-10\n');
  expect(bad).not.toBe(dxf);
  await page.locator('#plateFile').setInputFiles({ name: 'bad.dxf', mimeType: 'application/dxf', buffer: Buffer.from(bad) });
  await f(page, 'zero').selectOption('part');
  await expect(page.locator('#plateForm .chk.err').first()).toContainText('64');
  await expect(f(page, 'fa0')).toHaveValue('');                       // ни 64 (надпись), ни 60 (рисунок) — решает человек
  await expect(page.locator('#plateFSrc0')).toContainText('спорно');
  await f(page, 'fz0').fill('5'); await f(page, 'fk0').selectOption('mill'); await millSetup(page, 'em10');
  await blocked(page, 'введи центр, размеры и глубину');
  await expect(f(page, 'fx0')).toHaveValue('');                       // центр по X выведен из спорного размера — тоже пусто
  await f(page, 'fa0').fill('60'); await f(page, 'fx0').fill('60'); await f(page, 'fk0').selectOption('mill'); await f(page, 'setup').check();
  await expect(submit(page)).toBeEnabled();
});
