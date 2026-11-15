import { useId } from "react";
import type { TaskEnvironment } from "../../../shared/contracts";

type EnvironmentPickerProps = {
  value: TaskEnvironment;
  onChange: (value: TaskEnvironment) => void;
};

const environments: Array<{ id: TaskEnvironment; label: string; description: string }> = [
  { id: "local", label: "Local", description: "Edit the selected project directly" },
];

export function EnvironmentPicker({ value, onChange }: EnvironmentPickerProps) {
  const groupId = useId();
  const noteId = `${groupId}-note`;
  return <fieldset className="environment-picker">
    <legend id={`${groupId}-legend`}>Run this task in</legend>
    <div className="environment-options">
      {environments.map((environment) => <label className={`environment-option ${value === environment.id ? "is-selected" : ""}`} key={environment.id}>
        <input type="radio" name={groupId} value={environment.id} checked={value === environment.id} aria-describedby={noteId} onChange={() => onChange(environment.id)} />
        <span className="environment-option-copy"><strong>{environment.label}</strong><small>{environment.description}</small></span>
      </label>)}
    </div>
    <p className="environment-note" id={noteId}>Local is the only configured execution environment. Selecting it keeps the task plan bounded to this project.</p>
  </fieldset>;
}
