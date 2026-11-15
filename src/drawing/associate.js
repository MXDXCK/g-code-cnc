// Привязка размерных надписей к геометрии — без нейросети, по правилам оформления чертежей (ГОСТ 2.307).
// Вход не зависит от источника (DXF, векторный PDF, фото): отрезки, окружности, надписи в «единицах рисунка»
// (мм для векторов, пиксели для фото; ось Y вверх). Выход — наблюдения с источником и уверенностью.
// Подробно: docs/DIMENSION_ASSOCIATION.md

import { parseDimText } from './dimtext.js';
import { findFeatures, keypoints } from './features.js';

const DEG = Math.PI / 180;
const len = s => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
const dir = s => { const L = len(s) || 1; return [(s.x2 - s.x1) / L, (s.y2 - s.y1) / L]; };
const median = a => { const b = [...a].sort((x, y) => x - y), n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : NaN; };
const near = (a, b, t) => Math.abs(a - b) <= t;

/** Расстояние от точки до отрезка и параметр проекции (0..1 — внутри). */
function ptSeg(px, py, s) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L2 = dx * dx + dy * dy || 1e-12;
  const u = ((px - s.x1) * dx + (py - s.y1) * dy) / L2, cx = s.x1 + u * dx, cy = s.y1 + u * dy;
  return { d: Math.hypot(px - cx, py - cy), u, cx, cy };
}

/**
 * Перебор прямоугольников, каждая сторона которых — ОДНА непрерывная линия.
 * Углы могут быть острыми, скруглёнными (R) или со срезом (фаска): тогда обе стороны не доходят до угла на одну
 * и ту же величину, а через угол проходит дуга или срез.
 */
