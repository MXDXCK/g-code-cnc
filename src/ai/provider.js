// Общий интерфейс локального ИИ Fresa. Всё — на устройстве пользователя или на его ПК; облака и платных API нет.
// По умолчанию ИИ выключен (режим Lite): мастер «По чертежу» полностью работает без него.
//
// Провайдер:  { id, name, async status() → {ok, reason, info}, async analyze(imageBlob, {signal}) → сырой JSON модели }
//   none     — без ИИ (всегда доступен)
//   ollama   — Ollama на этом ПК (Windows/Mac/Linux), необязательно: пользователь сам ставит Ollama и модель
//   android  — llama.cpp внутри APK через мост AndroidApp (ещё не встроен — сообщает причину)
//   browser  — WebGPU в браузере (iPhone/ПК; ещё не встроен — сообщает причину и что известно об устройстве)
//
// Ответ модели ВСЕГДА проходит validate.crossCheck: значения ИИ — только подсказки, сверенные с рисунком.

export const PROMPT = 'This image is a mechanical engineering drawing of a flat part (GOST style). ' +
  'Read the dimension labels and report: plate size, every round hole (centre X and Y from the lower-left corner of the part, diameter), ' +
  'and the list of dimension labels as written. Use ONLY values written on the drawing; if a value is not given, use null. Do not guess. ' +
  'Answer only with JSON.';

export const SCHEMA = {
  type: 'object',
  properties: {
    plate: { type: 'object', properties: { w: { type: ['number', 'null'] }, h: { type: ['number', 'null'] } } },
    holes: { type: 'array', items: { type: 'object', properties: { x: { type: ['number', 'null'] }, y: { type: ['number', 'null'] }, d: { type: ['number', 'null'] } } } },
    dims: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['holes', 'dims'],
};

const KEY = 'fcam_ai';
export function loadSettings() {
  try { return Object.assign({ provider: 'none', url: 'http://127.0.0.1:11434', model: 'qwen3-vl:2b' }, JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch (e) { return { provider: 'none', url: 'http://127.0.0.1:11434', model: 'qwen3-vl:2b' }; }
}
export function saveSettings(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* без хранилища — только на сеанс */ } }

const toB64 = async blob => { const b = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
/** Уменьшить картинку до maxSide по длинной стороне (PNG); маленькие и неизвестные — как есть. */
async function shrink(blob, maxSide) {
  try {
    const bm = await createImageBitmap(blob), k = Math.min(1, maxSide / Math.max(bm.width, bm.height));
    if (k >= 1) return blob;
    const cv = document.createElement('canvas'); cv.width = Math.round(bm.width * k); cv.height = Math.round(bm.height * k);
    const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); c.drawImage(bm, 0, 0, cv.width, cv.height);
    return await new Promise(r => cv.toBlob(r, 'image/png'));
  } catch (e) { return blob; }
}
const parseJSON = t => { try { return JSON.parse(t); } catch (e) { const m = /\{[\s\S]*\}/.exec(t || ''); if (m) try { return JSON.parse(m[0]); } catch (e2) { /* нет */ } return null; } };

export const none = {
  id: 'none', name: 'Без ИИ (Lite)',
  async status() { return { ok: true, reason: 'распознавание без нейросети: линии, окружности, надписи (OCR) и правила черчения' }; },
  async analyze() { return null; },
};

/** Ollama: http://127.0.0.1:11434. Для страницы с другим адресом Ollama должна разрешить источник (OLLAMA_ORIGINS). */
export function ollama(cfg) {
  const url = (cfg.url || 'http://127.0.0.1:11434').replace(/\/+$/, ''), model = cfg.model || 'qwen3-vl:2b';
  return {
    id: 'ollama', name: `Ollama на этом ПК · ${model}`,
    async status() {
      let r;
      try { r = await fetch(url + '/api/tags', { signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined }); }
      catch (e) { return { ok: false, reason: `Ollama не отвечает по ${url}. Запусти Ollama или выключи ИИ. Если Ollama запущена — разреши этот адрес: OLLAMA_ORIGINS=${location.origin}` }; }
      if (!r.ok) return { ok: false, reason: `Ollama ответила ошибкой ${r.status}` };
      const j = await r.json().catch(() => ({})), names = (j.models || []).map(m => m.name);
      if (!names.some(n => n === model || n === model + ':latest' || n.startsWith(model + ':'))) return { ok: false, reason: `в Ollama нет модели ${model}. Установи: ollama pull ${model}`, info: { models: names } };
      return { ok: true, reason: `Ollama готова, модель ${model}`, info: { models: names } };
    },
    async analyze(blob, { signal } = {}) {
      const t0 = performance.now();
      // think:false — у «думающих» вариантов qwen3-vl рассуждение занимало минуты, а поле ответа оставалось пустым
      // (найдено сквозным тестом с настоящей Ollama, 15.11). Картинка — не больше 1280 пикс., ответ — не длиннее 1500 токенов.
      const r = await fetch(url + '/api/chat', {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: false, think: false, format: SCHEMA, options: { temperature: 0, num_predict: 1500, num_ctx: 8192 },
          messages: [{ role: 'user', content: PROMPT, images: [await toB64(await shrink(blob, 1280))] }] }),
      });
      if (!r.ok) throw new Error(`Ollama: ошибка ${r.status}${r.status === 400 ? ' (старая версия Ollama? нужна 0.12 или новее)' : ''}`);
      const j = await r.json(), m = j.message || {}, text = m.content || '';
      // запасной путь: JSON оказался в рассуждении
      const json = parseJSON(text) || (m.thinking ? parseJSON(m.thinking) : null);
      return { json, raw: text || m.thinking || '', ms: Math.round(performance.now() - t0), model, done: j.done_reason };
    },
  };
}

