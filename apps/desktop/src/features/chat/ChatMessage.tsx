import { useEffect, useId, useState } from "react";
import type { Message, Model } from "../../app/types";
import { Button } from "../../components/ui/Primitives";
import { AttachmentList } from "./AttachmentList";
import { MessageContent } from "./MessageContent";
import { speakNativeResponse, stopNativeSpeech } from "../../services/nativeTts";

type ChatMessageProps = {
  message: Message;
  index: number;
  model: string;
  busy: boolean;
  conversationId: string | null;
  copied: boolean;
  onCopy: (content: string, index: number) => void;
  models: Model[];
  onRetry: (index: number, model?: string) => void;
  onFork: (index: number) => void;
  onEdit: (index: number, content: string) => Promise<boolean>;
};

export function ChatMessage({ message, index, model, models, busy, conversationId, copied, onCopy, onRetry, onFork, onEdit }: ChatMessageProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const contentId = `chat-message-content-${useId().replaceAll(":", "")}`;
  const messageId = `chat-message-${encodeURIComponent(conversationId ?? "new")}-${index}`;
  const hasLongContent = message.content.length > 6000;
  const messageTimestamp = message.createdAtUtc && Number.isFinite(Date.parse(message.createdAtUtc)) ? new Date(message.createdAtUtc) : null;

  useEffect(() => {
    if (!editing) setDraft(message.content);
  }, [editing, message.content]);

  const saveEdit = async () => {
    const content = draft.trim();
    if (!content || saving || busy) return;
    setSaving(true);
    const saved = await onEdit(index, content);
    setSaving(false);
    if (saved) setEditing(false);
  };

  return <article id={messageId} className={`message-bubble chat-message ${message.role}`}>
    <div className="message-meta"><span>{message.role === "user" ? "You" : model}</span>{messageTimestamp && <time className="message-timestamp" dateTime={message.createdAtUtc} title={messageTimestamp.toLocaleString()}>{messageTimestamp.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</time>}<div className="message-actions">
      <Button variant="ghost" onClick={() => onCopy(message.content, index)}>{copied ? "Copied" : "Copy"}</Button>
      <Button variant="ghost" type="button" title="Copy link to this message" onClick={() => { const url = new URL(window.location.href); url.hash = messageId; const copy = navigator.clipboard?.writeText; if (!copy) { window.location.hash = messageId; return; } void copy.call(navigator.clipboard, url.toString()).then(() => { setLinkCopied(true); window.setTimeout(() => setLinkCopied(false), 1500); }).catch(() => { window.location.hash = messageId; }); }}>{linkCopied ? "Link copied" : "Copy link"}</Button>
      {message.role === "user" && <Button variant="ghost" disabled={busy || !conversationId || saving} onClick={() => setEditing(true)}>Edit</Button>}
      {message.role === "assistant" && <><Button variant="ghost" type="button" onClick={() => void speakNativeResponse(message.content, true)} aria-label="Read this reply aloud">Read aloud</Button><Button variant="ghost" type="button" onClick={stopNativeSpeech} aria-label="Stop reading this reply">Stop audio</Button></>}
      {message.role === "assistant" && <Button variant="ghost" disabled={busy} onClick={() => onRetry(index)}>Retry</Button>}
      {message.role === "assistant" && models.length > 0 && <select className="message-retry-model" aria-label="Retry this reply with another model" defaultValue="" disabled={busy} onChange={(event) => { const next = event.target.value; event.currentTarget.value = ""; if (next) onRetry(index, next); }}><option value="">Retry with model…</option>{models.filter((item) => item.model !== model).slice(0, 24).map((item) => <option value={item.model} key={item.model}>{item.displayName || item.model}</option>)}</select>}
      <Button variant="ghost" onClick={() => onFork(index)} disabled={!conversationId}>Fork from here</Button>
    </div></div>
    {editing ? <div className="message-edit-form"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} aria-label="Edit user message" autoFocus /><div className="message-edit-actions"><Button variant="ghost" type="button" disabled={saving} onClick={() => { setDraft(message.content); setEditing(false); }}>Cancel</Button><Button variant="primary" type="button" disabled={saving || !draft.trim()} onClick={() => void saveEdit()}>{saving ? "Regenerating…" : "Save & regenerate"}</Button></div></div> : <><div id={contentId} className={`message-content-region${hasLongContent && !expanded ? " is-collapsed" : ""}`}><MessageContent content={message.content} /></div>{hasLongContent && <Button className="message-content-toggle" variant="ghost" type="button" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded((value) => !value)}>{expanded ? "Collapse response" : "Show full response"}</Button>}</>}
    <AttachmentList attachments={message.attachments ?? []} trustLabel="Conversation content · retained locally" />
  </article>;
}
