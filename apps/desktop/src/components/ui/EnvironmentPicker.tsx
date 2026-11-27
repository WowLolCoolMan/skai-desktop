import { useId } from "react";
import type { TaskEnvironment } from "../../../shared/contracts";

type EnvironmentPickerProps = {
  value: TaskEnvironment;
  onChange: (value: TaskEnvironment) => void;
  worktreeAvailable?: boolean;
};

const environments: Array<{ id: TaskEnvironment; label: string; description: string }> = [
  { id: "local", label: "Local", description: "Edit the selected project directly" },
  { id: "worktree", label: "Isolated worktree", description: "Work on a separate Git branch and keep it for review" },
];

export function EnvironmentPicker({ value, onChange, worktreeAvailable = false }: EnvironmentPickerProps) {
  const groupId = useId();
  const noteId = `${groupId}-note`;
  return <fieldset className="environment-picker">
    <legend id={`${groupId}-legend`}>Run this task in</legend>
    <div className="environment-options">
      {environments.map((environment) => <label className={`environment-option ${value === environment.id ? "is-selected" : ""}${environment.id === "worktree" && !worktreeAvailable ? " is-unavailable" : ""}`} key={environment.id}>
        <input type="radio" name={groupId} value={environment.id} checked={value === environment.id} disabled={environment.id === "worktree" && !worktreeAvailable} aria-describedby={noteId} onChange={() => onChange(environment.id)} />
        <span className="environment-option-copy"><strong>{environment.label}</strong><small>{environment.id === "worktree" && !worktreeAvailable ? "Open a project with one Git repository root to enable" : environment.description}</small></span>
      </label>)}
    </div>
    <p className="environment-note" id={noteId}>{value === "worktree" ? "Starts from the repository's current commit. Uncommitted changes in the original checkout are not copied; the isolated branch is retained for review." : "Local edits the selected project checkout directly."}</p>
  </fieldset>;
}
