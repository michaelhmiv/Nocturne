#!/usr/bin/env node
// Phase 5 smoke: full player loop against local API
// NOCTURNE_API_URL=http://localhost:3001 node test/smoke-test.mjs

const API = process.env.NOCTURNE_API_URL || "http://localhost:3001";
const BASE = `${API}/v1`;
const H = { "content-type": "application/json", "x-nocturne-guest-mode": "1" };

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 300)}`);
  return data;
}
async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: H });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 300)}`);
  return data;
}

let ok = 0,
  bad = 0;
const check = (c, m) => {
  if (c) {
    ok++;
    console.log("  ✓ " + m);
  } else {
    bad++;
    console.error("  ✗ " + m);
  }
};

const ACTIONS = [
  ["detect", "I carefully check the alley for hidden cameras."],
  ["search", "I search the dumpster for discarded papers."],
  ["talk", "I chat with a passerby about the neighborhood."],
  ["steal", "I try to pickpocket a drunk standing nearby."],
  ["sneak", "I move silently through the shadows."],
  ["hack", "I try to hack the security panel on the wall."],
  ["attack", "I punch the thug who lunges at me."],
  ["heal", "I bandage my wounds with a first aid kit."],
];

async function main() {
  console.log("\n=== Nocturne smoke test ===\n");

  const health = await get("/health".replace("/v1", "")).catch(() => null);
  // health is at root
  const hres = await fetch(`${API}/health`);
  check(hres.ok, "API health");

  console.log("\n--- Character ---");
  const char = await post("/characters", {
    name: "Smoke Tester",
    conceptSummary: "A freelance courier learning the city streets.",
  });
  const id = char.characterId;
  check(!!id, `created ${id}`);

  console.log("\n--- Residence ---");
  const rent = await post("/residences/starter/rent", { characterId: id });
  check(!!rent.residenceId, `rented ${rent.residenceId}`);

  console.log("\n--- Roster ---");
  const roster = await get("/characters");
  const list = roster.characters || [];
  check(
    list.some((c) => c.characterId === id),
    "character in roster",
  );

  console.log("\n--- Actions ---");
  for (const [want, rawText] of ACTIONS) {
    try {
      const r = await post("/actions", { actorId: id, rawText });
      const trace = (r.calculationTrace || []).join(" ");
      const m = /action=(\w+)/.exec(trace);
      const got = m?.[1] || "unknown";
      check(got === want, `${want} → ${got}`);
      check(typeof r.narration === "string" && r.narration.length > 5, `${want} has narration`);
      check(typeof r.outcomeGrade === "string", `${want} outcome=${r.outcomeGrade}`);
      console.log(`    margin=${r.margin} narr=${String(r.narration).slice(0, 55)}…`);
    } catch (e) {
      bad++;
      console.error(`  ✗ ${want} error: ${e.message.slice(0, 200)}`);
    }
  }

  console.log("\n--- History ---");
  const hist = await get(`/actions?actorId=${id}`);
  const acts = hist.actions || hist;
  check(
    Array.isArray(acts) && acts.length >= 5,
    `history length ${Array.isArray(acts) ? acts.length : 0}`,
  );

  console.log(`\n=== ${ok} passed / ${bad} failed ===`);
  if (bad) process.exit(1);
  console.log("✅ SMOKE PASSED");
}

main().catch((e) => {
  console.error("\n❌ " + e.message);
  process.exit(1);
});
