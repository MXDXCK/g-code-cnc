// Автотесты Fresa. Запуск: npm test (в CI) или см. tests/README.md для запуска без npm.
const { defineConfig } = require('playwright/test');

module.exports = defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'test-report' }]] : 'list',
  webServer: { command: 'node tests/server.js', url: 'http://127.0.0.1:8765/index.html', reuseExistingServer: !process.env.CI, timeout: 20_000 },
  use: {
    browserName: 'chromium',
    viewport: { width: 400, height: 860 },
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] },
  },
});
