const { test, expect } = require('playwright/test');
const { readFile } = require('node:fs/promises');
const { openApp, fixture, readFixture } = require('../helpers');

async function openPlate(page) {
  const errors = await openApp(page);
  await page.evaluate(() => {
    const s = __fcam.st();
    Object.assign(s.stock, { shape: 'rect', x: 100, y: 70, z: 8, rr: 0, rch: 0, origin: 'center' });
    s.ops = [];
    s.prog.fmt = 'plain';
  });
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await page.locator('#shBody').getByRole('button', { name: /По чертежу DXF/ }).click();
  return errors;
}

test('DXF → подтверждение → центровка и сверление → проверка, сохранение и экспорт', async ({ page }) => {
  const errors = await openPlate(page);
  await page.locator('#plateFile').setInputFiles(fixture('plate-4-holes.dxf'));
  const form = page.locator('#plateForm');
  const field = name => form.locator(`[name="${name}"]`);
  const submit = form.getByRole('button', { name: /Добавить операции/ });
  await expect(form).toContainText('не сопоставлено: 1');
  await expect(field('x0')).toHaveValue('-35.25');
  await expect(field('z0')).toHaveValue('');
  await expect(submit).toBeDisabled();
  for (let i = 0; i < 4; i++) {
    await field('z' + i).fill('11');
    await field('ok' + i).check();
  }
  await field('center').selectOption({ index: 1 });
  await field('drill').selectOption({ index: 1 });
  await field('centerZ').fill('1,5');
  await field('r').fill('2');
  await field('safe').fill('10');
  await field('setup').check();
  await expect(submit).toBeEnabled();
  await field('x0').fill('-36,5');
  await expect(field('ok0')).not.toBeChecked();
  await expect(submit).toBeDisabled();
  expect(await page.evaluate(() => __fcam.st().ops)).toEqual([]);
  await field('ok0').check();
  await field('setup').check();
  await submit.click();
  await expect(page.locator('#t-code')).toHaveClass(/\bon\b/);
  const result = await page.evaluate(async () => {
    const st = __fcam.st(), drawing = st.drawings[0], code = document.querySelector('#code').value;
    const { get, sha256 } = await import('/src/storage/idb.js');
    const record = await get('drawings', drawing.id);
    const parsed = __fcam.parse(code);
    const cutPoints = tool => [...new Set(parsed.segs
      .filter(s => s.tool === tool && !s.rapid && s.b.z < s.a.z && s.b.z < 0)
      .map(s => `${s.b.x} ${s.b.y} ${s.b.z}`))];
    const [center, drill] = st.ops.map(o => +st.tools.find(t => t.id === o.tool).num);
    return {
      ops: st.ops.map(o => [o.type, o.pat, o.depth]),
      checks: __fcam.checkProgram(code).filter(c => c.sev === 'err'),
      source: drawing.sources[0], hash: await sha256(record.file),
      observedX: drawing.observations[0].geom.cx, confirmedX: drawing.confirmed[0].geom.cx,
      center: cutPoints(center), drill: cutPoints(drill),
    };
  });
  expect(result.ops).toEqual([['drill', 'list', 1.5], ['drill', 'list', 11]]);
  expect(result.checks).toEqual([]);
  expect(result.observedX).toBe(-35.25);
  expect(result.confirmedX).toBe(-36.5);
  expect(result.hash).toBe(result.source.sha256);
  expect(result.center).toEqual(['-36.5 -20 -1.5', '35 -20 -1.5', '35 20 -1.5', '-35 20 -1.5']);
  expect(result.drill).toEqual(['-36.5 -20 -11', '35 -20 -11', '35 20 -11', '-35 20 -11']);
  await page.reload();
  await expect.poll(() => page.evaluate(() => __fcam.st().drawings[0].confirmed[0].geom.cx)).toBe(-36.5);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '⬇ Экспорт текущей файлом .nc' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.nc$/);
  const exported = await readFile(await file.path(), 'utf8');
  const [program, project] = exported.split(/\r?\n\(GCODE-CNC PROJECT[^\n]+\n/);
  expect(program).toContain('G98 G81 X-36.5 Y-20. Z-11.');
  expect(JSON.parse(project).drawings[0].confirmed[0].geom.cx).toBe(-36.5);
  expect(errors).toEqual([]);
});

test('DXF с другими единицами или неполным набором окружностей не меняет план', async ({ page }) => {
  await openPlate(page);
  const dxf = readFixture('plate-4-holes.dxf');
  const load = buffer => page.locator('#plateFile').setInputFiles({
    name: 'invalid.dxf', mimeType: 'application/dxf', buffer: Buffer.from(buffer),
  });
  await load(dxf.replace(/\$INSUNITS\r?\n70\r?\n4/, '$INSUNITS\n70\n0'));
  await expect(page.getByLabel('Единицы чертежа — миллиметры')).not.toBeChecked();
  await expect(page.locator('#plateValidation')).toContainText('Подтверди единицы DXF');
  await load(dxf.replace(/\$INSUNITS\r?\n70\r?\n4/, '$INSUNITS\n70\n1'));
  await expect(page.locator('#plateLoadStatus')).toContainText('в миллиметрах');
  await load(dxf.replace('CIRCLE', 'POINT'));
  await expect(page.locator('#plateLoadStatus')).toContainText('Найдено: 3');
  await expect(page.locator('#plateForm')).toHaveCount(0);
  expect(await page.evaluate(() => __fcam.st().ops)).toEqual([]);
});
