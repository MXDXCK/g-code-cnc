// DXF → геометрия + надписи + размеры (точно, без нейросети).
// В отличие от старого dxfPrims (index.html), здесь читаются TEXT, MTEXT и DIMENSION — это нужно для привязки размеров.
import { normalizeText, parseDimText } from './dimtext.js';

function pairs(txt) {
  const L = String(txt).replace(/\r/g, '').split('\n'), out = [];
  for (let i = 0; i + 1 < L.length; i += 2) out.push([parseInt(L[i].trim(), 10), L[i + 1].replace(/\s+$/, '')]);
  return out;
}

/** Разобрать DXF. Возвращает данные для associate() и предупреждения. */
export function importDXF(txt) {
  const P = pairs(txt), warn = [];
  let units = 'mm';
  const iu = P.findIndex(([c, v]) => c === 9 && v.trim() === '$INSUNITS');
  if (iu >= 0) { const v = +P[iu + 1][1]; if (v === 1) units = 'inch'; else if (v && v !== 4) warn.push('единицы чертежа не мм (код ' + v + ') — проверьте масштаб'); }
  let i = P.findIndex(([c, v]) => c === 2 && v.trim() === 'ENTITIES');
  if (i < 0) throw new Error('В DXF нет секции ENTITIES');
  const ents = []; let cur = null;
  for (i++; i < P.length; i++) { const [c, v] = P[i]; if (c === 0) { if (v.trim() === 'ENDSEC') break; cur = { type: v.trim(), g: [] }; ents.push(cur); } else if (cur) cur.g.push([c, v]); }
  const num = (e, c, d = 0) => { const q = e.g.find(x => x[0] === c); return q ? parseFloat(q[1]) : d; };
  const str = (e, c) => e.g.filter(x => x[0] === c).map(x => x[1]).join('');
  const k = units === 'inch' ? 25.4 : 1;
  const segs = [], circles = [], arcs = [], texts = [], dimPts = [], skipped = {};
  const seg = (x1, y1, x2, y2, src) => { if (Math.hypot(x2 - x1, y2 - y1) > 1e-9) segs.push({ x1: x1 * k, y1: y1 * k, x2: x2 * k, y2: y2 * k, src }); };
  let poly = null;
  for (const e of ents) {
    const t = e.type;
    if (t === 'LINE') seg(num(e, 10), num(e, 20), num(e, 11), num(e, 21), 'LINE');
    else if (t === 'CIRCLE') circles.push({ cx: num(e, 10) * k, cy: num(e, 20) * k, r: num(e, 40) * k, src: 'CIRCLE' });
    else if (t === 'ARC') arcs.push({ cx: num(e, 10) * k, cy: num(e, 20) * k, r: num(e, 40) * k, a1: num(e, 50), a2: num(e, 51) });
    else if (t === 'LWPOLYLINE') {
      const V = []; let last = null;
      for (const [c, v] of e.g) { if (c === 10) { last = { x: +v, y: 0, b: 0 }; V.push(last); } else if (c === 20 && last) last.y = +v; else if (c === 42 && last) last.b = +v; }
      const closed = (num(e, 70) & 1) === 1;
      for (let j = 0; j < (closed ? V.length : V.length - 1); j++) { const a = V[j], b = V[(j + 1) % V.length]; if (a.b) warn.push('дуги в полилиниях упрощены до хорд'); seg(a.x, a.y, b.x, b.y, 'LWPOLYLINE'); }
    } else if (t === 'POLYLINE') poly = { closed: (num(e, 70) & 1) === 1, V: [] };
    else if (t === 'VERTEX' && poly) poly.V.push({ x: num(e, 10), y: num(e, 20) });
    else if (t === 'SEQEND' && poly) { const V = poly.V; for (let j = 0; j < (poly.closed ? V.length : V.length - 1); j++) { const a = V[j], b = V[(j + 1) % V.length]; seg(a.x, a.y, b.x, b.y, 'POLYLINE'); } poly = null; }
    else if (t === 'TEXT' || t === 'MTEXT') {
      const s = normalizeText(t === 'MTEXT' ? str(e, 3) + str(e, 1) : str(e, 1)), h = num(e, 40, 2.5) * k;
      let ang = num(e, 50, 0);
      if (t === 'MTEXT' && e.g.some(x => x[0] === 11)) ang = Math.atan2(num(e, 21), num(e, 11)) * 180 / Math.PI;
      // точка вставки TEXT — слева на базовой линии (если не задано выравнивание 72/73); центр — примерно
      const useAlign = t === 'TEXT' && (num(e, 72) || num(e, 73));
      let x = (useAlign ? num(e, 11) : num(e, 10)) * k, y = (useAlign ? num(e, 21) : num(e, 20)) * k;
      const w = 0.6 * h * s.length, a = ang * Math.PI / 180, att = t === 'MTEXT' ? num(e, 71, 1) : 0;
      let dx = w / 2, dy = h / 2;
      if (t === 'MTEXT') { const col = (att - 1) % 3, row = Math.floor((att - 1) / 3); dx = w / 2 - col * w / 2; dy = -h / 2 + row * h / 2; }
      else if (useAlign) { dx = 0; dy = h / 2; }
      texts.push({ s, x: x + dx * Math.cos(a) - dy * Math.sin(a), y: y + dx * Math.sin(a) + dy * Math.cos(a), h, ang, src: t });
    } else if (t === 'DIMENSION') {
      const type = num(e, 70) & 7, over = normalizeText(str(e, 1)), meas = num(e, 42, NaN);
      const parsed = over && !over.includes('<>') ? parseDimText(over) : null;
      const value = parsed && parsed.value != null ? parsed.value : Number.isFinite(meas) ? +(meas * k).toFixed(4) : NaN;
      const text = over && !over.includes('<>') ? over : (over || '<>').replace('<>', String(+(meas * k).toFixed(3)));
      const p = c => [num(e, c) * k, num(e, c + 10) * k];
      if (type === 0 || type === 1) {
        const p1 = p(13), p2 = p(14), ang = num(e, 50, 0) % 180;
        const axis = type === 0 ? (Math.abs(ang) < 1 ? 'x' : Math.abs(ang - 90) < 1 ? 'y' : 'aligned') : (Math.abs(p1[1] - p2[1]) < 1e-6 ? 'x' : Math.abs(p1[0] - p2[0]) < 1e-6 ? 'y' : 'aligned');
        dimPts.push({ kind: 'linear', axis, value, text, tol: parsed && parsed.tol, p1, p2, textId: 'dim' + dimPts.length });
      } else if (type === 3) {
        const a = p(10), b = p(15);
        dimPts.push({ kind: parsed && parsed.kind === 'thread' ? 'thread' : 'dia', value: parsed && parsed.kind === 'dia' || !parsed ? value : parsed.value, pitch: parsed && parsed.pitch, count: parsed && parsed.count,
          text, center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], r: Math.hypot(b[0] - a[0], b[1] - a[1]) / 2, textId: 'dim' + dimPts.length });
      } else if (type === 4) {
        dimPts.push({ kind: 'rad', value, text, center: p(10), textId: 'dim' + dimPts.length });
      } else { skipped['DIMENSION тип ' + type] = (skipped['DIMENSION тип ' + type] || 0) + 1; }
    } else if (!['SEQEND', 'VERTEX', 'POINT', 'HATCH', 'SOLID', 'LEADER', 'MLEADER'].includes(t)) skipped[t] = (skipped[t] || 0) + 1;
  }
  // полная дуга 360° из ARC — тоже окружность
  for (const a of arcs) if (Math.abs(((a.a2 - a.a1) % 360 + 360) % 360) < 1e-6) circles.push({ cx: a.cx * k, cy: a.cy * k, r: a.r * k, src: 'ARC' });
  if (Object.keys(skipped).length) warn.push('пропущено: ' + Object.entries(skipped).map(([a, b]) => a + ' ×' + b).join(', '));
  return { units: 'mm', segs, circles, arcs, texts, dimPts, warnings: [...new Set(warn)] };
}
