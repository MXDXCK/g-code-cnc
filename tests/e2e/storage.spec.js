// IndexedDB: резервная копия localStorage без изменения localStorage; работа без IndexedDB; файлы с контрольной суммой.
const { test, expect } = require('playwright/test');
const { openApp } = require('../helpers');

const snapshot = page => page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
const waitBackup = page => page.waitForFunction(() => window.__storeBackup, null, { timeout: 15000 });

test('резервная копия: localStorage не меняется, копия совпадает, повтор безопасен', async ({ page }) => {
  const errors = await openApp(page);
  await page.evaluate(() => { __fcam.st().prog.name = 'ТЕСТ'; });          // реальные данные проекта
  await page.evaluate(() => __fcam.show('ops'));
  await waitBackup(page);
  const before = await snapshot(page);
  const r1 = await page.evaluate(() => window.__store.backupLocalStorage());
  expect(r1.ok).toBe(true);
  const after = await snapshot(page);
  expect(after).toEqual(before);                                           // localStorage не тронут
  const same = await page.evaluate(async keys => {
    const bad = [];
    for (const k of keys) { const r = await window.__store.get('kv', 'ls:' + k); if (!r || r.v !== localStorage.getItem(k)) bad.push(k); }
    return bad;
  }, r1.keys);
  expect(same).toEqual([]);
  const r2 = await page.evaluate(() => window.__store.backupLocalStorage());
  expect(r2.copied).toBe(0);
  expect(r2.unchanged).toBe(r1.keys.length);
  await page.evaluate(() => localStorage.setItem('fcam_mode', 'easy'));
  const r3 = await page.evaluate(() => window.__store.backupLocalStorage());
  expect(r3.copied).toBe(1);
  expect(errors).toEqual([]);
});

test('без IndexedDB Fresa работает как раньше', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); });
  const errors = await openApp(page);
  await waitBackup(page);
  const before = await snapshot(page);
  const r = await page.evaluate(() => window.__storeBackup);
  expect(r.ok).toBe(false);
  expect(r.reason).toMatch(/IndexedDB/);
  const code = await page.evaluate(() => __fcam.gen());
  expect(code).toContain('M30');
  expect(await snapshot(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('файл в хранилище: запись, проверка суммы, чтение', async ({ page }) => {
  await openApp(page);
  await waitBackup(page);
  const r = await page.evaluate(async () => {
    const b = new Blob(['пластина 4 отв'], { type: 'text/plain' });
    const info = await window.__store.putBlob('t1', b, { name: 'a.txt' });
    const back = await window.__store.getBlob('t1');
    return { info, text: await back.text(), sha: await window.__store.sha256(back) };
  });
  expect(r.text).toBe('пластина 4 отв');
  expect(r.sha).toBe(r.info.sha256);
});
