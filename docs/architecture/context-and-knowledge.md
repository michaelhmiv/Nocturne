# Context, Identity, and Knowledge

Status: accepted for implementation

## Separation of truth and knowledge

Nocturne stores objective world state separately from what any player or entity knows.

An entity may exist authoritatively while remaining unknown to every player. A player may observe an entity without knowing its canonical identity. A player-specific alias may be accurate, mistaken, private, or later superseded. Rumors and inferences remain distinct from observations.

## Fact model

Every fact supplied to AI includes:

- fact ID;
- viewpoint ID;
- subject identity;
- claim;
- value;
- visibility;
- provenance;
- confidence where relevant;
- valid-from and optional valid-until boundaries;
- source event or content revision.

The authoritative layer may receive hidden facts needed for resolution. Player-facing planning and narration receive only player-known facts unless the selected event reveals additional information.

## Relevance-aware context compilation

Context is assembled for each command. It is not an ever-growing transcript and is not selected by fixed per-category buckets.

The compiler gathers candidates from:

- the actor and selected world;
- current location and location ancestors;
- nearby visible or perceivable entities;
- explicitly referenced entities and aliases;
- carried, equipped, contained, possessed, owned, controlled, or accompanying entities;
- active plan steps and dependencies;
- recent relevant events;
- current relationships;
- held information and observations;
- known destinations and access relations;
- scheduled work;
- relevant materialization sources;
- relevant hidden mechanics for authoritative resolution.

Candidates are ranked by explicit reference, physical presence, active-plan participation, relationship strength, recency, ownership or control, semantic match, proximity, event involvement, and safety relevance.

Every compiled context records an audit reason for each included entity and fact.

## Entity-reference resolution

The resolver supports:

- canonical names;
- public names;
- player-specific aliases;
- descriptions;
- pronouns;
- relationship references;
- location references;
- ordinal references;
- recent salience;
- partial or mistaken identity.

Resolution states are:

- `resolved`
- `ambiguous`
- `not_found`
- `known_but_inaccessible`
- `known_but_location_unknown`
- `stale_reference`

The resolver returns candidates, confidence, supporting facts, and disambiguating attributes. It asks for clarification when a wrong choice would materially change shared state.

## Naming

Identity supports four layers:

1. stable internal instance identity;
2. canonical or public name, if one exists;
3. generated descriptive label;
4. viewpoint-specific alias or mistaken identity.

Calling a dog `Rufus` does not automatically teach that alias to other players. A warehouse may be known publicly by a registry name and privately as `the old warehouse` without becoming two locations.

## Observations and information

Observation is a relation and may create information assets. Observation does not grant control, possession, ownership, exact condition knowledge, or canonical identity.

Information assets retain:

- holder;
- subject where known;
- content;
- confidence;
- truth status;
- source event;
- validity;
- supersession or invalidation.

## Context budget rules

The compiler uses token and entity budgets, but essential facts cannot be removed solely because a category quota was reached. The active actor, current location, current plan, explicit references, required preconditions, and safety-critical facts are mandatory.

Summaries may compact old events, but durable identity and current state remain queryable.

## Player-safe narration

Narration may use:

- facts already known to the viewpoint;
- newly committed player-visible facts;
- uncertainty explicitly present in the receipt;
- visible outcomes of checks.

Narration may not use:

- hidden entity state;
- hidden identities;
- hidden probabilities;
- unrevealed ownership;
- internal IDs;
- raw operation payloads;
- AI reasoning or calculation traces;
- uncommitted proposed facts.

## Acceptance examples

- A dog following the player remains relevant even after many unrelated turns.
- A dog left at home is omitted from an unrelated street action unless explicitly referenced.
- `the dog` becomes ambiguous when two equally salient dogs exist.
- `Rufus` resolves only for viewpoints that know that alias.
- A dead NPC remains referenceable historically.
- A hidden injury does not appear in the scene until observed or revealed.
