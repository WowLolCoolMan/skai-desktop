import { useEffect, useRef, useState } from "react";
import type { CloseChoice } from "../../../shared/contracts";
import { ModalDialog } from "../ui/ModalDialog";
import { NavIcon } from "../ui/NavIcon";

// Linux-only: shown when the window manager closes the main window (e.g. a
// Hyprland/i3 "close window" keybind) and no choice has been remembered.
export function CloseChoiceDialog() {
  const bridge = window.skaiAgent?.window;
  const [request, setRequest] = useState<{ trayAvailable: boolean } | null>(null);
  const [remember, setRemember] = useState(false);
  const backgroundRef = useRef<HTMLButtonElement>(null);

  useEffect(() => bridge?.onCloseRequested((next) => { setRemember(false); setRequest(next); }), [bridge]);

  if (!bridge) return null;
  const respond = (choice: CloseChoice) => {
    bridge.respondToClose(choice, choice !== "cancel" && remember);
    setRequest(null);
  };

  return <ModalDialog open={request !== null} titleId="close-choice-title" onClose={() => respond("cancel")} initialFocusRef={backgroundRef} className="close-choice-dialog">
    <div className="close-choice-card">
      <div className="close-choice-heading">
        <span className="close-choice-mark" aria-hidden="true"><NavIcon name="sparkle" /></span>
        <div>
          <h2 id="close-choice-title">Close Skai Desktop?</h2>
          <p>Skai can keep running in the background so desktop pets, scheduled work, and the local agent host stay available.</p>
        </div>
      </div>
      <div className="close-choice-options">
        <button ref={backgroundRef} type="button" className="close-choice-option is-primary" onClick={() => respond("background")}>
          <strong>Run in background</strong>
          <small>{request?.trayAvailable ? "Reopen from the system tray icon." : "No system tray found: reopen Skai from your app launcher."}</small>
        </button>
        <button type="button" className="close-choice-option" onClick={() => respond("quit")}>
          <strong>Fully close</strong>
          <small>Stop Skai, all pets, and the local agent host.</small>
        </button>
      </div>
      <label className="close-choice-remember"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>Remember my choice <small>(change it in Settings → General)</small></span></label>
    </div>
  </ModalDialog>;
}
