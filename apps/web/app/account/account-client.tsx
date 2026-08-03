"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "../../lib/auth-client";

type Connection = {
  grantId: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  active: boolean;
};

export default function AccountClient() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function loadConnections() {
    const response = await fetch("/api/account/connections", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load ChatGPT connections.");
    const body = (await response.json()) as { connections: Connection[] };
    setConnections(body.connections);
  }

  useEffect(() => {
    if (!session) return;
    void loadConnections().catch((caught: Error) => setError(caught.message));
  }, [session?.user.id]);

  async function revoke(input: { grantId?: string; all?: boolean }) {
    const key = input.all ? "all" : input.grantId || "";
    setBusy(key);
    setError("");
    try {
      const response = await fetch("/api/account/connections", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error("The connection could not be revoked.");
      await loadConnections();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The connection could not be revoked.");
    } finally {
      setBusy("");
    }
  }

  if (isPending) return <main className="centered">Loading account…</main>;
  if (!session) {
    return (
      <main className="account-page">
        <section className="account-panel">
          <p className="eyebrow">NOCTURNE ACCOUNT</p>
          <h1>Sign in required.</h1>
          <p>Sign in to manage your game identity and ChatGPT connections.</p>
          <div className="account-actions">
            <Link className="account-link-button" href="/sign-in">
              Sign in
            </Link>
            <Link className="account-link-button secondary" href="/sign-up">
              Create account
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const activeConnections = connections.filter((connection) => connection.active);

  return (
    <main className="account-page">
      <section className="account-panel">
        <p className="eyebrow">NOCTURNE ACCOUNT</p>
        <h1>{session.user.name || "Player"}</h1>
        <dl className="account-details">
          <div>
            <dt>Email</dt>
            <dd>{session.user.email}</dd>
          </div>
          <div>
            <dt>Account ID</dt>
            <dd className="account-mono">{session.user.id}</dd>
          </div>
        </dl>
        <button
          className="secondary"
          onClick={() => {
            void authClient.signOut().then(() => {
              router.replace("/sign-in");
              router.refresh();
            });
          }}
          type="button"
        >
          Sign out
        </button>
      </section>

      <section className="account-panel">
        <div className="account-section-heading">
          <div>
            <p className="eyebrow">CONNECTED APPS</p>
            <h2>ChatGPT connections</h2>
          </div>
          {activeConnections.length > 0 && (
            <button
              className="secondary danger"
              disabled={busy === "all"}
              onClick={() => void revoke({ all: true })}
              type="button"
            >
              {busy === "all" ? "Revoking…" : "Revoke all"}
            </button>
          )}
        </div>
        <p className="account-muted">
          Revoking a connection immediately invalidates its MCP access and refresh tokens. ChatGPT
          must be authorized again before it can access this account.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {connections.length === 0 ? (
          <p className="account-empty">No ChatGPT connections have been authorized.</p>
        ) : (
          <div className="connection-list">
            {connections.map((connection) => (
              <article className="connection-card" key={connection.grantId}>
                <div>
                  <strong>{connection.active ? "Active ChatGPT connection" : "Revoked connection"}</strong>
                  <p>
                    Authorized {new Date(connection.createdAt).toLocaleString()} · Expires{" "}
                    {new Date(connection.expiresAt).toLocaleString()}
                  </p>
                  <p className="account-mono">{connection.scopes.join(" · ")}</p>
                </div>
                {connection.active && (
                  <button
                    className="secondary danger"
                    disabled={busy === connection.grantId}
                    onClick={() => void revoke({ grantId: connection.grantId })}
                    type="button"
                  >
                    {busy === connection.grantId ? "Revoking…" : "Revoke"}
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
