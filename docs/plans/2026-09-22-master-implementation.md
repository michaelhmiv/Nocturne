# Nocturne master implementation plan

Date: 2026-09-22
Status: binding sequence for the finish-line engine
Companion: `docs/architecture/sandbox-systems.md`, `packages/contracts/src/sandbox-systems.ts`
Does not replace the revival contract. It reorders work so the engine can exist before the catalog.

## 0. Why the previous order failed

The revival plan is correct about layers: Jev interprets, the engine commits, Laguna narrates. The numbered sequence put canonical NYC geography at #139, after more semantic packets and consequence frameworks. The live site then asked for clarification on "go to the nearest grocery store" because the engine only binds UUIDs it already has.

Scribe-class IF engines fail the same way: the world is a graph of authored passages. Evennia, Quilltale, TaleWeaver, and TADS succeed where they keep a typed world and treat prose as a view. Nocturne already has the view split. It does not yet have one engine that answers categories against the city.

This plan builds that engine first, then turns systems on against it. Vehicles, weapons, jobs, heat, and property are later _modules of the same kernel_, not later products.

## 1. Doctrine

1. There is one player-command engine. API, worker, MCP, and tests call it. Handlers in `world-action-handler-registry.ts` become adapters that die as the kernel covers their primitive.
2. The engine never reads English. Jev (or a deterministic compiler for held-out paraphrases) emits an intent packet. If the packet cannot be built, clarify or reject. Never invent a plan in Qwen/Laguna.
3. A destination may be a category + selector, not only a UUID. The engine resolves it against known instances, then `world_geo`, then `source_geo`. It never invents a bodega.
4. Mutation is a list of `UniversalWorldOperation`s committed atomically with `world_id` / `shard_id` on every row. No-op success is a defect.
5. Clarification is legal only when two already-known playable instances would send the body or an item to different places. "Nearest X" is specified.
6. Adding a future noun is a lexicon entry + source class + maybe a snapshot field. Adding a future verb is almost never allowed. If it does not map to travel / perceive / search / operate / transfer / consume / damage / repair / restrain / release / communicate / wait / work / occupy, stop and ask why.
7. Could the engine run the turn if Laguna were `console.log(facts)`? If no, the work is in the wrong layer.

## 2. The engine packet

This is the only thing Jev is allowed to produce for a player command.

```text
EngineIntent
  worldId, shardId, actorId, requestId
  primitive              // travel, transfer, ...
  category?              // place.retail.food, vehicle.automobile, item.weapon
  selector               // nearest | here | known | named | equipped | carried | owned
  travelMode?            // walk | run | sneak | drive | transit | ...
  explicitEntityIds[]    // only IDs that appeared in compiled candidates
  constraints            // hours, payment, stealth, force, durationSeconds
  rawText                // audit only; engine must not parse it again
```

Kernel pipeline, one function:

```text
compileContext(actor)
  -> bind(intent, queryPort)          // instances, then world_geo, then source_geo
  -> authorize(bind, physics, law, money, body)
  -> plan(operations: UniversalWorldOperation[])
  -> commit(operations) | fail-closed
  -> facts for Laguna + dashboard projections
```

Ports (interfaces, not new products):

- `WorldQueryPort` — actor point, known instances, category-near, route
- `SourcePort` — MapPLUTO / OSM / POI lookup by family + bbox
- `MaterializePort` — create playable instance keyed to source feature id
- `MutationPort` — existing universal operations + receipts
- `ClockPort` — schedule / complete timed work on wall clock

The first GIS-backed grocery command and the first stolen car use the same function. Different category, different operations, same kernel.

## 3. Current truth (do not plan as if this is done)

Present and usable:

- Jev fast-path + semantic frame + world-action kinds
- Universal world operations and mutation receipts
- Search discovery / materialization contracts
- Geospatial source registry and MapPLUTO lineage (`0032`)
- Worker stub, dashboard, revival regressions (missing sandwich, missing pistol, two-minute stretch)
- Sandbox constitution + noun lexicon (this branch)

Broken or inverted:

