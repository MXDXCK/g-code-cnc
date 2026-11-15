// Набор эталонных чертежей №02–09: одно описание → DXF (с DIMENSION), DXF «разбитый» (линии + TEXT, как после
// «Расчленить» в CAD), SVG, PDF (вектор), PNG (8 пикс/мм) и expected.json — эталонная геометрия ОТДЕЛЬНО от файлов,
// которые читает приложение. Чертежи нарисованы по ГОСТ 2.307 «как обычно», без подстройки под алгоритм.
// Запуск: node tests/fixtures/drawings/gen-set.js  (PDF/PNG — через playwright/Chromium)
const fs = require('fs');
const path = require('path');

const TH = 3.5;                                   // высота шрифта, мм
const PX = 8;                                     // пикселей на мм в PNG
const rad = d => d * Math.PI / 180;

/* ---------- построители геометрии ---------- */
function rrect(x0, y0, w, h, r) {               // прямоугольник со скруглёнными углами
  if (!r) return { lines: [[x0, y0, x0 + w, y0], [x0 + w, y0, x0 + w, y0 + h], [x0 + w, y0 + h, x0, y0 + h], [x0, y0 + h, x0, y0]], arcs: [] };
  return {
    lines: [[x0 + r, y0, x0 + w - r, y0], [x0 + w, y0 + r, x0 + w, y0 + h - r], [x0 + w - r, y0 + h, x0 + r, y0 + h], [x0, y0 + h - r, x0, y0 + r]],
    arcs: [[x0 + w - r, y0 + r, r, 270, 360], [x0 + w - r, y0 + h - r, r, 0, 90], [x0 + r, y0 + h - r, r, 90, 180], [x0 + r, y0 + r, r, 180, 270]],
  };
}
function slot(cx1, cx2, cy, w) {                 // горизонтальный паз
  const r = w / 2;
  return { lines: [[cx1, cy - r, cx2, cy - r], [cx2, cy + r, cx1, cy + r]], arcs: [[cx2, cy, r, 270, 450], [cx1, cy, r, 90, 270]] };
}
const merge = (...g) => ({ lines: g.flatMap(x => x.lines || []), arcs: g.flatMap(x => x.arcs || []) });

/* ---------- чертежи ---------- */
const SET = [];

