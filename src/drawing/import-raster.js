// Фото / скан чертежа → отрезки, окружности, надписи (в пикселях, ось Y вверх) — без нейросети.
// Линии: адаптивный порог и утоньшение из автообводки Fresa (window.__at.atLines), отрезки — Дуглас–Пекер.
// Окружности: голосование краёв (Хаф) + проверка, что кольцо чернил обходит ≥ 75% окружности; центр уточняется по скелету.
// Надписи: Tesseract (уже есть в приложении), режим «разреженный текст» + второй проход для повёрнутых на 90°.
// Ограничения прототипа: снимок должен быть ровным (без сильной перспективы), язык распознавания — eng (цифры и латиница).

const rdp = (P, eps) => {
  if (P.length < 3) return P;
  let iMax = 0, dMax = 0; const [a, b] = [P[0], P[P.length - 1]], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
  for (let i = 1; i < P.length - 1; i++) { const d = Math.abs((b[0] - a[0]) * (a[1] - P[i][1]) - (a[0] - P[i][0]) * (b[1] - a[1])) / L; if (d > dMax) { dMax = d; iMax = i; } }
  return dMax > eps ? rdp(P.slice(0, iMax + 1), eps).slice(0, -1).concat(rdp(P.slice(iMax), eps)) : [a, b];
};
function fitC(P) {
  const n = P.length; if (n < 5) return null; let sx = 0, sy = 0; for (const p of P) { sx += p[0]; sy += p[1]; } const mx = sx / n, my = sy / n;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of P) { const u = p[0] - mx, v = p[1] - my; suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u; }
  const det = suu * svv - suv * suv; if (Math.abs(det) < 1e-9) return null;
  const b1 = (suuu + suvv) / 2, b2 = (svvv + svuu) / 2, uc = (b1 * svv - b2 * suv) / det, vc = (suu * b2 - suv * b1) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n), cx = uc + mx, cy = vc + my;
  let e = 0; for (const p of P) { const d = Math.hypot(p[0] - cx, p[1] - cy) - r; e += d * d; }
  return { cx, cy, r, rms: Math.sqrt(e / n) };
}

/**
 * Склеить куски скелета. Трассировщик автообводки рвёт наклонные линии и дуги на «ступеньки» по 1–3 пикселя;
 * здесь кусок продолжается соседним (концы ≤ 2 пикс.), который лучше всего сохраняет направление (≤ 35°).
 * На перекрёстках линия идёт прямо, ответвление остаётся отдельным куском.
 */
function linkPieces(pieces) {
  const key = (x, y) => Math.round(x) + ',' + Math.round(y), grid = new Map();
  pieces.forEach((P, i) => { for (const k of [0, 1]) { const p = k ? P[P.length - 1] : P[0], kk = key(p[0], p[1]); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push([i, k]); } });
  const used = new Uint8Array(pieces.length), out = [];
  const extend = chain => {
    for (;;) {
      const e = chain[chain.length - 1], back = chain[Math.max(0, chain.length - 12)];
      let best = null, bs = Infinity;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const L = grid.get(key(e[0] + dx, e[1] + dy)); if (!L) continue;
        for (const [j, k] of L) {
          if (used[j]) continue;
          const Q = pieces[j], far = k ? Q[0] : Q[Q.length - 1], gap = Math.hypot(dx, dy);
          let ang = 0;
          if (chain.length >= 4) {
            const v1 = [e[0] - back[0], e[1] - back[1]], v2 = [far[0] - back[0], far[1] - back[1]];
            const n1 = Math.hypot(...v1), n2 = Math.hypot(...v2); if (n2 < 1e-9) continue;
            ang = Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2 || 1))));
            if (ang > 0.6) continue;
          }
          const sc = gap + 10 * ang; if (sc < bs) { bs = sc; best = [j, k]; }
        }
      }
      if (!best) return;
      const [j, k] = best; used[j] = 1; const Q = k ? [...pieces[j]].reverse() : pieces[j];
      for (const q of Q) { const l = chain[chain.length - 1]; if (q[0] !== l[0] || q[1] !== l[1]) chain.push(q); }
    }
  };
  const order = pieces.map((_, i) => i).sort((a, b) => pieces[b].length - pieces[a].length);
  for (const i of order) { if (used[i]) continue; used[i] = 1; const chain = [...pieces[i]]; extend(chain); chain.reverse(); extend(chain); out.push(chain); }
  return out;
}

