#!/usr/bin/env node
/** Smoke the official agent API end-to-end. */
const API = process.env.NOCTURNE_API_URL || "http://localhost:3001";

async function req(method, path, body, token, extra = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

function check(cond, msg) {
  if (!cond) {
    console.error("FAIL", msg);
    process.exitCode = 1;
  } else console.log("OK", msg);
}

const boot = await req("POST", "/v1/agent/bootstrap", { label: "smoke-agent" });
check(boot.ok && boot.data.token?.startsWith("noct_agt_"), `bootstrap ${boot.status}`);
const token = boot.data.token;

const me = await req("GET", "/v1/agent/me", undefined, token);
check(me.data.auth === "agent", "me auth=agent");

const ch = await req(
  "POST",
  "/v1/agent/characters",
  { name: "Agent Rook", conceptSummary: "Test agent runner", bind: true },
  token,
);
check(ch.ok, `create character ${ch.status}`);

const rent = await req("POST", "/v1/agent/rent", {}, token);
check(rent.ok, `rent ${rent.status}`);

const act = await req("POST", "/v1/agent/act", { text: "I work a courier gig" }, token);
check(act.ok && (act.data.payday || act.data.narration), `act work ${act.status}`);

const status = await req("GET", "/v1/agent/status", undefined, token);
check(status.ok && Number(status.data.character?.cashOnPerson || 0) >= 50000, "status cash");

const hist = await req("GET", "/v1/agent/history", undefined, token);
check(hist.ok && (hist.data.actions?.length || 0) >= 1, "history");

console.log(process.exitCode ? "AGENT SMOKE FAILED" : "AGENT SMOKE PASSED");
