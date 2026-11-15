// ИСКУССТВЕННЫЕ «фото» эталонных чертежей (это не настоящие фотографии!) и чертёж с неполной цепочкой размеров.
//  • synth-*.jpg в папках 02 и 06: перспектива, тень и плохой свет, размытие, неоднородный фон, помехи —
//    искажения рисуются программно из drawing.png, эталон тот же (expected.json).
//  • 10-incomplete-chain: цепочка №06 без двух звеньев — X отверстия 65 по размерам определить нельзя
//    (expected.json: unknownX) — значение «по размеру» для него было бы выдумкой.
// Запуск: node tests/fixtures/drawings/gen-synth.js   (нужен playwright/Chromium)
const fs = require('fs'), path = require('path');
const { SET, svg, dxf, PX } = require('./gen-set');
const { chromium } = require('playwright');

const VARIANTS = {
  // лист снят под углом: верх дальше — сжат, низ ближе; поворот ~3°; серый стол вокруг
  perspective: { quad: [[0.07, 0.10], [0.95, 0.04], [0.99, 0.93], [0.02, 0.97]], bg: 'table', light: 0.95 },
  // тень от руки/телефона по диагонали и общий недостаток света
  shadow: { quad: [[0.03, 0.03], [0.97, 0.03], [0.97, 0.97], [0.03, 0.97]], bg: 'plain', light: 0.7, shadow: true },
  // нерезкое фото (дрожание): размытие ~1.6 пикс.
  blur: { quad: [[0.03, 0.03], [0.97, 0.03], [0.97, 0.97], [0.03, 0.97]], bg: 'plain', light: 0.95, blur: 1.6 },
  // лист на тёмном неоднородном фоне (дерево/ткань), чуть повёрнут, виньетка
  background: { quad: [[0.10, 0.12], [0.90, 0.08], [0.92, 0.88], [0.08, 0.92]], bg: 'wood', light: 0.9, vignette: true },
  // помехи: зерно, пятна, мусор на листе, сильное сжатие JPEG
  noise: { quad: [[0.03, 0.03], [0.97, 0.03], [0.97, 0.97], [0.03, 0.97]], bg: 'plain', light: 0.92, noise: 40, specks: 400, jpeg: 0.45 },
};

async function distort(p, srcB64, v, seed) {
  return p.evaluate(async ({ srcB64, v, seed }) => {
    let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const im = new Image(); im.src = 'data:image/png;base64,' + srcB64; await im.decode();
    const sw = im.width, sh = im.height, src = document.createElement('canvas'); src.width = sw; src.height = sh;
    const sc = src.getContext('2d'); if (v.blur) sc.filter = `blur(${v.blur}px)`; sc.drawImage(im, 0, 0); sc.filter = 'none';
    const S = sc.getImageData(0, 0, sw, sh).data;
    const W = Math.round(sw * 1.05), H = Math.round(sh * 1.05), out = document.createElement('canvas'); out.width = W; out.height = H;
    const c = out.getContext('2d'), D = c.createImageData(W, H), d = D.data;
    // гомография: углы листа (0,0)(sw,0)(sw,sh)(0,sh) → четырёхугольник quad (доли кадра); обратное отображение пикселей кадра
    const Q = v.quad.map(([x, y]) => [x * W, y * H]), P = [[0, 0], [sw, 0], [sw, sh], [0, sh]];
    const A = [], B = [];
    for (let i = 0; i < 4; i++) { const [X, Y] = Q[i], [x, y] = P[i];   // кадр → лист
      A.push([X, Y, 1, 0, 0, 0, -x * X, -x * Y]); B.push(x); A.push([0, 0, 0, X, Y, 1, -y * X, -y * Y]); B.push(y); }
    for (let i = 0; i < 8; i++) { let m = i; for (let r = i + 1; r < 8; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r;
      [A[i], A[m]] = [A[m], A[i]]; [B[i], B[m]] = [B[m], B[i]];
      for (let r = 0; r < 8; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let k = i; k < 8; k++) A[r][k] -= f * A[i][k]; B[r] -= f * B[i]; } }
    const h = B.map((b, i) => b / A[i][i]);
    const bg = (x, y) => {
      if (v.bg === 'table') return 120 + 15 * Math.sin(x / 37) * Math.cos(y / 53) + (rnd() - 0.5) * 20;
      if (v.bg === 'wood') return 70 + 35 * Math.sin(x / 9 + 4 * Math.sin(y / 60)) + (rnd() - 0.5) * 30;
      return 200 + (rnd() - 0.5) * 10;
    };
    for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
      const w = h[6] * X + h[7] * Y + 1, x = (h[0] * X + h[1] * Y + h[2]) / w, y = (h[3] * X + h[4] * Y + h[5]) / w, o = (Y * W + X) * 4;
      let g;
      if (x >= 0 && y >= 0 && x < sw - 1 && y < sh - 1) {     // билинейно
        const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, I = (xx, yy) => S[(yy * sw + xx) * 4];
        g = (I(x0, y0) * (1 - fx) + I(x0 + 1, y0) * fx) * (1 - fy) + (I(x0, y0 + 1) * (1 - fx) + I(x0 + 1, y0 + 1) * fx) * fy;
        g = g * 0.93 + 8;                                           // бумага не идеально белая
      } else g = bg(X, Y);
      let L = v.light;
      if (v.shadow) { const t = (X / W + Y / H - 0.7) * 3; L *= t > 0 ? Math.max(0.45, 1 - 0.55 * Math.min(1, t)) : 1; }
      if (v.vignette) { const r = Math.hypot(X / W - 0.5, Y / H - 0.5); L *= 1 - 0.6 * r * r; }
      g = g * L + (v.noise ? (rnd() - 0.5) * v.noise : (rnd() - 0.5) * 8);
      d[o] = Math.max(0, Math.min(255, g + 6)); d[o + 1] = Math.max(0, Math.min(255, g + 2)); d[o + 2] = Math.max(0, Math.min(255, g - 6)); d[o + 3] = 255;
    }
    c.putImageData(D, 0, 0);
    if (v.specks) for (let i = 0; i < v.specks; i++) { c.fillStyle = `rgba(40,30,20,${0.2 + 0.5 * rnd()})`; c.beginPath(); c.arc(rnd() * W, rnd() * H, 0.6 + 1.8 * rnd(), 0, 7); c.fill(); }
    return out.toDataURL('image/jpeg', v.jpeg || 0.8).split(',')[1];
  }, { srcB64, v, seed });
}

