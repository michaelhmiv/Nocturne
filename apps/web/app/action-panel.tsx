"use client";
import { useEffect, useState } from "react";
type ActionResult = {
  eventId: string;
  outcomeGrade: string;
  margin: number;
  narration: string;
  calculationTrace: string[];
  informationGained: Array<{ informationId: string; content: string; confidence: number }>;
  costs: Array<{ resource: string; amount: number }>;
  idempotentReplay: boolean;
};
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/game/${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || payload.error || "Action failed.");
  return payload as T;
}
export default function ActionPanel({ characterId }: { characterId: string }) {
  const [text, setText] = useState("Scan the alley behind my building for suspicious movement.");
  const [history, setHistory] = useState<ActionResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function refresh() {
    const result = await request<{ actions: ActionResult[] }>(
      `actions?actorId=${encodeURIComponent(characterId)}`,
    );
    setHistory(result.actions);
  }
  useEffect(() => {
    void refresh().catch((error: Error) => setMessage(error.message));
  }, [characterId]);
  return (
    <article className="panel action-panel">
      <h2>Take an action</h2>
      <p className="muted">
        Describe what your character does. The backend selects owned capabilities, derives scores,
        resolves uncertainty, and commits the event before narration.
      </p>
      <textarea value={text} onChange={(event) => setText(event.target.value)} />
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            const result = await request<ActionResult>("actions", {
              method: "POST",
              headers: { "idempotency-key": crypto.randomUUID() },
              body: JSON.stringify({ actorId: characterId, rawText: text }),
            });
            setHistory((current) => [result, ...current]);
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "Action failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Resolving…" : "Resolve action"}
      </button>
      {message && <p className="notice">{message}</p>}
      <div className="action-history">
        {history.map((result) => (
          <div className="action-result" key={result.eventId}>
            <span className="badge">{result.outcomeGrade.replaceAll("_", " ")}</span>
            <p>{result.narration}</p>
            {result.informationGained.map((information) => (
              <p className="intel" key={information.informationId}>
                {Math.round(information.confidence * 100)}% confidence — {information.content}
              </p>
            ))}
            {result.costs.length > 0 && (
              <p className="muted">
                Cost: {result.costs.map((cost) => `${cost.amount} ${cost.resource}`).join(", ")}
              </p>
            )}
            <details>
              <summary>Calculation trace</summary>
              <pre>{result.calculationTrace.join("\n")}</pre>
            </details>
          </div>
        ))}
      </div>
    </article>
  );
}
