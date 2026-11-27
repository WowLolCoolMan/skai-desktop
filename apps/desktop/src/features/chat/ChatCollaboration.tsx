import { useEffect, useRef, useState } from "react";
import type { Message } from "../../app/types";
import { Button } from "../../components/ui/Primitives";
import { ModalDialog } from "../../components/ui/ModalDialog";

type ShareRecord = {
  schema: "skai-local-share/v1";
  shareId: string;
  conversationId: string;
  owner: string;
  title: string;
  createdAt: string;
  expiresAt: string;
  includesUserMessages: boolean;
  includesAssistantMessages: boolean;
  participants: string[];
  revokedAt?: string;
};
type Suggestion = { schema: "skai-session-suggestion/v1"; shareId: string; conversationId: string; createdAt: string; participant: string; suggestion: string };
type SuggestionPreview = Suggestion & { fileName: string };
type Props = { conversationId: string | null; title: string; messages: Message[]; onAddToDraft: (text: string) => void; };
const recordKey = (id: string) => `skai.collaboration.local.${id}`;
const maxSuggestionBytes = 64 * 1024;
const isShareActive = (record: ShareRecord | null) => Boolean(record && !record.revokedAt && Date.now() < Date.parse(record.expiresAt));
function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  // Share IDs are file-routing labels, not credentials.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function readRecord(conversationId: string | null): ShareRecord | null {
  if (!conversationId) return null;
  try {
    const value = JSON.parse(localStorage.getItem(recordKey(conversationId)) ?? "null") as ShareRecord | null;
    if (!value || value.schema !== "skai-local-share/v1" || value.conversationId !== conversationId || typeof value.shareId !== "string" || value.shareId.length > 128 || typeof value.owner !== "string" || value.owner.length > 64 || typeof value.title !== "string" || value.title.length > 200 || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt)) || !Array.isArray(value.participants) || value.participants.length > 50 || value.participants.some((participant) => typeof participant !== "string" || participant.length > 64)) return null;
    return value;
  } catch { return null; }
}

function download(name: string, contents: string, mediaType: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mediaType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function htmlEscape(value: string) {
  return value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[character]!);
}

