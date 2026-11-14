// Генератор эталона №1 «Пластина с четырьмя отверстиями»: один источник правды → DXF, SVG, PDF (вектор) и PNG (растр).
// Запуск: node tests/fixtures/drawings/gen-plate.js  (нужен playwright с Chromium для PDF/PNG)
// Оформление близко к ГОСТ 2.307: цепочки размеров от базовых сторон, выносные от осей отверстий, полка-выноска «4 отв. Ø10».
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '01-plate-4-holes');
const W = 120, H = 80, D = 10, S = 10;                       // пластина 120×80, Ø10, толщина 10
const HOLES = [[15, 15], [105, 15], [15, 65], [105, 65]];
// размеры: [значение, ось, координата начала, конец, положение размерной линии]
const DIMS = [
  ['15', 'x', 0, 15, -10], ['90', 'x', 15, 105, -10], ['120', 'x', 0, 120, -20],
  ['15', 'y', 0, 15, -10], ['50', 'y', 15, 65, -10], ['80', 'y', 0, 80, -20],
];
const TH = 3.5;                                               // высота шрифта, мм

/* ---------- DXF (R2000, мм) ---------- */
function dxf() {
  const L = [];
  const g = (c, v) => L.push(String(c), String(v));
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$INSUNITS'); g(70, 4); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const line = (x1, y1, x2, y2, layer = '0') => { g(0, 'LINE'); g(8, layer); g(10, x1); g(20, y1); g(11, x2); g(21, y2); };
  line(0, 0, W, 0); line(W, 0, W, H); line(W, H, 0, H); line(0, H, 0, 0);
  for (const [x, y] of HOLES) {
    g(0, 'CIRCLE'); g(8, '0'); g(10, x); g(20, y); g(40, D / 2);
    line(x - 7, y, x + 7, y, 'AXIS'); line(x, y - 7, x, y + 7, 'AXIS');
  }
  for (const [txt, ax, a, b, at] of DIMS) {
    g(0, 'DIMENSION'); g(8, 'DIM'); g(1, '<>'); g(70, 32);
    if (ax === 'x') { g(10, b); g(20, at); g(11, (a + b) / 2); g(21, at + 2); g(13, a); g(23, a === 0 ? 0 : HOLES.find(h => h[0] === a)[1]); g(14, b); g(24, b === W ? 0 : HOLES.find(h => h[0] === b)[1]); g(50, 0); }
    else { g(10, at); g(20, b); g(11, at - 2); g(21, (a + b) / 2); g(13, a === 0 ? 0 : HOLES.find(h => h[1] === a)[0]); g(23, a); g(14, b === H ? 0 : HOLES.find(h => h[1] === b)[0]); g(24, b); g(50, 90); }
    g(42, +txt);
  }
  // диаметр: точки на окружности по диагонали отверстия (105,65), текст — свой
  g(0, 'DIMENSION'); g(8, 'DIM'); g(1, '4 отв. %%c10'); g(70, 3 + 32);
  const c = HOLES[3], r = D / 2, k = Math.SQRT1_2;
  g(10, c[0] - r * k); g(20, c[1] - r * k); g(15, c[0] + r * k); g(25, c[1] + r * k); g(11, 125); g(21, 82); g(42, D);
  g(0, 'TEXT'); g(8, '0'); g(10, 10); g(20, 90.5); g(40, TH); g(1, 'Толщина 10');
  g(0, 'ENDSEC'); g(0, 'EOF');
  return L.join('\n') + '\n';
}

