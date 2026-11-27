import { createElement, useEffect, useRef, useState, type ElementType } from "react";
import { Button, Card } from "../../components/ui/Primitives";

type BrowserGuest = HTMLElement & {
  loadURL(url: string): void;
  getURL(): string;
  reload(): void;
  stop(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
};

function normalizeLoopbackUrl(value: string): string | null {
  try {
    const parsed = new URL(value.includes("://") ? value : `http://${value}`);
    const host = parsed.hostname.toLowerCase();
    if (!(["http:", "https:"].includes(parsed.protocol)) || parsed.username || parsed.password) return null;
    if (!(host === "localhost" || host === "::1" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host))) return null;
    return parsed.toString();
  } catch { return null; }
}

export function BrowserPreview({ projectId }: { projectId: string }) {
  const guestRef = useRef<BrowserGuest | null>(null);
  const [address, setAddress] = useState("http://localhost:5173");
  const [activeUrl, setActiveUrl] = useState("");
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const partition = `persist:skai-preview-${projectId.replace(/[^a-z0-9_-]/gi, "").slice(0, 48) || "project"}`;
  const Webview = "webview" as unknown as ElementType;

  useEffect(() => {
    const guest = guestRef.current;
    if (!guest) return;
    const checkNavigation = (event: Event & { url?: string }) => {
      const requested = event.url ?? guest.getURL();
      if (!normalizeLoopbackUrl(requested)) {
        event.preventDefault();
        setError("Preview navigation is limited to localhost and 127.0.0.1.");
      }
    };
    const onNavigated = (event: Event & { url?: string }) => {
      const url = event.url ?? guest.getURL();
      if (normalizeLoopbackUrl(url)) { setActiveUrl(url); setAddress(url); setError(""); }
    };
    const onConsole = (event: Event & { message?: string; level?: number }) => {
      const line = `[${event.level ?? 0}] ${event.message ?? "Browser console message"}`;
      setMessages((current) => [...current.slice(-99), line]);
    };
    const onPopup = (event: Event) => event.preventDefault();
    const onLoadFailure = (event: Event & { errorDescription?: string; isMainFrame?: boolean }) => {
      if (event.isMainFrame) setError(event.errorDescription || "The local preview could not be loaded.");
    };
    guest.addEventListener("will-navigate", checkNavigation);
    guest.addEventListener("will-redirect", checkNavigation);
    guest.addEventListener("did-navigate", onNavigated);
    guest.addEventListener("console-message", onConsole);
    guest.addEventListener("new-window", onPopup);
    guest.addEventListener("did-fail-load", onLoadFailure);
    return () => {
      guest.removeEventListener("will-navigate", checkNavigation);
      guest.removeEventListener("will-redirect", checkNavigation);
      guest.removeEventListener("did-navigate", onNavigated);
      guest.removeEventListener("console-message", onConsole);
      guest.removeEventListener("new-window", onPopup);
      guest.removeEventListener("did-fail-load", onLoadFailure);
    };
  }, [projectId]);

  const navigate = () => {
    const url = normalizeLoopbackUrl(address.trim());
    if (!url) { setError("Enter a localhost URL such as http://localhost:5173."); return; }
    setError("");
    guestRef.current?.loadURL(url);
    setActiveUrl(url);
  };

  const guest = createElement(Webview, {
    ref: (element: BrowserGuest | null) => { guestRef.current = element; },
    className: "skai-browser-guest",
    src: activeUrl || "about:blank",
    partition,
    allowpopups: false,
    webpreferences: "contextIsolation=yes,nodeIntegration=no,sandbox=yes,webSecurity=yes,allowRunningInsecureContent=no",
    title: "Local project browser preview",
  });

  return <Card className="skai-browser-preview" aria-label="In-app browser preview">
    <div className="skai-browser-toolbar">
      <div className="skai-browser-nav">
        <Button variant="ghost" aria-label="Go back" disabled={!guestRef.current?.canGoBack()} onClick={() => guestRef.current?.goBack()}>←</Button>
        <Button variant="ghost" aria-label="Go forward" disabled={!guestRef.current?.canGoForward()} onClick={() => guestRef.current?.goForward()}>→</Button>
        <Button variant="ghost" aria-label="Reload preview" onClick={() => guestRef.current?.reload()}>↻</Button>
      </div>
      <form className="skai-browser-address" onSubmit={(event) => { event.preventDefault(); navigate(); }}>
        <input aria-label="Local preview URL" value={address} onChange={(event) => setAddress(event.target.value)} spellCheck={false} />
        <Button variant="primary" type="submit">Open</Button>
      </form>
      {activeUrl && <Button variant="ghost" onClick={() => { setMessages([]); guestRef.current?.stop(); }}>Stop</Button>}
    </div>
    {error && <p className="skai-browser-error" role="alert">{error}</p>}
    <div className="skai-browser-viewport">{guest}</div>
    <details className="skai-browser-console"><summary>Console messages ({messages.length})</summary>{messages.length ? <pre>{messages.join("\n")}</pre> : <p>No console messages captured.</p>}</details>
  </Card>;
}
