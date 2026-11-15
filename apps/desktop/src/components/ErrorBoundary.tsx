import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui/Primitives";

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { error: Error | null };

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): ErrorBoundaryState { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Skai renderer recovered from an unexpected error.", error, info.componentStack); }
  reset = () => this.setState({ error: null });
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="app-crash-state" role="alert" aria-labelledby="app-crash-title"><p className="eyebrow">SKAI DESKTOP</p><h1 id="app-crash-title">The workspace hit an unexpected error</h1><p>Your local data is still on this computer. Reload the workspace and try the last action again.</p><div className="app-crash-actions"><Button variant="primary" onClick={this.reset}>Reload workspace</Button><Button variant="ghost" onClick={() => window.location.reload()}>Restart app</Button></div><small>{this.state.error.message || "Unknown renderer error"}</small></main>;
  }
}