/* ---------- SVG (страница 200×140 мм, геометрия смещена на (35, 30)) ---------- */
function svg() {
  const OX = 35, OY = 30, PH = 140;
  const X = x => (x + OX).toFixed(3), Y = y => (PH - (y + OY)).toFixed(3);
  const out = [];
  const ln = (x1, y1, x2, y2, w = 0.25, dash = '') => out.push(`<line x1="${X(x1)}" y1="${Y(y1)}" x2="${X(x2)}" y2="${Y(y2)}" stroke="#000" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
  const arrow = (x, y, dx, dy) => { const L = 2.5, B = 0.6, px = -dy, py = dx; out.push(`<path d="M${X(x)} ${Y(y)} L${X(x - dx * L + px * B)} ${Y(y - dy * L + py * B)} L${X(x - dx * L - px * B)} ${Y(y - dy * L - py * B)} Z" fill="#000" stroke="none"/>`); };
  const text = (x, y, s, rot = 0) => out.push(`<text x="${X(x)}" y="${Y(y)}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${TH}" text-anchor="middle"${rot ? ` transform="rotate(${-rot} ${X(x)} ${Y(y)})"` : ''}>${s}</text>`);
  ln(0, 0, W, 0, 0.6); ln(W, 0, W, H, 0.6); ln(W, H, 0, H, 0.6); ln(0, H, 0, 0, 0.6);
  for (const [x, y] of HOLES) {
    out.push(`<circle cx="${X(x)}" cy="${Y(y)}" r="${D / 2}" fill="none" stroke="#000" stroke-width="0.6"/>`);
    ln(x - 7, y, x + 7, y, 0.2, '4 1 1 1'); ln(x, y - 7, x, y + 7, 0.2, '4 1 1 1');
  }
  for (const [txt, ax, a, b, at] of DIMS) {
    if (ax === 'x') {
      const ya = a === 0 ? -1 : HOLES.find(h => h[0] === a)[1] - 7, yb = b === W ? -1 : HOLES.find(h => h[0] === b)[1] - 7;
      ln(a, ya, a, at - 2); ln(b, yb, b, at - 2); ln(a, at, b, at); arrow(a, at, -1, 0); arrow(b, at, 1, 0);
      text((a + b) / 2, at + 1, txt);
    } else {
      const xa = a === 0 ? -1 : HOLES.find(h => h[1] === a)[0] - 7, xb = b === H ? -1 : HOLES.find(h => h[1] === b)[0] - 7;
      ln(xa, a, at - 2, a); ln(xb, b, at - 2, b); ln(at, a, at, b); arrow(at, a, 0, -1); arrow(at, b, 0, 1);
      text(at - 1, (a + b) / 2, txt, 90);
    }
  }
  // выноска к отверстию (105,65) и полка с надписью
  const c = HOLES[3], a30 = Math.PI / 6, sx = c[0] + D / 2 * Math.cos(a30), sy = c[1] + D / 2 * Math.sin(a30);
  const ux = 128 - sx, uy = 74 - sy, ul = Math.hypot(ux, uy);
  ln(sx, sy, 128, 74); ln(128, 74, 150, 74); arrow(sx, sy, -ux / ul, -uy / ul); text(139, 75.2, '4 отв. Ø10');
  text(25, 92, 'Толщина 10');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="140mm" viewBox="0 0 200 140"><rect width="200" height="140" fill="#fff"/>${out.join('')}</svg>`;
}

const expected = {
  schema: 'fresa.drawing/1', name: 'Пластина 120×80, 4 отв. Ø10, толщина 10',
  plate: { w: W, h: H, thickness: S }, holes: HOLES.map(([x, y]) => ({ x, y, d: D })),
  note: 'Координаты от левого нижнего угла пластины. Размеры: цепочки 15+90 (X), 15+50 (Y), габариты 120 и 80, «4 отв. Ø10».',
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'plate.dxf'), dxf());
  const s = svg();
  fs.writeFileSync(path.join(OUT, 'plate.svg'), s);
  fs.writeFileSync(path.join(OUT, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { console.log('playwright нет — PDF/PNG не созданы'); return; }
  const b = await chromium.launch(), p = await b.newPage();
  await p.setContent(`<html><head><style>@page{size:200mm 140mm;margin:0}html,body{margin:0}</style></head><body>${s}</body></html>`);
  await p.pdf({ path: path.join(OUT, 'plate.pdf'), width: '200mm', height: '140mm', printBackground: true });
  await p.setViewportSize({ width: 1600, height: 1120 });
  await p.setContent(`<html><body style="margin:0">${s.replace('width="200mm" height="140mm"', 'width="1600" height="1120"')}</body></html>`);
  await p.screenshot({ path: path.join(OUT, 'plate.png') });
  await b.close();
  console.log('готово:', fs.readdirSync(OUT).join(', '));
}
main();
