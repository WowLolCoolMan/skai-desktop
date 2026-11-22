import { useEffect, useRef, useState } from "react";
import type { UpdateCheckResult } from "../../../shared/contracts";
import { Button } from "../ui/Primitives";

export function UpdateNotice() {
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previousUpdate = useRef<UpdateCheckResult | null>(null);

  useEffect(() => {
    const updates = window.skaiAgent?.updates;
    if (!updates) return;
    let mounted = true;
    let receivedLiveState = false;
    const remove = updates.onState((result) => {
      receivedLiveState = true;
      const wasUpdating = previousUpdate.current?.available === true;
      previousUpdate.current = result;
      if (result.available || result.status === "downloaded" || (result.status === "error" && wasUpdating)) {
        setUpdate(result);
        setOpen(true);
      }
    });
    void updates.state().then((result) => { if (mounted && !receivedLiveState && result?.available) { previousUpdate.current = result; setUpdate(result); setOpen(true); } }).catch(() => {});
    return () => { mounted = false; remove(); };
  }, []);

  if (!open || !update || (!update.available && update.status !== "error")) return null;
  const run = async (action: "download" | "retry" | "install") => {
    const updates = window.skaiAgent?.updates;
    if (!updates || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (action === "download") {
        if (!await updates.download()) setError("The download could not be started. Try checking for updates again in Settings.");
      } else if (action === "retry") {
        const result = await updates.retry();
        setUpdate(result);
        previousUpdate.current = result;
      } else if (await updates.install()) setOpen(false);
      else setError("The update is not ready to install yet.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };
  return <div className="update-overlay" role="presentation"><section className="update-card" role="dialog" aria-modal="true" aria-labelledby="update-title" aria-describedby="update-description">
    <button className="update-close" type="button" onClick={() => setOpen(false)} aria-label="Dismiss update notification">×</button>
    <h2 id="update-title">{update.status === "error" ? "Update needs attention" : update.status === "downloaded" ? "Update ready to install" : update.status === "downloading" ? "Downloading update" : "Update available"}</h2>
    <p id="update-description">{error ?? update.message ?? `Skai Desktop ${update.version ? `v${update.version}` : "has a new release"} is available.`}</p>
    <div className="update-progress" aria-label={update.status === "downloaded" ? "Update verified" : `Download ${update.percent ?? 0}%`}><span style={{ width: `${update.status === "downloaded" ? 100 : update.percent ?? 0}%` }} /></div>
    <div className="update-progress-copy"><strong>{update.status === "downloaded" ? "Verified and staged" : update.status === "error" ? "Download/check failed" : "Background download"}</strong><span>{update.status === "downloading" ? `${update.percent ?? 0}%` : update.version ? `Version ${update.version}` : "Stable channel"}</span></div>
    <p className="update-safety-note">Skai verifies the downloaded package before staging. The app restarts only when you choose to install.</p>
    <div className="update-actions"><Button variant="ghost" onClick={() => setOpen(false)}>Later</Button>{update.status === "downloading" && <Button variant="ghost" disabled={busy} onClick={() => void window.skaiAgent?.updates?.cancelDownload()}>Cancel download</Button>}{update.status === "downloaded" ? <Button variant="primary" disabled={busy} onClick={() => void run("install")}>{busy ? "Restarting." : "Restart to update"}</Button> : update.status === "error" ? <Button variant="primary" disabled={busy} onClick={() => void run("retry")}>{busy ? "Retrying." : "Retry"}</Button> : update.status === "available" ? <Button variant="primary" disabled={busy} onClick={() => void run("download")}>{busy ? "Starting." : "Download update"}</Button> : null}</div>
  </section></div>;
}
