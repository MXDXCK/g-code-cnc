// Перевод своей программы в параметрию: резание после перевода совпадает с исходным.
const { test, expect } = require('playwright/test');
const { openApp, readFixture } = require('../helpers');

const CASES = [
  ['face_strips.nc', { strips: 4 }],
  ['pocket_rings.nc', { strips: 3 }],
  ['contour_ij.nc', {}],
  ['strips_uneven.nc', { strips: 3 }],
  ['fresa_generated_mix.nc', { exact: true }],
];

for (const [file, exp] of CASES) {
  test(`параметрия: ${file}`, async ({ page }) => {
    const errors = await openApp(page);
    const r = await page.evaluate(s => {
      const r = __fcam.toMacro(s);
      return r.err ? { err: r.err } : { dev: r.dev, cdev: r.cdev, err1: r.err1, l0: r.lines0, l1: r.lines1, ns: r.loops.map(l => l.ns) };
    }, readFixture('nc', file));
    expect(r.err).toBeUndefined();
    expect(r.err1 || '').toBe('');
    expect(r.cdev).not.toBeNull();
    expect(r.cdev).toBeLessThan(0.002);
    if (exp.exact) expect(r.dev).toBeLessThan(0.002);
    if (exp.strips) expect(r.ns).toContain(exp.strips);
    expect(r.l1).toBeLessThan(r.l0);
    expect(errors).toEqual([]);
  });
}
