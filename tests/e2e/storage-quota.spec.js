// Нехватка места в хранилище браузера (IndexedDB): понятное сообщение, план и проект не меняются, повтор возможен.
const { test, expect } = require('playwright/test');
const { openApp, fixture } = require('../helpers');

test('IndexedDB переполнено: чертёж не сохранён — операции не добавлены, сообщение понятное, после освобождения места всё работает', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...a) {
      if (window.__quota && this.name === 'drawings') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return put.apply(this, a);
    };
  });
  const errors = await openApp(page);
  await page.evaluate(() => { window.__quota = true; const s = __fcam.st(); Object.assign(s.stock, { shape: 'rect', x: 120, y: 80, z: 10, rr: 0, rch: 0, origin: 'corner' }); s.ops = [];
    s.tools.push({ id: 'tc', num: 21, type: 'center', d: 10, fl: 2, s: 1500, f: 150 }, { id: 'td', num: 22, type: 'drill', d: 10, fl: 2, s: 800, f: 100 }); });
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await page.locator('#shBody').getByRole('button', { name: /По чертежу/ }).click();
  await page.locator('#plateFile').setInputFiles(fixture('drawings', '01-plate-4-holes', 'plate.dxf'));
  const f = n => page.locator(`#plateForm [name="${n}"]`);
  for (let i = 0; i < 4; i++) { await f('z' + i).fill('8'); await f('ok' + i).check(); }
  await f('center').selectOption('tc'); await f('drill').selectOption('td'); await f('centerZ').fill('2'); await f('r').fill('2'); await f('safe').fill('20'); await f('setup').check();
  const before = await page.evaluate(() => localStorage.getItem('fcam'));
  await page.locator('#plateForm button[type=submit]').click();
  await expect(page.locator('#plateValidation')).toContainText(/места|памяти/);
  expect(await page.evaluate(() => __fcam.st().ops.length)).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('fcam'))).toBe(before);
  // место освободилось — та же форма сохраняется
  await page.evaluate(() => { window.__quota = false; });
  await expect(page.locator('#plateForm button[type=submit]')).toBeEnabled();
  await page.locator('#plateForm button[type=submit]').click();
  await expect(page.locator('#t-code')).toHaveClass(/\bon\b/);
  expect(await page.evaluate(() => __fcam.st().ops.length)).toBe(2);
  expect(errors).toEqual([]);
});