function scanRects(segs, tol, units, skip, take) {
  // стороны — только отрезки по оси: кусочки дуг скругления сюда не входят и не «склеивают» сторону с выносной
  // в векторе — строго (кусочки дуг идеально ровные); на фото концы сторон у углов скелет слегка закругляет — допуск целиком
  const ax = s => units === 'px' ? tol : Math.min(tol, Math.max(0.02 * len(s), tol / 2));
  const H = segs.filter(s => Math.abs(s.y2 - s.y1) <= ax(s) && len(s) > tol * 4).sort((a, b) => len(b) - len(a)).slice(0, 40);
  const V = segs.filter(s => Math.abs(s.x2 - s.x1) <= ax(s) && len(s) > tol * 4).sort((a, b) => len(b) - len(a)).slice(0, 40);
  const uniq = (a) => a.sort((x, y) => x - y).filter((v, i, b) => !i || v - b[i - 1] > tol);
  const xs = uniq(V.map(s => (s.x1 + s.x2) / 2)), ys = uniq(H.map(s => (s.y1 + s.y2) / 2));
  const run = (list, axis, at, a, b) => {                         // лучший непрерывный участок стороны на [a,b] (разрыв ≤ tol)
    const iv = list.filter(s => near(axis === 'h' ? (s.y1 + s.y2) / 2 : (s.x1 + s.x2) / 2, at, tol))
      .map(s => axis === 'h' ? [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)] : [Math.min(s.y1, s.y2), Math.max(s.y1, s.y2)])
      .sort((u, v) => u[0] - v[0]);
    // разрыв больше допуска перекрывается только там, где сторону пересекает наклонная линия (узел скелета на фото, выноска)
    // перпендикулярная линия у конца стороны (угол, выносная) — не повод перекрывать разрыв; в середине стороны (полка выноски
    // или линия детали пересекает сторону) — повод
    const mid = (m) => m > a + 3 * tol && m < b - 3 * tol;
    const crossed = (m) => segs.some(o => { const q = axis === 'h' ? ptSeg(m, at, o) : ptSeg(at, m, o), [dx, dy] = dir(o);
      const k = axis === 'h' ? Math.abs(dy) : Math.abs(dx);
      if (q.d <= tol && q.u > 0 && q.u < 1 && k > 0.3 && (k < 0.95 || mid(m))) return true;
      // в середине стороны узел на фото бывает «рваным»: пересекающая линия разбита на обрывки — достаточно обрывка рядом с разрывом.
      // Конец ДЛИННОЙ перпендикулярной линии у разрыва — это угол другого прямоугольника, а не узел: не перекрываем
      if (!mid(m) || k <= 0.3 || len(o) > 4 * tol) return false;
      const P = axis === 'h' ? [m, at] : [at, m];
      return [[o.x1, o.y1], [o.x2, o.y2]].some(([x, y]) => Math.hypot(x - P[0], y - P[1]) <= 2 * tol); });
    const runs = []; for (const [p, q] of iv) { const L = runs[runs.length - 1]; if (L && (p <= L[1] + tol || p <= L[1] + 5 * tol && crossed((L[1] + p) / 2))) L[1] = Math.max(L[1], q); else runs.push([p, q]); }
    // выносная линия, продолжающая сторону с зазором, не должна «удлинять» контур — поэтому берётся лучший непрерывный участок
    let best = null; for (const [p, q] of runs) { const c = Math.max(0, Math.min(q, b) - Math.max(p, a)); if (!best || c > best.c) best = { c, p: Math.max(p, a), q: Math.min(q, b), o0: a - p, o1: q - b }; }
    return best && best.c > 0 ? { g0: best.p - a, g1: b - best.q, o0: best.o0, o1: best.o1 } : null;
  };
  const onLine = (x, y) => segs.some(o => ptSeg(x, y, o).d <= tol * 1.5 && ptSeg(x, y, o).u >= -0.05 && ptSeg(x, y, o).u <= 1.05);
  // угол: оба зазора малы — острый; равны — скругление (точка на дуге под 45°) или фаска (середина среза)
  // oa/ob — насколько сторона продолжается ЗА угол: на фото выносная, стоящая продолжением стороны, иногда срастается
  // с ней через начало дуги скругления; тогда отступ этой стороны неизвестен и радиус берётся по второй стороне
  const corner = (at, ga, gb, cx, cy, sx, sy, oa = 0, ob = 0) => {
    if (ga <= tol && oa > 2 * tol && gb > 2 * tol) ga = gb;
    else if (gb <= tol && ob > 2 * tol && ga > 2 * tol) gb = ga;
    if (ga <= tol && gb <= tol || ga <= 2.5 * tol && gb <= 2.5 * tol && Math.min(ga, gb) <= tol) return { at, kind: 'sharp', r: 0 };   // размытый угол на фото
    const r = (ga + gb) / 2;
    if (!near(ga, gb, Math.max(2 * tol, 0.1 * r))) return null;
    if (r < 2 * tol) return null;                                                // «скругление» меньше двух допусков — это шум, а не угол детали
    // дуга должна проходить через точки на 30°, 45° и 60°; срез (фаска) — через ¼, ½ и ¾ своей длины
    if ([30, 45, 60].every(a => onLine(cx + sx * r * (1 - Math.cos(a * DEG)), cy + sy * r * (1 - Math.sin(a * DEG))))) {
      // уточнить радиус: точка дуги, касающейся обеих сторон, даёт r = u + v + √(2uv) (u, v — расстояния до сторон)
      const est = [];
      for (const o of segs) for (const [px, py] of [[o.x1, o.y1], [o.x2, o.y2], [(o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2]]) {
        const u = sx * (px - cx), v = sy * (py - cy);
        if (u > tol && v > tol && u < 1.5 * r && v < 1.5 * r && Math.hypot(u, v) < 1.5 * r) { const e = u + v + Math.sqrt(2 * u * v); if (e > 0.6 * r && e < 1.6 * r) est.push(e); }
      }
      return { at, kind: 'fillet', r: est.length >= 3 ? median(est) : r };
    }
    if ([0.25, 0.5, 0.75].every(t => onLine(cx + sx * r * t, cy + sy * r * (1 - t)))) return { at, kind: 'chamfer', r };
    return null;
  };
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) for (let k = 0; k < ys.length; k++) for (let l = k + 1; l < ys.length; l++) {
    const [x0, x1, y0, y1] = [xs[i], xs[j], ys[k], ys[l]], area = (x1 - x0) * (y1 - y0);
    if (skip && skip(area)) continue;
    const B = run(H, 'h', y0, x0, x1), T = run(H, 'h', y1, x0, x1), Lf = run(V, 'v', x0, y0, y1), R = run(V, 'v', x1, y0, y1);
    if (!B || !T || !Lf || !R) continue;
    const w = x1 - x0, h = y1 - y0, sd = Math.min(w, h);
    const C = [corner('ll', B.g0, Lf.g0, x0, y0, 1, 1, B.o0, Lf.o0), corner('lr', B.g1, R.g0, x1, y0, -1, 1, B.o1, R.o0),
      corner('ur', T.g1, R.g1, x1, y1, -1, -1, T.o1, R.o1), corner('ul', T.g0, Lf.g1, x0, y1, 1, -1, T.o0, Lf.o1)];
    if (C.some(c => !c)) continue;
    // без скруглений и фасок — как раньше: сторона покрыта на ≥ 97%
    if (C.every(c => c.kind === 'sharp') && [B.g0 + B.g1 > 0.03 * w, T.g0 + T.g1 > 0.03 * w, Lf.g0 + Lf.g1 > 0.03 * h, R.g0 + R.g1 > 0.03 * h].some(Boolean)) continue;
    if (C.some(c => c.r > 0.35 * sd)) continue;
    take({ x0, x1, y0, y1, area, corners: C });
  }
}

/** Все прямоугольники рисунка, у которых каждая сторона — одна непрерывная линия (углы острые, R или фаска). */
export function findRects(segs, tol, units = 'mm') { const out = []; scanRects(segs, tol, units, null, r => out.push(r)); return out; }

/**
 * Контур детали: наибольший такой прямоугольник, внутри которого лежат найденные окружности.
 * Возвращает {x0,x1,y0,y1, corners:[{at,kind,r}]}.
 */
export function findOutline(segs, circles, tol, units = 'mm') {
  let best = null;
  scanRects(segs, tol, units, area => best && area <= best.area * 0.5, r => {
    const inside = circles.filter(c => c.cx > r.x0 && c.cx < r.x1 && c.cy > r.y0 && c.cy < r.y1).length;
    const score = r.area * (circles.length && inside === circles.length ? 1 : 0.1);
    if (!best || score > best.score) best = { ...r, score, inside };
  });
  // прямоугольник, внутри которого нет всех найденных отверстий, — скорее полоса между размерными линиями, чем деталь.
  // Неверная база опаснее отсутствующей: тогда «контур не найден», координаты вводит человек
  if (best && circles.length && best.inside < Math.max(1, circles.length / 2)) return null;
  return best;
}

/**
 * Главная функция.
 * @param {{segs:Array<{x1,y1,x2,y2}>, circles:Array<{cx,cy,r}>, texts:Array<{s:string,x:number,y:number,h:number,ang?:number,conf?:number}>,
 *          dims?:Array, units:'mm'|'px', tol?:number}} inp  dims — готовые размеры из DXF (DIMENSION), если есть
 */
