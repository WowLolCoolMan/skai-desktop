import { useEffect, useState } from "react";
import type { UpdateCheckResult } from "../../../shared/contracts";
import { Button } from "../ui/Primitives";

export function UpdateNotice() {
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const updates = window.skaiAgent?.updates;
    if (!updates) return;
    let mounted = true;
    void updates.check().then((result) => { if (mounted && result.available) { setUpdate(result); setOpen(true); } }).catch(() => {});
    const remove = updates.onAvailable((result) => { if (result.available) { setUpdate(result); setOpen(true); } });
    return () => { mounted = false; remove(); };
  }, []);

  if (!open || !update?.available) return null;
  const openRelease = () => { if (update.downloadUrl) void window.skaiAgent?.updates?.open(update.downloadUrl); };
  return <div className="update-overlay" role="presentation"><section className="update-card" role="dialog" aria-modal="true" aria-labelledby="update-title" aria-describedby="update-description">
    <button className="update-close" type="button" onClick={() => setOpen(false)} aria-label="Dismiss update notification">×</button>
    <h2 id="update-title">Update ready</h2>
    <p id="update-description">Skai Desktop {update.version ? `v${update.version}` : "has a new release"} is verified and ready for review.</p>
    <div className="update-progress" aria-label="Release verification complete"><span style={{ width: "100%" }} /></div>
    <div className="update-progress-copy"><strong>Verified release</strong><span>{update.assetName ?? "Release artifact ready"}</span></div>
    <p className="update-safety-note">Review the official release page before downloading. Skai will not replace the running app silently.</p>
    <div className="update-actions"><Button variant="ghost" onClick={() => setOpen(false)}>Later</Button><Button variant="primary" disabled={!update.downloadUrl} onClick={openRelease}>Review update</Button></div>
  </section></div>;
}
