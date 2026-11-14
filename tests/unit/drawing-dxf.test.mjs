// Юнит-тесты без браузера: node --test tests/unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { importDXF } from '../../src/drawing/import-dxf.js';
import { associate } from '../../src/drawing/associate.js';
import { parseDimText } from '../../src/drawing/dimtext.js';

const DIR = new URL('../fixtures/drawings/01-plate-4-holes/', import.meta.url);
const expected = JSON.parse(fs.readFileSync(new URL('expected.json', DIR), 'utf8'));

test('разбор надписей', () => {
  assert.deepEqual([parseDimText('4 отв. %%c10').kind, parseDimText('4 отв. %%c10').value, parseDimText('4 отв. %%c10').count], ['dia', 10, 4]);
  assert.equal(parseDimText('4xØ8,5').value, 8.5);
  assert.equal(parseDimText('Ф12').kind, 'dia');
  assert.deepEqual([parseDimText('M8x1.25').kind, parseDimText('M8x1.25').value, parseDimText('M8x1.25').pitch], ['thread', 8, 1.25]);
  assert.deepEqual(parseDimText('50±0,1').tol, { upper: 0.1, lower: -0.1 });
  assert.equal(parseDimText('Толщина 10').kind, 'thick');
  assert.equal(parseDimText('s10').value, 10);
  assert.equal(parseDimText('R5').kind, 'rad');
  assert.equal(parseDimText('120').kind, 'linear');
  assert.equal(parseDimText('Сталь 45').kind, 'text');
});

test('DXF пластины: отверстия, размеры и толщина — точно по эталону', () => {
  const d = importDXF(fs.readFileSync(new URL('plate.dxf', DIR), 'utf8'));
  assert.equal(d.circles.length, 4);
  assert.equal(d.dimPts.length, 7);
  const r = associate({ segs: d.segs, circles: d.circles, texts: d.texts, dimPts: d.dimPts, units: 'mm' });
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.outline.w.value, expected.plate.w);
  assert.equal(r.outline.h.value, expected.plate.h);
  assert.equal(r.outline.w.source, 'dimension');
  assert.equal(r.thickness.value, expected.plate.thickness);
  const got = r.holes.map(h => [h.x.value, h.y.value, h.d.value, h.x.source, h.y.source, h.d.source]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const want = expected.holes.map(h => [h.x, h.y, h.d, 'dimension', 'dimension', 'dimension']).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  assert.deepEqual(got, want);
});

test('DXF: противоречивый размер даёт конфликт, а не подгонку', () => {
  const src = fs.readFileSync(new URL('plate.dxf', DIR), 'utf8').replace('42\n90\n', '42\n91\n');
  const d = importDXF(src);
  const r = associate({ segs: d.segs, circles: d.circles, texts: d.texts, dimPts: d.dimPts, units: 'mm' });
  assert.ok(r.conflicts.length >= 1, 'должен быть конфликт');
});
