// Векторный PDF → отрезки, окружности, надписи (pdf.js, Apache-2.0). Без растеризации: координаты из файла.
// Если в PDF нет векторных линий (скан), возвращает {vector:false} — тогда чертёж идёт по ветке «фото».

const PT2MM = 25.4 / 72;

/**
 * Загрузить pdf.js: из приложения (lib/pdfjs, сборка APK/EXE — файлы сохранены как .js, чтобы WebView отдал их как скрипт)
 * или с CDN (сайт).
 */
export async function loadPdfjs(local) {
  const base = local ? new URL('lib/pdfjs/', location.href).href : 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/legacy/build/', ext = local ? '.js' : '.mjs';
  const lib = await import(/* @vite-ignore */ base + 'pdf.min' + ext);
  lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min' + ext;
  return lib;
}

/** Отрисовать страницу PDF в картинку (для сканов без векторных линий). */
export async function renderPdfPage(data, pdfjs, { page: pageNo = 1, maxSide = 1600 } = {}) {
  const doc = await pdfjs.getDocument({ data: data instanceof Uint8Array ? data : new Uint8Array(data), isEvalSupported: false }).promise;
  const page = await doc.getPage(pageNo), v1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: maxSide / Math.max(v1.width, v1.height) });
  const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return await new Promise(res => cv.toBlob(res, 'image/png'));
}

const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Окружность по точкам (метод Каса). */
function fitCircle(P) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0; const n = P.length;
  for (const [x, y] of P) { const z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; }
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], b = [sxz, syz, sz];
  const det = M => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const D = det(A); if (Math.abs(D) < 1e-12) return null;
  const col = (i) => A.map((r, k) => r.map((v, j) => j === i ? b[k] : v));
  const a = det(col(0)) / D, bb = det(col(1)) / D, c = det(col(2)) / D, cx = a / 2, cy = bb / 2, r = Math.sqrt(c + cx * cx + cy * cy);
  const err = Math.max(...P.map(([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - r)));
  return { cx, cy, r, err };
}
const bez = (p0, p1, p2, p3, t) => { const u = 1 - t; return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]; };

/**
 * @param {ArrayBuffer|Uint8Array} data  содержимое PDF
 * @param {object} pdfjs                 модуль pdf.js (loadPdfjs)
 */
