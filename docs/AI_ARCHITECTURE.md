# Архитектура Fresa AI

Статус: **проект** (Фаза 0). Кода ИИ в репозитории пока нет.

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
