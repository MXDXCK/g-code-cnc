// Чертёж → геометрия и размеры: DXF (точно), векторный PDF (pdf.js), фото (автообводка + OCR). Эталон №1 — пластина 4 отв.
const { test, expect } = require('playwright/test');
const fs = require('fs');
const { openApp, fixture } = require('../helpers');

const expected = JSON.parse(fs.readFileSync(fixture('drawings', '01-plate-4-holes', 'expected.json'), 'utf8'));
const sortH = a => a.map(h => [h.x, h.y, h.d]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);

test('векторный PDF: отверстия и размеры по эталону, без конфликтов', async ({ page }) => {
  const errors = await openApp(page);
  const b64 = fs.readFileSync(fixture('drawings', '01-plate-4-holes', 'plate.pdf')).toString('base64');
  const r = await page.evaluate(async b64 => {
    const P = await import('/src/drawing/import-pdf.js'), A = await import('/src/drawing/associate.js');
    const lib = await P.loadPdfjs(false);
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const d = await P.importPDF(bytes, lib);
    const r = A.associate({ ...d, units: 'mm' });
    return { vector: d.vector, nSeg: d.segs.length, nC: d.circles.length, texts: d.texts.map(t => t.s), conflicts: r.conflicts, notes: r.notes,
      holes: r.holes.map(h => ({ x: h.x.value, y: h.y.value, d: h.d.value, src: [h.x.source, h.y.source, h.d.source].join('/') })),
      w: r.outline && r.outline.w, h: r.outline && r.outline.h, th: r.thickness, dims: r.dims.map(x => x.text + ':' + x.status) };
  }, b64);
  console.log(JSON.stringify(r, null, 1));
  expect(r.vector).toBe(true);
  expect(r.nC).toBe(4);
  expect(r.conflicts).toEqual([]);
  expect(sortH(r.holes)).toEqual(sortH(expected.holes));
  expect(r.holes.every(h => h.src === 'dimension/dimension/dimension')).toBe(true);
  expect(r.w.value).toBe(expected.plate.w);
  expect(r.h.value).toBe(expected.plate.h);
  expect(r.th.value).toBe(expected.plate.thickness);
  expect(errors).toEqual([]);
});

// Растр: синтетическая «идеальная» картинка 1600×1120 (8 пикс/мм). Это проверка алгоритма, а не точности по реальным фото.
const rasterRun = (page, withOcr) => page.evaluate(async ({ b64, withOcr }) => {
  const R = await import('/src/drawing/import-raster.js'), A = await import('/src/drawing/associate.js');
  const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
  const ocr = withOcr ? await window.__fresaOcrWorker({ tessedit_pageseg_mode: '11' }) : null;
  const d = await R.importRaster(blob, { at: window.__at, ocr });
  if (ocr) await ocr.terminate();
  const r = A.associate({ ...d });
  return { circles: d.circles.map(c => [c.cx, c.cy, c.r]), texts: d.texts.map(t => t.s), warnings: d.warnings, scale: r.scale, conflicts: r.conflicts,
    holes: r.holes.map(h => ({ x: h.x.value, y: h.y.value, d: h.d.value, src: [h.x.source, h.y.source, h.d.source].join('/') })),
    w: r.outline && r.outline.w, h: r.outline && r.outline.h, th: r.thickness, dims: r.dims.map(x => x.text + ':' + x.status) };
}, { b64: fs.readFileSync(fixture('drawings', '01-plate-4-holes', 'plate.png')).toString('base64'), withOcr });

test('растр без OCR: 4 окружности отверстий найдены (центр ±1 пикс.)', async ({ page }) => {
  const errors = await openApp(page);
  const r = await rasterRun(page, false);
  // ожидание в пикселях картинки (ось Y вверх): (x+35)·8, (y+30)·8, r = 5·8
  const want = expected.holes.map(h => [(h.x + 35) * 8, (h.y + 30) * 8]);
  expect(r.circles.length).toBe(4);
  for (const [x, y] of want) {
    const c = r.circles.find(c => Math.hypot(c[0] - x, c[1] - y) <= 1.5);
    expect(c, `окружность у (${x},${y})`).toBeTruthy();
    expect(Math.abs(c[2] - 40)).toBeLessThan(1.5);
  }
  expect(r.holes.every(h => h.src.startsWith('measured'))).toBe(true);   // без надписей — только измерено, не «по размеру»
  expect(errors).toEqual([]);
});

