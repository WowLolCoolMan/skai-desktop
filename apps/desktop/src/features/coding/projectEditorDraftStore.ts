export type ProjectEditorDraft = { key: string; projectId: string; path: string; content: string; updatedAt: number };

const databaseName = "skai-project-editor-drafts";
const databaseVersion = 1;
const storeName = "drafts";
const maxCharacters = 100_000;
const maxEntries = 40;
let databasePromise: Promise<IDBDatabase> | null = null;

function draftKey(projectId: string, path: string) { return `${projectId}:${path}`; }

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { databasePromise = null; reject(request.error ?? new Error("Project draft storage could not be opened.")); };
  });
  return databasePromise;
}

export async function loadProjectEditorDraft(projectId: string, path: string): Promise<string | null> {
  try {
    const database = await openDatabase();
    try {
      const record = await new Promise<ProjectEditorDraft | undefined>((resolve, reject) => {
        const request = database.transaction(storeName, "readonly").objectStore(storeName).get(draftKey(projectId, path));
        request.onsuccess = () => resolve(request.result as ProjectEditorDraft | undefined);
        request.onerror = () => reject(request.error);
      });
      return record && typeof record.content === "string" && record.content.length <= maxCharacters ? record.content : null;
    } finally { /* Keep the local draft database ready during editing. */ }
  } catch { return null; }
}

export async function saveProjectEditorDraft(projectId: string, path: string, content: string): Promise<boolean> {
  if (!projectId || !path || content.length > maxCharacters) return false;
  try {
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        store.put({ key: draftKey(projectId, path), projectId, path, content, updatedAt: Date.now() } satisfies ProjectEditorDraft);
        const request = store.getAll();
        request.onsuccess = () => {
          const records = (request.result as ProjectEditorDraft[]).sort((a, b) => b.updatedAt - a.updatedAt);
          for (const stale of records.slice(maxEntries)) store.delete(stale.key);
        };
        request.onerror = () => { transaction.abort(); reject(request.error); };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error("Project draft save was interrupted."));
      });
      return true;
    } finally { /* Keep the local draft database ready during editing. */ }
  } catch { return false; }
}

export async function removeProjectEditorDraft(projectId: string, path: string): Promise<void> {
  try {
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).delete(draftKey(projectId, path));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { /* Keep the local draft database ready during editing. */ }
  } catch { /* Cleanup is best-effort and must not interrupt editing. */ }
}
