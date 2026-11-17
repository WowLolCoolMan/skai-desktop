import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  EmptyState,
  StatusBadge,
} from "../../components/ui/Primitives";
import { NavIcon } from "../../components/ui/NavIcon";
import "./pluginsMcpHealth.css";
import type { Model, Route } from "../../app/types";
import { MarketplacePage } from "./MarketplacePage";
import {
  installedVoiceModels,
  saveVoiceSetting,
  selectedVoiceSettings,
  speakNativeResponse,
  stopNativeSpeech,
  voiceProfiles,
} from "../../services/nativeTts";

type Skill = {
  id: string;
  name: string;
  description: string;
  category: string;
  permissions: string[];
  source: string;
  enabled: boolean;
};
type Tool = {
  id: string;
  name: string;
  description: string;
  category: string;
  access: string;
  builtIn: boolean;
  status: string;
};
type McpConnection = {
  connectionId: string;
  serverId: string;
  transport: string;
  state: string;
  manifestDigest?: string;
  lastError: string;
  updatedAtUtc: string;
};
type McpTool = {
  serverId: string;
  toolName: string;
  description: string;
  isMutating: boolean;
  requiredCapabilities: string[];
};

type WorkbenchVoiceProfile = {
  id: string;
  name: string;
  engineId: string;
  clipNames: string[];
  status: "Ready" | "Changes pending" | "Building" | "Adapter unavailable";
  updatedAt: string;
};

type StoredVoiceClip = {
  key: string;
  profileId: string;
  name: string;
  blob: Blob;
  storedAt: string;
};

const WORKBENCH_PROFILES_KEY = "skai.voice.workbench.profiles";
const WORKBENCH_NOTICE_KEY = "skai.voice.workbench.rightsNoticeAcknowledged";
const VOICE_CLIPS_DB = "skai-voice-workbench";
const VOICE_CLIPS_STORE = "clips";

type MarketplaceHubSection = "Discover" | "Staff Picks" | "Models" | "MCP Servers" | "Skills" | "Plugins" | "Installed";
type StaffPickKind = "Model" | "MCP server" | "Skill" | "Plugin" | "Voice pack" | "Persona" | "Highlight";
type StaffPickAction =
  | { label: string; type: "external"; url: string }
  | { label: string; type: "section"; section: MarketplaceHubSection; query?: string }
  | { label: string; type: "route"; route: Route };
type StaffPick = { id: string; kind: StaffPickKind; title: string; description: string; details: string; publisher: string; icon: "model" | "activity" | "sparkle" | "terminal" | "project" | "image"; actions: StaffPickAction[] };

// Developers can curate any marketplace resource or a general highlight here.
// Type-specific installs should route into the corresponding reviewed catalog flow.
const staffPicks: StaffPick[] = [
  { id: "sophon-realtime", kind: "Model", title: "Sophon-Realtime v1", description: "Open full-duplex speech-to-speech by Adventists.ai, with expressive voice and interruption handling.", details: "Apache-2.0 · Recommended Tag build: about 42 GB and an 80 GB GPU · Self-hosting requires Linux and CUDA.", publisher: "Adventists.ai", icon: "activity", actions: [{ label: "Open model card", type: "external", url: "https://huggingface.co/adventists-ai/Sophon-Realtime-v1" }, { label: "Browse models", type: "section", section: "Models", query: "adventists-ai/Sophon-Realtime-v1" }] },
  { id: "lfm3-omni-2b", kind: "Model", title: "LFM3-Omni-2B", description: "Compact all-in-one model from Liquid AI for text, images, video, and audio, with text or speech output.", details: "LFM Open License v1.0 · 32K context · GGUF is supported by llama.cpp for local use.", publisher: "Liquid AI", icon: "model", actions: [{ label: "Open model card", type: "external", url: "https://huggingface.co/LiquidAI/LFM3-Omni-2B" }, { label: "Find GGUF build", type: "section", section: "Models", query: "LiquidAI/LFM3-Omni-2B-GGUF" }] },
];

