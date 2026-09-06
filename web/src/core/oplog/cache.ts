// Local metadata cache: sha256 dedupe (an artifact hit skips upload stage 2)
// plus a mirror of the full photo metadata.

import type { Photo } from '$shared/types';

const DB_NAME = 'infoto';
const CACHE_STORE = 'metaCache';

interface ShaEntry {
	sha256: string;
	photoId: number;
}

function withDb<T>(db: IDBDatabase, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(CACHE_STORE, 'readwrite');
		const req = fn(tx.objectStore(CACHE_STORE));
		tx.oncomplete = () => resolve(req.result);
		tx.onerror = () => reject(tx.error ?? new Error('metaCache failed'));
	});
}

/** sha256 → known photoId (a hit means "duplicate", skip the upload). */
export function lookupSha(db: IDBDatabase, sha256: string): Promise<ShaEntry | undefined> {
	return withDb(db, (s) => s.get(sha256) as IDBRequest<ShaEntry | undefined>);
}

/** Rebuild the cache after a full snapshot (writes the photos array wholesale). */
export async function rebuildCache(db: IDBDatabase, photos: Photo[]): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(CACHE_STORE, 'readwrite');
		const store = tx.objectStore(CACHE_STORE);
		store.clear();
		for (const p of photos) store.put({ sha256: p.sha256, photoId: p.id } satisfies ShaEntry, p.sha256);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('metaCache rebuild failed'));
	});
}

/** Register a new sha after upload succeeded and the server confirmed it. */
export function putSha(db: IDBDatabase, sha256: string, photoId: number): Promise<void> {
	return withDb(db, (s) => s.put({ sha256, photoId } satisfies ShaEntry, sha256) as IDBRequest<IDBValidKey>).then(() => undefined);
}
