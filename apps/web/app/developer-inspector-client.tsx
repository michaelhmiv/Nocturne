"use client";

import { useEffect, useState } from "react";
import type {
  OperatorDashboard,
  PlayerDashboard,
  WorldInspectorEntity,
} from "../../../packages/contracts/src/index.js";
import { authClient } from "../lib/auth-client";
import { gameFetch } from "./game-fetch";

type InspectorTab =
  | "overview"
  | "state"
  | "relations"
  | "events"
  | "plans"
  | "traces"
  | "simulation"
  | "context";

const guestMode = process.env.NEXT_PUBLIC_NOCTURNE_GUEST_MODE === "true";
const label = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
const when = (value: unknown) => {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value || "—");
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function value(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) if (value[key] !== undefined && value[key] !== null) return value[key];
  return null;
}

function JsonBlock({ value: content }: { value: unknown }) {
  return <pre className="developer-json">{JSON.stringify(content, null, 2)}</pre>;
}

function Empty({ children }: { children: string }) {
  return <p className="developer-empty">{children}</p>;
}

export default function DeveloperInspectorClient() {
  const { data: session, isPending } = authClient.useSession();
  const [dashboard, setDashboard] = useState<PlayerDashboard | null>(null);
  const [entity, setEntity] = useState<WorldInspectorEntity | null>(null);
  const [operator, setOperator] = useState<OperatorDashboard | null>(null);
  const [tab, setTab] = useState<InspectorTab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const player = await gameFetch<PlayerDashboard>("persistent-world/dashboard?historyLimit=100");
      const [inspected, traces] = await Promise.all([
        gameFetch<WorldInspectorEntity>(`operator/world/entities/${player.character.characterId}`),
        gameFetch<OperatorDashboard>(
          `operator/world/dashboard/${player.character.characterId}?limit=75`,
        ),
      ]);
      setDashboard(player);
      setEntity(inspected);
      setOperator(traces);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load operator data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isPending || (!session && !guestMode)) return;
    void load();
  }, [isPending, session?.user.id]);

  if (isPending || loading) {
    return <main className="developer-inspector developer-inspector--loading">Loading operator inspector…</main>;
  }

  if (!session && !guestMode) {
    return (
      <main className="developer-inspector developer-inspector--loading">
        Sign in before opening the developer inspector.
      </main>
    );
  }

  if (!entity || !operator || !dashboard) {
    return (
      <main className="developer-inspector developer-inspector--loading">
        <div>
          <h1>Operator access required</h1>
          <p>{error || "The selected world membership does not have operator access."}</p>
          <button type="button" onClick={() => void load()}>Try again</button>
        </div>
      </main>
    );
  }

  const tabs: Array<{ key: InspectorTab; label: string; count?: number }> = [
    { key: "overview", label: "Overview" },
    { key: "state", label: "State" },
    { key: "relations", label: "Relations", count: entity.relations.length },
    { key: "events", label: "Events", count: entity.recentEvents.length },
    { key: "plans", label: "Plans", count: entity.activePlans.length + entity.scheduledWork.length },
    { key: "traces", label: "Action Traces", count: operator.traces.length },
    { key: "simulation", label: "Simulation", count: entity.simulationRuns.length },
    { key: "context", label: "Context", count: entity.latestContextReasons.length },
  ];

  return (
    <main className="developer-inspector">
      <header className="developer-inspector__hero">
        <div>
          <p>OPERATOR WORLD INSPECTOR</p>
          <h1>{entity.name}</h1>
          <span>{entity.definitionType} · {entity.lifecycleStatus}</span>
        </div>
        <div>
          <span>Entity v{entity.version}</span>
          <span>Simulation v{entity.simulationVersion}</span>
          <span>Condition {entity.condition}/100</span>
          <button type="button" onClick={() => void load()}>Refresh</button>
        </div>
      </header>

      {error && <p className="developer-inspector__alert">{error}</p>}

      <nav className="developer-inspector__tabs" aria-label="Inspector sections">
        {tabs.map((item) => (
          <button
            className={tab === item.key ? "is-active" : undefined}
            key={item.key}
            onClick={() => setTab(item.key)}
            type="button"
          >
            {item.label}{item.count === undefined ? "" : ` (${item.count})`}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="developer-inspector__grid">
          <section>
            <h2>Identity and authority</h2>
            <dl>
              <div><dt>Entity ID</dt><dd>{entity.entityId}</dd></div>
              <div><dt>Definition ID</dt><dd>{entity.definitionId}</dd></div>
              <div><dt>World</dt><dd>{entity.worldId}</dd></div>
              <div><dt>Shard</dt><dd>{entity.shardId}</dd></div>
              <div><dt>Location</dt><dd>{entity.locationId || "None"}</dd></div>
              <div><dt>Owner</dt><dd>{entity.ownerId || "None"}</dd></div>
              <div><dt>Controller</dt><dd>{entity.controllerId || "None"}</dd></div>
            </dl>
          </section>
          <section>
            <h2>Runtime summary</h2>
            <div className="developer-metric-grid">
              <article><strong>{operator.traces.length}</strong><span>action requests</span></article>
              <article><strong>{entity.recentEvents.length}</strong><span>recent events</span></article>
              <article><strong>{entity.relations.length}</strong><span>relations</span></article>
              <article><strong>{entity.activePlans.length}</strong><span>active plans</span></article>
              <article><strong>{entity.scheduledWork.length}</strong><span>scheduled work</span></article>
              <article><strong>{entity.simulationRuns.length}</strong><span>simulation runs</span></article>
            </div>
          </section>
          <section className="developer-inspector__wide">
            <h2>Registered handlers</h2>
            <div className="developer-table-wrap">
              <table>
                <thead><tr><th>Kind</th><th>Version</th><th>Authority</th><th>Mutation</th><th>Status</th></tr></thead>
                <tbody>
                  {operator.handlers.map((handler) => (
                    <tr key={handler.actionKind}>
                      <td>{handler.actionKind}</td><td>{handler.handlerVersion}</td>
                      <td>{handler.authorityMode}</td><td>{handler.supportsStateChange ? "yes" : "no"}</td>
                      <td>{handler.enabled ? "enabled" : "disabled"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="developer-inspector__wide developer-warning">
            <h2>Repair boundary</h2>
            <p>Repairs remain operator-only and must create version-checked authoritative operations or compensating events. This inspector intentionally does not provide arbitrary JSON editing.</p>
          </section>
        </div>
      )}

      {tab === "state" && (
        <div className="developer-inspector__grid">
          <section>
            <h2>Player-safe state</h2>
            <dl>
              <div><dt>Condition</dt><dd>{dashboard.character.condition}</dd></div>
              <div><dt>Cash</dt><dd>{dashboard.character.cashOnPerson}</dd></div>
              <div><dt>Heat</dt><dd>{dashboard.character.heat}</dd></div>
              <div><dt>Status</dt><dd>{dashboard.character.status}</dd></div>
            </dl>
            <h3>Resources</h3>
            {dashboard.character.resources.length ? dashboard.character.resources.map((resource) => (
              <div className="developer-state-row" key={resource.key}><span>{resource.label}</span><strong>{resource.value}</strong></div>
            )) : <Empty>No resource values.</Empty>}
            <h3>Active conditions</h3>
            {dashboard.character.activeConditions.length ? dashboard.character.activeConditions.map((condition) => (
              <div className="developer-state-row" key={condition.key}><span>{condition.name}</span><strong>{condition.intensity}</strong></div>
            )) : <Empty>No active conditions.</Empty>}
          </section>
          <section className="developer-inspector__wide">
            <h2>Authoritative raw state</h2>
            <JsonBlock value={entity.state} />
          </section>
          <section className="developer-inspector__wide">
            <h2>Provenance</h2>
            <JsonBlock value={entity.provenance} />
          </section>
        </div>
      )}

      {tab === "relations" && (
        <div className="developer-inspector__stack">
          <section><h2>Aliases</h2>{entity.aliases.length ? <JsonBlock value={entity.aliases} /> : <Empty>No aliases.</Empty>}</section>
          <section><h2>Relations</h2>{entity.relations.length ? <JsonBlock value={entity.relations} /> : <Empty>No relations.</Empty>}</section>
        </div>
      )}

      {tab === "events" && (
        <div className="developer-trace-list">
          {entity.recentEvents.length ? entity.recentEvents.map((raw, index) => {
            const event = record(raw);
            const id = String(value(event, "event_id", "eventId") || index);
            return (
              <article key={id}>
                <header><div><strong>{label(String(value(event, "event_type", "eventType") || "event"))}</strong><code>{id}</code></div><time>{when(value(event, "world_time", "occurredAt", "created_at"))}</time></header>
                <JsonBlock value={event} />
              </article>
            );
          }) : <Empty>No recent events.</Empty>}
        </div>
      )}

      {tab === "plans" && (
        <div className="developer-inspector__stack">
          <section><h2>Active plans</h2>{entity.activePlans.length ? <JsonBlock value={entity.activePlans} /> : <Empty>No active plans.</Empty>}</section>
          <section><h2>Scheduled work</h2>{entity.scheduledWork.length ? <JsonBlock value={entity.scheduledWork} /> : <Empty>No scheduled work.</Empty>}</section>
        </div>
      )}

      {tab === "traces" && (
        <div className="developer-trace-list">
          {operator.traces.length ? operator.traces.map((trace) => (
            <article key={trace.requestId}>
              <header>
                <div><strong>{trace.command}</strong><code>{trace.requestId}</code></div>
                <div><span className={`developer-status developer-status--${trace.status}`}>{label(trace.status)}</span><time>{when(trace.createdAt)}</time></div>
              </header>
              <dl className="developer-trace-meta">
                <div><dt>Plan</dt><dd>{trace.planId || "None"}</dd></div>
                <div><dt>Context compilation</dt><dd>{trace.contextCompilationId || "None"}</dd></div>
                <div><dt>Error</dt><dd>{trace.errorCode || "None"}</dd></div>
                <div><dt>Updated</dt><dd>{when(trace.updatedAt)}</dd></div>
              </dl>
              <ol className="developer-stages">
                {trace.stages.map((stage) => (
                  <li key={stage.stageId}>
                    <span>{stage.order}</span>
                    <div><strong>{label(stage.type)}</strong><small>{label(stage.status)} · {when(stage.startedAt)}</small></div>
                    <details><summary>Stage payloads</summary><JsonBlock value={{ input: stage.inputSummary, output: stage.outputSummary }} /></details>
                  </li>
                ))}
              </ol>
              <details><summary>Request results</summary><JsonBlock value={{ authoritative: trace.authoritativeResult, playerSafe: trace.playerSafeResult }} /></details>
            </article>
          )) : <Empty>No action requests.</Empty>}
        </div>
      )}

      {tab === "simulation" && (
        <div className="developer-inspector__stack">
          <section><h2>Simulation runs</h2>{entity.simulationRuns.length ? <JsonBlock value={entity.simulationRuns} /> : <Empty>No simulation runs.</Empty>}</section>
        </div>
      )}

      {tab === "context" && (
        <div className="developer-inspector__stack">
          <section><h2>Latest context inclusion reasons</h2>{entity.latestContextReasons.length ? <JsonBlock value={entity.latestContextReasons} /> : <Empty>No context inclusion records.</Empty>}</section>
        </div>
      )}
    </main>
  );
}
