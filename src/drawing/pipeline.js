// Чертёж (DXF, PDF, фото) → наблюдения для мастера «По чертежу». Ничего не подтверждает: только предлагает.
// Каждое значение несёт источник: «dimension» — из размерной надписи, «measured» — измерено по рисунку (проверить).
import { importDXF } from './import-dxf.js';
import { importPDF, renderPdfPage } from './import-pdf.js';
import { importRaster } from './import-raster.js';
import { associate } from './associate.js';

export function kindOf(file) {
  const n = (file.name || '').toLowerCase();
  if (/\.dxf$/.test(n)) return 'dxf';
  if (/\.pdf$/.test(n) || file.type === 'application/pdf') return 'pdf';
  if (/^image\//.test(file.type) || /\.(png|jpe?g|webp|bmp|gif|heic)$/.test(n)) return 'image';
  return null;
}

/**
 * @param {File|Blob} file
 * @param {{at:object, pdfjs:()=>Promise<object>, ocr:()=>Promise<object|null>, status?:(s:string)=>void, text?:string}} env
 *   at — автообводка Fresa (window.__at); pdfjs/ocr — загрузчики (по требованию, чтобы не тянуть библиотеки зря)
 * @returns {Promise<{kind:string, vector:boolean, d:object, a:object, warnings:string[]}>}
 */
export async function readDrawing(file, env) {
  const kind = kindOf(file), say = env.status || (() => {});
  if (!kind) throw new Error('Нужен файл DXF, PDF или фото (JPG, PNG)');
  let d, vector = true;
  const raster = async blob => {
    say('Распознаю надписи на картинке… (первый раз — до минуты)');
    const ocr = await env.ocr().catch(() => null);
    try { return await importRaster(blob, { at: env.at, ocr }); } finally { if (ocr && ocr.terminate) await ocr.terminate().catch(() => {}); }
  };
  if (kind === 'dxf') d = importDXF(env.text ?? await file.text());
  else if (kind === 'pdf') {
    say('Читаю PDF…');
    const lib = await env.pdfjs(), bytes = new Uint8Array(await file.arrayBuffer());
    d = await importPDF(bytes.slice(), lib);
    if (!d.vector) { vector = false; d = await raster(await renderPdfPage(bytes.slice(), lib)); d.warnings.unshift('в PDF нет линий — это скан, разбираю как фото'); }
  } else { vector = false; d = await raster(file); }
  say('Сопоставляю размеры с линиями…');
  const a = associate({ ...d });
  return { kind, vector, d, a, warnings: d.warnings || [] };
}
