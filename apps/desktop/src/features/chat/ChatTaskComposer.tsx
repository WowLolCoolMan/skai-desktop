import { useEffect, useState, type FormEvent } from "react";
import type { TaskEnvironment } from "../../../shared/contracts";
import { Button } from "../../components/ui/Primitives";
import { EnvironmentPicker } from "../../components/ui/EnvironmentPicker";
import "./ChatTaskComposer.css";

const PREFILL_KEY = "skai.chat.taskPrefill";

type TaskPrefill = { title: string; instruction: string; environment: TaskEnvironment };
type TaskTemplate = { id: string; label: string; title: string; instruction: string; acceptance: string; environment: TaskEnvironment };

const TASK_TEMPLATES: TaskTemplate[] = [
  { id: "bug-fix", label: "Bug fix", title: "Fix a reported bug", instruction: "Reproduce the reported issue, identify the smallest safe fix, implement it, and verify the affected workflow without changing unrelated behavior.", acceptance: "The issue is reproducible before the change, the focused fix is implemented, and a regression check passes.", environment: "local" },
  { id: "feature", label: "Feature", title: "Implement a focused feature", instruction: "Design and implement the requested feature in small, reviewable steps. Preserve existing behavior outside the feature and document important decisions.", acceptance: "The feature works through its primary UI path, handles its failure state, and has focused verification evidence.", environment: "worktree" },
  { id: "refactor", label: "Refactor", title: "Refactor without behavior change", instruction: "Map the current behavior, make the smallest structural improvement, and keep public behavior stable while removing duplication or unnecessary complexity.", acceptance: "The refactor preserves existing behavior and the relevant typecheck, build, or test checks pass.", environment: "worktree" },
  { id: "dependency", label: "Dependency update", title: "Update a dependency safely", instruction: "Inspect the current dependency usage and release notes, update only the requested dependency, and check for API, lockfile, and runtime compatibility.", acceptance: "The dependency is updated with a reviewable lockfile change and compatibility checks pass.", environment: "worktree" },
  { id: "documentation", label: "Documentation", title: "Improve project documentation", instruction: "Review the existing documentation for stale or missing guidance, then make a focused update with accurate commands, boundaries, and examples.", acceptance: "The documentation matches the current workflow and links or commands are internally consistent.", environment: "local" },
  { id: "security", label: "Security review", title: "Review a security boundary", instruction: "Inspect the requested code path for trust boundaries, unsafe inputs, secrets, permissions, and failure handling. Report concrete findings before proposing changes.", acceptance: "Findings include severity, evidence, affected files, and a safe remediation or an explicit no-findings note.", environment: "local" },
];

const SCOPE_OPTIONS = [
  ["workspace", "Workspace files", "Read or edit files in the selected project"],
  ["git", "Git changes", "Inspect or create a reviewable branch/diff"],
  ["runtime", "Local runtime", "Use the configured local model or service"],
  ["ui", "UI workflow", "Exercise the desktop interface and visual states"],
  ["external", "External access", "Only when a specific approved integration is needed"],
] as const;

function consumeTaskPrefill(): TaskPrefill | null {
  try {
    const raw = localStorage.getItem(PREFILL_KEY);
    if (!raw) return null;
    localStorage.removeItem(PREFILL_KEY);
    const value = JSON.parse(raw) as Partial<TaskPrefill>;
    if (typeof value.title !== "string" || typeof value.instruction !== "string") return null;
    return {
      title: value.title.trim().slice(0, 200),
      instruction: value.instruction.trim().slice(0, 6000),
      environment: value.environment === "worktree" ? "worktree" : "local",
    };
  } catch {
    try { localStorage.removeItem(PREFILL_KEY); } catch { /* Storage may be disabled. */ }
    return null;
  }
}

