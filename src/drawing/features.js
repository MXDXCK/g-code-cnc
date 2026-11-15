// Элементы внутри контура детали: прямоугольные карманы (острые / скруглённые углы) и пазы со скруглёнными торцами.
// Только геометрия рисунка (единицы рисунка, ось Y вверх). Что это — карман, окно, выступ — решает человек в мастере:
// графический элемент ≠ технологическая операция.
// Опорные точки (keypoints) — координаты, к которым на чертеже ставят размеры: стороны кармана, центры торцов паза, стороны паза.

const len = s => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
const near = (a, b, t) => Math.abs(a - b) <= t;
function ptSeg(px, py, s) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L2 = dx * dx + dy * dy || 1e-12;
  const u = ((px - s.x1) * dx + (py - s.y1) * dy) / L2, cx = s.x1 + u * dx, cy = s.y1 + u * dy;
  return { d: Math.hypot(px - cx, py - cy), u };
}

/**
 * @param {Array} segs  отрезки рисунка
 * @param {object} outline  контур детали {x0,x1,y0,y1} (или null — тогда элементы не ищутся: нет «внутри»)
 * @param {number} tol  допуск в единицах рисунка
 * @param {object} findRects  функция поиска прямоугольников (из associate.js) — чтобы не дублировать правила углов
 * @returns {{pockets:Array, slots:Array}}
 */
export function findFeatures(segs, outline, tol, findRects) {
  if (!outline) return { pockets: [], slots: [] };
  const m = 3 * tol, inside = (x, y) => x > outline.x0 + m && x < outline.x1 - m && y > outline.y0 + m && y < outline.y1 - m;
  const inner = segs.filter(s => inside(s.x1, s.y1) && inside(s.x2, s.y2));
  const onLine = (x, y) => inner.some(o => { const q = ptSeg(x, y, o); return q.d <= tol * 1.5 && q.u >= -0.05 && q.u <= 1.05; });

  // 1) прямоугольники целиком внутри контура
  const pockets = (findRects(inner, tol) || [])
    .filter(r => inside(r.x0, r.y0) && inside(r.x1, r.y1))
    .sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));
  // вложенные друг в друга (одна сторона общая и т. п.) — оставляем только непересекающиеся, большие первыми
  const P = [];
  for (const r of pockets) if (!P.some(p => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0)) P.push(r);

  // 2) пазы: две параллельные равные стороны + полуокружности на торцах (точки на 45°, 90°, 135°)
  const slots = [];
  const axisSegs = ax => inner.filter(s => ax === 'h' ? Math.abs(s.y2 - s.y1) <= Math.min(tol, 0.02 * len(s) + tol / 2) : Math.abs(s.x2 - s.x1) <= Math.min(tol, 0.02 * len(s) + tol / 2)).filter(s => len(s) > tol * 4);
  for (const ax of ['h', 'v']) {
    const L = axisSegs(ax).map(s => ax === 'h' ? { a: Math.min(s.x1, s.x2), b: Math.max(s.x1, s.x2), at: (s.y1 + s.y2) / 2 } : { a: Math.min(s.y1, s.y2), b: Math.max(s.y1, s.y2), at: (s.x1 + s.x2) / 2 });
    for (let i = 0; i < L.length; i++) for (let j = 0; j < L.length; j++) {
      const p = L[i], q = L[j]; if (q.at <= p.at + tol) continue;
      if (!near(p.a, q.a, 2 * tol) || !near(p.b, q.b, 2 * tol)) continue;
      const w = q.at - p.at, r = w / 2, mid = (p.at + q.at) / 2, a = (p.a + q.a) / 2, b = (p.b + q.b) / 2;
      if (b - a < tol * 2 || w < tol * 4) continue;
      const pt = (u, v) => ax === 'h' ? [u, v] : [v, u];
      const arcOK = (c, sgn) => [45, 90, 135].every(deg => { const t = deg * Math.PI / 180; const [x, y] = pt(c + sgn * r * Math.sin(t), mid - r * Math.cos(t)); return onLine(x, y); });
      if (!arcOK(a, -1) || !arcOK(b, 1)) continue;
      if (P.some(k => { const [x, y] = pt((a + b) / 2, mid); return x > k.x0 && x < k.x1 && y > k.y0 && y < k.y1; })) continue;
      if (slots.some(s => s.ax === ax && near(s.mid, mid, tol * 2) && near(s.a, a, tol * 2))) continue;
      slots.push({ ax, a, b, mid, w });
    }
  }
  return { pockets: P, slots };
}

/** Опорные точки элементов по оси: [{axis:'x'|'y', at, id, feat, role}] (at — координата рисунка). */
export function keypoints(feats) {
  const K = [];
  feats.pockets.forEach((p, i) => {
    const f = 'pk' + i;
    K.push({ axis: 'x', at: p.x0, id: f + ':x0', feat: f, role: 'левая сторона' }, { axis: 'x', at: p.x1, id: f + ':x1', feat: f, role: 'правая сторона' },
      { axis: 'y', at: p.y0, id: f + ':y0', feat: f, role: 'нижняя сторона' }, { axis: 'y', at: p.y1, id: f + ':y1', feat: f, role: 'верхняя сторона' });
  });
  feats.slots.forEach((s, i) => {
    const f = 'sl' + i, A = s.ax === 'h' ? 'x' : 'y', B = s.ax === 'h' ? 'y' : 'x', r = s.w / 2;
    K.push({ axis: A, at: s.a, id: f + ':c1', feat: f, role: 'центр торца 1' }, { axis: A, at: s.b, id: f + ':c2', feat: f, role: 'центр торца 2' },
      { axis: A, at: s.a - r, id: f + ':e1', feat: f, role: 'край торца 1' }, { axis: A, at: s.b + r, id: f + ':e2', feat: f, role: 'край торца 2' },
      { axis: B, at: s.mid - r, id: f + ':s0', feat: f, role: 'сторона 1' }, { axis: B, at: s.mid + r, id: f + ':s1', feat: f, role: 'сторона 2' },
      { axis: B, at: s.mid, id: f + ':m', feat: f, role: 'ось паза' });
  });
  return K;
}
