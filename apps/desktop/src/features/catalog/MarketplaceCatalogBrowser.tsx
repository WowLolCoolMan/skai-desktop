import { useState } from "react";
import { Button, Card, StatusBadge } from "../../components/ui/Primitives";
import { NavIcon } from "../../components/ui/NavIcon";
import type { MarketplaceEntry } from "./marketplaceEntries";
import type { McpConnection } from "./useMarketplaceMcp";

type GroupedEntries = Array<[string, MarketplaceEntry[]]>;

function entryIcon(entry: MarketplaceEntry) {
  if (entry.kind === "Skills") return "sparkle" as const;
  if (entry.kind === "Catalog") {
    if (entry.category === "Coding") return "code" as const;
    if (entry.category === "Chat / General LLM") return "model" as const;
    if (entry.category === "Voice (TTS/STT)") return "audio" as const;
    if (entry.category === "Image Generation") return "image" as const;
  }
  return "terminal" as const;
}

function voicePipelineParts(entry: MarketplaceEntry) {
  switch (entry.adapter) {
    case "local-voice-whisper":
      return [
        ["Private runtime", "Isolated Python environment"],
        ["Recognition", "Whisper large-v3 · local transcription"],
        ["Output", "Reviewable transcript stays on this device"],
      ];
    case "local-voice-kokoro":
      return [
        ["Private runtime", "Isolated Python + ONNX runtime"],
        ["Speech output", "Kokoro INT8 model and English voice pack"],
        ["Playback", "Local WAV synthesis"],
      ];
    case "local-voice-piper":
      return [
        ["Private runtime", "Isolated Python + Piper runtime"],
        ["Speech output", "Pinned English ONNX voice model"],
        ["Playback", "Local WAV synthesis with attribution terms"],
      ];
    case "local-voice-chatterbox":
      return [
        ["Private runtime", "Isolated CPU Python environment"],
        ["Speech output", "Pinned Chatterbox Nano checkpoint"],
        ["Playback", "Resident local worker with built-in voice"],
      ];
    case "local-voice-pocket-tts":
      return [
        ["Private runtime", "Pinned Kyutai Windows x64 CPU binary"],
        ["Speech output", "Pinned English weights and built-in CC BY 4.0 voice"],
        ["Playback", "Local audio from a 127.0.0.1-only worker"],
      ];
    case "local-voice-qwen3-tts":
      return [
        ["Private runtime", "Pinned Python 3.12 + CPU PyTorch environment"],
        ["Speech output", "Qwen3-TTS 0.6B CustomVoice · 9 preset speakers"],
        ["Playback", "Offline complete WAV synthesis · no cloning or audio streaming"],
      ];
    default:
      return null;
  }
}

type Props = {
  groups: GroupedEntries;
  selected: MarketplaceEntry | null;
  connections: McpConnection[];
  busy: boolean;
  error: string | null;
  onToggleSelect: (id: string) => void;
  onDownloadRea: () => void;
  onConnectRea: () => void;
  onFindLocalPackage: (entry: MarketplaceEntry) => void;
  onInstallMcp: (entry: MarketplaceEntry, connectionString?: string) => void;
  onInstallVoice: (entry: MarketplaceEntry) => void;
  voiceBusy: boolean;
};

