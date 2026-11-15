# Android: локальный ИИ внутри Fresa (RuStore)

Статус на 15.11.2026: **нативной модели в APK ещё нет.** Сделано: провайдер `android` в `src/ai/provider.js` (проверяет мост `AndroidApp.aiStatus`; пока сообщает «в этой версии APK локальной модели ещё нет»), тестовая сборка «Fresa ТЕСТ» (`app.fresa.cnc.test`, `docs/TEST_BUILD.md`) — на ней будет проверяться llama.cpp, не трогая рабочую Fresa.

Порядок (обоснование — замер моделей `ai-bench.yml`, `AI_MODEL_COMPARISON.md`):
1. Выбрать модель по замеру на чертежах (если ни одна не лучше режима без ИИ — нативный модуль не делаем).
2. Сборка llama.cpp + mtmd под `arm64-v8a` в `build-check.yml` (NDK, CMake) — только в тестовой сборке `beta`.
3. JNI + мост `aiStatus/aiDownload/aiRun/aiCancel` (п. 2–4 плана ниже), загрузка модели с докачкой, SHA-256, проверкой места.
4. Испытание на телефоне владельца (память, время, перегрев) — до любого решения о рабочей версии.

## Сейчас

`MainActivity.java`: WebView + `WebViewAssetLoader`, мост `AndroidApp` (saveFile/shareFile/platform). Нет NDK/JNI. `applicationId app.fresa.cnc`, `minSdk 24`, `targetSdk 34`, подпись — секреты GitHub. **applicationId и ключ не меняем.**

## План

1. Новый Gradle-модуль `android/ai` (CMake + NDK), сборка llama.cpp (MIT) только под `arm64-v8a`. Бэкенд: CPU (NEON / KleidiAI на Arm) по умолчанию; Vulkan и OpenCL (Adreno) — только после замеров, т.к. у разных GPU они ведут себя по-разному [1][2].
2. JNI-обёртка: `init(modelPath, mmprojPath, nThreads, nCtx)`, `analyzeImage(bytes, prompt, grammarJson)`, `generate(prompt, grammar)`, `cancel()`, `memory()`, `unload()`. Вывод — с JSON-грамматикой llama.cpp (GBNF), чтобы ответ был структурным.
3. Работа в отдельном потоке (`ExecutorService`), результат в WebView через `evaluateJavascript` — UI не блокируется.
4. Мост в JS: `AndroidApp.aiCaps()`, `aiDownload(url, sha256)`, `aiLoad()`, `aiRun(jobJson)`, `aiCancel()`, `aiUnload()`, `aiDelete()`; события прогресса — через `window.__fresaAI.onEvent`.
5. Загрузка модели: `DownloadManager` или собственный загрузчик с докачкой (Range), файл в `getFilesDir()/models/`, проверка SHA-256 и свободного места до старта; источник — GitHub Releases (файл < 2 ГиБ, CORS не нужен в нативном коде) с зеркалом на Hugging Face.
6. Профиль устройства: `ActivityManager.MemoryInfo` (totalMem, availMem, lowMemory), `Build.SUPPORTED_ABIS`, свободное место, **пробный прогон** маленького изображения с замером времени — по нему выбирается режим, а не только по ОЗУ.
7. Нехватка памяти: `onTrimMemory` → выгрузка модели; при ошибке аллокации — сообщение и возврат в Lite.

## Размер APK

Измерено 15.11 (`ai-bench.yml`, задание `android-llama`): llama.cpp `b12420` с mtmd, NDK r30, arm64-v8a, Android 9+, статически, без OpenMP и curl — программа `llama-mtmd-cli` после strip **8,5 МБ** (до strip — 131 МБ из-за отладочных символов). Библиотека для JNI будет того же порядка: APK тестовой сборки вырастет примерно на 9–12 МБ (в сжатом виде меньше). На телефоне не запускалось. Модель (≈1.9 ГБ для Qwen3-VL-2B) — **не в APK**, а загрузкой по желанию пользователя. Лимит RuStore на APK — 5 ГБ [3], но огромный APK плох для пользователей.

## Память и скорость по замеру (15.11, не телефон)

Qwen3-VL-2B Q4_K_M + проектор Q8_0, контекст 4096 — пик **~3,1 ГБ**, файлы 1,48 ГБ (`AI_MODEL_COMPARISON.md`). Значит, реально только телефоны с 8 ГБ ОЗУ; на 4–6 ГБ Android выгрузит приложение. Скорость на x86 CI (4 ядра) — 40–110 с на чертёж; на телефоне ожидается медленнее (проверить). Координаты модель путает в 9–11 случаях из 25 — только подсказки.

## Открытые вопросы

- Правила модерации RuStore о загрузке дополнительных файлов (моделей) после установки — не прочитаны (страница «Требования к приложениям» недоступна из среды разработки). Проверить до Фазы 8.
- `targetSdk 34` — проверить актуальное требование RuStore.
- Тестовые устройства владельца (модель телефона, ОЗУ).

## Источники

1. Qualcomm: OpenCL-бэкенд llama.cpp для Adreno — https://www.qualcomm.com/developer/blog/2024/11/introducing-new-opn-cl-gpu-backend-llama-cpp-for-qualcomm-adreno-gpu
2. Arm: VLM на Android — https://learn.arm.com/learning-paths/mobile-graphics-and-gaming/ai-portal-mobile-vision-language/
3. RuStore: публикация — https://www.rustore.ru/help/developers/publishing-and-verifying-apps/app-publication
