// Регрессия «По чертежу» (пункты владельца 14.11): настоящий 3D, ноль, неизвестные размеры, конфликт,
// экспорт/импорт проекта, работа без интернета.
const { test, expect } = require('playwright/test');
const fs = require('fs');
const { openApp, fixture, readFixture, THREE } = require('../helpers');

const PLATE = (...p) => fixture('drawings', '01-plate-4-holes', ...p);

async function prepare(page, origin = 'corner', opts) {
  const errors = await openApp(page, opts);
  await page.evaluate(origin => {
    const s = __fcam.st();
    Object.assign(s.stock, { shape: 'rect', x: 120, y: 80, z: 10, rr: 0, rch: 0, origin });
    s.ops = []; s.prog.fmt = 'plain';
    s.tools.push({ id: 'tcent', num: 21, type: 'center', name: 'центровка', d: 10, fl: 2, s: 1500, f: 150, pitch: 1.25 },
                 { id: 'tdr10', num: 22, type: 'drill', name: 'сверло', d: 10, fl: 2, s: 800, f: 100, pitch: 1.25 });
  }, origin);
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await page.locator('#shBody').getByRole('button', { name: /По чертежу/ }).click();
  return errors;
}
const field = (page, name) => page.locator(`#plateForm [name="${name}"]`);
async function confirmAll(page, n, depth = '12') {
  for (let i = 0; i < n; i++) { await field(page, 'z' + i).fill(depth); await field(page, 'ok' + i).check(); }
  await field(page, 'center').selectOption('tcent');
  await field(page, 'drill').selectOption('tdr10');
  await field(page, 'centerZ').fill('2'); await field(page, 'r').fill('2'); await field(page, 'safe').fill('20');
  await field(page, 'setup').check();
}
const loadBuffer = (page, name, buffer, mimeType = 'application/dxf') => page.locator('#plateFile').setInputFiles({ name, mimeType, buffer: Buffer.from(buffer) });

test('настоящий 3D: после сверления в карте высот 4 сквозных отверстия, вокруг металл не тронут', async ({ page }) => {
  // заглушка three.js не строит модель — без настоящего three этот тест ничего не доказывает
  if (!THREE.real) { expect(process.env.CI, 'в CI должен стоять настоящий three.js').toBeFalsy(); test.skip(true, 'нет настоящего three.js (THREE_DIR)'); }
  const errors = await prepare(page);
  await page.locator('#plateFile').setInputFiles(PLATE('plate.dxf'));
  await expect(page.locator('#plateForm fieldset')).toHaveCount(4);
  await confirmAll(page, 4);
  await expect(page.locator('#plateValidation')).toContainText('выйдет из заготовки снизу на 2 мм');   // 12 > 10: не блокирует, но предупреждает
  await page.locator('#plateForm button[type=submit]').click();
  await expect(page.locator('#t-code')).toHaveClass(/\bon\b/);
  await page.evaluate(() => __fcam.show('sim'));
  await expect(page.locator('#view canvas')).toHaveCount(1);
  await page.evaluate(() => window.simFinish());
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => {
    const h = __fcam.hm(), at = (x, y) => h.H[Math.round((y - h.y0) / h.dy) * (h.nx + 1) + Math.round((x - h.x0) / h.dx)];
    return { holes: [[15, 15], [105, 15], [15, 65], [105, 65]].map(([x, y]) => at(x, y)), mid: at(60, 40), edge: at(15, 23), bot: h.bot, webgl: !!document.querySelector('#view canvas').getContext('webgl2') || true };
  });
  expect(r.holes).toEqual([r.bot, r.bot, r.bot, r.bot]);   // сквозь (глубина 12 > толщины 10)
  expect(r.mid).toBe(0);
  expect(r.edge).toBe(0);                                  // 8 мм от центра отверстия Ø10 — не тронуто
  const shot = await page.locator('#view').screenshot();
  fs.mkdirSync('test-results', { recursive: true }); fs.writeFileSync('test-results/3d-plate.png', shot);
  expect(shot.length).toBeGreaterThan(5000);               // не пустой кадр
  expect(errors).toEqual([]);
});

test('ноль: DXF «как в файле» ↔ «угол детали = угол заготовки» (ноль заготовки в центре)', async ({ page }) => {
  const errors = await prepare(page, 'center');
  await page.locator('#plateFile').setInputFiles(PLATE('plate.dxf'));
  await expect(field(page, 'zero')).toHaveValue('dxf');
  const xs = async () => { const v = []; for (let i = 0; i < 4; i++) v.push(+(await field(page, 'x' + i).inputValue())); return v.sort((a, b) => a - b); };
  expect(await xs()).toEqual([15, 15, 105, 105]);
  await field(page, 'ok0').check();
  await field(page, 'zero').selectOption('part');
  expect(await xs()).toEqual([-45, -45, 45, 45]);          // заготовка 120 с нулём в центре: −60 + 15
  await expect(field(page, 'ok0')).not.toBeChecked();      // смена нуля снимает подтверждение
  await expect(page.locator('#plateSrc0')).toContainText('по размеру');
  expect(errors).toEqual([]);
});

