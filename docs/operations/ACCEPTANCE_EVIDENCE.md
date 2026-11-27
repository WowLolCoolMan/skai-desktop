# Acceptance evidence contract

Feature completion is based on observable behavior. A build or route screenshot
alone does not prove a user workflow works. Each roadmap slice and release
claim must be reviewable from its implementation, a focused success and failure
path, and the evidence recorded below.

## Per-slice checklist

Copy this checklist into the slice's review record before calling it complete:

- [ ] State the user-visible outcome and affected route/workflow.
- [ ] Verify one representative success path and record the exact command or
  manual steps, result, and artifact.
- [ ] Verify one representative failure, disconnected, or denied path and
  record the expected recovery and result.
- [ ] Use a disposable profile for tests that create, modify, delete, import,
  or persist app data. Never point destructive acceptance at the user's profile.
- [ ] For a UI change, name the owner-approved reference, record the before and
  after screenshots, and describe matches and remaining differences.
- [ ] Record platform and OS version, viewport, theme, sidebar state, packaged
  or development runtime, and app revision for every screenshot.
- [ ] Check page/tab context, keyboard access, error state, and Settings return
  behavior when the slice changes navigation or settings.
- [ ] State whether the test stayed local or made an explicit network request;
  identify the request boundary and prove credentials or private content were
  not included when the test does not require them.
- [ ] List platforms, integrations, and hardware that were not verified.
- [ ] Link capability-matrix claims to the commands or manual evidence that
  supports them. Keep unverified claims `partial` or `planned`.

## Evidence record template

```markdown
### Slice N — short name

- Outcome:
- Reference / workflow:
- Success check (command or steps):
- Failure check (command or steps):
- Disposable profile / cleanup:
- Platform / OS:
- Viewport / theme / sidebar:
- Runtime / app revision:
- Network and privacy boundary:
- Before screenshot:
- After screenshot:
- Comparison: matches / differences / follow-up:
- Unverified platforms, integrations, or hardware:
```

## UI screenshot metadata

`npm run smoke:electron:ui-matrix` uses a throwaway app profile. When run with
`UI_MATRIX_CAPTURE=1`, every captured PNG gets an adjacent
`<image>.png.evidence.json` sidecar. The sidecar records the exact test platform,
viewport, theme, sidebar state, packaged Electron runtime, route, and capture
time. Screenshots are evidence only; they do not silently replace approved
reference images. Reviewers compare the before/after pair and note visual and
workflow differences in the corresponding Revision 4 workflow README section.

Older screenshots without sidecars are historical evidence. Their README text
states the known capture context and remaining comparison gap; do not infer a
platform or theme that was not recorded.

## Failure and privacy evidence register

| Scenario | Existing focused evidence | Current boundary |
| --- | --- | --- |
| Local image runtime/model unavailable | [`smoke:image:runtime-unavailable`](../../package.json), [`smoke:image:model-unavailable`](../../package.json) | Covers image runtime/model setup recovery; does not establish recovery for every chat provider. |
| MCP denied access, revoke, reconnect, delayed response | [`smoke:marketplace-host`](../../package.json), [`MCP client tests`](../../native/SkaiDesktop.Core.Tests/McpStreamableHttpClientTests.cs) | Loopback lifecycle verifies denied writes, revocation, and fresh-session reconnect; core test injects a delayed handler and checks the request deadline. Packaged timeout UI recovery remains unverified. |
| GitHub authentication expiry | [`GitHub integration guide`](../guides/GITHUB_INTEGRATION.md), [`GitHub core tests`](../../native/SkaiDesktop.Core.Tests/GitHubTests.cs) | Device-flow expiry/polling and an injected HTTP 401 are covered; end-to-end refresh failure in the packaged UI remains unverified. |
| Disk full / storage exhaustion | [`Atomic file writer fault-injection test`](../../native/SkaiDesktop.Core.Tests/AtomicFileWriterTests.cs), [`Agent Host smoke`](../../scripts/smoke-agent-host.cjs) | A deterministic injected ENOSPC write failure verifies that the last complete file is preserved and the partial temp file is cleaned up. It does not fill a real disk or verify the packaged UI recovery message; disk-growth quota remains unenforced. |
| Privacy / explicit network boundary | [`Local-only audit`](../../package.json), [`Marketplace host smoke`](../../package.json) | Release audit rejects unapproved hosted inference and host smoke rejects hosted MCP/model removal paths. Provider-specific outbound request inspection remains scoped to the relevant integration smoke. |

Known gaps in this table are intentionally explicit release limitations. A
future slice may close them with bounded deterministic fixtures; do not simulate
an OS-level disk-full condition by filling a developer or CI volume.

### Slice 32 — evidence-driven completion

- Outcome: link each capability status to an executable check and record
  acceptance context and release boundaries.
- Success check: `npm run check:acceptance-evidence`; `npm test`; focused
  packaged UI matrix with `UI_MATRIX_EXERCISE_SETTINGS_OVERLAY=1`.
- Failure check: missing image runtime smoke; delayed MCP response deadline;
  injected GitHub HTTP 401; injected ENOSPC temporary-file write.
- Disposable profile / cleanup: UI matrix and image workflow create temporary
  Electron user-data and Agent Host profiles. Fixtures are removed by smoke
  cleanup; the installed model cache is not modified.
- Platform / OS: current acceptance run is Windows 11 x64; release CI also
  executes the Linux packaged artifact gates listed in release readiness.
- Viewport / theme / sidebar: focused Settings-return test at 1440×900, dark,
  expanded sidebar; screenshot metadata sidecars capture actual test values.
- Runtime / app revision: packaged Electron artifact, with revision recorded
  in each newly captured screenshot sidecar.
- Network and privacy boundary: test uses local host fixtures. GitHub 401 is
  returned by an in-memory HTTP handler; no GitHub credential or network call is
  used. Existing local-only audit and marketplace smoke remain the network
  boundary gates.
- Before/after screenshots: no visual redesign in this slice; UI matrix
  captures are regression evidence, not a new design reference comparison.
- Unverified platforms, integrations, or hardware: native macOS; native Linux
  desktop; packaged MCP timeout display; full GitHub refresh failure UI; app UI
  response to actual disk exhaustion; user hardware/model/GPU combinations.
