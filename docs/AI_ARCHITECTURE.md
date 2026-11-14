# Архитектура Fresa AI

Статус на 15.11.2026: работает конвейер **без нейросети** (DXF/PDF/фото → привязка размеров → подтверждение → CAM → проверка → 3D) и **ИИ-помощник** с общим интерфейсом провайдеров (`src/ai/`). Из провайдеров действует Ollama на ПК (необязательно); Android (llama.cpp) и браузер (WebGPU) пока сообщают «не встроено». Ниже — целевая схема; что реально сделано — в разделе «Сейчас».

## Сейчас (реализовано)

| Звено | Файл | Что делает |
|---|---|---|
| Импорт | `src/drawing/import-dxf.js`, `import-pdf.js`, `import-raster.js`, `pipeline.js` | DXF (+DIMENSION, дуги), PDF вектор/скан (pdf.js), фото: автообводка Fresa, окружности (Хаф), выравнивание наклона, OCR Tesseract |
| Привязка размеров | `src/drawing/associate.js` | правила ГОСТ 2.307, контур со скруглениями/фасками, R к углам, цепочки, конфликты (`DIMENSION_ASSOCIATION.md`) |
| Провайдеры ИИ | `src/ai/provider.js` | `none` (по умолчанию), `ollama` (ПК, необязательно), `android`, `browser` — `status()` с причиной по-русски, `analyze(image)` → JSON по схеме |
| Проверка ответа ИИ | `src/ai/validate.js` | `crossCheck`: ИИ — только подсказки; выдуманные отверстия отбрасываются; Ø против рисунка; в поля ничего не подставляется |
| Подтверждение | `index.html` («По чертежу») | каждое отверстие «сверлить»/«Не обрабатывать», ноль, заготовка, материал, инструменты, высоты |
| CAM | `index.html` (`drill`, PAT list, G81) | без изменений генераторов |
| Проверка G-кода | `checkProgram` + `modalChecks` | ошибки / предупреждения / «не проверено»; G90/G91, G54–G59, G43, S, F, G8x/G80, M30 |
| Хранение | `src/storage/idb.js` | исходник чертежа + SHA-256 в IndexedDB, резервная копия localStorage, `persist()` |

Упрощённый интерфейс провайдера (вместо полного ниже — пока достаточно): `{id, name, status() → {ok, reason, info}, analyze(blob) → {json, raw, ms, model}}`.

## Принципы

1. **ИИ понимает — CAM считает.** Нейросеть предлагает элементы, связи «размер ↔ элемент», операции и объяснения. Координаты, эквидистанты, проходы и G-код строит только детерминированное ядро (существующие OPS и генераторы `index.html:522`, `:1335`, `:1497`).
2. **Точные пути раньше нейросети.** DXF и векторный PDF разбираются парсером; растровое фото — алгоритмы (автообводка `index.html:3025`) + OCR; VLM — дополнительный слой, который можно выключить.
3. **Ничего не попадает в CAM без подтверждения человеком.** Распознанное = «предложено», подтверждённое = «подтверждено», ИИ не перезаписывает подтверждённое.
4. **Всё локально.** Нет облачных вызовов ИИ. Сеть нужна только чтобы один раз скачать модель (с проверкой SHA-256).
5. **Старый код не переписываем.** Новые модули — отдельными файлами рядом с `index.html`, общаются через узкие интерфейсы.

## Конвейер

```
Fresa UI (существующий интерфейс, новый пункт «ИИ → По чертежу»)
  → AI Capability Manager        src/ai/capabilities.js     — что умеет устройство, какой режим (Lite/Standard/Advanced)
  → Local AI Provider            src/ai/providers/*.js      — Android native / Browser (WebGPU) / Windows (Ollama|llama.cpp) / None
  → Drawing Recognition          src/drawing/import-*.js    — DXF (точно), PDF-векторы (точно), растр (алгоритмы + OCR + VLM)
  → Drawing Schema               src/drawing/schema.js      — fresa.drawing/1 (DRAWING_SCHEMA.md)
  → Geometry Validator           src/drawing/validate.js    — замкнутость, пересечения, противоречия размеров, масштаб
  → Feature Recognition          src/drawing/features.js    — отверстия, массивы, карманы, пазы, контуры, фаски, резьбы
  → CAM Planner                  src/cam/planner.js         — признаки → операции OPS (только существующие типы)
  → Toolpath Generator           index.html (G, M)          — БЕЗ ИЗМЕНЕНИЙ, вызывается через st.ops
  → Postprocessor                index.html (G/M, профили)  — профили станков добавляются отдельно
  → G-code Validator             index.html:2220 + расширение — Ошибка / Предупреждение / Не проверено
  → Simulation Bridge            index.html:2107            — существующая 3D
  → Project Storage              src/storage/idb.js         — IndexedDB: чертежи, схема, модели; localStorage — как сейчас
```

## Интерфейс провайдера ИИ

```js
/** @typedef {{text:boolean, vision:boolean, structured:boolean, streaming:boolean, tools:boolean, offline:boolean, acceleration:'none'|'cpu'|'gpu'|'npu'}} AICaps */
interface AIProvider {
  id: 'android-native' | 'browser-webgpu' | 'windows-ollama' | 'windows-llamacpp' | 'none';
  initialize(): Promise<void>;
  checkCapabilities(): Promise<AICaps & {reason?: string}>;   // reason — почему недоступно, по-русски
  loadModel(modelId: string, onProgress?: (p)=>void): Promise<void>;
  unloadModel(): Promise<void>;
  generateText(prompt, opts): Promise<string>;
  generateStructured(prompt, jsonSchema, opts): Promise<object>;  // ответ валидируется по схеме, иначе ошибка
  analyzeImage(image: Blob, prompt, jsonSchema?): Promise<object>;
  streamResponse(prompt, onToken, opts): Promise<void>;
  cancel(): void;
  getMemoryUsage(): Promise<{rssMB?:number, gpuMB?:number}>;
  getModelInfo(): {id, version, license, sha256, sizeMB} | null;
}
```

Правила: метод, которого нет в `checkCapabilities`, не вызывается; при отказе — объяснение, а не подмена ответа; нет переключения на внешние сервисы.

## Платформы

| Платформа | Провайдер | Движок | Документ |
|---|---|---|---|
| Android (RuStore) | AndroidNativeAIProvider | llama.cpp (C++), JNI, мост `AndroidApp.ai*` в WebView | ANDROID_AI_RUNTIME.md |
| iPhone (Safari/PWA) | BrowserAIProvider | Transformers.js / ONNX Runtime Web / WebLLM на WebGPU, в Web Worker | IOS_WEB_AI.md |
| Windows | WindowsLocalAIProvider | Ollama (если установлена) или llama.cpp-сервер на 127.0.0.1, запускаемый оболочкой | WINDOWS_AI.md |
| Любая | NoneProvider | — | режим Lite: всё, кроме VLM |

## Безопасность

- Ответ модели — только данные по JSON-схеме; код не исполняется; доступа к файлам у ИИ нет.
- Локальный сервер на Windows слушает только 127.0.0.1.
- Предложения ИИ и подтверждённые данные хранятся раздельно (DRAWING_SCHEMA.md).
- Программа не отправляется на станок автоматически (такой функции нет и не будет).
