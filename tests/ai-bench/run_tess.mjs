// Замер Tesseract.js (тот же движок и версия, что в Fresa) на русских надписях: eng (как сейчас в Fresa), rus, rus+eng
// и «комбинация»: слова — из rus, числа и знаки — из eng. Запускается в GitHub Actions (нужна сеть для словарей).
// node run_tess.mjs <out-dir>   (tesseract.js должен быть установлен: npm i tesseract.js@5.1.1)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(path.join(process.cwd(), 'x.js'));
const Tesseract = require('tesseract.js');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const PH = path.join(ROOT, 'tests', 'fixtures', 'ocr-phrases'), DRAW = path.join(ROOT, 'tests', 'fixtures', 'drawings');
const out = process.argv[2] || 'results'; fs.mkdirSync(out, { recursive: true });
const cache = path.join(out, '_tessdata'); fs.mkdirSync(cache, { recursive: true });

export const norm = s => String(s).toLowerCase().replace(/[⌀∅]/g, 'ø').replace(/%%c/g, 'ø').replace(/[×хx]/g, 'x').replace(/,/g, '.').replace(/\s+/g, '').replace(/[«»"'`]/g, '');
export const nums = s => (String(s).match(/\d+(?:[.,]\d+)?/g) || []).map(x => +x.replace(',', '.'));
export const words = s => (String(s).toLowerCase().match(/[а-яё]{3,}/g) || []);

function score(exp, got) {
  const ne = nums(exp), ng = nums(got);
  const numsOk = ne.length === ng.length && ne.every((n, i) => n === ng[i]);
  const extra = ng.filter(n => !ne.includes(n));
  const we = words(exp), wg = words(got);
  return { exact: norm(exp) === norm(got), nums: numsOk, words: we.length ? we.filter(w => wg.some(g => g === w)).length / we.length : null, invented: extra };
}

let peak = 0; const tick = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 30);

async function worker(lang, psm) {
  const w = await Tesseract.createWorker(lang, 1, { cachePath: cache });
  await w.setParameters({ tessedit_pageseg_mode: String(psm), preserve_interword_spaces: '1' });
  return w;
}

const E = JSON.parse(fs.readFileSync(path.join(PH, 'expected.json'), 'utf8'));
const rows = [], res = {};
for (const lang of ['eng', 'rus', 'rus+eng']) {
  peak = 0; const t0 = Date.now(); const w = await worker(lang, 7); const tLoad = Date.now() - t0;
  let tSum = 0;
  for (const it of E.items) {
    const t = Date.now(); const { data } = await w.recognize(path.join(PH, it.file)); tSum += Date.now() - t;
    const txt = data.text.trim(); (res[it.file] ||= {})[lang] = txt;
    rows.push({ engine: 'tesseract-' + lang, file: it.file, variant: it.variant, font: it.font, text: it.text, got: txt, ...score(it.text, txt) });
  }
  await w.terminate();
  rows.push({ engine: 'tesseract-' + lang, summary: true, load_ms: tLoad, ms_per_image: Math.round(tSum / E.items.length), peak_rss_mb: Math.round(peak / 2 ** 20) });
}
// комбинация как в Fresa (src/drawing/import-raster.js combineRu): строка с русским ключевым словом из прохода rus+eng
// заменяет строку eng, только если числа совпадают и в eng нет Ø; иначе остаётся eng (с поправкой «@10»/«010» → Ø10)
const fixO = t => t.replace(/(^|\s)[0OoQ@DОоФф](\d+(?:[.,]\d+)?)([A-Za-z]{1,2}\d{1,2})?$/, '$1Ø$2$3');
const KEY = /толщ|глуб|сквозн|фаск|карман|паз|отв|радиус|неуказ/i, dig = t => (String(t).match(/\d+(?:[.,]\d+)?/g) || []).join(' ');
for (const it of E.items) {
  const r = res[it.file], e = fixO(r.eng), ru = r['rus+eng'];
  const combo = /[а-яё]{3,}/i.test(ru) && KEY.test(ru) && dig(ru) === dig(e) && !/Ø/.test(e) ? ru : (e || (KEY.test(ru) ? ru : ''));
  rows.push({ engine: 'tesseract-fresa-combo', file: it.file, variant: it.variant, font: it.font, text: it.text, got: combo, ...score(it.text, combo) });
}
// чертежи целиком (psm 11 — как в мастере «По чертежу»): сколько надписей найдено
for (const lang of ['eng', 'rus+eng']) {
  const w = await worker(lang, 11);
  for (const d of fs.readdirSync(DRAW).sort()) {
    const dirp = path.join(DRAW, d); if (!fs.statSync(dirp).isDirectory()) continue;
    const img = ['drawing.png', 'plate.png', 'scan.jpg'].map(f => path.join(dirp, f)).find(f => fs.existsSync(f)); if (!img) continue;
    const X = JSON.parse(fs.readFileSync(path.join(dirp, 'expected.json'), 'utf8'));
    const dims = X.dims || ['15', '90', '120', '15', '50', '80', '4 отв. Ø10', 'Толщина 10'];
    const t = Date.now(); const { data } = await w.recognize(img); const ms = Date.now() - t;
    const lines = data.lines.map(l => l.text.trim()).filter(Boolean), g = lines.map(norm);
    const hit = dims.filter(x => g.some(y => y === norm(x) || y.includes(norm(x)))).length;
    const cyr = dims.filter(x => /[а-яё]/i.test(x)), hitCyr = cyr.filter(x => g.some(y => y.includes(norm(x)))).length;
    rows.push({ engine: 'tesseract-' + lang + '-drawing', file: d, recall: +(hit / dims.length).toFixed(3), cyr: `${hitCyr}/${cyr.length}`, ms, lines });
  }
  await w.terminate();
}
clearInterval(tick);
for (const f of fs.readdirSync(cache)) rows.push({ engine: 'data', file: f, mb: +(fs.statSync(path.join(cache, f)).size / 2 ** 20).toFixed(2) });
fs.writeFileSync(path.join(out, 'tesseract.json'), JSON.stringify(rows, null, 1));

// краткая сводка
const S = {};
for (const r of rows.filter(r => r.variant)) {
  const k = r.engine; S[k] ||= { n: 0, exact: 0, nums: 0, words: 0, wn: 0, inv: 0, byVar: {} };
  const s = S[k]; s.n++; s.exact += r.exact ? 1 : 0; s.nums += r.nums ? 1 : 0; s.inv += r.invented.length ? 1 : 0;
  if (r.words !== null) { s.words += r.words; s.wn++; }
  (s.byVar[r.variant] ||= [0, 0])[0] += r.nums ? 1 : 0; s.byVar[r.variant][1]++;
}
for (const [k, s] of Object.entries(S))
  console.log(k, `точно ${s.exact}/${s.n}`, `числа ${s.nums}/${s.n}`, `слова ${(100 * s.words / Math.max(1, s.wn)).toFixed(0)}%`, `лишние числа в ${s.inv}`,
    Object.entries(s.byVar).map(([v, [a, b]]) => `${v}:${a}/${b}`).join(' '));
for (const r of rows.filter(r => r.summary || r.engine === 'data' || r.recall !== undefined)) console.log(JSON.stringify({ ...r, lines: undefined }));
