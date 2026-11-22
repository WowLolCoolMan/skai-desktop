import { Button, Card, StatusBadge } from "../../components/ui/Primitives";
import { NavIcon } from "../../components/ui/NavIcon";
import type { MarketplaceEntry } from "./marketplaceEntries";
import type { McpConnection } from "./useMarketplaceMcp";

type GroupedEntries = Array<[string, MarketplaceEntry[]]>;

type Props = {
  groups: GroupedEntries;
  selected: MarketplaceEntry | null;
  connections: McpConnection[];
  busy: boolean;
  error: string | null;
  onToggleSelect: (id: string) => void;
  onDownloadRea: () => void;
  onConnectRea: () => void;
};

export function MarketplaceCatalogBrowser({
  groups, selected, connections, busy, error, onToggleSelect, onDownloadRea, onConnectRea,
}: Props) {
  return (
<div className="plugins-browser">
                <div className="plugins-catalog" aria-label="Skai capabilities">
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
  );
}