// 02: контур со скруглёнными углами + 2 отверстия
{
  const o = rrect(0, 0, 100, 60, 8);
  SET.push({
    id: '02-contour-radii', name: 'Пластина 100×60, углы R8, 2 отв. Ø8', page: [180, 120], off: [40, 32],
    geom: { ...o, circles: [[20, 30, 4], [80, 30, 4]] },
    dims: [
      { t: 'lin', ax: 'x', a: [0, 8], b: [100, 8], at: -20, text: '100' },
      { t: 'lin', ax: 'x', a: [0, 8], b: [20, 30], gb: 6, at: -10, text: '20' },
      { t: 'lin', ax: 'x', a: [20, 30], b: [80, 30], ga: 6, gb: 6, at: -10, text: '60' },
      { t: 'lin', ax: 'y', a: [8, 0], b: [8, 60], at: -20, text: '60' },
      { t: 'lin', ax: 'y', a: [8, 0], b: [20, 30], gb: 6, at: -10, text: '30' },
      { t: 'dia', c: [80, 30], r: 4, ang: 45, to: [96, 74], text: '2 отв. Ø8' },
      { t: 'rad', c: [92, 52], r: 8, ang: 45, to: [110, 70], text: 'R8' },
    ],
    expected: { plate: { w: 100, h: 60 }, holes: [[20, 30, 8], [80, 30, 8]], fillets: { r: 8, corners: 4 } },
  });
}
// 03: прямоугольный карман (отверстий нет)
{
  SET.push({
    id: '03-pocket', name: 'Пластина 120×80, карман 60×30 R5 глубиной 5', page: [200, 140], off: [40, 32],
    geom: merge(rrect(0, 0, 120, 80, 0), rrect(30, 25, 60, 30, 5)),
    dims: [
      { t: 'lin', ax: 'x', a: [0, 0], b: [120, 0], at: -20, text: '120' },
      { t: 'lin', ax: 'x', a: [0, 0], b: [30, 25], at: -10, text: '30' },
      { t: 'lin', ax: 'x', a: [30, 25], b: [90, 25], at: -10, text: '60' },
      { t: 'lin', ax: 'y', a: [0, 0], b: [0, 80], at: -20, text: '80' },
      { t: 'lin', ax: 'y', a: [0, 0], b: [30, 25], at: -10, text: '25' },
      { t: 'lin', ax: 'y', a: [30, 25], b: [30, 55], at: -10, text: '30' },
    ],
    texts: [[60, 92, 'Карман глубина 5']],
    expected: { plate: { w: 120, h: 80 }, holes: [], pockets: [{ x0: 30, y0: 25, w: 60, h: 30, r: 5, depth: 5 }] },
  });
}
// 04: паз + одно отверстие
{
  SET.push({
    id: '04-slot', name: 'Пластина 100×50, паз 10×40, отв. Ø6', page: [180, 120], off: [40, 32],
    geom: { ...merge(rrect(0, 0, 100, 50, 0), slot(35, 65, 25, 10)), circles: [[15, 25, 3]] },
    dims: [
      { t: 'lin', ax: 'x', a: [0, 0], b: [100, 0], at: -20, text: '100' },
      { t: 'lin', ax: 'x', a: [0, 0], b: [15, 25], gb: 5, at: -10, text: '15' },
      { t: 'lin', ax: 'x', a: [15, 25], b: [35, 25], ga: 5, gb: 7, at: -10, text: '20' },
      { t: 'lin', ax: 'x', a: [35, 25], b: [65, 25], ga: 7, gb: 7, at: -10, text: '30' },
      { t: 'lin', ax: 'y', a: [0, 0], b: [0, 50], at: -20, text: '50' },
      { t: 'lin', ax: 'y', a: [0, 0], b: [15, 25], ga: 1, gb: 5, at: -10, text: '25' },
      { t: 'lin', ax: 'y', a: [65, 20], b: [65, 30], at: 110, text: '10' },
      { t: 'dia', c: [15, 25], r: 3, ang: 135, to: [2, 40], text: 'Ø6', left: true },
    ],
    expected: { plate: { w: 100, h: 50 }, holes: [[15, 25, 6]], slots: [{ c1: [35, 25], c2: [65, 25], w: 10 }] },
  });
}
// 05: два вида — вид сверху и вид сбоку (толщина), скрытые линии отверстий
{
  const side = rrect(140, 0, 10, 80, 0);
  SET.push({
    id: '05-multiview', name: 'Пластина 120×80×10 в двух видах, 2 отв. Ø12', page: [240, 140], off: [40, 32],
    geom: { ...merge(rrect(0, 0, 120, 80, 0), side), circles: [[30, 40, 6], [90, 40, 6]], hidden: [[140, 34, 150, 34], [140, 46, 150, 46]], marks: [[30, 40], [90, 40]], axes: [[138, 40, 152, 40]] },
    dims: [
      { t: 'lin', ax: 'x', a: [0, 0], b: [120, 0], at: -20, text: '120' },
      { t: 'lin', ax: 'x', a: [0, 0], b: [30, 40], gb: 8, at: -10, text: '30' },
      { t: 'lin', ax: 'x', a: [30, 40], b: [90, 40], ga: 8, gb: 8, at: -10, text: '60' },
      { t: 'lin', ax: 'y', a: [0, 0], b: [0, 80], at: -20, text: '80' },
      { t: 'lin', ax: 'y', a: [0, 0], b: [30, 40], gb: 8, at: -10, text: '40' },
      { t: 'lin', ax: 'x', a: [140, 0], b: [150, 0], at: -10, text: '10' },
      { t: 'dia', c: [90, 40], r: 6, ang: 45, to: [108, 70], text: '2 отв. Ø12' },
    ],
    expected: { plate: { w: 120, h: 80, thickness: 10 }, holes: [[30, 40, 12], [90, 40, 12]], views: 2 },
  });
}
// 06: размерные цепочки, замкнутая цепь (избыточная, но непротиворечивая)
{
  const xs = [15, 40, 65, 90, 135];
  const ch = [[0, 15], [15, 40], [40, 65], [65, 90], [90, 135], [135, 150]];
  SET.push({
    id: '06-chains', name: 'Планка 150×60, 5 отв. Ø6, цепочка размеров', page: [220, 120], off: [35, 32],
    geom: { ...rrect(0, 0, 150, 60, 0), circles: xs.map(x => [x, 30, 3]) },
    dims: [
      ...ch.map(([a, b]) => ({ t: 'lin', ax: 'x', a: [a, a === 0 ? 0 : 30], b: [b, b === 150 ? 0 : 30], ga: a === 0 ? 1 : 5, gb: b === 150 ? 1 : 5, at: -10, text: String(b - a) })),
      { t: 'lin', ax: 'x', a: [0, 0], b: [150, 0], at: -20, text: '150' },
      { t: 'lin', ax: 'y', a: [0, 0], b: [0, 60], at: -20, text: '60' },
      { t: 'lin', ax: 'y', a: [0, 0], b: [15, 30], gb: 5, at: -10, text: '30' },
      { t: 'dia', c: [135, 30], r: 3, ang: 45, to: [150, 72], text: '5 отв. Ø6' },
    ],
    expected: { plate: { w: 150, h: 60 }, holes: xs.map(x => [x, 30, 6]) },
  });
}
// 07: допуски
{
  SET.push({
    id: '07-tolerances', name: 'Пластина 80×60, 2 отв. Ø10H7, размеры с допусками', page: [170, 120], off: [40, 32],
    geom: { ...rrect(0, 0, 80, 60, 0), circles: [[20, 30, 5], [60, 30, 5]] },
    dims: [
      { t: 'lin', ax: 'x', a: [0, 0], b: [80, 0], at: -20, text: '80±0,2' },
      { t: 'lin', ax: 'x', a: [0, 0], b: [20, 30], gb: 7, at: -10, text: '20' },
      { t: 'lin', ax: 'x', a: [20, 30], b: [60, 30], ga: 7, gb: 7, at: -10, text: '40±0,05' },
      { t: 'lin', ax: 'y', a: [0, 0], b: [0, 60], at: -20, text: '60' },
      { t: 'lin', ax: 'y', a: [0, 0], b: [20, 30], gb: 7, at: -10, text: '30' },
      { t: 'dia', c: [60, 30], r: 5, ang: 45, to: [76, 74], text: '2 отв. Ø10H7' },
    ],
    expected: { plate: { w: 80, h: 60 }, holes: [[20, 30, 10, 'H7'], [60, 30, 10, 'H7']], tol: { '80': [0.2, -0.2], '40': [0.05, -0.05] } },
  });
}
// 09: противоречие — отверстие нарисовано в X=100, а размеры говорят 15+90=105
{
  SET.push({
    id: '09-conflict', name: 'Пластина 120×80: размер 90 не совпадает с рисунком (нарисовано 85)', page: [200, 140], off: [35, 30],
    geom: { ...rrect(0, 0, 120, 80, 0), circles: [[15, 15, 5], [100, 15, 5], [15, 65, 5], [100, 65, 5]] },
    dims: [
      { t: 'lin', ax: 'x', a: [0, 0], b: [15, 15], gb: 7, at: -10, text: '15' },
      { t: 'lin', ax: 'x', a: [15, 15], b: [100, 15], ga: 7, gb: 7, at: -10, text: '90' },
      { t: 'lin', ax: 'x', a: [0, 0], b: [120, 0], at: -20, text: '120' },
      { t: 'lin', ax: 'y', a: [0, 0], b: [15, 15], gb: 7, at: -10, text: '15' },
      { t: 'lin', ax: 'y', a: [15, 15], b: [15, 65], ga: 7, gb: 7, at: -10, text: '50' },
      { t: 'lin', ax: 'y', a: [0, 0], b: [0, 80], at: -20, text: '80' },
      { t: 'dia', c: [100, 65], r: 5, ang: 30, to: [126, 76], text: '4 отв. Ø10' },
    ],
    expected: { plate: { w: 120, h: 80 }, holes: [[15, 15, 10], [100, 15, 10, null, 105], [15, 65, 10], [100, 65, 10, null, 105]], conflict: true,
      note: 'Ожидается конфликт «размер 90 ≠ рисунок 85», а не «угаданное» значение. Координата X правых отверстий не должна быть выдана как «по размеру» без конфликта.' },
  });
}

