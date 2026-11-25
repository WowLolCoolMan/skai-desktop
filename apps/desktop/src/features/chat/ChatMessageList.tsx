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
  const messageListRef = useRef<HTMLDivElement>(null);
  const previousConversationIdRef = useRef(conversationId);
  const restoreScrollPendingRef = useRef(false);
  const stickToLatestRef = useRef(true);

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
  }, [conversationId, messages.length, busy]);

  const jumpToLatest = () => {
    stickToLatestRef.current = true;
    setShowJumpToLatest(false);
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: "smooth" });
  };

  return <>
    <div className="message-list" ref={messageListRef}>{messages.map((message, index) => <ChatMessage key={index} message={message} index={index} model={model} busy={busy} conversationId={conversationId} copied={copiedMessage === index} onCopy={onCopy} onRetry={onRetry} onFork={onFork} onEdit={onEdit} />)}{busy ? <article className="message-bubble chat-message assistant"><p className="typing">Thinking…</p></article> : null}</div>
    {showJumpToLatest && <div className="chat-latest-action"><Button variant="secondary" type="button" onClick={jumpToLatest}>Jump to latest ↓</Button></div>}
  </>;
}
