"use client";

import { FormEvent, useEffect, useState } from "react";
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
  factionStanding?: Record<string, number>;
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
type Listing = {
  listingId: string;
  title: string;
  priceCents: number;
  description: string;
};
type Vehicle = {
  vehicleId: string;
  name: string;
  speedFactor: number;
  ownerId: string | null;
  forSale: boolean;
  priceCents: number;
};
type CommsMsg = {
  messageId: string;
  toName: string;
  body: string;
  intercepted: boolean;
  createdAt: string;
};

type View = "chat" | "dashboard";
type ComposerMode = "act" | "invent";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function GameClient() {
  const { data: session, isPending } = authClient.useSession();
  const [view, setView] = useState<View>("chat");
  const [mode, setMode] = useState<ComposerMode>("act");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [concept, setConcept] = useState("");
  const [message, setMessage] = useState("");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [world, setWorld] = useState<StarterWorld | null>(null);
  const [inventions, setInventions] = useState<Invention[]>([]);
  const [actions, setActions] = useState<ActionResult[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [comms, setComms] = useState<CommsMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guestMode = process.env.NEXT_PUBLIC_NOCTURNE_GUEST_MODE === "true";
  const selected = characters.find((character) => character.selected) || characters[0];
  const selectedCharacterId = selected?.characterId;
  const residenceId = selected?.residenceId;
  const timeline = buildTimeline(selectedCharacterId, inventions, actions);
  const characterInventions = timeline.flatMap((entry) =>
    entry.kind === "invention" ? [entry.value] : [],
  );
  const hasInstalledSystem = characterInventions.some((invention) => invention.installedInstanceId);

  async function refresh() {
    if (!session && !guestMode) return;
    const [characterResponse, worldResponse, inventionResponse, marketResponse, vehicleResponse] =
      await Promise.all([
        gameFetch<{ characters: Character[] }>("characters"),
        gameFetch<StarterWorld>("world/start"),
        gameFetch<{ inventions: Invention[] }>("inventions"),
        gameFetch<{ listings: Listing[] }>("market/listings").catch(() => ({ listings: [] })),
        gameFetch<{ vehicles: Vehicle[] }>("vehicles").catch(() => ({ vehicles: [] })),
      ]);
    const active =
      characterResponse.characters.find((character) => character.selected) ||
      characterResponse.characters[0];
    const [actionResponse, commsResponse] = active
      ? await Promise.all([
          gameFetch<{ actions: ActionResult[] }>(
            `actions?actorId=${encodeURIComponent(active.characterId)}`,
          ),
          gameFetch<{ messages: CommsMsg[] }>(
            `comms?actorId=${encodeURIComponent(active.characterId)}`,
          ).catch(() => ({ messages: [] })),
        ])
      : [{ actions: [] }, { messages: [] }];
    setCharacters(characterResponse.characters);
    setWorld(worldResponse);
    setInventions(inventionResponse.inventions);
    setActions(actionResponse.actions);
    setListings(marketResponse.listings || []);
    setVehicles(vehicleResponse.vehicles || []);
    setComms(commsResponse.messages || []);
  }

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh().catch((caught: Error) => setError(caught.message));
  }, [session?.user.id]);

  useEffect(() => {
    if (view === "chat") window.scrollTo(0, document.body.scrollHeight);
  }, [view, actions.length, inventions.length]);

  if (isPending && !guestMode) return <main className="centered">Loading Nocturne…</main>;

  if (!session && !guestMode) {
    async function authenticate(create: boolean) {
      setError("");
      const result = create
        ? await authClient.signUp.email({ email, password, name: email.split("@")[0] || "Player" })
        : await authClient.signIn.email({ email, password });
      if (result.error) setError(result.error.message || "Authentication failed.");
    }
    return (
      <main className="auth-page">
        <p className="eyebrow">NOCTURNE</p>
        <h1>Enter Calder City.</h1>
        <form
          className="auth-card"
          onSubmit={(event) => {
            event.preventDefault();
            void authenticate(false);
          }}
        >
          <label>
            Email
            <input
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
            />
          </label>
          <label>
            Password
            <input
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit">Sign in</button>
          <button type="button" className="secondary" onClick={() => void authenticate(true)}>
            Create account
          </button>
        </form>
      </main>
    );
  }

  async function createCharacter(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await gameFetch("characters", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ name, conceptSummary: concept, originSource: "human" }),
      });
      setName("");
      setConcept("");
      await refresh();
    });
  }

  async function submitMessage(event: FormEvent) {
    event.preventDefault();
    if (!selected || !selected.residenceId || !message.trim()) return;
    await run(async () => {
      if (mode === "invent") {
        await gameFetch("inventions/normalize", {
          method: "POST",
          body: JSON.stringify({
            characterId: selected.characterId,
            residenceId: selected.residenceId,
            rawConcept: message.trim(),
            intendedUse: "Support the character's current goals",
          }),
        });
      } else {
        await gameFetch("actions", {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({ actorId: selected.characterId, rawText: message.trim() }),
        });
      }
      setMessage("");
      await refresh();
    });
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">NOCTURNE · FOUNDRY ROW</p>
          <strong>{selected?.name || "New arrival"}</strong>
          {selected && (
            <p className="status-strip">
              {money(selected.cashOnPerson ?? 0)}
              {" · "}heat {selected.heat ?? 0}
              {selected.warrant ? " · WARRANT" : ""}
              {selected.status === "jailed" ? " · JAILED" : ""}
            </p>
          )}
        </div>
        <nav aria-label="Primary">
          <button
            className={view === "chat" ? "nav-active" : "nav-button"}
            onClick={() => setView("chat")}
          >
            Chat
          </button>
          <button
            className={view === "dashboard" ? "nav-active" : "nav-button"}
            onClick={() => setView("dashboard")}
          >
            Dashboard
          </button>
        </nav>
        {session && (
          <button className="sign-out" onClick={() => void authClient.signOut()}>
            Sign out
          </button>
        )}
      </header>

      {error && (
        <p className="error app-error" role="alert">
          {error}
        </p>
      )}

      {view === "chat" ? (
        <section className="chat-view" aria-label="Nocturne conversation">
          <div className="messages" aria-live="polite">
            <article className="bubble gm">
              <span className="speaker">Nocturne</span>
              <p>Calder City is awake. Build what you need, then use it to scan the rear alley.</p>
            </article>

            {!selected && (
              <article className="bubble setup">
                <span className="speaker">Create your character</span>
                <form onSubmit={createCharacter}>
                  <label>
                    Name
                    <input
                      required
                      maxLength={80}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                  <label>
                    Who are they?
                    <textarea
                      required
                      maxLength={1000}
                      value={concept}
                      onChange={(event) => setConcept(event.target.value)}
                    />
                  </label>
                  <button disabled={busy} type="submit">
                    Begin
                  </button>
                </form>
              </article>
            )}

            {selected && !selected.residenceId && (
              <article className="bubble gm">
                <span className="speaker">Nocturne</span>
                <p>Your first lead begins behind Ashdown Apartments. Unit 3B can be your base.</p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await gameFetch("residences/starter/rent", {
                        method: "POST",
                        headers: { "idempotency-key": crypto.randomUUID() },
                        body: JSON.stringify({ characterId: selected.characterId }),
                      });
                      await refresh();
                    })
                  }
                >
                  Take Unit 3B
                </button>
              </article>
            )}

            {selected?.residenceId && timeline.length === 0 && (
              <article className="bubble gm">
                <span className="speaker">Nocturne</span>
                <p>
                  Unit 3B is yours. Invent a system for the apartment, or open the dashboard to
                  inspect your world.
                </p>
              </article>
            )}

            {timeline.map((entry) => {
              if (entry.kind === "invention") {
                const invention = entry.value;
                return (
                  <div className="exchange" key={`invention-${invention.requestId}`}>
                    <article className="bubble player">
                      <p>{invention.rawConcept}</p>
                    </article>
                    <article className="bubble gm">
                      <span className="speaker">{invention.draft?.name || "Nocturne"}</span>
                      <p>
                        {invention.draft?.conceptSummary ||
                          "I couldn't resolve that invention yet."}
                      </p>
                      <span className="status-pill">{invention.status.replaceAll("_", " ")}</span>
                      {invention.validation?.issues?.length ||
                      invention.installation?.issues.length ? (
                        <details>
                          <summary>What needs attention</summary>
                          {invention.validation?.issues?.map((issue, index) => (
                            <p key={`v-${index}`}>{issue.message}</p>
                          ))}
                          {invention.installation?.issues.map((issue, index) => (
                            <p key={`i-${index}`}>{issue.message}</p>
                          ))}
                        </details>
                      ) : null}
                      {selectedCharacterId &&
                        residenceId &&
                        invention.definitionId &&
                        invention.installation?.fits &&
                        !invention.installedInstanceId && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await gameFetch(`inventions/${invention.requestId}/install`, {
                                  method: "POST",
                                  headers: { "idempotency-key": crypto.randomUUID() },
                                  body: JSON.stringify({
                                    characterId: selectedCharacterId,
                                    residenceId,
                                  }),
                                });
                                setMode("act");
                                await refresh();
                              })
                            }
                          >
                            Install in Unit 3B
                          </button>
                        )}
                      {invention.installedInstanceId && (
                        <p className="success">Installed in Unit 3B.</p>
                      )}
                    </article>
                  </div>
                );
              }

              const result = entry.value;
              return (
                <div className="exchange" key={`action-${result.eventId}`}>
                  <article className="bubble player">
                    <p>{result.rawText}</p>
                  </article>
                  <article className="bubble gm">
                    <span className="speaker">{result.outcomeGrade.replaceAll("_", " ")}</span>
                    <p>{result.narration}</p>
                    {result.travel && (
                      <p className="intel">
                        Travel {result.travel.travelSeconds}s
                        {result.travel.scheduled ? " (en route)" : " (arrived)"}
                      </p>
                    )}
                    {result.legal && (
                      <p className="intel">
                        Heat {result.legal.heat}
                        {result.legal.warrant ? " · warrant" : ""}
                        {result.legal.jailed ? " · jailed" : ""}
                      </p>
                    )}
                    {result.payday && (
                      <p className="success">
                        Paid {money(result.payday.paidCents)} · wallet{" "}
                        {money(result.payday.cashOnPerson)}
                      </p>
                    )}
                    {result.comms && (
                      <p className="intel">
                        Msg → {result.comms.toName}
                        {result.comms.intercepted ? " · INTERCEPTED" : ""}
                      </p>
                    )}
                    {result.informationGained.map((information) => (
                      <p className="intel" key={information.informationId}>
                        {information.content}
                      </p>
                    ))}
                    <details>
                      <summary>Resolution details</summary>
                      <pre>{result.calculationTrace.join("\n")}</pre>
                    </details>
                  </article>
                </div>
              );
            })}
          </div>

          {selected?.residenceId && (
            <form className="composer" onSubmit={submitMessage}>
              <div className="mode-switch" aria-label="Message type">
                <button
                  type="button"
                  aria-pressed={mode === "invent"}
                  onClick={() => setMode("invent")}
                >
                  Invent
                </button>
                <button type="button" aria-pressed={mode === "act"} onClick={() => setMode("act")}>
                  Act
                </button>
              </div>
              <label className="sr-only" htmlFor="message">
                Message
              </label>
              <textarea
                id="message"
                required
                maxLength={4000}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={
                  mode === "invent"
                    ? "Describe anything you want to create…"
                    : "Act, move, work a gig, message someone…"
                }
              />
              <button disabled={busy || !message.trim()} type="submit" aria-label="Send message">
                {busy ? "…" : "Send"}
              </button>
            </form>
          )}
        </section>
      ) : (
        <section className="dashboard" aria-label="Character dashboard">
          <div className="dashboard-heading">
            <div>
              <p className="eyebrow">CURRENT CHARACTER</p>
              <h1>{selected?.name || "No character"}</h1>
            </div>
            <div className="character-switcher">
              {characters.map((character) => (
                <button
                  className={
                    character.characterId === selected?.characterId ? "selected" : "secondary"
                  }
                  key={character.characterId}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await gameFetch(`characters/${character.characterId}/select`, {
                        method: "POST",
                      });
                      await refresh();
                    })
                  }
                >
                  {character.name}
                </button>
              ))}
            </div>
          </div>
          <div className="dashboard-grid">
            <article className="dashboard-card">
              <p className="card-label">Street status</p>
              <h2>{money(selected?.cashOnPerson ?? 0)}</h2>
              <p>
                Heat {selected?.heat ?? 0}
                {selected?.warrant ? " · WARRANT" : ""}
                {selected?.status === "jailed" ? " · JAILED" : ""}
              </p>
              {selected?.factionStanding && Object.keys(selected.factionStanding).length > 0 && (
                <div className="capacity-grid">
                  {Object.entries(selected.factionStanding).map(([k, v]) => (
                    <div key={k}>
                      <strong>{v > 0 ? `+${v}` : v}</strong>
                      <span>{k}</span>
                    </div>
                  ))}
                </div>
              )}
              {selected?.characterId && (
                <button
                  disabled={busy}
                  className="secondary"
                  onClick={() =>
                    void run(async () => {
                      await gameFetch("actions", {
                        method: "POST",
                        headers: { "idempotency-key": crypto.randomUUID() },
                        body: JSON.stringify({
                          actorId: selected.characterId,
                          rawText: "I work a courier gig across Foundry Row",
                        }),
                      });
                      await refresh();
                    })
                  }
                >
                  Work a gig
                </button>
              )}
            </article>
            <article className="dashboard-card wide">
              <p className="card-label">Identity</p>
              <h2>{selected?.name || "Not established"}</h2>
              <p>{selected?.conceptSummary || "Create a character in Chat."}</p>
            </article>
            <article className="dashboard-card">
              <p className="card-label">Location</p>
              <h2>{selected?.residenceId && world ? world.residence.name : "No residence yet"}</h2>
              <p>
                {selected?.residenceId && world
                  ? `${world.neighborhood.name} · ${world.alley.name}`
                  : "Claim Unit 3B in Chat."}
              </p>
            </article>
            <article className="dashboard-card">
              <p className="card-label">Residence capacity</p>
              <div className="capacity-grid">
                {selected?.residenceId &&
                  world &&
                  Object.entries(world.residence.capacities).map(([key, value]) => (
                    <div key={key}>
                      <strong>{value}</strong>
                      <span>{key}</span>
                    </div>
                  ))}
              </div>
            </article>
            <article className="dashboard-card wide">
              <p className="card-label">Marketplace</p>
              {listings.length ? (
                listings.slice(0, 8).map((listing) => (
                  <div className="dashboard-row" key={listing.listingId}>
                    <div>
                      <strong>{listing.title}</strong>
                      <span>{money(listing.priceCents)}</span>
                    </div>
                    {selected?.characterId && (
                      <button
                        disabled={busy || (selected.cashOnPerson ?? 0) < listing.priceCents}
                        className="secondary"
                        onClick={() =>
                          void run(async () => {
                            await gameFetch("market/buy", {
                              method: "POST",
                              body: JSON.stringify({
                                buyerId: selected.characterId,
                                listingId: listing.listingId,
                              }),
                            });
                            await refresh();
                          })
                        }
                      >
                        Buy
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="empty">No active listings.</p>
              )}
            </article>
            <article className="dashboard-card">
              <p className="card-label">Vehicles</p>
              {vehicles.length ? (
                vehicles.map((v) => (
                  <div className="dashboard-row compact" key={v.vehicleId}>
                    <span>
                      {v.name} · ×{v.speedFactor}
                      {v.ownerId ? " · owned" : ""}
                    </span>
                    {!v.ownerId && selected?.characterId && (
                      <button
                        disabled={busy}
                        className="secondary"
                        onClick={() =>
                          void run(async () => {
                            await gameFetch("vehicles/claim", {
                              method: "POST",
                              body: JSON.stringify({
                                ownerId: selected.characterId,
                                vehicleId: v.vehicleId,
                              }),
                            });
                            await refresh();
                          })
                        }
                      >
                        Claim
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="empty">No vehicles around.</p>
              )}
            </article>
            <article className="dashboard-card">
              <p className="card-label">Inventory</p>
              {(selected?.inventory?.length || 0) > 0 ? (
                selected!.inventory!.map((item, idx) => (
                  <div className="dashboard-row compact" key={item.instanceId || idx}>
                    <span>{item.title || "item"}</span>
                  </div>
                ))
              ) : (
                <p className="empty">Empty pockets. Buy from the market.</p>
              )}
            </article>
            <article className="dashboard-card">
              <p className="card-label">Comms</p>
              {comms.length ? (
                comms.slice(0, 6).map((m) => (
                  <div className="dashboard-row compact" key={m.messageId}>
                    <span>
                      → {m.toName}
                      {m.intercepted ? " ⚠" : ""}
                    </span>
                  </div>
                ))
              ) : (
                <p className="empty">No messages yet. Act: &quot;I message Rook…&quot;</p>
              )}
            </article>
            <article className="dashboard-card wide">
              <p className="card-label">Systems</p>
              {characterInventions.length ? (
                characterInventions.map((invention) => (
                  <div className="dashboard-row" key={invention.requestId}>
                    <div>
                      <strong>{invention.draft?.name || "Unresolved concept"}</strong>
                      <span>{invention.draft?.conceptSummary || invention.rawConcept}</span>
                    </div>
                    <span className="status-pill">
                      {invention.installedInstanceId
                        ? "installed"
                        : invention.status.replaceAll("_", " ")}
                    </span>
                  </div>
                ))
              ) : (
                <p className="empty">No systems yet. Invent one in Chat.</p>
              )}
            </article>
            <article className="dashboard-card">
              <p className="card-label">Intelligence</p>
              {actions.flatMap((action) => action.informationGained).length ? (
                actions
                  .flatMap((action) => action.informationGained)
                  .map((information) => (
                    <p className="intel" key={information.informationId}>
                      {information.content}
                    </p>
                  ))
              ) : (
                <p className="empty">No intelligence gathered.</p>
              )}
            </article>
            <article className="dashboard-card">
              <p className="card-label">Recent outcomes</p>
              {actions.length ? (
                actions.slice(0, 5).map((action) => (
                  <div className="dashboard-row compact" key={action.eventId}>
                    <span>{action.rawText}</span>
                    <strong>{action.outcomeGrade.replaceAll("_", " ")}</strong>
                  </div>
                ))
              ) : (
                <p className="empty">No resolved actions.</p>
              )}
            </article>
          </div>
        </section>
      )}
    </main>
  );
}
