# Nocturne build-out guidance

Binding for the rest of the build. Companion to `docs/architecture/sandbox-systems.md` and `docs/plans/2026-09-22-master-implementation.md`.
Does not replace the revival contract. It is the product sequence the engine must survive.

Jev interprets. The engine commits. Laguna narrates committed facts.
OSM is the city. MapPLUTO is a later ownership overlay.
A new noun is a lexicon phrase + source or inventory field + a test.
A new verb is almost never allowed.

---

## Invariant (every build-out)

Packet Jev may emit:

```text
EngineIntent
  worldId, shardId, actorId, requestId
  primitive              // travel | perceive | search | operate | transfer |
                         // consume | damage | repair | restrain | release |
                         // communicate | wait | work | occupy
  category?              // place.* | item.* | vehicle.* | actor.* | body.self
  selector               // nearest | here | known | named | equipped | carried | owned
  travelMode?            // walk | run | sneak | drive | transit | ...
  explicitEntityIds[]    // only compiled candidates
  constraints            // hours, payment, stealth, force, durationSeconds
  rawText                // audit only; engine must not parse it again
```

Kernel, one function, every turn:

```text
compileContext(actor)
  → bind(intent, queryPort)     // instances → world_geo → source_geo
  → authorize(physics, law, money, body)
  → plan(UniversalWorldOperation[])
  → commit | fail-closed
  → facts for Laguna + dashboard
```

Ports stay ports. Do not invent a second engine in the API or in Laguna.

Clarification is legal only for `clarify_known_conflict` (two already-known playable instances).
`nearest` is specified. Empty source is `need_source`, not a prompt.
No-op success on a mutating primitive is a defect.
Every mutation carries `world_id` / `shard_id`.
Could the turn run if Laguna were `console.log(facts)`? If no, wrong layer.

Stop and rewrite if someone adds `goToGrocery()`, a noun-specific `WorldActionKind`, a seeded store as the definition of nearest, or Laguna choosing a destination.

---

## Build-out 1 — City is playable

### Purpose

The live turn uses the city. Geography is the destination resolver, not imported scenery.

### Scope (do this, nothing else)

1. **`submit()` city path**
   - `isCategoryTravelCommand` is a deterministic bypass (same class as scoped search).
   - Call `resolveCityDestination` → `buildCityTravelPlan`.
   - UUID destinations keep the old move path.
   - Missing city hit uses `missingCityDestinationPrompt(family)`, never "which grocery?"

2. **Actor point**
   - Snapshot always has `locationId`, `lon`, `lat`, `worldId`, `shardId`.
   - Starter apartment = one OSM `building=apartments|yes` + interior, stable key `osm:way:…`.
   - Ban `legacy:` cells as the body location.

3. **Bind ladder**
   - Known playable instances of that family in walking range.
   - Else `world_geo` already keyed to an OSM feature.
   - Else `source_geo` / fixture via `CATEGORY_SOURCE_CLASSES` + `pickNearestFeature`.
   - Materialize one place + entrance keyed to `osm:node:` / `osm:way:`.
   - Repeat command must upsert, not duplicate.

4. **Travel commit**
   - `move_entity` (or scheduled move) with honest seconds (straight-line fallback is allowed in the cell).
   - Location change is visible on dashboard, map, history, scene.
   - World A cannot see World B's materialized place.

5. **Source**
   - Cell may use `OSM_MANHATTAN_FIXTURE` until an extract exists.
   - Same port. Extract replaces the feature list, not the resolver.
   - No live Overpass on the player path.
   - MapPLUTO LandUse is not a grocery matcher.

### Families that must work on the same function

food, pharmacy, laundry, restaurant, bar, bank, liquor, hardware, fuel, garage, hospital, precinct, firehouse, transit, post.

Occupy (`get in the parked car`) and operate (`shoot the pistol`) must **not** go through this travel resolver.

### Tests (must stay green)

- Surface table: each family → one OSM key → move plan with that `destinationId`.
- Fuel ≠ food. Hospital ≠ precinct.
- Empty feature list → `need_source`, zero operations.
- Two known groceries → clarify; one known or source hit → no clarify.
- Isolation: world A destination invisible to world B.
- Idempotent rematerialize of the same `sourceKey`.
- After wire: live site grocery + pharmacy + hospital sentences change location.

### Out of scope here

Buy, eat, interiors beyond a single entrance, cars as instances, weapons as instances, borough extract, Playwright certification of the full loop.

### Exit

On the deployed site, from the starter body: `go to the nearest grocery store` and at least one other family walk there without clarification. If that fails, do not start Build-out 2.

---

## Build-out 2 — Apartment → street → shop loop

### Purpose

One night in the cell is a game, not a directory of pins.

### Scope

1. **Perceive**
   - Look / check money / body / exits read state only.
   - No mutation. No Laguna-invented furniture.

2. **Interiors**
   - Building instance owns a tiny graph: `street_door` — `front` — optional `counter` / `back`.
   - Entering a store is travel onto a child location keyed to the same OSM feature + suffix (`osm:node:14th-convenience#front`).
   - Do not generate a unique prose room per visit.

3. **Transfer**
   - Take: item must be present and unowned or takeable.
   - Buy: stock from **family capacity** (bodega food-ish, pharmacy medical-ish), payment or `insufficient`.
   - No SKU encyclopedia. Three to eight stock slots per family is enough.
   - Steal is transfer + a witness event. Heat is Build-out 3; the event must still be written now so 3 is not a rewrite.