function buildSnapshot(record: ShareRecord, transcript: Message[]) {
  const rows = transcript.map((message) => `<article class="message ${message.role}"><small>${message.role === "user" ? "You" : "Skai"}</small><p>${htmlEscape(message.content)}</p></article>`).join("\n");
  const messages = transcript.map(({ role, content }) => ({ role, content }));
  const archive = JSON.stringify([{ Id: randomId(), Title: `Fork of ${record.title}`.slice(0, 200), UpdatedAt: new Date().toISOString(), Messages: messages, ForkedFrom: record.conversationId }]);
  const snapshotData = JSON.stringify({ owner: record.owner, title: record.title, expiresAt: record.expiresAt, shareId: record.shareId, conversationId: record.conversationId }).replace(/</g, "\\u003c");
  const archiveData = JSON.stringify(archive).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${htmlEscape(record.title)} · Skai read-only snapshot</title>
  <style>:root{color-scheme:dark;font:15px/1.6 system-ui,sans-serif;background:#171719;color:#eee}body{max-width:900px;margin:40px auto;padding:0 20px}.head,.message,.panel{border:1px solid #37373c;border-radius:14px;background:#202023;padding:18px;margin:12px 0}.head p,.muted{color:#a8a8b0}.message{max-width:82%}.message.user{margin-left:auto;background:#28282d}.message p{white-space:pre-wrap;overflow-wrap:anywhere}.controls{display:grid;gap:10px}.controls input,.controls textarea{box-sizing:border-box;width:100%;padding:10px;border:1px solid #4a4a52;border-radius:8px;color:inherit;background:#171719}.controls textarea{min-height:110px}.controls button{padding:9px 14px;border:1px solid #555;border-radius:9px;color:inherit;background:#303036;cursor:pointer}.controls button:hover{background:#3a3a42}.warning{border-left:3px solid #df984b;padding-left:12px}.closed{display:none}</style>
  <main id="page" class="closed"><header class="head"><strong id="title"></strong><p id="meta"></p><p class="muted">Read-only, offline snapshot. It contains only the selected message text. Attachments, tools, files, project context, and machine access are excluded. This copy can’t be remotely revoked or erased after download.</p></header><section id="transcript">${rows}</section><section class="panel controls"><h2>Send a suggestion to the owner</h2><p class="muted">Suggestions are saved to a file for the owner to review. They never run tools or send messages automatically.</p><label>Your display name<input id="participant" maxlength="64" placeholder="Name"></label><label>Suggestion<textarea id="suggestion" maxlength="4000" placeholder="Share an idea or next step…"></textarea></label><button id="export" type="button">Download suggestion for owner</button><button id="fork" type="button">Download a private fork for Skai</button><button id="leave" type="button">Leave this snapshot</button><p class="muted warning">Leaving clears this page in this tab. It does not affect the owner’s conversation or other copies.</p></section></main><p id="expired" class="head closed">This snapshot has expired. Close this tab or keep only your own private copy.</p>
  <script>const share=${snapshotData};const forkArchive=${archiveData};document.getElementById('title').textContent=share.title;document.getElementById('meta').textContent='Shared by '+share.owner+' · Read-only snapshot · Expires '+new Date(share.expiresAt).toLocaleString();if(Date.now()>Date.parse(share.expiresAt)){document.getElementById('expired').classList.remove('closed')}else{document.getElementById('page').classList.remove('closed')}function save(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}document.getElementById('export').onclick=()=>{const participant=document.getElementById('participant').value.trim();const suggestion=document.getElementById('suggestion').value.trim();if(!participant||!suggestion){alert('Add your display name and a suggestion first.');return}save('skai-suggestion-'+share.shareId.slice(0,8)+'.json',JSON.stringify({schema:'skai-session-suggestion/v1',shareId:share.shareId,conversationId:share.conversationId,createdAt:new Date().toISOString(),participant,suggestion},null,2),'application/json')};document.getElementById('fork').onclick=()=>save('skai-private-fork.json',forkArchive,'application/json');document.getElementById('leave').onclick=()=>{document.getElementById('page').replaceChildren(Object.assign(document.createElement('p'),{textContent:'You left this snapshot. Your local copy is closed; the owner’s data was not changed.'}))};</script></html>`;
}

export function ChatCollaboration({ conversationId, title, messages, onAddToDraft }: Props) {
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState("You");
  const [expiryDays, setExpiryDays] = useState("7");
  const [includeUser, setIncludeUser] = useState(true);
  const [includeAssistant, setIncludeAssistant] = useState(true);
  const [record, setRecord] = useState(() => readRecord(conversationId));
  const [preview, setPreview] = useState<SuggestionPreview | null>(null);
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setRecord(readRecord(conversationId)); setPreview(null); setNotice(""); }, [conversationId]);
  const transcript = messages.filter((message) => (message.role === "user" ? includeUser : includeAssistant) && message.content.trim()).map(({ role, content }) => ({ role, content }));
  const isActive = isShareActive(record);

  const createSnapshot = () => {
    if (!conversationId || !transcript.length) return;
    const transcriptCharacters = transcript.reduce((sum, message) => sum + message.content.length, 0);
    if (transcriptCharacters > 5_000_000) { setNotice("This conversation exceeds the 5 MB snapshot limit. Remove messages before sharing it."); return; }
    const now = new Date();
    const next: ShareRecord = { schema: "skai-local-share/v1", shareId: randomId(), conversationId, owner: owner.trim().slice(0, 64) || "Conversation owner", title: title.slice(0, 200), createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + Number(expiryDays) * 86400000).toISOString(), includesUserMessages: includeUser, includesAssistantMessages: includeAssistant, participants: [] };
    try {
      localStorage.setItem(recordKey(conversationId), JSON.stringify(next));
      setRecord(next);
      download(`skai-read-only-${next.shareId.slice(0, 8)}.html`, buildSnapshot(next, transcript), "text/html;charset=utf-8");
      setNotice("Read-only snapshot downloaded. Transfer the file yourself; it is not uploaded or sent by Skai.");
    } catch { setNotice("The local sharing record could not be saved. Check this device’s available storage and try again."); }
  };

  const revoke = () => {
    if (!conversationId || !record) return;
    const next = { ...record, revokedAt: new Date().toISOString() };
    try { localStorage.setItem(recordKey(conversationId), JSON.stringify(next)); setRecord(next); setNotice("Suggestion imports for this share are now rejected on this device. Previously downloaded snapshots cannot be remotely erased."); }
    catch { setNotice("The local sharing record could not be updated."); }
  };

  const importSuggestion = async (file?: File) => {
    if (!file || file.size > maxSuggestionBytes || !record || !isShareActive(record)) { setNotice("This share is inactive or the suggestion file is too large."); return; }
    try {
      const raw: unknown = JSON.parse(await file.text());
      if (!raw || typeof raw !== "object") throw new Error("Invalid suggestion file.");
      const value = raw as Partial<Suggestion>;
      const created = Date.parse(value.createdAt ?? "");
      if (value.schema !== "skai-session-suggestion/v1" || value.shareId !== record.shareId || value.conversationId !== record.conversationId || !Number.isFinite(created) || created > Date.now() + 5 * 60_000 || created < Date.parse(record.createdAt) || created > Date.parse(record.expiresAt) || typeof value.participant !== "string" || !value.participant.trim() || value.participant.length > 64 || [...value.participant].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || typeof value.suggestion !== "string" || !value.suggestion.trim() || value.suggestion.length > 4000) throw new Error("This suggestion does not match the active share or has expired.");
      setPreview({ schema: value.schema!, shareId: value.shareId!, conversationId: value.conversationId!, createdAt: value.createdAt!, participant: value.participant.trim(), suggestion: value.suggestion.trim(), fileName: file.name });
      setNotice("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Suggestion could not be read."); }
  };

  const acceptSuggestion = () => {
    if (!preview || !record || !conversationId || !isShareActive(record)) { setNotice("This share expired before the suggestion could be accepted."); return; }
    const participant = preview.participant;
    const next = { ...record, participants: [...new Set([...record.participants, participant])].slice(0, 50) };
    try {
      localStorage.setItem(recordKey(conversationId), JSON.stringify(next));
      setRecord(next);
      onAddToDraft(`Suggestion from ${participant}:\n${preview.suggestion}`);
      setPreview(null);
      setNotice("Suggestion added to your composer draft. Review it before sending.");
    } catch { setNotice("The participant record could not be saved, so the suggestion was not added."); }
  };

  return <>
    <Button variant={isActive ? "secondary" : "ghost"} type="button" disabled={!conversationId || messages.length === 0} onClick={() => { setRecord(readRecord(conversationId)); setNotice(""); setOpen(true); }}>{isActive ? "Shared snapshot" : "Share"}</Button>
    {isActive && record && <span className="chat-share-header-status" title={`Owner: ${record.owner} · Access: read-only snapshot · Participants: ${record.participants.length ? record.participants.join(", ") : "none yet"} · Expires: ${new Date(record.expiresAt).toLocaleString()}`}>Read-only · {record.participants.length} participants · expires {new Date(record.expiresAt).toLocaleDateString()}</span>}
    <ModalDialog open={open} onClose={() => setOpen(false)} titleId="chat-local-share-title" className="ui-dialog chat-local-share-dialog">
      <div className="dialog-heading"><div><p className="section-kicker">OFFLINE · LOCAL FIRST</p><h3 id="chat-local-share-title">Share this conversation</h3><p>Create a portable, read-only snapshot. Skai does not start a network host or send this file anywhere.</p></div><button type="button" onClick={() => setOpen(false)} aria-label="Close sharing dialog">×</button></div>
      <div className="chat-share-boundary"><strong>Included</strong><span>{includeUser ? "Your messages" : "No user messages"} · {includeAssistant ? "Assistant replies" : "No assistant replies"} · text only</span><strong>Excluded</strong><span>Attachments, tools, system prompts, project files, machine control, and model/provider settings.</span></div>
      {record && <section className="chat-share-status"><div><span>Owner</span><strong>{record.owner}</strong></div><div><span>Access</span><strong>Read-only snapshot</strong></div><div><span>Expires</span><strong>{new Date(record.expiresAt).toLocaleString()}</strong></div><div><span>Participants</span><strong>{record.participants.length ? record.participants.join(", ") : "No suggestions received"}</strong></div><small>Owner data remains on this device. Downloaded copies cannot be remotely changed or erased.</small></section>}
      {!isActive && <div className="chat-share-form"><label>Owner display name<input value={owner} maxLength={64} onChange={(event) => setOwner(event.target.value)} /></label><label>Snapshot expires after<select value={expiryDays} onChange={(event) => setExpiryDays(event.target.value)}><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option></select></label><fieldset><legend>Message text to include</legend><label><input type="checkbox" checked={includeUser} onChange={(event) => setIncludeUser(event.target.checked)} /> Your messages</label><label><input type="checkbox" checked={includeAssistant} onChange={(event) => setIncludeAssistant(event.target.checked)} /> Assistant replies</label></fieldset><p className="settings-help">This expiry is checked by the snapshot and by Skai when importing suggestions. It cannot erase a copy already saved by someone else.</p><Button variant="primary" type="button" disabled={!conversationId || !transcript.length || (!includeUser && !includeAssistant)} onClick={createSnapshot}>Download read-only snapshot</Button></div>}
      {record && <div className="chat-share-actions"><Button variant="secondary" type="button" disabled={!isActive} onClick={() => inputRef.current?.click()}>Review suggestion file</Button><input ref={inputRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => { void importSuggestion(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /><Button variant="ghost" type="button" disabled={!isActive} onClick={() => { if (record && conversationId) download(`skai-read-only-${record.shareId.slice(0, 8)}.html`, buildSnapshot(record, messages.filter((message) => (message.role === "user" ? record.includesUserMessages : record.includesAssistantMessages) && message.content.trim()).map(({ role, content }) => ({ role, content }))), "text/html;charset=utf-8"); }}>Download snapshot again</Button>{isActive && <Button variant="ghost" type="button" onClick={revoke}>Close sharing</Button>}</div>}
      <div className="chat-share-disabled"><strong>Live LAN, QR pairing, and remote tool actions are off</strong><span>Skai has no trusted-device identity or encrypted relay configured. Suggestions are exchanged as files and always require your review.</span></div>
      {notice && <p className="chat-share-notice" role="status">{notice}</p>}
      <div className="dialog-actions"><Button variant="ghost" type="button" onClick={() => setOpen(false)}>Done</Button></div>
    </ModalDialog>
    <ModalDialog open={Boolean(preview)} onClose={() => setPreview(null)} titleId="chat-suggestion-preview-title" className="ui-dialog chat-suggestion-preview-dialog"><div className="dialog-heading"><div><p className="section-kicker">REVIEW · NOTHING SENT</p><h3 id="chat-suggestion-preview-title">Review collaborator suggestion</h3><p>Read this suggestion before adding it to your draft.</p></div><button type="button" onClick={() => setPreview(null)} aria-label="Close suggestion preview">×</button></div>{preview && <div className="chat-suggestion-preview"><strong>{preview.participant}</strong><small>{preview.fileName} · {new Date(preview.createdAt).toLocaleString()}</small><p>{preview.suggestion}</p></div>}<div className="dialog-actions"><Button variant="ghost" type="button" onClick={() => setPreview(null)}>Discard</Button><Button variant="primary" type="button" disabled={!isActive} onClick={acceptSuggestion}>Add to composer draft</Button></div></ModalDialog>
  </>;
}
