import { useEffect, useRef, useState } from "react";
import type { AgentRequest } from "../../services/agentClient";
import type { ChatAttachment, DesktopConversation, DesktopQueuedMessage } from "../../../shared/contracts";
import type { Message } from "../../app/types";
import { speakNativeResponse, stopNativeSpeech } from "../../services/nativeTts";
import { isLocalEndpoint, LOCAL_ENDPOINT_ERROR } from "../../services/localOnly";
import { extractVideoFrameAttachments, isVideoAttachment, videoMediaType } from "./videoFrameExtractor";

type ChatWorkspaceOptions = {
  request: AgentRequest;
  connection: "checking" | "ready" | "error";
  provider: string;
  endpoint: string;
  model: string;
  modelMetadata?: { model: string; provider?: string; sizeBytes?: number | null; contextLength?: number | null };
  mode: "ChatBot" | "Coding Agent";
  project?: { id: string; name: string; instructions?: string } | null;
  onConversationModelRestore?: (model: string | null | undefined, provider: string | null | undefined) => void;
  onError: (message: string | null) => void;
};

export type ChatResponseMode = "think" | "coding" | "security";
const CHAT_RESPONSE_MODES: ChatResponseMode[] = ["think", "coding", "security"];
function normalizeResponseMode(value: unknown): ChatResponseMode {
  return CHAT_RESPONSE_MODES.includes(value as ChatResponseMode) ? value as ChatResponseMode : "think";
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      const separator = value.indexOf(",");
      resolve(separator >= 0 ? value.slice(separator + 1) : value);
    };
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function base64ToBlob(content: string, mediaType: string) {
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes.buffer], { type: mediaType });
}

function skillMentions(messages: Array<{ content: string }>) {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const match of message.content.matchAll(/\$([A-Za-z0-9._-]{1,80})\b/g)) ids.add(match[1]);
  }
  return [...ids].slice(0, 4);
}

