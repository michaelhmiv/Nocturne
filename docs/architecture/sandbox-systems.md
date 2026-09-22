# Sandbox systems constitution

Status: binding for implementation. This is the missing overview.

Nocturne is a GTA-style living city told in text. The city is New York. Players are ordinary humans. Anything plausible is attemptable. Superhuman outcomes are rejected by physics and law, not by a verb denylist.

A grocery, a pistol, a parked Civic, a precinct, a hospital bed, and a wanted star are not separate games. They are instances of the same machine.

## The machine

```text
player language
  → Jev: primitive + category family + selector + constraints
  → engine: actor point in NYC
          → query known instances, then world_geo, then source_geo
          → reuse or materialize one thing keyed to a source feature
          → validate body, possession, access, time, money, law
          → commit event + state
          → emit witnesses / evidence / heat only from what happened
  → Laguna: narrate committed player-safe facts
```

Jev never invents a store, a car, or a gun. Laguna never moves a body. The engine never asks the player to name a UUID.

Clarification is legal only when two already-known playable instances would send the body or the item to different places. "Nearest grocery" is specified. "Get in the car" is specified if one accessible vehicle is here. "Shoot him" is specified if one visible person matches.

## Why earlier work skipped the picture

`COMPREHENSIVE_DESIGN.md` listed Calder districts and fifty store names. That is a catalog. Catalogs do not scale and they fight NYC GIS.

The revival plan put canonical geography at #139, after more semantic packets. Without a point on the map, every outbound command becomes clarification or a no-op. Geography is the substrate, not a later epic.

The category ladder bound a seeded Foundry Row bodega. That is an apartment demo wearing city clothing.

This document replaces those habits. Nouns are categories. Verbs are primitives. The map is the authority.

## Shared physics

Every sandbox noun is exactly one of:

1. **Source feature** — parcel, building, road, POI in `source_geo`. Not playable until activated.
2. **Spatial entity** — `world_geo` record in an activation cell, stable-keyed to a source feature.
3. **Playable instance** — `game` entity with location, condition, relations, provenance.
4. **Relation** — seated_in, possessed_by, owned_by, aimed_at, employed_by, wanted_by.
5. **Resource / condition** — cash, bank, fuel, ammo, health, stamina, hunger, heat, lock state.
6. **Event + evidence** — what happened, who could know, what can be published.
7. **Schedule** — hours, shift, patrol, transit, recovery clock.

Every player sentence collapses to one primitive, then maybe a compound of primitives:

| Primitive     | Meaning                                       | GTA examples                                     |
| ------------- | --------------------------------------------- | ------------------------------------------------ |
| `travel`      | change the body's place, with a mode          | walk, run, drive, ride subway, climb fire escape |
| `perceive`    | read what is already visible or known         | look around, check wallet, read sign             |
| `search`      | spend time to reveal hidden / unmaterialized  | pat down, trunk, alley, pockets                  |
| `operate`     | use an instance as a tool or control          | unlock, start engine, fire, wear, pump gas       |
| `transfer`    | change possession or location of an object    | buy, steal, drop, load trunk, hand over          |
| `consume`     | spend a resource or destroy a portion         | eat, drink, burn fuel, spend ammo, take pill     |
| `damage`      | reduce condition of body, object, or place    | punch, crash, smash window, shoot                |
| `repair`      | restore condition using time, skill, parts    | bandage, body shop, locksmith                    |
| `restrain`    | deny movement or use                          | cuff, lock in, arrest, tie                       |
| `release`     | undo restraint                                | unlock, post bail, drop weapon                   |
| `communicate` | send a claim through a channel                | talk, call, text, radio, gesture                 |
| `wait`        | let the clock run                             | hide, loiter, ride out a timer                   |
| `work`        | reserved timed labor with an employer or task | shift, unload truck, watch a door                |
| `occupy`      | enter a container or seat                     | get in car, sit at counter, lie in hospital bed  |

Travel modes are data on `travel`, not new verbs: `walk`, `run`, `sneak`, `drive`, `ride`, `transit`, `taxi`, `swim`, `climb`.

Selectors are data, not handlers: `nearest`, `any`, `known`, `named`, `equipped`, `carried`, `owned`, `here`, `along_route`.

If a proposed feature needs a new primitive, stop. It almost certainly does not.

## Domain coverage — nothing off-page

### 1. Geography

The ground is NYC. MapPLUTO parcels, building footprints, NTAs, OSM roads/paths/POIs.

Activation cells compile a bbox when a character is there or traveling there. Do not pre-build five boroughs as game entities.

Containment: city → district/NTA → street/block → parcel → building → interior → fixture. Interiors materialize under the building that already exists.

Starter apartment must sit on a real parcel with lat/lng. `legacy:<uuid>` cells are a defect.

### 2. Mobility

Pathfinding uses streets and access edges, filtered by mode and locks. Time is distance × mode × traffic × sneak. Each edge crossed can create witnesses.

"Go to the nearest grocery" is `travel` + `place.retail.food` + `nearest`. The engine picks the feature, materializes the door, schedules the walk.

