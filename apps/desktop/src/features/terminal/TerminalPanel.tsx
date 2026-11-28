import { useEffect, useState } from "react";
import type { DesktopProject } from "../../../shared/contracts";
import { Button, Card, EmptyState } from "../../components/ui/Primitives";

function TerminalOutput({ text, exitCode, label, className = "" }: { text: string; exitCode: number | null; label: string; className?: string }) {
  const [hidden, setHidden] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { setHidden(false); setMessage(""); }, [text]);
  const copy = async () => {
    let copied = false;
    try { if (navigator.clipboard) { await navigator.clipboard.writeText(text); copied = true; } } catch { /* Use the protected desktop clipboard bridge below. */ }
    if (!copied) { try { copied = await window.skaiAgent?.clipboard?.writeText(text) ?? false; } catch { /* Clipboard access can be unavailable. */ } }
    setMessage(copied ? "Copied" : "Copy unavailable");
  };
  const exportOutput = () => {
    const maxCharacters = 100_000;
    const truncated = text.length > maxCharacters;
    const contents = `${text.slice(0, maxCharacters)}${truncated ? "\n\n[Export limited to the first 100,000 characters.]" : ""}`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([contents], { type: "text/plain;charset=utf-8" }));
    link.download = `skai-terminal-output-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
    setMessage(truncated ? "Exported (first 100,000 characters)" : "Exported");
  };
  return <section className="terminal-output-block" aria-label={label}>
    <div className="terminal-output-actions"><span>{exitCode === null ? label : `exit ${exitCode}`}</span><div><Button variant="ghost" onClick={() => void copy()}>Copy</Button><Button variant="ghost" onClick={exportOutput}>Export</Button><Button variant="ghost" onClick={() => { setHidden((value) => !value); setMessage(""); }}>{hidden ? "Show" : "Clear"}</Button>{message && <small role="status">{message}</small>}</div></div>
    {!hidden && <pre tabIndex={0} className={exitCode === 0 ? `terminal-result ${className}`.trim() : `terminal-result terminal-failure ${className}`.trim()}>{text}</pre>}
  </section>;
}

type TerminalProfile = { id: string; name: string; command: string; cwd: string; targetMode: "local" | "ssh"; host: string; username: string; port: string };
type SshPreflight = { status: "ready" | "blocked"; message: string; checkedAt: string };

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
  const [sshPreflight, setSshPreflight] = useState<SshPreflight | null>(null);
  const [sshPreflightBusy, setSshPreflightBusy] = useState(false);
  const [profiles, setProfiles] = useState<TerminalProfile[]>([]);
  const [profileName, setProfileName] = useState("");
  const [profileSelection, setProfileSelection] = useState("");

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
      setSshPreflight(null);
    } catch { setSshHost(""); setSshUsername(""); setSshPort("22"); setSshPreflight(null); }
    setLoadedProfileKey(profileKey);
  }, [profileKey]);

  useEffect(() => {
    if (profileKey && loadedProfileKey === profileKey) localStorage.setItem(profileKey, JSON.stringify({ host: sshHost, username: sshUsername, port: sshPort }));
  }, [profileKey, loadedProfileKey, sshHost, sshUsername, sshPort]);

  useEffect(() => {
    if (!projectId) { setProfiles([]); setProfileSelection(""); return; }
    try {
      const parsed = JSON.parse(localStorage.getItem(`skai.terminal.profiles.${projectId}`) ?? "[]") as unknown;
      setProfiles(Array.isArray(parsed) ? parsed.filter((item): item is TerminalProfile => Boolean(item && typeof item === "object" && typeof (item as TerminalProfile).id === "string" && typeof (item as TerminalProfile).name === "string" && typeof (item as TerminalProfile).command === "string" && typeof (item as TerminalProfile).cwd === "string")).slice(0, 8) : []);
      setProfileSelection("");
    } catch { setProfiles([]); }
  }, [projectId]);

  const saveProfile = () => {
    const name = profileName.trim();
    if (!projectId || !name || !command.trim()) return;
    const profile: TerminalProfile = { id: typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}`, name: name.slice(0, 80), command: command.trim(), cwd: cwd.trim() || ".", targetMode, host: sshHost.trim(), username: sshUsername.trim(), port: sshPort };
    const next = [profile, ...profiles.filter((item) => item.name.toLowerCase() !== profile.name.toLowerCase())].slice(0, 8);
    setProfiles(next); setProfileName("");
    try { localStorage.setItem(`skai.terminal.profiles.${projectId}`, JSON.stringify(next)); } catch { /* Profiles are optional local convenience. */ }
  };
  const applyProfile = (id: string) => {
    const profile = profiles.find((item) => item.id === id);
    if (!profile) return;
    setProfileSelection(id); setCommand(profile.command); setCwd(profile.cwd); setTargetMode(profile.targetMode); setSshHost(profile.host); setSshUsername(profile.username); setSshPort(profile.port || "22");
  };
  const deleteProfile = (id: string) => {
    const next = profiles.filter((item) => item.id !== id);
    setProfiles(next);
    setProfileSelection("");
    if (projectId) { try { localStorage.setItem(`skai.terminal.profiles.${projectId}`, JSON.stringify(next)); } catch { /* Optional local convenience. */ } }
  };

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
  const checkSshConnection = async () => {
    const port = Number(sshPort);
    if (!sshHost.trim() || !sshUsername.trim() || !Number.isInteger(port) || port < 1 || port > 65535 || sshPreflightBusy) return;
    setSshPreflightBusy(true);
    setSshPreflight(null);
    setSshError("");
    try {
      // A harmless echo validates DNS/network reachability, known_hosts trust, and
      // the configured key/agent without running the user's command.
      const response = await window.skaiAgent.request("project.ssh.run", { host: sshHost.trim(), username: sshUsername.trim(), port, command: "echo skai-ssh-preflight-ok", timeoutSeconds: 15 });
      if (!response.ok) throw new Error(response.error?.message ?? "SSH connection check failed.");
      const result = response.result as { output?: string; exitCode?: number; timedOut?: boolean; target?: string };
      if (result.timedOut || result.exitCode !== 0 || !(result.output ?? "").includes("skai-ssh-preflight-ok")) throw new Error("The host connected but did not complete the preflight check.");
      setSshPreflight({ status: "ready", message: `${result.target ?? `${sshUsername}@${sshHost}`} is ready for SSH commands.`, checkedAt: new Date().toISOString() });
    } catch (error) {
      setSshPreflight({ status: "blocked", message: error instanceof Error ? error.message : "SSH connection check failed.", checkedAt: new Date().toISOString() });
    } finally { setSshPreflightBusy(false); }
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
      <label>Run on<select value={targetMode} onChange={(event) => { setTargetMode(event.target.value as "local" | "ssh"); setSshOutput(null); setSshError(""); setSshPreflight(null); }}><option value="local">Local project</option><option value="ssh">SSH devbox</option></select></label>
      {targetMode === "local" ? <label>Working directory<input value={cwd} onChange={(event) => setCwd(event.target.value)} aria-label="Working directory" /></label> : <>
        <label>Host<input value={sshHost} onChange={(event) => setSshHost(event.target.value)} placeholder="devbox.example.com" aria-label="SSH host" autoComplete="off" /></label>
        <label>Username<input value={sshUsername} onChange={(event) => setSshUsername(event.target.value)} placeholder="developer" aria-label="SSH username" autoComplete="username" /></label>
        <label>Port<input type="number" min={1} max={65535} value={sshPort} onChange={(event) => setSshPort(event.target.value)} aria-label="SSH port" /></label>
      </>}
    </div>
    <div className="terminal-profile-row" aria-label="Saved terminal profiles"><label>Saved environment<select value={profileSelection} onChange={(event) => applyProfile(event.target.value)}><option value="">Choose a saved profile…</option>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select></label><input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Profile name" aria-label="New terminal profile name" maxLength={80} /><Button variant="secondary" type="button" disabled={!profileName.trim() || !command.trim()} onClick={saveProfile}>Save profile</Button>{profileSelection && <Button variant="ghost" type="button" onClick={() => deleteProfile(profileSelection)}>Remove profile</Button>}</div>
    {targetMode === "ssh" && <div className="terminal-ssh-preflight"><p className="terminal-safety-note">Uses system OpenSSH keys or agent. The host must already be trusted in known_hosts. Password prompts and forwarding are disabled.</p><Button variant="secondary" type="button" disabled={sshPreflightBusy || !sshHost.trim() || !sshUsername.trim()} onClick={() => void checkSshConnection()}>{sshPreflightBusy ? "Checking connection…" : "Check connection"}</Button>{sshPreflight && <span className={`terminal-ssh-preflight-result is-${sshPreflight.status}`} role="status" aria-live="polite"><strong>{sshPreflight.status === "ready" ? "Connection ready" : "Connection blocked"}</strong><small>{sshPreflight.message} · checked {new Date(sshPreflight.checkedAt).toLocaleTimeString()}</small></span>}</div>}
    <div className="terminal-command-row">
      <input value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") run(); }} placeholder={targetMode === "ssh" ? "git status" : "git status"} aria-label={targetMode === "ssh" ? "Remote SSH command" : "Terminal command"} />
      <Button variant="primary" disabled={busy || sshBusy || !command.trim() || !projectId || targetMode === "ssh" && (!sshHost.trim() || !sshUsername.trim())} onClick={run}>{busy || sshBusy ? "Running…" : targetMode === "ssh" ? "Run on devbox" : "Run command"}</Button>
    </div>
    {targetMode === "local" && output !== null && <TerminalOutput text={output} exitCode={exitCode} label="Local command output" />}
    {targetMode === "ssh" && sshError && <p className="terminal-error" role="alert">{sshError}</p>}
    {targetMode === "ssh" && sshOutput !== null && <TerminalOutput text={sshOutput} exitCode={sshExitCode} label="SSH command output" />}</>}
    {projects.length > 0 && onStartSession && <div className="terminal-session"><div className="terminal-session-heading"><div><p className="section-kicker">PERSISTENT PTY</p><h3>{sessionId ? "Session connected" : "Keep a shell open"}</h3></div><span className="terminal-safety-note">{sessionId ? "Local session" : "Not started"}</span></div>{sessionId ? <><TerminalOutput key={`${sessionId}:${screen}`} text={screen || "Starting shell…"} exitCode={0} label="Persistent terminal screen" className="terminal-screen" /><div className="terminal-command-row"><input value={sessionInput} onChange={(event) => setSessionInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void sendSessionInput(); }} placeholder="Type shell input…" aria-label="Persistent terminal input" /><Button variant="secondary" disabled={!sessionInput} onClick={() => void sendSessionInput()}>Send</Button><Button variant="ghost" onClick={() => void onRefreshSession?.()}>Refresh</Button><Button variant="danger" onClick={() => void onCloseSession?.()}>Close</Button></div></> : <div className="form-footer"><span>Interactive input persists between commands while this workspace is open.</span><Button variant="secondary" disabled={busy || !projectId} onClick={startSession}>Start persistent session</Button></div>}</div>}
  </Card>;
}
