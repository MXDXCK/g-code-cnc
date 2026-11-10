// Своя (открытая) программа: инструменты из кода, не пропадает при переключении формата, правке заготовки и перезапуске.
const { test, expect } = require('playwright/test');
const { openApp, fixture, readFixture } = require('../helpers');

const man = page => page.evaluate(() => __fcam.man() && !!__fcam.imp());

for (const file of ['face_strips.nc', 'contour_ij.nc', 'fresa_generated_mix.nc']) {
  test(`открытая программа сохраняется: ${file}`, async ({ page }) => {
    const errors = await openApp(page);
    await page.setInputFiles('#ncF', fixture('nc', file));
    await page.waitForTimeout(1200);
    if (await page.locator('#ctM').count()) await page.click('#ctM [data-m=add]');
    expect(await man(page)).toBe(true);
    for (const f of ['plain', 'macro', 'plain']) {
      await page.evaluate(f => setFmtB(f), f);
      await page.waitForTimeout(300);
      expect(await man(page), 'после переключения формата ' + f).toBe(true);
    }
    await page.evaluate(() => setCmt('cyr'));
    expect(await man(page)).toBe(true);
    await page.reload();
    await page.waitForFunction(() => !!window.__fcam);
    const dbg = await page.evaluate(() => JSON.stringify({ man: __fcam.man(), imp: !!__fcam.imp(), keys: Object.keys(localStorage).join(',') }));
    expect(await man(page), 'после перезапуска ' + dbg).toBe(true);
    await page.evaluate(() => srcBack());
    expect(await page.evaluate(() => document.querySelector('#code').value.replace(/\r/g, '').trim()))
      .toBe(readFixture('nc', file).replace(/\r/g, '').trim());
    expect(errors).toEqual([]);
  });
}

test('инструменты из программы: найдены номера, тип и Ø', async ({ page }) => {
  await openApp(page);
  const t = await page.evaluate(src => __fcam.codeTools(src).map(f => [f.num, f.type, f.d]), readFixture('nc', 'fresa_generated_mix.nc'));
  expect(t.length).toBeGreaterThan(2);
  expect(t.every(([n, , d]) => n > 0 && d > 0)).toBe(true);
});
