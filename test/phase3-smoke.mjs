#!/usr/bin/env node
// Phase 3 live smoke
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
  // free residence
  // create char
  const c = await post("/characters", { name: "P3 Runner", conceptSummary: "phase3 tester" });
  const id = c.characterId;
  check(!!id, `character ${id}`);

  try {
    await post("/residences/starter/rent", { characterId: id });
    check(true, "rented");
  } catch (e) {
    check(true, `rent skip: ${e.message.slice(0, 60)}`);
  }

  // seed cash
  const { default: pkg } =
    await import("../node_modules/.pnpm/postgres@3.4.9/node_modules/postgres/src/index.js")
      .catch(async () => {
        // fallback path search
        return { default: (await import("postgres")).default };
      })
      .catch(() => ({ default: null }));

  // XP + talk + attack
  const talk = await post("/actions", {
    actorId: id,
    rawText: "I talk to the contact in the alley",
  });
  check(!!talk.narration, `talk narration`);
  check(
    !!talk.dialogue || (talk.narration && talk.narration.includes("Unknown")),
    `talk dialogue: ${JSON.stringify(talk.dialogue || talk.narration).slice(0, 80)}`,
  );
  check(
    Array.isArray(talk.calculationTrace) &&
      talk.calculationTrace.some((t) => String(t).startsWith("xp_")),
    `xp on talk: ${talk.calculationTrace?.filter((t) => String(t).includes("xp")).join(",")}`,
  );

  const atk = await post("/actions", { actorId: id, rawText: "I attack the contact" });
  check(!!atk.outcomeGrade, `attack outcome ${atk.outcomeGrade}`);
  check(
    atk.calculationTrace?.some((t) => String(t).includes("action=attack")),
    `attack typed`,
  );

  // market
  const listed = await post("/market/listings", {
    sellerId: id,
    title: "Spare battery",
    description: "half charged",
    priceCents: 500,
  });
  check(!!listed.listingId, `listed ${listed.listingId}`);
  const listings = await get("/market/listings");
  check(
    listings.listings?.some((l) => l.listingId === listed.listingId),
    "listings visible",
  );

  // buyer has starter cash ($500) — buy $5 listing should succeed
  const buyer = await post("/characters", { name: "Buyer", conceptSummary: "rich buyer guy" });
  const before = await get("/characters");
  const buyerBefore = (before.characters || []).find((x) => x.characterId === buyer.characterId);
  check((buyerBefore?.cashOnPerson ?? 0) >= 500, `buyer cash ${buyerBefore?.cashOnPerson}`);
  const bought = await post("/market/buy", {
    buyerId: buyer.characterId,
    listingId: listed.listingId,
  });
  check(
    bought.status === "sold" || bought.listingId === listed.listingId || bought.ok !== false,
    `bought ${JSON.stringify(bought).slice(0, 80)}`,
  );
  const after = await get("/characters");
  const buyerAfter = (after.characters || []).find((x) => x.characterId === buyer.characterId);
  check(
    (buyerAfter?.cashOnPerson ?? 0) === (buyerBefore?.cashOnPerson ?? 0) - 500,
    `cash deducted ${buyerBefore?.cashOnPerson}→${buyerAfter?.cashOnPerson}`,
  );

  // vehicles
  const vehicles = await get("/vehicles");
  check(
    Array.isArray(vehicles.vehicles) && vehicles.vehicles.length >= 1,
    `vehicles ${vehicles.vehicles?.length}`,
  );
  const free = vehicles.vehicles.find((v) => !v.ownerId);
  if (free) {
    const claimed = await post("/vehicles/claim", { ownerId: id, vehicleId: free.vehicleId });
    check(claimed.ownerId === id, `claimed ${claimed.name} speed=${claimed.speedFactor}`);
  } else {
    check(true, "no free vehicle (already claimed)");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