function StaffPicksPanel({ onNavigate, onNavigateRoute }: { onNavigate: (section: MarketplaceHubSection, query?: string) => void; onNavigateRoute: (route: Route) => void }) {
  const iconFor: Record<StaffPickKind, StaffPick["icon"]> = { Model: "model", "MCP server": "terminal", Skill: "sparkle", Plugin: "project", "Voice pack": "activity", Persona: "sparkle", Highlight: "image" };
  return <section className="marketplace-staff-picks" aria-label="Developer staff picks">
    <header className="plugins-topbar"><div><h2>Staff Picks</h2><p className="page-description">Developer-curated models, skills, voices, personas, plugins, servers, and other things worth a look.</p></div></header>
    {staffPicks.length === 0 ? <EmptyState title="No staff picks yet" description="Developer-curated Marketplace highlights will appear here." /> : <div className="marketplace-staff-picks-list">{staffPicks.map((pick) => <article className="marketplace-developer-pick" key={pick.id}>
      <div className="marketplace-developer-pick-mark" aria-hidden="true"><NavIcon name={iconFor[pick.kind] ?? pick.icon} /></div>
      <div className="marketplace-developer-pick-copy"><div className="marketplace-developer-pick-heading"><h3>{pick.title}</h3><span className="marketplace-developer-favorite"><span aria-hidden="true">★</span> Developer Favorite</span><StatusBadge tone="neutral">{pick.kind}</StatusBadge></div><p>{pick.description}</p><small>{pick.details} · {pick.publisher}</small></div>
      <div className="marketplace-developer-pick-actions">{pick.actions.map((action) => <Button key={`${pick.id}:${action.label}`} variant={action.type === "section" ? "primary" : "secondary"} type="button" onClick={() => { if (action.type === "external") void window.skaiAgent?.updates?.open(action.url); else if (action.type === "section") onNavigate(action.section, action.query); else onNavigateRoute(action.route); }}>{action.label}</Button>)}</div>
    </article>)}</div>}
  </section>;
}


