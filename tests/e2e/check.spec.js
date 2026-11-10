// Проверка программы: три уровня — ошибка, предупреждение, «не проверено» (ограничения проверки и 3D-модели).
const { test, expect } = require('playwright/test');
const { openApp } = require('../helpers');

test('у любой программы есть раздел «Не проверено» с ограничениями симуляции', async ({ page }) => {
  const errors = await openApp(page);
  const L = await page.evaluate(() => __fcam.checkProgram(__fcam.gen()));
  const nv = L.filter(c => c.sev === 'nv').map(c => c.msg);
  expect(nv.some(m => /Державка/.test(m))).toBe(true);
  expect(nv.some(m => /Пределы осей/.test(m))).toBe(true);
  expect(nv.some(m => /корректоров H\/D/.test(m))).toBe(true);
  expect(L.filter(c => c.sev === 'err')).toEqual([]);
  expect(errors).toEqual([]);
});

test('ограничения добавляются по содержимому программы', async ({ page }) => {
  await openApp(page);
  const msgs = await page.evaluate(() => __fcam.checkProgram('%\nO1\nT1 M06\nS1000 M03\nG90 G54 G18 G0 X0 Y0 Z10\nM98 P100\n#1=5\nG1 Z-#1 F100\nM30\n%')
    .filter(c => c.sev === 'nv').map(c => c.msg).join('\n'));
  expect(msgs).toMatch(/G18\/G19/);
  expect(msgs).toMatch(/M98/);
  expect(msgs).toMatch(/Параметрическая/);
});

test('сводка во вкладке G-код показывает «не проверено»', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => __fcam.show('code'));
  await expect(page.locator('#chkBox summary')).toContainText('не проверено');
  await page.locator('#chkBox summary').click();
  await expect(page.locator('#chkBox .chk.nv').first()).toBeVisible();
});
