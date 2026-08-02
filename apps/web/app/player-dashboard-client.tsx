"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  PlayerDashboard,
  PlayerVisibleEffect,
} from "../../../packages/contracts/src/index.js";
import { authClient } from "../lib/auth-client";
import { gameFetch } from "./game-fetch";

type DashboardTab = "overview" | "character" | "inventory" | "world" | "history";

const guestMode = process.env.NEXT_PUBLIC_NOCTURNE_GUEST_MODE === "true";
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const label = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;
const when = (value: string) => new Date(value).toLocaleString();

function effectText(effect: PlayerVisibleEffect): string {
  switch (effect.type) {
    case "resource_changed":
      return `${label(effect.resource)} ${signed(effect.delta)}${effect.after === null ? "" : ` → ${effect.after}`}`;
    case "condition_changed":
      return `${effect.name} ${effect.change}${effect.intensity === null ? "" : ` · intensity ${effect.intensity}`}`;
    case "quantity_changed":
      return `${effect.name} ${effect.change} ${signed(effect.delta)}${effect.after === null ? "" : ` · ${effect.after} remaining`}`;
    case "risk_resolved":
      return `${effect.description}: ${effect.occurred ? "occurred" : "did not occur"}`;
    case "location_changed":
      return `Location changed${effect.toLocationName ? ` to ${effect.toLocationName}` : ""}`;
    case "relationship_changed":
      return `${label(effect.relationship)} ${effect.change}`;
    case "fact_committed":
      return effect.fact;
  }
}