(async () => {
  const b = await chromium.launch(), p = await b.newPage();
  await p.setContent('<html><body></body></html>');
  // 10: неполная цепочка — №06 без звеньев 40–65 и 65–90
  const D06 = SET.find(d => d.id === '06-chains');
  const D = { ...D06, id: '10-incomplete-chain', name: 'Планка 150×60, 5 отв. Ø6, в цепочке нет двух звеньев (X отв. 65 не задан)',
    dims: D06.dims.filter(d => !(d.t === 'lin' && d.ax === 'x' && ['25'].includes(d.text) && d.a[0] >= 40 && d.a[0] < 90)) };
  if (D.dims.length !== D06.dims.length - 2) throw new Error('не удалось убрать звенья цепочки');
  const dir = path.join(__dirname, D.id); fs.mkdirSync(dir, { recursive: true });
  const s = svg(D);
  fs.writeFileSync(path.join(dir, 'drawing.svg'), s);
  fs.writeFileSync(path.join(dir, 'drawing.dxf'), dxf(D, false));
  fs.writeFileSync(path.join(dir, 'drawing-lines.dxf'), dxf(D, true));
  fs.writeFileSync(path.join(dir, 'expected.json'), JSON.stringify({
    schema: 'fresa.drawing-expected/1', name: D.name, units: 'mm', origin: 'левый нижний угол детали',
    plate: D.expected.plate, holes: D.expected.holes.map(([x, y, dd]) => ({ x, y, d: dd })), conflict: false,
    unknownX: [65], note: 'X отверстия 65 по размерам не определяется: допустимо «измерено» или пусто, но не «по размеру».',
    dims: D.dims.map(q => q.text),
  }, null, 2) + '\n');
  const [PW, PH] = D.page;
  await p.setContent(`<html><head><style>@page{size:${PW}mm ${PH}mm;margin:0}html,body{margin:0}</style></head><body>${s}</body></html>`);
  await p.pdf({ path: path.join(dir, 'drawing.pdf'), width: PW + 'mm', height: PH + 'mm', printBackground: true });
  await p.setViewportSize({ width: PW * PX, height: PH * PX });
  await p.setContent(`<html><body style="margin:0">${s.replace(`width="${PW}mm" height="${PH}mm"`, `width="${PW * PX}" height="${PH * PX}"`)}</body></html>`);
  await p.screenshot({ path: path.join(dir, 'drawing.png') });

  // искусственные «фото» №02 и №06
  await p.setContent('<html><body></body></html>');
  let seed = 11;
  for (const id of ['02-contour-radii', '06-chains']) {
    const src = fs.readFileSync(path.join(__dirname, id, 'drawing.png')).toString('base64');
    for (const [name, v] of Object.entries(VARIANTS)) {
      const jpg = await distort(p, src, v, seed++);
      fs.writeFileSync(path.join(__dirname, id, `synth-${name}.jpg`), Buffer.from(jpg, 'base64'));
    }
  }
  await b.close();
  console.log('готово: 10-incomplete-chain, synth-*.jpg в 02 и 06');
})();
