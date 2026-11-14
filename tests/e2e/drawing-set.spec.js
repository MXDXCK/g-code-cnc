// Матрица распознавания: эталонные чертежи №01–09 × форматы (DXF с размерами, DXF «линиями», PDF, PNG/скан).
// Эталон — expected.json (отдельно от файлов). Жёсткие требования (тест падает):
//  1) ни одного НЕВЕРНОГО значения с источником «по размеру» (dimension) — во всех форматах;
//  2) векторные форматы: все отверстия найдены, X/Y/Ø и габарит верны, лишних отверстий нет;
//  3) чертёж с противоречием даёт конфликт (векторные форматы);
//  4) допуски из надписей сохраняются (векторные форматы).
// Остальное (доля «по размеру», ошибки «измерено», лишние окружности на фото, время) пишется в test-results/drawing-matrix.json
// (по строке на файл: test-results/drawing-matrix/*.json) и сводится в docs/DIMENSION_ASSOCIATION.md. Это синтетика: она не заменяет проверку настоящих фото и сканов.
const { test, expect } = require('playwright/test');
const fs = require('fs'), path = require('path');
const { openApp, FIX } = require('../helpers');

const DIR = path.join(FIX, 'drawings');
const SETS = fs.readdirSync(DIR).filter(d => /^\d\d-/.test(d)).sort();
const FILES = d => fs.readdirSync(path.join(DIR, d)).filter(f => /\.(dxf|pdf|png|jpg)$/.test(f));
const kindOf = f => /lines\.dxf$/.test(f) ? 'dxf-lines' : f.endsWith('.dxf') ? 'dxf' : f.endsWith('.pdf') ? 'pdf' : 'raster';

async function run(page, file) {
  const b64 = fs.readFileSync(file).toString('base64'), name = path.basename(file);
  return page.evaluate(async ({ b64, name }) => {
    const P = await import('/src/drawing/pipeline.js'), PDF = await import('/src/drawing/import-pdf.js');
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const type = name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.png') ? 'image/png' : name.endsWith('.jpg') ? 'image/jpeg' : 'application/dxf';
    const file = new File([bytes], name, { type });
    const t0 = performance.now();
    const r = await P.readDrawing(file, { at: window.__at, pdfjs: () => PDF.loadPdfjs(false), ocr: () => window.__fresaOcrWorker({ tessedit_pageseg_mode: '11' }) });
    const a = r.a;
    return { ms: Math.round(performance.now() - t0), scale: a.scale, conflicts: a.conflicts.map(c => c.msg), notes: a.notes,
      outline: a.outline && { w: a.outline.w, h: a.outline.h }, thickness: a.thickness,
      holes: a.holes.map(h => ({ x: h.x, y: h.y, d: h.d })),
      dims: a.dims.map(d => ({ text: d.text, kind: d.kind, value: d.value, tol: d.tol || null, status: d.status })),
      unassigned: a.unassigned.map(u => u.text), nTexts: r.d.texts.length };
  }, { b64, name });
}

