"use client";

import { useEffect, useState } from "react";
import { authClient } from "../lib/auth-client";
import InventionPanel from "./invention-panel";

type Character = {
  characterId: string;
  name: string;
  conceptSummary: string;
  selected: boolean;
  residenceId: string | null;
};
type StarterWorld = {
  neighborhood: { name: string };
  residence: {
    id: string;
    name: string;
    occupiedByCharacterId: string | null;
    capacities: Record<string, number>;
  };
  alley: { name: string };
};
async function gameFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/game/${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || payload.error || "Game request failed.");
  return payload as T;
}

export default function GameClient() {
  const { data: session, isPending } = authClient.useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [concept, setConcept] = useState("");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [world, setWorld] = useState<StarterWorld | null>(null);
  const [message, setMessage] = useState("");
  async function refresh() {
    if (!session) return;
    const [characterResponse, worldResponse] = await Promise.all([
      gameFetch<{ characters: Character[] }>("characters"),
      gameFetch<StarterWorld>("world/start"),
    ]);
    setCharacters(characterResponse.characters);
    setWorld(worldResponse);
  }
  useEffect(() => {
    void refresh().catch((error: Error) => setMessage(error.message));
  }, [session?.user.id]);
  if (isPending)
    return (
      <main>
        <p>Loading Nocturne…</p>
      </main>
    );
  if (!session)
    return (
      <main>
        <p className="eyebrow">NOCTURNE</p>
        <h1>Enter Calder City.</h1>
        <section className="panel auth-panel">
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
          </label>
          <label>
            Password
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
            />
          </label>
          <div className="actions">
            <button onClick={() => void authClient.signIn.email({ email, password })}>
              Sign in
            </button>
            <button
              className="secondary"
              onClick={() =>
                void authClient.signUp.email({
                  email,
                  password,
                  name: email.split("@")[0] || "Player",
                })
              }
            >
              Create account
            </button>
          </div>
        </section>
      </main>
    );
  const selected = characters.find((character) => character.selected) || characters[0];
  return (
    <main>
      <div className="topline">
        <p className="eyebrow">FOUNDRY ROW</p>
        <button className="link" onClick={() => void authClient.signOut()}>
          Sign out
        </button>
      </div>
      <h1>{selected ? selected.name : "Create your first character."}</h1>
      <p className="lede">
        Invent freely. Nocturne converts the idea into persistent mechanics without turning the
        catalog into a limit.
      </p>
      {message && <p className="notice">{message}</p>}
      <section className="grid">
        <article className="panel">
          <h2>Characters</h2>
          {characters.map((character) => (
            <button
              key={character.characterId}
              className={`character ${character.selected ? "active" : ""}`}
              onClick={async () => {
                await gameFetch(`characters/${character.characterId}/select`, { method: "POST" });
                await refresh();
              }}
            >
              <strong>{character.name}</strong>
              <span>{character.conceptSummary}</span>
            </button>
          ))}
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Concept
            <textarea value={concept} onChange={(event) => setConcept(event.target.value)} />
          </label>
          <button
            onClick={async () => {
              await gameFetch("characters", {
                method: "POST",
                headers: { "idempotency-key": crypto.randomUUID() },
                body: JSON.stringify({ name, conceptSummary: concept, originSource: "human" }),
              });
              setName("");
              setConcept("");
              await refresh();
            }}
          >
            Create character
          </button>
        </article>
        <article className="panel">
          <h2>Starting residence</h2>
          {world ? (
            <>
              <p>
                <strong>{world.residence.name}</strong>
                <br />
                {world.neighborhood.name}, overlooking the {world.alley.name.toLowerCase()}.
              </p>
              <p className="muted">
                Capacity:{" "}
                {Object.entries(world.residence.capacities)
                  .map(([key, value]) => `${key} ${value}`)
                  .join(" · ")}
              </p>
            </>
          ) : (
            <p>Loading world…</p>
          )}
          {selected && !selected.residenceId && (
            <button
              onClick={async () => {
                await gameFetch("residences/starter/rent", {
                  method: "POST",
                  headers: { "idempotency-key": crypto.randomUUID() },
                  body: JSON.stringify({ characterId: selected.characterId }),
                });
                await refresh();
              }}
            >
              Rent Unit 3B
            </button>
          )}
          {selected?.residenceId && <p className="status">Residence secured.</p>}
        </article>
      </section>
      {selected?.residenceId && (
        <section>
          <InventionPanel characterId={selected.characterId} residenceId={selected.residenceId} />
        </section>
      )}
    </main>
  );
}