/** Угол наклона по длинным отрезкам: взвешенная по длине медиана угла к ближайшей оси (−45°…45°). */
function estimateSkew(segs, minLen) {
  const A = [];
  for (const g of segs) {
    const L = Math.hypot(g.x2 - g.x1, g.y2 - g.y1); if (L < minLen) continue;
    let a = Math.atan2(g.y2 - g.y1, g.x2 - g.x1); while (a > Math.PI / 4) a -= Math.PI / 2; while (a <= -Math.PI / 4) a += Math.PI / 2;
    A.push([a, L]);
  }
  if (A.length < 3) return 0;
  A.sort((p, q) => p[0] - q[0]); const tot = A.reduce((t, x) => t + x[1], 0); let acc = 0;
  for (const [a, L] of A) { acc += L; if (acc >= tot / 2) return a; }
  return 0;
}

async function decode(blob, maxSide) {
  const bm = await createImageBitmap(blob), k = Math.min(1, maxSide / Math.max(bm.width, bm.height));
  const W = Math.round(bm.width * k), H = Math.round(bm.height * k), cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d', { willReadFrequently: true }); c.fillStyle = '#fff'; c.fillRect(0, 0, W, H); c.drawImage(bm, 0, 0, W, H);
  const d = c.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2];
  return { cv, g, W, H, k, srcW: bm.width, srcH: bm.height };
}

/** Распознать слова с рамками; второй проход — картинка, повёрнутая на 90°, для вертикальных размеров. */
async function ocrWords(cv, worker) {
  const out = [];
  const run = async (canvas, back) => {
    const { data } = await worker.recognize(canvas);
    for (const w of data.words || []) {
      const t = (w.text || '').trim(); if (!t || w.confidence < 30) continue;
      const b = w.bbox; out.push({ ...back(b), s: t, conf: w.confidence / 100 });
    }
  };
  const W = cv.width, H = cv.height;
  await run(cv, b => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, ang: 0 }));
  const r = document.createElement('canvas'); r.width = H; r.height = W; const c = r.getContext('2d');
  c.translate(H, 0); c.rotate(Math.PI / 2); c.drawImage(cv, 0, 0);                 // поворот по часовой: текст «снизу вверх» становится горизонтальным
  await run(r, b => ({ x0: b.y0, y0: H - b.x1, x1: b.y1, y1: H - b.x0, ang: 90 })); // рамка обратно в исходные координаты
  return out;
}

