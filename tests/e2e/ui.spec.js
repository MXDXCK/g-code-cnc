// Основной интерфейс: порядок вкладок, переходы без ошибок, отмена/повтор, 3D-шкала, режим новичка.
const { test, expect } = require('playwright/test');
const { openApp } = require('../helpers');

test('вкладки по порядку и открываются без ошибок', async ({ page }) => {
  const errors = await openApp(page);
  const tabs = await page.$$eval('#tabs button', b => b.map(x => x.dataset.t));
  expect(tabs).toEqual(['home', 'tools', 'ops', 'code', 'sim']);
  for (const t of [...tabs, 'proj', 'draw', 'home']) {
    await page.evaluate(t => __fcam.show(t), t);
    await page.waitForTimeout(150);
  }
  expect(errors).toEqual([]);
});

test('отмена и повтор удаления операции', async ({ page }) => {
  const errors = await openApp(page);
  const n0 = await page.evaluate(() => __fcam.st().ops.length);
  await page.evaluate(() => __fcam.show('ops'));
  await page.locator('.opc').nth(1).locator('.ac button[aria-label="Удалить"]').click();
  await expect.poll(() => page.evaluate(() => __fcam.st().ops.length)).toBe(n0 - 1);
  await page.click('#snack button');
  await expect.poll(() => page.evaluate(() => __fcam.st().ops.length)).toBe(n0);
  expect(errors).toEqual([]);
});

test('3D: шкала времени по операциям', async ({ page }) => {
  const errors = await openApp(page);
  await page.evaluate(() => __fcam.show('sim'));
  await page.waitForTimeout(800);
  const segs = await page.locator('#tl .tls, #tl > div, #tl span').count();
  expect(segs).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('режим новичка: мастер новой детали открывается', async ({ page }) => {
  const errors = await openApp(page, { mode: 'easy' });
  await page.evaluate(() => __fcam.show('home'));
  await page.click('.hnew');
  await expect(page.locator('#wiz')).toBeVisible();
  expect(errors).toEqual([]);
});
