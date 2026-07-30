"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { authClient } from "../lib/auth-client";
import { gameFetch } from "./game-fetch";
import { buildTimeline } from "./game-state";

type Character = {
  characterId: string;
  name: string;
  conceptSummary: string;
  selected: boolean;
  residenceId: string | null;
  cashOnPerson?: number;
  heat?: number;
  warrant?: boolean;
  status?: string;
  skills?: Record<string, number>;
  inventory?: Array<{ title?: string; instanceId?: string }>;
};

type StarterWorld = {
  neighborhood: { name: string };
  residence: { id: string; name: string; capacities: Record<string, number> };
  alley: { name: string };
};

type Invention = {
  requestId: string;
  characterId: string;
  rawConcept: string;
  status: string;
  definitionId: string | null;
  installedInstanceId: string | null;
  draft: { name: string; conceptSummary: string } | null;
  validation: { issues?: Array<{ message: string }> } | null;
  installation: { fits: boolean; issues: Array<{ message: string }>; warnings: string[] } | null;
  createdAt: string;
};

type ActionResult = {
  eventId: string;
  rawText: string;
  outcomeGrade: string;
  narration: string;
  calculationTrace: string[];
  informationGained: Array<{ informationId: string; content: string; confidence: number }>;
  costs: Array<{ resource: string; amount: number }>;
  createdAt: string;
  travel?: { travelSeconds: number; scheduled: boolean };
  legal?: { heat: number; warrant: boolean; jailed: boolean };
  payday?: { paidCents: number; cashOnPerson: number };
  comms?: { toName: string; intercepted: boolean };
};

type AiJob = {
  jobId: string;
  kind: "action_resolution" | "invention_normalization";
  status: "pending" | "processing" | "retrying" | "completed" | "failed";
  attempts: number;
  maxAttempts: number;
  result: Record<string, unknown> | null;
  errorCode: string | null;
};

type AiQueueHealth = {
  workerOnline: boolean;
  workerConfigured: boolean;
  workerId: string | null;
  lastSeenAt: string | null;
  queuedCount: number;
  processingCount: number;
  oldestQueuedAt: string | null;
};