export function MarketplaceCatalogBrowser({
  groups, selected, connections, busy, error, onToggleSelect, onDownloadRea, onConnectRea, onFindLocalPackage, onInstallMcp, onInstallVoice, voiceBusy,
}: Props) {
  const [postgresUser, setPostgresUser] = useState("postgres");
  const [postgresDatabase, setPostgresDatabase] = useState("postgres");
  const [postgresPort, setPostgresPort] = useState("5432");
  const [postgresPassword, setPostgresPassword] = useState("");
  const [postgresError, setPostgresError] = useState<string | null>(null);

  const connectPostgres = (entry: MarketplaceEntry) => {
    const port = Number(postgresPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !postgresUser.trim() || !postgresDatabase.trim()) {
      setPostgresError("Enter a valid local database name, user, and port.");
      return;
    }
    const credentials = postgresPassword ? `${encodeURIComponent(postgresUser.trim())}:${encodeURIComponent(postgresPassword)}@` : `${encodeURIComponent(postgresUser.trim())}@`;
    const connectionString = `postgresql://${credentials}127.0.0.1:${port}/${encodeURIComponent(postgresDatabase.trim())}`;
    setPostgresError(null);
    setPostgresPassword("");
    onInstallMcp(entry, connectionString);
  };

  return (
<div className={`plugins-browser${selected ? " has-selection" : ""}`}>
                <div className="plugins-catalog" role="region" aria-label="Skai capabilities">
                  {groups.map(([category, categoryEntries]) => (
                    <section className="plugins-category" key={category}>
                      <h3>
                        {category}
                        <span className="plugins-category-count">
                          {categoryEntries.length}
                        </span>
                        <NavIcon name="chevron-right" />
                      </h3>
                      <div className="plugins-category-grid">
                        {categoryEntries.map((entry) => (
                          <article
                            className={`plugins-catalog-item${selected?.id === entry.id ? " is-selected" : ""}`}
                            key={entry.id}
                          >
                            <span
                              className={`plugins-catalog-icon ${entry.kind === "Skills" ? "is-skill" : "is-tool"}`}
                            >
                              <NavIcon
                                name={entryIcon(entry)}
                              />
                            </span>
                            <button
                              type="button"
                              className="plugins-catalog-copy"
                              onClick={() =>
                                onToggleSelect(entry.id)
                              }
                              aria-pressed={selected?.id === entry.id}
                            >
                              <strong>{entry.name}</strong>
                              <small>{entry.description}</small>
                              <span>{entry.availability}</span>
                            </button>
                            <Button
                              variant="ghost"
                              className="plugins-item-add"
                              aria-label={`Inspect ${entry.name}`}
                              title="View details"
                              onClick={() =>
                                onToggleSelect(entry.id)
                              }
                            >
                              <NavIcon
                                name={
                                  selected?.id === entry.id ? "close" : "plus"
                                }
                              />
                            </Button>
                          </article>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
                {selected && <aside
                  className="plugins-inspector"
                  aria-label="Marketplace details"
                >
                    <Card className="plugins-detail">
                      <div className="plugins-detail-heading">
                        <div>
                          <p className="section-kicker">MARKETPLACE DETAILS</p>
                          <h3>{selected.name}</h3>
                        </div>
                        <StatusBadge tone={selected.tone}>
                          {selected.status}
                        </StatusBadge>
                      </div>
                      <p>{selected.description}</p>
                      <dl className="model-detail-list">
                        <div>
                          <dt>Availability</dt>
                          <dd>{selected.availability}</dd>
                        </div>
                        <div>
                          <dt>Type</dt>
                          <dd>
                            {selected.kind === "Catalog"
                              ? selected.category === "MCP Servers" ? "Local MCP server integration" : "Self-hostable model listing"
                              : selected.kind === "Skills"
                                ? "Reusable local skill"
                                : "Tool integration"}
                          </dd>
                        </div>
                        <div>
                          <dt>Category</dt>
                          <dd>{selected.category}</dd>
                        </div>
                        <div>
                          <dt>Capabilities</dt>
                          <dd>{selected.access}</dd>
                        </div>
                        <div>
                          <dt>Publisher</dt>
                          <dd>{selected.source}</dd>
                        </div>
                        {selected.license && <div><dt>License</dt><dd>{selected.license}</dd></div>}
                      </dl>
                      {selected.kind === "Catalog" ? (
                        <div className="plugins-detail-note">
                            <strong>{selected.adapter === "local-model-search" ? "Local model adapter" : selected.adapter?.startsWith("local-mcp-") ? "Local MCP adapter" : selected.adapter?.startsWith("local-voice-") ? "Local voice adapter" : "Not available in Skai yet"}</strong>
                          <span>{selected.installReview}{selected.adapter === "local-model-search" ? " Model files download through the selected local runtime; inference remains on this device." : ""}</span>
                          {selected.adapter === "local-model-search" && (
                            <div className="plugins-detail-actions">
                              <Button variant="primary" type="button" onClick={() => onFindLocalPackage(selected)}>
                                Search local model packages
                              </Button>
                            </div>
                          )}
                          {["local-voice-kokoro", "local-voice-piper"].includes(selected.adapter ?? "") && (() => {
                            const isPiper = selected.adapter === "local-voice-piper";
                            const installKey = isPiper ? "skai.voice.piperInstalled" : "skai.voice.kokoroInstalled";
                            const installed = localStorage.getItem(installKey) === "true";
                            return <div className="plugins-detail-actions"><Button variant="primary" type="button" disabled={voiceBusy || installed} onClick={() => onInstallVoice(selected)}>{installed ? `Installed · ${isPiper ? "Piper" : "Kokoro"} ready` : voiceBusy ? "Installing local runtime…" : `Install ${isPiper ? "Piper" : "Kokoro"} locally`}</Button></div>;
                          })()}
                          {selected.adapter === "local-voice-whisper" && (() => {
                            const installed = localStorage.getItem("skai.voice.whisperInstalled") === "true";
                            return <div className="plugins-detail-actions"><Button variant="primary" type="button" disabled={voiceBusy || installed} onClick={() => onInstallVoice(selected)}>{installed ? "Installed · Whisper ready" : voiceBusy ? "Installing local model…" : "Install Whisper large-v3 · 3.09 GB"}</Button></div>;
                          })()}
                          {selected.adapter === "local-voice-chatterbox" && (() => {
                            const installed = localStorage.getItem("skai.voice.chatterboxInstalled") === "true";
                            return <div className="plugins-detail-actions"><Button variant="primary" type="button" disabled={voiceBusy || installed} onClick={() => onInstallVoice(selected)}>{installed ? "Installed · Chatterbox Nano ready" : voiceBusy ? "Preparing about 2 GB of local weights…" : "Install Chatterbox Nano · ~1.9 GB"}</Button></div>;
                          })()}
                          {selected.adapter === "local-voice-pocket-tts" && (() => {
                            const installed = localStorage.getItem("skai.voice.pocketTtsInstalled") === "true";
                            return <div className="plugins-detail-actions"><Button variant="primary" type="button" disabled={voiceBusy || installed} onClick={() => onInstallVoice(selected)}>{installed ? "Installed · Pocket TTS ready" : voiceBusy ? "Preparing about 250 MB of local voice files…" : "Install Pocket TTS · ~250 MB"}</Button></div>;
                          })()}
                          {selected.adapter === "local-voice-qwen3-tts" && (() => {
                            const installed = localStorage.getItem("skai.voice.qwen3TtsInstalled") === "true";
                            return <div className="plugins-detail-actions"><Button variant={installed ? "secondary" : "primary"} type="button" disabled={voiceBusy} onClick={() => onInstallVoice(selected)}>{installed ? voiceBusy ? "Removing Qwen3-TTS…" : "Remove Qwen3-TTS and free local storage" : voiceBusy ? "Preparing about 2.5 GB of model files and local runtime…" : "Install Qwen3-TTS 0.6B · ~2.5 GB"}</Button></div>;
                          })()}
                          {voicePipelineParts(selected) && <div className="plugins-voice-pipeline" aria-label="Local voice pipeline">
                            <strong>Local pipeline</strong>
                            <span>Each stage stays on this device. Review the runtime and model terms above before installing.</span>
                            <dl>{voicePipelineParts(selected)!.map(([label, detail]) => <div key={label}><dt>{label}</dt><dd>{detail}</dd></div>)}</dl>
                          </div>}
                          {["local-mcp-filesystem", "local-mcp-playwright"].includes(selected.adapter ?? "") && (
                            <div className="plugins-detail-actions">
                              <Button variant="primary" type="button" disabled={busy} onClick={() => onInstallMcp(selected)}>
                                {busy ? "Connecting…" : selected.adapter === "local-mcp-filesystem" ? "Choose folder and connect" : selected.adapter === "local-mcp-playwright" ? "Install and connect locally" : "Connect local Figma server"}
                              </Button>
                            </div>
                          )}
                          {selected.adapter === "local-mcp-postgres" && (
                            <div className="plugins-local-db-form">
                              <strong>Local database connection</strong>
                              <p>Only 127.0.0.1 is accepted. Skai holds this password in memory only while connecting.</p>
                              <label>Database<input value={postgresDatabase} onChange={(event) => setPostgresDatabase(event.target.value)} autoComplete="off" /></label>
                              <label>User<input value={postgresUser} onChange={(event) => setPostgresUser(event.target.value)} autoComplete="username" /></label>
                              <label>Port<input inputMode="numeric" value={postgresPort} onChange={(event) => setPostgresPort(event.target.value)} /></label>
                              <label>Password<input type="password" value={postgresPassword} onChange={(event) => setPostgresPassword(event.target.value)} autoComplete="new-password" /></label>
                              {postgresError && <span className="surface-error" role="alert">{postgresError}</span>}
                              <Button variant="primary" type="button" disabled={busy} onClick={() => connectPostgres(selected)}>
                                {busy ? "Installing and connecting…" : "Install and connect locally"}
                              </Button>
                            </div>
                          )}
                          {selected.adapter === "local-mcp-supabase" && (
                            <div className="plugins-detail-actions">
                              <Button variant="primary" type="button" disabled={busy} onClick={() => onInstallMcp(selected)}>
                                {busy ? "Connecting…" : "Connect local Supabase stack"}
                              </Button>
                            </div>
                          )}
                        </div>
                      ) : selected.id === "tool:rea" ? (
                        <div className="plugins-detail-note">
                          <strong>
                            Verified local MCP package · version 6.7.0
                          </strong>
                          <span>
                            Published by morluto. Requires Node.js 22.19.0+,
                            24.11.0+, or 26.0.0+. Download verifies the pinned
                            npm SHA-512 digest. Connecting runs the reviewed REA
                            stdio profile; tool calls remain governed by Skai
                            approval.
                          </span>
                          <div className="plugins-detail-actions">
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() => void onDownloadRea()}
                            >
                              {busy ? "Working…" : "Download package"}
                            </Button>
                            <Button
                              variant="primary"
                              disabled={
                                busy ||
                                connections.some(
                                  (connection) =>
                                    connection.serverId === "rea" &&
                                    connection.state === "healthy",
                                )
                              }
                              onClick={() => void onConnectRea()}
                            >
                              {connections.some(
                                (connection) =>
                                  connection.serverId === "rea" &&
                                  connection.state === "healthy",
                              )
                                ? "Connected"
                                : "Connect locally"}
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() =>
                                void window.skaiAgent?.updates?.open(
                                  "https://github.com/morluto/rea",
                                )
                              }
                            >
                              View source
                            </Button>
                          </div>
                          {error && (
                            <span className="surface-error" role="alert">
                              {error}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="plugins-detail-note">
                          <strong>Safety boundary</strong>
                          <span>
                            Skills are bounded instructions. Tools remain
                            governed by explicit permissions and the Agent Host;
                            write actions require approval.
                          </span>
                        </div>
                      )}
                    </Card>
                </aside>}
              </div>
  );
}
