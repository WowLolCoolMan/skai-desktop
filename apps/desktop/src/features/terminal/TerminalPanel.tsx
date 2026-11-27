import { useEffect, useState } from "react";
import type { DesktopProject } from "../../../shared/contracts";
import { Button, Card, EmptyState } from "../../components/ui/Primitives";

type TerminalPanelProps = {
  projects: DesktopProject[];
  initialProjectId?: string | null;
  busy: boolean;
  output: string | null;
  exitCode: number | null;
  compact?: boolean;
  onRun: (projectId: string, command: string, cwd: string) => void;
  sessionId?: string | null;
  screen?: string | null;
  onStartSession?: (projectId: string, cwd: string) => Promise<boolean>;
  onWriteSession?: (text: string) => Promise<boolean>;
  onRefreshSession?: () => Promise<boolean>;
  onCloseSession?: () => Promise<boolean>;
  onOpenCoding?: () => void;
  onProjectChange?: (projectId: string) => void;
};

export function TerminalPanel({ projects, initialProjectId, busy, output, exitCode, sessionId, screen, compact = false, onRun, onStartSession, onWriteSession, onRefreshSession, onCloseSession, onOpenCoding, onProjectChange }: TerminalPanelProps) {
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? "");
  const [cwd, setCwd] = useState(".");
  const [command, setCommand] = useState("");
  const [sessionInput, setSessionInput] = useState("");
  const [targetMode, setTargetMode] = useState<"local" | "ssh">("local");
  const [sshHost, setSshHost] = useState("");
  const [sshUsername, setSshUsername] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [loadedProfileKey, setLoadedProfileKey] = useState("");
  const [sshBusy, setSshBusy] = useState(false);
  const [sshOutput, setSshOutput] = useState<string | null>(null);
  const [sshExitCode, setSshExitCode] = useState<number | null>(null);
  const [sshError, setSshError] = useState("");

  const profileKey = projectId ? `skai.ssh.profile.${projectId}` : "";

  useEffect(() => {
    if (initialProjectId) setProjectId(initialProjectId);
    else if (!projectId && projects[0]?.id) setProjectId(projects[0].id);
  }, [initialProjectId, projectId, projects]);

  useEffect(() => {
    if (!profileKey) return;
    setLoadedProfileKey("");
    try {
      const saved = JSON.parse(localStorage.getItem(profileKey) ?? "null") as { host?: string; username?: string; port?: string } | null;
      setSshHost(saved?.host ?? "");
      setSshUsername(saved?.username ?? "");
      setSshPort(saved?.port ?? "22");
    } catch { setSshHost(""); setSshUsername(""); setSshPort("22"); }
    setLoadedProfileKey(profileKey);
  }, [profileKey]);

  useEffect(() => {
    if (profileKey && loadedProfileKey === profileKey) localStorage.setItem(profileKey, JSON.stringify({ host: sshHost, username: sshUsername, port: sshPort }));
  }, [profileKey, loadedProfileKey, sshHost, sshUsername, sshPort]);

  const run = () => {
    if (!command.trim() || !projectId || busy) return;
    if (targetMode === "ssh") { void runSsh(); return; }
    onRun(projectId, command.trim(), cwd.trim() || ".");
  };
  const runSsh = async () => {
    const port = Number(sshPort);
    if (!sshHost.trim() || !sshUsername.trim() || !Number.isInteger(port) || port < 1 || port > 65535 || !command.trim() || sshBusy) return;
    setSshBusy(true); setSshError(""); setSshOutput(null); setSshExitCode(null);
    try {
      const response = await window.skaiAgent.request("project.ssh.run", { host: sshHost.trim(), username: sshUsername.trim(), port, command: command.trim(), timeoutSeconds: 120 });
      if (!response.ok) throw new Error(response.error?.message ?? "Remote SSH command failed.");
      const result = response.result as { output?: string; exitCode?: number; timedOut?: boolean; outputTruncated?: boolean; target?: string };
      setSshOutput(`${result.target ?? `${sshUsername}@${sshHost}`}\n${result.output ?? ""}${result.outputTruncated ? "\n\n(output truncated at 30,000 characters)" : ""}${result.timedOut ? "\n\n(command timed out)" : ""}`);
      setSshExitCode(result.exitCode ?? null);
    } catch (error) { setSshError(error instanceof Error ? error.message : "Remote SSH command failed."); }
    finally { setSshBusy(false); }
  };
  const startSession = () => { if (projectId && onStartSession) void onStartSession(projectId, cwd.trim() || "."); };
  const sendSessionInput = async () => { if (!sessionInput || !sessionId || !onWriteSession) return; if (await onWriteSession(sessionInput + (sessionInput.endsWith("\n") ? "" : "\r\n"))) setSessionInput(""); };

  return <Card className={compact ? "terminal-card terminal-panel" : "terminal-card"}>
    {compact && <div className="terminal-panel-heading">
      <div><p className="section-kicker">PROJECT TERMINAL</p><h3>{compact ? "Run beside your files" : "Run with intent"}</h3></div>
      <span className="terminal-safety-note">Bounded to this project</span>
    </div>}
    {projects.length === 0 ? <EmptyState title="Select a project first" description="Terminal commands are bounded to a project. Open Coding Workspace to connect a folder before running anything." action={onOpenCoding ? <Button variant="secondary" onClick={onOpenCoding}>Open Coding Workspace</Button> : undefined} /> : <>
    <div className="terminal-controls">
      <label>Project<select value={projectId} onChange={(event) => { setProjectId(event.target.value); onProjectChange?.(event.target.value); }}><option value="">Select a project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label>Run on<select value={targetMode} onChange={(event) => { setTargetMode(event.target.value as "local" | "ssh"); setSshOutput(null); setSshError(""); }}><option value="local">Local project</option><option value="ssh">SSH devbox</option></select></label>
      {targetMode === "local" ? <label>Working directory<input value={cwd} onChange={(event) => setCwd(event.target.value)} aria-label="Working directory" /></label> : <>
        <label>Host<input value={sshHost} onChange={(event) => setSshHost(event.target.value)} placeholder="devbox.example.com" aria-label="SSH host" autoComplete="off" /></label>
        <label>Username<input value={sshUsername} onChange={(event) => setSshUsername(event.target.value)} placeholder="developer" aria-label="SSH username" autoComplete="username" /></label>
        <label>Port<input type="number" min={1} max={65535} value={sshPort} onChange={(event) => setSshPort(event.target.value)} aria-label="SSH port" /></label>
      </>}
    </div>
    {targetMode === "ssh" && <p className="terminal-safety-note">Uses system OpenSSH keys or agent. The host must already be trusted in known_hosts. Password prompts and forwarding are disabled.</p>}
    <div className="terminal-command-row">
      <input value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") run(); }} placeholder={targetMode === "ssh" ? "git status" : "git status"} aria-label={targetMode === "ssh" ? "Remote SSH command" : "Terminal command"} />
      <Button variant="primary" disabled={busy || sshBusy || !command.trim() || !projectId || targetMode === "ssh" && (!sshHost.trim() || !sshUsername.trim())} onClick={run}>{busy || sshBusy ? "Running…" : targetMode === "ssh" ? "Run on devbox" : "Run command"}</Button>
    </div>
    {targetMode === "local" && output !== null && <pre tabIndex={0} className={exitCode === 0 ? "terminal-result" : "terminal-result terminal-failure"}><span>exit {exitCode}</span>{output}</pre>}
    {targetMode === "ssh" && sshError && <p className="terminal-error" role="alert">{sshError}</p>}
    {targetMode === "ssh" && sshOutput !== null && <pre tabIndex={0} className={sshExitCode === 0 ? "terminal-result" : "terminal-result terminal-failure"}><span>exit {sshExitCode}</span>{sshOutput}</pre>}</>}
    {projects.length > 0 && onStartSession && <div className="terminal-session"><div className="terminal-session-heading"><div><p className="section-kicker">PERSISTENT PTY</p><h3>{sessionId ? "Session connected" : "Keep a shell open"}</h3></div><span className="terminal-safety-note">{sessionId ? "Local session" : "Not started"}</span></div>{sessionId ? <><pre className="terminal-result terminal-screen" aria-live="polite">{screen || "Starting shell…"}</pre><div className="terminal-command-row"><input value={sessionInput} onChange={(event) => setSessionInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void sendSessionInput(); }} placeholder="Type shell input…" aria-label="Persistent terminal input" /><Button variant="secondary" disabled={!sessionInput} onClick={() => void sendSessionInput()}>Send</Button><Button variant="ghost" onClick={() => void onRefreshSession?.()}>Refresh</Button><Button variant="danger" onClick={() => void onCloseSession?.()}>Close</Button></div></> : <div className="form-footer"><span>Interactive input persists between commands while this workspace is open.</span><Button variant="secondary" disabled={busy || !projectId} onClick={startSession}>Start persistent session</Button></div>}</div>}
  </Card>;
}