/** Склеить соседние слова одной строки и поправить типичные ошибки OCR в обозначении диаметра. */
function phrases(words) {
  // вдоль строки: для 0° — x растёт; для 90° (текст снизу вверх) — y убывает
  const ws = words.map(w => ({ ...w, h: w.ang ? w.x1 - w.x0 : w.y1 - w.y0 }));
  const along = w => w.ang ? -w.y1 : w.x0, alongEnd = w => w.ang ? -w.y0 : w.x1, across = w => w.ang ? (w.x0 + w.x1) / 2 : (w.y0 + w.y1) / 2;
  ws.sort((a, b) => a.ang - b.ang || along(a) - along(b));
  const out = [];
  for (const w of ws) {
    let L = null, best = Infinity;
    for (const o of out) {
      if (o.ang !== w.ang) continue; const gap = along(w) - alongEnd(o), h = Math.max(o.h, w.h);
      if (Math.abs(across(o) - across(w)) < 0.5 * h && gap > -0.3 * h && gap < 1.2 * h && gap < best) { best = gap; L = o; }
    }
    if (L) { L.s += ' ' + w.s; L.x1 = Math.max(L.x1, w.x1); L.y0 = Math.min(L.y0, w.y0); L.y1 = Math.max(L.y1, w.y1); L.x0 = Math.min(L.x0, w.x0); L.conf = Math.min(L.conf, w.conf); L.h = Math.max(L.h, w.h); }
    else out.push({ ...w });
  }
  for (const p of out) {
    // «010», «O10», «@10» перед числом — почти всегда знак Ø; отмечаем пониженной уверенностью
    const m = /(^|\s)[0OoQ@D](\d+(?:[.,]\d+)?)$/.exec(p.s);
    if (m && !/^\d+$/.test(p.s.trim()) || (m && /^0\d/.test(p.s.trim()))) { p.s = p.s.replace(/(^|\s)[0OoQ@D](\d+(?:[.,]\d+)?)$/, '$1Ø$2'); p.conf = Math.min(p.conf, 0.6); p.guess = 'Ø из «' + m[0].trim() + '»'; }
    p.s = p.s.replace(/(\d+)\s*(?:OTB|0TB|oTB|OTS|ors|ove|otb|отв)\.?/i, '$1 отв.');
  }
  // «слова» без цифр с низкой уверенностью — обычно это углы и штрихи чертежа («L», «=)»), а не надписи:
  // их не берём, чтобы они не закрывали линии под собой
  return out.filter(p => /\d/.test(p.s) || p.conf >= 0.85);
}

/** Порог Оцу по гистограмме яркости (чернила / бумага). */
function otsu(g) {
  const h = new Float64Array(256); for (let i = 0; i < g.length; i++) h[Math.max(0, Math.min(255, g[i] | 0))]++;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * h[i];
  let wB = 0, sB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) { wB += h[t]; if (!wB) continue; const wF = g.length - wB; if (!wF) break; sB += t * h[t];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; thr = t; } }
  return thr;
}

/**
 * Окружности по голосованию (Хаф по градиенту) + проверка кольцом.
 * Скелет окружности толстой линии распадается на «ступеньки» по 2 пикселя — по кускам дугу не подогнать,
 * поэтому центр ищется голосованием краёв, а радиус — по доле чернил на окружности (нужно ≥ 75% обхода).
 */
function houghCircles(g, W, H, skip, rMin, rMax) {
  const ink = otsu(g), acc = new Uint16Array(W * H), E = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const gx = g[i - W + 1] + 2 * g[i + 1] + g[i + W + 1] - g[i - W - 1] - 2 * g[i - 1] - g[i + W - 1];
    const gy = g[i + W - 1] + 2 * g[i + W] + g[i + W + 1] - g[i - W - 1] - 2 * g[i - W] - g[i - W + 1];
    const m = Math.hypot(gx, gy); if (m > 160 && !skip(x, y)) E.push(x, y, gx / m, gy / m);
  }
  const step = Math.max(1, Math.ceil(E.length / 4 / 200000)) * 4;                 // большие фото: прореживаем края
  for (let k = 0; k < E.length; k += step) {
    const x = E[k], y = E[k + 1], dx = E[k + 2], dy = E[k + 3];
    for (let r = rMin; r <= rMax; r++) for (const sg of [1, -1]) {
      const cx = Math.round(x + sg * r * dx), cy = Math.round(y + sg * r * dy);
      if (cx >= 0 && cy >= 0 && cx < W && cy < H) { const j = cy * W + cx; if (acc[j] < 65535) acc[j]++; }
    }
  }
  const S = (x, y) => { let s = 0; for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) s += acc[(y + v) * W + x + u]; return s; };
  const peaks = [];
  for (let y = 4; y < H - 4; y++) for (let x = 4; x < W - 4; x++) {
    if (acc[y * W + x] < 8) continue; const s = S(x, y); if (s < 40 * step / 4) continue;
    let mx = true; for (let v = -3; v <= 3 && mx; v++) for (let u = -3; u <= 3; u++) if ((u || v) && S(x + u, y + v) > s) { mx = false; break; }
    if (mx) peaks.push({ x, y, s });
  }
  peaks.sort((a, b) => b.s - a.s);
  const out = [], N = 72, isInk = (x, y) => { const X = Math.round(x), Y = Math.round(y); return X >= 0 && Y >= 0 && X < W && Y < H && g[Y * W + X] < ink; };
  for (const p of peaks.slice(0, 400)) {
    const prof = [];
    for (let r = rMin; r <= rMax; r++) { let n = 0; for (let a = 0; a < N; a++) if (isInk(p.x + r * Math.cos(2 * Math.PI * a / N), p.y + r * Math.sin(2 * Math.PI * a / N))) n++; prof.push(n / N); }
    for (let i = 0; i < prof.length; i++) {
      if (prof[i] < 0.75) continue; let j = i; while (j + 1 < prof.length && prof[j + 1] >= 0.75) j++;
      if (j - i <= Math.max(3, 0.25 * (rMin + i))) {                                // кольцо, а не залитое пятно
        const r = rMin + (i + j) / 2;
        if (!out.some(c => Math.hypot(c.cx - p.x, c.cy - p.y) < Math.max(3, 0.1 * r) && Math.abs(c.r - r) < Math.max(3, 0.1 * r))) out.push({ cx: p.x, cy: p.y, r, cov: Math.max(...prof.slice(i, j + 1)) });
      }
      i = j;
    }
  }
  return out;
}

