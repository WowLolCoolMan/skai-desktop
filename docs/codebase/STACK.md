# Technology Stack

## Runtime Summary

| Area | Value | Evidence |
|---|---|---|
| Primary language | TypeScript/React and C# | `apps/desktop/package.json`, `services/agent-host/SkaiDesktop.AgentHost.csproj` |
| Runtime | Node.js/Vite desktop client plus .NET host | `package.json`, `services/agent-host/SkaiDesktop.AgentHost.csproj` |
| Package manager | npm | `package-lock.json`, `package.json` |
| Build system | Vite and dotnet build | `apps/desktop/package.json`, `scripts/smoke-agent-host.cjs` |

## Production Frameworks and Dependencies

| Dependency | Role | Evidence |
|---|---|---|
| React | Desktop UI | `apps/desktop/package.json` |
| Vite | UI bundling | `apps/desktop/package.json` |
| Monaco Editor | Coding workspace editor | `apps/desktop/src/features/coding` |
| .NET host | Local protocol, persistence, tools | `services/agent-host` |

## Key Commands

```bash
npm run typecheck --prefix apps/desktop
npm run desktop:build
node scripts/smoke-agent-host.cjs
```

## Evidence

- `package.json`
- `apps/desktop/package.json`
- `services/agent-host/SkaiDesktop.AgentHost.csproj`
- `docs/codebase/.codebase-scan.txt`
