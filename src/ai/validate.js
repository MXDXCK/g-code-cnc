// Проверка ответа нейросети геометрией чертежа. ИИ ничего не подтверждает и ничего не подставляет сам:
// его значения становятся ПОДСКАЗКАМИ рядом с полями, и только если не противоречат рисунку.
// Чистые функции, без DOM — проверяются модульными тестами (tests/unit/ai-validate.test.mjs).

const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(+v)) ? null : +v;

/** Привести ответ модели к одному виду. Мусор и лишние поля отбрасываются. */
export function normalizeAI(raw) {
  const j = raw && typeof raw === 'object' ? raw : {};
  const holes = Array.isArray(j.holes) ? j.holes.filter(h => h && typeof h === 'object').slice(0, 100)
    .map(h => ({ x: num(h.x), y: num(h.y), d: num(h.d), kind: typeof h.kind === 'string' ? h.kind.slice(0, 40) : null })) : [];
  const dims = Array.isArray(j.dims) ? j.dims.map(String).map(s => s.slice(0, 60)).slice(0, 200) : [];
  const plate = j.plate && typeof j.plate === 'object' ? { w: num(j.plate.w), h: num(j.plate.h) } : null;
  const notes = Array.isArray(j.notes) ? j.notes.map(String).map(s => s.slice(0, 200)).slice(0, 20) : [];
  return { holes, dims, plate, notes };
}

/**
 * Сверить ответ ИИ с найденной геометрией.
 * @param {object} assoc  результат associate(): holes[{x,y,d}] в мм от левого нижнего угла детали, outline
 * @param {object} ai     normalizeAI(...)
 * @param {{posTol?:number, dTol?:number}} opt  допуски сопоставления (мм; Ø — доля)
 * @returns {{perHole: Array<{ai:object|null, x:string, y:string, d:string}>, ignored: Array, unread: string[], plate: object|null, notes: string[]}}
 *   x/y/d: 'agree' — ИИ согласен с распознанным; 'differs' — ИИ видит иначе (показать, не подставлять);
 *          'only-ai' — у нас пусто, ИИ предлагает (показать как подсказку); 'none' — ИИ не дал значения
 */
export function crossCheck(assoc, ai, opt = {}) {
  const posTol = opt.posTol ?? 1.0, dTol = opt.dTol ?? 0.05;
  const H = assoc.holes || [], used = new Set(), perHole = H.map(() => null), ignored = [];
  const val = q => q && q.value != null && !q.conflict ? +q.value : null;
  const meas = q => q && q.measured != null ? +q.measured : val(q);
  // 1) сопоставить отверстия ИИ с окружностями рисунка по положению (сначала — по координатам, затем — по Ø при единственном кандидате)
  for (const a of ai.holes) {
    let best = -1, bd = Infinity;
    H.forEach((h, i) => {
      if (used.has(i)) return;
      const hx = meas(h.x), hy = meas(h.y);
      if (a.x == null || a.y == null || hx == null || hy == null) return;
      const d = Math.hypot(a.x - hx, a.y - hy); if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0 && bd <= Math.max(posTol, 3)) { used.add(best); perHole[best] = a; }
    else ignored.push({ ...a, why: a.x == null || a.y == null ? 'без координат' : 'на рисунке нет окружности в этом месте' });
  }
  const cmp = (mine, theirs, tol, rel) => {
    if (theirs == null) return 'none';
    if (mine == null) return 'only-ai';
    return Math.abs(mine - theirs) <= (rel ? tol * mine : tol) ? 'agree' : 'differs';
  };
  const out = H.map((h, i) => {
    const a = perHole[i];
    if (!a) return { ai: null, x: 'none', y: 'none', d: 'none' };
    // Ø от ИИ сверяется с размером окружности на рисунке: если рисунок другой — подсказку не даём вовсе
    const dGeo = h.d && h.d.measured != null ? +h.d.measured : null;
    let d = cmp(val(h.d), a.d, dTol, true);
    if (a.d != null && dGeo != null && Math.abs(a.d - dGeo) > Math.max(0.5, 0.1 * dGeo)) d = 'contradicts-geometry';
    return { ai: a, x: cmp(val(h.x), a.x, 0.05), y: cmp(val(h.y), a.y, 0.05), d };
  });
  // 2) надписи, которые прочитал ИИ, но не нашёл OCR/файл — показываем как «не сопоставлено», без чисел в поля
  const norm = s => String(s).replace(/[\s,]/g, m => m === ',' ? '.' : '').replace(/[⌀∅]/g, 'Ø').toLowerCase();
  const known = new Set((assoc.dims || []).map(d => norm(d.text || '')).concat((assoc.unassigned || []).map(u => norm(u.text || ''))));
  const unread = ai.dims.filter(t => /\d/.test(t) && !known.has(norm(t)));
  const plate = ai.plate && assoc.outline ? {
    w: cmp(assoc.outline.w && assoc.outline.w.value, ai.plate.w, 0.05), h: cmp(assoc.outline.h && assoc.outline.h.value, ai.plate.h, 0.05), ai: ai.plate,
  } : null;
  return { perHole: out, ignored, unread, plate, notes: ai.notes };
}

/** Строка подсказки ИИ для одного отверстия (для показа под полями мастера). Пусто — показывать нечего. */
export function holeHint(c) {
  if (!c || !c.ai) return '';
  const a = c.ai, p = [];
  const one = (k, label, v) => {
    const s = c[k];
    if (s === 'agree') p.push(`${label} ✓`);
    else if (s === 'differs') p.push(`${label}: ИИ видит ${v} — проверь`);
    else if (s === 'only-ai') p.push(`${label}: ИИ предлагает ${v} — проверь`);
    else if (s === 'contradicts-geometry') p.push(`${label}: ИИ назвал ${v}, но окружность на рисунке другая — не используется`);
  };
  one('x', 'X', a.x); one('y', 'Y', a.y); one('d', 'Ø', a.d);
  return p.length ? 'ИИ: ' + p.join(' · ') : '';
}