/**
 * @param {Blob} blob   фото или скан
 * @param {{at:object, ocr?:object, maxSide?:number}} env  at = window.__at, ocr = воркер Tesseract (или null — без надписей)
 */
export async function importRaster(blob, env) {
  const { cv, g, W, H, k, srcW, srcH } = await decode(blob, env.maxSide || 1600);
  const warn = [];
  const words = env.ocr ? phrases(await ocrWords(cv, env.ocr)) : [];
  if (!env.ocr) warn.push('надписи не распознавались — размеры нужно ввести вручную');
  const inText = (x, y, m = 3) => words.some(w => x >= w.x0 - m && x <= w.x1 + m && y >= w.y0 - m && y <= w.y1 + m);
  const raw0 = env.at.atLines(g, W, H, 50);
  const raw = [...raw0.filter(x => x.circle), ...linkPieces(raw0.filter(x => !x.circle && x.P.length).map(x => x.P)).map(P => ({ P }))];
  const pts = []; for (const { P, circle } of raw) if (!circle) for (const q of P) if (!inText(q[0], q[1])) pts.push(q);
  // окружности: голосование + уточнение по точкам скелета вблизи найденного кольца
  const found = houghCircles(g, W, H, (x, y) => inText(x, y, 1), 6, Math.round(Math.min(W, H) / 4));
  for (const x of raw) if (x.circle && x.circle.r >= 6) found.push({ cx: x.circle.cx, cy: x.circle.cy, r: x.circle.r, cov: 1 });
  const hMed = (() => { const hs = words.map(w => w.ang ? w.x1 - w.x0 : w.y1 - w.y0).sort((a, b) => a - b); return hs.length ? hs[hs.length >> 1] : 0; })();
  const C0 = [];
  for (const c of found) {
    const near = pts.filter(([x, y]) => Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r) < Math.max(3, 0.08 * c.r));
    const f = near.length >= 12 ? fitC(near) : null, q = f && Math.abs(f.r - c.r) < Math.max(3, 0.1 * c.r) && f.rms < Math.max(1.2, 0.04 * c.r) ? f : c;
    if (C0.some(o => Math.hypot(o.cx - q.cx, o.cy - q.cy) < Math.max(3, 0.1 * q.r) && Math.abs(o.r - q.r) < Math.max(3, 0.1 * q.r))) continue;
    // буквы «о», «0», «Ø» — маленькие кольца рядом с надписями
    if (hMed && 2 * q.r < 0.9 * hMed && inText(q.cx, q.cy, hMed)) continue;
    C0.push({ cx: q.cx, cy: q.cy, r: q.r, conf: Math.min(1, c.cov) });
  }
  const onCircle = (x, y) => C0.some(c => Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r) < Math.max(3, 0.08 * c.r));
  const polys = [];
  for (const { P, circle } of raw) {
    if (circle) continue;
    // штрихи букв и цифр — внутри рамок слов; но длинная линия (больше 2,5 высоты шрифта) — не буква,
    // даже если OCR ошибочно положил на неё рамку «слова» (так бывает на углах и выносных)
    const ext = P.length > 1 ? Math.max(Math.abs(P[P.length - 1][0] - P[0][0]), Math.abs(P[P.length - 1][1] - P[0][1])) : 0;
    if (P.every(([x, y]) => inText(x, y)) && !(hMed && ext > 2.5 * hMed)) continue;
    let cur = [];                                                                    // части, лежащие на окружности, — не отрезки
    for (const q of P) { if (onCircle(q[0], q[1])) { if (cur.length > 1) polys.push(cur); cur = []; } else cur.push(q); }
    if (cur.length > 1) polys.push(cur);
  }
  const C = C0.map(c => ({ cx: c.cx, cy: H - c.cy, r: c.r, conf: c.conf }));
  const segs = [];
  for (const P of polys) {
    const Q = rdp(P, 1.5);
    for (let i = 1; i < Q.length; i++) { const [a, b] = [Q[i - 1], Q[i]]; if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= 4) segs.push({ x1: a[0], y1: H - a[1], x2: b[0], y2: H - b[1], src: 'raster' }); }
  }
  // маленькое кольцо без осевых линий через центр — скорее буква «о»/«0», чем отверстие
  // (осевая выходит за окружность с обеих сторон; косая черта знака «Ø» — почти нет)
  const small = Math.max(20, 1.2 * hMed), mark = c => segs.some(s => {
    const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) || 1e-9, ux = (s.x2 - s.x1) / L, uy = (s.y2 - s.y1) / L, t0 = (s.x1 - c.cx) * ux + (s.y1 - c.cy) * uy, t1 = t0 + L;
    const d = Math.abs((s.x1 - c.cx) * uy - (s.y1 - c.cy) * ux), m = c.r + Math.max(5, 0.4 * c.r);
    return d <= 2.5 && Math.min(t0, t1) <= -m && Math.max(t0, t1) >= m; });
  const C1 = C.filter(c => 2 * c.r >= small || mark(c));
  if (C1.length < C.length) warn.push('пропущено мелких колец без осевых линий (похожи на буквы): ' + (C.length - C1.length));
  const texts = words.map(w => ({ s: w.s, x: (w.x0 + w.x1) / 2, y: H - (w.y0 + w.y1) / 2, h: w.ang ? w.x1 - w.x0 : w.y1 - w.y0, ang: w.ang, conf: w.conf, guess: w.guess, src: 'ocr' }));
  // наклон снимка: длинные линии чертежа почти всегда идут по осям — по ним находим угол и выравниваем всё вместе
  const skew = estimateSkew(segs, 0.05 * Math.min(W, H));
  if (Math.abs(skew) > 0.1 * Math.PI / 180 && Math.abs(skew) < 10 * Math.PI / 180) {
    const c = Math.cos(-skew), sn = Math.sin(-skew), ox = W / 2, oy = H / 2, R = (x, y) => [ox + (x - ox) * c - (y - oy) * sn, oy + (x - ox) * sn + (y - oy) * c];
    for (const g of segs) { [g.x1, g.y1] = R(g.x1, g.y1); [g.x2, g.y2] = R(g.x2, g.y2); }
    for (const q of C1) [q.cx, q.cy] = R(q.cx, q.cy);
    for (const t of texts) [t.x, t.y] = R(t.x, t.y);
    warn.push(`снимок наклонён на ${(skew * 180 / Math.PI).toFixed(1)}° — выровнен по линиям чертежа`);
  }
  return { units: 'px', skewDeg: +(skew * 180 / Math.PI).toFixed(2), segs, circles: C1, texts, image: { W, H, k, srcW, srcH }, warnings: warn };
}