/* ---------- примитивы чертежа (общие для SVG и «разбитого» DXF) ---------- */
function prims(D) {
  const L = [], T = [], A = [];                   // линии [x1,y1,x2,y2,w,dash], тексты [x,y,s,rot], стрелки [x,y,dx,dy]
  const g = D.geom;
  for (const l of g.lines || []) L.push([...l, 0.6, '']);
  for (const h of g.hidden || []) L.push([...h, 0.3, '2 1']);
  for (const a of g.axes || []) L.push([...a, 0.2, '4 1 1 1']);
  for (const [cx, cy, r] of g.circles || []) { const e = r + 2; L.push([cx - e, cy, cx + e, cy, 0.2, '4 1 1 1'], [cx, cy - e, cx, cy + e, 0.2, '4 1 1 1']); }
  for (const d of D.dims) {
    if (d.t === 'lin') {
      const X = d.ax === 'x', k = X ? 1 : 0;      // k — индекс координаты, вдоль которой идёт выносная
      const ga = d.ga ?? 1, gb = d.gb ?? 1;
      const ext = (p, gap) => { const s = Math.sign(d.at - p[k]); const q0 = [...p], q1 = [...p]; q0[k] = p[k] + s * gap; q1[k] = d.at + s * 2; L.push([...q0, ...q1, 0.25, '']); };
      ext(d.a, ga); ext(d.b, gb);
      const u = X ? 0 : 1, a = d.a[u], b = d.b[u];
      const p1 = X ? [a, d.at] : [d.at, a], p2 = X ? [b, d.at] : [d.at, b];
      L.push([...p1, ...p2, 0.25, '']);
      A.push([...p1, X ? -1 : 0, X ? 0 : -1], [...p2, X ? 1 : 0, X ? 0 : 1]);
      T.push(X ? [(a + b) / 2, d.at + 1, d.text, 0] : [d.at - 1, (a + b) / 2, d.text, 90]);
    } else {
      const [cx, cy] = d.c, s = [cx + d.r * Math.cos(rad(d.ang)), cy + d.r * Math.sin(rad(d.ang))];
      const w = 0.62 * TH * d.text.length + 2, dir = d.left ? -1 : 1, end = [d.to[0] + dir * w, d.to[1]];
      L.push([...s, ...d.to, 0.25, ''], [...d.to, ...end, 0.25, '']);
      const ux = d.to[0] - s[0], uy = d.to[1] - s[1], ul = Math.hypot(ux, uy);
      A.push([...s, -ux / ul, -uy / ul]);
      T.push([(d.to[0] + end[0]) / 2, d.to[1] + 1.2, d.text, 0]);
    }
  }
  for (const [x, y, s] of D.texts || []) T.push([x, y, s, 0]);
  return { L, T, A };
}

