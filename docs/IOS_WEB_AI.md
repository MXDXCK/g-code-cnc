# iPhone: ИИ в Safari / PWA

Статус: проект (Фаза 9). Отдельного iOS-приложения не будет (решение владельца).

## Что известно

- WebGPU появился в Safari на iOS 26 [1]. Это **необходимое, но не достаточное** условие.
- Полевой отчёт 2026 г.: iPhone 11 Pro Max, Safari 26.5 — WebGPU «есть», `maxBufferSize ≈ 715 МБ`, но ни одна из Qwen2.5-0.5B/1.5B и Llama-3.2-1B не доработала: перезагрузка вкладки без ошибки или «Load failed» [2]. Значит, решение принимается только по **пробному запуску на устройстве**, а не по наличию `navigator.gpu`.
- Хранилище Safari может быть очищено системой → модель придётся перекачать; это показываем.
- Сейчас Fresa хранит всё в `localStorage` (≈5 МБ) — для моделей и картинок нужен IndexedDB / Cache Storage.

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
