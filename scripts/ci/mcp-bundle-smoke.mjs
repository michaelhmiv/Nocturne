import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

const port = 31_000 + Math.floor(Math.random() * 2_000);
const baseUrl = `http://127.0.0.1:${port}`;

function startServer(signingSecret) {
  const child = spawn(process.execPath, ["apps/mcp/dist/index.cjs"], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      MCP_PUBLIC_BASE_URL: baseUrl,
      NOCTURNE_API_URL: "http://127.0.0.1:9",
      NOCTURNE_API_AUTH_MODE: "guest",
      MCP_OAUTH_SIGNING_SECRET: signingSecret,
      MCP_ADMIN_PASSWORD: "bundle-smoke-admin-password",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  return { child, output: () => output };
}

async function waitForHealth(process) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (process.child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        const body = await response.json();
        if (body?.status === "ok" && body?.service === "nocturne-mcp") return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(process.output() || "Compiled MCP did not become healthy.");
}

async function stopServer(process) {
  if (process.child.exitCode === null) process.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => process.child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (process.child.exitCode === null) process.child.kill("SIGKILL");
}

let first;
let second;
try {
  first = startServer("bundle-smoke-old-oauth-signing-secret-32");
  await waitForHealth(first);
  const registration = await fetch(`${baseUrl}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "ChatGPT",
      redirect_uris: ["https://chatgpt.com/connector/oauth/bundle-smoke"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!registration.ok) throw new Error(`OAuth registration failed: ${registration.status}`);
  const { client_id: clientId } = await registration.json();
  await stopServer(first);
  first = undefined;

  second = startServer("bundle-smoke-new-oauth-signing-secret-32");
  await waitForHealth(second);
  const verifier = "bundle-smoke-verifier".padEnd(64, "a");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = "https://chatgpt.com/connector/oauth/bundle-smoke";
  const resource = `${baseUrl}/mcp`;
  const approval = await fetch(`${baseUrl}/oauth/authorize`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "offline_access nocturne.read nocturne.write",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource,
      state: "bundle-smoke-state",
      password: "bundle-smoke-admin-password",
    }),
    redirect: "manual",
  });
  if (approval.status !== 302) {
    throw new Error(
      `Rotated-key authorization failed: ${approval.status} ${await approval.text()}`,
    );
  }
  const callback = new URL(approval.headers.get("location"));
  const code = callback.searchParams.get("code");
  if (!code) throw new Error("Rotated-key authorization did not issue a code.");

  const exchange = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code,
      code_verifier: verifier,
      resource,
    }),
  });
  if (!exchange.ok) {
    throw new Error(
      `Rotated-key token exchange failed: ${exchange.status} ${await exchange.text()}`,
    );
  }
  const tokens = await exchange.json();
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Rotated-key token exchange returned incomplete credentials.");
  }
} finally {
  if (first) await stopServer(first);
  if (second) await stopServer(second);
}

console.log("Compiled MCP runtime and OAuth client rotation smoke tests passed.");
