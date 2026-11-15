// Объединение двух проходов OCR: русские слова — из прохода с русским словарём, числа и Ø — из основного.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineRu } from '../../src/drawing/import-raster.js';
import { parseDimText } from '../../src/drawing/dimtext.js';

const box = (s, x0, y0, x1, y1, conf = 0.9, ang = 0) => ({ s, x0, y0, x1, y1, conf, ang });

test('«Толщина 10»: основной проход прочёл только «10» — заменяется русской строкой (числа совпали)', () => {
  const out = combineRu([box('10', 60, 0, 80, 10)], [box('Толщина 10', 0, 0, 80, 10)]);
  assert.equal(out.length, 1); assert.equal(out[0].s, 'Толщина 10');
  assert.equal(parseDimText(out[0].s).kind, 'thick');
});
test('числа разные («4 отв. Ø10» и «4 отв. 210») — остаётся основная строка', () => {
  const out = combineRu([box('4 отв. Ø10', 0, 0, 90, 10)], [box('4 отв. 210', 0, 0, 90, 10)]);
  assert.deepEqual(out.map(o => o.s), ['4 отв. Ø10']);
});
test('в основной строке есть Ø — не заменяется, даже если числа совпали', () => {
  const out = combineRu([box('2 отв. Ø8', 0, 0, 90, 10)], [box('2 отв. 08', 0, 0, 90, 10)]);
  assert.deepEqual(out.map(o => o.s), ['2 отв. Ø8']);
});
test('строка без русских ключевых слов из второго прохода не берётся (числа — только из основного)', () => {
  const out = combineRu([box('120', 0, 0, 30, 10)], [box('120', 0, 0, 30, 10), box('З0', 100, 0, 120, 10)]);
  assert.deepEqual(out.map(o => o.s), ['120']);
});
test('«Сквозное» на пустом месте — добавляется; с низкой уверенностью — нет', () => {
  assert.deepEqual(combineRu([], [box('Сквозное', 0, 0, 60, 10, 0.8)]).map(o => o.s), ['Сквозное']);
  assert.deepEqual(combineRu([], [box('Сквозное', 0, 0, 60, 10, 0.4)]), []);
});
test('русская строка перекрывает две основные — ничего не меняется', () => {
  const E = [box('5', 0, 0, 10, 10), box('25', 20, 0, 40, 10)];
  assert.deepEqual(combineRu(E, [box('Глубина 5 25', 0, 0, 40, 10)]).map(o => o.s), ['5', '25']);
});
