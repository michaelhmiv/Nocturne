#!/usr/bin/env node
/**
 * Live play audit — acts like a player turn-by-turn and checks DB state.
 * Not a unit test. Failures = real product bugs.
 */
import pkg from "../node_modules/.pnpm/postgres@3.4.9/node_modules/postgres/src/index.js";

const API = process.env.NOCTURNE_API_URL || "http://localhost:3001";
const DB = process.env.DATABASE_URL || "postgresql://pguser@localhost:5433/nocturne";
const H = { "content-type": "application/json", "x-nocturne-guest-mode": "1" };

const sql = pkg(DB, { prepare: false });
const log = [];
const bugs = [];
let pass = 0,
  fail = 0;

const note = (msg) => {
  console.log(msg);
  log.push(msg);
};
const ok = (cond, msg) => {
  if (cond) {
    pass++;
    note(`  ✓ ${msg}`);
  } else {
    fail++;
    bugs.push(msg);
    note(`  ✗ ${msg}`);
  }
};
const step = (title) => note(`\n## ${title}`);

async function api(method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    j = { raw: text };
  }
  return { status: r.status, ok: r.ok, body: j, text };
}

async function dbChar(id) {
  const rows = await sql`
    SELECT i.instance_id, i.location_id, i.state, i.owner_id, d.name,
           o.residence_instance_id
    FROM game.entity_instances i
    JOIN game.entity_definitions d ON d.definition_id = i.definition_id
    LEFT JOIN game.residence_occupancies o
      ON o.character_instance_id = i.instance_id AND o.status = 'active'
    WHERE i.instance_id = ${id}
  `;
  if (!rows[0]) return null;
  const st = rows[0].state || {};
  return {
    name: rows[0].name,
    locationId: rows[0].location_id,
    residenceId: rows[0].residence_instance_id,
    cash: Number(st.cashOnPerson ?? 0),
    heat: Number(st.heat ?? 0),
    warrant: Boolean(st.warrant),
    status: st.status || "active",
    skills: st.skills || {},
    factions: st.factionStanding || {},
    inventory: st.inventory || st.items || st.carried || null,
    stateKeys: Object.keys(st),
  };
}

async function locName(id) {
  if (!id) return null;
  const rows = await sql`
    SELECT d.name FROM game.entity_instances i
    JOIN game.entity_definitions d ON d.definition_id = i.definition_id
    WHERE i.instance_id = ${id}
  `;
  return rows[0]?.name || String(id).slice(0, 8);
}

async function ownedVehicles(ownerId) {
  return sql`
    SELECT instance_id, state FROM game.entity_instances
    WHERE definition_id = 'vehicle' AND owner_id = ${ownerId}
  `;
}

async function listingsFor(sellerId) {
  return sql`
    SELECT listing_id, title, price_cents, status FROM game.marketplace_listings
    WHERE seller_id = ${sellerId} ORDER BY created_at DESC
  `;
}

async function itemsOwned(ownerId) {
  // try common ownership patterns
  const byOwner = await sql`
    SELECT i.instance_id, d.name, d.definition_type, i.state
    FROM game.entity_instances i
    JOIN game.entity_definitions d ON d.definition_id = i.definition_id
    WHERE i.owner_id = ${ownerId}
      AND d.definition_type NOT IN ('character')
  `;
  return byOwner;
}

