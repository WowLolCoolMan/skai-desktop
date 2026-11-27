import { useEffect, useState } from "react";

const scratchpadKey = (projectId: string) => `skai.project.scratchpad.${projectId}`;

export function ProjectScratchpad({ projectId }: { projectId: string }) {
  const [value, setValue] = useState(() => localStorage.getItem(scratchpadKey(projectId)) ?? "");
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    setValue(localStorage.getItem(scratchpadKey(projectId)) ?? "");
    setSaved(true);
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(scratchpadKey(projectId), value);
        setSaved(true);
      } catch {
        setSaved(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [projectId, value]);

  return <details className="coding-project-scratchpad">
    <summary><span><strong>Project scratchpad</strong><small>{value.trim() ? saved ? "Saved locally" : "Could not save locally" : "Notes stay outside the chat"}</small></span><span className="coding-project-scratchpad-count">{value.length.toLocaleString()} / 20,000</span></summary>
    <div className="coding-project-scratchpad-body">
      <textarea value={value} maxLength={20_000} onChange={(event) => { setValue(event.target.value); setSaved(false); }} placeholder="Capture decisions, commands, links, or temporary notes for this project…" aria-label="Project scratchpad" />
      <p>Stored only on this device. Scratchpad text is not sent to a model unless you copy it into a conversation.</p>
    </div>
  </details>;
}
