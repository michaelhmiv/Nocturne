# Persistent Shared-World Architecture

Status: accepted for implementation

## Product model

Nocturne is a persistent, shared, real-time world simulation. Player commands are not isolated prompts. They are requests to inspect or mutate an authoritative world whose entities, locations, relationships, knowledge, plans, and history remain durable across actions and sessions.

The database is authoritative. AI output is never authoritative by itself.

A narration may describe only facts that were already known to the viewpoint or were committed by the selected mutation branch. A convincing paragraph cannot create an item, move a character, establish ownership, injure an entity, reveal hidden information, complete travel, or kill a target.

## Locked decisions

- Launch with one shared production world while scoping data by world and shard from the beginning.
- Preserve accounts and authentication during cutover; archive and replace prototype world state where necessary.
- Use canonical macro geography with controlled, lazily materialized minor locations and interiors.
- Permit bounded generation of ordinary entities and locations from authoritative materialization sources.
- Persist every observed, named, affected, related, moved, owned, controlled, injured, killed, or event-involved entity.
- Discovery never implies possession, control, custody, or ownership.
- Use a real-time world clock. Long actions become scheduled work rather than advancing universal time.
- Allow one exclusive physical plan per actor. New conflicting commands explicitly continue, pause, cancel, or supersede it.
- Keep offline characters and property in the world, but restrict severe offline PvP during initial development.
- Gate irreversible PvP outcomes until the supporting safety, witness, property, response, and recovery systems are mature.
- Use lazy simulation for unattended entities and scheduled events for major autonomous actions.
- Keep player knowledge, aliases, identity confidence, and observations viewpoint-specific.
- Keep DeepSeek Flash as the sole AI provider. AI interprets semantics and proposes bounded operations; deterministic services authorize and commit them.

## Core concepts

### Definition

A reusable semantic description of a kind of thing. Definitions may be globally reusable or world-specific. Examples include a mixed-breed domestic dog, a steel crowbar, a warehouse building, or a compact automobile.

Definitions are versioned. A definition does not represent a unique physical object.

### Instance

A unique durable entity in one world. An instance has a stable identifier, current lifecycle state, location, condition, relations, provenance, versions, and event history.

The thin brown dog found behind a loading dock is an instance. It may reuse a general domestic-dog definition while retaining unique traits and history in instance state and revisions.

### Relation

A durable directed relationship between entities. Relations describe physical, social, legal, informational, and organizational connections. Examples include `located_within`, `following`, `possessed_by`, `owned_by`, `observed`, `trusts`, `fears`, `resides_at`, and `has_access_to`.

Relation wording may remain open-ended, but mechanics use normalized relation families with bounded parameters.

### Event

An immutable authoritative record explaining why state changed. Every gameplay mutation belongs to an event. Events support replay, audit, debugging, compensation, and narrative grounding.

### Fact and knowledge

Objective world state and viewpoint knowledge are separate. An entity may exist without a player knowing it exists. A player may know an alias without knowing the canonical identity. A rumor may be false. Knowledge must retain provenance, confidence, validity, and viewpoint.

### Plan

A durable graph of intended steps, dependencies, waiting conditions, references, and execution state. Plans survive travel, scheduled work, process restarts, clarification, and world changes.

## Mandatory invariants

1. Every durable entity has one stable instance ID and exactly one world.
2. Relations cannot cross worlds.
3. A physical entity has no more than one immediate authoritative physical location.
4. Contained and carried entities derive effective position through a bounded containment chain.
5. Ownership, possession, control, custody, accompaniment, access, visibility, and knowledge are independent concepts.
6. Every mutation is associated with one event and one idempotency key.
7. Replaying an event key returns the original mutation receipt and creates no duplicate state.
8. AI may reference only supplied entities, authoritative symbolic references, or authorized materialization sources.
9. AI never generates authoritative UUIDs.
10. AI never resolves randomness or bypasses deterministic rules.
11. Selected operations are revalidated under locks immediately before commit.
12. Entity versions are incremented by material mutations; stale operations fail rather than overwrite newer state.
13. Narration cannot assert an uncommitted mutation or expose hidden facts.
14. Timed work survives worker and API restarts.
15. A resumed plan recompiles context and revalidates references before every step.
16. Generated entities and locations retain materialization provenance and policy version.
17. Death, destruction, retirement, and merging preserve history rather than deleting identity.
18. Administrative repairs use compensating events where practical.

## Command lifecycle

The target runtime flow is:

1. Resolve the active world, shard, actor, and active plan.
2. Identify references and retrieve candidate entities.
3. Compile relevance-ranked player-known and hidden authoritative context.
4. Interpret intent and propose a plan.
5. Authorize checks, materialization sources, and possible operation branches.
6. Resolve probability and contests deterministically.
7. Select exactly one operation branch.
8. Revalidate facts and versions under transaction locks.
9. Apply all mutations atomically.
10. Write the event and mutation receipt.
11. Schedule or resume dependent plan steps.
12. Rebuild the player-safe scene projection.
13. Generate narration constrained to committed facts.

## Dynamic geography

Nocturne does not pre-create every room, alley, warehouse, or ordinary object.

Macro geography is canonical: world, region, city, district, street or block, parcel, property, and significant building.

Minor spaces are lazily materialized beneath existing geography when gameplay makes them significant. A loading bay, rear service alley, maintenance corridor, basement room, or office normally becomes a child of an existing property instead of creating another building.

Before materializing a new place, the engine searches for compatible existing locations using parent area, approximate spatial cell, semantic type, footprint, access, occupancy, ownership, aliases, and semantic fingerprint. Once observed, entered, named, altered, purchased, damaged, or included in a committed event, the location is durable shared geography.

## Dynamic population

Generation is bounded by authoritative reservoirs and profiles. A location may support ordinary urban animals, workers, residents, vehicles, mundane resources, or minor businesses without containing a hard-coded catalog.

A request does not create an entity merely because the player named it. The resolver first searches existing visible and hidden entities, then checks whether an authoritative source can plausibly materialize the requested concept. Capacity, regeneration, ecology, geography, rarity, time, and prior generation constrain the result.

## Shared-world concurrency

All contested state uses transaction locks, expected versions, and deterministic resolution. Two actors cannot both acquire the same unique item. The first valid commit changes the world; later stale actions recompile context. Genuinely simultaneous contests use an authoritative contested check instead of request latency alone.

## Initial PvP boundaries

The architecture supports contested actions between players. During initial development:

- severe irreversible offline PvP is restricted;
- permanent death, catastrophic property destruction, and total inventory loss are gated;
- lower-severity theft attempts, pursuit, assault, restraint, access violations, and property effects may be enabled where supporting mechanics are authoritative;
- policies are data-driven and can expand without replacing the simulation architecture.

## Canonical acceptance scenario

The system is not considered complete until generic primitives can support this sequence without dog-specific code:

1. A player travels to an alley and searches for a dog.
2. The resolver finds an existing dog or materializes one from a bounded local source on a successful branch.
3. The unique dog persists with location, condition, provenance, aliases, and viewpoint-specific knowledge.
4. Discovery does not grant ownership.
5. A later action establishes trust and following only if resolved successfully.
6. Travel moves the player and dog as a validated cohort.
7. Putting the dog inside the house changes its location and relevant relations.
8. The player leaves; the dog remains.
9. Hours later, the same dog is resolved and lazily simulated.
10. Another player can encounter the same dog without automatically knowing its private alias or history.