4. **Consume**
   - Existing consumption path, `world_id` on every row (#152).
   - Missing item is impossible, not a prompt.

5. **Communicate**
   - Clerk is a role on the place, not a spawned novel person mid-turn.
   - Talk writes a claim + NPC memory. No ownership transfer via dialogue.

6. **Wait / work-lite**
   - Stretch / wait use the wall-clock worker (#154).
   - Empty mutating commit is failure (#153).

7. **Loop shape**
   - Apartment → nearest food → enter → buy allowed item → eat → talk to clerk → walk home.
   - Replay of the same idempotency key does not double-charge or double-move.

### Tests

- Sitting script above, unit then Playwright desktop + mobile.
- Insufficient funds: zero stock change.
- Consume isolation across worlds.
- Worker completes a two-minute wait.
- Dashboard fingerprint equals the receipt.
- Clerk talk does not move items.

### Out of scope here

Driving, shooting, police response, second player, property leases, full extract.

### Exit

One human sitting on the live cell completes the loop without a clarification on `nearest` and without "You accomplish your objective" on an empty commit.

---

## Build-out 3 — Sandbox teeth

Three modules. Same kernel. Ship in this order. Each has its own exit. Do not braid them into one PR.

### 3A. One car

**Instance, not a parking amenity.** `amenity=parking` may *hint* a spawn cell. The car is `vehicle.automobile` with a stable id.

- `occupy` seat (here, accessible, not already occupied).
- `operate` ignition: keys in inventory or a mechanic check. Missing keys fail-closed.
- `travel` with `travelMode=drive` on highway edges only. Off-road is impossible, not a hop.
- Fuel is a resource on the instance. Empty tank fails drive.
- Trunk is a container. Transfer into it is transfer.
- Stolen flag + plate fields exist now; police response waits for 3C.

Exit: `get in the parked car` binds one accessible car. `drive to the nearest garage` reuses Build-out 1 resolver with mode drive and faster seconds.

### 3B. One weapon + body

- Fists remain anatomy (existing regression).
- Weapon is `item.weapon` + ammo resource + legal class. Gun shop on the map ≠ a gun in hand.
- `operate` + `damage` against a body or object in `here` / adjacent.
- Missing pistol cannot fire.
- Noise event written for witnesses (data only until 3C).
- Defeat: GTA recovery clock, drop carried cash/items, keep bank / property / skills. Body is not deleted.

Exit: missing pistol impossible. Bare fist resolves. Defeat drops carried cash. Two-minute stretch still completes.

### 3C. Heat

- Witnesses from committed events + visibility. No omniscient wanted level.
- Heat per actor per faction.
- Police pathfind from `place.civic.precinct` already on the city table.
- Arrest is `restrain` by an authorized actor.
- Newspaper / public feed reads public evidence only.

Exit: unidentified theft can make the paper without a name. Hidden act stays hidden. Open theft can attract a precinct path.

### Shared 3 rules

- No new primitives.
- No vehicle minigame, cover-shooter, or star meter as a separate product.
- Tests per module: bind, fail-closed missing resource, isolation, receipt ≠ dashboard.

---

## Build-out 4 — City scale and other people

Only after 1–3 exist on the cell. Scaling a broken loop multiplies bugs.

### Extract

- Versioned NYC OSM extract into `source_geo.features` (roads, buildings, POIs).
- Stable keys unchanged.
- Activation cells so the whole borough is not hot.
- Hours on POIs when tags exist; closed → wait or fail.
- Street graph replaces straight-line seconds where edges exist.
- ODbL: attribute OSM; snapshot the extract; no live Overpass.

### Presence

- Two bodies in one cell can perceive each other.
- Contested transfer locks.
- Offline body stays put and is lootable per revival policy.
- Same isolation rules: `world_id` / `shard_id` on every row.

### Property and work

- Lease / own as relations on interiors that already sit on OSM buildings.
- MapPLUTO BBL join is optional and only here.
- `work` = timed labor + one payroll write.

### Still not this build-out

Elections, cosmetics, radio, character creator, long-horizon NPC ambitions, Liberty-City-complete density.

### Exit

A second account sees the first body in the cell. A stolen car in world A is invisible in world B. An extract query for grocery still returns a real `shop=convenience|supermarket|…`, not a fixture-only hit, inside at least one non-fixture cell.

---

## Guidance while building (any week)

1. Name the build-out in the PR. If the diff spans two build-outs, split it.
2. Touch the packet only if a primitive is truly missing. Argue in the PR, do not sneak a kind.
3. City questions go through `SourcePort` + `CATEGORY_SOURCE_CLASSES`. Inventory questions go through possession. Do not query OSM for a pistol in hand.
4. Keep the surface table green when adding a family. One new row, one new fixture feature if the cell lacks that tag.
5. Live Jev (`OPENROUTER_API_KEY`) only when the packet shape or lexicon changes — paraphrases must emit primitive + family + selector, not a store name.
6. If a sitting still needs clarification on `nearest`, stop adding modules. The engine is not the engine yet.

## Mapping to tickets

| Ticket | Lives in |
| --- | --- |
| Action core + NYC foundation (#113) | Build-out 1 |
| Isolation #152 | 1 (travel) and 2 (consume) |
| No-op success #153 | 2 |
| Timed stretch #154 | 2 |
| Live runner #142 | after 2 |
| Revival geography #139 | 1, extract in 4 |
| Vehicles / weapons / heat | 3A / 3B / 3C |
| Multiplayer / property | 4 |
