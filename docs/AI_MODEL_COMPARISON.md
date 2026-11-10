# Сравнение локальных моделей

Статус: **по документации и публикациям; собственных замеров ещё нет** (план — `AI_MODEL_BENCHMARK.md`). Дата сбора: 2026-11-10.

## Кандидаты

| Модель | Параметры | Лицензия весов | Коммерция | Загрузка (≈4 бит) | ОЗУ при работе | Android | Safari iPhone | Windows | Русский | Чертежи / размеры | Структурный вывод |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Qwen3-VL-2B-Instruct** | 2.1B | Apache-2.0 [1][2] | да | LLM 1.11 ГБ + проектор; целиком 1.9 ГБ [1][2] | ≈2.5–3.5 ГБ (оценка) | llama.cpp поддерживает Qwen3-VL [3] | не подтверждено; вероятно нет на старых iPhone [4] | llama.cpp / Ollama [2] | заявлен многоязычный OCR (32 языка, отчёт [5]) | общего назначения, на ГОСТ не проверено | JSON по подсказке, нужна валидация |
| Qwen3-VL-4B-Instruct | 4B | Apache-2.0 [2] | да | ≈2.5–3 ГБ (оценка) | ≈4–5 ГБ | только мощные (12+ ГБ) | нет | да | да | лучше 2B (оценка) | — |
| Qwen3-VL-8B-Instruct | 8B | Apache-2.0 [2] | да | ≈5 ГБ (оценка) | ≈7–8 ГБ | нет | нет | 16+ ГБ / GPU | да | — | — |
| SmolVLM2-256M/500M/2.2B | 0.26–2.2B | Apache-2.0 [6] | да | 0.2–1.5 ГБ | 0.5–2 ГБ | через ONNX | **шанс есть** для 256M/500M (Transformers.js WebGPU) [7] | да | слабый (оценка) | слабый на мелком тексте (оценка) | — |
| Florence-2 base / large | 0.23 / 0.77B | MIT [6] | да | 0.25–0.8 ГБ | <1.5 ГБ | ONNX | да (ONNX/WebGPU) | да | OCR латиница/цифры | **после дообучения** обгоняет GPT-4o по GD&T на 52% F1 [8] | задачи OCR/детекции, не диалог |
| PP-OCRv5 cyrillic mobile (rec) + det | — | Apache-2.0 [9] | да | единицы МБ | мало | ONNX/Paddle Lite | ONNX Web | да | **да**, 80.3% строк [9] | только текст | — |
| Tesseract 5 (уже в Fresa) | — | Apache-2.0 | да | 4–10 МБ | мало | есть | есть | есть | rus-словарь отдельно | цифры при настройке | — |
| Компактная текстовая для чата (напр. Qwen3-0.6B/1.7B) | 0.6–1.7B | Apache-2.0 (Qwen3) [ПРЕДПОЛОЖЕНИЕ — сверить] | да | 0.4–1.1 ГБ | 1–2 ГБ | да | 0.6B — возможно | да | да | — | — |

Не рекомендуются: модели с лицензией Gemma Terms (ограничения использования), YOLO от Ultralytics (AGPL-3.0), MiniCPM-V (собственная лицензия с регистрацией) — для коммерческой Fresa нужна отдельная юридическая проверка.

## Выводы

1. **Для Android и Windows** главный кандидат — **Qwen3-VL-2B** (Apache-2.0, поддержан llama.cpp, ~1.9 ГБ). 4B — опция «Advanced».
2. **Для iPhone** реалистичны только очень малые модели (SmolVLM2-256M/500M, Florence-2 base) — и то после проверки на устройстве. Полевые данные: даже 0.5–1.5B текстовые модели не запустились в Safari на iPhone 11 Pro Max [4].
3. **Чтение размеров** — задача OCR + геометрии, а не «общего понимания». Публикации с хорошими результатами используют **дообученные** узкие модели [8][10]. Без дообучения на чертежах ГОСТ точность общих малых VLM — неизвестна и, вероятно, недостаточна → поэтому в конвейере VLM только предлагает.
4. Ни одна модель не выбирается окончательно до замеров на эталонных чертежах (`AI_MODEL_BENCHMARK.md`).

## Источники

1. https://huggingface.co/Qwen/Qwen3-VL-2B-Thinking-GGUF
2. https://registry.ollama.ai/library/qwen3-vl:2b
3. https://toolnavs.com/en/article/662-qwen-annonce-qwen3-vl-est-d%C3%A9sormais-disponible-sur-llamacpp-avec-des-poids-gguf
4. https://hackernews-dynamic.seasondane.workers.dev/news/48624985
5. Qwen3-VL Technical Report — https://arxiv.org/pdf/2511.21631v2 (заявления о языках и OCR — по отчёту, не проверены)
6. https://playground.roboflow.com/models/compare/florence-2-vs-smolvlm2
7. https://pyimagesearch.com/2025/10/20/running-smolvlm-locally-in-your-browser-with-transformers-js/
8. https://arxiv.org/abs/2411.03707
9. https://huggingface.co/PaddlePaddle/cyrillic_PP-OCRv5_mobile_rec
10. https://arxiv.org/pdf/2505.01530v3