/* ---------- SVG ---------- */
function svg(D) {
  const [PW, PH] = D.page, [OX, OY] = D.off;
  const X = x => (x + OX).toFixed(3), Y = y => (PH - (y + OY)).toFixed(3);
  const out = [], { L, T, A } = prims(D);
  for (const [x1, y1, x2, y2, w, dash] of L) out.push(`<line x1="${X(x1)}" y1="${Y(y1)}" x2="${X(x2)}" y2="${Y(y2)}" stroke="#000" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
  for (const [cx, cy, r] of D.geom.circles || []) out.push(`<circle cx="${X(cx)}" cy="${Y(cy)}" r="${r}" fill="none" stroke="#000" stroke-width="0.6"/>`);
  for (const [cx, cy, r, a0, a1] of D.geom.arcs || []) {
    const p = a => [cx + r * Math.cos(rad(a)), cy + r * Math.sin(rad(a))], [x0, y0] = p(a0), [x1, y1] = p(a1);
    out.push(`<path d="M${X(x0)} ${Y(y0)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 0 ${X(x1)} ${Y(y1)}" fill="none" stroke="#000" stroke-width="0.6"/>`);
  }
  for (const [x, y, dx, dy] of A) { const l = 2.5, b = 0.6, px = -dy, py = dx; out.push(`<path d="M${X(x)} ${Y(y)} L${X(x - dx * l + px * b)} ${Y(y - dy * l + py * b)} L${X(x - dx * l - px * b)} ${Y(y - dy * l - py * b)} Z" fill="#000"/>`); }
  for (const [x, y, s, rot] of T) out.push(`<text x="${X(x)}" y="${Y(y)}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${TH}" text-anchor="middle"${rot ? ` transform="rotate(${-rot} ${X(x)} ${Y(y)})"` : ''}>${s}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PW}mm" height="${PH}mm" viewBox="0 0 ${PW} ${PH}"><rect width="${PW}" height="${PH}" fill="#fff"/>${out.join('')}</svg>`;
}

