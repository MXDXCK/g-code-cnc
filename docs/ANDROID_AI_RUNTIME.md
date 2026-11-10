# Android: локальный ИИ внутри Fresa (RuStore)

Статус: проект (Фаза 8). Ничего из этого ещё не реализовано.

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

llama.cpp под arm64 добавит ориентировочно 10–30 МБ [ПРЕДПОЛОЖЕНИЕ — измерить]. Модель (≈1.9 ГБ для Qwen3-VL-2B) — **не в APK**, а загрузкой по желанию пользователя. Лимит RuStore на APK — 5 ГБ [3], но огромный APK плох для пользователей.

## Открытые вопросы

- Правила модерации RuStore о загрузке дополнительных файлов (моделей) после установки — не прочитаны (страница «Требования к приложениям» недоступна из среды разработки). Проверить до Фазы 8.
- `targetSdk 34` — проверить актуальное требование RuStore.
- Тестовые устройства владельца (модель телефона, ОЗУ).

## Источники

1. Qualcomm: OpenCL-бэкенд llama.cpp для Adreno — https://www.qualcomm.com/developer/blog/2024/11/introducing-new-opn-cl-gpu-backend-llama-cpp-for-qualcomm-adreno-gpu
2. Arm: VLM на Android — https://learn.arm.com/learning-paths/mobile-graphics-and-gaming/ai-portal-mobile-vision-language/
3. RuStore: публикация — https://www.rustore.ru/help/developers/publishing-and-verifying-apps/app-publication
