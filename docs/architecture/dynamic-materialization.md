# Dynamic Materialization

Status: accepted for implementation

## Goal

Nocturne must support open-ended ordinary content without a fixed catalog and without allowing player requests to conjure unlimited entities, valuables, locations, or resources.

Materialization converts an authoritative unrealized possibility into a durable entity or location only when a selected event branch requires it.

## Source types

Authorized sources include:

- population reservoirs;
- ecology profiles;
- ambient resource pools;
- property contents profiles;
- encounter sources;
- prior events;
- scheduled arrivals;
- explicit player creation, construction, or invention;
- administrative world seeding.

Each source has world scope, location scope, semantic constraints, capacity, regeneration policy, rarity, provenance, and policy version.

## Resolution order

Before creating anything, the resolver must:

1. Search compatible visible entities.
2. Search compatible hidden entities.
3. Search known but currently unresolved candidates.
4. Search existing compatible locations or definitions.
5. Identify authorized materialization sources.
6. Derive a bounded proposal with DeepSeek.
7. Validate semantics and source constraints.
8. Resolve checks and contests deterministically.
9. Materialize only in the selected branch.
10. Update source capacity and materialization history atomically.

## Entity generation

A generated entity receives:

- a reusable definition reference or a newly created definition where necessary;
- a unique instance ID allocated by the server;
- distinguishing traits;
- current location;
- condition and bounded state;
- lifecycle status;
- source and generation policy;
- source event;
- semantic profile hash;
- initial visibility and knowledge relations.

Generation does not grant ownership or control.

## Persistence threshold

A live generated entity is permanent once it is observed, named, affected, moved, related, possessed, controlled, injured, killed, included in an event, or retained in player knowledge.

Unselected proposals and unrealized possibilities are disposable. The system does not create thousands of unused background records merely because they are plausible.

## Geography

Macro geography is canonical. Minor locations are materialized beneath existing geography.

Before creating a new location, the engine searches by:

- parent location;
- approximate spatial cell or coordinates;
- semantic family;
- footprint;
- access pattern;
- owner or occupant;
- aliases;
- semantic fingerprint;
- generation history.

A loading bay normally becomes part of an existing warehouse. Repeated references to `the old warehouse` reuse one location when identity evidence matches.

## Naming

Generated locations and entities may begin with descriptive labels rather than proper names. Names can later become public or viewpoint-specific through registry data, player naming, NPC usage, business formation, or repeated public use.

## Capacity and regeneration

Sources prevent infinite generation. Capacity may represent local population, ordinary property stock, mundane contents, ecological prevalence, or available ambient resources. Regeneration is explicit and may be absent, slow, event-driven, or seasonally bounded.

The source remains semantic rather than catalog-driven. `ordinary urban animals` can authorize a stray dog but not an exotic tiger unless constraints and world history support it.

## Definition reuse

The system should reuse compatible semantic definitions and always create unique instances. Unique descriptive traits and personal history belong to the instance.

## Acceptance examples

- A successful alley search can create one durable stray dog from an urban-animal reservoir.
- A failed search creates no dog.
- An existing hidden dog is discovered before a new one is created.
- Replaying the event does not create another dog or consume capacity twice.
- Repeated warehouse searches reuse an existing building and materialize only needed sublocations.
- Requesting an implausible or exhausted resource fails rather than creating it.