Impossible travel fails: no route, no access, restrained, dead, no fuel for `drive`.

### 3. Vehicles

A vehicle is an instance that is a container, a travel-mode provider, and a registered object.

State: location, seats, occupants, trunk, fuel/charge, condition, keys, registration, stolen flag, alarm.

Sources: dealership POI, street occupancy reservoir, private sale, impound. Ambient parked cars exist as source capacity on a block, not as thousands of pre-spawned rows. Materialize the one the player touches.

Ops: `occupy` seat, `operate` start, `travel` drive, `transfer` into trunk, `consume` fuel, `damage` crash, `repair` shop, `transfer` theft, `restrain` boot/impound.

Wanted heat attaches to the plate and the actor separately.

### 4. Commerce and services

A store is a place with a category family, hours, and an inventory _source_, not a SKU list.

Families include food retail, liquor, pharmacy, hardware, electronics, clothing, pawn, gun dealer, garage, gas, dealership, bank, clinic, hospital, barber, laundromat, gym, hotel, restaurant, bar, locksmith, post, precinct, firehouse, courthouse, transit station.

"Nearest X" is a category query. Hours can make the place closed; that is not clarification. Closed means wait or break in.

Buy is `transfer` against listed price and stock capacity. Empty capacity fails. No invented sandwich.

### 5. Inventory and tools

Everything portable is an instance: cash wad, phone, keys, crowbar, bag, clothing.

Relations: carried, worn, stored_in, installed_in. Encumbrance and concealment are condition fields, not new systems.

Search reveals. Discovery is not ownership.

### 6. Weapons and combat

A weapon is an item with a damage method, range, noise, ammo resource, and legal class.

No combat mode. `operate` + `damage` against a body or object. Fists are anatomy, not a missing item. Missing pistol cannot fire. That regression stays forever.

Outcomes: hit/miss, injury on a body part, noise, spent ammo, dropped weapon, incapacitation. Defeat uses GTA-style recovery: body moves to hospital/home, carried cash and held items can be lost, bank/property/skills persist.

### 7. Body

Health, stamina, hunger, intoxication, bleeding, cuffs, consciousness. Offline bodies stay in the world. They do not act. They can be robbed or helped.

Sleep and wait are `wait` at a valid place. Food is `consume` from inventory or a store.

### 8. Property and housing

Starter unit is a leased interior on a real parcel. Ownership, lease, squat, and institutional assignment are relations. Empty property does not print money. Damage and repair persist on the place.

### 9. Population

Clerks, drivers, cops, bystanders are reservoir + schedule until interacted with. Same physical rules as players. Dialogue is claims and memory, not world mutation.

### 10. Economy

Cash on body, bank ledger, prices, wages, rent, fines, bail. Conservation is an invariant. No negative money. Duplicate buy does not duplicate goods.

Jobs are `work` with an employer and a clock. Crime pays only through committed transfers.

### 11. Law and heat

Crimes are classified after the event, from what witnesses and recordings could know. Heat is per actor per faction. Unknown offender stays unnamed in the newspaper.

Arrest is `restrain` by an authorized actor. Jail is a location with denied travel. Trial and sentences are scheduled work. Superpowers are excluded; so is omniscient police.

### 12. Emergency services

Police, ambulance, fire are factions with stations on the map and response windows. They pathfind. They do not teleport. Hospital is a place that can `repair` a body on a clock.

### 13. Information

Four layers: what happened, what was recorded, what someone believes, what is public. Cameras, phones, plates, receipts are instances that can record. Planting or destroying evidence mutates layer 2, never layer 1.

### 14. Communication

Face to face, phone, text, radio. Each needs a channel, a device or proximity, and a time window. Interception requires access + capability + presence.

### 15. Time

Wall clock is authority. Travel, work, healing, sentences, store hours use it. Worker completes due work. A two-minute stretch that never finishes is a release blocker.

### 16. Multiplayer

Same cell can see same bodies. Contested items lock. First valid commit wins. Offline is present and vulnerable within launch policy.

## What "done enough to play" means

Not every domain simulated at Rockstar depth. This loop, in one activation cell, with live Jev:

1. Wake in the starter unit on a real parcel.
2. Look. Money. Body. Known exits.
3. Walk to nearest food retail from GIS. Arrive. Hours apply.
4. Buy something the store category can sell. Money and inventory move.
5. Eat it. Resource changes.
6. Talk to the clerk. Claim stored. World unchanged except memory.
7. Walk back. Dashboard, map, history, narration agree.
8. Repeat a travel/buy without duplicate goods or duplicate places.

Vehicles, guns, heat, jobs, property deals use the same resolver the moment their source and primitive are wired. They do not get their own product.

## Testing law

Every domain above has:

- a contract mapping nouns → primitive + category
- a fail-closed path when source or instance is missing (no invented success)
- an isolation test (world A does not leak into world B)
- an idempotent replay test

Live OpenRouter jobs certify Jev emits primitive + category + selector, not a store name and not a clarification, on the held-out city corpus.

If a domain is not executable yet, tests must say `unsupported` or `need_source`, never `completed` with a generic "you succeed."
