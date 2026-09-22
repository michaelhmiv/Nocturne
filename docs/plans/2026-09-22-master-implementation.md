# Nocturne master implementation plan

Date: 2026-09-22 (revised same day: OSM-first city)
Status: binding sequence for the finish-line engine
Companion: `docs/architecture/sandbox-systems.md`, `packages/contracts/src/sandbox-systems.ts`, `packages/contracts/src/category-source.ts`
Does not replace the revival contract. It reorders work so the engine can exist before the catalog.

## 0. Why the previous order failed

The revival plan is correct about layers: Jev interprets, the engine commits, Laguna narrates. The numbered sequence put canonical NYC geography at #139, after more semantic packets. The live site then asked for clarification on "go to the nearest grocery store" because the engine only binds UUIDs it already has.

The first draft of this plan still treated MapPLUTO tax lots as the thing that answers "nearest grocery." That was wrong. MapPLUTO is a finance file (BBL, LandUse 01–11, RetailArea). OSM is streets, buildings, and `shop`/`amenity` POIs. Grocery is an OSM question. Ownership is a later MapPLUTO join.

## 1. Doctrine

1. There is one player-command engine. API, worker, MCP, and tests call it.
2. The engine never reads English. Jev emits an intent packet. If the packet cannot be built, clarify or reject. Never invent a plan in Qwen/Laguna.
3. A destination may be a category + selector. Bind order: known instances → `world_geo` → `source_geo`. Never invent a bodega.
4. **`source_geo` for play is an OSM extract.** Versioned `.osm.pbf` (or derived features) imported into `source_geo.features`. Stable keys are `osm:node:` / `osm:way:` / `osm:relation:`. No live Overpass on the player path.
5. **MapPLUTO is optional overlay**, not the resolver. Join BBL onto an OSM building when Wave G needs ownership. Until then a "parcel" is a building or landuse polygon.
6. Mutation is `UniversalWorldOperation`s with `world_id` / `shard_id` on every row. No-op success is a defect.
7. Clarification is legal only when two already-known playable instances would send the body or an item to different places. "Nearest X" is specified.
8. Adding a noun is a lexicon phrase + an OSM tag row in `CATEGORY_SOURCE_CLASSES`. Adding a verb is almost never allowed.
9. Could the engine run the turn if Laguna were `console.log(facts)`? If no, wrong layer.

## 2. The engine packet

Unchanged.

```text
EngineIntent
  worldId, shardId, actorId, requestId
  primitive, category?, selector, travelMode?
  explicitEntityIds[]   // only compiled candidates
  constraints, rawText  // rawText is audit only
```

```text
compileContext(actor)
  -> bind(intent, queryPort)     // instances, world_geo, source_geo
  -> authorize
  -> plan(operations)
  -> commit | fail-closed
  -> facts for Laguna + dashboard
```

Ports:

- `WorldQueryPort` — actor point, known instances
- `SourcePort` — OSM features by family + walking bbox (`CATEGORY_SOURCE_CLASSES`)
- `MaterializePort` — playable instance keyed to `osm:…`
- `MutationPort`, `ClockPort`

MapPLUTO may later implement a second `SourcePort` for `owned` lots. It must not answer `nearest` grocery.

## 3. Current truth

Present:

- Kernel packet, bind/plan, in-memory ports (Wave A on this branch)
- `CATEGORY_SOURCE_CLASSES` + `createFeatureSourcePort` (Wave B data plane)
- Category-travel command gate (grocery is specified travel)
- `source_geo` / `world_geo` schemas and dataset rows, including `openstreetmap_nyc_seed` (still `unimported`)
- Jev fast-path, universal operations, dashboards, revival regressions

Not done:

- OSM extract is not loaded into `source_geo.features`
- `resolveCityDestination` is not wired through `PersistentWorldActionService.submit`
- Starter body may still sit on `legacy:` cells
- #152 / #153 / #154
- Live site grocery sentence still clarifies

## 4. Geography contract (OSM-first)

```text
OSM extract
  highway            → streets / route graph
  building           → place.building (this is the playable "parcel" at launch)
  shop|amenity|…     → activity families
  railway/station    → transit
  landuse/leisure    → parks, industrial, etc.
        ↓
world_geo.spatial_entity.stable_key = osm:way:123
        ↓
playable interior / stock / clerk when bound
```

Activity checklist is the OSM tag table, not LandUse 01–11:

