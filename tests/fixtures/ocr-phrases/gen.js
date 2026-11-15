// Надписи русских чертежей для замера OCR: каждая фраза × несколько ИСКУССТВЕННЫХ искажений (это не фото!).
// Шрифт — не ГОСТ 2.304 (шрифта типа А в системе нет): DejaVu Sans курсив и FreeSans прямой — близкие по форме.
// Запуск: node tests/fixtures/ocr-phrases/gen.js  → *.png + expected.json (эталон отдельно от картинок)
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');

const PHRASES = [
  'Толщина 10', '4 отв. Ø8', 'Глубина 5', 'Сквозное', 'Фаска 1×45°', 'R8', 'Ø10H7', '50±0,1', '2 паза 10×40',
  'Карман глубина 5', '3 отв. М6-7Н', 'Ra 3,2', '12h9', 'Неуказанные радиусы R2', 'Ø20 +0,021',
];
const FONTS = [['dejavu-it', 'italic 30px "DejaVu Sans"'], ['freesans', '30px "FreeSans"']];
const VARIANTS = ['clean', 'small', 'blur', 'shadow-noise', 'skew', 'low-contrast'];

(async () => {
  const dir = __dirname, b = await chromium.launch(), p = await b.newPage();
  await p.setContent('<canvas id=c></canvas>');
  const out = [];
  let seed = 7;
  for (let i = 0; i < PHRASES.length; i++) for (const [fid, font] of FONTS) for (const v of VARIANTS) {
    const file = `p${String(i + 1).padStart(2, '0')}-${fid}-${v}.png`;
    const png = await p.evaluate(({ text, font, v, seed }) => {
      let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
      const c = document.getElementById('c'), x = c.getContext('2d');
      const f = v === 'small' ? font.replace('30px', '17px') : font;
      x.font = f; const w = Math.ceil(x.measureText(text).width) + 60, h = v === 'small' ? 44 : 70;
      c.width = w; c.height = h;
      x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
      if (v === 'skew') x.setTransform(1, -0.05, -0.12, 1, 12, 4);
      if (v === 'blur') x.filter = 'blur(1.3px)';
      x.font = f; x.fillStyle = v === 'low-contrast' ? '#8a8a8a' : '#111'; x.textBaseline = 'middle';
      x.fillText(text, 30, h / 2);
      x.setTransform(1, 0, 0, 1, 0, 0); x.filter = 'none';
      if (v === 'shadow-noise' || v === 'low-contrast') {
        const d = x.getImageData(0, 0, w, h), a = d.data;
        for (let k = 0; k < a.length; k += 4) {
          const px = (k / 4) % w, py = Math.floor(k / 4 / w);
          const shade = v === 'shadow-noise' ? 0.55 + 0.45 * Math.min(1, Math.hypot(px - w * 0.9, py - h * 1.2) / (w * 0.8)) : 0.93;
          const n = (rnd() - 0.5) * (v === 'shadow-noise' ? 70 : 24);
          for (let ch = 0; ch < 3; ch++) a[k + ch] = Math.max(0, Math.min(255, a[k + ch] * shade + n));
        }
        x.putImageData(d, 0, 0);
      }
      return c.toDataURL('image/png').split(',')[1];
    }, { text: PHRASES[i], font, v, seed: seed++ });
    fs.writeFileSync(path.join(dir, file), Buffer.from(png, 'base64'));
    out.push({ file, text: PHRASES[i], font: fid, variant: v });
  }
  fs.writeFileSync(path.join(dir, 'expected.json'), JSON.stringify({
    note: 'Искусственные изображения надписей (не фото). Шрифт не ГОСТ 2.304.', phrases: PHRASES, items: out,
  }, null, 1));
  await b.close();
  console.log(out.length, 'картинок');
})();