test('конфликт размеров показывается, а не подгоняется', async ({ page }) => {
  const errors = await prepare(page);
  const dxf = readFixture('drawings', '01-plate-4-holes', 'plate.dxf');
  expect(dxf.match(/\n42\n90\n/g)).toHaveLength(1);
  await loadBuffer(page, 'conflict.dxf', dxf.replace('\n42\n90\n', '\n42\n95\n'));
  await expect(page.locator('#plateForm .chk.err').first()).toContainText('95');
  // значение из файла не заменено числом с надписи
  const xs = []; for (let i = 0; i < 4; i++) xs.push(+(await field(page, 'x' + i).inputValue()));
  expect(xs.sort((a, b) => a - b)).toEqual([15, 15, 105, 105]);
  expect(errors).toEqual([]);
});

test('неизвестные размеры не выдумываются: мелкое фото → поля пустые, без ввода кнопка закрыта', async ({ page }) => {
  test.setTimeout(150000);
  const errors = await prepare(page);
  const b64 = fs.readFileSync(PLATE('plate.png')).toString('base64');
  // плохой снимок: ×0.4 (шрифт ≈ 11 пикс.), размытие, шум, JPEG — OCR не читает размеры
  await page.evaluate(async b64 => {
    const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 448; const c = cv.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, 640, 448); c.filter = 'blur(0.8px)'; c.drawImage(im, 0, 0, 640, 448); c.filter = 'none';
    const id = c.getImageData(0, 0, 640, 448); let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < id.data.length; i += 4) { const n = (rnd() - 0.5) * 20; for (let j = 0; j < 3; j++) id.data[i + j] = Math.max(0, Math.min(255, id.data[i + j] * 0.92 + 10 + n)); }
    c.putImageData(id, 0, 0);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.7));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'small.png', { type: 'image/png' }));
    const inp = document.querySelector('#plateFile'); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
  }, b64);
  await expect(page.locator('#plateForm')).toBeVisible({ timeout: 140000 });
  const n = await page.locator('#plateForm fieldset').count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    expect(await field(page, 'x' + i).inputValue()).toBe('');
    expect(await field(page, 'y' + i).inputValue()).toBe('');
  }
  await confirmAll(page, n);
  await expect(page.locator('#plateForm button[type=submit]')).toBeDisabled();
  await expect(page.locator('#plateValidation')).toContainText('введи X, Y');
  expect(await page.evaluate(() => __fcam.st().ops)).toEqual([]);
  expect(errors).toEqual([]);
});

test('проект с чертежом: экспорт .nc → импорт на «другом устройстве» → геометрия на месте, исходника нет — честное сообщение', async ({ page, browser }) => {
  const errors = await prepare(page);
  await page.locator('#plateFile').setInputFiles(PLATE('plate.dxf'));
  await confirmAll(page, 4);
  await page.locator('#plateForm button[type=submit]').click();
  await expect(page.locator('#t-code')).toHaveClass(/\bon\b/);
  await page.evaluate(() => __fcam.show('home'));
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '⬇ Экспорт текущей файлом .nc' }).click();
  const file = await (await download).path();
  // новое устройство: пустой браузер
  const ctx = await browser.newContext(); const p2 = await ctx.newPage();
  const e2 = await openApp(p2);
  await p2.locator('#impF').setInputFiles(file);
  await expect.poll(() => p2.evaluate(() => (__fcam.st().drawings || []).length)).toBe(1);
  const d = await p2.evaluate(() => __fcam.st().drawings[0]);
  expect(d.confirmed.map(h => [h.geom.cx, h.geom.cy]).sort()).toEqual([[105, 15], [105, 65], [15, 15], [15, 65]]);
  await p2.getByRole('button', { name: 'Меню', exact: true }).click();
  await p2.locator('#shBody').getByRole('button', { name: /По чертежу/ }).click();
  await p2.getByRole('button', { name: 'Открыть исходник' }).click();
  await expect(p2.locator('#plateSrcView')).toContainText('не найден на этом устройстве');
  expect(errors).toEqual([]); expect(e2).toEqual([]);
  await ctx.close();
});

test('без интернета (сайт): после первого открытия «По чертежу» с DXF работает офлайн, даже если мастер раньше не открывали', async ({ page, context }) => {
  const errors = await openApp(page, { keepStorage: true });
  await page.evaluate(async () => { await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(async () => !!(await caches.match(new URL('src/drawing/pipeline.js', location.href).href)))).toBe(true);
  await expect.poll(() => page.evaluate(async () => !!(await caches.match('https://unpkg.com/three@0.160.0/build/three.module.js')))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#home')).toBeVisible();
  await page.evaluate(() => { const s = __fcam.st(); Object.assign(s.stock, { shape: 'rect', x: 120, y: 80, z: 10, rr: 0, rch: 0, origin: 'corner' }); });
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await page.locator('#shBody').getByRole('button', { name: /По чертежу/ }).click();
  await page.locator('#plateFile').setInputFiles(PLATE('plate.dxf'));
  await expect(page.locator('#plateForm fieldset')).toHaveCount(4);
  await context.setOffline(false);
  expect(errors.filter(e => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|net::/.test(e))).toEqual([]);
});
