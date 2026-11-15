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
async function prepare(page, stock = { x: 120, y: 80, z: 10 }, extra = []) {
  const errors = await openApp(page);
  await page.evaluate(({ stock, TOOLS }) => {
    const s = __fcam.st(); Object.assign(s.stock, { shape: 'rect', ...stock, rr: 0, rch: 0, origin: 'corner' }); s.ops = []; s.prog.fmt = 'plain'; s.tools.push(...TOOLS);
  }, { stock, TOOLS: [...TOOLS, ...extra] });
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
  // надпись «Карман глубина 5» показывается, но глубина не подставляется (на фото — второй проход OCR с русским словарём)
  await expect(page.locator('#plateFSrc0')).toContainText('«Карман глубина 5» — глубину введи сам');
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

/* ---------- наружный контур и сквозное окно → «Контур по элементам» ---------- */
// №02: пластина 100×60, углы R8, 2 отв. Ø8. Заготовка 120×80, деталь по центру → левый нижний угол детали (10, 10).
async function outerReady(page, file, { tool = 'em10', depth = '5', zero = 'center', stock = { x: 120, y: 80, z: 10 }, extra = [] } = {}) {
  const errors = await prepare(page, stock, extra);
  await page.locator('#plateFile').setInputFiles(fixture('drawings', '02-contour-radii', file));
  await expect(f(page, 'ok_out')).toHaveCount(1, { timeout: 140000 });
  await f(page, 'zero').selectOption(zero);
  await f(page, 'skip0').check(); await f(page, 'skip1').check();
  await expect(f(page, 'ok_out')).toHaveValue('skip');                 // по умолчанию контур не обрабатывается
  if (depth) await f(page, 'oz').fill(depth);
  return errors;
}
for (const file of ['drawing.dxf', 'drawing.pdf', 'drawing.png']) test(`наружный контур №02 (${file}): R8 по чертежу → «Контур по элементам» снаружи; траектория и 3D`, async ({ page }) => {
  test.setTimeout(150000);
  const errors = await outerReady(page, file);
  await expect(f(page, 'ox')).toHaveValue('10'); await expect(f(page, 'oy')).toHaveValue('10');
  await expect(f(page, 'ow')).toHaveValue('100'); await expect(f(page, 'oh')).toHaveValue('60');
  if (file.endsWith('.png')) {
    // на фото углы распознаются ненадёжно (у угла сходятся выносные линии) — вид углов и R решает человек
    await expect(f(page, 'ock')).toHaveValue(''); await expect(page.locator('#plateOSrc')).toContainText('выбери вид углов сам');
    await f(page, 'ock').selectOption('fillet'); await f(page, 'orr').fill('8');
  } else { await expect(f(page, 'ock')).toHaveValue('fillet'); await expect(f(page, 'orr')).toHaveValue('8'); }
  await expect(page.locator('#plateOSrc')).toContainText('по центру заготовки');
  await f(page, 'ok_out').selectOption('mill');
  await millSetup(page, 'em10', '2.5');
  const r = await genCode(page);
  expect(r.ops.map(o => o.type)).toEqual(['contour']);
  expect(r.errs).toEqual([]);
  const op = await page.evaluate(() => { const o = __fcam.st().ops[0]; return { sx: o.sx, sy: o.sy, els: o.els, closed: o.closed, comp: o.comp, cmode: o.cmode, passes: o.passes, depth: o.depth }; });
  expect(op).toMatchObject({ sx: 60, sy: 10, closed: '1', comp: '41', cmode: 'prog', passes: 1, depth: 5 });
  expect(op.els.filter(e => e.t === 'CW').map(e => e.r)).toEqual([8, 8, 8, 8]);
  // центр фрезы на чистовом проходе: стенка + R5 → X 5…115, Y 5…75, углы — дуги R13 (8 + 5)
  expect(r.code).toMatch(/G1 X18\. Y5\.\nG2 X5\. Y18\. I0\. J13\./);
  expect(r.code).toMatch(/G2 X115\. Y62\. I0\. J-13\./);
  const B = cutBox(r.segs, 31);
  expect(B.z).toBe(-5);
  // врезание — за пределами заготовки (фреза не врезается в металл)
  const plunges = r.segs.filter(s => s.t === 31 && !s.r && s.b.z < s.a.z && s.a.x === s.b.x && s.a.y === s.b.y).map(s => s.b);
  expect(plunges.length).toBeGreaterThan(0);
  for (const p of plunges) expect(p.x < -5 || p.x > 125 || p.y < -5 || p.y > 85).toBe(true);
  if (!THREE.real) return;
  const H = await sim(page);
  // снято вокруг детали до края заготовки; деталь и угол R8 целы; кромка — ровно по контуру
  const [ring, ringCorner, stockEdge, inPart, inCornerR, outCornerR, edgeIn, edgeOut] =
    await H([[5, 40], [3, 3], [1, 40], [12, 40], [10 + 8 - 8 * 0.7071 + 0.6, 10 + 8 - 8 * 0.7071 + 0.6], [10 + 8 - 8 * 0.7071 - 0.6, 10 + 8 - 8 * 0.7071 - 0.6], [10.4, 40], [9.6, 40]]);
  expect([ring, stockEdge, outCornerR, edgeOut]).toEqual([-5, -5, -5, -5]);
  expect([inPart, inCornerR, edgeIn]).toEqual([0, 0, 0]);
  expect(ringCorner).toBeLessThanOrEqual(0);                    // угол заготовки: может остаться «уголок» — вне детали
  expect(errors).toEqual([]);
});
test('наружный контур с фасками углов (выбрано человеком вместо R): предупреждение, кромка фаски в 3D', async ({ page }) => {
  await outerReady(page, 'drawing.dxf');
  await f(page, 'ock').selectOption('chamfer'); await f(page, 'orr').fill('5');
  await f(page, 'ok_out').selectOption('mill'); await millSetup(page, 'em10', '5');
  await expect(page.locator('#plateValidation')).toContainText('вид углов выбран не как на рисунке');
  const r = await genCode(page);
  expect(r.errs).toEqual([]);
  if (!THREE.real) return;
  const H = await sim(page);
  // угол (10,10) с фаской 5: линия x + y = 25. Внутри детали — цело, снаружи — снято
  expect(await H([[13, 13], [12, 12], [10.6, 15.2], [15.2, 10.6], [10.6, 13.8], [13.8, 10.6]])).toEqual([0, -5, 0, 0, -5, -5]);
});
test('запрет: наружный контур на всю толщину (деталь отделится от заготовки)', async ({ page }) => {
  await outerReady(page, 'drawing.dxf', { depth: '10' });
  await f(page, 'ok_out').selectOption('mill'); await millSetup(page);
  await blocked(page, 'деталь отделится');
});
test('запрет: деталь не помещается в заготовку; ноль «по центру» недоступен', async ({ page }) => {
  await outerReady(page, 'drawing.dxf', { zero: 'part', stock: { x: 90, y: 80, z: 10 } });
  await expect(page.locator('#plateForm [name=zero] option[value=center]')).toHaveAttribute('disabled', '');
  await f(page, 'ok_out').selectOption('mill'); await millSetup(page);
  await blocked(page, 'выходит за края заготовки');
});
test('наружный контур: правка размера снимает решение; неизвестный радиус не подставляется', async ({ page }) => {
  await outerReady(page, 'drawing.dxf');
  await f(page, 'ok_out').selectOption('mill'); await millSetup(page);
  await expect(submit(page)).toBeEnabled();
  await f(page, 'orr').fill('');
  await expect(f(page, 'ok_out')).toHaveValue('skip');
  await f(page, 'ok_out').selectOption('mill'); await f(page, 'setup').check();
  await blocked(page, 'введи радиус углов');
});

// №03 как сквозное окно 60×30 R5 в пластине 10 мм: обход изнутри, фреза Ø8 (R4 ≤ R5), глубина 11 (выход 1 мм)
async function windowReady(page, { tool = 'em8', depth = '11', slug = true } = {}) {
  await prepare(page);
  await page.locator('#plateFile').setInputFiles(fixture('drawings', '03-pocket', 'drawing.dxf'));
  await f(page, 'zero').selectOption('part');
  await f(page, 'fz0').fill(depth); await f(page, 'fk0').selectOption('window');
  await millSetup(page, tool, '2');
  if (slug) { await f(page, 'wslug').check(); await f(page, 'setup').check(); }
}
test('сквозное окно №03: «Контур по элементам» изнутри; траектория, выход снизу, 3D', async ({ page }) => {
  await windowReady(page);
  await expect(page.locator('#plateValidation')).toContainText('выйдет из заготовки снизу на 1 мм');
  const r = await genCode(page);
  expect(r.ops.map(o => o.type)).toEqual(['contour']);
  expect(r.errs).toEqual(['warn: Обработка ниже дна заготовки (Z-11., высота заготовки 10.) — проверьте, что под деталью есть зазор']);
  // центр фрезы: стенка − R4 → X 34…86, Y 29…51, углы R1 (5 − 4), против часовой
  expect(r.code).toMatch(/G1 X85\. Y29\.\nG3 X86\. Y30\. I0\. J1\./);
  const B = cutBox(r.segs, 32);
  expect(B).toMatchObject({ x0: 34, x1: 86, z: -11 });
  expect(B.y0).toBeGreaterThanOrEqual(29); expect(B.y1).toBeLessThanOrEqual(51);
  if (!THREE.real) return;
  const H = await sim(page);
  const [wallIn, wallOut, cornerOut, ring] = await H([[30.6, 40], [29.4, 40], [30.8, 25.8], [31.5, 40]]);
  expect(ring).toBeLessThan(-9.9);                                // кольцо прорезано насквозь (дно сима — низ заготовки)
  expect([wallOut, cornerOut]).toEqual([0, 0]);                   // за стенкой и в углу R5 — металл цел
  expect(wallIn).toBeLessThan(-9.9);
});
test('запрет: окно — фреза больше R углов; глухое «окно»; без подтверждения пробки', async ({ page }) => {
  await windowReady(page, { tool: 'em12' });
  await blocked(page, 'больше R5 углов окна');
  await f(page, 'mill').selectOption('em8'); await f(page, 'fz0').fill('5'); await f(page, 'fk0').selectOption('window'); await f(page, 'setup').check();
  await blocked(page, 'только сквозное');
  await f(page, 'fz0').fill('11'); await f(page, 'fk0').selectOption('window'); await f(page, 'wslug').uncheck(); await f(page, 'setup').check();
  await blocked(page, 'подтверди подкладку');
});

/* ---------- фаска по верхней кромке → «Фаска по контуру» ---------- */
// профиль среза поперёк кромки по узлам сетки 3D: [x узла, z]; кромка при x = edge, металл при x > edge (sgn = +1) или x < edge (−1)
const chamferProfile = (page, y, edge, sgn) => page.evaluate(({ y, edge, sgn }) => {
  const h = __fcam.hm(), j = Math.round((y - h.y0) / h.dy), out = [];
  for (let i = 0; i <= h.nx; i++) { const k = j * (h.nx + 1) + i, d = (h.px[k] - edge) * sgn; if (d > 0.05 && d < 2) out.push([+d.toFixed(3), +h.H[k].toFixed(3)]); }
  return out;
}, { y, edge, sgn });
// фаска C×45°: на расстоянии d от кромки внутрь металла срез глубиной C − d (0 при d ≥ C); допуск — шаг сетки 3D
const expectChamfer = (P, C, tol) => { expect(P.length).toBeGreaterThan(1); for (const [d, z] of P) expect(Math.abs(z - Math.min(0, d - C))).toBeLessThanOrEqual(tol); };
const CHT = { id: 'tch', num: 41, type: 'chamfer', d: 12, ang: 90, tip: 0.5, fl: 2, s: 4000, f: 300 };
test('фаска C1 по наружному контуру (R8) и по карману №03: «Фаска по контуру», 3D — срез 45° у кромки', async ({ page }) => {
  // наружный контур №02 + фаска
  await outerReady(page, 'drawing.dxf', { extra: [CHT] });
  await f(page, 'ok_out').selectOption('mill');
  await f(page, 'chout').check(); await f(page, 'chtool').selectOption('tch'); await f(page, 'chc').fill('1');
  await millSetup(page, 'em10', '5');
  const r = await genCode(page);
  expect(r.ops.map(o => o.type)).toEqual(['contour', 'chamf']);
  expect(r.errs).toEqual([]);
  const ch = await page.evaluate(() => { const o = __fcam.st().ops[1]; return { src: o.src, side: o.side, cx: o.cx, cy: o.cy, w: o.w, h: o.h, rc: o.rc, c: o.c, z0: o.z0 }; });
  expect(ch).toEqual({ src: 'rect', side: 'out', cx: 60, cy: 40, w: 100, h: 60, rc: 8, c: 1, z0: 0 });
  // вершина фаскоснима: Z = −(C + 0.3), центр — на кромке + (0.25 + 0.3) от неё (Ø вершины 0.5)
  expect(cutBox(r.segs, 41).z).toBeCloseTo(-1.3, 3);
  if (!THREE.real) return;
  const H = await sim(page);
  expectChamfer(await chamferProfile(page, 40, 10, 1), 1, 0.12);            // левая кромка x = 10, металл справа
  expectChamfer(await chamferProfile(page, 40, 110, -1), 1, 0.12);          // правая кромка x = 110
  expect(await H([[60, 40]])).toEqual([0]);
});
test('фаска по карману №03 после кармана; запреты: инструмент не 90°, фаска ≥ глубины, карман не фрезеруется', async ({ page }) => {
  await prepare(page, undefined, [CHT, { ...CHT, id: 'tc60', num: 42, type: 'center', ang: 60 }]);
  await page.locator('#plateFile').setInputFiles(fixture('drawings', '03-pocket', 'drawing.dxf'));
  await f(page, 'zero').selectOption('part');
  await f(page, 'chpk0').check(); await f(page, 'chtool').selectOption('tch'); await f(page, 'chc').fill('1');
  await f(page, 'fz0').fill('5'); await f(page, 'fk0').selectOption('skip'); await millSetup(page, 'em10', '2.5');
  await blocked(page, 'карман не фрезеруется');
  await f(page, 'fk0').selectOption('mill'); await f(page, 'chtool').selectOption('tc60'); await f(page, 'setup').check();
  await blocked(page, 'нужен инструмент с углом 90°');
  await f(page, 'chtool').selectOption('tch'); await f(page, 'chc').fill('5'); await f(page, 'setup').check();
  await blocked(page, 'не меньше глубины кромки');
  await f(page, 'chc').fill('1'); await f(page, 'setup').check();
  const r = await genCode(page);
  expect(r.ops.map(o => o.type)).toEqual(['pocketRect', 'chamf']);
  expect(r.errs).toEqual([]);
  const ch = await page.evaluate(() => { const o = __fcam.st().ops[1]; return { side: o.side, cx: o.cx, cy: o.cy, w: o.w, h: o.h, rc: o.rc }; });
  expect(ch).toEqual({ side: 'in', cx: 60, cy: 40, w: 60, h: 30, rc: 5 });   // угол кромки = радиус фрезы Ø10
  if (!THREE.real) return;
  await sim(page);
  expectChamfer(await chamferProfile(page, 40, 30, -1), 1, 0.12);           // стенка кармана x = 30, металл слева
});
