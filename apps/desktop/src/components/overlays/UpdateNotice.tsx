import { useEffect, useState } from "react";
import type { UpdateCheckResult } from "../../../shared/contracts";
import { Button } from "../ui/Primitives";

export function UpdateNotice() {
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const updates = window.skaiAgent?.updates;
    if (!updates) return;
    let mounted = true;
    void updates.state().then((result) => { if (mounted && result?.available) { setUpdate(result); setOpen(true); } }).catch(() => {});
    const remove = updates.onState((result) => { if (result.available || result.status === "downloaded") { setUpdate(result); setOpen(true); } });
    return () => { mounted = false; remove(); };
  }, []);

  if (!open || !update?.available) return null;
  const install = () => { void window.skaiAgent?.updates?.install(); setOpen(false); };
  const retry = () => { void window.skaiAgent?.updates?.retry().then(setUpdate); };
  return <div className="update-overlay" role="presentation"><section className="update-card" role="dialog" aria-modal="true" aria-labelledby="update-title" aria-describedby="update-description">
    <button className="update-close" type="button" onClick={() => setOpen(false)} aria-label="Dismiss update notification">×</button>
    <h2 id="update-title">{update.status === "error" ? "Update needs attention" : update.status === "downloaded" ? "Update ready to install" : update.status === "downloading" ? "Downloading update" : "Update available"}</h2>
    <p id="update-description">{update.message ?? `Skai Desktop ${update.version ? `v${update.version}` : "has a new release"} is available.`}</p>
    <div className="update-progress" aria-label={update.status === "downloaded" ? "Update verified" : `Download ${update.percent ?? 0}%`}><span style={{ width: `${update.status === "downloaded" ? 100 : update.percent ?? 0}%` }} /></div>
    <div className="update-progress-copy"><strong>{update.status === "downloaded" ? "Verified and staged" : update.status === "error" ? "Download/check failed" : "Background download"}</strong><span>{update.status === "downloading" ? `${update.percent ?? 0}%` : update.version ? `Version ${update.version}` : "Stable channel"}</span></div>
    <p className="update-safety-note">Skai verifies the downloaded package before staging. The app restarts only when you choose to install.</p>
    <div className="update-actions"><Button variant="ghost" onClick={() => setOpen(false)}>Later</Button>{update.status === "downloading" && <Button variant="ghost" onClick={() => void window.skaiAgent?.updates?.cancelDownload()}>Cancel download</Button>}{update.status === "downloaded" ? <Button variant="primary" onClick={install}>Restart to update</Button> : update.status === "error" ? <Button variant="primary" onClick={retry}>Retry</Button> : null}</div>
  </section></div>;
}
