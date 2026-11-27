import { Fragment, useEffect, useRef, useState } from "react";
import type { Message } from "../../app/types";
import { Button } from "../../components/ui/Primitives";
import { ChatMessage } from "./ChatMessage";

const CHAT_SCROLL_KEY_PREFIX = "skai.chat.scroll.";
const chatScrollKey = (conversationId: string | null) => `${CHAT_SCROLL_KEY_PREFIX}${conversationId ?? "new"}`;

function localDayKey(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (localDayKey(value) === localDayKey(today.toISOString())) return "Today";
  if (localDayKey(value) === localDayKey(yesterday.toISOString())) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

type ChatMessageListProps = {
  conversationId: string | null;
  messages: Message[];
  busy: boolean;
  model: string;
  copiedMessage: number | null;
  onCopy: (content: string, index: number) => void;
  onRetry: (index: number) => void;
  onFork: (index: number) => void;
  onEdit: (index: number, content: string) => Promise<boolean>;
};

export function ChatMessageList({ conversationId, messages, busy, model, copiedMessage, onCopy, onRetry, onFork, onEdit }: ChatMessageListProps) {
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [newOutputCount, setNewOutputCount] = useState(0);
  const [newActivityStartIndex, setNewActivityStartIndex] = useState<number | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const previousConversationIdRef = useRef(conversationId);
  const lastReadMessageCountRef = useRef(messages.length);
  const messagesCountRef = useRef(messages.length);
  messagesCountRef.current = messages.length;
  const previousMessageCountRef = useRef(messages.length);
  const previousLatestContentRef = useRef(messages.at(-1)?.content ?? "");
  const restoreScrollPendingRef = useRef(false);
  const stickToLatestRef = useRef(true);
  const latestContent = messages.at(-1)?.content ?? "";

  useEffect(() => {
    const key = chatScrollKey(conversationId);
    return () => {
      const node = messageListRef.current;
      const distanceFromLatest = node ? node.scrollHeight - node.scrollTop - node.clientHeight : 0;
      localStorage.setItem(key, JSON.stringify({ top: Math.max(0, Math.round(node?.scrollTop ?? 0)), messageCount: lastReadMessageCountRef.current, wasAtLatest: distanceFromLatest < 56 }));
    };
  }, [conversationId, messages.length]);

  useEffect(() => {
    const node = messageListRef.current;
    if (!node) return;
    const updateScrollState = () => {
      const distanceFromLatest = node.scrollHeight - node.scrollTop - node.clientHeight;
      const atLatest = distanceFromLatest < 56;
      stickToLatestRef.current = atLatest;
      if (atLatest) lastReadMessageCountRef.current = messagesCountRef.current;
      setShowJumpToLatest(!atLatest && node.scrollHeight > node.clientHeight + 12);
      if (atLatest) { setNewOutputCount(0); setNewActivityStartIndex(null); }
    };
    node.addEventListener("scroll", updateScrollState, { passive: true });
    updateScrollState();
    return () => node.removeEventListener("scroll", updateScrollState);
  }, [messages.length > 0]);

  useEffect(() => {
    const conversationChanged = previousConversationIdRef.current !== conversationId;
    if (conversationChanged) {
      previousConversationIdRef.current = conversationId;
      restoreScrollPendingRef.current = true;
      previousMessageCountRef.current = messages.length;
      previousLatestContentRef.current = latestContent;
      let saved: { messageCount?: number; wasAtLatest?: boolean } | null = null;
      try { const raw = JSON.parse(localStorage.getItem(chatScrollKey(conversationId)) ?? "null"); if (raw && typeof raw === "object") saved = raw; } catch { /* Older builds stored only the scroll offset. */ }
      lastReadMessageCountRef.current = saved?.messageCount ?? messages.length;
      const unseenCount = Math.max(0, messages.length - (saved?.messageCount ?? messages.length));
      setNewOutputCount(saved?.wasAtLatest === false ? unseenCount : 0);
      setNewActivityStartIndex(saved?.wasAtLatest === false && unseenCount > 0 ? Math.min(saved?.messageCount ?? 0, messages.length - 1) : null);
    } else {
      const addedMessages = Math.max(0, messages.length - previousMessageCountRef.current);
      const contentChanged = latestContent !== previousLatestContentRef.current;
      if (!stickToLatestRef.current && (addedMessages > 0 || contentChanged)) {
        setNewActivityStartIndex((current) => current ?? Math.min(previousMessageCountRef.current, Math.max(0, messages.length - 1)));
        setNewOutputCount((current) => current + Math.max(addedMessages, contentChanged ? 1 : 0));
      }
      previousMessageCountRef.current = messages.length;
      previousLatestContentRef.current = latestContent;
    }
    if (conversationChanged || restoreScrollPendingRef.current) {
      restoreScrollPendingRef.current = false;
      const raw = localStorage.getItem(chatScrollKey(conversationId)) ?? "0";
      let savedTop: number;
      try { const value = JSON.parse(raw) as { top?: number } | number; savedTop = typeof value === "number" ? value : Number(value.top ?? 0); } catch { savedTop = Number(raw); }
      const top = Number.isFinite(savedTop) ? Math.max(0, savedTop) : 0;
      window.requestAnimationFrame(() => { if (messageListRef.current) messageListRef.current.scrollTop = top; });
      return;
    }
    if (!stickToLatestRef.current) return;
    window.requestAnimationFrame(() => { if (messageListRef.current) messageListRef.current.scrollTo({ top: messageListRef.current.scrollHeight, behavior: "smooth" }); });
  }, [conversationId, latestContent, messages.length, busy]);

  const jumpToLatest = () => {
    stickToLatestRef.current = true;
    setShowJumpToLatest(false);
    setNewOutputCount(0);
    setNewActivityStartIndex(null);
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: "smooth" });
  };

  useEffect(() => {
    let targetId = window.location.hash.slice(1);
    try { targetId = decodeURIComponent(targetId); } catch { return; }
    if (!targetId.startsWith(`chat-message-${encodeURIComponent(conversationId ?? "new")}-`)) return;
    window.requestAnimationFrame(() => document.getElementById(targetId)?.scrollIntoView({ block: "center" }));
  }, [conversationId, messages.length]);

  return <>
    <div className="message-list" ref={messageListRef}>{messages.map((message, index) => {
      const timestamp = message.createdAtUtc && Number.isFinite(Date.parse(message.createdAtUtc)) ? message.createdAtUtc : null;
      const previousTimestamp = index > 0 ? messages[index - 1].createdAtUtc : null;
      const dayChanged = timestamp && (!previousTimestamp || !Number.isFinite(Date.parse(previousTimestamp)) || localDayKey(timestamp) !== localDayKey(previousTimestamp));
      return <Fragment key={`message-${index}`}>{dayChanged && <time className="chat-date-separator" dateTime={timestamp!}>{dayLabel(timestamp!)}</time>}{newActivityStartIndex === index && <div className="new-activity-divider" role="separator">New activity</div>}<ChatMessage message={message} index={index} model={model} busy={busy} conversationId={conversationId} copied={copiedMessage === index} onCopy={onCopy} onRetry={onRetry} onFork={onFork} onEdit={onEdit} /></Fragment>;
    })}{busy ? <article className="message-bubble chat-message assistant"><p className="typing">Thinking…</p></article> : null}</div>
    {showJumpToLatest && <div className="chat-latest-action"><Button variant="secondary" type="button" onClick={jumpToLatest}>{newOutputCount ? `${newOutputCount} new ${newOutputCount === 1 ? "message" : "messages"} · ` : ""}Jump to latest ↓</Button></div>}
  </>;
}
