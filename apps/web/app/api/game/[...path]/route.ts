const apiBase = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const uuid = "[0-9a-fA-F-]{36}";

function allowed(method: string, path: string): boolean {
  if (
    method === "GET" &&
    (path === "/characters" ||
      path === "/world/start" ||
      new RegExp(`^/characters/${uuid}$`).test(path))
  )
    return true;
  if (
    method === "POST" &&
    (path === "/characters" ||
      path === "/residences/starter/rent" ||
      new RegExp(`^/characters/${uuid}/select$`).test(path))
  )
    return true;
  return false;
}

async function forward(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const route = `/${path.join("/")}`;
  if (!allowed(request.method, route))
    return Response.json({ error: "not_found" }, { status: 404 });

  const target = new URL(`/v1${route}`, apiBase);
  target.search = new URL(request.url).search;
  const headers = new Headers();
  for (const name of ["cookie", "content-type", "idempotency-key"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const response = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === "GET" ? undefined : await request.text(),
    cache: "no-store",
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") || "application/json" },
  });
}

export const GET = forward;
export const POST = forward;