function ResourceMeter({
  resource,
}: {
  resource: PlayerDashboard["character"]["resources"][number];
}) {
  const span = Math.max(1, resource.maximum - resource.minimum);
  const percent = Math.max(0, Math.min(100, ((resource.value - resource.minimum) / span) * 100));
  return (
    <div className="dashboard-resource">
      <div>
        <span>{resource.label}</span>
        <strong>{resource.value}</strong>
      </div>
      <div className="dashboard-resource__track" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="player-dashboard__empty">{children}</p>;
}

export default function PlayerDashboardClient() {
  const { data: session, isPending } = authClient.useSession();
  const [dashboard, setDashboard] = useState<PlayerDashboard | null>(null);
  const [tab, setTab] = useState<DashboardTab>("overview");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  async function load(background = false) {
    if (!background) setLoading(true);
    else setRefreshing(true);
    try {
      const next = await gameFetch<PlayerDashboard>("persistent-world/dashboard?historyLimit=150");
      setDashboard(next);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load the dashboard.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (isPending || (!session && !guestMode)) return;
    void load();
    const timer = window.setInterval(() => void load(true), 15_000);
    return () => window.clearInterval(timer);
  }, [isPending, session?.user.id]);

  const recentChanges = useMemo(
    () => dashboard?.effects.events.filter((event) => event.effects.length > 0).slice(0, 6) || [],
    [dashboard],
  );

  if (isPending || loading) {
    return <main className="player-dashboard player-dashboard--loading">Loading dashboard…</main>;
  }

  if (!session && !guestMode) {
    return (
      <main className="player-dashboard player-dashboard--loading">
        Sign in from the Play view to open your dashboard.
      </main>
    );
  }

  if (!dashboard) {
    return (
      <main className="player-dashboard player-dashboard--loading">
        <p>{error || "The dashboard is unavailable."}</p>
        <button type="button" onClick={() => void load()}>
          Try again
        </button>
      </main>
    );
  }

  const { character, scene } = dashboard;
  const tabs: Array<{ key: DashboardTab; label: string }> = [
    { key: "overview", label: "Overview" },
    { key: "character", label: "Character" },
    { key: "inventory", label: "Inventory" },
    { key: "world", label: "World" },
    { key: "history", label: "History" },
  ];

  return (
    <main className="player-dashboard">
      <header className="player-dashboard__hero">
        <div>
          <p className="player-dashboard__eyebrow">CURRENT CHARACTER</p>
          <h1>{character.name}</h1>
          <p>{character.conceptSummary}</p>
        </div>
        <div className="player-dashboard__hero-status">
          <span>{scene.location.name}</span>
          <strong>{character.condition}/100 condition</strong>
          <span>
            {money(character.cashOnPerson)} · Heat {character.heat}
          </span>
          <button disabled={refreshing} type="button" onClick={() => void load(true)}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && <p className="player-dashboard__alert">{error}</p>}

      <nav className="player-dashboard__tabs" aria-label="Dashboard sections">
        {tabs.map((item) => (
          <button
            aria-selected={tab === item.key}
            className={tab === item.key ? "is-active" : undefined}
            key={item.key}
            onClick={() => setTab(item.key)}
            role="tab"
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="player-dashboard__grid">
          <section className="player-dashboard__card player-dashboard__card--status">
            <p className="player-dashboard__eyebrow">VITALS</p>
            <div className="dashboard-condition-ring">
              <strong>{character.condition}</strong>
              <span>condition</span>
            </div>
            <dl className="dashboard-stat-list">
              <div>
                <dt>Status</dt>
                <dd>{label(character.status)}</dd>
              </div>
              <div>
                <dt>Lifecycle</dt>
                <dd>{label(character.lifecycleStatus)}</dd>
              </div>
              <div>
                <dt>Cash</dt>
                <dd>{money(character.cashOnPerson)}</dd>
              </div>
              <div>
                <dt>Heat</dt>
                <dd>{character.heat}</dd>
              </div>
              <div>
                <dt>Warrant</dt>
                <dd>{character.warrant ? "Active" : "None"}</dd>
              </div>
            </dl>
          </section>

          <section className="player-dashboard__card player-dashboard__card--wide">
            <p className="player-dashboard__eyebrow">RESOURCES</p>
            {character.resources.length ? (
              <div className="dashboard-resource-grid">
                {character.resources.map((resource) => (
                  <ResourceMeter key={resource.key} resource={resource} />
                ))}
              </div>
            ) : (
              <Empty>No tracked resources have changed yet.</Empty>
            )}
          </section>

          <section className="player-dashboard__card">
            <p className="player-dashboard__eyebrow">ACTIVE CONDITIONS</p>
            {character.activeConditions.length ? (
              character.activeConditions.map((condition) => (
                <article className="dashboard-condition" key={condition.key}>
                  <strong>{condition.name}</strong>
                  <span>Intensity {condition.intensity}</span>
                  {condition.expiresAt && (
                    <time dateTime={condition.expiresAt}>Until {when(condition.expiresAt)}</time>
                  )}
                  {condition.rationale && <p>{condition.rationale}</p>}
                </article>
              ))
            ) : (
              <Empty>No active conditions.</Empty>
            )}
          </section>

          <section className="player-dashboard__card player-dashboard__card--wide">
            <p className="player-dashboard__eyebrow">CURRENT PLAN</p>
            {scene.activePlan ? (
              <div className="dashboard-plan">
                <div className="dashboard-plan__header">
                  <strong>{label(scene.activePlan.status)}</strong>
                  <span>Version {scene.activePlan.planVersion}</span>
                </div>
                <ol>
                  {scene.activePlan.steps.map((step) => (
                    <li key={step.stepId}>
                      <span>{step.order}</span>
                      <div>
                        <strong>{step.description}</strong>
                        <small>
                          {label(step.status)}
                          {step.outcomeGrade ? ` · ${label(step.outcomeGrade)}` : ""}
                        </small>
                        {step.waitingReason && <p>{step.waitingReason}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <Empty>No active action plan.</Empty>
            )}
          </section>

          <section className="player-dashboard__card">
            <p className="player-dashboard__eyebrow">IN PROGRESS</p>
            {scene.scheduledWork.length ? (
              scene.scheduledWork.map((work) => (
                <article className="dashboard-scheduled" key={work.scheduleId}>
                  <strong>{work.description}</strong>
                  <span>{label(work.status)}</span>
                  <time dateTime={work.resolvesAt}>{when(work.resolvesAt)}</time>
                </article>
              ))
            ) : (
              <Empty>No scheduled work.</Empty>
            )}
          </section>

          <section className="player-dashboard__card player-dashboard__card--wide">
            <p className="player-dashboard__eyebrow">RECENT MECHANICAL CHANGES</p>
            {recentChanges.length ? (
              <div className="dashboard-history-list">
                {recentChanges.map((event) => (
                  <article key={event.eventId}>
                    <div>
                      <strong>{event.summary}</strong>
                      <time dateTime={event.occurredAt}>{when(event.occurredAt)}</time>
                    </div>
                    <ul>
                      {event.effects.map((effect, index) => (
                        <li key={`${event.eventId}:${index}`}>{effectText(effect)}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            ) : (
              <Empty>No mechanical changes have been recorded.</Empty>
            )}
          </section>
        </div>
      )}

      {tab === "character" && (
        <div className="player-dashboard__grid">
          <section className="player-dashboard__card player-dashboard__card--wide">
            <p className="player-dashboard__eyebrow">IDENTITY</p>
            <h2>{character.name}</h2>
            <p>{character.conceptSummary}</p>
            <dl className="dashboard-stat-list dashboard-stat-list--columns">
              <div>
                <dt>Entity version</dt>
                <dd>{character.version}</dd>
              </div>
              <div>
                <dt>Simulation version</dt>
                <dd>{character.simulationVersion}</dd>
              </div>
              <div>
                <dt>Definition</dt>
                <dd>{character.definitionId}</dd>
              </div>
              <div>
                <dt>Character ID</dt>
                <dd>{character.characterId}</dd>
              </div>
            </dl>
          </section>
          <section className="player-dashboard__card">
            <p className="player-dashboard__eyebrow">SKILLS</p>
            {Object.keys(character.skills).length ? (
              Object.entries(character.skills).map(([skill, value]) => (
                <div className="dashboard-value-row" key={skill}>
                  <span>{label(skill)}</span>
                  <strong>{value}</strong>
                </div>
              ))
            ) : (
              <Empty>No skills recorded.</Empty>
            )}
          </section>
          <section className="player-dashboard__card">
            <p className="player-dashboard__eyebrow">FACTION STANDING</p>
            {Object.keys(character.factionStanding).length ? (
              Object.entries(character.factionStanding).map(([faction, value]) => (
                <div className="dashboard-value-row" key={faction}>
                  <span>{label(faction)}</span>
                  <strong>{signed(value)}</strong>
                </div>
              ))
            ) : (
              <Empty>No faction standing recorded.</Empty>
            )}
          </section>
          <section className="player-dashboard__card player-dashboard__card--wide">
            <p className="player-dashboard__eyebrow">RESOURCE HISTORY</p>
            {dashboard.resourceHistory.length ? (
              dashboard.resourceHistory.map((history) => (
                <details className="dashboard-resource-history" key={history.resource}>
                  <summary>
                    {history.label} · {history.points.length} changes
                  </summary>
                  {history.points
                    .slice()
                    .reverse()
                    .map((point) => (
                      <div key={`${history.resource}:${point.eventId}`}>
                        <span>{point.summary}</span>
                        <strong>
                          {signed(point.delta)}
                          {point.after === null ? "" : ` → ${point.after}`}
                        </strong>
                        <time dateTime={point.occurredAt}>{when(point.occurredAt)}</time>
                      </div>
                    ))}
                </details>
              ))
            ) : (
              <Empty>No resource history yet.</Empty>
            )}
          </section>
        </div>
      )}

      {tab === "inventory" && (
        <div className="player-dashboard__grid">
          <section className="player-dashboard__card player-dashboard__card--wide">
            <p className="player-dashboard__eyebrow">CARRIED INVENTORY</p>
            {character.inventory.length ? (
              <div className="dashboard-inventory-grid">
                {character.inventory.map((item, index) => (
                  <article key={item.instanceId || `${item.title}:${index}`}>
                    <div>
                      <strong>{item.title}</strong>
                      {item.equipped && <span>Equipped</span>}
                    </div>
                    <dl>
                      <div>
                        <dt>Quantity</dt>
                        <dd>{item.quantity ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Condition</dt>
                        <dd>{item.condition ?? "—"}</dd>
                      </div>
                    </dl>
                    {item.instanceId && <small>{item.instanceId}</small>}
                  </article>
                ))}
              </div>
            ) : (
              <Empty>Your carried inventory is empty.</Empty>
            )}
          </section>
          <section className="player-dashboard__card">
            <p className="player-dashboard__eyebrow">ACCOMPANYING / CARRIED ENTITIES</p>
            {scene.accompanyingEntities.length ? (
              scene.accompanyingEntities.map((entity) => (
                <article className="dashboard-entity-row" key={entity.entityId}>
                  <strong>{entity.name}</strong>
                  <span>{label(entity.presence)}</span>
                  <small>
                    {entity.relationshipLabels.map(label).join(" · ") || entity.definitionType}
                  </small>
                </article>
              ))
            ) : (
              <Empty>No accompanying entities.</Empty>
            )}
          </section>
        </div>
      )}

      {tab === "world" && (
        <div className="player-dashboard__grid">
          <section className="player-dashboard__card player-dashboard__card--wide">
            <p className="player-dashboard__eyebrow">LOCATION</p>
            <h2>{scene.location.name}</h2>
            <div className="dashboard-location-path">
              {scene.location.hierarchy.map((location) => (
                <span key={location.locationId}>{location.name}</span>
              ))}
            </div>
            {scene.location.locationId && <small>{scene.location.locationId}</small>}
          </section>
          <section className="player-dashboard__card">
            <p className="player-dashboard__eyebrow">NEARBY</p>
            {scene.nearbyEntities.length ? (
              scene.nearbyEntities.map((entity) => (
                <article className="dashboard-entity-row" key={entity.entityId}>
                  <strong>{entity.name}</strong>
                  <span>{label(entity.lifecycleStatus)}</span>
                  <small>
                    {entity.relationshipLabels.map(label).join(" · ") ||
                      label(entity.definitionType)}
                  </small>
                </article>
              ))
            ) : (
              <Empty>No known entities are immediately nearby.</Empty>
            )}
          </section>
          <section className="player-dashboard__card">
            <p className="player-dashboard__eyebrow">KNOWN ELSEWHERE</p>
            {scene.knownEntities.length ? (
              scene.knownEntities.map((entity) => (
                <article className="dashboard-entity-row" key={entity.entityId}>
                  <strong>{entity.name}</strong>
                  <span>{entity.locationName || "Location unknown"}</span>
                  <small>
                    Last observed {entity.lastObservedAt ? when(entity.lastObservedAt) : "unknown"}
                  </small>
                </article>
              ))
            ) : (
              <Empty>No persistent entities are known elsewhere.</Empty>
            )}
          </section>
          <section className="player-dashboard__card player-dashboard__card--wide">
            <p className="player-dashboard__eyebrow">RECENT WORLD EVENTS</p>
            {scene.recentEvents.length ? (
              scene.recentEvents.map((event) => (
                <article className="dashboard-world-event" key={event.eventId}>
                  <div>
                    <strong>{event.summary}</strong>
                    <span>{label(event.eventType)}</span>
                  </div>
                  <time dateTime={event.occurredAt}>{when(event.occurredAt)}</time>
                </article>
              ))
            ) : (
              <Empty>No recent committed events.</Empty>
            )}
          </section>
        </div>
      )}

      {tab === "history" && (
        <section className="player-dashboard__history">
          <header>
            <div>
              <p className="player-dashboard__eyebrow">EVENT HISTORY</p>
              <h2>{dashboard.effects.events.length} committed events</h2>
            </div>
            <span>Newest first</span>
          </header>
          {dashboard.effects.events.length ? (
            dashboard.effects.events.map((event) => (
              <article key={event.eventId}>
                <div className="player-dashboard__history-meta">
                  <div>
                    <strong>{event.summary}</strong>
                    <span>{label(event.eventType)}</span>
                  </div>
                  <time dateTime={event.occurredAt}>{when(event.occurredAt)}</time>
                </div>
                {event.effects.length ? (
                  <ul>
                    {event.effects.map((effect, index) => (
                      <li key={`${event.eventId}:${index}`}>{effectText(effect)}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No normalized mechanical effects were exposed for this event.</p>
                )}
                <details>
                  <summary>Event identifiers</summary>
                  <code>{event.eventId}</code>
                </details>
              </article>
            ))
          ) : (
            <Empty>No committed events are available.</Empty>
          )}
        </section>
      )}
    </main>
  );
}
