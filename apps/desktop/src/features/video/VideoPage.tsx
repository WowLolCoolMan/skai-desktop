import { NavIcon } from "../../components/ui/NavIcon";
import { PageHeader, StatusBadge } from "../../components/ui/Primitives";

const plannedTools = [
  { icon: "sparkle" as const, title: "Generate a clip", detail: "Create short video from a prompt or image." },
  { icon: "image" as const, title: "Edit a timeline", detail: "Arrange clips, audio, and titles in one view." },
  { icon: "arrow-up-right" as const, title: "Export your work", detail: "Choose a format and save a finished video locally." },
];

export function VideoPage() {
  return <div className="feature-page video-page">
    <PageHeader eyebrow="CREATIVE TOOLS" title="Video" description="A future workspace for local video creation and editing." actions={<StatusBadge tone="warning">Planned</StatusBadge>} />
    <section className="video-preview" aria-label="Planned video workspace preview">
      <div className="video-preview-toolbar"><span><NavIcon name="video" /> Untitled video</span><span className="video-preview-status">Preview · not available yet</span></div>
      <div className="video-preview-stage"><div className="video-preview-frame"><NavIcon name="video" /><span>Video workspace preview</span></div><aside><p className="section-kicker">WORKSPACE PREVIEW</p><h2>One place for clips and edits</h2><p>Skai Desktop’s video tools are planned. This preview shows the direction; it does not generate, edit, or export video.</p></aside></div>
      <div className="video-preview-timeline" aria-hidden="true"><span>Timeline</span><div><i /><i /><i /></div></div>
    </section>
    <section className="video-planned-tools" aria-label="Planned video capabilities">{plannedTools.map((tool) => <article key={tool.title}><span className="video-planned-icon"><NavIcon name={tool.icon} /></span><div><h3>{tool.title}</h3><p>{tool.detail}</p></div><span className="video-planned-label">Planned</span></article>)}</section>
  </div>;
}
