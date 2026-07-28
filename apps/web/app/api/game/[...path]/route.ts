const apiBase = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

async function forward(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const target = new URL(`/v1/${path.join("/")}`, apiBase);
  target.search = new URL(request.url).search;
  const headers = new Headers();
  for (const name of ["cookie", "content-type", "idempotency-key"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const response = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
    cache: "no-store",
  });
  return new Response(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") || "application/json" } });
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const DELETE = forward;
