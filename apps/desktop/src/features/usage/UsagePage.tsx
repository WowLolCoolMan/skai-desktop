import { Card, EmptyState, PageHeader, StatusBadge } from "../../components/ui/Primitives";

type UsagePageProps = {
  conversationCount: number;
  projectCount: number;
  taskCount: number;
  memoryCount: number;
  provider: string;
  model: string;
};

export function UsagePage({ conversationCount, projectCount, taskCount, memoryCount, provider, model }: UsagePageProps) {
  const hasWorkspaceActivity = conversationCount + projectCount + taskCount + memoryCount > 0;
  return <div className="feature-page usage-page">
    <PageHeader eyebrow="LOCAL RUNTIME" title="Usage" description="Review the local workspace snapshot and the measurements Skai can verify on this computer." />
    <div className="usage-grid">
      <Card className="usage-summary"><div className="panel-heading"><div><p className="section-kicker">WORKSPACE SNAPSHOT</p><h3>What is active on this computer</h3></div><StatusBadge tone="neutral">No telemetry</StatusBadge></div>{hasWorkspaceActivity ? <div className="usage-list"><span><b>Saved conversations</b>{conversationCount}</span><span><b>Projects</b>{projectCount}</span><span><b>Tasks tracked</b>{taskCount}</span><span><b>Memory notes</b>{memoryCount}</span><span><b>Selected provider</b>{provider || "Not selected"}</span><span><b>Selected model</b>{model || "Not selected"}</span></div> : <EmptyState title="Your local workspace is empty" description="Start a chat, open a project, or save a memory note and this page will reflect that local activity." />}</Card>
      <Card className="usage-boundary"><p className="section-kicker">MEASUREMENTS</p><h3>What Skai can verify</h3><p>Skai reports counts and selections from local state. It does not invent token totals, dollar costs, GPU memory, or latency when the host has not measured them.</p><div className="usage-list"><span><b>Stored locally</b> Workspace counts, operation status, and provider provenance.</span><span><b>Not inferred</b> Token counts, cost, GPU memory, or latency.</span><span><b>Cloud-safe</b> This page sends no telemetry.</span></div></Card>
    </div>
  </div>;
}