export function associate(inp) {
  const { segs = [], circles = [], texts = [], units } = inp;
  const ext = (() => { const xs = [], ys = []; segs.forEach(s => { xs.push(s.x1, s.x2); ys.push(s.y1, s.y2); }); circles.forEach(c => { xs.push(c.cx - c.r, c.cx + c.r); ys.push(c.cy - c.r, c.cy + c.r); });
    return xs.length ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) : 100; })();
  const tol = inp.tol ?? (units === 'px' ? Math.max(2, ext * 0.004) : Math.max(0.02, ext * 0.0005));
  const conflicts = [], notes = [];
  const T = texts.map((t, i) => ({ ...t, id: t.id || 'txt' + i, ang: t.ang || 0, p: parseDimText(t.s) }));
  const C = circles.map((c, i) => ({ ...c, id: c.id || 'c' + i }));
  const outline = findOutline(segs, C, tol, units);
  // карманы и пазы внутри контура (только геометрия) и их опорные точки для размеров
  const FE = findFeatures(segs, outline, tol, (sg, t) => findRects(sg, t, units)), KP = keypoints(FE);
  const fbox = id => { const [k, i] = [id.slice(0, 2), +id.slice(2)]; if (k === 'pk') return FE.pockets[i];
    const sl = FE.slots[i], r = sl.w / 2; return sl.ax === 'h' ? { x0: sl.a - r, x1: sl.b + r, y0: sl.mid - r, y1: sl.mid + r } : { x0: sl.mid - r, x1: sl.mid + r, y0: sl.a - r, y1: sl.b + r }; };
  const boxDist = (b, x, y) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));

  /* ---------- 1. Линейные размеры: размерная линия + выносные ---------- */
  const lin = [];
  for (const t of T.filter(t => t.p.kind === 'linear')) {
    const u = [Math.cos(t.ang * DEG), Math.sin(t.ang * DEG)];
    let dl = null;
    for (const s of segs) {
      const d = dir(s); if (Math.abs(d[0] * u[1] - d[1] * u[0]) > Math.sin(8 * DEG)) continue;   // параллельна надписи
      const q = ptSeg(t.x, t.y, s); if (q.u < -0.3 || q.u > 1.3) continue;
      if (q.d < 0.1 * t.h || q.d > 2.5 * t.h) continue;                                           // надпись — над линией
      if (!dl || q.d < dl.q.d) dl = { s, q };
    }
    if (!dl) { lin.push({ t, ok: false, why: 'не найдена размерная линия' }); continue; }
    const d = dir(dl.s), n = [-d[1], d[0]];
    // выносные: перпендикулярные отрезки, которые пересекают размерную линию или касаются её
    const exts = [];
    for (const s of segs) {
      if (s === dl.s) continue;
      const e = dir(s); if (Math.abs(e[0] * d[0] + e[1] * d[1]) > Math.sin(8 * DEG)) continue;    // перпендикулярна
      const pa = (s.x1 - dl.s.x1) * n[0] + (s.y1 - dl.s.y1) * n[1], pb = (s.x2 - dl.s.x1) * n[0] + (s.y2 - dl.s.y1) * n[1];
      if (Math.min(pa, pb) > tol * 2 || Math.max(pa, pb) < -tol * 2) continue;                   // не доходит до линии
      const along = ((s.x1 + s.x2) / 2 - dl.s.x1) * d[0] + ((s.y1 + s.y2) / 2 - dl.s.y1) * d[1];
      const L = len(dl.s); if (along < -0.6 * L || along > 1.6 * L) continue;
      const far = Math.abs(pa) > Math.abs(pb) ? [s.x1, s.y1] : [s.x2, s.y2];                      // дальний конец — к детали
      exts.push({ s, along, far, over: Math.min(Math.abs(pa), Math.abs(pb)) });
    }
    // цепочка размеров на одной прямой может прийти одним отрезком: участок этой надписи — между ближайшими
    // выносными слева и справа от неё (выносная заходит за размерную линию не дальше ~1 высоты шрифта, осевая — проходит насквозь)
    const tA = (t.x - dl.s.x1) * d[0] + (t.y - dl.s.y1) * d[1];
    let lo = 0, hi = len(dl.s);
    for (const e of exts) if (e.over <= 1.2 * t.h) { if (e.along > lo + tol * 2 && e.along < tA) lo = e.along; if (e.along < hi - tol * 2 && e.along > tA) hi = e.along; }
    lin.push({ t, ok: true, dl: dl.s, d, n, exts, lo, hi, L: hi - lo });
  }

  /* ---------- 2. Масштаб: размеры, у которых выносные стоят на концах размерной линии ---------- */
  const sc = [];
  for (const m of lin.filter(m => m.ok)) {
    const a = m.exts.find(e => near(e.along, m.lo, tol * 2)), b = m.exts.find(e => near(e.along, m.hi, tol * 2));
    if (a && b && m.L > tol * 4) sc.push(m.t.p.value / m.L);
  }
  let s = sc.length ? median(sc) : (units === 'mm' ? 1 : NaN);
  const inl = sc.filter(v => Math.abs(v / s - 1) < 0.015);
  if (sc.length >= 2 && inl.length < sc.length) notes.push(`масштаб: ${sc.length - inl.length} из ${sc.length} размеров не сходятся с рисунком`);
  if (inl.length) s = median(inl);
  const scale = { s, n: inl.length, from: sc.length ? 'dimensions' : (units === 'mm' ? 'assumed-1:1' : 'unknown') };

  /* ---------- 3. Пара выносных для каждого размера и ссылки на элементы ---------- */
  const refAt = (m, e) => {                                       // что «держит» выносная: центр окружности, сторона контура, другой отрезок
    const pos = [e.s.x1, e.s.y1], d = m.d;
    const coord = p => p[0] * d[0] + p[1] * d[1], at = coord(pos);
    const c = C.filter(c => near(coord([c.cx, c.cy]), at, tol * 1.5)).sort((p, q) => Math.hypot(p.cx - e.far[0], p.cy - e.far[1]) - Math.hypot(q.cx - e.far[0], q.cy - e.far[1]))[0];
    // опорная точка кармана/паза на той же оси — если она ближе к концу выносной, чем окружность
    const ax = Math.abs(d[0]) > Math.abs(d[1]) ? 'x' : 'y';
    const k = KP.filter(k => k.axis === ax && near(k.at * Math.sign(ax === 'x' ? d[0] : d[1]), at, tol * 1.5)).map(k => ({ k, dist: boxDist(fbox(k.feat), e.far[0], e.far[1]) })).sort((p, q) => p.dist - q.dist)[0];
    if (k && (!c || k.dist < Math.hypot(c.cx - e.far[0], c.cy - e.far[1]) - c.r)) return { type: 'kp', id: k.k.id, axisCoord: at };
    if (c) return { type: 'circle', id: c.id, axisCoord: coord([c.cx, c.cy]) };
    if (outline) {
      const horiz = Math.abs(d[0]) > Math.abs(d[1]);
      for (const [nm, v] of horiz ? [['x0', outline.x0], ['x1', outline.x1]] : [['y0', outline.y0], ['y1', outline.y1]])
        if (near(at, horiz ? v * Math.sign(d[0]) : v * Math.sign(d[1]), tol * 1.5)) return { type: 'edge', id: nm, axisCoord: at };
    }
    return { type: 'line', id: null, axisCoord: at };
  };
  const dims = [];
  for (const m of lin) {
    if (!m.ok) { dims.push({ textId: m.t.id, text: m.t.p.raw, kind: 'linear', value: m.t.p.value, status: 'unassociated', why: m.why }); continue; }
    let best = null;
    for (let i = 0; i < m.exts.length; i++) for (let j = i + 1; j < m.exts.length; j++) {
      const A = m.exts[i], B = m.exts[j], dist = Math.abs(B.along - A.along);
      if (dist < tol) continue;
      const tAlong = (m.t.x - m.dl.x1) * m.d[0] + (m.t.y - m.dl.y1) * m.d[1];
      const lo = Math.min(A.along, B.along), hi = Math.max(A.along, B.along);
      const off = tAlong < lo ? lo - tAlong : tAlong > hi ? tAlong - hi : 0;                     // надпись между выносными — лучше
      const err = Number.isFinite(s) ? Math.abs(dist * s - m.t.p.value) / m.t.p.value : 0;
      const score = err * 10 + off / (m.L || 1);
      if (!best || score < best.score) best = { A, B, dist, err, score };
    }
    if (!best) { dims.push({ textId: m.t.id, text: m.t.p.raw, kind: 'linear', value: m.t.p.value, status: 'unassociated', why: 'нет пары выносных линий' }); continue; }
    const axis = Math.abs(m.d[0]) > 0.99 ? 'x' : Math.abs(m.d[1]) > 0.99 ? 'y' : 'aligned';
    const pos = e => axis === 'y' ? (e.s.y1 + e.s.y2) / 2 : (e.s.x1 + e.s.x2) / 2;            // по возрастанию координаты оси
    const [A, B] = pos(best.A) <= pos(best.B) ? [best.A, best.B] : [best.B, best.A];
    const ra = refAt(m, A), rb = refAt(m, B);
    const st = !Number.isFinite(s) ? 'associated' : best.err <= (units === 'mm' ? 0.002 : 0.03) ? 'associated' : 'conflict';
    if (st === 'conflict') conflicts.push({ textId: m.t.id, msg: `Размер ${m.t.p.raw}: на рисунке ${(best.dist * s).toFixed(2)} мм — не совпадает` });
    dims.push({ textId: m.t.id, text: m.t.p.raw, kind: 'linear', value: m.t.p.value, tol: m.t.p.tol || null, axis, refs: [ra, rb], measured: best.dist * s, status: st, conf: (m.t.conf ?? 1) * (st === 'associated' ? 0.95 : 0.5) });
  }

  /* ---------- 4. Диаметры, резьбы, количество: выноска или линия через центр ---------- */
  const groups = (() => { const g = []; for (const c of C) { const k = g.find(x => Math.abs(x.r - c.r) <= Math.max(tol, c.r * 0.02)); if (k) k.ids.push(c.id); else g.push({ r: c.r, ids: [c.id] }); } return g; })();
  const groupOf = id => groups.find(g => g.ids.includes(id));
  // конец выноски — на окружности (стрелка) или в центре большой окружности
  const onCircle = (x, y) => C.find(c => Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r) <= tol * 2 || c.r > 4 * tol && Math.hypot(x - c.cx, y - c.cy) <= tol * 2);
  // стороны контура детали — не выноски
  const onOutline = sg => outline && (near(sg.y1, outline.y0, tol) && near(sg.y2, outline.y0, tol) || near(sg.y1, outline.y1, tol) && near(sg.y2, outline.y1, tol)
    || near(sg.x1, outline.x0, tol) && near(sg.x2, outline.x0, tol) || near(sg.x1, outline.x1, tol) && near(sg.x2, outline.x1, tol));
  const leaderSegs = segs.filter(sg => !onOutline(sg));
  // скругления углов контура: центр дуги и радиус в единицах рисунка
  // (у кармана углы внутренние: центр дуги — внутри кармана, так же как у контура — внутри детали)
  const cornersOf = (rc, pre) => rc.corners.filter(c => c.kind === 'fillet').map(c => {
    const sx = c.at[1] === 'l' ? 1 : -1, sy = c.at[0] === 'l' ? 1 : -1, x = c.at[1] === 'l' ? rc.x0 : rc.x1, y = c.at[0] === 'l' ? rc.y0 : rc.y1;
    return { ...c, at: pre + c.at, cx: x + sx * c.r, cy: y + sy * c.r }; });
  const fillets = [...(outline ? cornersOf(outline, '') : []), ...FE.pockets.flatMap((p, i) => cornersOf(p, 'pk' + i + ':'))];
  const onFillet = (x, y) => fillets.find(f => Math.abs(Math.hypot(x - f.cx, y - f.cy) - f.r) <= tol * 2);
  const radDims = {};
  for (const t of T.filter(t => ['dia', 'thread', 'count', 'rad'].includes(t.p.kind))) {
    let hit = null, how = '';
    if (t.p.kind === 'rad' && fillets.length) {                                  // «R8» — к скруглению угла по выноске
      const st0 = segs.filter(s => ptSeg(t.x, t.y, s).d <= 1.6 * t.h), seen0 = new Set(st0); let q = [...st0], f = null;
      for (let depth = 0; depth < 3 && !f && q.length; depth++) { const nx = [];
        for (const s of q) { for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]]) { f = onFillet(x, y); if (f) break; } if (f) break;
          for (const o of segs) if (!seen0.has(o) && [[o.x1, o.y1], [o.x2, o.y2]].some(([x, y]) => Math.hypot(x - s.x1, y - s.y1) <= tol * 2 || Math.hypot(x - s.x2, y - s.y2) <= tol * 2)) { seen0.add(o); nx.push(o); } }
        q = nx; }
      if (f) {
        const meas = Number.isFinite(s) ? f.r * s : null, bad = meas != null && Math.abs(meas - t.p.value) > Math.max(units === 'mm' ? 0.02 : 0.5, t.p.value * (units === 'mm' ? 0.01 : 0.08));
        if (bad) conflicts.push({ textId: t.id, msg: `${t.p.raw}: скругление на рисунке ≈ R${meas.toFixed(2)}` });
        else radDims[f.at] = { value: t.p.value, source: 'dimension', textId: t.id };
        dims.push({ textId: t.id, text: t.p.raw, kind: 'rad', value: t.p.value, refs: [{ type: 'corner', id: f.at }], how: 'выноска', status: bad ? 'conflict' : 'associated', conf: (t.conf ?? 1) * 0.9 });
        continue;
      }
    }
    // а) выноска: отрезки, связанные с надписью (полка под текстом → наклонная к окружности); ближние — первыми
    const start = leaderSegs.filter(s => ptSeg(t.x, t.y, s).d <= 1.6 * t.h).sort((a, b) => ptSeg(t.x, t.y, a).d - ptSeg(t.x, t.y, b).d);
    const seen = new Set(start), queue = [...start];
    for (let depth = 0; depth < 3 && !hit; depth++) {
      const next = [];
      for (const s of queue) {
        for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]]) { const c = onCircle(x, y); if (c) { hit = c; how = 'выноска'; break; } }
        if (hit) break;
        for (const o of leaderSegs) if (!seen.has(o) && [[o.x1, o.y1], [o.x2, o.y2]].some(([x, y]) => Math.hypot(x - s.x1, y - s.y1) <= tol * 2 || Math.hypot(x - s.x2, y - s.y2) <= tol * 2)) { seen.add(o); next.push(o); }
      }
      queue.length = 0; queue.push(...next);
    }
    // б) размерная линия через центр (диаметр на окружности)
    if (!hit) for (const c of C) for (const sg of segs) { const q = ptSeg(c.cx, c.cy, sg); if (q.d <= tol && q.u > 0 && q.u < 1 && near(len(sg), 2 * c.r, tol * 3) && ptSeg(t.x, t.y, sg).d < 2.5 * t.h) { hit = c; how = 'размер по диаметру'; } }
    // в) ближайшая окружность (низкая уверенность)
    if (!hit && C.length) { const c = [...C].sort((p, q) => (Math.hypot(t.x - p.cx, t.y - p.cy) - p.r) - (Math.hypot(t.x - q.cx, t.y - q.cy) - q.r))[0]; if (Math.hypot(t.x - c.cx, t.y - c.cy) - c.r < 8 * t.h) { hit = c; how = 'ближайшая окружность'; } }
    if (!hit) { dims.push({ textId: t.id, text: t.p.raw, kind: t.p.kind, value: t.p.value, status: 'unassociated', why: 'не найдена окружность' }); continue; }
    const g = groupOf(hit.id), ids = g ? g.ids : [hit.id];
    const d = { textId: t.id, text: t.p.raw, kind: t.p.kind, value: t.p.value, count: t.p.count || null, pitch: t.p.pitch || null, tol: t.p.tol || null, refs: ids.map(id => ({ type: 'circle', id })), how, status: 'associated', conf: (t.conf ?? 1) * (how === 'ближайшая окружность' ? 0.5 : 0.9) };
    if (t.p.count && t.p.count !== ids.length) { d.status = 'conflict'; conflicts.push({ textId: t.id, msg: `«${t.p.raw}»: указано ${t.p.count} шт., на рисунке ${ids.length} окружн. этого размера` }); }
    if (t.p.kind === 'dia' && Number.isFinite(s)) {
      const meas = 2 * hit.r * s, e = Math.abs(meas - t.p.value) / t.p.value;
      if (e > (units === 'mm' ? 0.01 : 0.06)) { d.status = 'conflict'; conflicts.push({ textId: t.id, msg: `${t.p.raw}: окружность на рисунке ≈ Ø${meas.toFixed(2)}` }); }
    }
    dims.push(d);
  }
  // размеры из DXF (DIMENSION) — точные: точки привязки известны, остаётся сопоставить их с элементами
  const refPt = (p, axis) => {
    const c = C.find(c => Math.hypot(c.cx - p[0], c.cy - p[1]) <= tol * 1.5);
    if (c) return { type: 'circle', id: c.id };
    const kk = axis === 'x' ? 0 : 1, k = KP.filter(k => k.axis === axis && near(k.at, p[kk], tol * 1.5) && boxDist(fbox(k.feat), p[0], p[1]) <= tol * 2)
      .sort((a, b) => boxDist(fbox(a.feat), p[0], p[1]) - boxDist(fbox(b.feat), p[0], p[1]))[0];
    if (k) return { type: 'kp', id: k.id };
    if (outline) for (const [nm, v, k] of [['x0', outline.x0, 0], ['x1', outline.x1, 0], ['y0', outline.y0, 1], ['y1', outline.y1, 1]])
      if ((axis === 'x' ? k === 0 : k === 1) && near(p[k], v, tol * 1.5)) return { type: 'edge', id: nm };
    return { type: 'point', id: null, at: p };
  };
  for (const d of inp.dimPts || []) {
    if (d.kind === 'linear' && (d.axis === 'x' || d.axis === 'y')) {
      const k = d.axis === 'x' ? 0 : 1, [p, q] = d.p1[k] <= d.p2[k] ? [d.p1, d.p2] : [d.p2, d.p1];
      const meas = Math.abs(q[k] - p[k]) * s, st = Math.abs(meas - d.value) <= Math.max(0.01, d.value * 0.002) ? 'associated' : 'conflict';
      if (st === 'conflict') conflicts.push({ textId: d.textId, msg: `Размер ${d.text}: в файле ${meas.toFixed(3)} мм — не совпадает с надписью` });
      dims.push({ textId: d.textId, text: d.text, kind: 'linear', value: d.value, tol: d.tol || null, axis: d.axis, refs: [refPt(p, d.axis), refPt(q, d.axis)], measured: meas, status: st, conf: 1, how: 'DIMENSION' });
    } else if (d.kind === 'rad' && fillets.length) {
      const f = fillets.find(f => Math.hypot(f.cx - d.center[0], f.cy - d.center[1]) <= tol * 1.5);
      if (!f) { dims.push({ textId: d.textId, text: d.text, kind: 'rad', value: d.value, status: 'unassociated', why: 'нет скругления в точке размера' }); continue; }
      const bad = Math.abs(f.r * s - d.value) > Math.max(0.01, d.value * 0.002);
      if (bad) conflicts.push({ textId: d.textId, msg: `${d.text}: скругление в файле R${(f.r * s).toFixed(3)}` }); else radDims[f.at] = { value: d.value, source: 'dimension', textId: d.textId };
      dims.push({ textId: d.textId, text: d.text, kind: 'rad', value: d.value, refs: [{ type: 'corner', id: f.at }], how: 'DIMENSION', status: bad ? 'conflict' : 'associated', conf: 1 });
    } else if (d.kind === 'dia' || d.kind === 'thread') {
      const c = C.find(c => Math.hypot(c.cx - d.center[0], c.cy - d.center[1]) <= tol * 1.5);
      if (!c) { dims.push({ textId: d.textId, text: d.text, kind: d.kind, value: d.value, status: 'unassociated', why: 'нет окружности в точке размера' }); continue; }
      const g = groupOf(c.id), ids = d.count && g ? g.ids : [c.id];
      const st = d.kind === 'dia' && Math.abs(2 * c.r * s - d.value) > Math.max(0.01, d.value * 0.002) ? 'conflict' : 'associated';
      if (st === 'conflict') conflicts.push({ textId: d.textId, msg: `${d.text}: окружность в файле Ø${(2 * c.r * s).toFixed(3)}` });
      if (d.count && d.count !== ids.length) conflicts.push({ textId: d.textId, msg: `«${d.text}»: указано ${d.count} шт., в файле ${ids.length}` });
      dims.push({ textId: d.textId, text: d.text, kind: d.kind, value: d.value, count: d.count || null, pitch: d.pitch || null, tol: d.tol || null, refs: ids.map(id => ({ type: 'circle', id })), how: 'DIMENSION', status: st, conf: 1 });
    }
  }

  /* ---------- 5. Координаты отверстий: сначала из размеров (цепочки от базы), потом — измерение по рисунку ---------- */
  const ox = outline ? outline.x0 : Math.min(...C.map(c => c.cx - c.r)), oy = outline ? outline.y0 : Math.min(...C.map(c => c.cy - c.r));
  const solve = (axis) => {
    const key = c => axis === 'x' ? c.cx : c.cy, col = [];                       // окружности на одной вертикали/горизонтали — одна координата
    const items = [...C.map(c => ({ id: c.id, at: key(c) })), ...KP.filter(k => k.axis === axis).map(k => ({ id: k.id, at: k.at }))];   // + опорные точки карманов и пазов
    for (const c of items) { const k = col.find(g => near(g.at, c.at, tol * 1.5)); if (k) k.ids.push(c.id); else col.push({ at: c.at, ids: [c.id] }); }
    const val = new Map();                                                       // имя → {v, src}
    val.set(axis + '0', { v: 0, src: 'база' });
    if (outline) val.set(axis + '1', null);
    const nodeOf = r => r.type === 'circle' || r.type === 'kp' ? 'col:' + col.findIndex(g => g.ids.includes(r.id)) : r.type === 'edge' ? r.id : null;
    const cons = dims.filter(d => d.kind === 'linear' && d.axis === axis && d.status !== 'unassociated' && d.refs).map(d => ({ a: nodeOf(d.refs[0]), b: nodeOf(d.refs[1]), v: d.value, d }))
      .filter(c => c.a && c.b && c.a !== c.b);
    for (let it = 0; it < 20; it++) {
      let ch = false;
      for (const c of cons) {
        const A = val.get(c.a), B = val.get(c.b);
        // значение, выведенное из спорного размера (надпись ≠ геометрия), само становится спорным — его не подставляют
        const bad = c.d.status === 'conflict';
        if (A && !B) { val.set(c.b, { v: A.v + c.v, src: 'размер ' + c.d.text, bad: A.bad || bad }); ch = true; }
        else if (B && !A) { val.set(c.a, { v: B.v - c.v, src: 'размер ' + c.d.text, bad: B.bad || bad }); ch = true; }
        else if (A && B && !near(B.v - A.v, c.v, 0.01)) { if (!c.bad) { c.bad = 1; conflicts.push({ textId: c.d.textId, msg: `Размеры противоречат друг другу: ${c.d.text} ≠ ${(B.v - A.v).toFixed(2)}` }); } }
      }
      if (!ch) break;
    }
    const res = {};
    col.forEach((g, i) => {
      const k = val.get('col:' + i), meas = (g.at - (axis === 'x' ? ox : oy)) * s;
      // без контура детали нет базы: «измерять» не от чего — значение неизвестно, а не выдумано от случайной точки
      const mOk = outline && Number.isFinite(meas);
      for (const id of g.ids) res[id] = k ? { value: +k.v.toFixed(3), source: 'dimension', note: k.src, measured: mOk ? +meas.toFixed(3) : null }
        : { value: mOk ? +meas.toFixed(units === 'mm' ? 3 : 1) : null, source: 'measured', note: !outline ? 'контур детали не найден — введите' : units === 'mm' ? 'по геометрии файла' : 'измерено по фото — проверьте', measured: mOk ? meas : null };
      if (k && k.bad) for (const id of g.ids) res[id].conflict = { measured: mOk ? +meas.toFixed(3) : null, why: 'выведено из спорного размера' };
      else if (k && mOk && Math.abs(meas - k.v) > (units === 'mm' ? 0.05 : Math.max(0.5, k.v * 0.03))) {
        conflicts.push({ msg: `${/:/.test(g.ids[0]) ? 'Элемент ' + g.ids[0].split(':')[0] : 'Отверстие ' + g.ids[0]}: по размеру ${axis.toUpperCase()}=${k.v}, по рисунку ≈ ${meas.toFixed(2)}` });
        for (const id of g.ids) res[id].conflict = { measured: +meas.toFixed(3) };    // значение спорное: решает человек
      }
    });
    // прямой размер между двумя узлами (например, ширина кармана 60), даже если положение от базы неизвестно
    const direct = (a, b) => { const A = nodeOf({ type: 'kp', id: a }), B = nodeOf({ type: 'kp', id: b }); const c = cons.find(c => c.a === A && c.b === B || c.a === B && c.b === A); return c ? { v: c.v, bad: c.d.status === 'conflict' } : null; };
    return { res, edge1: val.get(axis + '1'), direct };
  };
  const SX = solve('x'), SY = solve('y');

  /* ---------- 6. Карманы и пазы: положение и размеры из опорных точек ---------- */
  const R3 = v => +(+v).toFixed(3);
  const get = (axis, id) => (axis === 'x' ? SX : SY).res[id];
  // величина = разность двух координат: «по размеру», если обе по размеру или есть прямой размер; иначе «измерено»
  const diff = (axis, a, b, scaleDu) => {
    const A = get(axis, a), B = get(axis, b), dr = (axis === 'x' ? SX : SY).direct(a, b);
    if (dr != null) return { value: R3(dr.v), source: 'dimension', note: 'размер ' + dr.v, ...(dr.bad ? { conflict: { measured: Number.isFinite(s) ? R3(scaleDu * s) : null, why: 'надпись не совпадает с рисунком' } } : {}) };
    if (A && B && A.value != null && B.value != null) {
      if (A.conflict || B.conflict) return { value: R3(B.value - A.value), source: 'dimension', conflict: { measured: Number.isFinite(s) ? R3(scaleDu * s) : null } };
      return { value: R3(B.value - A.value), source: A.source === 'dimension' && B.source === 'dimension' ? 'dimension' : 'measured' };
    }
    return { value: Number.isFinite(s) ? R3(scaleDu * s) : null, source: 'measured' };
  };
  const mid = (axis, a, b) => { const A = get(axis, a), B = get(axis, b);
    if (!A || !B || A.value == null || B.value == null || A.conflict || B.conflict) return { value: null, source: 'measured', note: 'нет положения — введите' };
    return { value: R3((A.value + B.value) / 2), source: A.source === 'dimension' && B.source === 'dimension' ? 'dimension' : 'measured' }; };
  const features = [
    ...FE.pockets.map((p, i) => { const f = 'pk' + i, cr = p.corners.filter(c => c.kind === 'fillet');
      const rr = cr.length ? (radDims[f + ':' + cr[0].at] || { value: Number.isFinite(s) ? R3(cr[0].r * s) : null, source: 'measured' }) : { value: 0, source: 'measured' };
      return { id: f, kind: 'pocketRect', du: { x0: p.x0, x1: p.x1, y0: p.y0, y1: p.y1, corners: p.corners },
        cx: mid('x', f + ':x0', f + ':x1'), cy: mid('y', f + ':y0', f + ':y1'), w: diff('x', f + ':x0', f + ':x1', p.x1 - p.x0), h: diff('y', f + ':y0', f + ':y1', p.y1 - p.y0),
        r: rr, sharp: cr.length === 0, corners: p.corners.map(c => c.kind), x0: get('x', f + ':x0'), y0: get('y', f + ':y0') }; }),
    ...FE.slots.map((sl, i) => { const f = 'sl' + i, A = sl.ax === 'h' ? 'x' : 'y', B = sl.ax === 'h' ? 'y' : 'x', cc = mid(A, f + ':c1', f + ':c2');
      const w = diff(B, f + ':s0', f + ':s1', sl.w), cl = diff(A, f + ':c1', f + ':c2', sl.b - sl.a), el = diff(A, f + ':e1', f + ':e2', sl.b - sl.a + sl.w);
      const L = el.source === 'dimension' ? el : cl.value != null && w.value != null ? { value: R3(cl.value + w.value), source: cl.source === 'dimension' && w.source === 'dimension' ? 'dimension' : 'measured' } : el;
      const m = get(B, f + ':m'), cm = m && m.value != null && !m.conflict ? { value: m.value, source: m.source } : mid(B, f + ':s0', f + ':s1');
      return { id: f, kind: 'slot', du: { ax: sl.ax, a: sl.a, b: sl.b, mid: sl.mid, w: sl.w }, ang: sl.ax === 'h' ? 0 : 90,
        cx: A === 'x' ? cc : cm, cy: A === 'x' ? cm : cc, l: L, w, cc: cl }; }),
  ];
  for (const ft of features) for (const k of ['cx', 'cy', 'w', 'h', 'l']) if (ft[k] && ft[k].conflict) ft[k].value = null;

  const holes = C.map(c => {
    const dd = dims.find(d => ['dia', 'thread'].includes(d.kind) && d.refs && d.refs.some(r => r.id === c.id));
    const meas = Number.isFinite(s) ? 2 * c.r * s : null;
    return {
      id: c.id, du: { cx: c.cx, cy: c.cy, r: c.r },
      d: dd && dd.kind === 'dia' ? { value: dd.value, source: 'dimension', textId: dd.textId, measured: meas } : { value: meas != null ? +meas.toFixed(units === 'mm' ? 3 : 2) : null, source: 'measured', measured: meas },
      thread: dd && dd.kind === 'thread' ? { d: dd.value, pitch: dd.pitch } : null,
      x: SX.res[c.id], y: SY.res[c.id], group: (groupOf(c.id) || {}).ids || [c.id],
      status: dd && dd.status === 'conflict' ? 'conflict' : 'suggested',
    };
  });
  const thick = T.find(t => t.p.kind === 'thick');
  const depthTexts = T.filter(t => t.p.kind === 'depth').map(t => ({ id: t.id, text: t.p.raw, value: t.p.value }));
  const through = T.filter(t => t.p.kind === 'through').map(t => ({ id: t.id, text: t.p.raw }));
  const plate = outline ? {
    du: outline,
    corners: outline.corners.map(c => ({ at: c.at, kind: c.kind, r: c.kind === 'sharp' ? null : radDims[c.at] || { value: Number.isFinite(s) ? +(c.r * s).toFixed(units === 'mm' ? 3 : 2) : null, source: 'measured' } })),
    w: SX.edge1 ? { value: SX.edge1.v, source: 'dimension', note: SX.edge1.src } : { value: Number.isFinite(s) ? +((outline.x1 - outline.x0) * s).toFixed(2) : null, source: 'measured' },
    h: SY.edge1 ? { value: SY.edge1.v, source: 'dimension', note: SY.edge1.src } : { value: Number.isFinite(s) ? +((outline.y1 - outline.y0) * s).toFixed(2) : null, source: 'measured' },
  } : null;
  const used = new Set(dims.filter(d => d.status !== 'unassociated').map(d => d.textId));
  if (thick) used.add(thick.id);
  for (const t of [...depthTexts, ...through]) used.add(t.id);
  return {
    units, tol, scale, outline: plate, holes, features, depthTexts, through, dims, conflicts, notes,
    thickness: thick ? { value: thick.p.value, source: 'dimension', textId: thick.id } : null,
    unassigned: T.filter(t => !used.has(t.id) && t.p.kind !== 'text').map(t => ({ id: t.id, text: t.p.raw })),
    otherText: T.filter(t => t.p.kind === 'text').map(t => t.p.raw),
  };
}
