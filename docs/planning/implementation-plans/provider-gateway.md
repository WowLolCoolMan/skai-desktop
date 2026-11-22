# Provider gateway implementation plan

## Goal

Add optional user-connected local, cloud, and hybrid model routes while keeping
Skai local-first. Skai does not sell provider access. The user supplies a
provider account and credential where required. Local-only mode remains a
complete, enforceable operating mode.

## Current state

- Electron + React submits chat requests through the isolated preload bridge to
  the persistent .NET Agent Host.
- The Core provider supports local OpenAI-compatible endpoints. AirLLM has a
  separate local route and narrowly scoped local capacity fallback.
- `RequiredLocalEndpoint`, settings normalization, endpoint checks, and
  `scripts/audit-local-only.cjs` currently prohibit hosted model routing.
- Chat provider connections do not yet have a durable secret store. Optional
  cloud voice now stores its own provider keys with Windows user encryption or
  the Linux desktop keyring; this is a voice-specific implementation, not yet
  the provider-neutral connection store described below. Keys are entered in
  Settings transiently and are not sent with speech requests.
- Chat prompt compaction and several internal completion helpers call provider
  code directly; they must use the same selected connection and cancellation
  rules as the visible chat turn.

## Architecture

1. **Provider connection model:** Persist non-secret connection metadata only:
   stable connection ID, adapter type, user-visible name, endpoint, model
   inventory cache, selected capabilities, and whether the user enabled it.
   Store the credential under a separate OS-secret key derived from the
   connection ID.
2. **Secret-store abstraction:** Add a Core-facing `ISecretStore` with set/get/
   remove operations. Implement platform adapters using supported OS
   credential services. Reuse existing credential-store patterns only after
   extracting a provider-neutral contract. If the OS secure store is
   unavailable, fail with clear setup instructions; never fall back to clear
   text.
3. **Provider adapter contract:** Define typed capabilities and operations for
   model discovery, streaming completion, cancellation, tool-call support,
   vision, context limits, and bounded usage metadata. Local adapters retain
   their current behavior. Cloud adapters are separate and selected by a
   connection ID, not an arbitrary renderer URL/key pair.
4. **Trust boundary:** Renderer receives redacted connection metadata only.
   Electron main and preload expose narrow credential actions. Agent Host
   retrieves secrets just in time from the OS store; secrets never enter
   conversation records, task artifacts, logs, exceptions, environment dumps,
   settings exports, or diagnostics.
5. **Routing and consent:** Every conversation/task declares a selected
   connection. A route change displays provider and data destination before
   the first remote request. “Local only” rejects remote route IDs at the
   protocol boundary. No implicit provider fallback or model substitution.
6. **Network boundary:** Remote provider endpoints require HTTPS and strict
   response/request size and timeout bounds. Local adapters keep loopback HTTP
   support. User-configured LAN endpoints require an explicit local-network
   connection choice. Reject credentials in endpoint URLs, redirects to
   unapproved schemes, and unexpected cross-host redirects. Redact secrets and
   sensitive request content from telemetry and logs.
7. **Capability-aware UI:** Model selectors show provider, local/remote status,
   context, supported inputs, tool calling, and connection readiness. Explain
   unsupported features before users submit. Usage/cost is shown only when the
   provider returns verified data; never estimate it as fact.

## Delivery sequence

### Slice A — provider and secret contracts

- **Progress:** Cloud voice keys now use per-provider OS-protected storage on
  Windows and the Linux Secret Service. The renderer can save, check, replace,
  and remove keys; speech requests identify a provider but do not carry its
  credential. Core now exposes an `ISecretStore` contract with a shared Windows
  DPAPI/Linux Secret Service implementation. The voice-specific store delegates
  through it while retaining its previous Windows file path, DPAPI entropy, and
  Linux keyring attributes. Windows tests cover generic key round-trip,
  connection isolation, ciphertext at rest, removal, and unsafe IDs. macOS
  storage plus Linux live-keyring and corrupted/unavailable-store acceptance
  remain open.
- Define typed provider-connection metadata, provider capabilities, and
  per-request route identity.
- Add provider-neutral OS credential storage and tests for unavailable,
  missing, corrupted, and removed credentials.
- Add redaction checks for logs, serialized settings, chat exports, and
  diagnostics.
- Keep runtime behavior local-only in this slice.

### Slice B — local adapters through the gateway

- Route Ollama/OpenAI-compatible, LM Studio, and AirLLM through the new
  contract without changing defaults or existing settings.
- Remove duplicate direct provider calls in compaction and helper completions.
- Verify streaming, cancellation, model discovery, error reporting, and
  capacity fallback stay local and preserve current behavior.

### Slice C — first cloud adapter

- Add one explicitly selected, documented user-configured cloud provider.
- Add a connection setup screen that stores the key in the OS store, verifies
  the connection, fetches models, and supports revoke/remove.
- Add the remote-data notice and provider/model labels before sending any chat
  prompt or attachment.
- Verify streaming, cancellation, tool capability negotiation, error mapping,
  rate limits, key rotation, and secret redaction against a real account when
  available; deterministic tests alone do not establish provider acceptance.

### Slice D — more providers and hybrid workflows

- Add additional maintained adapters behind the same contract; do not add a
  provider just to inflate the catalog.
- Allow explicit per-task assignment and model combinations, including a local
  model for private work and a selected cloud model for another task.
- Add capacity-aware local scheduling and opt-in cost-aware selection only
  after capability and cost data are verified.

### Slice E — retire the blanket local-only audit

- Replace URL-string prohibitions with policy audits that prove: no secret in
  renderer/settings/logs; no remote route without a configured connection and
  user selection; HTTPS for cloud endpoints; explicit destination disclosure;
  offline-only mode blocks every remote request; and fallback cannot cross
  local/cloud boundaries.
- Keep legacy settings migration backward-compatible and preserve user model
  choice. Never silently reinterpret an old local endpoint as cloud.
- Update README, capability matrix, contributor guide, release notes, and
  Marketplace labels only as each provider reaches its acceptance bar.

## Verification matrix

| Area | Required evidence |
| --- | --- |
| Storage | OS secret store round-trip; missing/unavailable behavior; no clear-text fallback; settings and backup contain no secret |
| Privacy | User sees provider and destination before the first send; attachments and project context are included in the disclosure scope; local-only blocks remote routing |
| Chat behavior | Streaming order, cancellation, timeout, retry, tool-call negotiation, context bounds, and provider error recovery |
| Security | HTTPS enforcement, redirect handling, endpoint validation, key redaction, bounded payloads, no secret in logs or exports |
| Compatibility | Existing local Ollama/LM Studio/compatible endpoint and AirLLM workflows remain unchanged |
| Live acceptance | At least one real connection per adapter family, tested with a disposable key and no private test content |

## Constraints

- Do not send a prompt to a hosted provider merely because a local provider is
  unavailable or over capacity.
- Do not treat consumer subscriptions as API access unless that provider
  officially supports that flow.
- Do not embed provider keys, route credentials through prompts, or keep them
  in renderer local storage.
- Do not claim remote support from a model catalog card alone; a complete
  connection, chat, cancellation, and error journey must work.
- Do not weaken project-command sandboxing or privacy controls as a side effect
  of adding cloud inference.
