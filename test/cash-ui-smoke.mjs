#!/usr/bin/env node
// Cash + status smoke
const API = process.env.NOCTURNE_API_URL || "http://localhost:3001";
const BASE = `${API}/v1`;
const H = { "content-type": "application/json", "x-nocturne-guest-mode": "1" };
let pass = 0,
  fail = 0;
const check = (ok, msg) => {
  if (ok) {
    pass++;
    console.log("✓", msg);
  } else {
    fail++;
    console.log("✗", msg);
  }
};
const post = async (path, body) => {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    j = { raw: t };
  }
  if (!r.ok) throw new Error(`${path} ${r.status}: ${t}`);
  return j;
};
const get = async (path) => {
  const r = await fetch(`${BASE}${path}`, { headers: H });
  const t = await r.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    j = { raw: t };
  }
  if (!r.ok) throw new Error(`${path} ${r.status}: ${t}`);
  return j;
};

const main = async () => {
  const c = await post("/characters", {
    name: "Cash Runner",
    conceptSummary: "street courier with grit",
  });
  check(!!c.characterId, `char ${c.characterId}`);
  const list = await get("/characters");
  const me = (list.characters || []).find((x) => x.characterId === c.characterId);
  check(me?.cashOnPerson === 50000, `starter cash ${me?.cashOnPerson}`);
  check(typeof me?.heat === "number", `heat field ${me?.heat}`);

  try {
    await post("/residences/starter/rent", { characterId: c.characterId });
  } catch {}

  const work = await post("/actions", {
    actorId: c.characterId,
    rawText: "I work a courier gig tonight",
  });
  check(
    !!work.payday || work.calculationTrace?.some((t) => String(t).startsWith("payday=")),
    `payday ${JSON.stringify(work.payday || {})}`,
  );
  const after = await get("/characters");
  const me2 = (after.characters || []).find((x) => x.characterId === c.characterId);
  check((me2?.cashOnPerson ?? 0) > 50000, `cash grew ${me2?.cashOnPerson}`);

  // list market/vehicles/comms for UI
  const m = await get("/market/listings");
  check(Array.isArray(m.listings), `listings ${m.listings?.length}`);
  const v = await get("/vehicles");
  check(Array.isArray(v.vehicles), `vehicles ${v.vehicles?.length}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
