// Общая проверка распознавания чертежа (матрица эталонов и частные чертежи владельца): чтение файла в браузере
// тем же конвейером, что в приложении, и сравнение с эталоном expected.json.
const fs = require('fs'), path = require('path');

const kindOf = f => /lines\.dxf$/i.test(f) ? 'dxf-lines' : /\.dxf$/i.test(f) ? 'dxf' : /\.pdf$/i.test(f) ? 'pdf' : 'raster';

async function run(page, file) {
  const b64 = fs.readFileSync(file).toString('base64'), name = path.basename(file);
  return page.evaluate(async ({ b64, name }) => {
    const P = await import('/src/drawing/pipeline.js'), PDF = await import('/src/drawing/import-pdf.js');
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const n = name.toLowerCase(), type = n.endsWith('.pdf') ? 'application/pdf' : n.endsWith('.png') ? 'image/png' : /\.jpe?g$/.test(n) ? 'image/jpeg' : 'application/dxf';
    const file = new File([bytes], name, { type });
    const t0 = performance.now();
    const r = await P.readDrawing(file, { at: window.__at, pdfjs: () => PDF.loadPdfjs(false), ocr: () => window.__fresaOcrWorker({ tessedit_pageseg_mode: '11' }),
      ocrRu: () => window.__fresaOcrWorker({ tessedit_pageseg_mode: '11' }, null, 'rus+eng') });   // как в приложении
    const a = r.a;
    return { ms: Math.round(performance.now() - t0), scale: a.scale, conflicts: a.conflicts.map(c => c.msg), notes: a.notes,
      outline: a.outline && { w: a.outline.w, h: a.outline.h }, thickness: a.thickness,
      holes: a.holes.map(h => ({ x: h.x, y: h.y, d: h.d })),
      features: a.features.map(f => ({ kind: f.kind, cx: f.cx, cy: f.cy, w: f.w, h: f.h, l: f.l, r: f.r })),
      texts: (r.d.texts || []).map(t => t.s),
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
    // неполная цепочка: координату нельзя вывести из размеров — «по размеру» здесь было бы выдумкой, даже если число совпало
    if ((E.unknownX || []).includes(h.x) && f.x && f.x.source === 'dimension') out.wrongDim.push(`X отв.(${h.x},${h.y}): по размерам не определяется, а выдано «по размеру»`);
    if (vec && !near(f.d && f.d.value, h.d, 0.01)) out.wrongDim.push(`Ø отв.(${h.x},${h.y}): ${f.d && f.d.value}, эталон ${h.d}`);
  }
  out.extra = r.holes.length - used.size;
  if (r.outline) { val(r.outline.w, E.plate.w, 'ширина'); val(r.outline.h, E.plate.h, 'высота'); }
  out.outlineOk = !!r.outline && near(r.outline.w.value, E.plate.w, vec ? 0.01 : 1.5) && near(r.outline.h.value, E.plate.h, vec ? 0.01 : 1.5);
  out.measMax = out.measErr.length ? +Math.max(...out.measErr).toFixed(2) : null;
  return out;
}

module.exports = { kindOf, run, analyse };
