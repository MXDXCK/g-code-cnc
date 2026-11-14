// Ответ нейросети сверяется с геометрией: ИИ только подсказывает, выдуманное отбрасывается.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { importDXF } from '../../src/drawing/import-dxf.js';
import { associate } from '../../src/drawing/associate.js';
import { normalizeAI, crossCheck, holeHint } from '../../src/ai/validate.js';

const plate = () => associate({ ...importDXF(fs.readFileSync(new URL('../fixtures/drawings/01-plate-4-holes/plate.dxf', import.meta.url), 'utf8')) });
const byPos = (a, x, y) => a.holes.findIndex(h => h.x.value === x && h.y.value === y);

test('согласие, расхождение и выдуманное отверстие', () => {
  const a = plate();
  const ai = normalizeAI({ plate: { w: 120, h: 80 }, holes: [
    { x: 15, y: 15, d: 10 },            // всё верно
    { x: 105, y: 15, d: 12 },           // Ø не тот — противоречит рисунку
    { x: 15, y: 65.5, d: 10 },          // Y чуть иначе — «ИИ видит иначе»
    { x: 60, y: 40, d: 10 },            // отверстия там нет — выдумано
  ], dims: ['15', '90', '120', '4 отв. Ø10', 'Ra 3,2'] });
  const c = crossCheck(a, ai);
  const h1 = c.perHole[byPos(a, 15, 15)], h2 = c.perHole[byPos(a, 105, 15)], h3 = c.perHole[byPos(a, 15, 65)], h4 = c.perHole[byPos(a, 105, 65)];
  assert.deepEqual([h1.x, h1.y, h1.d], ['agree', 'agree', 'agree']);
  assert.equal(h2.d, 'contradicts-geometry');
  assert.equal(h3.y, 'differs');
  assert.equal(h4.ai, null);                                         // ИИ про него ничего не сказал
  assert.equal(c.ignored.length, 1);
  assert.match(c.ignored[0].why, /нет окружности/);
  assert.deepEqual(c.plate.w, 'agree');
  assert.match(holeHint(h2), /не используется/);
  assert.match(holeHint(h3), /ИИ видит 65.5/);
});

test('мусор и чужие поля в ответе модели отбрасываются', () => {
  const ai = normalizeAI({ holes: [null, 'x', { x: '15', y: 'abc', d: 10, evil: 1 }], dims: [1, 2], plate: 5, extra: 'drop' });
  assert.deepEqual(ai.holes, [{ x: 15, y: null, d: 10, kind: null }]);
  assert.deepEqual(ai.dims, ['1', '2']);
  assert.equal(ai.plate, null);
  assert.deepEqual(normalizeAI(null), { holes: [], dims: [], plate: null, notes: [] });
});

test('ИИ не заполняет спорное: при конфликте размера значение не считается «нашим»', () => {
  const a = plate();
  const i = byPos(a, 105, 15);
  a.holes[i].x.conflict = { measured: 100 };
  const c = crossCheck(a, normalizeAI({ holes: [{ x: 105, y: 15, d: 10 }], dims: [] }));
  assert.equal(c.perHole[i].x, 'only-ai');        // показать как подсказку, решать человеку
  assert.match(holeHint(c.perHole[i]), /ИИ предлагает 105 — проверь/);
});
