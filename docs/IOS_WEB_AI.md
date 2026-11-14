# iPhone: ИИ в Safari / PWA

Статус: проект (Фаза 9). Отдельного iOS-приложения не будет (решение владельца).

## Внешние сведения (чужой опыт, Fresa их не проверяла)

- WebGPU в Safari заявлен с iOS 26 — по статье [1], не по документации Apple. Это **необходимое, но не достаточное** условие.
- Один пользовательский отчёт [2] (копия обсуждения Hacker News, не первоисточник): iPhone 11 Pro Max, WebGPU «есть», `maxBufferSize ≈ 715 МБ`, но текстовые модели Qwen2.5-0.5B/1.5B и Llama-3.2-1B не доработали — перезагрузка вкладки или «Load failed». Версии в отчёте противоречивы (iOS 18.7 и Safari 26.5, а Safari 26 идёт с iOS 26). Это **сигнал риска, а не измерение**, и не про VLM.
- Safari может очищать хранилище сайта (поведение WebKit) → модель придётся перекачать; это показываем.

## Испытания Fresa на iPhone

**Не проводились.** Модель iPhone и версия iOS владельца неизвестны. Автотесты Fresa идут в Chromium (Playwright); настольный Safari и Chromium не считаются проверкой iPhone.

| Дата | iPhone | iOS / Safari | Что проверяли | Результат |
|---|---|---|---|---|
| — | — | — | — | испытаний не было |

Чек-лист первого испытания (без ИИ, режим Lite):
1. Открыть https://mxdxck.github.io/g-code-cnc/ из ветки после слияния (до слияния — только локальная копия), «На экран Домой».
2. «По чертежу» → PDF эталона `01-plate-4-holes/plate.pdf` → 4 отверстия «по размеру».
3. То же с фото с камеры iPhone (распечатка эталона) → сколько окружностей, какие значения «измерено».
4. Подтвердить, получить G-код, «Проверка программы», 3D.
5. Закрыть Safari, открыть снова: проект и «Открыть исходник» (IndexedDB) на месте.
6. Без интернета (режим полёта): PDF/фото — pdf.js и Tesseract берутся из кэша после первого запуска?
7. Записать модель iPhone, версию iOS, время распознавания фото.

- Хранилище: с `37f3309` — IndexedDB (резервная копия `fcam*`, исходники чертежей); для моделей позже — IndexedDB / Cache Storage.

## План

1. `BrowserAIProvider` в Web Worker: Transformers.js или ONNX Runtime Web (WebGPU, запасной путь — WASM) [3].
2. Модели — только малые: Florence-2 base (OCR/детекция), SmolVLM2-256M/500M. Qwen3-VL-2B в Safari на iPhone — только если пробный запуск пройдёт; по [2] это маловероятно для старых iPhone.
3. Пробный запуск: загрузка крошечной модели → один прогон → замер времени; при падении вкладки — флаг в `localStorage` «не пробовать снова», режим Lite.
4. Загрузка: с Hugging Face (CORS есть; доступен из России по данным 25.09.2026 [4]); GitHub Releases браузеру не подходит (нет CORS) [5]; GitHub Pages — только файлы < 100 МБ и сайт ≤ 1 ГБ [6].
5. Режим Lite (без нейросети) на iPhone **полноценный**: DXF, PDF-векторы, автообводка, OCR Tesseract, редактор, CAM, проверка, 3D.

## Тесты

Только на реальном iPhone владельца (модель и версия iOS — уточнить). Настольный Safari не считается проверкой iPhone (ТЗ §28).

## Источники

1. https://appdevelopermagazine.com/webgpu-in-ios-26/
2. https://hackernews-dynamic.seasondane.workers.dev/news/48624985
3. https://pyimagesearch.com/2025/10/20/running-smolvlm-locally-in-your-browser-with-transformers-js/
4. https://t-j.ru/hugging-face/
5. https://github.com/orgs/community/discussions/45446
6. https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