export function ChatTaskComposer({ busy, onPlanTask, initialOpen = false, expanded, showToggle = true, onExpand, worktreeAvailable = false }: {
  busy: boolean;
  onPlanTask: (title: string, instruction: string, environment: TaskEnvironment, requiresApproval: boolean, gitHubIssueUrl?: string, acceptanceCriteria?: string) => Promise<boolean>;
  initialOpen?: boolean;
  expanded?: boolean;
  showToggle?: boolean;
  onExpand?: () => void;
  worktreeAvailable?: boolean;
}) {
  const [localOpen, setLocalOpen] = useState(initialOpen);
  const open = expanded ?? localOpen;
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [environment, setEnvironment] = useState<TaskEnvironment>("local");
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [gitHubIssueUrl, setGitHubIssueUrl] = useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
  const [scope, setScope] = useState<string[]>(["workspace"]);
  const [templateId, setTemplateId] = useState("");
  const [status, setStatus] = useState("");

  const applyTemplate = (value: string) => {
    setTemplateId(value);
    const template = TASK_TEMPLATES.find((item) => item.id === value);
    if (!template) return;
    setTitle(template.title);
    setInstruction(template.instruction);
    setAcceptanceCriteria(template.acceptance);
    setEnvironment(template.environment === "worktree" && !worktreeAvailable ? "local" : template.environment);
    setStatus(`${template.label} template loaded. Adjust the scope before saving.`);
  };

  useEffect(() => {
    const applyPrefill = () => {
      const prefill = consumeTaskPrefill();
      if (!prefill) return;
      setTitle(prefill.title);
      setInstruction(prefill.instruction);
      setEnvironment(prefill.environment === "worktree" && !worktreeAvailable ? "local" : prefill.environment);
      if (expanded === undefined) setLocalOpen(true);
      else onExpand?.();
      setStatus("");
    };
    const onStorage = (event: StorageEvent) => { if (event.key === PREFILL_KEY) applyPrefill(); };
    applyPrefill();
    window.addEventListener("hashchange", applyPrefill);
    window.addEventListener("skai:task-prefill", applyPrefill);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("hashchange", applyPrefill);
      window.removeEventListener("skai:task-prefill", applyPrefill);
      window.removeEventListener("storage", onStorage);
    };
  }, [onExpand, expanded, worktreeAvailable]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const safeTitle = title.trim().slice(0, 200);
    const safeInstruction = instruction.trim().slice(0, 5_600);
    if (!safeTitle || !safeInstruction || busy) return;
    const safeIssueUrl = gitHubIssueUrl.trim();
    if (safeIssueUrl && !/^https:\/\/github\.com\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}\/issues\/[1-9][0-9]{0,15}\/?$/i.test(safeIssueUrl)) {
      setStatus("Use a GitHub issue link like https://github.com/owner/repository/issues/123.");
      return;
    }
    const scopeText = scope.length ? `\n\nExecution scope: ${scope.map((id) => SCOPE_OPTIONS.find(([option]) => option === id)?.[1] ?? id).join(", ")}.` : "\n\nExecution scope: No extra scope selected; ask before expanding access.";
    const saved = await onPlanTask(safeTitle, `${safeInstruction}${scopeText}`.slice(0, 6_000), environment, requiresApproval, safeIssueUrl, acceptanceCriteria.trim().slice(0, 4_000));
    setStatus(saved ? "Plan saved to this conversation for review." : "The plan could not be saved. Check the status message and retry.");
  };

  return <section className={`task-composer chat-task-composer${open ? " is-open" : ""}`} aria-label="Plan a local task">
    <div className="task-composer-heading">
      <div><p className="section-kicker">LOCAL TASK</p><h3>Turn this into a task</h3><p>Save a reviewable plan in this conversation. Planning does not start execution.</p></div>
      {showToggle && <Button variant="secondary" type="button" aria-expanded={open} aria-controls="chat-task-composer-fields" onClick={() => setLocalOpen((value) => !value)}>{open ? "Hide planner" : "Plan a task"}</Button>}
    </div>
    {open && <form id="chat-task-composer-fields" onSubmit={(event) => void submit(event)}>
      <div className="task-composer-fields"><label>Start from a template <span className="settings-help">A bounded starting brief; edit every field before saving.</span><select value={templateId} onChange={(event) => applyTemplate(event.target.value)}><option value="">Custom task</option>{TASK_TEMPLATES.map((template) => <option value={template.id} key={template.id}>{template.label}</option>)}</select></label><label>Task title<input value={title} maxLength={200} onChange={(event) => { setTemplateId(""); setTitle(event.target.value); }} required /></label><label>Task brief<textarea value={instruction} maxLength={6000} rows={3} onChange={(event) => { setTemplateId(""); setInstruction(event.target.value); }} required /></label><label>GitHub issue link <span className="settings-help">Optional · links the plan to its issue</span><input value={gitHubIssueUrl} maxLength={512} type="url" placeholder="https://github.com/owner/repository/issues/123" onChange={(event) => setGitHubIssueUrl(event.target.value)} /></label><label>Acceptance criteria <span className="settings-help">Optional · included in the agent task context</span><textarea value={acceptanceCriteria} maxLength={4000} rows={2} placeholder="List the checks or outcomes this task must satisfy…" onChange={(event) => setAcceptanceCriteria(event.target.value)} /></label></div>
      <fieldset className="task-scope-picker"><legend>Task scope <span className="settings-help">The selected boundary is included in the saved plan.</span></legend><div className="task-scope-options">{SCOPE_OPTIONS.map(([id, label, detail]) => <label className={`task-scope-option${scope.includes(id) ? " is-selected" : ""}`} key={id}><input type="checkbox" checked={scope.includes(id)} onChange={() => setScope((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} /><span><strong>{label}</strong><small>{detail}</small></span></label>)}</div><p className="task-scope-summary" role="status">{scope.length ? `Plan boundary: ${scope.map((id) => SCOPE_OPTIONS.find(([option]) => option === id)?.[1] ?? id).join(" · ")}` : "No extra scope selected; the agent must ask before expanding access."}</p></fieldset>
      <aside className="task-plan-preview" aria-label="Saved plan preview"><div><p className="section-kicker">PLAN PREVIEW</p><strong>{title.trim() || "Untitled task"}</strong></div><dl><div><dt>Environment</dt><dd>{environment === "worktree" ? "Isolated worktree" : "Current workspace"}</dd></div><div><dt>Approval</dt><dd>{requiresApproval ? "Required before run" : "Not required"}</dd></div><div><dt>Scope</dt><dd>{scope.length ? scope.map((id) => SCOPE_OPTIONS.find(([option]) => option === id)?.[1] ?? id).join(" · ") : "Ask before expanding"}</dd></div><div><dt>Acceptance</dt><dd>{acceptanceCriteria.trim() || "No acceptance criteria yet"}</dd></div></dl></aside>
      <EnvironmentPicker value={environment} worktreeAvailable={worktreeAvailable} onChange={setEnvironment} />
      <label className="task-require-approval"><input type="checkbox" checked={requiresApproval} onChange={(event) => setRequiresApproval(event.target.checked)} /> Require approval before starting the local agent run</label>
      <div className="task-composer-footer"><span role="status">{status || "Review the brief before saving the plan."}</span><Button variant="primary" type="submit" disabled={busy || !title.trim() || !instruction.trim()}>{busy ? "Saving plan…" : "Save plan in thread"}</Button></div>
    </form>}
  </section>;
}
