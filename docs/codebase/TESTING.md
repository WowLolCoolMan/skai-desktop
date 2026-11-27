# Testing

## Test Strategy

- TypeScript compilation validates the desktop client.
- Vite production build validates bundling.
- Agent-host smoke tests exercise protocol health, persistence, tasks, personas, and scheduling.
- Electron UI matrix exercises desktop workflows through the packaged runtime.

## Key Commands

```bash
npm run typecheck --prefix apps/desktop
npm run desktop:build
node scripts/smoke-agent-host.cjs
```

## Coverage Gaps

- [TODO] Add a focused client regression test for save retry and local draft recovery.
- [TODO] Add provider-fallback integration coverage.

## Evidence

- `scripts/smoke-agent-host.cjs`
- `scripts/smoke-electron-ui-matrix.cjs`
- `apps/desktop/package.json`