async function main() {
  note("=== NOCTURNE LIVE PLAY AUDIT ===");
  note(`API ${API}`);

  // Isolate from leftover runs / shared-DB unit tests
  await sql`DELETE FROM game.residence_occupancies`;
  await sql`
    INSERT INTO game.entity_definitions (
      definition_id, definition_type, name, concept_summary, origin_source, lifecycle_status
    ) VALUES ('vehicle','item','Vehicle','street vehicle','seed','approved')
    ON CONFLICT (definition_id) DO NOTHING
  `;
  await sql`
    INSERT INTO game.entity_instances (instance_id, definition_id, location_id, state, owner_id) VALUES
      ('b1000000-0000-4000-8000-000000000001','vehicle',NULL,
       '{"name":"Courier Bike","speedFactor":2.5,"forSale":true,"priceCents":25000}'::jsonb,NULL),
      ('b1000000-0000-4000-8000-000000000002','vehicle',NULL,
       '{"name":"Used Sedan","speedFactor":1.8,"forSale":true,"priceCents":120000}'::jsonb,NULL)
    ON CONFLICT (instance_id) DO UPDATE
      SET owner_id = NULL, state = EXCLUDED.state, updated_at = now()
  `;
  note("world prep: residences freed, vehicles available");

  // --- 1. Create character ---
  step("1. Create character (new arrival)");
  const create = await api("POST", "/v1/characters", {
    name: "Rook Vale",
    conceptSummary: "Ex-courier trying to stay clean in Foundry Row",
  });
  ok(create.ok, `create HTTP ${create.status}`);
  const id = create.body.characterId;
  ok(!!id, `got characterId ${id}`);
  note(`  player: Rook Vale (${id})`);

  let me = await dbChar(id);
  ok(me?.cash === 50000, `starter wallet $500 (got ${me?.cash})`);
  ok(me?.heat === 0, `start heat 0 (got ${me?.heat})`);
  ok(me?.locationId, `spawn location set (${await locName(me?.locationId)})`);
  const spawnLoc = me?.locationId;

  // --- 2. Rent ---
  step("2. Rent Unit 3B");
  const rent = await api("POST", "/v1/residences/starter/rent", { characterId: id });
  ok(rent.ok, `rent HTTP ${rent.status} ${rent.ok ? "" : rent.text.slice(0, 120)}`);
  me = await dbChar(id);
  ok(!!me?.residenceId, `residence occupancy in DB (${me?.residenceId})`);

  // --- 3. Roster / UI status fields ---
  step("3. Check roster shows money/heat (UI feed)");
  const roster = await api("GET", "/v1/characters");
  const row = (roster.body.characters || []).find((c) => c.characterId === id);
  ok(row?.cashOnPerson === 50000, `API roster cash ${row?.cashOnPerson}`);
  ok(row?.heat === 0, `API roster heat ${row?.heat}`);

  // --- 4. Work a gig ---
  step("4. Work a courier gig (earn cash)");
  const work = await api("POST", "/v1/actions", {
    actorId: id,
    rawText: "I work a courier gig across Foundry Row",
  });
  ok(work.ok, `work HTTP ${work.status}`);
  note(`  narr: ${String(work.body.narration || "").slice(0, 120)}`);
  note(`  payday: ${JSON.stringify(work.body.payday || null)}`);
  ok(!!work.body.payday, "response includes payday");
  me = await dbChar(id);
  ok(me.cash > 50000, `DB cash increased (${me.cash})`);
  const cashAfterWork = me.cash;
  ok(
    Object.keys(me.skills).length > 0 ||
      work.body.calculationTrace?.some((t) => String(t).includes("xp_")),
    `skills/xp progressing skills=${JSON.stringify(me.skills)}`,
  );

  // --- 5. Talk to NPC ---
  step("5. Talk to alley contact");
  const talk = await api("POST", "/v1/actions", {
    actorId: id,
    rawText: "I talk to the contact in the alley about odd jobs",
  });
  ok(talk.ok, `talk HTTP ${talk.status}`);
  note(`  narr: ${String(talk.body.narration || "").slice(0, 140)}`);
  ok(
    !!talk.body.dialogue || /contact|alley|interested|Unknown/i.test(talk.body.narration || ""),
    "got dialogue-ish response",
  );

  // --- 6. Move ---
  step("6. Move to Rear Alley");
  const beforeMove = await dbChar(id);
  const move = await api("POST", "/v1/actions", {
    actorId: id,
    rawText: "I move to the Rear Alley",
  });
  ok(move.ok, `move HTTP ${move.status}`);
  note(`  travel: ${JSON.stringify(move.body.travel || null)}`);
  note(`  narr: ${String(move.body.narration || "").slice(0, 120)}`);
  ok(
    !!move.body.travel || move.body.calculationTrace?.some((t) => String(t).includes("travel")),
    "travel payload present",
  );

  // if scheduled, wait for worker (poll every 2s up to ETA+12s)
  if (move.body.travel?.scheduled) {
    const secs = (move.body.travel.travelSeconds || 5) + 12;
    note(`  waiting up to ${secs}s for worker arrival…`);
    const deadline = Date.now() + secs * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const cur = await dbChar(id);
      if (cur?.locationId === move.body.travel.to) break;
    }
  }
  me = await dbChar(id);
  const movedName = await locName(me.locationId);
  note(`  DB location now: ${movedName} (${me.locationId})`);
  ok(
    me.locationId === move.body.travel?.to ||
      (!move.body.travel?.scheduled && me.locationId !== beforeMove.locationId),
    `arrived at destination (want ${move.body.travel?.to}, got ${me.locationId})`,
  );

  // --- 7. Message ---
  step("7. Send a message to Rook's contact");
  const msg = await api("POST", "/v1/actions", {
    actorId: id,
    rawText: "I message Mira about a package drop behind Ashdown",
  });
  ok(msg.ok, `message HTTP ${msg.status}`);
  note(`  comms: ${JSON.stringify(msg.body.comms || null)}`);
  ok(!!msg.body.comms, "comms object returned");
  const comms = await api("GET", `/v1/comms?actorId=${id}`);
  ok((comms.body.messages || []).length >= 1, `comms list ${comms.body.messages?.length}`);

  // --- 8. Invent something ---
  step("8. Invent a pocket radio");
  const residenceId = me.residenceId || rent.body.residenceId;
  const invent = await api("POST", "/v1/inventions/normalize", {
    characterId: id,
    residenceId,
    rawConcept: "A battered pocket radio that can scan police bands",
    intendedUse: "Listen for patrol chatter",
  });
  ok(invent.ok, `invent HTTP ${invent.status} ${invent.ok ? "" : invent.text.slice(0, 200)}`);
  note(`  invent body keys: ${Object.keys(invent.body || {}).join(",")}`);
  const requestId = invent.body.requestId;
  ok(!!requestId, `requestId ${requestId}`);

  // list inventions
  const invList = await api("GET", "/v1/inventions");
  const mine = (invList.body.inventions || []).filter((i) => i.characterId === id);
  ok(mine.length >= 1, `invention listed (${mine.length})`);
  note(`  invention status: ${mine[0]?.status} draft=${mine[0]?.draft?.name}`);

  // try install if possible
  if (requestId && residenceId) {
    const install = await api("POST", `/v1/inventions/${requestId}/install`, {
      characterId: id,
      residenceId,
    });
    note(`  install HTTP ${install.status} ${install.ok ? "ok" : install.text.slice(0, 200)}`);
    if (!install.ok) {
      bugs.push(`install blocked: ${install.text.slice(0, 160)}`);
      fail++;
      note(`  ✗ install failed`);
    } else {
      ok(true, "installed invention");
      const afterInstall = (await api("GET", "/v1/inventions")).body.inventions || [];
      const inst = afterInstall.find((i) => i.requestId === requestId);
      ok(!!inst?.installedInstanceId, `installedInstanceId ${inst?.installedInstanceId}`);
    }
  }

  // --- 9. Market list + buy cycle ---
  step("9. List an item on the market, buy with second character");
  const list = await api("POST", "/v1/market/listings", {
    sellerId: id,
    title: "Courier satchel",
    description: "scuffed leather, still holds",
    priceCents: 2500,
  });
  ok(list.ok, `list HTTP ${list.status}`);
  const listingId = list.body.listingId;
  ok(!!listingId, `listingId ${listingId}`);

  const buyer = await api("POST", "/v1/characters", {
    name: "Penny Cash",
    conceptSummary: "Local buyer with spare change",
  });
  ok(buyer.ok, `buyer create ${buyer.status}`);
  const buyerId = buyer.body.characterId;
  let buyerDb = await dbChar(buyerId);
  ok(buyerDb.cash === 50000, `buyer starter cash ${buyerDb.cash}`);

  const buy = await api("POST", "/v1/market/buy", { buyerId, listingId });
  ok(buy.ok, `buy HTTP ${buy.status} ${buy.ok ? "" : buy.text.slice(0, 160)}`);
  buyerDb = await dbChar(buyerId);
  me = await dbChar(id);
  ok(buyerDb.cash === 50000 - 2500, `buyer paid 25 → cash ${buyerDb.cash}`);
  // seller should receive cash
  ok(
    me.cash === cashAfterWork + 2500,
    `seller received 25 → cash ${me.cash} (pre ${cashAfterWork})`,
  );

  const listingRows = await listingsFor(id);
  ok(
    listingRows.some((l) => String(l.listing_id) === listingId && l.status === "sold"),
    "listing marked sold",
  );

  const buyerItems = await itemsOwned(buyerId);
  note(
    `  buyer owned entities after buy: ${buyerItems.length} ${buyerItems.map((i) => i.name).join(",")}`,
  );
  buyerDb = await dbChar(buyerId);
  note(`  buyer inventory state: ${JSON.stringify(buyerDb.inventory)}`);
  ok(
    buyerItems.length > 0 || (Array.isArray(buyerDb.inventory) && buyerDb.inventory.length > 0),
    `buyer has inventory after market buy (entities=${buyerItems.length}, stateInv=${Array.isArray(buyerDb.inventory) ? buyerDb.inventory.length : 0})`,
  );

  // --- 10. Claim vehicle ---
  step("10. Claim a vehicle");
  const vehicles = await api("GET", "/v1/vehicles");
  ok(
    vehicles.ok && (vehicles.body.vehicles || []).length > 0,
    `vehicles available ${vehicles.body.vehicles?.length}`,
  );
  const free = (vehicles.body.vehicles || []).find((v) => !v.ownerId);
  if (free) {
    const claim = await api("POST", "/v1/vehicles/claim", {
      ownerId: id,
      vehicleId: free.vehicleId,
    });
    ok(claim.ok, `claim HTTP ${claim.status}`);
    const owned = await ownedVehicles(id);
    ok(owned.length >= 1, `DB owner_id set on vehicle (${owned.length})`);
    note(`  vehicle state: ${JSON.stringify(owned[0]?.state)}`);
  } else {
    bugs.push("no free vehicle to claim");
    fail++;
  }

  // --- 11. Crime → heat ---
  step("11. Commit a theft and check heat");
  const heatBefore = (await dbChar(id)).heat;
  const steal = await api("POST", "/v1/actions", {
    actorId: id,
    rawText: "I steal a wallet from a drunk near the dumpsters",
  });
  ok(steal.ok, `steal HTTP ${steal.status}`);
  note(`  legal: ${JSON.stringify(steal.body.legal || null)}`);
  note(`  narr: ${String(steal.body.narration || "").slice(0, 120)}`);
  me = await dbChar(id);
  ok(me.heat > heatBefore, `heat rose ${heatBefore} → ${me.heat}`);
  ok(
    Object.keys(me.factions).length > 0 || steal.body.factionStanding,
    `faction standing touched ${JSON.stringify(me.factions)}`,
  );

  // --- 12. Drive/move with vehicle speed ---
  step("12. Drive somewhere with claimed vehicle");
  const drive = await api("POST", "/v1/actions", {
    actorId: id,
    rawText: "I drive to the Foundry Ward",
  });
  ok(drive.ok, `drive HTTP ${drive.status}`);
  note(`  travel: ${JSON.stringify(drive.body.travel || null)}`);
  note(
    `  trace: ${(drive.body.calculationTrace || []).filter((t) => /travel|speed|action=/.test(String(t))).join(" | ")}`,
  );
  ok(
    drive.body.calculationTrace?.some((t) => String(t).includes("speed_factor")) ||
      drive.body.travel,
    "vehicle speed considered or travel returned",
  );

  // --- 13. History ---
  step("13. Action history length");
  const hist = await api("GET", `/v1/actions?actorId=${id}`);
  const acts = hist.body.actions || [];
  ok(acts.length >= 5, `history has ${acts.length} actions`);

  // --- 14. Web shell still loads ---
  step("14. Web guest shell");
  try {
    const html = await fetch("http://127.0.0.1:3000/").then((r) => r.text());
    ok(/NOCTURNE|app-shell|Create your character/i.test(html), "web HTML contains app markers");
  } catch (e) {
    ok(false, `web unreachable ${e.message}`);
  }

  // --- Summary ---
  me = await dbChar(id);
  note("\n=== FINAL PLAYER STATE ===");
  note(JSON.stringify(me, null, 2));
  note(`\n=== AUDIT: ${pass} checks passed, ${fail} failed ===`);
  if (bugs.length) {
    note("\nBUGS / GAPS:");
    for (const b of bugs) note(` - ${b}`);
  }
  await sql.end();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await sql.end();
  } catch {}
  process.exit(1);
});