export function useChatWorkspace({ request, connection, provider, endpoint, model, modelMetadata, mode, project, onConversationModelRestore, onError }: ChatWorkspaceOptions) {
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [conversations, setConversations] = useState<DesktopConversation[]>([]);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<DesktopQueuedMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [responseMode, setResponseModeState] = useState<ChatResponseMode>(() => normalizeResponseMode(localStorage.getItem("skai.chat.responseMode")));

  useEffect(() => {
    if (connection !== "ready") return;
    void Promise.all([request("conversations.list", { includeArchived: false }), request("chat.queue.list")]).then(([conversationResponse, queueResponse]) => {
      if (conversationResponse.ok) {
        const loaded = (conversationResponse.result as DesktopConversation[]) ?? [];
        setConversations(loaded);
        setConversationsLoaded(true);
        const savedConversationId = localStorage.getItem("skai.conversation.active");
        const first = loaded.find((conversation) => conversation.id === savedConversationId) ?? loaded.find((conversation) => (conversation.mode ?? "ChatBot") === modeRef.current);
        if (first) {
          onConversationModelRestore?.(first.model, first.modelProvider);
          setConversationId(first.id);
          localStorage.setItem("skai.conversation.active", first.id);
          setMessages(first.messages.filter((item) => item.role !== "system") as Message[]);
          setResponseModeState(normalizeResponseMode(first.responseMode));
          localStorage.setItem("skai.chat.responseMode", normalizeResponseMode(first.responseMode));
        } else {
          setConversationId(null);
          localStorage.removeItem("skai.conversation.active");
          setMessages([]);
        }
      } else onError(conversationResponse.error?.message ?? "Conversations could not be loaded.");
      if (queueResponse.ok) setQueuedMessages((queueResponse.result as DesktopQueuedMessage[]) ?? []);
      else onError(queueResponse.error?.message ?? "Queued messages could not be loaded.");
    }).catch(() => onError("Chat workspace data could not be loaded."));
  }, [connection, onError, request]);

  const saveConversation = async (nextMessages: Message[], id = conversationId) => {
    const existingTitle = id ? conversations.find((conversation) => conversation.id === id)?.title : undefined;
    const title = existingTitle || nextMessages.find((item) => item.role === "user")?.content.slice(0, 80) || "New chat";
    const response = await request("conversation.save", { id: id ?? undefined, title, mode, responseMode, model, modelProvider: provider, modelSizeBytes: modelMetadata?.sizeBytes ?? null, modelContextLength: modelMetadata?.contextLength ?? null, ...(mode === "Coding Agent" && project ? { projectId: project.id, projectName: project.name, projectInstructions: project.instructions ?? "" } : {}) });
    if (!response.ok) { onError(response.error?.message ?? "Conversation could not be saved."); return id; }
    const savedId = (response.result as { id: string }).id;
    setConversationId(savedId);
    localStorage.setItem("skai.conversation.active", savedId);
    return savedId;
  };

  const sendMessage = async (text: string, messageAttachments: ChatAttachment[], documentsOnly = false, speakReply = false, temporary = false) => {
    if (!isLocalEndpoint(endpoint)) { onError(LOCAL_ENDPOINT_ERROR); return; }
    stopNativeSpeech();
    const next = [...messages, { role: "user" as const, content: text || "Attached files", attachments: messageAttachments.length ? messageAttachments : undefined }];
    setMessages(next); setAttachments([]); setBusy(true); onError(null);
    const savedId = temporary ? null : await saveConversation(next);
    if (mode === "Coding Agent") {
      try {
        const planned = await request("tasks.plan", {
          title: text.slice(0, 200) || "Coding task",
          instruction: project?.instructions ? `${text}\n\nProject instructions:\n${project.instructions}` : text,
          environment: "local",
          projectId: project?.id ?? null,
          conversationId: savedId,
          responseMode,
          model: modelMetadata?.model ?? model,
          modelProvider: modelMetadata?.provider ?? provider,
          modelSizeBytes: modelMetadata?.sizeBytes ?? null,
          modelContextLength: modelMetadata?.contextLength ?? null,
          airLlmCompatible: (modelMetadata?.provider ?? provider).toLowerCase() === "airllm" || model.includes("/"),
        });
        if (!planned.ok) throw new Error(planned.error?.message ?? "The coding task could not be created.");
        const taskId = (planned.result as { id: string }).id;
        const queued = await request("tasks.queue", { id: taskId });
        if (!queued.ok) throw new Error(queued.error?.message ?? "The coding task could not be queued.");
        const started = await request("tasks.execute", { id: taskId });
        if (!started.ok) throw new Error(started.error?.message ?? "The coding task could not start.");
        setBusy(false);
        return;
      } catch (error) {
        setBusy(false);
        onError(error instanceof Error ? error.message : "The coding task could not start.");
        return;
      }
    }
    const response = await request("chat.complete", { provider, endpoint, model, modelContextLength: modelMetadata?.contextLength ?? null, messages: next, responseMode, skills: skillMentions(next), ...(documentsOnly ? { documentsOnly: true } : {}) });
    if (!response.ok) { setBusy(false); onError(response.error?.message ?? "The model request failed."); return; }
    const completed = [...next, { role: "assistant" as const, content: (response.result as { content: string }).content }];
    setMessages(completed); if (!temporary) await saveConversation(completed, savedId);
    await speakNativeResponse(completed.at(-1)?.content ?? "", speakReply);
    setBusy(false);
  };

  const rewritePrompt = async (draft: string): Promise<string | null> => {
    const original = draft.trim();
    if (!original || original.length > 120_000) {
      onError("Enter a prompt under 120,000 characters before rewriting it.");
      return null;
    }
    if (!isLocalEndpoint(endpoint)) {
      onError(LOCAL_ENDPOINT_ERROR);
      return null;
    }
    const context = messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-16)
      .map((message) => ({
        role: message.role,
        content: message.content.length > 12_000 ? `${message.content.slice(0, 12_000)}\n[context truncated]` : message.content,
      }));
    const rewriteMessages = [
      {
        role: "system" as const,
        content: "Rewrite the user's latest draft as a clear, specific, actionable prompt for the selected AI. Preserve the full intent, requested operation, names, paths, examples, constraints, tone, uncertainty, and technical details. Do not add requirements, facts, safety rules, refusals, or claims that work was done. Do not omit content because it is technical or risky. Keep the original language and return only the rewritten prompt. If the draft is already clear, return it unchanged.",
      },
      ...context,
      { role: "user" as const, content: original },
    ];
    onError(null);
    try {
      const response = await request("chat.complete", { provider, endpoint, model, modelContextLength: modelMetadata?.contextLength ?? null, messages: rewriteMessages });
      if (!response.ok) throw new Error(response.error?.message ?? "The selected model could not rewrite this prompt.");
      const candidate = (response.result as { content?: unknown }).content;
      if (typeof candidate !== "string" || candidate.trim().length < 2 || candidate.trim().length > 24_000) {
        throw new Error("The model returned an empty or oversized rewrite. Your original draft is unchanged.");
      }
      return candidate.trim();
    } catch (error) {
      onError(error instanceof Error ? `Prompt rewrite failed. Your original draft is unchanged. ${error.message}` : "Prompt rewrite failed. Your original draft is unchanged.");
      return null;
    }
  };

  const retryMessage = async (messageIndex: number) => {
    if (busy || !conversationId) return;
    if (!isLocalEndpoint(endpoint)) { onError(LOCAL_ENDPOINT_ERROR); return; }
    const originalMessages = messages;
    const prefix = messages.slice(0, messageIndex);
    if (messages[messageIndex]?.role !== "assistant" || !prefix.some((message) => message.role === "user")) return;
    stopNativeSpeech();
    setMessages(prefix); setBusy(true); onError(null);
    const response = await request("chat.complete", { provider, endpoint, model, modelContextLength: modelMetadata?.contextLength ?? null, messages: prefix, responseMode, skills: skillMentions(prefix) });
    setBusy(false);
    if (!response.ok) { setMessages(originalMessages); onError(response.error?.message ?? "The model request failed."); return; }
    const completed = [...prefix, { role: "assistant" as const, content: (response.result as { content: string }).content }];
    setMessages(completed); await saveConversation(completed, conversationId);
    void speakNativeResponse(completed.at(-1)?.content ?? "");
  };

  const editMessage = async (messageIndex: number, content: string) => {
    if (busy || !conversationId || !content.trim()) return false;
    if (messages[messageIndex]?.role !== "user") return false;
    if (!isLocalEndpoint(endpoint)) { onError(LOCAL_ENDPOINT_ERROR); return false; }
    const originalMessages = messages;
    const prefix = messages.slice(0, messageIndex);
    const edited = { ...messages[messageIndex], content: content.trim() };
    const next = [...prefix, edited];
    stopNativeSpeech();
    setMessages(next); setBusy(true); onError(null);
    const response = await request("chat.complete", { provider, endpoint, model, modelContextLength: modelMetadata?.contextLength ?? null, messages: next, responseMode, skills: skillMentions(next) });
    setBusy(false);
    if (!response.ok) { setMessages(originalMessages); onError(response.error?.message ?? "The edited message could not be completed."); return false; }
    const completed = [...next, { role: "assistant" as const, content: (response.result as { content: string }).content }];
    setMessages(completed); await saveConversation(completed, conversationId);
    void speakNativeResponse(completed.at(-1)?.content ?? "");
    return true;
  };

  const pickAttachments = async () => {
    const response = await request("workspace.pickFiles");
    if (!response.ok) { onError(response.error?.message ?? "File selection failed."); return; }
    const selected = (response.result as { attachments: ChatAttachment[] }).attachments ?? [];
    const extracted: ChatAttachment[] = [];
    try {
      for (const attachment of selected) {
        if (isVideoAttachment(attachment)) {
          extracted.push(...await extractVideoFrameAttachments(base64ToBlob(attachment.content, attachment.mediaType!), attachment.fileName));
        } else if (attachment.fileName.toLowerCase().endsWith(".pdf")) {
          const extraction = await request("workspace.attachment.extract", { fileName: attachment.fileName, content: attachment.content });
          if (!extraction.ok) { onError(extraction.error?.message ?? `Could not read ${attachment.fileName}.`); return; }
          extracted.push(extraction.result as ChatAttachment);
        } else extracted.push(attachment);
        if (extracted.length >= 5) break;
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "The selected video could not be sampled locally.");
      return;
    }
    setAttachments((current) => [...current, ...extracted].slice(0, 5));
  };

  const importDroppedFiles = async (files: File[]) => {
    if (files.length === 0) return;
    try {
      const attachments: ChatAttachment[] = [];
      for (const file of files.slice(0, 5)) {
        const mediaType = videoMediaType(file.name, file.type);
        if (mediaType) attachments.push(...await extractVideoFrameAttachments(file, file.name));
        else attachments.push({ fileName: file.name, mediaType: file.type || null, content: await readFileAsBase64(file) });
        if (attachments.length >= 5) break;
      }
      const response = await request("workspace.importDroppedFiles", { attachments });
      if (!response.ok) { onError(response.error?.message ?? "Dropped files could not be attached."); return; }
      const imported = (response.result as { attachments: ChatAttachment[] }).attachments ?? [];
      const extracted: ChatAttachment[] = [];
      for (const attachment of imported) {
        if (attachment.fileName.toLowerCase().endsWith(".pdf")) {
          const extraction = await request("workspace.attachment.extract", { fileName: attachment.fileName, content: attachment.content });
          if (!extraction.ok) { onError(extraction.error?.message ?? `Could not read ${attachment.fileName}.`); return; }
          extracted.push(extraction.result as ChatAttachment);
        } else extracted.push(attachment);
      }
      setAttachments((current) => [...current, ...extracted].slice(0, 5));
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Dropped files could not be processed locally.");
    }
  };

  const queueMessage = async (text: string, messageAttachments: ChatAttachment[]) => {
    const response = await request("chat.queue.enqueue", { text: text || "Attached files", attachments: messageAttachments });
    if (!response.ok) { onError(response.error?.message ?? "Message could not be queued."); return; }
    setQueuedMessages((response.result as DesktopQueuedMessage[]) ?? []);
  };

  const removeQueuedMessage = async (index: number) => {
    const response = await request("chat.queue.remove", { index });
    if (!response.ok) { onError(response.error?.message ?? "Queued message could not be removed."); return; }
    setQueuedMessages((response.result as DesktopQueuedMessage[]) ?? []);
  };

  const exportConversations = async () => {
    const response = await request("conversations.export", { includeArchived: true });
    if (!response.ok) { onError(response.error?.message ?? "Conversation export failed."); return; }
    const result = response.result as { fileName: string; markdown: string };
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([result.markdown], { type: "text/markdown" })); link.download = result.fileName; link.click(); URL.revokeObjectURL(link.href);
  };

  const updateConversationMetadata = async (patch: { pinned?: boolean; archived?: boolean; title?: string }, targetId = conversationId) => {
    if (!targetId) return false;
    const response = await request("conversation.metadata.save", { id: targetId, ...patch });
    if (!response.ok) { onError(response.error?.message ?? "Conversation metadata could not be saved."); return false; }
    const refreshed = await request("conversations.list", { includeArchived: Boolean(patch.archived) });
    if (refreshed.ok) setConversations((refreshed.result as DesktopConversation[]) ?? []);
    else { onError(refreshed.error?.message ?? "Conversations could not be refreshed."); return false; }
    return true;
  };

  const forkConversation = async (throughIndex?: number) => {
    if (!conversationId) return;
    const response = await request("conversation.fork", { id: conversationId, ...(throughIndex === undefined ? {} : { throughIndex }) });
    if (!response.ok) { onError(response.error?.message ?? "Conversation could not be forked."); return; }
    const result = response.result as { id: string };
    setConversationId(result.id);
    if (throughIndex !== undefined) setMessages((current) => current.slice(0, throughIndex + 1));
    const refreshed = await request("conversations.list", { includeArchived: false });
    if (refreshed.ok) setConversations((refreshed.result as DesktopConversation[]) ?? []);
    else onError(refreshed.error?.message ?? "Conversations could not be refreshed.");
  };

  const startNewChat = () => { setConversationId(null); localStorage.removeItem("skai.conversation.active"); setMessages([]); setAttachments([]); onError(null); };
  const selectConversation = (id: string) => {
    const selected = conversations.find((conversation) => conversation.id === id);
    if (!selected) return;
    setConversationId(selected.id);
    onConversationModelRestore?.(selected.model, selected.modelProvider);
    localStorage.setItem("skai.conversation.active", selected.id);
    setMessages(selected.messages.filter((item) => item.role !== "system") as Message[]);
    const selectedResponseMode = normalizeResponseMode(selected.responseMode);
    setResponseModeState(selectedResponseMode);
    localStorage.setItem("skai.chat.responseMode", selectedResponseMode);
    if (selected.id !== conversationId) setAttachments([]);
    onError(null);
  };
  const setResponseMode = (nextValue: ChatResponseMode) => {
    const next = normalizeResponseMode(nextValue);
    setResponseModeState(next);
    localStorage.setItem("skai.chat.responseMode", next);
    if (!conversationId) return;
    void request("conversation.metadata.save", { id: conversationId, responseMode: next }).then((result) => {
      if (!result.ok) { onError(result.error?.message ?? "Response mode could not be saved."); return; }
      setConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, responseMode: next } : conversation));
    }).catch(() => onError("Response mode could not be saved."));
  };
  const activeConversation = conversations.find((conversation) => conversation.id === conversationId) ?? null;

  return { messages, conversationId, attachments, conversations, conversationsLoaded, queuedMessages, busy, activeConversation, responseMode, setResponseMode, setAttachments, sendMessage, rewritePrompt, retryMessage, editMessage, pickAttachments, importDroppedFiles, queueMessage, removeQueuedMessage, exportConversations, updateConversationMetadata, forkConversation, startNewChat, selectConversation };
}