/** Android: llama.cpp внутри APK через мост AndroidApp.ai* (этап «Android AI» — ещё не встроен). */
export const android = {
  id: 'android', name: 'На телефоне (llama.cpp)',
  async status() {
    const A = window.AndroidApp;
    if (!A) return { ok: false, reason: 'это не приложение Android' };
    if (typeof A.aiStatus !== 'function') return { ok: false, reason: 'в этой версии APK локальной модели ещё нет — работает режим без ИИ' };
    try { const s = JSON.parse(A.aiStatus()); return { ok: !!s.ok, reason: s.reason || '', info: s }; } catch (e) { return { ok: false, reason: 'мост ИИ ответил ошибкой' }; }
  },
  async analyze() { throw new Error('локальная модель на Android ещё не встроена'); },
};

/** Браузер (iPhone Safari, ПК): WebGPU. Пока только проверка возможностей — модель не запускается. */
export const browser = {
  id: 'browser', name: 'В браузере (WebGPU)',
  async status() {
    const gpu = typeof navigator !== 'undefined' && navigator.gpu;
    const info = { webgpu: !!gpu, memoryGB: navigator.deviceMemory || null, ua: navigator.userAgent };
    if (gpu) { try { const ad = await gpu.requestAdapter(); info.adapter = !!ad; if (ad) info.maxBufferMB = Math.round(ad.limits.maxBufferSize / 2 ** 20); } catch (e) { info.adapter = false; } }
    return { ok: false, reason: (gpu ? 'WebGPU есть' : 'WebGPU нет') + ' — модель в браузере ещё не встроена, работает режим без ИИ (наличие WebGPU не значит, что модель поместится — нужен пробный запуск на устройстве)', info };
  },
  async analyze() { throw new Error('модель в браузере ещё не встроена'); },
};

export function current() {
  const s = loadSettings();
  return s.provider === 'ollama' ? ollama(s) : s.provider === 'android' ? android : s.provider === 'browser' ? browser : none;
}