test('растр + OCR: размеры привязаны к геометрии, координаты — по размерам', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await openApp(page);
  const r = await rasterRun(page, true);
  console.log(JSON.stringify(r, null, 1));
  expect(Math.abs(r.scale.s - 0.125) / 0.125).toBeLessThan(0.01);
  expect(r.scale.n).toBeGreaterThanOrEqual(4);
  expect(r.conflicts).toEqual([]);
  expect(sortH(r.holes)).toEqual(sortH(expected.holes));
  expect(r.holes.every(h => h.src === 'dimension/dimension/dimension')).toBe(true);
  expect(r.w.value).toBe(expected.plate.w);
  expect(r.h.value).toBe(expected.plate.h);
  // «Толщина» — кириллица; OCR работает с eng, поэтому толщину с картинки не берём — её подтверждает пользователь
  expect(r.th == null || r.th.value === expected.plate.thickness).toBe(true);
  expect(errors).toEqual([]);
});

// Ухудшенная картинка (меньше, размыта, шум, JPEG) — как плохой скан. Требование: ничего не выдумывать.
// Координата либо «по размеру» и точно равна эталону, либо «измерено» и тогда в пределах 1 мм; конфликтов нет.
for (const [k, blur, noise, q] of [[0.75, 1, 12, 0.6], [0.6, 1.2, 20, 0.5]]) test(`растр ухудшенный ×${k}: размеры не выдумываются`, async ({ page }) => {
  test.setTimeout(120000);
  const errors = await openApp(page);
  const b64 = fs.readFileSync(fixture('drawings', '01-plate-4-holes', 'plate.png')).toString('base64');
  const r = await page.evaluate(async ({ b64, k, blur, noise, q }) => {
    const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
    const cv = document.createElement('canvas'); cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
    const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); c.filter = `blur(${blur}px)`; c.drawImage(im, 0, 0, cv.width, cv.height); c.filter = 'none';
    const id = c.getImageData(0, 0, cv.width, cv.height); let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < id.data.length; i += 4) { const n = (rnd() - 0.5) * 2 * noise; for (let j = 0; j < 3; j++) id.data[i + j] = Math.max(0, Math.min(255, id.data[i + j] * 0.92 + 10 + n)); }
    c.putImageData(id, 0, 0);
    const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', q));
    const R = await import('/src/drawing/import-raster.js'), A = await import('/src/drawing/associate.js');
    const ocr = await window.__fresaOcrWorker({ tessedit_pageseg_mode: '11' });
    const d = await R.importRaster(blob, { at: window.__at, ocr }); await ocr.terminate();
    const r = A.associate({ ...d });
    return { nC: d.circles.length, conflicts: r.conflicts, holes: r.holes.map(h => ({ x: h.x, y: h.y, d: h.d })), w: r.outline && r.outline.w, h: r.outline && r.outline.h };
  }, { b64, k, blur, noise, q });
  console.log(JSON.stringify(r));
  expect(r.nC).toBe(4);
  expect(r.conflicts).toEqual([]);
  const ok = (o, want) => o && (o.source === 'dimension' ? o.value === want : o.source === 'measured' && Math.abs(o.value - want) <= 1);
  for (const want of expected.holes) {
    const h = r.holes.find(h => Math.abs(h.x.value - want.x) <= 1 && Math.abs(h.y.value - want.y) <= 1);
    expect(h, `отверстие (${want.x},${want.y})`).toBeTruthy();
    expect(ok(h.x, want.x) && ok(h.y, want.y) && ok(h.d, want.d)).toBe(true);
  }
  expect(ok(r.w, expected.plate.w) && ok(r.h, expected.plate.h)).toBe(true);
  expect(errors).toEqual([]);
});
