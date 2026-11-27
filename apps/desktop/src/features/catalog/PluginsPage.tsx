import { useEffect, useMemo, useState } from "react";
import {
  Button,
  EmptyState,
  StatusBadge,
} from "../../components/ui/Primitives";
import { NavIcon } from "../../components/ui/NavIcon";
import "./pluginsMcpHealth.css";
import type { Model, Route } from "../../app/types";
import { MarketplacePage } from "./MarketplacePage";
import { McpConnectionsPanel } from "./McpConnectionsPanel";
import { MarketplaceCatalogBrowser } from "./MarketplaceCatalogBrowser";
import { request } from "./marketplaceRequest";
import {
  createMarketplaceEntries,
  filterMarketplaceEntries,
  groupMarketplaceEntries,
  type MarketplaceCatalogSection,
  type Skill,
  type Tool,
  type CuratedCatalogEntry,
  type InternetMarketplaceItem,
  type MarketplaceEntry,
} from "./marketplaceEntries";
import { useMarketplaceMcp, type McpConnection, type McpTool } from "./useMarketplaceMcp";
import { refreshInstalledVoiceModels } from "../../services/nativeTts";
export { VoiceWorkbench } from "./VoiceWorkbench";

export function PluginsPage({
  onNavigate,
  onSelectAirLlmModel,
  onImageChange,
  onImportWorkflow,
}: {
  onNavigate?: (route: Route) => void;
  onSelectAirLlmModel?: (model: Model) => void;
  onImageChange?: (key: "endpoint" | "prompt" | "workflow" | "provider", value: string) => void;
  onImportWorkflow?: () => Promise<{ name: string; workflow: string } | null>;
} = {}) {
  const [view, setView] = useState<"catalog" | "models" | "voices" | "updates">("catalog");
  const [catalogSection, setCatalogSection] = useState<MarketplaceCatalogSection>("Discover");
  const [query, setQuery] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [curated, setCurated] = useState<CuratedCatalogEntry[]>([]);
  const [internetItems, setInternetItems] = useState<InternetMarketplaceItem[]>([]);
  const [internetCategory, setInternetCategory] = useState("all");
  const [internetLoading, setInternetLoading] = useState(false);
  const [internetError, setInternetError] = useState<string | null>(null);
  const [internetHasMore, setInternetHasMore] = useState(false);
  const [internetPage, setInternetPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState("Checking local runtime");
  const [runtimeModelCount, setRuntimeModelCount] = useState(0);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const mcp = useMarketplaceMcp(setNotice);
  const {
    connections,
    tools: mcpTools,
    selectedConnectionId,
    setSelectedConnectionId,
    serverId,
    setServerId,
    endpoint,
    setEndpoint,
    busy: mcpBusy,
    error: mcpError,
    connect: connectMcp,
    refreshHealth: refreshMcpHealth,
    downloadRea,
    connectRea,
    changeState: changeMcpState,
  } = mcp;

  const installMcpEntry = async (entry: MarketplaceEntry, connectionString?: string) => {
    if (entry.adapter === "local-mcp-filesystem") {
      setNotice("Choose one local folder to share with the read-only Filesystem MCP server.");
      const picked = await request("workspace.pickFolder");
      if (!picked.ok) {
        setNotice(picked.error?.message ?? "The folder picker could not be opened.");
        return;
      }
      const folderPath = (picked.result as { path?: string | null }).path;
      if (!folderPath) return;
      setNotice("Installing the pinned Filesystem MCP package and connecting locally…");
      await mcp.connectFilesystem(folderPath);
    } else if (entry.adapter === "local-mcp-playwright") {
      setNotice("Installing the pinned Playwright MCP package and connecting locally…");
      await mcp.connectPlaywright();
    } else if (entry.adapter === "local-mcp-postgres" && connectionString) {
      setNotice("Installing the pinned PostgreSQL MCP package and connecting to localhost…");
      await mcp.connectPostgres(connectionString);
    } else if (entry.adapter === "local-mcp-figma") {
      setNotice("Connecting to Figma's local desktop MCP server…");
      await mcp.connectLocalServer("figma-desktop", "http://127.0.0.1:3845/mcp");
    } else if (entry.adapter === "local-mcp-supabase") {
      setNotice("Connecting to the local Supabase CLI MCP endpoint…");
      await mcp.connectLocalServer("supabase-local", "http://127.0.0.1:54321/mcp");
    }
  };

  const installVoiceEntry = async (entry: MarketplaceEntry) => {
    if (voiceBusy) return;
    const isPiper = entry.adapter === "local-voice-piper";
    const isWhisper = entry.adapter === "local-voice-whisper";
    const isChatterbox = entry.adapter === "local-voice-chatterbox";
    const isPocketTts = entry.adapter === "local-voice-pocket-tts";
    const isQwen3 = entry.adapter === "local-voice-qwen3-tts";
    const method = isWhisper ? "whisper" : isChatterbox ? "chatterbox" : isPocketTts ? "pocket" : isQwen3 ? "qwen3" : isPiper ? "piper" : "kokoro";
    const modelName = isWhisper ? "Whisper large-v3" : isChatterbox ? "Chatterbox Nano" : isPocketTts ? "Pocket TTS" : isQwen3 ? "Qwen3-TTS 0.6B CustomVoice" : isPiper ? "Piper" : "Kokoro";
    const removingQwen3 = isQwen3 && localStorage.getItem("skai.voice.qwen3TtsInstalled") === "true";
    setVoiceBusy(true);
    setNotice(removingQwen3 ? `Removing ${modelName} and its local runtime…` : `Preparing an isolated local ${modelName} runtime…`);
    try {
      if (removingQwen3) {
        const removed = await request("voice.qwen3.remove");
        const state = removed.result as { removed?: boolean; error?: string } | undefined;
        if (!removed.ok || !state?.removed) throw new Error(state?.error ?? removed.error?.message ?? `${modelName} could not be removed.`);
        localStorage.removeItem("skai.voice.qwen3TtsInstalled");
        await refreshInstalledVoiceModels();
        setNotice(`${modelName} and its local runtime were removed from this device.`);
        return;
      }
      const started = await request(`voice.${method}.install.start`);
      if (!started.ok) throw new Error(started.error?.message ?? `${isPiper ? "Piper" : "Kokoro"} installation could not start.`);
      const deadline = Date.now() + (isQwen3 ? 90 : isPocketTts ? 35 : isChatterbox ? 45 : isWhisper ? 60 : 10) * 60_000;
      while (Date.now() < deadline) {
        const status = await request(`voice.${method}.install.status`);
        if (!status.ok) throw new Error(status.error?.message ?? `${isPiper ? "Piper" : "Kokoro"} installation status could not be read.`);
        const state = status.result as { installed?: boolean; status?: string; step?: string; error?: string };
        if (state.installed || state.status === "installed") {
          if (isWhisper) localStorage.setItem("skai.voice.whisperInstalled", "true");
          else {
            if (isPocketTts) localStorage.setItem("skai.voice.pocketTtsInstalled", "true");
            if (isQwen3) localStorage.setItem("skai.voice.qwen3TtsInstalled", "true");
            await refreshInstalledVoiceModels();
          }
          setNotice(`${modelName} is installed, checksum-verified, and ready for ${isWhisper ? "offline transcription" : "local speech"}.`);
          return;
        }
        if (state.status === "failed") throw new Error(state.error ?? `${modelName} installation failed.`);
        setNotice(state.step ? `${modelName} setup · ${state.step}` : `Installing ${modelName} locally…`);
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
      }
      throw new Error(`${modelName} setup is still running. Return to Marketplace later to check its installed status.`);
    } catch (installError) {
      setNotice(installError instanceof Error ? installError.message : `${modelName} installation failed.`);
    } finally { setVoiceBusy(false); }
  };

  const runModelTransformer = async (entry: MarketplaceEntry) => {
    const pickFolder = async (message: string) => {
      setNotice(message);
      const response = await request("workspace.pickFolder");
      if (!response.ok) throw new Error(response.error?.message ?? "The folder picker could not be opened.");
      const path = (response.result as { path?: string | null }).path;
      if (!path) throw new Error("No folder was selected.");
      return path;
    };
    try {
      const modelPath = await pickFolder("Choose the source model folder…");
      const outputPath = await pickFolder("Choose a different output folder…");
      const planResponse = await request("model.transformers.plan", { adapterId: entry.adapter, modelPath, outputPath });
      if (!planResponse.ok) throw new Error(planResponse.error?.message ?? "The model transformation plan could not be created.");
      const plan = planResponse.result as { command: string; canRun: boolean; warnings?: string[] };
      if (!plan.canRun) throw new Error([...(plan.warnings ?? []), "This adapter is available for inspection but not executable through Skai yet."].join(" "));
      if (!window.confirm(`Run this local model transformation?\n\n${plan.command}\n\n${(plan.warnings ?? []).join("\n")}`)) {
        setNotice("Model transformation cancelled before launch.");
        return;
      }
      const started = await request("model.transformers.start", { adapterId: entry.adapter, modelPath, outputPath, confirm: true });
      if (!started.ok) throw new Error(started.error?.message ?? "The model transformation could not start.");
      const run = started.result as { id: string };
      setNotice("Model transformation started. Skai will keep the output in the selected folder.");
      for (let attempt = 0; attempt < 7_200; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        const statusResponse = await request("model.transformers.status", { id: run.id });
        if (!statusResponse.ok) throw new Error(statusResponse.error?.message ?? "The model transformation status could not be read.");
        const status = statusResponse.result as { status: string; output?: string; error?: string };
        if (["completed", "failed", "cancelled"].includes(status.status)) {
          setNotice(status.status === "completed" ? "Model transformation completed. Review the output folder before adding it to a runtime." : status.error ?? `Model transformation ${status.status}.`);
          return;
        }
        if (attempt % 10 === 0) setNotice(`Model transformation running…${status.output ? ` ${status.output.slice(-180)}` : ""}`);
      }
      setNotice("Model transformation is still running. Reopen the adapter to inspect its status.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Model transformation failed.");
    }
  };

  const callMcpTool = async (connection: McpConnection, tool: McpTool, argumentsValue: Record<string, unknown>) => {
    const capabilities = tool.requiredCapabilities.length > 0
      ? tool.requiredCapabilities
      : [tool.isMutating ? "mcp.invoke.write" : "mcp.invoke.read"];
    const response = await request("mcp.tool.call", {
      connectionId: connection.connectionId,
      toolName: tool.toolName,
      approvalId: crypto.randomUUID(),
      capabilities,
      arguments: argumentsValue,
    });
    if (!response.ok) throw new Error(response.error?.message ?? "The MCP tool call failed.");
    const result = response.result as { isError?: boolean; text?: string };
    if (result.isError) throw new Error(result.text || "The MCP server reported a tool error.");
    return result.text ?? "Tool completed without text output.";
  };

  const changeCatalogSection = (next: MarketplaceCatalogSection, nextQuery?: string) => {
    setCatalogSection(next);
    setView(next === "Models" ? "models" : next === "Installed" || next === "Updates" ? "updates" : next === "Voices" ? "voices" : "catalog");
    if (!["Installed", "Staff Picks"].includes(next)) {
      setQuery(nextQuery ?? localStorage.getItem(`skai.marketplace.query.${next.toLowerCase()}`) ?? "");
      setSelectedId(null);
    }
  };

  const searchInternetMarketplace = async (category: string, page: number, replace: boolean) => {
    setInternetLoading(true);
    setInternetError(null);
    try {
      const response = await request("marketplace.internet.search", { category, query, page });
      if (!response.ok) {
        setInternetError(response.error?.message ?? "Internet Marketplace search failed.");
        return;
      }
      const result = response.result as { items?: InternetMarketplaceItem[]; hasMore?: boolean; page?: number };
      setInternetItems((current) => replace ? (result.items ?? []) : [...current, ...(result.items ?? [])]);
      setInternetPage(result.page ?? page);
      setInternetHasMore(Boolean(result.hasMore));
    } catch { setInternetError("Internet Marketplace search failed."); }
    finally { setInternetLoading(false); }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const [catalogResponse, skillsResponse, connectionsResponse] =
        await Promise.all([
          request("marketplace.catalog"),
          request("skills.list"),
          request("mcp.connections.list"),
        ]);
      void refreshInstalledVoiceModels();
      if (!catalogResponse.ok)
        throw new Error(
          catalogResponse.error?.message ??
            "Plugin catalog could not be loaded.",
        );
      if (!skillsResponse.ok)
        throw new Error(
          skillsResponse.error?.message ?? "Local skills could not be loaded.",
        );
      const catalog = catalogResponse.result as { tools?: Tool[]; catalogEntries?: CuratedCatalogEntry[] };
      setTools(catalog.tools ?? []);
      setCurated(catalog.catalogEntries ?? []);
      setSkills((skillsResponse.result as Skill[]) ?? []);
      if (connectionsResponse.ok) {
        const nextConnections =
          (connectionsResponse.result as { connections?: McpConnection[] })
            .connections ?? [];
        mcp.loadConnections(nextConnections);
      } else
        setNotice((current) =>
          current
            ? `${current} MCP connections could not be refreshed.`
            : "MCP connections could not be refreshed.",
        );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Plugins could not be loaded.",
      );
      setRuntimeStatus("unavailable");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (view !== "catalog" || loading) return;
    let active = true;
    const endpoint = localStorage.getItem("skai.endpoint") ?? "http://localhost:11434/v1";
    const provider = localStorage.getItem("skai.provider") ?? "Ollama";
    setRuntimeStatus("Checking");
    void request("models.runtime.status", { endpoint, provider }).then(async (response) => {
      if (!active) return;
      if (!response.ok || !(response.result as { available?: boolean } | undefined)?.available) {
        setRuntimeModelCount(0);
        setRuntimeStatus("unavailable");
        return;
      }
      const inventory = await request("models.list", { endpoint, provider });
      if (!active) return;
      const result = (inventory.result as Array<{ provider?: string }>) ?? [];
      setRuntimeModelCount(result.filter((model) => model.provider?.toLowerCase() === provider.toLowerCase()).length);
      setRuntimeStatus("ready");
    }).catch(() => { if (active) setRuntimeStatus("unavailable"); });
    return () => { active = false; };
  }, [loading, view]);
  useEffect(() => {
    if (catalogSection !== "Internet") return;
    const timer = window.setTimeout(() => void searchInternetMarketplace(internetCategory, 1, true), 300);
    return () => window.clearTimeout(timer);
  }, [catalogSection, internetCategory, query]);
  useEffect(() => {
    if (view === "catalog")
      localStorage.setItem(
        `skai.marketplace.query.${catalogSection.toLowerCase()}`,
        query,
      );
  }, [catalogSection, query, view]);

  const entries = useMemo(() => createMarketplaceEntries(skills, tools, connections, query, curated, internetItems), [connections, curated, internetItems, query, skills, tools]);
  const sectionEntries = useMemo(() => filterMarketplaceEntries(entries, catalogSection), [catalogSection, entries]);
  const selected = sectionEntries.find((entry) => entry.id === selectedId) ?? null;
  const groupedEntries = useMemo(() => groupMarketplaceEntries(sectionEntries), [sectionEntries]);
  return (
    <div className="feature-page plugins-page">
      <aside
        className="plugins-customize-nav"
        aria-label="Marketplace sections"
      >
        <div className="plugins-nav-brand">
          <span className="plugins-nav-brand-mark" aria-hidden="true"><NavIcon name="sparkle" /></span>
          <div>
            <strong>Marketplace</strong>
            <small>Local capability catalog</small>
          </div>
        </div>
        <p className="plugins-customize-label">CATEGORIES</p>
        {([
          ["Discover", "sparkle"],
          ["Internet", "marketplace"],
          ["Models", "model"],
          ["Voices", "activity"],
          ["Skills", "sparkle"],
          ["Tools", "terminal"],
          ["Installed & updates", "memory"],
        ] as const).map(([item, icon]) => {
          const active = item === "Installed & updates"
            ? catalogSection === "Installed" || catalogSection === "Updates"
            : item === "Tools"
            ? ["MCP Servers", "Skai built-ins", "Compatible plugins"].includes(catalogSection)
            : catalogSection === item;
          const destination: MarketplaceCatalogSection = item === "Installed & updates" ? "Updates" : item === "Tools" ? "MCP Servers" : item;
          return <button key={item} type="button" className={active ? "is-active" : ""} aria-current={active ? "page" : undefined} onClick={() => changeCatalogSection(destination)}><NavIcon name={icon} /><span>{item}</span>{item === "Models" && <small>Live</small>}{item === "Tools" && <small>{tools.length + skills.length}</small>}</button>;
        })}
        {["MCP Servers", "Skai built-ins", "Compatible plugins"].includes(catalogSection) && <div className="plugins-tool-subnav" role="tablist" aria-label="Tools categories">
          {(["MCP Servers", "Skai built-ins", "Compatible plugins"] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={catalogSection === item} className={catalogSection === item ? "is-active" : ""} onClick={() => changeCatalogSection(item)}>{item === "MCP Servers" ? "MCP servers" : item}</button>)}
        </div>}
        <div className="plugins-nav-note">
          <span className="plugins-nav-note-dot" aria-hidden="true" />
          <div><strong>Stays on this device</strong><small>Review source, runtime, and permissions before connecting.</small></div>
        </div>
      </aside>
      <div className="plugins-main">
        {view === "models" || view === "voices" || view === "updates" ? (
          <MarketplacePage
            key={view}
            initialSection={view === "models" ? "Models" : view === "voices" ? "Voices" : "Installed"}
            initialQuery={view === "models" ? query : undefined}
            onBack={() => changeCatalogSection("Discover")}
            onSectionChange={(section) => changeCatalogSection(section as MarketplaceCatalogSection)}
            onNavigate={onNavigate}
            onSelectAirLlmModel={onSelectAirLlmModel}
            onImageChange={onImageChange}
            onImportWorkflow={onImportWorkflow}
          />
        ) : (
          <>
            <header className="plugins-topbar">
              <div className="plugins-heading-lockup">
                <span className="plugins-heading-mark" aria-hidden="true"><NavIcon name={catalogSection === "Discover" ? "sparkle" : catalogSection === "Internet" ? "marketplace" : catalogSection === "MCP Servers" || catalogSection === "Skai built-ins" || catalogSection === "Compatible plugins" ? "terminal" : "project"} /></span>
                <div><p className="plugins-eyebrow">SKAI MARKETPLACE</p><h2>{catalogSection === "MCP Servers" ? "MCP servers" : catalogSection}</h2><p className="plugins-heading-description">{catalogSection === "Discover" ? "Search local models and inspect what can be installed on this device." : catalogSection === "Internet" ? "Discover public models, skills, tools, and MCP servers without implying they are safe or installable." : catalogSection === "MCP Servers" ? "Connect a local MCP server or review the available package." : catalogSection === "Skai built-ins" ? "Hand-picked capabilities already built into Skai." : catalogSection === "Compatible plugins" ? "Plugins and skills that work inside Skai Desktop." : `Browse ${catalogSection.toLowerCase()} available on this device.`}</p></div>
              </div>
              <div className="plugins-heading-meta"><StatusBadge tone={catalogSection === "Internet" ? "neutral" : "success"}>{catalogSection === "Internet" ? "Internet discovery" : "Local catalog"}</StatusBadge><span className="plugins-count">{sectionEntries.length} {catalogSection === "Discover" ? "available" : catalogSection.toLowerCase()}</span></div>
              <div className="plugins-topbar-actions">
                <label className="plugins-search">
                  <span className="sr-only">Search marketplace</span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={`Search ${catalogSection.toLowerCase()}`}
                  />
                </label>
                {catalogSection === "Internet" && <label className="plugins-search plugins-internet-filter"><span className="sr-only">Internet category</span><select value={internetCategory} onChange={(event) => setInternetCategory(event.target.value)}><option value="all">All online categories</option><option value="llm">LLM models</option><option value="image">Image models</option><option value="voice">Voice models</option><option value="skills">Skills</option><option value="tools">Developer tools</option><option value="mcp">MCP servers</option></select></label>}
                <Button
                  variant="ghost"
                  className="plugins-icon-button"
                  aria-label="Refresh marketplace"
                  title="Refresh marketplace"
                  disabled={loading}
                  onClick={() => void load()}
                >
                  <NavIcon name="refresh" />
                </Button>
                {catalogSection === "MCP Servers" && (
                  <Button
                    variant="primary"
                    className="plugins-add-button"
                    onClick={() =>
                      document.getElementById("plugins-endpoint")?.focus()
                    }
                  >
                    <NavIcon name="plus" />
                    Connect server
                  </Button>
                )}
              </div>
            </header>
            {notice && (
              <div className="plugins-catalog-notice" role="status">
                {notice}
              </div>
            )}
            {catalogSection === "Discover" && !query.trim() && (
              <section className="plugins-start-panel" aria-label="Marketplace actions">
                <div><p className="section-kicker">LOCAL WORKSPACE</p><h3>Marketplace</h3><p>Model search finds packages for local runtimes. Inference stays on your configured runtime.</p><div className="marketplace-runtime-state"><strong>Local runtime</strong><StatusBadge tone={runtimeStatus === "ready" ? "success" : runtimeStatus === "unavailable" ? "danger" : "warning"}>{runtimeStatus}</StatusBadge><span>{runtimeStatus === "ready" ? `${localStorage.getItem("skai.provider") ?? "Local runtime"} · ${runtimeModelCount} models` : "No responding local runtime detected"}</span></div></div>
                <div className="plugins-start-actions"><Button variant="primary" type="button" onClick={() => changeCatalogSection("Models")}>Search models</Button><Button variant="secondary" type="button" onClick={() => changeCatalogSection("MCP Servers")}>Connect MCP</Button><Button variant="secondary" type="button" onClick={() => changeCatalogSection("Updates")}>Installed &amp; updates</Button></div>
              </section>
            )}
            {error ? (
              <div className="surface-error" role="alert">
                <strong>Marketplace is unavailable</strong>
                <p>{error}</p>
                <Button variant="secondary" onClick={() => void load()}>
                  Retry
                </Button>
              </div>
            ) : loading || (catalogSection === "Internet" && internetLoading && sectionEntries.length === 0) ? (
              <EmptyState
                title={catalogSection === "Internet" ? "Searching the Internet Marketplace…" : "Loading Marketplace…"}
                description={catalogSection === "Internet" ? "Reading public registries and keeping source provenance attached to every result." : "Reading tools and skills available in Skai."}
              />
            ) : internetError && catalogSection === "Internet" ? (
              <div className="surface-error" role="alert"><strong>Internet discovery is unavailable</strong><p>{internetError}</p><Button variant="secondary" onClick={() => void searchInternetMarketplace(internetCategory, 1, true)}>Retry</Button></div>
            ) : sectionEntries.length === 0 ? (
              <EmptyState
                title="No matching items"
                description="Try another search or choose a different category."
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuery("");
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <MarketplaceCatalogBrowser
                groups={groupedEntries}
                selected={selected}
                connections={connections}
                busy={mcpBusy}
                error={mcpError}
                onToggleSelect={(id) => setSelectedId((current) => current === id ? null : id)}
                onDownloadRea={downloadRea}
                onConnectRea={connectRea}
              onFindLocalPackage={(entry) => changeCatalogSection("Models", entry.name)}
                onInstallMcp={(entry) => void installMcpEntry(entry)}
                onInstallVoice={(entry) => void installVoiceEntry(entry)}
                onRunModelTransformer={(entry) => void runModelTransformer(entry)}
                voiceBusy={voiceBusy}
              />
            )}
            {catalogSection === "Internet" && internetHasMore && <div className="plugins-catalog-more"><Button variant="secondary" disabled={internetLoading} onClick={() => void searchInternetMarketplace(internetCategory, internetPage + 1, false)}>{internetLoading ? "Loading online results…" : "Load more online results"}</Button></div>}
            {catalogSection === "MCP Servers" && <McpConnectionsPanel
              connections={connections}
              toolsByConnection={mcpTools}
              selectedConnectionId={selectedConnectionId}
              onSelectConnection={setSelectedConnectionId}
              busy={mcpBusy}
              onRefreshHealth={(connection) => void refreshMcpHealth(connection)}
              onChangeState={(connection, method) => void changeMcpState(connection, method)}
              serverId={serverId}
              onServerIdChange={setServerId}
              endpoint={endpoint}
              onEndpointChange={setEndpoint}
              onConnect={() => void connectMcp()}
              onCallTool={callMcpTool}
              error={mcpError}
            />}
          </>
        )}
      </div>
    </div>
  );
}
