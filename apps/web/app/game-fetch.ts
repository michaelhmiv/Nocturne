const guestMode = process.env.NEXT_PUBLIC_NOCTURNE_GUEST_MODE === "true";

function issueMessage(issue: unknown): string | null {
  if (!issue || typeof issue !== "object") return null;
  const value = issue as Record<string, unknown>;
  const path = Array.isArray(value.path) ? value.path.join(".") : "";
  const message = typeof value.message === "string" ? value.message : "";
  if (!message) return null;
  return path ? `${path}: ${message}` : message;
}

function playerFacingError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback || "Game request failed.";
  const value = payload as Record<string, unknown>;
  const code = String(value.error || "");
  const message = typeof value.message === "string" ? value.message : "";
  const issues = Array.isArray(value.issues)
    ? value.issues.map(issueMessage).filter((issue): issue is string => Boolean(issue))
    : [];

  if (issues.length) return issues.slice(0, 3).join(" · ");
  if (["timeout", "rate_limited", "provider_failure", "malformed_response", "validation"].includes(code)) {
    return "Nocturne could not resolve this turn yet. Your captured action can be retried.";
  }
  if (code === "forbidden") return message || "You do not have access to that part of the world.";
  if (code === "idempotency_conflict") return "That action key was already used for a different request.";
  if (code === "not_found") return message || "That part of the world could not be found.";
  return message || code || fallback || "Game request failed.";
}

export async function gameFetch<T>(
  path: string,
  init?: RequestInit,
  guest = guestMode,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  if (guest) headers.set("x-nocturne-guest-mode", "1");

  const response = await fetch(`/api/game/${path}`, { ...init, headers });
  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {}
  if (!response.ok) throw new Error(playerFacingError(payload, text));
  return payload as T;
}
