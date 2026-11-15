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
const { kindOf, run, analyse } = require('../drawing-check');

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
