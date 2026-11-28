export type ImageHistoryEntry = {
  url: string;
  fileName: string;
  createdAt: string;
  provider: "comfyui" | "diffusers";
  prompt: string;
  mediaType?: "image" | "video" | "audio";
  model?: string;
  seed?: number;
  width?: number;
  height?: number;
  workflow?: string;
  origin?: "generated" | "edited" | "imported" | "user-authored";
};

const databaseName = "skai-image-history";
const databaseVersion = 1;
const storeName = "outputs";
const maxEntries = 24;
const maxStoredCharacters = 32 * 1024 * 1024;
const maxImageCharacters = 7_500_000;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Image history could not be opened."));
  });
}

function readAll(store: IDBObjectStore): Promise<Array<ImageHistoryEntry & { id: string }>> {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as Array<ImageHistoryEntry & { id: string }>);
    request.onerror = () => reject(request.error ?? new Error("Image history could not be read."));
  });
}

/** Read the newest bounded local image history. Broken or unavailable storage is non-fatal. */
export async function loadImageHistory(): Promise<ImageHistoryEntry[]> {
  try {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(storeName, "readonly");
      const records = await readAll(transaction.objectStore(storeName));
      return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, maxEntries);
    } finally {
      database.close();
    }
  } catch {
    return [];
  }
}

/** Remove expired Skai-owned previews only; source media files are never touched. */
export async function pruneImageHistoryBefore(cutoff: Date): Promise<number> {
  try {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(storeName, "readwrite");
      let removed = 0;
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("Generated media retention could not be applied."));
        transaction.onabort = () => reject(transaction.error ?? new Error("Generated media retention was interrupted."));
        const cursorRequest = transaction.objectStore(storeName).openCursor();
        cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error("Generated media history could not be read."));
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const entry = cursor.value as ImageHistoryEntry & { id: string };
          const createdAt = Date.parse(entry.createdAt);
          if (!Number.isNaN(createdAt) && createdAt < cutoff.getTime()) {
            cursor.delete();
            removed += 1;
          }
          cursor.continue();
        };
      });
      return removed;
    } finally { database.close(); }
  } catch {
    return 0;
  }
}

/** Remove only Skai's generated-output index and embedded previews in this browser profile. */
export async function clearImageHistory(): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Generated media history could not be cleared."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Generated media history cleanup was interrupted."));
    });
  } finally {
    database.close();
  }
}

/** Persist image outputs locally, keeping recent records within strict count and size limits. */
export async function saveImageHistory(entries: ImageHistoryEntry[]): Promise<void> {
  if (!entries.length) return;
  try {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("Image history could not be saved."));
        transaction.onabort = () => reject(transaction.error ?? new Error("Image history save was interrupted."));
        const request = store.getAll();
        request.onerror = () => reject(request.error ?? new Error("Image history could not be read."));
        request.onsuccess = () => {
          const unique = new Map<string, ImageHistoryEntry & { id: string }>();
          for (const entry of [...(request.result as Array<ImageHistoryEntry & { id: string }>), ...entries]) {
            if (!entry.url || entry.url.length > maxImageCharacters || !entry.fileName || !entry.createdAt || (entry.workflow?.length ?? 0) > 1_000_000) continue;
            const id = `${entry.createdAt}:${entry.fileName}`;
            unique.set(id, { ...entry, id });
          }

          const newest = [...unique.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
          const retained: Array<ImageHistoryEntry & { id: string }> = [];
          let storedCharacters = 0;
          for (const entry of newest) {
            const metadataCharacters = JSON.stringify({ ...entry, url: "" }).length;
            if (retained.length >= maxEntries || storedCharacters + entry.url.length + metadataCharacters > maxStoredCharacters) continue;
            retained.push(entry);
            storedCharacters += entry.url.length + metadataCharacters;
          }

          store.clear();
          for (const entry of retained) store.put(entry);
        };
      });
    } finally {
      database.close();
    }
  } catch {
    // Generation remains successful if browser storage is unavailable or full.
  }
}
