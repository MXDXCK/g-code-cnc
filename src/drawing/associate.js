// Привязка размерных надписей к геометрии — без нейросети, по правилам оформления чертежей (ГОСТ 2.307).
// Вход не зависит от источника (DXF, векторный PDF, фото): отрезки, окружности, надписи в «единицах рисунка»
// (мм для векторов, пиксели для фото; ось Y вверх). Выход — наблюдения с источником и уверенностью.
// Подробно: docs/DIMENSION_ASSOCIATION.md

import { parseDimText } from './dimtext.js';

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

/** Найти контур пластины: наибольший прямоугольник, все 4 стороны которого покрыты отрезками (≥97%). */
export function findOutline(segs, circles, tol) {
  const H = segs.filter(s => Math.abs(s.y2 - s.y1) <= tol && len(s) > tol * 4).sort((a, b) => len(b) - len(a)).slice(0, 40);
  const V = segs.filter(s => Math.abs(s.x2 - s.x1) <= tol && len(s) > tol * 4).sort((a, b) => len(b) - len(a)).slice(0, 40);
  const uniq = (a) => a.sort((x, y) => x - y).filter((v, i, b) => !i || v - b[i - 1] > tol);
  const xs = uniq(V.map(s => (s.x1 + s.x2) / 2)), ys = uniq(H.map(s => (s.y1 + s.y2) / 2));
  const cover = (list, axis, at, a, b) => {                       // доля [a,b], покрытая ОДНОЙ непрерывной линией (разрыв ≤ tol)
    const iv = list.filter(s => near(axis === 'h' ? (s.y1 + s.y2) / 2 : (s.x1 + s.x2) / 2, at, tol))
      .map(s => axis === 'h' ? [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)] : [Math.min(s.y1, s.y2), Math.max(s.y1, s.y2)])
      .sort((u, v) => u[0] - v[0]);
    // разрыв больше допуска допустим только там, где сторону пересекает другая линия (узел скелета на фото, выноска)
    const crossed = (m) => segs.some(o => { const q = axis === 'h' ? ptSeg(m, at, o) : ptSeg(at, m, o), [dx, dy] = dir(o);
      const k = axis === 'h' ? Math.abs(dy) : Math.abs(dx);                      // перпендикулярная линия (угол, выносная) — не повод перекрывать разрыв
      return q.d <= tol && q.u > 0 && q.u < 1 && k > 0.3 && k < 0.95; });
    const runs = []; for (const [p, q] of iv) { const L = runs[runs.length - 1]; if (L && (p <= L[1] + tol || p <= L[1] + 3 * tol && crossed((L[1] + p) / 2))) L[1] = Math.max(L[1], q); else runs.push([p, q]); }
    // выносная линия, продолжающая сторону с зазором, не должна «удлинять» контур — поэтому берётся лучший непрерывный участок
    return Math.max(0, ...runs.map(([p, q]) => Math.max(0, Math.min(q, b) - Math.max(p, a)))) / (b - a || 1);
  };
  let best = null;
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) for (let k = 0; k < ys.length; k++) for (let l = k + 1; l < ys.length; l++) {
    const [x0, x1, y0, y1] = [xs[i], xs[j], ys[k], ys[l]], area = (x1 - x0) * (y1 - y0);
    if (best && area <= best.area * 0.5) continue;
    if (cover(H, 'h', y0, x0, x1) < 0.97 || cover(H, 'h', y1, x0, x1) < 0.97 || cover(V, 'v', x0, y0, y1) < 0.97 || cover(V, 'v', x1, y0, y1) < 0.97) continue;
    const inside = circles.filter(c => c.cx > x0 && c.cx < x1 && c.cy > y0 && c.cy < y1).length;
    const score = area * (circles.length && inside === circles.length ? 1 : 0.1);
    if (!best || score > best.score) best = { x0, x1, y0, y1, area, score };
  }
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
  const outline = findOutline(segs, C, tol);

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
  for (const t of T.filter(t => ['dia', 'thread', 'count', 'rad'].includes(t.p.kind))) {
    let hit = null, how = '';
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
    } else if (d.kind === 'dia' || d.kind === 'thread') {
      const c = C.find(c => Math.hypot(c.cx - d.center[0], c.cy - d.center[1]) <= tol * 1.5);
      if (!c) { dims.push({ textId: d.textId, text: d.text, kind: d.kind, value: d.value, status: 'unassociated', why: 'нет окружности в точке размера' }); continue; }
      const g = groupOf(c.id), ids = d.count && g ? g.ids : [c.id];
      const st = d.kind === 'dia' && Math.abs(2 * c.r * s - d.value) > Math.max(0.01, d.value * 0.002) ? 'conflict' : 'associated';
      if (st === 'conflict') conflicts.push({ textId: d.textId, msg: `${d.text}: окружность в файле Ø${(2 * c.r * s).toFixed(3)}` });
      if (d.count && d.count !== ids.length) conflicts.push({ textId: d.textId, msg: `«${d.text}»: указано ${d.count} шт., в файле ${ids.length}` });
      dims.push({ textId: d.textId, text: d.text, kind: d.kind, value: d.value, count: d.count || null, pitch: d.pitch || null, refs: ids.map(id => ({ type: 'circle', id })), how: 'DIMENSION', status: st, conf: 1 });
    }
  }

  /* ---------- 5. Координаты отверстий: сначала из размеров (цепочки от базы), потом — измерение по рисунку ---------- */
  const ox = outline ? outline.x0 : Math.min(...C.map(c => c.cx - c.r)), oy = outline ? outline.y0 : Math.min(...C.map(c => c.cy - c.r));
  const solve = (axis) => {
    const key = c => axis === 'x' ? c.cx : c.cy, col = [];                       // окружности на одной вертикали/горизонтали — одна координата
    for (const c of C) { const k = col.find(g => near(g.at, key(c), tol * 1.5)); if (k) k.ids.push(c.id); else col.push({ at: key(c), ids: [c.id] }); }
    const val = new Map();                                                       // имя → {v, src}
    val.set(axis + '0', { v: 0, src: 'база' });
    if (outline) val.set(axis + '1', null);
    const nodeOf = r => r.type === 'circle' ? 'col:' + col.findIndex(g => g.ids.includes(r.id)) : r.type === 'edge' ? r.id : null;
    const cons = dims.filter(d => d.kind === 'linear' && d.axis === axis && d.status !== 'unassociated' && d.refs).map(d => ({ a: nodeOf(d.refs[0]), b: nodeOf(d.refs[1]), v: d.value, d }))
      .filter(c => c.a && c.b && c.a !== c.b);
    for (let it = 0; it < 20; it++) {
      let ch = false;
      for (const c of cons) {
        const A = val.get(c.a), B = val.get(c.b);
        if (A && !B) { val.set(c.b, { v: A.v + c.v, src: 'размер ' + c.d.text }); ch = true; }
        else if (B && !A) { val.set(c.a, { v: B.v - c.v, src: 'размер ' + c.d.text }); ch = true; }
        else if (A && B && !near(B.v - A.v, c.v, 0.01)) { if (!c.bad) { c.bad = 1; conflicts.push({ textId: c.d.textId, msg: `Размеры противоречат друг другу: ${c.d.text} ≠ ${(B.v - A.v).toFixed(2)}` }); } }
      }
      if (!ch) break;
    }
    const res = {};
    col.forEach((g, i) => {
      const k = val.get('col:' + i), meas = (g.at - (axis === 'x' ? ox : oy)) * s;
      for (const id of g.ids) res[id] = k ? { value: +k.v.toFixed(3), source: 'dimension', note: k.src, measured: Number.isFinite(meas) ? +meas.toFixed(3) : null }
        : { value: Number.isFinite(meas) ? +meas.toFixed(units === 'mm' ? 3 : 1) : null, source: 'measured', note: units === 'mm' ? 'по геометрии файла' : 'измерено по фото — проверьте', measured: meas };
      if (k && Number.isFinite(meas) && Math.abs(meas - k.v) > (units === 'mm' ? 0.05 : Math.max(0.5, k.v * 0.03)))
        conflicts.push({ msg: `Отверстие ${g.ids[0]}: по размеру ${axis.toUpperCase()}=${k.v}, по рисунку ≈ ${meas.toFixed(2)}` });
    });
    return { res, edge1: val.get(axis + '1') };
  };
  const SX = solve('x'), SY = solve('y');

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
  const plate = outline ? {
    du: outline,
    w: SX.edge1 ? { value: SX.edge1.v, source: 'dimension', note: SX.edge1.src } : { value: Number.isFinite(s) ? +((outline.x1 - outline.x0) * s).toFixed(2) : null, source: 'measured' },
    h: SY.edge1 ? { value: SY.edge1.v, source: 'dimension', note: SY.edge1.src } : { value: Number.isFinite(s) ? +((outline.y1 - outline.y0) * s).toFixed(2) : null, source: 'measured' },
  } : null;
  const used = new Set(dims.filter(d => d.status !== 'unassociated').map(d => d.textId));
  if (thick) used.add(thick.id);
  return {
    units, tol, scale, outline: plate, holes, dims, conflicts, notes,
    thickness: thick ? { value: thick.p.value, source: 'dimension', textId: thick.id } : null,
    unassigned: T.filter(t => !used.has(t.id) && t.p.kind !== 'text').map(t => ({ id: t.id, text: t.p.raw })),
    otherText: T.filter(t => t.p.kind === 'text').map(t => t.p.raw),
  };
}