const near = (a, b, t) => a != null && Math.abs(a - b) <= t;
function analyse(E, r, kind) {
  const vec = kind !== 'raster', tolPos = vec ? 0.01 : 2, out = { wrongDim: [], missing: 0, extra: 0, byDim: 0, values: 0, measErr: [] };
  const val = (q, want, what, alt) => {
    if (!q || q.value == null) return;
    out.values++;
    // противоречивый чертёж: значение по размерам (alt) допустимо только с пометкой конфликта на самом значении
    if (alt != null && Math.abs(q.value - alt) < 1e-6) { if (!q.conflict) out.wrongDim.push(`${what}: ${q.value} по размеру без пометки о конфликте`); return; }
    if (q.source === 'dimension') { out.byDim++; if (Math.abs(q.value - want) > 1e-6) out.wrongDim.push(`${what}: «по размеру» ${q.value}, эталон ${want}`); }
    else out.measErr.push(Math.abs(q.value - want));
  };
  const used = new Set();
  for (const h of E.holes) {
    const okX = f => near(f.x && f.x.value, h.x, tolPos) || h.xDim != null && near(f.x && f.x.value, h.xDim, tolPos);
    const i = r.holes.findIndex((f, k) => !used.has(k) && okX(f) && near(f.y && f.y.value, h.y, tolPos));
    if (i < 0) { out.missing++; continue; }
    used.add(i); const f = r.holes[i];
    if (h.xDim != null && kind !== 'raster' && !(f.x && f.x.conflict)) out.wrongDim.push(`X отв.(${h.x},${h.y}): спорная координата без пометки о конфликте`);
    val(f.x, h.x, `X отв.(${h.x},${h.y})`, h.xDim); val(f.y, h.y, `Y отв.(${h.x},${h.y})`); val(f.d, h.d, `Ø отв.(${h.x},${h.y})`);
    if (vec && !near(f.d && f.d.value, h.d, 0.01)) out.wrongDim.push(`Ø отв.(${h.x},${h.y}): ${f.d && f.d.value}, эталон ${h.d}`);
  }
  out.extra = r.holes.length - used.size;
  if (r.outline) { val(r.outline.w, E.plate.w, 'ширина'); val(r.outline.h, E.plate.h, 'высота'); }
  out.outlineOk = !!r.outline && near(r.outline.w.value, E.plate.w, vec ? 0.01 : 1.5) && near(r.outline.h.value, E.plate.h, vec ? 0.01 : 1.5);
  out.measMax = out.measErr.length ? +Math.max(...out.measErr).toFixed(2) : null;
  return out;
}

for (const set of SETS) for (const f of FILES(set)) {
  const kind = kindOf(f);
  test(`${set} · ${f}`, async ({ page }) => {
    test.setTimeout(kind === 'raster' ? 150000 : 60000);
    const errors = await openApp(page);
    const E = JSON.parse(fs.readFileSync(path.join(DIR, set, 'expected.json'), 'utf8'));
    const r = await run(page, path.join(DIR, set, f));
    const A = analyse(E, r, kind);
    const row = { set, file: f, kind, ms: r.ms, holes: `${E.holes.length - A.missing}/${E.holes.length}`, extra: A.extra, byDim: `${A.byDim}/${A.values}`,
      measMax: A.measMax, outline: A.outlineOk, scaleN: r.scale.n, conflicts: r.conflicts.length, wrongDim: A.wrongDim, thickness: r.thickness && r.thickness.value, unassigned: r.unassigned };
    fs.mkdirSync('test-results/drawing-matrix', { recursive: true });
    fs.writeFileSync(`test-results/drawing-matrix/${set}__${f}.json`, JSON.stringify(row));
    console.log(JSON.stringify(row));
    expect(A.wrongDim, 'значения «по размеру» не должны быть неверными').toEqual([]);
    if (kind !== 'raster') {
      expect(A.missing, 'векторный чертёж: все отверстия найдены').toBe(0);
      expect(A.extra, 'векторный чертёж: лишних отверстий нет').toBe(0);
      expect(A.outlineOk, 'векторный чертёж: габарит детали').toBe(true);
      if (E.conflict) expect(r.conflicts.length, 'противоречие показано как конфликт').toBeGreaterThan(0);
      else expect(r.conflicts, 'нет ложных конфликтов').toEqual([]);
      for (const [v, [up, lo]] of Object.entries(E.tolerances || {})) {
        const d = r.dims.find(d => d.value === +v && d.kind === 'linear');
        expect(d && d.tol, `допуск размера ${v}`).toEqual({ upper: up, lower: lo });
      }
      for (const h of E.holes.filter(h => h.fit)) expect(r.dims.some(d => d.kind === 'dia' && d.tol && d.tol.fit === h.fit), `посадка ${h.fit}`).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}
