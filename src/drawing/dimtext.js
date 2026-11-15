// Разбор размерных надписей чертежа: что написано, а не где. Чистые функции, без DOM.
// Поддержка: Ø/⌀/∅/%%c/Ф10, «4 отв. Ø10», «4×Ø10», R5, M8, M8x1.25, 50±0.1, Ø10H7, «s10», «Толщина 10», «10×45°»,
// «Глубина 5» / «глуб. 5», «Фаска 1×45°», «Сквозное».

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const toN = s => +String(s).replace(',', '.');

/** Привести текст из DXF/PDF/OCR к одному виду. */
export function normalizeText(s) {
  return String(s || '')
    .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±')     // коды DXF
    .replace(/\\[Pp]/g, ' ').replace(/\{\\[^;{}]*;|\}|\{/g, '')                 // форматирование MTEXT
    .replace(/[⌀∅]/g, 'Ø').replace(/(^|[\s(])[Фф](?=\s?\d)/g, (m, a) => a + 'Ø') // «Ф10» → «Ø10». «O10»/«010» от OCR сюда не входят: путаница с нулём решается в import-raster с пониженной уверенностью
    // OCR с русским словарём: похожие кириллические буквы в обозначениях — латиницей («М6» → M6, «Ø10Н7» → Ø10H7)
    .replace(/(^|[\s(x×])М(?=\s?\d)/g, '$1M')
    .replace(/(\d)([АВЕКМНРСТ])(?=\d{1,2}(?!\d))/g, (m, d, c) => d + 'ABEKMHPCT'['АВЕКМНРСТ'.indexOf(c)])
    .replace(/[×хХ*]/g, 'x').replace(/\s+/g, ' ').trim();
}

/**
 * Разобрать одну надпись.
 * @returns {{kind:'dia'|'rad'|'thread'|'thick'|'depth'|'through'|'chamfer'|'linear'|'count'|'text', value?:number, count?:number, pitch?:number, tol?:{upper:number,lower:number,fit?:string}, raw:string}}
 */
export function parseDimText(raw) {
  const s = normalizeText(raw);
  const r = { raw: s, kind: 'text' };
  let m;
  const cnt = /(\d+)\s*(?:отв\.?|отверст\w*|holes?|x)\s*(?=Ø|M\d|$)/i.exec(s);
  if (cnt) r.count = +cnt[1];
  if ((m = new RegExp(String.raw`Ø\s*` + NUM + String.raw`\s*([A-Za-z]{1,2}\d{1,2})?`).exec(s))) {
    r.kind = 'dia'; r.value = toN(m[1]); if (m[2]) r.tol = { fit: m[2], upper: null, lower: null };
  } else if ((m = new RegExp(String.raw`(?:^|\s)M\s*` + NUM + String.raw`(?:\s*x\s*` + NUM + ')?').exec(s))) {
    r.kind = 'thread'; r.value = toN(m[1]); if (m[2]) r.pitch = toN(m[2]);
  } else if ((m = new RegExp(String.raw`(?:^|\s)R\s*` + NUM).exec(s))) {
    r.kind = 'rad'; r.value = toN(m[1]);
  } else if ((m = new RegExp(String.raw`(?:^|\s)(?:s|S)\s*` + NUM + String.raw`(?:\s*мм)?$|толщ[а-яё]*\s*` + NUM, 'i').exec(s))) {
    r.kind = 'thick'; r.value = toN(m[1] || m[2]);
  } else if ((m = new RegExp(String.raw`глуб[а-яё]*\.?\s*` + NUM, 'i').exec(s))) {
    r.kind = 'depth'; r.value = toN(m[1]);
  } else if (/сквозн/i.test(s)) {
    r.kind = 'through';
  } else if ((m = new RegExp(String.raw`(?:^|фаска\s*)` + NUM + String.raw`\s*x\s*45\s*°?$`, 'i').exec(s))) {
    r.kind = 'chamfer'; r.value = toN(m[1]);
  } else if ((m = new RegExp('^' + NUM + String.raw`(?:\s*±\s*` + NUM + String.raw`|\s*([+-]\s*\d+(?:[.,]\d+)?)\s*([+-]\s*\d+(?:[.,]\d+)?)?)?$`).exec(s))) {
    r.kind = 'linear'; r.value = toN(m[1]);
    if (m[2]) r.tol = { upper: toN(m[2]), lower: -toN(m[2]) };
    else if (m[3]) { const a = toN(m[3].replace(/\s/g, '')), b = m[4] ? toN(m[4].replace(/\s/g, '')) : 0; r.tol = { upper: Math.max(a, b), lower: Math.min(a, b) }; }
  } else if ((m = new RegExp('^' + NUM + String.raw`\s*([A-Za-z]{1,2}\d{1,2})$`).exec(s))) {   // «12h9», «20H7» — размер с полем допуска
    r.kind = 'linear'; r.value = toN(m[1]); r.tol = { fit: m[2], upper: null, lower: null };
  } else if (r.count) r.kind = 'count';
  return r;
}
