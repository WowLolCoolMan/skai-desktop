import { useEffect, useRef, useState } from "react";
import type { Message } from "../../app/types";
import { Button } from "../../components/ui/Primitives";
import { ChatMessage } from "./ChatMessage";

const CHAT_SCROLL_KEY_PREFIX = "skai.chat.scroll.";
const chatScrollKey = (conversationId: string | null) => `${CHAT_SCROLL_KEY_PREFIX}${conversationId ?? "new"}`;

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
  const messageListRef = useRef<HTMLDivElement>(null);
  const previousConversationIdRef = useRef(conversationId);
  const previousMessageCountRef = useRef(messages.length);
  const previousLatestContentRef = useRef(messages.at(-1)?.content ?? "");
  const restoreScrollPendingRef = useRef(false);
  const stickToLatestRef = useRef(true);
  const latestContent = messages.at(-1)?.content ?? "";

  useEffect(() => {
    const key = chatScrollKey(conversationId);
    return () => { localStorage.setItem(key, String(Math.max(0, Math.round(messageListRef.current?.scrollTop ?? 0)))); };
  }, [conversationId]);

  useEffect(() => {
    const node = messageListRef.current;
    if (!node) return;
    const updateScrollState = () => {
      const distanceFromLatest = node.scrollHeight - node.scrollTop - node.clientHeight;
      const atLatest = distanceFromLatest < 56;
      stickToLatestRef.current = atLatest;
      setShowJumpToLatest(!atLatest && node.scrollHeight > node.clientHeight + 12);
      if (atLatest) setNewOutputCount(0);
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
      setNewOutputCount(0);
    } else {
      const addedMessages = Math.max(0, messages.length - previousMessageCountRef.current);
      const contentChanged = latestContent !== previousLatestContentRef.current;
      if (!stickToLatestRef.current && (addedMessages > 0 || contentChanged)) {
        setNewOutputCount((current) => current + Math.max(addedMessages, contentChanged ? 1 : 0));
      }
      previousMessageCountRef.current = messages.length;
      previousLatestContentRef.current = latestContent;
    }
    if (conversationChanged || restoreScrollPendingRef.current) {
      restoreScrollPendingRef.current = false;
      const saved = Number(localStorage.getItem(chatScrollKey(conversationId)) ?? "0");
      const top = Number.isFinite(saved) ? Math.max(0, saved) : 0;
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
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: "smooth" });
  };

  useEffect(() => {
    let targetId = window.location.hash.slice(1);
    try { targetId = decodeURIComponent(targetId); } catch { return; }
    if (!targetId.startsWith(`chat-message-${encodeURIComponent(conversationId ?? "new")}-`)) return;
    window.requestAnimationFrame(() => document.getElementById(targetId)?.scrollIntoView({ block: "center" }));
  }, [conversationId, messages.length]);

  return <>
    <div className="message-list" ref={messageListRef}>{messages.map((message, index) => <ChatMessage key={index} message={message} index={index} model={model} busy={busy} conversationId={conversationId} copied={copiedMessage === index} onCopy={onCopy} onRetry={onRetry} onFork={onFork} onEdit={onEdit} />)}{busy ? <article className="message-bubble chat-message assistant"><p className="typing">Thinking…</p></article> : null}</div>
    {showJumpToLatest && <div className="chat-latest-action"><Button variant="secondary" type="button" onClick={jumpToLatest}>{newOutputCount ? `${newOutputCount} new ${newOutputCount === 1 ? "message" : "messages"} · ` : ""}Jump to latest ↓</Button></div>}
  </>;
}
