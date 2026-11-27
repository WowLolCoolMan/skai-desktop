import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { PetWindow } from "./components/overlays/PetWindow";
import { VisualComponentWorkbench } from "./dev/VisualComponentWorkbench";
import "./design-system/tokens.css";
import "./styles.css";
import "./features/settings/easterEggs.css";

const searchParams = new URLSearchParams(window.location.search);
const showVisualWorkbench = import.meta.env.DEV && searchParams.get("ui-workbench") === "1";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {showVisualWorkbench ? <VisualComponentWorkbench /> : searchParams.get("pet") === "1" ? <PetWindow /> : <App />}
  </StrictMode>,
);