/* ---------- DXF ---------- */
function dxf(D, exploded) {
  const out = [], g = (c, v) => out.push(String(c), String(v));
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$INSUNITS'); g(70, 4); g(0, 'ENDSEC'); g(0, 'SECTION'); g(2, 'ENTITIES');
  const line = (x1, y1, x2, y2, layer = '0') => { g(0, 'LINE'); g(8, layer); g(10, x1); g(20, y1); g(11, x2); g(21, y2); };
  const text = (x, y, s, rot = 0) => { g(0, 'TEXT'); g(8, 'DIM'); g(10, x); g(20, y); g(40, TH); g(1, s.replace(/Ø/g, '%%c').replace(/±/g, '%%p')); if (rot) g(50, rot); g(72, 1); g(73, 0); g(11, x); g(21, y); };
  for (const l of D.geom.lines || []) line(...l);
  for (const l of D.geom.hidden || []) line(...l, 'HIDDEN');
  for (const l of D.geom.axes || []) line(...l, 'AXIS');
  for (const [cx, cy, r] of D.geom.circles || []) { g(0, 'CIRCLE'); g(8, '0'); g(10, cx); g(20, cy); g(40, r); const e = r + 2; line(cx - e, cy, cx + e, cy, 'AXIS'); line(cx, cy - e, cx, cy + e, 'AXIS'); }
  for (const [cx, cy, r, a0, a1] of D.geom.arcs || []) { g(0, 'ARC'); g(8, '0'); g(10, cx); g(20, cy); g(40, r); g(50, a0 % 360); g(51, a1 % 360 || 360); }
  if (exploded) {
    const { L, T } = prims(D);
    const nGeom = (D.geom.lines || []).length + (D.geom.hidden || []).length + (D.geom.axes || []).length + 2 * (D.geom.circles || []).length;
    for (const [x1, y1, x2, y2] of L.slice(nGeom)) line(x1, y1, x2, y2, 'DIM');
    for (const [x, y, s, rot] of T) text(x, y, s, rot);
  } else {
    for (const d of D.dims) {
      g(0, 'DIMENSION'); g(8, 'DIM');
      if (d.t === 'lin') {
        const X = d.ax === 'x', meas = Math.abs(X ? d.b[0] - d.a[0] : d.b[1] - d.a[1]);
        g(1, String(+d.text.replace(',', '.')) === String(+meas.toFixed(4)) ? '<>' : d.text.replace(/±/g, '%%p')); g(70, 32);
        if (X) { g(10, d.b[0]); g(20, d.at); g(11, (d.a[0] + d.b[0]) / 2); g(21, d.at + 2); } else { g(10, d.at); g(20, d.b[1]); g(11, d.at - 2); g(21, (d.a[1] + d.b[1]) / 2); }
        g(13, d.a[0]); g(23, d.a[1]); g(14, d.b[0]); g(24, d.b[1]); g(50, X ? 0 : 90); g(42, meas);
      } else if (d.t === 'dia') {
        const [cx, cy] = d.c, k = [Math.cos(rad(d.ang)), Math.sin(rad(d.ang))];
        g(1, d.text.replace(/Ø/g, '%%c')); g(70, 3 + 32);
        g(10, cx - d.r * k[0]); g(20, cy - d.r * k[1]); g(15, cx + d.r * k[0]); g(25, cy + d.r * k[1]); g(11, d.to[0]); g(21, d.to[1]); g(42, 2 * d.r);
      } else {
        const [cx, cy] = d.c; g(1, d.text); g(70, 4 + 32);
        g(10, cx); g(20, cy); g(15, cx + d.r * Math.cos(rad(d.ang))); g(25, cy + d.r * Math.sin(rad(d.ang))); g(11, d.to[0]); g(21, d.to[1]); g(42, d.r);
      }
    }
    for (const [x, y, s] of D.texts || []) text(x, y, s);
  }
  g(0, 'ENDSEC'); g(0, 'EOF');
  return out.join('\n') + '\n';
}

