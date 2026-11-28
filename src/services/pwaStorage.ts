import type {
  AnnotationDto,
  AppSettings,
  BookDto,
  BookmarkDto,
  ShelfDto,
  TocItem,
} from "../types/models";

const DB_NAME = "essvb_pwa_v1";
const DB_VERSION = 1;
const STORE_KV = "kv";
const STORE_BOOKS = "bookData";

export interface StoredChapterEntry {
  title: string;
  bodyHtml: string;
  plainText: string;
}

export interface StoredBookPayload {
  id: string;
  toc: TocItem[];
  pageMap: number[];
  chapters: StoredChapterEntry[];
}

export interface PwaKvSnapshot {
  settings?: AppSettings;
  shelves?: ShelfDto[];
  books?: BookDto[];
  annotations?: AnnotationDto[];
  bookmarks?: BookmarkDto[];
}

export function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openPwaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV);
      }
      if (!db.objectStoreNames.contains(STORE_BOOKS)) {
        db.createObjectStore(STORE_BOOKS, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB açılamadı"));
  });
}

async function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  if (!hasIndexedDb()) return undefined;
  const db = await openPwaDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB okuma hatası"));
    tx.oncomplete = () => db.close();
  });
}

async function idbPut<T>(storeName: string, key: string | undefined, value: T): Promise<void> {
  if (!hasIndexedDb()) return;
  const db = await openPwaDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = key !== undefined ? store.put(value, key) : store.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("IndexedDB yazma hatası"));
    tx.oncomplete = () => db.close();
  });
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  if (!hasIndexedDb()) return;
  const db = await openPwaDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("IndexedDB silme hatası"));
    tx.oncomplete = () => db.close();
  });
}

export async function loadPwaSnapshot(): Promise<PwaKvSnapshot> {
  if (!hasIndexedDb()) return {};
  try {
    const [settings, shelves, books, annotations, bookmarks] = await Promise.all([
      idbGet<AppSettings>(STORE_KV, "settings"),
      idbGet<ShelfDto[]>(STORE_KV, "shelves"),
      idbGet<BookDto[]>(STORE_KV, "books"),
      idbGet<AnnotationDto[]>(STORE_KV, "annotations"),
      idbGet<BookmarkDto[]>(STORE_KV, "bookmarks"),
    ]);
    return { settings, shelves, books, annotations, bookmarks };
  } catch {
    return {};
  }
}

export async function savePwaKv<K extends keyof PwaKvSnapshot>(
  key: K,
  value: NonNullable<PwaKvSnapshot[K]>,
): Promise<void> {
  try {
    await idbPut(STORE_KV, key, value);
  } catch {
    // Ignore storage quota errors cleanly in preview mode
  }
}

export async function savePwaBookPayload(payload: StoredBookPayload): Promise<void> {
  try {
    await idbPut(STORE_BOOKS, undefined, payload);
  } catch {
    // Ignore storage errors cleanly
  }
}

export async function loadPwaBookPayload(bookId: string): Promise<StoredBookPayload | undefined> {
  try {
    return await idbGet<StoredBookPayload>(STORE_BOOKS, bookId);
  } catch {
    return undefined;
  }
}

export async function deletePwaBookPayload(bookId: string): Promise<void> {
  try {
    await idbDelete(STORE_BOOKS, bookId);
  } catch {
    // Ignore delete failures
  }
}
