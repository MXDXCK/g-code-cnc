// Безопасный подвод снаружи заготовки: обычный и параметрический G-код дают одну траекторию.
const { test, expect } = require('playwright/test');
const { openApp } = require('../helpers');

const CASES = [
  ['rect', { x: 120, y: 80 }, { type: 'contourRect', cx: 0, cy: 0, w: 110, h: 70, side: 'out', depth: 6, step: 2, wall: 0, over: 45 }, true],
  ['rect wall', { x: 140, y: 100 }, { type: 'contourRect', cx: 0, cy: 0, w: 110, h: 70, side: 'out', depth: 6, step: 2, wall: 15, over: 45 }, true],
  ['circle', { x: 120, y: 80 }, { type: 'contourCircle', cx: 0, cy: 0, d: 70, side: 'out', depth: 6, step: 2, wall: 10, over: 45 }, true],
  ['oval', { x: 120, y: 80 }, { type: 'contourOval', cx: 0, cy: 0, l: 100, w: 60, ang: 20, side: 'out', depth: 6, step: 2, wall: 5, over: 45 }, true],
  ['polygon', { x: 120, y: 80 }, { type: 'polygon', cx: 0, cy: 0, n: 6, sw: 60, ang: 0, side: 'out', depth: 6, step: 2, wall: 5, over: 45, blank: 0 }, true],
  ['rect in', { x: 120, y: 80 }, { type: 'contourRect', cx: 0, cy: 0, w: 60, h: 40, side: 'in', depth: 6, step: 2, wall: 0, over: 45 }, false],
];

for (const [name, stk, op, outside] of CASES) {
  test(`подвод: ${name}`, async ({ page }) => {
    const errors = await openApp(page);
    const r = await page.evaluate(([stk, op]) => {
      const F = __fcam, st = F.st(), T = st.tools.find(t => t.type == 'endmill');
      Object.assign(st.stock, { shape: 'rect', x: stk.x, y: stk.y, z: 30, origin: 'center' });
      const o = { id: 'x', on: true, safe: 10, dmode: 'rem', tool: T.id, ...op };
      const out = {};
      for (const fmt of ['plain', 'macro']) { st.prog.fmt = fmt; const c = F.opCode(o).code; const P = F.parse(c); out[fmt] = { err: P.err, pts: P.segs.filter(s => !s.rapid).map(s => [s.b.x, s.b.y, s.b.z]), first: P.segs.find(s => !s.rapid) }; }
      let md = 0; const a = out.plain.pts, b = out.macro.pts;
      for (let i = 0; i < Math.min(a.length, b.length); i++) md = Math.max(md, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1], a[i][2] - b[i][2]));
      const f = out.plain.first.a, r = T.d / 2, X = stk.x / 2 + r, Y = stk.y / 2 + r;
      return { n: [a.length, b.length], md, err: (out.plain.err || '') + (out.macro.err || ''), plungeOutside: Math.abs(f.x) >= X || Math.abs(f.y) >= Y };
    }, [stk, op]);
    expect(r.err).toBe('');
    expect(r.n[0]).toBe(r.n[1]);
    expect(r.md).toBeLessThan(0.002);
    if (outside) expect(r.plungeOutside, 'врезание должно быть вне заготовки').toBe(true);
    expect(errors).toEqual([]);
  });
}
