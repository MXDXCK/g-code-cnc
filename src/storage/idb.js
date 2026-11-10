// Хранилище Fresa в IndexedDB — для больших данных (чертежи, фото, позже модели).
//
// Правила безопасности (docs/STORAGE_MIGRATION.md):
//  1. localStorage остаётся основным хранилищем проекта. Этот модуль его НИКОГДА не меняет и не удаляет.
//  2. «Миграция» = резервная копия ключей fcam* в IndexedDB с проверкой чтением; повторный запуск безопасен.
//  3. Нет IndexedDB (приватный режим, запрет, ошибка) — Fresa работает как раньше, только без новых функций.
// Без сборщика: обычный ES-модуль, типы — в JSDoc.

const DB_NAME = 'fresa';
const DB_VERSION = 1;
const STORES = ['kv', 'blobs', 'drawings', 'meta'];
const LS_PREFIX = 'fcam';
export const MIGRATION_ID = 'ls-backup-1';

/** @type {Promise<IDBDatabase|null>|null} */
let dbp = null;
/** @type {{available:boolean, reason?:string, persisted?:boolean}} */
export const status = { available: false };

const req2p = r => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const tx2p = t => new Promise((ok, no) => { t.oncomplete = () => ok(); t.onerror = () => no(t.error); t.onabort = () => no(t.error || new Error('transaction aborted')); });

/** Открыть базу. Никогда не бросает исключение: при проблеме возвращает null и пишет причину в status. */
export function open() {
  if (dbp) return dbp;
  dbp = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) { status.reason = 'IndexedDB нет в этом браузере'; return resolve(null); }
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => { const db = r.result; for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s); };
      r.onsuccess = () => { status.available = true; resolve(r.result); };
      r.onerror = () => { status.reason = String(r.error && r.error.message || r.error); resolve(null); };
      r.onblocked = () => { status.reason = 'база занята другой вкладкой'; resolve(null); };
    } catch (e) { status.reason = String(e && e.message || e); resolve(null); }
  });
  return dbp;
}

async function store(name, mode) {
  const db = await open();
  if (!db) throw new Error('IndexedDB недоступна: ' + (status.reason || ''));
  const t = db.transaction(name, mode);
  return { t, s: t.objectStore(name) };
}

/** Прочитать значение. */
export async function get(name, key) { const { s } = await store(name, 'readonly'); return req2p(s.get(key)); }
/** Записать значение и дождаться завершения транзакции. */
export async function put(name, key, value) { const { t, s } = await store(name, 'readwrite'); s.put(value, key); await tx2p(t); }
/** Удалить значение (только из IndexedDB). */
export async function del(name, key) { const { t, s } = await store(name, 'readwrite'); s.delete(key); await tx2p(t); }
/** Все ключи хранилища. */
export async function keys(name) { const { s } = await store(name, 'readonly'); return req2p(s.getAllKeys()); }

/** SHA-256 строки или Blob → hex. */
export async function sha256(data) {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(await data.arrayBuffer());
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Сохранить файл (Blob) с контрольной суммой. Возвращает запись без самого Blob. */
export async function putBlob(id, blob, meta = {}) {
  const rec = { blob, type: blob.type, size: blob.size, sha256: await sha256(blob), name: meta.name || '', t: Date.now() };
  await put('blobs', id, rec);
  const back = await get('blobs', id);                      // проверка чтением
  if (!back || back.size !== rec.size || (await sha256(back.blob)) !== rec.sha256) throw new Error('файл в хранилище не совпал после записи');
  const { blob: _, ...info } = rec; return info;
}
export async function getBlob(id) { const r = await get('blobs', id); return r ? r.blob : null; }

/**
 * Резервная копия localStorage (ключи fcam*) в IndexedDB.
 * localStorage только читается. Копия проверяется чтением; запись о результате — в meta.
 * @returns {Promise<{ok:boolean, copied:number, unchanged:number, keys:string[], reason?:string}>}
 */
export async function backupLocalStorage() {
  const db = await open();
  if (!db) return { ok: false, copied: 0, unchanged: 0, keys: [], reason: status.reason };
  const lsKeys = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(LS_PREFIX)) lsKeys.push(k); }
  let copied = 0, unchanged = 0;
  for (const k of lsKeys.sort()) {
    const v = localStorage.getItem(k);
    if (v == null) continue;
    const h = await sha256(v), old = await get('kv', 'ls:' + k);
    if (old && old.sha256 === h) { unchanged++; continue; }
    await put('kv', 'ls:' + k, { v, sha256: h, t: Date.now() });
    const back = await get('kv', 'ls:' + k);
    if (!back || back.v !== v) return { ok: false, copied, unchanged, keys: lsKeys, reason: 'копия ключа ' + k + ' не совпала' };
    copied++;
  }
  await put('meta', MIGRATION_ID, { at: Date.now(), keys: lsKeys, ok: true });
  return { ok: true, copied, unchanged, keys: lsKeys };
}

/** Восстановить один ключ из резервной копии — только по явному действию пользователя. */
export async function restoreKey(k) {
  const r = await get('kv', 'ls:' + k);
  if (!r) return false;
  localStorage.setItem(k, r.v);
  return true;
}

/** Попросить браузер не очищать хранилище (Safari/Chrome решают сами, окно не показывается). */
export async function requestPersist() {
  try { if (navigator.storage && navigator.storage.persist) status.persisted = await navigator.storage.persist(); } catch (e) { /* не критично */ }
  return status.persisted;
}

/** Сколько места занято/доступно (если браузер сообщает). */
export async function estimate() {
  try { return navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch (e) { return null; }
}
