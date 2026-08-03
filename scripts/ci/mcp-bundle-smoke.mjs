import { spawn } from "node:child_process";

const port = 31_000 + Math.floor(Math.random() * 2_000);
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["apps/mcp/dist/index.cjs"], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    MCP_PUBLIC_BASE_URL: baseUrl,
    NOCTURNE_API_URL: "http://127.0.0.1:9",
    NOCTURNE_API_AUTH_MODE: "guest",
    MCP_OAUTH_SIGNING_SECRET: "bundle-smoke-oauth-signing-secret-32",
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

const deadline = Date.now() + 10_000;
let healthy = false;
try {
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        const body = await response.json();
        if (body?.status === "ok" && body?.service === "nocturne-mcp") {
          healthy = true;
          break;
        }
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

if (!healthy) {
  console.error(output || "Compiled MCP did not become healthy.");
  process.exit(1);
}

console.log("Compiled MCP runtime smoke test passed.");
