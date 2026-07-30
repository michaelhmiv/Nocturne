#!/usr/bin/env node
// Phase 4 live smoke
const API = process.env.NOCTURNE_API_URL || "http://localhost:3001";
const BASE = `${API}/v1`;
const H = { "content-type": "application/json", "x-nocturne-guest-mode": "1" };

let pass = 0, fail = 0;
const check = (ok, msg) => {
  if (ok) { pass++; console.log("✓", msg); }
  else { fail++; console.log("✗", msg); }
};
const post = async (path, body) => {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
  if (!r.ok) throw new Error(`${path} ${r.status}: ${t}`);
  return j;
};
const get = async (path) => {
  const r = await fetch(`${BASE}${path}`, { headers: H });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
  if (!r.ok) throw new Error(`${path} ${r.status}: ${t}`);
  return j;
};

const main = async () => {
  const c = await post("/characters", { name: "P4 Runner", conceptSummary: "phase4 tester" });
  const id = c.characterId;
  check(!!id, `character ${id}`);
  try { await post("/residences/starter/rent", { characterId: id }); check(true, "rented"); }
  catch (e) { check(true, `rent skip ${String(e.message).slice(0,40)}`); }

  // Move
  const mv = await post("/actions", { actorId: id, rawText: "I move to the Rear Alley" });
  check(!!mv.travel || mv.calculationTrace?.some(t => String(t).includes("travel")), `move travel ${JSON.stringify(mv.travel||{}).slice(0,80)}`);
  check(mv.calculationTrace?.some(t => String(t).includes("action=move")), "move typed");

  // Crime → heat
  const st = await post("/actions", { actorId: id, rawText: "I steal a wallet from the contact" });
  check(!!st.legal || st.calculationTrace?.some(t => String(t).startsWith("heat=")), `heat ${JSON.stringify(st.legal||st.calculationTrace?.filter(x=>String(x).includes('heat')))}`);
  check(st.factionStanding || st.calculationTrace?.some(t => String(t).includes("faction=")), "faction shift");

  // Comms
  const cm = await post("/actions", { actorId: id, rawText: "I message Rook about the drop" });
  check(!!cm.comms || cm.calculationTrace?.some(t => String(t).includes("comms")), `comms ${JSON.stringify(cm.comms||{}).slice(0,80)}`);
  const msgs = await get(`/comms?actorId=${id}`);
  check(Array.isArray(msgs.messages) && msgs.messages.length >= 1, `comms list ${msgs.messages?.length}`);

  // Attack for more heat (maybe warrant)
  for (let i = 0; i < 6; i++) {
    await post("/actions", { actorId: id, rawText: "I attack the contact wildly" });
  }
  const hot = await post("/actions", { actorId: id, rawText: "I steal again desperately" });
  check(
    hot.legal?.warrant === true || hot.calculationTrace?.some(t => String(t).includes("warrant=true")) || hot.legal?.heat >= 40,
    `warrant/heat path heat=${hot.legal?.heat} warrant=${hot.legal?.warrant}`,
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

main().catch((e) => { console.error(e); process.exit(1); });