type PendingTurn = {
  localId: string;
  text: string;
  kind: AiJob["kind"];
  jobId?: string;
  status: "capturing" | AiJob["status"];
  error?: string;
  queueOffline?: boolean;
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function inferJobKind(text: string): AiJob["kind"] {
  return /^(invent|build|design|create|craft|make|construct)\b/i.test(text.trim())
    ? "invention_normalization"
    : "action_resolution";
}

function queueErrorMessage(errorCode: string | null): string | undefined {
  if (!errorCode) return undefined;
  if (errorCode === "worker_secret_rejected") {
    return "The resolver cannot authenticate with the game API. The action remains safely stored.";
  }
  if (errorCode === "worker_api_unreachable") {
    return "The resolver cannot reach the game API. The action remains safely stored.";
  }
  if (errorCode === "worker_request_timeout") {
    return "The resolver timed out and will retry automatically.";
  }
  if (errorCode === "worker_configuration_missing") {
    return "The resolver is missing its production configuration. The action remains safely stored.";
  }
  return errorCode.replaceAll("_", " ");
}

function pendingLabel(turn: PendingTurn): string {
  if (turn.status === "capturing") return "Saving action";
  if (turn.queueOffline) return "Resolver offline";
  if (turn.status === "pending") return "Queued";
  if (turn.status === "processing") return "Resolving";
  if (turn.status === "retrying") return "Retrying";
  if (turn.status === "failed") return "Resolution failed";
  return "Resolved";
}

export default function SceneGameClient() {
  const { data: session, isPending } = authClient.useSession();
  const guestMode = process.env.NEXT_PUBLIC_NOCTURNE_GUEST_MODE === "true";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [characterConcept, setCharacterConcept] = useState("");
  const [message, setMessage] = useState("");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [world, setWorld] = useState<StarterWorld | null>(null);
  const [inventions, setInventions] = useState<Invention[]>([]);
  const [actions, setActions] = useState<ActionResult[]>([]);
  const [pendingTurns, setPendingTurns] = useState<PendingTurn[]>([]);
  const [showCharacter, setShowCharacter] = useState(false);
  const [creatingCharacter, setCreatingCharacter] = useState(false);
  const [renting, setRenting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const monitoredJobs = useRef(new Set<string>());

  const selected = characters.find((character) => character.selected) || characters[0];
  const timeline = useMemo(
    () => buildTimeline(selected?.characterId, inventions, actions),
    [selected?.characterId, inventions, actions],
  );

  async function refresh() {
    if (!session && !guestMode) return;
    const [characterResponse, worldResponse, inventionResponse] = await Promise.all([
      gameFetch<{ characters: Character[] }>("characters"),
      gameFetch<StarterWorld>("world/start"),
      gameFetch<{ inventions: Invention[] }>("inventions"),
    ]);
    const active =
      characterResponse.characters.find((character) => character.selected) ||
      characterResponse.characters[0];
    const actionResponse = active
      ? await gameFetch<{ actions: ActionResult[] }>(
          `actions?actorId=${encodeURIComponent(active.characterId)}`,
        )
      : { actions: [] };
    setCharacters(characterResponse.characters);
    setWorld(worldResponse);
    setInventions(inventionResponse.inventions);
    setActions(actionResponse.actions);
  }

  useEffect(() => {
    void refresh().catch((caught: Error) => setError(caught.message));
  }, [session?.user.id]);

  async function monitorJob(localId: string, jobId: string) {
    if (monitoredJobs.current.has(jobId)) return;
    monitoredJobs.current.add(jobId);

    try {
      for (let poll = 0; poll < 120; poll += 1) {
        await sleep(poll < 4 ? 800 : 1_500);
        try {
          const job = await gameFetch<AiJob>(`ai-jobs/${jobId}`);
          let queueOffline = false;
          let jobError = queueErrorMessage(job.errorCode);

          if (
            poll >= 4 &&
            poll % 4 === 0 &&
            (job.status === "pending" || job.status === "retrying")
          ) {
            const health = await gameFetch<AiQueueHealth>("ai-jobs/health");
            queueOffline = !health.workerOnline;
            if (queueOffline) {
              jobError = health.workerConfigured
                ? "No resolver heartbeat was detected. Your action is saved and will resume automatically when the worker is online."
                : "The API is missing its queue secret. Your action is saved, but production configuration must be corrected.";
            }
          }

          setPendingTurns((current) =>
            current.map((turn) =>
              turn.localId === localId
                ? {
                    ...turn,
                    status: job.status,
                    error: jobError,
                    queueOffline,
                  }
                : turn,
            ),
          );

          if (job.status === "completed") {
            await refresh();
            setPendingTurns((current) => current.filter((turn) => turn.localId !== localId));
            return;
          }
          if (job.status === "failed") return;
        } catch (caught) {
          setPendingTurns((current) =>
            current.map((turn) =>
              turn.localId === localId
                ? {
                    ...turn,
                    status: "retrying",
                    error: caught instanceof Error ? caught.message : "Could not check the queued action.",
                  }
                : turn,
            ),
          );
        }
      }

      setPendingTurns((current) =>
        current.map((turn) =>
          turn.localId === localId
            ? {
                ...turn,
                status: "retrying",
                error: "This action is still saved in the background. Use Check again to refresh its status.",
              }
            : turn,
        ),
      );
    } finally {
      monitoredJobs.current.delete(jobId);
    }
  }

  function editPendingTurn(turn: PendingTurn) {
    setMessage(turn.text);
    setPendingTurns((current) => current.filter((item) => item.localId !== turn.localId));
  }

  function dismissPendingTurn(localId: string) {
    setPendingTurns((current) => current.filter((turn) => turn.localId !== localId));
  }

  if (isPending && !guestMode) return <main className="scene-loading">Opening Calder City…</main>;

  if (!session && !guestMode) {
    async function authenticate(create: boolean) {
      setError("");
      const result = create
        ? await authClient.signUp.email({
            email,
            password,
            name: email.split("@")[0] || "Player",
          })
        : await authClient.signIn.email({ email, password });
      if (result.error) setError(result.error.message || "Authentication failed.");
    }
    return (
      <main className="scene-auth">
        <div className="scene-auth-copy">
          <p className="scene-kicker">NOCTURNE</p>
          <h1>Calder City remembers what you do.</h1>
          <p>Type any action. Build anything plausible. Live with what follows.</p>
        </div>
        <form
          className="scene-auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            void authenticate(false);
          }}
        >
          <label>
            Email
            <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Password
            <input
              required
              minLength={8}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && <p className="scene-error">{error}</p>}
          <button type="submit">Enter the city</button>
          <button type="button" className="scene-quiet-button" onClick={() => void authenticate(true)}>
            Create account
          </button>
        </form>
      </main>
    );
  }

  async function createCharacter(event: FormEvent) {
    event.preventDefault();
    setCreatingCharacter(true);
    setError("");
    try {
      await gameFetch("characters", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          name: characterName,
          conceptSummary: characterConcept,
          originSource: "human",
        }),
      });
      setCharacterName("");
      setCharacterConcept("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Character creation failed.");
    } finally {
      setCreatingCharacter(false);
    }
  }

  async function rentResidence() {
    if (!selected) return;
    setRenting(true);
    setError("");
    try {
      await gameFetch("residences/starter/rent", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ characterId: selected.characterId }),
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not secure the residence.");
    } finally {
      setRenting(false);
    }
  }

  async function submitMessage(event: FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!selected?.residenceId || !text || submitting) return;
    const localId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    const kind = inferJobKind(text);
    setMessage("");
    setSubmitting(true);
    setError("");
    setPendingTurns((current) => [...current, { localId, text, kind, status: "capturing" }]);

    try {
      const path = kind === "action_resolution" ? "ai-jobs/actions" : "ai-jobs/inventions";
      const body =
        kind === "action_resolution"
          ? { actorId: selected.characterId, rawText: text }
          : {
              characterId: selected.characterId,
              residenceId: selected.residenceId,
              rawConcept: text,
              intendedUse: "Support the character's current goals",
            };
      const job = await gameFetch<AiJob>(path, {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        body: JSON.stringify(body),
      });
      setPendingTurns((current) =>
        current.map((turn) =>
          turn.localId === localId ? { ...turn, jobId: job.jobId, status: job.status } : turn,
        ),
      );
      void monitorJob(localId, job.jobId);
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "The action could not be captured.";
      setPendingTurns((current) =>
        current.map((turn) =>
          turn.localId === localId ? { ...turn, status: "failed", error: detail } : turn,
        ),
      );
      setMessage(text);
      setError(detail);
    } finally {
      setSubmitting(false);
    }
  }

  async function installInvention(invention: Invention) {
    if (!selected?.residenceId) return;
    setInstallingId(invention.requestId);
    setError("");
    try {
      await gameFetch(`inventions/${invention.requestId}/install`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          characterId: selected.characterId,
          residenceId: selected.residenceId,
        }),
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Installation failed.");
    } finally {
      setInstallingId(null);
    }
  }

  return (
    <main className="scene-shell">
      <header className="scene-topbar">
        <div className="scene-identity">
          <p className="scene-kicker">CALDER CITY · {world?.neighborhood.name || "FOUNDRY ROW"}</p>
          <div className="scene-identity-row">
            <strong>{selected?.name || "New arrival"}</strong>
            {selected && (
              <div className="scene-vitals" aria-label="Character status">
                <span>{money(selected.cashOnPerson ?? 0)}</span>
                <span>Heat {selected.heat ?? 0}</span>
                {selected.warrant && <span className="scene-danger">Warrant</span>}
              </div>
            )}
          </div>
        </div>
        <button
          aria-label={showCharacter ? "Close character panel" : "Open character panel"}
          className="scene-quiet-button scene-character-toggle"
          onClick={() => setShowCharacter((value) => !value)}
        >
          {showCharacter ? "Close" : "Character"}
        </button>
      </header>

      {error && <div className="scene-alert" role="alert">{error}</div>}

      <div className="scene-layout">
        <section className="scene-main">
          <header className="scene-location">
            <p className="scene-kicker">CURRENT SCENE</p>
            <h1>{selected?.residenceId ? world?.residence.name || "Unit 3B" : "Foundry Row"}</h1>
            <p>
              {selected?.residenceId
                ? `The apartment overlooks ${world?.alley.name || "the rear alley"}. The city moves beyond the walls.`
                : "Rain shines on old brick and machine shops. You have no base and no history here yet."}
            </p>
          </header>

          <div className="scene-story" aria-live="polite">
            {!selected && (
              <article className="scene-onboarding">
                <p className="scene-kicker">WHO ENTERS THE CITY?</p>
                <form onSubmit={createCharacter}>
                  <label>
                    Name
                    <input required maxLength={80} value={characterName} onChange={(event) => setCharacterName(event.target.value)} />
                  </label>
                  <label>
                    Character concept
                    <textarea required maxLength={1000} value={characterConcept} onChange={(event) => setCharacterConcept(event.target.value)} />
                  </label>
                  <button disabled={creatingCharacter} type="submit">
                    {creatingCharacter ? "Creating…" : "Begin"}
                  </button>
                </form>
              </article>
            )}

            {selected && !selected.residenceId && (
              <article className="scene-event scene-event-world">
                <p className="scene-kicker">AN OPEN DOOR</p>
                <h2>Unit 3B is available.</h2>
                <p>Ashdown Apartments is cheap, private enough, and close to the service alleys.</p>
                <button disabled={renting} onClick={() => void rentResidence()}>
                  {renting ? "Signing the lease…" : "Take Unit 3B"}
                </button>
              </article>
            )}

            {selected?.residenceId && timeline.length === 0 && pendingTurns.length === 0 && (
              <article className="scene-event scene-event-world">
                <p className="scene-kicker">THE CITY IS WAITING</p>
                <h2>What do you do?</h2>
                <p>Speak, investigate, travel, work, fight, bargain, or describe something you want to build.</p>
              </article>
            )}

            {timeline.map((entry) => {
              if (entry.kind === "invention") {
                const invention = entry.value;
                return (
                  <article className="scene-turn" key={`invention-${invention.requestId}`}>
                    <div className="scene-player-line">{invention.rawConcept}</div>
                    <div className="scene-event scene-event-invention">
                      <p className="scene-kicker">WORKSHOP · {invention.status.replaceAll("_", " ")}</p>
                      <h2>{invention.draft?.name || "Unresolved design"}</h2>
                      <p>{invention.draft?.conceptSummary || "The design could not be completed."}</p>
                      {invention.definitionId && invention.installation?.fits && !invention.installedInstanceId && (
                        <button
                          disabled={installingId === invention.requestId}
                          onClick={() => void installInvention(invention)}
                        >
                          {installingId === invention.requestId ? "Installing…" : "Install in Unit 3B"}
                        </button>
                      )}
                      {invention.installedInstanceId && <p className="scene-success">Installed and available.</p>}
                      {(invention.validation?.issues?.length || invention.installation?.issues.length) && (
                        <details>
                          <summary>Design weaknesses</summary>
                          {invention.validation?.issues?.map((issue, index) => <p key={`v-${index}`}>{issue.message}</p>)}
                          {invention.installation?.issues.map((issue, index) => <p key={`i-${index}`}>{issue.message}</p>)}
                        </details>
                      )}
                    </div>
                  </article>
                );
              }

              const result = entry.value;
              return (
                <article className="scene-turn" key={`action-${result.eventId}`}>
                  <div className="scene-player-line">{result.rawText}</div>
                  <div className={`scene-event scene-event-${result.outcomeGrade}`}>
                    <p className="scene-kicker">{result.outcomeGrade.replaceAll("_", " ")}</p>
                    <p className="scene-narration">{result.narration}</p>
                    {result.informationGained.map((information) => (
                      <p className="scene-discovery" key={information.informationId}>{information.content}</p>
                    ))}
                    {result.travel && <p className="scene-consequence">Travel: {result.travel.travelSeconds}s{result.travel.scheduled ? " · en route" : " · arrived"}</p>}
                    {result.legal && <p className="scene-consequence">Heat {result.legal.heat}{result.legal.warrant ? " · warrant issued" : ""}{result.legal.jailed ? " · jailed" : ""}</p>}
                    {result.payday && <p className="scene-success">Paid {money(result.payday.paidCents)}</p>}
                  </div>
                </article>
              );
            })}

            {pendingTurns.map((turn) => (
              <article className="scene-turn" key={turn.localId}>
                <div className="scene-player-line">{turn.text}</div>
                <div
                  className={`scene-pending ${turn.status === "failed" ? "scene-pending-failed" : ""} ${turn.queueOffline ? "scene-pending-offline" : ""}`}
                >
                  <span className="scene-pulse" aria-hidden="true" />
                  <div className="scene-pending-copy">
                    <strong>{pendingLabel(turn)}</strong>
                    {turn.error && <p>{turn.error}</p>}
                    {(turn.jobId || turn.status === "failed") && (
                      <div className="scene-pending-actions">
                        {turn.jobId && turn.status !== "failed" && (
                          <button type="button" onClick={() => void monitorJob(turn.localId, turn.jobId!)}>
                            Check again
                          </button>
                        )}
                        {(turn.status === "failed" || turn.queueOffline) && (
                          <button type="button" onClick={() => editPendingTurn(turn)}>
                            Edit action
                          </button>
                        )}
                        {(turn.status === "failed" || turn.queueOffline) && (
                          <button type="button" onClick={() => dismissPendingTurn(turn.localId)}>
                            Dismiss
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        {showCharacter && selected && (
          <aside className="scene-character-panel">
            <p className="scene-kicker">CHARACTER</p>
            <h2>{selected.name}</h2>
            <p>{selected.conceptSummary}</p>
            <dl>
              <div><dt>Cash</dt><dd>{money(selected.cashOnPerson ?? 0)}</dd></div>
              <div><dt>Heat</dt><dd>{selected.heat ?? 0}</dd></div>
              <div><dt>Status</dt><dd>{selected.status || "active"}</dd></div>
              <div><dt>Location</dt><dd>{selected.residenceId ? world?.residence.name || "Unit 3B" : "Foundry Row"}</dd></div>
            </dl>
            {selected.inventory?.length ? (
              <section>
                <p className="scene-kicker">INVENTORY</p>
                {selected.inventory.map((item, index) => <p key={item.instanceId || index}>{item.title || "Unknown item"}</p>)}
              </section>
            ) : null}
            {selected.skills && Object.keys(selected.skills).length ? (
              <section>
                <p className="scene-kicker">SKILLS</p>
                {Object.entries(selected.skills).map(([skill, value]) => <p key={skill}>{skill} · {value}</p>)}
              </section>
            ) : null}
            {session && <button className="scene-quiet-button" onClick={() => void authClient.signOut()}>Sign out</button>}
          </aside>
        )}
      </div>

      {selected?.residenceId && (
        <form className="scene-composer" onSubmit={submitMessage}>
          <label className="sr-only" htmlFor="scene-message">Your action</label>
          <textarea
            id="scene-message"
            required
            maxLength={4000}
            rows={1}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="What do you do?"
          />
          <div className="scene-composer-footer">
            <span>{message.trim() ? (inferJobKind(message) === "invention_normalization" ? "Workshop intent" : "Action") : "Describe any action or invention"}</span>
            <button disabled={submitting || !message.trim()} type="submit">
              {submitting ? "Saving…" : "Do it"}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