| family                   | OSM match                                          |
| ------------------------ | -------------------------------------------------- |
| `place.retail.food`      | `shop=convenience\|supermarket\|greengrocer\|deli` |
| `place.retail.pharmacy`  | `amenity=pharmacy`                                 |
| `place.service.fuel`     | `amenity=fuel`                                     |
| `place.service.garage`   | `shop=car_repair`                                  |
| `place.service.hospital` | `amenity=hospital`                                 |
| `place.civic.precinct`   | `amenity=police`                                   |
| `place.transit`          | `station=subway` / `public_transport=station`      |
| `place.service.laundry`  | `shop=laundry`                                     |
| `place.building`         | `building=*`                                       |
| `place.street`           | `highway=*`                                        |

LandUse / BldgClass / RetailArea stay documented for Wave G. They do not decide travel.

ODbL: attribute OSM on the site. Snapshot the extract. Do not query OSM live per turn.

## 5. Sequence

### Wave A — Kernel — landed on this branch

Packet, bind, plan, invented-success ban, in-memory tests. Do not reopen unless the packet shape changes.

### Wave B — OSM city as destination resolver

**Goal.** Starter body has lon/lat on an OSM building. "Go to the nearest grocery store" binds `shop=convenience|supermarket|…` and moves.

Still to build:

1. Import one NYC OSM extract into `source_geo.features` (roads + buildings + POIs). Mark `openstreetmap_nyc_seed` imported.
2. Actor snapshot always has `locationId`, `lon`, `lat`, `worldId`, `shardId`. Starter apartment = one `building=apartments` (or `yes`) + interior, key `osm:way:…`. No `legacy:` cells.
3. `resolveCityDestination`: walking bbox → `querySourceFeatures` → `pickNearestFeature` → upsert `world_geo` by stable OSM key → return entity id.
4. Wire that into `PersistentWorldActionService.submit` via the existing category-travel gate. UUID destinations keep the old move handler.
5. Isolation on every kernel mutation (#152).

Exit (one activation cell, live site):

1. Look / money / body / exits from state.
2. Grocery sentence: no clarification, location changes, dashboard/map/history agree, stable key is `osm:…`.
3. Repeat does not duplicate the POI.
4. Empty extract → city-source failure, not "which grocery?"
5. "go there" still clarifies or rejects.
6. World A invisible to world B.
7. Live Jev: 20 grocery paraphrases → travel + `place.retail.food` + nearest.

Protect this slice. No vehicles until it passes.

### Wave C — Core verbs on the same bind

look, pick up, buy, eat, talk, wait/stretch (#154), walk. Kill #153 empty mutating success.

Exit: apartment → grocery → buy → eat → talk → home. Playwright desktop + mobile.

### Wave D — Vehicles

`occupy` + `travel` mode `drive`. Parked cars from OSM `amenity=parking` / street occupancy, not a minigame.

### Wave E — Body, tools, weapons

`operate` + `damage`. Missing pistol impossible. Fists already certified.

### Wave F — Heat, police, newspaper

Police from `amenity=police`. Evidence-only paper.

### Wave G — Property overlay + work + two bodies

Optional MapPLUTO join: OSM building → BBL when you need lease/own. Work clocks. Presence. No elections or cosmetics.

## 6. Later content

Nearest laundromat: lexicon row + `shop=laundry` (already in the table) + one extract query test. Stop.

Boats: `vehicle.boat` + waterway edges from OSM. Same kernel.

Lockpick: `operate` on a lock. No new kind.

## 7. Testing law

Revival gates stand. Engine PRs also need: schema round-trip, paraphrase table, missing source = zero mutation, isolation, replay, worker clocks, dashboard fingerprint, live Jev when the packet or lexicon changes.

A wave that cannot run grocery travel against an OSM feature index may not add combat tables.

## 8. Tickets

| Ticket             | Fate                                           |
| ------------------ | ---------------------------------------------- |
| #113               | Wave A+B are the action core + city foundation |
| #152 / #153 / #154 | B isolation, C no-ops, C clocks                |
| #142 live runner   | After Wave C                                   |
| revival #139       | OSM extract + bind, not MapPLUTO-first         |
| revival #140+      | After the loop is real                         |

## 9. Stop rules

Stop if someone adds `goToGrocery()`, a noun-specific `WorldActionKind`, a seeded store as the definition of nearest, Laguna choosing a destination, clarification for `nearest`, or MapPLUTO LandUse as the grocery matcher.

## 10. Next, in order

1. Keep constitution + Wave A + category table (this branch).
2. Import a bounded Manhattan OSM extract into `source_geo`.
3. Starter point on an OSM building.
4. Wire `resolveCityDestination` into submit.
5. Type the grocery sentence on the site.
6. Only then buy / eat / talk.

If step 5 still clarifies, the engine is still not wired. Do not expand scope.
