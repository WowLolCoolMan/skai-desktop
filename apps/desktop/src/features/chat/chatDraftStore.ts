import type { ChatAttachment } from "../../../shared/contracts";

export type ChatDraftRecord = { tabId: string; draft: string; attachments: ChatAttachment[]; updatedAt: number };

const databaseName = "skai-chat-drafts";
const databaseVersion = 1;
const storeName = "drafts";
const maxDraftCharacters = 24_000;
const maxAttachments = 5;
const maxAttachmentCharacters = 20 * 1024 * 1024;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: "tabId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Chat draft storage could not be opened."));
  });
}

function validate(record: ChatDraftRecord): boolean {
  return record.draft.length <= maxDraftCharacters
    && record.attachments.length <= maxAttachments
    && record.attachments.every((item) => typeof item.fileName === "string" && typeof item.content === "string")
    && record.attachments.reduce((total, item) => total + item.content.length, 0) <= maxAttachmentCharacters;
}

export async function loadChatDraft(tabId: string): Promise<ChatDraftRecord | null> {
  try {
    const database = await openDatabase();
    try {
      const record = await new Promise<ChatDraftRecord | undefined>((resolve, reject) => {
        const request = database.transaction(storeName, "readonly").objectStore(storeName).get(tabId);
        request.onsuccess = () => resolve(request.result as ChatDraftRecord | undefined);
        request.onerror = () => reject(request.error);
      });
      return record && validate(record) ? record : null;
    } finally { database.close(); }
  } catch { return null; }
}

export async function saveChatDraft(record: ChatDraftRecord): Promise<boolean> {
  if (!record.tabId || !validate(record)) return false;
  try {
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).put(record);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      return true;
    } finally { database.close(); }
  } catch { return false; }
}

export async function removeChatDraft(tabId: string): Promise<void> {
  try {
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).delete(tabId);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { database.close(); }
  } catch { /* Draft cleanup must never block navigation. */ }
}