function openVoiceClipStore(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(VOICE_CLIPS_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(VOICE_CLIPS_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function storeVoiceClip(profileId: string, file: File): Promise<boolean> {
  const database = await openVoiceClipStore();
  if (!database) return false;
  return new Promise((resolve) => {
    const transaction = database.transaction(VOICE_CLIPS_STORE, "readwrite");
    const clip: StoredVoiceClip = {
      key: `${profileId}:${file.name}`,
      profileId,
      name: file.name,
      blob: file,
      storedAt: new Date().toISOString(),
    };
    transaction.objectStore(VOICE_CLIPS_STORE).put(clip);
    transaction.oncomplete = () => { database.close(); resolve(true); };
    transaction.onerror = () => { database.close(); resolve(false); };
  });
}

function loadWorkbenchProfiles(): WorkbenchVoiceProfile[] {
  try {
    const value = JSON.parse(localStorage.getItem(WORKBENCH_PROFILES_KEY) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is WorkbenchVoiceProfile => Boolean(item && typeof item === "object" && typeof (item as WorkbenchVoiceProfile).id === "string" && typeof (item as WorkbenchVoiceProfile).name === "string"));
  } catch {
    return [];
  }
}

function saveWorkbenchProfiles(profiles: WorkbenchVoiceProfile[]) {
  localStorage.setItem(WORKBENCH_PROFILES_KEY, JSON.stringify(profiles.slice(0, 24)));
}

function request(method: string, params?: Record<string, unknown>) {
  return (
    window.skaiAgent?.request(method, params) ??
    Promise.resolve({
      v: 1,
      id: `plugins-${method}`,
      ok: false,
      error: {
        code: "BRIDGE_UNAVAILABLE",
        message: "The Electron agent bridge is unavailable.",
      },
    })
  );
}

export function VoiceWorkbench({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState(selectedVoiceSettings);
  const [workbenchProfiles, setWorkbenchProfiles] = useState<WorkbenchVoiceProfile[]>(loadWorkbenchProfiles);
  const [activeWorkbenchId, setActiveWorkbenchId] = useState(() => loadWorkbenchProfiles()[0]?.id ?? "");
  const [newProfileName, setNewProfileName] = useState("");
  const [clipStorageNotice, setClipStorageNotice] = useState<string | null>(null);
  const [rightsNoticeOpen, setRightsNoticeOpen] = useState(() => localStorage.getItem(WORKBENCH_NOTICE_KEY) !== "true");
  const activeWorkbench = workbenchProfiles.find((item) => item.id === activeWorkbenchId) ?? null;
  const update = (
    key:
      "profileId" | "primaryModelId" | "lowResourceMode" | "voiceOutputEnabled",
    value: string | boolean,
  ) => {
    saveVoiceSetting(key, value);
    setSettings(selectedVoiceSettings());
  };
  const profile =
    voiceProfiles.find((item) => item.id === settings.profileId) ??
    voiceProfiles[0];
  const updateWorkbench = (change: Partial<WorkbenchVoiceProfile>) => {
    if (!activeWorkbench) return;
    const next = workbenchProfiles.map((item) => item.id === activeWorkbench.id ? { ...item, ...change, updatedAt: new Date().toISOString() } : item);
    setWorkbenchProfiles(next);
    saveWorkbenchProfiles(next);
  };
  const createWorkbenchProfile = () => {
    const name = newProfileName.trim();
    if (!name) return;
    const created: WorkbenchVoiceProfile = { id: `voice-${crypto.randomUUID()}`, name, engineId: settings.primaryModelId, clipNames: [], status: "Changes pending", updatedAt: new Date().toISOString() };
    const next = [...workbenchProfiles, created];
    setWorkbenchProfiles(next); saveWorkbenchProfiles(next); setActiveWorkbenchId(created.id); setNewProfileName("");
  };
  const addClips = async (files: FileList | null) => {
    if (!activeWorkbench || !files?.length) return;
    const selected = [...files].slice(0, 12).filter((file) => /\.(wav|mp3|m4a|ogg|flac)$/i.test(file.name));
    if (!selected.length) return;
    const names = selected.map((file) => file.name);
    const stored = await Promise.all(selected.map((file) => storeVoiceClip(activeWorkbench.id, file)));
    if (stored.some((value) => !value)) {
      setClipStorageNotice("Clip storage is unavailable; the file names were kept, but the audio bytes were not saved.");
    } else {
      setClipStorageNotice("Audio clips are stored locally on this device. No audio was uploaded.");
    }
    updateWorkbench({ clipNames: [...new Set([...activeWorkbench.clipNames, ...names])].slice(0, 48), status: "Changes pending" });
  };
  const acknowledgeRightsNotice = () => { localStorage.setItem(WORKBENCH_NOTICE_KEY, "true"); setRightsNoticeOpen(false); };
  return (
    <div className="voice-workbench-view">
      <header className="voice-workbench-header">
        <Button variant="ghost" onClick={onBack}>
          <NavIcon name="chevron-left" />
          Back to Marketplace
        </Button>
        <div>
          <p className="eyebrow">MARKETPLACE · VOICE</p>
          <h2>Voice Workbench</h2>
          <p>Shape Skai’s local voice without leaving the catalog.</p>
        </div>
      </header>
      {rightsNoticeOpen && <Card className="voice-workbench-notice"><p className="section-kicker">ONE-TIME NOTICE</p><h3>Use voice clips responsibly</h3><p>Only create an identifiable voice profile when you have the person’s permission or the rights to use the recordings. Skai keeps profile metadata local and does not treat a voice profile as proof of identity.</p><Button variant="primary" type="button" onClick={acknowledgeRightsNotice}>I understand</Button></Card>}
      <div className="voice-workbench-grid">
        <Card>
          <p className="section-kicker">VOICE PROFILES</p>
          <h3>Reusable voices</h3>
          <p className="marketplace-muted">Create a profile, add clips over time, and keep the last working version while a compatible adapter is pending.</p>
          <div className="voice-workbench-profile-list">{workbenchProfiles.length === 0 ? <p className="settings-help">No custom voice profiles yet.</p> : workbenchProfiles.map((item) => <button key={item.id} type="button" className={item.id === activeWorkbenchId ? "is-active" : ""} onClick={() => setActiveWorkbenchId(item.id)}><strong>{item.name}</strong><small>{item.clipNames.length} clips · {item.status}</small></button>)}</div>
          <div className="voice-workbench-create"><input value={newProfileName} onChange={(event) => setNewProfileName(event.target.value)} placeholder="New profile name" aria-label="New voice profile name" /><Button variant="secondary" type="button" onClick={createWorkbenchProfile} disabled={!newProfileName.trim()}>Create</Button></div>
        </Card>
        <Card>
          <p className="section-kicker">VOICE PROFILE</p>
          <h3>{profile.name}</h3>
          <p>{profile.description}</p>
          <label className="marketplace-field">
            Profile
            <select
              value={settings.profileId}
              onChange={(event) => update("profileId", event.target.value)}
            >
              {voiceProfiles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <div className="voice-workbench-actions">
            <Button
              variant="primary"
              onClick={() =>
                void speakNativeResponse(
                  "Skai voice preview. Your Voice Workbench settings are working.",
                  true,
                )
              }
            >
              Preview voice
            </Button>
            <Button variant="ghost" onClick={stopNativeSpeech}>
              Stop
            </Button>
          </div>
        </Card>
        <Card>
          <p className="section-kicker">LOCAL RUNTIME</p>
          <h3>Choose where speech runs</h3>
          <label className="marketplace-field">
            Primary runtime
            <select
              value={settings.primaryModelId}
              onChange={(event) => update("primaryModelId", event.target.value)}
            >
              {installedVoiceModels.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name}
                </option>
              ))}
            </select>
          </label>
          <p className="marketplace-muted">
            Additional runtimes can be installed from the Voices catalog when
            available.
          </p>
          <label className="marketplace-toggle">
            <input
              type="checkbox"
              checked={settings.voiceOutputEnabled}
              onChange={(event) =>
                update("voiceOutputEnabled", event.target.checked)
              }
            />
            <span>
              <strong>Speak completed replies</strong>
              <small>Keep voice output opt-in.</small>
            </span>
          </label>
          <label className="marketplace-toggle">
            <input
              type="checkbox"
              checked={settings.lowResourceMode}
              onChange={(event) =>
                update("lowResourceMode", event.target.checked)
              }
            />
            <span>
              <strong>Low-resource mode</strong>
              <small>Prefer a smaller CPU-first runtime.</small>
            </span>
          </label>
        </Card>
        <Card>
          <p className="section-kicker">CLIPS</p>
          <h3>{activeWorkbench?.name ?? "Choose a profile"}</h3>
          {activeWorkbench ? <><p className="marketplace-muted">Add recordings incrementally. Leaving the page or first use can queue a rebuild once an adapter is connected.</p><input type="file" accept=".wav,.mp3,.m4a,.ogg,.flac,audio/*" multiple onChange={(event) => void addClips(event.target.files)} aria-label="Add voice clips" /><div className="voice-workbench-clip-list">{activeWorkbench.clipNames.length === 0 ? <p className="settings-help">No clips attached.</p> : activeWorkbench.clipNames.map((name) => <span key={name}>{name}</span>)}</div>{clipStorageNotice && <p className="settings-help" role="status">{clipStorageNotice}</p>}<div className="voice-workbench-status" role="status"><strong>{activeWorkbench.status}</strong><small>{activeWorkbench.status === "Changes pending" ? "A compatible voice adapter is required before a clone can be built." : "Profile metadata and selected audio clips are stored locally."}</small></div></> : <p className="settings-help">Create or choose a profile to add clips.</p>}
        </Card>
      </div>
    </div>
  );
}

export function PluginsPage({
  onNavigate,
  onSelectAirLlmModel,
}: {
  onNavigate?: (route: Route) => void;
  onSelectAirLlmModel?: (model: Model) => void;
} = {}) {
  const [view, setView] = useState<"catalog" | "models" | "installed" | "staff-picks">("catalog");
  const [catalogSection, setCatalogSection] = useState<MarketplaceHubSection>("Discover");
  const [query, setQuery] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [mcpTools, setMcpTools] = useState<Record<string, McpTool[]>>({});
  const [selectedConnectionId, setSelectedConnectionId] = useState<
    string | null
  >(null);
  const [serverId, setServerId] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const changeCatalogSection = (next: MarketplaceHubSection, nextQuery?: string) => {
    setCatalogSection(next);
    setView(next === "Models" ? "models" : next === "Installed" ? "installed" : next === "Staff Picks" ? "staff-picks" : "catalog");
    if (!["Models", "Installed", "Staff Picks"].includes(next)) {
      setQuery(nextQuery ?? localStorage.getItem(`skai.marketplace.query.${next.toLowerCase()}`) ?? "");
      setSelectedId(null);
    }
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
      if (!catalogResponse.ok)
        throw new Error(
          catalogResponse.error?.message ??
            "Plugin catalog could not be loaded.",
        );
      if (!skillsResponse.ok)
        throw new Error(
          skillsResponse.error?.message ?? "Local skills could not be loaded.",
        );
      const catalog = catalogResponse.result as { tools?: Tool[] };
      setTools(catalog.tools ?? []);
      setSkills((skillsResponse.result as Skill[]) ?? []);
      if (connectionsResponse.ok) {
        const nextConnections =
          (connectionsResponse.result as { connections?: McpConnection[] })
            .connections ?? [];
        setConnections(nextConnections);
        setSelectedConnectionId((current) =>
          current &&
          nextConnections.some(
            (connection) => connection.connectionId === current,
          )
            ? current
            : (nextConnections[0]?.connectionId ?? null),
        );
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
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (view === "catalog")
      localStorage.setItem(
        `skai.marketplace.query.${catalogSection.toLowerCase()}`,
        query,
      );
  }, [catalogSection, query, view]);

  const entries = useMemo(() => {
    const term = query.trim().toLowerCase();
    const skillEntries = skills.map((skill) => ({
      id: `skill:${skill.id}`,
      kind: "Skills" as const,
      name: skill.name,
      description: skill.description,
      category: "Compatible plugins",
      access: skill.permissions.join(" · ") || "No extra permissions",
      status: skill.enabled ? "Enabled" : "Disabled",
      availability:
        skill.source === "built-in" ? "Built into Skai" : "Installed locally",
      installed: skill.source !== "built-in",
      tone: skill.enabled ? ("success" as const) : ("neutral" as const),
      source: skill.source,
    }));
    const toolEntries = [
      ...tools,
      {
        id: "rea",
        name: "REA · Reverse Engineering Agent",
        description:
          "Downloadable local MCP server for reverse engineering software and application behavior.",
        category: "Developer Tools",
        access: "Local stdio MCP · explicit tool approval",
        builtIn: false,
        status: "Downloadable MCP",
      },
    ].map((tool) => ({
      id: `tool:${tool.id}`,
      kind: "Tools" as const,
      name: tool.name,
      description: tool.description,
      category:
        tool.id === "rea"
          ? "MCP servers"
          : tool.builtIn
            ? "Skai built-ins"
            : "Compatible plugins",
      access: tool.access,
      status: tool.builtIn ? "Built in" : tool.status,
      availability:
        tool.id === "rea"
          ? "Downloadable MCP · morluto"
          : tool.builtIn
            ? "Available in Skai"
            : "Installed locally",
      installed:
        tool.id === "rea"
          ? connections.some(
              (connection) =>
                connection.serverId === "rea" && connection.state === "healthy",
            )
          : tool.builtIn || tool.status.toLowerCase().includes("installed"),
      tone:
        tool.builtIn || tool.id === "rea"
          ? ("success" as const)
          : ("neutral" as const),
      source:
        tool.id === "rea"
          ? "morluto · github.com/morluto/rea"
          : "Marketplace catalog",
    }));
    return [...skillEntries, ...toolEntries].filter((entry) => {
      return (
        (!term ||
          `${entry.name} ${entry.description} ${entry.category} ${entry.access} ${entry.source}`
            .toLowerCase()
            .includes(term))
      );
    });
  }, [query, skills, tools]);
  const sectionEntries = useMemo(() => entries.filter((entry) => {
    if (catalogSection === "Skills") return entry.kind === "Skills";
    if (catalogSection === "MCP Servers") return entry.kind === "Tools" && (entry.id === "tool:rea" || /mcp/i.test(entry.category));
    if (catalogSection === "Plugins") return entry.kind === "Tools" && entry.id !== "tool:rea" && !/mcp/i.test(entry.category);
    return true;
  }), [catalogSection, entries]);
  const selected = sectionEntries.find((entry) => entry.id === selectedId) ?? null;
  const groupedEntries = useMemo(() => {
    const groups = new Map<string, typeof sectionEntries>();
    for (const entry of sectionEntries)
      groups.set(
        entry.category || (entry.kind === "Skills" ? "Skills" : "Tools"),
        [
          ...(groups.get(
            entry.category || (entry.kind === "Skills" ? "Skills" : "Tools"),
          ) ?? []),
          entry,
        ],
      );
    return [...groups.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    );
  }, [sectionEntries]);
  const connectMcp = async () => {
    if (!serverId.trim() || !endpoint.trim()) return;
    setMcpBusy(true);
    setMcpError(null);
    try {
      const response = await request("mcp.connection.connect", {
        serverId: serverId.trim(),
        endpoint: endpoint.trim(),
        transport: "streamable-http",
      });
      if (!response.ok)
        throw new Error(response.error?.message ?? "MCP connection failed.");
      const result = response.result as {
        connection: McpConnection;
        tools?: McpTool[];
      };
      setConnections((current) => [
        result.connection,
        ...current.filter(
          (item) => item.connectionId !== result.connection.connectionId,
        ),
      ]);
      setMcpTools((current) => ({
        ...current,
        [result.connection.connectionId]: result.tools ?? [],
      }));
      setSelectedConnectionId(result.connection.connectionId);
      setServerId("");
      setEndpoint("");
    } catch (connectError) {
      setMcpError(
        connectError instanceof Error
          ? connectError.message
          : "MCP connection failed.",
      );
    } finally {
      setMcpBusy(false);
    }
  };
  const refreshMcpHealth = async (connection: McpConnection) => {
    setMcpBusy(true);
    setMcpError(null);
    try {
      const response = await request("mcp.tools.list", {
        connectionId: connection.connectionId,
      });
      if (!response.ok)
        throw new Error(
          response.error?.message ?? "The MCP health check failed.",
        );
      const result = response.result as {
        connected: boolean;
        tools?: McpTool[];
        connection?: McpConnection;
      };
      if (result.connection)
        setConnections((current) =>
          current.map((item) =>
            item.connectionId === connection.connectionId
              ? result.connection!
              : item,
          ),
        );
      setMcpTools((current) => ({
        ...current,
        [connection.connectionId]: result.tools ?? [],
      }));
      setNotice(
        result.connected
          ? `${connection.serverId} responded. The tool manifest and connection health are current.`
          : `${connection.serverId} did not respond; its last known health is shown.`,
      );
    } catch (healthError) {
      setMcpError(
        healthError instanceof Error
          ? healthError.message
          : "The MCP health check failed.",
      );
    } finally {
      setMcpBusy(false);
    }
  };
  const downloadRea = async () => {
    setMcpBusy(true);
    setMcpError(null);
    try {
      const response = await request("mcp.marketplace.download", { id: "rea" });
      if (!response.ok)
        throw new Error(
          response.error?.message ?? "REA package download failed.",
        );
      const result = response.result as {
        name: string;
        version: string;
        fileName: string;
        filePath: string;
        sizeBytes: number;
        sha256: string;
        integrity: string;
      };
      setNotice(
        `${result.name} ${result.version} downloaded to ${result.filePath}. npm SHA-512 integrity verified.`,
      );
    } catch (downloadError) {
      setMcpError(
        downloadError instanceof Error
          ? downloadError.message
          : "REA package download failed.",
      );
    } finally {
      setMcpBusy(false);
    }
  };
  const connectRea = async () => {
    setMcpBusy(true);
    setMcpError(null);
    try {
      const response = await request("mcp.connection.connect", {
        serverId: "rea",
        transport: "stdio",
        profileId: "rea",
      });
      if (!response.ok)
        throw new Error(response.error?.message ?? "REA could not be started.");
      const result = response.result as {
        connection: McpConnection;
        tools?: McpTool[];
      };
      setConnections((current) => [
        result.connection,
        ...current.filter(
          (item) => item.connectionId !== result.connection.connectionId,
        ),
      ]);
      setMcpTools((current) => ({
        ...current,
        [result.connection.connectionId]: result.tools ?? [],
      }));
      setSelectedConnectionId(result.connection.connectionId);
      setNotice(
        `REA connected locally with ${result.tools?.length ?? 0} tools. Review each tool permission before use.`,
      );
    } catch (connectError) {
      setMcpError(
        connectError instanceof Error
          ? connectError.message
          : "REA could not be started.",
      );
    } finally {
      setMcpBusy(false);
    }
  };
  const changeMcpState = async (
    connection: McpConnection,
    method: "mcp.connection.disconnect" | "mcp.connection.revoke",
  ) => {
    setMcpBusy(true);
    setMcpError(null);
    try {
      const response = await request(method, {
        connectionId: connection.connectionId,
      });
      if (!response.ok)
        throw new Error(
          response.error?.message ?? "MCP connection update failed.",
        );
      const updated = response.result as McpConnection;
      setConnections((current) =>
        current.map((item) =>
          item.connectionId === updated.connectionId ? updated : item,
        ),
      );
      setMcpTools((current) => ({ ...current, [updated.connectionId]: [] }));
    } catch (stateError) {
      setMcpError(
        stateError instanceof Error
          ? stateError.message
          : "MCP connection update failed.",
      );
    } finally {
      setMcpBusy(false);
    }
  };

  return (
    <div className="feature-page plugins-page">
      <aside
        className="plugins-customize-nav"
        aria-label="Marketplace sections"
      >
        <p className="plugins-customize-title">Marketplace</p>
        {([
          ["Discover", "sparkle"],
          ["Staff Picks", "sparkle"],
          ["Models", "model"],
          ["MCP Servers", "terminal"],
          ["Skills", "sparkle"],
          ["Plugins", "project"],
          ["Installed", "memory"],
        ] as const).map(([item, icon]) => <button key={item} type="button" className={catalogSection === item ? "is-active" : ""} aria-current={catalogSection === item ? "page" : undefined} onClick={() => changeCatalogSection(item)}><NavIcon name={icon} />{item}</button>)}
      </aside>
      <div className="plugins-main">
        {view === "models" || view === "installed" ? (
          <MarketplacePage
            initialSection={view === "models" ? "Models" : "Installed"}
            initialQuery={view === "models" ? query : undefined}
            onBack={() => changeCatalogSection("Discover")}
            onNavigate={onNavigate}
            onSelectAirLlmModel={onSelectAirLlmModel}
          />
        ) : view === "staff-picks" ? (
          <StaffPicksPanel onNavigate={changeCatalogSection} onNavigateRoute={(route) => onNavigate?.(route)} />
        ) : (
          <>
            <header className="plugins-topbar">
              <h2>
                {catalogSection}
                <span className="plugins-count">{sectionEntries.length} {catalogSection === "Discover" ? "available in Skai" : catalogSection.toLowerCase()}</span>
              </h2>
              <div className="plugins-topbar-actions">
                <label className="plugins-search">
                  <span className="sr-only">Search marketplace</span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={`Search ${catalogSection.toLowerCase()}`}
                  />
                </label>
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
            {error ? (
              <div className="surface-error" role="alert">
                <strong>Marketplace is unavailable</strong>
                <p>{error}</p>
                <Button variant="secondary" onClick={() => void load()}>
                  Retry
                </Button>
              </div>
            ) : loading ? (
              <EmptyState
                title="Loading Marketplace…"
                description="Reading tools and skills available in Skai."
              />
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
              <div className="plugins-browser">
                <div className="plugins-catalog" aria-label="Skai capabilities">
                  {groupedEntries.map(([category, categoryEntries]) => (
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
                                name={
                                  entry.kind === "Skills"
                                    ? "sparkle"
                                    : "project"
                                }
                              />
                            </span>
                            <button
                              type="button"
                              className="plugins-catalog-copy"
                              onClick={() =>
                                setSelectedId((current) =>
                                  current === entry.id ? null : entry.id,
                                )
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
                                setSelectedId((current) =>
                                  current === entry.id ? null : entry.id,
                                )
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
                <aside
                  className="plugins-inspector"
                  aria-label="Plugin details"
                >
                  {selected ? (
                    <Card className="plugins-detail">
                      <div className="plugins-detail-heading">
                        <div>
                          <p className="section-kicker">PLUGIN DETAILS</p>
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
                            {selected.kind === "Skills"
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
                      </dl>
                      {selected.id === "tool:rea" ? (
                        <div className="plugins-detail-note">
                          <strong>
                            Verified local MCP package · version 6.9.0
                          </strong>
                          <span>
                            Published by morluto. Requires Node.js 22.23.4+,
                            24.22.1+, or 26.12.1+. Download verifies the pinned
                            npm SHA-512 digest. Connecting runs the reviewed REA
                            stdio profile; tool calls remain governed by Skai
                            approval.
                          </span>
                          <div className="plugins-detail-actions">
                            <Button
                              variant="secondary"
                              disabled={mcpBusy}
                              onClick={() => void downloadRea()}
                            >
                              {mcpBusy ? "Working…" : "Download package"}
                            </Button>
                            <Button
                              variant="primary"
                              disabled={
                                mcpBusy ||
                                connections.some(
                                  (connection) =>
                                    connection.serverId === "rea" &&
                                    connection.state === "healthy",
                                )
                              }
                              onClick={() => void connectRea()}
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
                          {mcpError && (
                            <span className="surface-error" role="alert">
                              {mcpError}
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
                  ) : (
                    <div className="plugins-inspector-empty">
                      <p className="section-kicker">PLUGIN INSPECTOR</p>
                      <h3>Choose an item to inspect</h3>
                      <p>
                        Availability, permissions, compatibility, and next steps
                        will appear here while the catalog stays in view.
                      </p>
                    </div>
                  )}
                </aside>
              </div>
            )}
            {catalogSection === "MCP Servers" && <>
            <Card className="plugins-mcp-note" id="plugins-mcp-connections">
              <div className="plugins-mcp-copy">
                <p className="section-kicker">MCP CONNECTIONS</p>
                <h3>Connect a compatible server</h3>
                <p>
                  Connect a Streamable HTTP MCP server explicitly. HTTPS is
                  required for remote servers; plain HTTP is accepted only for
                  loopback development endpoints.
                </p>
                <div className="plugins-mcp-form">
                  <input
                    value={serverId}
                    onChange={(event) => setServerId(event.target.value)}
                    placeholder="Server ID"
                    aria-label="MCP server ID"
                  />
                  <input
                    id="plugins-endpoint"
                    value={endpoint}
                    onChange={(event) => setEndpoint(event.target.value)}
                    placeholder="https://example.com/mcp"
                    aria-label="MCP endpoint"
                  />
                  <Button
                    variant="primary"
                    disabled={mcpBusy || !serverId.trim() || !endpoint.trim()}
                    onClick={() => void connectMcp()}
                  >
                    {mcpBusy ? "Connecting…" : "Connect and review tools"}
                  </Button>
                </div>
                {mcpError && (
                  <p className="surface-error" role="alert">
                    {mcpError}
                  </p>
                )}
              </div>
              <StatusBadge tone="neutral">
                Explicit approval required
              </StatusBadge>
            </Card>
            {connections.length > 0 && (
              <Card className="plugins-connections">
                <div className="settings-section-heading">
                  <div>
                    <p className="section-kicker">CONNECTED SERVERS</p>
                    <h3>MCP lifecycle</h3>
                    <p>
                      Connections are persisted as credential-free metadata.
                      Revoking one prevents future tool calls and cannot be
                      silently undone.
                    </p>
                  </div>
                </div>
                <div className="plugins-connection-list">
                  {connections.map((connection) => {
                    const toolsForConnection =
                      mcpTools[connection.connectionId] ?? [];
                    const tone =
                      connection.state === "healthy"
                        ? "success"
                        : connection.state === "revoked"
                          ? "danger"
                          : "warning";
                    const selectedConnection =
                      selectedConnectionId === connection.connectionId;
                    const readTools = toolsForConnection.filter(
                      (tool) => !tool.isMutating,
                    );
                    const writeTools = toolsForConnection.filter(
                      (tool) => tool.isMutating,
                    );
                    return (
                      <div
                        className={`plugins-connection${selectedConnection ? " is-selected" : ""}`}
                        key={connection.connectionId}
                      >
                        <div className="plugins-connection-summary">
                          <button
                            type="button"
                            className="plugins-connection-select"
                            onClick={() =>
                              setSelectedConnectionId((current) =>
                                current === connection.connectionId
                                  ? null
                                  : connection.connectionId,
                              )
                            }
                            aria-expanded={selectedConnection}
                          >
                            <span>
                              <strong>{connection.serverId}</strong>
                              <small>
                                {connection.transport} ·{" "}
                                {connection.connectionId}
                              </small>
                            </span>
                            <StatusBadge tone={tone}>
                              {connection.state === "healthy"
                                ? "Connected"
                                : connection.state === "degraded"
                                  ? "Needs attention"
                                  : connection.state}
                            </StatusBadge>
                          </button>
                          <div className="plugins-connection-actions">
                            <div className="plugins-connection-health">
                              <span>
                                Last reported{" "}
                                {Number.isNaN(
                                  Date.parse(connection.updatedAtUtc),
                                )
                                  ? "time unavailable"
                                  : new Date(
                                      connection.updatedAtUtc,
                                    ).toLocaleString()}
                              </span>
                              {connection.lastError && (
                                <p role="status">
                                  {connection.lastError
                                    .replace(
                                      /Bearer\s+\S+/gi,
                                      "Bearer [redacted]",
                                    )
                                    .replace(
                                      /(token|api[_-]?key|secret|password)(\s*[:=]\s*)[^\s,;]+/gi,
                                      "$1$2[redacted]",
                                    )
                                    .slice(0, 240)}
                                </p>
                              )}
                            </div>
                            {connection.state !== "revoked" && (
                              <>
                                <Button
                                  variant="secondary"
                                  disabled={
                                    mcpBusy ||
                                    connection.state === "disconnected"
                                  }
                                  onClick={() =>
                                    void refreshMcpHealth(connection)
                                  }
                                >
                                  {mcpBusy ? "Checking…" : "Refresh health"}
                                </Button>
                                <Button
                                  variant="ghost"
                                  disabled={mcpBusy}
                                  onClick={() =>
                                    void changeMcpState(
                                      connection,
                                      "mcp.connection.disconnect",
                                    )
                                  }
                                >
                                  Disconnect
                                </Button>
                                <Button
                                  variant="danger"
                                  disabled={mcpBusy}
                                  onClick={() =>
                                    void changeMcpState(
                                      connection,
                                      "mcp.connection.revoke",
                                    )
                                  }
                                >
                                  Revoke
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                        {selectedConnection && (
                          <div className="plugins-connection-inspector">
                            <div className="plugins-connection-metadata">
                              <span>
                                <b>Manifest</b>
                                {connection.manifestDigest
                                  ? connection.manifestDigest
                                  : "Not recorded"}
                              </span>
                              <span>
                                <b>Tools</b>
                                {toolsForConnection.length} discovered
                              </span>
                              <span>
                                <b>Access</b>Explicit approval per call
                              </span>
                            </div>
                            {toolsForConnection.length === 0 ? (
                              <p className="plugins-tool-empty">
                                No live tool manifest. Refresh health while the
                                server is connected to inspect its current
                                tools.
                              </p>
                            ) : (
                              <div className="plugins-tool-groups">
                                <div>
                                  <h4>
                                    Read-only tools{" "}
                                    <span>{readTools.length}</span>
                                  </h4>
                                  {readTools.length === 0 ? (
                                    <p className="plugins-tool-empty">
                                      None discovered.
                                    </p>
                                  ) : (
                                    readTools.map((tool) => (
                                      <div
                                        className="plugins-tool-review"
                                        key={tool.toolName}
                                      >
                                        <span>
                                          <strong>{tool.toolName}</strong>
                                          <small>
                                            {tool.description ||
                                              "No description provided by the server."}
                                          </small>
                                        </span>
                                        <em>
                                          {tool.requiredCapabilities.join(
                                            " · ",
                                          ) || "Read approval"}
                                        </em>
                                      </div>
                                    ))
                                  )}
                                </div>
                                <div>
                                  <h4>
                                    Mutating tools{" "}
                                    <span>{writeTools.length}</span>
                                  </h4>
                                  {writeTools.length === 0 ? (
                                    <p className="plugins-tool-empty">
                                      None discovered.
                                    </p>
                                  ) : (
                                    writeTools.map((tool) => (
                                      <div
                                        className="plugins-tool-review is-mutating"
                                        key={tool.toolName}
                                      >
                                        <span>
                                          <strong>{tool.toolName}</strong>
                                          <small>
                                            {tool.description ||
                                              "No description provided by the server."}
                                          </small>
                                        </span>
                                        <em>
                                          {tool.requiredCapabilities.join(
                                            " · ",
                                          ) || "Write approval"}
                                        </em>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>
                            )}
                            <p className="plugins-approval-boundary">
                              Listing a tool only shows untrusted server
                              metadata. Skai still requires an explicit approval
                              grant when a tool is called.
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
            </>}
          </>
        )}
      </div>
    </div>
  );
}
