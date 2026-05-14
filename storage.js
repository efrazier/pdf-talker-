// storage.js
// IndexedDB wrapper for per-PDF progress.

const DB_NAME = 'pdf-talker';
const DB_VERSION = 1;
const STORE_PROGRESS = 'progress';

let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROGRESS)) {
        const store = db.createObjectStore(STORE_PROGRESS, { keyPath: 'fileId' });
        store.createIndex('lastOpened', 'lastOpened', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

export async function computeFileId(file) {
  const slice = file.slice(0, 128 * 1024);
  const buffer = await slice.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return file.name + '::' + file.size + '::' + hashHex.slice(0, 24);
}

export async function getProgress(fileId) {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_PROGRESS, 'readonly');
      const request = tx.objectStore(STORE_PROGRESS).get(fileId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn('getProgress failed', err);
    return null;
  }
}

export async function saveProgress(progress) {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_PROGRESS, 'readwrite');
      const record = {
        fileId: progress.fileId,
        fileName: progress.fileName,
        pageNumber: progress.pageNumber,
        sentenceIndex: progress.sentenceIndex,
        totalPages: progress.totalPages,
        lastOpened: Date.now(),
      };
      tx.objectStore(STORE_PROGRESS).put(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn('saveProgress failed', err);
    return null;
  }
}

export async function listProgress() {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_PROGRESS, 'readonly');
      const request = tx.objectStore(STORE_PROGRESS).getAll();
      request.onsuccess = () => {
        const items = request.result || [];
        items.sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
        resolve(items);
      };
      request.onerror = () => resolve([]);
    });
  } catch (err) {
    return [];
  }
}

export async function clearProgress(fileId) {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_PROGRESS, 'readwrite');
      tx.objectStore(STORE_PROGRESS).delete(fileId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (err) {
    return false;
  }
}
