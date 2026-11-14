// ИИ-помощник в «По чертежу»: необязателен, по умолчанию выключен; ответ модели — только подсказки, сверенные с рисунком.
// Ollama здесь подменена (ответ задан в тесте); с настоящей моделью — задание fresa-ollama в ai-bench.yml.
const { test, expect } = require('playwright/test');
const { openApp, fixture } = require('../helpers');

async function prepare(page) {
  const errors = await openApp(page);
  await page.evaluate(() => { const s = __fcam.st(); Object.assign(s.stock, { shape: 'rect', x: 120, y: 80, z: 10, rr: 0, rch: 0, origin: 'corner' }); s.ops = []; });
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await page.locator('#shBody').getByRole('button', { name: /По чертежу/ }).click();
  return errors;
}

test('по умолчанию ИИ выключен, мастер работает без него', async ({ page }) => {
  const errors = await prepare(page);
  await page.locator('#plateFile').setInputFiles(fixture('drawings', '01-plate-4-holes', 'plate.pdf'));
  await expect(page.locator('#aiProv')).toHaveValue('none');
  await expect(page.locator('#aiRun')).toBeDisabled();
  await expect(page.locator('#aiStatus')).toContainText('без нейросети');
  expect(errors).toEqual([]);
});

test('Ollama не запущена — понятная причина, кнопка недоступна', async ({ page }) => {
  const errors = await prepare(page);
  await page.context().route('http://127.0.0.1:11434/**', r => r.abort());
  await page.locator('#plateFile').setInputFiles(fixture('drawings', '01-plate-4-holes', 'plate.pdf'));
  await page.locator('#aiProv').selectOption('ollama');
  await expect(page.locator('#aiStatus')).toContainText('Ollama не отвечает');
  await expect(page.locator('#aiRun')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('ответ модели: подсказки под полями, выдуманное отверстие отброшено, поля и подтверждения не тронуты', async ({ page }) => {
  const errors = await prepare(page);
  let asked = null;
  await page.context().route('http://127.0.0.1:11434/**', async r => {
    const u = r.request().url();
    if (u.endsWith('/api/tags')) return r.fulfill({ json: { models: [{ name: 'qwen3-vl:2b' }] } });
    asked = JSON.parse(r.request().postData());
    return r.fulfill({ json: { message: { content: JSON.stringify({ plate: { w: 120, h: 80 },
      holes: [{ x: 15, y: 15, d: 10 }, { x: 105, y: 15, d: 12 }, { x: 60, y: 40, d: 10 }], dims: ['15', '90', 'Ra 3,2'] }) } } });
  });
  await page.locator('#plateFile').setInputFiles(fixture('drawings', '01-plate-4-holes', 'plate.pdf'));
  await expect(page.locator('#plateForm fieldset')).toHaveCount(4);
  const before = await page.locator('#plateForm input').evaluateAll(els => els.map(e => e.type === 'checkbox' ? e.checked : e.value));
  await page.locator('#aiProv').selectOption('ollama');
  await expect(page.locator('#aiStatus')).toContainText('Ollama готова');
  await page.locator('#aiRun').click();
  await expect(page.locator('#aiOut')).toContainText('Подсказки — под отверстиями');
  // запрос: картинка, схема JSON, температура 0, модель из настроек
  expect(asked.model).toBe('qwen3-vl:2b');
  expect(asked.messages[0].images[0].length).toBeGreaterThan(1000);
  expect(asked.format.required).toEqual(['holes', 'dims']);
  expect(asked.options.temperature).toBe(0);
  // выдуманное отверстие (60,40) отброшено, Ø12 противоречит рисунку, «Ra 3,2» — непрочитанная надпись
  await expect(page.locator('#aiOut')).toContainText('которых нет на рисунке');
  await expect(page.locator('#aiOut')).toContainText('«Ra 3,2»');
  const hints = await page.locator('[id^=plateAi]:not([hidden])').allTextContents();
  expect(hints.some(t => /X ✓ · Y ✓ · Ø ✓/.test(t))).toBe(true);
  expect(hints.some(t => /окружность на рисунке другая — не используется/.test(t))).toBe(true);
  // поля и галочки — как были: ИИ ничего не подставил и ничего не подтвердил
  const after = await page.locator('#plateForm input').evaluateAll(els => els.map(e => e.type === 'checkbox' ? e.checked : e.value));
  expect(after).toEqual(before);
  await expect(page.locator('#plateForm button[type=submit]')).toBeDisabled();
  expect(errors).toEqual([]);
});
