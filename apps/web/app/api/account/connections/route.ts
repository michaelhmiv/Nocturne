import { createMcpOAuthStore, getSessionFromNodeHeaders } from "@nocturne/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let store: ReturnType<typeof createMcpOAuthStore> | undefined;

function oauthStore() {
  if (store) return store;
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  store = createMcpOAuthStore(databaseUrl);
  return store;
}

async function sessionFor(request: Request) {
  return getSessionFromNodeHeaders(Object.fromEntries(request.headers.entries()));
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function GET(request: Request) {
  const session = await sessionFor(request);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const grants = await oauthStore().listGrants(session.user.id);
  return Response.json({
    connections: grants.map((grant) => ({
      grantId: grant.grantId,
      scopes: grant.scope.split(/\s+/).filter(Boolean),
      createdAt: grant.createdAt.toISOString(),
      expiresAt: grant.expiresAt.toISOString(),
      revokedAt: grant.revokedAt?.toISOString() || null,
      active: !grant.revokedAt && grant.expiresAt.getTime() > Date.now(),
    })),
  });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "invalid_origin" }, { status: 403 });
  const session = await sessionFor(request);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (input.all === true) {
    const revoked = await oauthStore().revokeAllGrants(session.user.id);
    return Response.json({ revoked });
  }
  const grantId = typeof input.grantId === "string" ? input.grantId.trim() : "";
  if (!grantId) return Response.json({ error: "grant_id_required" }, { status: 400 });
  const revoked = await oauthStore().revokeGrant({ userId: session.user.id, grantId });
  return Response.json({ revoked });
}