- Move handler requires `destinationId` UUID → category travel clarifies
- Planner binds only supplied instance candidates
- Consume isolation leak to `DEFAULT_WORLD` (#152)
- Generic "you succeed" with no mutation (#153)
- Timed work does not complete on wall clock (#154)
- Starter unit can sit on `legacy:` cells instead of a real parcel
- `WorldActionKind` handlers are the engine, so every new verb wants a new handler
- Geography is imported as source, not queried as the destination resolver

## 4. Sequence

Do not start Wave C until Wave B's grocery sentence mutates location against GIS. Do not start vehicles until travel + buy + consume work on the same kernel.

### Wave A — Kernel in process (about one focused PR)

**Goal.** The engine exists as a package with ports. Nothing new is playable yet. Everything later has a place to plug in.

Build:

- `packages/contracts/src/engine-intent.ts` — packet + result + bind status
- `packages/rules-engine/src/world-engine/` — `decide`, `bind`, `plan`, `authorize`
- In-memory ports for tests
- Map `WorldActionKind` → primitive (move→travel, buy→transfer, eat→consume, talk→communicate, …)
- Ban invented success in the kernel (`need_source` cannot return `completed`)

Do not:

- seed another Foundry Row bodega
- add grocery-specific code
- change the website yet

Exit:

- Unit tests: grocery paraphrase → travel + `place.retail.food` + nearest
- Unit tests: missing source → `need_source`, zero operations
- Unit tests: two known groceries → clarify; one known or GIS hit → no clarify
- Unit tests: drive-to-garage → travel + drive + `place.service.garage`
- Unit tests: fire pistol with no pistol entity → impossible, not a prompt

Learn from: Quilltale validator, Evennia rulebook-as-black-box.

### Wave B — City as the destination resolver (the finish-line slice)

**Goal.** The starter body has a WGS84 point on a real parcel. "Go to the nearest grocery store" walks there.

Build:

- Actor snapshot always includes `locationId`, `lon`, `lat`, `worldId`, `shardId`
- `SourcePort` query: family → OSM/NYC class list → nearest feature in activation cell / walking radius
- Stable key from BBL or OSM id; materialize one place + entrance, not a block of fiction
- Travel plan uses route graph or straight-line fallback with honest seconds, then `move_entity` + timed work
- Wire kernel in front of `PersistentWorldActionService.submit` for travel intents; old move handler remains for explicit UUID destinations
- Fix starter apartment off `legacy:` cells
- Fix #152 isolation on every mutation the kernel emits

Category → source class (extend, do not fork):

| family                   | source hint                                                                  |
| ------------------------ | ---------------------------------------------------------------------------- |
| `place.retail.food`      | OSM `shop=convenience\|supermarket\|greengrocer\|deli` + NYC retail land use |
| `place.service.fuel`     | `amenity=fuel`                                                               |
| `place.service.hospital` | `amenity=hospital`                                                           |
| `place.civic.precinct`   | `amenity=police`                                                             |
| `place.transit`          | `station=subway` / `public_transport=station`                                |

Exit (live site, one activation cell):

1. Look. Money. Body. Exits. All from state.
2. "go to the nearest grocery store" — no clarification, location changes, dashboard/map/history agree.
3. Same command twice does not duplicate the place.
4. Closed hours → wait or fail, not clarify.
5. "go there" with no prior bind → clarify or reject.
6. World A grocery is invisible to world B.
7. Live Jev corpus (Actions `OPENROUTER_API_KEY`): 20 grocery paraphrases emit travel+food+nearest, not a store name.

This is the only slice that unblocks the product. Protect it.

### Wave C — Core verbs on the same bind

Once a place can be bound, the eight launch verbs share it.

| verb               | primitive   | commit                                               |
| ------------------ | ----------- | ---------------------------------------------------- |
| look / check money | perceive    | knowledge asset or projection only                   |
| pick up            | transfer    | possession if present                                |
| buy                | transfer    | money + stock or fail insufficient                   |
| eat                | consume     | existing consumption path, scoped world              |
| talk               | communicate | claim + NPC memory, no ownership                     |
| wait / stretch     | wait        | wall-clock schedule that the worker completes (#154) |
| walk               | travel      | Wave B                                               |

Kill #153: if operations.length === 0 and the primitive is mutating, result is failure, never "You accomplish your objective."

Exit: one sitting from apartment → grocery → buy allowed item → eat → talk to clerk → walk home. Replay is idempotent. Playwright desktop + mobile.

Learn from: TaleWeaver two-pass, TADS implicit actions (travel may precede buy without Jev inventing a novel).

### Wave D — Vehicles as occupy + travel mode

No vehicle minigame.

- Category `vehicle.*` from street occupancy reservoir or dealership POI
- `occupy` seat, `operate` ignition (keys or mechanics), `travel` with `drive`
- Fuel is a resource on the instance; empty tank fails drive
- Trunk is a container; transfer into it is transfer
- Stolen flag + plate heat attach here but police response waits for Wave F

Exit: "get in the parked car" binds one accessible car here; "drive to the nearest garage" reuses Wave B resolver with mode drive and faster seconds. Missing keys fail-closed.

### Wave E — Body, tools, weapons

- Fists are anatomy (existing regression)
- Weapon is `item.weapon` + ammo resource + legal class
- `operate` + `damage` against a body or object
- Noise event for witnesses (data only until Wave F)
- Defeat → GTA recovery clock, drop carried cash/items, keep bank/property/skills

Exit: missing pistol cannot fire. Bare fist resolves. Two-minute stretch still completes.

### Wave F — Heat, police, newspaper

- Witnesses from committed events + visibility, not omniscience
- Heat per actor per faction
- Police pathfind from `place.civic.precinct`
- Arrest is `restrain` by authorized actor
- Newspaper reads public evidence only (#146 rules, implemented now that events exist)

Exit: unidentified theft can make the paper without a name. Hidden act stays hidden.

### Wave G — Property, work, multiplayer presence

- Lease/own as relations on interiors that already sit on parcels
- `work` as timed labor with payroll once
- Two bodies in one cell can see each other; contested transfer locks
- Offline body stays put and is lootable per revival policy

Do not build elections, cosmetics, or long-horizon NPC ambitions.

## 5. How later content plugs in without a new engine

When you want "nearest laundromat" six months from now:

1. Add phrases to `SANDBOX_NOUN_LEXICON`.
2. Map family → OSM/NYC class in the source port table.
3. If the place sells something, add an inventory capacity source, not SKUs.
4. Ship a paraphrase test and one live GIS query test.
5. Stop.

When you want boats: `vehicle.boat` + travel mode `drive` restricted to water edges. Same occupy/travel.

When you want lockpicking: `operate` on a lock condition with a skill check already in `rules-engine`. No `handlers.lockpick`.

## 6. Testing law for every wave

Revival gates stand. In addition, every engine PR:

- schema-parses the intent and the receipt
- table of paraphrases → same primitive+family+selector
- missing source / missing item / insufficient money fail with zero mutation
- world isolation
- idempotent replay
- worker completion if a clock was written
- dashboard fingerprint agrees with the receipt
- live Jev job when the packet shape or lexicon changes (Actions secret)

A wave that cannot run grocery-class travel against GIS is not allowed to add combat tables.

## 7. Mapping to existing tickets

| Ticket             | Fate                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| #113 waves 1–4     | Wave A+B _are_ the authoritative action core + NYC foundation, collapsed so geography is not optional |
| #152 isolation     | Wave B kernel emits scoped operations only                                                            |
| #153 no-op success | Wave C kernel refuses empty mutating commits                                                          |
| #154 timed stretch | Wave C clock port + worker                                                                            |
| #142 live runner   | After Wave C; do not certify a story on no-ops                                                        |
| revival #136–#138  | Keep Jev packet work, but packet must include category+selector, not only entity IDs                  |
| revival #139       | Pulled forward into Wave B                                                                            |
| revival #140+      | After the loop is real; UI cannot fix a missing city                                                  |

## 8. Stop rules

Stop and rewrite the packet if someone adds:

- `goToGrocery()`
- a new `WorldActionKind` for one noun
- a seeded store used as the definition of "nearest"
- Laguna choosing a destination
- a clarification for an unambiguous selector

## 9. First week, in order

1. Merge the constitution + lexicon tests (this branch).
2. Wave A kernel + fake ports.
3. Wave B source query on one borough extract + starter point.
4. Wire travel intents only.
5. Sit down and type the grocery sentence on the site.
6. Only then buy/eat/talk/wait.

If step 5 still clarifies, do not expand scope. The engine is still not the engine.
