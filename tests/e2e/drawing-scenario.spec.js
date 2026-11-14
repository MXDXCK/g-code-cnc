// Сквозной сценарий из ТЗ: чертёж пластины (PDF, фото) → подтверждение геометрии → операции → G-код Fanuc → проверка → 3D.
// Эталон №1: пластина 120×80×10, 4 отв. Ø10 в (15,15) (105,15) (15,65) (105,65) от левого нижнего угла.
const { test, expect } = require('playwright/test');
const fs = require('fs');
const { openApp, fixture } = require('../helpers');

const expected = JSON.parse(fs.readFileSync(fixture('drawings', '01-plate-4-holes', 'expected.json'), 'utf8'));

async function prepare(page) {
  const errors = await openApp(page);
  await page.evaluate(() => {
    const s = __fcam.st();
    Object.assign(s.stock, { shape: 'rect', x: 120, y: 80, z: 10, rr: 0, rch: 0, origin: 'corner' });
    s.ops = []; s.prog.fmt = 'plain';
    s.tools.push({ id: 'tcent', num: 21, type: 'center', name: 'центровка', d: 10, fl: 2, s: 1500, f: 150, pitch: 1.25 },
                 { id: 'tdr10', num: 22, type: 'drill', name: 'сверло', d: 10, fl: 2, s: 800, f: 100, pitch: 1.25 });
  });
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await page.locator('#shBody').getByRole('button', { name: /По чертежу/ }).click();
  return errors;
}
const field = (page, name) => page.locator(`#plateForm [name="${name}"]`);

async function confirmAll(page, n, skip = []) {
  for (let i = 0; i < n; i++) {
    if (skip.includes(i)) { await field(page, 'skip' + i).check(); continue; }
    await field(page, 'z' + i).fill('12');
    await field(page, 'ok' + i).check();
  }
  await field(page, 'center').selectOption('tcent');
  await field(page, 'drill').selectOption('tdr10');
  await field(page, 'centerZ').fill('2');
  await field(page, 'r').fill('2');
  await field(page, 'safe').fill('20');
  await field(page, 'setup').check();
}

async function finish(page) {
  const submit = page.locator('#plateForm button[type=submit]');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.locator('#t-code')).toHaveClass(/\bon\b/);
  return page.evaluate(() => {
    const code = document.querySelector('#code').value, st = __fcam.st(), parsed = __fcam.parse(code);
    const drillT = +st.tools.find(t => t.id === 'tdr10').num;
    const pts = [...new Set(parsed.segs.filter(s => s.tool === drillT && !s.rapid && s.b.z < s.a.z && s.b.z < 0).map(s => `${s.b.x} ${s.b.y} ${s.b.z}`))].sort();
    return { code, pts, errs: __fcam.checkProgram(code).filter(c => c.sev === 'err'), drawing: st.drawings[st.drawings.length - 1], ops: st.ops.map(o => [o.type, o.cycle, o.depth]) };
  });
}

for (const [file, label, timeout] of [['plate.pdf', 'PDF', 60000], ['plate.png', 'фото', 150000]]) {
  test(`${label}: чертёж → подтверждение → центровка и сверление G81 → проверка → 3D`, async ({ page }) => {
    test.setTimeout(timeout);
    const errors = await prepare(page);
    await page.locator('#plateFile').setInputFiles(fixture('drawings', '01-plate-4-holes', file));
    const form = page.locator('#plateForm');
    await expect(form).toBeVisible({ timeout: timeout - 10000 });
    await expect(form.locator('fieldset')).toHaveCount(4);
    await expect(field(page, 'zero')).toHaveValue('part');
    // предложенные значения — из размерных надписей, а не «на глаз»
    const got = [];
    for (let i = 0; i < 4; i++) {
      got.push([+(await field(page, 'x' + i).inputValue()), +(await field(page, 'y' + i).inputValue()), +(await field(page, 'd' + i).inputValue())]);
      await expect(page.locator('#plateSrc' + i)).toContainText('X: по размеру');
    }
    const key = a => a.map(v => v.join(' ')).sort();
    expect(key(got)).toEqual(key(expected.holes.map(h => [h.x, h.y, h.d])));
    await expect(form).toContainText('120 × 80');
    // ничего не сверлится без подтверждения
    expect(await page.evaluate(() => __fcam.st().ops)).toEqual([]);
    await expect(form.locator('button[type=submit]')).toBeDisabled();
    await confirmAll(page, 4);
    const r = await finish(page);
    expect(r.ops).toEqual([['drill', 'G81', 2], ['drill', 'G81', 12]]);
    expect(r.errs).toEqual([]);
    expect(r.pts).toEqual(expected.holes.map(h => `${h.x} ${h.y} -12`).sort());
    expect(r.code).toMatch(/G98 G81 X1?[05]{1,2}\. Y[16]5\. Z-12\./);   // первое отверстие — любое из четырёх
    expect(r.drawing.sources[0].kind).toBe(file.endsWith('.pdf') ? 'pdf' : 'image');
    expect(r.drawing.confirmed.every(h => h.source.suggested.x === 'dimension')).toBe(true);
    // 3D
    await page.evaluate(() => __fcam.show('sim'));
    await page.waitForTimeout(800);
    expect(await page.locator('#tl .tls, #tl > div, #tl span').count()).toBeGreaterThan(0);
    // исходник открывается из проекта и совпадает по SHA-256
    await page.getByRole('button', { name: 'Меню', exact: true }).click();
    await page.locator('#shBody').getByRole('button', { name: /По чертежу/ }).click();
    await page.getByRole('button', { name: 'Открыть исходник' }).click();
    await expect(page.locator('#plateSrcView')).toContainText('SHA-256 совпадает');
    await expect(page.locator('#plateSrcView img')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

test('лишняя окружность: «Не обрабатывать» — в программе только подтверждённые отверстия', async ({ page }) => {
  const errors = await prepare(page);
  await page.locator('#plateFile').setInputFiles(fixture('drawings', '01-plate-4-holes', 'plate.dxf'));
  await expect(page.locator('#plateForm fieldset')).toHaveCount(4);
  await expect(page.locator('#plateForm')).toContainText('не сопоставлено: 0');
  // у DXF по умолчанию ноль файла; эталон начерчен от угла, заготовка — тоже от угла
  await expect(field(page, 'x0')).toHaveValue(/^(15|105)$/);
  await confirmAll(page, 4, [1]);
  const r = await finish(page);
  expect(r.pts.length).toBe(3);
  expect(r.drawing.skipped).toEqual(['circle-2']);
  expect(r.errs).toEqual([]);
  expect(errors).toEqual([]);
});
