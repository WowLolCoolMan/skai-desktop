import { useState } from "react";
import { Button, Card, EmptyState, PageHeader, StatusBadge } from "../components/ui/Primitives";
import "./visual-component-workbench.css";

const themes = ["dark", "light"] as const;
const densities = ["comfortable", "compact"] as const;

export function VisualComponentWorkbench() {
  const [theme, setTheme] = useState<(typeof themes)[number]>("dark");
  const [density, setDensity] = useState<(typeof densities)[number]>("comfortable");
  return <main className="visual-workbench" data-theme={theme} data-density={density} data-testid="component-workbench">
    <header className="visual-workbench-toolbar">
      <div><p className="section-kicker">DEVELOPER PREVIEW</p><h1>Shared UI workbench</h1><p>Same reusable components, rendered with explicit props across themes, density, and interaction states.</p></div>
      <div className="visual-workbench-options">
        <label>Theme<select value={theme} onChange={(event) => setTheme(event.target.value as typeof theme)}>{themes.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Density<select value={density} onChange={(event) => setDensity(event.target.value as typeof density)}>{densities.map((value) => <option key={value}>{value}</option>)}</select></label>
      </div>
    </header>
    <section className="visual-workbench-section" data-geometry="page-header">
      <PageHeader eyebrow="FIXTURE · HEADER" title="Readable page heading" description="Long supporting copy wraps independently from the action group at narrow widths." actions={<><Button variant="secondary">Secondary action</Button><Button variant="primary">Primary action</Button></>} />
    </section>
    <section className="visual-workbench-section visual-workbench-grid" aria-label="Shared components by state">
      <Card className="visual-workbench-card" data-geometry="button-states"><h2>Buttons</h2><div className="visual-workbench-row"><Button variant="primary">Primary</Button><Button variant="secondary">Secondary</Button><Button variant="ghost">Quiet</Button><Button variant="danger">Destructive</Button><Button variant="primary" disabled>Disabled</Button></div><div className="visual-workbench-row"><Button variant="secondary" aria-label="Refresh preview">⌁</Button><Button variant="secondary" className="visual-workbench-forced-focus">Keyboard focus</Button></div></Card>
      <Card className="visual-workbench-card" data-geometry="status-states"><h2>Status and loading</h2><div className="visual-workbench-row"><StatusBadge tone="success">Ready</StatusBadge><StatusBadge tone="warning">Needs attention</StatusBadge><StatusBadge tone="danger">Failed</StatusBadge><StatusBadge>Idle</StatusBadge></div><div className="visual-workbench-skeleton" aria-label="Loading card preview"><span /><span /><span /></div></Card>
      <Card className="visual-workbench-card" data-geometry="empty-error-states"><h2>Empty and error content</h2><div className="visual-workbench-row visual-workbench-empty-row"><EmptyState title="No items yet" description="An actionable empty state keeps the next step visible." action={<Button variant="secondary">Add an item</Button>} /><div className="visual-workbench-error" role="alert"><strong>Could not load this section</strong><p>The error stays selectable and includes a direct recovery action.</p><Button variant="secondary">Retry</Button></div></div></Card>
      <Card className="visual-workbench-card" data-geometry="form-states"><h2>Form geometry</h2><label className="visual-workbench-field">Project name<input defaultValue="Demo workspace" aria-describedby="workbench-help" /></label><small id="workbench-help">Helper text aligns with the control.</small><label className="visual-workbench-field">Invalid URL<input aria-invalid="true" defaultValue="not a url" /></label><small className="visual-workbench-validation" role="alert">Enter a valid local endpoint.</small></Card>
    </section>
    <footer>Fixture coverage: error · empty · loading · disabled · focused · dark/light · comfortable/compact</footer>
  </main>;
}
