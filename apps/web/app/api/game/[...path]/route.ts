const apiBase = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

async function forward(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const pathname = path.join("/");
  const target = new URL(`/v1/${pathname}`, apiBase);
  target.search = new URL(request.url).search;
  const headers = new Headers();
  for (const name of [
    "authorization",
    "cookie",
    "content-type",
    "idempotency-key",
    "x-nocturne-guest-mode",
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const timeoutMs = pathname === "persistent-world/actions" ? 180_000 : 60_000;
  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return new Response(response.body, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") || "application/json" },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return new Response(
        JSON.stringify({
          error: "gateway_timeout",
          message:
            "The world action is taking too long to resolve. No in-world failure was committed.",
        }),
        { status: 504, headers: { "content-type": "application/json" } },
      );
    }
    throw error;
  }
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const DELETE = forward;
