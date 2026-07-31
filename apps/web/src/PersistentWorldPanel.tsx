"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { PersistentWorldScene } from "../../../packages/contracts/src/persistent-scene.js";
import type { WorldActionPlayerSafeResult } from "../../../packages/contracts/src/world-action.js";
import {
  loadPersistentWorldScene,
  submitPersistentWorldAction,
} from "./persistent-world-client.js";
import { PersistentEntityCard } from "./PersistentEntityCard.js";
import { PersistentPlanCard } from "./PersistentPlanCard.js";

const newIdempotencyKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function PersistentWorldPanel({
  apiBaseUrl,
  accessToken,
}: {
  apiBaseUrl: string;
  accessToken?: string;
}) {
  const [scene, setScene] = useState<PersistentWorldScene | null>(null);
  const [command, setCommand] = useState("");
  const [result, setResult] = useState<WorldActionPlayerSafeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await loadPersistentWorldScene({ apiBaseUrl, accessToken });
    setScene(next);
    setError(null);
  }, [accessToken, apiBaseUrl]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadPersistentWorldScene({ apiBaseUrl, accessToken })
      .then((next) => {
        if (!cancelled) setScene(next);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load the world.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, apiBaseUrl]);

  useEffect(() => {
    if (!scene?.scheduledWork.length) return;
    const nextResolve = Math.min(
      ...scene.scheduledWork.map(({ resolvesAt }) => new Date(resolvesAt).getTime()),
    );
    const delay = Math.max(1_000, Math.min(30_000, nextResolve - Date.now() + 1_000));
    const timer = window.setTimeout(() => void refresh().catch(() => {}), delay);
    return () => window.clearTimeout(timer);
  }, [refresh, scene?.scheduledWork]);

  const nearby = useMemo(
    () => [...(scene?.nearbyEntities || []), ...(scene?.accompanyingEntities || [])],
    [scene],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = command.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const next = await submitPersistentWorldAction({
        apiBaseUrl,
        accessToken,
        command: trimmed,
        idempotencyKey: newIdempotencyKey(),
      });
      setResult(next);
      if (next.state !== "waiting_for_clarification") setCommand("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The action failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="persistent-world-panel is-loading">Loading shared world…</div>;
  if (!scene) {
    return (
      <div className="persistent-world-panel is-error">
        <p>{error || "The persistent world is unavailable."}</p>
        <button type="button" onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <main className="persistent-world-panel">
      <header className="persistent-world-panel__location">
        <div>
          <small>{scene.location.hierarchy.map(({ name }) => name).join(" / ")}</small>
          <h1>{scene.location.name}</h1>
        </div>
        <span>{scene.runtimeVersion}</span>
      </header>

      {scene.activePlan ? <PersistentPlanCard plan={scene.activePlan} /> : null}

      {result?.state === "waiting_for_clarification" ? (
        <aside className="persistent-world-panel__clarification">
          <strong>Clarification needed</strong>
          <p>{result.prompt}</p>
        </aside>
      ) : result ? (
        <aside className="persistent-world-panel__result">
          <p>{result.narration}</p>
        </aside>
      ) : null}

      <section className="persistent-world-panel__section">
        <h2>Here with you</h2>
        {nearby.length ? (
          <div className="persistent-world-panel__entities">
            {nearby.map((entity) => (
              <PersistentEntityCard key={entity.entityId} entity={entity} />
            ))}
          </div>
        ) : (
          <p className="persistent-world-panel__empty">No known entities are immediately present.</p>
        )}
      </section>

      {scene.knownEntities.length ? (
        <details className="persistent-world-panel__known">
          <summary>Known elsewhere ({scene.knownEntities.length})</summary>
          <div className="persistent-world-panel__entities">
            {scene.knownEntities.map((entity) => (
              <PersistentEntityCard key={entity.entityId} entity={entity} />
            ))}
          </div>
        </details>
      ) : null}

      {scene.scheduledWork.length ? (
        <section className="persistent-world-panel__section">
          <h2>In progress</h2>
          <ul className="persistent-world-panel__scheduled">
            {scene.scheduledWork.map((work) => (
              <li key={work.scheduleId}>
                <span>{work.description}</span>
                <time dateTime={work.resolvesAt}>{new Date(work.resolvesAt).toLocaleTimeString()}</time>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <form className="persistent-world-panel__composer" onSubmit={submit}>
        <label htmlFor="persistent-world-command">What do you do?</label>
        <div>
          <textarea
            id="persistent-world-command"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="Search the alley, talk to someone, move an object, go somewhere…"
            rows={2}
            disabled={submitting}
          />
          <button type="submit" disabled={submitting || !command.trim()}>
            {submitting ? "Resolving…" : "Act"}
          </button>
        </div>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </main>
  );
}
