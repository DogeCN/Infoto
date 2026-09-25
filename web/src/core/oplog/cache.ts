// The cache stores album mappings and editor image URLs by purpose and hash.

import type { Photo } from '$shared/types';

const DB_NAME = 'infoto';
const CACHE_STORE = 'metaCache';

export interface ShaEntry {
  sha256: string;
  purpose: 'album' | 'editor';
  photoId: number | null;
  url?: string;
}

function key(purpose: ShaEntry['purpose'], sha256: string): string {
  return `${purpose}:${sha256}`;
}

function withDb<T>(db: IDBDatabase, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    const req = fn(tx.objectStore(CACHE_STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? new Error('metaCache failed'));
  });
}

export function lookupSha(db: IDBDatabase, purpose: ShaEntry['purpose'], sha256: string): Promise<ShaEntry | undefined> {
  return withDb(db, (store) => store.get(key(purpose, sha256)) as IDBRequest<ShaEntry | undefined>);
}

export async function rebuildCache(db: IDBDatabase, photos: Photo[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    const store = tx.objectStore(CACHE_STORE);
    const request = store.openCursor();
    const editorEntries: ShaEntry[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const entry = cursor.value as ShaEntry;
        if (entry.purpose === 'editor') editorEntries.push(entry);
        cursor.continue();
        return;
      }
      store.clear();
      for (const photo of photos) {
        const entry: ShaEntry = { sha256: photo.sha256, purpose: 'album', photoId: photo.id, url: photo.url };
        store.put(entry, key('album', photo.sha256));
      }
      for (const entry of editorEntries) store.put(entry, key('editor', entry.sha256));
    };
    request.onerror = () => reject(request.error ?? new Error('metaCache scan failed'));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('metaCache rebuild failed'));
  });
}

export function putSha(db: IDBDatabase, purpose: ShaEntry['purpose'], sha256: string, photoId: number | null, url?: string): Promise<void> {
  return withDb(
    db,
    (store) => store.put({ sha256, purpose, photoId, ...(url ? { url } : {}) }, key(purpose, sha256)) as IDBRequest<IDBValidKey>,
  ).then(() => undefined);
}
