import type { ChatAttachment } from "../../../shared/contracts";
import { Button } from "../../components/ui/Primitives";
import { NavIcon } from "../../components/ui/NavIcon";

function isImage(attachment: ChatAttachment) {
  return attachment.mediaType === "image/png" || attachment.mediaType === "image/jpeg";
}

function attachmentKind(attachment: ChatAttachment) {
  const videoTime = attachment.fileName.match(/\.frame-\d+-at-(\d{2})-(\d{2})\.jpg$/i);
  if (videoTime) return `Video frame · ${videoTime[1]}:${videoTime[2]}`;
  if (attachment.fileName.toLowerCase().endsWith(".audio-transcript.txt")) return "Audio transcript · processed locally";
  if (isImage(attachment)) return "Image";
  if (attachment.fileName.toLowerCase().endsWith(".pdf")) return attachment.ocr ? "PDF · English OCR · processed locally" : "PDF · text extracted locally";
  return attachment.mediaType || "Local file";
}

function attachmentPreview(attachment: ChatAttachment) {
  if (isImage(attachment) && attachment.content) return <img src={`data:${attachment.mediaType};base64,${attachment.content}`} alt="" />;
  return <span className="attachment-file-mark">{attachment.fileName.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"}</span>;
}

function formatFileSize(sizeBytes?: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes === undefined || sizeBytes < 0) return null;
  if (sizeBytes < 1_000) return `${sizeBytes} B`;
  if (sizeBytes < 1_000_000) return `${(sizeBytes / 1_000).toFixed(sizeBytes < 10_000 ? 1 : 0)} KB`;
  return `${(sizeBytes / 1_000_000).toFixed(sizeBytes < 10_000_000 ? 1 : 0)} MB`;
}

export function AttachmentList({ attachments, onRemove, trustLabel }: { attachments: ChatAttachment[]; onRemove?: (index: number) => void; trustLabel?: string }) {
  if (attachments.length === 0) return null;
  return <div className={`attachment-list ${onRemove ? "attachment-list-composer" : "attachment-list-message"}`} aria-label={onRemove ? "Attached files" : "Message attachments"}>
    {attachments.map((attachment, index) => <article className="attachment-card" key={`${attachment.fileName}-${index}`}>
      <div className="attachment-preview" aria-hidden="true">{attachmentPreview(attachment)}</div>
      <div className="attachment-copy"><strong title={attachment.fileName}>{attachment.fileName}</strong><small>{[attachmentKind(attachment), formatFileSize(attachment.sizeBytes)].filter(Boolean).join(" · ")}</small>{trustLabel && <span className="attachment-trust-label">{trustLabel}</span>}</div>
      {onRemove && <Button variant="ghost" type="button" className="attachment-remove" onClick={() => onRemove(index)} aria-label={`Remove ${attachment.fileName}`}><NavIcon name="close" /></Button>}
    </article>)}
  </div>;
}
