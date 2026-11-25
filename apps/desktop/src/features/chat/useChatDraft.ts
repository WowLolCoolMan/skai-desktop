import { useEffect, useRef, useState } from "react";
import type { ChatAttachment } from "../../../shared/contracts";
import { loadChatDraft, saveChatDraft } from "./chatDraftStore";

const CHAT_DRAFT_KEY_PREFIX = "skai.chat.draft.";
const LEGACY_CHAT_DRAFT_KEY = "skai.chat.draft";

const chatDraftKey = (tabId: string) => `${CHAT_DRAFT_KEY_PREFIX}tab.${tabId}`;

function readChatDraft(tabId: string, conversationId: string | null) {
  const scopedKey = chatDraftKey(tabId);
  const scoped = localStorage.getItem(scopedKey);
  if (scoped !== null) return scoped;
  const legacyKey = `${CHAT_DRAFT_KEY_PREFIX}${conversationId ?? "new"}`;
  const legacy = localStorage.getItem(legacyKey) ?? localStorage.getItem(LEGACY_CHAT_DRAFT_KEY);
  if (legacy !== null) {
    localStorage.setItem(scopedKey, legacy);
    if (legacyKey !== scopedKey) localStorage.removeItem(legacyKey);
    localStorage.removeItem(LEGACY_CHAT_DRAFT_KEY);
    return legacy;
  }
  return "";
}

export function useChatDraft(tabId: string, conversationId: string | null, attachments: ChatAttachment[], onSetAttachments: (attachments: ChatAttachment[]) => void) {
  const [draft, setDraft] = useState(() => readChatDraft(tabId, conversationId));
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null);
  const latestDraftRef = useRef(draft);
  const tabRef = useRef(tabId);
  const hydrationRef = useRef("");
  const latestAttachmentsRef = useRef(attachments);
  latestAttachmentsRef.current = attachments;

  const updateDraft = (value: string) => { latestDraftRef.current = value; setDraft(value); };

  useEffect(() => {
    if (tabRef.current !== tabId) {
      tabRef.current = tabId;
      hydrationRef.current = "";
      const tabDraft = readChatDraft(tabId, conversationId);
      latestDraftRef.current = tabDraft;
      setDraft(tabDraft);
      onSetAttachments([]);
    }
    let active = true;
    const startingDraft = readChatDraft(tabId, conversationId);
    void loadChatDraft(tabId).then((record) => {
      if (!active || tabRef.current !== tabId) return;
      const restoredDraft = localStorage.getItem(chatDraftKey(tabId)) ?? record?.draft ?? latestDraftRef.current;
      if (latestDraftRef.current === startingDraft) updateDraft(restoredDraft);
      if (record) onSetAttachments(record.attachments);
      hydrationRef.current = tabId;
      localStorage.setItem(chatDraftKey(tabId), restoredDraft);
      void saveChatDraft({ tabId, draft: restoredDraft, attachments: record?.attachments ?? latestAttachmentsRef.current, updatedAt: Date.now() }).then((saved) => {
        if (tabRef.current === tabId) setPersistenceWarning(saved ? null : "This draft could not be saved locally. It may be too large or local storage may be unavailable.");
      });
    });
    return () => { active = false; };
  // Hydrate only when the workspace tab changes. Draft/attachment edits are persisted below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  useEffect(() => {
    localStorage.setItem(chatDraftKey(tabId), draft);
    if (hydrationRef.current !== tabId) return;
    const timer = window.setTimeout(() => {
      void saveChatDraft({ tabId, draft: latestDraftRef.current, attachments: latestAttachmentsRef.current, updatedAt: Date.now() }).then((saved) => {
        if (tabRef.current === tabId) setPersistenceWarning(saved ? null : "This draft could not be saved locally. It may be too large or local storage may be unavailable.");
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, tabId]);

  useEffect(() => {
    if (hydrationRef.current !== tabId) return;
    void saveChatDraft({ tabId, draft: latestDraftRef.current, attachments, updatedAt: Date.now() }).then((saved) => {
      if (tabRef.current === tabId) setPersistenceWarning(saved ? null : "This draft could not be saved locally. It may be too large or local storage may be unavailable.");
    });
  }, [attachments, tabId]);

  return { draft, updateDraft, persistenceWarning };
}
