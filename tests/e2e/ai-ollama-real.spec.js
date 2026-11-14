// НАСТОЯЩАЯ локальная модель через Ollama (задание fresa-ollama в ai-bench.yml). В обычном прогоне пропускается.
// Проверяет сквозной путь Fresa → Ollama → проверка геометрией → подсказки и пишет замеры в test-results/ollama-real.json.
const { test, expect } = require('playwright/test');
const fs = require('fs'), path = require('path');
const { openApp, FIX } = require('../helpers');

const REAL = !!process.env.FRESA_REAL_OLLAMA, MODEL = process.env.FRESA_OLLAMA_MODEL || 'qwen3-vl:2b-instruct';
const CASES = [['01-plate-4-holes', 'plate.png'], ['02-contour-radii', 'drawing.png'], ['06-chains', 'drawing.png'], ['07-tolerances', 'drawing.pdf'], ['09-conflict', 'drawing.png'], ['08-bad-scan', 'scan.jpg']];
const OUT = [];

for (const [set, file] of CASES) test(`Ollama ${MODEL}: ${set}/${file}`, async ({ page }) => {
  test.skip(!REAL, 'нужна запущенная Ollama с моделью (FRESA_REAL_OLLAMA=1)');
  test.setTimeout(900000);
  const errors = await openApp(page);
  await page.evaluate(m => { localStorage.setItem('fcam_ai', JSON.stringify({ provider: 'ollama', url: 'http://127.0.0.1:11434', model: m }));
    const s = __fcam.st(); Object.assign(s.stock, { shape: 'rect', x: 150, y: 80, z: 10, rr: 0, rch: 0, origin: 'corner' }); }, MODEL);
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await page.locator('#shBody').getByRole('button', { name: /По чертежу/ }).click();
  await page.locator('#plateFile').setInputFiles(path.join(FIX, 'drawings', set, file));
  await expect(page.locator('#plateForm')).toBeVisible({ timeout: 300000 });
  const before = await page.locator('#plateForm input').evaluateAll(els => els.map(e => e.type === 'checkbox' ? e.checked : e.value));
  await expect(page.locator('#aiStatus')).toContainText('Ollama готова', { timeout: 30000 });
  await page.locator('#aiRun').click();
  await expect(page.locator('#aiOut')).not.toContainText('ИИ смотрит', { timeout: 840000 });
  const res = { set, file, out: await page.locator('#aiOut').innerText(), hints: await page.locator('[id^=plateAi]:not([hidden])').allTextContents(),
    ai: await page.evaluate(() => window.__fresaLastAI) };
  OUT.push(res); fs.mkdirSync('test-results', { recursive: true }); fs.writeFileSync('test-results/ollama-real.json', JSON.stringify(OUT, null, 1));
  console.log(JSON.stringify(res));
  const after = await page.locator('#plateForm input').evaluateAll(els => els.map(e => e.type === 'checkbox' ? e.checked : e.value));
  expect(after, 'ИИ не меняет поля и подтверждения').toEqual(before);
  // интеграция работает: модель вернула JSON (раньше тест этого не требовал и пропустил пустые ответы)
  expect(res.ai && res.ai.ok, 'модель вернула JSON: ' + JSON.stringify(res.ai)).toBe(true);
  expect(res.out).toContain('Подсказки — под отверстиями');
  expect(errors).toEqual([]);
});
