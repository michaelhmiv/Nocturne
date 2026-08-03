"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { authClient } from "../lib/auth-client";

export default function AuthPageClient({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const signingUp = mode === "sign-up";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = signingUp
      ? await authClient.signUp.email({
          email,
          password,
          name: name.trim() || email.split("@")[0] || "Player",
        })
      : await authClient.signIn.email({ email, password });
    setBusy(false);
    if (result.error) {
      setError(result.error.message || "Authentication failed.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="auth-page">
      <p className="eyebrow">NOCTURNE ACCOUNT</p>
      <h1>{signingUp ? "Enter Calder City." : "Welcome back."}</h1>
      <form className="auth-card" onSubmit={submit}>
        {signingUp && (
          <label>
            Display name
            <input
              autoComplete="name"
              maxLength={80}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        )}
        <label>
          Email
          <input
            autoComplete="email"
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            autoComplete={signingUp ? "new-password" : "current-password"}
            minLength={8}
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button disabled={busy} type="submit">
          {busy ? "Working…" : signingUp ? "Create account" : "Sign in"}
        </button>
        <p className="account-auth-switch">
          {signingUp ? "Already have an account?" : "Need a Nocturne account?"}{" "}
          <Link href={signingUp ? "/sign-in" : "/sign-up"}>
            {signingUp ? "Sign in" : "Create one"}
          </Link>
        </p>
      </form>
    </main>
  );
}
