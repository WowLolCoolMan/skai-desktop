import { useCallback, useEffect, useState } from "react";
import { Button, StatusBadge } from "../../components/ui/Primitives";
import "./PermissionCenter.css";

type ProjectGrant = { id: string; name: string; folderPaths: string[]; scope: string; duration: string };
type PermissionEvent = { eventId: string; type: string; actor: string; timestamp: string; projectId?: string | null; payload: Record<string, string> };
type SecurityOverview = {
  platform: string;
  sandbox: string;
  projects: ProjectGrant[];
  audit: PermissionEvent[];
  grants: Array<{ area: string; scope: string; duration: string; behavior: string }>;
  limits: { codingActionsPerTask: number; commandsPerTask: number; commandTimeoutSeconds: number; commandCharacters: number; commandOutputCharacters: number; editableFileCharacters: number; diskGrowthBytes: number | null; diskGrowthEnforced: boolean };
  auditStorage: string;
};

const eventLabel = (type: string) => type.replace(/^permission\./, "").replace(/[._]/g, " ");

export function PermissionCenter() {
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await window.skaiAgent?.request("security.overview");
      if (!response?.ok) throw new Error(response?.error?.message ?? "The permission overview is unavailable.");
      setOverview(response.result as SecurityOverview);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The permission overview is unavailable.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const revoke = async (project: ProjectGrant) => {
    if (busyId) return;
    setBusyId(project.id);
    setError("");
    setNotice("");
    try {
      const response = await window.skaiAgent?.request("security.project.revoke", { id: project.id });
      if (!response?.ok) throw new Error(response?.error?.message ?? "Project access could not be revoked.");
      const result = response.result as { revoked: number; stoppedTasks: number; stoppedOperations: number; closedTerminals: number };
      setNotice(`Revoked ${result.revoked} folder ${result.revoked === 1 ? "grant" : "grants"}; stopped ${result.stoppedTasks} active task(s), ${result.stoppedOperations} project operation(s), and closed ${result.closedTerminals} terminal(s).`);
      setRevokeId(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Project access could not be revoked.");
    } finally { setBusyId(null); }
  };

  return <section className="permission-center" aria-label="Permission center">
    <div className="permission-center-heading">
      <div><p className="section-kicker">ACCESS &amp; AUDIT</p><h2>Permission center</h2><p>Review the local access scopes Skai uses, revoke project folder access, and inspect recent permission activity.</p></div>
      <Button variant="secondary" type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</Button>
    </div>
    {error && <p className="permission-center-alert" role="alert">{error}</p>}
    {notice && <p className="permission-center-notice" role="status">{notice}</p>}
    {loading && !overview ? <p className="settings-help" role="status">Loading local permission state…</p> : overview && <>
      <div className="permission-center-grid">
        <article className="permission-center-card permission-center-span">
          <div className="permission-center-card-heading"><div><p className="section-kicker">PROJECT FOLDERS</p><h3>Selected folder access</h3></div><StatusBadge tone="neutral">{overview.projects.reduce((sum, project) => sum + project.folderPaths.length, 0)} roots</StatusBadge></div>
          <p className="permission-center-muted">Selected roots grant project access. File reads can use all selected roots; saves, sandboxed Coding Agent commands, and the integrated terminal use the first root. Revoking removes every root, cancels active tasks and commands, and closes project terminals.</p>
          {overview.projects.length === 0 ? <p className="permission-center-empty">No projects have folder access.</p> : <div className="permission-center-projects">{overview.projects.map((project) => <article className="permission-center-project" key={project.id}>
            <div className="permission-center-project-title"><div><h4>{project.name}</h4><small>{project.folderPaths.length} folder {project.folderPaths.length === 1 ? "root" : "roots"} · {project.duration}</small></div>
              {project.folderPaths.length > 0 && (revokeId === project.id ? <span className="permission-center-confirm"><span>Revoke all access for this project?</span><Button variant="ghost" type="button" onClick={() => setRevokeId(null)}>Cancel</Button><Button variant="primary" type="button" disabled={busyId === project.id} onClick={() => void revoke(project)}>{busyId === project.id ? "Revoking…" : "Revoke access"}</Button></span> : <Button variant="secondary" type="button" onClick={() => setRevokeId(project.id)}>Revoke all</Button>)}
            </div>
            {project.folderPaths.length ? <ul>{project.folderPaths.map((folder) => <li key={folder}><code>{folder}</code></li>)}</ul> : <p className="permission-center-empty">No folder roots are currently granted.</p>}
          </article>)}</div>}
        </article>
        <article className="permission-center-card">
          <p className="section-kicker">EXECUTION BOUNDARY · {overview.platform.toUpperCase()}</p><h3>What is sandboxed</h3><p className="permission-center-muted">{overview.sandbox}</p>
          <div className="permission-center-boundary"><strong>Integrated terminal</strong><span>Runs an interactive shell as your signed-in user. It is not contained by the Coding Agent command sandbox. Project access revocation closes its sessions.</span></div>
          <div className="permission-center-boundary"><strong>Remote SSH commands</strong><span>Execute on the remote host and are outside the local project sandbox.</span></div>
        </article>
        <article className="permission-center-card">
          <p className="section-kicker">ENFORCED LIMITS</p><h3>Per-task bounds</h3>
          <dl className="permission-center-limits"><div><dt>File or command actions</dt><dd>{overview.limits.codingActionsPerTask}</dd></div><div><dt>Commands</dt><dd>{overview.limits.commandsPerTask}</dd></div><div><dt>Command timeout</dt><dd>{overview.limits.commandTimeoutSeconds}s</dd></div><div><dt>Command length</dt><dd>{overview.limits.commandCharacters.toLocaleString()} chars</dd></div><div><dt>Command output</dt><dd>{overview.limits.commandOutputCharacters.toLocaleString()} chars</dd></div><div><dt>Editable file size</dt><dd>{overview.limits.editableFileCharacters.toLocaleString()} chars</dd></div><div><dt>Disk growth quota</dt><dd>{overview.limits.diskGrowthEnforced ? `${overview.limits.diskGrowthBytes?.toLocaleString()} bytes` : "Not enforced"}</dd></div></dl>
        </article>
        <article className="permission-center-card permission-center-span">
          <p className="section-kicker">CURRENT GRANT RULES</p><h3>Scopes and duration</h3><div className="permission-center-grants">{overview.grants.map((grant) => <div className="permission-center-grant" key={grant.area}><div><strong>{grant.area}</strong><StatusBadge tone="neutral">{grant.duration}</StatusBadge></div><p>{grant.scope}</p><small>{grant.behavior}</small></div>)}</div>
          <p className="permission-center-muted">Skai currently has no reusable global tool grants and no unattended high-risk tool mode. Per-call MCP approval cannot be inherited across calls.</p>
        </article>
        <article className="permission-center-card permission-center-span">
          <p className="section-kicker">UNTRUSTED CONTENT BOUNDARY</p><h3>Prompts do not grant access</h3>
          <p className="permission-center-muted">Text from files, webpages, model output, MCP metadata, and imported transcripts is treated as untrusted content. It cannot change these grants, authorize a tool, widen a project folder, or disable the sandbox.</p>
          <div className="permission-center-boundary"><strong>Before a risky action</strong><span>Skai shows the target resource, scope, duration, and review step. Keep the request paused when the source is unexpected or asks for secrets, credentials, or policy changes.</span></div>
          <div className="permission-center-boundary"><strong>Recovery</strong><span>Revoke project access to cancel active project tasks and terminals, then inspect the local audit history for the action metadata.</span></div>
        </article>
        <article className="permission-center-card permission-center-span">
          <div className="permission-center-card-heading"><div><p className="section-kicker">LOCAL HISTORY</p><h3>Permission audit</h3></div><StatusBadge tone="neutral">{overview.audit.length} recent</StatusBadge></div>
          <p className="permission-center-muted">{overview.auditStorage}</p>
          {overview.audit.length === 0 ? <p className="permission-center-empty">No permission events recorded yet.</p> : <ol className="permission-center-audit">{overview.audit.map((event) => <li key={event.eventId}><div><strong>{eventLabel(event.type)}</strong><time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleString()}</time></div><small>{event.payload.projectName ?? event.projectId ?? "Workspace"}{event.payload.resource ? ` · ${event.payload.resource}` : ""}{event.payload.toolName ? ` · ${event.payload.toolName}` : ""}{event.payload.scope ? ` · ${event.payload.scope}` : ""}</small></li>)}</ol>}
        </article>
      </div>
    </>}
  </section>;
}