export async function importPDF(data, pdfjs, { page: pageNo = 1 } = {}) {
  const doc = await pdfjs.getDocument({ data: data instanceof Uint8Array ? data : new Uint8Array(data), isEvalSupported: false }).promise;
  const page = await doc.getPage(pageNo);
  const { fnArray, argsArray } = await page.getOperatorList();
  const OPS = pdfjs.OPS, STROKE = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const segs = [], circles = [];
  let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], a = argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, a);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (a && a[0]) ctm = mul(ctm, a[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === OPS.constructPath) {
      const paint = a[0], path = a[1] && a[1][0];
      if (!STROKE.has(paint) || !path) continue;                          // заливки (стрелки, штриховка) не нужны
      const d = Array.from(path); let k = 0, cur = null, start = null, curves = [], lines = [];
      const flush = () => {
        if (curves.length >= 4) {                                           // замкнутая фигура из кривых → окружность?
          const pts = []; for (const c of curves) for (let t = 0; t < 1; t += 0.125) pts.push(bez(c[0], c[1], c[2], c[3], t));
          const f = fitCircle(pts); if (f && f.r > 0 && f.err < Math.max(0.01 * f.r, 0.05)) { circles.push({ cx: f.cx * PT2MM, cy: f.cy * PT2MM, r: f.r * PT2MM, src: 'pdf' }); curves = []; return; }
        }
        for (const c of curves) { let p = c[0]; for (let t = 0.125; t <= 1.0001; t += 0.125) { const q = bez(c[0], c[1], c[2], c[3], t); lines.push([p, q]); p = q; } }
        curves = [];
      };
      while (k < d.length) {
        const op = d[k++];
        if (op === 0) { flush(); cur = start = ap(ctm, d[k], d[k + 1]); k += 2; }
        else if (op === 1) { const p = ap(ctm, d[k], d[k + 1]); k += 2; if (cur) lines.push([cur, p]); cur = p; }
        else if (op === 2) { const p1 = ap(ctm, d[k], d[k + 1]), p2 = ap(ctm, d[k + 2], d[k + 3]), p3 = ap(ctm, d[k + 4], d[k + 5]); k += 6; if (cur) curves.push([cur, p1, p2, p3]); cur = p3; }
        else if (op === 3) { const p1 = ap(ctm, d[k], d[k + 1]), p2 = ap(ctm, d[k + 2], d[k + 3]); k += 4; if (cur) curves.push([cur, [(cur[0] + 2 * p1[0]) / 3, (cur[1] + 2 * p1[1]) / 3], [(p2[0] + 2 * p1[0]) / 3, (p2[1] + 2 * p1[1]) / 3], p2]); cur = p2; }
        else if (op === 4) { if (cur && start && (cur[0] !== start[0] || cur[1] !== start[1])) lines.push([cur, start]); cur = start; }
        else break;
      }
      flush();
      for (const [p, q] of lines) if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-3) segs.push({ x1: p[0] * PT2MM, y1: p[1] * PT2MM, x2: q[0] * PT2MM, y2: q[1] * PT2MM, src: 'pdf' });
    }
  }
  // надписи: pdf.js даёт кусочки строк — склеиваем соседние на одной линии
  const tc = await page.getTextContent();
  const raw = tc.items.filter(it => it.str && it.str.trim()).map(it => {
    const [a, b, c, d2, e, f] = it.transform, ang = Math.atan2(b, a), h = Math.hypot(c, d2) || it.height;
    return { s: it.str, x0: e, y0: f, w: it.width, h, ang };
  });
  raw.sort((p, q) => Math.abs(p.ang - q.ang) > 0.01 ? p.ang - q.ang : (Math.abs(p.y0 - q.y0) > 0.5 ? q.y0 - p.y0 : p.x0 - q.x0));
  const merged = [];
  for (const t of raw) {
    const L = merged[merged.length - 1];
    if (L && Math.abs(L.ang - t.ang) < 0.01) {
      const ca = Math.cos(t.ang), sa = Math.sin(t.ang), endX = L.x0 + L.w * ca, endY = L.y0 + L.w * sa;
      const gap = (t.x0 - endX) * ca + (t.y0 - endY) * sa, off = Math.abs(-(t.x0 - L.x0) * sa + (t.y0 - L.y0) * ca);
      if (off < 0.3 * t.h && gap > -0.3 * t.h && gap < 0.8 * t.h) { L.s += (gap > 0.15 * t.h ? ' ' : '') + t.s; L.w = (t.x0 - L.x0) * ca + (t.y0 - L.y0) * sa + t.w; continue; }
    }
    merged.push({ ...t });
  }
  const texts = merged.map(t => {
    const ca = Math.cos(t.ang), sa = Math.sin(t.ang), cx = t.x0 + (t.w / 2) * ca - (t.h * 0.35) * sa, cy = t.y0 + (t.w / 2) * sa + (t.h * 0.35) * ca;
    return { s: t.s.trim(), x: cx * PT2MM, y: cy * PT2MM, h: t.h * PT2MM, ang: t.ang * 180 / Math.PI, src: 'pdf' };
  });
  const view = page.view;   // [x0,y0,x1,y1] в pt
  return { units: 'mm', vector: segs.length + circles.length > 0, segs, circles, texts, pages: doc.numPages, pageSizeMM: [(view[2] - view[0]) * PT2MM, (view[3] - view[1]) * PT2MM], warnings: doc.numPages > 1 ? ['в PDF несколько страниц — взята страница ' + pageNo] : [] };
}
