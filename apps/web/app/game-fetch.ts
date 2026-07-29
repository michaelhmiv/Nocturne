const guestMode = process.env.NEXT_PUBLIC_NOCTURNE_GUEST_MODE === "true";

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
  if (!response.ok) {
    const detail =
      payload && typeof payload === "object"
        ? String(
            (payload as { message?: unknown; error?: unknown }).message ||
              (payload as { error?: unknown }).error ||
              text,
          )
        : text;
    throw new Error(detail || "Game request failed.");
  }
  return payload as T;
}