/* ---------- запуск ---------- */
async function main() {
  let chromium = null;
  try { ({ chromium } = require('playwright')); } catch (e) { console.log('playwright нет — PDF/PNG не созданы'); }
  const b = chromium && await chromium.launch(), p = b && await b.newPage();
  for (const D of SET) {
    const dir = path.join(__dirname, D.id); fs.mkdirSync(dir, { recursive: true });
    const s = svg(D);
    fs.writeFileSync(path.join(dir, 'drawing.svg'), s);
    fs.writeFileSync(path.join(dir, 'drawing.dxf'), dxf(D, false));
    fs.writeFileSync(path.join(dir, 'drawing-lines.dxf'), dxf(D, true));
    const E = D.expected;
    fs.writeFileSync(path.join(dir, 'expected.json'), JSON.stringify({
      schema: 'fresa.drawing-expected/1', name: D.name, units: 'mm', origin: 'левый нижний угол детали',
      plate: E.plate, holes: E.holes.map(([x, y, d, fit, xDim]) => ({ x, y, d, ...(fit ? { fit } : {}), ...(xDim ? { xDim, note: 'по размерам X=' + xDim + ', нарисовано ' + x + ' — допустимо любое из двух, но только с пометкой о конфликте' } : {}) })),
      ...(E.fillets ? { fillets: E.fillets } : {}), ...(E.pockets ? { pockets: E.pockets } : {}), ...(E.slots ? { slots: E.slots } : {}),
      ...(E.tol ? { tolerances: E.tol } : {}), ...(E.views ? { views: E.views } : {}), conflict: !!E.conflict, ...(E.note ? { note: E.note } : {}),
      dims: D.dims.map(d => d.text),
    }, null, 2) + '\n');
    if (!p) continue;
    const [PW, PH] = D.page;
    await p.setContent(`<html><head><style>@page{size:${PW}mm ${PH}mm;margin:0}html,body{margin:0}</style></head><body>${s}</body></html>`);
    await p.pdf({ path: path.join(dir, 'drawing.pdf'), width: PW + 'mm', height: PH + 'mm', printBackground: true });
    await p.setViewportSize({ width: PW * PX, height: PH * PX });
    await p.setContent(`<html><body style="margin:0">${s.replace(`width="${PW}mm" height="${PH}mm"`, `width="${PW * PX}" height="${PH * PX}"`)}</body></html>`);
    await p.screenshot({ path: path.join(dir, 'drawing.png') });
  }
  // 08: «плохой скан» цепочки №06 — поворот 1°, уменьшение, размытие, желтоватая бумага, шум, JPEG
  if (p) {
    const src = fs.readFileSync(path.join(__dirname, '06-chains', 'drawing.png')).toString('base64');
    await p.setContent('<html><body></body></html>');
    const jpg = await p.evaluate(async src => {
      const im = new Image(); im.src = 'data:image/png;base64,' + src; await im.decode();
      const W = Math.round(im.width * 0.8), H = Math.round(im.height * 0.8), cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const c = cv.getContext('2d'); c.fillStyle = '#f3ecd8'; c.fillRect(0, 0, W, H);
      c.translate(W / 2, H / 2); c.rotate(Math.PI / 180); c.translate(-W / 2, -H / 2); c.filter = 'blur(1px)'; c.globalCompositeOperation = 'multiply'; c.drawImage(im, 0, 0, W, H);
      c.setTransform(1, 0, 0, 1, 0, 0); c.filter = 'none'; c.globalCompositeOperation = 'source-over';
      const id = c.getImageData(0, 0, W, H); let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < id.data.length; i += 4) { const n = (r() - 0.5) * 36; for (let j = 0; j < 3; j++) id.data[i + j] = Math.max(0, Math.min(255, id.data[i + j] * 0.9 + 12 + n)); }
      c.putImageData(id, 0, 0);
      return cv.toDataURL('image/jpeg', 0.55).split(',')[1];
    }, src);
    const dir = path.join(__dirname, '08-bad-scan'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'scan.jpg'), Buffer.from(jpg, 'base64'));
    const e = JSON.parse(fs.readFileSync(path.join(__dirname, '06-chains', 'expected.json'), 'utf8'));
    e.name = 'Плохой скан чертежа №06: поворот 1°, ×0,8, размытие, жёлтая бумага, шум, JPEG 55%';
    e.note = 'Требование — ничего не выдумывать: значения «по размеру» должны быть верными, остальное — «измерено» или пусто.';
    fs.writeFileSync(path.join(dir, 'expected.json'), JSON.stringify(e, null, 2) + '\n');
  }
  if (b) await b.close();
  console.log('готово:', SET.map(d => d.id).join(', '), '+ 08-bad-scan');
}
if (require.main === module) main();
module.exports = { SET, svg, dxf, PX };
