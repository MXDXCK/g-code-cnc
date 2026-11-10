// Общие помощники автотестов Fresa (Playwright, CommonJS).
// three.js: в CI берётся из node_modules (npm install), локально — из THREE_DIR, иначе заглушка tests/fixtures/three_stub.js.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = 'http://127.0.0.1:' + (process.env.FRESA_TEST_PORT || 8765) + '/index.html';
const FIX = path.join(__dirname, 'fixtures');

function threeFiles() {
  const cands = [];
  try { cands.push(path.dirname(require.resolve('three/package.json'))); } catch (e) { /* нет в node_modules */ }
  if (process.env.THREE_DIR) cands.push(process.env.THREE_DIR);
  for (const d of cands) {
    const a = [path.join(d, 'build/three.module.js'), path.join(d, 'three.module.js')].find(fs.existsSync);
    const b = [path.join(d, 'examples/jsm/controls/OrbitControls.js'), path.join(d, 'OrbitControls.js')].find(fs.existsSync);
    if (a && b) return { three: fs.readFileSync(a, 'utf8'), orbit: fs.readFileSync(b, 'utf8'), real: true };
  }
  const stub = fs.readFileSync(path.join(FIX, 'three_stub.js'), 'utf8');
  return { three: stub, orbit: stub, real: false };
}
const THREE = threeFiles();

/** Открыть приложение с чистым состоянием. opts.mode: 'pro'|'easy'; opts.keepStorage — не чистить localStorage. */
async function openApp(page, opts = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.route('https://unpkg.com/**', r => r.fulfill({
    status: 200, contentType: 'application/javascript',
    body: r.request().url().includes('OrbitControls') ? THREE.orbit : THREE.three,
  }));
  // распознавание текста (Tesseract с CDN) в тестах не загружаем
  await page.route('https://cdn.jsdelivr.net/**', r => r.abort());
  const mode = opts.mode || 'pro';
  await page.addInitScript(([mode, keep]) => {
    // флаг в самом localStorage: при перезагрузке страницы данные не стираются
    if (!keep && !localStorage.getItem('__fresa_test')) {
      localStorage.clear();
      localStorage.setItem('__fresa_test', '1');
      localStorage.setItem('fcam_terms2', '1'); localStorage.setItem('fcam_terms1', '1');
      localStorage.setItem('fcam_mode', mode); localStorage.setItem('fcam_safe1', '1');
    }
  }, [mode, !!opts.keepStorage]);
  await page.goto(APP);
  await page.waitForFunction(() => !!window.__fcam, null, { timeout: 15000 });
  return errors;
}

const fixture = (...p) => path.join(FIX, ...p);
const readFixture = (...p) => fs.readFileSync(fixture(...p), 'utf8');

module.exports = { ROOT, APP, FIX, THREE, openApp, fixture, readFixture };
