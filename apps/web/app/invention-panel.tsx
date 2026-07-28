"use client";

import { useEffect, useState } from "react";

type Invention = {
  requestId: string;
  rawConcept: string;
  status: string;
  definitionId: string | null;
  installedInstanceId: string | null;
  draft: { name: string; conceptSummary: string } | null;
  validation: { issues?: Array<{ message: string }> } | null;
  installation: { fits: boolean; issues: Array<{ message: string }>; warnings: string[] } | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/game/${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(payload.message || payload.error || "Invention request failed.");
  return payload as T;
}

export default function InventionPanel({
  characterId,
  residenceId,
}: {
  characterId: string;
  residenceId: string;
}) {
  const [concept, setConcept] = useState(
    "A hidden surveillance array using thermal cameras, directional microphones, and a homemade motion-analysis AI to watch the alley behind my building.",
  );
  const [inventions, setInventions] = useState<Invention[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function refresh() {
    const result = await request<{ inventions: Invention[] }>("inventions");
    setInventions(result.inventions);
  }
  useEffect(() => {
    void refresh().catch((error: Error) => setMessage(error.message));
  }, [characterId]);
  return (
    <article className="panel invention-panel">
      <h2>Invent something</h2>
      <p className="muted">
        Describe any device. The authoritative model converts it into effects, requirements,
        limitations, signatures, and counterplay before the backend allows installation.
      </p>
      <textarea value={concept} onChange={(event) => setConcept(event.target.value)} />
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            await request("inventions/normalize", {
              method: "POST",
              body: JSON.stringify({
                characterId,
                residenceId,
                rawConcept: concept,
                intendedUse: "Monitor the rear alley",
              }),
            });
            await refresh();
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "Normalization failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Normalizing…" : "Normalize invention"}
      </button>
      {message && <p className="notice">{message}</p>}
      <div className="invention-list">
        {inventions.map((invention) => (
          <div className="invention" key={invention.requestId}>
            <strong>{invention.draft?.name || "Unresolved concept"}</strong>
            <span className="badge">{invention.status}</span>
            <p>{invention.draft?.conceptSummary || invention.rawConcept}</p>
            {invention.validation?.issues?.map((issue, index) => (
              <p className="muted" key={index}>
                {issue.message}
              </p>
            ))}
            {invention.installation?.issues.map((issue, index) => (
              <p className="notice" key={index}>
                {issue.message}
              </p>
            ))}
            {invention.definitionId &&
              invention.installation?.fits &&
              !invention.installedInstanceId && (
                <button
                  onClick={async () => {
                    await request(`inventions/${invention.requestId}/install`, {
                      method: "POST",
                      headers: { "idempotency-key": crypto.randomUUID() },
                      body: JSON.stringify({ characterId, residenceId }),
                    });
                    await refresh();
                  }}
                >
                  Install in Unit 3B
                </button>
              )}
            {invention.installedInstanceId && <p className="status">Installed and persistent.</p>}
          </div>
        ))}
      </div>
    </article>
  );
}
